import type { ModuleId } from '@ds/tokens';
import type { AIRequestContext } from '@shared/permissions/ai-scope';

/**
 * AI orchestrator contract.
 *
 * A contract only. No AI provider SDK is installed, nothing here is implemented,
 * and nothing is called during Phase 1.
 *
 * The one non-negotiable in this file: `endpoint` is a **server** URL. There is no
 * field for a provider API key, because no key or secret may exist in the mobile
 * application. Model access is always brokered by NoorLife's own backend.
 */

/** A source an AI answer is grounded in (§07: Faith content must show citations). */
export type AISource = {
  readonly id: string;
  readonly title: string;
  /** e.g. "Sahih Bukhari", "Surah Ash-Sharh 94:6". */
  readonly reference: string;
  /** True when the text is quoted source material rather than AI explanation. */
  readonly isPrimaryText: boolean;
};

/**
 * A proposed data change.
 *
 * `preview` is required, not optional: an AI action that changes data must show a
 * preview and require confirmation, so a mutation cannot be described to the user
 * without one.
 */
export type AIActionPreview = {
  readonly actionId: string;
  readonly summary: string;
  readonly targetModule: ModuleId;
  readonly preview: readonly string[];
  readonly mutatesData: true;
};

export type AIAnswer = {
  readonly text: string;
  readonly sources: readonly AISource[];
  /** Modules actually read, surfaced to the user (§06 safeguards). */
  readonly accessedModules: readonly ModuleId[];
  /** Present only when the assistant proposes a change. */
  readonly proposedAction?: AIActionPreview;
};

export type AIRefusal =
  | { readonly kind: 'safety-boundary'; readonly explanation: string }
  | { readonly kind: 'permission-required'; readonly requiredModule: ModuleId }
  | { readonly kind: 'out-of-scope'; readonly suggestedHandoff: 'noor-ai' | null }
  | { readonly kind: 'unavailable' };

export type AIResult =
  | { readonly outcome: 'answer'; readonly answer: AIAnswer }
  | { readonly outcome: 'refused'; readonly refusal: AIRefusal };

export type AIOrchestratorConfig = {
  /**
   * NoorLife's own backend endpoint. Never a model-provider endpoint, and never
   * accompanied by a provider key — see the file note above.
   */
  readonly endpoint: string;
};

/**
 * The **ask half** of `AIOrchestrator`, named so a phase can implement it honestly.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * `AIOrchestrator` below is the finished composition: a question channel *and* a
 * confirmed-mutation channel. Those two arrive in different phases, because
 * `confirmAction` cannot exist before there is a tool that can propose an
 * `AIActionPreview` — and there is not one. Without a name for the half that can
 * be built first, a phase delivering only `ask` has two bad options: ship a
 * `confirmAction` that can only fail, or claim it is not implementing the
 * orchestrator at all. This type is the third option, and it is the accurate one.
 *
 * It is a **staged interface boundary, not a divergence**. Nothing here is a
 * reduced or relaxed `AIOrchestrator`: the full contract is defined in terms of
 * this type immediately below, so the `ask` signature exists once and the two
 * cannot drift.
 *
 * ── The type parameter, and why it is not a loophole ────────────────────────
 * `TResult` defaults to `AIResult`, so `AIAskOrchestrator` with no argument is
 * exactly what `AIOrchestrator['ask']` has always been. It is a parameter because
 * §12.1 of `docs/NOOR_AI_BACKEND_CONTRACT.md` records that `AIResult` cannot
 * express what the wire contract actually produces — all thirteen server error
 * conditions and the platform's separate gateway category collapse into the bare
 * `AIRefusal.unavailable` tag — and the resolution it prescribes is a third
 * outcome for transport and server failure. A phase adopting that resolution
 * needs a result type of its own; what it must **not** get is a second, drifting
 * copy of the call signature. Parameterising the result keeps the signature
 * single and lets the result be honest.
 */
export type AIAskOrchestrator<TResult = AIResult> = {
  /**
   * Sends a prompt within a scope.
   *
   * Implementations must consult `shared/permissions/ai-scope.ts` before reading
   * any module data, and must return a refusal rather than widening scope.
   */
  readonly ask: (prompt: string, context: AIRequestContext) => Promise<TResult>;
};

/**
 * The full orchestrator: the ask channel plus confirmed mutation.
 *
 * Structurally identical to what it has always been — `AIAskOrchestrator` with no
 * type argument is `{ ask: (prompt, context) => Promise<AIResult> }`, so this
 * declares the same two members it declared before. `ai-orchestrator-staging.test.ts`
 * asserts that equivalence in both directions rather than asserting it here in prose.
 *
 * **`confirmAction` is unchanged and is not optional.** Its security requirement is
 * the whole reason the interface is shaped this way: it takes an `actionId` from an
 * `AIActionPreview` the user has already seen, so an unconfirmed mutation is
 * unexpressible rather than merely discouraged. Nothing may weaken that to make an
 * earlier phase's adapter fit — the adapter conforms to `AIAskOrchestrator`, and
 * composing the two into this type is the later phase's work.
 */
export type AIOrchestrator = AIAskOrchestrator & {
  /**
   * Applies a previously previewed action after the user confirms it.
   *
   * Takes the `actionId` from an `AIActionPreview` the user has already seen, so
   * the API shape makes an unconfirmed mutation impossible to express.
   */
  readonly confirmAction: (actionId: string) => Promise<AIResult>;
};
