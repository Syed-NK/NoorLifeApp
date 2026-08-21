import { useEffect, useRef, useState } from 'react';

import { useAuth } from '@application/providers/auth-provider';
import { useFontReadiness } from '@application/providers/font-provider';
import { readOnboardingState } from '@services/onboarding/onboarding-preferences';
import { readAccountJourney } from '@services/account/account-journey';

import { useRecoveryContainmentState } from '@application/providers/recovery-containment-provider';

import { STARTUP_TIMEOUT_MS, nextStartupState, type StartupState } from './startup-machine';

/**
 * Drives the startup sequence and produces exactly one routing decision.
 *
 * ── One decision, not several competing effects ─────────────────────────────
 * The previous startup had three places contributing to the answer, and their interaction is what
 * buried the brand. Here the machine is pure and this hook only feeds it: elapsed time, fonts,
 * session, onboarding. The destination is frozen the first time the machine names one, so a later
 * re-render — a session refresh, say — cannot re-route a user who has already arrived. That
 * freezing is load-bearing: without it, signing up flips the session and the gate redirects over
 * the top of the screen the app just navigated to.
 */
export type StartupRouting = {
  readonly state: StartupState;
  /** The destination, once decided. Null while the splash is still showing. */
  readonly destination: StartupState | null;
  readonly isFirstLaunch: boolean;
};

/** Ticks often enough to hit the minimums precisely without busy-waiting. */
const TICK_MS = 100;

export function useStartupRouting(): StartupRouting {
  const fonts = useFontReadiness();
  const auth = useAuth();
  /**
   * Read alongside fonts, session and onboarding rather than after them.
   *
   * The actor resolves the marker against the live session itself, so all this layer has to do is
   * feed the verdict in. It is consulted on every launch — a signed-out one answers immediately.
   *
   * **Consumed, not owned.** This used to call `useRecoveryContainment` directly, which made the
   * entry gate the only thing that armed containment — and Expo Router never mounts the entry gate
   * for a deep-linked launch, so a direct link took no containment decision at all (issue #30). The
   * actor now lives in `RecoveryContainmentProvider`, above the navigator, and this reads its
   * verdict. One owner, one set of side effects, and this layer keeps exactly the input it had.
   */
  const recovery = useRecoveryContainmentState();

  const [elapsedMs, setElapsedMs] = useState(0);
  const [onboardingCompleted, setOnboardingCompleted] = useState<boolean | null>(null);
  const [isFirstLaunch, setIsFirstLaunch] = useState(true);
  const [planSelected, setPlanSelected] = useState<boolean | null>(null);

  /**
   * The moment the branded splash mounted.
   *
   * A ref set during the first render rather than in an effect: an effect runs after paint, which
   * would start the clock late and make the splash outlast its minimum by a frame or two on every
   * launch.
   */
  const mountedAt = useRef<number | null>(null);
  mountedAt.current ??= Date.now();

  // Read onboarding state concurrently with fonts and session — none of the three depends on the
  // others, so resolving them in series would add their latencies together.
  useEffect(() => {
    let cancelled = false;
    readOnboardingState().then(
      (state) => {
        if (!cancelled) {
          setOnboardingCompleted(state.completed);
          // A user who has never completed any version is on their first launch.
          setIsFirstLaunch(state.completedVersion === 0);
        }
      },
      () => {
        if (!cancelled) {
          // Not a hard failure: onboarding is the safe fallback, so continue rather than error.
          setOnboardingCompleted(false);
          setIsFirstLaunch(true);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  // The clock. Stops as soon as the ceiling is reached, so a stuck startup does not tick forever.
  useEffect(() => {
    const started = mountedAt.current ?? Date.now();
    const timer = setInterval(() => {
      const next = Date.now() - started;
      setElapsedMs(next);
      if (next >= STARTUP_TIMEOUT_MS) {
        clearInterval(timer);
      }
    }, TICK_MS);
    return () => {
      clearInterval(timer);
    };
  }, []);

  /**
   * Font failure is reported, never fatal.
   *
   * `FontProvider` sets `ready` true even when a face fails, so the app renders on system fonts
   * rather than blocking. Logging it in development is the whole response — refusing to start
   * because a font is missing would be a harsher outcome than the problem it guards against.
   */
  useEffect(() => {
    if (fonts.error !== null && __DEV__) {
      console.warn('[startup] font loading failed; continuing with fallback faces', fonts.error);
    }
  }, [fonts.error]);

  /**
   * Journey state for a signed-in account, read alongside everything else.
   *
   * Only attempted once the session resolves, because it needs a user id. `unconfigured` maps to
   * **false**, not true: the migration adding these columns is not applied yet, and treating "we
   * cannot tell" as "already chose a plan" is precisely the bug that sends a new account straight
   * to Main Home. False sends them to the plan chooser, which costs one tap to leave.
   */
  useEffect(() => {
    if (auth.status === 'unknown') {
      return;
    }
    if (auth.status === 'signed-out' || auth.user === null) {
      // Nothing to set: the machine input below substitutes `false` whenever the user is not
      // signed in, so writing state here would only be a synchronous setState inside an effect —
      // a cascading render for a value that is already known.
      return;
    }
    if (auth.authority === 'offline') {
      /*
        ── No journey read under offline authority ──────────────────────────
        `readAccountJourney` is a Supabase read. Offline it cannot answer, and the rejection handler
        below writes `planSelected = false` — which the machine reads as "has not chosen a plan" and
        routes to the subscription chooser. Measured on device: an airplane-mode launch landed on
        "Choose how NoorLife supports you" instead of Home.

        That is the same mistake as the original sign-out bug, one layer up: *could not ask* becoming
        *the answer is no*. So the read is not attempted, and the input below is substituted
        explicitly rather than left to a failed promise.
      */
      return;
    }

    let cancelled = false;
    readAccountJourney(auth.user.id).then(
      (journey) => {
        if (cancelled) {
          return;
        }
        if (journey.status === 'unconfigured' && __DEV__) {
          console.warn(`[startup] account journey unavailable: ${journey.reason}`);
        }
        setPlanSelected(journey.status === 'completed');
      },
      () => {
        if (!cancelled) {
          setPlanSelected(false);
        }
      },
    );
    return () => {
      cancelled = true;
    };
    /*
      `auth.authority` is a dependency because the early return above reads it: a launch that
      resolved offline and later reaches a server transitions `offline → online`, and that is
      exactly when the journey read becomes both possible and necessary.
    */
  }, [auth.status, auth.authority, auth.user]);

  const state = nextStartupState({
    elapsedMs,
    fontsReady: fonts.ready,
    isSignedIn: auth.status === 'unknown' ? null : auth.status === 'signed-in',
    hasCompletedOnboarding: onboardingCompleted,
    /**
     * Offline authority is not blocked on a plan choice that cannot be read.
     *
     * ── Why `true` here is a statement about routing, not about entitlement ──
     * A receipt is only ever written after a **validated online session**, so a device holding one
     * belongs to somebody who has already signed in and been through this gate. Offline, the
     * subscription chooser is a screen they cannot complete — every purchase and restore path needs
     * a network — so sending them there replaces their downloaded Qur'an with a dead end.
     *
     * It grants nothing: entitlement is `EntitlementProvider`'s to decide and the offline receipt
     * carries no entitlement claim at all (locked decision 11, tier is always free). The next online
     * launch reads the real journey state and enforces the chooser if it is genuinely outstanding.
     */
    hasCompletedPlanSelection:
      auth.status === 'signed-in' ? auth.authority === 'offline' || planSelected : false,
    /**
     * No input can currently set this.
     *
     * Session and onboarding both resolve to a safe value on failure, and font errors are
     * non-fatal, so the only way startup can fail to resolve is by never answering — which the
     * machine's `STARTUP_TIMEOUT_MS` ceiling already routes to authentication. `startup_error`
     * stays in the machine, tested, for a future dependency that genuinely cannot fall back.
     */
    failed: false,
    isFirstLaunch,
    /**
     * Only meaningful while signed in, and substituted to `false` otherwise.
     *
     * A signed-out launch has no session for a marker to contain, and the machine's own resolution
     * check skips this input in that case — but passing the hook's null through would still make
     * the value read as "unanswered" to anyone inspecting the input record.
     */
    hasPendingRecovery: auth.status === 'signed-in' ? recovery.pending : false,
  });

  /**
   * The destination, taken once.
   *
   * `useState` with a guarded set during render — React's sanctioned way to derive state that must
   * not be recomputed. Once the machine has named a destination, later inputs cannot change it.
   */
  const [destination, setDestination] = useState<StartupState | null>(null);
  if (destination === null && state !== 'branded_splash' && state !== 'resolving') {
    setDestination(state);
  }

  // The timeout path is the one that actually fires in practice; say so where it happens.
  useEffect(() => {
    if (state === 'authentication' && !fonts.ready && __DEV__) {
      console.warn(
        '[startup] resolution timed out; routing to authentication, session assumed signed out',
      );
    }
  }, [state, fonts.ready]);

  // Native-splash dismissal is deliberately *not* returned here. It belongs to
  // `useNativeSplashHandoff`, which must not wait on anything this hook resolves — coupling the two
  // is what let a stalled session hold the native splash up until the user touched the screen.
  return { state, destination, isFirstLaunch };
}

/** Exposed for tests that need to simulate a hard failure. */
export type { StartupState };
