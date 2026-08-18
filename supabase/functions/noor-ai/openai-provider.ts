import { LOCALE_ALLOW_LIST } from './allow-lists.ts';
import type { FinishReason } from './contract.ts';
import { isActiveSafetyIdentifier } from './safety-identifier.ts';
import type {
  AIProvider,
  ProviderOutcome,
  ProviderResult,
  ProviderUsage,
  SafetyCategory,
} from './ports.ts';

/**
 * The OpenAI Responses API adapter — the one module in this function that can reach a third party.
 *
 * ── Documentation this file is written against ───────────────────────────────
 * Every field name, status code, response shape and price below was read off the official developer
 * documentation at `developers.openai.com` on **2026-08-09**, not from memory and not from a search
 * snippet. The pages, and what each fixed:
 *
 *   • `/api/docs/api-reference/responses/create` — the request fields (`model`, `instructions`,
 *     `input`, `store`, `max_output_tokens`, `reasoning.effort`, `text.format`, `safety_identifier`),
 *     the response object (`status` of `in_progress` | `completed` | `incomplete`, the `output`
 *     array of `message` and `reasoning` items, `output_text` and `refusal` content parts,
 *     `incomplete_details.reason`) and the usage object (`input_tokens`, `output_tokens`,
 *     `output_tokens_details.reasoning_tokens`, `input_tokens_details.cached_tokens`).
 *   • `/api/docs/guides/structured-outputs` — `text.format` as `{ type: 'json_schema', name, schema,
 *     strict }`, and the strict subset: every property `required`, `additionalProperties: false`, no
 *     root-level `anyOf`.
 *   • `/api/docs/models/gpt-5.6-terra` — the slug, that Responses is a supported endpoint, that
 *     `structured_outputs` is a supported feature, the 128,000 max output tokens, and the price.
 *   • `/api/docs/models` — the reasoning-effort set the GPT-5.6 family shows: `none`, `low`,
 *     `medium`, `high`, `xhigh`, `max`. `minimal` is **not** in it and is never sent. No dated
 *     snapshot id is published for any GPT-5.6 model, which is why the slug is a reviewed alias.
 *   • `/api/docs/guides/reasoning` — reasoning tokens are billed as output tokens and count against
 *     `max_output_tokens`; exhausting it yields `status: 'incomplete'` with
 *     `incomplete_details.reason: 'max_output_tokens'`.
 *   • `/api/docs/guides/rate-limits` — `429`, and `Retry-After` as "the minimum number of seconds to
 *     wait before retrying a temporary rate-limit error, when present".
 *   • `/api/docs/guides/error-codes` — the `error.type` / `error.code` / `error.message` shape, and
 *     that the billing and spend-limit conditions are `429`s distinguished by those two strings.
 *   • `/api/docs/guides/safety-best-practices` — `safety_identifier` is "recommended … but not
 *     required", with the instruction to hash rather than send identifying information.
 *   • `/api/docs/guides/your-data` — API data is not used for training by default; stored responses
 *     are retained at least 30 days, which is what `store: false` declines.
 *
 * ── Nothing here is enabled ──────────────────────────────────────────────────
 * This module is written, tested against a mocked `fetch`, and **not reachable**. Three independent
 * locks hold, and each one alone is sufficient:
 *
 *   1. `productionConfig.enabled` is `false` (§I.2's kill switch), so the handler never reaches a
 *      provider at all.
 *   2. No `OPENAI_API_KEY` exists in any environment. With no key `createOpenAIProvider` returns the
 *      provider that can only refuse, before any transport is constructed.
 *   3. **No HMAC key exists.** B10 is now implemented — `safety-identifier.ts` derives a per-user
 *      opaque value server-side — but its dedicated secret has not been generated or provisioned, so
 *      the handler answers `503` before a reservation is taken and this adapter is never invoked.
 *      This module's own gate is independent of that: a request whose `safetyIdentifier` is missing or
 *      malformed makes **zero** fetch calls, whatever the key situation is.
 *
 * ── What this module may know about the identifier, and what it may not ──────
 * It **accepts** an already-derived value on `ProviderRequest`, validates that it is an identifier of
 * the **currently active version** — not merely a syntactically valid one, and not against a version
 * literal restated here — and copies it into one API field. It does not derive it, does not decode it,
 * does not persist it,
 * does not log it — there is no logger here — and does not return it in any outcome. There is no key
 * material, no user identity and no digest primitive in scope in this file, and
 * `tests/source-scan_test.ts` asserts each of those absences, so nobody can route around B10's review
 * by computing an identifier at the boundary.
 *
 * ── No retry, deliberately ───────────────────────────────────────────────────
 * `generate` issues exactly one HTTP request and returns. §F.8 permits one retry and the handler owns
 * it, because the handler is the only thing that can see §F.7's deadline. A retry policy that cannot
 * see the deadline is a retry policy that can blow through it — the same reasoning `quota-rpc.ts`
 * records, and the same conclusion.
 *
 * ── The key ──────────────────────────────────────────────────────────────────
 * Held in one closure variable and written to exactly one place: the `Authorization` request header.
 * It is never in the URL, never in the body, never in a thrown message, never in a returned value and
 * never in anything this module could log — there is no logger here at all. `redirect: 'error'` means
 * a redirect is a transport failure rather than a second request, so the header cannot be replayed to
 * a host of the provider's choosing.
 */

// ─────────────────────────────────────────────────────────────────────────────
// The boundary, as constants a reviewer can read in one place
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The fixed origin. Not configurable, by construction.
 *
 * There is deliberately no environment variable, no config field and no parameter that can change
 * it. `SUPABASE_URL` gets a validator in `quota-rpc.ts` precisely because it *is* read from the
 * environment; the stronger form of that defence is to have nothing to validate, which is what a
 * literal gives. Anything that could set an environment variable on this function could otherwise
 * redirect a request carrying the provider key to a host of its choosing.
 */
export const OPENAI_ORIGIN = 'https://api.openai.com';

/** The only route this function calls. There is no path parameter and no second endpoint. */
export const OPENAI_RESPONSES_PATH = '/v1/responses';

/**
 * §F.2 / plan §3.6 R1 — the selected model, as a **controlled reviewed alias**.
 *
 * No dated immutable snapshot is published for any GPT-5.6 model, so there is nothing else to pin
 * (plan §3.7). The alias controls that section requires are: one place — this constant, pinned by an
 * exact-equality assertion in `tests/source-scan_test.ts` so no second file can name a model;
 * re-verified before any traffic; and treated as a configuration change requiring a re-run of §J.
 *
 * Plan §3.7 item 1 proposed reading the slug from the environment instead. That is deliberately not
 * done here: this phase fixes the function's environment surface at one new name (`OPENAI_API_KEY`),
 * and a second environment read would be a second thing that can silently retarget the model, with no
 * validator possible. The exact-equality source scan gives the same "one reviewable place" property
 * without adding that surface. The deviation is recorded in the AI-3 plan.
 */
export const OPENAI_MODEL = 'gpt-5.6-terra';

/**
 * Plan §4.3 R2 — `low`, sent explicitly rather than inherited.
 *
 * A documented value for the GPT-5.6 family. It is sent explicitly because the family's **default**
 * effort is not documented anywhere (plan §2.2), so inheriting would mean not knowing what was asked
 * for. `reasoning.mode` is omitted entirely: `standard` is the documented default, and omitting means
 * there is no field for a later edit to flip to `pro`, which costs more tokens.
 */
export const OPENAI_REASONING_EFFORT = 'low';

/** The structured-output schema name. Identifies the shape; carries no data. */
export const STRUCTURED_OUTPUT_NAME = 'noor_ai_answer';

/**
 * The enum member meaning "no category applies", so `safety_category` is a plain required string.
 *
 * Strict structured output requires every property to be `required`. A nullable enum is expressible,
 * but a sentinel is unambiguous under every reading of the strict subset, and the mapping back to the
 * port's `SafetyCategory | null` is one line below.
 */
export const NO_CATEGORY = 'none';

/**
 * Plan §4.9 — the response body cap. A bounded output implies a bounded body.
 *
 * An unbounded read is a memory risk against Supabase's 256MB function limit, and the failure it
 * guards against is not a hostile provider but a wrong one: a proxy returning an HTML error page, or
 * a stream that does not terminate.
 */
export const MAX_RESPONSE_BYTES = 262_144;

/**
 * Plan §4.9 — a structural impossibility check, not a truncation policy.
 *
 * A 2,000-token answer cannot reach 8,000 code points. Text beyond it means the response is not the
 * one this request asked for, so it fails closed rather than being cut down to fit.
 */
export const MAX_ANSWER_CODE_POINTS = 8_000;

/**
 * The database's own per-attempt token ceiling
 * (`supabase/migrations/20260808180000_noor_ai_quota_store.sql`, `attempt_tokens_bounded`).
 *
 * Mirrored here so an absurd usage figure is rejected at the boundary rather than becoming a failed
 * `register_attempt` — which the handler correctly turns into a `503` for a request that had
 * otherwise succeeded.
 */
export const MAX_USAGE_TOKENS = 10_000_000;

/**
 * The largest `Retry-After` this adapter will pass on.
 *
 * The value reaches the handler, which multiplies it by 1000 and both waits and reports it. An
 * unbounded number from a third party therefore decides how long NoorLife sleeps and what the client
 * is told to wait — so it is validated as delta-seconds and capped. Beyond the cap the honest answer
 * is "no usable hint" rather than a number nobody checked.
 */
export const MAX_RETRY_AFTER_SECONDS = 300;

/** Terra's documented maximum output tokens. A request above it is a configuration fault. */
const MODEL_MAX_OUTPUT_TOKENS = 128_000;

/**
 * The coarse category a provider-side refusal is reported as.
 *
 * The provider decided to refuse and NoorLife did not classify why. `out-of-scope` is §E.1/§G.9's
 * catch-all, which server policy answers with `OUT_OF_SCOPE_REFUSAL` plus §G.8's handoff — NoorLife's
 * own words. The provider's refusal string is read to recognise the shape and then discarded: §I.6
 * forbids provider wording crossing a boundary, and a refusal message is provider wording.
 */
const PROVIDER_REFUSAL_CATEGORY: SafetyCategory = 'out-of-scope';

// ─────────────────────────────────────────────────────────────────────────────
// The closed category set, shared with the schema so the two cannot drift
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Every category the model may return, as a `Record` over the union.
 *
 * A `Record<SafetyCategory, true>` rather than an array: adding a member to `SafetyCategory` is then
 * a compile error here, so the outbound schema and the policy table cannot drift apart. A category
 * the model invents is not in this object, so it is rejected — the model cannot widen its own
 * vocabulary, which is what "provider classification is input to policy, not the decision" requires.
 */
const SAFETY_CATEGORIES: Readonly<Record<SafetyCategory, true>> = {
  'module-data-required': true,
  'family-private': true,
  'health-advice': true,
  'prescribed-treatment': true,
  'crisis': true,
  'finance-advice': true,
  'finance-product': true,
  'finance-education': true,
  'citation-required': true,
  'out-of-scope': true,
};

/** The enum sent in the schema: every category, plus the "nothing applies" sentinel. */
export const SAFETY_CATEGORY_ENUM: readonly string[] = [
  ...Object.keys(SAFETY_CATEGORIES),
  NO_CATEGORY,
];

/** `undefined` means the value is not one this contract recognises, which fails closed. */
function toCategory(value: string): SafetyCategory | null | undefined {
  if (value === NO_CATEGORY) {
    return null;
  }
  return Object.hasOwn(SAFETY_CATEGORIES, value) ? value as SafetyCategory : undefined;
}

/**
 * The strict JSON Schema for the answer.
 *
 * ── Why the classification guidance lives here rather than in `buildInstructions()` ──
 * `policy.ts` owns §F.3's instruction text and `POLICY_VERSION` versions it; the property
 * descriptions below describe an API-level output *shape*, not a safety rule. Keeping them apart
 * means the schema can change with the provider contract without re-versioning the policy, and the
 * boundaries themselves stay in exactly one place — `PROHIBITED_TOPICS`, mirrored from `src/`.
 *
 * Every property is `required` and `additionalProperties` is `false`, as the strict subset demands.
 */
export function buildAnswerSchema(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['answer_text', 'safety_category', 'citation_required'],
    properties: {
      answer_text: {
        type: 'string',
        description:
          'The answer to show the user, in plain text. Empty only if the question is refused.',
      },
      safety_category: {
        type: 'string',
        enum: SAFETY_CATEGORY_ENUM,
        description:
          `Which boundary the question touches, or "${NO_CATEGORY}" when none applies. Use only ` +
          'these values; never invent one.',
      },
      citation_required: {
        type: 'boolean',
        description:
          'True when a correct answer would have to quote or attribute a source. You have none.',
      },
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// The provider that is not there
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The provider that can only report that there is no provider.
 *
 * Returned by `createOpenAIProvider` whenever the key is absent — which is every environment today.
 * It performs no network call and constructs no transport, so the refusal happens before anything
 * could be sent rather than as an error path after the fact.
 *
 * A stub that answered would be the wrong thing to ship: a canned answer in the production graph is
 * a canned answer one misconfigured deployment away from a user reading it and believing it.
 * `signal` is accepted because the port requires it and ignored because there is nothing to abort.
 */
export const unavailableProvider: AIProvider = {
  // deno-lint-ignore require-await
  generate: async () => ({ kind: 'unavailable' }),
};

// ─────────────────────────────────────────────────────────────────────────────
// Configuration, and the two gates on it
// ─────────────────────────────────────────────────────────────────────────────

/** A uuid anywhere in the string, in any case. */
const UUID_ANYWHERE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/**
 * Whether a candidate identifier is an identity rather than a derived value.
 *
 * §H.2's deny-list is the rule; this is the structural half of it. A raw uuid is a join key into
 * NoorLife's own database, and an email or an embedded uuid arriving here would mean something
 * upstream had substituted an identity for a derived value. Both are refused rather than sent.
 *
 * It is deliberately redundant with the format check, which no email and no bare uuid can satisfy.
 * Redundancy is the point, and it is not only theoretical: a uuid is 36 characters of `[0-9a-f-]`,
 * which is a subset of the approved alphabet, so seven filler characters produce a value the format
 * check alone would pass. This is what refuses it.
 */
function looksLikeIdentity(value: string): boolean {
  return UUID_ANYWHERE.test(value) || value.includes('@');
}

/**
 * Whether an already-derived identifier may travel.
 *
 * Both halves must hold: it is an identifier of the **currently active** version, and it is not an
 * identity in any spelling. A value failing either makes the whole request `unavailable` **before**
 * any transport is touched — so a derivation bug becomes zero outbound requests rather than a wrong
 * subject sent to a third party.
 *
 * ── Why the active version rather than any syntactically valid one ───────────
 * `isActiveSafetyIdentifier` is imported from `safety-identifier.ts` and reads
 * `SAFETY_IDENTIFIER_ACTIVE_VERSION`. The version is deliberately **not** restated here as a literal:
 * the derivation module can construct values under an inactive version so a rotation can be built and
 * tested before it is switched on, and a second independently written `v1` in this file would be a
 * second thing that rotation has to remember to change — the one it forgets being the one that keeps
 * sending the old version. A syntactically perfect `nl_osi_v2_…` or `nl_osi_v999_…` is refused while
 * v1 is active, and refused before the transport, so it costs zero fetch calls.
 */
function mayTravel(value: unknown): value is string {
  return isActiveSafetyIdentifier(value) && !looksLikeIdentity(value);
}

export type OpenAIProviderConfig = {
  /**
   * `OPENAI_API_KEY`, read from the Edge Function environment by the entry point and handed here.
   *
   * A name only — no value exists in any environment, and none appears in this repository. Absent
   * yields the unavailable provider.
   *
   * ── There is deliberately no identifier option beside it ────────────────────
   * An earlier revision carried a `staticSafetyIdentifier` construction option for the mocked tests.
   * It is **removed**, not repurposed: the adapter is built once per isolate, so a value fixed here
   * would be one constant shared by every user it ever serves — the application, not a person. B10's
   * value is per-request and arrives on `ProviderRequest`, which is the only channel that can carry a
   * different value for a different caller.
   */
  readonly apiKey: string | undefined;
  /** Injected so a test can drive the transport without a network. Defaults to global `fetch`. */
  readonly fetchImpl?: typeof fetch;
};

// ─────────────────────────────────────────────────────────────────────────────
// Defensive reading
// ─────────────────────────────────────────────────────────────────────────────

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/**
 * An output item type that means a tool ran or was requested.
 *
 * §F.4 omits `tools` rather than sending it empty, so nothing was offered and none of these can
 * legitimately appear. The documented item types that are tool activity all end in `_call` or
 * `_call_output`, or belong to the `mcp` family. Recognising them as a distinct outcome rather than
 * as generic malformation is what lets the handler record `unexpected-tool-call` — §F.4: "A handler
 * that 'just handles' an unexpected tool call has quietly added a capability nobody reviewed."
 */
const TOOL_ITEM = /_call$|_call_output$|^mcp/;

/** A single token count: an integer, non-negative, inside the database's own bound. */
function readTokenCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 &&
      value <= MAX_USAGE_TOKENS
    ? value
    : null;
}

/**
 * Documented usage fields only, and `null` for anything this adapter cannot vouch for.
 *
 * ── Why `output_tokens` is split rather than passed through ──────────────────
 * The API's `output_tokens` is the **total** billable output, and
 * `output_tokens_details.reasoning_tokens` is a breakdown *of* it. The database adds the two columns
 * together when it prices an attempt and when it checks its own output ceiling
 * (`register_attempt`), so passing the API total as `outputTokens` alongside the reasoning figure
 * would double-count the reasoning share — inflating recorded spend and, at the ceiling, turning a
 * successful answer into a rejected accounting call. So the visible share is the difference, and the
 * two fields sum back to exactly what the provider reported.
 *
 * `null` means "the provider reported nothing usable". The handler records the attempt with zero
 * tokens, which is a deliberate under-count rather than an estimate: §12.7 already accepts that, and
 * inventing a number would put a fabricated figure into a spend ceiling.
 */
function readUsage(raw: unknown): ProviderUsage | null {
  const usage = asRecord(raw);
  if (usage === null) {
    return null;
  }
  const inputTokens = readTokenCount(usage.input_tokens);
  const totalOutput = readTokenCount(usage.output_tokens);
  const details = asRecord(usage.output_tokens_details);
  // Absent reasoning detail is normal, not a defect: a response with no reasoning items reports none.
  const reasoningTokens = details === null || details.reasoning_tokens === undefined
    ? 0
    : readTokenCount(details.reasoning_tokens);

  if (inputTokens === null || totalOutput === null || reasoningTokens === null) {
    return null;
  }
  if (reasoningTokens > totalOutput) {
    // A breakdown larger than the total it breaks down is a shape this adapter does not recognise.
    return null;
  }
  return { inputTokens, outputTokens: totalOutput - reasoningTokens, reasoningTokens };
}

/**
 * `Retry-After`, as delta-seconds, validated and capped.
 *
 * The header may also carry an HTTP-date. It is not honoured: parsing a date means trusting a third
 * party's clock against ours, and the documented guidance is expressed in seconds. An unparseable,
 * negative, fractional or oversized value yields `null`, which the handler reads as "no hint" and
 * falls back to its own configured backoff.
 */
function readRetryAfter(headers: Headers): number | null {
  const raw = headers.get('retry-after');
  if (raw === null) {
    return null;
  }
  const trimmed = raw.trim();
  if (!/^[0-9]{1,7}$/.test(trimmed)) {
    return null;
  }
  const seconds = Number(trimmed);
  return seconds >= 0 && seconds <= MAX_RETRY_AFTER_SECONDS ? seconds : null;
}

/**
 * Releases a body this adapter will not read.
 *
 * Every non-200 path discards rather than inspects, because §I.6 forbids forwarding backend detail
 * and the surest way to honour that is never to hold it. The one exception is the `429` classifier
 * below, which reads two enum-valued strings and keeps neither.
 */
async function discard(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Already consumed or already errored. There is nothing to release and nothing to report.
  }
}

/**
 * Reads at most `MAX_RESPONSE_BYTES`, then stops.
 *
 * A declared `Content-Length` over the cap is refused without reading a byte; a body that exceeds it
 * while streaming is cancelled mid-read. `null` means "no usable body", which every caller turns into
 * a malformed-upstream outcome.
 */
async function readBoundedText(response: Response): Promise<string | null> {
  const declared = response.headers.get('content-length');
  if (
    declared !== null && /^[0-9]+$/.test(declared.trim()) && Number(declared) > MAX_RESPONSE_BYTES
  ) {
    await discard(response);
    return null;
  }
  const body = response.body;
  if (body === null) {
    return '';
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch {
    // A truncated or aborted body. Nothing about the failure is captured.
    return null;
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

/**
 * The documented `429`s that retrying cannot fix.
 *
 * §F.8 is explicit: "`insufficient_quota` and other billing, spend, or organization-limit `429`s"
 * are **never** retried, because retrying "won't restore API access". They are a different outcome
 * from a transient rate limit — `quota-exhausted`, which the handler answers with `503` **and an
 * operator alert**, because this is the one condition that must page a human.
 */
const BILLING_ERROR_TYPES: ReadonlySet<string> = new Set(['insufficient_quota']);
const BILLING_ERROR_CODES: ReadonlySet<string> = new Set([
  'insufficient_quota',
  'credit_balance_exhausted',
  'organization_spend_limit_exceeded',
  'project_spend_limit_exceeded',
  'organization_usage_limit_exceeded',
  'billing_hard_limit_reached',
]);

/**
 * The `usage` object from a non-200 body, if there is a valid one — and nothing else from it.
 *
 * ── Why an error body is read at all here ────────────────────────────────────
 * A `401` or `403` is an **incurred** attempt: a request was built, sent and answered, so §I.2's
 * spend accounting has to record something. The honest something is whatever the provider reported.
 * The documented error envelope for these statuses carries no `usage`, so in practice this returns
 * `null` and the handler records zero tokens — but "we checked and there was none" is a different
 * claim from "we never looked", and only the first one stays true if the envelope ever gains one.
 *
 * Exactly as in `isBillingLimit`, the read is surgical: `readUsage` accepts only documented numeric
 * fields, and no message, code, status text or body fragment is retained or returned.
 */
async function readSafeUsage(response: Response): Promise<ProviderUsage | null> {
  const text = await readBoundedText(response);
  if (text === null || text === '') {
    return null;
  }
  try {
    return readUsage(asRecord(JSON.parse(text))?.usage);
  } catch {
    return null;
  }
}

/**
 * Whether a `429` is the billing kind, decided from two closed enums and nothing else.
 *
 * The body is read to answer exactly this question. Only `error.type` and `error.code` are looked at,
 * only by set membership, and neither is retained — no message, no `param`, no status text and no
 * body fragment survives this function. An unreadable or unrecognised body means "not billing", which
 * is the safe direction: it becomes a rate limit, which the handler retries at most once and then
 * reports as `503` anyway.
 */
async function isBillingLimit(response: Response): Promise<boolean> {
  const text = await readBoundedText(response);
  if (text === null || text === '') {
    return false;
  }
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return false;
  }
  const error = asRecord(asRecord(payload)?.error);
  if (error === null) {
    return false;
  }
  const type = typeof error.type === 'string' && BILLING_ERROR_TYPES.has(error.type);
  const code = typeof error.code === 'string' && BILLING_ERROR_CODES.has(error.code);
  return type || code;
}

// ─────────────────────────────────────────────────────────────────────────────
// Response parsing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A `200` body, read defensively from the outside in.
 *
 * Usage is extracted first and attached to **every** outcome this function can return, including the
 * malformed ones. That is not tidiness: §I.2's ceilings are enforced from recorded spend, and a
 * response that parsed badly was still billed for the tokens it read. Hanging usage off the success
 * path only would make exactly the wasteful cases invisible to the spend counter.
 */
async function parseSuccess(response: Response): Promise<ProviderResult> {
  const text = await readBoundedText(response);
  if (text === null) {
    return { kind: 'malformed' };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    // Not JSON at all — an HTML error page from a proxy, or a truncated body.
    return { kind: 'malformed' };
  }

  const envelope = asRecord(payload);
  if (envelope === null) {
    return { kind: 'malformed' };
  }

  const usage = readUsage(envelope.usage);
  const result = (outcome: ProviderOutcome): ProviderResult =>
    usage === null ? outcome : { ...outcome, usage };

  /**
   * `envelope.id` is never read. Plan §F.9 and this phase's scope both require the provider's own
   * response id to be neither stored nor exposed, and the strongest form of that is a value this
   * module never binds to a name.
   */
  const status = envelope.status;
  if (status !== 'completed' && status !== 'incomplete') {
    // `in_progress` cannot occur without background mode, which §F.6 forbids and this adapter never
    // requests. Anything else is a shape this contract does not know.
    return result({ kind: 'malformed' });
  }

  const output = envelope.output;
  if (!Array.isArray(output)) {
    return result({ kind: 'malformed' });
  }

  const messages: Record<string, unknown>[] = [];
  for (const entry of output) {
    const item = asRecord(entry);
    if (item === null) {
      return result({ kind: 'malformed' });
    }
    const type = item.type;
    if (type === 'reasoning') {
      // Expected on a reasoning model and carries no visible text. It is counted in `usage`, which
      // has already been read, and contributes nothing else.
      continue;
    }
    if (type === 'message') {
      messages.push(item);
      continue;
    }
    if (typeof type === 'string' && TOOL_ITEM.test(type)) {
      // Not executed. There is nothing here to execute it with — no tool registry, no dispatch table
      // and no outbound path other than the one request this module already made.
      return result({ kind: 'unexpected-tool-call' });
    }
    return result({ kind: 'malformed' });
  }

  // Exactly one assistant message. Several would mean the response is not the single-turn answer this
  // request asked for, and choosing one of them would be the handler inventing a policy.
  const message = messages.length === 1 ? messages[0] : undefined;
  if (message === undefined) {
    return result({ kind: 'malformed' });
  }

  const content = message.content;
  if (!Array.isArray(content) || content.length !== 1) {
    return result({ kind: 'malformed' });
  }
  const part = asRecord(content[0]);
  if (part === null) {
    return result({ kind: 'malformed' });
  }

  if (part.type === 'refusal') {
    // The provider refused. Its wording is not read into anything — server policy owns every string a
    // user sees, and `refusal` here carries only the coarse category.
    return result({ kind: 'refusal', category: PROVIDER_REFUSAL_CATEGORY });
  }

  if (part.type !== 'output_text' || typeof part.text !== 'string') {
    return result({ kind: 'malformed' });
  }

  let structured: unknown;
  try {
    structured = JSON.parse(part.text);
  } catch {
    return result({ kind: 'malformed' });
  }
  const answer = asRecord(structured);
  if (answer === null) {
    return result({ kind: 'malformed' });
  }

  // Exact keys, so a helpfully-added field is a failure rather than something silently ignored.
  const keys = Object.keys(answer).sort();
  if (
    keys.length !== 3 || keys[0] !== 'answer_text' || keys[1] !== 'citation_required' ||
    keys[2] !== 'safety_category'
  ) {
    return result({ kind: 'malformed' });
  }

  const answerText = answer.answer_text;
  const citationRequired = answer.citation_required;
  const rawCategory = answer.safety_category;
  if (
    typeof answerText !== 'string' || typeof citationRequired !== 'boolean' ||
    typeof rawCategory !== 'string'
  ) {
    return result({ kind: 'malformed' });
  }

  const category = toCategory(rawCategory);
  if (category === undefined) {
    // A category outside the closed set. The model does not get to widen its own vocabulary, and a
    // classification NoorLife cannot map is one it cannot apply policy to.
    return result({ kind: 'malformed' });
  }

  if (answerText.trim() === '') {
    /**
     * Two different failures share this line, and both are honestly `malformed`:
     *
     *   • `completed` with no text — the provider produced nothing (§J.14b).
     *   • `incomplete` with no text — plan §4.9's **starvation** case: `max_output_tokens` was
     *     exhausted by reasoning before any visible output, and the attempt was billed. Its remedy is
     *     to raise the cap, not to retry, and the plan records a distinct log field for it as a
     *     separate reviewed addition to `OperationalLogRecord` (plan §9.1) which this phase does not
     *     make.
     */
    return result({ kind: 'malformed' });
  }

  if ([...answerText].length > MAX_ANSWER_CODE_POINTS) {
    return result({ kind: 'malformed' });
  }

  let finish: FinishReason;
  if (status === 'completed') {
    finish = 'complete';
  } else {
    const reason = asRecord(envelope.incomplete_details)?.reason;
    if (reason !== 'max_output_tokens') {
      // Incomplete for a reason this contract has no representation for.
      return result({ kind: 'malformed' });
    }
    // §C.4 / §F.5 — the client must present this as incomplete rather than as a short answer.
    finish = 'length';
  }

  return result({
    kind: 'answer',
    answer: { text: answerText, finish, category, citationRequired },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// The adapter
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Builds the provider, or the one that refuses.
 *
 * The key gate is checked here, before any transport exists, so a missing credential cannot make even
 * one request. B10's gate is deliberately **not** here: an identifier is per-request, so it is checked
 * per request inside `generate`, which is the only place a per-caller value exists.
 */
export function createOpenAIProvider(config: OpenAIProviderConfig): AIProvider {
  const key = config.apiKey ?? '';

  if (key === '') {
    return unavailableProvider;
  }

  const call = config.fetchImpl ?? fetch;
  const endpoint = `${OPENAI_ORIGIN}${OPENAI_RESPONSES_PATH}`;
  const schema = buildAnswerSchema();

  return {
    generate: async (request, signal): Promise<ProviderResult> => {
      /**
       * §F.5's bound, checked before it is sent. `HandlerConfig` supplies it, so an out-of-range value
       * is an operator configuration fault rather than anything a caller can reach — and the honest
       * response to a configuration fault is to make no request at all.
       */
      if (
        !Number.isInteger(request.maxOutputTokens) || request.maxOutputTokens <= 0 ||
        request.maxOutputTokens > MODEL_MAX_OUTPUT_TOKENS
      ) {
        return { kind: 'unavailable' };
      }

      /**
       * B10's gate, per request, before the transport.
       *
       * The handler will not reach this adapter without a derived value — it answers `503` first — so
       * this is the boundary's own refusal to send anything it cannot vouch for, not the primary
       * control. It refuses a missing value, a malformed one, an identity-shaped one, and an
       * identifier belonging to any version other than the active one. `unavailable` is exact here in
       * the sense `attemptWasIncurred` depends on: nothing left the process, so nothing was billed and
       * the reservation is released as unused.
       */
      if (!mayTravel(request.safetyIdentifier)) {
        return { kind: 'unavailable' };
      }

      /**
       * The outbound body, field by field (§H.1's closed allow-list).
       *
       * `instructions` and the user's text stay in **separate API channels** and are never
       * concatenated — §F.3: promoting user text into the channel that outranks user text "is the
       * whole game". The language hint is a third, server-authored channel: a `developer` message
       * built from a value that has already been narrowed to the two-entry locale allow-list, so the
       * only strings that can appear in it are ones this repository wrote.
       *
       * Absent by construction, each for its own reason: no `tools` (§F.4 omits rather than empties,
       * so a successful injection has nothing to reach), no `previous_response_id`, no
       * `conversation`, no `background`, no `stream` (§F.6), no `metadata` at all (§H.2 names it
       * explicitly as a tempting place to stash an identifier), no `temperature` or `top_p` (not
       * documented as supported for this model — plan §4.4), no `prompt_cache_key` (plan §4.6.1), and
       * no `reasoning.mode` (`standard` is the default, so omitting leaves nothing to flip to `pro`).
       */
      const input: Record<string, string>[] = [];
      if (LOCALE_ALLOW_LIST.includes(request.languageHint)) {
        input.push({
          role: 'developer',
          content: `Reply in this language, given as a BCP 47 tag: ${request.languageHint}.`,
        });
      }
      input.push({ role: 'user', content: request.userInput });

      const body = {
        model: OPENAI_MODEL,
        instructions: request.instructions,
        input,
        // The port types this as the literal `false`, so it is not a value this line can get wrong.
        store: request.store,
        max_output_tokens: request.maxOutputTokens,
        reasoning: { effort: OPENAI_REASONING_EFFORT },
        text: {
          format: {
            type: 'json_schema',
            name: STRUCTURED_OUTPUT_NAME,
            strict: true,
            schema,
          },
        },
        /**
         * The one place B10's value is written, and the only API field it may occupy.
         *
         * Not `metadata` (§H.2 names that as the tempting place to stash an identifier, and this body
         * has no such field), not `prompt_cache_key`, not the instructions, not the user message.
         */
        safety_identifier: request.safetyIdentifier,
      };

      let response: Response;
      try {
        response = await call(endpoint, {
          method: 'POST',
          headers: {
            // The only place the key is written. Not the URL, not the body, not a message.
            'authorization': `Bearer ${key}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify(body),
          // §F.7 — the handler's budget, so the connection is genuinely aborted rather than ignored.
          signal,
          /**
           * A redirect is a failure, not a second request. Following one would replay the
           * `Authorization` header — and therefore the provider key — to whatever host the redirect
           * named, which is a credential exfiltration through a response NoorLife did not control.
           */
          redirect: 'error',
        });
      } catch {
        /**
         * A transport failure: a reset, a DNS failure, a refused redirect, or the handler's abort.
         * Nothing about the error is captured — §I.6 forbids forwarding provider detail, and an
         * exception from a provider call is made of provider detail.
         */
        return signal.aborted ? { kind: 'timeout' } : { kind: 'transient-server-error' };
      }

      if (response.status === 200) {
        return await parseSuccess(response);
      }

      if (response.status === 429) {
        // The one non-200 whose body is read, and only to answer §F.8's billing-or-transient question.
        const retryAfterSeconds = readRetryAfter(response.headers);
        return await isBillingLimit(response)
          ? { kind: 'quota-exhausted' }
          : { kind: 'rate-limited', retryAfterSeconds };
      }

      if (response.status === 401 || response.status === 403) {
        /**
         * §F.8 — never retried. The key is wrong, absent, revoked or not permitted here, and a second
         * identical request produces the same answer.
         *
         * ── Why this is **not** `unavailable` ─────────────────────────────────
         * `unavailable` means no request left the process, and the handler treats it as free: no
         * attempt registered, reservation released as unused. A `401` is a *reply* — the request was
         * built, sent and answered — so claiming it was free asserts something the function does not
         * know. `provider-configuration-error` is terminal in exactly the same way but is accounted
         * as the incurred attempt it is, and carries a coarse operator alert.
         *
         * The usage read is the only inspection of this body, and it takes numbers or nothing.
         */
        const usage = await readSafeUsage(response);
        return usage === null
          ? { kind: 'provider-configuration-error' }
          : { kind: 'provider-configuration-error', usage };
      }

      await discard(response);

      switch (response.status) {
        case 408:
        case 500:
        case 502:
        case 503:
        case 504:
          /**
           * §F.8's transient class. The section enumerates `500`, `502`, `503` and connection resets;
           * `504` and `408` are the same category of failure — a gateway or request timeout at the
           * provider, not a decision about this request — and are mapped alongside them. That is a
           * small, stated extension of §F.8's enumeration rather than a silent one, and it is flagged
           * for review in the AI-3 plan. It does **not** change the retry budget: the handler still
           * permits at most one retry, and only if it fits the deadline.
           */
          return { kind: 'transient-server-error' };

        default:
          /**
           * `400`, `404`, `422`, a `3xx` that `redirect: 'error'` did not already refuse, and anything
           * else. §F.8 lists the first three as never retried, and all of them mean this request and
           * the provider's contract disagree.
           *
           * `malformed` rather than `unavailable` for two reasons: it is recorded as an **incurred**
           * attempt, which is the right bias when it is unknown whether the request was billed
           * (§I.2's ceilings are enforced from recorded spend, so ambiguity resolves toward
           * recording); and it lights `upstream_malformed` in the log, which sends whoever
           * investigates toward the request shape rather than toward provider availability.
           */
          return { kind: 'malformed' };
      }
    },
  };
}
