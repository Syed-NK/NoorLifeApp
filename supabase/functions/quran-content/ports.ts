import type { ErrorCode, QuranOperation } from './contract.ts';

/**
 * Every dependency the handler has, expressed as a port.
 *
 * ── Why the handler owns no concrete dependency ──────────────────────────────
 * It constructs nothing: not a verifier, not an upstream client, not a token store, not a clock, not
 * a logger. That is what makes the whole test tier runnable with no Docker, no Supabase project, no
 * network and **no Quran Foundation credential** — and what lets a test hold the only reference to
 * the thing that would have contacted the vendor and prove it was never called.
 *
 * The rule that keeps it honest, enforced by `tests/source-scan_test.ts`: **no fake lives in this
 * directory outside `tests/`.** There is no request field, header, query parameter or environment
 * flag that selects one, because there is no fake in the production module graph to select.
 *
 * ── On the two files copied verbatim from `noor-ai` ──────────────────────────
 * `claims.ts` and `jwt-verifier.ts` are **byte-identical** copies of the modules in
 * `supabase/functions/noor-ai/`, and `tests/jwt-parity_test.ts` asserts that by exact comparison so
 * neither copy can drift.
 *
 * They are copied rather than imported across function directories, and rather than moved to a
 * shared module, for two reasons that pull the same way. A Supabase function is deployed as a unit,
 * and a security control that lives in a sibling function's folder is a control whose review, and
 * whose deployment, belong to something else. And moving them would have edited `noor-ai`, which
 * this work is not authorised to touch. The duplication's real cost — a fix landing in one copy and
 * not the other — is exactly what the parity test converts into a failing build.
 *
 * The verbatim copies mention Noor AI's contract by section number in their comments. That is left
 * as it is on purpose: an edited comment is an edited file, and the value of the parity assertion
 * comes from there being nothing to compare but equality.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Clock, scheduler, identifiers
// ─────────────────────────────────────────────────────────────────────────────

/** Wall clock in milliseconds. Injected so the token's expiry is a value a test can control. */
export type Clock = {
  readonly now: () => number;
};

/**
 * A cancellable one-shot timer.
 *
 * The upstream request budget is enforced by aborting the connection, and a test that proved that by
 * sleeping would be slow and flaky at the same time. The port lets a test fire the timer itself.
 */
export type Timer = {
  /** Returns a cancel function. Cancelling after firing must be safe. */
  readonly schedule: (delayMs: number, onFire: () => void) => () => void;
};

/** The source of the uuid inside `quran_req_<uuid>`. Random — never derived from the caller. */
export type RequestIdSource = {
  readonly nextUuid: () => string;
};

// ─────────────────────────────────────────────────────────────────────────────
// Authentication — identical in shape to `noor-ai`, because the copied modules implement it
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Why a token was refused.
 *
 * A closed enum, logged as an operational code and **never** returned to the caller: every handler
 * rejection produces the same response body, because distinguishing them tells a prober how far it
 * got.
 *
 * `verifier-unavailable` is the one member that is not the caller's fault — the function cannot
 * verify anything — and it maps to `503`, not `401`. Answering `401` there would tell a signed-in
 * user their session was bad when the server was misconfigured.
 */
export type AuthFailureReason =
  | 'missing'
  | 'malformed'
  | 'signature'
  | 'expired'
  | 'time-claims'
  | 'audience'
  | 'issuer'
  | 'role'
  | 'subject'
  | 'session'
  | 'verifier-unavailable';

/**
 * What the handler is allowed to know about the caller.
 *
 * ── And what it deliberately does nothing with ───────────────────────────────
 * Nothing. This function reads public scripture; it has no per-user state, no quota, no personal
 * record and no reason to know who is asking beyond *that somebody signed in is asking*. `userId` is
 * therefore verified and then used for nothing at all — it is not logged, not sent upstream, not
 * hashed, not stored, and there is no field on any outbound value that could carry it.
 *
 * That is a stronger privacy position than redaction: a request for Surah 18 is indistinguishable
 * from every other request for Surah 18, including to whoever reads the logs.
 */
export type VerifiedClaims = {
  /** The verified `sub`. Present so the copied verifier's contract is satisfied; used nowhere. */
  readonly userId: string;
  /** The verified `session_id`. Likewise carried and not consulted. */
  readonly sessionId: string;
  /** Narrowed to the one accepted value, so `anon` and `service_role` are unrepresentable. */
  readonly role: 'authenticated';
};

export type AuthOutcome =
  | { readonly ok: true; readonly claims: VerifiedClaims }
  | { readonly ok: false; readonly reason: AuthFailureReason };

/**
 * The claim verifier.
 *
 * Takes the raw `Authorization` header value rather than a pre-extracted token, so "present, single,
 * `Bearer`, non-empty" is the verifier's responsibility and the handler never holds a token it has
 * not been told is good. `null` is "no header at all".
 */
export type ClaimsVerifier = {
  readonly verify: (authorizationHeader: string | null) => Promise<AuthOutcome>;
};

// ─────────────────────────────────────────────────────────────────────────────
// The validated request
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A request that has passed validation — and the structural proof that no URL can be proxied.
 *
 * ── Read the union, not the prose ────────────────────────────────────────────
 * Every member is an operation name plus integers. There is no `path`, no `url`, no `host`, no
 * `query`, no `params` bag and no string field of any kind, so "the client cannot make this function
 * fetch an arbitrary upstream address" is not a rule the handler follows — it is a sentence that
 * cannot be written in this type. `quran-foundation-client.ts` turns one of these into exactly one
 * fixed path template, and `tests/source-scan_test.ts` asserts the template table is the only place a
 * path is built.
 *
 * `translationId` is a number here rather than the wire's string, because the vendor's resource ids
 * are integers and the boundary is where a string becomes one. A value that is not a bounded integer
 * never reaches this type.
 */
export type QuranQuery =
  | { readonly operation: 'list_chapters' }
  | { readonly operation: 'get_chapter'; readonly surah: number }
  | {
    readonly operation: 'list_verses';
    readonly surah: number;
    readonly page: number;
    readonly perPage: number;
  }
  | {
    readonly operation: 'list_verse_translations';
    readonly surah: number;
    readonly translationId: number;
    readonly page: number;
    readonly perPage: number;
  }
  | {
    readonly operation: 'get_verse';
    readonly surah: number;
    readonly ayah: number;
    /** `null` asks for scripture alone. The Daily Ayah supplies one; nothing else does. */
    readonly translationId: number | null;
  }
  | { readonly operation: 'list_translation_resources' }
  | { readonly operation: 'list_recitation_resources' }
  | {
    readonly operation: 'sync_content_resources';
    /**
     * The vendor’s opaque checkpoint, or `null` to bootstrap.
     *
     * Bootstrap is the absence of a token rather than a separate flag on this side: the vendor’s
     * own `bootstrap=true` is set by the client module from exactly this condition, so there is one
     * place where “no token” becomes “start again” and no way for the two to disagree.
     */
    readonly syncToken: string | null;
    /** A cursor previously extracted from `next_page_url`, or `null` for the first page. */
    readonly cursor: string | null;
    readonly perPage: number;
  }
  | {
    readonly operation: 'get_content_snapshot';
    /**
     * Which permitted resource to snapshot.
     *
     * The group alone. The id is looked up from `SYNC_RESOURCES` on the server, so a client cannot
     * request a snapshot of a resource NoorLife has no permission to hold — not by guessing an id,
     * and not by replaying one it saw in a mutation.
     */
    readonly resourceGroup: 'recitations' | 'translations';
  }
  | {
    readonly operation: 'list_verse_recitations';
    readonly surah: number;
    readonly recitationId: number;
    readonly page: number;
    readonly perPage: number;
  };

// ─────────────────────────────────────────────────────────────────────────────
// The Quran Foundation boundary
// ─────────────────────────────────────────────────────────────────────────────

/**
 * An access token, or the honest statement that there is none.
 *
 * A closed result rather than a thrown error, for the reason the upstream outcome below gives about
 * its own failure members: the implementation holds a client secret, and an exception escaping it is
 * an exception carrying whatever the runtime decided to put in the message.
 */
export type TokenOutcome =
  | { readonly kind: 'token'; readonly accessToken: string }
  /**
   * The authorization server **rejected the credential** — a `400`, `401` or `403` on the exchange.
   *
   * Separated from `unavailable` because the remedies are different and an operator has to be able to
   * tell them apart: a rejected credential needs the client id, the secret or the approved scope
   * looked at, and a transport failure needs nothing done at all. Collapsing them would bury a
   * configuration fault inside a stream of ordinary outage counts.
   *
   * The client's answer is identical for both — no request is served — and nothing about *why* the
   * credential was refused reaches the caller or the log.
   */
  | { readonly kind: 'refused' }
  /** No credential is configured, the exchange failed in transport, or the body was not a token. */
  | { readonly kind: 'unavailable' };

/**
 * The OAuth2 client-credentials token source.
 *
 * ── `forceRenew` is the whole of the retry contract ──────────────────────────
 * There is no refresh token in a client-credentials flow, so "renew" means "exchange again". The
 * client asks for a fresh token exactly once, after an upstream `401`, by passing `forceRenew: true`;
 * every other call takes the cached token if one is live. A port with a boolean rather than a
 * `refresh()` method is what makes "at most one renewal per request" countable by a fake.
 */
export type TokenSource = {
  readonly get: (
    options: { readonly forceRenew: boolean },
    signal: AbortSignal,
  ) => Promise<TokenOutcome>;
};

/**
 * Everything the Quran Foundation boundary can report.
 *
 * The set is the requirement: each case has a different HTTP status and a different honest message,
 * and a boundary that collapsed them would force the handler to guess. What no member carries is any
 * upstream *text* — there is no field on this union that could hold a vendor error body, and that is
 * the type-level half of "never log or forward a full upstream error body".
 */
export type UpstreamOutcome =
  /** A `200` whose body parsed as JSON. Still untrusted — `normalize.ts` validates every field. */
  | { readonly kind: 'ok'; readonly body: unknown }
  /** The vendor has no such chapter, verse or resource. A `404`, and the caller's doing. */
  | { readonly kind: 'not-found' }
  /** A `429`. `retryAfterSeconds` is passed on only when it parsed as bounded delta-seconds. */
  | { readonly kind: 'rate-limited'; readonly retryAfterSeconds: number | null }
  /**
   * Refused the credential — **after** one fresh token was obtained and the request retried once.
   *
   * Reaching this member means a newly minted token was also refused, which is a NoorLife
   * configuration or approval-scope problem rather than anything the caller did. It is never a `401`
   * to the client: the caller's own session was fine.
   */
  | { readonly kind: 'unauthorized' }
  /** The request budget elapsed and the connection was aborted. */
  | { readonly kind: 'timeout' }
  /** A 5xx, a connection reset, a refused redirect, or an over-large body. */
  | { readonly kind: 'transient' }
  /** A `200` that was not JSON, or a status this contract has no representation for. */
  | { readonly kind: 'malformed' }
  /**
   * **No credential is configured**, so nothing left the process.
   *
   * Load-bearing rather than descriptive: it is the only member that means no request was made, and
   * it is what the function answers with in an environment where `QF_CLIENT_ID` or `QF_CLIENT_SECRET`
   * is absent. Failing closed here is the point — there is no branch that serves scripture without a
   * credential, and none that falls back to another source.
   */
  | { readonly kind: 'unconfigured' };

export type UpstreamOutcomeKind = UpstreamOutcome['kind'];

/**
 * Who translated an edition, and what that edition is called.
 *
 * ── Why this travels beside the body instead of being read out of it ────────
 * Quran Foundation's `translation` object makes `resource_name` **optional** — only `resource_id`
 * and `text` are required — and the live API omits it on the two routes NoorLife reads. A
 * normaliser that required it rejected perfectly good translations, which is what
 * `502 upstream_unavailable` after `upstream_outcome: ok` meant in the deployed logs.
 *
 * The response-level `meta.translation_name` / `meta.author_name` pair *is* required — but only on
 * `/quran/translations/{id}`, the whole-Qur'an route, which this function does not use. Neither
 * `/translations/{id}/by_chapter/{n}` nor `/verses/by_key/{key}` declares a `meta` block at all.
 *
 * So the authority is the **catalogue**: `/resources/translations`, an already-approved operation,
 * keyed by the exact resource id the caller asked for. The client resolves it and hands the pair
 * alongside the body, which keeps the normaliser a pure function over data it was given.
 *
 * Both fields are required and non-empty by construction. There is no shape here for a half-known
 * attribution, because half an attribution is the thing that must not be rendered.
 */
export type TranslationAttribution = {
  /** The edition's own title, e.g. "The Clear Quran". From the catalogue's `name`. */
  readonly title: string;
  /** Who translated it, e.g. "Dr. Mustafa Khattab". From the catalogue's `author_name`. */
  readonly translator: string;
};

/**
 * Why a `200` from the vendor did not survive normalisation.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * This enum exists because of a specific, real, and previously undiagnosable failure.
 *
 * The deployed logs showed `list_verse_translations` requests answering `upstream_outcome: ok`
 * followed by NoorLife's own `502 upstream_unavailable` — intermittently, for the same surah and the
 * same edition, with no field anywhere in the record distinguishing *which* of the eight independent
 * checks in `normalizeTranslations` had refused the body. Two requests that differ only in whether
 * the isolate happened to hold a warm catalogue produced byte-identical log lines.
 *
 * ── What may and may not be in these values ─────────────────────────────────
 * Each value names **a check**, never what the check saw. There is no member here that can carry a
 * verse, a translation, a translator's name, an edition title, a resource id, a surah number, a
 * header, a URL or a token — and there is no free-text member, so no call site can add one later
 * without adding a member to this union and having that addition reviewed.
 *
 * That is the whole of "bounded internal diagnostics": enough to tell an operator which branch
 * rejected a valid response, and structurally incapable of telling them anything about its content.
 * ═══════════════════════════════════════════════════════════════════════════
 */
export type NormalizeReason =
  /** The body was not an object, or the array this operation reads was absent or not an array. */
  | 'envelope'
  /** A row's `verse_key` was missing, unparseable, or named a surah other than the one requested. */
  | 'verse_key'
  /** A row's `resource_id` was missing, out of bounds, or named an edition other than the one asked for. */
  | 'resource_id'
  /** A row's `text` was present but was not a string. */
  | 'text_type'
  /** A row's `text` was empty once footnote and formatting markup were removed. */
  | 'text_empty'
  /** Two rows in one response named different editions. */
  | 'label_conflict'
  /**
   * Rows to render and nobody to credit them to.
   *
   * The catalogue produced no attribution for the requested edition, the response carried no `meta`
   * pair, and no row carried a `resource_name`. Fail-closed is the correct behaviour and is not
   * changing — but it is a *NoorLife-side* failure wearing an upstream error code, and until this
   * member existed there was no way to tell it apart from a malformed vendor body.
   */
  | 'attribution'
  /** Any other operation's body did not match its contract. Granularity lives where it was needed. */
  | 'shape';

/**
 * How the translation catalogue answered for this request, as a closed set of coarse states.
 *
 * ── The field this replaces was actively misleading ─────────────────────────
 * `catalogueFetched` is a boolean set to `true` on **every** path that attempted a fetch — including
 * the paths where the fetch failed and the ones where it succeeded but did not list the requested
 * edition. An operator reading `upstream_outcome: ok, catalogue_fetched: true` beside a `502` would
 * reasonably conclude the catalogue was fine and look elsewhere. It is kept for continuity with the
 * existing dashboards, and this enum is what actually answers the question.
 *
 * Neither an edition id nor a title nor a translator appears in any member.
 */
export type CatalogueOutcome =
  /** Served from this isolate's cache, and it lists the requested edition. */
  | 'cached_hit'
  /** Served from this isolate's cache, which does not list the requested edition. */
  | 'cached_miss'
  /** Fetched during this request, and it lists the requested edition. */
  | 'fetched_hit'
  /** Fetched during this request, and it does not list the requested edition. */
  | 'fetched_miss'
  /** Fetched, but the body was not a catalogue. Any earlier cached copy was used instead. */
  | 'unreadable'
  /** The catalogue read itself failed. Any earlier cached copy was used instead. */
  | 'unreachable';

/**
 * An outcome plus what it took to reach it.
 *
 * Written as an intersection over the union so every member gains the two fields without the
 * eight-member discriminated union being restated. Both are **counts about NoorLife's own
 * behaviour** rather than anything the vendor said: how many content requests this function issued,
 * and whether it exchanged a fresh token mid-request. They exist because a rising retry rate is a
 * signal and one buried inside an adapter is not — and because "at most one retry" is a claim a test
 * should be able to read off a returned value rather than infer from a call count.
 */
export type UpstreamResult = UpstreamOutcome & {
  /**
   * Content requests issued **for the caller's operation**. `0` when no credential is configured;
   * never more than `2`.
   *
   * A catalogue lookup for attribution is deliberately not counted here — it is a different
   * question, answered at most once a day per isolate, and folding it in would make the one number
   * that says "how hard did we press the vendor for this read" mean two things. `catalogueFetched`
   * reports it separately.
   */
  readonly attempts: number;
  /** Whether a token was exchanged because the vendor refused the one we held. */
  readonly tokenRenewed: boolean;
  /** Whether the translation catalogue was fetched to resolve attribution during this request. */
  readonly catalogueFetched?: boolean;
  /**
   * How the catalogue answered, in the detail `catalogueFetched` cannot express.
   *
   * Present exactly when a catalogue lookup happened — the two translation-bearing operations, and
   * regardless of how the content read went, because the lookup now runs beside it rather than after
   * it. Absent everywhere else, because "the catalogue was not consulted" and "the catalogue was
   * consulted and said nothing" are different facts and a single boolean was already conflating a
   * milder version of that distinction.
   */
  readonly catalogueOutcome?: CatalogueOutcome;
  /**
   * The attribution for the requested edition, when one was resolved.
   *
   * Present only for the two translation-bearing operations, and absent rather than guessed when the
   * catalogue could not be reached or does not list the id.
   */
  readonly attribution?: TranslationAttribution;
};

/**
 * The Quran Foundation client port.
 *
 * Takes a validated query and a signal, and returns a parsed body or a closed failure. It cannot be
 * handed a URL, and it returns no `Response`, no headers and no status — so nothing downstream of
 * this port can accidentally forward vendor detail, because nothing downstream ever holds any.
 */
export type QuranUpstream = {
  readonly read: (query: QuranQuery, signal: AbortSignal) => Promise<UpstreamResult>;
};

// ─────────────────────────────────────────────────────────────────────────────
// Logging
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The one log record this function can emit.
 *
 * ── Redaction by allow-list, enforced by the type system ─────────────────────
 * A closed record type is an allow-list one step earlier than a serialiser: there is no property here
 * that can hold an `Authorization` header, an access token, a client id, a client secret, an upstream
 * error body, a URL, a verse of scripture or a user identifier — so no call site can pass one, not by
 * accident and not under a debug flag, because there is no free-text field to smuggle it through.
 *
 * Two absences are deliberate and worth naming:
 *
 *   • **No user identifier of any kind.** Not the `sub`, not a hash of it, not a session id. This
 *     function serves public scripture, so a per-user correlator in an operational log would create a
 *     record of what somebody reads for no operational gain whatsoever.
 *   • **No upstream status code.** `upstream_outcome` is this function's own closed vocabulary. A raw
 *     vendor status is a fact about the vendor's response, and the rule is that none of those crosses
 *     this boundary — the coarse outcome is what an operator actually routes on.
 */
export type OperationalLogRecord = {
  readonly event: 'quran_content_request';
  /** Safe to log, safe to display, safe to send to support. Reveals nothing on its own. */
  readonly request_id: string;
  readonly contract_version: number;
  readonly http_status: number;
  readonly outcome: 'ok' | 'error';
  readonly error_code: ErrorCode | null;
  /** The **name** of a rejected field, never its value. */
  readonly error_field: string | null;
  /** A closed enum. Not a token, not a claim value, not a message. */
  readonly auth_reason: AuthFailureReason | null;
  /**
   * Which operation was asked for.
   *
   * A closed enum from the approved table, and the one piece of request content that is logged. It is
   * operationally necessary — "translations are failing and chapters are fine" is the first thing an
   * operator needs — and it is not personal: it says which kind of read happened, never which surah,
   * which verse, which edition or who asked.
   */
  readonly operation: QuranOperation | null;
  readonly upstream_outcome: UpstreamOutcomeKind | null;
  /** How many upstream attempts were made. At most two, and the second only after a `401`. */
  readonly upstream_attempts: number;
  /** True when a fresh token was obtained mid-request. A rising count is a real signal. */
  readonly token_renewed: boolean;
  /**
   * Whether the translation catalogue was fetched during this request to resolve attribution.
   *
   * Counted separately from `upstream_attempts` so the number answering "how hard did we press the
   * vendor for this read" keeps meaning one thing. It should be true rarely — once per isolate per
   * day — and a run of `true` is the signal that the catalogue cache is not surviving, which is
   * vendor load nobody asked for.
   */
  readonly catalogue_fetched: boolean;
  /**
   * How the catalogue answered, or `null` when no attribution was needed.
   *
   * The field that makes an attribution failure visible. `catalogue_fetched` reports only that a
   * fetch was attempted; this reports what came back, so `unreachable` and `fetched_miss` — the two
   * states that turn a perfectly good page of translations into a `502` — stop being invisible.
   */
  readonly catalogue_outcome: CatalogueOutcome | null;
  /**
   * Which normalisation check refused an upstream `200`, or `null` when none did.
   *
   * Non-null exactly when `upstream_outcome` is `ok` and `error_code` is `upstream_unavailable` —
   * the combination that was previously unexplainable from the log alone. A closed enum of check
   * names; see `NormalizeReason` for why it can carry nothing else.
   */
  readonly normalize_reason: NormalizeReason | null;
  readonly retry_after_seconds: number | null;
  /**
   * The failures that must reach a human rather than only a counter.
   *
   * A closed enum of coarse states, not a message. `credentials_rejected` means a freshly minted
   * token was refused, which needs the client credentials or the approved scope looked at;
   * `credentials_missing` means the secrets are not set on this deployment. Both are distinct from an
   * ordinary `503`, which mostly needs nobody woken.
   */
  readonly operator_alert: 'credentials_rejected' | 'credentials_missing' | null;
  readonly duration_ms: number;
};

export type Logger = {
  readonly record: (entry: OperationalLogRecord) => void;
};

// ─────────────────────────────────────────────────────────────────────────────
// Handler configuration and the full dependency set
// ─────────────────────────────────────────────────────────────────────────────

export type HandlerConfig = {
  /** The upstream wall clock per attempt, enforced by aborting the connection. */
  readonly upstreamTimeoutMs: number;
  /** Strictly greater than one upstream budget plus authentication overhead. */
  readonly handlerBudgetMs: number;
};

export type QuranContentDependencies = {
  readonly verifier: ClaimsVerifier;
  readonly upstream: QuranUpstream;
  readonly clock: Clock;
  readonly timer: Timer;
  readonly requestIds: RequestIdSource;
  readonly logger: Logger;
  readonly config: HandlerConfig;
};
