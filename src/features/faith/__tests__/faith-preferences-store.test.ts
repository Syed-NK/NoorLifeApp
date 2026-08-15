import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  getFaithPreferencesSnapshot,
  hydrateFaithPreferences,
  subscribeToFaithPreferences,
  updateFaithPreferences,
} from '../state/faith-preferences-store';
import { faithStorageKeys } from '../storage/faith-storage';

/**
 * The Faith preference store, on its own — no screens, no repositories, no rendering.
 *
 * ── The defect it replaced ──────────────────────────────────────────────────
 * `useFaithPreferences` held a `useState` per call site, so the prayer reminders screen and the
 * `usePrayerNotifications` hook that screen mounts each had a private copy. Turning the master
 * switch on wrote through one and rendered from the other: the switch the user had just pressed
 * stayed off, while the value sat correctly in storage the whole time. Nothing was listening.
 *
 * That shape also raced. Two copies each did read-modify-write against the same blob, so a
 * per-prayer toggle followed quickly by another could have the second write land on a snapshot read
 * before the first — silently discarding it.
 *
 * ── Why this is a separate file from the reminders suite ────────────────────
 * These cases drive the store directly, which leaves hydrations and writes in flight that a
 * following test would inherit. Mixed in with cases that mount a screen, the suite passed in
 * isolation and failed in sequence — the signature symptom of shared async state, and the very class
 * of bug this store exists to remove from the product. One kind of pending work per file.
 */

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('faith preferences are one shared snapshot', () => {
  it('publishes one snapshot to every subscriber', async () => {
    await hydrateFaithPreferences();

    const seenByFirst: boolean[] = [];
    const seenBySecond: boolean[] = [];
    const unsubscribeFirst = subscribeToFaithPreferences(() => {
      seenByFirst.push(getFaithPreferencesSnapshot().preferences.prayerNotificationsEnabled);
    });
    const unsubscribeSecond = subscribeToFaithPreferences(() => {
      seenBySecond.push(getFaithPreferencesSnapshot().preferences.prayerNotificationsEnabled);
    });

    await updateFaithPreferences({ prayerNotificationsEnabled: true });

    /*
      Both consumers, the same value, from the same publish. Under the per-hook state this replaces
      there was no second consumer to notify at all — each held its own `useState`.
    */
    expect(seenByFirst).toEqual([true]);
    expect(seenBySecond).toEqual([true]);

    unsubscribeFirst();
    unsubscribeSecond();
  });

  it('returns a stable snapshot identity until something changes', async () => {
    await hydrateFaithPreferences();
    const before = getFaithPreferencesSnapshot();

    /* `useSyncExternalStore` compares by identity; a fresh object per read would loop forever. */
    expect(getFaithPreferencesSnapshot()).toBe(before);

    await updateFaithPreferences({ prayerNotificationsEnabled: true });
    expect(getFaithPreferencesSnapshot()).not.toBe(before);
  });

  it('serialises overlapping writes so neither is lost', async () => {
    await hydrateFaithPreferences();

    /*
      Issued without awaiting in between, which is exactly how two quick taps arrive. Under the old
      shape both derived from the same pre-toggle array and the second write erased the first, so one
      of the user's two prayers switched itself back off.
    */
    const first = updateFaithPreferences((current) => ({
      prayerNotifications: current.prayerNotifications.map((entry) =>
        entry.prayer === 'fajr' ? { ...entry, enabled: true } : entry,
      ),
    }));
    const second = updateFaithPreferences((current) => ({
      prayerNotifications: current.prayerNotifications.map((entry) =>
        entry.prayer === 'asr' ? { ...entry, enabled: true } : entry,
      ),
    }));
    await Promise.all([first, second]);

    const enabled = getFaithPreferencesSnapshot()
      .preferences.prayerNotifications.filter((entry) => entry.enabled)
      .map((entry) => entry.prayer);
    expect(enabled).toEqual(expect.arrayContaining(['fajr', 'asr']));
  });

  it('persists through storage rather than only in memory', async () => {
    await hydrateFaithPreferences();
    await updateFaithPreferences({ prayerNotificationsEnabled: true });

    const raw = await AsyncStorage.getItem(faithStorageKeys.preferences);
    expect(JSON.parse(raw ?? '{}')).toMatchObject({ prayerNotificationsEnabled: true });
  });

  it('reports a write the device refused instead of swallowing it', async () => {
    await hydrateFaithPreferences();
    const setItem = jest
      .spyOn(AsyncStorage, 'setItem')
      .mockRejectedValueOnce(new Error('no space'));

    await updateFaithPreferences({ prayerNotificationsEnabled: true });

    const snapshot = getFaithPreferencesSnapshot();
    /* The value the user asked for is still what the app shows… */
    expect(snapshot.preferences.prayerNotificationsEnabled).toBe(true);
    /* …and the fact that it did not reach the device is stated rather than hidden. */
    expect(snapshot.persistenceError).not.toBeNull();

    setItem.mockRestore();
    /* And a later successful write clears the report. */
    await updateFaithPreferences({ prayerNotificationsEnabled: false });
    expect(getFaithPreferencesSnapshot().persistenceError).toBeNull();
  });
});
