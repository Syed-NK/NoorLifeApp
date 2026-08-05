import {
  ALLOWED_METHODS,
  type AnswerResponseBody,
  CONTRACT_VERSION,
  ERROR_MESSAGES,
  ERROR_STATUS,
  type ErrorCode,
  type ErrorResponseBody,
  type FinishReason,
  type RefusalResponseBody,
} from './contract.ts';
import type { PolicyRefusal } from './policy.ts';
import { refusalExplanation } from './policy.ts';

/**
 * The only place this function constructs a `Response`.
 *
 * Centralised because §I.6's rule is absolute and easiest to break one call site at a time: "Provider
 * error bodies, status lines, headers, and messages are never forwarded, wrapped, embedded, or
 * appended", and the same now applies to platform errors. Every builder below takes a closed
 * `ErrorCode` and looks the user-facing string up from a constant — there is no parameter anywhere in
 * this file that can carry an exception, a stack, a provider message, a JWT detail, a key detail, a
 * model detail or a rejected field's value.
 *
 * §I.5's four reasons, kept because the second is the one people forget: a provider message can
 * disclose account, organization, project, quota or model details; a provider message is
 * attacker-reachable output and can be steered; provider wording changes without notice and would
 * break clients that parsed it; and a raw upstream error is meaningless to a user who never chose the
 * provider.
 */

/**
 * §I.7 — `noorai_req_<uuid v4>`.
 *
 * The prefix is applied here, once, so no implementation of `RequestIdSource` has to remember the
 * format. The id "is random, not derived from the user, the message, or the time".
 */
export function formatRequestId(uuid: string): string {
  return `noorai_req_${uuid}`;
}

/**
 * The headers every response carries.
 *
 * `Cache-Control: no-store` because an answer is per-user content produced from a per-user question,
 * and an intermediary caching one would serve it to somebody else.
 *
 * The CORS headers are permissive on origin and narrow on everything else. The caller is a React
 * Native app, which sends no `Origin` at all, and `react-native-web` would send one that varies per
 * developer. Narrowing to a list would therefore break the web target while protecting nothing this
 * endpoint depends on: authorization here is a bearer token checked by the gateway and re-checked by
 * the handler (§D), not an origin — and §C.6 makes the body's field set closed, so there is no
 * cookie, no ambient credential and no form-encoded surface for a hostile page to abuse.
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

/**
 * §C.1 — the CORS preflight, which "requires no authentication (a preflight carries no
 * `Authorization` header by definition)".
 *
 * `204` with no body: there is nothing to say, and a body on a preflight is a body a browser ignores.
 */
export function preflightResponse(): Response {
  return new Response(null, {
    status: 204,
    headers: { ...BASE_HEADERS, 'access-control-max-age': '86400' },
  });
}

export function answerResponse(
  requestId: string,
  text: string,
  finish: FinishReason,
): { readonly response: Response; readonly body: AnswerResponseBody } {
  const body: AnswerResponseBody = {
    contract_version: CONTRACT_VERSION,
    request_id: requestId,
    outcome: 'answer',
    answer: {
      text,
      /**
       * §C.4 — always `[]` in AI-2. `sources` because there is no retrieval layer;
       * `accessed_modules` because nothing was read. Both are present rather than omitted because
       * `AIAnswer.sources` is required in the client contract and "a field that appears later is a
       * client change".
       */
      sources: [],
      accessed_modules: [],
    },
    finish,
  };
  return { response: json(body, 200), body };
}

/**
 * §C.4 — a refusal is a **successful** request.
 *
 * "HTTP `200` with `"outcome": "refused"` is the response to 'the policy said no', because that is an
 * answer the product intends to give, not a failure." This mirrors `AIResult`, which already models
 * `answer | refused` as two outcomes of one successful call.
 */
export function refusalResponse(
  requestId: string,
  refusal: PolicyRefusal,
): { readonly response: Response; readonly body: RefusalResponseBody } {
  const body: RefusalResponseBody = {
    contract_version: CONTRACT_VERSION,
    request_id: requestId,
    outcome: 'refused',
    refusal: {
      kind: refusal.kind,
      explanation: refusalExplanation(refusal),
      /** §C.4 — `null` in AI-2, reserved for the `'noor-ai'` hand-off value AI-9 will use. */
      suggested_handoff: null,
    },
  };
  return { response: json(body, 200), body };
}

export type ErrorDetail = {
  /** §I.5 — permitted only for `invalid_request`, and a name only. */
  readonly field?: string;
  /** §I.5 — permitted for `rate_limited`, and for `service_unavailable` when a hint exists. */
  readonly retryAfterSeconds?: number;
};

/**
 * A handler error in NoorLife's stable schema (§I.5).
 *
 * Only errors raised **after the handler starts** come through here. §C.9's other producer — the Edge
 * gateway with `verify_jwt = true` — answers before this function exists, in Supabase's platform shape
 * and with no NoorLife `request_id`, and §I.7 is explicit that AI-4 "must not treat a missing
 * `request_id` as a malformed response, and must not fabricate one client-side".
 *
 * The `Retry-After` **header** is set alongside the body field because §I.1 requires both, and because
 * a client that respects HTTP semantics and a client that reads NoorLife's schema should not need to be
 * the same client.
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
