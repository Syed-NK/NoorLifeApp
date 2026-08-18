import type { ClaimsPolicy } from './claims.ts';
import { createJwtClaimsVerifier } from './jwt-verifier.ts';
import { createQuranFoundationClient } from './quran-foundation-client.ts';
import type {
  Clock,
  HandlerConfig,
  Logger,
  OperationalLogRecord,
  QuranContentDependencies,
  RequestIdSource,
  Timer,
} from './ports.ts';

/** Defined next to the client that returns it, and re-exported so the graph reads in one place. */
export { unconfiguredUpstream } from './quran-foundation-client.ts';

/**
 * The production dependency graph.
 *
 * ── There is no fake here, and no switch that selects one ────────────────────
 * No request field, no header, no query parameter and no environment flag chooses a different
 * upstream, because there is only one upstream in this module graph. `tests/source-scan_test.ts`
 * asserts that no production file imports test code and that none defines a fake of its own.
 *
 * That rule carries more weight in this function than it usually does. A fake upstream in the
 * production graph would be a source of **scripture** one misconfigured deployment away from a user
 * reading it and believing it — which is exactly the failure the whole Quran Foundation integration
 * was built to prevent, arriving through the back door.
 *
 * ── What happens with no credential ──────────────────────────────────────────
 * `createQuranFoundationClient` returns the upstream that can only report `unconfigured`, **before
 * any transport is constructed**, so a deployment without `QF_CLIENT_ID` and `QF_CLIENT_SECRET` makes
 * zero outbound requests rather than a stream of failing ones. The handler answers `503`, and the app
 * renders an honest configuration state. Nothing falls back to sample content, here or anywhere.
 */

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
 * A v4 uuid from the platform's CSPRNG.
 *
 * Random, and deliberately not derived from the user, the operation or the time — a request id that
 * encoded any of those would be a correlator wearing an identifier's clothes.
 */
export const cryptoRequestIds: RequestIdSource = {
  nextUuid: () => crypto.randomUUID(),
};

/**
 * The structured logger — an allow-list serialiser.
 *
 * ── Why every key is written out by hand ─────────────────────────────────────
 * `{ ...entry }` would be shorter and would defeat the purpose. The failure mode being guarded
 * against is a *future* change widening `OperationalLogRecord` and a spread quietly carrying the new
 * field into the log. Enumerating the keys means a new field is invisible to the log until somebody
 * adds a line here, which is a diff a reviewer sees.
 *
 * There is exactly one `console` call in this function's source, and it is the next statement.
 * Development is not an exception: a log line is a line in a scrollback buffer, a screen recording
 * and a bug-report attachment.
 */
export const structuredLogger: Logger = {
  record: (entry: OperationalLogRecord) => {
    console.log(
      JSON.stringify({
        event: entry.event,
        request_id: entry.request_id,
        contract_version: entry.contract_version,
        http_status: entry.http_status,
        outcome: entry.outcome,
        error_code: entry.error_code,
        error_field: entry.error_field,
        auth_reason: entry.auth_reason,
        operation: entry.operation,
        upstream_outcome: entry.upstream_outcome,
        /**
         * The third closed enum, and the newest.
         *
         * `upstream_reason` names which branch of the vendor boundary refused a response — a contract
         * status, an empty body, either size bound, or an unparseable body. Like the two below it is a
         * union of string literals fixed in `ports.ts`, so there is no shape in which a status code, a
         * byte count, a response body, an audio URL, a resource id or a verse could arrive in it.
         */
        upstream_reason: entry.upstream_reason,
        upstream_attempts: entry.upstream_attempts,
        token_renewed: entry.token_renewed,
        catalogue_fetched: entry.catalogue_fetched,
        /**
         * Two closed enums, and the reason they are safe to write here.
         *
         * Neither can hold anything the vendor sent. `catalogue_outcome` names how NoorLife's own
         * catalogue read went; `normalize_reason` names which of NoorLife's own checks refused a
         * body. Both are unions of string literals fixed in `ports.ts`, so there is no shape in
         * which a verse, a translator, an edition id or a URL could arrive in either — which is the
         * property this serialiser's allow-list exists to keep true field by field.
         */
        catalogue_outcome: entry.catalogue_outcome,
        normalize_reason: entry.normalize_reason,
        retry_after_seconds: entry.retry_after_seconds,
        operator_alert: entry.operator_alert,
        duration_ms: entry.duration_ms,
      }),
    );
  },
};

/**
 * The bounded wall clock for one token exchange.
 *
 * A constant rather than a config field because it is a property of one HTTPS round trip to an
 * authorization server, not something a deployment tunes. It sits well inside the upstream budget so
 * that an exchange and a content request together still fit.
 */
export const TOKEN_TIMEOUT_MS = 6_000;

/**
 * The handler configuration.
 *
 * `upstreamTimeoutMs` covers the **whole** upstream operation — up to two content requests and any
 * token exchange between them — because the single permitted retry must not be able to buy itself a
 * fresh deadline. `handlerBudgetMs` is strictly greater, leaving room for JWT verification and body
 * parsing on either side of it.
 *
 * The numbers are set against what the vendor's own latency has to fit inside rather than measured
 * against it — this phase makes no production calls, and inventing a figure from a measurement that
 * was never taken would be worse than choosing a generous one and saying so. They are generous.
 */
export const productionConfig: HandlerConfig = {
  upstreamTimeoutMs: 15_000,
  handlerBudgetMs: 20_000,
};

/**
 * The claim policy, derived from the platform-injected project URL.
 *
 * Supabase issues user tokens with `iss` of `<project URL>/auth/v1` and `aud` of `authenticated`.
 * `SUPABASE_URL` is injected by the platform, so neither value is configuration anybody has to
 * remember to set, and neither is a secret.
 */
export function claimsPolicyFor(supabaseUrl: string | undefined): ClaimsPolicy {
  return {
    issuer: `${(supabaseUrl ?? '').replace(/\/+$/, '')}/auth/v1`,
    audience: 'authenticated',
    /** Leeway on `nbf`/`iat` only. `exp` is checked strictly; see `claims.ts`. */
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
   * Not a secret, and the only key material read for authentication. Because the platform injects it,
   * verifying a signature needs no outbound request at all, which is what lets this function state
   * that the only host it ever contacts is Quran Foundation's.
   */
  readonly jwks: string | undefined;
  /**
   * `QF_CLIENT_ID` — half of the Quran Foundation Basic credential, and a header on every content
   * request.
   *
   * A **name only**. No value appears in this repository, in `.env`, in any `EXPO_PUBLIC_*` variable
   * or in the app bundle — `EXPO_PUBLIC_*` in particular is inlined into the shipped bundle, which is
   * the specific mistake the server-side boundary exists to prevent. It is set with
   * `supabase secrets set` and read in exactly one file, `index.ts`, which hands it straight on.
   */
  readonly qfClientId: string | undefined;
  /**
   * `QF_CLIENT_SECRET` — the other half.
   *
   * The same rules, more strictly. It is read once at the entry point and handed to
   * `token-store.ts`, which writes it into one `Authorization` header and nowhere else. It reaches no
   * handler, no logger, no response body and no error message, and this repository contains no value
   * for it — `tests/source-scan_test.ts` asserts every part of that by scanning the committed source.
   */
  readonly qfClientSecret: string | undefined;
};

/**
 * Assembles the production dependency graph.
 *
 * Takes the environment as an argument rather than reading it, so a test can build the *real* graph —
 * the real verifier, the real logger, the real client — and assert that with no credentials it
 * performs no network call and answers `503`, without a Supabase project existing, without a Quran
 * Foundation credential existing, and without the test having to trust a description of what
 * production does.
 */
export function createProductionDependencies(
  environment: ProductionEnvironment,
): QuranContentDependencies {
  return {
    verifier: createJwtClaimsVerifier({
      keySet: environment.jwks,
      claims: claimsPolicyFor(environment.supabaseUrl),
      nowSeconds: () => Math.floor(systemClock.now() / 1000),
    }),
    upstream: createQuranFoundationClient({
      clientId: environment.qfClientId,
      clientSecret: environment.qfClientSecret,
      tokenTimeoutMs: TOKEN_TIMEOUT_MS,
      clock: systemClock,
    }),
    clock: systemClock,
    timer: systemTimer,
    requestIds: cryptoRequestIds,
    logger: structuredLogger,
    config: productionConfig,
  };
}
