import type { ClaimsPolicy } from './claims.ts';
import { createJwtClaimsVerifier } from './jwt-verifier.ts';
import { createOpenAIProvider } from './openai-provider.ts';
import { createQuotaRpcStore } from './quota-rpc.ts';
import type {
  AIProvider,
  Clock,
  HandlerConfig,
  Logger,
  NoorAIDependencies,
  OperationalLogRecord,
  RequestIdSource,
  Timer,
} from './ports.ts';

/** Defined next to the adapter that returns it, and re-exported so the graph reads in one place. */
export { unavailableProvider } from './openai-provider.ts';

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
 * ── The four independent reasons Noor AI is unavailable in production ────────
 * Layered deliberately, so that flipping any single one of them cannot accidentally open the endpoint:
 *
 *   1. **The kill switch is off** (§I.2). Noor AI is not enabled for this deployment, because there is
 *      nothing behind it to enable.
 *   2. **The quota store has no credential.** No `SUPABASE_SERVICE_ROLE_KEY` is set anywhere, so the
 *      adapter degrades to the store that can only refuse, and an unmetered AI endpoint is worse than
 *      an unavailable one (§I.1).
 *   3. **No provider key exists.** `OPENAI_API_KEY` is unset in every environment, so
 *      `createOpenAIProvider` yields the provider that can only refuse.
 *   4. **B10 is open** — see `createProductionProvider`. There is no reviewed **per-user**
 *      `safety_identifier` derivation, and the adapter's construction-time option cannot be one, so
 *      nothing can be supplied and the provider refuses on that ground *alone*, whatever happens to
 *      the key.
 *
 * A request therefore fails closed with §I.5's stable `503 service_unavailable` *after* authentication
 * and validation have run — the whole request path is exercised and nothing is answered.
 */

/**
 * The production provider — the OpenAI adapter, constructed so that it refuses.
 *
 * ── Why this function exists rather than a bare `unavailableProvider` ────────
 * The adapter is now real code that could contact `api.openai.com`, so "it is disabled" has to be a
 * property of the *graph* a test can build and drive, not a sentence in a comment. This constructs the
 * real thing from the real environment and lets its own gates decide — and today they both refuse.
 *
 * ── B10, stated where the wiring is ──────────────────────────────────────────
 * `staticSafetyIdentifier: undefined` is not an omission, and it is **not a slot waiting for a value**.
 * B10 — the key provisioning and rotation lifecycle (`NOOR_AI3_QUOTA_STORE_SECURITY_REVIEW.md` §11.5)
 * — is **open**, and the thing it is open *about* cannot be expressed here at all: this graph is built
 * once per isolate, so anything passed on that line would be a single constant shared by every user
 * the isolate serves. A safety identifier is defined as identifying each user. One constant is not
 * that, and no better constant fixes it.
 *
 * **Closing B10 therefore does not mean filling this in.** It means a separately reviewed **per-user
 * derivation step** — server-side, after JWT verification and before the provider call, emitting an
 * opaque identifier and nothing else — carried as a new per-request field. That is a reviewed diff to
 * `ProviderRequest`, to §H.1's allow-list and to the boundary test (plan §6.5), plus an answer to the
 * Apple linkage question in `NOOR_AI_DATA_CONTROL_DECISION.md` §6.3. A raw uuid, an email, a phone
 * number, a session id and an unkeyed uuid hash all remain prohibited as input or output, and the
 * mobile client may never supply one.
 *
 * Until that port exists, the `undefined` below keeps live provider execution unavailable **by
 * itself**, whatever happens to the API key. `tests/source-scan_test.ts` pins the literal so removing
 * it is a visible failure rather than a quiet one.
 */
export function createProductionProvider(environment: ProductionEnvironment): AIProvider {
  return createOpenAIProvider({
    apiKey: environment.openaiApiKey,
    staticSafetyIdentifier: undefined,
  });
}

/**
 * The quota timeout, and why it is well inside the handler budget.
 *
 * A reserve that took as long as the whole request would leave nothing for the provider, so the store
 * gets a small fixed slice. It is a constant rather than a config field because it is a property of a
 * database round trip in the same region, not something a deployment tunes.
 */
export const QUOTA_TIMEOUT_MS = 3_000;

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
        /**
         * The AI-3 quota fields. All three are coarse by construction — a closed enum, a count and a
         * settlement state — and none can hold a subject, a reservation id or a token count.
         *
         * `accounting: 'failed'` is the one an operator must be able to see, and it covers **two**
         * distinct states rather than one:
         *
         *   • **Registration failed.** A provider attempt was incurred and the store has no record
         *     of it, so recorded spend is behind real spend by an unknown amount.
         *   • **Finalization failed.** The attempts *are* registered, but their cost was never
         *     accumulated into the spend counters, so the ceilings cannot yet see it.
         *
         * Both leave §I.2's ceilings enforcing against an understated figure, which is why they share
         * a value — but they are not the same defect, and `attempts_registered` distinguishes them:
         * zero means nothing was recorded, non-zero means the attempts landed and the settlement did
         * not. In both cases the lease is left to expire so late accounting can correct it.
         */
        quota_reason: entry.quota_reason,
        attempts_registered: entry.attempts_registered,
        accounting: entry.accounting,
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
  quotaTimeoutMs: QUOTA_TIMEOUT_MS,
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
  /**
   * Platform-injected `SUPABASE_SERVICE_ROLE_KEY` — the **only** secret this function reads, and the
   * only one it may.
   *
   * §B.2's service-role row read "Never" for AI-2 because AI-2 needed no privileged database access at
   * all. AI-3 does: the quota store's five wrappers are executable by `service_role` and by nothing
   * else, which is what keeps `anon` and `authenticated` — and therefore the mobile app — unable to
   * reach quota state in any way. The containment is that this value lives only in the Edge Function
   * environment, is read only by `quota-rpc.ts`, and never appears in the app bundle, a log line, a
   * response body or this repository. `tests/source-scan_test.ts` asserts each of those.
   *
   * When it is absent — which it is everywhere today, because nothing is deployed and no secret is
   * set — the adapter degrades to the store that can only refuse, and the handler answers `503`.
   */
  readonly serviceRoleKey: string | undefined;
  /**
   * `OPENAI_API_KEY` — the provider credential, and the second secret this function may read.
   *
   * **No such key exists.** None has been created, none is set in any environment, none appears in
   * this repository, and this phase is not authorised to create one. The name is here so the adapter
   * can be constructed from the real environment and observed to refuse, which is a stronger claim
   * than not wiring it at all.
   *
   * It is read once, in `index.ts`, and handed straight to `openai-provider.ts`. It reaches no
   * handler, no logger and no response, and it must never appear in mobile source, in `.env`, in any
   * `EXPO_PUBLIC_*` variable or in the app bundle — `EXPO_PUBLIC_*` in particular is inlined into the
   * shipped bundle, which is the specific mistake §B.2 exists to prevent.
   */
  readonly openaiApiKey: string | undefined;
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
    provider: createProductionProvider(environment),
    quota: createQuotaRpcStore({
      supabaseUrl: environment.supabaseUrl,
      serviceRoleKey: environment.serviceRoleKey,
      timeoutMs: QUOTA_TIMEOUT_MS,
    }),
    clock: systemClock,
    timer: systemTimer,
    requestIds: cryptoRequestIds,
    logger: structuredLogger,
    config: productionConfig,
  };
}
