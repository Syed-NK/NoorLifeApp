import tzLookup from '@photostructure/tz-lookup';

import type { Coordinate } from '../prayer-times.repository';

/**
 * The timezone of a *place*, and wall-clock arithmetic inside it.
 *
 * ── The defect this module exists to fix ────────────────────────────────────
 * Prayer times were calculated for the selected coordinate and then formatted in the **device's**
 * zone. The instants were right and the numbers on screen were wrong for anybody whose phone was set
 * to somewhere else:
 *
 *   device Asia/Dubai (+04), location Mountain View (-07)
 *   → Fajr 05:00 PDT, a correct instant, stamped `+04:00` and rendered as "4:00 PM"
 *
 * Three separate things were wrong, and a formatting patch would only have fixed the first:
 *
 *   1. `toOffsetIso` read `getHours()` and `-getTimezoneOffset()` — both device-local.
 *   2. `PrayerLocation.timeZone` was set to `deviceTimeZone()`, so the field that was supposed to
 *      carry the answer carried the question.
 *   3. "Today" was the device's calendar day, so next-prayer and rollover broke independently of
 *      formatting. A traveller past midnight at home but not at their destination got the wrong
 *      day's times.
 *
 * ── Where the zone comes from, and what was rejected ────────────────────────
 * `@photostructure/tz-lookup` (CC0-1.0, ~88 KB, no dependencies, one file, no native module and no
 * filesystem access). It is a compressed raster of the IANA boundary set and resolves entirely on the
 * device.
 *
 * Rejected, and the reasons are worth keeping:
 *
 *   • **Guessing from longitude.** 15° per hour is wrong across most of the inhabited world —
 *     China runs one zone over five nominal ones, India is on a half-hour offset, and the boundary in
 *     Europe follows borders rather than meridians. Prayer times are the wrong place to be
 *     approximately right about time.
 *   • **A fixed UTC offset instead of a zone name.** An offset cannot express DST, so a cached
 *     result would be an hour out for half the year. This module stores and passes IANA names.
 *   • **A network timezone service.** It would send the user's coordinates to a third party for a
 *     value obtainable offline. That is a privacy cost with no benefit.
 *   • **`expo-location`'s `timezone` field.** It exists, and the SDK 57 documentation marks it
 *     *iOS only* — `null` on Android. Half the platforms is not a solution.
 *
 * ── Why the offsets come from `Intl` and not from a bundled tz database ─────
 * `tz-lookup` answers *which zone*, not *what offset on this date* — the offset needs the IANA rules,
 * including each region's own DST history. `Intl.DateTimeFormat` already has them, on both platforms,
 * and bundling a second copy of the tz database would cost far more than the lookup table does.
 *
 * The caution recorded elsewhere in this module about Hermes and ICU is real, so nothing here trusts
 * `Intl` blindly: every function returns `null` when the platform cannot answer, `isZoneResolvable`
 * probes before a zone is adopted, and the callers treat `null` as "NoorLife cannot say" rather than
 * substituting the device. A wrong prayer time is worse than an absent one.
 */

/**
 * The IANA zone containing a coordinate, or `null` when it cannot be resolved.
 *
 * `tz-lookup` throws on an out-of-range latitude or longitude rather than returning a nearest guess,
 * which is the behaviour this wants — a coordinate that is not a place on Earth has no zone, and
 * inventing one would put a fabricated time on screen.
 */
export function timeZoneForCoordinate(coordinate: Coordinate): string | null {
  try {
    const zone = tzLookup(coordinate.latitude, coordinate.longitude);
    if (typeof zone !== 'string' || zone.length === 0) {
      return null;
    }
    // Probed rather than assumed: a zone name the platform's ICU does not know is worse than no
    // zone, because every downstream format would silently fall back to the device.
    return isZoneResolvable(zone) ? zone : null;
  } catch {
    return null;
  }
}

/** The device's own IANA zone, or `null` where the platform cannot say. Never guessed. */
export function deviceTimeZone(): string | null {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof zone === 'string' && zone.length > 0 ? zone : null;
  } catch {
    return null;
  }
}

/** Whether this platform's `Intl` can actually do wall-clock arithmetic in a given zone. */
export function isZoneResolvable(timeZone: string): boolean {
  return zonedParts(new Date(0), timeZone) !== null;
}

type ZonedParts = {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
};

/**
 * The wall-clock components of an instant, as read in a given zone.
 *
 * `hourCycle: 'h23'` rather than `hour12: false`, because the two are not equivalent: several ICU
 * versions render midnight as `24` under `hour12: false`, which would put the day boundary an hour
 * late and produce a `24:00` timestamp. `h23` is the cycle that means 00–23, and the `% 24` below is
 * belt and braces for a build that ignores it.
 */
export function zonedParts(instant: Date, timeZone: string): ZonedParts | null {
  if (Number.isNaN(instant.getTime())) {
    return null;
  }
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(instant);

    const read = (type: string): number => {
      const found = parts.find((part) => part.type === type);
      return found === undefined ? Number.NaN : Number(found.value);
    };

    const resolved: ZonedParts = {
      year: read('year'),
      month: read('month'),
      day: read('day'),
      hour: read('hour') % 24,
      minute: read('minute'),
      second: read('second'),
    };

    return Object.values(resolved).some((value) => Number.isNaN(value)) ? null : resolved;
  } catch {
    return null;
  }
}

/**
 * The zone's UTC offset in minutes at a given instant — so DST is a property of the date.
 *
 * Derived rather than tabulated: the wall clock in the zone, reinterpreted as if it were UTC, differs
 * from the true instant by exactly the offset. That is true across a DST transition without this
 * module knowing any transition rules, which is the point — the rules live in ICU, and duplicating
 * them here is how the two would disagree.
 */
export function zoneOffsetMinutes(instant: Date, timeZone: string): number | null {
  const parts = zonedParts(instant, timeZone);
  if (parts === null) {
    return null;
  }
  const asIfUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  // Rounded to the minute: `instant` can carry milliseconds, which the formatted parts do not.
  return Math.round((asIfUtc - instant.getTime()) / 60_000);
}

/** The calendar day at the location, `YYYY-MM-DD`. This is what "today" has to mean. */
export function zonedIsoDay(instant: Date, timeZone: string): string | null {
  const parts = zonedParts(instant, timeZone);
  return parts === null
    ? null
    : `${String(parts.year).padStart(4, '0')}-${pad(parts.month)}-${pad(parts.day)}`;
}

/**
 * An instant as an ISO-8601 timestamp carrying **the location's** offset.
 *
 * ── Why the offset is written out rather than using `toISOString` ───────────
 * `PrayerTime.at` is documented as carrying its offset so that a rendered time can never lose its
 * zone, and `formatPrayerClock` reads the hours and minutes straight out of the string. A `Z` form
 * would make every screen responsible for converting, and the screen that forgot would show the
 * wrong hour — which is the class of bug this module was written to end.
 *
 * It also means a **cached** result reconstructs correctly with no further lookup: the offset that
 * applied on that date, including DST, is inside the string.
 */
export function toZonedOffsetIso(instant: Date, timeZone: string): string | null {
  const parts = zonedParts(instant, timeZone);
  const offset = zoneOffsetMinutes(instant, timeZone);
  if (parts === null || offset === null) {
    return null;
  }

  const sign = offset >= 0 ? '+' : '-';
  const absolute = Math.abs(offset);
  const offsetText = `${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`;

  return (
    `${String(parts.year).padStart(4, '0')}-${pad(parts.month)}-${pad(parts.day)}` +
    `T${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}${offsetText}`
  );
}

/**
 * A `Date` whose **device-local** calendar day equals the given day at the location.
 *
 * ── Why this exists, and why it looks like a trick ──────────────────────────
 * `adhan` takes a `Date` and reads `getFullYear`, `getMonth` and `getDate` off it — device-local
 * getters — to decide which calendar day to compute. It ignores the time of day. So to ask it for
 * "17 July at this coordinate" the argument has to be a `Date` that the *device* reads as 17 July,
 * whatever zone the device is in and whatever zone the coordinate is in.
 *
 * Noon, deliberately. Midnight local lands on the previous day in UTC for anybody west of Greenwich
 * and on the next day for a large enough eastern offset, and noon is the only hour that is the same
 * calendar day in every zone on Earth.
 *
 * This is the seam where the two time models meet, and it is one function so there is exactly one
 * place to look when they disagree.
 */
export function localDateForCalendarDay(isoDay: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDay);
  if (match === null) {
    return null;
  }
  const parsed = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Adds whole days to an ISO calendar day, without going through a zone. */
export function addCalendarDays(isoDay: string, days: number): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDay);
  if (match === null) {
    return null;
  }
  // UTC arithmetic on a bare calendar day: no zone is involved, so no transition can shift it.
  const shifted = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days),
  );
  return Number.isNaN(shifted.getTime()) ? null : shifted.toISOString().slice(0, 10);
}

function pad(value: number): string {
  return String(Math.floor(Math.abs(value))).padStart(2, '0');
}
