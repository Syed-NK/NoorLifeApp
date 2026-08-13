import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  activeLocationRevision,
  resetActiveLocationRevisionForTest,
} from '../data/location/active-location';
import { isUserSelectedLocation } from '../data/prayer-times.repository';
import { faithStorageKeys } from '../storage/faith-storage';
import {
  commitActivePrayerLocation,
  migrateLegacyRecord,
  parseStoredPrayerLocation,
  PRAYER_LOCATION_SCHEMA_VERSION,
  readStoredLocation,
  resetPrayerLocationSnapshotForTest,
} from '../storage/faith-location';

/**
 * The versioned active-location record, its one-time migration, and the single write boundary.
 *
 * ── What V3 makes unrepresentable ───────────────────────────────────────────
 * V2 removed the original `manual: boolean` / `mode` contradiction but left a subtler one: a single
 * `manual` mode carrying two different kinds of claim. A city selected from the bundled GeoNames
 * catalogue has an id, a country and a region and can be re-validated; a coordinate somebody typed
 * has none of that and must never be presented as though it did. Under V2 they were the same record,
 * so the identity fields simply did not exist and a saved city could not be distinguished from a
 * typed pair of numbers on relaunch.
 *
 * V3 splits them into `city` and `coordinates`, and gives each variant exactly the fields its mode
 * can justify — so there is no shape in which a typed coordinate claims a GeoNames id, and none in
 * which a city claims a GPS accuracy.
 *
 * ── Why the migration is tested through fixtures rather than only through storage ──
 * Because a migration is only trustworthy if the shapes it *refuses* are covered as thoroughly as the
 * shapes it accepts, and a refusal is invisible through `readStoredLocation` — it looks identical to
 * "nothing was stored". Driving the historical shapes through `migrateLegacyRecord` directly asserts
 * the table itself; the storage-level cases below then assert that the table is actually reached, and
 * reached exactly once.
 */

const DUBAI = { latitude: 25.2048, longitude: 55.2708 };
const MOUNTAIN_VIEW = { latitude: 37.3861, longitude: -122.0839 };
const STAMP = '2026-08-13T12:00:00.000Z';

/** Writes straight to the key, bypassing the boundary — the only way to plant a historical record. */
async function plantRaw(value: unknown): Promise<void> {
  await AsyncStorage.setItem(faithStorageKeys.location, JSON.stringify(value));
}

async function rawStored(): Promise<Record<string, unknown> | null> {
  const raw = await AsyncStorage.getItem(faithStorageKeys.location);
  return raw === null ? null : (JSON.parse(raw) as Record<string, unknown>);
}

beforeEach(async () => {
  await AsyncStorage.clear();
  resetActiveLocationRevisionForTest();
  resetPrayerLocationSnapshotForTest();
});

describe('the V3 record', () => {
  it('is version 3', () => {
    expect(PRAYER_LOCATION_SCHEMA_VERSION).toBe(3);
  });

  it('stores a selected city with its GeoNames identity and its own timezone', async () => {
    const result = await commitActivePrayerLocation({
      mode: 'city',
      coordinate: DUBAI,
      label: 'Dubai, United Arab Emirates',
      geonamesId: 292223,
      countryCode: 'AE',
      admin1: 'Dubai',
      resolvedAt: STAMP,
    });

    expect(result.kind).toBe('committed');
    expect(await rawStored()).toEqual({
      version: 3,
      mode: 'city',
      coordinate: DUBAI,
      timezone: 'Asia/Dubai',
      label: 'Dubai, United Arab Emirates',
      labelProvenance: 'geonames',
      geonamesId: 292223,
      countryCode: 'AE',
      admin1: 'Dubai',
      resolvedAt: STAMP,
    });
  });

  it('stores typed coordinates with user-supplied provenance and no city identity', async () => {
    await commitActivePrayerLocation({
      mode: 'coordinates',
      coordinate: DUBAI,
      label: 'My office',
      resolvedAt: STAMP,
    });

    const stored = await rawStored();
    expect(stored).toEqual({
      version: 3,
      mode: 'coordinates',
      coordinate: DUBAI,
      timezone: 'Asia/Dubai',
      label: 'My office',
      labelProvenance: 'user-supplied',
      resolvedAt: STAMP,
    });
    // The fields that would let a typed coordinate impersonate catalogue data are simply not written.
    expect(stored).not.toHaveProperty('geonamesId');
    expect(stored).not.toHaveProperty('countryCode');
  });

  it('marks an unnamed coordinate as coordinates rather than as the user’s words', async () => {
    await commitActivePrayerLocation({
      mode: 'coordinates',
      coordinate: DUBAI,
      label: null,
      resolvedAt: STAMP,
    });
    expect((await rawStored())?.labelProvenance).toBe('coordinates');
  });

  it('stores a device location with geocoder provenance and its accuracy', async () => {
    await commitActivePrayerLocation({
      mode: 'device',
      coordinate: MOUNTAIN_VIEW,
      label: 'Mountain View, United States',
      resolvedAt: STAMP,
      accuracyMetres: 12,
    });

    const stored = await rawStored();
    expect(stored?.mode).toBe('device');
    expect(stored?.labelProvenance).toBe('reverse-geocoded');
    expect(stored?.accuracyMetres).toBe(12);
    expect(stored?.timezone).toBe('America/Los_Angeles');
  });

  it('marks a device label the geocoder could not supply as device-unlabelled', async () => {
    await commitActivePrayerLocation({
      mode: 'device',
      coordinate: MOUNTAIN_VIEW,
      label: null,
      resolvedAt: STAMP,
      accuracyMetres: null,
    });
    expect((await rawStored())?.labelProvenance).toBe('device-unlabelled');
  });

  it('never lets a city or coordinate record carry a device accuracy', async () => {
    await commitActivePrayerLocation({
      mode: 'coordinates',
      coordinate: DUBAI,
      label: 'Somewhere',
      resolvedAt: STAMP,
    });
    expect(await rawStored()).not.toHaveProperty('accuracyMetres');
  });

  it('rejects a city with no usable GeoNames identity, and writes nothing', async () => {
    const result = await commitActivePrayerLocation({
      mode: 'city',
      coordinate: DUBAI,
      label: 'Dubai',
      geonamesId: 0,
      countryCode: 'AE',
      admin1: null,
      resolvedAt: STAMP,
    });

    expect(result).toEqual({ kind: 'rejected', reason: 'incomplete-city' });
    expect(await rawStored()).toBeNull();
    expect(activeLocationRevision()).toBe(0);
  });

  it('rejects a coordinate that is not on Earth, and writes nothing', async () => {
    for (const coordinate of [
      { latitude: 91, longitude: 0 },
      { latitude: 0, longitude: 181 },
      { latitude: Number.NaN, longitude: 0 },
      { latitude: 0, longitude: Number.POSITIVE_INFINITY },
    ]) {
      const result = await commitActivePrayerLocation({
        mode: 'coordinates',
        coordinate,
        label: null,
        resolvedAt: STAMP,
      });
      expect(result).toEqual({ kind: 'rejected', reason: 'invalid-coordinate' });
    }
    expect(await rawStored()).toBeNull();
    expect(activeLocationRevision()).toBe(0);
  });

  it('rejects a stamp that is not a moment', async () => {
    const result = await commitActivePrayerLocation({
      mode: 'coordinates',
      coordinate: DUBAI,
      label: null,
      resolvedAt: 'whenever',
    });
    expect(result.kind).toBe('rejected');
    expect(await rawStored()).toBeNull();
  });

  it('derives the timezone rather than accepting one, so the pair is always consistent', async () => {
    await commitActivePrayerLocation({
      mode: 'coordinates',
      coordinate: MOUNTAIN_VIEW,
      // A label naming a different continent changes nothing: the zone comes from the coordinate.
      label: 'Definitely Dubai',
      resolvedAt: STAMP,
    });
    expect((await rawStored())?.timezone).toBe('America/Los_Angeles');
  });
});

describe('the authority predicate', () => {
  it('treats a city and typed coordinates as the user’s choice, and a device fix as not', () => {
    expect(isUserSelectedLocation({ mode: 'city' })).toBe(true);
    expect(isUserSelectedLocation({ mode: 'coordinates' })).toBe(true);
    expect(isUserSelectedLocation({ mode: 'device' })).toBe(false);
  });

  /*
    The regression this predicate exists to prevent. Written as `mode === 'coordinates'`, the guard
    would be correct for typed coordinates and would let a device refresh overwrite every saved city —
    so the property under test is that *both* user modes answer the same way.
  */
  it('answers identically for both user-authority modes', () => {
    expect(isUserSelectedLocation({ mode: 'city' })).toBe(
      isUserSelectedLocation({ mode: 'coordinates' }),
    );
  });
});

describe('migration from earlier schemas', () => {
  it('migrates a V2 device record, renaming its unavailable provenance', () => {
    expect(
      migrateLegacyRecord({
        version: 2,
        mode: 'device',
        coordinate: MOUNTAIN_VIEW,
        label: null,
        labelProvenance: 'unavailable',
        timezone: 'America/Los_Angeles',
        resolvedAt: STAMP,
        accuracyMetres: 30,
      }),
    ).toEqual({
      mode: 'device',
      coordinate: MOUNTAIN_VIEW,
      label: null,
      resolvedAt: STAMP,
      accuracyMetres: 30,
    });
  });

  /*
    The decision worth stating plainly: a V2 `manual` record becomes `coordinates`, never `city`.
    It has no GeoNames id, no country and no region, and the only way to invent them would be to match
    the coordinate to the nearest catalogue entry — which would relabel somebody's typed guess with a
    real city's name and attach a source credit to it. What the record is, is what it migrates to.
  */
  it('migrates a V2 manual record to coordinates, never to a guessed city', () => {
    const migrated = migrateLegacyRecord({
      version: 2,
      mode: 'manual',
      coordinate: DUBAI,
      label: 'Dubai, UAE',
      labelProvenance: 'user-supplied',
      timezone: 'Asia/Dubai',
      resolvedAt: STAMP,
    });

    expect(migrated).toEqual({
      mode: 'coordinates',
      coordinate: DUBAI,
      label: 'Dubai, UAE',
      resolvedAt: STAMP,
    });
    expect(migrated).not.toHaveProperty('geonamesId');
  });

  it('reads a V1 manual: true record as coordinates', () => {
    expect(migrateLegacyRecord({ coordinate: DUBAI, manual: true, resolvedAt: STAMP })?.mode).toBe(
      'coordinates',
    );
  });

  it('reads a V1 manual: false record as device', () => {
    expect(migrateLegacyRecord({ coordinate: DUBAI, manual: false, resolvedAt: STAMP })?.mode).toBe(
      'device',
    );
  });

  it('accepts an agreeing manual/mode pair', () => {
    expect(
      migrateLegacyRecord({ coordinate: DUBAI, manual: true, mode: 'manual', resolvedAt: STAMP })
        ?.mode,
    ).toBe('coordinates');
    expect(
      migrateLegacyRecord({ coordinate: DUBAI, manual: false, mode: 'device', resolvedAt: STAMP })
        ?.mode,
    ).toBe('device');
  });

  it('fails closed on a contradictory manual/mode pair', () => {
    expect(
      migrateLegacyRecord({ coordinate: DUBAI, manual: true, mode: 'device', resolvedAt: STAMP }),
    ).toBeNull();
    expect(
      migrateLegacyRecord({ coordinate: DUBAI, manual: false, mode: 'manual', resolvedAt: STAMP }),
    ).toBeNull();
  });

  it('fails closed when nothing in the record says where its authority came from', () => {
    expect(migrateLegacyRecord({ coordinate: DUBAI, resolvedAt: STAMP })).toBeNull();
  });

  it('rejects malformed, non-finite and out-of-range records', () => {
    for (const value of [
      null,
      undefined,
      'a string',
      42,
      {},
      { coordinate: DUBAI },
      { manual: true, resolvedAt: STAMP },
      { coordinate: { latitude: 91, longitude: 0 }, manual: true, resolvedAt: STAMP },
      { coordinate: { latitude: 0, longitude: 181 }, manual: true, resolvedAt: STAMP },
      { coordinate: { latitude: Number.NaN, longitude: 0 }, manual: true, resolvedAt: STAMP },
      {
        coordinate: { latitude: 0, longitude: Number.POSITIVE_INFINITY },
        manual: true,
        resolvedAt: STAMP,
      },
      { coordinate: DUBAI, manual: true, resolvedAt: 'not a date' },
      { coordinate: DUBAI, manual: true, resolvedAt: 12345 },
    ]) {
      expect(migrateLegacyRecord(value)).toBeNull();
    }
  });

  it('treats a missing label and a missing accuracy as unknown rather than as values', () => {
    expect(migrateLegacyRecord({ coordinate: DUBAI, manual: false, resolvedAt: STAMP })).toEqual({
      mode: 'device',
      coordinate: DUBAI,
      label: null,
      resolvedAt: STAMP,
      accuracyMetres: null,
    });
  });
});

describe('the parse boundary', () => {
  it('tells absent, current, migratable and unreadable apart', () => {
    expect(parseStoredPrayerLocation(null).kind).toBe('absent');
    expect(parseStoredPrayerLocation(undefined).kind).toBe('absent');
    expect(
      parseStoredPrayerLocation({ coordinate: DUBAI, manual: true, resolvedAt: STAMP }).kind,
    ).toBe('migrated');
    expect(
      parseStoredPrayerLocation({
        coordinate: DUBAI,
        manual: true,
        mode: 'device',
        resolvedAt: STAMP,
      }).kind,
    ).toBe('unreadable');
    expect(
      parseStoredPrayerLocation({
        version: 3,
        mode: 'coordinates',
        coordinate: DUBAI,
        timezone: 'Asia/Dubai',
        label: null,
        labelProvenance: 'coordinates',
        resolvedAt: STAMP,
      }).kind,
    ).toBe('current');
  });

  it('refuses a V3 record whose provenance contradicts its label', () => {
    // "The user named this place" with no name is a record nobody can read. It fails closed.
    expect(
      parseStoredPrayerLocation({
        version: 3,
        mode: 'coordinates',
        coordinate: DUBAI,
        timezone: 'Asia/Dubai',
        label: null,
        labelProvenance: 'user-supplied',
        resolvedAt: STAMP,
      }).kind,
    ).toBe('unreadable');
  });

  it('refuses a V3 city record with no GeoNames identity', () => {
    expect(
      parseStoredPrayerLocation({
        version: 3,
        mode: 'city',
        coordinate: DUBAI,
        timezone: 'Asia/Dubai',
        label: 'Dubai',
        labelProvenance: 'geonames',
        countryCode: 'AE',
        admin1: null,
        resolvedAt: STAMP,
      }).kind,
    ).toBe('unreadable');
  });
});

describe('migration through storage', () => {
  it('migrates a legacy record on read, exactly once, and never again', async () => {
    await plantRaw({ coordinate: DUBAI, label: 'Dubai, UAE', manual: true, resolvedAt: STAMP });

    const first = await readStoredLocation();
    expect(first?.version).toBe(3);
    expect(first?.mode).toBe('coordinates');
    expect((await rawStored())?.version).toBe(3);

    /*
      The second read finds V3 and writes nothing. Asserted by mutating the stored bytes between the
      reads: if the second read re-migrated, it would overwrite this marker.
    */
    const stored = (await rawStored()) as Record<string, unknown>;
    await AsyncStorage.setItem(
      faithStorageKeys.location,
      JSON.stringify({ ...stored, label: 'Untouched' }),
    );
    const second = await readStoredLocation();
    expect(second?.label).toBe('Untouched');
  });

  /*
    A migration must not look like a location change. Every notification reconciliation in the app is
    triggered by a revision moving, so publishing one here would rebuild the entire alert schedule on
    the first launch after an upgrade — for a place that has not moved a metre.
  */
  it('does not bump the revision when migrating or when re-reading', async () => {
    await plantRaw({ coordinate: DUBAI, manual: true, resolvedAt: STAMP });

    await readStoredLocation();
    expect(activeLocationRevision()).toBe(0);
    await readStoredLocation();
    expect(activeLocationRevision()).toBe(0);
  });

  it('preserves a valid saved selection across the migration', async () => {
    await plantRaw({
      coordinate: DUBAI,
      label: 'Dubai, UAE',
      manual: true,
      resolvedAt: STAMP,
    });

    const migrated = await readStoredLocation();
    expect(migrated?.coordinate).toEqual(DUBAI);
    expect(migrated?.label).toBe('Dubai, UAE');
    expect(migrated === null ? null : isUserSelectedLocation(migrated)).toBe(true);
  });

  it('retains the last valid runtime snapshot when a record cannot be migrated', async () => {
    await commitActivePrayerLocation({
      mode: 'coordinates',
      coordinate: DUBAI,
      label: 'Dubai, UAE',
      resolvedAt: STAMP,
    });
    expect((await readStoredLocation())?.coordinate).toEqual(DUBAI);

    // Corrupted underneath the process — contradictory, so unreadable.
    await plantRaw({ coordinate: DUBAI, manual: true, mode: 'device', resolvedAt: STAMP });

    const recovered = await readStoredLocation();
    expect(recovered?.coordinate).toEqual(DUBAI);
    expect(recovered?.label).toBe('Dubai, UAE');
    // Storage is left exactly as it was; nothing is repaired behind the user's back.
    expect((await rawStored())?.mode).toBe('device');
  });

  it('reports no location at all when nothing valid has ever been read', async () => {
    await plantRaw({ nonsense: true });
    expect(await readStoredLocation()).toBeNull();
  });
});

describe('the mutation boundary', () => {
  it('publishes exactly one revision for one logical change', async () => {
    expect(activeLocationRevision()).toBe(0);
    await commitActivePrayerLocation({
      mode: 'city',
      coordinate: DUBAI,
      label: 'Dubai, United Arab Emirates',
      geonamesId: 292223,
      countryCode: 'AE',
      admin1: 'Dubai',
      resolvedAt: STAMP,
    });
    expect(activeLocationRevision()).toBe(1);
  });

  it('writes nothing and publishes nothing for an equivalent snapshot', async () => {
    const candidate = {
      mode: 'device',
      coordinate: DUBAI,
      label: 'Dubai',
      resolvedAt: STAMP,
      accuracyMetres: 20,
    } as const;

    await commitActivePrayerLocation(candidate);
    expect(activeLocationRevision()).toBe(1);

    // Same place, same accuracy, later stamp. Nothing downstream can act on that.
    const second = await commitActivePrayerLocation({
      ...candidate,
      resolvedAt: '2026-08-13T13:00:00.000Z',
    });
    expect(second.kind).toBe('unchanged');
    expect(activeLocationRevision()).toBe(1);
  });

  it('treats two cities at one coordinate with different ids as different selections', async () => {
    const base = {
      mode: 'city',
      coordinate: DUBAI,
      label: 'Dubai, United Arab Emirates',
      countryCode: 'AE',
      admin1: 'Dubai',
      resolvedAt: STAMP,
    } as const;

    await commitActivePrayerLocation({ ...base, geonamesId: 292223 });
    const second = await commitActivePrayerLocation({ ...base, geonamesId: 292224 });

    expect(second.kind).toBe('committed');
    expect(activeLocationRevision()).toBe(2);
  });

  it('publishes nothing when the write is rejected', async () => {
    await commitActivePrayerLocation({
      mode: 'coordinates',
      coordinate: { latitude: 91, longitude: 0 },
      label: null,
      resolvedAt: STAMP,
    });
    expect(activeLocationRevision()).toBe(0);
  });

  it('publishes nothing for a migration', async () => {
    await commitActivePrayerLocation(
      { mode: 'coordinates', coordinate: DUBAI, label: null, resolvedAt: STAMP },
      { reason: 'migration' },
    );
    expect(activeLocationRevision()).toBe(0);
    expect((await rawStored())?.version).toBe(3);
  });

  it('changes mode without ambiguity, one record at a time', async () => {
    await commitActivePrayerLocation({
      mode: 'city',
      coordinate: DUBAI,
      label: 'Dubai, United Arab Emirates',
      geonamesId: 292223,
      countryCode: 'AE',
      admin1: 'Dubai',
      resolvedAt: STAMP,
    });
    expect((await rawStored())?.mode).toBe('city');

    await commitActivePrayerLocation({
      mode: 'device',
      coordinate: MOUNTAIN_VIEW,
      label: 'Mountain View',
      resolvedAt: STAMP,
      accuracyMetres: 8,
    });

    const stored = await rawStored();
    expect(stored?.mode).toBe('device');
    // The previous mode's identity fields are gone rather than left behind to be misread.
    expect(stored).not.toHaveProperty('geonamesId');
    expect(activeLocationRevision()).toBe(2);
  });
});
