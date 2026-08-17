import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  deferLegacyDecision,
  drainLegacyQuarantineQueueForTest,
  hasPendingLegacyChoice,
  importLegacyQuarantine,
  LEGACY_PERSONAL_KEY_NAMES,
  LEGACY_QUARANTINE_KEY_FOR_TESTS,
  LEGACY_QUARANTINE_VERSION,
  readLegacyDecision,
  readLegacyQuarantineSummary,
  removeLegacyQuarantine,
  sweepLegacyFaithData,
} from '../storage/faith-legacy-quarantine';
import { faithStorageKeys, readJson, resolveFaithAddress } from '../storage/faith-storage';
import { resetFaithScopeForTest, setActiveFaithScope } from '../storage/faith-user-scope';
import { TEST_FAITH_USER_ID } from '@/test-support/faith-storage-address';

/**
 * Moving Faith data of unknown ownership without giving it to the wrong person.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── What is actually being tested ──────────────────────────────────────────
 * Not "does the data move". The interesting properties are all about what happens when things go
 * wrong or when two people share a phone: that a crash at any point loses nothing, that a failed
 * import keeps the original, that a second run does not duplicate or destroy, and that user B
 * cannot see what user A imported.
 *
 * Every case here plants its own fixture. Nothing touches a real install's data, which is why this
 * suite could be written and run while an emulator held a signed-in session and a gigabyte of
 * downloads.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const USER_A = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const USER_B = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const CAPTURED_AT = 1_700_000_000_000;

/** Plants values at the pre-partitioning addresses, exactly as an older build left them. */
async function plantLegacyData(): Promise<void> {
  await AsyncStorage.multiSet([
    [faithStorageKeys.bookmarks, JSON.stringify([{ surah: 2, ayah: 255 }])],
    [faithStorageKeys.quranNotes, JSON.stringify([{ key: '2:255', text: 'a private note' }])],
    [faithStorageKeys.tasbihLabels, JSON.stringify(['A private counter'])],
    [faithStorageKeys.location, JSON.stringify({ version: 3, label: 'A private city' })],
  ]);
}

async function quarantineRaw(): Promise<Record<string, unknown> | null> {
  const raw = await AsyncStorage.getItem(LEGACY_QUARANTINE_KEY_FOR_TESTS);
  return raw === null ? null : (JSON.parse(raw) as Record<string, unknown>);
}

beforeEach(async () => {
  await AsyncStorage.clear();
  await drainLegacyQuarantineQueueForTest();
  setActiveFaithScope(USER_A);
});

afterEach(async () => {
  await drainLegacyQuarantineQueueForTest();
  setActiveFaithScope(TEST_FAITH_USER_ID);
});

describe('detection', () => {
  it('finds nothing on an install that never had unscoped data', async () => {
    expect(await sweepLegacyFaithData(CAPTURED_AT)).toBe('nothing');
    expect(await readLegacyQuarantineSummary()).toBeNull();
  });

  it('captures every legacy personal key that is present', async () => {
    await plantLegacyData();
    expect(await sweepLegacyFaithData(CAPTURED_AT)).toBe('captured');

    const summary = await readLegacyQuarantineSummary();
    expect(summary).toEqual({ capturedAt: CAPTURED_AT, categoryCount: 4 });
  });

  it('looks for exactly the keys a pre-partitioning install could hold', () => {
    /*
      Frozen on purpose, and different from `USER_SCOPED_KEY_NAMES`. That list grows whenever a
      personal key is added; this one cannot, because a key introduced after partitioning has no
      legacy address to sweep. `legacyDecision` is the first such key and is correctly absent.
    */
    expect([...LEGACY_PERSONAL_KEY_NAMES]).not.toContain('legacyDecision');
    expect(LEGACY_PERSONAL_KEY_NAMES).toHaveLength(13);
  });
});

describe('quarantine', () => {
  it('takes the values out of reach of every account', async () => {
    await plantLegacyData();
    await sweepLegacyFaithData(CAPTURED_AT);

    /* Nothing left at an address any reader can name. */
    const keys = await AsyncStorage.getAllKeys();
    for (const name of LEGACY_PERSONAL_KEY_NAMES) {
      expect(keys).not.toContain(faithStorageKeys[name]);
    }
    /* And nothing under either account's namespace, because nobody has agreed to anything. */
    expect(keys.filter((key) => key.startsWith('noorlife.faith.user.v1.'))).toEqual([]);
  });

  it('holds no Qur’an, translation or audio payload', async () => {
    /*
      Publisher content is device-wide and stays exactly where it is. A quarantine that swept it up
      would strand a published generation and a gigabyte of installed recitation behind a prompt
      about bookmarks.
    */
    await plantLegacyData();
    await AsyncStorage.setItem(
      faithStorageKeys.quranSyncedTranslations,
      JSON.stringify([{ verseKey: '1:1', text: 'publisher text' }]),
    );
    await AsyncStorage.setItem(
      faithStorageKeys.quranGenerationPointer,
      JSON.stringify({ version: 1, generationId: 'gen-x' }),
    );

    await sweepLegacyFaithData(CAPTURED_AT);

    const bundle = await quarantineRaw();
    const serialised = JSON.stringify(bundle);
    expect(serialised).not.toContain('publisher text');
    expect(serialised).not.toContain('gen-x');
    /* And the publisher keys are untouched at their own addresses. */
    expect(await AsyncStorage.getItem(faithStorageKeys.quranGenerationPointer)).not.toBeNull();
  });

  it('is invisible to every repository until a decision is made', async () => {
    await plantLegacyData();
    await sweepLegacyFaithData(CAPTURED_AT);

    const bookmarks = await readJson<unknown[]>(
      faithStorageKeys.bookmarks,
      [],
      (v): v is unknown[] => Array.isArray(v),
    );
    expect(bookmarks).toEqual([]);

    setActiveFaithScope(USER_B);
    expect(
      await readJson<unknown[]>(faithStorageKeys.bookmarks, [], (v): v is unknown[] =>
        Array.isArray(v),
      ),
    ).toEqual([]);
  });

  it('exposes counts and a date, and no value of any kind', async () => {
    /*
      The preview *is* the breach: showing "2:255 — a private note" to help somebody decide whether
      the data is theirs discloses it to somebody who may not be its owner. The summary type is the
      enforcement, and this asserts nothing leaks through it.
    */
    await plantLegacyData();
    await sweepLegacyFaithData(CAPTURED_AT);

    const summary = await readLegacyQuarantineSummary();
    const serialised = JSON.stringify(summary);
    expect(serialised).not.toContain('a private note');
    expect(serialised).not.toContain('A private counter');
    expect(serialised).not.toContain('A private city');
    expect(Object.keys(summary ?? {}).sort()).toEqual(['capturedAt', 'categoryCount']);
  });
});

describe('crash safety', () => {
  it('loses nothing when the process dies after capture and before the sweep', async () => {
    /*
      The one window that exists: the bundle is written in a single `setItem` and the originals are
      removed afterwards. A crash between leaves both copies, which is the safe direction.
    */
    await plantLegacyData();
    const captured = await AsyncStorage.multiGet([
      faithStorageKeys.bookmarks,
      faithStorageKeys.quranNotes,
      faithStorageKeys.tasbihLabels,
      faithStorageKeys.location,
    ]);
    await AsyncStorage.setItem(
      LEGACY_QUARANTINE_KEY_FOR_TESTS,
      JSON.stringify({
        version: LEGACY_QUARANTINE_VERSION,
        capturedAt: CAPTURED_AT,
        entries: Object.fromEntries(
          captured.map(([key, value]) => [key.replace('noorlife.faith.', ''), value]),
        ),
      }),
    );

    /* Relaunch. */
    expect(await sweepLegacyFaithData(CAPTURED_AT + 1)).toBe('swept');

    const summary = await readLegacyQuarantineSummary();
    expect(summary?.categoryCount).toBe(4);
    /* The original capture time survives — the second run did not re-stamp it. */
    expect(summary?.capturedAt).toBe(CAPTURED_AT);
    const keys = await AsyncStorage.getAllKeys();
    expect(keys).not.toContain(faithStorageKeys.bookmarks);
  });

  it('leaves the originals in place when the capture write itself fails', async () => {
    /*
      Removing without a durable copy is the one outcome that actually destroys data. If the bundle
      cannot be written the device stays exactly as it was — unscoped, which is where it already
      was, and not worse.
    */
    await plantLegacyData();
    /*
      The mock's own one-shot override, rather than a spy that is restored afterwards.

      Restoring a spy taken over a module mock's own `jest.fn` leaves AsyncStorage subtly broken for
      every later case in this file. The symptom is not an error: it is a sweep three tests further
      down that silently captures nothing, which reads exactly like a bug in the code under test. A
      `…Once` override cleans itself up after the call it is meant for.
    */
    (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('full'));

    expect(await sweepLegacyFaithData(CAPTURED_AT)).toBe('nothing');
    expect(await AsyncStorage.getItem(faithStorageKeys.bookmarks)).not.toBeNull();
    expect(await quarantineRaw()).toBeNull();
  });

  it('never overwrites a bundle the user has already been asked about', async () => {
    await plantLegacyData();
    await sweepLegacyFaithData(CAPTURED_AT);

    /* Something writes an unscoped key again — an older build left running, a rollback. */
    await AsyncStorage.setItem(faithStorageKeys.bookmarks, JSON.stringify(['late']));
    await sweepLegacyFaithData(CAPTURED_AT + 5_000);

    const bundle = await quarantineRaw();
    expect(bundle?.capturedAt).toBe(CAPTURED_AT);
    expect(Object.keys((bundle?.entries ?? {}) as object)).toHaveLength(4);
    expect(await AsyncStorage.getItem(faithStorageKeys.bookmarks)).toBeNull();
  });

  it('is idempotent across many launches', async () => {
    await plantLegacyData();
    await sweepLegacyFaithData(CAPTURED_AT);
    const first = await quarantineRaw();

    for (let launch = 0; launch < 5; launch += 1) {
      await sweepLegacyFaithData(CAPTURED_AT + launch);
    }

    expect(await quarantineRaw()).toEqual(first);
  });

  it('serialises concurrent callers instead of interleaving them', async () => {
    /*
      Two launches racing — a warm start while a cold one is still sweeping. Queued rather than
      skipped: a skip would report "done" for work that never happened.
    */
    await plantLegacyData();
    const outcomes = await Promise.all([
      sweepLegacyFaithData(CAPTURED_AT),
      sweepLegacyFaithData(CAPTURED_AT),
      sweepLegacyFaithData(CAPTURED_AT),
    ]);

    expect(outcomes.filter((outcome) => outcome === 'captured')).toHaveLength(1);
    expect(Object.keys(((await quarantineRaw())?.entries ?? {}) as object)).toHaveLength(4);
  });
});

describe('import', () => {
  it('moves the values into the account that asked, and nowhere else', async () => {
    await plantLegacyData();
    await sweepLegacyFaithData(CAPTURED_AT);

    const outcome = await importLegacyQuarantine();
    expect(outcome).toEqual({ kind: 'imported', categoryCount: 4, skipped: 0 });

    const bookmarks = await readJson<{ ayah: number }[]>(
      faithStorageKeys.bookmarks,
      [],
      (v): v is { ayah: number }[] => Array.isArray(v),
    );
    expect(bookmarks[0]?.ayah).toBe(255);
  });

  it('deletes the quarantine only after reading back what it wrote', async () => {
    await plantLegacyData();
    await sweepLegacyFaithData(CAPTURED_AT);
    await importLegacyQuarantine();

    expect(await quarantineRaw()).toBeNull();
    expect(await readLegacyDecision()).toBe('imported');
  });

  it('keeps the quarantine when the read-back disagrees', async () => {
    /*
      A storage layer that resolves a write and then serves nothing back would otherwise leave the
      user with neither the imported copy nor the quarantined original. The bundle survives, so the
      cost is a retry rather than the data.
    */
    await plantLegacyData();
    await sweepLegacyFaithData(CAPTURED_AT);

    /*
      The write is made to *resolve without storing anything*, which is the realistic version of
      this failure: a storage layer that reports success and serves nothing back. Faking the
      read-back instead would prove only that the comparison runs; faking the write proves the
      comparison catches a write that genuinely did not land.
    */
    (AsyncStorage.multiSet as unknown as jest.Mock).mockResolvedValueOnce(undefined);

    expect(await importLegacyQuarantine()).toEqual({ kind: 'validation-failed' });

    expect(await quarantineRaw()).not.toBeNull();
    expect(await readLegacyDecision()).toBeNull();
  });

  it('does not overwrite data this account already authored', async () => {
    /*
      Legacy data is of unknown origin; this account's own data is not. When they collide the known
      owner wins, or an import would destroy what somebody definitely wrote in order to install what
      they merely agreed to adopt.
    */
    await plantLegacyData();
    await sweepLegacyFaithData(CAPTURED_AT);
    await AsyncStorage.setItem(
      resolveFaithAddress(faithStorageKeys.bookmarks)!,
      JSON.stringify([{ surah: 18, ayah: 10 }]),
    );

    const outcome = await importLegacyQuarantine();
    expect(outcome).toEqual({ kind: 'imported', categoryCount: 3, skipped: 1 });

    const bookmarks = await readJson<{ ayah: number }[]>(
      faithStorageKeys.bookmarks,
      [],
      (v): v is { ayah: number }[] => Array.isArray(v),
    );
    expect(bookmarks[0]?.ayah).toBe(10);
  });

  it('refuses when nobody is signed in', async () => {
    await plantLegacyData();
    await sweepLegacyFaithData(CAPTURED_AT);
    resetFaithScopeForTest();

    expect(await importLegacyQuarantine()).toEqual({ kind: 'no-owner' });
    expect(await quarantineRaw()).not.toBeNull();
  });
});

describe('remove and defer', () => {
  it('permanently deletes the quarantine on remove', async () => {
    await plantLegacyData();
    await sweepLegacyFaithData(CAPTURED_AT);

    expect(await removeLegacyQuarantine()).toBe(true);
    expect(await quarantineRaw()).toBeNull();
    expect(await readLegacyDecision()).toBe('removed');
    expect(await hasPendingLegacyChoice()).toBe(false);
  });

  it('writes no decision on “decide later”, so the question returns', async () => {
    /*
      Persisting a "later" would make it an answer and the prompt would never come back. The bundle
      stays quarantined and invisible in the meantime.
    */
    await plantLegacyData();
    await sweepLegacyFaithData(CAPTURED_AT);
    await deferLegacyDecision();

    expect(await readLegacyDecision()).toBeNull();
    expect(await quarantineRaw()).not.toBeNull();
    expect(await hasPendingLegacyChoice()).toBe(true);
  });

  it('asks nobody when nobody is signed in', async () => {
    await plantLegacyData();
    await sweepLegacyFaithData(CAPTURED_AT);
    resetFaithScopeForTest();

    expect(await hasPendingLegacyChoice()).toBe(false);
  });
});

describe('two accounts on one phone', () => {
  it('does not show user B what user A imported', async () => {
    await plantLegacyData();
    await sweepLegacyFaithData(CAPTURED_AT);
    await importLegacyQuarantine();

    setActiveFaithScope(USER_B);

    expect(
      await readJson<unknown[]>(faithStorageKeys.bookmarks, [], (v): v is unknown[] =>
        Array.isArray(v),
      ),
    ).toEqual([]);
    expect(
      await readJson<unknown[]>(faithStorageKeys.quranNotes, [], (v): v is unknown[] =>
        Array.isArray(v),
      ),
    ).toEqual([]);
    /* And there is no quarantine left to offer B either — A took it. */
    expect(await hasPendingLegacyChoice()).toBe(false);
  });

  it('does not let user A’s “decide later” answer for user B', async () => {
    /*
      The decision key is itself scoped, which is what makes the question reopen. B gets the same
      neutral choice A deferred — the data's owner is still unknown, and B is as entitled to be
      asked as A was.
    */
    await plantLegacyData();
    await sweepLegacyFaithData(CAPTURED_AT);
    await deferLegacyDecision();

    setActiveFaithScope(USER_B);
    expect(await hasPendingLegacyChoice()).toBe(true);
  });

  it('does not let user A’s removal be undone by user B', async () => {
    await plantLegacyData();
    await sweepLegacyFaithData(CAPTURED_AT);
    await removeLegacyQuarantine();

    setActiveFaithScope(USER_B);
    expect(await hasPendingLegacyChoice()).toBe(false);
    expect(await quarantineRaw()).toBeNull();
  });

  it('keeps each account’s decision separate', async () => {
    await plantLegacyData();
    await sweepLegacyFaithData(CAPTURED_AT);
    await importLegacyQuarantine();
    expect(await readLegacyDecision()).toBe('imported');

    setActiveFaithScope(USER_B);
    expect(await readLegacyDecision()).toBeNull();
  });
});
