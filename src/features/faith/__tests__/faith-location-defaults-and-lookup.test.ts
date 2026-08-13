import fs from 'node:fs';
import path from 'node:path';

import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  activeLocationRevision,
  resetActiveLocationRevisionForTest,
} from '../data/location/active-location';
import { formattedHijriForCalendarDay } from '../data/calendar-day';
import { hasData } from '../data/faith-result';
import { GEONAMES_ATTRIBUTION, GEONAMES_USAGE_NOTE } from '../data/location/city-attribution';
import { resetCityCatalogueForTest } from '../data/location/city-catalogue';
import { findCityChoice, searchCityChoices } from '../data/location/city-lookup';
import { COUNTRY_NAMES, countryNameFor } from '../data/location/country-names';
import type { LocationFix, LocationPort } from '../data/location/location.port';
import { createAdhanPrayerTimesRepository } from '../data/prayer/adhan-prayer-times.repository';
import { cityLabel, type PrayerTimesRepository } from '../data/prayer-times.repository';
import {
  commitActivePrayerLocation,
  readStoredLocation,
  resetPrayerLocationSnapshotForTest,
} from '../storage/faith-location';

/**
 * What NoorLife does before anybody has chosen anything, and what it must never do instead.
 *
 * ── The default that is not a default ───────────────────────────────────────
 * A prayer app with no location has two honest options: ask, or let the user say. It has a third,
 * dishonest one that is easy to reach by accident — pick somewhere. Mountain View is in the emulator
 * image, Makkah is thematically defensible, and Dubai is in half the fixtures in this repository, so
 * any of the three could end up as "the location" for a user who never granted anything. Prayer times
 * for a city somebody is not in are wrong by up to hours, and nothing on screen would say so.
 *
 * The cases below assert the absence of that. A fresh install resolves to `permission-required` and
 * to nothing else, and the offline paths remain fully usable so declining location costs a user the
 * automatic behaviour and not the feature.
 */

const DUBAI_GEONAMES_ID = 292223;
const MOUNTAIN_VIEW = { latitude: 37.3861, longitude: -122.0839 };
const NOW = new Date('2026-08-13T12:00:00.000Z');

/** A device that will not supply a location, in whichever way the case needs. */
function port(overrides: Partial<LocationPort> = {}): LocationPort {
  return {
    getPermission: async () => 'denied',
    requestPermission: async () => 'denied',
    getLastKnownPosition: async () => null,
    getCurrentPosition: async () => ({ failure: 'permission-denied' as const }),
    describe: async () => null,
    search: async () => [],
    hasCompass: async () => false,
    watchHeading: async () => () => undefined,
    ...overrides,
  };
}

function repositoryWith(location: LocationPort): PrayerTimesRepository {
  return createAdhanPrayerTimesRepository({
    location,
    hijriFor: formattedHijriForCalendarDay,
    now: () => NOW,
  });
}

beforeEach(async () => {
  await AsyncStorage.clear();
  resetPrayerLocationSnapshotForTest();
  resetActiveLocationRevisionForTest();
});

describe('a fresh install with nothing stored', () => {
  it('has no location at all, and names no fallback city', async () => {
    const repository = repositoryWith(port());

    const resolved = await repository.resolveCurrentLocation();
    expect(resolved.kind).toBe('permission-required');
    expect(await repository.getActiveLocationMode()).toBeNull();
    expect(await readStoredLocation()).toBeNull();

    /*
      The three coordinates most likely to be reached for. None of them may appear in the result, in
      any form — a label, a coordinate, or a rationale string.
    */
    const serialised = JSON.stringify(resolved);
    for (const forbidden of ['Mountain View', 'Dubai', 'Makkah', '37.38', '25.07', '21.42']) {
      expect(serialised).not.toContain(forbidden);
    }
  });

  it('explains why location is wanted, in the rationale the screen renders', async () => {
    const resolved = await repositoryWith(port()).resolveCurrentLocation();
    expect(resolved.kind).toBe('permission-required');
    if (resolved.kind !== 'permission-required') return;

    expect(resolved.rationale).toMatch(/prayer times/i);
    expect(resolved.rationale).toMatch(/stays on this device|Qibla/i);
  });

  it('distinguishes a refusal from location services being switched off', async () => {
    const off = await repositoryWith(
      port({ getPermission: async () => 'services-disabled' }),
    ).resolveCurrentLocation();
    expect(off.kind).toBe('permission-required');
    if (off.kind !== 'permission-required') return;
    expect(off.rationale).toMatch(/switched off/i);
  });

  /*
    The application must remain usable without location permission. City search is the path that
    makes that true, so it has to work in exactly the state where the device has refused — no
    permission, no fix, nothing stored.
  */
  it('still searches cities and saves one, with location permanently denied', async () => {
    const repository = repositoryWith(port());

    const found = await repository.searchCities('Dubai');
    expect(found.kind).toBe('ok');
    if (found.kind !== 'ok') return;

    const dubai = found.data.find((city) => city.geonamesId === DUBAI_GEONAMES_ID);
    expect(dubai).toBeDefined();
    if (dubai === undefined) return;

    const saved = await repository.saveCityLocation(dubai);
    expect(saved.kind).toBe('ok');
    if (saved.kind !== 'ok') return;

    expect(saved.data.timeZone).toBe('Asia/Dubai');
    expect(saved.data.mode).toBe('city');
    // And the app now has a location, without a single permission having been granted.
    expect((await repository.resolveCurrentLocation()).kind).toBe('ok');
  });

  it('still accepts typed coordinates with location permanently denied', async () => {
    const repository = repositoryWith(port());
    const saved = await repository.saveCoordinateLocation({
      label: 'My village',
      coordinate: { latitude: 24.4539, longitude: 54.3773 },
    });

    expect(saved.kind).toBe('ok');
    if (saved.kind !== 'ok') return;
    expect(saved.data.mode).toBe('coordinates');
    expect(saved.data.timeZone).toBe('Asia/Dubai');
  });

  it('requests no permission as a side effect of resolving', async () => {
    let requested = 0;
    const repository = repositoryWith(
      port({
        requestPermission: async () => {
          requested += 1;
          return 'denied';
        },
      }),
    );

    await repository.resolveCurrentLocation();
    await repository.searchCities('Dubai');
    await repository.getActiveLocationMode();

    // The prompt belongs to a control the user pressed. Nothing on a read path may raise one.
    expect(requested).toBe(0);
  });
});

describe('on relaunch, the user’s chosen authority survives', () => {
  /*
    A relaunch is modelled as a *new repository over the same storage*, which is exactly what it is:
    no module-level state carries across a process restart, so anything that survives must have been
    written down.
  */
  it.each([
    ['a selected city', 'city'],
    ['typed coordinates', 'coordinates'],
  ] as const)('keeps %s rather than replacing it with a device fix', async (_name, mode) => {
    const first = repositoryWith(port());
    if (mode === 'city') {
      const found = await first.searchCities('Dubai');
      const dubai = hasData(found)
        ? found.data.find((city) => city.geonamesId === DUBAI_GEONAMES_ID)
        : undefined;
      expect(dubai).toBeDefined();
      if (dubai === undefined) return;
      await first.saveCityLocation(dubai);
    } else {
      await first.saveCoordinateLocation({
        label: 'My village',
        coordinate: { latitude: 25.2048, longitude: 55.2708 },
      });
    }

    // Relaunch — and this time the device *can* supply a fix, which must not be taken.
    resetPrayerLocationSnapshotForTest();
    const fix: LocationFix = { coordinate: MOUNTAIN_VIEW, accuracyMetres: 5 };
    const relaunched = repositoryWith(
      port({ getPermission: async () => 'granted', getCurrentPosition: async () => fix }),
    );

    expect(await relaunched.getActiveLocationMode()).toBe(mode);

    const refreshed = await relaunched.refreshDeviceLocation();
    expect(refreshed.kind).toBe('ok');
    if (refreshed.kind !== 'ok') return;
    expect(refreshed.data.accepted).toBe(false);
    expect(refreshed.data.mode).toBe(mode);
    expect(refreshed.data.location.timeZone).toBe('Asia/Dubai');

    // Storage untouched: no device fix was requested, so none could replace the choice.
    expect((await readStoredLocation())?.mode).toBe(mode);
  });

  it('lets device mode refresh its own coordinate under the existing acceptance policy', async () => {
    await commitActivePrayerLocation({
      mode: 'device',
      coordinate: { latitude: 25.07725, longitude: 55.30927 },
      label: 'Dubai',
      resolvedAt: NOW.toISOString(),
      accuracyMetres: 100,
    });
    resetPrayerLocationSnapshotForTest();
    resetActiveLocationRevisionForTest();

    // A materially different place — the user has genuinely moved.
    const relaunched = repositoryWith(
      port({
        getPermission: async () => 'granted',
        getCurrentPosition: async () => ({ coordinate: MOUNTAIN_VIEW, accuracyMetres: 10 }),
      }),
    );

    const refreshed = await relaunched.refreshDeviceLocation();
    expect(refreshed.kind).toBe('ok');
    if (refreshed.kind !== 'ok') return;
    expect(refreshed.data.accepted).toBe(true);
    expect(refreshed.data.materialChange).toBe(true);
    expect(refreshed.data.location.timeZone).toBe('America/Los_Angeles');
    // One logical change, one revision.
    expect(activeLocationRevision()).toBe(1);
  });

  it('preserves the last valid record when a device switch fails after a city was chosen', async () => {
    const repository = repositoryWith(port());
    const found = await repository.searchCities('Dubai');
    const dubai = hasData(found)
      ? found.data.find((city) => city.geonamesId === DUBAI_GEONAMES_ID)
      : undefined;
    if (dubai === undefined) throw new Error('Dubai must be in the catalogue.');
    await repository.saveCityLocation(dubai);
    const before = await readStoredLocation();
    resetActiveLocationRevisionForTest();

    // Permission is granted but the fix times out — the case that most tempts a partial write.
    const flaky = repositoryWith(
      port({
        getPermission: async () => 'granted',
        getCurrentPosition: async () => ({ failure: 'timed-out' as const }),
      }),
    );
    const switched = await flaky.switchToDeviceLocation();

    expect(switched.kind).toBe('error');
    expect(await readStoredLocation()).toEqual(before);
    expect(activeLocationRevision()).toBe(0);
  });
});

describe('the GeoNames credit', () => {
  /*
    The Prayer Location card renders the credit from a constant rather than loading 2.19 MB to
    display one line. This is what stops that constant drifting from the asset it credits — a stale
    attribution is a licence breach that looks exactly like compliance.
  */
  it('matches the attribution inside the shipped asset, byte for byte', () => {
    const asset = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), 'assets/data/city-catalogue.json'), 'utf8'),
    ) as { readonly meta: { readonly licence: { readonly attribution: string } } };

    expect(GEONAMES_ATTRIBUTION).toBe(asset.meta.licence.attribution);
  });

  it('names GeoNames and the licence, which is what CC BY requires', () => {
    expect(GEONAMES_ATTRIBUTION).toMatch(/GeoNames/);
    expect(GEONAMES_ATTRIBUTION).toMatch(/CC BY 4\.0/);
    // And states that the data was modified, which CC BY also requires.
    expect(GEONAMES_USAGE_NOTE).toMatch(/modified/i);
  });
});

describe('the country name table', () => {
  /*
    The completeness guarantee `countryNameFor`'s fallback depends on. Every country code the shipped
    catalogue contains must have a name here, or a search result would render a bare two-letter code
    for a user who is least able to interpret one.
  */
  it('names every country the shipped catalogue uses', () => {
    const asset = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), 'assets/data/city-catalogue.json'), 'utf8'),
    ) as { readonly rows: string };

    const needed = new Set<string>();
    for (const row of asset.rows.split('\n')) {
      if (row.length > 0) {
        needed.add(row.split('|')[3] as string);
      }
    }

    const missing = [...needed].filter((code) => COUNTRY_NAMES[code] === undefined).sort();
    expect(missing).toEqual([]);
    expect(needed.size).toBe(244);
  });

  it('carries no name for a country the catalogue does not contain', () => {
    const asset = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), 'assets/data/city-catalogue.json'), 'utf8'),
    ) as { readonly rows: string };
    const needed = new Set(
      asset.rows
        .split('\n')
        .filter((row) => row.length > 0)
        .map((row) => row.split('|')[3] as string),
    );

    // Kept in step with the data rather than accumulating dead entries a reader has to check.
    expect(Object.keys(COUNTRY_NAMES).filter((code) => !needed.has(code))).toEqual([]);
  });

  it('falls back to the code rather than inventing a country', () => {
    expect(countryNameFor('ZZ')).toBe('ZZ');
    expect(countryNameFor('AE')).toBe('United Arab Emirates');
  });
});

describe('the domain objects screens consume', () => {
  it('never hands a screen a catalogue row or an index position', async () => {
    const outcome = await searchCityChoices('Dubai');
    const first = outcome.cities[0];
    expect(first).toBeDefined();
    if (first === undefined) return;

    // Exactly the domain shape — no `at`, no `normalized`, no `population`.
    expect(Object.keys(first).sort()).toEqual([
      'coordinate',
      'countryCode',
      'countryName',
      'geonamesId',
      'name',
      'region',
    ]);
  });

  it('turns an absent region into null rather than an empty string', async () => {
    const outcome = await searchCityChoices('Singapore');
    for (const city of outcome.cities) {
      expect(city.region).not.toBe('');
    }
  });

  it('drops a repeated region from the label but keeps a real one', async () => {
    const dubai = await findCityChoice(DUBAI_GEONAMES_ID);
    expect(dubai).not.toBeNull();
    if (dubai === null) return;
    // GeoNames records Dubai in Dubai; "Dubai, Dubai, United Arab Emirates" reads as a data error.
    expect(cityLabel(dubai)).toBe('Dubai, United Arab Emirates');

    const lahore = (await searchCityChoices('Lahore')).cities[0];
    expect(lahore).toBeDefined();
    if (lahore === undefined) return;
    expect(cityLabel(lahore)).toBe('Lahore, Punjab, Pakistan');
  });

  it('finds a city by id and refuses an id that is not one', async () => {
    expect(await findCityChoice(DUBAI_GEONAMES_ID)).not.toBeNull();
    expect(await findCityChoice(999_999_999)).toBeNull();
    expect(await findCityChoice(0)).toBeNull();
    expect(await findCityChoice(-1)).toBeNull();
    expect(await findCityChoice(1.5)).toBeNull();
  });
});

describe('measured cost of the paths a screen actually drives', () => {
  /**
   * Recorded rather than bounded tightly.
   *
   * The numbers go to the run output so they can be read and reported; the assertions are generous
   * and exist only to catch an order-of-magnitude regression — the kind a change that moved work back
   * to query time would produce.
   */
  it('records the cost of a first search and of a warm one', async () => {
    resetCityCatalogueForTest();

    const coldStarted = Date.now();
    const cold = await searchCityChoices('Dubai');
    const coldMs = Date.now() - coldStarted;

    const warmStarted = Date.now();
    const warm = await searchCityChoices('Lahore');
    const warmMs = Date.now() - warmStarted;

    const idStarted = Date.now();
    await findCityChoice(DUBAI_GEONAMES_ID);
    const idMs = Date.now() - idStarted;

    console.log(
      `[city-lookup] first search (incl. catalogue parse) ${coldMs}ms, ` +
        `warm search ${warmMs}ms (search itself ${warm.searchMs}ms), ` +
        `re-validation by id ${idMs}ms`,
    );

    expect(cold.cities.length).toBeGreaterThan(0);
    expect(warm.cities.length).toBeGreaterThan(0);
    expect(coldMs).toBeLessThan(5_000);
    expect(warmMs).toBeLessThan(500);
  });
});
