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
  /**
   * Resolution has passed the presentation ceiling and still has no answer.
   *
   * **Not a destination.** It is a statement about what to *show* while the wait continues, not a
   * conclusion about who the user is — which is the whole of issue #31. `isDestination` excludes it
   * deliberately, so `useStartupRouting` does not freeze on it and the real destination is still
   * reached when the answer lands, however late.
   */
  | 'still_resolving'
  | 'onboarding'
  | 'authentication'
  /** Signed in, but the account still owes its initial plan choice. */
  | 'subscription_choice'
  | 'authenticated_home'
  /**
   * Signed in **through an unfinished password recovery**, and therefore not signed in for any
   * other purpose. Routes only to Set New Password. See `recovery-containment.ts`.
   */
  | 'password_recovery'
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
 * When the branded splash stops being the whole of what is shown, in ms.
 *
 * **A presentation ceiling, not a verdict deadline.** Past this the machine says "still resolving" —
 * it does not decide anything about who the user is. Naming it `STARTUP_TIMEOUT_MS` was part of the
 * problem: a timeout invites a fallback, and the fallback chosen was the signed-out entry point.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── The history, because it repeated ───────────────────────────────────────
 * This value was **4000** first, chosen against a warm development launch and narrower than a real
 * cold start. Measured on the emulator against a release build in airplane mode, the session resolved
 * to `authority: 'offline'` at roughly **4.3 s** from splash mount — Hermes cold start, a connectivity
 * probe bounded at 2 s, then a Keystore read. The ceiling fired a few hundred milliseconds before the
 * correct answer arrived, routed to `authentication` on the explicit assumption of signed-out, and
 * `destination` froze there. The user-visible result was Authentication Options on a device holding a
 * valid receipt and 3,158 downloaded recitation files.
 *
 * It was raised to **10000** as the fix. Issue #31 then measured the same failure again on both
 * targets: after installing a current APK, a first launch takes **20–28 s** to render at all, and a
 * valid live session and a valid offline receipt each reached Authentication Options because
 * resolution outran the ceiling a second time.
 *
 * ── Why raising it a third time is not the fix ─────────────────────────────
 * Because the number was never the defect. Any finite ceiling is beatable by a cold enough device or
 * a slow enough network, and each raise buys silence until the next machine. What was wrong is the
 * *conclusion* drawn when the ceiling elapsed: unresolved was converted into signed out.
 *
 * So the ceiling keeps its value and loses its verdict. Past it the machine returns
 * `'still_resolving'`, which `isDestination` excludes — so nothing freezes, no navigation happens, and
 * the launch reaches its real destination whenever the answer lands, at 11 s or at 40 s.
 *
 * The earlier note argued that un-freezing the destination "does not work, because `Redirect` has
 * already navigated and the gate has unmounted". That is true and it is not an objection: the fix is
 * not to correct a navigation afterwards, it is not to navigate on a non-answer in the first place.
 * Freezing remains right for destinations, and `'still_resolving'` is not one.
 *
 * ── What still bounds the wait ─────────────────────────────────────────────
 * Every path in `resolveLaunch` settles: the connectivity probe carries its own 2 s bound, and each
 * branch writes state. What is *not* bounded is the network — `getSession()` may refresh, and
 * `getProfile()` follows it, and neither carries a timeout — which is where a slow launch spends its
 * time. Bounding those is a change to session validation rather than to presentation, so it is not
 * done here; see issue #31 for the measurement.
 * ═══════════════════════════════════════════════════════════════════════════
 */
export const STARTUP_PRESENTATION_CEILING_MS = 10_000;

export type StartupInput = {
  /** Milliseconds since the branded splash mounted. */
  readonly elapsedMs: number;
  /** Fonts registered, or safely fallen back. */
  readonly fontsReady: boolean;
  /** Session resolved to signed-in or signed-out. Null while still unknown. */
  readonly isSignedIn: boolean | null;
  /** Onboarding completed at the current version. Null while still unknown. */
  readonly hasCompletedOnboarding: boolean | null;
  /**
   * Whether the signed-in account has finished the post-signup plan introduction.
   *
   * Null means not yet known — including the case where the migration adding the column has not
   * been applied. Null must **not** be read as completed: doing so is what sends a brand-new
   * account straight past the subscription introduction into Main Home, which is the defect this
   * field exists to fix. Only `true` lets a signed-in user through to Home.
   *
   * Irrelevant while signed out, where it is never consulted.
   */
  readonly hasCompletedPlanSelection: boolean | null;
  /** True when a startup dependency reported a hard failure. */
  readonly failed: boolean;
  /**
   * Whether this launch is the user's first.
   *
   * Drives which minimum applies. Unknown counts as first: showing the longer splash to a
   * returning user is a smaller error than truncating the brand for a new one.
   */
  readonly isFirstLaunch: boolean;
  /**
   * Whether a password recovery is open and must be finished before anything else.
   *
   * Resolved by `use-recovery-containment.ts`, which has already cross-checked the stored marker
   * against the live session — so by the time it arrives here it means "a valid marker and a
   * matching session", not merely "a marker exists". Null while that read is still in flight, and
   * null blocks resolution rather than defaulting: defaulting to false is precisely the assumption
   * that lets an unfinished recovery reach Main Home.
   */
  readonly hasPendingRecovery: boolean | null;
};

/**
 * Everything the machine has been asked for has an answer.
 *
 * The plan-selection answer is required only when signed in — a signed-out user has no account for
 * it to describe, and waiting on it would hold the splash up for no reason.
 */
export function isResolved(input: StartupInput): boolean {
  if (!input.fontsReady || input.isSignedIn === null || input.hasCompletedOnboarding === null) {
    return false;
  }
  if (!input.isSignedIn) {
    return true;
  }
  /**
   * A signed-in launch additionally waits on the recovery read.
   *
   * Only when signed in: a signed-out user has no session for a marker to describe, and holding the
   * splash for a read that cannot change the answer would slow every ordinary launch.
   */
  if (input.hasPendingRecovery === null) {
    return false;
  }
  /**
   * A contained session does not wait for the plan-selection read.
   *
   * Its destination is already decided, and that read is a network round trip against the account
   * journey. Waiting for one that cannot change the answer would delay containment — and delay it
   * for exactly the failure it exists to catch, since a launch after process death is when the
   * network is least likely to be warm.
   */
  if (input.hasPendingRecovery) {
    return true;
  }
  return input.hasCompletedPlanSelection !== null;
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

  const pastCeiling = input.elapsedMs >= STARTUP_PRESENTATION_CEILING_MS;

  if (!isResolved(input)) {
    /*
      Past the ceiling with no answer, the presentation changes and the *conclusion* does not.

      This branch used to return 'authentication' — the signed-out entry point — on the reasoning that
      falling through to a safe route beat hanging, and that treating the session as signed out was the
      conservative direction. It is conservative about *exposure* and wrong about *truth*: it tells a
      user who is signed in that they are not, and invites them to sign in again. Issue #31 measured
      it on both targets after a fresh install, where a valid session and a valid offline receipt each
      reached Authentication Options because resolution outran a performance ceiling.

      "We have not finished asking" is not "there is nobody signed in". Only a real verdict may send
      anyone to authentication, and this branch has no verdict by definition — `isResolved` is false.
      So it now names a presentation state instead, which is not a destination: nothing freezes, and
      the launch still arrives wherever the answer says once the answer exists.
    */
    return pastCeiling ? 'still_resolving' : 'branded_splash';
  }

  if (input.elapsedMs < minimumSplashMs(input.isFirstLaunch)) {
    // Resolved, but the brand has not had its moment yet.
    return 'branded_splash';
  }

  if (input.isSignedIn === true) {
    /**
     * Recovery containment outranks every authenticated destination.
     *
     * Checked before the plan-selection branch, not after, because it is not a competing
     * destination — it is a statement that this session does not yet count as a sign-in at all. A
     * session created by a recovery exchange must reach Set New Password and nothing else: not Main
     * Home, not the subscription chooser, not Profile, not a module.
     */
    if (input.hasPendingRecovery === true) {
      return 'password_recovery';
    }
    /**
     * The one authoritative post-auth decision.
     *
     * A live Supabase session is not sufficient to reach Main Home. Signing up produces a session
     * immediately, and treating that as "done" is precisely what skipped Account Success and the
     * subscription introduction. The account must also have recorded a plan choice.
     *
     * Strictly `=== true`: an unknown answer sends the user to the plan chooser, which is
     * recoverable — Continue with Free is one tap — whereas wrongly skipping it leaves the account
     * permanently past a step it never took.
     */
    return input.hasCompletedPlanSelection === true ? 'authenticated_home' : 'subscription_choice';
  }
  return input.hasCompletedOnboarding === true ? 'authentication' : 'onboarding';
}

/** Whether a state is a terminal destination the router should navigate to exactly once. */
export function isDestination(state: StartupState): boolean {
  return (
    state === 'onboarding' ||
    state === 'authentication' ||
    state === 'subscription_choice' ||
    state === 'authenticated_home' ||
    state === 'password_recovery' ||
    state === 'startup_error'
  );
}
