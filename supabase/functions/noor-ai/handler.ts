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
  AttemptOutcomeClass,
  AuthFailureReason,
  NoorAIDependencies,
  OperationalLogRecord,
  ProviderOutcome,
  ProviderOutcomeKind,
  ProviderRequest,
  ProviderResult,
  ProviderUsage,
  QuotaAck,
  QuotaDenialReason,
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
 *   6. B10's per-user safety identifier → `503` when it cannot be derived, before anything is spent.
 *   7. Per-user rate limit → `429` (§I.1).
 *   8. The provider.
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
 * Whether an attempt actually reached the provider and therefore may have cost money.
 *
 * `unavailable` is the single exception, and it is exact rather than conservative: it means no
 * provider is configured, so the port returned without anything leaving the process. Every other
 * outcome — including `timeout`, including `provider-configuration-error`, and including the
 * connection-level throw that `attemptProvider` converts into `transient-server-error` — means a
 * request was issued and the answer is unknown.
 *
 * `provider-configuration-error` is worth naming here because it is the one that looks like it
 * belongs with `unavailable` and does not. A `401` is a *reply*: the request was built, sent and
 * answered. Whether the provider billed for it is unknown, and unknown resolves toward recording.
 *
 * The bias is deliberate and one-directional. Recording an attempt that turned out to be free costs a
 * zero-token row; *not* recording one that was billed means recorded spend drifts below real spend,
 * and §I.2's ceilings are enforced from recorded spend. Under-recording is the failure that spends
 * money, so ambiguity resolves toward recording.
 */
function attemptWasIncurred(outcome: ProviderOutcome): boolean {
  return outcome.kind !== 'unavailable';
}

/**
 * The coarse class the store records. Three values, chosen by what the operator needs to distinguish:
 * it answered, it might answer if asked again, or it will not.
 */
function outcomeClass(outcome: ProviderOutcome): AttemptOutcomeClass {
  switch (outcome.kind) {
    case 'answer':
    case 'refusal':
      return 'success';
    case 'rate-limited':
    case 'transient-server-error':
    case 'timeout':
      return 'transient';
    default:
      return 'terminal';
  }
}

/**
 * Usage the provider reported, or zeros.
 *
 * Zeros are not an estimate and must not be read as one. §12.7's crash case is already accepted as an
 * under-count, and the database's own rule is that it "must not invent an estimate" — so an attempt
 * whose usage is unknown is recorded as having happened, with no cost attributed to it.
 */
const NO_USAGE: ProviderUsage = { inputTokens: 0, outputTokens: 0, reasoningTokens: 0 };

/** The per-user reasons, which are the caller's doing and therefore the only ones that earn a 429. */
const PER_USER_REASONS: readonly QuotaDenialReason[] = [
  'per_user_minute',
  'per_user_hour',
  'per_user_day',
];

/**
 * §I.1 requires a `429` to carry `retry_after_seconds`, and the window that denied the request is the
 * honest answer to "how long?". A shorter hint would send the user straight back into the same
 * denial, which is how one `429` becomes three.
 */
const RETRY_AFTER_SECONDS: Readonly<Record<string, number>> = {
  per_user_minute: 60,
  per_user_hour: 3600,
  per_user_day: 86_400,
};

/** What one accounted provider run produced. `accountingFailed` stops everything downstream. */
type AccountedRun = {
  readonly outcome: ProviderOutcome;
  readonly attempts: number;
  readonly registered: number;
  readonly accountingFailed: boolean;
};

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
  quota_reason: QuotaDenialReason | null;
  attempts_registered: number;
  accounting: OperationalLogRecord['accounting'];
  retry_after_seconds: number | null;
  provider_outcome: ProviderOutcomeKind | null;
  provider_attempts: number;
  upstream_malformed: boolean;
  operator_alert: OperationalLogRecord['operator_alert'];
};

export function createNoorAIHandler(
  deps: NoorAIDependencies,
): (request: Request) => Promise<Response> {
  const {
    verifier,
    safetyIdentifiers,
    provider,
    quota,
    clock,
    timer,
    requestIds,
    logger,
    config,
  } = deps;

  /**
   * One provider attempt, with the upstream budget actually aborting it (§F.7).
   *
   * "Enforced with `AbortController`; the connection is actually aborted, not just ignored." The timer is
   * the injected port, so a test fires it rather than waiting — and because the controller is passed to
   * the provider, a test's fake provider can observe the abort and prove the operation was cancelled
   * rather than merely abandoned.
   */
  const attemptProvider = async (request: ProviderRequest): Promise<ProviderResult> => {
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
    register: (attemptNumber: 1 | 2, result: ProviderResult) => Promise<boolean>,
  ): Promise<AccountedRun> => {
    const first = await attemptProvider(request);
    let registered = 0;

    /**
     * Accounting happens immediately after the attempt it describes, not at the end.
     *
     * §I.2's ceilings are enforced from recorded spend, so the window in which an attempt is incurred
     * but unrecorded is the window in which the store under-reports. Registering here makes that
     * window one RPC wide instead of spanning the retry delay and the second attempt.
     */
    if (attemptWasIncurred(first)) {
      if (!(await register(1, first))) {
        /**
         * §F.8 and §I.2 together: a quota RPC failure is **not** permission to call the provider
         * again. The retry allowance exists for a provider that might succeed on a second ask; it is
         * not a general "try harder" budget, and spending more money because the accounting failed is
         * precisely backwards.
         */
        return { outcome: first, attempts: 1, registered: 0, accountingFailed: true };
      }
      registered = 1;
    }

    if (!isRetryable(first)) {
      return { outcome: first, attempts: 1, registered, accountingFailed: false };
    }

    const requested = first.kind === 'rate-limited' ? first.retryAfterSeconds : null;
    const delayMs = requested === null ? config.retryBackoffMs : requested * 1000;
    if (clock.now() + delayMs + config.upstreamTimeoutMs > deadlineMs) {
      return { outcome: first, attempts: 1, registered, accountingFailed: false };
    }

    await new Promise<void>((resolve) => {
      timer.schedule(delayMs, resolve);
    });

    const second = await attemptProvider(request);
    if (attemptWasIncurred(second)) {
      if (!(await register(2, second))) {
        return { outcome: second, attempts: 2, registered, accountingFailed: true };
      }
      registered += 1;
    }
    return { outcome: second, attempts: 2, registered, accountingFailed: false };
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
      quota_reason: null,
      attempts_registered: 0,
      accounting: 'not-required',
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
        quota_reason: draft.quota_reason,
        attempts_registered: draft.attempts_registered,
        accounting: draft.accounting,
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

      /**
       * ── B10 — the per-user safety identifier, derived here and only here ───
       *
       * Four properties of this position, each of which a test pins:
       *
       *   • **After verification.** The only input is `auth.claims.userId`, the `sub` of a token whose
       *     signature was checked. There is nothing else the handler could pass: §C.6 rejects `sub`,
       *     `user_id`, `subject_id` and `safety_identifier` as unknown request fields long before this
       *     line, so a client cannot supply, seed or override the value in any form.
       *   • **Before the reservation.** A missing or invalid HMAC key is an operator fault, and making
       *     a user pay a quota unit for it would spend their daily allowance on NoorLife's
       *     misconfiguration. Deriving first means a failure costs the user nothing at all.
       *   • **Before the provider.** The adapter refuses a request without a well-formed identifier, so
       *     failing here means zero outbound calls rather than one that is thrown away.
       *   • **Once.** One derivation per handler execution, reused across §F.8's retry, so the two
       *     attempts of one question are one subject rather than two.
       *
       * `unavailable` collapses every cause — no secret, malformed secret, wrong key length, all-zero
       * key, an unrecognised version, a runtime failure inside the primitive — into §I.5's stable
       * `503`. Distinguishing them for the caller would describe the server's key configuration to
       * whoever asked, which is §D.1's reasoning applied to a secret rather than to a token.
       */
      const derived = await safetyIdentifiers.derive(auth.claims.userId);
      if (derived.kind !== 'derived') {
        return fail('service_unavailable');
      }

      /**
       * ── §I.1 / §I.2 — reserve, before anything can be spent ────────────────
       *
       * The subject is `auth.claims.userId` and it is the only identity in scope. There is no other
       * value the handler could pass: §C.6 rejects `user_id`, `subject_id` and `sub` as unknown
       * fields before this line is reached, so a body carrying them is a `400` rather than an
       * override, and `VerifiedClaims` is the only place a user id exists at all.
       *
       * The store's idempotency key is NoorLife's own `request_id` — server-generated, random, and
       * bounded well inside the database's 64-character limit.
       *
       * ── What that key does and does not deduplicate ────────────────────────
       * It is generated fresh at the top of **every handler execution**, so a client that gives up and
       * issues a second HTTP request arrives with a *different* quota request id and takes a *second*
       * reservation. The database's `(subject_id, request_id)` idempotency protects a replay of the
       * same server-controlled key — the same reserve operation retried — and nothing more.
       *
       * It is therefore **not** cross-request deduplication, and must not be described as if it were.
       * A client-controlled key is what would provide that; §I.1 already records `client_request_id`
       * as future work, and this phase deliberately does not add one.
       */
      const reservation = await quota.reserve(auth.claims.userId, requestId);

      if (reservation.kind === 'limited') {
        draft.quota_reason = reservation.reason;
        if (PER_USER_REASONS.includes(reservation.reason)) {
          // The caller's own doing, and waiting genuinely helps: §I.1's `429`.
          draft.rate_limit_state = 'limited';
          return fail('rate_limited', undefined, RETRY_AFTER_SECONDS[reservation.reason]);
        }
        /**
         * A global ceiling, the concurrency cap, a spend ceiling or the operator kill switch. None of
         * them is the caller's behaviour, so none of them earns a `429` — telling somebody who did
         * nothing wrong that they asked too often is both untrue and useless advice. No retry hint is
         * invented either: NoorLife does not know when capacity returns.
         */
        draft.rate_limit_state = 'unavailable';
        return fail('service_unavailable');
      }

      if (reservation.kind === 'unavailable') {
        /**
         * The store could not answer — transport, timeout, non-2xx, malformed JSON, an unrecognised
         * shape, or its own `configuration_error`. All of them fail closed, and none of them is a
         * `429`: an unmetered AI endpoint is worse than an unavailable one (§I.1), and a store fault
         * dressed as a rate limit would blame the user for NoorLife's defect.
         */
        draft.rate_limit_state = 'unavailable';
        return fail('service_unavailable');
      }

      draft.rate_limit_state = 'ok';
      const { reservationId } = reservation;

      // §F.7's wall clock, computed here because both the accounting retry and the pre-provider
      // budget check below need it.
      const deadlineMs = startedAt + config.handlerBudgetMs;

      /**
       * Hands back a reservation nothing was spent against.
       *
       * Only ever called where no provider attempt was incurred. §12.7 is explicit that release does
       * **not** refund consumed quota — the request unit stays spent — so this frees the concurrency
       * lease and nothing more. A failure to release is not surfaced: the lease TTL reclaims it, and
       * turning a successful-but-unreleased request into an error would trade a recoverable lease for
       * a user-visible failure.
       */
      const releaseUnused = async (): Promise<void> => {
        const ack = await quota.release(auth.claims.userId, reservationId);
        /**
         * The log records what happened, not what was attempted.
         *
         * An unacknowledged release still resolves — the lease TTL reclaims it — so this does not
         * change the response. But writing `released` when the store never confirmed it would make
         * the one field an operator uses to reconcile leases quietly untrue, and a concurrency
         * ceiling that appears to have been freed is exactly the thing somebody would stop
         * investigating. No detail of the failure is recorded: the ack is a boolean.
         */
        draft.accounting = ack.ok ? 'released' : 'release-failed';
      };

      /**
       * One accounting call, with at most one bounded retry.
       *
       * ── Why this lives here and not in the adapter ─────────────────────────
       * The adapter is deliberately retry-free: it cannot see §F.7's deadline, and a retry policy
       * blind to the deadline can blow through it. The handler *can* see it, so the single permitted
       * retry sits above the port where the budget check is possible.
       *
       * ── Why retrying is safe at all ────────────────────────────────────────
       * Only for these two operations, and only because the database makes them idempotent under
       * keys this caller supplies: `register_attempt` on `(reservation_id, attempt_number)` and
       * `finalize` on its state guard. The retry re-invokes the *same closure*, so the subject,
       * reservation, ordinal and token counts are identical by construction rather than by
       * discipline — an identical replay is recognised and returns the original result instead of
       * inserting or accumulating twice.
       *
       * There is no delay: an immediate second call is bounded, and a wait would spend budget the
       * handler is trying to protect. `reserve` and `release` gain no retry here.
       *
       * **This does not eliminate under-counting.** If both calls fail, or the isolate dies between
       * them, the crash/timeout under-count in §12.7 remains possible. It narrows the window; it does
       * not close it, and nothing here should be read as a durable reconciliation design.
       */
      const withAccountingRetry = async (attempt: () => Promise<QuotaAck>): Promise<boolean> => {
        const first = await attempt();
        if (first.ok) {
          return true;
        }
        // Retry only if what remains of the handler budget can actually absorb another quota RPC.
        // Starting a call the deadline will cut off spends budget and changes nothing.
        if (clock.now() + config.quotaTimeoutMs > deadlineMs) {
          return false;
        }
        return (await attempt()).ok;
      };

      // ── §F ────────────────────────────────────────────────────────────────
      if (clock.now() >= deadlineMs) {
        // §F.7 — handler budget exhausted before the provider was even reached. Nothing was spent.
        await releaseUnused();
        return fail('timeout');
      }

      /**
       * The outbound request, built field by field (§H.1).
       *
       * `instructions` is a server constant taking no argument, and `userInput` is the validated message
       * unmodified. §F.3's rule is that the two never mix: no templating, no delimiters, no "the user
       * asked". There is no `surface` here — §H.1 keeps the route string from travelling — no `model`
       * (§F.2 makes it the provider implementation's configuration, and AI-2 names none), no `tools`
       * (§F.4 omits rather than empties) and no conversation state (§F.6).
       *
       * `safetyIdentifier` is the sixth field, added by B10. It carries the already-derived opaque
       * value from above — never the uuid it was derived from, never the key, never the message that
       * was signed, and never anything the caller sent.
       */
      const providerRequest: ProviderRequest = {
        instructions: buildInstructions(),
        userInput: parsed.request.message,
        maxOutputTokens: config.maxOutputTokens,
        store: false,
        languageHint: locale.locale,
        safetyIdentifier: derived.identifier,
      };

      const run = await callProvider(
        providerRequest,
        deadlineMs,
        (attemptNumber, result) =>
          withAccountingRetry(() =>
            quota.registerAttempt(
              auth.claims.userId,
              reservationId,
              attemptNumber,
              // Counts only. The handler never computes, receives or sends a money value — the
              // database derives cost from its own price table (§I.2).
              result.usage ?? NO_USAGE,
              outcomeClass(result),
            )
          ),
      );

      const { outcome } = run;
      draft.provider_outcome = outcome.kind;
      draft.provider_attempts = run.attempts;
      draft.attempts_registered = run.registered;

      /**
       * ── Post-provider accounting failure ───────────────────────────────────
       *
       * An attempt happened and the store did not record it. Three things follow, and each is a
       * choice rather than a default:
       *
       *   • **No further provider call.** Already guaranteed inside `callProvider`; restated because
       *     the tempting fix — "retry the whole thing" — spends more money to fix a bookkeeping
       *     problem.
       *   • **No release.** Releasing here would assert the reservation went unused, which is false:
       *     a provider attempt occurred and may have been billed. The lease is left to expire, and
       *     the store's late-accounting rule then permits the incurred cost to be recorded after
       *     expiry — exactly the case that rule was written for.
       *   • **No success.** The user gets §I.5's stable `503`. Returning the answer would mean
       *     serving a response NoorLife cannot account for, and §I.2's ceilings are only as good as
       *     the spend they can see.
       *
       * The log carries `accounting: 'failed'` and the safe `request_id`, and nothing else — no
       * subject, no reservation id, no token counts and no database text.
       */
      if (run.accountingFailed) {
        draft.accounting = 'failed';
        return fail('service_unavailable');
      }

      if (run.registered === 0) {
        // No attempt was incurred, so the reservation is genuinely unused (§F.7 / §K's `unavailable`).
        await releaseUnused();
      } else {
        /**
         * Settle once. The store is idempotent on finalize, so a replay adds nothing — but a *failed*
         * finalize means the attempts are recorded and the spend is not yet accumulated, which is the
         * same under-count as above and gets the same answer.
         */
        const settled = await withAccountingRetry(() =>
          quota.finalize(auth.claims.userId, reservationId)
        );
        if (!settled) {
          draft.accounting = 'failed';
          return fail('service_unavailable');
        }
        draft.accounting = 'complete';
      }

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

        case 'provider-configuration-error':
          /**
           * §F.8 / §J.13d — the provider refused the credential. **No retry**, because a wrong or
           * unpermitted key is not a condition a second identical request improves, and an alert,
           * because §F.8 says a `401` "must page a human".
           *
           * The client's answer is byte-identical to the `unavailable` case below: §I.5's stable
           * `503`, with nothing that distinguishes a missing key from an invalid one, a revoked one
           * or a region restriction. What differs is entirely internal — the attempt was registered
           * as incurred above, the reservation is settled rather than released, and the log carries
           * a coarse alert an operator can route on.
           */
          draft.operator_alert = 'provider_configuration';
          return fail('service_unavailable');

        case 'unavailable':
          /**
           * No provider is configured, so **nothing left the process** — see `attemptWasIncurred`,
           * which reads this member as "free". The request fails closed with §I.5's stable `503`
           * after authentication and validation have both run, and it is never a canned answer.
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
