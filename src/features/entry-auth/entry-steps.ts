import { useRouter } from 'expo-router';
import { useCallback } from 'react';

import { onboardingRoutes } from '@application/navigation/routes';

/**
 * The onboarding sequence as a row of dots.
 *
 * ── Why three, not five ─────────────────────────────────────────────────────
 * This was five: three onboarding panels plus Welcome plus a shared dot for Sign In and Sign Up.
 * The approved product flow is **three onboarding pages**, and the indicator has to describe that
 * flow rather than the wider entry journey.
 *
 * Extending the indicator across authentication was wrong on its own terms too. A progress
 * indicator promises a finite sequence the user is working through, and authentication is not
 * that — a user can sit on Welcome indefinitely, or bounce between Sign In and Sign Up, neither of
 * which is progress toward anything. Two of the five dots were describing a journey that does not
 * exist, and the fifth stood for two alternative screens at once.
 *
 * So the indicator now covers exactly the three panels it can honestly describe, and the
 * authentication screens carry none.
 *
 * ── Backward only ───────────────────────────────────────────────────────────
 * A dot never navigates forward. Skipping ahead would bypass panels without recording that
 * onboarding was completed.
 */
export const ENTRY_STEP_COUNT = 3;

/**
 * Which dot each onboarding panel lights up.
 *
 * Welcome and the credentials screens are absent: they are no longer part of the indicated
 * sequence. See the note above for why the count dropped from five to three.
 */
export const entryStepIndex = {
  onboardingOne: 0,
  onboardingTwo: 1,
  onboardingThree: 2,
} as const;

/**
 * Where each dot leads when tapped.
 *
 * One route per dot. Every onboarding panel is a real destination, unlike the previous model whose
 * final dot covered two sibling screens and could not be navigated to.
 */
const entryStepRoutes = [
  onboardingRoutes.one,
  onboardingRoutes.two,
  onboardingRoutes.three,
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
