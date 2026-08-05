import type { ClaimsPolicy } from './claims.ts';
import { createJwtClaimsVerifier } from './jwt-verifier.ts';
import type {
  AIProvider,
  Clock,
  HandlerConfig,
  Logger,
  NoorAIDependencies,
  OperationalLogRecord,
  RateLimiter,
  RequestIdSource,
  Timer,
} from './ports.ts';

/**
 * The production dependency graph.
 *
 * ── This file is the reason the phase can say "no key exists anywhere" ───────
 * Every port below is production-safe in the strict sense that AI-2 needs: none of them holds a
 * credential, none of them opens a socket, and two of them exist specifically to *refuse*. There is no
 * fake here and no switch that selects one — no request field, no header, no query parameter and no
 * environment flag chooses a different provider, because there is only one provider in this module
 * graph and it is the one that declines.
 *
 * ── The three independent reasons AI-2 is unavailable in production ──────────
 * Layered deliberately, so that flipping any single one of them in AI-3 cannot accidentally open the
 * endpoint:
 *
 *   1. **The kill switch is off** (§I.2). Noor AI is not enabled for this deployment, because there is
 *      nothing behind it to enable.
 *   2. **The rate limiter cannot answer** (§I.1, §12.7). No shared store has been selected, and an
 *      in-memory counter in an ephemeral isolate is not a rate limit, so it fails closed.
 *   3. **The provider is unavailable** (§K). No provider is configured, so there is nothing to call.
 *
 * A request therefore fails closed with §I.5's stable `503 service_unavailable` *after* authentication
 * and validation have run — which is what makes the AI-2 skeleton useful: the whole request path is
 * exercised and nothing is answered.
 */

/**
 * The provider that is not there.
 *
 * ── An `unavailable` provider rather than a stub that answers ────────────────
 * The temptation in a skeleton phase is a provider that returns "Hello from Noor AI", and it is exactly
 * the wrong thing to ship: a canned answer in the production graph is a canned answer one misconfigured
 * deployment away from a user reading it and believing it. So the production provider's only behaviour is
 * to report that there is no provider.
 *
 * It performs no network call. It imports nothing. `signal` is accepted because the port requires it and
 * ignored because there is no operation to abort — noted here so its absence reads as deliberate rather
 * than forgotten.
 *
 * §F.1's boundary — `POST https://api.openai.com/v1/responses`, the Responses API — is what AI-3
 * implements behind this port once §F.10's data-control decision is on record and a key exists. Nothing
 * in this file names, imports or reaches it, and `tests/source-scan_test.ts` asserts that for the whole
 * directory.
 */
export const unavailableProvider: AIProvider = {
  // deno-lint-ignore require-await
  generate: async () => ({ kind: 'unavailable' }),
};

/**
 * The limiter that refuses rather than guesses (§I.1, §12.7).
 *
 * §I.1 states the constraint that rules out the obvious implementation: "an Edge Function runs in
 * ephemeral, horizontally-scaled isolates, so an in-memory counter is not a rate limit. It resets on cold
 * start and each isolate counts separately, which yields a limit that is neither enforced nor
 * observable."
 *
 * So there is no counter here. Presenting one as distributed rate limiting would be the specific
 * dishonesty §12.7 and §J.13b exist to catch — and §J.13b is an **AI-3** row precisely because it is the
 * test that fails against a naive implementation. AI-3 chooses the store (Postgres table, external KV, or
 * something reviewed) and the numbers; until then the answer is `unavailable`, which the handler turns
 * into `503`.
 */
export const unavailableRateLimiter: RateLimiter = {
  // deno-lint-ignore require-await
  check: async () => ({ kind: 'unavailable' }),
};

export const systemClock: Clock = {
  now: () => Date.now(),
};

export const systemTimer: Timer = {
  schedule: (delayMs, onFire) => {
    const handle = setTimeout(onFire, delayMs);
    return () => clearTimeout(handle);
  },
};

/**
 * §I.7 — a v4 uuid from the platform's CSPRNG.
 *
 * "It is random, not derived from the user, the message, or the time", which `crypto.randomUUID`
 * satisfies and a counter or a timestamp would not.
 */
export const cryptoRequestIds: RequestIdSource = {
  nextUuid: () => crypto.randomUUID(),
};

/**
 * The structured logger — §H.3's allow-list serialiser.
 *
 * ── Why every key is written out by hand ─────────────────────────────────────
 * `{ ...entry }` would be shorter and would defeat the purpose. §H.3 requires "an allow-list serialiser,
 * not a deny-list regex over free text", and the failure mode it is guarding against is a *future* change
 * widening the record type and a spread quietly carrying the new field into the log. Enumerating the keys
 * means a new field is invisible to the log until somebody adds a line here, which is a diff a reviewer
 * sees.
 *
 * There is exactly one `console` call in this function's source, and it is the next statement. §H.3:
 * "Structured logging only, one JSON object per request, and never bare `console.log` of an object whose
 * shape a future change might widen." Development is not an exception — "A prompt printed to a terminal
 * is a prompt in a scrollback buffer, a screen recording, and a bug report attachment."
 */
export const structuredLogger: Logger = {
  record: (entry: OperationalLogRecord) => {
    console.log(
      JSON.stringify({
        event: entry.event,
        request_id: entry.request_id,
        contract_version: entry.contract_version,
        policy_version: entry.policy_version,
        http_status: entry.http_status,
        outcome: entry.outcome,
        refusal_kind: entry.refusal_kind,
        error_code: entry.error_code,
        error_field: entry.error_field,
        auth_reason: entry.auth_reason,
        safety_category: entry.safety_category,
        message_length: entry.message_length,
        surface_accepted: entry.surface_accepted,
        locale_accepted: entry.locale_accepted,
        rate_limit_state: entry.rate_limit_state,
        retry_after_seconds: entry.retry_after_seconds,
        provider_outcome: entry.provider_outcome,
        provider_attempts: entry.provider_attempts,
        upstream_malformed: entry.upstream_malformed,
        operator_alert: entry.operator_alert,
        duration_ms: entry.duration_ms,
      }),
    );
  },
};

/**
 * The AI-2 production handler configuration.
 *
 * `enabled: false` is §I.2's kill switch in its off position, and it is a constant rather than an
 * environment lookup on purpose: a flag read from the environment is a flag that can be turned on by
 * whoever sets an environment variable, and turning Noor AI on is AI-3's decision gated on §F.10's
 * written data-control review — not a deployment setting.
 *
 * The three numbers are placeholders this phase never gets to use. §F.7 is explicit that concrete values
 * are "set in AI-3 against measured latency for the selected model" and that "Fixing numbers here before
 * anything has been measured would be inventing them". They are shaped correctly — the handler budget is
 * strictly greater than the upstream budget, as §F.7 requires — and nothing more should be read into
 * them.
 */
export const productionConfig: HandlerConfig = {
  enabled: false,
  maxOutputTokens: 512,
  upstreamTimeoutMs: 20_000,
  handlerBudgetMs: 25_000,
  retryBackoffMs: 500,
};

/**
 * The claim policy, derived from the platform-injected project URL.
 *
 * Supabase issues user tokens with `iss` of `<project URL>/auth/v1` and `aud` of `authenticated`. Both are
 * required by §D.4 row 5. `SUPABASE_URL` is injected by the platform, so neither value is configuration
 * anybody has to remember to set, and neither is a secret.
 */
export function claimsPolicyFor(supabaseUrl: string | undefined): ClaimsPolicy {
  return {
    issuer: `${(supabaseUrl ?? '').replace(/\/+$/, '')}/auth/v1`,
    audience: 'authenticated',
    /** §D.3 — leeway on `nbf`/`iat` only. `exp` is checked strictly; see `claims.ts`. */
    clockSkewSeconds: 5,
  };
}

/** The environment values this function reads. Named as a type so the list is reviewable. */
export type ProductionEnvironment = {
  /** Platform-injected. Not a secret. */
  readonly supabaseUrl: string | undefined;
  /**
   * Platform-injected `SUPABASE_JWKS` — the project's **public** verification keys.
   *
   * Not a secret, and deliberately the only key material this function reads. §B.2's table is the
   * security core of the contract, and the rows for the OpenAI key, the service-role key and the
   * `safety_identifier` salt all read **Never** for the repository. Nothing here reads any of them, and
   * `tests/source-scan_test.ts` asserts that no file in this directory reads `OPENAI_API_KEY`,
   * `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_SECRET_KEYS`, or anything shaped like a provider secret.
   */
  readonly jwks: string | undefined;
};

/**
 * Assembles the production dependency graph.
 *
 * Takes the environment as an argument rather than reading it, so a test can build the *real* graph — the
 * real verifier, the real logger, the unavailable provider and the unavailable limiter — and assert that
 * it performs no network call and answers `503`, without a Supabase project existing and without the test
 * having to trust a description of what production does.
 */
export function createProductionDependencies(
  environment: ProductionEnvironment,
): NoorAIDependencies {
  return {
    verifier: createJwtClaimsVerifier({
      keySet: environment.jwks,
      claims: claimsPolicyFor(environment.supabaseUrl),
      nowSeconds: () => Math.floor(systemClock.now() / 1000),
    }),
    provider: unavailableProvider,
    rateLimiter: unavailableRateLimiter,
    clock: systemClock,
    timer: systemTimer,
    requestIds: cryptoRequestIds,
    logger: structuredLogger,
    config: productionConfig,
  };
}
