import type { LocationDayProvenance } from './calendar-day';
import type { FaithResult } from './faith-result';
import type { PrayerLocation } from './prayer-times.repository';

/**
 * The Hijri calendar and its observances.
 *
 * ── Why every date carries a `sighting` qualifier ───────────────────────────
 * Hijri dates are not a pure calculation. Whether Ramadan begins on a given evening
 * depends on moon sighting, which differs by region and by authority, and a calendar
 * that renders a calculated date as settled fact is stating something the app cannot
 * know. `HijriDate.basis` records which it is, and the UI shows "expected" for
 * calculated observances rather than presenting them as confirmed.
 */

/** How a Hijri date was arrived at. */
export type HijriBasis = 'calculated' | 'confirmed-sighting';

export type HijriDate = {
  readonly day: number;
  readonly month: number;
  /** e.g. "Dhul-Qadah". */
  readonly monthName: string;
  readonly year: number;
  /** Formatted for display, e.g. "21 Dhul-Qadah 1446 AH". */
  readonly formatted: string;
  readonly basis: HijriBasis;
};

export type ObservanceKind = 'ramadan' | 'eid' | 'hajj' | 'ashura' | 'mawlid' | 'other';

export type Observance = {
  readonly id: string;
  readonly name: string;
  readonly kind: ObservanceKind;
  readonly hijri: HijriDate;
  /** Gregorian equivalent, ISO `YYYY-MM-DD`. */
  readonly gregorian: string;
  /** Days from today. Negative once past. */
  readonly daysUntil: number;
  readonly description: string;
};

export type CalendarMonth = {
  readonly hijriMonth: number;
  readonly hijriYear: number;
  readonly monthName: string;
  readonly days: readonly {
    readonly hijri: HijriDate;
    readonly gregorian: string;
    readonly observanceIds: readonly string[];
  }[];
};

/**
 * Today at a prayer location, with the evidence for it.
 *
 * `gregorian` and `day` are the same string; both names are kept because callers read them for
 * different reasons — one is "the date to print", the other is "the calendar day everything else on
 * this screen must agree with".
 */
export type LocationToday = {
  readonly hijri: HijriDate;
  readonly gregorian: string;
  readonly day: string;
  readonly timeZone: string;
  readonly provenance: LocationDayProvenance;
  readonly locationResolvedAt: string | null;
  readonly stale: boolean;
};

/**
 * The Hijri calendar.
 *
 * ── Every "today" here is scoped to a prayer location, and takes one ────────
 * `getToday()` used to take no argument and resolve the day itself, from the device. That is the
 * defect this contract now makes unstateable: a method that cannot see a location cannot be asked
 * which day it is, because the honest answer depends entirely on where the question is asked from.
 *
 * Passing the location in also buys **atomicity for free**. Faith Home renders the Hijri date beside
 * the next prayer; both are derived from one `PrayerLocation` object resolved once by the caller, so
 * there is no window in which they can be derived from two different locations, and no second
 * lookup to race the first.
 *
 * ── There is no device-local variant, deliberately ─────────────────────────
 * Not on this interface and not beside it. Two "today"s in one module — one location-scoped, one
 * device-scoped — is the ambiguity that produced the defect in the first place, and no naming
 * convention survives contact with a hurried call site. The Faith module has exactly one meaning for
 * today: the day at the user's prayer location. Where that is unknown, the surfaces say so.
 *
 * The methods that need **no** today take no location: `getMonth` derives its observance markers
 * from the Hijri year being browsed, and `convertGregorian` is pure arithmetic on the day it is
 * given. Both are zone-free by construction.
 */
export type FaithCalendarRepository = {
  /**
   * Today in both calendars, at the given prayer location.
   *
   * Answers `error: 'unavailable'` when the zone will not resolve or the location behind it is past
   * `LOCATION_DAY_MAX_AGE_MS` — never a substituted date. "There is no location at all" is not this
   * method's state to report: the caller reaches it by resolving a location first, and
   * `permission-required` comes from there.
   */
  getLocationToday(location: PrayerLocation): Promise<FaithResult<LocationToday>>;

  /** A browsed Hijri month. Needs no today — see the note above. */
  getMonth(hijriYear: number, hijriMonth: number): Promise<FaithResult<CalendarMonth>>;

  /** The next observance — drives the home screen's "Upcoming" card. */
  getNextObservance(location: PrayerLocation): Promise<FaithResult<Observance>>;

  listUpcomingObservances(
    location: PrayerLocation,
    limit?: number,
  ): Promise<FaithResult<readonly Observance[]>>;

  convertGregorian(date: string): Promise<FaithResult<HijriDate>>;
};
