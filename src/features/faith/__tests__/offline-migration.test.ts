import { generationFor, seedFileOnDisk } from '@/test-support/faith-reader';

import { mockFileSystem } from '../../../../jest.setup';
import { createExpoAudioStore } from '../data/audio/expo-audio-store';
import { createExpoManifestFile } from '../data/audio/expo-manifest-file';
import {
  createOfflineManifestStore,
  type ManifestFilePort,
} from '../data/audio/offline-manifest.store';
import { manifestIsAuthoritative, migrateLegacyAudio } from '../data/audio/offline-migration';
import { EMPTY_MANIFEST, offlineFileName } from '../storage/faith-offline-recitation';

/**
 * Adopting files written before the offline manifest existed.
 *
 * ── The single rule every test here is a form of ────────────────────────────
 * **Existence is not completeness.** A file being on disk says nothing about whether its transfer
 * finished, whether the bytes are audio, or whether the verse it claims to be is a verse the
 * publisher agrees exists for this resource. So every candidate is re-checked by the same signature,
 * size floor and published-size comparison a fresh download must pass, and a file that fails becomes
 * work to redo rather than a row that claims to be playable.
 */

const DOWNLOADED_DIR = 'file:///documents/faith-recitations-downloaded';
const CACHE_DIR = 'file:///cache/faith-recitations';

function deps(options?: {
  readonly generation?: ReturnType<typeof generationFor> | null;
  readonly file?: ManifestFilePort;
}) {
  return {
    downloaded: createExpoAudioStore('downloaded'),
    prepared: createExpoAudioStore('prepared'),
    manifest: createOfflineManifestStore({ file: options?.file ?? createExpoManifestFile() }),
    generation: options?.generation === undefined ? generationFor(1, 7) : options.generation,
    now: () => 1_700_000_000_000,
  };
}

beforeEach(() => {
  mockFileSystem.reset();
});

describe('adoption proves identity before it trusts a name', () => {
  it('adopts a file the publisher corroborates', async () => {
    seedFileOnDisk('downloaded', 1, 1);
    const dependencies = deps();

    const outcome = await migrateLegacyAudio(dependencies);

    expect(outcome).toMatchObject({ kind: 'migrated', adopted: 1, rejected: 0 });
    const manifest = dependencies.manifest.current();
    expect(manifest.rows).toHaveLength(1);
    expect(manifest.rows[0]).toMatchObject({
      surah: 1,
      ayah: 1,
      state: 'available',
      validation: 'signature-ok',
      /*
        `completedAt` stays null. These bytes arrived at a time this build cannot know, and inventing
        a timestamp would put a fabricated date on a screen. `verifiedAt` is now, which is true.
      */
      completedAt: null,
      verifiedAt: 1_700_000_000_000,
    });
  });

  it('refuses a verse nothing in the generation corroborates', async () => {
    /*
      The name says surah 9 verse 1 and the publication does not agree that this file is that verse.
      A mis-bound recitation plays one verse in another's place with nothing downstream able to
      notice, so it is not adopted — and it is not deleted either.
    */
    seedFileOnDisk('downloaded', 9, 1);
    const dependencies = deps();

    const outcome = await migrateLegacyAudio(dependencies);

    expect(outcome).toMatchObject({ kind: 'migrated', adopted: 0 });
    expect(outcome.kind === 'migrated' && outcome.rejections['unproved-identity']).toBe(1);
    expect(mockFileSystem.files.has(`${DOWNLOADED_DIR}/${offlineFileName(3, 9, 1)}`)).toBe(true);
  });

  it('refuses a file that is present but too small to be a recitation', async () => {
    seedFileOnDisk('downloaded', 1, 1, 512);
    const dependencies = deps();

    const outcome = await migrateLegacyAudio(dependencies);

    expect(outcome).toMatchObject({ kind: 'migrated', adopted: 0 });
    expect(dependencies.manifest.current().rows).toHaveLength(0);
  });

  it('refuses a file whose bytes are not audio at all', async () => {
    mockFileSystem.seed(
      `${DOWNLOADED_DIR}/${offlineFileName(3, 1, 1)}`,
      new TextEncoder().encode('<html><body>Sign in to this network</body></html>'.repeat(200)),
    );
    const dependencies = deps();

    const outcome = await migrateLegacyAudio(dependencies);

    expect(outcome.kind === 'migrated' && outcome.rejections['failed-validation']).toBe(1);
    expect(dependencies.manifest.current().rows).toHaveLength(0);
  });

  it('refuses a file whose size disagrees with the size the publisher stated', async () => {
    seedFileOnDisk('downloaded', 1, 1, 4096);
    const dependencies = deps({ generation: generationFor(1, 7, { bytes: 9000 }) });

    const outcome = await migrateLegacyAudio(dependencies);

    expect(outcome.kind === 'migrated' && outcome.rejections['size-mismatch']).toBe(1);
    expect(dependencies.manifest.current().rows).toHaveLength(0);
  });

  it('ignores a name it cannot read, and does not delete it', async () => {
    mockFileSystem.seed(`${DOWNLOADED_DIR}/notes.txt`, mockFileSystem.audioBytes(4096));
    const dependencies = deps();

    const outcome = await migrateLegacyAudio(dependencies);

    expect(outcome.kind === 'migrated' && outcome.rejections['unreadable-name']).toBe(1);
    expect(mockFileSystem.files.has(`${DOWNLOADED_DIR}/notes.txt`)).toBe(true);
  });
});

describe('the permission is never extended by adoption', () => {
  it('leaves another reciter’s files exactly where they are', async () => {
    /*
      ── The stop gate this pins ────────────────────────────────────────────────
      No permanent-download behaviour may apply to another reciter. A migration that swept a file
      belonging to reciter 7 into permanent storage would be applying a grant nobody gave — so it is
      neither adopted nor deleted, and the count is reported so the outcome is auditable.
    */
    mockFileSystem.seed(`${CACHE_DIR}/r7-s1-a1.mp3`, mockFileSystem.audioBytes(4096));
    mockFileSystem.seed(`${DOWNLOADED_DIR}/r168-s1-a1.mp3`, mockFileSystem.audioBytes(4096));
    const dependencies = deps();

    const outcome = await migrateLegacyAudio(dependencies);

    expect(outcome).toMatchObject({ kind: 'migrated', adopted: 0, otherReciterFiles: 2 });
    expect(dependencies.manifest.current().rows).toHaveLength(0);
    /* Left in place. Not this migration's to remove. */
    expect(mockFileSystem.files.has(`${CACHE_DIR}/r7-s1-a1.mp3`)).toBe(true);
    expect(mockFileSystem.files.has(`${DOWNLOADED_DIR}/r168-s1-a1.mp3`)).toBe(true);
  });
});

describe('files are rescued from the evictable cache', () => {
  it('moves a prepared file into permanent storage rather than copying it', async () => {
    seedFileOnDisk('prepared', 1, 1);
    const dependencies = deps();

    const outcome = await migrateLegacyAudio(dependencies);

    expect(outcome).toMatchObject({ kind: 'migrated', adopted: 1, promotedFromCache: 1 });
    expect(mockFileSystem.files.has(`${DOWNLOADED_DIR}/${offlineFileName(3, 1, 1)}`)).toBe(true);
    /*
      Moved, not copied. A device short of room must not briefly hold two copies of a file it is
      rescuing precisely because room is short.
    */
    expect(mockFileSystem.files.has(`${CACHE_DIR}/${offlineFileName(3, 1, 1)}`)).toBe(false);
  });

  it('keeps the permanent copy when the same verse exists in both places', async () => {
    /*
      The permanent copy is the one the user chose to keep and the one not about to be evicted.
      Adopting the cache copy over it would move a file needlessly and, if the move failed part-way,
      would put the file the user asked for at risk to gain nothing.
    */
    mockFileSystem.seed(
      `${DOWNLOADED_DIR}/${offlineFileName(3, 1, 1)}`,
      mockFileSystem.audioBytes(8192),
    );
    mockFileSystem.seed(
      `${CACHE_DIR}/${offlineFileName(3, 1, 1)}`,
      mockFileSystem.audioBytes(4096),
    );
    const dependencies = deps();

    const outcome = await migrateLegacyAudio(dependencies);

    expect(outcome).toMatchObject({ adopted: 1, promotedFromCache: 0 });
    expect(dependencies.manifest.current().rows[0]?.bytes).toBe(8192);
  });
});

describe('deferral, idempotence and crash-safety', () => {
  it('waits for a generation rather than adopting on the strength of names alone', async () => {
    seedFileOnDisk('downloaded', 1, 1);
    const dependencies = deps({ generation: null });

    const outcome = await migrateLegacyAudio(dependencies);

    /*
      Not a failure. A device that has never completed a Content Sync has nothing to check a filename
      against, and adopting anyway is exactly the practice being retired. The files stay put.
    */
    expect(outcome).toEqual({ kind: 'deferred', reason: 'no-generation' });
    expect(dependencies.manifest.current().migratedLegacyFiles).toBe(false);
    expect(mockFileSystem.files.has(`${DOWNLOADED_DIR}/${offlineFileName(3, 1, 1)}`)).toBe(true);
  });

  it('runs once and reports already-migrated afterwards', async () => {
    seedFileOnDisk('downloaded', 1, 1);
    expect(await migrateLegacyAudio(deps())).toMatchObject({ kind: 'migrated' });
    expect(await migrateLegacyAudio(deps())).toEqual({ kind: 'already-migrated' });
  });

  it('produces the same manifest when the plan is recomputed', async () => {
    /*
      Idempotence stated as an equality rather than as an absence of duplicates: a second pass
      re-derives the same rows and writes the same document, so an interrupted run simply repeats.
    */
    for (let ayah = 1; ayah <= 5; ayah += 1) {
      seedFileOnDisk('downloaded', 1, ayah);
    }
    const first = deps();
    await migrateLegacyAudio(first);
    const afterFirst = first.manifest.current();

    /* A fresh run over a manifest whose completion flag was lost — the crash-in-the-gap case. */
    const reopened = createOfflineManifestStore({ file: createExpoManifestFile() });
    await reopened.load();
    await reopened.mutate((value) => ({ ...value, migratedLegacyFiles: false }));

    const second = { ...deps(), manifest: reopened };
    const outcome = await migrateLegacyAudio(second);

    expect(outcome).toMatchObject({ kind: 'migrated', adopted: 5 });
    expect(second.manifest.current().rows).toEqual(afterFirst.rows);
  });

  it('fails closed when the manifest cannot be written', async () => {
    seedFileOnDisk('downloaded', 1, 1);
    const failing: ManifestFilePort = {
      read: () => null,
      write: () => false,
      remove: () => undefined,
    };
    const dependencies = deps({ file: failing });

    const outcome = await migrateLegacyAudio(dependencies);

    /*
      Nothing was published, the flag stays false, and no valid file was deleted — so the next launch
      simply tries again.
    */
    expect(outcome).toEqual({ kind: 'failed', reason: 'write-failed' });
    expect(mockFileSystem.files.has(`${DOWNLOADED_DIR}/${offlineFileName(3, 1, 1)}`)).toBe(true);
  });

  it('does not claim the manifest is authoritative until the sweep has finished', () => {
    /*
      Before it has, an empty manifest does **not** mean nothing is downloaded: the files may be on
      disk and simply not yet adopted, and a screen that said "not downloaded" in that window would
      offer to re-fetch a surah the device already holds.
    */
    expect(manifestIsAuthoritative(EMPTY_MANIFEST)).toBe(false);
    expect(manifestIsAuthoritative({ ...EMPTY_MANIFEST, migratedLegacyFiles: true })).toBe(true);
  });
});

describe('a mixed device', () => {
  it('adopts what it can prove and reports the rest, in one pass', async () => {
    seedFileOnDisk('downloaded', 1, 1); // adoptable
    seedFileOnDisk('prepared', 1, 2); // adoptable, from the cache
    seedFileOnDisk('downloaded', 1, 3, 512); // too small
    seedFileOnDisk('downloaded', 9, 1); // not in the generation
    mockFileSystem.seed(`${CACHE_DIR}/r7-s1-a1.mp3`, mockFileSystem.audioBytes(4096)); // other reciter
    mockFileSystem.seed(`${DOWNLOADED_DIR}/stray`, mockFileSystem.audioBytes(4096)); // unreadable

    const dependencies = deps();
    const outcome = await migrateLegacyAudio(dependencies);

    expect(outcome).toMatchObject({
      kind: 'migrated',
      adopted: 2,
      promotedFromCache: 1,
      otherReciterFiles: 1,
    });
    expect(dependencies.manifest.current().rows.map((row) => row.ayah)).toEqual([1, 2]);
    expect(dependencies.manifest.current().migratedLegacyFiles).toBe(true);
  });
});
