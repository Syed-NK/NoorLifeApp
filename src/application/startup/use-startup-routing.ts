import { useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { useAuth } from '@application/providers/auth-provider';
import { useFontReadiness } from '@application/providers/font-provider';
import { readOnboardingState } from '@services/onboarding/onboarding-preferences';
import { readAccountJourney } from '@services/account/account-journey';
import { WAIT_EXPIRED, waitAtMost } from '@shared/utils/bounded-wait';

import { useRecoveryContainmentState } from '@application/providers/recovery-containment-provider';

import {
  STARTUP_PRESENTATION_CEILING_MS,
  isDestination,
  nextStartupState,
  type StartupState,
} from './startup-machine';

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

/**
 * How long the launch waits for the account-journey read before deciding without it.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Why four seconds, and not the session bound's six ──────────────────────
 * The two reads are not comparable work. The session lookup's bound is sized for a *token refresh* —
 * a round trip that legitimately takes a second or two on a healthy link. This is a single indexed
 * row read, `select … eq('id', …) .maybeSingle()`, with no refresh and no negotiation. One that has
 * not answered in four seconds is not about to.
 *
 * ── Its relationship to the presentation ceiling ───────────────────────────
 * This read starts *after* authority publishes, so the two bounds add up on a bad launch: the
 * connectivity probe (2 s) plus the session bound (6 s) plus this is 12 s, past
 * `STARTUP_PRESENTATION_CEILING_MS`. That is deliberate and fine, and the reason it is fine is worth
 * stating: the ceiling changes only what is **displayed**. Past it the launch says "still resolving"
 * — which at that point is precisely true, because neither authority nor the plan decision has
 * landed. It is not a verdict, it may not become one, and no bound here is chosen to beat it.
 *
 * What four seconds does buy is that the *common* case stays inside the ceiling: authority in about a
 * second plus a bounded journey read is under five, so the notice stays reserved for launches that
 * are genuinely stuck rather than merely slow. That keeps #31's notice honest, which is a
 * presentation goal, not a correctness one.
 * ═══════════════════════════════════════════════════════════════════════════
 */
export const JOURNEY_READ_TIMEOUT_MS = 4000;

/**
 * What the launch knows about the plan decision, at the routing layer.
 *
 * Three states, because there are three genuinely different answers and the previous two collapsed
 * the third into "no" — issue #46. `AccountJourneyState` has four members; two of them map here to
 * `not-selected` for reasons recorded at each mapping.
 */
type JourneyDecision = 'selected' | 'not-selected' | 'unknown';

/** A decision together with the account it was read for, so it can never be read under another. */
type OwnedJourneyDecision = {
  readonly userId: string;
  readonly decision: JourneyDecision;
};

/**
 * Interprets a journey read for routing.
 *
 * ── Why `unconfigured` and `unavailable` part company here ──────────────────
 *   • `completed`   → selected. The account has recorded a choice.
 *   • `pending`     → not selected. The server looked and the account owes the introduction.
 *   • `unconfigured`→ not selected, **deliberately, and unchanged**. This deployment cannot record a
 *     plan choice at all, so nobody has one; the existing decision is to show the chooser rather than
 *     let a new account past a step it never took, and it costs one tap to leave. It is a definitive
 *     statement about the installation rather than an outage, which is why it is not an unknown.
 *   • `unavailable` → unknown. Nothing was learned. Mapping this to "has not chosen a plan" is the
 *     defect: it routes an entitled, possibly paying account to a purchase screen because the network
 *     was slow, which is *could not ask* becoming *the answer is no* — the same mistake as the
 *     original sign-out bug, two layers up.
 */
function decisionFor(journey: Awaited<ReturnType<typeof readAccountJourney>>): JourneyDecision {
  switch (journey.status) {
    case 'completed':
      return 'selected';
    case 'pending':
    case 'unconfigured':
      return 'not-selected';
    case 'unavailable':
      return 'unknown';
  }
}

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
  /*
    Keyed by owner rather than a bare boolean. The selector below refuses to read a decision that
    belongs to another account, so a late answer for a replaced account cannot be *consulted* at all —
    which is a stronger guarantee than checking at the moment it is written, and needs no guard there.
  */
  const [journey, setJourney] = useState<OwnedJourneyDecision | null>(null);
  /**
   * Bumped to re-attempt a read that finished without an answer.
   *
   * Not a retry loop: nothing here fires on a timer, and a read that produced a *definitive* answer is
   * never re-attempted. It is a **trigger**, the same shape the auth provider already uses to recover
   * an offline launch when connectivity returns — an external event that makes the question worth
   * asking again.
   */
  const [journeyAttempt, setJourneyAttempt] = useState(0);

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

  /*
    The clock. Stops as soon as the ceiling is reached, so a stuck startup does not tick forever.

    Stopping is still correct now that the ceiling no longer decides anything: past it the machine
    reports `still_resolving` whatever the elapsed value is, and when authority finally lands the
    re-render recomputes with the frozen elapsed time — which is already beyond both the ceiling and
    the brand minimum, so the real destination is named immediately rather than after another tick.
  */
  useEffect(() => {
    const started = mountedAt.current ?? Date.now();
    const timer = setInterval(() => {
      const next = Date.now() - started;
      setElapsedMs(next);
      if (next >= STARTUP_PRESENTATION_CEILING_MS) {
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
   * Journey state for a signed-in account, read alongside everything else and **bounded**.
   *
   * ═══════════════════════════════════════════════════════════════════════════
   * Only attempted once the session resolves, because it needs a user id — which is an argument for
   * taking it off the critical path rather than for starting it earlier, and there is nowhere earlier
   * to start it.
   *
   * ── The bound, and why the request is not abandoned ────────────────────────
   * The promise is kept. `waitAtMost` decides how long the *launch* waits on it; the read carries on
   * and its answer is applied below when it lands. That matters because a definitive answer that was
   * merely late is exactly what resolves an unknown launch honestly — aborting the request would
   * throw away the one thing that can.
   *
   * ── What the bound elapsing means ─────────────────────────────────────────
   * `unknown`, and nothing else. Not "has not chosen a plan": the launch holds, shows #31's
   * identity-free notice past the ceiling, and resolves if and when the answer arrives. A paying
   * account is never sent to a purchase screen because a row read was slow.
   *
   * ── How a stale result is made inert ──────────────────────────────────────
   * Two mechanisms, and they cover different windows. The `cancelled` flag stops a result landing
   * after this effect has been torn down — a sign-out, an account replacement, an unmount. And the
   * write is *owner-stamped*, so even a result that does land cannot be read while another account is
   * current, because the selector requires the id to match. Backgrounding changes neither: the read
   * is not re-attempted, and whatever it eventually says is still checked against both.
   * ═══════════════════════════════════════════════════════════════════════════
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

    const userId = auth.user.id;
    let cancelled = false;

    const apply = (decision: JourneyDecision) => {
      if (cancelled) {
        return;
      }
      setJourney({ userId, decision });
    };

    void (async () => {
      /*
        `readAccountJourney` is documented never to reject — every failure resolves to a reported
        state. This still catches, because "documented not to" is a property of the current
        implementation rather than of the type, and the consequence of being wrong matters: an escaped
        rejection would leave the launch holding with no recorded reason, and in a test it surfaces as
        an unhandled rejection rather than as the behaviour under test. A rejection is an outage by any
        other name, so it lands where every other outage does.
      */
      const inFlight = readAccountJourney(userId).catch(
        (reason: unknown) =>
          ({
            status: 'unavailable' as const,
            reason: reason instanceof Error ? reason.message : 'Journey read rejected.',
          }) satisfies Awaited<ReturnType<typeof readAccountJourney>>,
      );
      const raced = await waitAtMost(inFlight, JOURNEY_READ_TIMEOUT_MS);

      if (raced === WAIT_EXPIRED) {
        apply('unknown');
        /*
          The read continues. A definitive answer arriving after the bound resolves the unknown state
          for this account — an upgrade in either direction, since "not selected" is as definitive as
          "selected" and both are better than holding. It reaches `apply`, so it is still subject to
          the cancellation flag and still owner-stamped.
        */
        void inFlight.then((late) => {
          apply(decisionFor(late));
        });
        return;
      }

      if (raced.status === 'unconfigured' && __DEV__) {
        console.warn(`[startup] account journey not configured: ${raced.reason}`);
      }
      apply(decisionFor(raced));
    })();

    return () => {
      cancelled = true;
    };
    /*
      `auth.authority` is a dependency because the early return above reads it: a launch that
      resolved offline and later reaches a server transitions `offline → online`, and that is
      exactly when the journey read becomes both possible and necessary.
    */
  }, [auth.status, auth.authority, auth.user, journeyAttempt]);

  /**
   * Asks again when the app comes back to the foreground, and only while the answer is unknown.
   *
   * ═══════════════════════════════════════════════════════════════════════════
   * ── What makes the bound load-bearing ──────────────────────────────────────
   * Without this, bounding the read changes nothing a user could observe: an *unknown* answer and a
   * read still in flight both hold the launch, so the bound would be a comment with a timer attached.
   * A mutation that removed it passed every test, which is how that was noticed rather than argued.
   *
   * The bound's value is that it produces a **known** unknown — a moment at which it is worth asking
   * again. This is that moment's consumer: a user who sees the resolving notice, fixes the connection
   * or leaves the captive portal, and comes back to the app now gets a launch that completes, instead
   * of one that needs a force-quit.
   *
   * ── Why foreground, and why only while unknown ─────────────────────────────
   * Foreground is the event that correlates with a user having done something about it, and it is the
   * one this codebase already treats as a recovery trigger. The listener is attached **only** while the
   * decision is unknown, so an ordinary launch carries no extra subscription and makes no extra
   * request; a definitive answer detaches it. One re-attempt per foreground, bounded the same way,
   * with the same guards — no loop, no timer, no inflation.
   * ═══════════════════════════════════════════════════════════════════════════
   */
  const journeyUnknown = journey !== null && journey.decision === 'unknown';
  useEffect(() => {
    if (!journeyUnknown) {
      return;
    }
    const subscription = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') {
        setJourneyAttempt((attempt) => attempt + 1);
      }
    });
    return () => {
      subscription.remove();
    };
  }, [journeyUnknown]);

  /**
   * The journey decision this account may actually be routed on.
   *
   * ═══════════════════════════════════════════════════════════════════════════
   * ── Owner first, then meaning ──────────────────────────────────────────────
   * A decision read for another account is not consulted at all. That is what makes a stale result
   * structurally unable to route the current one: it is refused at the point of *reading*, every
   * render, against whoever is signed in now — rather than checked once when it was written and
   * trusted thereafter.
   *
   * ── The three-way mapping, and why ~unknown~ is ~null~ ─────────────────────
   * ~null~ is the machine's "not answered yet", and ~isResolved~ requires a non-null value for a
   * signed-in online launch. So an unknown journey **holds** the launch: branded splash, then #31's
   * identity-free notice, and the real destination whenever an answer lands.
   *
   * That is the honest reading and it is also the conservative one. The alternatives were both worse:
   * ~false~ routes an entitled account to a purchase screen because a row read was slow, and ~true~
   * lets a genuinely new account past the introduction it has not seen. Holding asserts nothing about
   * the plan in either direction, exposes no protected surface, and stays retryable — the request that
   * has not answered yet still can.
   * ═══════════════════════════════════════════════════════════════════════════
   */
  const currentUserId = auth.user?.id;
  const planSelectedInput: boolean | null =
    journey === null || currentUserId === undefined || journey.userId !== currentUserId
      ? null
      : journey.decision === 'unknown'
        ? null
        : journey.decision === 'selected';

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
      auth.status === 'signed-in' ? auth.authority === 'offline' || planSelectedInput : false,
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
  /*
    `isDestination`, rather than a list of the states that are not one.

    The exclusion list was `branded_splash` and `resolving`, so adding a third non-destination state
    for issue #31 would have frozen `destination` at `still_resolving` — the launch would have
    stopped on a presentation state and never reached its real destination, which is a worse version
    of the defect being fixed. Asking the machine which of its states are terminal keeps the two
    answers from drifting, here and for anything added later.
  */
  if (destination === null && isDestination(state)) {
    setDestination(state);
  }

  /*
    The slow path is the one that actually fires in practice; say so where it happens.

    Retargeted for issue #31: it used to fire on `state === 'authentication'`, which after that change
    no longer means "resolution ran out of time" — it means a real signed-out verdict, which is not
    noteworthy. It now reports the state that does mean it, and says what is true of it: still waiting,
    nothing concluded.
  */
  useEffect(() => {
    if (state === 'still_resolving' && __DEV__) {
      console.warn(
        '[startup] resolution has passed the presentation ceiling; still waiting, no verdict taken',
      );
    }
  }, [state]);

  // Native-splash dismissal is deliberately *not* returned here. It belongs to
  // `useNativeSplashHandoff`, which must not wait on anything this hook resolves — coupling the two
  // is what let a stalled session hold the native splash up until the user touched the screen.
  return { state, destination, isFirstLaunch };
}

/** Exposed for tests that need to simulate a hard failure. */
export type { StartupState };
