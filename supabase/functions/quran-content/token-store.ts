import type { Clock, TokenOutcome, TokenSource } from './ports.ts';

/**
 * The OAuth2 client-credentials token store — one of the two modules that may reach the vendor.
 *
 * ── The flow, as the official quickstart documents it ────────────────────────
 * Read from `https://api-docs.quran.foundation/docs/quickstart/` on 2026-08-10:
 *
 *     POST https://oauth2.quran.foundation/oauth2/token
 *     Authorization: Basic base64(client_id ":" client_secret)
 *     Content-Type: application/x-www-form-urlencoded
 *
 *     grant_type=client_credentials&scope=content
 *
 * The response carries `access_token` and `expires_in` (documented as 3600). **There is no refresh
 * token** — the quickstart says so explicitly, and this module has no code path that would use one.
 * "Renewing" means exchanging again with the same credentials, which is what `forceRenew` does.
 *
 * ── What this module holds, and where it may write it ────────────────────────
 * The client secret exists in exactly one closure variable and is written to exactly one place: the
 * `Authorization` header of the token request. It is never in a URL, never in a body field, never in
 * a thrown message, never in a returned value and never in anything this module could log — there is
 * no logger here at all, and `tests/source-scan_test.ts` asserts the absence of `console` and of any
 * second interpolation site.
 *
 * The client id is treated with the same care even though it travels as a plain header on every
 * content request. It is half of a Basic credential, and a value that is half a credential is not a
 * value to put in a log line.
 *
 * ── `redirect: 'error'` ──────────────────────────────────────────────────────
 * A redirect is a transport failure here, not a second request. Following one would replay the Basic
 * `Authorization` header — and therefore the client secret — to whatever host the redirect named.
 */

/**
 * The fixed production origin. Not configurable, by construction.
 *
 * There is deliberately no environment variable, no config field and no parameter that can change it.
 * Anything able to set an environment variable on this function could otherwise redirect a request
 * carrying the client secret to a host of its choosing, and the strongest defence against a value
 * being wrong is to have no value to get wrong. The pre-production host is not named anywhere in this
 * repository: production access is what was approved, and a second reachable origin is a second thing
 * a deployment can be pointed at by mistake.
 */
export const QF_OAUTH_ORIGIN = 'https://oauth2.quran.foundation';

/** The only route this module calls. */
export const QF_TOKEN_PATH = '/oauth2/token';

/** The approved scope, and the only one. `user` and the search scopes are not approved. */
export const QF_SCOPE = 'content';

/**
 * The token response body cap.
 *
 * A token response is a few hundred bytes. An unbounded read is a memory risk against Supabase's
 * function limit, and the failure it guards against is not a hostile authorization server but a wrong
 * one: a proxy returning an HTML error page, or a stream that does not terminate.
 */
export const MAX_TOKEN_RESPONSE_BYTES = 16_384;

/**
 * The longest token lifetime this store will honour.
 *
 * `expires_in` is a number from a third party that decides how long NoorLife reuses a credential. The
 * documented value is 3600; anything beyond a day is either a mistake or a value nobody intended, and
 * treating it as authoritative would mean caching a credential far past the point where a revocation
 * upstream should have taken effect. Above the cap the lifetime is clamped, not rejected — a shorter
 * cache is always safe.
 */
export const MAX_TOKEN_LIFETIME_MS = 24 * 60 * 60 * 1000;

/**
 * How far before the reported expiry a cached token stops being served.
 *
 * The quickstart's instruction is to "cache tokens and re-request them shortly before expiry", and
 * the reason to obey it precisely is the request in flight when the clock crosses over: a token that
 * is valid when the header is written and expired when the vendor reads it produces a `401` that
 * looks like a credential problem and is not.
 *
 * Sixty seconds, or half the lifetime when the lifetime is short — the `min` is what stops a
 * hypothetical 30-second token from being treated as already expired on arrival, which would make
 * every request exchange a new one and never use it.
 */
export const TOKEN_RENEWAL_SKEW_MS = 60_000;

/**
 * A token value that may be written into a header.
 *
 * ── Why the charset check is the important half ──────────────────────────────
 * The access token is copied into the `x-auth-token` request header. A value containing CR, LF or a
 * NUL is a header-injection primitive, and the source of this value is a third-party HTTP response —
 * exactly the kind of input that must not be trusted to be well-formed just because it usually is.
 * Restricting to visible ASCII refuses that whole class before the value reaches a header, and every
 * token format in use here (opaque or JWT) is comfortably inside it.
 */
const TOKEN_VALUE = /^[\x21-\x7e]{8,4096}$/;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/**
 * Base64 of the UTF-8 bytes, for the Basic credential.
 *
 * `btoa` operates on Latin-1 code units and throws on anything above U+00FF, so encoding to UTF-8
 * first is what makes this correct for a credential containing a non-ASCII character rather than
 * merely correct for the credentials we expect. A throw here would be a throw from the one function
 * holding the secret, which is precisely where an exception message must never come from.
 */
function basicCredential(clientId: string, clientSecret: string): string {
  const bytes = new TextEncoder().encode(`${clientId}:${clientSecret}`);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

/** Reads at most `MAX_TOKEN_RESPONSE_BYTES`, then stops. `null` means "no usable body". */
async function readBoundedText(response: Response): Promise<string | null> {
  const declared = response.headers.get('content-length');
  if (
    declared !== null && /^[0-9]+$/.test(declared.trim()) &&
    Number(declared) > MAX_TOKEN_RESPONSE_BYTES
  ) {
    await cancelBody(response);
    return null;
  }
  const body = response.body;
  if (body === null) {
    return '';
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      total += value.byteLength;
      if (total > MAX_TOKEN_RESPONSE_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

/** Releases a body this module will not read. A failed token response is never inspected. */
async function cancelBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Already consumed or already errored. Nothing to release and nothing to report.
  }
}

export type TokenStoreConfig = {
  /** `QF_CLIENT_ID`, read from the environment by the entry point and handed here. */
  readonly clientId: string | undefined;
  /** `QF_CLIENT_SECRET`. Read once, used in one header, never logged, returned or embedded. */
  readonly clientSecret: string | undefined;
  /** The wall clock for one exchange. Independent of the caller's budget — see `get` below. */
  readonly timeoutMs: number;
  readonly clock: Clock;
  /** Injected so a test can drive the exchange without a network. Defaults to global `fetch`. */
  readonly fetchImpl?: typeof fetch;
};

/**
 * A token source that can only report that there is no token.
 *
 * Returned when either secret is absent, and returned **before any transport is constructed** — so a
 * deployment with no credentials makes zero outbound requests rather than one that fails. This is the
 * fail-closed path the whole integration depends on: there is no branch anywhere in this function
 * that serves scripture without a token, and none that substitutes another source.
 */
export const unavailableTokenSource: TokenSource = {
  // deno-lint-ignore require-await
  get: async () => ({ kind: 'unavailable' }),
};

export function createTokenStore(config: TokenStoreConfig): TokenSource {
  const clientId = config.clientId ?? '';
  const clientSecret = config.clientSecret ?? '';
  if (clientId === '' || clientSecret === '') {
    return unavailableTokenSource;
  }

  const call = config.fetchImpl ?? fetch;
  const endpoint = `${QF_OAUTH_ORIGIN}${QF_TOKEN_PATH}`;
  const credential = basicCredential(clientId, clientSecret);
  const body = `grant_type=client_credentials&scope=${QF_SCOPE}`;

  let cached: { readonly accessToken: string; readonly expiresAtMs: number } | null = null;
  /**
   * The single-flight slot.
   *
   * An Edge Function isolate serves requests concurrently, so without this a burst of ten requests
   * arriving on a cold isolate would perform ten identical token exchanges — ten times the vendor
   * load, and nine tokens immediately discarded. Sharing one in-flight exchange makes the burst cost
   * one, and because the shared promise resolves to a value rather than mutating shared state, a
   * caller that gives up does not affect the others.
   */
  let inFlight: Promise<TokenOutcome> | null = null;

  const exchange = async (): Promise<TokenOutcome> => {
    /**
     * Its own controller, deliberately not the caller's signal.
     *
     * The exchange is shared, so binding it to one caller's signal would let that caller's abort
     * cancel a token every concurrent request is waiting on. It is still bounded — this timeout is
     * the bound — so nothing can hang here.
     */
    const controller = new AbortController();
    const handle = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      const response = await call(endpoint, {
        method: 'POST',
        headers: {
          // The one place the credential is written. Not the URL, not the body, not a message.
          'authorization': `Basic ${credential}`,
          'content-type': 'application/x-www-form-urlencoded',
          'accept': 'application/json',
        },
        body,
        signal: controller.signal,
        redirect: 'error',
      });

      if (response.status !== 200) {
        /**
         * The body is not read, and the status is used for exactly one decision before being dropped.
         *
         * An OAuth2 error body carries `error` and `error_description`, and a description from an
         * authorization server can name the client, the scope or the reason a credential was
         * rejected. None of that may cross this boundary, and the surest way to honour that is never
         * to hold it.
         *
         * What the status *does* decide is which of the two closed outcomes this is. RFC 6749 answers
         * `invalid_client` with `401` and an unauthorised grant or scope with `400`, so those two —
         * and `403` — mean the credential itself was refused, which an operator must be paged about.
         * Everything else is a `5xx` or an unrecognised status: a server having a bad minute, which
         * needs nobody woken. Neither branch retains the number.
         */
        const refused = response.status === 400 || response.status === 401 ||
          response.status === 403;
        await cancelBody(response);
        return refused ? { kind: 'refused' } : { kind: 'unavailable' };
      }

      const text = await readBoundedText(response);
      if (text === null || text === '') {
        return { kind: 'unavailable' };
      }

      let payload: unknown;
      try {
        payload = JSON.parse(text);
      } catch {
        return { kind: 'unavailable' };
      }
      const envelope = asRecord(payload);
      if (envelope === null) {
        return { kind: 'unavailable' };
      }

      const accessToken = envelope.access_token;
      if (typeof accessToken !== 'string' || !TOKEN_VALUE.test(accessToken)) {
        return { kind: 'unavailable' };
      }

      /**
       * `scope` is checked only when the server returns it.
       *
       * RFC 6749 makes it optional when the granted scope matches the request, so its absence is
       * normal and must not be read as a refusal. When it *is* present and does not include
       * `content`, the token cannot serve this function's only purpose, and using it anyway would
       * turn a clear configuration answer into a stream of upstream `403`s.
       */
      const scope = envelope.scope;
      if (typeof scope === 'string' && !scope.split(/\s+/).includes(QF_SCOPE)) {
        return { kind: 'unavailable' };
      }

      /**
       * `token_type` is deliberately not checked.
       *
       * The vendor's content endpoints take the token in `x-auth-token`, not in an `Authorization:
       * Bearer` header, so the type does not select a presentation this module could get wrong.
       * Asserting a value the flow does not use would be a check that can only produce false
       * failures.
       */

      const expiresIn = envelope.expires_in;
      if (typeof expiresIn !== 'number' || !Number.isFinite(expiresIn) || expiresIn <= 0) {
        /**
         * No usable lifetime. The token is discarded rather than cached with a guessed expiry: a
         * lifetime this function invented would be a lifetime nobody agreed to, and the failure mode
         * of guessing too long is a credential reused after it should have been renewed.
         */
        return { kind: 'unavailable' };
      }

      const lifetimeMs = Math.min(Math.floor(expiresIn * 1000), MAX_TOKEN_LIFETIME_MS);
      const skewMs = Math.min(TOKEN_RENEWAL_SKEW_MS, Math.floor(lifetimeMs / 2));
      cached = { accessToken, expiresAtMs: config.clock.now() + lifetimeMs - skewMs };
      return { kind: 'token', accessToken };
    } catch {
      /**
       * A transport failure, a refused redirect, or the exchange timeout. Nothing about the error is
       * captured: an exception raised by a request carrying a credential is an exception that can be
       * made of that request.
       */
      return { kind: 'unavailable' };
    } finally {
      clearTimeout(handle);
    }
  };

  return {
    get: async ({ forceRenew }, signal): Promise<TokenOutcome> => {
      if (signal.aborted) {
        // The caller's budget is already spent. Starting an exchange it cannot use costs the vendor
        // a request for nothing.
        return { kind: 'unavailable' };
      }

      if (forceRenew) {
        /**
         * The upstream refused the token we had, so it is dropped before anything else looks at it.
         *
         * Dropping rather than merely bypassing matters: a concurrent request that arrives a
         * millisecond later must not be handed the token that was just refused, which is exactly
         * what "use the cache unless I said otherwise" would do.
         */
        cached = null;
      } else {
        const live = cached;
        if (live !== null && config.clock.now() < live.expiresAtMs) {
          return { kind: 'token', accessToken: live.accessToken };
        }
      }

      const pending = inFlight ?? exchange().finally(() => {
        inFlight = null;
      });
      inFlight = pending;
      return await pending;
    },
  };
}
