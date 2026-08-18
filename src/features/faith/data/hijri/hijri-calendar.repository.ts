import { locationDayFor } from '../calendar-day';
import type {
  CalendarMonth,
  FaithCalendarRepository,
  HijriDate,
  LocationToday,
  Observance,
} from '../faith-calendar.repository';
import type { PrayerLocation } from '../prayer-times.repository';
import type { FaithResult } from '../faith-result';
import {
  gregorianDateFor,
  gregorianToJdn,
  hijriDateFor,
  hijriMonthLength,
  hijriMonthName,
  jdnToGregorian,
  toIsoDate,
  type CivilDate,
} from './hijri-calendar';
import {
  nextObservance,
  observanceDatesInHijriYear,
  upcomingObservances,
} from './hijri-observances';

/**
 * The Hijri calendar, calculated.
 *
 * ── Why this is a real repository and not a mock ────────────────────────────
 * It sits in `data/hijri/` rather than `data/mock/` because nothing about it is a fixture: every
 * date it returns is computed from the day it is asked about. The repository it replaces returned
 * "21 Dhul-Qadah 1446 AH" and "19 May 2025" to every caller on every day, which made the Faith
 * home's date cards wrong for all but one day in history.
 *
 * ── What it still cannot do ─────────────────────────────────────────────────
 * Confirm a sighting. Every `HijriDate` it produces carries `basis: 'calculated'`, and the
 * observance descriptions say "expected" in words rather than relying on that flag being rendered.
 * See `hijri-calendar.ts` for why the tabular calendar was chosen and what it costs.
 *
 * ── `now` is injected ───────────────────────────────────────────────────────
 * Every method that means "today" takes its answer from `now()`. A repository that read the clock
 * directly would have tests that pass in August and fail in September, which is the specific way
 * date code rots.
 *
 * ── So is *which day* "now" falls on, and that is the newer correction ──────
 * `now()` is an instant, and an instant is two different calendar days either side of midnight. This
 * repository used to resolve that with `civilDateOf(now())` — device-local getters — while the
 * prayer path beside it resolved the same question in the *location's* zone. Faith Home therefore
 * rendered a Hijri date from one day next to a next prayer from another, for anybody whose phone was
 * set to a different side of midnight from where they were.
 *
 * `todayCivilDate` is now injected too. The DI supplies a resolver that reads the day at the user's
 * prayer location; where no location has been resolved it falls back to the device, which is not a
 * fudge — with no location, the device's day is genuinely all NoorLife knows, and the Hijri card is
 * then answering "what is the date for me" rather than "what is the date there".
 *
 * The arithmetic is untouched. This changes *which day* is converted, never *how* — every date still
 * carries `basis: 'calculated'` and nothing here implies a sighting.
 */

export type HijriCalendarConfig = {
  /**
   * The clock. Injected so tests need not depend on when they run.
   *
   * There is no longer a companion `todayCivilDate`. It existed to let a caller supply the day, and
   * its default read the device — a total function that had to return *something* when the location
   * was not yet known, and what it returned was a plausible wrong answer. The day is now derived per
   * call from the `PrayerLocation` the caller passes in, and the cases where it cannot be derived
   * are states in the return type rather than substitutions.
   */
  readonly now?: () => Date;
};

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseIsoDate(value: string): CivilDate | null {
  const match = ISO_DATE.exec(value);
  if (match === null) {
    return null;
  }
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  // Re-derived rather than trusted: "2026-02-31" parses to three plausible integers and is not a
  // date. The day-number conversion normalises it to 3 March, and comparing the normalised value
  // back against the input is what rejects it.
  const civil: CivilDate = { year, month, day };
  const normalised = jdnToGregorian(gregorianToJdn(civil));
  return normalised.year === year && normalised.month === month && normalised.day === day
    ? civil
    : null;
}

export function createHijriCalendarRepository(
  config: HijriCalendarConfig | (() => Date) = {},
): FaithCalendarRepository {
  /*
    Accepts the old bare `now` function as well as the config object. Several call sites and a
    number of tests pass `() => new Date(...)`, and breaking them all to add one optional field
    would have been churn with no reader benefit.
  */
  const resolved: HijriCalendarConfig = typeof config === 'function' ? { now: config } : config;
  const now = resolved.now ?? (() => new Date());

  /**
   * Today at the given location, or the reason there is no answer.
   *
   * One derivation, shared by every method that means "today", so two surfaces reading this
   * repository in the same tick cannot land on different days.
   */
  const todayAt = (location: PrayerLocation) => locationDayFor(location, now());
  /**
   * Observance ids falling on a given Gregorian day, for the month grid's markers.
   *
   * Takes the id/date pairs rather than whole `Observance` values: a marker needs a day and an id,
   * and nothing else. Narrowing the input is what let `getMonth` stop needing a "today".
   */
  const observanceIdsOn = (
    iso: string,
    all: readonly { readonly id: string; readonly gregorian: string }[],
  ): readonly string[] =>
    all.filter((observance) => observance.gregorian === iso).map((observance) => observance.id);

  return {
    async getLocationToday(location: PrayerLocation): Promise<FaithResult<LocationToday>> {
      const today = todayAt(location);
      if (today.status !== 'resolved') {
        /*
          `unavailable`, with the reason in `detail` for the development audit. Not a date, not the
          device's day, and not a cached day from a different location — the three things that would
          each render as an ordinary, believable date.
        */
        return {
          kind: 'error',
          code: 'unavailable',
          detail:
            today.status === 'zone-unresolved'
              ? 'The location’s time zone could not be resolved on this device.'
              : 'The stored location is too old to date today from.',
        };
      }

      const { value } = today;
      return {
        kind: 'ok',
        data: {
          hijri: hijriDateFor(value.civil),
          gregorian: value.day,
          day: value.day,
          timeZone: value.timeZone,
          provenance: value.provenance,
          locationResolvedAt: value.locationResolvedAt,
          stale: value.stale,
        },
      };
    },

    async getMonth(hijriYear: number, hijriMonth: number): Promise<FaithResult<CalendarMonth>> {
      if (!Number.isInteger(hijriMonth) || hijriMonth < 1 || hijriMonth > 12) {
        return { kind: 'error', code: 'not-found' };
      }
      if (!Number.isInteger(hijriYear) || hijriYear < 1) {
        return { kind: 'error', code: 'not-found' };
      }

      const monthName = hijriMonthName(hijriMonth);
      const length = hijriMonthLength(hijriYear, hijriMonth);
      /**
       * Markers for the Hijri year **being browsed**, which needs no "today" at all.
       *
       * This used to call `observancesAround(today)`, seeded from the current Hijri year and the
       * next — so browsing a month three years out showed no markers, and the query needed a
       * location-scoped value to compute a `daysUntil` the grid never reads.
       */
      const all = observanceDatesInHijriYear(hijriYear);

      const days = Array.from({ length }, (_, index) => {
        const day = index + 1;
        const gregorian = toIsoDate(gregorianDateFor({ year: hijriYear, month: hijriMonth, day }));
        return {
          hijri: {
            day,
            month: hijriMonth,
            monthName,
            year: hijriYear,
            formatted: `${day} ${monthName} ${hijriYear} AH`,
            basis: 'calculated' as const,
          },
          gregorian,
          observanceIds: observanceIdsOn(gregorian, all),
        };
      });

      return { kind: 'ok', data: { hijriMonth, hijriYear, monthName, days } };
    },

    async getNextObservance(location: PrayerLocation): Promise<FaithResult<Observance>> {
      const today = todayAt(location);
      if (today.status !== 'resolved') {
        // A countdown needs a today. Without one there is no honest number of days to state.
        return { kind: 'error', code: 'unavailable' };
      }
      const next = nextObservance(today.value.civil);
      // `empty` rather than an error: "nothing is coming up" is a legitimate answer, even though the
      // seeded set means it cannot happen today. An error would tell the user something is broken.
      return next === null ? { kind: 'empty' } : { kind: 'ok', data: next };
    },

    async listUpcomingObservances(
      location: PrayerLocation,
      limit = 10,
    ): Promise<FaithResult<readonly Observance[]>> {
      const today = todayAt(location);
      if (today.status !== 'resolved') {
        return { kind: 'error', code: 'unavailable' };
      }
      const upcoming = upcomingObservances(today.value.civil, limit);
      return upcoming.length === 0 ? { kind: 'empty' } : { kind: 'ok', data: upcoming };
    },

    async convertGregorian(date: string): Promise<FaithResult<HijriDate>> {
      const parsed = parseIsoDate(date);
      if (parsed === null) {
        return { kind: 'error', code: 'not-found', detail: 'Expected an ISO date, YYYY-MM-DD.' };
      }
      return { kind: 'ok', data: hijriDateFor(parsed) };
    },
  };
}
