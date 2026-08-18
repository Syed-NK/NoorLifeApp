import {
  civilDateOf,
  daysBetween,
  gregorianDateFor,
  gregorianToJdn,
  hijriDateFor,
  hijriMonthLength,
  hijriMonthName,
  hijriToJdn,
  isHijriLeapYear,
  jdnToGregorian,
  jdnToHijri,
  toIsoDate,
  type CivilDate,
} from '../data/hijri/hijri-calendar';
import {
  nextObservance,
  observancesAround,
  upcomingObservances,
} from '../data/hijri/hijri-observances';

/**
 * The Hijri conversion, and the observances derived from it.
 *
 * ── What these tests can and cannot assert ──────────────────────────────────
 * They assert that the *calculation* is correct and self-consistent. They deliberately do not assert
 * that a computed date matches what a given country announced, because that is a moon sighting and
 * this is arithmetic — the two legitimately differ by a day, which is the whole reason every date
 * this module produces is stamped `calculated`.
 *
 * The anchors below are chosen where the tabular calendar and the widely-published date agree, so a
 * failure means the algorithm drifted rather than that the moon did something.
 */

describe('Julian Day Number conversion', () => {
  it('round-trips every Gregorian day across the app’s lifetime', () => {
    const start = gregorianToJdn({ year: 2000, month: 1, day: 1 });
    const end = gregorianToJdn({ year: 2050, month: 1, day: 1 });

    for (let jdn = start; jdn <= end; jdn += 1) {
      expect(gregorianToJdn(jdnToGregorian(jdn))).toBe(jdn);
    }
  });

  it('handles the three centuries whose leap rules disagree', () => {
    // Swept rather than exhaustive elsewhere: 1900 and 2100 are common years, 2000 is a leap year,
    // and a conversion that gets the 400-year rule wrong fails only here.
    expect(jdnToGregorian(gregorianToJdn({ year: 1900, month: 2, day: 28 }))).toEqual({
      year: 1900,
      month: 2,
      day: 28,
    });
    expect(jdnToGregorian(gregorianToJdn({ year: 1900, month: 3, day: 1 }))).toEqual({
      year: 1900,
      month: 3,
      day: 1,
    });
    expect(
      gregorianToJdn({ year: 1900, month: 3, day: 1 }) -
        gregorianToJdn({ year: 1900, month: 2, day: 28 }),
    ).toBe(1);
    expect(
      gregorianToJdn({ year: 2000, month: 3, day: 1 }) -
        gregorianToJdn({ year: 2000, month: 2, day: 28 }),
    ).toBe(2);
    expect(
      gregorianToJdn({ year: 2100, month: 3, day: 1 }) -
        gregorianToJdn({ year: 2100, month: 2, day: 28 }),
    ).toBe(1);
  });

  it('places a known Julian Day Number on the right Gregorian date', () => {
    // JDN 2451545 is the J2000.0 epoch, 1 January 2000.
    expect(jdnToGregorian(2451545)).toEqual({ year: 2000, month: 1, day: 1 });
  });
});

describe('Hijri conversion', () => {
  it('round-trips every Hijri day from the epoch to well past the present', () => {
    const start = hijriToJdn({ year: 1, month: 1, day: 1 });
    const end = hijriToJdn({ year: 1500, month: 12, day: 29 });

    let mismatches = 0;
    for (let jdn = start; jdn <= end; jdn += 1) {
      if (hijriToJdn(jdnToHijri(jdn)) !== jdn) {
        mismatches += 1;
      }
    }
    expect(mismatches).toBe(0);
  });

  it('converts the date the design reference carried, which was previously hard-coded', () => {
    // The Faith home used to render this string on every device on every day. It is now computed,
    // and the computation agrees with the reference — which is the evidence that removing the
    // literal lost no accuracy.
    expect(hijriDateFor({ year: 2025, month: 5, day: 19 })).toEqual({
      day: 21,
      month: 11,
      monthName: 'Dhul-Qadah',
      year: 1446,
      formatted: '21 Dhul-Qadah 1446 AH',
      basis: 'calculated',
    });
  });

  it('places 1 Ramadan 1445 on 11 March 2024', () => {
    expect(gregorianDateFor({ year: 1445, month: 9, day: 1 })).toEqual({
      year: 2024,
      month: 3,
      day: 11,
    });
  });

  it('never reports a sighting it has no authority to confirm', () => {
    const sampled: readonly CivilDate[] = [
      { year: 2024, month: 1, day: 1 },
      { year: 2025, month: 6, day: 15 },
      { year: 2026, month: 8, day: 10 },
      { year: 2030, month: 12, day: 31 },
    ];
    for (const date of sampled) {
      expect(hijriDateFor(date).basis).toBe('calculated');
    }
  });

  it('produces a day within the month it reports', () => {
    const start = gregorianToJdn({ year: 2024, month: 1, day: 1 });
    const end = gregorianToJdn({ year: 2034, month: 1, day: 1 });

    for (let jdn = start; jdn <= end; jdn += 1) {
      const hijri = jdnToHijri(jdn);
      expect(hijri.month).toBeGreaterThanOrEqual(1);
      expect(hijri.month).toBeLessThanOrEqual(12);
      expect(hijri.day).toBeGreaterThanOrEqual(1);
      expect(hijri.day).toBeLessThanOrEqual(hijriMonthLength(hijri.year, hijri.month));
    }
  });

  it('advances exactly one day for each day that passes', () => {
    // Catches a conversion that skips or repeats a date at a month or year boundary — the defect a
    // spot-check of a handful of dates would miss.
    const start = gregorianToJdn({ year: 2024, month: 1, day: 1 });
    let previous = jdnToHijri(start);

    for (let jdn = start + 1; jdn <= start + 3650; jdn += 1) {
      const current = jdnToHijri(jdn);
      const advancedWithinMonth =
        current.year === previous.year &&
        current.month === previous.month &&
        current.day === previous.day + 1;
      const rolledToNextMonth =
        current.day === 1 &&
        previous.day === hijriMonthLength(previous.year, previous.month) &&
        ((current.year === previous.year && current.month === previous.month + 1) ||
          (current.year === previous.year + 1 && current.month === 1 && previous.month === 12));

      expect(advancedWithinMonth || rolledToNextMonth).toBe(true);
      previous = current;
    }
  });

  it('gives a leap year 355 days and a common year 354', () => {
    for (let year = 1440; year <= 1470; year += 1) {
      const length =
        hijriToJdn({ year: year + 1, month: 1, day: 1 }) - hijriToJdn({ year, month: 1, day: 1 });
      expect(length).toBe(isHijriLeapYear(year) ? 355 : 354);
    }
  });

  it('names all twelve months and refuses anything else', () => {
    expect(hijriMonthName(1)).toBe('Muharram');
    expect(hijriMonthName(9)).toBe('Ramadan');
    expect(hijriMonthName(12)).toBe('Dhul-Hijjah');
    expect(() => hijriMonthName(0)).toThrow(RangeError);
    expect(() => hijriMonthName(13)).toThrow(RangeError);
  });
});

describe('civil date helpers', () => {
  it('reads the local calendar day from a Date', () => {
    expect(civilDateOf(new Date(2026, 7, 10, 23, 59))).toEqual({ year: 2026, month: 8, day: 10 });
  });

  it('measures whole days forward and backward', () => {
    expect(daysBetween({ year: 2026, month: 1, day: 1 }, { year: 2026, month: 1, day: 31 })).toBe(
      30,
    );
    expect(daysBetween({ year: 2026, month: 1, day: 31 }, { year: 2026, month: 1, day: 1 })).toBe(
      -30,
    );
    expect(daysBetween({ year: 2026, month: 3, day: 5 }, { year: 2026, month: 3, day: 5 })).toBe(0);
  });

  it('zero-pads an ISO date', () => {
    expect(toIsoDate({ year: 2026, month: 3, day: 5 })).toBe('2026-03-05');
  });
});

describe('observances', () => {
  /*
    A `CivilDate`, not a `Date`. These functions used to take an instant and read its calendar day
    with device-local getters, which made every observance date depend on the machine's timezone.
    They now take the day itself — resolved at the location by `data/calendar-day.ts` — so this
    fixture is three integers and the suite is zone-independent by construction.
  */
  const today: CivilDate = { year: 2026, month: 8, day: 10 };

  it('dates every observance from the calculation rather than a stored string', () => {
    for (const observance of observancesAround(today)) {
      expect(observance.hijri.basis).toBe('calculated');
      expect(observance.gregorian).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      // The Hijri date it claims must convert back to the Gregorian date it claims.
      const [year, month, day] = observance.gregorian.split('-').map(Number) as [
        number,
        number,
        number,
      ];
      expect(hijriDateFor({ year, month, day })).toMatchObject({
        day: observance.hijri.day,
        month: observance.hijri.month,
        year: observance.hijri.year,
      });
    }
  });

  it('measures daysUntil against the day it was asked about', () => {
    for (const observance of observancesAround(today)) {
      const [year, month, day] = observance.gregorian.split('-').map(Number) as [
        number,
        number,
        number,
      ];
      expect(observance.daysUntil).toBe(daysBetween(today, { year, month, day }));
    }
  });

  it('returns upcoming observances soonest first and excludes past ones', () => {
    const upcoming = upcomingObservances(today);
    expect(upcoming.length).toBeGreaterThan(0);
    for (const observance of upcoming) {
      expect(observance.daysUntil).toBeGreaterThanOrEqual(0);
    }
    const days = upcoming.map((observance) => observance.daysUntil);
    expect([...days].sort((a, b) => a - b)).toEqual(days);
  });

  it('keeps an observance on the day it falls rather than dropping it at midnight', () => {
    const ramadanStart = observancesAround(today).find((item) => item.id.startsWith('ramadan-'));
    expect(ramadanStart).toBeDefined();
    const [year, month, day] = (ramadanStart as { gregorian: string }).gregorian
      .split('-')
      .map(Number) as [number, number, number];

    const onTheDay = upcomingObservances({ year, month, day });
    expect(onTheDay[0]?.daysUntil).toBe(0);
  });

  it('always has a next observance, including at the end of a Hijri year', () => {
    // Sampled across a full solar year so the year-boundary case — where the answer lives in the
    // following Hijri year — is actually exercised rather than assumed.
    for (let offset = 0; offset < 366; offset += 7) {
      const date = jdnToGregorian(gregorianToJdn({ year: 2026, month: 1, day: 1 }) + offset);
      const next = nextObservance(date);
      expect(next).not.toBeNull();
      expect((next as { daysUntil: number }).daysUntil).toBeGreaterThanOrEqual(0);
    }
  });

  it('takes no position on observances whose observance is itself disputed', () => {
    const ids = observancesAround(today).map((item) => item.id);
    expect(ids.some((id) => id.startsWith('mawlid'))).toBe(false);
    // Nor does it name a night nobody can know.
    expect(ids.some((id) => id.includes('qadr'))).toBe(false);
  });
});
