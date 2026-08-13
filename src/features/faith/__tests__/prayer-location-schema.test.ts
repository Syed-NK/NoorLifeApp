import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  activeLocationRevision,
  resetActiveLocationRevisionForTest,
} from '../data/location/active-location';
import { faithStorageKeys } from '../storage/faith-storage';
import {
  commitActivePrayerLocation,
  migrateLegacyRecord,
  PRAYER_LOCATION_SCHEMA_VERSION,
  readStoredLocation,
  resetPrayerLocationSnapshotForTest,
} from '../storage/faith-location';

/**
 * The versioned active-location record, its one-time migration, and the single write boundary.
 *
 * ── The contradiction this schema makes unrepresentable ─────────────────────
 * The previous record carried `manual: boolean` **and** `mode?: 'device' | 'manual'` — the same fact
 * twice, with two of the four combinations meaningless. `manual: true, mode: 'device'` has no
 * correct reading: mode decides whether an automatic GPS refresh may overwrite a saved city, so
 * believing the wrong field either replaces a deliberate choice or freezes a location that should
 * follow the user. A discriminated union removes both states from the type system.
 */

const DUBAI = { latitude: 25.2048, longitude: 55.2708 };
const MOUNTAIN_VIEW = { latitude: 37.3861, longitude: -122.0839 };
const STAMP = '2026-08-13T12:00:00.000Z';

/** Writes straight to the key, bypassing the boundary — the only way to plant a legacy record. */
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

describe('the V2 record', () => {
  it('stores a manual location with user-supplied provenance and its own timezone', async () => {
    const result = await commitActivePrayerLocation({
      mode: 'manual',
      coordinate: DUBAI,
      label: 'Dubai, UAE',
      resolvedAt: STAMP,
    });

    expect(result.kind).toBe('committed');
    const stored = await rawStored();
    expect(stored).toEqual({
      version: PRAYER_LOCATION_SCHEMA_VERSION,
      mode: 'manual',
      coordinate: DUBAI,
      label: 'Dubai, UAE',
      labelProvenance: 'user-supplied',
      timezone: 'Asia/Dubai',
      resolvedAt: STAMP,
    });
    // `manual` is gone from everything newly written.
    expect(stored).not.toHaveProperty('manual');
  });

  it('stores a device location with geocoder provenance and its accuracy', async () => {
    await commitActivePrayerLocation({
      mode: 'device',
      coordinate: MOUNTAIN_VIEW,
      label: 'Mountain View, United States',
      resolvedAt: STAMP,
      accuracyMetres: 24,
    });

    const stored = await rawStored();
    expect(stored?.mode).toBe('device');
    expect(stored?.labelProvenance).toBe('reverse-geocoded');
    expect(stored?.timezone).toBe('America/Los_Angeles');
    expect(stored?.accuracyMetres).toBe(24);
    expect(stored).not.toHaveProperty('manual');
  });

  it('marks a device label the geocoder could not supply as unavailable', async () => {
    await commitActivePrayerLocation({
      mode: 'device',
      coordinate: MOUNTAIN_VIEW,
      label: null,
      resolvedAt: STAMP,
      accuracyMetres: null,
    });

    expect((await rawStored())?.labelProvenance).toBe('unavailable');
  });

  it('never lets a device label claim user-supplied provenance', async () => {
    await commitActivePrayerLocation({
      mode: 'device',
      coordinate: DUBAI,
      label: 'Dubai',
      resolvedAt: STAMP,
      accuracyMetres: 10,
    });
    expect((await rawStored())?.labelProvenance).not.toBe('user-supplied');
  });

  it('rejects a coordinate that is not on Earth, and writes nothing', async () => {
    for (const coordinate of [
      { latitude: 91, longitude: 0 },
      { latitude: 0, longitude: 181 },
      { latitude: Number.NaN, longitude: 0 },
    ]) {
      const result = await commitActivePrayerLocation({
        mode: 'manual',
        coordinate,
        label: 'Nowhere',
        resolvedAt: STAMP,
      });
      expect(result).toEqual({ kind: 'rejected', reason: 'invalid-coordinate' });
    }
    expect(await rawStored()).toBeNull();
  });

  /**
   * The timezone is resolved by the boundary, so a record cannot disagree with its own coordinate.
   */
  it('derives the timezone rather than accepting one, so the pair is always consistent', async () => {
    await commitActivePrayerLocation({
      mode: 'manual',
      coordinate: DUBAI,
      label: 'Deliberately mislabelled',
      resolvedAt: STAMP,
    });
    expect((await rawStored())?.timezone).toBe('Asia/Dubai');
  });
});

describe('legacy migration', () => {
  const legacy = (extra: Record<string, unknown>) => ({
    coordinate: DUBAI,
    label: 'Dubai, UAE',
    resolvedAt: STAMP,
    ...extra,
  });

  it('reads legacy manual: true as manual mode', () => {
    expect(migrateLegacyRecord(legacy({ manual: true }))?.mode).toBe('manual');
  });

  it('reads legacy manual: false as device mode', () => {
    expect(migrateLegacyRecord(legacy({ manual: false }))?.mode).toBe('device');
  });

  it('accepts an agreeing manual/mode pair', () => {
    expect(migrateLegacyRecord(legacy({ manual: true, mode: 'manual' }))?.mode).toBe('manual');
    expect(migrateLegacyRecord(legacy({ manual: false, mode: 'device' }))?.mode).toBe('device');
  });

  /**
   * The case with no honest answer.
   *
   * Reading it as `device` lets an automatic refresh replace a city the user chose; reading it as
   * `manual` freezes a location that should follow them. Both are silent, so neither is guessed.
   */
  it.each([[{ manual: true, mode: 'device' }], [{ manual: false, mode: 'manual' }]])(
    'fails closed on contradictory legacy fields %p',
    (fields) => {
      expect(migrateLegacyRecord(legacy(fields))).toBeNull();
    },
  );

  it('rejects malformed coordinates and a missing timestamp', () => {
    expect(
      migrateLegacyRecord({ coordinate: { latitude: 'x', longitude: 0 }, manual: true }),
    ).toBeNull();
    expect(migrateLegacyRecord({ coordinate: DUBAI, manual: true })).toBeNull();
    expect(migrateLegacyRecord(null)).toBeNull();
  });

  it('treats a missing label and a missing accuracy as unknown rather than as values', () => {
    const migrated = migrateLegacyRecord({ coordinate: DUBAI, manual: false, resolvedAt: STAMP });
    expect(migrated).toMatchObject({ mode: 'device', label: null, accuracyMetres: null });
  });

  it('migrates a legacy record on read, exactly once, and never again', async () => {
    await plantRaw({ coordinate: DUBAI, label: 'Dubai, UAE', manual: true, resolvedAt: STAMP });

    const first = await readStoredLocation();
    expect(first?.mode).toBe('manual');
    expect(first?.version).toBe(PRAYER_LOCATION_SCHEMA_VERSION);
    expect(first?.timezone).toBe('Asia/Dubai');
    const afterFirst = await rawStored();

    // Two further reads must not rewrite anything.
    await readStoredLocation();
    await readStoredLocation();
    expect(await rawStored()).toEqual(afterFirst);
  });

  /**
   * Migrating is not a location change, so it publishes nothing.
   *
   * The place has not moved — only its representation — and a revision would make every
   * location-derived resource in the app refetch on the first launch after an upgrade.
   */
  it('does not bump the revision when migrating or when re-reading', async () => {
    await plantRaw({ coordinate: DUBAI, label: 'Dubai, UAE', manual: true, resolvedAt: STAMP });
    const before = activeLocationRevision();

    await readStoredLocation();
    await readStoredLocation();

    expect(activeLocationRevision()).toBe(before);
  });

  it('preserves a valid saved manual selection across the migration', async () => {
    await plantRaw({ coordinate: DUBAI, label: 'Dubai, UAE', manual: true, resolvedAt: STAMP });

    const migrated = await readStoredLocation();
    expect(migrated?.coordinate).toEqual(DUBAI);
    expect(migrated?.label).toBe('Dubai, UAE');
    expect(migrated?.mode).toBe('manual');
  });

  /**
   * An unreadable record keeps the last valid snapshot rather than blanking a working screen.
   */
  it('retains the last valid runtime snapshot when a record cannot be migrated', async () => {
    await commitActivePrayerLocation({
      mode: 'manual',
      coordinate: DUBAI,
      label: 'Dubai, UAE',
      resolvedAt: STAMP,
    });
    expect((await readStoredLocation())?.coordinate).toEqual(DUBAI);

    // Now corrupt the key beneath it.
    await plantRaw({ coordinate: DUBAI, manual: true, mode: 'device', resolvedAt: STAMP });

    const recovered = await readStoredLocation();
    expect(recovered?.coordinate).toEqual(DUBAI);
    expect(recovered?.mode).toBe('manual');
  });

  it('reports no location at all when nothing valid has ever been read', async () => {
    await plantRaw({ coordinate: DUBAI, manual: true, mode: 'device', resolvedAt: STAMP });
    expect(await readStoredLocation()).toBeNull();
  });
});

describe('the mutation boundary', () => {
  it('publishes exactly one revision for one logical change', async () => {
    const before = activeLocationRevision();
    await commitActivePrayerLocation({
      mode: 'manual',
      coordinate: DUBAI,
      label: 'Dubai, UAE',
      resolvedAt: STAMP,
    });
    expect(activeLocationRevision()).toBe(before + 1);
  });

  it('writes nothing and publishes nothing for an equivalent snapshot', async () => {
    await commitActivePrayerLocation({
      mode: 'manual',
      coordinate: DUBAI,
      label: 'Dubai, UAE',
      resolvedAt: STAMP,
    });
    const after = activeLocationRevision();

    /*
      The same place, re-resolved a minute later. A new `resolvedAt` alone is not a change anything
      downstream can act on, and treating it as one would reschedule the whole horizon on every
      screen entry.
    */
    const second = await commitActivePrayerLocation({
      mode: 'manual',
      coordinate: DUBAI,
      label: 'Dubai, UAE',
      resolvedAt: '2026-08-13T12:01:00.000Z',
    });

    expect(second.kind).toBe('unchanged');
    expect(activeLocationRevision()).toBe(after);
  });

  it('publishes nothing when the write is rejected', async () => {
    const before = activeLocationRevision();
    await commitActivePrayerLocation({
      mode: 'manual',
      coordinate: { latitude: 999, longitude: 0 },
      label: 'Nowhere',
      resolvedAt: STAMP,
    });
    expect(activeLocationRevision()).toBe(before);
  });

  it('publishes nothing for a migration', async () => {
    const before = activeLocationRevision();
    const result = await commitActivePrayerLocation(
      { mode: 'manual', coordinate: DUBAI, label: 'Dubai, UAE', resolvedAt: STAMP },
      { reason: 'migration' },
    );

    expect(result).toMatchObject({ kind: 'committed', published: false });
    expect(activeLocationRevision()).toBe(before);
  });

  it('changes mode without ambiguity, one record at a time', async () => {
    await commitActivePrayerLocation({
      mode: 'manual',
      coordinate: DUBAI,
      label: 'Dubai, UAE',
      resolvedAt: STAMP,
    });
    await commitActivePrayerLocation({
      mode: 'device',
      coordinate: MOUNTAIN_VIEW,
      label: 'Mountain View, United States',
      resolvedAt: STAMP,
      accuracyMetres: 30,
    });

    const stored = await rawStored();
    expect(stored?.mode).toBe('device');
    expect(stored?.timezone).toBe('America/Los_Angeles');
    // No residue of the previous mode's fields.
    expect(stored).not.toHaveProperty('manual');
    expect(stored?.labelProvenance).toBe('reverse-geocoded');
  });
});
