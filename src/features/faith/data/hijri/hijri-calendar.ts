import type { HijriDate } from '../faith-calendar.repository';

/**
 * Gregorian ⇄ Hijri conversion, calculated.
 *
 * ── Why this exists rather than a fixture ───────────────────────────────────
 * The Faith home used to render "21 Dhul-Qadah 1446 AH" as today's date on every device on every
 * day, because it was a string copied from a design reference. A date is the one thing a user can
 * check against the world outside the app, so a wrong one is not a cosmetic defect — and "no
 * fabricated dates" is a requirement this module has to satisfy somewhere. It is satisfied here.
 *
 * ── Why *tabular*, and what that costs ──────────────────────────────────────
 * This is the arithmetic (tabular) Islamic calendar with the civil epoch — the standard 30-year
 * cycle in which years 2, 5, 7, 10, 13, 16, 18, 21, 24, 26 and 29 are leap. It is a pure
 * calculation with no table to maintain and no service to call.
 *
 * What it is not is a *sighting*. The beginning of a Hijri month depends on the moon being seen,
 * which differs by region and by authority, so a calculated date can differ from the observed one by
 * a day in either direction. That is why every date this module produces carries
 * `basis: 'calculated'` and why the contract has that field at all: the UI renders it with an
 * explicit qualifier rather than as settled fact.
 *
 * `basis: 'confirmed-sighting'` is never produced here. Producing it would require an authority to
 * defer to, and NoorLife has none.
 *
 * ── Intl was considered and rejected ────────────────────────────────────────
 * `Intl.DateTimeFormat` with the `islamic-umalqura` calendar would be more accurate where it works.
 * Hermes ships a partial ICU, the available calendars vary by Android version and vendor, and a
 * conversion that silently falls back to the Gregorian calendar on some devices is worse than one
 * that is uniformly approximate and says so.
 */

/** The twelve months, in order. Index 0 is unused so `month` reads 1–12. */
const MONTH_NAMES: readonly string[] = [
  '',
  'Muharram',
  'Safar',
  'Rabi al-Awwal',
  'Rabi al-Thani',
  'Jumada al-Ula',
  'Jumada al-Akhirah',
  'Rajab',
  'Shaban',
  'Ramadan',
  'Shawwal',
  'Dhul-Qadah',
  'Dhul-Hijjah',
];

export function hijriMonthName(month: number): string {
  const name = MONTH_NAMES[month];
  if (name === undefined || name === '') {
    throw new RangeError(`Hijri month must be 1–12, received ${month}.`);
  }
  return name;
}

/**
 * A civil date with no time and no zone.
 *
 * Taken as three integers rather than a `Date` because a conversion that accepted a `Date` would be
 * silently zone-dependent: the same instant is two different calendar days either side of midnight,
 * and "which day is it" is the caller's question to answer, not this module's.
 */
export type CivilDate = {
  readonly year: number;
  readonly month: number;
  readonly day: number;
};

/** The local calendar day a `Date` falls on. The one place a zone is applied. */
export function civilDateOf(date: Date): CivilDate {
  return { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() };
}

/**
 * Gregorian calendar date → Julian Day Number.
 *
 * Proleptic Gregorian throughout — the Julian/Gregorian switchover predates the Hijri epoch's use
 * here by a millennium and is irrelevant to any date this app renders.
 */
export function gregorianToJdn({ year, month, day }: CivilDate): number {
  const a = Math.floor((14 - month) / 12);
  const y = year + 4800 - a;
  const m = month + 12 * a - 3;
  return (
    day +
    Math.floor((153 * m + 2) / 5) +
    365 * y +
    Math.floor(y / 4) -
    Math.floor(y / 100) +
    Math.floor(y / 400) -
    32045
  );
}

export function jdnToGregorian(jdn: number): CivilDate {
  const a = jdn + 32044;
  const b = Math.floor((4 * a + 3) / 146097);
  const c = a - Math.floor((146097 * b) / 4);
  const d = Math.floor((4 * c + 3) / 1461);
  const e = c - Math.floor((1461 * d) / 4);
  const m = Math.floor((5 * e + 2) / 153);
  return {
    day: e - Math.floor((153 * m + 2) / 5) + 1,
    month: m + 3 - 12 * Math.floor(m / 10),
    year: 100 * b + d - 4800 + Math.floor(m / 10),
  };
}

/**
 * The Julian Day Number of 1 Muharram 1 AH under the civil epoch.
 *
 * 16 July 622 CE (proleptic Julian). The alternative "astronomical" epoch is one day earlier; both
 * are in use, and choosing one and stating it is the only way the two directions of this module
 * agree with each other.
 */
const HIJRI_EPOCH_JDN = 1948440;

/** Hijri date → Julian Day Number, tabular. */
export function hijriToJdn({ year, month, day }: CivilDate): number {
  return (
    day +
    Math.ceil(29.5 * (month - 1)) +
    (year - 1) * 354 +
    Math.floor((3 + 11 * year) / 30) +
    HIJRI_EPOCH_JDN -
    1
  );
}

/** Julian Day Number → Hijri date, tabular. Inverse of `hijriToJdn` over the app's range. */
export function jdnToHijri(jdn: number): CivilDate {
  const days = jdn - HIJRI_EPOCH_JDN;
  // 30-year cycle of 10631 days. The +1 lands day zero of a cycle in year 1 rather than year 0.
  const cycles = Math.floor(days / 10631);
  let remainder = days - cycles * 10631;
  let year = cycles * 30 + 1;

  // Walk forward a year at a time within the cycle. At most 30 iterations, and it avoids the
  // closed-form expression whose off-by-one behaviour at cycle boundaries is famously fiddly.
  for (;;) {
    const length = isHijriLeapYear(year) ? 355 : 354;
    if (remainder < length) {
      break;
    }
    remainder -= length;
    year += 1;
  }

  let month = 1;
  for (;;) {
    const length = hijriMonthLength(year, month);
    if (remainder < length || month === 12) {
      break;
    }
    remainder -= length;
    month += 1;
  }

  return { year, month, day: remainder + 1 };
}

/** The eleven leap years of the 30-year cycle. */
export function isHijriLeapYear(year: number): boolean {
  const position = ((year % 30) + 30) % 30;
  return [2, 5, 7, 10, 13, 16, 18, 21, 24, 26, 29].includes(position);
}

/** Odd months have 30 days, even months 29, and Dhul-Hijjah gains one in a leap year. */
export function hijriMonthLength(year: number, month: number): number {
  if (month === 12) {
    return isHijriLeapYear(year) ? 30 : 29;
  }
  return month % 2 === 1 ? 30 : 29;
}

/** The full domain object for a Gregorian day. Always `calculated` — see the note above. */
export function hijriDateFor(date: CivilDate): HijriDate {
  const { year, month, day } = jdnToHijri(gregorianToJdn(date));
  const monthName = hijriMonthName(month);
  return {
    day,
    month,
    monthName,
    year,
    formatted: `${day} ${monthName} ${year} AH`,
    basis: 'calculated',
  };
}

/** The Gregorian day a Hijri date falls on, calculated. */
export function gregorianDateFor(hijri: CivilDate): CivilDate {
  return jdnToGregorian(hijriToJdn(hijri));
}

/** Whole days from `from` to `to`, both Gregorian. Negative once `to` is past. */
export function daysBetween(from: CivilDate, to: CivilDate): number {
  return gregorianToJdn(to) - gregorianToJdn(from);
}

/** ISO `YYYY-MM-DD`, zero-padded. */
export function toIsoDate({ year, month, day }: CivilDate): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
