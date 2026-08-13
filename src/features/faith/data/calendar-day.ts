import type { HijriDate } from './faith-calendar.repository';
import {
  gregorianToJdn,
  hijriDateFor,
  jdnToGregorian,
  type CivilDate,
} from './hijri/hijri-calendar';
import { zonedIsoDay } from './prayer/location-time-zone';

/**
 * The one boundary between "an instant" and "which calendar day it is at a place".
 *
 * ── The defect this exists to end ───────────────────────────────────────────
 * Prayer timestamps were resolved through the location's IANA zone — `zonedIsoDay(now,
 * location.timeZone)` — while the Hijri date beside them went through `civilDateOf(now())`, which
 * reads `getFullYear()`, `getMonth()` and `getDate()`: the **device's** calendar day. Whenever the
 * device and the prayer location sat on opposite sides of midnight, the card showed one day's prayer
 * times beside another day's Hijri date.
 *
 * A second instance of the same mistake was upstream of that: the Prayer screen asked for
 * `getDailyTimes(location, todayIsoDate(), …)`, and `todayIsoDate()` is also device-local — so the
 * *times themselves*, not only the Hijri date, were computed for the device's day. A traveller past
 * midnight at home but not at their destination got the wrong day's prayers.
 *
 * ── Why one module rather than a fix at each site ───────────────────────────
 * This is the fourth appearance of the same class of bug in this module (see
 * `prayer/location-time-zone.ts` for the first three). Fixing each site again would produce a fifth.
 * What was missing was a *named place* where the two time models meet, so there is somewhere to look
 * and somewhere for a scan to point at. Everything location-scoped now crosses here.
 *
 * ── The shape of the correction ─────────────────────────────────────────────
 * The crossing happens exactly once, at `locationCalendarDay`, and produces a bare `YYYY-MM-DD`.
 * After that there is **no zone left to get wrong**: a calendar day is three integers, the Hijri
 * conversion is pure arithmetic on those integers, and nothing downstream needs a `Date` at all.
 * That is why `hijriForCalendarDay` takes a string and not a `Date` — a `Date` would let a device
 * getter back in, and a signature that cannot express the mistake is worth more than a comment
 * saying not to make it.
 *
 * ── What is deliberately *not* here ─────────────────────────────────────────
 * Any change to the Hijri arithmetic. `hijriDateFor` is unchanged, its tabular basis is unchanged,
 * and every date produced still carries `basis: 'calculated'` — this module corrects *which day* is
 * converted, never *how*. Nothing here reaches a network or a calendar service; the whole path is
 * `Intl` for the zone and integer arithmetic for the conversion.
 */

/** A calendar day with no time and no zone: `YYYY-MM-DD`. */
export type CalendarDay = string;

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * The Gregorian calendar day at a location, for a given instant.
 *
 * **This is the only sanctioned crossing from an instant to a location-scoped date.** It returns
 * `null` when the platform cannot resolve the zone rather than falling back to the device, because a
 * plausible date in the wrong zone is indistinguishable from a correct one and therefore gets acted
 * on. Callers render an error; none of them substitutes the device.
 */
export function locationCalendarDay(instant: Date, timeZone: string): CalendarDay | null {
  return zonedIsoDay(instant, timeZone);
}

/**
 * A calendar day as three integers, or `null` if it is not a real date.
 *
 * Re-derived rather than trusted: `2026-02-31` parses to three plausible integers and is not a day.
 * The round trip through the Julian day number normalises it to 3 March, and comparing that back
 * against the input is what rejects it.
 */
export function civilDateForCalendarDay(day: CalendarDay): CivilDate | null {
  const match = ISO_DAY.exec(day);
  if (match === null) {
    return null;
  }
  const civil: CivilDate = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
  if (civil.month < 1 || civil.month > 12 || civil.day < 1 || civil.day > 31) {
    return null;
  }
  const normalised = jdnToGregorian(gregorianToJdn(civil));
  return normalised.year === civil.year &&
    normalised.month === civil.month &&
    normalised.day === civil.day
    ? civil
    : null;
}

/**
 * The Hijri date for a calendar day.
 *
 * Pure: no `Date`, no zone, no clock. Whatever day is handed in is the day converted, which is what
 * makes a month of thirty days produce thirty different Hijri dates instead of thirty copies of
 * today's. The `basis: 'calculated'` disclosure comes straight from `hijriDateFor` and is not
 * touched here — nothing in this module implies a confirmed sighting.
 */
export function hijriForCalendarDay(day: CalendarDay): HijriDate | null {
  const civil = civilDateForCalendarDay(day);
  return civil === null ? null : hijriDateFor(civil);
}

/**
 * The formatted Hijri date for a calendar day, e.g. `27 Safar 1448 AH`.
 *
 * Returns `''` rather than `null` for an unparseable day, because its one caller stores the result
 * in `DailyPrayerTimes.hijriDate`, a non-optional string. An empty string renders as absent and is
 * reported `UNRESOLVED` by the provenance audit; a fabricated date would render as fact.
 */
export function formattedHijriForCalendarDay(day: CalendarDay): string {
  return hijriForCalendarDay(day)?.formatted ?? '';
}

/**
 * How old a location fix may be before the day derived from it is flagged as stale.
 *
 * Not a cut-off — a flag. A day-old fix is still overwhelmingly likely to be the right zone, and
 * discarding it would leave the user with no date at all rather than with a good one. The flag is
 * carried on the result and surfaced by the development provenance audit.
 */
export const LOCATION_DAY_STALE_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * How old a location fix may be before a *date* may no longer be derived from it at all.
 *
 * ── Why there is a cut-off, and why it is here rather than everywhere ───────
 * A prayer time is a claim about a **place**: computed from a month-old coordinate it is still the
 * correct answer for that place, and a user who has not moved is well served by it. A Hijri date is
 * a claim about **now** — "today is 27 Safar" — and a thirty-day-old fix is no longer evidence of
 * where "now" is being asked from.
 *
 * ── The asymmetry this creates, stated rather than hidden ───────────────────
 * Beyond this ceiling the Prayer screen still renders times from the stored location while the date
 * beside them reports `unavailable`. That is deliberate: an explicitly absent date is honest, and a
 * date asserted from a fix nobody has confirmed in a month is the class of statement this whole
 * correction exists to remove. Whether the prayer path should adopt the same ceiling is a product
 * decision and is flagged, not taken here.
 */
export const LOCATION_DAY_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** How a location came to be known. Mirrors `PrayerLocation.manual`, named for reading. */
export type LocationDayProvenance = 'device-fix' | 'user-selected';

/** A calendar day that is genuinely attributable to a place, with the evidence attached. */
export type LocationDay = {
  readonly day: CalendarDay;
  readonly civil: CivilDate;
  readonly timeZone: string;
  readonly provenance: LocationDayProvenance;
  /** When the location behind this day was resolved. `null` for a place never stored. */
  readonly locationResolvedAt: string | null;
  /** Age of that resolution in milliseconds, or `null` when it has no resolution moment. */
  readonly ageMs: number | null;
  /** True past `LOCATION_DAY_STALE_AFTER_MS`. Reported, not acted on. */
  readonly stale: boolean;
};

/**
 * What can be said about today at a location, as a closed set.
 *
 * ── Why this is a union and not a `CivilDate` ───────────────────────────────
 * Because the previous shape was a total function — `() => CivilDate` — and a total function has to
 * return *something* when it does not know. What it returned was the device's calendar day, which is
 * a correct answer to a different question and is indistinguishable on screen from a right one. The
 * type could not express "I do not know yet", so the implementation invented a value instead.
 *
 * Every state below is one a surface can render honestly. None of them is a date NoorLife is
 * guessing at.
 */
export type LocationDayResolution =
  | { readonly status: 'resolved'; readonly value: LocationDay }
  /** The platform's `Intl` cannot do arithmetic in this zone, so no day can be derived. */
  | { readonly status: 'zone-unresolved' }
  /** The location behind it is older than `LOCATION_DAY_MAX_AGE_MS`. */
  | { readonly status: 'expired'; readonly ageMs: number };

/**
 * Today at a location — the single derivation for every location-scoped date in the module.
 *
 * ── Why it takes the whole location rather than a zone ──────────────────────
 * Because provenance and freshness are part of the answer, and they live on the location. A function
 * taking a bare zone would have to be trusted about where that zone came from, and "where did this
 * zone come from" is precisely the question that went unasked.
 *
 * ── Why there is no fallback of any kind ────────────────────────────────────
 * There is no device branch, no cached-day branch and no default. The location passed in is either
 * good enough to derive a day from or it is not, and both outcomes are in the return type. The
 * caller's own `FaithResult` carries "no location at all" — that state belongs to location
 * resolution, not here.
 */
export function locationDayFor(location: LocationLike, instant: Date): LocationDayResolution {
  const day = locationCalendarDay(instant, location.timeZone);
  const civil = day === null ? null : civilDateForCalendarDay(day);
  if (day === null || civil === null) {
    return { status: 'zone-unresolved' };
  }

  const resolvedAtMs = location.resolvedAt === null ? null : Date.parse(location.resolvedAt);
  /*
    An unparseable stamp is treated as "no stamp" rather than as age zero. Reading a corrupt value as
    freshly resolved would make the ceiling below unenforceable by exactly the input most likely to
    be wrong.
  */
  const ageMs =
    resolvedAtMs === null || Number.isNaN(resolvedAtMs)
      ? null
      : Math.max(0, instant.getTime() - resolvedAtMs);

  if (ageMs !== null && ageMs > LOCATION_DAY_MAX_AGE_MS) {
    return { status: 'expired', ageMs };
  }

  return {
    status: 'resolved',
    value: {
      day,
      civil,
      timeZone: location.timeZone,
      provenance: location.manual ? 'user-selected' : 'device-fix',
      locationResolvedAt: location.resolvedAt,
      ageMs,
      stale: ageMs !== null && ageMs > LOCATION_DAY_STALE_AFTER_MS,
    },
  };
}

/** The part of a `PrayerLocation` a day derivation needs. Narrowed so tests need not build one. */
export type LocationLike = {
  readonly timeZone: string;
  readonly manual: boolean;
  readonly resolvedAt: string | null;
};

/**
 * How many days a Gregorian month has, by arithmetic rather than by constructing a `Date`.
 *
 * ── What this replaced, and why it was worth replacing ──────────────────────
 * `new Date(year, monthIndex + 1, 0).getDate()` — day zero of the following month, which is the last
 * day of this one. A neat trick, correct in almost every case, and built out of exactly the two
 * things this module exists to keep off the location-scoped path: a device-local `Date` constructor
 * and a device-local getter.
 *
 * "Almost every case" is the problem. `new Date(y, m, 0)` materialises local midnight, and there are
 * zones where local midnight does not exist on a given date because the clock jumps straight from
 * 23:59 to 01:00 — Lord Howe, and historically several South American and Middle Eastern zones. The
 * runtime then resolves the missing hour forward, and the day read back can be the next one. That
 * would give a 30-day month 31 entries.
 *
 * The difference between two Julian day numbers has no such edge: it is integer subtraction on a
 * proleptic calendar, identical on every machine, and it handles February in a leap year without a
 * table or a special case.
 */
export function daysInGregorianMonth(year: number, month: number): number {
  const firstOfThis = gregorianToJdn({ year, month, day: 1 });
  const firstOfNext =
    month === 12
      ? gregorianToJdn({ year: year + 1, month: 1, day: 1 })
      : gregorianToJdn({ year, month: month + 1, day: 1 });
  return firstOfNext - firstOfThis;
}
