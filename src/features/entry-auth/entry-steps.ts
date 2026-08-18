import { useRouter } from 'expo-router';
import { useCallback } from 'react';

import { authRoutes, onboardingRoutes } from '@application/navigation/routes';

/**
 * The entry sequence as a single row of dots.
 *
 * ── Why five and not six ────────────────────────────────────────────────────
 * Splash has no dot. It carries no controls, and the entry gate renders it *without* a history
 * entry so Back cannot land on it (see src/app/index.tsx). A dot pointing at it would return the
 * user to a screen that resolves the session and immediately pushes them forward again — a dot
 * that undoes itself.
 *
 * Sign In and Sign Up share the last dot. They are alternatives reached from Welcome, not
 * consecutive steps: the two screens even swap places with `replace` rather than stacking. Giving
 * them separate dots would draw an order the flow does not have and imply Sign Up follows Sign In.
 *
 * ── Backward only ───────────────────────────────────────────────────────────
 * A dot never navigates forward. Skipping ahead to Welcome would bypass onboarding without
 * recording that it was completed, and there is no honest forward target for the shared final dot.
 */
export const ENTRY_STEP_COUNT = 5;

/** Which dot each entry screen lights up. */
export const entryStepIndex = {
  onboardingOne: 0,
  onboardingTwo: 1,
  onboardingThree: 2,
  welcome: 3,
  /** Sign In and Sign Up both sit here — see the note above. */
  credentials: 4,
} as const;

/**
 * Where each dot leads when tapped.
 *
 * Four entries for five dots: the final step is the end of the sequence, so nothing ever
 * navigates *to* it. `goToStep` refuses an index this array does not cover.
 */
const entryStepRoutes = [
  onboardingRoutes.one,
  onboardingRoutes.two,
  onboardingRoutes.three,
  authRoutes.welcome,
] as const;

export type EntryStepNavigation = {
  /** Navigate to an earlier step. Ignores forward or out-of-range indices. */
  readonly goToStep: (index: number) => void;
  /** One step back, or `undefined` on the first step where there is nothing behind. */
  readonly goBack: (() => void) | undefined;
};

/**
 * Backward navigation for the entry sequence.
 *
 * ── Why `replace` and not `back()` ──────────────────────────────────────────
 * There is frequently no history to pop. Onboarding's Skip and Get Started both `replace` the
 * stack with Welcome, and a returning user is sent there by the entry gate's `Redirect` — so on
 * the most common path Welcome *is* the stack root and `router.back()` does nothing at all.
 * Replacing with the target route is deterministic from any entry point, and keeps the stack from
 * growing as the user moves back and forth.
 *
 * The trade-off is the transition: `replace` animates in the forward direction, so a backward move
 * slides the wrong way. Correcting that would mean a per-screen animation override; the honest
 * position is that deterministic navigation matters more than the direction of a 200 ms slide.
 */
export function useEntryStepNavigation(activeIndex: number): EntryStepNavigation {
  const router = useRouter();

  const goToStep = useCallback(
    (index: number) => {
      // Backward only, and only to a step that has a route.
      if (index >= activeIndex) {
        return;
      }
      const route = entryStepRoutes[index];
      if (route === undefined) {
        return;
      }
      router.replace(route);
    },
    [router, activeIndex],
  );

  const goBack = useCallback(() => {
    goToStep(activeIndex - 1);
  }, [goToStep, activeIndex]);

  return { goToStep, goBack: activeIndex > 0 ? goBack : undefined };
}
