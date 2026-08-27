import type { ModuleId } from '@ds/tokens';
import type { FrameworkModuleId } from '@features/modules/module-tokens';

import { canAccessModule, isPremiumModule } from './domain/entitlement';
import { useEntitlement, useOptionalEntitlement } from './services/entitlement-context';

/**
 * The one place presentation asks "is this locked?".
 *
 * ── Why a selector and not a plan check ─────────────────────────────────────
 * A `plan === 'free'` written into a component is a rule that has escaped its definition. Spread
 * across a grid, a timeline, three summary cards and a quick-action row, those checks drift: one
 * forgets the grace period, another forgets that a family *member* is entitled through the
 * organizer, and a third locks Faith. Every lock decision here resolves through
 * `canAccessModule`, which is the same function the module route gate uses — so the tile and the
 * destination can never disagree.
 *
 * ── Faith and Noor AI ───────────────────────────────────────────────────────
 * Neither is a premium module, so both answer "unlocked" before any plan or status is consulted.
 * Faith must never show a lock, and Noor AI stays usable at the app-guidance scope the free plan
 * describes — a scope limit, not a lock.
 */
export type ModuleLock = {
  /** Whether this module needs a subscription the user does not have. */
  readonly isLocked: boolean;
  /** True when the module is premium at all, regardless of the current plan. */
  readonly isPremium: boolean;
  /**
   * Accessible name for a locked tile, e.g. "Health, Premium feature".
   *
   * Null when unlocked, so a caller cannot accidentally announce a lock that is not there.
   */
  readonly accessibilityLabel: string | null;
};

/**
 * Resolves lock state for one module.
 *
 * `main` is not a module a user opens, so it is never locked.
 */
export function useModuleLock(moduleId: ModuleId, moduleName: string): ModuleLock {
  const { entitlement } = useEntitlement();

  if (moduleId === 'main') {
    return { isLocked: false, isPremium: false, accessibilityLabel: null };
  }

  const id = moduleId as FrameworkModuleId;
  const isPremium = isPremiumModule(id);
  const isLocked = !canAccessModule(entitlement, id);

  return {
    isLocked,
    isPremium,
    // The suffix is part of the name rather than a hint, so a screen reader announces the
    // restriction in the same breath as the module — a hint is easily skipped.
    accessibilityLabel: isLocked ? `${moduleName}, Premium feature` : null,
  };
}

/*
 * ── There is deliberately no "navigate straight to the plans" hook here ─────
 * `useUpgradeNavigation` used to live at this point in the file, and the module grid was its only
 * caller. It pushed the subscription chooser directly, which the Pixel 8 pass caught: tapping Health
 * jumped to a list of prices with no statement of what had been asked for. Every locked surface now
 * raises the shared contextual sheet through `useUpgradeSheetActions`, and "View Premium Plans"
 * inside that sheet is the only path to the chooser. Reintroducing a direct route would reintroduce
 * the defect, so the hook is gone rather than left available.
 *
 * A locked surface still never pushes the protected route itself — that part was always right.
 */

/**
 * Whether any paid content should be presented as locked.
 *
 * For surfaces that are not a single module — the summary cards, the timeline, the quick actions —
 * where the question is "does this user hold a paid entitlement at all?". Expressed through the
 * same capability rules rather than by reading the plan, so a grace period keeps working and an
 * expired subscription locks, without either being restated here.
 */
export function usePaidContentLock(): { readonly isLocked: boolean } {
  const { entitlement } = useEntitlement();
  // Any premium module answers the question; `health` stands in for "paid content".
  return { isLocked: !canAccessModule(entitlement, 'health') };
}

export type ModuleAccess = {
  /** True only when the entitlement has resolved **and** it grants this module. */
  readonly isEntitled: boolean;
  /** False until the first resolve completes, and outside the provider. */
  readonly isResolved: boolean;
};

/**
 * Whether a surface may read a module's private data yet — the closed-by-default question.
 *
 * `useModuleLock` answers "should this look locked?", which is a presentation question and is
 * allowed to be optimistic while things settle. This answers "may I touch the records?", and the
 * two are not the same question: a surface that showed a figure during the half-second before the
 * entitlement resolved would have disclosed it, and no later correction takes that back.
 *
 * So every uncertain answer is `false`. No provider, an unresolved entitlement, a free plan, an
 * expired subscription — all of them mean *not yet*. The grant is the only affirmative case, and it
 * resolves through `canAccessModule`, the same function the route gate uses, so a Main Home row and
 * the module behind it can never disagree about who is entitled.
 */
export function useOptionalModuleAccess(moduleId: FrameworkModuleId): ModuleAccess {
  const state = useOptionalEntitlement();

  if (state === null) {
    return { isEntitled: false, isResolved: false };
  }
  return {
    isEntitled: state.isResolved && canAccessModule(state.entitlement, moduleId),
    isResolved: state.isResolved,
  };
}
