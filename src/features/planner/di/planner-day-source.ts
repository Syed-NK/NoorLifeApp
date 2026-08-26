import { useSyncExternalStore } from 'react';
import { AppState, type AppStateStatus, type NativeEventSubscription } from 'react-native';

import {
  msUntilNextLocalMidnight,
  plannerDayAt,
  samePlannerDay,
  type PlannerDay,
} from '../data/planner-day';

/**
 * **The one answer to "what day is it" for Planner and Main Home** — issue #76.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Why this is a store and not a provider ─────────────────────────────────
 * The consumer set is not one subtree. `PlannerHomeContent`, Tasks, Calendar and Routines render
 * under `app/planner/_layout.tsx`; `TodayAgendaPublisher` renders in `AppProviders`, above every
 * route, and Main Home is not inside the Planner stack at all. A context could only cover both by
 * being mounted above everything — and any surface rendered outside it (a screen test, a future
 * embed) would silently fall back to deriving its own day, which is exactly the defect.
 *
 * A module-scoped store has no tree position, so agreement is not something a caller can get wrong.
 * Every consumer reads the same object identity, and there is no arrangement of mounts that yields
 * two different days.
 *
 * This changes no provider ownership. `PlannerProvider` still owns tasks, `PlannerRoutineProvider`
 * still owns routines, `TodayAgendaProvider` still owns the agenda port. This owns the calendar,
 * which none of them owned — they each re-derived it.
 *
 * ── One timer, not one per surface ─────────────────────────────────────────
 * The midnight timer and the foreground listener are armed when the **first** consumer subscribes
 * and torn down when the **last** unsubscribes. Four Planner surfaces plus Main Home mounted at once
 * arm exactly one timer between them. Nothing polls: the store sleeps until the boundary it computed,
 * and a wake-up that observes no change publishes nothing.
 *
 * ── What can move the day, and how each is noticed ─────────────────────────
 * - **Midnight while mounted** — the armed timer fires, re-reads, and re-arms for the next one.
 * - **Foreground on a later day** — `AppState` `active`. A backgrounded app's timer is not reliable,
 *   so the foreground read is the one that matters after a long sleep, not a backstop.
 * - **Timezone change** — React Native emits no event for this. The offset is compared at every
 *   boundary the app already has (foreground, midnight fire, account change), so a zone change is
 *   picked up at the next one rather than by polling for it. A zone can move without the date moving,
 *   which is why `samePlannerDay` compares the offset too.
 * - **Account change** — `PlannerProvider` calls `refreshPlannerDay()` when the repository identity
 *   changes, so the new account's first render cannot inherit a day snapshot taken during a session
 *   that may have been idle across midnight.
 *
 * ── Re-arming is unconditional, publishing is not ──────────────────────────
 * A timer that fires early — drift, a coarse platform timer, a suspended JS thread — must not publish
 * a day that has not actually changed, because every consumer would re-render for nothing. So a fire
 * always re-arms and only notifies when the reading genuinely differs.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export type PlannerDaySource = {
  /** The current reading. Stable identity until the day actually changes. */
  readonly getSnapshot: () => PlannerDay;
  /** React's subscribe contract. Arms the timer for the first listener only. */
  readonly subscribe: (listener: () => void) => () => void;
  /** Re-read the clock now, publishing only if the day moved. Returns the current reading. */
  readonly refresh: () => PlannerDay;
};

export type PlannerDaySourceDeps = {
  /** The clock. Injected so a suite can state the instant instead of waiting for one. */
  readonly now?: () => Date;
  /**
   * Foreground transitions.
   *
   * Injected as a whole because `AppState` in a suite is a mock whose listener set outlives the
   * store; taking it as a dependency lets a test drive a foreground without reaching into that mock.
   */
  readonly appState?: {
    readonly addEventListener: (
      type: 'change',
      handler: (status: AppStateStatus) => void,
    ) => NativeEventSubscription;
  };
};

export function createPlannerDaySource(deps: PlannerDaySourceDeps = {}): PlannerDaySource {
  const now = deps.now ?? (() => new Date());
  const appState = deps.appState ?? AppState;

  let snapshot = plannerDayAt(now());
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let appStateSubscription: NativeEventSubscription | null = null;

  function read(): boolean {
    const next = plannerDayAt(now());
    if (samePlannerDay(snapshot, next)) {
      return false;
    }
    snapshot = next;
    return true;
  }

  function publish(): void {
    for (const listener of [...listeners]) {
      listener();
    }
  }

  function disarm(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function arm(): void {
    disarm();
    timer = setTimeout(() => {
      timer = null;
      const moved = read();
      /*
        Re-arm before publishing. A listener may unsubscribe the last consumer synchronously, and
        arming afterwards would leave a timer running with nobody to hear it.
      */
      if (listeners.size > 0) {
        arm();
      }
      if (moved) {
        publish();
      }
    }, msUntilNextLocalMidnight(now()));
  }

  function onAppState(status: AppStateStatus): void {
    if (status !== 'active') {
      return;
    }
    /*
      Only `active`. `inactive` and `background` are the iOS app-switcher pass, and reacting to them
      would cost a read for a transition the user never completed — the same rule `PlannerProvider`
      applies to its own foreground reload.
    */
    const moved = read();
    arm();
    if (moved) {
      publish();
    }
  }

  function subscribe(listener: () => void): () => void {
    const first = listeners.size === 0;
    listeners.add(listener);
    if (first) {
      /*
        A store that has sat idle with no consumers may hold a reading from before a midnight. The
        first subscriber re-reads rather than trusting it, which is also what makes a remount correct
        under Strict Mode's subscribe / unsubscribe / subscribe.
      */
      read();
      appStateSubscription = appState.addEventListener('change', onAppState);
      arm();
    }
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        disarm();
        appStateSubscription?.remove();
        appStateSubscription = null;
      }
    };
  }

  function refresh(): PlannerDay {
    const moved = read();
    if (listeners.size > 0) {
      arm();
    }
    if (moved) {
      publish();
    }
    return snapshot;
  }

  return { getSnapshot: () => snapshot, subscribe, refresh };
}

/**
 * The instance the app reads.
 *
 * Module-scoped rather than exported through a hook argument, so no consumer can accidentally be
 * given a second one. Suites that need to state the clock replace it through
 * `installPlannerDaySource`, which lives with the other test harnesses.
 */
let active: PlannerDaySource = createPlannerDaySource();

/**
 * Replace the active source. **Test seam.**
 *
 * Production never calls this — the only caller is the day harness, which restores the default
 * afterwards. It exists because the store is deliberately not injectable per consumer: the
 * whole point is that there is one, and a test that needs a stated clock has to replace the one
 * rather than add another.
 */
export function __setPlannerDaySource(source: PlannerDaySource | null): void {
  active = source ?? createPlannerDaySource();
}

/** The current reading, without subscribing. For code outside a render. */
export function plannerDayNow(): PlannerDay {
  return active.getSnapshot();
}

/**
 * Re-read the calendar now.
 *
 * Called on an account change. Not called on every render, and not on a schedule — a refresh that
 * observes no change publishes nothing, so an unnecessary call is wasteful rather than incorrect.
 */
export function refreshPlannerDay(): PlannerDay {
  return active.refresh();
}

/**
 * The day, for a rendering surface.
 *
 * `useSyncExternalStore` rather than state plus an effect: it reads the store during render, so a
 * surface mounted after a midnight fire renders the new day on its first pass instead of rendering
 * the old one and correcting it. That correcting frame is the visible form of this whole defect.
 *
 * The returned object's identity is stable while the day holds, so it can be a dependency of a
 * `useMemo` without re-running it on every render.
 */
/*
  Hoisted, and that is load-bearing rather than tidy.

  `useSyncExternalStore` re-subscribes whenever the subscribe function's identity changes. Defined
  inline in the hook these were a new closure on every render, so every consumer tore down its
  subscription and re-added it on every pass — and because the store arms its timer for the *first*
  listener and disarms on the *last*, a render could clear and re-arm the midnight timer. That is the
  "one timer" guarantee lost to a closure. Module-scoped constants subscribe once per mount.
*/
const subscribeToActiveDay = (listener: () => void): (() => void) => active.subscribe(listener);
const readActiveDay = (): PlannerDay => active.getSnapshot();

export function usePlannerDay(): PlannerDay {
  return useSyncExternalStore(subscribeToActiveDay, readActiveDay, readActiveDay);
}
