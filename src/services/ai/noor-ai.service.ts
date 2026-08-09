import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import type { AIRequestContext } from '@shared/permissions/ai-scope';

import {
  NOOR_AI_CLIENT_TIMEOUT_MS,
  NOOR_AI_CONTRACT_VERSION,
  NOOR_AI_FUNCTION_NAME,
  NOOR_AI_MAX_ANSWER_CODE_POINTS,
  NOOR_AI_MAX_BODY_BYTES,
  NOOR_AI_MAX_EXPLANATION_CODE_POINTS,
  NOOR_AI_MAX_MESSAGE_CODE_POINTS,
  NOOR_AI_SURFACE_ALLOW_LIST,
  type NoorAIAnswer,
  type NoorAIAskOptions,
  type NoorAIFailureState,
  type NoorAIFinishReason,
  type NoorAIPort,
  type NoorAIRefusal,
  type NoorAIRefusalKind,
  type NoorAIRequestBody,
  type NoorAIResult,
} from './noor-ai.contract';

/**
 * The Noor AI mobile adapter.
 *
 * ── What this owns ───────────────────────────────────────────────────────────
 * Exactly one thing: turning a question into at most one authenticated invocation of the `noor-ai`
 * Edge Function, and turning whatever comes back — an answer, a policy refusal, NoorLife's error
 * envelope, Supabase's platform error, or nothing at all — into one of the small closed set of
 * states in `noor-ai.contract.ts`. It builds no UI, holds no conversation, persists nothing, and
 * reads no module data.
 *
 * ── Presentation never sees the client, and never sees a response ───────────
 * The Supabase client is imported here and nowhere near a screen, which is the same boundary
 * `account-security.service.ts` keeps. Stronger than that: no Supabase object — not the client, not
 * the session, not the `FunctionsResponse`, not a `FunctionsHttpError` and not the `Response` it
 * carries — is reachable from a returned value. `NoorAIResult` is constructed field by field from
 * validated primitives, so there is no reference for a screen to follow.
 *
 * ── What is never logged ────────────────────────────────────────────────────
 * This module contains no logging at all, which is the choice `account-security.service.ts` made
 * for the same reason. §H.3 forbids logging content, and a prompt, an answer, an access token and a
 * platform error body are each enough to matter on its own. There is no safe mobile structured-log
 * convention in this repository to opt into, and inventing one to carry AI metadata would be a new
 * disclosure surface introduced by the phase that was told not to add telemetry. The classification
 * is returned to the caller, not printed. A source scan asserts the absence.
 *
 * ── One invocation, and no automatic retry ──────────────────────────────────
 * See `NOOR_AI_ONE_INVOCATION_INVARIANT`. §I.1's quota store mints a fresh request id per handler
 * execution, so a retried question is a second reservation, a second provider attempt and a second
 * charge. Every failure path below returns; none loops, and none calls `invoke` a second time.
 * There is exactly one `invoke` call site in this file and a test counts it.
 */

/** The `FunctionsResponse` fields this adapter reads. Deliberately not the SDK's own type. */
type InvocationOutcome = {
  readonly data: unknown;
  readonly error: unknown;
};

/**
 * The narrow view of `supabase.functions` this adapter needs.
 *
 * Declared structurally so the seam a test replaces is the seam production uses, rather than a
 * parallel one. Nothing here widens what the SDK offers.
 */
type FunctionInvoker = {
  invoke(
    functionName: string,
    options: {
      readonly body: NoorAIRequestBody;
      readonly headers: Readonly<Record<string, string>>;
      readonly timeout: number;
      readonly signal?: AbortSignal;
    },
  ): Promise<InvocationOutcome>;
};

/**
 * The characters trimmed from both ends of a question, mirroring §C.3.4.
 *
 * Unicode whitespace via `\s` with the `u` flag, plus the two families `\s` does not cover: the
 * zero-width characters, which would let a "non-empty" message be composed entirely of invisible
 * ones, and the bidirectional controls, which reorder how a string displays without changing what
 * it contains. This app is RTL-capable, so both are plausible input rather than exotic ones.
 *
 * The server trims again and independently. This copy exists so a question that is empty in
 * substance is refused without spending an invocation, not to relieve the server of the check.
 */
const TRIMMABLE = '\\s\\u200b-\\u200f\\u202a-\\u202e\\u2060\\u2066-\\u2069\\ufeff';
const LEADING_TRIM = new RegExp(`^[${TRIMMABLE}]+`, 'u');
const TRAILING_TRIM = new RegExp(`[${TRIMMABLE}]+$`, 'u');

/** Tab, line feed and carriage return — the three §C.3.7 permits. */
const PERMITTED_CONTROLS = new Set([0x09, 0x0a, 0x0d]);

function trimMessage(value: string): string {
  return value.replace(LEADING_TRIM, '').replace(TRAILING_TRIM, '');
}

/** §C.3.6 — code points, not UTF-16 units and not bytes. */
function countCodePoints(value: string): number {
  return [...value].length;
}

/**
 * Whether the string holds a C0 or C1 control character other than `\n`, `\r` or `\t` (§C.3.7).
 *
 * Written as a code-point scan rather than a character class, because a regex spelling this would
 * be a regex containing control characters — the thing `no-control-regex` exists to flag, and the
 * thing a reviewer cannot check by eye.
 */
function hasForbiddenControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (PERMITTED_CONTROLS.has(code)) {
      continue;
    }
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) {
      return true;
    }
  }
  return false;
}

/**
 * UTF-8 byte length, for §C.3.1's cap.
 *
 * Counted from the code points rather than through `Blob` or `TextEncoder`. Both exist on some of
 * the runtimes this code runs on and not all of them — Hermes, the Jest environment and the web all
 * differ — and a size check that silently depends on a host object is a size check that can be
 * absent exactly where it matters.
 */
function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
  }
  return bytes;
}

function failed(failure: NoorAIFailureState): NoorAIResult {
  return { outcome: 'failed', failure };
}

/**
 * §12.1 — the only thing derived from `AIRequestContext`, and it is derived, not forwarded.
 *
 * An unrecognised route yields `undefined` and the field is omitted, so the server applies §C.5's
 * default. Sending the raw `currentScreen` instead would put an arbitrary client string on the wire
 * for no gain: §C.5 already discards anything off its own list.
 */
function resolveSurface(currentScreen: string): string | undefined {
  return NOOR_AI_SURFACE_ALLOW_LIST.includes(currentScreen) ? currentScreen : undefined;
}

/**
 * Builds §C.2's body, or says which local rule refused it.
 *
 * ── Why the client validates at all ─────────────────────────────────────────
 * Not to relieve the server, which validates everything again against untrusted input (§B.3), but
 * because a request the server will certainly reject still costs a handler execution — and §I.1
 * mints a quota request id per execution. The four rules below are the ones whose outcome is
 * knowable without asking: empty after trimming, over the code-point limit, control characters,
 * and over the byte cap. Anything requiring server knowledge is left to the server.
 *
 * ── What this deliberately does not do ──────────────────────────────────────
 * It does not decide what the question is *about*. Every check here is structural — shape, size,
 * control characters, and an allow-listed `surface` — and none of them can tell a NoorLife help
 * question from any other kind of sentence. §E.2 already draws that line: "the client's scope
 * objects are UI policy; the server's are authorization." The server recomputes authorization,
 * applies the policy table, and answers §C.4's `refused` outcome for a question outside Noor AI's
 * subject.
 *
 * No keyword or topic filter belongs here, and adding one would make things worse rather than
 * safer: it would be trivially evaded, it would refuse legitimate questions, and it would invite a
 * reader to believe a semantic control exists on the device when it does not. What the client
 * genuinely guarantees is narrower and worth stating exactly — a §C.2-shaped body, within §C.3's
 * limits, carrying no module data of any kind.
 *
 * Truncation is never a fallback, in either direction (§C.3).
 */
type RequestDraft =
  | { readonly ok: true; readonly body: NoorAIRequestBody }
  | { readonly ok: false; readonly failure: NoorAIFailureState };

function buildRequestBody(
  prompt: string,
  context: AIRequestContext,
  options: NoorAIAskOptions | undefined,
): RequestDraft {
  if (typeof prompt !== 'string') {
    return { ok: false, failure: 'invalid-request' };
  }

  const message = trimMessage(prompt);
  if (message.length === 0) {
    // §C.3.5 — a whitespace-only question is the same case as an empty one, deliberately.
    return { ok: false, failure: 'invalid-request' };
  }
  if (countCodePoints(message) > NOOR_AI_MAX_MESSAGE_CODE_POINTS) {
    return { ok: false, failure: 'invalid-request' };
  }
  if (hasForbiddenControlCharacter(message)) {
    return { ok: false, failure: 'invalid-request' };
  }

  const surface = resolveSurface(context.currentScreen);

  /**
   * Built as an object literal with four named keys and no spread.
   *
   * `{ ...something }` would be shorter and would defeat the purpose: §C.6 rejects unknown fields
   * by name, and the failure mode it guards against is a future change widening a source object and
   * a spread quietly carrying the new field onto the wire. Naming every key means a fifth field is
   * a diff a reviewer sees. In particular nothing from `context` beyond the derived `surface`
   * appears here — not `scope`, not `permittedModules`, not `grantedModules` (§12.1).
   */
  const body: NoorAIRequestBody = {
    contract_version: NOOR_AI_CONTRACT_VERSION,
    message,
    ...(surface === undefined ? {} : { surface }),
    ...(options?.locale === undefined ? {} : { locale: options.locale }),
  };

  /**
   * §C.3.1's cap, measured on the bytes actually sent rather than on the question alone.
   *
   * Stated honestly: **no body this function can currently construct reaches it.** A message is
   * capped at 1000 code points above, and 1000 code points at UTF-8's four-byte worst case is 4000
   * bytes, which is the same arithmetic §C.3.1 used to choose 8 KiB in the first place. It is kept
   * because it is the bound the server actually enforces, and because the thing that would breach
   * it is a fifth field arriving in the body — which is exactly the change that should fail here
   * rather than at the gateway. Defence in depth, not a reachable client rule.
   */
  if (utf8ByteLength(JSON.stringify(body)) > NOOR_AI_MAX_BODY_BYTES) {
    return { ok: false, failure: 'invalid-request' };
  }

  return { ok: true, body };
}

/** A plain JSON object, narrowed. Arrays and `null` are not the object §C.4 describes. */
function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isBoundedString(value: unknown, maxCodePoints: number): value is string {
  return typeof value === 'string' && countCodePoints(value) <= maxCodePoints;
}

/** §C.4 — `sources` and `accessed_modules` are empty in AI-1, and a non-empty one is not ours. */
function isEmptyArray(value: unknown): boolean {
  return Array.isArray(value) && value.length === 0;
}

function toFinishReason(value: unknown): NoorAIFinishReason | null {
  return value === 'complete' || value === 'length' ? value : null;
}

function toRefusalKind(value: unknown): NoorAIRefusalKind | null {
  return value === 'out-of-scope' || value === 'safety-boundary' || value === 'permission-required'
    ? value
    : null;
}

/**
 * Validates a 2xx body against §C.4 and rebuilds it from validated primitives.
 *
 * ── Every field is checked by executing code ────────────────────────────────
 * A `type AnswerBody = { … }` and a cast would compile and check nothing, which is the standard way
 * a "validated" boundary ends up unvalidated. The server's `request-schema.ts` makes the same point
 * about inbound requests; a response is untrusted for the same reason, and more so here because the
 * client cannot see who generated it.
 *
 * ── Allow-list copy, not filtering ──────────────────────────────────────────
 * The returned object is constructed key by key. Nothing is spread and nothing is deleted, so a
 * field this contract does not name — a provider response id, a safety value, a token count, a
 * cost, a model name, an internal identifier, a debug bag — cannot reach a caller even if a
 * response carries it, and cannot start reaching one because somebody widened a type.
 *
 * ── Fail closed ─────────────────────────────────────────────────────────────
 * Anything that does not validate becomes `invalid-server-response`. A partially-believed response
 * means rendering unvalidated server text, which is exactly what §I.6 exists to prevent.
 *
 * `request_id` is required to be a string because §I.7 guarantees one on **every** response the
 * handler produces, and a 2xx can only come from the handler. It is validated and then dropped: it
 * is not carried onto any returned value.
 */
function parseSuccessBody(data: unknown): NoorAIResult {
  const body = asRecord(data);
  if (body === null) {
    return failed('invalid-server-response');
  }
  if (body.contract_version !== NOOR_AI_CONTRACT_VERSION) {
    return failed('invalid-server-response');
  }
  if (typeof body.request_id !== 'string' || body.request_id.length === 0) {
    return failed('invalid-server-response');
  }

  if (body.outcome === 'answer') {
    const answer = asRecord(body.answer);
    if (answer === null) {
      return failed('invalid-server-response');
    }
    if (!isBoundedString(answer.text, NOOR_AI_MAX_ANSWER_CODE_POINTS)) {
      return failed('invalid-server-response');
    }
    if (answer.text.length === 0) {
      return failed('invalid-server-response');
    }
    if (!isEmptyArray(answer.sources) || !isEmptyArray(answer.accessed_modules)) {
      return failed('invalid-server-response');
    }
    const finish = toFinishReason(body.finish);
    if (finish === null) {
      return failed('invalid-server-response');
    }
    const validated: NoorAIAnswer = { text: answer.text, finish, sources: [] };
    return { outcome: 'answer', answer: validated };
  }

  if (body.outcome === 'refused') {
    const refusal = asRecord(body.refusal);
    if (refusal === null) {
      return failed('invalid-server-response');
    }
    const kind = toRefusalKind(refusal.kind);
    if (kind === null) {
      return failed('invalid-server-response');
    }
    if (!isBoundedString(refusal.explanation, NOOR_AI_MAX_EXPLANATION_CODE_POINTS)) {
      return failed('invalid-server-response');
    }
    if (refusal.explanation.length === 0) {
      return failed('invalid-server-response');
    }
    // §C.4 pins this to `null` until AI-9. A value here is a schema this client does not know.
    if ('suggested_handoff' in refusal && refusal.suggested_handoff !== null) {
      return failed('invalid-server-response');
    }
    const validated: NoorAIRefusal = { kind, explanation: refusal.explanation };
    return { outcome: 'refused', refusal: validated };
  }

  return failed('invalid-server-response');
}

/**
 * §I.5's closed error set, mapped to the client-facing states.
 *
 * Reached only when the response carried NoorLife's envelope, so the `code` is NoorLife's own word
 * and not a platform or provider one. §I.6: "The client therefore programs against §I.5's closed
 * set, and only against that set."
 *
 * Three mappings are worth their justification:
 *
 *   • `unsupported_contract_version` joins `invalid-request` rather than getting a state of its
 *     own. It means this build is out of date, which the user fixes by updating — but as a *result*
 *     it is still "this request is not acceptable and resending it will not help", and inventing a
 *     tenth state for a condition no shipped build can currently produce would be inventing copy.
 *   • `forbidden` becomes `unknown`, not `authentication-required` and not
 *     `temporarily-unavailable`. §I.5 reserves it and marks it unused in AI-1; it is not fixed by
 *     signing in again and it is not temporary, so both of the specific states would tell the user
 *     something false. `unknown` is the honest generic failure.
 *   • `internal_error` becomes `unknown` for the same reason from the other side: the server's own
 *     copy for it is "Something went wrong. Please try again.", which is the generic error state.
 */
function fromHandlerErrorCode(code: string): NoorAIFailureState {
  switch (code) {
    case 'unauthenticated':
      return 'authentication-required';
    case 'invalid_request':
    case 'unsupported_contract_version':
    case 'method_not_allowed':
    case 'unsupported_media_type':
    case 'payload_too_large':
      return 'invalid-request';
    case 'rate_limited':
      return 'temporarily-limited';
    case 'timeout':
      return 'timed-out';
    case 'upstream_unavailable':
    case 'service_unavailable':
      return 'temporarily-unavailable';
    case 'forbidden':
    case 'not_found':
    case 'internal_error':
      return 'unknown';
    default:
      // A code this build does not know. Not guessed at, and not rendered.
      return 'unknown';
  }
}

/**
 * The gateway rule — mapping on HTTP status alone, because there is nothing else to trust.
 *
 * §I.5: the platform's `code` "is not reliably numeric", the hosted documentation and the local
 * runtime disagree about its type, and §K.1 records that `UNAUTHORIZED_LEGACY_JWT` names a token
 * *family* rather than a reason — "the code alone would not have separated a rejected token from an
 * accepted one". So nothing here reads a platform `code` or `message`, and the extra duplicated
 * `msg` key the real runtime emits is not treated as malformed, because it is never looked at.
 *
 * The statuses are §C.9's list of pre-handler outcomes plus the ordinary families:
 *
 *   • `401` — the one §12.11 requires to land in the same place as a handler authentication error.
 *   • `404` — with the adapter always naming a deployed function, this means the deployment is not
 *     reachable. That is service unavailability, not a bad request, and not the user's doing.
 *   • `408` and `504` — the request ran out of time somewhere in front of the handler.
 *   • `429` — a limit, and per this phase's rule a limit is never an authentication or a permanent
 *     failure.
 *   • `502`, `503`, `546` and any other `5xx` — the platform could not deliver an answer. `546` is
 *     Supabase's own resource-limit outcome and is unavailability like the rest.
 *   • `400`, `413`, `415` — the request itself was not acceptable.
 *   • anything else — `unknown`, deliberately, rather than guessed.
 */
function fromGatewayStatus(status: number): NoorAIFailureState {
  if (status === 401) {
    return 'authentication-required';
  }
  if (status === 408 || status === 504) {
    return 'timed-out';
  }
  if (status === 429) {
    return 'temporarily-limited';
  }
  if (status === 400 || status === 413 || status === 415) {
    return 'invalid-request';
  }
  if (status === 404 || status === 546 || status >= 500) {
    return 'temporarily-unavailable';
  }
  return 'unknown';
}

/**
 * Reads the body of a non-2xx response and classifies it, without letting any of it escape.
 *
 * The producer is decided by **shape, not status**, which is §I.5's instruction: "The invariant to
 * rely on is the *absence* of `request_id`, not the shape of `code`." A body carrying a string
 * `request_id` and an `error.code` string is NoorLife's envelope and is mapped on the code; anything
 * else — the platform's shape, an HTML error page, an empty body, a stream that fails mid-read — is
 * mapped on the status alone.
 *
 * Nothing read here is returned, stored, concatenated or re-thrown. The body is consumed inside
 * this function and only a state word leaves it.
 */
async function classifyErrorResponse(response: Response): Promise<NoorAIFailureState> {
  const status = typeof response.status === 'number' ? response.status : 0;

  let body: Record<string, unknown> | null = null;
  try {
    body = asRecord(await response.json());
  } catch {
    // Unparseable, already consumed, or not JSON at all. No detail is captured: an exception raised
    // by reading an error body is made of the error body.
    body = null;
  }

  if (body !== null && typeof body.request_id === 'string' && body.request_id.length > 0) {
    const error = asRecord(body.error);
    if (error !== null && typeof error.code === 'string') {
      return fromHandlerErrorCode(error.code);
    }
    // NoorLife's id with a shape NoorLife does not produce. Fall through to the status.
  }

  return fromGatewayStatus(status);
}

/** Whether the thrown value is an abort, in either of the two spellings a runtime may use. */
function isAbortLike(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as { name?: unknown; code?: unknown };
  return candidate.name === 'AbortError' || candidate.code === 20;
}

/**
 * The two transport failures this application already recognises by message.
 *
 * `toSecurityErrorCode` in `account-security.service.ts` matches exactly these two strings for its
 * `offline` state, because React Native's `fetch` reports one and the web's the other, and neither
 * carries a status or a code to match on instead. Reusing the same pair keeps one definition of
 * "offline" in the app rather than two that can disagree.
 */
function isRecognisableNetworkFailure(value: unknown): boolean {
  const message =
    typeof value === 'object' && value !== null && 'message' in value
      ? String((value as { message: unknown }).message).toLowerCase()
      : '';
  return message.includes('network request failed') || message.includes('failed to fetch');
}

/** The `Response` a `FunctionsHttpError` carries, when it carries one. */
function responseOf(error: unknown): Response | null {
  if (typeof error !== 'object' || error === null || !('context' in error)) {
    return null;
  }
  const context = (error as { context: unknown }).context;
  return typeof context === 'object' &&
    context !== null &&
    'status' in context &&
    typeof (context as { json?: unknown }).json === 'function'
    ? (context as Response)
    : null;
}

/**
 * Classifies whatever `invoke` reported instead of a body.
 *
 * ── Why an abort is not a network failure ───────────────────────────────────
 * `supabase-js` wraps every `fetch` rejection in one `FunctionsFetchError`, including the rejection
 * an `AbortController` causes, so the wrapper's identity says nothing on its own. The evidence that
 * separates the two cases is the caller's own signal: if it is aborted, the caller abandoned the
 * request; if it is not and the rejection is still an abort, the only other controller in play is
 * the client deadline. Anything else is classified on the underlying message, and only on the two
 * spellings this application already recognises.
 *
 * ── Why unrecognised failures are `unknown` ─────────────────────────────────
 * Classifying every invocation exception as "no internet" is a fabricated diagnosis, and a
 * confident wrong state is worse for a user than an honest generic one. So a failure with no
 * evidence of its cause gets none invented for it.
 */
function classifyThrown(error: unknown, callerSignal: AbortSignal | undefined): NoorAIFailureState {
  const cause =
    typeof error === 'object' && error !== null && 'context' in error
      ? (error as { context: unknown }).context
      : error;

  if (isAbortLike(error) || isAbortLike(cause)) {
    return callerSignal?.aborted === true ? 'cancelled' : 'timed-out';
  }
  if (callerSignal?.aborted === true) {
    return 'cancelled';
  }
  if (isRecognisableNetworkFailure(error) || isRecognisableNetworkFailure(cause)) {
    return 'network-unavailable';
  }
  return 'unknown';
}

/**
 * Asks Noor AI one question.
 *
 * ── The order of operations is part of the guarantee ────────────────────────
 * Configuration, then session, then local validation, then **one** invocation. Each of the first
 * three can only return, never invoke, which is what makes "a local validation failure results in
 * zero invocation calls" a property of the shape of this function rather than a claim about it.
 *
 * ── Authentication ──────────────────────────────────────────────────────────
 * The session comes from `supabase.auth.getSession()`, which is how every other service in this
 * application reads one, and the SDK owns whatever refresh that implies. No refresh is triggered
 * here, no sign-in is attempted, and a missing session is answered locally with
 * `authentication-required` rather than by invoking and letting the gateway say so — one fewer
 * invocation for an outcome that is already known.
 *
 * The access token is placed on `Authorization` explicitly, at invoke level, where §12.11 requires
 * it: "the publishable key must be sent on the `apikey` header **only**", because if it also
 * arrives as `Authorization: Bearer` the platform "tries to parse it as a JWT and rejects the
 * request with `Invalid JWT`" — and a correctly authenticated user would then see a session error
 * caused entirely by client header construction. Invoke-level headers take priority over the
 * client's, so this pins the header to the user's token whatever the SDK's own auth state is,
 * while the publishable key stays where the client put it. The token is read into a local, used
 * once, and never logged, stored, returned or attached to any result.
 *
 * `verify_jwt` is not bypassed and cannot be from here: the function's own configuration declares
 * it, this adapter names a function rather than a URL, and no header, body field or option below
 * changes what the gateway does with the token.
 */
async function ask(
  prompt: string,
  context: AIRequestContext,
  options?: NoorAIAskOptions,
): Promise<NoorAIResult> {
  if (!isSupabaseConfigured || supabase === null) {
    return failed('not-configured');
  }
  const client = supabase;

  const { data: sessionData, error: sessionError } = await client.auth.getSession();
  const accessToken = sessionData?.session?.access_token;
  if (sessionError !== null || typeof accessToken !== 'string' || accessToken.length === 0) {
    return failed('authentication-required');
  }

  const draft = buildRequestBody(prompt, context, options);
  if (!draft.ok) {
    return failed(draft.failure);
  }

  if (options?.signal?.aborted === true) {
    // Abandoned before anything was sent. Zero invocations, and not reported as a failure to fix.
    return failed('cancelled');
  }

  /**
   * The one invocation. There is no second call site in this file, and no loop around this one.
   *
   * `timeout` is the SDK's own deadline mechanism and is set above the server's handler budget, so
   * the server's honest §I.5 `timeout` wins the race in every ordinary case and this only fires for
   * a connection that has genuinely stopped answering. `signal` is the caller's, passed through
   * unchanged; the SDK honours both.
   */
  const { data, error } = await (client.functions as unknown as FunctionInvoker).invoke(
    NOOR_AI_FUNCTION_NAME,
    {
      body: draft.body,
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: NOOR_AI_CLIENT_TIMEOUT_MS,
      ...(options?.signal === undefined ? {} : { signal: options.signal }),
    },
  );

  if (error !== null && error !== undefined) {
    const response = responseOf(error);
    if (response !== null) {
      return failed(await classifyErrorResponse(response));
    }
    return failed(classifyThrown(error, options?.signal));
  }

  return parseSuccessBody(data);
}

/**
 * The adapter AI-5 consumes.
 *
 * Exported as an object satisfying `NoorAIPort` so a screen depends on the port and not on this
 * module, which is what lets the unreachable states — a quota refusal, a provider outage, an
 * expired session — be driven by a fixture rather than by changing a real account or spending a
 * real provider request.
 */
export const noorAIService: NoorAIPort = { ask };

/** The bare function, for callers that already hold the port by another name. */
export { ask as askNoorAI };
