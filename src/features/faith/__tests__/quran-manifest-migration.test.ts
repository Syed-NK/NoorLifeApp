import type { AudioStore, StoredAudioFile } from '@features/faith/data/audio/audio-store.port';
import { audioFileName, MIN_AUDIO_BYTES } from '@features/faith/data/audio/audio-store.port';
import {
  manifestIsAuthoritative,
  migrateLegacyAudio,
} from '@features/faith/data/audio/manifest-migration';
import {
  clearAudioManifest,
  findRow,
  isPlayable,
  readAudioManifest,
  writeAudioManifest,
} from '@features/faith/storage/faith-audio-manifest';
import type { RecitationRow } from '@features/faith/storage/faith-sync-rows';
import {
  clearAllGenerations,
  publishGeneration,
} from '@features/faith/storage/faith-sync-generation';
import { mockFileSystem } from '@/../jest.setup';

/** Publishes a generation carrying the given recitation rows, so identities can be proved. */
async function publishRows(rows: readonly RecitationRow[]): Promise<void> {
  const outcome = await publishGeneration({
    generationId: 'gen-migration',
    createdAt: NOW,
    feed: {
      resources: 'recitations:3;translations:85',
      syncToken: 'tok_migration',
      syncedUntilSequence: 1,
    },
    translations: { resourceId: 85, attribution: null, rows: [] },
    recitations: { resourceId: 3, rows },
    recitation: { lastCheckedAt: NOW, method: 'snapshot', mutationEverObserved: false },
  });
  if (outcome.kind !== 'published') {
    throw new Error('the seed generation did not publish');
  }
}

/**
 * The migration off filename probing — Generation 1 retired in one commit.
 *
 * ── The property that matters most here is an absence ───────────────────────
 * **No valid file is ever downloaded again, and no valid file is ever deleted.** Adoption is a
 * bookkeeping operation: it reads what is on disk, proves each identity against a synchronised
 * recitation row, and writes a manifest. Nothing in this path fetches, and nothing removes.
 *
 * ── The second property is that a guess is never trusted ────────────────────
 * A filename is the only identity these files have, and it is not evidence. Every case below that
 * ends in a rejection is a file whose name said something nothing corroborated — and every one of
 * them stays on disk, because deleting a user's audio on the strength of a failed inference would be
 * a worse error than leaving it unadopted.
 */

const NOW = 1_700_000_000_000;
const SUDAIS = '3';
const GOOD_BYTES = MIN_AUDIO_BYTES * 10;

function syncedRow(surah: number, ayah: number): RecitationRow {
  return {
    verseKey: `${surah}:${ayah}`,
    resourceId: 3,
    surah,
    ayah,
    durationSeconds: 5,
    bytes: GOOD_BYTES,
    sequence: 42,
    refreshedAt: NOW - 1000,
  };
}

/**
 * A store backed by a plain map, so the awkward cases are reachable.
 *
 * `read` returning `null` for a name `list` reported is the listed-then-reclaimed case, and it is a
 * real one: the two are separate calls against a filesystem the OS may reclaim between them.
 */
function fakeStore(
  files: readonly { readonly name: string; readonly bytes: number }[],
  options: { readonly unreadable?: readonly string[] } = {},
): AudioStore & { readonly downloads: number; readonly removals: string[] } {
  const unreadable = new Set(options.unreadable ?? []);
  const removals: string[] = [];
  const stored = files.map<StoredAudioFile>((file) => ({
    name: file.name,
    uri: `file:///audio/${file.name}`,
    bytes: file.bytes,
    storedAt: NOW - 5000,
  }));
  return {
    downloads: 0,
    removals,
    list: () => stored,
    read: (name) =>
      unreadable.has(name) ? null : (stored.find((file) => file.name === name) ?? null),
    remove: (name) => {
      removals.push(name);
    },
    download: () => {
      throw new Error('the migration must never download');
    },
    sweepIncomplete: () => {},
    availableBytes: () => 8_000_000_000,
  };
}

beforeEach(async () => {
  mockFileSystem.reset();
  await clearAudioManifest();
  await clearAllGenerations();
});

describe('adopting existing files', () => {
  it('adopts every file whose identity a synchronised row corroborates', async () => {
    await publishRows([syncedRow(93, 1), syncedRow(93, 2)]);
    const store = fakeStore([
      { name: audioFileName(SUDAIS, 93, 1), bytes: GOOD_BYTES },
      { name: audioFileName(SUDAIS, 93, 2), bytes: GOOD_BYTES },
    ]);

    const outcome = await migrateLegacyAudio({ store, now: () => NOW });

    expect(outcome).toMatchObject({ kind: 'migrated', adopted: 2, rejected: 0 });
    const manifest = await readAudioManifest();
    expect(manifest.rows).toHaveLength(2);
    expect(findRow(manifest, SUDAIS, 93, 1)?.recordKey).toBe('93:1');
    expect(manifest.rows.every((row) => row.reciterId === SUDAIS)).toBe(true);
  });

  it('never downloads and never removes while adopting', async () => {
    /*
      The whole point of adoption: bytes already on the device are re-described, not re-fetched. The
      store's `download` throws, so any fetch would fail this test loudly.
    */
    await publishRows([syncedRow(1, 1)]);
    const store = fakeStore([{ name: audioFileName(SUDAIS, 1, 1), bytes: GOOD_BYTES }]);

    await expect(migrateLegacyAudio({ store, now: () => NOW })).resolves.toMatchObject({
      kind: 'migrated',
    });
    expect(store.removals).toEqual([]);
  });

  it('adopts as downloaded rather than available, so nothing is playable unverified', async () => {
    /*
      Bytes having arrived is not the same as bytes having been checked. A migrated file goes through
      verification like any other rather than being promoted on the strength of having existed before.
    */
    await publishRows([syncedRow(1, 1)]);
    const store = fakeStore([{ name: audioFileName(SUDAIS, 1, 1), bytes: GOOD_BYTES }]);

    await migrateLegacyAudio({ store, now: () => NOW });

    const row = findRow(await readAudioManifest(), SUDAIS, 1, 1);
    expect(row?.state).toBe('downloaded');
    expect(isPlayable(row)).toBe(false);
    /* And no integrity value is invented for a file that never had one. */
    expect(row?.integrity).toBeNull();
    expect(row?.downloadedAt).toBeNull();
  });
});

describe('files that cannot be proved', () => {
  it('leaves an unprovable file on disk rather than deleting it', async () => {
    await publishRows([syncedRow(1, 1)]);
    /* Surah 2 was never synchronised, so nothing corroborates this name. */
    const store = fakeStore([
      { name: audioFileName(SUDAIS, 1, 1), bytes: GOOD_BYTES },
      { name: audioFileName(SUDAIS, 2, 1), bytes: GOOD_BYTES },
    ]);

    const outcome = await migrateLegacyAudio({ store, now: () => NOW });

    expect(outcome).toMatchObject({ kind: 'migrated', adopted: 1, rejected: 1 });
    expect(store.removals).toEqual([]);
    expect(findRow(await readAudioManifest(), SUDAIS, 2, 1)).toBeNull();
  });

  it('rejects a file below the audio size floor', async () => {
    await publishRows([syncedRow(1, 1)]);
    const store = fakeStore([{ name: audioFileName(SUDAIS, 1, 1), bytes: MIN_AUDIO_BYTES - 1 }]);

    const outcome = await migrateLegacyAudio({ store, now: () => NOW });

    expect(outcome).toMatchObject({ kind: 'migrated', adopted: 0 });
    expect(outcome.kind === 'migrated' && outcome.rejections['too-small']).toBe(1);
  });

  it('rejects a file listed and then unreadable', async () => {
    /* Two calls against a filesystem the OS may reclaim between them. Not adopted with a guessed size. */
    await publishRows([syncedRow(1, 1)]);
    const name = audioFileName(SUDAIS, 1, 1);
    const store = fakeStore([{ name, bytes: GOOD_BYTES }], { unreadable: [name] });

    const outcome = await migrateLegacyAudio({ store, now: () => NOW });

    expect(outcome).toMatchObject({ kind: 'migrated', adopted: 0 });
    expect(outcome.kind === 'migrated' && outcome.rejections.missing).toBe(1);
  });

  it('rejects a name it cannot parse', async () => {
    await publishRows([syncedRow(1, 1)]);
    const store = fakeStore([{ name: 'something-else.mp3', bytes: GOOD_BYTES }]);

    const outcome = await migrateLegacyAudio({ store, now: () => NOW });

    expect(outcome).toMatchObject({ kind: 'migrated', adopted: 0, rejected: 1 });
    expect(outcome.kind === 'migrated' && outcome.rejections['unreadable-name']).toBe(1);
  });

  it('does not adopt a file for a reciter outside the permission table', async () => {
    /*
      Resource 3 is the only reciter with extended retention. A file named for another reciter has no
      synchronised row to prove it, so it is left alone rather than inheriting resource 3's treatment.
    */
    await publishRows([syncedRow(1, 1)]);
    const store = fakeStore([{ name: audioFileName('7', 1, 1), bytes: GOOD_BYTES }]);

    const outcome = await migrateLegacyAudio({ store, now: () => NOW });

    expect(outcome).toMatchObject({ kind: 'migrated', adopted: 0, rejected: 1 });
    expect(findRow(await readAudioManifest(), '7', 1, 1)).toBeNull();
  });
});

describe('when the migration may not run yet', () => {
  it('defers until a sync has produced rows to prove identities against', async () => {
    /*
      A device that has never synchronised has nothing to corroborate a filename, and adopting on the
      strength of names alone is the exact practice being retired.
    */
    const store = fakeStore([{ name: audioFileName(SUDAIS, 1, 1), bytes: GOOD_BYTES }]);

    expect(await migrateLegacyAudio({ store, now: () => NOW })).toEqual({
      kind: 'deferred',
      reason: 'no-synced-rows',
    });
    expect(manifestIsAuthoritative(await readAudioManifest())).toBe(false);
  });

  it('does not mark the manifest authoritative while deferred', async () => {
    const store = fakeStore([]);
    await migrateLegacyAudio({ store, now: () => NOW });
    expect((await readAudioManifest()).migratedLegacyFiles).toBe(false);
  });
});

describe('resumability and idempotence', () => {
  it('produces the same manifest when run twice, without duplicating rows', async () => {
    await publishRows([syncedRow(93, 1), syncedRow(93, 2)]);
    const store = fakeStore([
      { name: audioFileName(SUDAIS, 93, 1), bytes: GOOD_BYTES },
      { name: audioFileName(SUDAIS, 93, 2), bytes: GOOD_BYTES },
    ]);

    await migrateLegacyAudio({ store, now: () => NOW });
    const first = await readAudioManifest();

    /* A second call is a no-op once the flag is set — nothing is read and nothing is written. */
    expect(await migrateLegacyAudio({ store, now: () => NOW })).toEqual({
      kind: 'already-migrated',
    });
    expect(await readAudioManifest()).toEqual(first);
  });

  it('recomputes from disk after an interrupted run', async () => {
    /*
      An interrupted run leaves `migratedLegacyFiles` false, so the next launch recomputes the plan
      from the filesystem. Resumability here is "recompute", which is why it needs no journal.
    */
    await publishRows([syncedRow(93, 1), syncedRow(93, 2)]);
    await writeAudioManifest({ version: 1, rows: [], migratedLegacyFiles: false });

    const store = fakeStore([
      { name: audioFileName(SUDAIS, 93, 1), bytes: GOOD_BYTES },
      { name: audioFileName(SUDAIS, 93, 2), bytes: GOOD_BYTES },
    ]);
    const outcome = await migrateLegacyAudio({ store, now: () => NOW });

    expect(outcome).toMatchObject({ kind: 'migrated', adopted: 2 });
    expect(manifestIsAuthoritative(await readAudioManifest())).toBe(true);
  });

  it('keeps manifest rows a newer download already wrote', async () => {
    /* A migration pass must not cost a device rows that arrived through the new path. */
    await publishRows([syncedRow(93, 1)]);
    await writeAudioManifest({
      version: 1,
      migratedLegacyFiles: false,
      rows: [
        {
          reciterId: SUDAIS,
          surah: 2,
          ayah: 255,
          fileName: audioFileName(SUDAIS, 2, 255),
          bytes: GOOD_BYTES,
          integrity: null,
          downloadedAt: NOW - 100,
          lastSyncedAt: NOW - 100,
          recordKey: '2:255',
          sequence: 1,
          state: 'available',
        },
      ],
    });
    const store = fakeStore([{ name: audioFileName(SUDAIS, 93, 1), bytes: GOOD_BYTES }]);

    await migrateLegacyAudio({ store, now: () => NOW });

    const manifest = await readAudioManifest();
    expect(manifest.rows).toHaveLength(2);
    expect(findRow(manifest, SUDAIS, 2, 255)?.state).toBe('available');
  });
});

describe('failing closed', () => {
  it('publishes nothing and keeps the flag false when the write fails', async () => {
    await publishRows([syncedRow(1, 1)]);
    const store = fakeStore([{ name: audioFileName(SUDAIS, 1, 1), bytes: GOOD_BYTES }]);

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const manifestModule = require('@features/faith/storage/faith-audio-manifest') as {
      writeAudioManifest: (manifest: unknown) => Promise<boolean>;
    };
    const spy = jest.spyOn(manifestModule, 'writeAudioManifest').mockResolvedValue(false);

    try {
      expect(await migrateLegacyAudio({ store, now: () => NOW })).toEqual({
        kind: 'failed',
        reason: 'write-failed',
      });
      /* Nothing was deleted, and the next launch will try again. */
      expect(store.removals).toEqual([]);
      expect((await readAudioManifest()).migratedLegacyFiles).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });
});
