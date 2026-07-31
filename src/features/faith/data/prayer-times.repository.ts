import type { FaithResult } from './faith-result';

/**
 * Prayer times, and the preferences that determine them.
 *
 * ── Why location is a parameter rather than a dependency ────────────────────
 * A prayer time is a function of a coordinate, a date and a calculation method. Making
 * the coordinate an argument keeps this repository pure with respect to device
 * permissions: the *screen* decides whether to ask for location, fall back to a
 * manually chosen city, or render the `permission-required` state. A repository that
 * reached for the GPS itself would make that decision untestable and would put a
 * permission prompt behind a data call.
 *
 * `PrayerTimesRepository` therefore never returns `permission-required` from
 * `getDailyTimes` — the caller has already resolved a coordinate by then. It *is* a
 * legitimate result from `resolveCurrentLocation`.
 */

export type PrayerKey = 'fajr' | 'sunrise' | 'dhuhr' | 'asr' | 'maghrib' | 'isha';

/** The five obligatory prayers. Sunrise is a time marker, not a prayer. */
export const OBLIGATORY_PRAYERS: readonly PrayerKey[] = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];

export type Coordinate = {
  readonly latitude: number;
  readonly longitude: number;
};

export type PrayerLocation = {
  readonly coordinate: Coordinate;
  /** Human-readable place, e.g. "Manchester, United Kingdom". */
  readonly label: string;
  /** IANA zone, e.g. "Europe/London". Times are meaningless without it. */
  readonly timeZone: string;
  /** True when the user picked a city rather than the device reporting one. */
  readonly manual: boolean;
};

/**
 * Calculation conventions.
 *
 * Deliberately an enumerated set rather than free numeric angles: the app must not
 * invent a convention, and every value here corresponds to a body that publishes one.
 */
export type CalculationMethod =
  | 'muslim-world-league'
  | 'umm-al-qura'
  | 'egyptian'
  | 'karachi'
  | 'isna'
  | 'moonsighting-committee';

/** Asr shadow-length convention. */
export type AsrJuristicMethod = 'standard' | 'hanafi';

export type PrayerCalculationSettings = {
  readonly method: CalculationMethod;
  readonly asr: AsrJuristicMethod;
  /** Per-prayer manual offset in minutes, for local mosque alignment. */
  readonly offsetsMinutes: Readonly<Partial<Record<PrayerKey, number>>>;
};

export type PrayerTime = {
  readonly key: PrayerKey;
  readonly label: string;
  /** ISO-8601 with offset, so a rendered time can never lose its zone. */
  readonly at: string;
};

export type DailyPrayerTimes = {
  /** ISO date, `YYYY-MM-DD`. */
  readonly date: string;
  readonly hijriDate: string;
  readonly location: PrayerLocation;
  readonly settings: PrayerCalculationSettings;
  readonly times: readonly PrayerTime[];
};

/** Which prayer is next, and how long until it. Derived, but derived in one place. */
export type NextPrayer = {
  readonly prayer: PrayerTime;
  readonly minutesUntil: number;
};

/** Per-prayer reminder preference. A contract only — no notification is scheduled yet. */
export type PrayerNotificationPreference = {
  readonly prayer: PrayerKey;
  readonly enabled: boolean;
  /** Minutes before the prayer time. 0 means at the time itself. */
  readonly minutesBefore: number;
};

export type PrayerTimesRepository = {
  /**
   * Resolves where the user is.
   *
   * The one method that may return `permission-required`, because it is the one that
   * needs the OS.
   */
  resolveCurrentLocation(): Promise<FaithResult<PrayerLocation>>;

  /** Cities the user can pick when they decline location. */
  searchLocations(query: string): Promise<FaithResult<readonly PrayerLocation[]>>;

  getDailyTimes(
    location: PrayerLocation,
    date: string,
    settings: PrayerCalculationSettings,
  ): Promise<FaithResult<DailyPrayerTimes>>;

  getMonthlyTimes(
    location: PrayerLocation,
    month: string,
    settings: PrayerCalculationSettings,
  ): Promise<FaithResult<readonly DailyPrayerTimes[]>>;

  getNextPrayer(
    location: PrayerLocation,
    settings: PrayerCalculationSettings,
  ): Promise<FaithResult<NextPrayer>>;

  readNotificationPreferences(): Promise<FaithResult<readonly PrayerNotificationPreference[]>>;

  writeNotificationPreferences(
    preferences: readonly PrayerNotificationPreference[],
  ): Promise<FaithResult<readonly PrayerNotificationPreference[]>>;
};
