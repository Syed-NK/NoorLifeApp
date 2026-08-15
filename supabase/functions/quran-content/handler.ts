import { CONTRACT_VERSION, type ErrorCode, type QuranOperation } from './contract.ts';
import { normalizePayload } from './normalize.ts';
import { parseRequestBody, readBody } from './request-schema.ts';
import { errorResponse, formatRequestId, preflightResponse, successResponse } from './responses.ts';
import type {
  AuthFailureReason,
  CatalogueOutcome,
  NormalizeReason,
  OperationalLogRecord,
  QuranContentDependencies,
  UpstreamMalformedReason,
  UpstreamOutcomeKind,
} from './ports.ts';

/**
 * The `quran-content` handler, as a factory over its dependencies.
 *
 * ── What this endpoint is, stated where it cannot be lost ────────────────────
 * A **read-only proxy for approved Quran Foundation Content API operations**, and nothing else. It
 * holds no user data, writes nothing, reads no database, and its entire outbound surface is the seven
 * fixed routes in `quran-foundation-client.ts`. Quran Foundation approved Content API access on
 * 2026-08-10; **Search, the OAuth user APIs, bookmarks and notes are not approved**, and none of them
 * is reachable from here — not because the handler declines to call them, but because
 * `request-schema.ts` cannot produce a query naming one and the client has no route for one.
 *
 * ── The authentication boundary, restated because it must live in the code ───
 * This handler authenticates a caller by verifying a JWT's signature and claims. That establishes
 * **identity and issuance** and nothing else. It does **not** establish that the caller's session
 * still exists: a signed, correctly scoped, unexpired `authenticated`-role JWT **may remain accepted
 * until it expires**, which at `jwt_expiry = 3600` is up to one hour after the user signed out. No
 * `auth.sessions` lookup happens here, and no response, log line or comment anywhere in this function
 * may describe it as if one did.
 *
 * That gap costs less here than it does anywhere else in the product, and the reason is worth being
 * precise about rather than reassuring: what a stale token buys is the ability to read public Qur'anic
 * scripture, which is published, free, and served to anyone Quran Foundation approves. There is no
 * personal record behind this endpoint to expose and no per-user state to alter. The authentication
 * requirement exists to keep NoorLife's vendor credential attached to NoorLife's own users rather than
 * to the open internet, and an expired-but-unrevoked token is still one of NoorLife's users.
 *
 * ── Why the whole handler is a closure over injected ports ───────────────────
 * It constructs nothing: not the verifier, not the upstream client, not the clock, the timer, the
 * request-id source or the logger. That is what makes every case below testable with no Docker, no
 * project, no network and **no Quran Foundation credential** — and what lets a test hold the only
 * reference to the thing that would have contacted the vendor and prove it was never called.
 *
 * ── The order of checks, and why it is this order ────────────────────────────
 *   1. Request id, so every handler-produced response carries one.
 *   2. Path → `404`, method → `405`, `OPTIONS` → preflight without authentication.
 *   3. Authentication. Nothing reads the body for a caller who has not authenticated.
 *   4. `Content-Type` → `415`, then the byte cap → `413`, then parse and schema → `400`.
 *   5. The upstream.
 *
 * Validation sits ahead of the upstream call so a malformed request never becomes a request to Quran
 * Foundation. The vendor's rate limits are NoorLife's to respect, and the cheapest way to respect them
 * is not to spend one on a request that was already known to be wrong.
 */

const FUNCTION_NAME = 'quran-content';

/** `/functions/v1/` is Supabase's platform path prefix, not NoorLife's contract version. */
const PLATFORM_PREFIX = '/functions/v1';

/**
 * Whether the request addresses the function itself rather than a path under it.
 *
 * The local stack and the deployed platform present the path differently — `/functions/v1/quran-content`
 * against `/quran-content` — so both are accepted, and anything deeper is a `404` rather than something
 * quietly answered. No query parameter is read anywhere in this handler: only `pathname` is consulted
 * below, so a query string cannot influence behaviour and cannot reach a log.
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

/** Every handler auth rejection produces the same body. Only the log distinguishes them. */
function authErrorCode(reason: AuthFailureReason): ErrorCode {
  return reason === 'verifier-unavailable' ? 'service_unavailable' : 'unauthenticated';
}

/** A mutable accumulator for the single log line each request emits. */
type LogDraft = {
  outcome: OperationalLogRecord['outcome'];
  http_status: number;
  error_code: ErrorCode | null;
  error_field: string | null;
  auth_reason: AuthFailureReason | null;
  operation: QuranOperation | null;
  upstream_outcome: UpstreamOutcomeKind | null;
  upstream_reason: UpstreamMalformedReason | null;
  upstream_attempts: number;
  token_renewed: boolean;
  catalogue_fetched: boolean;
  catalogue_outcome: CatalogueOutcome | null;
  normalize_reason: NormalizeReason | null;
  retry_after_seconds: number | null;
  operator_alert: OperationalLogRecord['operator_alert'];
};

export function createQuranContentHandler(
  deps: QuranContentDependencies,
): (request: Request) => Promise<Response> {
  const { verifier, upstream, clock, timer, requestIds, logger, config } = deps;

  return async (request: Request): Promise<Response> => {
    const startedAt = clock.now();
    const requestId = formatRequestId(requestIds.nextUuid());

    /**
     * Every field starts at a value meaning "we never got that far", so a log record is honest about
     * a request that failed early rather than reporting a default that looks like a measurement.
     */
    const draft: LogDraft = {
      outcome: 'error',
      http_status: 500,
      error_code: null,
      error_field: null,
      auth_reason: null,
      operation: null,
      upstream_outcome: null,
      upstream_reason: null,
      upstream_attempts: 0,
      token_renewed: false,
      catalogue_fetched: false,
      catalogue_outcome: null,
      normalize_reason: null,
      retry_after_seconds: null,
      operator_alert: null,
    };

    const emit = (): void => {
      logger.record({
        event: 'quran_content_request',
        request_id: requestId,
        contract_version: CONTRACT_VERSION,
        http_status: draft.http_status,
        outcome: draft.outcome,
        error_code: draft.error_code,
        error_field: draft.error_field,
        auth_reason: draft.auth_reason,
        operation: draft.operation,
        upstream_outcome: draft.upstream_outcome,
        upstream_reason: draft.upstream_reason,
        upstream_attempts: draft.upstream_attempts,
        token_renewed: draft.token_renewed,
        catalogue_fetched: draft.catalogue_fetched,
        catalogue_outcome: draft.catalogue_outcome,
        normalize_reason: draft.normalize_reason,
        retry_after_seconds: draft.retry_after_seconds,
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
       * The preflight, answered without authentication and without a log line.
       *
       * Nothing was authenticated and nothing was asked, so there is no request to record. A log entry
       * per preflight would be volume without signal, and the record type has no honest shape for one.
       */
      if (request.method === 'OPTIONS') {
        return preflightResponse();
      }

      if (request.method !== 'POST') {
        return fail('method_not_allowed');
      }

      /**
       * ── Authentication, before the body is read ───────────────────────────
       *
       * `verify_jwt = true` is declared for this function in `supabase/config.toml`, so the platform
       * inspects the `Authorization` header before this code runs and answers `401` itself when it
       * cannot. This is the second gate, and it is not redundant: the documentation describes what the
       * gateway does in one sentence and does not enumerate which claims it checks, so the claim this
       * function actually depends on — `role === 'authenticated'`, which is what separates a signed-in
       * person from a correctly signed `anon` key — is asserted where it can be seen and tested. It
       * also keeps the handler correct if the gateway is ever reconfigured.
       *
       * There is no user identity in the request body to check it against, and there could not be:
       * `ACCEPTED_REQUEST_FIELDS` names no identity field, so a client-supplied user id is a `400`
       * rather than something this handler has to decide whether to trust.
       */
      const auth = await verifier.verify(request.headers.get('authorization'));
      if (!auth.ok) {
        draft.auth_reason = auth.reason;
        return fail(authErrorCode(auth.reason));
      }

      // Parameters such as `; charset=utf-8` are legal and must not be treated as a different type,
      // so only the media type itself is compared — exactly, not by prefix or suffix.
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
        // The unparseable text is not logged. It is caller-controlled bytes.
        return fail('invalid_request', 'body');
      }

      const parsed = parseRequestBody(parsedJson);
      if (!parsed.ok) {
        draft.error_field = parsed.failure.field ?? null;
        return fail(parsed.failure.code, parsed.failure.field);
      }
      draft.operation = parsed.operation;

      /**
       * ── The upstream budget, actually aborting the connection ─────────────
       *
       * One controller for the whole upstream operation, not one per attempt. That is deliberate: the
       * single permitted retry lives inside the client, and giving the retry its own fresh budget
       * would let a request that has already spent the deadline start another one. The budget is the
       * authority on whether an answer arrived in time, and it covers both attempts and any token
       * exchange between them.
       *
       * The timer is the injected port, so a test fires it rather than waiting — and because the
       * signal is passed to the client, a fake can observe the abort and prove the operation was
       * cancelled rather than merely abandoned.
       */
      if (clock.now() - startedAt >= config.handlerBudgetMs) {
        // The budget was gone before the upstream was reached. Nothing was requested.
        return fail('timeout');
      }

      const controller = new AbortController();
      let timedOut = false;
      const cancelTimer = timer.schedule(config.upstreamTimeoutMs, () => {
        timedOut = true;
        controller.abort();
      });

      let result;
      try {
        result = await upstream.read(parsed.query, controller.signal);
      } finally {
        cancelTimer();
      }

      draft.upstream_attempts = result.attempts;
      draft.token_renewed = result.tokenRenewed;
      draft.catalogue_fetched = result.catalogueFetched === true;
      draft.catalogue_outcome = result.catalogueOutcome ?? null;
      // A client that resolves after the abort still yields a timeout: the budget is the authority on
      // whether the answer arrived in time, not the vendor.
      const outcome = timedOut ? ({ kind: 'timeout' } as const) : result;
      draft.upstream_outcome = outcome.kind;

      switch (outcome.kind) {
        case 'ok': {
          /**
           * A `200` is not yet an answer. `normalizePayload` validates every field, and a body that
           * does not match the documented shape becomes `upstream_unavailable` rather than being
           * passed through — because the alternative is rendering unvalidated third-party text as
           * scripture, which is the one failure this integration exists to make impossible.
           */
          const normalized = normalizePayload(parsed.query, outcome.body, result.attribution);
          if (!normalized.ok) {
            /**
             * Which check refused it, recorded before the response is built.
             *
             * `upstream_outcome: ok` beside `error_code: upstream_unavailable` used to be the end of
             * the trail: the vendor answered, NoorLife refused, and nothing said why. The reason is a
             * closed enum of check *names* — see `NormalizeReason` — so it narrows an investigation
             * without carrying a byte of what was rejected. Read together with `catalogue_outcome`,
             * `normalize_reason: 'attribution'` names both the branch and its cause.
             */
            draft.normalize_reason = normalized.reason;
            return fail('upstream_unavailable');
          }
          const built = successResponse(requestId, parsed.operation, normalized.value);
          draft.outcome = 'ok';
          draft.http_status = 200;
          emit();
          return built.response;
        }

        case 'not-found':
          // The vendor has no such chapter, verse or edition. The caller's doing, and honestly a `404`.
          return fail('not_found');

        case 'rate-limited':
          /**
           * NoorLife's whole deployment shares one vendor quota, so this is **not** a statement about
           * the caller's behaviour — but it is the one failure where waiting genuinely helps, and the
           * user's action either way is the same. The vendor's hint is passed through because it is a
           * number rather than a message: a retry delay carries no account, quota or client detail.
           */
          return fail(
            'rate_limited',
            undefined,
            outcome.retryAfterSeconds ?? undefined,
          );

        case 'unauthorized':
          /**
           * A freshly exchanged token was refused. The **caller's** session was fine, so this is
           * emphatically not a `401`: telling a signed-in user to sign in again for NoorLife's own
           * credential problem would send them round a loop that cannot help.
           *
           * It pages a human. Rotating or re-scoping the client credentials is the remedy, and
           * nothing about which of those it is reaches the client or the log.
           */
          draft.operator_alert = 'credentials_rejected';
          return fail('service_unavailable');

        case 'unconfigured':
          /**
           * **No credential is configured, so nothing left the process.**
           *
           * The fail-closed path, and the one that must never grow an alternative. There is no branch
           * here that serves scripture from a fixture, a cache seeded at build time, or any source
           * other than the approved one — the client's honest report is that Qur'an content is
           * unavailable, and the app renders that as a configuration state rather than as content.
           */
          draft.operator_alert = 'credentials_missing';
          return fail('service_unavailable');

        case 'timeout':
          // We waited and gave up. Never a partial payload, and never an invented one.
          return fail('timeout');

        case 'transient':
          /**
           * The vendor failed. A `502`, and the distinction from `malformed` below is recorded in
           * `upstream_outcome` for whoever investigates rather than told to the client.
           */
          return fail('upstream_unavailable');

        case 'malformed':
          /**
           * The vendor answered something this contract does not recognise — and **which** something
           * is recorded here, in the log alone.
           *
           * `malformed` stood for five unrelated situations with five different remedies, which is
           * why a snapshot failing on every attempt was undiagnosable: a contract disagreement, an
           * empty body, either of the two size bounds and an unparseable body all logged the same
           * word. The reason is a closed enum of branch names — see `UpstreamMalformedReason` — so it
           * narrows the investigation without carrying a status code, a byte count or a byte of what
           * was rejected.
           *
           * The response is unchanged and stays deliberately generic: the same
           * `502 upstream_unavailable` body every other vendor failure produces. Which branch refused
           * is an operational fact, not something a client is told.
           *
           * `streamed_too_large` is the member that carried this route to its own bound: both approved
           * snapshots reported it against the 1 MiB limit, and both fit inside the 8 MiB one they now
           * have. It stays exactly as it is — a snapshot past *that* bound reports the same word, and
           * the client still sees the same generic refusal either way.
           */
          draft.upstream_reason = outcome.reason;
          return fail('upstream_unavailable');
      }
    } catch {
      /**
       * The only thing this block is allowed to know.
       *
       * The exception is not inspected, not logged and not described. An unhandled fault here could
       * carry an upstream body, a header or a credential fragment in its message, and the platform's
       * own runtime logs are where an operator looks for what it was.
       */
      return fail('internal_error');
    }
  };
}
