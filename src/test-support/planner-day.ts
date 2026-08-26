import type { AppStateStatus, NativeEventSubscription } from 'react-native';

import {
  createPlannerDaySource,
  __setPlannerDaySource,
  type PlannerDaySource,
} from '@features/planner/di/planner-day-source';

/**
 * A stated clock and a driveable foreground, for the one Planner day source.
 *
 * The source is deliberately module-scoped — the whole point of #76 is that there is exactly one, so
 * a suite cannot be handed its own without reintroducing the defect it is testing. This installs a
 * replacement built on a clock the test moves by hand, and gives back the handles to move it.
 *
 * Every test that touches the day must `restore()` in an `afterEach`, or the next file in the same
 * worker inherits a frozen clock.
 */
export type PlannerDayHarness = {
  /** Move the stated clock. Does not itself publish — fire a boundary to do that. */
  readonly setNow: (instant: Date) => void;
  /** The stated clock's current instant. */
  readonly now: () => Date;
  /** Run the armed midnight timer as though its deadline had arrived. */
  readonly fireMidnight: () => void;
  /** Whether a midnight timer is currently armed. */
  readonly isArmed: () => boolean;
  /** How many timers have been armed in total — the guard against one-per-surface. */
  readonly armCount: () => number;
  /** Deliver an `AppState` transition to the source. */
  readonly sendAppState: (status: AppStateStatus) => void;
  /** How many `AppState` listeners the source currently holds. */
  readonly appStateListenerCount: () => number;
  /** The installed source, for direct assertions. */
  readonly source: PlannerDaySource;
  /** Put the real source back. Required in `afterEach`. */
  readonly restore: () => void;
};

/**
 * Install a day source whose clock and timers the test drives.
 *
 * The timer is intercepted rather than faked globally: `jest.useFakeTimers()` in these suites would
 * also freeze React Native Testing Library's own scheduling, and several Planner suites already
 * record that fake timers break them. Capturing the callback is enough — the store's contract is
 * "arm one timer, run it at the boundary", and a test that runs the callback is testing exactly that.
 */
export function installPlannerDaySource(initial: Date): PlannerDayHarness {
  let current = new Date(initial.getTime());
  let armed: (() => void) | null = null;
  let arms = 0;
  const appStateListeners = new Set<(status: AppStateStatus) => void>();

  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;

  /*
    A stand-in timer, keyed like the real one so `clearTimeout` on a stale handle cannot cancel a
    newly armed callback. The source disarms before it re-arms, and a shared handle would make those
    two operations cancel each other.
  */
  let nextHandle = 1;
  const live = new Map<number, () => void>();

  globalThis.setTimeout = ((callback: () => void, _delay?: number) => {
    const handle = nextHandle++;
    live.set(handle, callback);
    armed = callback;
    arms += 1;
    return handle as unknown as ReturnType<typeof setTimeout>;
  }) as unknown as typeof globalThis.setTimeout;

  globalThis.clearTimeout = ((handle: unknown) => {
    if (typeof handle === 'number') {
      const callback = live.get(handle);
      live.delete(handle);
      if (callback === armed) {
        armed = null;
      }
    }
  }) as unknown as typeof globalThis.clearTimeout;

  const source = createPlannerDaySource({
    now: () => new Date(current.getTime()),
    appState: {
      addEventListener: (
        _type: 'change',
        handler: (status: AppStateStatus) => void,
      ): NativeEventSubscription => {
        appStateListeners.add(handler);
        return {
          remove: () => {
            appStateListeners.delete(handler);
          },
        } as NativeEventSubscription;
      },
    },
  });

  __setPlannerDaySource(source);

  return {
    setNow: (instant) => {
      current = new Date(instant.getTime());
    },
    now: () => new Date(current.getTime()),
    fireMidnight: () => {
      const callback = armed;
      if (callback === null) {
        throw new Error('No midnight timer is armed');
      }
      armed = null;
      callback();
    },
    isArmed: () => armed !== null,
    armCount: () => arms,
    sendAppState: (status) => {
      for (const listener of [...appStateListeners]) {
        listener(status);
      }
    },
    appStateListenerCount: () => appStateListeners.size,
    source,
    restore: () => {
      globalThis.setTimeout = realSetTimeout;
      globalThis.clearTimeout = realClearTimeout;
      appStateListeners.clear();
      __setPlannerDaySource(null);
    },
  };
}
