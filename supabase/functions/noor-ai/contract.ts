/**
 * The Noor AI wire contract, as types and constants.
 *
 * Every shape here is `docs/NOOR_AI_BACKEND_CONTRACT.md` §C.4 and §I.5 transcribed into code. It is
 * a separate module from the handler on purpose: the response shapes are the thing the mobile
 * adapter (AI-4) programs against, and a shape that lives inside the function that produces it is a
 * shape nobody can review without reading control flow.
 *
 * ── Two structural guarantees are expressed as types rather than as tests ────
 * `sources` and `accessed_modules` are `readonly never[]`, which makes `[]` the only value either
 * can hold. §C.4 requires both to be empty in AI-2 — there is no retrieval layer and nothing is
 * read — and a `readonly string[]` would leave "populate it truthfully" (AI-6's job) as something a
 * later edit could do accidentally. A type that cannot hold a citation is stronger than a test that
 * checks there is not one.
 *
 * `refusal.suggested_handoff` is `null` for the same reason: §C.4 reserves it for AI-9.
 */

/** NoorLife's own contract version. Not the `/functions/v1/` platform path prefix — see §C.1. */
export const CONTRACT_VERSION = 1;

/** §C.1. `OPTIONS` is answered for CORS preflight; everything else is `405`. */
export const ALLOWED_METHODS = 'POST, OPTIONS';

/** §C.3.1. Enforced against `Content-Length` and again while reading, so a lying header is caught. */
export const MAX_BODY_BYTES = 8192;

/** §C.3.6. Unicode code points after trimming, so an Arabic question is not penalised. */
export const MAX_MESSAGE_CODE_POINTS = 1000;

/** §C.2. The whole schema. Any other property is rejected by name (§C.6). */
export const ACCEPTED_REQUEST_FIELDS = [
  'contract_version',
  'message',
  'surface',
  'locale',
] as const;

/**
 * The three policy refusal kinds.
 *
 * `AIRefusal` in `src/services/ai/ai-orchestrator.contract.ts` has a fourth, `unavailable`. It is
 * deliberately absent here: §C.4 records that an unavailable service is an *error* in this contract,
 * not a refusal, and §12.1 records that collapsing the two is the client-side shape gap AI-4 must
 * fix rather than something the wire format should imitate.
 */
export type RefusalKind = 'out-of-scope' | 'safety-boundary' | 'permission-required';

/** §C.4. `length` means the model hit `max_output_tokens` and the client must say so. */
export type FinishReason = 'complete' | 'length';

/** §I.5's closed set. The client programs against this and only against this (§I.6). */
export type ErrorCode =
  | 'invalid_request'
  | 'unsupported_contract_version'
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'method_not_allowed'
  | 'unsupported_media_type'
  | 'payload_too_large'
  | 'rate_limited'
  | 'timeout'
  | 'upstream_unavailable'
  | 'service_unavailable'
  | 'internal_error';

/** An empty tuple type. See the file note: it makes a non-empty `sources` unexpressible. */
export type AlwaysEmpty = readonly never[];

export type AnswerResponseBody = {
  readonly contract_version: typeof CONTRACT_VERSION;
  readonly request_id: string;
  readonly outcome: 'answer';
  readonly answer: {
    readonly text: string;
    readonly sources: AlwaysEmpty;
    readonly accessed_modules: AlwaysEmpty;
  };
  readonly finish: FinishReason;
};

export type RefusalResponseBody = {
  readonly contract_version: typeof CONTRACT_VERSION;
  readonly request_id: string;
  readonly outcome: 'refused';
  readonly refusal: {
    readonly kind: RefusalKind;
    readonly explanation: string;
    readonly suggested_handoff: null;
  };
};

export type ErrorResponseBody = {
  readonly contract_version: typeof CONTRACT_VERSION;
  readonly request_id: string;
  readonly error: {
    readonly code: ErrorCode;
    readonly message: string;
    /** §I.5: present only for `invalid_request`, and a field **name** only — never a value. */
    readonly field?: string;
    /** §I.5: `rate_limited`, and `service_unavailable` when a retry hint is available. */
    readonly retry_after_seconds?: number;
  };
};

export type NoorAIResponseBody = AnswerResponseBody | RefusalResponseBody | ErrorResponseBody;

/**
 * The HTTP status each error code answers with (§I.5).
 *
 * A table rather than a `switch` so the mapping is one readable fact and cannot diverge between two
 * call sites. `504` for `timeout` is deliberately distinct from `502` for `upstream_unavailable`:
 * §I.4 — "we waited and gave up" and "the provider failed" need different operational responses.
 */
export const ERROR_STATUS: Readonly<Record<ErrorCode, number>> = {
  invalid_request: 400,
  unsupported_contract_version: 400,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  method_not_allowed: 405,
  unsupported_media_type: 415,
  payload_too_large: 413,
  rate_limited: 429,
  timeout: 504,
  upstream_unavailable: 502,
  service_unavailable: 503,
  internal_error: 500,
};

/**
 * The user-facing copy for each error code.
 *
 * §I.5 states these strings are "illustrative of register and length" and that the final copy needs
 * the same product review as any other user-facing string; that review is still open, and is
 * recorded in the AI-2 report rather than silently settled here.
 *
 * What is **not** provisional is the rule they exist to enforce: none of them contains a provider
 * message, a platform `code`/`message` pair, a status line, a header, a stack trace or a field
 * value. §I.6 forbids forwarding any of those, and the only way to guarantee it is for the
 * client-facing text to be a constant chosen by NoorLife before the failure happened.
 */
export const ERROR_MESSAGES: Readonly<Record<ErrorCode, string>> = {
  invalid_request: 'Noor AI could not read that request. Please try again.',
  unsupported_contract_version: 'This version of NoorLife is out of date. Please update the app.',
  unauthenticated: 'Please sign in again to continue.',
  forbidden: 'Noor AI is not available for this account.',
  not_found: 'Noor AI could not find that.',
  method_not_allowed: 'Noor AI could not read that request. Please try again.',
  unsupported_media_type: 'Noor AI could not read that request. Please try again.',
  payload_too_large: 'That question is too long. Please shorten it and try again.',
  rate_limited: "You've asked a few questions very quickly. Try again in a moment.",
  timeout: 'Noor AI took too long to answer. Please try again.',
  upstream_unavailable: 'Noor AI is having trouble right now. Please try again.',
  service_unavailable: 'Noor AI is unavailable right now. Please try again later.',
  internal_error: 'Something went wrong. Please try again.',
};
