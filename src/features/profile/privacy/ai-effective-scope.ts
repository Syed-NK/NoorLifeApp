import type { ModuleId } from '@ds/tokens';
import { FRAMEWORK_MODULE_IDS, type FrameworkModuleId } from '@features/modules/module-tokens';
import { getModuleDefinition } from '@features/modules/module-registry';
import { canUseModuleAI, type Entitlement } from '@features/subscription/domain/entitlement';
import { noorAIModuleDecision } from '@features/subscription/domain/noor-ai-scope';
import { prohibitedAITopics } from '@shared/permissions/ai-scope';

/**
 * What NoorLife's AI can actually reach for this user, right now.
 *
 * ── Why this is derived and not stored ──────────────────────────────────────
 * Every answer below is computed from the two functions that already decide it everywhere else:
 * `canUseModuleAI` for whether a module's own assistant is available, and `noorAIModuleDecision`
 * for whether Noor AI may read that module's records. Restating the rules here would create a
 * screen that could disagree with the enforcement — the most dangerous kind of privacy display,
 * because it is the one the user believes.
 *
 * So this module contains no policy. It formats decisions somebody else makes.
 *
 * ── The two questions are deliberately separate ─────────────────────────────
 * "Can I open Health AI?" and "May Noor AI read my Health records?" are different questions with
 * different answers, and collapsing them is how a subscription silently becomes a data-access
 * grant. A paid entitlement opens the module; a *grant* opens the data; and
 * `noorAIRequestContext` intersects the grant with the entitlement, so a stale grant left over
 * from a lapsed subscription cannot widen anything.
 *
 * ── What does not exist, stated rather than implied ─────────────────────────
 * There is no grant store. `grantedModules` is a parameter that every caller in this codebase
 * passes literally — nothing persists a user's permission decisions, so the effective grant set is
 * empty for everybody, and Noor AI must ask at the moment it needs a module. The screen therefore
 * reports the effective scope and defers *editing* it, rather than drawing switches that would
 * remember a position and change nothing. See `AI_GRANT_EDITING_AVAILABLE`.
 */

/**
 * Whether a user can edit their AI data grants in this build.
 *
 * False, and asserted false by test until a grant store exists. Exported as a constant rather than
 * left implicit so the screen's deferral is a single readable fact, and so switching it on is one
 * line plus the controls it then requires — not a hunt for every place a permission was assumed.
 */
export const AI_GRANT_EDITING_AVAILABLE = false;

/**
 * Whether NoorLife stores AI conversations anywhere.
 *
 * False. There is no AI provider SDK in the application, no conversation table in the schema, and
 * no conversation key in `faithStorageKeys` or any other storage namespace — the Faith AI
 * repository is an interface satisfied by a mock that returns canned replies and writes nothing.
 * A source scan asserts this, so the screen's "nothing is stored" claim fails a test the moment it
 * stops being true rather than becoming a stale promise.
 */
export const AI_CONVERSATION_STORAGE_EXISTS = false;

/** What Noor AI may do with one module's data, on this entitlement and these grants. */
export type NoorAIModuleAccess =
  /** Granted and entitled — Noor AI may read it. */
  | 'allowed'
  /** Entitled, but the user has not granted access. Noor AI must ask first. */
  | 'permission-required'
  /** Not covered by the current plan, whatever grants are on record. */
  | 'requires-premium';

export type ModuleAIScope = {
  readonly moduleId: FrameworkModuleId;
  /** The module's display name, from the registry. Never re-typed here. */
  readonly name: string;
  /** Whether this module's own assistant can be opened at all. */
  readonly assistantAvailable: boolean;
  /** What Noor AI may do with this module's records. */
  readonly noorAIAccess: NoorAIModuleAccess;
};

/**
 * The effective AI scope, module by module.
 *
 * `currentScreen` is passed through to the decision function unchanged; it is part of the request
 * context the orchestrator will carry, and inventing a value here would make this display
 * describe a request nobody makes.
 */
export function effectiveAIScope(
  entitlement: Entitlement,
  grantedModules: readonly ModuleId[] = [],
  currentScreen = '/profile/privacy-security',
): readonly ModuleAIScope[] {
  return FRAMEWORK_MODULE_IDS.map((moduleId) => {
    const decision = noorAIModuleDecision(entitlement, moduleId, currentScreen, grantedModules);
    return {
      moduleId,
      name: getModuleDefinition(moduleId).name,
      assistantAvailable: canUseModuleAI(entitlement, moduleId),
      noorAIAccess: decision.allowed
        ? 'allowed'
        : decision.reason === 'permission-required'
          ? 'permission-required'
          : 'requires-premium',
    };
  });
}

/**
 * The boundaries that hold on every plan, taken from the shared policy rather than restated.
 *
 * `prohibitedAITopics` is the same object the orchestrator contract is written against, so a rule
 * softened there is softened here too — and a rule added there appears on this screen without
 * anybody remembering to add it. Wording it twice is how a privacy screen ends up describing an
 * older, stricter product than the one shipping.
 */
export const AI_BOUNDARIES = prohibitedAITopics;

/**
 * Whether a paid entitlement alone could ever open a module's data to Noor AI.
 *
 * Exported for the test that proves it cannot: an entitlement covering every module still resolves
 * to `permission-required` for a module the user has not granted, because permission and
 * entitlement are answered separately and both are required.
 */
export function grantsDataAccess(scope: ModuleAIScope): boolean {
  return scope.noorAIAccess === 'allowed';
}
