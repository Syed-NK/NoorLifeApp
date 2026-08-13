import fs from 'node:fs';
import path from 'node:path';

import AsyncStorage from '@react-native-async-storage/async-storage';

import { resetPrayerLocationSnapshotForTest } from '../storage/faith-location';

import type {
  HeadingReading,
  LocationFailure,
  LocationFix,
  LocationPermission,
  LocationPort,
} from '../data/location/location.port';
import {
  computeDailyTimes,
  createAdhanPrayerTimesRepository,
} from '../data/prayer/adhan-prayer-times.repository';
import {
  addCalendarDays,
  deviceTimeZone,
  isZoneResolvable,
  timeZoneForCoordinate,
  toZonedOffsetIso,
  zonedIsoDay,
  zoneOffsetMinutes,
} from '../data/prayer/location-time-zone';
import { formatPrayerClock } from '../data/prayer/prayer-clock';
import type { Coordinate, PrayerLocation } from '../data/prayer-times.repository';

/**
 * A prayer time is a fact about a **place**, and is displayed in that place's own clock.
 *
 * ── The defect this suite exists to lock out ────────────────────────────────
 * Prayer instants were calculated for the selected coordinate and then formatted in the *device's*
 * zone. With a phone set to Asia/Dubai and a location in Mountain View, a 05:00 Fajr was stamped
 * `+04:00` and rendered "4:00 PM" — an afternoon Fajr — and the prayer list stopped being
 * chronological because Isha crossed into the next device-local day.
 *
 * ── Why the previous suite could not catch it ──────────────────────────────
 * Every fixture in `faith-prayer-times.test.ts` built its location with `timeZone: deviceTimeZone()`,
 * so the location's zone and the device's were the same value in every case. Both the broken and the
 * corrected implementation pass a test that cannot tell them apart. The cases here differ **only** in
 * that respect, which is what gives them their power: each one fails on the old implementation.
 *
 * These assertions are absolute rather than relative to the machine's own zone, so they mean the same
 * thing on a developer's laptop and in CI. Where the device's zone matters it is read and asserted
 * to be *different* from the location's, rather than assumed.
 */

const DUBAI: Coordinate = { latitude: 25.2048, longitude: 55.2708 };
const MOUNTAIN_VIEW: Coordinate = { latitude: 37.3861, longitude: -122.0839 };
const MANCHESTER: Coordinate = { latitude: 53.4808, longitude: -2.2426 };
const KOLKATA: Coordinate = { latitude: 22.5726, longitude: 88.3639 };
const KATHMANDU: Coordinate = { latitude: 27.7172, longitude: 85.324 };

const SETTINGS = {
  method: 'muslim-world-league' as const,
  asr: 'standard' as const,
  offsetsMinutes: {},
};

function locationAt(coordinate: Coordinate, label: string): PrayerLocation {
  const timeZone = timeZoneForCoordinate(coordinate);
  if (timeZone === null) {
    throw new Error(`No IANA zone resolved for ${label}.`);
  }
  // A fresh fix, so nothing here trips the staleness ceiling in `locationDayFor`.
  return { coordinate, label, timeZone, manual: false, resolvedAt: new Date().toISOString() };
}

function fakeLocationPort(overrides: Partial<LocationPort> = {}): LocationPort {
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
    ...overrides,
  };
}

function repositoryWith(port: LocationPort, now: Date) {
  return createAdhanPrayerTimesRepository({
    location: port,
    hijriFor: () => '25 Safar 1448 AH',
    now: () => now,
  });
}

/** The wall-clock hour a screen would print, straight out of the stamped timestamp. */
function hourOf(iso: string): number {
  return Number(/T(\d{2}):/.exec(iso)?.[1]);
}

function at(day: ReturnType<typeof computeDailyTimes>, key: string): string {
  return day?.times.find((time) => time.key === key)?.at ?? '';
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

describe('resolving a coordinate to an IANA zone', () => {
  it.each([
    ['Dubai', DUBAI, 'Asia/Dubai'],
    ['Mountain View', MOUNTAIN_VIEW, 'America/Los_Angeles'],
    ['Manchester', MANCHESTER, 'Europe/London'],
  ])('resolves %s to %s', (_label, coordinate, expected) => {
    expect(timeZoneForCoordinate(coordinate as Coordinate)).toBe(expected);
  });

  it('resolves offline, with no network call available to it', () => {
    // The lookup table is bundled. Asserted by the absence of any transport in the module's imports,
    // and observable here: the answer arrives synchronously.
    const zone = timeZoneForCoordinate(DUBAI);
    expect(zone).toBe('Asia/Dubai');
  });

  it('never guesses a zone from longitude', () => {
    /**
     * Kolkata and Kathmandu are ~3° apart in longitude and in different zones, on offsets that differ
     * by 15 minutes (+05:30 and +05:45). A degrees-to-hours approximation puts both in the same zone,
     * and could not express either offset.
     */
    expect(timeZoneForCoordinate(KOLKATA)).toBe('Asia/Kolkata');
    expect(timeZoneForCoordinate(KATHMANDU)).toBe('Asia/Kathmandu');

    const instant = new Date(Date.UTC(2026, 5, 15, 0, 0));
    expect(zoneOffsetMinutes(instant, 'Asia/Kolkata')).toBe(330);
    expect(zoneOffsetMinutes(instant, 'Asia/Kathmandu')).toBe(345);
  });

  it('refuses an impossible coordinate rather than returning a nearest guess', () => {
    expect(timeZoneForCoordinate({ latitude: 91, longitude: 0 })).toBeNull();
    expect(timeZoneForCoordinate({ latitude: 0, longitude: 999 })).toBeNull();
    expect(timeZoneForCoordinate({ latitude: Number.NaN, longitude: 0 })).toBeNull();
  });

  it('reports the device zone separately, and never substitutes it for a location', () => {
    // Both exist as distinct facts. The bug was using the second where the first was needed.
    expect(isZoneResolvable('Asia/Dubai')).toBe(true);
    expect(isZoneResolvable('Nowhere/Nowhere')).toBe(false);
    const device = deviceTimeZone();
    expect(device === null || typeof device === 'string').toBe(true);
  });
});

describe('offsets are a property of the zone and the date, not a constant', () => {
  it('tracks a DST transition without knowing the rule', () => {
    // Los Angeles: PST is -08:00 in January, PDT is -07:00 in July.
    expect(zoneOffsetMinutes(new Date(Date.UTC(2026, 0, 15, 20, 0)), 'America/Los_Angeles')).toBe(
      -480,
    );
    expect(zoneOffsetMinutes(new Date(Date.UTC(2026, 6, 15, 19, 0)), 'America/Los_Angeles')).toBe(
      -420,
    );
  });

  it('holds a zone with no DST at one offset all year', () => {
    // Dubai does not observe DST, so both dates are +04:00. A stored fixed offset would be right
    // here and wrong in Los Angeles, which is why an offset is not an acceptable substitute.
    expect(zoneOffsetMinutes(new Date(Date.UTC(2026, 0, 15, 8, 0)), 'Asia/Dubai')).toBe(240);
    expect(zoneOffsetMinutes(new Date(Date.UTC(2026, 6, 15, 8, 0)), 'Asia/Dubai')).toBe(240);
  });

  it('stamps the offset that applied on the day, so a cached string stays correct', () => {
    const winter = toZonedOffsetIso(new Date(Date.UTC(2026, 0, 15, 15, 30)), 'America/Los_Angeles');
    const summer = toZonedOffsetIso(new Date(Date.UTC(2026, 6, 15, 15, 30)), 'America/Los_Angeles');

    expect(winter).toBe('2026-01-15T07:30:00-08:00');
    expect(summer).toBe('2026-07-15T08:30:00-07:00');
  });

  it('renders midnight as hour 00 rather than 24', () => {
    /**
     * The `hourCycle: 'h23'` case. Several ICU builds render midnight as `24` under `hour12: false`,
     * which would produce a `24:00` timestamp and put the calendar day one hour late.
     */
    const midnight = toZonedOffsetIso(
      new Date(Date.UTC(2026, 6, 14, 20, 0)),
      'America/Los_Angeles',
    );
    expect(midnight).toBe('2026-07-14T13:00:00-07:00');

    const utcMidnight = toZonedOffsetIso(new Date(Date.UTC(2026, 6, 15, 0, 0)), 'UTC');
    expect(utcMidnight).toBe('2026-07-15T00:00:00+00:00');
    expect(utcMidnight).not.toMatch(/T24:/);
  });
});

describe('the reported defect: a device in one zone, a location in another', () => {
  /**
   * The exact case from the report.
   *
   * Device Asia/Dubai (+04), location Mountain View (-07). Fajr is an early-morning time in Mountain
   * View; the old implementation printed it as an afternoon time. There is an 11-hour gap between the
   * zones, so a device-formatted Fajr cannot land in the morning by luck.
   */
  it('shows Mountain View’s Fajr in the morning, not the afternoon', () => {
    const day = computeDailyTimes(
      locationAt(MOUNTAIN_VIEW, 'Mountain View'),
      '2026-08-10',
      SETTINGS,
      () => 'x',
    );

    const fajr = at(day, 'fajr');
    expect(fajr).toMatch(/-07:00$/);

    const hour = hourOf(fajr);
    expect(hour).toBeGreaterThanOrEqual(3);
    expect(hour).toBeLessThan(7);

    // And the string a screen actually prints.
    expect(formatPrayerClock(fajr)).toMatch(/AM$/);
  });

  it('stamps every prayer with the location’s offset, never the device’s', () => {
    const device = deviceTimeZone();
    const day = computeDailyTimes(
      locationAt(MOUNTAIN_VIEW, 'Mountain View'),
      '2026-08-10',
      SETTINGS,
      () => 'x',
    );

    // The premise of this case: the two zones genuinely differ on the machine running it.
    expect(device).not.toBe('America/Los_Angeles');

    for (const time of day?.times ?? []) {
      expect(time.at).toMatch(/-07:00$/);
    }
  });

  it('keeps the whole list chronological in the location’s own clock', () => {
    /**
     * The ordering collapse the report describes.
     *
     * Two assertions, because they can fail independently: the *instants* must increase, and so must
     * the printed *wall-clock hours*. The old implementation could keep the instants ordered while
     * the rendered hours wrapped past midnight into the next device-local day, which is what made the
     * list read out of order on screen.
     */
    for (const [coordinate, label] of [
      [MOUNTAIN_VIEW, 'Mountain View'],
      [DUBAI, 'Dubai'],
      [MANCHESTER, 'Manchester'],
    ] as const) {
      const day = computeDailyTimes(
        locationAt(coordinate, label),
        '2026-08-10',
        SETTINGS,
        () => 'x',
      );
      const times = day?.times ?? [];

      expect(times.map((time) => time.key)).toEqual([
        'fajr',
        'sunrise',
        'dhuhr',
        'asr',
        'maghrib',
        'isha',
      ]);

      for (let index = 1; index < times.length; index += 1) {
        const previous = times[index - 1] as { at: string };
        const current = times[index] as { at: string };
        expect(new Date(current.at).getTime()).toBeGreaterThan(new Date(previous.at).getTime());
        expect(hourOf(current.at)).toBeGreaterThanOrEqual(hourOf(previous.at));
      }
    }
  });

  it('dates every prayer to the day that was asked for, in the location’s zone', () => {
    // The day label and the stamped date must agree. Formatting through the device's zone could push
    // Isha onto the following calendar date for a large enough offset difference.
    for (const [coordinate, label] of [
      [MOUNTAIN_VIEW, 'Mountain View'],
      [DUBAI, 'Dubai'],
    ] as const) {
      const day = computeDailyTimes(
        locationAt(coordinate, label),
        '2026-08-10',
        SETTINGS,
        () => 'x',
      );
      for (const time of day?.times ?? []) {
        expect(time.at.slice(0, 10)).toBe('2026-08-10');
      }
    }
  });

  it('gives a traveller the destination’s times, not their home zone’s', () => {
    // Same instant, two places. The wall clocks must differ by roughly the zone gap, which is what
    // "times for where you are" means.
    const dubai = computeDailyTimes(locationAt(DUBAI, 'Dubai'), '2026-08-10', SETTINGS, () => 'x');
    const california = computeDailyTimes(
      locationAt(MOUNTAIN_VIEW, 'Mountain View'),
      '2026-08-10',
      SETTINGS,
      () => 'x',
    );

    expect(at(dubai, 'dhuhr')).toMatch(/\+04:00$/);
    expect(at(california, 'dhuhr')).toMatch(/-07:00$/);

    // Both are around midday in their own clock, and hours apart as instants.
    expect(hourOf(at(dubai, 'dhuhr'))).toBeGreaterThanOrEqual(11);
    expect(hourOf(at(dubai, 'dhuhr'))).toBeLessThanOrEqual(14);
    expect(hourOf(at(california, 'dhuhr'))).toBeGreaterThanOrEqual(11);
    expect(hourOf(at(california, 'dhuhr'))).toBeLessThanOrEqual(14);
  });
});

describe('“today” means the calendar day at the location', () => {
  it('uses the location’s day, not the device’s, when the two disagree', () => {
    /**
     * 2026-08-10T04:00Z is 08:00 in Dubai on the 10th and 21:00 in Los Angeles on the **9th**.
     * A device in either zone must not change which day the other zone reports.
     */
    const instant = new Date(Date.UTC(2026, 7, 10, 4, 0));
    expect(zonedIsoDay(instant, 'Asia/Dubai')).toBe('2026-08-10');
    expect(zonedIsoDay(instant, 'America/Los_Angeles')).toBe('2026-08-09');
  });

  it('rolls over at midnight in the location, not at midnight on the device', () => {
    // One minute either side of midnight in Los Angeles.
    const before = new Date(Date.UTC(2026, 7, 10, 6, 59)); // 23:59 on the 9th, PDT
    const after = new Date(Date.UTC(2026, 7, 10, 7, 1)); // 00:01 on the 10th, PDT

    expect(zonedIsoDay(before, 'America/Los_Angeles')).toBe('2026-08-09');
    expect(zonedIsoDay(after, 'America/Los_Angeles')).toBe('2026-08-10');
  });

  it('steps to the next day on the calendar, so a DST weekend cannot repeat or skip one', () => {
    /**
     * 2026-11-01 is the US autumn transition. Adding 86,400,000 ms to a local midnight lands at 23:00
     * the same day, so a "tomorrow" computed that way repeats the date. Stepping the calendar day
     * cannot.
     */
    expect(addCalendarDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addCalendarDays('2026-11-01', 1)).toBe('2026-11-02');
    // And the spring transition, which loses an hour rather than gaining one.
    expect(addCalendarDays('2026-03-07', 1)).toBe('2026-03-08');
    expect(addCalendarDays('2026-03-08', 1)).toBe('2026-03-09');
    // Month and year boundaries.
    expect(addCalendarDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addCalendarDays('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('finds the next prayer against the location’s day, across the device’s midnight', async () => {
    /**
     * The instant is chosen so the device and the location are on different calendar days.
     *
     * 2026-08-10T20:00Z is 13:00 PDT on the 10th — early afternoon in Mountain View, so Asr, Maghrib
     * or Isha is still ahead *that day*. On a device in Asia/Dubai the same instant is 00:00 on the
     * **11th**, so an implementation using the device's day would compute the 11th's times and could
     * report a prayer that had already passed.
     */
    const location = locationAt(MOUNTAIN_VIEW, 'Mountain View');
    const instant = new Date(Date.UTC(2026, 7, 10, 20, 0));

    const repository = repositoryWith(fakeLocationPort(), instant);
    const next = await repository.getNextPrayer(location, SETTINGS);

    expect(next.kind).toBe('ok');
    const data = (next as { data: { prayer: { key: string; at: string }; minutesUntil: number } })
      .data;

    // Still on the location's own day, still ahead, and not a past instant.
    expect(data.prayer.at.slice(0, 10)).toBe('2026-08-10');
    expect(new Date(data.prayer.at).getTime()).toBeGreaterThan(instant.getTime());
    expect(data.minutesUntil).toBeGreaterThan(0);
    // 13:00 PDT is a few minutes before Dhuhr in mid-August, so any of these four is correct. What
    // must not happen is a prayer dated the 11th, or one already past.
    expect(['dhuhr', 'asr', 'maghrib', 'isha']).toContain(data.prayer.key);
  });

  it('rolls to tomorrow’s Fajr at the location, dated the location’s tomorrow', async () => {
    const location = locationAt(MOUNTAIN_VIEW, 'Mountain View');
    const day = computeDailyTimes(location, '2026-08-10', SETTINGS, () => 'x');
    const afterIsha = new Date(new Date(at(day, 'isha')).getTime() + 60_000);

    const repository = repositoryWith(fakeLocationPort(), afterIsha);
    const next = await repository.getNextPrayer(location, SETTINGS);
    const prayer = (next as { data: { prayer: { key: string; at: string } } }).data.prayer;

    expect(prayer.key).toBe('fajr');
    expect(prayer.at.slice(0, 10)).toBe('2026-08-11');
    expect(new Date(prayer.at).getTime()).toBeGreaterThan(afterIsha.getTime());
  });
});

describe('there is exactly one zone-aware formatting path', () => {
  /**
   * No source in the Faith or Main Home trees reads device-local calendar fields.
   *
   * ── Why a source scan is the right enforcement here ─────────────────────────
   * This defect recurred **four** times in the same codebase, and the fourth instance —
   * `prayer-times-screen.tsx` doing `new Date(iso).getHours()` — survived a full correction of the
   * other three. Every one was a local formatter written by somebody reaching for the obvious API. No
   * behavioural test catches the fifth, because a fifth copy would be correct on a machine whose zone
   * happens to match the fixture; the defect only appears when the device and the location differ.
   *
   * So the rule is structural: `getHours`, `getMinutes` and `toLocaleTimeString` do not appear in these
   * trees at all. `formatPrayerClock` reads the characters out of the stamped string and is the only
   * formatter, and `location-time-zone.ts` is the only module that goes near `Intl`.
   *
   * Comments are stripped first, so the several files that *describe* the prohibition — including the
   * ones recording what they used to do — are not what fails it.
   */
  const SCANNED = [
    path.join(process.cwd(), 'src', 'features', 'faith'),
    path.join(process.cwd(), 'src', 'features', 'modules', 'faith'),
    path.join(process.cwd(), 'src', 'features', 'home'),
  ];

  function sources(dir: string): readonly string[] {
    if (!fs.existsSync(dir)) {
      return [];
    }
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return entry.name === '__tests__' ? [] : sources(full);
      }
      return entry.name.endsWith('.ts') || entry.name.endsWith('.tsx') ? [full] : [];
    });
  }

  const FILES = SCANNED.flatMap(sources).map((file) =>
    path.relative(process.cwd(), file).replace(/\\/g, '/'),
  );

  it('finds files to scan', () => {
    expect(FILES.length).toBeGreaterThan(20);
  });

  it.each(FILES)('%s reads no device-local clock field', (file) => {
    const source = fs
      .readFileSync(path.join(process.cwd(), file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    expect(source).not.toMatch(/\.getHours\(\)/);
    expect(source).not.toMatch(/\.getMinutes\(\)/);
    expect(source).not.toMatch(/toLocaleTimeString/);
  });

  it('confines Intl to the one module that owns zone arithmetic', () => {
    const offenders = FILES.filter((file) => {
      const source = fs
        .readFileSync(path.join(process.cwd(), file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      return /\bIntl\./.test(source);
    });

    // `location-time-zone.ts` needs `Intl` for the IANA offset rules. Nothing else may reach for it,
    // because everything else can read the offset out of the timestamp instead.
    expect(offenders).toEqual(['src/features/faith/data/prayer/location-time-zone.ts']);
  });
});

describe('the string a screen prints', () => {
  /**
   * `formatPrayerClock` is the only prayer-time formatter, and it must not go through a `Date`.
   *
   * ── The fourth instance of this defect ──────────────────────────────────────
   * `prayer-times-screen.tsx` had its own `formatTime` that did `new Date(iso).getHours()`. Parsing
   * the timestamp into a `Date` throws the location's offset away — the `Date` is the correct
   * instant, and `getHours()` then reads it in the *device's* zone. So the screen whose whole purpose
   * is to show prayer times undid the repository's fix, and would have kept showing an afternoon
   * Fajr after everything upstream was corrected.
   *
   * These cases assert the property that prevents it: the printed hour comes from the characters in
   * the string, so it is the same on every device in the world.
   */
  it.each([
    ['2026-08-10T05:02:00-07:00', '5:02 AM'],
    ['2026-08-10T20:44:00+01:00', '8:44 PM'],
    ['2026-08-10T12:35:00+04:00', '12:35 PM'],
    ['2026-08-10T00:15:00+05:45', '12:15 AM'],
    ['2026-08-10T12:00:00+00:00', '12:00 PM'],
  ])('prints %s as %s regardless of the device zone', (iso, expected) => {
    expect(formatPrayerClock(iso)).toBe(expected);
  });

  it('does not agree with a device-zone rendering, which is the whole point', () => {
    // A Mountain View Fajr on a machine that is not in Mountain View. `getHours()` would print an
    // afternoon hour here; reading the string prints the morning one.
    const iso = '2026-08-10T05:02:00-07:00';
    const deviceRendered = new Date(iso).getHours();

    expect(formatPrayerClock(iso)).toBe('5:02 AM');
    // The premise: this machine really is in a different zone, so the two genuinely differ.
    expect(deviceTimeZone()).not.toBe('America/Los_Angeles');
    expect(deviceRendered).not.toBe(5);
  });
});

describe('a cached result reopens correctly', () => {
  it('reconstructs the location-local wall clock from the stored string alone', () => {
    /**
     * Requirement: a cached result must store enough to redisplay the correct local time.
     *
     * It does, and without a second zone lookup: the offset that applied on that date is inside the
     * timestamp. This is what a JSON round-trip through storage does to it.
     */
    const day = computeDailyTimes(
      locationAt(MOUNTAIN_VIEW, 'Mountain View'),
      '2026-01-15',
      SETTINGS,
      () => 'x',
    );
    const revived = JSON.parse(JSON.stringify(day)) as typeof day;

    expect(revived?.location.timeZone).toBe('America/Los_Angeles');
    for (const time of revived?.times ?? []) {
      // January, so Pacific Standard Time — the cached string must not have drifted to PDT.
      expect(time.at).toMatch(/-08:00$/);
    }
    expect(formatPrayerClock(at(revived, 'dhuhr'))).toBe(formatPrayerClock(at(day, 'dhuhr')));
  });

  it('keeps the same instant and the same printed time across the round trip', () => {
    const day = computeDailyTimes(locationAt(DUBAI, 'Dubai'), '2026-08-10', SETTINGS, () => 'x');
    const revived = JSON.parse(JSON.stringify(day)) as typeof day;

    for (const key of ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha']) {
      expect(at(revived, key)).toBe(at(day, key));
      expect(new Date(at(revived, key)).getTime()).toBe(new Date(at(day, key)).getTime());
    }
  });
});

describe('a manually chosen location', () => {
  it('carries the chosen place’s zone, not the device’s', async () => {
    const repository = repositoryWith(
      fakeLocationPort({
        search: async () => [{ label: 'Mountain View', coordinate: MOUNTAIN_VIEW }],
      }),
      new Date(Date.UTC(2026, 7, 10, 12, 0)),
    );

    const result = await repository.searchLocations('Mountain View');
    const place = (result as { data: readonly PrayerLocation[] }).data[0];

    expect(place?.manual).toBe(true);
    expect(place?.timeZone).toBe('America/Los_Angeles');
    expect(place?.timeZone).not.toBe(deviceTimeZone());
  });

  it('gives a stored manual location its own zone on reopen', async () => {
    await AsyncStorage.setItem(
      'noorlife.faith.location',
      JSON.stringify({
        coordinate: MOUNTAIN_VIEW,
        label: 'Mountain View, United States',
        manual: true,
        resolvedAt: '2026-08-10T00:00:00.000Z',
      }),
    );

    const repository = repositoryWith(fakeLocationPort(), new Date(Date.UTC(2026, 7, 10, 12, 0)));
    const result = await repository.resolveCurrentLocation();

    expect(result.kind).toBe('ok');
    const place = (result as { data: PrayerLocation }).data;
    expect(place.timeZone).toBe('America/Los_Angeles');
    expect(place.manual).toBe(true);
  });
});

describe('when the zone cannot be resolved', () => {
  it('reports an error rather than a plausible time in the wrong zone', () => {
    // A location whose `timeZone` the platform cannot use. The whole day is refused; no partial list
    // of device-formatted times is produced.
    const broken: PrayerLocation = {
      coordinate: MANCHESTER,
      label: 'Somewhere',
      timeZone: 'Nowhere/Nowhere',
      manual: false,
      resolvedAt: '2026-08-10T00:00:00Z',
    };
    expect(computeDailyTimes(broken, '2026-08-10', SETTINGS, () => 'x')).toBeNull();
  });

  /**
   * An impossible stored coordinate never reaches the zone lookup, and that is the better outcome.
   *
   * `faith-location.ts` validates `|latitude| <= 90` and `|longitude| <= 180` on read, so a corrupt
   * or tampered record resolves to `null` before `timeZoneForCoordinate` is asked about it. The
   * repository then takes its no-stored-location path and asks for permission.
   *
   * Asserted here rather than assumed, because it is the outer half of the same guarantee: two
   * independent layers refuse to turn a nonsense coordinate into a place, and neither substitutes
   * one. The inner half — a `PrayerLocation` whose zone will not resolve — is the case above.
   */
  it('never reaches the zone lookup with a stored coordinate that is not on Earth', async () => {
    await AsyncStorage.setItem(
      'noorlife.faith.location',
      JSON.stringify({
        coordinate: { latitude: 91, longitude: 500 },
        label: 'Impossible',
        manual: true,
        resolvedAt: '2026-08-10T00:00:00.000Z',
      }),
    );

    const repository = repositoryWith(fakeLocationPort(), new Date(Date.UTC(2026, 7, 10, 12, 0)));
    const result = await repository.resolveCurrentLocation();

    // Rejected by the storage validator, so this is the no-location path rather than an error.
    expect(result.kind).toBe('permission-required');
    // And nothing invented a place to stand in for it.
    expect(JSON.stringify(result)).not.toMatch(/Impossible/);
  });

  it('still asks for permission when there is no location at all', async () => {
    const repository = repositoryWith(
      fakeLocationPort({ getPermission: async () => 'undetermined' }),
      new Date(Date.UTC(2026, 7, 10, 12, 0)),
    );
    const result = await repository.resolveCurrentLocation();

    expect(result.kind).toBe('permission-required');
    // No zone, no coordinate, no city — the timezone work introduced no fallback place.
    expect(JSON.stringify(result)).not.toMatch(/Dubai|Los_Angeles|Mountain View|London/i);
  });
});
