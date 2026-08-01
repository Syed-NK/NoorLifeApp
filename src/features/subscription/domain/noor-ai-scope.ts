import type { ModuleId } from '@ds/tokens';
import { FRAMEWORK_MODULE_IDS, type FrameworkModuleId } from '@features/modules/module-tokens';
import {
  canAccessModule as decideAIScope,
  type AIRequestContext,
  type AIScope,
  type ScopeDecision,
} from '@shared/permissions/ai-scope';

import { canAccessModule, hasPremiumAccess, type Entitlement } from './entitlement';

/**
 * What Noor AI is allowed to be, on the plan the user actually holds.
 *
 * ── Why Noor AI is scope-limited rather than locked ──────────────────────────
 * Noor AI is not a premium module, so `isPremiumModule` answers false for it and nothing in the app
 * can raise an upgrade prompt for it. The free plan includes it — "Basic Noor AI navigation help",
 * in `freePlanCopy` — which means a free user must be able to open it and get real help finding
 * their way around NoorLife and managing their account.
 *
 * What the free plan does *not* include is Noor AI standing in for the six paid modules. An
 * assistant that plans a free user's week, reviews their spending or suggests a family activity has
 * delivered Planner, Finance and Family through the back door, and the user has paid for none of
 * them. So the limit is on **subject**, not on availability.
 *
 * ── Why the scope is derived here and not passed in ─────────────────────────
 * The mode is computed from the entitlement, never from the surface that opened Noor AI or from a
 * route parameter. A tap, a deep link and a cold start therefore all resolve to the same answer,
 * and there is no argument a caller could pass that would widen it. `noorAIRequestContext` is the
 * only constructor for a Noor AI `AIRequestContext`, and `AIOrchestrator.ask` cannot be called
 * without one — so the boundary is a type requirement rather than a convention.
 *
 * Nothing here is enforced by wording alone: `noorAIScopeFor` produces the `permittedModules` that
 * `shared/permissions/ai-scope.ts` checks every request against, and a paid module is absent from
 * that list on a free plan.
 */

/**
 * Noor AI's two modes.
 *
 * `application_guidance` is the free mode: NoorLife itself is the subject — where things are, what
 * a module contains, and the user's own account and subscription. `full` adds the paid modules'
 * data and planning, which is what the subscription buys.
 */
export type NoorAIMode = 'full' | 'application_guidance';

/**
 * The subjects Noor AI answers on **every** plan, including free.
 *
 * Recorded as data rather than prose so the free scope is inspectable and testable, in the same
 * shape `prohibitedAITopics` uses. None of these reads a paid module's records: they are questions
 * about the application, the user's account and what Premium contains.
 */
export const NOOR_AI_APPLICATION_GUIDANCE_TOPICS = {
  app_navigation: 'Where a screen is and how to reach it.',
  feature_discovery: 'Whether NoorLife can do something, and what it is called.',
  module_directory: 'Which NoorLife module contains a feature.',
  account_help: 'Signing in, profile and account settings.',
  subscription_help: 'Plans, billing, restoring purchases and what Premium includes.',
} as const;

export type NoorAIApplicationGuidanceTopic = keyof typeof NOOR_AI_APPLICATION_GUIDANCE_TOPICS;

/**
 * The mode this entitlement resolves to.
 *
 * Unknown entitlement resolves to `application_guidance`, because `hasPremiumAccess` answers false
 * for it — the same defaulting every other locked surface uses. A subscriber briefly gets the free
 * scope on a cold start; a free user never gets the paid one.
 */
export function noorAIModeFor(entitlement: Entitlement): NoorAIMode {
  return hasPremiumAccess(entitlement) ? 'full' : 'application_guidance';
}

export function isNoorAILimited(entitlement: Entitlement): boolean {
  return noorAIModeFor(entitlement) === 'application_guidance';
}

/**
 * The modules Noor AI may reach at all on this entitlement.
 *
 * Resolved through `canAccessModule` per module rather than by listing the free ones, so Faith and
 * Noor AI stay in on every plan for the reason they always do — they are not premium — and a grace
 * period or an expiry moves this list without being restated here.
 */
export function noorAIPermittedModules(entitlement: Entitlement): readonly FrameworkModuleId[] {
  return FRAMEWORK_MODULE_IDS.filter((moduleId) => canAccessModule(entitlement, moduleId));
}

/** Whether Noor AI may discuss a module's own records and activity at all. */
export function noorAIMayDiscussModule(
  entitlement: Entitlement,
  moduleId: FrameworkModuleId,
): boolean {
  return canAccessModule(entitlement, moduleId);
}

/** The scope object every Noor AI request carries, derived from the entitlement. */
export function noorAIScopeFor(entitlement: Entitlement): AIScope {
  return { kind: 'noorlife', permittedModules: noorAIPermittedModules(entitlement) };
}

/**
 * The request context for Noor AI.
 *
 * ── A grant cannot widen the scope ──────────────────────────────────────────
 * `grantedModules` is intersected with the permitted set. A user who granted Noor AI access to
 * Finance while subscribed, then let the subscription lapse, has a grant that is still on record
 * and an entitlement that no longer covers it; intersecting resolves that in the only safe
 * direction. Permission and entitlement are separate questions, and this keeps both answers
 * necessary rather than letting one stand in for the other.
 */
export function noorAIRequestContext(
  entitlement: Entitlement,
  currentScreen: string,
  grantedModules: readonly ModuleId[],
): AIRequestContext {
  const permitted = noorAIPermittedModules(entitlement);
  return {
    scope: { kind: 'noorlife', permittedModules: permitted },
    currentScreen,
    grantedModules: grantedModules.filter((moduleId) =>
      permitted.includes(moduleId as FrameworkModuleId),
    ),
  };
}

/**
 * What Noor AI may do with a request about `targetModule`, on this entitlement.
 *
 * A thin composition of the context above and the shared scope rule, exposed so a caller asks one
 * question instead of assembling the context and remembering to check it.
 */
export function noorAIModuleDecision(
  entitlement: Entitlement,
  targetModule: FrameworkModuleId,
  currentScreen: string,
  grantedModules: readonly ModuleId[],
): ScopeDecision {
  return decideAIScope(
    noorAIRequestContext(entitlement, currentScreen, grantedModules),
    targetModule,
  );
}
