import { createNoorAIHandler } from '../handler.ts';
import { createOpenAIProvider } from '../openai-provider.ts';
import { createProductionDependencies, productionConfig } from '../production.ts';
import {
  createSafetyIdentifierDeriver,
  SAFETY_IDENTIFIER_ACTIVE_VERSION,
  safetyIdentifierPrefix,
} from '../safety-identifier.ts';
import type {
  AuthOutcome,
  ClaimsVerifier,
  NoorAIDependencies,
  SafetyIdentifierDeriver,
} from '../ports.ts';
import { assert, assertEquals, assertExcludes } from './assert.ts';
import {
  createCapturingLogger,
  createFakeClock,
  createFakeProvider,
  createFakeQuotaStore,
  createFakeRequestIds,
  createFakeSafetyIdentifiers,
  createFakeTimer,
  createFakeVerifier,
  createFetchMock,
  createForbiddenProvider,
  createForbiddenQuotaStore,
  createHarness,
  createPerSubjectSafetyIdentifiers,
  createSigningFixture,
  createUnavailableSafetyIdentifiers,
  fixtureKey,
  helpAnswer,
  jsonRequest,
  type RecordingProvider,
  type RecordingQuotaStore,
  TEST_OTHER_USER_ID,
  TEST_PROVIDER_KEY,
  TEST_SAFETY_IDENTIFIER,
  TEST_SESSION_ID,
  TEST_USER_ID,
  testConfig,
  validBody,
  validClaimSet,
  withNetworkTripwire,
} from './fakes.ts';

/**
 * B10 through the handler: where the derivation sits, what it costs when it fails, and what a client
 * can do about it. (Nothing.)
 *
 * ── What none of these tests print ───────────────────────────────────────────
 * No fixture key, no decoded bytes, no HMAC message, no raw user uuid in an assertion message. Where a
 * real key is needed — the production-gate group at the bottom — it is built in test memory from a
 * numeric formula and never rendered. **No secret was generated for production and none is
 * provisioned**; nothing here reads an environment value that exists.
 */

const PROJECT_URL = 'https://project.supabase.co';

function claimsFor(userId: string): AuthOutcome {
  return { ok: true, claims: { userId, sessionId: TEST_SESSION_ID, role: 'authenticated' } };
}

// ─────────────────────────────────────────────────────────────────────────────
// 26/27 — where the derivation sits in the order of operations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A harness whose verifier, deriver, quota store and provider all write into ONE ordered timeline.
 *
 * Separate recorders can each prove their own call happened; only a shared array can prove which came
 * first, and "after verification, before the reservation" is exactly a claim about that.
 */
function createOrderedHarness(options: {
  readonly auth?: AuthOutcome;
  readonly derived?: boolean;
  readonly quota?: RecordingQuotaStore;
  readonly provider?: RecordingProvider;
} = {}): {
  readonly deps: NoorAIDependencies;
  readonly events: readonly string[];
  readonly quota: RecordingQuotaStore;
  readonly provider: RecordingProvider;
  readonly subjects: readonly string[];
} {
  const events: string[] = [];
  const subjects: string[] = [];

  const inner = createFakeVerifier(options.auth);
  const verifier: ClaimsVerifier = {
    verify: (header) => {
      events.push('auth:verify');
      return inner.verify(header);
    },
  };

  const safetyIdentifiers: SafetyIdentifierDeriver = {
    derive: (subject) => {
      events.push('safety:derive');
      subjects.push(subject);
      return Promise.resolve(
        options.derived === false
          ? { kind: 'unavailable' as const }
          : { kind: 'derived' as const, identifier: TEST_SAFETY_IDENTIFIER },
      );
    },
  };

  const innerQuota = options.quota ?? createFakeQuotaStore();
  const quota: RecordingQuotaStore = {
    calls: innerQuota.calls,
    ops: innerQuota.ops,
    subjects: innerQuota.subjects,
    reserve: (subjectId, quotaRequestId) => {
      events.push('quota:reserve');
      return innerQuota.reserve(subjectId, quotaRequestId);
    },
    registerAttempt: (subjectId, reservationId, attemptNumber, tokens, outcome) => {
      events.push('quota:register');
      return innerQuota.registerAttempt(subjectId, reservationId, attemptNumber, tokens, outcome);
    },
    finalize: (subjectId, reservationId) => {
      events.push('quota:finalize');
      return innerQuota.finalize(subjectId, reservationId);
    },
    release: (subjectId, reservationId) => {
      events.push('quota:release');
      return innerQuota.release(subjectId, reservationId);
    },
    status: (subjectId) => innerQuota.status(subjectId),
  };

  const innerProvider = options.provider ?? createFakeProvider(helpAnswer());
  const provider: RecordingProvider = {
    calls: innerProvider.calls,
    aborted: innerProvider.aborted,
    generate: (request, signal) => {
      events.push('provider:call');
      return innerProvider.generate(request, signal);
    },
  };

  return {
    events,
    quota,
    provider,
    subjects,
    deps: {
      verifier,
      safetyIdentifiers,
      provider,
      quota,
      clock: createFakeClock(),
      timer: createFakeTimer(),
      requestIds: createFakeRequestIds(),
      logger: createCapturingLogger(),
      config: testConfig(),
    },
  };
}

Deno.test('26/27 — verification, then derivation, then the reservation, then the provider', async () => {
  const harness = createOrderedHarness();
  const response = await createNoorAIHandler(harness.deps)(jsonRequest(validBody()));

  assertEquals(response.status, 200, 'the ordinary success path');
  assertEquals(
    harness.events,
    [
      'auth:verify',
      'safety:derive',
      'quota:reserve',
      'provider:call',
      'quota:register',
      'quota:finalize',
    ],
    'the derivation sits between the verified identity and anything that can be spent',
  );
});

Deno.test('26b — an unauthenticated request never reaches the derivation at all', async () => {
  const harness = createOrderedHarness({ auth: { ok: false, reason: 'signature' } });
  const response = await createNoorAIHandler(harness.deps)(jsonRequest(validBody()));

  assertEquals(response.status, 401, 'refused on the token');
  assertEquals(harness.events, ['auth:verify'], 'and no derivation was attempted');
  assertEquals(harness.subjects, [], 'so no subject was ever handed to the deriver');
});

Deno.test('28 — the derived value is the one that reaches ProviderRequest, and the subject is the verified sub', async () => {
  const harness = createHarness();
  await createNoorAIHandler(harness.deps)(jsonRequest(validBody()));

  assertEquals(
    harness.safetyIdentifiers.subjects,
    [TEST_USER_ID],
    'the verified sub, once, and nothing else',
  );
  assertEquals(
    harness.provider.calls[0]?.safetyIdentifier,
    TEST_SAFETY_IDENTIFIER,
    'and the derived value is what the provider was handed',
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// 29–32 — what a failed derivation costs
// ─────────────────────────────────────────────────────────────────────────────

Deno.test('29/30/31/32 — an unavailable derivation is a 503 that spends nothing', async () => {
  /**
   * Missing key, malformed key, wrong length, all-zero, unknown version and a runtime failure all
   * arrive here as the same `unavailable`, and the handler's answer is identical for all of them —
   * §D.1's reasoning applied to a secret rather than to a token.
   *
   * The store and the provider are the *forbidden* fakes, which throw if touched. That is what makes
   * "zero quota calls" and "zero provider calls" assertions rather than observations: the handler
   * cannot reach either without failing the test loudly.
   */
  const tripwire = withNetworkTripwire();
  try {
    const quota = createForbiddenQuotaStore();
    const provider = createForbiddenProvider();
    const logger = createCapturingLogger();
    const response = await createNoorAIHandler({
      verifier: createFakeVerifier(),
      safetyIdentifiers: createUnavailableSafetyIdentifiers(),
      provider,
      quota,
      clock: createFakeClock(),
      timer: createFakeTimer(),
      requestIds: createFakeRequestIds(),
      logger,
      config: testConfig(),
    })(jsonRequest(validBody()));
    const body = await response.json();

    assertEquals(response.status, 503, '§I.5’s stable service_unavailable');
    assertEquals(body.error.code, 'service_unavailable', 'with the stable code');
    assertEquals('answer' in body, false, 'and never an answer');
    assertEquals(quota.calls.length, 0, 'zero quota calls — the user’s allowance is untouched');
    assertEquals(provider.calls.length, 0, 'zero provider calls');
    assertEquals(tripwire.calls, [], 'and nothing reached the network');

    // The reservation was never taken, so there is nothing to settle or release.
    assertEquals(logger.records[0]?.rate_limit_state, 'not-evaluated', 'the store was never asked');
    assertEquals(logger.records[0]?.accounting, 'not-required', 'so nothing needed settling');
    assertEquals(logger.records[0]?.provider_outcome, null, 'and the provider was never reached');
  } finally {
    tripwire.restore();
  }
});

Deno.test('29b — a real missing or invalid key produces the same 503, through the real deriver', async () => {
  /**
   * The same assertion driven by the actual `safety-identifier.ts` rather than by a fake, so the
   * handler's `503` is tied to the real validation rules and not to a test double's idea of them. Every
   * secret below is a configuration accident, and none of them is printed.
   */
  const key = fixtureKey(11);
  const configurations: readonly (string | undefined)[] = [
    undefined,
    '',
    `${key}=`,
    ` ${key}`,
    key.slice(0, 42),
    `${key}x`,
  ];

  for (const secret of configurations) {
    const quota = createForbiddenQuotaStore();
    const provider = createForbiddenProvider();
    const response = await createNoorAIHandler({
      verifier: createFakeVerifier(),
      safetyIdentifiers: createSafetyIdentifierDeriver({ version: 'v1', secret }),
      provider,
      quota,
      clock: createFakeClock(),
      timer: createFakeTimer(),
      requestIds: createFakeRequestIds(),
      logger: createCapturingLogger(),
      config: testConfig(),
    })(jsonRequest(validBody()));

    assertEquals(response.status, 503, 'an unusable key configuration fails closed');
    assertEquals(quota.calls.length, 0, 'without consuming quota');
    assertEquals(provider.calls.length, 0, 'or calling the provider');
  }
});

Deno.test('30b — an unknown active version fails closed even with a perfectly valid key', async () => {
  const quota = createForbiddenQuotaStore();
  const response = await createNoorAIHandler({
    verifier: createFakeVerifier(),
    safetyIdentifiers: createSafetyIdentifierDeriver({ version: 'v9x', secret: fixtureKey(12) }),
    provider: createForbiddenProvider(),
    quota,
    clock: createFakeClock(),
    timer: createFakeTimer(),
    requestIds: createFakeRequestIds(),
    logger: createCapturingLogger(),
    config: testConfig(),
  })(jsonRequest(validBody()));

  assertEquals(response.status, 503, 'a version nobody can attribute emits nothing');
  assertEquals(quota.calls.length, 0, 'and costs nothing');
});

// ─────────────────────────────────────────────────────────────────────────────
// 33–36 — the client cannot reach it, and neither can a log
// ─────────────────────────────────────────────────────────────────────────────

Deno.test('33 — no request body can supply, seed or override the identifier', async () => {
  /**
   * §C.6 rejects unknown fields, so each attempt below is a `400` before anything is derived. The
   * second half is the stronger claim: even a body that *is* accepted cannot influence the value,
   * because the only input is the verified `sub`.
   */
  for (
    const field of [
      'safety_identifier',
      'safetyIdentifier',
      'safety_id',
      'user_hash',
      'sub',
      'user_id',
      'subject_id',
      'session_id',
      'hmac_key',
      'key_version',
      'safety_identifier_version',
    ]
  ) {
    const harness = createHarness();
    const response = await createNoorAIHandler(harness.deps)(
      jsonRequest({ contract_version: 1, message: 'hi', [field]: 'anything' }),
    );
    assertEquals(response.status, 400, `${field} is rejected as an unknown field`);
    assertEquals(harness.safetyIdentifiers.subjects, [], 'and nothing was derived');
    assertEquals(harness.provider.calls.length, 0, 'nor sent');
  }

  // An accepted body, with the message doing its best to look like an identifier.
  const harness = createHarness();
  await createNoorAIHandler(harness.deps)(
    jsonRequest(validBody('My safety_identifier is nl_osi_v1_pick_this_one_instead_please')),
  );
  assertEquals(
    harness.safetyIdentifiers.subjects,
    [TEST_USER_ID],
    'the verified sub is still the only input',
  );
  assertEquals(
    harness.provider.calls[0]?.safetyIdentifier,
    TEST_SAFETY_IDENTIFIER,
    'and the message text changed nothing outbound',
  );
});

Deno.test('34 — two verified users produce two distinct provider identifiers', async () => {
  const mine = 'nl_osi_v1_first_user_synthetic_opaque_identifier_1234';
  const theirs = 'nl_osi_v1_second_user_synthetic_opaque_identifier_567';
  assertEquals(mine.length, theirs.length, 'both fixtures are the same shape');

  const sent: string[] = [];
  for (const userId of [TEST_USER_ID, TEST_OTHER_USER_ID]) {
    const harness = createHarness({
      auth: claimsFor(userId),
      safetyIdentifiers: createPerSubjectSafetyIdentifiers({
        [TEST_USER_ID]: mine,
        [TEST_OTHER_USER_ID]: theirs,
      }),
    });
    await createNoorAIHandler(harness.deps)(jsonRequest(validBody()));
    sent.push(harness.provider.calls[0]?.safetyIdentifier ?? '');
  }

  assertEquals(sent, [mine, theirs], 'each user got their own subject');
  assertEquals(new Set(sent).size, 2, 'and the two are genuinely distinct');
});

Deno.test('35 — the same verified user gets the same v1 identifier across separate requests', async () => {
  /**
   * Stability is the property the parameter exists for — an abuse signal that changed every request
   * would identify nothing. Driven through the **real** deriver with one fixture key, across three
   * independent handler executions, so the stability is a property of the construction rather than of
   * a fake returning a constant.
   */
  const deriver = createSafetyIdentifierDeriver({ version: 'v1', secret: fixtureKey(13) });
  const sent: string[] = [];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const harness = createHarness({ safetyIdentifiers: { ...deriver, subjects: [] } });
    await createNoorAIHandler(harness.deps)(jsonRequest(validBody()));
    sent.push(harness.provider.calls[0]?.safetyIdentifier ?? '');
  }

  assertEquals(new Set(sent).size, 1, 'one user, one stable identifier, across separate requests');
  assert(
    sent[0]?.startsWith(safetyIdentifierPrefix(SAFETY_IDENTIFIER_ACTIVE_VERSION)) === true,
    'under the active version, read from the constant rather than written out',
  );
});

Deno.test('35b — one derivation per request, reused across the retry rather than recomputed', async () => {
  const harness = createHarness({
    provider: createFakeProvider({ kind: 'transient-server-error' }, helpAnswer()),
  });
  await createNoorAIHandler(harness.deps)(jsonRequest(validBody()));

  assertEquals(harness.provider.calls.length, 2, '§F.8’s single retry ran');
  assertEquals(harness.safetyIdentifiers.subjects.length, 1, 'and the derivation happened once');
  assertEquals(
    harness.provider.calls.map((call) => call.safetyIdentifier),
    [TEST_SAFETY_IDENTIFIER, TEST_SAFETY_IDENTIFIER],
    'both attempts of one question are one subject',
  );
});

Deno.test('36 — the identifier appears in no log record and in no client response', async () => {
  /**
   * §H.3's record type has no field that could hold it, which is what makes this structural rather
   * than careful. Asserted over the whole serialised log surface and the whole response body, on the
   * success path and on the derivation-failure path.
   */
  const harness = createHarness();
  const response = await createNoorAIHandler(harness.deps)(jsonRequest(validBody()));
  const text = await response.text();

  assertExcludes(harness.logger.text(), TEST_SAFETY_IDENTIFIER, 'not in the log');
  assertExcludes(harness.logger.text(), 'nl_osi', 'not even the prefix');
  assertExcludes(harness.logger.text(), TEST_USER_ID, '§H.3 — nor the raw subject it came from');
  assertExcludes(text, TEST_SAFETY_IDENTIFIER, 'and not in the response');
  assertExcludes(text, 'nl_osi', 'in any form');
  assertEquals(
    Object.keys(harness.logger.records[0] ?? {}).filter((key) =>
      /safety|identifier|hash|user/i.test(key)
    ),
    ['safety_category'],
    'the only such field is the closed policy enum',
  );

  const failed = createHarness({ safetyIdentifiers: createUnavailableSafetyIdentifiers() });
  const failedResponse = await createNoorAIHandler(failed.deps)(jsonRequest(validBody()));
  const failedText = await failedResponse.text();
  assertExcludes(failed.logger.text(), TEST_USER_ID, 'the failure path logs no subject either');
  assertExcludes(failedText, 'nl_osi', 'and reveals nothing about the construction');
  assertExcludes(failedText, 'key', 'or about what was misconfigured');
});

// ─────────────────────────────────────────────────────────────────────────────
// 49–54 — the production gates
// ─────────────────────────────────────────────────────────────────────────────

Deno.test('49/51 — production derives nothing, so an authenticated request fails closed', async () => {
  /**
   * The real graph, with no environment variable set anywhere — which is the state of every
   * environment, because **no HMAC secret has been generated or provisioned**. The deriver answers
   * `unavailable`, and the handler would fail closed on that alone even if the kill switch were open.
   */
  const production = createProductionDependencies({
    supabaseUrl: PROJECT_URL,
    jwks: undefined,
    serviceRoleKey: undefined,
    openaiApiKey: undefined,
  });

  assertEquals(
    await production.safetyIdentifiers.derive(TEST_USER_ID),
    { kind: 'unavailable' },
    'no key is provisioned, so nothing can be derived',
  );
  assertEquals(productionConfig.enabled, false, '§I.2’s kill switch is still a source constant');
});

Deno.test('52 — a provider key alone cannot enable traffic: the derivation still fails first', async () => {
  /**
   * `enabled` is raised **in this test only**, so the assertion is about the gates *underneath* the
   * kill switch rather than about the switch itself. With a provider key present and no HMAC key, the
   * request stops at the derivation: no reservation, no provider call, no network.
   */
  const tripwire = withNetworkTripwire();
  try {
    const production = createProductionDependencies({
      supabaseUrl: PROJECT_URL,
      jwks: undefined,
      serviceRoleKey: undefined,
      openaiApiKey: TEST_PROVIDER_KEY,
    });
    const quota = createForbiddenQuotaStore();
    const response = await createNoorAIHandler({
      ...production,
      verifier: createFakeVerifier(),
      quota,
      clock: createFakeClock(),
      timer: createFakeTimer(),
      requestIds: createFakeRequestIds(),
      logger: createCapturingLogger(),
      config: testConfig({ enabled: true }),
    })(jsonRequest(validBody()));

    assertEquals(response.status, 503, 'the provider key opens nothing on its own');
    assertEquals(quota.calls.length, 0, 'no quota was consumed');
    assertEquals(tripwire.calls, [], 'and no network call was made');
  } finally {
    tripwire.restore();
  }
});

Deno.test('53 — an HMAC key alone cannot enable traffic: the provider is still unavailable', async () => {
  const tripwire = withNetworkTripwire();
  try {
    const production = createProductionDependencies({
      supabaseUrl: PROJECT_URL,
      jwks: undefined,
      serviceRoleKey: undefined,
      openaiApiKey: undefined,
    });
    const quota = createFakeQuotaStore();
    const logger = createCapturingLogger();
    const response = await createNoorAIHandler({
      ...production,
      verifier: createFakeVerifier(),
      safetyIdentifiers: createSafetyIdentifierDeriver({ version: 'v1', secret: fixtureKey(14) }),
      quota,
      clock: createFakeClock(),
      timer: createFakeTimer(),
      requestIds: createFakeRequestIds(),
      logger,
      config: testConfig({ enabled: true }),
    })(jsonRequest(validBody()));

    assertEquals(response.status, 503, 'a derived identifier with no provider key answers nothing');
    assertEquals(logger.records[0]?.provider_outcome, 'unavailable', 'the provider had no key');
    assertEquals(quota.ops(), ['reserve', 'release'], 'and the unused reservation was handed back');
    assertEquals(tripwire.calls, [], 'with no network call');
  } finally {
    tripwire.restore();
  }
});

Deno.test('54 — both credentials present still cannot bypass the source-controlled kill switch', async () => {
  /**
   * The outermost lock, asserted with everything underneath it hypothetically open: a provider key, a
   * real derived identifier, a working quota store and a mocked transport. `productionConfig` is used
   * **unmodified**, so the switch is the real one, and it closes the request before the derivation is
   * even attempted.
   */
  const mock = createFetchMock();
  const quota = createForbiddenQuotaStore();
  const derived = createFakeSafetyIdentifiers();
  const response = await createNoorAIHandler({
    verifier: createFakeVerifier(),
    safetyIdentifiers: derived,
    provider: createOpenAIProvider({ apiKey: TEST_PROVIDER_KEY, fetchImpl: mock.impl }),
    quota,
    clock: createFakeClock(),
    timer: createFakeTimer(),
    requestIds: createFakeRequestIds(),
    logger: createCapturingLogger(),
    config: productionConfig,
  })(jsonRequest(validBody()));

  assertEquals(
    response.status,
    503,
    'disabled means unavailable, whatever is configured behind it',
  );
  assertEquals(derived.subjects, [], 'the switch runs before the derivation');
  assertEquals(quota.calls.length, 0, 'and before the reservation');
  assertEquals(mock.calls.length, 0, 'and before the provider');
});

Deno.test('50/51b — the whole production graph, real verifier and real token, answers 503 and sends nothing', async () => {
  const tripwire = withNetworkTripwire();
  try {
    const keys = await createSigningFixture();
    const token = await keys.sign(
      validClaimSet(Math.floor(Date.now() / 1000), { iss: `${PROJECT_URL}/auth/v1` }),
    );
    const logger = createCapturingLogger();
    const response = await createNoorAIHandler({
      ...createProductionDependencies({
        supabaseUrl: PROJECT_URL,
        jwks: keys.jwks,
        serviceRoleKey: undefined,
        openaiApiKey: undefined,
      }),
      clock: createFakeClock(),
      timer: createFakeTimer(),
      requestIds: createFakeRequestIds(),
      logger,
    })(jsonRequest(validBody(), { authorization: `Bearer ${token}` }));
    const body = await response.json();

    assertEquals(response.status, 503, 'no real-user path is enabled');
    assertEquals(body.error.code, 'service_unavailable', 'with §I.5’s stable code');
    assertEquals(tripwire.calls, [], 'nothing reached the network');
    assertEquals(logger.records[0]?.auth_reason, null, 'the real verifier accepted a real token');
    assertExcludes(logger.text(), 'nl_osi', 'and no identifier appears in the log');
  } finally {
    tripwire.restore();
  }
});
