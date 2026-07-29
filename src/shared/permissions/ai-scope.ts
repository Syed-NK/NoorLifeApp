import type { ModuleId } from '@ds/tokens';

/**
 * AI scope and permission model.
 *
 * Source of truth: docs/NOORLIFE_UI_DESIGN_SPEC.md §06 and
 * docs/NOORLIFE_PRODUCTION_WORKFLOW.md §3.3, §17.
 *
 * This is the *policy shape*, not an orchestrator. No AI provider SDK is
 * installed, no API key exists in the app, and no request is made anywhere in
 * Phase 1. What exists here is the contract that Phase 4's orchestrator must
 * satisfy, plus the pure decision functions that can be unit-tested today.
 */

/**
 * What an AI assistant is allowed to reach.
 *
 * `noorlife` — Noor AI: NoorLife help, navigation, module explanations and
 * permitted cross-module summaries. Not a general-purpose chatbot (§06).
 * `module` — a module AI, restricted to its own module (§3.3).
 */
export type AIScope =
  | { readonly kind: 'noorlife'; readonly permittedModules: readonly ModuleId[] }
  | { readonly kind: 'module'; readonly moduleId: ModuleId };

/** The context every AI request must carry (workflow §3.3). */
export type AIRequestContext = {
  readonly scope: AIScope;
  /** The route the request originated from. */
  readonly currentScreen: string;
  /** Modules the user has explicitly granted access to. */
  readonly grantedModules: readonly ModuleId[];
};

/** The outcome of a scope check. */
export type ScopeDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: 'out-of-scope'; readonly requiredModule: ModuleId }
  | {
      readonly allowed: false;
      readonly reason: 'permission-required';
      readonly requiredModule: ModuleId;
    };

/**
 * Decides whether a request may read a module's data.
 *
 * Two rules, both from the specification:
 *
 *   1. A module AI must not silently cross into another module (§3.3). A
 *      cross-module request is refused as `out-of-scope`; the caller's only
 *      correct response is to offer a hand-off to Noor AI after user
 *      confirmation — never to widen the scope itself.
 *   2. Noor AI may reach a module only if the user has granted it. §06 requires
 *      asking permission before accessing private module data, so an ungranted
 *      module is `permission-required`, not a silent success.
 */
export function canAccessModule(context: AIRequestContext, targetModule: ModuleId): ScopeDecision {
  if (context.scope.kind === 'module') {
    if (context.scope.moduleId === targetModule) {
      return { allowed: true };
    }
    return { allowed: false, reason: 'out-of-scope', requiredModule: targetModule };
  }

  if (!context.scope.permittedModules.includes(targetModule)) {
    return { allowed: false, reason: 'out-of-scope', requiredModule: targetModule };
  }

  if (!context.grantedModules.includes(targetModule)) {
    return { allowed: false, reason: 'permission-required', requiredModule: targetModule };
  }

  return { allowed: true };
}

/**
 * Subjects an AI must never advise on, from the top-level restrictions and
 * §08/§10/§07.
 *
 * Recorded as data so the safety policy is inspectable and testable rather than
 * living in prompt text alone.
 */
export const prohibitedAITopics = {
  health: 'Must not diagnose, prescribe, or replace a clinician.',
  finance: 'Must not provide investment, tax, or legal advice, or promise returns.',
  faith: 'Must cite approved sources and must not present disputed opinions as universal facts.',
  family: "Must not surface a child's private entry to another member without explicit consent.",
} as const;

/**
 * Whether an AI action requires an explicit confirmation step.
 *
 * Architecture rule: "AI actions that change data must show a preview and require
 * confirmation." Any mutating action is therefore always confirmable — reads never
 * are.
 */
export function requiresConfirmation(action: { readonly mutatesData: boolean }): boolean {
  return action.mutatesData;
}
