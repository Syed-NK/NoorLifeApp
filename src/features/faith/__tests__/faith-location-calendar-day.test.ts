import AsyncStorage from '@react-native-async-storage/async-storage';

import { resetPrayerLocationSnapshotForTest } from '../storage/faith-location';

import {
  civilDateForCalendarDay,
  daysInGregorianMonth,
  formattedHijriForCalendarDay,
  hijriForCalendarDay,
  locationCalendarDay,
  locationDayFor,
  LOCATION_DAY_MAX_AGE_MS,
  LOCATION_DAY_STALE_AFTER_MS,
  type LocationDay,
  type LocationDayResolution,
} from '../data/calendar-day';
import { gregorianToJdn, hijriDateFor } from '../data/hijri/hijri-calendar';
import type { LocationToday } from '../data/faith-calendar.repository';
import { createHijriCalendarRepository } from '../data/hijri/hijri-calendar.repository';
import type {
  HeadingReading,
  LocationFailure,
  LocationFix,
  LocationPermission,
  LocationPort,
} from '../data/location/location.port';
import { createAdhanPrayerTimesRepository } from '../data/prayer/adhan-prayer-times.repository';
import { timeZoneForCoordinate } from '../data/prayer/location-time-zone';
import type { Coordinate, DailyPrayerTimes, PrayerLocation } from '../data/prayer-times.repository';

/**
 * The calendar day a prayer result belongs to is the day **at the location**, and the Hijri date
 * beside it is that same day converted.
 *
 * ── The defect ──────────────────────────────────────────────────────────────
 * Prayer timestamps resolved their day through the location's IANA zone —
 * `zonedIsoDay(now, location.timeZone)` — while the Hijri date went through `civilDateOf(now())`,
 * which reads `getFullYear()`, `getMonth()` and `getDate()`: the *device's* calendar day. Whenever
 * the device and the prayer location sat on opposite sides of midnight, the card showed one day's
 * prayer times beside another day's Hijri date.
 *
 * A second instance sat upstream of it. The Prayer screen asked for
 * `getDailyTimes(location, todayIsoDate(), …)` and `todayIsoDate()` is device-local too, so the
 * *times themselves* were computed for the device's day while `getNextPrayer` — which already used
 * the location's — answered from another. One screen, three claims about which day it was.
 *
 * `getMonthlyTimes` carried a third: every one of its ~30 entries was stamped with `hijriToday()`,
 * so a month view showed one Hijri date repeated beside thirty different Gregorian ones.
 *
 * ── Why the previous suites could not catch any of it ───────────────────────
 * `faith-prayer-timezone.test.ts` proved the *timestamps* were stamped in the location's zone, which
 * they were. Nothing asserted that the **day selected** and the **Hijri date derived** came from the
 * same clock as each other, and every fixture injected `hijriFor: () => '25 Safar 1448 AH'` — a
 * constant, which cannot disagree with anything.
 *
 * ── How these cases stay machine-independent ────────────────────────────────
 * No assertion here reads the machine's zone. Where a case needs "the device is somewhere else",
 * the device's zone is modelled as a *named* IANA zone and compared against the location's, so the
 * two are provably on different calendar days whatever the runner is set to. Every instant is an
 * explicit UTC literal and every clock is injected, so nothing depends on when the suite runs.
 *
 * Each case below fails on the pre-correction implementation.
 */

const DUBAI: Coordinate = { latitude: 25.2048, longitude: 55.2708 };
const LOS_ANGELES: Coordinate = { latitude: 34.0522, longitude: -118.2437 };

const DUBAI_ZONE = 'Asia/Dubai';
const LA_ZONE = 'America/Los_Angeles';

const SETTINGS = {
  method: 'muslim-world-league' as const,
  asr: 'standard' as const,
  offsetsMinutes: {},
};

/**
 * A location, with its fix stamped at the instant the case is about.
 *
 * `resolvedAt` defaults to the instant under test rather than to the real clock: several cases run
 * at 2028, and a fix stamped "now" would be years old relative to them and would trip
 * `LOCATION_DAY_MAX_AGE_MS`. The freshness ceiling has its own cases; it should not silently decide
 * the outcome of the cross-midnight ones.
 */
function locationAt(coordinate: Coordinate, label: string, resolvedAt?: string): PrayerLocation {
  const timeZone = timeZoneForCoordinate(coordinate);
  if (timeZone === null) {
    throw new Error(`No IANA zone resolved for ${label}.`);
  }
  return {
    coordinate,
    label,
    timeZone,
    mode: 'device',
    resolvedAt: resolvedAt ?? new Date().toISOString(),
  };
}

function fakeLocationPort(): LocationPort {
  return {
    getPermission: async (): Promise<LocationPermission> => 'denied',
    requestPermission: async (): Promise<LocationPermission> => 'denied',
    // Nothing cached: these suites exercise the authoritative path only.
    getLastKnownPosition: async () => null,
    getCurrentPosition: async (): Promise<LocationFix | { readonly failure: LocationFailure }> => ({
      failure: 'permission-denied',
    }),
    describe: async () => null,
    search: async () => [],
    hasCompass: async () => false,
    watchHeading: async (_onReading: (reading: HeadingReading) => void) => () => undefined,
  };
}

/**
 * A repository whose clock is fixed and whose Hijri seam is the real one.
 *
 * The real seam matters: a fixture returning a constant is exactly what let the defect through, so
 * these cases wire `formattedHijriForCalendarDay` and let the arithmetic disagree if it can.
 */
function repositoryAt(instant: string) {
  return createAdhanPrayerTimesRepository({
    location: fakeLocationPort(),
    hijriFor: formattedHijriForCalendarDay,
    now: () => new Date(instant),
  });
}

function expectData<T>(result: { kind: string }): T {
  expect(result.kind).toBe('ok');
  return (result as unknown as { data: T }).data;
}

beforeEach(async () => {
  await AsyncStorage.clear();
  /*
    The store keeps the last record it read successfully, so an unreadable one does not blank a
    working screen mid-session. That snapshot is process-scoped, so clearing storage in a test has to
    clear it too — otherwise a deliberately corrupt record is "recovered" into a previous test's
    location. Test-only seam; nothing in production resets it.
  */
  resetPrayerLocationSnapshotForTest();
});

/**
 * Instants at which two named zones are on different calendar days.
 *
 * `deviceZone` is a *stand-in* for wherever the phone is set. Nothing reads the runner's own zone,
 * so these hold identically on a laptop in London and in a CI container on UTC.
 */
const CROSS_MIDNIGHT: readonly {
  readonly name: string;
  readonly instant: string;
  readonly deviceZone: string;
  readonly locationZone: string;
  readonly deviceDay: string;
  readonly locationDay: string;
}[] = [
  {
    name: 'device Dubai, location Los Angeles',
    instant: '2026-08-12T05:00:00Z',
    deviceZone: DUBAI_ZONE,
    locationZone: LA_ZONE,
    deviceDay: '2026-08-12',
    locationDay: '2026-08-11',
  },
  {
    name: 'device Los Angeles, location Dubai',
    instant: '2026-08-11T20:00:00Z',
    deviceZone: LA_ZONE,
    locationZone: DUBAI_ZONE,
    deviceDay: '2026-08-11',
    locationDay: '2026-08-12',
  },
  {
    name: 'UTC crossing eastward — location is already tomorrow',
    instant: '2026-08-11T23:30:00Z',
    deviceZone: 'UTC',
    locationZone: DUBAI_ZONE,
    deviceDay: '2026-08-11',
    locationDay: '2026-08-12',
  },
  {
    name: 'UTC crossing westward — location is still yesterday',
    instant: '2026-08-12T00:30:00Z',
    deviceZone: 'UTC',
    locationZone: LA_ZONE,
    deviceDay: '2026-08-12',
    locationDay: '2026-08-11',
  },
  {
    name: 'month boundary — location has rolled into September',
    instant: '2026-08-31T20:00:00Z',
    deviceZone: 'UTC',
    locationZone: DUBAI_ZONE,
    deviceDay: '2026-08-31',
    locationDay: '2026-09-01',
  },
  {
    name: 'year boundary — location has rolled into 2027',
    instant: '2026-12-31T20:00:00Z',
    deviceZone: 'UTC',
    locationZone: DUBAI_ZONE,
    deviceDay: '2026-12-31',
    locationDay: '2027-01-01',
  },
  {
    name: 'Gregorian leap day — location has rolled into 29 February',
    instant: '2028-02-28T20:00:00Z',
    deviceZone: 'UTC',
    locationZone: DUBAI_ZONE,
    deviceDay: '2028-02-28',
    locationDay: '2028-02-29',
  },
  {
    name: 'Gregorian leap day — location is still on 29 February',
    instant: '2028-03-01T00:30:00Z',
    deviceZone: 'UTC',
    locationZone: LA_ZONE,
    deviceDay: '2028-03-01',
    locationDay: '2028-02-29',
  },
];

describe('the location calendar day is read in the location’s zone', () => {
  it.each(CROSS_MIDNIGHT.map((c) => [c.name, c] as const))(
    '%s',
    (_name, { instant, deviceZone, locationZone, deviceDay, locationDay }) => {
      const at = new Date(instant);

      // The premise: at this instant the two zones genuinely are on different days.
      expect(locationCalendarDay(at, deviceZone)).toBe(deviceDay);
      expect(locationCalendarDay(at, locationZone)).toBe(locationDay);
      expect(deviceDay).not.toBe(locationDay);
    },
  );

  /**
   * The transition from an instant to a day happens once, and returns `null` rather than the device.
   *
   * A zone the platform cannot resolve is an error everywhere on the prayer path. The one sanctioned
   * device fallback is `civilDateAtZoneOrDevice`, and it is reached only when there is no zone at
   * all — see its own case below.
   */
  it('answers null for an unresolvable zone rather than falling back to the device', () => {
    expect(locationCalendarDay(new Date('2026-08-12T05:00:00Z'), 'Not/AZone')).toBeNull();
    expect(locationCalendarDay(new Date(Number.NaN), DUBAI_ZONE)).toBeNull();
  });
});

describe('immediately before and after midnight at the location', () => {
  /** Midnight on 12 August in Dubai (+04) is 2026-08-11T20:00:00Z. */
  it('is still the 11th one second before', () => {
    expect(locationCalendarDay(new Date('2026-08-11T19:59:59Z'), DUBAI_ZONE)).toBe('2026-08-11');
  });

  it('is the 12th at the stroke of midnight', () => {
    expect(locationCalendarDay(new Date('2026-08-11T20:00:00Z'), DUBAI_ZONE)).toBe('2026-08-12');
  });

  it('carries the Hijri date across with it, in the same step', () => {
    const before = locationCalendarDay(new Date('2026-08-11T19:59:59Z'), DUBAI_ZONE) ?? '';
    const after = locationCalendarDay(new Date('2026-08-11T20:00:00Z'), DUBAI_ZONE) ?? '';

    const hijriBefore = hijriForCalendarDay(before);
    const hijriAfter = hijriForCalendarDay(after);
    expect(hijriBefore).not.toBeNull();
    expect(hijriAfter).not.toBeNull();

    // Exactly one Hijri day apart — the Gregorian and Hijri boundaries move together.
    expect(
      gregorianToJdn({ year: 2026, month: 8, day: 12 }) -
        gregorianToJdn({ year: 2026, month: 8, day: 11 }),
    ).toBe(1);
    expect(hijriAfter?.formatted).not.toBe(hijriBefore?.formatted);
  });

  /**
   * The repository's own "today" moves at the location's midnight, not the device's.
   *
   * This is the assertion the old implementation could not satisfy: `locationCalendarDay` on the
   * repository reads the injected clock through the location's zone, so the flip happens at
   * 20:00Z for Dubai regardless of where the runner is.
   */
  it('flips the repository’s day at the location’s midnight', () => {
    const dubai = locationAt(DUBAI, 'Dubai');
    expect(repositoryAt('2026-08-11T19:59:59Z').locationCalendarDay(dubai)).toBe('2026-08-11');
    expect(repositoryAt('2026-08-11T20:00:00Z').locationCalendarDay(dubai)).toBe('2026-08-12');
  });
});

describe('the Hijri date is derived from the calendar day, never from a Date', () => {
  it('converts the day it is given, not today', () => {
    expect(hijriForCalendarDay('2026-08-12')?.formatted).toBe(
      hijriDateFor({ year: 2026, month: 8, day: 12 }).formatted,
    );
    expect(hijriForCalendarDay('2027-01-01')?.formatted).toBe(
      hijriDateFor({ year: 2027, month: 1, day: 1 }).formatted,
    );
    expect(hijriForCalendarDay('2026-08-12')?.formatted).not.toBe(
      hijriForCalendarDay('2027-01-01')?.formatted,
    );
  });

  /** The tabular/calculated disclosure survives the correction untouched. */
  it('keeps every date marked calculated and never claims a sighting', () => {
    for (const day of ['2026-08-12', '2027-01-01', '2028-02-29']) {
      expect(hijriForCalendarDay(day)?.basis).toBe('calculated');
    }
  });

  it('rejects a day that is not a date rather than normalising it', () => {
    expect(civilDateForCalendarDay('2026-02-31')).toBeNull();
    expect(civilDateForCalendarDay('2026-13-01')).toBeNull();
    expect(civilDateForCalendarDay('tomorrow')).toBeNull();
    // A real leap day is accepted; the same day in a non-leap year is not.
    expect(civilDateForCalendarDay('2028-02-29')).toEqual({ year: 2028, month: 2, day: 29 });
    expect(civilDateForCalendarDay('2027-02-29')).toBeNull();
  });

  it('renders an unparseable day as absent rather than inventing one', () => {
    expect(formattedHijriForCalendarDay('nonsense')).toBe('');
  });
});

describe('a day’s prayer times and its Hijri date always name the same day', () => {
  it.each(CROSS_MIDNIGHT.map((c) => [c.name, c] as const))(
    '%s — the card agrees with the calculation',
    async (_name, { instant, locationZone, deviceDay, locationDay }) => {
      const location = locationAt(locationZone === DUBAI_ZONE ? DUBAI : LOS_ANGELES, locationZone);
      expect(location.timeZone).toBe(locationZone);

      const repository = repositoryAt(instant);
      const day = repository.locationCalendarDay(location);
      expect(day).toBe(locationDay);

      const result = await repository.getDailyTimes(location, day as string, SETTINGS);
      const data = expectData<DailyPrayerTimes>(result);

      // The times are for the location's day…
      expect(data.date).toBe(locationDay);
      // …and so is the Hijri date printed beside them.
      expect(data.hijriDate).toBe(hijriForCalendarDay(locationDay)?.formatted);
      // The specific defect: it is *not* the device day's Hijri date.
      expect(data.hijriDate).not.toBe(hijriForCalendarDay(deviceDay)?.formatted);
    },
  );

  it('gives tomorrow’s Fajr tomorrow’s Hijri date after Isha', async () => {
    // 15:00Z on 11 August is 19:00 in Dubai — after Isha, so the next prayer rolls to the 12th.
    const repository = repositoryAt('2026-08-11T19:00:00Z');
    const dubai = locationAt(DUBAI, 'Dubai');
    const today = repository.locationCalendarDay(dubai);
    expect(today).toBe('2026-08-11');

    const tomorrow = await repository.getDailyTimes(dubai, '2026-08-12', SETTINGS);
    const data = expectData<DailyPrayerTimes>(tomorrow);
    expect(data.hijriDate).toBe(hijriForCalendarDay('2026-08-12')?.formatted);
    expect(data.hijriDate).not.toBe(hijriForCalendarDay('2026-08-11')?.formatted);
  });
});

describe('monthly results calculate every day’s Hijri date independently', () => {
  /**
   * The two DST months are here on purpose.
   *
   * A month containing a transition has one day of 23 hours and one of 25. Any implementation that
   * stepped the calendar by adding 86,400,000 ms would repeat or skip a day inside them, and the
   * consecutive-JDN assertion below is what would catch it.
   */
  it.each([
    ['August 2026, Dubai — no transition', '2026-08', DUBAI, 31],
    ['March 2026, Los Angeles — DST spring transition', '2026-03', LOS_ANGELES, 31],
    ['November 2026, Los Angeles — DST autumn transition', '2026-11', LOS_ANGELES, 30],
    ['February 2028, Dubai — Gregorian leap month', '2028-02', DUBAI, 29],
    ['December 2026, Dubai — year boundary', '2026-12', DUBAI, 31],
  ])('%s', async (_name, month, coordinate, expectedDays) => {
    const repository = repositoryAt('2026-08-12T05:00:00Z');
    const location = locationAt(coordinate, month);
    const result = await repository.getMonthlyTimes(location, month, SETTINGS);
    const days = expectData<readonly DailyPrayerTimes[]>(result);

    expect(days).toHaveLength(expectedDays);

    // Every Hijri date is distinct — the defect stamped all of them with today's.
    const hijriDates = days.map((day) => day.hijriDate);
    expect(new Set(hijriDates).size).toBe(expectedDays);

    // Each is the conversion of its *own* Gregorian day…
    for (const day of days) {
      expect(day.hijriDate).toBe(hijriForCalendarDay(day.date)?.formatted);
      expect(day.hijriDate).not.toBe('');
    }

    // …and the days advance one at a time, across the transition and the month end alike.
    const numbers = days.map((day) => {
      const civil = civilDateForCalendarDay(day.date);
      expect(civil).not.toBeNull();
      return gregorianToJdn(civil as { year: number; month: number; day: number });
    });
    for (let index = 1; index < numbers.length; index += 1) {
      expect((numbers[index] as number) - (numbers[index - 1] as number)).toBe(1);
    }
  });

  /**
   * The regression in its plainest form.
   *
   * Before the correction every entry carried the same string. One assertion, and it is the one that
   * would have failed.
   */
  it('does not repeat one Hijri date across the whole month', async () => {
    const repository = repositoryAt('2026-08-12T05:00:00Z');
    const result = await repository.getMonthlyTimes(
      locationAt(DUBAI, 'Dubai'),
      '2026-08',
      SETTINGS,
    );
    const days = expectData<readonly DailyPrayerTimes[]>(result);

    expect(new Set(days.map((day) => day.hijriDate)).size).toBeGreaterThan(1);
    expect(new Set(days.map((day) => day.hijriDate)).size).toBe(days.length);
  });
});

describe('month length is arithmetic, not a device-local Date', () => {
  it.each([
    [2026, 1, 31],
    [2026, 2, 28],
    [2028, 2, 29],
    [2000, 2, 29],
    [1900, 2, 28],
    [2026, 4, 30],
    [2026, 12, 31],
  ])('%i-%i has %i days', (year, month, expected) => {
    expect(daysInGregorianMonth(year, month)).toBe(expected);
  });

  /**
   * December has to roll the year, which is the case the old trick got for free and this one has to
   * state. `new Date(y, 12, 0)` normalised the overflow itself; `gregorianToJdn` does not.
   */
  it('rolls into the following year for December', () => {
    expect(daysInGregorianMonth(2026, 12)).toBe(31);
    expect(daysInGregorianMonth(2026, 12)).toBe(daysInGregorianMonth(2027, 12));
  });
});

describe('DST transitions do not move the calendar day', () => {
  /** US spring forward 2026 is 02:00 → 03:00 on 8 March. Midnight is untouched. */
  it('keeps both sides of the spring transition on the same day', () => {
    expect(locationCalendarDay(new Date('2026-03-08T09:59:00Z'), LA_ZONE)).toBe('2026-03-08');
    expect(locationCalendarDay(new Date('2026-03-08T10:00:00Z'), LA_ZONE)).toBe('2026-03-08');
  });

  /** US fall back 2026 is 02:00 → 01:00 on 1 November: 01:59 occurs twice, both on the 1st. */
  it('keeps both passes of the repeated autumn hour on the same day', () => {
    expect(locationCalendarDay(new Date('2026-11-01T08:59:00Z'), LA_ZONE)).toBe('2026-11-01');
    expect(locationCalendarDay(new Date('2026-11-01T09:00:00Z'), LA_ZONE)).toBe('2026-11-01');
  });

  it('gives both sides of each transition the same Hijri date', () => {
    for (const [before, after] of [
      ['2026-03-08T09:59:00Z', '2026-03-08T10:00:00Z'],
      ['2026-11-01T08:59:00Z', '2026-11-01T09:00:00Z'],
    ]) {
      const dayBefore = locationCalendarDay(new Date(before as string), LA_ZONE) ?? '';
      const dayAfter = locationCalendarDay(new Date(after as string), LA_ZONE) ?? '';
      expect(dayAfter).toBe(dayBefore);
      expect(formattedHijriForCalendarDay(dayAfter)).toBe(formattedHijriForCalendarDay(dayBefore));
    }
  });
});

/**
 * There is no device-day fallback anywhere on the location-scoped path.
 *
 * ── What was here before, and why it was withdrawn ──────────────────────────
 * `createLocationDayResolver` returned `() => CivilDate` — a *total* function, which therefore had
 * to return something before the asynchronous location lookup landed. What it returned was the
 * device's calendar day. Around midnight that briefly rendered one location's prayer times beside
 * another location's Hijri date, with nothing on screen to say the date was provisional.
 *
 * The type is what fixed it. `locationDayFor` returns a union in which "I cannot say" is a member,
 * so there is no branch that has to invent a value to satisfy a signature.
 */
describe('an unresolved location yields a state, never a date', () => {
  const AT = new Date('2026-08-12T05:00:00Z');

  it('reports zone-unresolved rather than substituting the device day', () => {
    const resolution = locationDayFor(
      { timeZone: 'Not/AZone', mode: 'device', resolvedAt: AT.toISOString() },
      AT,
    );
    expect(resolution.status).toBe('zone-unresolved');
    // The exhaustive check: there is no `value` to read, so no caller can print one.
    expect('value' in resolution).toBe(false);
  });

  it('has no member of the result type that carries a device-derived day', () => {
    /*
      Every reachable status, enumerated. A future variant that quietly meant "device day" would have
      to be added here to compile, which is the point of listing them.
    */
    const statuses: readonly LocationDayResolution['status'][] = [
      'resolved',
      'zone-unresolved',
      'expired',
    ];
    expect(statuses).toHaveLength(3);
  });
});

describe('a cached location provides an immediate, correct location day', () => {
  it('derives the day from the stored zone with no further lookup', () => {
    const at = new Date('2026-08-12T05:00:00Z');
    const resolution = locationDayFor(
      // A location as `resolveCurrentLocation` returns it when read back from storage.
      { timeZone: LA_ZONE, mode: 'device', resolvedAt: '2026-08-12T04:00:00Z' },
      at,
    );

    expect(resolution.status).toBe('resolved');
    const value = (resolution as { value: LocationDay }).value;
    expect(value.day).toBe('2026-08-11');
    expect(value.timeZone).toBe(LA_ZONE);
    expect(value.provenance).toBe('device-fix');
    expect(value.stale).toBe(false);
    expect(value.ageMs).toBe(60 * 60 * 1000);
  });

  it('records a user-selected place as such', () => {
    const at = new Date('2026-08-12T05:00:00Z');
    const resolution = locationDayFor(
      { timeZone: DUBAI_ZONE, mode: 'city', resolvedAt: at.toISOString() },
      at,
    );
    expect((resolution as { value: LocationDay }).value.provenance).toBe('user-selected');
  });

  /** Freshness is reported, not enforced — a day-old zone is still the right zone. */
  it('flags a fix older than the staleness threshold but still serves it', () => {
    const at = new Date('2026-08-12T05:00:00Z');
    const resolvedAt = new Date(at.getTime() - LOCATION_DAY_STALE_AFTER_MS - 1000).toISOString();
    const resolution = locationDayFor({ timeZone: LA_ZONE, mode: 'device', resolvedAt }, at);

    expect(resolution.status).toBe('resolved');
    expect((resolution as { value: LocationDay }).value.stale).toBe(true);
    expect((resolution as { value: LocationDay }).value.day).toBe('2026-08-11');
  });

  /** Beyond the ceiling the answer is an explicit absence, still never the device. */
  it('expires a fix past the maximum age rather than dating from it', () => {
    const at = new Date('2026-08-12T05:00:00Z');
    const resolvedAt = new Date(at.getTime() - LOCATION_DAY_MAX_AGE_MS - 1000).toISOString();
    const resolution = locationDayFor({ timeZone: LA_ZONE, mode: 'device', resolvedAt }, at);

    expect(resolution.status).toBe('expired');
    expect('value' in resolution).toBe(false);
  });

  /**
   * A corrupt stamp reads as "no stamp", not as "resolved just now".
   *
   * Treating an unparseable value as age zero would make the ceiling unenforceable by exactly the
   * input most likely to be wrong.
   */
  it('treats an unparseable resolvedAt as unknown age rather than as fresh', () => {
    const at = new Date('2026-08-12T05:00:00Z');
    const resolution = locationDayFor({ timeZone: LA_ZONE, mode: 'device', resolvedAt: 'x' }, at);
    const value = (resolution as { value: LocationDay }).value;
    expect(value.ageMs).toBeNull();
    expect(value.stale).toBe(false);
  });

  /** The day advances with the clock even though the zone is cached — no frozen date. */
  it('recomputes the day from now, not from when the location was resolved', () => {
    const cached = {
      timeZone: DUBAI_ZONE,
      mode: 'device',
      resolvedAt: '2026-08-11T10:00:00Z',
    } as const;
    const before = locationDayFor(cached, new Date('2026-08-11T19:59:59Z'));
    const after = locationDayFor(cached, new Date('2026-08-11T20:00:00Z'));

    expect((before as { value: LocationDay }).value.day).toBe('2026-08-11');
    expect((after as { value: LocationDay }).value.day).toBe('2026-08-12');
  });

  /** Changing location recomputes the day; nothing is memoised against the old zone. */
  it('recomputes when the location changes', () => {
    const at = new Date('2026-08-12T05:00:00Z');
    const stamp = at.toISOString();
    const inLa = locationDayFor({ timeZone: LA_ZONE, mode: 'device', resolvedAt: stamp }, at);
    const inDubai = locationDayFor({ timeZone: DUBAI_ZONE, mode: 'city', resolvedAt: stamp }, at);

    expect((inLa as { value: LocationDay }).value.day).toBe('2026-08-11');
    expect((inDubai as { value: LocationDay }).value.day).toBe('2026-08-12');
  });
});

describe('the Hijri calendar repository answers only from the location it is given', () => {
  const calendarAt = (instant: string) =>
    createHijriCalendarRepository({ now: () => new Date(instant) });

  it('reports the location day, not the device day', async () => {
    const today = expectData<LocationToday>(
      await calendarAt('2026-08-12T05:00:00Z').getLocationToday(locationAt(LOS_ANGELES, LA_ZONE)),
    );

    expect(today.gregorian).toBe('2026-08-11');
    expect(today.day).toBe('2026-08-11');
    expect(today.timeZone).toBe(LA_ZONE);
    expect(today.hijri.formatted).toBe(hijriForCalendarDay('2026-08-11')?.formatted);
    expect(today.hijri.formatted).not.toBe(hijriForCalendarDay('2026-08-12')?.formatted);
    // The disclosure survives the state-model change.
    expect(today.hijri.basis).toBe('calculated');
  });

  it('answers unavailable, not a date, when the zone will not resolve', async () => {
    const result = await calendarAt('2026-08-12T05:00:00Z').getLocationToday({
      ...locationAt(LOS_ANGELES, LA_ZONE),
      timeZone: 'Not/AZone',
    });

    expect(result.kind).toBe('error');
    expect(JSON.stringify(result)).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it('answers unavailable when the stored location is past the age ceiling', async () => {
    const at = '2026-08-12T05:00:00Z';
    const stale = new Date(Date.parse(at) - LOCATION_DAY_MAX_AGE_MS - 1000).toISOString();
    const result = await calendarAt(at).getLocationToday({
      ...locationAt(LOS_ANGELES, LA_ZONE),
      resolvedAt: stale,
    });

    expect(result.kind).toBe('error');
  });

  it('refuses an observance countdown it has no today for', async () => {
    const broken = { ...locationAt(DUBAI, DUBAI_ZONE), timeZone: 'Not/AZone' };
    expect((await calendarAt('2026-08-12T05:00:00Z').getNextObservance(broken)).kind).toBe('error');
    expect((await calendarAt('2026-08-12T05:00:00Z').listUpcomingObservances(broken, 3)).kind).toBe(
      'error',
    );
  });

  /**
   * Month browsing needs no location at all, so it keeps working when today does not.
   *
   * This is what makes the location-scoped choice affordable: the part of the Calendar screen that
   * is genuinely zone-free stays available even in the location-required state.
   */
  it('browses a month with no location involved', async () => {
    const month = expectData<{ days: readonly { readonly gregorian: string }[] }>(
      await calendarAt('2026-08-12T05:00:00Z').getMonth(1448, 2),
    );
    expect(month.days.length).toBeGreaterThan(28);
  });
});

/**
 * Faith Home and the Prayer screen cannot temporarily disagree.
 *
 * Both derive from a single `PrayerLocation`. These cases assert that at every cross-midnight
 * instant — including at the boundary itself — the prayer day and the Hijri day are the same day.
 */
describe('Faith Home and Prayer Times always name the same day', () => {
  it.each(CROSS_MIDNIGHT.map((c) => [c.name, c] as const))(
    '%s',
    async (_name, { instant, locationZone, locationDay }) => {
      const location = locationAt(
        locationZone === DUBAI_ZONE ? DUBAI : LOS_ANGELES,
        locationZone,
        instant,
      );

      const prayerDay = repositoryAt(instant).locationCalendarDay(location);
      const today = expectData<LocationToday>(
        await createHijriCalendarRepository({ now: () => new Date(instant) }).getLocationToday(
          location,
        ),
      );

      expect(prayerDay).toBe(locationDay);
      expect(today.day).toBe(prayerDay);
      expect(today.hijri.formatted).toBe(formattedHijriForCalendarDay(prayerDay as string));
    },
  );

  /**
   * Crossing midnight *during* resolution cannot expose a mismatch.
   *
   * The old resolver could: the device day was served first and the location day replaced it later,
   * so a midnight crossing between the two renders showed two different dates. Now both values come
   * from one location and one clock read, so the only two possible outcomes are "both before" and
   * "both after" — never one of each.
   */
  it('cannot straddle midnight between the two values', async () => {
    for (const instant of [
      '2026-08-11T19:59:59Z',
      '2026-08-11T19:59:59.999Z',
      '2026-08-11T20:00:00Z',
      '2026-08-11T20:00:00.001Z',
    ]) {
      const location = locationAt(DUBAI, DUBAI_ZONE, instant);
      const prayerDay = repositoryAt(instant).locationCalendarDay(location);
      const today = expectData<LocationToday>(
        await createHijriCalendarRepository({ now: () => new Date(instant) }).getLocationToday(
          location,
        ),
      );
      expect(today.day).toBe(prayerDay);
    }
  });
});
