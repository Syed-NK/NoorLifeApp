import { checkClaims, type ClaimsPolicy } from './claims.ts';
import type { AuthOutcome, ClaimsVerifier } from './ports.ts';

/**
 * The production claim verifier — §D.2 mechanism 2.
 *
 * ── What this is for, given that the gateway already ran ─────────────────────
 * `verify_jwt = true` is the first deployed gate and stays on (§K, §12.11). This is the second, and
 * §D.2 says why it is not redundant: "The documentation describes what the gateway does in one sentence
 * and does not enumerate which claims it checks, so the claims this function actually depends on —
 * `role === 'authenticated'` above all — are asserted where they can be seen and tested. It also keeps
 * the handler correct if the gateway is ever reconfigured."
 *
 * ── Why there is no JWT library here, and no network call ────────────────────
 * Two facts from the current Supabase documentation make a dependency unnecessary:
 *
 *   • The platform injects `SUPABASE_JWKS` into every function. The verification keys are therefore
 *     already in the environment, so verifying a signature needs **no outbound request at all** — which
 *     is what lets AI-2 state flatly that this function calls the network nowhere.
 *   • Supabase Auth signs user tokens with ES256, RS256, HS256, or EdDSA ("coming soon"). WebCrypto
 *     verifies the two asymmetric ones directly from a JWK, in about forty lines, with no remote module
 *     to pin, audit or cache.
 *
 * The alternative was `withSupabase` from `@supabase/server`, and it was rejected for a specific
 * reason rather than for dependency taste: its context object exposes `supabaseAdmin`, which "bypasses
 * RLS restrictions". §B.2's service-role row forbids introducing that capability into this function,
 * and §12.10 forbids reaching for privileged access as an incidental part of another phase. A wrapper
 * that hands the handler a service-role client is a wrapper that makes the forbidden thing one
 * identifier away.
 *
 * ── This project's signing key, confirmed rather than assumed ────────────────
 * §0.3 recorded that the project's signing algorithm was "not determinable from the working tree" and
 * made confirming it an AI-2 exit criterion. It has since been confirmed against the project dashboard,
 * and the answer decides which of the two branches below this endpoint is actually on:
 *
 *   • The **current** signing key is **ECC (P-256)**, and it is in the CURRENT state — the key Auth signs
 *     new access tokens with. RFC 7518 §3.1 defines `ES256` as "ECDSA using P-256 and SHA-256", so an
 *     ECC P-256 signing key issues `ES256` tokens. That is on the allow-list below, `SUPABASE_JWKS`
 *     carries its public half, and this verifier needs nothing further configured.
 *   • A **previous HS256 key remains listed**, temporarily, so that access tokens issued before the
 *     rotation can still be verified until they pass their `exp`.
 *
 * No key identifier from the dashboard is recorded here, and none is needed: `kid` is read from the token
 * and matched against whatever the platform injects.
 *
 * ── The algorithm this verifier does not accept, and why that is fail-closed ─
 * HS256 is deliberately absent from the allow-list. Verifying it needs the project's legacy JWT
 * **secret**, and AI-2 provisions no secret of any kind (§K: "**no key exists anywhere**"). AI-2 does not
 * add, read or depend on that secret, and it does not migrate, revoke or modify any signing key.
 *
 * So during the transition there is exactly one gap, and it is stated rather than papered over. An
 * unexpired token signed by the **previous HS256 key** may satisfy the gateway — `verify_jwt` is
 * documented as validating "legacy HS256 JWTs" — and then be refused here, because this handler cannot
 * verify it independently. The refusal is `signature` → `401`: an unverifiable credential is refused
 * rather than trusted on the gateway's word, so there is no bypass and nothing is weakened to accommodate
 * it. What it costs is **availability**, not security — a real signed-in user holding a pre-rotation
 * token gets a `401` until it expires — and it is temporary: once the last such token passes its `exp`,
 * every token in circulation is ES256 and the incompatibility ends on its own. This is not a security
 * success to be claimed; it is a transitional limitation to be waited out.
 *
 * The reverse case still holds too. If a project ever presents no usable key at all, `parseKeySet`
 * returns `null` — the documentation states the discovery endpoint "does not return any keys if you are
 * not using asymmetric JWT signing keys" — and this verifier answers `verifier-unavailable`, which the
 * handler turns into `503`, not `401`. That is a statement about the server, not about the caller.
 *
 * Refusing HS256 also removes the classic algorithm-confusion attack by construction: there is no code
 * path that can treat a public key as an HMAC secret, because there is no HMAC path. A listed symmetric
 * key is unreachable by two independent rules — the allow-list refuses the header, and `selectKey`
 * requires `kty: "EC"` on `P-256`. `tests/jwt-verifier_test.ts` pins both, along with the signature
 * representation: JOSE ES256 signatures are the fixed 64-octet R‖S pair of RFC 7518 §3.4, **not** DER,
 * and the two are not interchangeable.
 */

/** The signature algorithms this verifier accepts. See the file note on HS256's absence. */
const SUPPORTED_ALGORITHMS = ['RS256', 'ES256'] as const;
type SupportedAlgorithm = (typeof SUPPORTED_ALGORITHMS)[number];

function isSupportedAlgorithm(value: unknown): value is SupportedAlgorithm {
  return typeof value === 'string' && (SUPPORTED_ALGORITHMS as readonly string[]).includes(value);
}

/** The compact JWS serialisation: three base64url segments, nothing else. */
const COMPACT_JWS = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

/**
 * §D.4 row 2 — `Authorization` present, single, `Bearer`, non-empty.
 *
 * "more than one credential presented → `401`". `Headers.get` joins repeated headers with `", "`, so a
 * request carrying two `Authorization` headers arrives as one comma-bearing string — which the strict
 * pattern below rejects, because a compact JWS contains no comma and no space. The scheme is matched
 * case-insensitively per RFC 7235; the token is not.
 */
export function extractBearerToken(header: string | null): string | null {
  if (header === null) {
    return null;
  }
  const match = /^Bearer[ ]([^ ]+)$/i.exec(header.trim());
  if (match === null) {
    return null;
  }
  const token = match[1];
  return token !== undefined && COMPACT_JWS.test(token) ? token : null;
}

/**
 * Backed by an explicit `ArrayBuffer` rather than the `Uint8Array(length)` shorthand.
 *
 * `crypto.subtle.verify` takes a `BufferSource`, which excludes a view over a `SharedArrayBuffer`, and
 * the shorthand's inferred buffer type is the wider `ArrayBufferLike`. Allocating the buffer explicitly
 * is how the byte array this hands to WebCrypto is the type WebCrypto accepts.
 */
function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function decodeJsonSegment(segment: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(base64UrlToBytes(segment)));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

type JsonWebKey = Record<string, unknown>;

/**
 * Parses the platform-injected key set.
 *
 * Returns `null` — meaning "this function cannot verify anything" — for an absent, unparseable or
 * key-less value, which is the legacy-HS256 case described in the file note.
 */
export function parseKeySet(raw: string | null | undefined): readonly JsonWebKey[] | null {
  if (raw === undefined || raw === null || raw.trim() === '') {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  /**
   * The array case is tested **first**, and that ordering is load-bearing rather than stylistic.
   *
   * `Array.prototype.keys` exists, so reading `.keys` off a bare array yields the iterator *function* — which is
   * not nullish, so a `?? (Array.isArray(parsed) ? parsed : undefined)` fallback never runs and every bare array
   * resolves to `null`. That would have made the verifier silently fail closed for a legitimate key set shape.
   */
  const keys = Array.isArray(parsed) ? parsed : (parsed as { keys?: unknown }).keys;
  if (!Array.isArray(keys)) {
    return null;
  }
  const usable = keys.filter(
    (key): key is JsonWebKey => typeof key === 'object' && key !== null && !Array.isArray(key),
  );
  return usable.length === 0 ? null : usable;
}

/**
 * Selects the key that may verify this token, and refuses to guess.
 *
 * Three rules, each of which closes a real hole:
 *
 *   • A `kid` in the header must match a `kid` in the key set. Key rotation is the documented reason the
 *     discovery endpoint exists — "allowing you to rotate and revoke keys without needing to deploy new
 *     versions" — so a `kid` that matches nothing means the token was signed by a key this project no
 *     longer trusts. Trying the other keys anyway would defeat revocation.
 *   • The key's own `alg`, when present, must equal the header's. A key published for RS256 must not be
 *     pressed into service for something else.
 *   • The key type must match the algorithm — RSA for RS256, EC on P-256 for ES256. Together with HS256's
 *     absence, this is what makes algorithm confusion unexpressible rather than merely unlikely.
 */
function selectKey(
  keys: readonly JsonWebKey[],
  algorithm: SupportedAlgorithm,
  kid: unknown,
): JsonWebKey | null {
  const expectedType = algorithm === 'RS256' ? 'RSA' : 'EC';
  const candidates = keys.filter((key) => {
    if (key.use !== undefined && key.use !== 'sig') {
      return false;
    }
    if (key.alg !== undefined && key.alg !== algorithm) {
      return false;
    }
    if (key.kty !== expectedType) {
      return false;
    }
    if (expectedType === 'EC' && key.crv !== 'P-256') {
      return false;
    }
    return true;
  });

  if (typeof kid === 'string') {
    return candidates.find((key) => key.kid === kid) ?? null;
  }
  // No `kid`. Acceptable only when the choice is unambiguous; picking one of several would be picking
  // one at random and calling the result verified.
  return candidates.length === 1 ? (candidates[0] ?? null) : null;
}

function importParams(algorithm: SupportedAlgorithm): RsaHashedImportParams | EcKeyImportParams {
  return algorithm === 'RS256'
    ? { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }
    : { name: 'ECDSA', namedCurve: 'P-256' };
}

function verifyParams(algorithm: SupportedAlgorithm): AlgorithmIdentifier | EcdsaParams {
  return algorithm === 'RS256' ? { name: 'RSASSA-PKCS1-v1_5' } : { name: 'ECDSA', hash: 'SHA-256' };
}

export type JwtVerifierConfig = {
  /** The raw `SUPABASE_JWKS` value the platform injects. */
  readonly keySet: string | null | undefined;
  readonly claims: ClaimsPolicy;
  /** Seconds since the epoch. Injected so the verifier shares the handler's clock. */
  readonly nowSeconds: () => number;
};

/**
 * Builds the production verifier.
 *
 * Logs nothing, ever. §H.3 forbids logging the `Authorization` header, the bearer token, or "any
 * fragment or prefix of either", and the surest way to honour that in the one module that holds the
 * token is to have no logging statement in it at all — which `tests/source-scan_test.ts` asserts.
 */
export function createJwtClaimsVerifier(config: JwtVerifierConfig): ClaimsVerifier {
  const keys = parseKeySet(config.keySet);

  return {
    verify: async (authorizationHeader: string | null): Promise<AuthOutcome> => {
      if (authorizationHeader === null || authorizationHeader.trim() === '') {
        return { ok: false, reason: 'missing' };
      }

      const token = extractBearerToken(authorizationHeader);
      if (token === null) {
        return { ok: false, reason: 'malformed' };
      }

      /**
       * No usable key material. Answered before anything about the token is considered, so the outcome
       * cannot depend on caller input: this is a statement about the server, and it maps to `503`.
       */
      if (keys === null) {
        return { ok: false, reason: 'verifier-unavailable' };
      }

      const [headerSegment, payloadSegment, signatureSegment] = token.split('.');
      if (
        headerSegment === undefined ||
        payloadSegment === undefined ||
        signatureSegment === undefined
      ) {
        return { ok: false, reason: 'malformed' };
      }

      const header = decodeJsonSegment(headerSegment);
      if (header === null) {
        return { ok: false, reason: 'malformed' };
      }
      if (header.typ !== undefined && header.typ !== 'JWT') {
        return { ok: false, reason: 'malformed' };
      }
      /**
       * `alg: "none"` and every unsupported algorithm land here as a signature failure rather than as
       * `verifier-unavailable`, because reaching this line means the key set *does* hold usable keys —
       * so the project signs asymmetrically and a token claiming otherwise is simply not verifiable.
       */
      if (!isSupportedAlgorithm(header.alg)) {
        return { ok: false, reason: 'signature' };
      }

      const key = selectKey(keys, header.alg, header.kid);
      if (key === null) {
        return { ok: false, reason: 'signature' };
      }

      let verified: boolean;
      try {
        const cryptoKey = await crypto.subtle.importKey(
          'jwk',
          key,
          importParams(header.alg),
          false,
          ['verify'],
        );
        /**
         * The signature segment is passed through **as decoded**, with no re-framing, and for ES256 that
         * is load-bearing rather than incidental.
         *
         * RFC 7518 §3.4 defines the ES256 JWS signature as R and S "in big-endian order, with each array
         * being be 32 octets long", concatenated, giving a "64-octet sequence". WebCrypto's ECDSA uses
         * that same fixed-width pair. The other ECDSA encoding in common use — the DER `SEQUENCE` of two
         * `INTEGER`s that OpenSSL and X.509 tooling emit — is variable-length and **not** interchangeable
         * with it. Converting between them here, in either direction, would reject every genuine token.
         *
         * `tests/jwt-verifier_test.ts` establishes this against the runtime rather than assuming it: every
         * signature it produces is exactly 64 octets across many distinct messages including ones DER
         * would have had to pad, a DER re-encoding of an accepted signature is refused, and swapping the
         * halves is refused.
         */
        verified = await crypto.subtle.verify(
          verifyParams(header.alg),
          cryptoKey,
          base64UrlToBytes(signatureSegment),
          new TextEncoder().encode(`${headerSegment}.${payloadSegment}`),
        );
      } catch {
        // A malformed key, a malformed signature, or an unusable curve. No detail is captured: it would
        // be detail about a credential.
        return { ok: false, reason: 'signature' };
      }
      if (!verified) {
        return { ok: false, reason: 'signature' };
      }

      const payload = decodeJsonSegment(payloadSegment);
      if (payload === null) {
        return { ok: false, reason: 'malformed' };
      }

      // Only now, with the signature proven, are the claims worth reading (§D.2).
      return checkClaims(payload, config.claims, config.nowSeconds());
    },
  };
}
