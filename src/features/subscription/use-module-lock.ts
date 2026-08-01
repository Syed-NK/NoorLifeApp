import { useCallback } from 'react';
import { useRouter } from 'expo-router';

import type { ModuleId } from '@ds/tokens';
import type { FrameworkModuleId } from '@features/modules/module-tokens';

import { canAccessModule, isPremiumModule } from './domain/entitlement';
import { useEntitlement } from './services/entitlement-context';
import { subscriptionRoutes } from './subscription-routes';

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

/**
 * Navigates a locked surface to the upgrade screen.
 *
 * ── Never the protected route first ─────────────────────────────────────────
 * A locked tile routes *directly* to the subscription screen. Pushing the module and letting its
 * own gate bounce the user would flash a screen they are not entitled to and leave the module in
 * the back stack, which is both a worse experience and a weaker guarantee than not going there.
 */
export function useUpgradeNavigation(): () => void {
  const router = useRouter();
  return useCallback(() => {
    router.push(subscriptionRoutes.welcome);
  }, [router]);
}

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
