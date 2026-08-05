import { CONTRACT_VERSION, type ErrorCode, type RefusalKind } from './contract.ts';
import { resolveLocale, resolveSurface } from './allow-lists.ts';
import { buildInstructions, decidePolicy, POLICY_VERSION, withQualification } from './policy.ts';
import { parseRequestBody, readBody } from './request-schema.ts';
import {
  answerResponse,
  errorResponse,
  formatRequestId,
  preflightResponse,
  refusalResponse,
} from './responses.ts';
import type {
  AuthFailureReason,
  NoorAIDependencies,
  OperationalLogRecord,
  ProviderOutcome,
  ProviderOutcomeKind,
  ProviderRequest,
  SafetyCategory,
} from './ports.ts';

/**
 * The Noor AI handler, as a factory over its dependencies.
 *
 * ── §D.3's boundary, restated here because §K requires it to live where it cannot be lost ────────────
 * This handler authenticates a caller by verifying a JWT's signature and claims. That establishes
 * **identity and issuance** and nothing else. It does **not** establish that the caller's session still
 * exists.
 *
 * Concretely: a signed, correctly scoped, unexpired `authenticated`-role JWT **may remain accepted
 * until it expires**, which at `jwt_expiry = 3600` is up to one hour after the user signed out. No
 * `auth.sessions` lookup happens here; `session_id` is verified to be present and is used for nothing
 * else (§D.4 row 8). Strong immediate revocation is **not implemented**, and no response, log line,
 * comment or piece of copy anywhere in this function may describe it as if it were. §I.1's per-user
 * limits, §I.2's spend ceiling and breaker, and the kill switch bound the *cost* of that window; they do
 * not convert a revoked session into a rejected request.
 *
 * This is the same limit the app already ships and already tells users about — `signOutEverywhere`
 * records that already-issued access JWTs "are not revoked by this or any other client call", and
 * `allSessionsWarning` tells users another device "may remain active briefly". §12.10 assigns the
 * decision to AI-10; §J.2f is its acceptance gate *if* the decision is to adopt it. It is deliberately
 * not a gate on this phase, and a service-role credential must not be introduced here "for later"
 * (§B.2).
 *
 * ── Why the whole handler is a closure over injected ports ───────────────────
 * It constructs nothing. The verifier, the provider, the limiter, the clock, the timer, the request-id
 * source and the logger all arrive from outside, which is what makes every AI-2 row of §J testable with
 * no Docker, no project, no network and no key — and what lets a test hold the only reference to the
 * thing that would have spent money and prove it was never called.
 *
 * ── The order of checks, and why it is this order ────────────────────────────
 *   1. Request id, so every handler-produced response carries one (§I.7).
 *   2. Path → `404`, method → `405`, `OPTIONS` → preflight without authentication (§C.1).
 *   3. Authentication (§D.4 rows 2–8). Nothing reads the body for a caller who has not authenticated.
 *   4. `Content-Type` → `415`, then the byte cap → `413`, then parse and schema → `400` (§C.3's
 *      cheap-first ordering).
 *   5. Kill switch → `503` (§I.2), which runs "before the provider call and before the rate-limit read".
 *   6. Per-user rate limit → `429` (§I.1).
 *   7. The provider.
 *
 * Validation sits ahead of the kill switch rather than behind it so that a malformed request is still
 * told it is malformed while Noor AI is disabled — a client debugging its payload against a switched-off
 * deployment otherwise gets `503` for a `400` and learns nothing.
 */

const FUNCTION_NAME = 'noor-ai';

/** §C.1 — `/functions/v1/` is Supabase's platform path prefix, not NoorLife's contract version. */
const PLATFORM_PREFIX = '/functions/v1';

/**
 * Whether the request addresses the function itself rather than a path under it.
 *
 * §I.5's `not_found` is for "Unknown path under the function". The local stack and the deployed platform
 * present the path differently — `/functions/v1/noor-ai` against `/noor-ai` — so both are accepted, and
 * anything deeper is a `404` rather than something quietly answered.
 *
 * §C.1: "No query parameters are read; if present they are ignored, never logged, and never influence
 * behaviour." Only `pathname` is consulted below, so that holds by construction.
 */
function addressesFunctionRoot(url: string): boolean {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return false;
  }
  let path = pathname.replace(/\/+$/, '');
  if (path.startsWith(PLATFORM_PREFIX)) {
    path = path.slice(PLATFORM_PREFIX.length);
  }
  return path === '' || path === `/${FUNCTION_NAME}`;
}

/** §D.1 — every handler auth rejection produces the same body. Only the log distinguishes them. */
function authErrorCode(reason: AuthFailureReason): ErrorCode {
  return reason === 'verifier-unavailable' ? 'service_unavailable' : 'unauthenticated';
}

/** §F.8 — the two outcomes a retry can help. Everything else is deterministic or a billing problem. */
function isRetryable(outcome: ProviderOutcome): boolean {
  return outcome.kind === 'rate-limited' || outcome.kind === 'transient-server-error';
}

/**
 * A mutable accumulator for the single log line each request emits (§H.3).
 *
 * Every field starts at a value meaning "we never got that far", so a log record is honest about a
 * request that failed early rather than reporting a default that looks like a measurement.
 */
type LogDraft = {
  outcome: OperationalLogRecord['outcome'];
  http_status: number;
  refusal_kind: RefusalKind | null;
  error_code: ErrorCode | null;
  error_field: string | null;
  auth_reason: AuthFailureReason | null;
  safety_category: SafetyCategory | null;
  message_length: number | null;
  surface_accepted: boolean | null;
  locale_accepted: boolean | null;
  rate_limit_state: OperationalLogRecord['rate_limit_state'];
  retry_after_seconds: number | null;
  provider_outcome: ProviderOutcomeKind | null;
  provider_attempts: number;
  upstream_malformed: boolean;
  operator_alert: 'quota_exhausted' | null;
};

export function createNoorAIHandler(
  deps: NoorAIDependencies,
): (request: Request) => Promise<Response> {
  const { verifier, provider, rateLimiter, clock, timer, requestIds, logger, config } = deps;

  /**
   * One provider attempt, with the upstream budget actually aborting it (§F.7).
   *
   * "Enforced with `AbortController`; the connection is actually aborted, not just ignored." The timer is
   * the injected port, so a test fires it rather than waiting — and because the controller is passed to
   * the provider, a test's fake provider can observe the abort and prove the operation was cancelled
   * rather than merely abandoned.
   */
  const attemptProvider = async (request: ProviderRequest): Promise<ProviderOutcome> => {
    const controller = new AbortController();
    let timedOut = false;
    const cancelTimer = timer.schedule(config.upstreamTimeoutMs, () => {
      timedOut = true;
      controller.abort();
    });
    try {
      const outcome = await provider.generate(request, controller.signal);
      // A provider that resolves after the abort still yields a timeout: the budget is the authority on
      // whether the answer arrived in time, not the provider.
      return timedOut ? { kind: 'timeout' } : outcome;
    } catch {
      /**
       * A thrown error is a connection-level failure — a reset, a DNS failure, an aborted socket — which
       * §F.8 lists among the narrowly retryable cases. Nothing about the error is captured: §I.6 forbids
       * forwarding provider detail, and an exception from a provider call is made of provider detail.
       */
      return timedOut ? { kind: 'timeout' } : { kind: 'transient-server-error' };
    } finally {
      cancelTimer();
    }
  };

  /**
   * At most one retry (§F.8), and only if it fits the remaining handler budget.
   *
   * "Maximum attempts | 2 total, i.e. at most one retry" and "A retry is attempted only if it fits inside
   * the remaining handler budget (§F.7). Budget wins." The delay honours the provider's `Retry-After`
   * when it sent one, because §F.8 requires it and because guessing shorter than the provider asked is
   * how a 429 becomes two 429s.
   */
  const callProvider = async (
    request: ProviderRequest,
    deadlineMs: number,
  ): Promise<{ readonly outcome: ProviderOutcome; readonly attempts: number }> => {
    const first = await attemptProvider(request);
    if (!isRetryable(first)) {
      return { outcome: first, attempts: 1 };
    }

    const requested = first.kind === 'rate-limited' ? first.retryAfterSeconds : null;
    const delayMs = requested === null ? config.retryBackoffMs : requested * 1000;
    if (clock.now() + delayMs + config.upstreamTimeoutMs > deadlineMs) {
      return { outcome: first, attempts: 1 };
    }

    await new Promise<void>((resolve) => {
      timer.schedule(delayMs, resolve);
    });

    const second = await attemptProvider(request);
    return { outcome: second, attempts: 2 };
  };

  return async (request: Request): Promise<Response> => {
    const startedAt = clock.now();
    const requestId = formatRequestId(requestIds.nextUuid());

    const draft: LogDraft = {
      outcome: 'error',
      http_status: 500,
      refusal_kind: null,
      error_code: null,
      error_field: null,
      auth_reason: null,
      safety_category: null,
      message_length: null,
      surface_accepted: null,
      locale_accepted: null,
      rate_limit_state: 'not-evaluated',
      retry_after_seconds: null,
      provider_outcome: null,
      provider_attempts: 0,
      upstream_malformed: false,
      operator_alert: null,
    };

    const emit = (): void => {
      logger.record({
        event: 'noor_ai_request',
        request_id: requestId,
        contract_version: CONTRACT_VERSION,
        policy_version: POLICY_VERSION,
        http_status: draft.http_status,
        outcome: draft.outcome,
        refusal_kind: draft.refusal_kind,
        error_code: draft.error_code,
        error_field: draft.error_field,
        auth_reason: draft.auth_reason,
        safety_category: draft.safety_category,
        message_length: draft.message_length,
        surface_accepted: draft.surface_accepted,
        locale_accepted: draft.locale_accepted,
        rate_limit_state: draft.rate_limit_state,
        retry_after_seconds: draft.retry_after_seconds,
        provider_outcome: draft.provider_outcome,
        provider_attempts: draft.provider_attempts,
        upstream_malformed: draft.upstream_malformed,
        operator_alert: draft.operator_alert,
        duration_ms: clock.now() - startedAt,
      });
    };

    const fail = (code: ErrorCode, field?: string, retryAfterSeconds?: number): Response => {
      const built = errorResponse(requestId, code, { field, retryAfterSeconds });
      draft.outcome = 'error';
      draft.http_status = built.status;
      draft.error_code = code;
      draft.error_field = field ?? null;
      if (retryAfterSeconds !== undefined) {
        draft.retry_after_seconds = retryAfterSeconds;
      }
      emit();
      return built.response;
    };

    try {
      if (!addressesFunctionRoot(request.url)) {
        return fail('not_found');
      }

      /**
       * §C.1 — the preflight, answered without authentication and without a log line.
       *
       * Nothing was authenticated and nothing was asked, so there is no Noor AI request to record. A log
       * entry per preflight would be volume without signal, and §H.3's record type has no honest shape
       * for one.
       */
      if (request.method === 'OPTIONS') {
        return preflightResponse();
      }

      if (request.method !== 'POST') {
        return fail('method_not_allowed');
      }

      // ── §D.4 rows 2–8 ─────────────────────────────────────────────────────
      const auth = await verifier.verify(request.headers.get('authorization'));
      if (!auth.ok) {
        draft.auth_reason = auth.reason;
        return fail(authErrorCode(auth.reason));
      }

      // ── §C.1 / §C.3 ───────────────────────────────────────────────────────
      // Parameters such as `; charset=utf-8` are legal and must not be treated as a different type, so
      // only the media type itself is compared — and compared exactly, not by prefix or suffix.
      const mediaType = (request.headers.get('content-type') ?? '').toLowerCase().split(';')[0]
        ?.trim();
      if (mediaType !== 'application/json') {
        return fail('unsupported_media_type');
      }

      const read = await readBody(request.body, request.headers.get('content-length'));
      if (!read.ok) {
        return read.reason === 'too-large'
          ? fail('payload_too_large')
          : fail('invalid_request', 'body');
      }

      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(read.text);
      } catch {
        // §C.3.2 — "The unparseable text is not logged."
        return fail('invalid_request', 'body');
      }

      const parsed = parseRequestBody(parsedJson);
      if (!parsed.ok) {
        draft.error_field = parsed.failure.field;
        return fail(parsed.failure.code, parsed.failure.field);
      }

      draft.message_length = parsed.request.messageCodePoints;
      const surface = resolveSurface(parsed.request.surface);
      const locale = resolveLocale(parsed.request.locale);
      draft.surface_accepted = surface.accepted;
      draft.locale_accepted = locale.accepted;

      // ── §I.2's kill switch ────────────────────────────────────────────────
      if (!config.enabled) {
        return fail('service_unavailable');
      }

      // ── §I.1 ──────────────────────────────────────────────────────────────
      const limit = await rateLimiter.check(auth.claims.userId, clock.now());
      if (limit.kind === 'limited') {
        draft.rate_limit_state = 'limited';
        return fail('rate_limited', undefined, limit.retryAfterSeconds);
      }
      if (limit.kind === 'unavailable') {
        /**
         * §I.1 / §12.7 — the limiter cannot answer, so the request is refused rather than waved through.
         *
         * "an Edge Function runs in ephemeral, horizontally-scaled isolates, so an in-memory counter is
         * not a rate limit." Until AI-3 selects a shared store there is nothing that can answer, and an
         * unmetered AI endpoint is worse than an unavailable one.
         */
        draft.rate_limit_state = 'unavailable';
        return fail('service_unavailable');
      }
      draft.rate_limit_state = 'ok';

      // ── §F ────────────────────────────────────────────────────────────────
      const deadlineMs = startedAt + config.handlerBudgetMs;
      if (clock.now() >= deadlineMs) {
        // §F.7 — handler budget exhausted before the provider was even reached.
        return fail('timeout');
      }

      /**
       * The outbound request, built field by field (§H.1).
       *
       * `instructions` is a server constant taking no argument, and `userInput` is the validated message
       * unmodified. §F.3's rule is that the two never mix: no templating, no delimiters, no "the user
       * asked". There is no `surface` here — §H.1 keeps the route string from travelling — no `model`
       * (§F.2 makes it the provider implementation's configuration, and AI-2 names none), no `tools`
       * (§F.4 omits rather than empties), no conversation state (§F.6) and no `safety_identifier`
       * (§12.6 is unresolved, so AI-2 does not implement it).
       */
      const providerRequest: ProviderRequest = {
        instructions: buildInstructions(),
        userInput: parsed.request.message,
        maxOutputTokens: config.maxOutputTokens,
        store: false,
        languageHint: locale.locale,
      };

      const { outcome, attempts } = await callProvider(providerRequest, deadlineMs);
      draft.provider_outcome = outcome.kind;
      draft.provider_attempts = attempts;

      const refuse = (category: SafetyCategory): Response => {
        const decision = decidePolicy(category);
        if (decision.action !== 'refuse') {
          /**
           * The provider claimed a refusal for a category server policy does not refuse. That is a
           * provider contradicting the contract, which §F.4's reasoning covers: a handler that "just
           * handles" an unexpected upstream shape has quietly accepted a behaviour nobody reviewed.
           */
          draft.upstream_malformed = true;
          return fail('upstream_unavailable');
        }
        draft.safety_category = category;
        const built = refusalResponse(requestId, decision.refusal);
        draft.outcome = 'refused';
        draft.http_status = 200;
        draft.refusal_kind = decision.refusal.kind;
        emit();
        return built.response;
      };

      switch (outcome.kind) {
        case 'answer': {
          const { answer } = outcome;

          /**
           * §G.5 / §J.10b — an answer that needs a citation cannot be given, because `sources` can only
           * ever be `[]` in AI-2 and §07 requires citations for Faith content.
           *
           * Checked before the category, so a provider that flags the requirement while classifying the
           * answer as ordinary still cannot get scripture past this line. "A quotation from memory with no
           * `sources` entry would violate §07 while looking like a helpful answer, which is the worst
           * combination available."
           */
          if (answer.citationRequired) {
            return refuse('citation-required');
          }

          if (answer.text.trim() === '') {
            /**
             * §J.14b — "Never an empty-string answer presented as an answer." An empty answer is a
             * provider that produced no output, which is a `malformed_upstream` condition rather than a
             * very short reply.
             */
            draft.upstream_malformed = true;
            return fail('upstream_unavailable');
          }

          /**
           * `category === null` is the ordinary case: an answer with nothing to add. Anything else runs
           * through the deterministic policy table, which either refuses it or attaches §G.4's
           * qualification — the `refuse`/`qualify` distinction §G.4 requires the server to preserve,
           * because "Over-refusal is a defect, not extra safety."
           */
          let text = answer.text;
          const category = answer.category;
          if (category !== null) {
            const decision = decidePolicy(category);
            if (decision.action === 'refuse') {
              return refuse(category);
            }
            if (decision.action === 'qualify') {
              text = withQualification(answer.text, decision.qualification);
              draft.safety_category = category;
            }
          }

          const built = answerResponse(requestId, text, answer.finish);
          draft.outcome = 'answer';
          draft.http_status = 200;
          emit();
          return built.response;
        }

        case 'refusal':
          return refuse(outcome.category);

        case 'timeout':
          // §F.7 / §J.12 — "Never a partial answer, never a fabricated one."
          return fail('timeout');

        case 'rate-limited':
          /**
           * §J.13c — after at most one retry honouring `Retry-After`, a provider rate limit becomes
           * `503 service_unavailable`. The provider's own hint is passed through as `retry_after_seconds`
           * because it is a number, not a message: §I.6 forbids forwarding provider *wording*, and a
           * retry delay carries no account, quota or model detail.
           */
          return fail(
            'service_unavailable',
            undefined,
            outcome.retryAfterSeconds ?? undefined,
          );

        case 'transient-server-error':
          // §J.16 — a provider 500 becomes `502`, and "The provider's wording appears nowhere".
          return fail('upstream_unavailable');

        case 'quota-exhausted':
          /**
           * §F.8 / §J.13d — **no retry**, because retrying billing and quota errors "won't restore API
           * access". `503` for the client and an alert for the operator: this is the one outcome that
           * "must page a human".
           */
          draft.operator_alert = 'quota_exhausted';
          return fail('service_unavailable');

        case 'malformed':
          // §I.5 — recorded distinctly as `malformed_upstream` and reported as `502`.
          draft.upstream_malformed = true;
          return fail('upstream_unavailable');

        case 'unexpected-tool-call':
          /**
           * §F.4 / §J.14c — the call is **not executed**.
           *
           * There is deliberately nothing here to execute it with: this function has no tool registry, no
           * dispatch table, no database client and no outbound path of any kind. §F.4: "A handler that
           * 'just handles' an unexpected tool call has quietly added a capability nobody reviewed." The
           * negative assertion is a test (`handler-provider_test.ts`), and the structural guarantee is
           * that a tool call arrives here as a value and leaves as a `502`.
           */
          draft.upstream_malformed = true;
          return fail('upstream_unavailable');

        case 'unavailable':
          /**
           * The AI-2 production path. No provider is configured, so there is nothing to call, and the
           * request fails closed with §I.5's stable `503` after authentication and validation have both
           * run. It is never a canned answer.
           */
          return fail('service_unavailable');
      }
    } catch {
      /**
       * §I.5's `internal_error`, and the only thing this block is allowed to know.
       *
       * The exception is not inspected, not logged and not described. §H.3 forbids logging "the contents
       * of any log, error, or stack trace originating in NoorLife", and §I.6 forbids any of it reaching
       * the user. `error_code` in the log line says an unhandled fault happened; the platform's own
       * runtime logs are where an operator looks for what it was.
       */
      return fail('internal_error');
    }
  };
}
