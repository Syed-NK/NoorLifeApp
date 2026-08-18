import AsyncStorage from '@react-native-async-storage/async-storage';

import type { CityChoice, Coordinate, PrayerLocation } from '../data/prayer-times.repository';
import type {
  HeadingReading,
  LocationFailure,
  LocationFix,
  LocationPermission,
  LocationPort,
} from '../data/location/location.port';
import {
  buildParameters,
  computeDailyTimes,
  createAdhanPrayerTimesRepository,
} from '../data/prayer/adhan-prayer-times.repository';
import { timeZoneForCoordinate, toZonedOffsetIso } from '../data/prayer/location-time-zone';
import { readStoredLocation, resetPrayerLocationSnapshotForTest } from '../storage/faith-location';
import { faithAddress } from '@/test-support/faith-storage-address';

/**
 * Prayer times are calculated, and no coordinate is ever invented.
 *
 * ── The two properties under test ───────────────────────────────────────────
 * **The arithmetic is `adhan`'s**, so these do not re-derive solar positions — that would be
 * testing the library. What they assert is the part NoorLife owns: that the six published
 * conventions reach the right parameter set, that the Asr school changes the Asr time and nothing
 * else, that offsets apply, and that the times move when the coordinate and the date do. A fixture
 * would pass every one of those by accident, which is precisely why the fixture was deleted.
 *
 * **No fallback location exists.** With no permission and no stored place the repository reports
 * `permission-required`. It does not answer with a city, a country centroid, or the last coordinate
 * anybody used, and several cases below exist only to hold that line.
 */

const MANCHESTER: Coordinate = { latitude: 53.4808, longitude: -2.2426 };
const MAKKAH: Coordinate = { latitude: 21.4225, longitude: 39.8262 };

/**
 * A location carrying **its own** zone.
 *
 * ── Why this changed, and why the old version hid the defect ────────────────
 * It used to be `timeZone: deviceTimeZone()`, which is exactly the bug the production code had: every
 * fixture in this file agreed with the device, so no case could distinguish "formatted in the
 * location's zone" from "formatted in the device's". The suite passed on both the broken and the
 * corrected implementation. `faith-prayer-timezone.test.ts` is the file that separates them.
 */
function locationAt(coordinate: Coordinate, label = 'Test place'): PrayerLocation {
  const timeZone = timeZoneForCoordinate(coordinate);
  if (timeZone === null) {
    throw new Error(`No IANA zone for ${label}; the fixture coordinate is not on land.`);
  }
  // A fresh fix, so nothing here trips the staleness ceiling in `locationDayFor`.
  return { coordinate, label, timeZone, mode: 'device', resolvedAt: new Date().toISOString() };
}

const SETTINGS = {
  method: 'muslim-world-league' as const,
  asr: 'standard' as const,
  offsetsMinutes: {},
};

/** A location port under the test's control. Every state a device can be in is reachable here. */
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

function repositoryWith(port: LocationPort, now = new Date(2026, 7, 10, 9, 0)) {
  return createAdhanPrayerTimesRepository({
    location: port,
    hijriFor: () => '25 Safar 1448 AH',
    now: () => now,
  });
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

describe('the calculation', () => {
  it('produces the five prayers and sunrise, in order', () => {
    const day = computeDailyTimes(
      locationAt(MANCHESTER),
      '2026-08-10',
      SETTINGS,
      () => '25 Safar 1448 AH',
    );

    expect(day).not.toBeNull();
    expect(day?.times.map((time) => time.key)).toEqual([
      'fajr',
      'sunrise',
      'dhuhr',
      'asr',
      'maghrib',
      'isha',
    ]);

    // Strictly increasing through the day.
    const stamps = (day as { times: readonly { at: string }[] }).times.map((time) =>
      new Date(time.at).getTime(),
    );
    for (let index = 1; index < stamps.length; index += 1) {
      expect(stamps[index]).toBeGreaterThan(stamps[index - 1] as number);
    }
  });

  it('gives a different answer for a different place', () => {
    // The defect this replaces: one fixture answered 05:02 / 12:35 / 16:15 for every coordinate on
    // Earth. Manchester and Makkah must not agree.
    const here = computeDailyTimes(locationAt(MANCHESTER), '2026-08-10', SETTINGS, () => 'x');
    const there = computeDailyTimes(locationAt(MAKKAH), '2026-08-10', SETTINGS, () => 'x');

    expect(here?.times[0]?.at).not.toBe(there?.times[0]?.at);
    expect(here?.times[4]?.at).not.toBe(there?.times[4]?.at);
  });

  it('gives a different answer for a different date', () => {
    const summer = computeDailyTimes(locationAt(MANCHESTER), '2026-06-21', SETTINGS, () => 'x');
    const winter = computeDailyTimes(locationAt(MANCHESTER), '2026-12-21', SETTINGS, () => 'x');

    const maghribOf = (day: typeof summer): string =>
      day?.times.find((time) => time.key === 'maghrib')?.at ?? '';

    // Manchester's sunset moves by hours between the solstices. A fixture could not do this.
    expect(maghribOf(summer).slice(11, 16)).not.toBe(maghribOf(winter).slice(11, 16));
  });

  it('moves Asr, and only Asr, when the school changes', () => {
    const shafi = computeDailyTimes(locationAt(MANCHESTER), '2026-08-10', SETTINGS, () => 'x');
    const hanafi = computeDailyTimes(
      locationAt(MANCHESTER),
      '2026-08-10',
      { ...SETTINGS, asr: 'hanafi' },
      () => 'x',
    );

    const at = (day: typeof shafi, key: string): string =>
      day?.times.find((time) => time.key === key)?.at ?? '';

    // The Hanafi shadow-length convention puts Asr later, and touches nothing else.
    expect(new Date(at(hanafi, 'asr')).getTime()).toBeGreaterThan(
      new Date(at(shafi, 'asr')).getTime(),
    );
    for (const key of ['fajr', 'sunrise', 'dhuhr', 'maghrib', 'isha']) {
      expect(at(hanafi, key)).toBe(at(shafi, key));
    }
  });

  it('maps every published convention to a distinct parameter set', () => {
    const methods = [
      'muslim-world-league',
      'umm-al-qura',
      'egyptian',
      'karachi',
      'isna',
      'moonsighting-committee',
    ] as const;

    // Each is a body that publishes a convention — the property that made the union closed. None
    // may silently resolve to the same angles as another.
    const fajrAngles = methods.map((method) => buildParameters(method, 'standard').fajrAngle);
    expect(new Set(fajrAngles).size).toBeGreaterThan(1);

    for (const method of methods) {
      const params = buildParameters(method, 'standard');
      expect(params.fajrAngle).toBeGreaterThan(0);
    }
  });

  it('applies a per-prayer offset for local mosque alignment', () => {
    const plain = computeDailyTimes(locationAt(MANCHESTER), '2026-08-10', SETTINGS, () => 'x');
    const shifted = computeDailyTimes(
      locationAt(MANCHESTER),
      '2026-08-10',
      { ...SETTINGS, offsetsMinutes: { isha: 15 } },
      () => 'x',
    );

    const ishaOf = (day: typeof plain): number =>
      new Date(day?.times.find((time) => time.key === 'isha')?.at ?? 0).getTime();
    const fajrOf = (day: typeof plain): number =>
      new Date(day?.times.find((time) => time.key === 'fajr')?.at ?? 0).getTime();

    expect(ishaOf(shifted) - ishaOf(plain)).toBe(15 * 60_000);
    // And only that prayer moved.
    expect(fajrOf(shifted)).toBe(fajrOf(plain));
  });

  it('refuses a date it cannot parse rather than answering for today', () => {
    expect(computeDailyTimes(locationAt(MANCHESTER), 'tomorrow', SETTINGS, () => 'x')).toBeNull();
    expect(computeDailyTimes(locationAt(MANCHESTER), '2026-8-1', SETTINGS, () => 'x')).toBeNull();
  });
});

describe('the timestamp format', () => {
  it('carries its offset rather than collapsing to UTC', () => {
    // `PrayerTime.at` is documented as carrying its offset "so a rendered time can never lose its
    // zone". `toISOString` returns a `Z`, and a screen formatting that without converting shows the
    // wrong hour wherever the device is not on UTC.
    const iso = toZonedOffsetIso(new Date(Date.UTC(2026, 7, 10, 19, 44, 0)), 'Europe/London');

    expect(iso).toBe('2026-08-10T20:44:00+01:00');
    expect(iso).not.toMatch(/Z$/);
  });

  it('round-trips to the same instant', () => {
    const original = new Date(Date.UTC(2026, 7, 10, 5, 2, 0));
    const iso = toZonedOffsetIso(original, 'Asia/Dubai');
    expect(new Date(iso as string).getTime()).toBe(original.getTime());
  });

  it('refuses a zone the platform cannot resolve rather than falling back to the device', () => {
    // The whole point of the `null` return: a nonsense zone must not quietly produce a device-local
    // time that looks correct.
    expect(toZonedOffsetIso(new Date(), 'Mars/Olympus_Mons')).toBeNull();
  });
});

describe('resolving a location', () => {
  it('asks for permission rather than inventing a place', async () => {
    const repository = repositoryWith(
      fakeLocationPort({ getPermission: async () => 'undetermined' }),
    );
    const result = await repository.resolveCurrentLocation();

    expect(result.kind).toBe('permission-required');
    // The specific failure this guards: any city at all appearing here.
    expect(JSON.stringify(result)).not.toMatch(/Manchester|Sharjah|London|Makkah|Dubai/i);
  });

  it('distinguishes location services being off from a refusal', async () => {
    const repository = repositoryWith(
      fakeLocationPort({ getPermission: async () => 'services-disabled' }),
    );
    const result = await repository.resolveCurrentLocation();

    expect(result.kind).toBe('permission-required');
    expect(JSON.stringify(result)).toMatch(/switched off/i);
  });

  it('never prompts while resolving', async () => {
    // Resolution happens on render. A prompt raised from here is a prompt the user did not ask for.
    const requestPermission = jest.fn(async (): Promise<LocationPermission> => 'granted');
    const repository = repositoryWith(fakeLocationPort({ requestPermission }));

    await repository.resolveCurrentLocation();
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it('uses the device fix when permission is already granted, and remembers it', async () => {
    const repository = repositoryWith(
      fakeLocationPort({
        getPermission: async () => 'granted',
        // Nothing cached: these suites exercise the authoritative path only.
        getLastKnownPosition: async () => null,
        getCurrentPosition: async () => ({ coordinate: MANCHESTER, accuracyMetres: 42 }),
        describe: async () => 'Manchester, United Kingdom',
      }),
    );

    const result = await repository.resolveCurrentLocation();
    expect(result.kind).toBe('ok');
    expect((result as { data: PrayerLocation }).data.label).toBe('Manchester, United Kingdom');

    // Stored, so the next render does not wake the GPS again.
    const stored = await readStoredLocation();
    expect(stored?.coordinate).toEqual(MANCHESTER);
    expect(stored?.mode).toBe('device');
  });

  it('prefers the stored location over waking the GPS', async () => {
    const getCurrentPosition = jest.fn(async () => ({
      coordinate: MAKKAH,
      accuracyMetres: null,
    }));
    const repository = repositoryWith(
      fakeLocationPort({ getPermission: async () => 'granted', getCurrentPosition }),
    );

    await AsyncStorage.setItem(
      faithAddress('location'),
      JSON.stringify({
        coordinate: MANCHESTER,
        label: 'Manchester, United Kingdom',
        mode: 'device',
        resolvedAt: new Date().toISOString(),
      }),
    );

    const result = await repository.resolveCurrentLocation();
    expect((result as { data: PrayerLocation }).data.coordinate).toEqual(MANCHESTER);
    expect(getCurrentPosition).not.toHaveBeenCalled();
  });

  it('falls back to no coordinate at all when the fix times out', async () => {
    const repository = repositoryWith(
      fakeLocationPort({
        getPermission: async () => 'granted',
        // Nothing cached: these suites exercise the authoritative path only.
        getLastKnownPosition: async () => null,
        getCurrentPosition: async () => ({ failure: 'timed-out' }),
      }),
    );

    const result = await repository.resolveCurrentLocation();
    expect(result).toEqual({ kind: 'error', code: 'timeout' });
    expect(await readStoredLocation()).toBeNull();
  });

  it('labels a coordinate the geocoder could not name, without inventing a place', async () => {
    const repository = repositoryWith(
      fakeLocationPort({
        getPermission: async () => 'granted',
        // Nothing cached: these suites exercise the authoritative path only.
        getLastKnownPosition: async () => null,
        getCurrentPosition: async () => ({ coordinate: MANCHESTER, accuracyMetres: null }),
        describe: async () => null,
      }),
    );

    const result = await repository.resolveCurrentLocation();
    // The coordinate itself, which is true, rather than a nearest-city guess.
    expect((result as { data: PrayerLocation }).data.label).toBe('53.481, -2.243');
  });
});

describe('searching for a place', () => {
  it('reports no results rather than offering a default city', async () => {
    const repository = repositoryWith(fakeLocationPort());
    expect(await repository.searchCities('nowhere at all')).toEqual({
      kind: 'no-results',
      query: 'nowhere at all',
    });
  });

  /*
    Through the bundled catalogue rather than the location port. The port's `search` was the seam a
    paid provider would have been wired into and is no longer on this path at all — city search is a
    scan of an asset, so this asserts against the data the app actually ships.
  */
  it('finds a city in the bundled catalogue and carries its GeoNames identity', async () => {
    const repository = repositoryWith(fakeLocationPort());

    const result = await repository.searchCities('Makkah');
    const first = (result as { data: readonly CityChoice[] }).data[0];

    expect(first?.name).toBe('Makkah');
    expect(first?.countryCode).toBe('SA');
    expect(first?.countryName).toBe('Saudi Arabia');
    expect(first?.geonamesId).toBeGreaterThan(0);
  });
});

describe('the next prayer', () => {
  it('is the next one still ahead today', async () => {
    // 09:00 local: Fajr and sunrise are past, Dhuhr is next.
    const repository = repositoryWith(
      fakeLocationPort({
        getPermission: async () => 'granted',
        // Nothing cached: these suites exercise the authoritative path only.
        getLastKnownPosition: async () => null,
        getCurrentPosition: async () => ({ coordinate: MANCHESTER, accuracyMetres: null }),
      }),
      new Date(2026, 7, 10, 9, 0),
    );

    const location = await repository.resolveCurrentLocation();
    const next = await repository.getNextPrayer(
      (location as { data: PrayerLocation }).data,
      SETTINGS,
    );

    expect((next as { data: { prayer: { key: string } } }).data.prayer.key).toBe('dhuhr');
    expect((next as { data: { minutesUntil: number } }).data.minutesUntil).toBeGreaterThan(0);
  });

  it('never counts sunrise as a prayer', async () => {
    // 05:30 local, after Fajr and before sunrise — the one window where the bug would show.
    const repository = repositoryWith(
      fakeLocationPort({
        getPermission: async () => 'granted',
        // Nothing cached: these suites exercise the authoritative path only.
        getLastKnownPosition: async () => null,
        getCurrentPosition: async () => ({ coordinate: MANCHESTER, accuracyMetres: null }),
      }),
      new Date(2026, 7, 10, 5, 30),
    );

    const location = await repository.resolveCurrentLocation();
    const next = await repository.getNextPrayer(
      (location as { data: PrayerLocation }).data,
      SETTINGS,
    );
    expect((next as { data: { prayer: { key: string } } }).data.prayer.key).not.toBe('sunrise');
  });

  it('rolls to tomorrow’s Fajr after Isha, at tomorrow’s time', async () => {
    /**
     * `now` is derived from the day's own Isha, not written as a wall-clock time.
     *
     * A literal like 23:55 is only "after Isha" in some time zones — this suite runs wherever the
     * developer or CI happens to be, and in a Gulf zone Manchester's Isha lands after midnight
     * local. Deriving the instant makes the case mean what it says on every machine.
     */
    const day = computeDailyTimes(locationAt(MANCHESTER), '2026-08-10', SETTINGS, () => 'x');
    const isha = new Date(day?.times.find((time) => time.key === 'isha')?.at ?? 0);
    const afterIsha = new Date(isha.getTime() + 60_000);

    const repository = repositoryWith(
      fakeLocationPort({
        getPermission: async () => 'granted',
        // Nothing cached: these suites exercise the authoritative path only.
        getLastKnownPosition: async () => null,
        getCurrentPosition: async () => ({ coordinate: MANCHESTER, accuracyMetres: null }),
      }),
      afterIsha,
    );

    const location = await repository.resolveCurrentLocation();
    const resolved = (location as { data: PrayerLocation }).data;
    const next = await repository.getNextPrayer(resolved, SETTINGS);
    const prayer = (next as { data: { prayer: { key: string; at: string } } }).data.prayer;

    expect(prayer.key).toBe('fajr');
    // Tomorrow's Fajr, at tomorrow's time — not today's reused, which would report a past instant.
    expect(new Date(prayer.at).getTime()).toBeGreaterThan(afterIsha.getTime());
    const todaysFajr = day?.times.find((time) => time.key === 'fajr')?.at ?? '';
    expect(prayer.at).not.toBe(todaysFajr);
    expect((next as { data: { minutesUntil: number } }).data.minutesUntil).toBeGreaterThan(0);
  });
});

describe('a whole month', () => {
  it('returns one entry per day, with times that change across it', async () => {
    const repository = repositoryWith(fakeLocationPort());
    const result = await repository.getMonthlyTimes(locationAt(MANCHESTER), '2026-02', SETTINGS);
    const days = (result as { data: readonly { date: string }[] }).data;

    expect(days).toHaveLength(28);
    expect(days[0]?.date).toBe('2026-02-01');
    expect(days[27]?.date).toBe('2026-02-28');
  });

  it('refuses a month it cannot parse', async () => {
    const repository = repositoryWith(fakeLocationPort());
    const result = await repository.getMonthlyTimes(locationAt(MANCHESTER), '2026-13', SETTINGS);
    expect(result.kind).toBe('error');
  });
});
