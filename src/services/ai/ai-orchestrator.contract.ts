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

export type AIOrchestrator = {
  /**
   * Sends a prompt within a scope.
   *
   * Implementations must consult `shared/permissions/ai-scope.ts` before reading
   * any module data, and must return a refusal rather than widening scope.
   */
  readonly ask: (prompt: string, context: AIRequestContext) => Promise<AIResult>;

  /**
   * Applies a previously previewed action after the user confirms it.
   *
   * Takes the `actionId` from an `AIActionPreview` the user has already seen, so
   * the API shape makes an unconfirmed mutation impossible to express.
   */
  readonly confirmAction: (actionId: string) => Promise<AIResult>;
};
