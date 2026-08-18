import type { FaithResult } from './faith-result';

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

export type FaithCalendarRepository = {
  /** Today in both calendars — drives the home screen's Islamic Calendar card. */
  getToday(): Promise<FaithResult<{ readonly hijri: HijriDate; readonly gregorian: string }>>;

  getMonth(hijriYear: number, hijriMonth: number): Promise<FaithResult<CalendarMonth>>;

  /** The next observance — drives the home screen's "Upcoming" card. */
  getNextObservance(): Promise<FaithResult<Observance>>;

  listUpcomingObservances(limit?: number): Promise<FaithResult<readonly Observance[]>>;

  convertGregorian(date: string): Promise<FaithResult<HijriDate>>;
};
