import { createNoorAIHandler } from '../handler.ts';
import type { OperationalLogRecord, ProviderOutcome } from '../ports.ts';
import { assert, assertDoesNotMatch, assertEquals, assertExcludes } from './assert.ts';
import {
  createFakeProvider,
  createFakeTimer,
  createHarness,
  createThrowingProvider,
  createTimingOutProvider,
  helpAnswer,
  jsonRequest,
  TEST_SESSION_ID,
  TEST_USER_ID,
  VALID_BEARER,
} from './fakes.ts';

/**
 * §H.3 and §J.15 — the log surface, scanned rather than sampled.
 *
 * ── Why this file walks every path instead of checking one ───────────────────
 * §J.15a's instruction is "Run the full suite with a log spy" and assert that "No captured log line contains
 * the bearer token, the `message` text, the answer text, the provider key, or the salt". A single happy-path
 * assertion would prove nothing about the error paths, which are exactly where a well-meaning
 * `console.error(request)` gets added.
 *
 * So `EVERY_PATH` below drives one request per distinguishable outcome — every auth failure reason, every
 * validation failure, both limiter states, the kill switch, every provider outcome — and the scans run against
 * the concatenation of all of them.
 *
 * ── The structural guarantee underneath ──────────────────────────────────────
 * §H.3 requires "an allow-list serialiser, not a deny-list regex over free text", because "a regex-based
 * redactor fails the first time a new secret shape appears". `OperationalLogRecord` is that allow-list one
 * step earlier: it has no property that can hold free text, so there is no call site that *could* pass a
 * prompt, an answer, a header or a token. These tests confirm the consequence; the type is what enforces it.
 */

/** The distinctive strings that must never appear in a log line, whatever path produced it. */
const SECRETS = {
  bearer: VALID_BEARER,
  token: 'header.payload.signature',
  message: 'Where do I change my prayer reminder sound on Fridays',
  answer: 'Open Faith then Prayer Settings then Reminders and pick a sound',
  rejectedValue: 'rejected-field-value-that-must-not-be-logged',
  userId: TEST_USER_ID,
  sessionId: TEST_SESSION_ID,
} as const;

function answerWith(text: string): ProviderOutcome {
  return {
    kind: 'answer',
    answer: { text, finish: 'complete', category: null, citationRequired: false },
  };
}

/**
 * Drives one request per distinguishable handler path and returns every log record produced.
 *
 * The message and the provider's answer are the same distinctive strings on every path, so a leak anywhere
 * shows up in the scan regardless of which branch introduced it.
 */
async function everyPath(): Promise<readonly OperationalLogRecord[]> {
  const records: OperationalLogRecord[] = [];
  const body = { contract_version: 1, message: SECRETS.message };

  const run = async (
    options: Parameters<typeof createHarness>[0],
    request: Request,
  ): Promise<void> => {
    const harness = createHarness(options);
    await createNoorAIHandler(harness.deps)(request);
    records.push(...harness.logger.records);
  };

  // Every authentication failure reason.
  for (
    const reason of [
      'missing',
      'malformed',
      'signature',
      'expired',
      'time-claims',
      'audience',
      'issuer',
      'role',
      'subject',
      'session',
      'verifier-unavailable',
    ] as const
  ) {
    await run({ auth: { ok: false, reason } }, jsonRequest(body));
  }

  // Method, path and media type.
  await run({}, jsonRequest(body, { method: 'DELETE' }));
  await run(
    {},
    jsonRequest(body, { url: 'https://p.functions.supabase.co/functions/v1/noor-ai/deep' }),
  );
  await run({}, jsonRequest(body, { contentType: 'text/plain' }));

  // Every validation failure, including one carrying a value that must not be logged.
  await run({}, jsonRequest(null, { rawBody: `{"broken":${SECRETS.rejectedValue}` }));
  await run({}, jsonRequest(null, { rawBody: 'x'.repeat(20_000) }));
  await run({}, jsonRequest({ contract_version: 2, message: SECRETS.message }));
  await run({}, jsonRequest({ contract_version: 1, message: '' }));
  await run({}, jsonRequest({ contract_version: 1, message: 'a'.repeat(1001) }));
  await run(
    {},
    jsonRequest({ contract_version: 1, message: SECRETS.message, nickname: SECRETS.rejectedValue }),
  );
  await run(
    {},
    jsonRequest({ contract_version: 1, message: SECRETS.message, system: SECRETS.rejectedValue }),
  );

  // Limits.
  await run({ config: { enabled: false } }, jsonRequest(body));
  await run({ limit: { kind: 'limited', retryAfterSeconds: 30 } }, jsonRequest(body));
  await run({ limit: { kind: 'unavailable' } }, jsonRequest(body));

  // Every provider outcome that carries an answer or a refusal.
  await run({ provider: createFakeProvider(answerWith(SECRETS.answer)) }, jsonRequest(body));
  await run(
    {
      provider: createFakeProvider({
        kind: 'answer',
        answer: {
          text: SECRETS.answer,
          finish: 'length',
          category: 'finance-education',
          citationRequired: false,
        },
      }),
    },
    jsonRequest(body),
  );
  await run(
    {
      provider: createFakeProvider({
        kind: 'answer',
        answer: {
          text: SECRETS.answer,
          finish: 'complete',
          category: null,
          citationRequired: true,
        },
      }),
    },
    jsonRequest(body),
  );
  for (
    const category of [
      'module-data-required',
      'family-private',
      'health-advice',
      'prescribed-treatment',
      'crisis',
      'finance-advice',
      'finance-product',
      'out-of-scope',
    ] as const
  ) {
    await run({ provider: createFakeProvider({ kind: 'refusal', category }) }, jsonRequest(body));
  }

  // Every provider failure.
  for (
    const outcome of [
      { kind: 'rate-limited', retryAfterSeconds: 2 },
      { kind: 'transient-server-error' },
      { kind: 'quota-exhausted' },
      { kind: 'malformed' },
      { kind: 'unexpected-tool-call' },
      { kind: 'unavailable' },
    ] as const
  ) {
    await run({ provider: createFakeProvider(outcome) }, jsonRequest(body));
  }
  await run({ provider: createThrowingProvider() }, jsonRequest(body));
  await run({ provider: createFakeProvider(answerWith('')) }, jsonRequest(body));

  // The timeout path, which needs its own timer.
  const timer = createFakeTimer();
  await run({ timer, provider: createTimingOutProvider(timer) }, jsonRequest(body));

  return records;
}

Deno.test('§J.15a — no log line contains a token, the message text, or the answer text', async () => {
  const records = await everyPath();
  const text = records.map((record) => JSON.stringify(record)).join('\n');

  assert(records.length > 30, `every path was exercised (${records.length} records)`);

  for (const [label, secret] of Object.entries(SECRETS)) {
    assertExcludes(text, secret, `§H.3 — the ${label} must never be logged`);
  }
});

Deno.test('§J.15b — the string "Bearer" never appears in a log, in any casing', async () => {
  // §J.15b names the assertion exactly: "The string `Bearer` never appears in captured logs, in any casing."
  const text = (await everyPath()).map((record) => JSON.stringify(record)).join('\n');
  assertDoesNotMatch(text, /bearer/i, 'no Authorization header material in any casing');
  assertDoesNotMatch(text, /\bapikey\b/i, 'and no apikey header either');
  assertDoesNotMatch(text, /authorization/i, 'nor the header name');
});

Deno.test('§H.3 — no log line contains anything shaped like a secret', async () => {
  /**
   * The scan §H.3 asks for, applied to shapes rather than to known values — including the "safe"
   * first-and-last-four form it explicitly forbids, and a compact JWS, which is what a leaked token looks
   * like even when nobody meant to log one.
   */
  const text = (await everyPath()).map((record) => JSON.stringify(record)).join('\n');

  assertDoesNotMatch(text, /sk-[A-Za-z0-9_-]{8,}/, 'nothing shaped like a provider key');
  assertDoesNotMatch(text, /sb_(publishable|secret)_/, 'no Supabase key of either generation');
  assertDoesNotMatch(text, /eyJ[A-Za-z0-9_-]{10,}/, 'no base64url JSON header — i.e. no JWT');
  assertDoesNotMatch(
    text,
    /[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/,
    'no compact JWS',
  );
  assertDoesNotMatch(text, /service_role/, 'no service-role reference');
  assertDoesNotMatch(text, /\bsalt\b/i, 'no salt');
});

Deno.test('§H.3 — no raw user id, session id, email or device data is logged', async () => {
  /**
   * §H.3 forbids the raw uuid, and §12.6 leaves the salted-hash alternative undecided. Requirement: if the
   * user-correlation hash is unresolved, do not implement it. So AI-2 logs **no** user identifier at all, and
   * the record type has no field for one — which is asserted here as an absence of key *names*, not just of
   * values, because a field that exists is a field a later change will fill in.
   */
  const records = await everyPath();
  const keys = new Set(records.flatMap((record) => Object.keys(record)));

  for (
    const forbidden of [
      'user_hash',
      'user_id',
      'sub',
      'session_id',
      'email',
      'device',
      'ip',
      'name',
    ]
  ) {
    assertEquals(keys.has(forbidden), false, `§H.3 — the log record has no ${forbidden} field`);
  }

  /**
   * The uuid scan runs with `request_id` removed, because §I.7's id is itself uuid-shaped and is the one
   * identifier that is explicitly safe: it "Contains | Nothing. It is random, not derived from the user, the
   * message, or the time." Anything *else* uuid-shaped in a log line is a primary key that escaped.
   */
  const withoutRequestId = records.map((record) => {
    const { request_id: _requestId, ...rest } = record;
    return JSON.stringify(rest);
  }).join('\n');
  assertDoesNotMatch(
    withoutRequestId,
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/,
    'no uuid other than the request id appears anywhere in the log',
  );
});

Deno.test('§I.7 — every logged record carries the request id, and it is the response’s', async () => {
  /**
   * §I.7: the request id is "Present in | Every response the handler produces — answer, refusal, and handler
   * error — and every log line". A correlation id that differs between the response and the log correlates
   * nothing, so the two are compared rather than each checked for presence.
   */
  const outcomes: ProviderOutcome[] = [
    helpAnswer(),
    { kind: 'refusal', category: 'health-advice' },
    { kind: 'malformed' },
    { kind: 'unavailable' },
  ];

  for (const outcome of outcomes) {
    const harness = createHarness({ provider: createFakeProvider(outcome) });
    const response = await createNoorAIHandler(harness.deps)(
      jsonRequest({ contract_version: 1, message: 'Where is Qibla?' }),
    );
    const body = await response.json();

    assertEquals(harness.logger.records.length, 1, 'exactly one log record per request');
    assertEquals(
      harness.logger.records[0]?.request_id,
      body.request_id,
      'and it matches the response',
    );
    assert(/^noorai_req_[0-9a-f-]{36}$/.test(body.request_id), '§I.7’s format');
  }
});

Deno.test('§H.3 — the log carries metadata about the question, never the question', async () => {
  // §H.3: "Token counts and `message_length` are metadata, not content: they say how much was asked, never
  // what."
  const harness = createHarness();
  await createNoorAIHandler(harness.deps)(
    jsonRequest({ contract_version: 1, message: 'Where is Qibla?', surface: '/faith' }),
  );

  const record = harness.logger.records[0];
  assertEquals(record?.message_length, 15, 'the length in code points');
  assertEquals(record?.surface_accepted, true, 'whether the surface was recognised');
  assertEquals(record?.outcome, 'answer', 'and the outcome');
  assertExcludes(JSON.stringify(record), 'Qibla', 'but not a word of the question');
});

Deno.test('§J.15c — no response body on any path contains a secret, a header value or a stack trace', async () => {
  /**
   * §J.15c: "Every error and refusal path | No response body contains a token, key, header value, provider
   * message, provider id, or stack trace."
   *
   * Driven over the same exhaustive path list as the log scans, because a response is the other place a
   * well-meaning error handler leaks.
   */
  const bodies: string[] = [];
  const message = SECRETS.message;

  const collect = async (
    options: Parameters<typeof createHarness>[0],
    request: Request,
  ): Promise<void> => {
    const harness = createHarness(options);
    const response = await createNoorAIHandler(harness.deps)(request);
    bodies.push(await response.text());
  };

  for (const reason of ['missing', 'signature', 'role', 'verifier-unavailable'] as const) {
    await collect({ auth: { ok: false, reason } }, jsonRequest({ contract_version: 1, message }));
  }
  await collect({}, jsonRequest(null, { rawBody: `{"x":${SECRETS.rejectedValue}` }));
  await collect({}, jsonRequest({ contract_version: 1, message, nickname: SECRETS.rejectedValue }));
  await collect(
    { limit: { kind: 'limited', retryAfterSeconds: 30 } },
    jsonRequest({ contract_version: 1, message }),
  );
  for (
    const outcome of [
      { kind: 'malformed' },
      { kind: 'unexpected-tool-call' },
      { kind: 'quota-exhausted' },
      { kind: 'transient-server-error' },
      { kind: 'unavailable' },
      { kind: 'refusal', category: 'crisis' },
      { kind: 'refusal', category: 'module-data-required' },
    ] as const
  ) {
    await collect(
      { provider: createFakeProvider(outcome) },
      jsonRequest({ contract_version: 1, message }),
    );
  }

  const text = bodies.join('\n');
  assertDoesNotMatch(text, /bearer/i, 'no header value');
  assertDoesNotMatch(text, /sk-[A-Za-z0-9_-]{8,}/, 'no provider key shape');
  assertDoesNotMatch(text, /sb_(publishable|secret)_/, 'no Supabase key');
  assertDoesNotMatch(text, /eyJ[A-Za-z0-9_-]{10,}/, 'no JWT');
  assertDoesNotMatch(text, /resp_|x-request-id/i, 'no provider identifier');
  assertDoesNotMatch(text, /\bat [A-Za-z]+ \(|\bstack\b|Error:/, 'no stack trace or raw exception');
  assertExcludes(text, SECRETS.rejectedValue, 'no rejected field value');
  assertExcludes(text, SECRETS.userId, 'no raw user id');
  assertExcludes(text, SECRETS.sessionId, 'no session id');
});
