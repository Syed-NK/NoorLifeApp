import { createNoorAIHandler } from '../handler.ts';
import { createOpenAIProvider } from '../openai-provider.ts';
import {
  createProductionDependencies,
  createProductionProvider,
  productionConfig,
} from '../production.ts';
import type { HandlerConfig, NoorAIDependencies, ProviderRequest } from '../ports.ts';
import { assert, assertEquals, assertExcludes } from './assert.ts';
import {
  type CapturingLogger,
  createCapturingLogger,
  createFakeClock,
  createFakeQuotaStore,
  createFakeRequestIds,
  createFakeTimer,
  createFakeVerifier,
  createFetchMock,
  createSigningFixture,
  envelopeWithText,
  type FakeQuotaOptions,
  type FetchMock,
  type FetchStep,
  jsonRequest,
  jsonResponse,
  providerEnvelope,
  type RecordingQuotaStore,
  TEST_PROVIDER_KEY,
  TEST_RESERVATION_ID,
  TEST_SAFETY_IDENTIFIER,
  TEST_USER_ID,
  testConfig,
  validClaimSet,
  withNetworkTripwire,
} from './fakes.ts';

/**
 * The real OpenAI adapter driven through the real handler, against a mocked transport and a fake
 * quota store.
 *
 * ── Why these are separate from `openai-provider_test.ts` ────────────────────
 * That file proves the adapter's own behaviour. These prove the two things only the *composition*
 * can show: that the approved quota lifecycle — reserve → provider → register → finalize — still
 * holds now that the provider is real rather than a fake, and that §F.8's single retry is the
 * handler's and not the adapter's. A retry loop hidden inside the adapter would pass every test in
 * the other file and fail here, because the scripted transport counts every call.
 *
 * No network is touched and no key exists. The last group asserts that the *production* graph stays
 * closed, which is the claim that matters most: the adapter is written, and it is not reachable.
 */

const PROJECT_URL = 'https://project.supabase.co';

function buildDeps(
  mock: FetchMock,
  options: {
    readonly quota?: RecordingQuotaStore;
    readonly config?: Partial<HandlerConfig>;
  } = {},
): { deps: NoorAIDependencies; quota: RecordingQuotaStore; logger: CapturingLogger } {
  const quota = options.quota ?? createFakeQuotaStore();
  const logger = createCapturingLogger();
  return {
    quota,
    logger,
    deps: {
      verifier: createFakeVerifier(),
      provider: createOpenAIProvider({
        apiKey: TEST_PROVIDER_KEY,
        staticSafetyIdentifier: TEST_SAFETY_IDENTIFIER,
        fetchImpl: mock.impl,
      }),
      quota,
      clock: createFakeClock(),
      timer: createFakeTimer(),
      requestIds: createFakeRequestIds(),
      logger,
      config: testConfig(options.config),
    },
  };
}

async function ask(
  steps: readonly FetchStep[],
  options: { readonly quota?: RecordingQuotaStore; readonly config?: Partial<HandlerConfig> } = {},
) {
  const mock = createFetchMock(...steps);
  const { deps, quota, logger } = buildDeps(mock, options);
  const response = await createNoorAIHandler(deps)(
    jsonRequest({ contract_version: 1, message: 'Where do I change my prayer reminder sound?' }),
  );
  return { mock, quota, logger, response, body: await response.json() };
}

function quotaWith(options: FakeQuotaOptions): RecordingQuotaStore {
  return createFakeQuotaStore(options);
}

// ─────────────────────────────────────────────────────────────────────────────
// 45 — the approved lifecycle, end to end
// ─────────────────────────────────────────────────────────────────────────────

Deno.test('45 — a valid answer runs reserve → provider → register → finalize', async () => {
  const { mock, quota, response, body } = await ask([jsonResponse(providerEnvelope())]);

  assertEquals(response.status, 200, 'the answer is served');
  assertEquals(body.outcome, 'answer', 'as an answer');
  assertEquals(body.finish, 'complete', 'complete');
  assertEquals(body.answer.sources, [], 'with no citations, which AI-3 still cannot supply');
  assertEquals(mock.calls.length, 1, 'one provider attempt');
  assertEquals(quota.ops(), ['reserve', 'registerAttempt', 'finalize'], 'the approved lifecycle');

  const registered = quota.calls[1];
  assert(registered?.op === 'registerAttempt', 'the attempt was registered');
  assertEquals(registered.attemptNumber, 1, 'as attempt 1');
  assertEquals(registered.outcome, 'success', 'classed as a success');
  assertEquals(
    registered.usage,
    { inputTokens: 137, outputTokens: 42, reasoningTokens: 19 },
    'with the provider’s own counts, reasoning split out of the output total',
  );
  assertEquals(quota.subjects(), [TEST_USER_ID, TEST_USER_ID, TEST_USER_ID], 'bound to the sub');
});

Deno.test('45b — nothing the provider returned reaches the client except the answer text', async () => {
  const { body } = await ask([jsonResponse(providerEnvelope())]);
  const serialised = JSON.stringify(body);

  assertExcludes(serialised, 'resp_synthetic', 'no provider response id');
  assertExcludes(serialised, 'a-model-the-adapter-must-ignore', 'no model identifier');
  assertExcludes(serialised, TEST_PROVIDER_KEY, 'no credential');
  assertExcludes(serialised, 'input_tokens', 'no usage accounting');
  assertEquals(
    Object.keys(body).sort(),
    ['answer', 'contract_version', 'finish', 'outcome', 'request_id'],
    'exactly §C.4’s answer envelope',
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// 46–48 — §F.8's one retry, owned by the handler
// ─────────────────────────────────────────────────────────────────────────────

Deno.test('46 — a provider 429 is retried exactly once, and the second attempt is accounted', async () => {
  const { mock, quota, response, body } = await ask([
    jsonResponse({ error: { message: 'slow down' } }, 429, { 'retry-after': '2' }),
    jsonResponse(providerEnvelope()),
  ]);

  assertEquals(mock.calls.length, 2, 'two attempts, i.e. one retry');
  assertEquals(response.status, 200, 'and the retry succeeded');
  assertEquals(body.outcome, 'answer', 'with an answer');
  assertEquals(
    quota.ops(),
    ['reserve', 'registerAttempt', 'registerAttempt', 'finalize'],
    'both attempts are cost-accounted separately, and the reservation settles once',
  );
  const first = quota.calls[1];
  const second = quota.calls[2];
  assert(first?.op === 'registerAttempt' && second?.op === 'registerAttempt', 'two attempts');
  assertEquals([first.attemptNumber, second.attemptNumber], [1, 2], 'ordinals 1 then 2');
  assertEquals(first.outcome, 'transient', 'the rate limit was transient');
  assertEquals(
    first.usage,
    { inputTokens: 0, outputTokens: 0, reasoningTokens: 0 },
    'a 429 reports no usage, so zero is recorded rather than an estimate',
  );
});

Deno.test('47 — a transient 5xx follows the same one-retry rule', async () => {
  for (const status of [500, 502, 503, 504, 408]) {
    const { mock, quota, response } = await ask([
      jsonResponse({ error: { message: 'boom' } }, status),
      jsonResponse(providerEnvelope()),
    ]);
    assertEquals(mock.calls.length, 2, `${status} is retried once`);
    assertEquals(response.status, 200, 'and the retry is served');
    assertEquals(quota.ops().filter((op) => op === 'registerAttempt').length, 2, 'both accounted');
  }
});

Deno.test('47b — two failures in a row stop at two attempts and never a third', async () => {
  const { mock, response, body } = await ask([
    jsonResponse({ error: { message: 'boom' } }, 503),
    jsonResponse({ error: { message: 'boom' } }, 503),
  ]);

  assertEquals(mock.calls.length, 2, '§F.8 — 2 total, i.e. at most one retry');
  assertEquals(response.status, 502, 'and the provider failure becomes upstream_unavailable');
  assertExcludes(JSON.stringify(body), 'boom', 'with none of the provider’s wording');
});

Deno.test('48 — a provider authentication failure is an incurred, accounted, terminal attempt', async () => {
  /**
   * ── The correction this test exists for ──────────────────────────────────
   * A `401`/`403` was previously mapped onto `unavailable`, which the handler defines as "no provider
   * is configured and no request left the process". That definition drives `attemptWasIncurred`, so
   * the mapping caused the handler to register nothing and **release the reservation as unused** — an
   * assertion that the request was free, made about a request the provider demonstrably received and
   * answered. §I.2's ceilings are enforced from recorded spend, so an unrecorded incurred attempt is
   * the failure mode that actually costs money.
   *
   * `provider-configuration-error` is terminal in exactly the same way and accounted honestly.
   */
  for (const status of [401, 403]) {
    const { mock, quota, response, body, logger } = await ask([
      jsonResponse(
        { error: { message: 'Incorrect API key provided', code: 'invalid_api_key' } },
        status,
      ),
    ]);

    assertEquals(mock.calls.length, 1, `${status} is terminal — a second ask cannot help`);
    assertEquals(
      quota.ops(),
      ['reserve', 'registerAttempt', 'finalize'],
      'the incurred attempt is registered and the reservation is settled, never released',
    );
    assertEquals(quota.calls.some((call) => call.op === 'release'), false, 'never released');

    const registered = quota.calls[1];
    assert(registered?.op === 'registerAttempt', 'the attempt was registered');
    assertEquals(registered.attemptNumber, 1, 'once, with ordinal 1');
    assertEquals(registered.outcome, 'terminal', 'as a terminal attempt');
    assertEquals(
      registered.usage,
      { inputTokens: 0, outputTokens: 0, reasoningTokens: 0 },
      'the error envelope reports no usage, so zero is recorded rather than estimated',
    );
    assertEquals(
      quota.calls.filter((call) => call.op === 'finalize').length,
      1,
      'and finalize runs exactly once',
    );

    assertEquals(response.status, 503, 'the client gets §I.5’s stable service_unavailable');
    assertEquals(body.error.code, 'service_unavailable', 'and nothing about the credential');
    assertEquals(
      logger.records[0]?.provider_outcome,
      'provider-configuration-error',
      'recorded as itself, distinctly from an absent provider',
    );
    assertEquals(
      logger.records[0]?.operator_alert,
      'provider_configuration',
      'and a coarse alert is raised — §F.8 says a wrong key must page a human',
    );
    assertEquals(
      logger.records[0]?.accounting,
      'complete',
      'the accounting is complete, not failed',
    );

    // Neither the response nor the log may reveal which credential condition occurred.
    const surfaces = `${JSON.stringify(body)} ${JSON.stringify(logger.records[0])}`;
    for (const leak of ['API key', 'invalid_api_key', 'Incorrect', String(status)]) {
      assertExcludes(surfaces, leak, `the provider’s wording and status never travel: ${leak}`);
    }
  }
});

Deno.test('48c — a 401 is indistinguishable from an absent provider to the client', async () => {
  /**
   * §D.1's reasoning applied to the provider credential: a prober must not be able to tell a
   * misconfigured key from a switched-off feature. Both bodies are compared whole, minus the
   * request id, which is random per request by construction (§I.7).
   */
  const refused = await ask([jsonResponse({ error: { message: 'no' } }, 401)]);

  const absentResponse = await createNoorAIHandler({
    ...buildDeps(createFetchMock()).deps,
    provider: createProductionProvider({
      supabaseUrl: PROJECT_URL,
      jwks: undefined,
      serviceRoleKey: undefined,
      openaiApiKey: undefined,
    }),
  })(jsonRequest({ contract_version: 1, message: 'Where do I change my prayer reminder sound?' }));
  const absentBody = await absentResponse.json();

  const strip = (body: Record<string, unknown>) => ({ ...body, request_id: '<id>' });
  assertEquals(refused.response.status, absentResponse.status, 'the same status');
  assertEquals(strip(refused.body), strip(absentBody), 'and byte-identical bodies');
});

Deno.test('48b — a billing 429 pages a human and is never retried', async () => {
  const { mock, response, logger } = await ask([
    jsonResponse({ error: { type: 'insufficient_quota', message: 'no credits' } }, 429, {
      'retry-after': '60',
    }),
  ]);

  assertEquals(mock.calls.length, 1, '§F.8 — retrying will not restore API access');
  assertEquals(response.status, 503, 'the client is told the service is unavailable');
  assertEquals(logger.records[0]?.operator_alert, 'quota_exhausted', 'and an operator is alerted');
  assertEquals(logger.records[0]?.provider_outcome, 'quota-exhausted', 'recorded as itself');
});

// ─────────────────────────────────────────────────────────────────────────────
// 49–51 — accounting under failure
// ─────────────────────────────────────────────────────────────────────────────

Deno.test('49 — a malformed provider response is billed, recorded, and fails safely', async () => {
  const { mock, quota, response, body, logger } = await ask([
    jsonResponse(envelopeWithText('this is not the structured payload')),
  ]);

  assertEquals(mock.calls.length, 1, 'malformed is terminal — never retried');
  assertEquals(response.status, 502, '§I.5 — malformed upstream');
  assertEquals(body.error.code, 'upstream_unavailable', 'reported distinctly from a 503');
  assertEquals(logger.records[0]?.upstream_malformed, true, 'and flagged as such');
  assertEquals(quota.ops(), ['reserve', 'registerAttempt', 'finalize'], 'still fully accounted');

  const registered = quota.calls[1];
  assert(registered?.op === 'registerAttempt', 'the attempt was registered');
  assertEquals(registered.outcome, 'terminal', 'as a terminal attempt');
  assertEquals(
    registered.usage,
    { inputTokens: 137, outputTokens: 42, reasoningTokens: 19 },
    'with the tokens it actually cost — a failed parse is still a paid request',
  );
  assertEquals('answer' in body, false, 'and no answer of any kind is produced');
});

Deno.test('50 — a quota denial never reaches the provider', async () => {
  for (
    const reserve of [
      { kind: 'limited', reason: 'per_user_minute' } as const,
      { kind: 'limited', reason: 'daily_spend' } as const,
      { kind: 'limited', reason: 'disabled' } as const,
      { kind: 'unavailable' } as const,
    ]
  ) {
    const { mock, quota, response } = await ask([], { quota: quotaWith({ reserve }) });

    assertEquals(mock.calls.length, 0, 'nothing was sent to the provider');
    assertEquals(quota.ops(), ['reserve'], 'and nothing was accounted');
    assert(response.status === 429 || response.status === 503, 'the request was refused');
  }
});

Deno.test('51 — an accounting failure stops everything and calls the provider no further', async () => {
  // The first attempt is a retryable 429, so a handler that ignored the failed registration would
  // have every reason to try again. It must not.
  const { mock, quota, response, logger } = await ask([
    jsonResponse({ error: { message: 'slow down' } }, 429, { 'retry-after': '1' }),
  ], { quota: quotaWith({ registerAcks: [false, false] }) });

  assertEquals(mock.calls.length, 1, 'a bookkeeping failure is not permission to spend more');
  assertEquals(response.status, 503, 'and the request cannot be served');
  assertEquals(logger.records[0]?.accounting, 'failed', 'recorded so an operator can reconcile');
  assertEquals(
    quota.ops(),
    ['reserve', 'registerAttempt', 'registerAttempt'],
    'the one permitted accounting retry ran, and no release followed an incurred attempt',
  );
  assertEquals(quota.calls.some((call) => call.op === 'release'), false, 'never released');
});

Deno.test('51c — an accounting failure after a 401 still fails safely and calls nothing again', async () => {
  /**
   * The two corrections meeting: a `401` is now an incurred attempt, so it goes through registration,
   * so it can hit the accounting-failure path. What must not happen is the provider being asked again
   * — a bookkeeping failure is not permission to spend, least of all on a credential the provider has
   * already refused.
   */
  for (const status of [401, 403]) {
    const { mock, quota, response, logger } = await ask([
      jsonResponse({ error: { message: 'Incorrect API key provided' } }, status),
    ], { quota: quotaWith({ registerAcks: [false, false] }) });

    assertEquals(mock.calls.length, 1, `${status}: no second provider call, ever`);
    assertEquals(response.status, 503, 'and the safe 503 stands');
    assertEquals(logger.records[0]?.accounting, 'failed', 'the gap is recorded honestly');
    assertEquals(
      quota.ops(),
      ['reserve', 'registerAttempt', 'registerAttempt'],
      'only the existing bounded accounting retry ran',
    );
    assertEquals(
      quota.calls.some((call) => call.op === 'release'),
      false,
      'and the reservation is never released — an attempt was incurred',
    );
  }
});

Deno.test('51b — a finalize failure also fails the request rather than serving unaccounted spend', async () => {
  const { response, logger } = await ask([jsonResponse(providerEnvelope())], {
    quota: quotaWith({ finalizeAcks: [false, false] }),
  });

  assertEquals(response.status, 503, 'an answer NoorLife cannot account for is not served');
  assertEquals(logger.records[0]?.accounting, 'failed', 'and the gap is visible');
});

// ─────────────────────────────────────────────────────────────────────────────
// 52–55 — production is closed
// ─────────────────────────────────────────────────────────────────────────────

Deno.test('52 — with no key the handler answers unavailable and makes zero network calls', async () => {
  const tripwire = withNetworkTripwire();
  try {
    const quota = createFakeQuotaStore();
    const logger = createCapturingLogger();
    const response = await createNoorAIHandler({
      verifier: createFakeVerifier(),
      // The real adapter, constructed exactly as production constructs it.
      provider: createProductionProvider({
        supabaseUrl: PROJECT_URL,
        jwks: undefined,
        serviceRoleKey: undefined,
        openaiApiKey: undefined,
      }),
      quota,
      clock: createFakeClock(),
      timer: createFakeTimer(),
      requestIds: createFakeRequestIds(),
      logger,
      config: testConfig(),
    })(jsonRequest({ contract_version: 1, message: 'Where is Qibla?' }));

    assertEquals(response.status, 503, 'the handler fails closed');
    assertEquals(
      logger.records[0]?.provider_outcome,
      'unavailable',
      'because there is no provider',
    );
    assertEquals(tripwire.calls, [], 'and no network call of any kind was made');
    // Nothing was spent, so the reservation is handed back rather than settled.
    assertEquals(quota.ops(), ['reserve', 'release'], 'the unused reservation is released');
  } finally {
    tripwire.restore();
  }
});

Deno.test('53 — B10 keeps the production provider unavailable even with a key present', async () => {
  /**
   * The gate that does not depend on the key. `createProductionProvider` passes `undefined`, because
   * B10 is open and — more fundamentally — because the option it would pass is fixed at construction
   * and this graph is built once per isolate, so no value put there could identify a user. Even a
   * hypothetical environment with a provider key set therefore stays closed, and B10 is closed by
   * adding a reviewed per-user derivation port, not by a deployment setting.
   */
  const tripwire = withNetworkTripwire();
  try {
    const request: ProviderRequest = {
      instructions: 'server text',
      userInput: 'Where is Qibla?',
      maxOutputTokens: 256,
      store: false,
      languageHint: 'en',
    };
    const withKey = createProductionProvider({
      supabaseUrl: PROJECT_URL,
      jwks: undefined,
      serviceRoleKey: undefined,
      openaiApiKey: TEST_PROVIDER_KEY,
    });

    const outcome = await withKey.generate(request, new AbortController().signal);
    assertEquals(outcome, { kind: 'unavailable' }, 'a key alone does not open the provider');
    assertEquals(tripwire.calls, [], 'and nothing was sent');
  } finally {
    tripwire.restore();
  }
});

Deno.test('54 — the production kill switch is off, and it is not read from the environment', async () => {
  assertEquals(productionConfig.enabled, false, '§I.2’s kill switch is off');

  // Even with both gates hypothetically open, the switch alone closes the endpoint before the
  // provider is reached — asserted rather than described, because it is the outermost lock.
  const mock = createFetchMock();
  const { deps, quota } = buildDeps(mock, { config: { enabled: false } });
  const response = await createNoorAIHandler(deps)(
    jsonRequest({ contract_version: 1, message: 'Where is Qibla?' }),
  );

  assertEquals(response.status, 503, 'disabled means unavailable');
  assertEquals(mock.calls.length, 0, 'with no provider call');
  assertEquals(quota.ops(), [], 'and no quota call — the switch runs before the reservation');
});

Deno.test('55 — the whole production graph still answers 503 with no network call', async () => {
  /**
   * The end-to-end statement for this phase, built the hard way: the real verifier fed a real ES256
   * key set and a genuinely signed token, the real quota adapter, and the real provider adapter
   * constructed from an environment that has a provider key in it. Authentication succeeds,
   * validation runs, and the request still fails closed with nothing sent anywhere.
   */
  const tripwire = withNetworkTripwire();
  try {
    const keys = await createSigningFixture();
    const token = await keys.sign(
      validClaimSet(Math.floor(Date.now() / 1000), { iss: `${PROJECT_URL}/auth/v1` }),
    );
    const logger = createCapturingLogger();
    const handler = createNoorAIHandler({
      ...createProductionDependencies({
        supabaseUrl: PROJECT_URL,
        jwks: keys.jwks,
        serviceRoleKey: undefined,
        openaiApiKey: TEST_PROVIDER_KEY,
      }),
      clock: createFakeClock(),
      timer: createFakeTimer(),
      requestIds: createFakeRequestIds(),
      logger,
    });

    const response = await handler(
      jsonRequest({ contract_version: 1, message: 'Where is Qibla?' }, {
        authorization: `Bearer ${token}`,
      }),
    );
    const body = await response.json();

    assertEquals(response.status, 503, 'no real-user path is enabled');
    assertEquals(body.error.code, 'service_unavailable', 'with §I.5’s stable code');
    assertEquals('answer' in body, false, 'and never an answer');
    assertEquals(tripwire.calls, [], 'nothing reached the network');
    assertEquals(logger.records[0]?.auth_reason, null, 'the real verifier accepted a real token');
    assertEquals(logger.records[0]?.provider_outcome, null, 'and the provider was never reached');
  } finally {
    tripwire.restore();
  }
});

Deno.test('55b — the reservation id is the only handle, and no fake provider is selectable', async () => {
  // A body field that looks like a provider switch is an unknown field, which §C.6 rejects before
  // anything else happens. Restated here against the graph that now has a real provider in it.
  const mock = createFetchMock();
  const { deps } = buildDeps(mock);
  for (const extra of ['provider', 'model', 'api_key', 'safety_identifier', 'openai']) {
    const response = await createNoorAIHandler(deps)(
      jsonRequest({ contract_version: 1, message: 'hi', [extra]: 'anything' }),
    );
    assertEquals(response.status, 400, `${extra} is rejected as an unknown field`);
    assertEquals(mock.calls.length, 0, 'and never reaches the provider');
  }
  assertEquals(TEST_RESERVATION_ID.length, 36, 'the reservation id stays a server-side uuid');
});
