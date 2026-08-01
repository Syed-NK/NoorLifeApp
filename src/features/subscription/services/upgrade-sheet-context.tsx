import { useRouter } from 'expo-router';
import { createContext, useCallback, useContext, useMemo, useState } from 'react';

import type { FrameworkModuleId } from '@features/modules/module-tokens';

import { isPremiumModule } from '../domain/entitlement';
import { subscriptionRoutes } from '../subscription-routes';

/**
 * One contextual upgrade explanation, requested from anywhere.
 *
 * ── Why a controller rather than a sheet per surface ────────────────────────
 * Eight surfaces need this — three timeline rows, two summary cards, three quick actions and the
 * Insights tab — and none of them is a module screen. Giving each its own modal would produce
 * eight copies of the same rules about scrims, back handling, focus and "never purchase
 * automatically", which is eight chances to get one of them wrong. One controller holds the state;
 * `LockedModuleSheet` remains the only presentation.
 *
 * ── Duplicate instances are impossible by construction ──────────────────────
 * The request is a single state slot, not a stack. A second `requestUpgrade` while one is open
 * replaces its contents rather than mounting another modal, so a double tap cannot produce two
 * sheets.
 */

export type UpgradeRequest = {
  /** The feature the user actually tapped, e.g. "Family Check-in" or "School drop-off". */
  readonly featureTitle: string;
  /** The module that owns it. Drives the pictogram and the body copy. */
  readonly moduleId: FrameworkModuleId;
  readonly moduleName: string;
  /** Where the request came from, for diagnostics. Never shown to the user. */
  readonly source: string;
};

export type UpgradeSheetActions = {
  /**
   * Asks for the upgrade explanation.
   *
   * Silently ignored for a module that is not premium. Faith can never open this, and that refusal
   * lives here as well as in `LockedModuleSheet` — a caller that forgets is a caller that cannot
   * cause the bug.
   */
  requestUpgrade(request: UpgradeRequest): void;
  dismiss(): void;
  /** Explicit confirmation. The only path from this sheet to the plans. */
  viewPlans(): void;
};

export type UpgradeSheetState = {
  readonly request: UpgradeRequest | null;
  readonly isVisible: boolean;
};

const StateContext = createContext<UpgradeSheetState | null>(null);
const ActionsContext = createContext<UpgradeSheetActions | null>(null);

export function UpgradeSheetProvider({ children }: { readonly children: React.ReactNode }) {
  const router = useRouter();
  const [request, setRequest] = useState<UpgradeRequest | null>(null);

  const requestUpgrade = useCallback((next: UpgradeRequest) => {
    // Faith and Noor AI are not premium, so nothing can raise an upgrade prompt for them.
    if (!isPremiumModule(next.moduleId)) {
      if (__DEV__) {
        console.warn(
          `[upgrade] refused for non-premium module "${next.moduleId}" from ${next.source}`,
        );
      }
      return;
    }
    setRequest(next);
  }, []);

  const dismiss = useCallback(() => {
    // "Not now" and the scrim both land here: dismissal never navigates anywhere.
    setRequest(null);
  }, []);

  const viewPlans = useCallback(() => {
    setRequest(null);
    // Navigation only after an explicit press. Nothing here starts a purchase — the plans screen
    // is a chooser, and the purchase itself still needs a confirmation and a pending intent.
    router.push(subscriptionRoutes.welcome);
  }, [router]);

  const state = useMemo<UpgradeSheetState>(
    () => ({ request, isVisible: request !== null }),
    [request],
  );
  const actions = useMemo<UpgradeSheetActions>(
    () => ({ requestUpgrade, dismiss, viewPlans }),
    [requestUpgrade, dismiss, viewPlans],
  );

  return (
    <StateContext.Provider value={state}>
      <ActionsContext.Provider value={actions}>{children}</ActionsContext.Provider>
    </StateContext.Provider>
  );
}

export function useUpgradeSheet(): UpgradeSheetState {
  const value = useContext(StateContext);
  if (value === null) {
    throw new Error('useUpgradeSheet must be used inside an UpgradeSheetProvider.');
  }
  return value;
}

export function useUpgradeSheetActions(): UpgradeSheetActions {
  const value = useContext(ActionsContext);
  if (value === null) {
    throw new Error('useUpgradeSheetActions must be used inside an UpgradeSheetProvider.');
  }
  return value;
}

/** The body line, e.g. "Health is included with NoorLife Premium." */
export function upgradeBodyFor(request: UpgradeRequest): string {
  return `${request.featureTitle} is included with NoorLife Premium.`;
}

export const UPGRADE_SHEET_TITLE = 'Unlock this feature';
