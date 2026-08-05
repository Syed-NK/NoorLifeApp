import { checkClaims, type ClaimsPolicy } from '../claims.ts';
import { createNoorAIHandler } from '../handler.ts';
import { assert, assertEquals, assertExcludes } from './assert.ts';
import {
  createForbiddenProvider,
  createHarness,
  ENDPOINT,
  jsonRequest,
  TEST_SESSION_ID,
  TEST_USER_ID,
  VALID_BEARER,
  validBody,
} from './fakes.ts';

/**
 * §D.4's handler rows, and the boundary §D.3 refuses to overstate.
 *
 * ── What this file can and cannot test, stated up front ──────────────────────
 * §J splits the authentication rows across two producers, and the split is not cosmetic. With
 * `verify_jwt = true` the Edge gateway answers a missing or malformed JWT **before this handler exists** —
 * "your code never executes" — in Supabase's platform shape and with no NoorLife `request_id`. §J.1, §J.2a
 * and §J.2d are therefore gateway assertions, they are marked BLOCKED in
 * `gateway-integration_test.ts`, and nothing here pretends to cover them.
 *
 * What this file covers is §D.4 rows 2–8: the handler's own re-verification, which §D.2 keeps as
 * mechanism 2 because "the documentation describes what the gateway does in one sentence and does not
 * enumerate which claims it checks". §J.2d2 — the legacy `anon`-role token — is called "**The single most
 * important handler auth test**", and it is here.
 */

const POLICY: ClaimsPolicy = {
  issuer: 'https://project.supabase.co/auth/v1',
  audience: 'authenticated',
  clockSkewSeconds: 5,
};

const NOW = 1_800_000_000;

function claims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    iss: POLICY.issuer,
    aud: POLICY.audience,
    role: 'authenticated',
    sub: TEST_USER_ID,
    session_id: TEST_SESSION_ID,
    iat: NOW - 10,
    exp: NOW + 3600,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// §D.4 rows 4–8 — the claim policy, with no cryptography in the way
// ─────────────────────────────────────────────────────────────────────────────

Deno.test('§D.4 row 6 — a legacy anon-role token is refused (§J.2d2)', () => {
  /**
   * The most important row in §J's auth block. §D.4 spells out why: a legacy JWT-format `anon` key "is a
   * long-lived signed JWT with `role: "anon"`" that "Passes a signature check and can satisfy a
   * `verify_jwt` gate. Only the explicit `role` assertion stops it."
   *
   * So this token is correct in every other respect — right issuer, right audience, unexpired, uuid `sub`,
   * `session_id` present — and is refused solely on `role`.
   */
  const outcome = checkClaims(claims({ role: 'anon' }), POLICY, NOW);
  assertEquals(outcome.ok, false, 'an anon-role token must not authenticate');
  assert(!outcome.ok && outcome.reason === 'role', 'refused for the role claim, not incidentally');
});

Deno.test('§D.4 row 6 — a service_role token is refused (§J.2d2, repeated)', () => {
  // §J.2d2: "Repeat for `role: "service_role"`." A service-role key bypasses RLS; it must never be able
  // to present itself as a signed-in person asking a help question.
  const outcome = checkClaims(claims({ role: 'service_role' }), POLICY, NOW);
  assert(!outcome.ok && outcome.reason === 'role', 'a service_role token must be refused on role');
});

Deno.test('§D.4 row 6 — a missing or unexpected role is refused', () => {
  for (
    const role of [undefined, '', 'authenticated ', 'AUTHENTICATED', 'supabase_admin', 1, true]
  ) {
    const outcome = checkClaims(claims({ role }), POLICY, NOW);
    assert(!outcome.ok, `role ${JSON.stringify(role)} must not authenticate`);
  }
});

Deno.test('§D.4 row 4 — an expired token is refused, with no leeway on exp', () => {
  /**
   * §D.3 quotes the rule: `exp` "Sets a time limit after which the token should not be trusted and is
   * considered expired, even if it is properly signed". The second case is the one that matters — a token
   * expiring exactly now is expired, because skew on `exp` would silently widen §D.3's acceptance window
   * by an amount nobody reviewed.
   */
  assert(!checkClaims(claims({ exp: NOW - 1 }), POLICY, NOW).ok, 'a past exp must be refused');
  assert(!checkClaims(claims({ exp: NOW }), POLICY, NOW).ok, 'exp == now must be refused');
  assert(
    checkClaims(claims({ exp: NOW + 1 }), POLICY, NOW).ok,
    'exp one second out is still valid',
  );
});

Deno.test('§D.4 row 4 — a token with no exp is refused', () => {
  // A token without `exp` never expires, which would remove the only bound §D.3 has on its acceptance
  // window. There is no "treat a missing exp as far future" branch anywhere.
  assert(!checkClaims(claims({ exp: undefined }), POLICY, NOW).ok, 'a missing exp must be refused');
  assert(
    !checkClaims(claims({ exp: 'soon' }), POLICY, NOW).ok,
    'a non-numeric exp must be refused',
  );
});

Deno.test('§D.4 row 4 — future nbf and iat are refused beyond the permitted skew', () => {
  assert(!checkClaims(claims({ nbf: NOW + 60 }), POLICY, NOW).ok, 'a future nbf must be refused');
  assert(!checkClaims(claims({ iat: NOW + 60 }), POLICY, NOW).ok, 'a future iat must be refused');
  // Inside the skew, a clock difference is tolerated rather than treated as an attack.
  assert(checkClaims(claims({ nbf: NOW + 3 }), POLICY, NOW).ok, 'small clock skew is tolerated');
});

Deno.test('§D.4 row 5 — a foreign issuer or audience is refused', () => {
  assert(
    !checkClaims(claims({ iss: 'https://attacker.supabase.co/auth/v1' }), POLICY, NOW).ok,
    'another project’s issuer must be refused',
  );
  assert(
    !checkClaims(claims({ iss: undefined }), POLICY, NOW).ok,
    'a missing issuer must be refused',
  );
  assert(
    !checkClaims(claims({ aud: 'anon' }), POLICY, NOW).ok,
    'a foreign audience must be refused',
  );
  // An array audience is legal JWT and is accepted only when it contains the expected value.
  assert(
    checkClaims(claims({ aud: ['authenticated', 'other'] }), POLICY, NOW).ok,
    'array aud matches',
  );
  assert(
    !checkClaims(claims({ aud: ['other'] }), POLICY, NOW).ok,
    'a non-matching array aud is refused',
  );
});

Deno.test('§D.4 row 7 — a sub that is not a well-formed uuid is refused (§J.2e)', () => {
  /**
   * §J.2e's forged-`sub` row. The uuid check is not the defence — the signature is — but it is what stops
   * a verified token carrying something that is not a user id from being treated as one, and it is what
   * keeps `userId` a value the rest of the function can rely on.
   */
  for (const sub of [undefined, '', 'not-a-uuid', 'admin', '11111111-1111-4111-8111', 42]) {
    assert(
      !checkClaims(claims({ sub }), POLICY, NOW).ok,
      `sub ${JSON.stringify(sub)} must be refused`,
    );
  }
});

Deno.test('§D.4 row 8 — session_id must be present, and its liveness is NOT checked (§J.2c)', () => {
  /**
   * §J.2c "**pins the accepted boundary, does not require revocation**".
   *
   * The first assertion is that `session_id` is required. The second is the boundary itself: a token whose
   * session was ended server-side is *indistinguishable* from one whose session is live, because nothing
   * here consults `auth.sessions`. §D.3: such a token "**may remain accepted until the JWT expires**".
   *
   * This test exists so that adopting strong revocation later is "a visible, deliberate test change rather
   * than a silent one" — whoever implements §12.10 has to come here and change it.
   */
  assert(!checkClaims(claims({ session_id: undefined }), POLICY, NOW).ok, 'session_id is required');
  assert(!checkClaims(claims({ session_id: 'signed-out' }), POLICY, NOW).ok, 'it must be a uuid');

  const revokedButUnexpired = checkClaims(claims(), POLICY, NOW);
  assert(
    revokedButUnexpired.ok,
    'a signed, unexpired token is accepted regardless of session state',
  );
  assertEquals(
    revokedButUnexpired.ok && revokedButUnexpired.claims.sessionId,
    TEST_SESSION_ID,
    'session_id is carried for correlation only',
  );
});

Deno.test('a fully valid claim set yields exactly the three fields the handler may know', () => {
  const outcome = checkClaims(claims(), POLICY, NOW);
  assert(outcome.ok, 'the valid claim set must authenticate');
  assertEquals(
    outcome.ok ? outcome.claims : null,
    { userId: TEST_USER_ID, sessionId: TEST_SESSION_ID, role: 'authenticated' },
    'nothing else from the token reaches the handler — no email, no metadata, no raw payload',
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// The handler's behaviour once the verifier has spoken
// ─────────────────────────────────────────────────────────────────────────────

Deno.test('§D.4 row 2 — a rejected credential yields 401 and no provider call', async () => {
  /**
   * §J.1's handler-level equivalent, which §J.1 says "is exercised separately with the gate bypassed in the
   * harness". Injecting a refusing verifier *is* that bypass: the gateway is not in the picture, so this is
   * a statement about the handler alone.
   */
  for (
    const reason of ['missing', 'malformed', 'signature', 'expired', 'role', 'subject'] as const
  ) {
    const harness = createHarness({
      auth: { ok: false, reason },
      provider: createForbiddenProvider(),
    });
    const handler = createNoorAIHandler(harness.deps);
    const response = await handler(jsonRequest(validBody()));

    assertEquals(response.status, 401, `${reason} must answer 401`);
    assertEquals(harness.provider.calls.length, 0, 'no provider call is ever made (§J.1)');

    const body = await response.json();
    assertEquals(
      body.error.code,
      'unauthenticated',
      'one stable code for every handler auth failure',
    );
  }
});

Deno.test('§D.1 — every handler auth rejection returns byte-identical detail', async () => {
  /**
   * §D.1: "Within the handler category, all rejections produce the **same** response body; distinguishing
   * them tells a prober how far it got."
   *
   * `request_id` differs per request by design, so it is removed before comparison. Everything else must
   * be identical — a caller must not be able to tell "wrong signature" from "wrong role".
   */
  const bodies: string[] = [];
  for (
    const reason of ['malformed', 'signature', 'expired', 'audience', 'role', 'session'] as const
  ) {
    const harness = createHarness({ auth: { ok: false, reason } });
    const response = await createNoorAIHandler(harness.deps)(jsonRequest(validBody()));
    const body = await response.json();
    delete body.request_id;
    bodies.push(JSON.stringify(body));
  }
  assertEquals(new Set(bodies).size, 1, 'the six rejections are indistinguishable to the caller');
});

Deno.test('a 401 body discloses nothing about the token or the reason', async () => {
  const harness = createHarness({ auth: { ok: false, reason: 'signature' } });
  const response = await createNoorAIHandler(harness.deps)(jsonRequest(validBody()));
  const text = await response.text();

  for (const forbidden of ['Bearer', 'signature', 'jwt', 'JWT', 'token', 'claim', 'role', 'exp']) {
    assertExcludes(text.toLowerCase(), forbidden.toLowerCase(), 'no auth detail in the response');
  }
});

Deno.test('a verifier that cannot verify answers 503, not 401', async () => {
  /**
   * The fail-closed case, and the reason it is not a `401`: `verifier-unavailable` means the *server* has
   * no usable key material — the legacy-HS256 configuration described in `jwt-verifier.ts` — and telling a
   * correctly signed-in user their session is bad would hide an operator problem behind a user-facing one.
   *
   * §J does not have a row for this because AI-1 did not anticipate the verifier being unconfigurable
   * without a dashboard confirmation. It is reported as an open AI-2 exit criterion rather than resolved by
   * guessing an algorithm.
   */
  const harness = createHarness({
    auth: { ok: false, reason: 'verifier-unavailable' },
    provider: createForbiddenProvider(),
  });
  const response = await createNoorAIHandler(harness.deps)(jsonRequest(validBody()));

  assertEquals(response.status, 503, 'an unverifiable configuration fails closed');
  assertEquals(
    (await response.json()).error.code,
    'service_unavailable',
    'and says so as a service state',
  );
  assertEquals(harness.provider.calls.length, 0, 'still no provider call');
  assertEquals(
    harness.logger.records[0]?.auth_reason,
    'verifier-unavailable',
    'the operator sees the real reason in the log, which the caller does not',
  );
});

Deno.test('the handler hands the verifier the raw Authorization header and nothing else', async () => {
  /**
   * §D.4 row 2 — present, single, `Bearer`, non-empty — belongs to the verifier, so the handler must pass
   * the header through unparsed. A handler that pre-extracted the token would be a handler that had already
   * decided the header was well-formed.
   */
  const harness = createHarness();
  await createNoorAIHandler(harness.deps)(jsonRequest(validBody()));
  assertEquals(harness.verifier.seen, [VALID_BEARER], 'exactly the header value, unmodified');
});

Deno.test('authentication runs before the body is read', async () => {
  /**
   * The ordering §D.4 implies and this pins: nothing reads, parses or measures a body for a caller who has
   * not authenticated. An oversized body from an unauthenticated caller answers `401`, not `413` — the
   * cheaper rejection is the one that also refuses to do the work.
   */
  const harness = createHarness({ auth: { ok: false, reason: 'missing' } });
  const response = await createNoorAIHandler(harness.deps)(
    jsonRequest(null, { rawBody: 'x'.repeat(20_000) }),
  );
  assertEquals(response.status, 401, 'authentication decides first');
});

Deno.test('the preflight needs no authentication (§C.1)', async () => {
  /**
   * §C.1: `OPTIONS` "is answered for CORS preflight and requires no authentication (a preflight carries no
   * `Authorization` header by definition)".
   */
  const harness = createHarness({ provider: createForbiddenProvider() });
  const response = await createNoorAIHandler(harness.deps)(
    new Request(ENDPOINT, { method: 'OPTIONS' }),
  );

  assertEquals(response.status, 204, 'a preflight is answered');
  assertEquals(harness.verifier.seen.length, 0, 'and no credential is demanded');
  assertEquals(harness.provider.calls.length, 0, 'and nothing is asked of the provider');
  assertEquals(
    harness.logger.records.length,
    0,
    'a preflight is not a Noor AI request and is not logged',
  );
});
