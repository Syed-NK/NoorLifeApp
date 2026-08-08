import { createNoorAIHandler } from '../handler.ts';
import type { NoorAIDependencies, ProviderResult, ReserveOutcome } from '../ports.ts';
import { assert, assertEquals, assertExcludes } from './assert.ts';
import {
  answerWithUsage,
  createFakeProvider,
  createFakeQuotaStore,
  createForbiddenProvider,
  createForbiddenQuotaStore,
  createHarness,
  createThrowingProvider,
  helpAnswer,
  jsonRequest,
  type RecordingProvider,
  type RecordingQuotaStore,
  TEST_RESERVATION_ID,
  TEST_USER_ID,
  usage,
  validBody,
} from './fakes.ts';

/**
 * The AI-3 quota lifecycle: reserve → attempt → register → finalize, and release when nothing ran.
 *
 * ── What these tests are actually pinning ────────────────────────────────────
 * Every property here is about *order* and *arguments*, because those are the only things that can go
 * wrong in a way a status code would not reveal. A handler that called the provider first and
 * reserved afterwards would still answer `200`. A handler that finalized twice would still answer
 * `200`. A handler that passed a client-supplied id as the quota subject would still answer `200` —
 * and would meter the wrong person. So the fakes record whole calls and the assertions read them.
 *
 * ── No network, no key, no provider ──────────────────────────────────────────
 * The quota store here is a fake in `tests/`, exactly like the provider. Nothing in this file reads a
 * service-role value, and nothing can: `source-scan_test.ts` asserts that only `quota-rpc.ts` names
 * the platform secret, and the suite runs without Deno's `--allow-net`.
 */

/**
 * A harness whose quota store and provider write into ONE ordered timeline.
 *
 * Two separate recorders can each prove their own calls happened but neither can prove which came
 * first, and "reserve before any provider attempt" is precisely a claim about that. Wrapping both in
 * a shared array is the smallest thing that makes the ordering assertable rather than assumed.
 */
function createTimelineHarness(options: {
  readonly reserve?: ReserveOutcome;
  readonly registerAcks?: readonly boolean[];
  readonly finalizeAcks?: readonly boolean[];
  readonly config?: Partial<import('../ports.ts').HandlerConfig>;
  readonly provider?: RecordingProvider;
  readonly providerResults?: readonly ProviderResult[];
} = {}): {
  readonly deps: NoorAIDependencies;
  readonly events: readonly string[];
  readonly quota: RecordingQuotaStore;
  readonly provider: RecordingProvider;
  readonly logger: ReturnType<typeof createHarness>['logger'];
} {
  const events: string[] = [];
  const inner = createFakeQuotaStore({
    reserve: options.reserve,
    registerAcks: options.registerAcks,
    finalizeAcks: options.finalizeAcks,
  });

  const quota: RecordingQuotaStore = {
    calls: inner.calls,
    ops: inner.ops,
    subjects: inner.subjects,
    reserve: (subjectId, quotaRequestId) => {
      events.push('quota:reserve');
      return inner.reserve(subjectId, quotaRequestId);
    },
    registerAttempt: (subjectId, reservationId, attemptNumber, tokens, outcome) => {
      events.push(`quota:register:${attemptNumber}`);
      return inner.registerAttempt(subjectId, reservationId, attemptNumber, tokens, outcome);
    },
    finalize: (subjectId, reservationId) => {
      events.push('quota:finalize');
      return inner.finalize(subjectId, reservationId);
    },
    release: (subjectId, reservationId) => {
      events.push('quota:release');
      return inner.release(subjectId, reservationId);
    },
    status: (subjectId) => inner.status(subjectId),
  };

  const baseProvider = options.provider ??
    createFakeProvider(...(options.providerResults ?? [answerWithUsage()]));
  const provider: RecordingProvider = {
    calls: baseProvider.calls,
    aborted: baseProvider.aborted,
    generate: (request, signal) => {
      events.push('provider:call');
      return baseProvider.generate(request, signal);
    },
  };

  const harness = createHarness({ quota, provider, config: options.config });
  return { deps: harness.deps, events, quota, provider, logger: harness.logger };
}

async function ask(deps: NoorAIDependencies, body: unknown = validBody()) {
  const response = await createNoorAIHandler(deps)(jsonRequest(body));
  return { response, body: await response.json() };
}

// ─────────────────────────────────────────────────────────────────────────────
// Authentication and subject binding
// ─────────────────────────────────────────────────────────────────────────────

Deno.test('an unauthenticated request never reaches the quota store or the provider', async () => {
  const harness = createHarness({
    auth: { ok: false, reason: 'missing' },
    provider: createForbiddenProvider(),
    quota: createForbiddenQuotaStore(),
  });
  const { response } = await ask(harness.deps);

  assertEquals(response.status, 401, 'refused');
  assertEquals(
    harness.quota.calls.length,
    0,
    'no reservation is taken for a caller with no identity',
  );
  assertEquals(harness.provider.calls.length, 0, 'and nothing is spent');
});

Deno.test('an expired or invalid identity never reaches the quota store or the provider', async () => {
  for (const reason of ['expired', 'signature', 'role', 'subject'] as const) {
    const harness = createHarness({
      auth: { ok: false, reason },
      provider: createForbiddenProvider(),
      quota: createForbiddenQuotaStore(),
    });
    const { response } = await ask(harness.deps);
    assertEquals(response.status, 401, `${reason} is refused`);
    assertEquals(harness.quota.calls.length, 0, `${reason} takes no reservation`);
    assertEquals(harness.provider.calls.length, 0, `${reason} spends nothing`);
  }
});

Deno.test('the quota subject is the verified sub, and tracks the verifier rather than the request', async () => {
  /**
   * The positive half of §I.1's subject rule. The verifier is made to return a *different* uuid from
   * the usual fixture, and the store is asked about that one — so the subject demonstrably follows
   * the verified claims rather than a constant the test could have matched by coincidence.
   */
  const otherUser = '44444444-4444-4444-8444-444444444444';
  const harness = createHarness({
    auth: {
      ok: true,
      claims: {
        userId: otherUser,
        sessionId: '55555555-5555-4555-8555-555555555555',
        role: 'authenticated',
      },
    },
  });
  await ask(harness.deps);

  assertEquals(
    [...new Set(harness.quota.subjects())],
    [otherUser],
    'every quota call carries the verified sub and no other identity',
  );
});

Deno.test('a body carrying identity-shaped fields cannot become the quota subject', async () => {
  /**
   * §C.6 rejects any unrecognised field by name, so `user_id` and friends never reach the quota call
   * at all — the request is a `400` first. Both halves are asserted: the rejection, and the fact that
   * no reservation was taken against the value the caller tried to supply.
   */
  const attacker = '99999999-9999-4999-8999-999999999999';
  for (const field of ['user_id', 'subject_id', 'sub', 'reservation_id', 'p_subject_id']) {
    const harness = createHarness({
      provider: createForbiddenProvider(),
      quota: createForbiddenQuotaStore(),
    });
    const { response, body } = await ask(harness.deps, {
      contract_version: 1,
      message: 'hello',
      [field]: attacker,
    });

    assertEquals(response.status, 400, `${field} is rejected as an unknown field`);
    assertEquals(body.error.field, field, 'and named, by name only');
    assertEquals(harness.quota.calls.length, 0, `${field} never reaches the quota store`);
  }
});

Deno.test('a valid request with a client-supplied subject in scope still meters the verified user', async () => {
  /**
   * The belt-and-braces version: a body that is *accepted* cannot influence the subject, because the
   * accepted schema has no identity field in it at all. The subject is read from `VerifiedClaims`,
   * which is the only place a user id exists in the handler.
   */
  const harness = createHarness();
  await ask(harness.deps, { contract_version: 1, message: 'hello', surface: 'faith' });

  const reserve = harness.quota.calls.find((call) => call.op === 'reserve');
  assert(reserve !== undefined && reserve.op === 'reserve', 'a reservation was taken');
  assertEquals(reserve.subjectId, TEST_USER_ID, 'against the verified user');
});

Deno.test('no identity, reservation id or credential appears in the response or the log', async () => {
  const harness = createHarness({ provider: createFakeProvider(answerWithUsage()) });
  const { response } = await createNoorAIHandler(harness.deps)(jsonRequest(validBody()))
    .then(async (r) => ({ response: await r.text() }));

  const logged = harness.logger.text();
  for (const secret of [TEST_USER_ID, TEST_RESERVATION_ID, 'Bearer', 'service_role', 'apikey']) {
    assertExcludes(response, secret, `the response never carries ${secret}`);
    assertExcludes(logged, secret, `the log never carries ${secret}`);
  }
  // The safe correlation id is present, because that is the one identifier §I.7 makes shareable.
  assert(harness.logger.records[0]?.request_id.startsWith('noorai_req_'), 'the safe id is logged');
});

// ─────────────────────────────────────────────────────────────────────────────
// Reserve ordering and denial
// ─────────────────────────────────────────────────────────────────────────────

Deno.test('reserve happens before the first provider call', async () => {
  const harness = createTimelineHarness();
  await ask(harness.deps);

  assertEquals(harness.events[0], 'quota:reserve', 'nothing is spent before quota is reserved');
  assert(
    harness.events.indexOf('quota:reserve') < harness.events.indexOf('provider:call'),
    'and the ordering holds for the whole run',
  );
});

Deno.test('the reserve idempotency key is NoorLife’s own bounded request id', async () => {
  /**
   * The store keys idempotency on `(subject_id, request_id)` and bounds the id to 64 characters. The
   * key is the server-generated id, so it protects a replay of the *same reserve operation* — it does
   * not deduplicate a separate client HTTP retry, which arrives with a new id. See the cross-request
   * test below for that distinction.
   * The id is the server-generated one — random, and never derived from the user or the message.
   */
  const harness = createHarness();
  const { body } = await ask(harness.deps);

  const reserve = harness.quota.calls.find((call) => call.op === 'reserve');
  assert(reserve !== undefined && reserve.op === 'reserve', 'a reservation was taken');
  assertEquals(reserve.quotaRequestId, body.request_id, 'the key is the response’s own request id');
  assert(reserve.quotaRequestId.startsWith('noorai_req_'), 'server-generated, in §I.7’s format');
  assert(reserve.quotaRequestId.length <= 64, 'and inside the database’s bound');
});

Deno.test('a per-user ceiling is 429 with a retry hint, and spends nothing', async () => {
  for (
    const [reason, expected] of [
      ['per_user_minute', 60],
      ['per_user_hour', 3600],
      ['per_user_day', 86_400],
    ] as const
  ) {
    const harness = createHarness({
      reserve: { kind: 'limited', reason },
      provider: createForbiddenProvider(),
    });
    const { response, body } = await ask(harness.deps);

    assertEquals(response.status, 429, `${reason} is the caller’s own doing`);
    assertEquals(body.error.code, 'rate_limited', 'with §I.5’s code');
    assertEquals(body.error.retry_after_seconds, expected, 'and the window as the wait');
    assertEquals(response.headers.get('retry-after'), String(expected), 'on the header too');
    assertEquals(harness.provider.calls.length, 0, 'no provider call on a denied request');
    assertEquals(
      harness.quota.ops(),
      ['reserve'],
      'and no accounting for a reservation never made',
    );
  }
});

Deno.test('a global, concurrency, spend or disabled denial is 503 and spends nothing', async () => {
  /**
   * None of these is the caller's behaviour, so none of them earns a `429`. Telling somebody who did
   * nothing wrong that they asked too often is untrue, and "try again in a moment" is useless advice
   * when the real cause is a global ceiling.
   */
  for (
    const reason of [
      'global_minute',
      'global_day',
      'concurrency',
      'daily_spend',
      'monthly_spend',
      'disabled',
    ] as const
  ) {
    const harness = createHarness({
      reserve: { kind: 'limited', reason },
      provider: createForbiddenProvider(),
    });
    const { response, body } = await ask(harness.deps);

    assertEquals(response.status, 503, `${reason} is NoorLife’s state, not the user’s`);
    assertEquals(body.error.code, 'service_unavailable', 'with §I.5’s stable code');
    assertEquals(body.error.retry_after_seconds, undefined, 'and no retry hint is invented');
    assertEquals(harness.provider.calls.length, 0, `${reason} spends nothing`);
    assertEquals(
      harness.logger.records[0]?.quota_reason,
      reason,
      'the operator sees which ceiling',
    );
  }
});

Deno.test('a quota store that cannot answer fails closed with 503 and calls no provider', async () => {
  /**
   * `unavailable` is every transport, timeout, non-2xx, malformed-JSON, unknown-shape and
   * `configuration_error` case collapsed into one member — the handler's answer is identical for all
   * of them, and an unmetered AI endpoint is worse than an unavailable one (§I.1).
   */
  const harness = createHarness({
    reserve: { kind: 'unavailable' },
    provider: createForbiddenProvider(),
  });
  const { response, body } = await ask(harness.deps);

  assertEquals(response.status, 503, 'fails closed');
  assertEquals(
    body.error.code,
    'service_unavailable',
    'never rate_limited — the user exceeded nothing',
  );
  assertEquals(harness.provider.calls.length, 0, 'and nothing is spent');
  assertEquals(harness.logger.records[0]?.rate_limit_state, 'unavailable', 'honestly recorded');
  assertEquals(
    harness.logger.records[0]?.accounting,
    'not-required',
    'there was nothing to settle',
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Normal accounting
// ─────────────────────────────────────────────────────────────────────────────

Deno.test('a successful first attempt runs reserve → provider → register(1) → finalize, in that order', async () => {
  const harness = createTimelineHarness();
  const { response } = await ask(harness.deps);

  assertEquals(response.status, 200, 'the answer is served');
  assertEquals(
    harness.events,
    ['quota:reserve', 'provider:call', 'quota:register:1', 'quota:finalize'],
    'the exact lifecycle order',
  );
  assertEquals(harness.quota.ops(), ['reserve', 'registerAttempt', 'finalize'], 'and nothing else');
});

Deno.test('the token counts the provider reported are the ones that reach the store', async () => {
  const tokens = usage(311, 57, 23);
  const harness = createHarness({ provider: createFakeProvider(answerWithUsage(tokens)) });
  await ask(harness.deps);

  const registered = harness.quota.calls.find((call) => call.op === 'registerAttempt');
  assert(
    registered !== undefined && registered.op === 'registerAttempt',
    'an attempt was registered',
  );
  assertEquals(
    registered.usage,
    tokens,
    'input, output and reasoning, unmodified and untransposed',
  );
  assertEquals(registered.attemptNumber, 1, 'as ordinal 1');
  assertEquals(registered.outcome, 'success', 'with a coarse outcome class');
  assertEquals(
    registered.reservationId,
    TEST_RESERVATION_ID,
    'against the reservation reserve issued',
  );
});

Deno.test('an attempt whose usage the provider did not report is recorded as zero, never estimated', async () => {
  /**
   * §12.7's rule, restated at the handler: the store "must not invent an estimate". A provider result
   * with no usage is recorded as having happened with no cost attributed, which is honest; guessing a
   * number would put a fabricated figure into the ledger that enforces the spend ceiling.
   */
  const harness = createHarness({ provider: createFakeProvider(helpAnswer()) });
  await ask(harness.deps);

  const registered = harness.quota.calls.find((call) => call.op === 'registerAttempt');
  assert(registered !== undefined && registered.op === 'registerAttempt', 'still registered');
  assertEquals(
    registered.usage,
    { inputTokens: 0, outputTokens: 0, reasoningTokens: 0 },
    'zeros, not an estimate',
  );
});

Deno.test('no money value is ever accepted from the provider or sent to the store', async () => {
  /**
   * §I.2: the database computes cost from its own active price table, and callers "never supply
   * money". The assertion is structural — every registered call is inspected for any money-shaped
   * key — so a future field called `cost` or `micros` fails here rather than being reviewed later.
   */
  const harness = createHarness({ provider: createFakeProvider(answerWithUsage()) });
  await ask(harness.deps);

  for (const call of harness.quota.calls) {
    const serialised = JSON.stringify(call);
    for (const money of ['micros', 'cost', 'price', 'usd', 'amount', 'spend', 'charge']) {
      assertExcludes(serialised.toLowerCase(), money, `no ${money} crosses the port`);
    }
  }
});

Deno.test('finalization happens exactly once, and no release follows a successful accounting', async () => {
  const harness = createHarness({ provider: createFakeProvider(answerWithUsage()) });
  const { response } = await ask(harness.deps);

  assertEquals(response.status, 200, 'answered');
  assertEquals(harness.quota.ops().filter((op) => op === 'finalize').length, 1, 'settled once');
  assertEquals(
    harness.quota.ops().filter((op) => op === 'release').length,
    0,
    'and never released',
  );
  assertEquals(harness.logger.records[0]?.accounting, 'complete', 'recorded as settled');
  assertEquals(harness.logger.records[0]?.attempts_registered, 1, 'with one attempt on record');
});

// ─────────────────────────────────────────────────────────────────────────────
// Retry accounting
// ─────────────────────────────────────────────────────────────────────────────

Deno.test('an eligible transient failure then a success registers ordinals 1 and 2 and finalizes once', async () => {
  const harness = createTimelineHarness({
    providerResults: [
      { kind: 'transient-server-error', usage: usage(100, 0, 0) },
      answerWithUsage(usage(120, 40, 10)),
    ],
  });
  const { response } = await ask(harness.deps);

  assertEquals(response.status, 200, 'the retry succeeded');
  assertEquals(
    harness.events,
    [
      'quota:reserve',
      'provider:call',
      'quota:register:1',
      'provider:call',
      'quota:register:2',
      'quota:finalize',
    ],
    'one reserve, two accounted attempts, one settlement',
  );

  const ordinals = harness.quota.calls
    .filter((call) => call.op === 'registerAttempt')
    .map((call) => (call.op === 'registerAttempt' ? call.attemptNumber : 0));
  assertEquals(ordinals, [1, 2], 'exactly the two permitted ordinals');
  assertEquals(harness.provider.calls.length, 2, 'and never a third provider attempt');
  assertEquals(harness.quota.ops().filter((op) => op === 'finalize').length, 1, 'settled once');
});

Deno.test('the first attempt is classified transient and the second success, not collapsed together', async () => {
  const harness = createHarness({
    provider: createFakeProvider(
      { kind: 'rate-limited', retryAfterSeconds: null, usage: usage(90, 0, 0) },
      answerWithUsage(),
    ),
  });
  await ask(harness.deps);

  const classes = harness.quota.calls
    .filter((call) => call.op === 'registerAttempt')
    .map((call) => (call.op === 'registerAttempt' ? call.outcome : ''));
  assertEquals(classes, ['transient', 'success'], 'each attempt carries its own coarse outcome');
});

Deno.test('a terminal provider failure is registered once and never retried', async () => {
  for (const kind of ['malformed', 'unexpected-tool-call', 'quota-exhausted', 'timeout'] as const) {
    const harness = createHarness({ provider: createFakeProvider({ kind }) });
    await ask(harness.deps);

    assertEquals(harness.provider.calls.length, 1, `${kind} is not retried`);
    assertEquals(
      harness.quota.ops().filter((op) => op === 'registerAttempt').length,
      1,
      `${kind} is recorded exactly once`,
    );
  }
});

Deno.test('attempt 2 cannot occur unless attempt 1 was an approved eligible transient outcome', async () => {
  /**
   * §F.8's allow-list, asserted from the store's side: the only way a second ordinal ever appears is
   * after a `rate-limited` or `transient-server-error` first attempt. Everything else — including a
   * refusal, a timeout and a billing failure — stops at one.
   */
  const retryable = ['rate-limited', 'transient-server-error'];
  for (
    const kind of [
      'answer',
      'refusal',
      'timeout',
      'rate-limited',
      'transient-server-error',
      'quota-exhausted',
      'malformed',
      'unexpected-tool-call',
    ] as const
  ) {
    const first: ProviderResult = kind === 'answer'
      ? answerWithUsage()
      : kind === 'refusal'
      ? { kind: 'refusal', category: 'out-of-scope' }
      : kind === 'rate-limited'
      ? { kind: 'rate-limited', retryAfterSeconds: null }
      : { kind };

    const harness = createHarness({ provider: createFakeProvider(first, answerWithUsage()) });
    await ask(harness.deps);

    const ordinals = harness.quota.calls
      .filter((call) => call.op === 'registerAttempt')
      .map((call) => (call.op === 'registerAttempt' ? call.attemptNumber : 0));
    assertEquals(
      ordinals,
      retryable.includes(kind) ? [1, 2] : [1],
      `${kind} ${retryable.includes(kind) ? 'may' : 'may not'} reach a second ordinal`,
    );
  }
});

Deno.test('a quota RPC failure is never permission to call the provider again', async () => {
  /**
   * The rule that keeps a bookkeeping fault from becoming a spending one. The first attempt is
   * `transient-server-error` — normally retryable — but its registration fails, so the run stops.
   */
  const harness = createTimelineHarness({
    providerResults: [{ kind: 'transient-server-error' }, answerWithUsage()],
    registerAcks: [false],
  });
  const { response } = await ask(harness.deps);

  assertEquals(response.status, 503, 'the safe handler error');
  assertEquals(
    harness.provider.calls.length,
    1,
    'the PROVIDER retry that was otherwise allowed does not happen',
  );
  assertEquals(
    harness.events,
    ['quota:reserve', 'provider:call', 'quota:register:1', 'quota:register:1'],
    'the one bounded accounting replay runs, and nothing follows it',
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Release and failure handling
// ─────────────────────────────────────────────────────────────────────────────

Deno.test('a reservation nothing ran against is released exactly once', async () => {
  /**
   * The production provider's `unavailable` is the real instance of this: no provider is configured,
   * so the port returns without anything leaving the process and the reservation is genuinely unused.
   */
  const harness = createTimelineHarness({ providerResults: [{ kind: 'unavailable' }] });
  const { response } = await ask(harness.deps);

  assertEquals(response.status, 503, 'the request fails closed');
  assertEquals(
    harness.events,
    ['quota:reserve', 'provider:call', 'quota:release'],
    'reserved, nothing incurred, handed back',
  );
  assertEquals(harness.quota.ops().filter((op) => op === 'release').length, 1, 'exactly once');
  assertEquals(
    harness.quota.ops().filter((op) => op === 'registerAttempt').length,
    0,
    'nothing to record',
  );
  assertEquals(
    harness.quota.ops().filter((op) => op === 'finalize').length,
    0,
    'and nothing to settle',
  );
  assertEquals(harness.logger.records[0]?.accounting, 'released', 'recorded as released');
});

Deno.test('a handler budget exhausted before the provider releases the reservation', async () => {
  const harness = createHarness({
    config: { handlerBudgetMs: 0 },
    provider: createForbiddenProvider(),
  });
  const { response } = await ask(harness.deps);

  assertEquals(response.status, 504, '§F.7’s timeout');
  assertEquals(harness.provider.calls.length, 0, 'the provider was never reached');
  assertEquals(
    harness.quota.ops(),
    ['reserve', 'release'],
    'so the reservation is handed straight back',
  );
});

Deno.test('a provider exception is treated as incurred and is recorded, not released', async () => {
  /**
   * The approved release rule at its hardest case. A throw may be a connection reset before anything
   * was sent, or a socket that died after the request was accepted — the handler genuinely cannot
   * tell. Releasing would assert nothing was spent, which is a claim it has no basis for, so the
   * conservative direction is to record the attempt. Under-recording is the failure that spends
   * money; over-recording costs a zero-token row.
   */
  const harness = createTimelineHarness({ provider: createThrowingProvider() });
  const { response } = await ask(harness.deps);

  assertEquals(response.status, 502, 'a transport failure is reported upstream');
  assertEquals(harness.quota.ops().filter((op) => op === 'release').length, 0, 'never released');
  assertEquals(
    harness.quota.ops().filter((op) => op === 'registerAttempt').length,
    2,
    'both attempts are on record',
  );
  assertEquals(harness.quota.ops().filter((op) => op === 'finalize').length, 1, 'and settled');
});

Deno.test('once an attempt occurred, a registration failure returns 503 and does not release', async () => {
  const harness = createTimelineHarness({ registerAcks: [false] });
  const { response, body } = await ask(harness.deps);

  assertEquals(response.status, 503, 'the safe handler error');
  assertEquals(body.error.code, 'service_unavailable', 'from §I.5’s closed set');
  assertEquals(
    harness.quota.ops().filter((op) => op === 'release').length,
    0,
    'no release after a real attempt',
  );
  assertEquals(harness.provider.calls.length, 1, 'and no further provider call');
  assertEquals(
    harness.logger.records[0]?.accounting,
    'failed',
    'the under-count is flagged, not hidden',
  );
});

Deno.test('a failed registration prevents finalize, so nothing claims complete accounting', async () => {
  /**
   * The chosen sequence, stated because it is a decision rather than an accident: finalize is *not*
   * attempted after a registration failure. Finalizing would settle the reservation on the attempts
   * that did land and close it as fully accounted, while the handler knows an attempt is missing.
   * Leaving it open lets the lease expire and the store's late-accounting rule record the incurred
   * cost afterwards — which is the case that rule exists for.
   */
  const harness = createTimelineHarness({ registerAcks: [false] });
  await ask(harness.deps);

  assertEquals(
    harness.quota.ops(),
    ['reserve', 'registerAttempt', 'registerAttempt'],
    'the registration is retried once and then abandoned — no finalize follows',
  );
  assertExcludes(
    harness.quota.ops().join(','),
    'finalize',
    'the reservation is left open, not settled',
  );
});

Deno.test('a finalize failure returns 503, reports no success, and calls no provider again', async () => {
  const harness = createTimelineHarness({ finalizeAcks: [false] });
  const { response, body } = await ask(harness.deps);

  assertEquals(response.status, 503, 'the safe handler error');
  assertEquals('answer' in body, false, 'an answer NoorLife cannot account for is not served');
  assertEquals(harness.provider.calls.length, 1, 'and no additional provider call is made');
  assertEquals(harness.quota.ops().filter((op) => op === 'release').length, 0, 'no release either');
  assertEquals(harness.logger.records[0]?.accounting, 'failed', 'flagged for the operator');
});

Deno.test('an idempotent replay from the store is accepted without duplicate effects', async () => {
  /**
   * The store returns the same reservation for a repeated `(subject_id, request_id)` and acks a
   * repeated finalize without accumulating twice. The handler must simply accept those answers — it
   * has no special path for them, which is what makes replay safe rather than merely handled.
   */
  const harness = createTimelineHarness({
    reserve: { kind: 'allowed', reservationId: TEST_RESERVATION_ID },
  });
  const { response } = await ask(harness.deps);
  assertEquals(response.status, 200, 'a replayed reservation is an ordinary allowed reservation');
  assertEquals(harness.quota.ops().filter((op) => op === 'reserve').length, 1, 'reserved once');
  assertEquals(harness.quota.ops().filter((op) => op === 'finalize').length, 1, 'settled once');
});

// ─────────────────────────────────────────────────────────────────────────────
// Bounded accounting recovery
// ─────────────────────────────────────────────────────────────────────────────

Deno.test('a lost register response is recovered by one idempotent replay', async () => {
  /**
   * The realistic failure: the database committed the attempt row and the acknowledgement was lost on
   * the way back, so the adapter reports failure for a call that actually succeeded. The replay sends
   * byte-identical arguments, the database recognises `(reservation_id, attempt_number)` and returns
   * the original result rather than inserting again — one provider attempt, one attempt identity.
   */
  const tokens = usage(211, 33, 7);
  const harness = createTimelineHarness({
    providerResults: [answerWithUsage(tokens)],
    registerAcks: [false, true],
  });
  const { response } = await ask(harness.deps);

  assertEquals(response.status, 200, 'the request completes normally after recovery');
  assertEquals(harness.provider.calls.length, 1, 'exactly one provider attempt happened');

  const registrations = harness.quota.calls.filter((call) => call.op === 'registerAttempt');
  assertEquals(registrations.length, 2, 'two accounting calls, no more');
  assertEquals(
    registrations.map((call) => JSON.stringify(call)),
    [JSON.stringify(registrations[0]), JSON.stringify(registrations[0])],
    'both carry identical subject, reservation, ordinal, usage and outcome — one database identity',
  );
  assertEquals(
    harness.events,
    ['quota:reserve', 'provider:call', 'quota:register:1', 'quota:register:1', 'quota:finalize'],
    'and the retry sits between the attempt and the settlement, with no second provider call',
  );
  assertEquals(harness.logger.records[0]?.provider_attempts, 1, 'the provider attempt count is 1');
  assertEquals(harness.logger.records[0]?.attempts_registered, 1, 'and one attempt is on record');
  assertEquals(harness.logger.records[0]?.accounting, 'complete', 'settled');
});

Deno.test('a register that fails twice returns 503, with no provider retry and no release', async () => {
  const harness = createTimelineHarness({ registerAcks: [false, false] });
  const { response, body } = await ask(harness.deps);

  assertEquals(response.status, 503, 'the safe handler error');
  assertEquals(body.error.code, 'service_unavailable', 'from §I.5’s closed set');
  assertEquals(
    harness.quota.calls.filter((call) => call.op === 'registerAttempt').length,
    2,
    'at most two accounting calls — the retry is bounded at one',
  );
  assertEquals(harness.provider.calls.length, 1, 'no further provider call');
  assertEquals(harness.quota.ops().filter((op) => op === 'release').length, 0, 'and no release');
  assertEquals(harness.quota.ops().filter((op) => op === 'finalize').length, 0, 'and no finalize');
  assertEquals(
    harness.logger.records[0]?.accounting,
    'failed',
    'flagged in the safe structured log',
  );
});

Deno.test('a finalize that fails once then succeeds settles exactly once', async () => {
  const harness = createTimelineHarness({ finalizeAcks: [false, true] });
  const { response } = await ask(harness.deps);

  assertEquals(response.status, 200, 'the request completes normally');
  const finalizes = harness.quota.calls.filter((call) => call.op === 'finalize');
  assertEquals(finalizes.length, 2, 'two calls, bounded at one retry');
  assertEquals(
    finalizes.map((call) => JSON.stringify(call)),
    [JSON.stringify(finalizes[0]), JSON.stringify(finalizes[0])],
    'identical arguments, so the store’s state guard accumulates the cost exactly once',
  );
  assertEquals(harness.provider.calls.length, 1, 'and the provider was called once');
  assertEquals(harness.logger.records[0]?.accounting, 'complete', 'settled');
});

Deno.test('a finalize that fails twice returns 503, with no provider retry and no release', async () => {
  const harness = createTimelineHarness({ finalizeAcks: [false, false] });
  const { response, body } = await ask(harness.deps);

  assertEquals(response.status, 503, 'the safe handler error');
  assertEquals('answer' in body, false, 'an answer NoorLife cannot account for is not served');
  assertEquals(harness.quota.ops().filter((op) => op === 'finalize').length, 2, 'bounded at two');
  assertEquals(harness.provider.calls.length, 1, 'no further provider call');
  assertEquals(harness.quota.ops().filter((op) => op === 'release').length, 0, 'no release');
  assertEquals(harness.logger.records[0]?.accounting, 'failed', 'flagged, not hidden');
});

Deno.test('no accounting retry happens when the remaining handler budget cannot absorb one', async () => {
  /**
   * Starting a quota call the deadline will cut off spends budget and changes nothing, so the retry
   * is conditional on there being room for it. Expressed by making one quota RPC cost more than the
   * whole handler budget, which is the same arithmetic the handler does.
   */
  const harness = createTimelineHarness({
    registerAcks: [false, true],
    config: { quotaTimeoutMs: 60_000, handlerBudgetMs: 40_000 },
  });
  const { response } = await ask(harness.deps);

  assertEquals(response.status, 503, 'it fails closed rather than overrunning the budget');
  assertEquals(
    harness.quota.calls.filter((call) => call.op === 'registerAttempt').length,
    1,
    'exactly one accounting call — the retry that would have succeeded was not affordable',
  );
  assertEquals(harness.provider.calls.length, 1, 'and no extra provider call');
});

Deno.test('accounting retries never change the provider attempt count or the ordinals', async () => {
  /**
   * The two retry budgets are independent and must stay so: §F.8's one provider retry is about a
   * provider that might answer, and the accounting retry is about a write that might have landed.
   * Here both attempts need an accounting replay, and the provider is still called exactly twice with
   * ordinals 1 and 2.
   */
  const harness = createTimelineHarness({
    providerResults: [
      { kind: 'transient-server-error', usage: usage(90, 0, 0) },
      answerWithUsage(usage(110, 20, 5)),
    ],
    registerAcks: [false, true, false, true],
  });
  const { response } = await ask(harness.deps);

  assertEquals(response.status, 200, 'the retry succeeded and was accounted');
  assertEquals(harness.provider.calls.length, 2, 'exactly two provider attempts, as §F.8 permits');

  const registrations = harness.quota.calls.filter((call) => call.op === 'registerAttempt');
  assertEquals(
    registrations.map((call) => (call.op === 'registerAttempt' ? call.attemptNumber : 0)),
    [1, 1, 2, 2],
    'each ordinal is replayed under its own identity — never renumbered by a retry',
  );
  assertEquals(harness.logger.records[0]?.provider_attempts, 2, 'two provider attempts');
  assertEquals(harness.logger.records[0]?.attempts_registered, 2, 'two accounted attempts');
});

// ─────────────────────────────────────────────────────────────────────────────
// Release accuracy
// ─────────────────────────────────────────────────────────────────────────────

Deno.test('an unacknowledged release is not logged as released', async () => {
  /**
   * The lease TTL still reclaims it, so the response is unchanged — but the log must not say the
   * reservation was released when the store never confirmed it. A concurrency slot that appears to
   * have been freed is exactly the thing an operator would stop investigating.
   */
  const quota = createFakeQuotaStore({ releaseOk: false });
  const harness = createHarness({ quota, provider: createFakeProvider({ kind: 'unavailable' }) });
  const { response } = await ask(harness.deps);

  assertEquals(response.status, 503, 'the request still fails closed for its own reason');
  assertEquals(
    quota.ops().filter((op) => op === 'release').length,
    1,
    'release was attempted once',
  );
  assertEquals(
    harness.logger.records[0]?.accounting,
    'release-failed',
    'and the log says so rather than claiming success',
  );
  assertExcludes(harness.logger.text(), 'released"', 'it is not recorded as released');
});

Deno.test('a successful release is logged as released, so the two states are distinguishable', async () => {
  const harness = createHarness({ provider: createFakeProvider({ kind: 'unavailable' }) });
  await ask(harness.deps);
  assertEquals(harness.logger.records[0]?.accounting, 'released', 'the acknowledged case');
});

// ─────────────────────────────────────────────────────────────────────────────
// The idempotency claim, pinned so the false version cannot return
// ─────────────────────────────────────────────────────────────────────────────

Deno.test('two separate HTTP requests take two reservations — there is no cross-request dedup', async () => {
  /**
   * The correction. An earlier revision of this integration claimed a client retry "replays into the
   * same reservation", which is false: the quota request id is NoorLife's **server-generated** id,
   * minted fresh on every handler execution, so a second HTTP request arrives with a different key and
   * takes a second reservation.
   *
   * What the database's `(subject_id, request_id)` key really protects is a replay of the *same
   * server-controlled key* — the same reserve operation retried. Cross-request deduplication needs a
   * client-controlled key, which §I.1 records as future work (`client_request_id`) and this phase does
   * not add.
   */
  const harness = createHarness();
  const handler = createNoorAIHandler(harness.deps);

  const first = await handler(jsonRequest(validBody()));
  const second = await handler(jsonRequest(validBody()));
  assertEquals(first.status, 200, 'both requests are served');
  assertEquals(second.status, 200, 'both requests are served');

  const reserves = harness.quota.calls.filter((call) => call.op === 'reserve');
  assertEquals(reserves.length, 2, 'each execution reserves');
  const keys = reserves.map((call) => (call.op === 'reserve' ? call.quotaRequestId : ''));
  assertEquals(
    new Set(keys).size,
    2,
    'with DIFFERENT quota request ids — not the same reservation',
  );
});

Deno.test('the source does not claim a client retry reuses the same reservation', () => {
  /**
   * A source assertion, because the failure being guarded against is a *claim* rather than a
   * behaviour: the code was already correct, and only the comment was wrong. A wrong comment about
   * idempotency is what a future reader would rely on when deciding whether a client-controlled key is
   * still needed.
   */
  const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

  /**
   * Doc comments are read as flowing prose, with the `\n   * ` continuations collapsed to a space.
   *
   * Without this the scan is at the mercy of the formatter: `deno fmt` wraps a sentence wherever the
   * line length falls, so "does not deduplicate a separate client HTTP retry" can end up with "not"
   * and "deduplicate" on different lines — which defeats a negation check and, worse, would let a
   * genuinely false claim slip through simply by being long enough to wrap.
   */
  const flatten = (text: string): string => text.replace(/\r?\n\s*\*\s?/g, ' ');
  const sources = ['handler.ts', 'ports.ts', 'quota-rpc.ts']
    .map((name) => flatten(Deno.readTextFileSync(`${root}/${name}`)));

  for (const text of sources) {
    for (
      const claim of [
        /client retry[^.]{0,80}same reservation/i,
        /client[- ]retr(y|ies)[^.]{0,80}(replay|reuse)s? into/i,
        /a client retry therefore replays/i,
        /**
         * Affirmative claims only. An earlier version of this guard matched `deduplicat…client
         * retry` outright, which flagged the *correct* sentence — "it does not deduplicate a
         * separate client HTTP retry" — as though it were the false one. A guard that punishes the
         * accurate statement pushes the next author toward saying nothing, so the negation is
         * excluded explicitly.
         */
        /(?<!not )(?<!never )deduplicates? (a |the )?(separate )?client/i,
      ]
    ) {
      assertEquals(claim.test(text), false, `no source may claim ${String(claim)}`);
    }
  }

  // And the correct statement is present where the key is chosen, so the limit is not merely unstated.
  const handler = flatten(Deno.readTextFileSync(`${root}/handler.ts`));
  assert(
    // Tolerates the emphasis markers the doc comment uses around "not".
    /not\W{0,4}\s*cross-request deduplication/i.test(handler),
    'the handler states plainly that this is not cross-request deduplication',
  );
  assert(/client_request_id/.test(handler), 'and points at the future work that would provide it');
});

Deno.test('no quota transport detail reaches the user or the log', async () => {
  /**
   * §I.6 forbids forwarding backend wording, and the port's shape is what enforces it: an ack is a
   * boolean and a denial is a closed enum, so there is no string from PostgREST, Postgres or the
   * network for the handler to pass on even if it tried.
   */
  const harness = createHarness({
    reserve: { kind: 'unavailable' },
    provider: createForbiddenProvider(),
  });
  const { response } = await createNoorAIHandler(harness.deps)(jsonRequest(validBody()))
    .then(async (r) => ({ response: await r.text() }));

  const logged = harness.logger.text();
  for (
    const leak of [
      'PGRST',
      'postgres',
      'permission denied',
      'relation',
      'SQLSTATE',
      'fetch failed',
      '/rest/v1',
      // The wrapper names themselves, and the private schema. `noor_ai_request` — NoorLife's own log
      // event name — is deliberately not on this list: it is the record's own identifier, not
      // backend detail, and banning the substring would ban the log line rather than the leak.
      'noor_ai_reserve',
      'noor_ai_register_attempt',
      'noor_ai_finalize',
      'noor_ai.',
    ]
  ) {
    assertExcludes(response.toLowerCase(), leak.toLowerCase(), `the body never carries ${leak}`);
    assertExcludes(logged.toLowerCase(), leak.toLowerCase(), `the log never carries ${leak}`);
  }
  assertEquals(
    JSON.parse(response).error.message,
    'Noor AI is unavailable right now. Please try again later.',
    'the user sees NoorLife’s own constant copy',
  );
});
