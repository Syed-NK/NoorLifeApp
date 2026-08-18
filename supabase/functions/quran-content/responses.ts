import {
  ALLOWED_METHODS,
  CONTRACT_VERSION,
  ERROR_MESSAGES,
  ERROR_STATUS,
  type ErrorCode,
  type ErrorResponseBody,
  MAX_CACHE_AGE_MS,
  OPERATION_CACHE_MAX_AGE_MS,
  type QuranOperation,
  type QuranPayload,
  type SuccessResponseBody,
} from './contract.ts';

/**
 * The only place this function constructs a `Response`.
 *
 * Centralised because the rule it enforces is absolute and easiest to break one call site at a time:
 * a Quran Foundation error body, status line, header or message is never forwarded, wrapped, embedded
 * or appended. Every builder below takes a closed `ErrorCode` and looks the user-facing string up
 * from a constant — there is no parameter anywhere in this file that can carry an exception, a stack,
 * an upstream message, a token detail or a rejected field's value.
 *
 * Four reasons the rule is absolute rather than a preference: an upstream message can disclose
 * account, client or quota detail; vendor wording changes without notice and would break clients that
 * parsed it; a raw upstream error is meaningless to a user who never chose the vendor; and a body
 * this function did not author is a body nobody reviewed before it reached a screen.
 */

/** `quran_req_<uuid v4>`. Applied here, once, so no `RequestIdSource` has to remember the format. */
export function formatRequestId(uuid: string): string {
  return `quran_req_${uuid}`;
}

/**
 * The headers every response carries.
 *
 * `Cache-Control: no-store` on the **HTTP** response even though the payload declares its own
 * `cache_max_age_ms`, and the two are not in conflict. The response travels over an authenticated,
 * per-user channel, so an intermediary caching it would serve one user's authorized response to
 * somebody who may not be signed in at all; the payload's age is an instruction to the *client's own*
 * store, which sits behind that authentication and is bound by the developer terms directly.
 *
 * The CORS headers are permissive on origin and narrow on everything else, matching the app's other
 * function. The caller is a React Native app, which sends no `Origin`; authorization here is a bearer
 * token checked by the gateway and re-checked by the handler, not an origin, and the request body's
 * field set is closed, so there is no ambient credential and no form-encoded surface to abuse.
 */
const BASE_HEADERS: Readonly<Record<string, string>> = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, apikey, content-type',
  'access-control-allow-methods': ALLOWED_METHODS,
};

function json(body: unknown, status: number, extraHeaders?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...BASE_HEADERS, ...extraHeaders },
  });
}

/** The CORS preflight, answered without authentication — a preflight carries no `Authorization`. */
export function preflightResponse(): Response {
  return new Response(null, {
    status: 204,
    headers: { ...BASE_HEADERS, 'access-control-max-age': '86400' },
  });
}

/**
 * The cache age this operation's response may declare, clamped to the licence ceiling.
 *
 * ── Why it is clamped here rather than trusted from the table ────────────────
 * The one-week maximum is a term of the Quran Foundation developer agreement, not a tuning
 * parameter, and the failure it guards against is somebody editing a number in
 * `OPERATION_CACHE_MAX_AGE_MS` without knowing that. Clamping at the single point where the value
 * enters a response means an out-of-terms number is impossible to emit rather than merely unlikely —
 * and `tests/responses_test.ts` proves it by asking for a year and watching a week come back.
 *
 * A non-positive or non-finite value collapses to zero, which the client reads as "do not cache".
 * Failing toward re-fetching is the safe direction: the cost is a request, and the alternative cost
 * is a stale copy nobody can correct.
 */
export function cacheMaxAgeFor(operation: QuranOperation): number {
  const declared = OPERATION_CACHE_MAX_AGE_MS[operation];
  if (!Number.isFinite(declared) || declared <= 0) {
    return 0;
  }
  return Math.min(declared, MAX_CACHE_AGE_MS);
}

export function successResponse(
  requestId: string,
  operation: QuranOperation,
  data: QuranPayload,
): { readonly response: Response; readonly body: SuccessResponseBody } {
  const body: SuccessResponseBody = {
    contract_version: CONTRACT_VERSION,
    request_id: requestId,
    outcome: 'ok',
    data,
    cache_max_age_ms: cacheMaxAgeFor(operation),
  };
  return { response: json(body, 200), body };
}

export type ErrorDetail = {
  /** Permitted only for the `invalid_request` family, and a name only. */
  readonly field?: string;
  /** Permitted for `rate_limited`, when the upstream supplied a usable hint. */
  readonly retryAfterSeconds?: number;
};

/**
 * A handler error in NoorLife's stable schema.
 *
 * Only errors raised **after the handler starts** come through here. The other producer — the Edge
 * gateway with `verify_jwt = true` — answers before this function exists, in Supabase's platform
 * shape and with no NoorLife `request_id`. The client must not treat a missing `request_id` as a
 * malformed response, and must not fabricate one; it maps that case on HTTP status alone.
 *
 * The `Retry-After` **header** is set alongside the body field because a client that respects HTTP
 * semantics and a client that reads NoorLife's schema should not have to be the same client.
 */
export function errorResponse(
  requestId: string,
  code: ErrorCode,
  detail: ErrorDetail = {},
): { readonly response: Response; readonly body: ErrorResponseBody; readonly status: number } {
  const status = ERROR_STATUS[code];
  const body: ErrorResponseBody = {
    contract_version: CONTRACT_VERSION,
    request_id: requestId,
    error: {
      code,
      message: ERROR_MESSAGES[code],
      ...(detail.field === undefined ? {} : { field: detail.field }),
      ...(detail.retryAfterSeconds === undefined
        ? {}
        : { retry_after_seconds: detail.retryAfterSeconds }),
    },
  };

  const headers: Record<string, string> = {};
  if (detail.retryAfterSeconds !== undefined) {
    headers['retry-after'] = String(detail.retryAfterSeconds);
  }
  if (code === 'method_not_allowed') {
    headers.allow = ALLOWED_METHODS;
  }

  return { response: json(body, status, headers), body, status };
}
