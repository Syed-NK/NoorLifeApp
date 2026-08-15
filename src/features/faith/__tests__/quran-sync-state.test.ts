import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  clearSyncCheckpoint,
  commitSync,
  emptyCheckpoint,
  readSyncCheckpoint,
  recordSyncFailure,
  SYNC_INTERVAL_MS,
  syncDue,
} from '../storage/faith-sync-checkpoint';
import {
  applyRowMutations,
  readSyncedRecitations,
  readSyncedTranslations,
  replaceSyncedRecitations,
  replaceSyncedTranslations,
  SYNC_ROWS_VERSION,
  type RecitationRow,
  type TranslationRow,
} from '../storage/faith-sync-rows';

/**
 * The local half of the Content Sync obligation.
 *
 * ── The property everything here protects ───────────────────────────────────
 * A sync token is not a bookmark. Presenting one asks the vendor "what changed **since** this
 * point", so storing a token before the work it covers is finished does not delay those mutations —
 * it loses them. Nothing will ever offer them again, and the local copy silently diverges from the
 * publisher's, which is the exact failure the sync obligation exists to prevent.
 *
 * So most of what follows is about *not* advancing: a failed run keeps its token, a rejected token
 * clears rather than repeats, and a filter change invalidates rather than reuses.
 */

const FILTER = 'recitations:3;translations:85';
const OTHER_FILTER = 'recitations:3';
const NOW = 1_786_000_000_000;

const translationRow = (ayah: number, text: string, sequence: number | null): TranslationRow => ({
  verseKey: `93:${ayah}`,
  surah: 93,
  ayah,
  text,
  resourceId: 85,
  sequence,
  refreshedAt: NOW,
});

const recitationRow = (ayah: number, over: Partial<RecitationRow> = {}): RecitationRow => ({
  verseKey: `93:${ayah}`,
  resourceId: 3,
  surah: 93,
  ayah,
  durationSeconds: null,
  bytes: null,
  sequence: null,
  refreshedAt: NOW,
  ...over,
});

beforeEach(async () => {
  await AsyncStorage.clear();
});

// ─────────────────────────────────────────────────────────────────────────────
// The checkpoint
// ─────────────────────────────────────────────────────────────────────────────

describe('the sync checkpoint', () => {
  it('starts with no token, so the first run bootstraps', async () => {
    const checkpoint = await readSyncCheckpoint(FILTER);

    expect(checkpoint).toEqual(emptyCheckpoint(FILTER));
    expect(checkpoint.syncToken).toBeNull();
    expect(syncDue(checkpoint, NOW)).toBe(true);
  });

  it('stores a token only through a completed run', async () => {
    expect(
      await commitSync({
        resources: FILTER,
        syncToken: 'tok_1',
        syncedUntilSequence: 4200,
        at: NOW,
      }),
    ).toBe(true);

    const checkpoint = await readSyncCheckpoint(FILTER);
    expect(checkpoint.syncToken).toBe('tok_1');
    expect(checkpoint.syncedUntilSequence).toBe(4200);
    expect(checkpoint.lastSyncedAt).toBe(NOW);
    expect(checkpoint.lastFailure).toBeNull();
  });

  it('keeps the previous token when a run fails', async () => {
    await commitSync({ resources: FILTER, syncToken: 'tok_1', syncedUntilSequence: 10, at: NOW });
    const before = await readSyncCheckpoint(FILTER);

    await recordSyncFailure(before, 'offline', NOW + 1000);
    const after = await readSyncCheckpoint(FILTER);

    /*
      The whole point. A failed run must leave the next one asking the same question, so a page that
      was fetched but not fully applied is delivered again rather than skipped.
    */
    expect(after.syncToken).toBe('tok_1');
    expect(after.syncedUntilSequence).toBe(10);
    expect(after.lastFailure).toBe('offline');
    expect(after.failedAt).toBe(NOW + 1000);
  });

  it('clears the token when the vendor rejects it, so the next run bootstraps', async () => {
    await commitSync({ resources: FILTER, syncToken: 'tok_1', syncedUntilSequence: 10, at: NOW });
    const before = await readSyncCheckpoint(FILTER);

    await recordSyncFailure(before, 'stale-token', NOW + 1000);
    const after = await readSyncCheckpoint(FILTER);

    /*
      The one failure that does not preserve the token. Retrying with a token the server has refused
      would fail identically for ever; the vendor's own guidance is to bootstrap again.
    */
    expect(after.syncToken).toBeNull();
    expect(after.lastFailure).toBe('stale-token');
    expect(syncDue(after, NOW + 1000)).toBe(true);
  });

  it('clears the failure once a run succeeds', async () => {
    await recordSyncFailure(emptyCheckpoint(FILTER), 'rate-limited', NOW);
    await commitSync({
      resources: FILTER,
      syncToken: 'tok_2',
      syncedUntilSequence: 99,
      at: NOW + 5,
    });

    const checkpoint = await readSyncCheckpoint(FILTER);
    expect(checkpoint.lastFailure).toBeNull();
    expect(checkpoint.failedAt).toBeNull();
  });

  it('refuses a token stored under a different canonical filter', async () => {
    await commitSync({
      resources: OTHER_FILTER,
      syncToken: 'tok_1',
      syncedUntilSequence: 1,
      at: NOW,
    });

    const checkpoint = await readSyncCheckpoint(FILTER);

    /*
      The vendor derives a token from its filter. Presenting one against a different scope is at best
      rejected and at worst answers for the wrong resources, so a filter change invalidates rather
      than reuses — and the caller cannot forget to check, because the read does it.
    */
    expect(checkpoint.syncToken).toBeNull();
    expect(checkpoint.resources).toBe(FILTER);
  });

  it('reports a check as due once the seven-day interval has elapsed', async () => {
    await commitSync({ resources: FILTER, syncToken: 'tok_1', syncedUntilSequence: 1, at: NOW });
    const checkpoint = await readSyncCheckpoint(FILTER);

    expect(syncDue(checkpoint, NOW + SYNC_INTERVAL_MS - 1)).toBe(false);
    expect(syncDue(checkpoint, NOW + SYNC_INTERVAL_MS)).toBe(true);
  });

  it('treats a clock that moved backwards as due rather than as fresh', () => {
    /*
      Failing toward a check. A device whose clock jumped back would otherwise report itself
      synchronised for as long as the jump lasted, which is the one direction this must not fail in.
    */
    const checkpoint = { ...emptyCheckpoint(FILTER), syncToken: 'tok_1', lastSyncedAt: NOW };
    expect(syncDue(checkpoint, NOW - 1000)).toBe(true);
  });

  it('discards the checkpoint entirely on request', async () => {
    await commitSync({ resources: FILTER, syncToken: 'tok_1', syncedUntilSequence: 1, at: NOW });
    await clearSyncCheckpoint();

    expect((await readSyncCheckpoint(FILTER)).syncToken).toBeNull();
  });

  it('discards a checkpoint written by an older schema', async () => {
    await AsyncStorage.setItem(
      'noorlife.faith.quran.sync-checkpoint',
      JSON.stringify({ version: 0, resources: FILTER, syncToken: 'tok_old' }),
    );

    /* A wrong token is worse than no token, so a version mismatch discards rather than migrates. */
    expect((await readSyncCheckpoint(FILTER)).syncToken).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Rows
// ─────────────────────────────────────────────────────────────────────────────

describe('the synchronised row stores', () => {
  it('round-trips translation rows with their attribution', async () => {
    await replaceSyncedTranslations({
      version: SYNC_ROWS_VERSION,
      resourceId: 85,
      attribution: { resourceId: 85, name: 'M.A.S. Abdel Haleem', translator: 'Abdul Haleem' },
      rows: [translationRow(1, 'By the morning brightness', 10)],
      syncedAt: NOW,
    });

    const stored = await readSyncedTranslations();
    expect(stored?.rows).toHaveLength(1);
    expect(stored?.rows[0]?.text).toBe('By the morning brightness');
    /* A licence condition: the translation may only be shown with the translator named. */
    expect(stored?.attribution?.translator).toBe('Abdul Haleem');
  });

  it('round-trips recitation rows and stores no URL', async () => {
    await replaceSyncedRecitations({
      version: SYNC_ROWS_VERSION,
      resourceId: 3,
      rows: [recitationRow(1, { durationSeconds: 5, bytes: 30_730 })],
      syncedAt: NOW,
    });

    const stored = await readSyncedRecitations();
    expect(stored?.rows[0]).toMatchObject({
      surah: 93,
      ayah: 1,
      durationSeconds: 5,
      bytes: 30_730,
    });
    /*
      A CDN address can be rotated or re-signed, so identity must not depend on one. The shape has
      nowhere to put a URL, which is stronger than a rule about not writing one.
    */
    expect(JSON.stringify(stored)).not.toContain('http');
  });

  it('refuses a row whose verse key disagrees with its numbers', async () => {
    await replaceSyncedRecitations({
      version: SYNC_ROWS_VERSION,
      resourceId: 3,
      rows: [{ ...recitationRow(1), verseKey: '93:9' }],
      syncedAt: NOW,
    });

    /*
      An ambiguous identity is a verse that could be played in the wrong place, and nothing further
      down could detect it — so the whole store is discarded at the boundary rather than repaired.
    */
    expect(await readSyncedRecitations()).toBeNull();
  });

  it('refuses a row for an impossible surah or ayah', async () => {
    await replaceSyncedTranslations({
      version: SYNC_ROWS_VERSION,
      resourceId: 85,
      attribution: null,
      rows: [{ ...translationRow(1, 'x', null), surah: 115, verseKey: '115:1' }],
      syncedAt: NOW,
    });

    expect(await readSyncedTranslations()).toBeNull();
  });

  it('replaces rather than merges, so a removed row is actually removed', async () => {
    await replaceSyncedTranslations({
      version: SYNC_ROWS_VERSION,
      resourceId: 85,
      attribution: null,
      rows: [translationRow(1, 'first', 1), translationRow(2, 'second', 2)],
      syncedAt: NOW,
    });
    await replaceSyncedTranslations({
      version: SYNC_ROWS_VERSION,
      resourceId: 85,
      attribution: null,
      rows: [translationRow(1, 'first', 1)],
      syncedAt: NOW + 1,
    });

    /*
      What a snapshot means: `RESOURCE_INVALIDATE` says replace all local rows. Merging would keep
      rows the vendor has removed, which is the deletion half of the obligation quietly ignored.
    */
    const stored = await readSyncedTranslations();
    expect(stored?.rows.map((row) => row.ayah)).toEqual([1]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Applying mutations
// ─────────────────────────────────────────────────────────────────────────────

describe('applying row mutations', () => {
  const rows = [translationRow(1, 'first', 1), translationRow(2, 'second', 2)];

  it('inserts, replaces and deletes by verse key', () => {
    const next = applyRowMutations(rows, [
      { kind: 'upsert', verseKey: '93:3', sequence: 3, row: translationRow(3, 'third', 3) },
      { kind: 'upsert', verseKey: '93:1', sequence: 4, row: translationRow(1, 'corrected', 4) },
      { kind: 'delete', verseKey: '93:2', sequence: 5 },
    ]);

    expect(next.map((row) => row.ayah)).toEqual([1, 3]);
    expect(next[0]?.text).toBe('corrected');
  });

  it('applies mutations in sequence order, not arrival order', () => {
    /*
      A page can carry a create and a later delete for the same key. Arrival order happens to be
      right most of the time and is wrong exactly when it matters, so the order is applied.
    */
    const next = applyRowMutations(rows, [
      { kind: 'delete', verseKey: '93:1', sequence: 9 },
      { kind: 'upsert', verseKey: '93:1', sequence: 5, row: translationRow(1, 'resurrected', 5) },
    ]);

    expect(next.map((row) => row.ayah)).toEqual([2]);
  });

  it('applies a create then update then delete as one net removal', () => {
    const next = applyRowMutations(
      [],
      [
        { kind: 'upsert', verseKey: '93:7', sequence: 1, row: translationRow(7, 'a', 1) },
        { kind: 'upsert', verseKey: '93:7', sequence: 2, row: translationRow(7, 'b', 2) },
        { kind: 'delete', verseKey: '93:7', sequence: 3 },
      ],
    );

    expect(next).toEqual([]);
  });

  it('returns rows in verse order whatever order they arrived in', () => {
    const next = applyRowMutations(
      [],
      [
        { kind: 'upsert', verseKey: '93:11', sequence: 1, row: translationRow(11, 'k', 1) },
        { kind: 'upsert', verseKey: '93:2', sequence: 2, row: translationRow(2, 'b', 2) },
        { kind: 'upsert', verseKey: '93:9', sequence: 3, row: translationRow(9, 'i', 3) },
      ],
    );

    /* Numeric, not lexicographic: 2 before 9 before 11, which a string sort would get wrong. */
    expect(next.map((row) => row.ayah)).toEqual([2, 9, 11]);
  });

  it('keeps a mutation the vendor gave no sequence for, applying it last', () => {
    const next = applyRowMutations(rows, [
      {
        kind: 'upsert',
        verseKey: '93:1',
        sequence: null,
        row: translationRow(1, 'unsequenced', null),
      },
      { kind: 'upsert', verseKey: '93:1', sequence: 100, row: translationRow(1, 'sequenced', 100) },
    ]);

    /* Dropping it would lose a change, which is the one outcome that cannot be recovered from. */
    expect(next[0]?.text).toBe('unsequenced');
  });
});
