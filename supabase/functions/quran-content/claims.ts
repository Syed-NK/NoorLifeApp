import type { AuthOutcome } from './ports.ts';

/**
 * §D.4 rows 4–8, as a pure function over already-signature-verified claims.
 *
 * ── Why the claim policy is separate from the cryptography ───────────────────
 * The two halves fail for different reasons and need different tests. "Is this signature valid against
 * the project key set" is answered by WebCrypto and can only be tested against real key material;
 * "is `role` exactly `authenticated`" is a policy decision, it is the check §D.4 calls out above all
 * others, and it must be provable without a key existing anywhere.
 *
 * So `jwt-verifier.ts` does the signature and hands the payload here, and `tests/handler-auth_test.ts`
 * exercises this file directly for the cases that matter most — §J.2d2's legacy `anon`-role and
 * `service_role` tokens, "**The single most important handler auth test**".
 *
 * ── What arriving here does and does not mean ────────────────────────────────
 * It means the string's signature verified. It does **not** mean the caller's session still exists.
 * §D.3 withdraws that claim explicitly, and nothing in this file may be read as restoring it — see the
 * note on `session_id` below.
 */

export type ClaimsPolicy = {
  /** The project's token issuer, e.g. `<SUPABASE_URL>/auth/v1`. §D.4 row 5. */
  readonly issuer: string;
  /**
   * The expected `aud`.
   *
   * Supabase issues `aud: "authenticated"` for a signed-in user, so this value is an audience *name*
   * rather than a project identifier — the project-specific half of §D.4 row 5 is carried by `issuer`.
   * Recorded here because "`aud` and issuer are this project's" reads as though both were
   * project-scoped, and only one of them is.
   */
  readonly audience: string;
  /**
   * Leeway for `nbf` and `iat` only.
   *
   * `exp` is checked with **no** leeway. §D.3 quotes the rule it is enforcing: `exp` "Sets a time limit
   * after which the token should not be trusted and is considered expired, even if it is properly
   * signed". Skew on `exp` would extend the §D.3 acceptance window this contract has already been
   * careful to state honestly, and it would extend it by an amount nobody reviewed.
   */
  readonly clockSkewSeconds: number;
};

/**
 * RFC 4122 shape, with a version nibble of 1–8 and an RFC-variant nibble.
 *
 * §D.4 row 7 requires `sub` to be "a well-formed uuid". Supabase user ids are v4, but pinning the
 * version here would make this function reject a future id format that Supabase considers valid, so the
 * check is on the shape rather than on the generator.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

function audienceMatches(aud: unknown, expected: string): boolean {
  if (typeof aud === 'string') {
    return aud === expected;
  }
  // The JWT specification permits an array audience. Accepting one that *contains* the expected value
  // is the specified behaviour; accepting one that merely overlaps something is not.
  return Array.isArray(aud) && aud.some((entry) => entry === expected);
}

/**
 * Validates the claims the handler depends on.
 *
 * Every failure returns the same closed reason enum, and the handler turns every one of them into the
 * same `401 unauthenticated` body (§D.1): "Within the handler category, all rejections produce the
 * **same** response body; distinguishing them tells a prober how far it got." The reason survives only
 * into the operational log, where it is a closed enum and not a claim value.
 */
export function checkClaims(
  claims: Record<string, unknown>,
  policy: ClaimsPolicy,
  nowSeconds: number,
): AuthOutcome {
  // §D.4 row 4 — not expired. `exp` is required: a token without one never expires, and §D.3's whole
  // acceptance boundary is "until the JWT expires".
  const exp = claims.exp;
  if (typeof exp !== 'number' || !Number.isFinite(exp)) {
    return { ok: false, reason: 'time-claims' };
  }
  if (nowSeconds >= exp) {
    return { ok: false, reason: 'expired' };
  }

  // §D.4 row 4 — `nbf`/`iat` sane. Both optional; both, when present, must not be in the future beyond
  // the permitted skew. A token issued in the future is either a clock problem or a forgery attempt,
  // and neither is something to answer a question for.
  const nbf = claims.nbf;
  if (nbf !== undefined) {
    if (typeof nbf !== 'number' || !Number.isFinite(nbf)) {
      return { ok: false, reason: 'time-claims' };
    }
    if (nowSeconds + policy.clockSkewSeconds < nbf) {
      return { ok: false, reason: 'time-claims' };
    }
  }
  const iat = claims.iat;
  if (iat !== undefined) {
    if (typeof iat !== 'number' || !Number.isFinite(iat)) {
      return { ok: false, reason: 'time-claims' };
    }
    if (nowSeconds + policy.clockSkewSeconds < iat) {
      return { ok: false, reason: 'time-claims' };
    }
  }

  // §D.4 row 5.
  if (!audienceMatches(claims.aud, policy.audience)) {
    return { ok: false, reason: 'audience' };
  }
  if (claims.iss !== policy.issuer) {
    return { ok: false, reason: 'issuer' };
  }

  /**
   * §D.4 row 6 — `role` is `authenticated`, **not** `anon`, not `service_role`.
   *
   * §D.4 gives three reasons this check is retained even though this project's `sb_publishable_*` key is
   * not a JWT and cannot reach the handler at all, and the third is the one to remember: it "is the
   * difference between 'the token verified' and 'a signed-in person is calling', and conflating those
   * two statements is the single most likely way to build an 'authenticated' AI endpoint that is in fact
   * open to the internet".
   *
   * A legacy JWT-format `anon` or `service_role` key is a correctly signed token for this project. It
   * passes every check above this line. This is the only line that stops it.
   */
  if (claims.role !== 'authenticated') {
    return { ok: false, reason: 'role' };
  }

  // §D.4 row 7.
  if (!isUuid(claims.sub)) {
    return { ok: false, reason: 'subject' };
  }

  /**
   * §D.4 row 8 — `session_id` is present and recorded for correlation.
   *
   * **Its existence in `auth.sessions` is not checked**, and this function makes no attempt to check it.
   * §D.3 states the consequence in full: a signed, correctly scoped, unexpired authenticated-user JWT
   * "**may remain accepted until the JWT expires**", which at `jwt_expiry = 3600` is up to one hour
   * after sign-out. Strong immediate revocation is not implemented and AI-2 does not pretend otherwise.
   *
   * The documented mechanism that *would* close it — checking the claim against a row in
   * `auth.sessions` — needs privileged database access that §B.2 forbids wiring in "for later", and
   * §12.10 assigns the decision to AI-10 with a threat model and a least-privilege access story. There
   * is no service-role credential in this function, no database client, and no `auth.sessions` read.
   *
   * Presence is still required, because §J.2c's assertion is that the boundary is *pinned*: a token
   * without a `session_id` is not a Supabase user session token, and accepting one would widen the gap
   * beyond the one this contract has written down.
   */
  if (!isUuid(claims.session_id)) {
    return { ok: false, reason: 'session' };
  }

  return {
    ok: true,
    claims: { userId: claims.sub, sessionId: claims.session_id, role: 'authenticated' },
  };
}
