import type { ErrorCode, FinishReason, RefusalKind } from './contract.ts';

/**
 * Every dependency the handler has, expressed as a port.
 *
 * ── Why the handler owns no concrete dependency at all ───────────────────────
 * The handler is a factory over this file. It constructs nothing: not a JWT verifier, not a
 * provider, not a clock, not a logger, not a request id. That is what makes the AI-2 test tier in
 * `docs/NOOR_AI_BACKEND_CONTRACT.md` §J runnable with no Docker, no Supabase project, no network and
 * no key — and it is also what makes the §J.15 assertions meaningful, because a test can hold the
 * only reference to the thing that would have made a call and prove it was never called.
 *
 * The rule that keeps it honest is stated once here and enforced by
 * `tests/source-scan_test.ts`: **no fake lives in this directory outside `tests/`.** Production
 * supplies production-safe dependencies (`production.ts`); deterministic fakes are constructed only
 * inside test code. There is no request field, header, query parameter or environment flag that
 * selects a fake, because there is no fake in the production module graph to select.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Clock, scheduler, identifiers
// ─────────────────────────────────────────────────────────────────────────────

/** Wall clock in milliseconds. Injected so the handler budget is a value a test can control. */
export type Clock = {
  readonly now: () => number;
};

/**
 * A cancellable one-shot timer.
 *
 * §F.7 requires the upstream request to be "actually aborted, not just ignored", and §F.8 allows one
 * retry after a delay. Both need a timer, and a test that proves either by sleeping is a test that
 * makes the suite slow and flaky at the same time. The port lets a test fire the timer itself, so
 * "the provider was aborted" and "the retry waited for `Retry-After`" are assertions about
 * behaviour rather than about elapsed wall clock.
 */
export type Timer = {
  /** Returns a cancel function. Cancelling after firing must be safe. */
  readonly schedule: (delayMs: number, onFire: () => void) => () => void;
};

/**
 * The source of the uuid inside `noorai_req_<uuid>` (§I.7).
 *
 * The port yields a bare uuid and the handler applies the prefix, so the format is guaranteed by the
 * handler rather than by every implementation remembering to spell it. §I.7 also requires the id to
 * contain nothing — it is random, not derived from the user, the message or the time.
 */
export type RequestIdSource = {
  readonly nextUuid: () => string;
};

// ─────────────────────────────────────────────────────────────────────────────
// Authentication
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Why a token was refused.
 *
 * A closed enum, logged as an operational code and **never** returned to the caller: §D.1 requires
 * every handler rejection to produce the same response body, because distinguishing them tells a
 * prober how far it got.
 *
 * `verifier-unavailable` is the one member that is not the caller's fault. It means the function
 * cannot verify anything — no usable key material, or an algorithm the verifier does not support —
 * and it maps to `503 service_unavailable`, not `401`. Answering `401` there would tell a signed-in
 * user their session was bad when in fact the server was misconfigured, and would hide an operator
 * problem behind a user-facing one.
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
 * Three fields, and deliberately not a decoded token. Everything the handler does with identity it
 * does with `userId`, which §D.2 requires to come only from a token whose **signature** was
 * verified — "decoding it proves nothing".
 *
 * `sessionId` is carried for correlation and nothing else. §D.4 row 8 is explicit that its existence
 * in `auth.sessions` is **not** checked, and §D.3 states the consequence: a signed, unexpired,
 * `authenticated`-role JWT may remain accepted until it expires even after sign-out. Holding the
 * claim without checking it is the honest shape of that gap — the value is there for the day §12.10
 * decides to check it, and until then nothing in this function may describe the session as verified
 * live.
 */
export type VerifiedClaims = {
  /** The verified `sub`. A well-formed uuid (§D.4 row 7). Never logged (§H.3), never sent (§H.2). */
  readonly userId: string;
  /** The verified `session_id`. Recorded for correlation only — see the note above. */
  readonly sessionId: string;
  /** Narrowed to the one accepted value, so `anon` and `service_role` are unrepresentable. */
  readonly role: 'authenticated';
};

export type AuthOutcome =
  | { readonly ok: true; readonly claims: VerifiedClaims }
  | { readonly ok: false; readonly reason: AuthFailureReason };

/**
 * The claim verifier (§D.2 mechanism 2).
 *
 * Takes the raw `Authorization` header value, not a pre-extracted token, so that §D.4 row 2 —
 * present, single, `Bearer`, non-empty — is the verifier's responsibility and the handler never
 * holds a token it has not been told is good. `null` is "no header at all".
 *
 * An implementation must verify the signature, the time claims, the audience and issuer, the `role`
 * claim, the `sub` uuid shape and the presence of `session_id`. It must not merely decode.
 */
export type ClaimsVerifier = {
  readonly verify: (authorizationHeader: string | null) => Promise<AuthOutcome>;
};

// ─────────────────────────────────────────────────────────────────────────────
// Rate limiting
// ─────────────────────────────────────────────────────────────────────────────

/**
 * §I.1's decision, and the third member is the point of the type.
 *
 * `unavailable` exists because §I.1 has a hard constraint that must not be discovered later: an Edge
 * Function runs in ephemeral, horizontally-scaled isolates, so **an in-memory counter is not a rate
 * limit**. AI-2 has not chosen a shared store (§12.7 is open), so the production limiter cannot
 * answer, and a limiter that cannot answer must fail closed rather than wave the request through.
 *
 * Returning `unavailable` maps to `503 service_unavailable`. That is a deliberate availability cost
 * paid to avoid the alternative, which is an unmetered endpoint that spends money.
 */
export type RateLimitDecision =
  | { readonly kind: 'allowed' }
  | { readonly kind: 'limited'; readonly retryAfterSeconds: number }
  | { readonly kind: 'unavailable' };

export type RateLimiter = {
  /** The subject is the **verified** user id from §D — never a client-supplied id, never IP alone. */
  readonly check: (userId: string, nowMs: number) => Promise<RateLimitDecision>;
};

// ─────────────────────────────────────────────────────────────────────────────
// Provider boundary
// ─────────────────────────────────────────────────────────────────────────────

/**
 * What the provider is asked to classify.
 *
 * ── Why classification is a provider output and not a server keyword list ────
 * §G's boundaries need to know what a question is *about*, and there are only two honest places to
 * decide that: a real classifier, or the model itself under server instructions. A regex over the
 * message text is neither. §12.5 records the moderation decision as open and states plainly that
 * until it is wired, "§G's boundaries rest on the instruction text plus §C's input validation" —
 * so AI-2 builds the seam and refuses to fake what sits behind it.
 *
 * What AI-2 *does* own, and tests, is the deterministic half: given a classification, exactly which
 * refusal kind and which verbatim string the user receives. That mapping is in `policy.ts`, it
 * involves no text matching, and it is where every §J safety row is actually asserted.
 */
export type SafetyCategory =
  /** §E.4 / §J.8 — the question needs module records, which AI-2 cannot reach. */
  | 'module-data-required'
  /** §G.6 / §J.11 — another member's private entry. */
  | 'family-private'
  /** §G.3 / §J.9 — diagnosis, symptoms, medication, dosage. */
  | 'health-advice'
  /** §G.3 — starting, stopping or changing prescribed treatment. */
  | 'prescribed-treatment'
  /** §G.7 / §J.9b — the one case where the product must lead rather than answer. */
  | 'crisis'
  /** §G.4 / §J.10 — investment, tax or legal advice. */
  | 'finance-advice'
  /** §G.4 — forecasting returns or recommending a product. */
  | 'finance-product'
  /** §G.4 — permitted, but the answer carries a qualification. Not a refusal. */
  | 'finance-education'
  /** §G.5 / §J.10b — an answer that would need a citation, which AI-2 cannot supply. */
  | 'citation-required'
  /** §E.1 / §G.9 — not about NoorLife. Includes every injection attempt in §G.9's table. */
  | 'out-of-scope';

/**
 * The provider's answer, before server policy has run on it.
 *
 * `citationRequired` is separate from the text on purpose. §G.5 forbids substantive religious
 * content in AI-2 because §07 requires citations and there is no approved-source retrieval layer, so
 * the handler must be able to refuse an answer *because of what it would need*, not because of what
 * words it contains. A quotation from memory with no `sources` entry "would violate §07 while
 * looking like a helpful answer, which is the worst combination available" — and no amount of
 * scanning the text catches that reliably.
 */
export type ProviderAnswer = {
  readonly text: string;
  readonly finish: FinishReason;
  /** `null` when the answer needs no qualification or refusal. */
  readonly category: SafetyCategory | null;
  /** True when the answer asserts or requires source material. Forces a refusal in AI-2. */
  readonly citationRequired: boolean;
};

/**
 * Everything the provider boundary can report.
 *
 * The set is the requirement: answer, refusal, timeout, rate limit, quota exhaustion, malformed
 * upstream data and unexpected tool output must each be *representable*, because §F.8's retry rules
 * and §I.5's status mapping differ per case and a boundary that collapses them forces the handler to
 * guess. `unavailable` is the AI-2 production member — no provider is configured, so there is
 * nothing to call.
 */
export type ProviderOutcome =
  | { readonly kind: 'answer'; readonly answer: ProviderAnswer }
  /** A policy refusal the provider decided. Server policy still chooses the wording. */
  | { readonly kind: 'refusal'; readonly category: SafetyCategory }
  /** §F.7 — the upstream budget elapsed and the operation was aborted. Never retried. */
  | { readonly kind: 'timeout' }
  /** §F.8 — a transient provider 429. Retried at most once, honouring `Retry-After`. */
  | { readonly kind: 'rate-limited'; readonly retryAfterSeconds: number | null }
  /** §F.8 — a transient provider 5xx or a connection reset. Retried at most once. */
  | { readonly kind: 'transient-server-error' }
  /** §F.8 — billing/quota. **Never** retried; retrying "won't restore API access". */
  | { readonly kind: 'quota-exhausted' }
  /** §F.4 / §I.5 — unparseable, empty, or missing the expected output. Never retried. */
  | { readonly kind: 'malformed' }
  /** §F.4 — a tool or function call was returned though none was requested. Never executed. */
  | { readonly kind: 'unexpected-tool-call' }
  /** No provider is configured. The AI-2 production path (§K). Never retried. */
  | { readonly kind: 'unavailable' };

export type ProviderOutcomeKind = ProviderOutcome['kind'];

/**
 * Exactly what crosses the boundary that leaves NoorLife (§B.3 boundary 3, §H.1).
 *
 * ── This type *is* the outbound allow-list ──────────────────────────────────
 * §H.1 is closed: "a field not on it does not travel, and adding one is a contract change requiring
 * privacy review". Writing it as a type with five properties makes the review a diff on this
 * declaration. `tests/provider-boundary_test.ts` asserts the constructed object's keys equal exactly
 * these five, so a helpfully-spread context object fails a test rather than reaching a third party.
 *
 * Three absences are as load-bearing as the five presences:
 *
 *   • **`userInput` is separate from `instructions` and never concatenated into it.** §F.3: no string
 *     templating, no delimiters, no "the user asked: …". Promoting user text into the channel that
 *     outranks user text "is the whole game". The type makes the concatenation impossible to express
 *     without adding a field.
 *   • **No `tools`.** §F.4 omits it rather than sending it empty, so a successful injection has
 *     nothing to reach. The absence is structural, not a value.
 *   • **No `model`.** §F.2 makes the model server *configuration* owned by the provider
 *     implementation and selected in AI-3; AI-2 must not name one. The handler therefore cannot
 *     express a model, which also means §J.6a/6b hold by construction.
 *   • **No `safetyIdentifier`, and no conversation state.** §12.6 leaves the salted-hash decision
 *     open, so AI-2 does not implement it — a stable pseudonymous identifier crossing to a third
 *     party is a privacy decision, not a technical default. `previous_response_id`, `conversation`
 *     and `background` are absent per §F.6.
 */
export type ProviderRequest = {
  /** §F.3 — server constant, versioned by `policy_version`. Never built from request data. */
  readonly instructions: string;
  /** §F.3 — exactly one `user` message: the validated `message`, unmodified. */
  readonly userInput: string;
  /** §F.5 — the output bound, which is what makes §I.2's spend ceiling calculable. */
  readonly maxOutputTokens: number;
  /** §F.6 — declines the 30-day response retention. Literal `false`, so it cannot be flipped. */
  readonly store: false;
  /** §H.1 — a bare allow-listed language tag, not a profile setting. */
  readonly languageHint: string;
};

/**
 * The provider port.
 *
 * Shaped for the Responses API boundary AI-3 will implement behind it (§F.1) without importing,
 * naming or reaching it: no OpenAI package, no `api.openai.com`, no key. `signal` is not optional —
 * §F.7 requires the connection to be genuinely aborted, and an implementation that cannot receive
 * the signal cannot honour that.
 */
export type AIProvider = {
  readonly generate: (
    request: ProviderRequest,
    signal: AbortSignal,
  ) => Promise<ProviderOutcome>;
};

// ─────────────────────────────────────────────────────────────────────────────
// Logging
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The one log record this function can emit.
 *
 * ── Redaction by allow-list, enforced by the type system ────────────────────
 * §H.3 requires "an allow-list serialiser, not a deny-list regex over free text", and the reason is
 * that "a regex-based redactor fails the first time a new secret shape appears". A closed record
 * type is that allow-list one step earlier: there is no property on this object that can hold the
 * message text, the answer text, a header, a token, a provider error body or a rejected field's
 * value, so no call site can pass one — not by accident, and not under a `debug` flag, because there
 * is no free-text field to smuggle it through.
 *
 * Two fields §H.3's example log contains are deliberately absent:
 *
 *   • **`user_hash`.** It is the same salted hash as `safety_identifier`, and §12.6 has not decided
 *     whether that hash may exist. Implementing it now would settle a privacy decision by writing a
 *     log line, so AI-2 logs **no** user identifier at all — which also satisfies §H.3's ban on the
 *     raw uuid by leaving nothing to get wrong.
 *   • **`model_config_version`, `input_tokens`, `output_tokens`, `provider_response_id`,
 *     `provider_request_id`, `upstream_status`.** All are facts about a provider call, and AI-2
 *     makes none. They arrive with the provider in AI-3.
 */
export type OperationalLogRecord = {
  readonly event: 'noor_ai_request';
  /** §I.7 — safe to log, safe to display, safe to send to support. Reveals nothing on its own. */
  readonly request_id: string;
  readonly contract_version: number;
  readonly http_status: number;
  readonly outcome: 'answer' | 'refused' | 'error';
  readonly refusal_kind: RefusalKind | null;
  readonly error_code: ErrorCode | null;
  /**
   * The **name** of a rejected field, never its value (§C.6, §H.3).
   *
   * `request-schema.ts` additionally refuses to put an unrecognised name here unless it matches a
   * conservative identifier shape, so attacker-controlled text cannot reach a log line through the
   * one field that carries caller-chosen content.
   */
  readonly error_field: string | null;
  /** A closed enum from `AuthFailureReason`. Not a token, not a claim value, not a message. */
  readonly auth_reason: AuthFailureReason | null;
  /** §F.3 — identifies the instruction revision without the instruction text being in the log. */
  readonly policy_version: string;
  /** §G.7.5 — the crisis path is recorded "by **category only** — never the text". */
  readonly safety_category: SafetyCategory | null;
  /** §H.3 — "metadata, not content: they say how much was asked, never what". Code points. */
  readonly message_length: number | null;
  readonly surface_accepted: boolean | null;
  readonly locale_accepted: boolean | null;
  readonly rate_limit_state: 'ok' | 'limited' | 'unavailable' | 'not-evaluated';
  readonly retry_after_seconds: number | null;
  readonly provider_outcome: ProviderOutcomeKind | null;
  /** §F.8 — "a rising retry rate is a signal, and one buried in a loop is not". */
  readonly provider_attempts: number;
  /** §I.5 — recorded distinctly from a 503 because it is a different engineering problem. */
  readonly upstream_malformed: boolean;
  /** §F.8 / §J.13d — a quota failure "must page a human", so it is flagged, not just counted. */
  readonly operator_alert: 'quota_exhausted' | null;
  readonly duration_ms: number;
};

export type Logger = {
  readonly record: (entry: OperationalLogRecord) => void;
};

// ─────────────────────────────────────────────────────────────────────────────
// Handler configuration and the full dependency set
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The server constants §F.5, §F.7 and §I.2 require but do not fix.
 *
 * §F.7 is explicit that concrete values are "set in AI-3 against measured latency for the selected
 * model", and that "fixing numbers here before anything has been measured would be inventing them".
 * So they are injected: production supplies placeholders it never gets to use, and tests supply
 * values that make the timeout and retry paths deterministic.
 */
export type HandlerConfig = {
  /** §I.2's kill switch. Checked after validation and before the rate-limit read. */
  readonly enabled: boolean;
  /** §F.5. */
  readonly maxOutputTokens: number;
  /** §F.7 — the upstream wall clock, enforced by aborting the provider operation. */
  readonly upstreamTimeoutMs: number;
  /** §F.7 — strictly greater than the upstream budget plus auth and rate-limit overhead. */
  readonly handlerBudgetMs: number;
  /**
   * The delay before the single permitted retry when the provider sends no `Retry-After`.
   *
   * §F.8 describes "exponential backoff with jitter", which is the right shape for a chain of
   * retries. There is no chain here — "2 total, i.e. at most one retry" — so there is one delay, and
   * a jittered single delay would only make the test non-deterministic while randomising nothing
   * that matters. If AI-3 raises the attempt cap, jitter comes back with it.
   */
  readonly retryBackoffMs: number;
};

export type NoorAIDependencies = {
  readonly verifier: ClaimsVerifier;
  readonly provider: AIProvider;
  readonly rateLimiter: RateLimiter;
  readonly clock: Clock;
  readonly timer: Timer;
  readonly requestIds: RequestIdSource;
  readonly logger: Logger;
  readonly config: HandlerConfig;
};
