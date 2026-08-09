import type { SupportedLocale } from '@application/providers/localization-provider';
import type { AIRequestContext } from '@shared/permissions/ai-scope';

import type { AIAskOrchestrator } from './ai-orchestrator.contract';

/**
 * The Noor AI mobile contract — what the app is allowed to send, and what it is allowed to know.
 *
 * Every shape here is `docs/NOOR_AI_BACKEND_CONTRACT.md` transcribed for the client side: §C.2 for
 * the request, §C.4 for the success schema, §C.9/§I.5/§I.6 for the two error producers, and §12.1
 * for the two shape gaps AI-1 deliberately left open. It is a separate module from the service for
 * the same reason `contract.ts` is separate from `handler.ts` on the server: the shapes are the
 * thing AI-5 programs against, and a shape that lives inside the function that produces it is a
 * shape nobody can review without reading control flow.
 *
 * ── Nothing here can carry a secret, and that is structural ──────────────────
 * There is no field for a provider key, a service-role key, a model name, a signing secret, a
 * project reference or a function secret — §B.2 says the repository may hold none of them, and
 * `AIOrchestratorConfig`'s note in `ai-orchestrator.contract.ts` has said since Phase 1 that "any
 * design that would need a key on device is wrong". There is also no field for a user id, an access
 * token, a generation parameter or an identity of any kind: §C.6 rejects every one of those by name
 * on the server, and a client type that could express one is a client that will eventually send one.
 *
 * ── What the caller may not choose ───────────────────────────────────────────
 * The complete set of caller-controlled inputs is a prompt, a local policy context, an optional
 * locale and an optional cancellation signal. Identity comes from the verified token (§D), the
 * model and every generation parameter are server configuration (§F.2, §F.5), and the per-user
 * opaque identifier OpenAI receives is derived server-side after JWT verification — the app cannot
 * supply, seed, override or observe it.
 */

/** NoorLife's own contract version (§C.2). Not the `/functions/v1/` platform path prefix. */
export const NOOR_AI_CONTRACT_VERSION = 1;

/** The deployed function name. The adapter never builds a URL, so this is the whole address. */
export const NOOR_AI_FUNCTION_NAME = 'noor-ai';

/**
 * §C.3.1's byte cap, mirrored so an oversized request is refused before it is sent.
 *
 * The server enforces this against `Content-Length` and again while reading. Checking it here as
 * well is not redundancy for its own sake: a body the server will certainly reject is a round trip
 * that costs the user their connection and costs NoorLife an invocation, and §I.1's quota request id
 * is minted per handler execution, so an avoidable invocation is not free.
 */
export const NOOR_AI_MAX_BODY_BYTES = 8192;

/** §C.3.6 — Unicode code points after trimming, so an Arabic question is not penalised. */
export const NOOR_AI_MAX_MESSAGE_CODE_POINTS = 1000;

/**
 * The upper bound on an answer this client will accept, in code points.
 *
 * A structural bound, not a token estimate. §F.5 caps generation with `max_output_tokens`, which is
 * a server constant the client cannot see and must not assume; this is the separate question of how
 * much text the app is willing to hold and render from a response it did not author. 8192 is the
 * same order as §C.3.1's request cap and is far above anything the committed output ceiling can
 * produce, so it rejects a malformed or hostile body without ever rejecting a real answer.
 *
 * Over the bound the answer is **refused, not truncated** — §C.3's rule in the other direction:
 * showing half an answer as if it were whole is worse than declining it.
 */
export const NOOR_AI_MAX_ANSWER_CODE_POINTS = 8192;

/** The bound on NoorLife's own refusal copy (§C.4). Short by construction; see `policy-copy.ts`. */
export const NOOR_AI_MAX_EXPLANATION_CODE_POINTS = 1000;

/**
 * How long the client waits before giving up, in milliseconds.
 *
 * Deliberately **greater** than the committed server-side handler budget rather than tuned against
 * it. The server owns the deadline — §F.7 gives it a handler budget strictly greater than its
 * upstream budget, and it answers §I.5's `timeout` when either is exhausted. A client that gave up
 * first would abandon a request the server is still going to complete, and because §I.1 mints a
 * fresh quota request id per handler execution the adapter may not then retry (see
 * `NOOR_AI_ONE_INVOCATION_INVARIANT`). So this exists only to stop a connection that has genuinely
 * stopped answering, and it sits above the server's own ceiling so the server's honest `timeout`
 * wins the race in every ordinary case.
 */
export const NOOR_AI_CLIENT_TIMEOUT_MS = 30_000;

/**
 * §C.5's surface allow-list, mirrored, and the reason it is mirrored rather than imported.
 *
 * The list is owned by `supabase/functions/noor-ai/allow-lists.ts`, which is Deno source behind no
 * path alias and cannot be imported by React Native. The same problem produced the same answer on
 * the server side for the refusal copy — see `policy-copy.ts` — and the same remedy applies:
 * `__tests__/noor-ai-adapter-guards.test.ts` reads that file as text and asserts the two lists are
 * identical, so a drift is a failing test rather than a silently downgraded answer.
 *
 * §12.1 is what makes the client hold a copy at all: "serialise **nothing** from it except an
 * allow-listed `surface` derived from `currentScreen`". An unrecognised route is therefore omitted
 * from the body entirely and the server applies its own default, which is exactly §C.5's forgiving
 * behaviour — "a route rename shipped in a new app build must not make Noor AI start failing".
 */
export const NOOR_AI_SURFACE_ALLOW_LIST: readonly string[] = [
  '/ai',
  '/ai/history',
  '/ai/saved',
  '/ai/sources',
  '/ai/permissions',
  '/home',
  '/modules',
  '/insights',
  '/notifications',
  '/settings',
  '/profile',
  '/profile/privacy-security',
  '/subscription',
  '/faith',
  '/health',
  '/planner',
  '/finance',
  '/learning',
  '/family',
  '/goals',
];

/**
 * The complete request body, and the complete list of fields that may ever be sent.
 *
 * Four fields, matching §C.2 exactly. §C.6 rejects any other property **by name**, so this type is
 * not a convenience — it is the client half of a boundary the server enforces. `surface` and
 * `locale` are optional because §C.2 makes them optional, and the adapter omits rather than
 * defaults them so the server's own defaults stay the single source of that decision.
 *
 * @see NOOR_AI_REQUEST_FIELDS — the same set as data, asserted by test.
 */
export type NoorAIRequestBody = {
  readonly contract_version: typeof NOOR_AI_CONTRACT_VERSION;
  readonly message: string;
  readonly surface?: string;
  readonly locale?: SupportedLocale;
};

/** The complete field set, as data, so the allow-list is inspectable and testable. */
export const NOOR_AI_REQUEST_FIELDS = [
  'contract_version',
  'message',
  'surface',
  'locale',
] as const satisfies readonly (keyof NoorAIRequestBody)[];

/**
 * A successful answer, reduced to what a screen may see.
 *
 * §C.4 defines five fields on the wire; three of them reach here. `request_id` and
 * `accessed_modules` deliberately do not — see `NOOR_AI_ANSWER_FIELDS` for `request_id` and the
 * note on `sources` for the other.
 */
export type NoorAIAnswer = {
  /** §C.4 — plain text. No markdown contract in AI-1, no HTML, no links the client must resolve. */
  readonly text: string;
  /**
   * §C.4 — `length` means the model hit the output ceiling and "the client must say so rather than
   * presenting a truncated answer as finished". Carried for exactly that reason.
   */
  readonly finish: NoorAIFinishReason;
  /**
   * §C.4 — always empty in AI-1, because there is no retrieval layer and nothing was read.
   *
   * Typed as an empty tuple rather than `readonly NoorAISource[]`, which is the same choice
   * `contract.ts` makes on the server and for the same reason: `[]` becomes the only value it can
   * hold, so "populate it truthfully" stays AI-6's deliberate change rather than something a later
   * edit can do by accident. A type that cannot hold a citation is stronger than a test that checks
   * there is not one.
   */
  readonly sources: readonly never[];
};

/** §C.4's closed set. `length` is not an error and must not be rendered as one. */
export type NoorAIFinishReason = 'complete' | 'length';

/** The complete field set, as data, so the allow-list is inspectable and testable. */
export const NOOR_AI_ANSWER_FIELDS = [
  'text',
  'finish',
  'sources',
] as const satisfies readonly (keyof NoorAIAnswer)[];

/**
 * §C.4's three policy refusal kinds.
 *
 * `unavailable` from `AIRefusal` is deliberately absent, and that absence is the resolution of
 * §12.1's response half: an unavailable service is a **failure**, not a policy outcome, and this
 * contract keeps them apart the way the wire format does (§C.4 versus §I.5).
 */
export type NoorAIRefusalKind = 'out-of-scope' | 'safety-boundary' | 'permission-required';

/**
 * A refusal — a *successful* request whose answer is "no" (§C.4).
 *
 * `explanation` is the one server-supplied string this adapter passes through, and it is safe
 * because of where it comes from rather than because it looks harmless: `policy-copy.ts` holds it
 * as a source constant mirrored from `src/shared/permissions/ai-scope.ts` and
 * `src/features/modules/module-ai-policy.ts`, `repo-parity_test.ts` asserts the mirror, and
 * `refusalResponse` builds it from the deterministic policy table rather than from provider output.
 * It is NoorLife's own copy, chosen before the request happened — which is precisely the property
 * §I.6 demands of any text a user is shown. It is still length-bounded here, because a response is
 * untrusted input regardless of who is supposed to have written it.
 *
 * `suggested_handoff` is not carried. §C.4 reserves it for AI-9 and pins it to `null` today, so a
 * field here would be a field with one possible value and a standing invitation to fill it in.
 */
export type NoorAIRefusal = {
  readonly kind: NoorAIRefusalKind;
  readonly explanation: string;
};

/**
 * Every failure a Noor AI surface has to render — the finite, safe, client-facing set.
 *
 * ── Why this is a closed union of NoorLife's own words ───────────────────────
 * §I.6: provider and platform error bodies "are never forwarded, wrapped, embedded, or appended",
 * and a gateway `{ "code": 401, "message": "Invalid Token or Protected Header formatting" }` is "a
 * correct machine-readable response and a terrible thing to show a person". The only way to
 * guarantee a screen never renders one is for the screen to have no way to receive one. So the
 * adapter classifies once and returns a tag; there is no `message`, no `detail`, no `cause` and no
 * `raw` field on any state below, and no state carries an identifier of any kind.
 *
 * ── The two producers collapse into one set ──────────────────────────────────
 * §C.9 and §12.11: a request can fail at the Edge gateway before the handler exists, in Supabase's
 * platform shape and with no NoorLife `request_id`, or inside the handler in NoorLife's stable
 * schema. §12.11 requires both categories normalised into the same small set, "treating a 401 from
 * either producer as one 'session expired' state" — which is why `authentication-required` is
 * reached from both and why nothing here records which producer answered.
 *
 * ── Naming ───────────────────────────────────────────────────────────────────
 * Kebab-case, matching `AuthErrorCode` and `SecurityErrorCode`, which are the two closed failure
 * unions this application already ships.
 */
export type NoorAIFailureState =
  /**
   * The session is missing, expired, or was refused by the gateway or the handler.
   *
   * One state for four distinct causes on purpose (§12.11). The user's remedy is identical in all
   * of them — sign in again — and telling them apart would mean telling the user which of NoorLife's
   * two authentication layers rejected them, which is an internal detail dressed up as help.
   */
  | 'authentication-required'
  /**
   * The request was not acceptable, and resending it unchanged cannot help.
   *
   * Reached locally before any invocation (empty, oversized or control-character-bearing input) and
   * from the server's §I.5 4xx codes that describe a malformed request rather than a transient
   * condition. Distinct from every state below because it is the only failure the *caller* can fix.
   */
  | 'invalid-request'
  /**
   * A rate, quota or concurrency limit refused the request (§I.1, §I.5 `rate_limited`).
   *
   * Deliberately not folded into `authentication-required` — nothing is wrong with the session —
   * and deliberately not folded into `temporarily-unavailable`, because the wait is short and
   * user-specific rather than service-wide.
   */
  | 'temporarily-limited'
  /**
   * Noor AI is not answering right now: disabled, over a ceiling, degraded, or upstream-failed.
   *
   * This is the state the **current deployment always reaches** once authenticated. The function is
   * deployed and source-disabled — §I.2's kill switch is the literal `false` — so an otherwise valid
   * request fails closed with §I.5's stable `503` after authentication and validation have both run.
   */
  | 'temporarily-unavailable'
  /** No usable connection, recognised as such. Never a catch-all — see `unknown`. */
  | 'network-unavailable'
  /** The request was abandoned after the client deadline, or the server reported §I.5 `timeout`. */
  | 'timed-out'
  /** The caller aborted the request. Not a failure to report, and never to be shown as one. */
  | 'cancelled'
  /**
   * A 2xx response that does not match §C.4, or a body that is not the JSON object it claims to be.
   *
   * Fails closed by design. A response the adapter cannot fully validate is a response it will not
   * partially believe, because the alternative is rendering unvalidated server-supplied text.
   */
  | 'invalid-server-response'
  /**
   * No Supabase URL or publishable key in this build.
   *
   * Local and pre-invocation; it cannot arise from any response. Named separately because
   * `AuthErrorCode` and `SecurityErrorCode` both name it, and because a build that was never
   * configured is not a service that is temporarily down.
   */
  | 'not-configured'
  /**
   * Everything else, including a status this contract does not describe.
   *
   * Deliberately reached rather than avoided. §I.6's rule cuts both ways: an unrecognised failure
   * classified as "offline" or "rate limited" is a fabricated diagnosis, and a wrong specific
   * answer is worse than an honest generic one.
   */
  | 'unknown';

/**
 * What one `ask` produced.
 *
 * Three outcomes, which is §12.1's response half resolved: `AIResult` models `answer | refused`,
 * and every one of §I.5's thirteen conditions plus §12.11's separate gateway category collapsed
 * into the bare `AIRefusal.unavailable` tag — so "a rate limit, a timeout, a provider outage, an
 * expired session and an oversized message all arrive at the UI as the same value". They no longer
 * do. `failed` is a third outcome rather than a fourth refusal kind because §C.4 and §I.5 keep
 * policy and failure apart on the wire and the client type should not merge what the wire separates.
 *
 * §12.1 also proposed carrying the `request_id` here as design-spec state 21's "optional error
 * reference". This adapter does **not**, and the divergence is deliberate rather than an oversight:
 * this phase's brief requires that no identifier of any kind escapes to a UI consumer. Nothing in
 * §I.7 is weakened by that — it says the id is *safe* to display, not that it must be — and no
 * security boundary moves, because withholding an identifier is strictly narrower than showing one.
 * The cost is real and is recorded rather than hidden: state 21's error reference cannot be
 * rendered from this adapter, and re-opening it is an AI-5 decision with its own review.
 */
export type NoorAIResult =
  | { readonly outcome: 'answer'; readonly answer: NoorAIAnswer }
  | { readonly outcome: 'refused'; readonly refusal: NoorAIRefusal }
  | { readonly outcome: 'failed'; readonly failure: NoorAIFailureState };

/** Per-call options. Nothing here reaches the request body. */
export type NoorAIAskOptions = {
  /**
   * Cancellation, if the caller has a reason to abandon the request.
   *
   * Surfaced as `cancelled` rather than an error state, and distinguished from the client deadline
   * by which signal fired — see the service. An abort does not make a sent request un-sent, which
   * is why cancelling is still one invocation.
   */
  readonly signal?: AbortSignal;
  /** §C.2 — answer language. Omitted from the body when absent; the server defaults to `en`. */
  readonly locale?: SupportedLocale;
};

/**
 * The seam AI-5 depends on.
 *
 * ── Why the signature is `(prompt, context)` ────────────────────────────────
 * It is §12.1's prescribed resolution for the request half, verbatim: "keep the
 * `ask(prompt, context)` signature, use `context` locally only, and serialise **nothing** from it
 * except an allow-listed `surface` derived from `currentScreen`." `AIRequestContext` carries
 * `scope.permittedModules` and `grantedModules`, and §C.6 rejects every one of those as a body
 * field — "a client-sent grant is a self-issued permission". The object is right as a local
 * decision and wrong as a wire field, so it stays local. `__tests__` asserts the body matches §C.2
 * exactly, "so this cannot regress by someone helpfully spreading the context object into the
 * payload".
 *
 * ── It **is** the orchestrator's ask channel, formally ──────────────────────
 * This extends `AIAskOrchestrator<NoorAIResult>` — the named ask half of `AIOrchestrator` — so the
 * relationship is checked by the compiler at this declaration rather than asserted in prose. §K
 * assigns AI-4 "an `AIOrchestrator` implementation", and this is the honest reading of that: the
 * ask channel is implemented against the formally defined subset, and `confirmAction` is **not**
 * implemented because no tool can propose an `AIActionPreview` yet (§F.4, §A.2) and a method that
 * could only fail would be a worse answer than an absent one.
 *
 * That is a **staged interface boundary, not a divergence**. `AIOrchestrator` is unchanged and
 * still requires `confirmAction` with its original security property; composing this adapter into
 * the full interface is AI-9's, in the same change that makes a confirmable action exist.
 *
 * ── The third parameter, and why it does not break the subset ───────────────
 * `options` is optional, so a caller holding only `AIAskOrchestrator<NoorAIResult>` still sees the
 * two-argument signature and can call it with two arguments. TypeScript checks that at the
 * `extends` clause below, and `__tests__/ai-orchestrator-staging.test.ts` proves it at type level
 * from the outside as well — no cast, unsafe or otherwise, is used to claim conformance anywhere.
 *
 * ── Why a port when there is exactly one implementation ─────────────────────
 * The same reason `AccountSecurityPort` is one: several states a screen must render are
 * unreachable without a live service — a quota refusal, a provider outage, an expired session — and
 * the alternative to injecting them is shipping without having seen them.
 */
export interface NoorAIPort extends AIAskOrchestrator<NoorAIResult> {
  readonly ask: (
    prompt: string,
    context: AIRequestContext,
    options?: NoorAIAskOptions,
  ) => Promise<NoorAIResult>;
}

/**
 * The one-invocation rule, stated where a reader of the types will meet it.
 *
 * §I.1's quota store mints a **fresh request id per handler execution**, so two invocations of the
 * same question are two reservations, two provider attempts and two charges — a client retry is
 * not idempotent and this adapter never claims it is. §I.5 marks several codes "retryable", and
 * that is a statement about what a *person* may choose to do after reading an error, not a licence
 * for the adapter to do it silently.
 *
 * Therefore: **at most one function invocation per `ask`, and never an automatic second one.** A
 * local validation failure produces zero. There is no path through the service that invokes twice —
 * asserted behaviourally for every failure class, and structurally by a source scan that counts the
 * invocation call sites.
 */
export const NOOR_AI_ONE_INVOCATION_INVARIANT =
  'At most one Edge Function invocation per ask; no automatic retry; client retries are not idempotent.';
