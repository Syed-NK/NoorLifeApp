import { createNoorAIHandler } from '../handler.ts';
import { assertEquals, assertExcludes } from './assert.ts';
import {
  createForbiddenProvider,
  createHarness,
  jsonRequest,
  TEST_USER_ID,
  validBody,
} from './fakes.ts';

/**
 * §I.1 and §I.2 — the per-user limit, the kill switch, and the two states a limiter can be in that are not
 * "allowed".
 *
 * ── What AI-2 can honestly claim here ────────────────────────────────────────
 * §I.1's hard constraint is that "an Edge Function runs in ephemeral, horizontally-scaled isolates, so an
 * in-memory counter is not a rate limit". §12.7 leaves the store unchosen, and §J.13b — "Rate limit is shared,
 * not per-isolate" — is an **AI-3** row for exactly that reason: it needs simulated isolates and a real shared
 * store to mean anything.
 *
 * So this file asserts the handler's behaviour *given a decision*, which is what AI-2 owns: the `429`, the
 * body's `retry_after_seconds`, the `Retry-After` header, that no provider call happens on a rejected
 * request, that the subject of the limit is the verified user id, and that a limiter which cannot answer fails
 * closed rather than waving the request through. No in-memory counter is presented as distributed rate
 * limiting anywhere.
 */

async function ask(harness: ReturnType<typeof createHarness>) {
  const response = await createNoorAIHandler(harness.deps)(jsonRequest(validBody()));
  return { response, body: await response.json() };
}

Deno.test('§I.1 / §J.13a — exceeding the per-user limit is 429 with both retry signals', async () => {
  /**
   * §J.13a: "`429 rate_limited` with `retry_after_seconds` and `Retry-After`. No provider call on the rejected
   * request."
   */
  const harness = createHarness({
    limit: { kind: 'limited', retryAfterSeconds: 30 },
    provider: createForbiddenProvider(),
  });
  const { response, body } = await ask(harness);

  assertEquals(response.status, 429, '429');
  assertEquals(body.error.code, 'rate_limited', 'with the contract’s code');
  assertEquals(body.error.retry_after_seconds, 30, 'the body field §I.5 specifies');
  assertEquals(response.headers.get('retry-after'), '30', 'and the HTTP header §I.1 requires');
  assertEquals(harness.provider.calls.length, 0, 'no provider call on the rejected request');
  assertEquals(harness.logger.records[0]?.rate_limit_state, 'limited', 'recorded for metrics');
});

Deno.test('§I.1 — the rate-limit copy is non-accusatory', async () => {
  // §I.1: "The copy is NoorLife's and non-accusatory; a keen user is not an attacker."
  const harness = createHarness({ limit: { kind: 'limited', retryAfterSeconds: 30 } });
  const { body } = await ask(harness);

  assertEquals(
    body.error.message,
    "You've asked a few questions very quickly. Try again in a moment.",
    'copy',
  );
  for (const accusatory of ['abuse', 'blocked', 'banned', 'violation', 'suspicious', 'too many']) {
    assertExcludes(body.error.message.toLowerCase(), accusatory, 'no accusation');
  }
});

Deno.test('§I.1 — the subject of the limit is the verified user id, not anything from the request', async () => {
  /**
   * §I.1: "The subject of the limit is the **verified** user id from §D, never a client-supplied id, and never
   * IP alone." A client cannot supply an id at all — §C.6 rejects `user_id` by name — so this asserts the
   * positive half: the limiter is asked about the id the verifier returned.
   */
  const harness = createHarness();
  await ask(harness);
  assertEquals(harness.rateLimiter.subjects, [TEST_USER_ID], 'exactly the verified subject');
});

Deno.test('§I.1 / §12.7 — a limiter that cannot answer fails closed with 503', async () => {
  /**
   * The AI-2 production state. §I.1 rules out the naive implementation and §12.7 leaves the store unchosen, so
   * the only honest answer is `unavailable` — and an unmetered AI endpoint is worse than an unavailable one.
   *
   * The `503` is deliberately not a `429`: the user has not exceeded anything, and telling them they have
   * would be a lie that also suggests waiting would help.
   */
  const harness = createHarness({
    limit: { kind: 'unavailable' },
    provider: createForbiddenProvider(),
  });
  const { response, body } = await ask(harness);

  assertEquals(response.status, 503, 'fails closed');
  assertEquals(
    body.error.code,
    'service_unavailable',
    'not rate_limited — the user exceeded nothing',
  );
  assertEquals(body.error.retry_after_seconds, undefined, 'and no retry hint is invented');
  assertEquals(harness.provider.calls.length, 0, 'nothing is spent');
  assertEquals(
    harness.logger.records[0]?.rate_limit_state,
    'unavailable',
    'the operator sees the real state',
  );
});

Deno.test('§I.2 — the kill switch answers 503 without reading the rate limit or calling the provider', async () => {
  /**
   * §I.2: the kill switch is "A single configuration flag that disables Noor AI without a deploy. Returns
   * `503 service_unavailable`. The check runs before the provider call and before the rate-limit read, so it is
   * cheap and always available."
   */
  const harness = createHarness({
    config: { enabled: false },
    provider: createForbiddenProvider(),
  });
  const { response, body } = await ask(harness);

  assertEquals(response.status, 503, '503');
  assertEquals(body.error.code, 'service_unavailable', 'with the contract’s code');
  assertEquals(harness.rateLimiter.subjects.length, 0, 'before the rate-limit read');
  assertEquals(harness.provider.calls.length, 0, 'and before the provider call');
  assertEquals(
    harness.logger.records[0]?.rate_limit_state,
    'not-evaluated',
    'honestly recorded as unread',
  );
});

Deno.test('validation still runs while Noor AI is switched off', async () => {
  /**
   * The one ordering choice this handler makes that §D.4's table does not dictate, recorded because it is
   * deliberate: a malformed request is told it is malformed even when the kill switch is off. A client
   * debugging its payload against a disabled deployment would otherwise get `503` for a `400` and learn
   * nothing about the real problem.
   */
  const harness = createHarness({ config: { enabled: false } });
  const response = await createNoorAIHandler(harness.deps)(
    jsonRequest({ contract_version: 1, message: 'hi', nickname: 'x' }),
  );

  assertEquals(response.status, 400, 'the schema answer is more useful than the service answer');
  assertEquals((await response.json()).error.field, 'nickname', 'and still names the field');
});

Deno.test('authentication precedes the kill switch, so a switched-off endpoint is not an open one', async () => {
  const harness = createHarness({
    config: { enabled: false },
    auth: { ok: false, reason: 'role' },
  });
  const { response } = await ask(harness);
  assertEquals(
    response.status,
    401,
    'an unauthenticated caller is refused before anything else is decided',
  );
});
