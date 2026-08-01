/**
 * The application startup state machine.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * Startup routing was spread across three places that each held part of the answer: the root
 * layout decided whether to mount the navigator, `useAppStartup` decided when to hide the native
 * splash, and the entry gate decided where to go. Between them they produced a measured startup of
 * native robot icon for ~2.2 s, then a blank mint view, *then* the branded splash for ~1.5 s, then
 * onboarding — so the brand moment arrived last and read as though it had been skipped.
 *
 * This module holds the whole decision. One input record in, one state out, computed as a pure
 * function so the timing rules can be tested without rendering anything or waiting two real
 * seconds.
 */

/** Where the user is in the startup sequence. */
export type StartupState =
  | 'native_boot'
  | 'branded_splash'
  | 'resolving'
  | 'onboarding'
  | 'authentication'
  | 'authenticated_home'
  | 'startup_error';

/**
 * Minimum time the branded splash stays up on a **first** launch, in ms.
 *
 * 1800. This is the brand's one uninterrupted moment, and on a first launch the user has never
 * seen it. It is a floor, not a delay: if resolution takes longer, the splash simply stays.
 */
export const FIRST_LAUNCH_SPLASH_MS = 1800;

/**
 * Minimum on a **returning** cold launch, in ms.
 *
 * 900. Long enough that the emblem registers rather than flickering, short enough that a user
 * opening the app for the fifth time today is not held up. The brief's rule — never delay beyond
 * what avoids a flash — is why this is half the first-launch figure rather than the same.
 */
export const RETURNING_LAUNCH_SPLASH_MS = 900;

/**
 * Hard ceiling before the app stops waiting, in ms.
 *
 * 4000. Past this, storage or the session provider is not going to answer. Continuing to wait
 * would leave the user on a splash forever, so the machine falls through to a recoverable route
 * rather than hanging. It never invents a session — an unresolved session is treated as signed
 * out, which is the safe direction to be wrong in.
 */
export const STARTUP_TIMEOUT_MS = 4000;

export type StartupInput = {
  /** Milliseconds since the branded splash mounted. */
  readonly elapsedMs: number;
  /** Fonts registered, or safely fallen back. */
  readonly fontsReady: boolean;
  /** Session resolved to signed-in or signed-out. Null while still unknown. */
  readonly isSignedIn: boolean | null;
  /** Onboarding completed at the current version. Null while still unknown. */
  readonly hasCompletedOnboarding: boolean | null;
  /** True when a startup dependency reported a hard failure. */
  readonly failed: boolean;
  /**
   * Whether this launch is the user's first.
   *
   * Drives which minimum applies. Unknown counts as first: showing the longer splash to a
   * returning user is a smaller error than truncating the brand for a new one.
   */
  readonly isFirstLaunch: boolean;
};

/** Everything the machine has been asked for has an answer. */
export function isResolved(input: StartupInput): boolean {
  return input.fontsReady && input.isSignedIn !== null && input.hasCompletedOnboarding !== null;
}

/** The minimum branded-splash duration that applies to this launch. */
export function minimumSplashMs(isFirstLaunch: boolean): number {
  return isFirstLaunch ? FIRST_LAUNCH_SPLASH_MS : RETURNING_LAUNCH_SPLASH_MS;
}

/**
 * The single routing decision.
 *
 * Two conditions must both hold before the splash gives way: the startup state has resolved, *and*
 * the minimum has elapsed. Either alone is a bug — resolving early would flash the brand, and
 * waiting on the timer alone would route before there is an answer, which is the "uninterruptible
 * timer" the brief rules out.
 */
export function nextStartupState(input: StartupInput): StartupState {
  if (input.failed) {
    return 'startup_error';
  }

  const timedOut = input.elapsedMs >= STARTUP_TIMEOUT_MS;

  if (!isResolved(input)) {
    // Past the ceiling with no answer: fall through to a safe route rather than hang. The session
    // is treated as signed out, never as signed in.
    return timedOut ? 'authentication' : 'branded_splash';
  }

  if (input.elapsedMs < minimumSplashMs(input.isFirstLaunch)) {
    // Resolved, but the brand has not had its moment yet.
    return 'branded_splash';
  }

  if (input.isSignedIn === true) {
    return 'authenticated_home';
  }
  return input.hasCompletedOnboarding === true ? 'authentication' : 'onboarding';
}

/** Whether a state is a terminal destination the router should navigate to exactly once. */
export function isDestination(state: StartupState): boolean {
  return (
    state === 'onboarding' ||
    state === 'authentication' ||
    state === 'authenticated_home' ||
    state === 'startup_error'
  );
}
