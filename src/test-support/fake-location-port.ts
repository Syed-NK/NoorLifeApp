import { createAdhanPrayerTimesRepository } from '@features/faith/data/prayer/adhan-prayer-times.repository';
import { formattedHijriForCalendarDay } from '@features/faith/data/calendar-day';
import { createMockFaithRepositories } from '@features/faith/data/mock';
import type {
  HeadingReading,
  LocationFailure,
  LocationFix,
  LocationPermission,
  LocationPort,
  ProvisionalFix,
} from '@features/faith/data/location/location.port';
import type { Coordinate } from '@features/faith/data/prayer-times.repository';
import type { FaithRepositories } from '@features/faith/data/index';

/**
 * A `LocationPort` that records every call, and can be made to fail the test if one arrives at all.
 *
 * ── Why counting is not enough, and a throwing port is the point ─────────────
 * The rule this exists to enforce is negative: in `city` and `coordinates` mode the app must never
 * reach the platform for a position. A negative is only as good as the place it is checked, and a
 * suite that counts calls after the fact reports the violation from whichever assertion happens to
 * run next — several awaits and one screen away from the code that made the call.
 *
 * `forbid` makes the port itself the failure site. The method throws where it was invoked, so the
 * stack names the hook, the effect or the repository that asked, rather than the test that noticed.
 * That is the difference between "city mode called the GPS somewhere" and a line number.
 *
 * ── Why the fix is deferred rather than immediate ───────────────────────────
 * Every interesting concurrency case in this module lives *inside* the seconds a device acquisition
 * takes: a city saved while a fix is in flight, a second tap on the refresh control, a timeout that
 * lands after the user has already chosen somewhere else. A port that resolves immediately cannot
 * express any of them, and an arbitrary sleep only makes the race likely rather than certain.
 * `pendingPositions` hands the test the resolver, so the window is opened and closed on purpose.
 */

/** Every method of the port, named so a test can assert on the exact call log. */
export type LocationPortCall =
  | 'getPermission'
  | 'requestPermission'
  | 'getCurrentPosition'
  | 'getLastKnownPosition'
  | 'describe'
  | 'search'
  | 'hasCompass'
  | 'watchHeading';

/**
 * The calls that reach the platform for a **position**, as opposed to reading a cached permission
 * flag. These are the ones city and coordinates mode may never make.
 */
export const NATIVE_POSITION_CALLS: readonly LocationPortCall[] = [
  'getPermission',
  'requestPermission',
  'getCurrentPosition',
  'getLastKnownPosition',
  'describe',
];

export type PendingPosition = {
  /** Resolves the in-flight acquisition with a fix. */
  readonly succeed: (fix: LocationFix) => void;
  /** Resolves it with a failure, exactly as the real port reports one. */
  readonly fail: (failure: LocationFailure) => void;
};

export type RecordingLocationPort = {
  readonly port: LocationPort;
  /** Every call, in order. */
  readonly calls: readonly LocationPortCall[];
  /** How many times `name` was called. */
  readonly count: (name: LocationPortCall) => number;
  /** How many of the position-acquiring calls were made, of any kind. */
  readonly nativeCallCount: () => number;
  /** Empties the log, for a test that seeds through a path it does not want to count. */
  readonly reset: () => void;
  /** One entry per `getCurrentPosition` still awaiting a verdict, in call order. */
  readonly pendingPositions: readonly PendingPosition[];
  /** Settles every outstanding acquisition, so no promise resolves into a torn-down tree. */
  readonly releaseAll: (failure?: LocationFailure) => void;
};

export type RecordingLocationPortOptions = {
  /** What `getPermission`/`requestPermission` resolve to. Defaults to granted. */
  readonly permission?: LocationPermission;
  /**
   * Calls that must never happen. Each throws where it is invoked.
   *
   * Defaults to none, so a device-mode test can use the same fixture without opting out of anything.
   */
  readonly forbid?: readonly LocationPortCall[];
  /** A reverse-geocoded label, or `null` for a coordinate the geocoder cannot name. */
  readonly label?: string | null;
};

export function createRecordingLocationPort(
  options: RecordingLocationPortOptions = {},
): RecordingLocationPort {
  const permission = options.permission ?? 'granted';
  const forbidden = new Set(options.forbid ?? []);
  const calls: LocationPortCall[] = [];
  const pending: PendingPosition[] = [];

  const record = (name: LocationPortCall): void => {
    calls.push(name);
    if (forbidden.has(name)) {
      throw new Error(
        `LocationPort.${name} was called, and this mode must never reach the platform for a position.`,
      );
    }
  };

  const port: LocationPort = {
    async getPermission(): Promise<LocationPermission> {
      record('getPermission');
      return permission;
    },
    async requestPermission(): Promise<LocationPermission> {
      record('requestPermission');
      return permission;
    },
    getCurrentPosition(): Promise<LocationFix | { readonly failure: LocationFailure }> {
      record('getCurrentPosition');
      return new Promise((resolve) => {
        pending.push({
          succeed: (fix) => resolve(fix),
          fail: (failure) => resolve({ failure }),
        });
      });
    },
    async getLastKnownPosition(): Promise<ProvisionalFix | null> {
      record('getLastKnownPosition');
      return null;
    },
    async describe(_coordinate: Coordinate): Promise<string | null> {
      record('describe');
      return options.label ?? null;
    },
    async search(): Promise<
      readonly { readonly label: string; readonly coordinate: Coordinate }[]
    > {
      record('search');
      return [];
    },
    async hasCompass(): Promise<boolean> {
      record('hasCompass');
      return false;
    },
    async watchHeading(_onReading: (reading: HeadingReading) => void): Promise<() => void> {
      record('watchHeading');
      return () => undefined;
    },
  };

  return {
    port,
    calls,
    count: (name) => calls.filter((entry) => entry === name).length,
    nativeCallCount: () => calls.filter((entry) => NATIVE_POSITION_CALLS.includes(entry)).length,
    reset: () => {
      calls.length = 0;
    },
    pendingPositions: pending,
    releaseAll: (failure = 'timed-out') => {
      for (const entry of pending.splice(0)) {
        entry.fail(failure);
      }
    },
  };
}

/**
 * The development repository set, with the location port replaced.
 *
 * ── Why the prayer repository is rebuilt rather than spread over ────────────
 * `createMockFaithRepositories` constructs one port and hands the *same instance* to the prayer
 * repository it builds. Overriding `location` on the returned object therefore changes what the
 * screens see and leaves the repository holding the original — so a test would assert against a port
 * nothing under test was using, and every "zero native calls" case would pass vacuously.
 */
export function repositoriesWithLocationPort(port: LocationPort): FaithRepositories {
  const base = createMockFaithRepositories();
  return {
    ...base,
    location: port,
    prayerTimes: createAdhanPrayerTimesRepository({
      location: port,
      hijriFor: formattedHijriForCalendarDay,
    }),
  };
}
