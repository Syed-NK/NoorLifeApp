import type {
  AttemptOutcomeClass,
  ProviderUsage,
  QuotaAck,
  QuotaDenialReason,
  QuotaStore,
} from './ports.ts';

/**
 * The quota store adapter — the one module in this function that reaches the network.
 *
 * ── What this file is, and why it is the only one of its kind ────────────────
 * Everything else in this directory is a pure function over injected ports. This file is the single
 * deliberate exception: it speaks PostgREST to the five `service_role`-only wrappers in `public` that
 * `supabase/migrations/20260808180000_noor_ai_quota_store.sql` created. It exists **only** inside the
 * Edge Function server boundary. The mobile app holds the publishable key and must never contain a
 * service-role reference in any spelling — `src/services/auth/__tests__/supabase-security.test.ts`
 * asserts that over the whole application source, and `tests/source-scan_test.ts` asserts that this
 * is the *only* file here that names the platform secret or calls `fetch`.
 *
 * ── Why the private schema is unreachable from here ──────────────────────────
 * PostgREST can only see the schemas in `[api] schemas`, which is `public` + `graphql_public`. A
 * `noor_ai.*` function is therefore not addressable over this transport at all — which is precisely
 * why the five thin wrappers exist. This adapter calls them by exact name; there is no schema
 * parameter, no table path, and no query-builder surface, so "it must not read a quota table" is a
 * capability it does not have rather than a rule it follows.
 *
 * ── No retries ───────────────────────────────────────────────────────────────
 * Not one. `reserve` and `register_attempt` are idempotent in the database under keys the *caller*
 * supplies — `(subject_id, request_id)` and `(reservation_id, attempt_number)` — so a blind retry
 * here would in fact be safe for them. It is still not done, for a reason worth stating: a retry
 * inside the adapter is invisible to the handler's budget, and the handler is the only thing that
 * knows how much time is left before §F.7's deadline. A retry policy that cannot see the deadline is
 * a retry policy that can blow through it. If AI-3 later wants one, it belongs above this port.
 *
 * ── What never crosses this boundary ─────────────────────────────────────────
 * The caller's `Authorization` header is never forwarded — this call authenticates as the server, not
 * as the user, and passing the user's token would both fail (the wrappers refuse `authenticated`) and
 * leak it into a second system. No prompt, no answer, no email, no session id and no money value is
 * sent: the parameter lists below are the whole outbound surface, and every one is a uuid, a bounded
 * id, an integer count or a three-value enum.
 */

/**
 * The environment this adapter reads. Names only — no value appears in this repository.
 *
 * Both are platform-injected into a deployed Edge Function. `SUPABASE_SERVICE_ROLE_KEY` is a secret
 * and is read exactly once, here, at construction; it is never logged, never returned, never placed
 * in a URL, and never written to any diagnostic surface.
 */
export const QUOTA_URL_ENV = 'SUPABASE_URL';
export const QUOTA_KEY_ENV = 'SUPABASE_SERVICE_ROLE_KEY';

/** The five approved wrappers, by exact name. Nothing else is addressable through this adapter. */
export const QUOTA_WRAPPERS = {
  reserve: 'noor_ai_reserve',
  registerAttempt: 'noor_ai_register_attempt',
  finalize: 'noor_ai_finalize',
  release: 'noor_ai_release',
  status: 'noor_ai_status',
} as const;

/** The database bounds `request_id` to 1..64 characters. Checked here so a long id fails closed. */
const MAX_QUOTA_REQUEST_ID = 64;

/** Every reason string the store can return, as a lookup rather than a cast. */
const DENIAL_REASONS: Readonly<Record<string, QuotaDenialReason>> = {
  per_user_minute: 'per_user_minute',
  per_user_hour: 'per_user_hour',
  per_user_day: 'per_user_day',
  global_minute: 'global_minute',
  global_day: 'global_day',
  concurrency: 'concurrency',
  daily_spend: 'daily_spend',
  monthly_spend: 'monthly_spend',
  disabled: 'disabled',
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A Supabase project API hostname: exactly one label, then `.supabase.co`.
 *
 * Anchored at both ends, which is what rejects the deceptive-suffix attack — a host like
 * `project.supabase.co.attacker.example` *contains* `.supabase.co` but does not end with it. The
 * single label also rejects the bare apex `supabase.co`, which is not a project and would be a
 * different service entirely.
 */
const PROJECT_HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?\.supabase\.co$/;

/** The only hosts that may be reached over plain HTTP. Same machine, so no transport risk. */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Whether a configured base URL may be handed the service-role credential — and the origin to use.
 *
 * ── Why the environment is not trusted ───────────────────────────────────────
 * `SUPABASE_URL` is platform-injected, which makes it *conventionally* trustworthy and not
 * *structurally* so. Anything that can set an environment variable on the function — a compromised
 * deployment pipeline, a mistaken `supabase secrets set`, a copy-paste into the wrong project — can
 * redirect every quota RPC to a host of its choosing, and each of those requests carries
 * `apikey: <service-role key>` and `Authorization: Bearer <service-role key>` in its headers. That is
 * a full credential exfiltration through a value nobody thinks of as attacker-controlled, and the
 * service-role key bypasses RLS on the entire database.
 *
 * So the URL is parsed and checked against a closed shape before the adapter is built. This is not
 * defence against a caller — no caller can influence it — it is defence against the value being wrong.
 *
 * Returns the normalised origin, or `null`. The rejected URL is deliberately **not** returned,
 * logged, or embedded in any message: a misconfigured value can itself be sensitive (it may carry
 * credentials in its userinfo), and an error string is the easiest way for one to reach a log.
 */
export function resolveQuotaOrigin(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  // Credentials in the URL, a query string or a fragment are never legitimate here, and userinfo in
  // particular is a way to smuggle a secret into a place that gets logged.
  if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') {
    return null;
  }

  // The origin and nothing else. `new URL` normalises an absent path to `/`, so this accepts both
  // `https://host` and one trailing slash while rejecting any real path segment.
  if (url.pathname !== '/') {
    return null;
  }

  if (LOOPBACK_HOSTS.has(url.hostname)) {
    /**
     * Local development. HTTP is permitted here and nowhere else — the request never leaves the
     * machine, so there is no transport to intercept — and HTTPS loopback is accepted too.
     *
     * An explicit port is **required**, not merely expected. The local Supabase stack never listens
     * on 80 or 443, so a portless loopback URL is not a working local configuration; it is a
     * truncated or half-edited value. `URL` strips the default port, so `url.port` being empty means
     * either that no port was written or that the default was, and both are refused. Accepting them
     * would let a mistyped `SUPABASE_URL` resolve to whatever happens to be listening on 80 on the
     * same host, which is exactly the class of surprise this validation exists to remove.
     */
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }
    return url.port === '' ? null : url.origin;
  }

  // Everything else must be a real project over TLS.
  if (url.protocol !== 'https:') {
    return null;
  }
  if (!PROJECT_HOST.test(url.hostname)) {
    return null;
  }
  // `URL` strips the default port, so a non-empty port here is always an explicit, non-default one.
  if (url.port !== '') {
    return null;
  }
  return url.origin;
}

export type QuotaRpcConfig = {
  /** Platform-injected project URL. Not a secret. */
  readonly supabaseUrl: string | undefined;
  /** Platform-injected service-role secret. Read once; never logged, returned or embedded. */
  readonly serviceRoleKey: string | undefined;
  /** Bounded wall clock for every call. Must sit well inside §F.7's handler budget. */
  readonly timeoutMs: number;
  /** Injected so a test can drive the transport without a network. Defaults to global `fetch`. */
  readonly fetchImpl?: typeof fetch;
};

/**
 * A store that can only refuse.
 *
 * Returned when the platform supplied no URL or no key, which is the state of every environment in
 * this phase: nothing is deployed and no secret is set. It is not an error path bolted on — it is the
 * honest answer to "can this function account for spend?", and the handler turns it into `503`. An
 * adapter that silently allowed the request when it could not reach the store would be an unmetered
 * AI endpoint, which §I.1 is explicit is worse than an unavailable one.
 */
export const unavailableQuotaStore: QuotaStore = {
  // deno-lint-ignore require-await
  reserve: async () => ({ kind: 'unavailable' }),
  // deno-lint-ignore require-await
  registerAttempt: async () => ({ ok: false }),
  // deno-lint-ignore require-await
  finalize: async () => ({ ok: false }),
  // deno-lint-ignore require-await
  release: async () => ({ ok: false }),
  // deno-lint-ignore require-await
  status: async () => ({ ok: false }),
};

/** A JSON object, narrowed once so every reader below works on a known shape. */
function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function createQuotaRpcStore(config: QuotaRpcConfig): QuotaStore {
  const key = config.serviceRoleKey ?? '';
  const baseUrl = resolveQuotaOrigin(config.supabaseUrl ?? '');
  /**
   * A rejected URL or a missing key yields the store that can only refuse, and it does so *before*
   * the transport exists — so an invalid configuration cannot make even one request, and the
   * credential is never handed to a host that failed the check.
   */
  if (baseUrl === null || key === '') {
    return unavailableQuotaStore;
  }
  const call = config.fetchImpl ?? fetch;

  /**
   * One RPC, with a bounded wall clock and no way to leave a timer behind.
   *
   * The timeout is cleared in `finally`, so it is cleared on success, on rejection and on abort
   * alike; and nothing here creates a promise it does not await, so an aborted call cannot surface
   * later as an unhandled rejection. `null` means "no usable answer" for every failure mode —
   * transport, status, parse and shape — because the caller's response is identical for all of them
   * and a caller that could tell them apart could accidentally treat one as success.
   */
  const rpc = async (
    wrapper: string,
    params: Readonly<Record<string, unknown>>,
  ): Promise<Record<string, unknown> | null> => {
    const controller = new AbortController();
    const handle = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      const response = await call(`${baseUrl}/rest/v1/rpc/${wrapper}`, {
        method: 'POST',
        headers: {
          // The server's own credential. The caller's Authorization header is never forwarded.
          'apikey': key,
          'authorization': `Bearer ${key}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(params),
        signal: controller.signal,
      });
      if (!response.ok) {
        // The status is not read into a message and the body is not consumed: §I.6 forbids backend
        // detail reaching a user, and the surest way to honour that is never to hold it.
        return null;
      }
      return asRecord(await response.json());
    } catch {
      // Transport failure, abort, or unparseable JSON. Nothing about the error is captured.
      return null;
    } finally {
      clearTimeout(handle);
    }
  };

  const ackFrom = (payload: Record<string, unknown> | null): QuotaAck => {
    if (payload === null) {
      return { ok: false };
    }
    // A configuration failure is explicitly not an ack, even though the call itself succeeded.
    if (payload.configuration_error === true) {
      return { ok: false };
    }
    return { ok: payload.ok === true };
  };

  return {
    reserve: async (subjectId, quotaRequestId) => {
      if (
        !UUID.test(subjectId) || quotaRequestId.length < 1 ||
        quotaRequestId.length > MAX_QUOTA_REQUEST_ID
      ) {
        return { kind: 'unavailable' };
      }
      const payload = await rpc(QUOTA_WRAPPERS.reserve, {
        p_subject_id: subjectId,
        p_request_id: quotaRequestId,
      });
      if (payload === null) {
        return { kind: 'unavailable' };
      }
      /**
       * `{ configuration_error: true, decision: 'unavailable' }` is the store telling us a required
       * ceiling is missing, duplicated, null or non-positive. It is a store fault, not a denial, and
       * it maps to `503` — never `429`. Checked first so it cannot be read as anything else.
       */
      if (payload.configuration_error === true) {
        return { kind: 'unavailable' };
      }
      const decision = payload.decision;
      if (decision === 'allowed' || decision === 'replayed') {
        const reservationId = payload.reservation_id;
        // A reservation id that is not a uuid is a shape this adapter does not recognise, and
        // proceeding on it would mean accounting against something that cannot be settled.
        return typeof reservationId === 'string' && UUID.test(reservationId)
          ? { kind: 'allowed', reservationId }
          : { kind: 'unavailable' };
      }
      if (decision === 'limited') {
        const reason = typeof payload.reason === 'string'
          ? DENIAL_REASONS[payload.reason]
          : undefined;
        // An unrecognised reason fails closed rather than being passed through as a 429: a denial we
        // cannot classify is one we cannot honestly tell the user how to respond to.
        return reason === undefined ? { kind: 'unavailable' } : { kind: 'limited', reason };
      }
      return { kind: 'unavailable' };
    },

    registerAttempt: async (
      subjectId: string,
      reservationId: string,
      attemptNumber: 1 | 2,
      usage: ProviderUsage,
      outcome: AttemptOutcomeClass,
    ) => {
      if (!UUID.test(subjectId) || !UUID.test(reservationId)) {
        return { ok: false };
      }
      return ackFrom(
        await rpc(QUOTA_WRAPPERS.registerAttempt, {
          p_subject_id: subjectId,
          p_reservation_id: reservationId,
          p_attempt_number: attemptNumber,
          p_input_tokens: usage.inputTokens,
          p_output_tokens: usage.outputTokens,
          p_reasoning_tokens: usage.reasoningTokens,
          // A coarse class. No provider message, body, id or money value is sent — the database
          // computes cost itself from its own price table.
          p_outcome: outcome,
        }),
      );
    },

    finalize: async (subjectId, reservationId) => {
      if (!UUID.test(subjectId) || !UUID.test(reservationId)) {
        return { ok: false };
      }
      return ackFrom(
        await rpc(QUOTA_WRAPPERS.finalize, {
          p_subject_id: subjectId,
          p_reservation_id: reservationId,
        }),
      );
    },

    release: async (subjectId, reservationId) => {
      if (!UUID.test(subjectId) || !UUID.test(reservationId)) {
        return { ok: false };
      }
      return ackFrom(
        await rpc(QUOTA_WRAPPERS.release, {
          p_subject_id: subjectId,
          p_reservation_id: reservationId,
        }),
      );
    },

    status: async (subjectId) => {
      if (!UUID.test(subjectId)) {
        return { ok: false };
      }
      return ackFrom(await rpc(QUOTA_WRAPPERS.status, { p_subject_id: subjectId }));
    },
  };
}
