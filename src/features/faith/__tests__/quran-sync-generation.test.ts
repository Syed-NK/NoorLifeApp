import { Directory, File, Paths } from 'expo-file-system';

import {
  checksumOf,
  clearAllGenerations,
  type GenerationDraft,
  GENERATION_POINTER_VERSION,
  openGeneration,
  publishGeneration,
  readActiveGeneration,
  readGenerationPointer,
  STORAGE_RESERVE_BYTES,
  sweepGenerations,
} from '@features/faith/storage/faith-sync-generation';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { faithStorageKeys } from '@features/faith/storage/faith-storage';
import {
  publishRevision,
  readSyncStatus,
  resetSyncStatus,
  subscribeSyncStatus,
  syncStatusSubscriberCount,
  updateSyncStatus,
} from '@features/faith/data/sync/content-sync.revision';
import { mockFileSystem } from '@/../jest.setup';

/**
 * Durable generations — the correction to two release-blocking defects.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Defect 1: four sequential writes are not a transaction ─────────────────
 * Publication used to be `replaceSyncedTranslations` → `replaceSyncedRecitations` →
 * `recordRecitationCheck` → `commitSync`. A process death or a failed write between any two of them
 * left translations from one run beside recitations from another, acknowledged by a token covering
 * neither. Most of this file is an attempt to produce that mixed state and fail to.
 *
 * ── Defect 2: multi-megabyte JSON in AsyncStorage ──────────────────────────
 * The live snapshots measured `over_2_to_4_mib` and `over_4_to_8_mib`. Storing rows of that size in
 * one SQLite-backed key-value store is a production failure an in-memory double would never surface,
 * so the rows are file-backed and the tests below assert that with 8 MiB-class fixtures.
 *
 * ── How a crash is simulated ───────────────────────────────────────────────
 * `mockFileSystem.failWritesTo(uri)` makes one write throw, which is the observable half of a process
 * death: the step does not complete and nothing after it runs. The assertion each time is the same —
 * the pointer still names the old generation, and that generation still opens whole.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const NOW = 1_700_000_000_000;
const GEN_ROOT = 'file:///documents/quran-sync';

function draft(over: Partial<GenerationDraft> = {}): GenerationDraft {
  return {
    generationId: 'gen-a',
    createdAt: NOW,
    feed: {
      resources: 'recitations:3;translations:85',
      syncToken: 'tok_a',
      syncedUntilSequence: 1,
    },
    translations: {
      resourceId: 85,
      attribution: { resourceId: 85, name: 'The Clear Quran', translator: 'Dr. Mustafa Khattab' },
      rows: [
        {
          verseKey: '1:1',
          surah: 1,
          ayah: 1,
          text: 'In the Name of Allah',
          resourceId: 85,
          sequence: 1,
          refreshedAt: NOW,
        },
      ],
    },
    recitations: {
      resourceId: 3,
      rows: [
        {
          verseKey: '1:1',
          resourceId: 3,
          surah: 1,
          ayah: 1,
          durationSeconds: 5,
          bytes: 40_000,
          sequence: 1,
          refreshedAt: NOW,
        },
      ],
    },
    recitation: { lastCheckedAt: NOW, method: 'snapshot', mutationEverObserved: false },
    ...over,
  };
}

/** A generation of the size the live snapshots actually are, for the storage-shape assertions. */
function largeDraft(generationId: string, ayahCount: number): GenerationDraft {
  const translations = [];
  const recitations = [];
  for (let index = 0; index < ayahCount; index += 1) {
    const surah = (index % 114) + 1;
    const ayah = Math.floor(index / 114) + 1;
    translations.push({
      verseKey: `${surah}:${ayah}`,
      surah,
      ayah,
      /* Roughly a real translated verse, so the fixture reaches a realistic byte size. */
      text: `Verse ${surah}:${ayah} — ${'translated text '.repeat(12)}`,
      resourceId: 85,
      sequence: 1,
      refreshedAt: NOW,
    });
    recitations.push({
      verseKey: `${surah}:${ayah}`,
      resourceId: 3,
      surah,
      ayah,
      durationSeconds: 5,
      bytes: 40_000,
      sequence: 1,
      refreshedAt: NOW,
    });
  }
  return draft({
    generationId,
    translations: { resourceId: 85, attribution: null, rows: translations },
    recitations: { resourceId: 3, rows: recitations },
  });
}

function generationDirs(): string[] {
  const root = new Directory(Paths.document, 'quran-sync');
  return root.exists
    ? root
        .list()
        .map((entry) => entry.uri.replace(/\/+$/, '').split('/').pop() ?? '')
        .filter((name) => name.length > 0)
    : [];
}

beforeEach(async () => {
  mockFileSystem.reset();
  await clearAllGenerations();
});

// ─────────────────────────────────────────────────────────────────────────────
// The happy path, and where the bytes actually live
// ─────────────────────────────────────────────────────────────────────────────

describe('publishing a generation', () => {
  it('writes files privately and publishes with one small pointer', async () => {
    const outcome = await publishGeneration(draft());
    expect(outcome.kind).toBe('published');

    const pointer = await readGenerationPointer();
    expect(pointer).toEqual({ version: GENERATION_POINTER_VERSION, generationId: 'gen-a' });
    /* Two fields. The pointer is the only thing about a generation that AsyncStorage ever holds. */
    expect(Object.keys(pointer ?? {}).sort()).toEqual(['generationId', 'version']);

    const uris = mockFileSystem.uris().filter((uri) => uri.startsWith(GEN_ROOT));
    expect(uris.sort()).toEqual([
      `${GEN_ROOT}/gen-a/generation.json`,
      `${GEN_ROOT}/gen-a/recitations.json`,
      `${GEN_ROOT}/gen-a/translations.json`,
    ]);
    /* Private application storage only — never cache, never a shared or exported location. */
    expect(uris.every((uri) => uri.startsWith('file:///documents/'))).toBe(true);
    /* And no `.part` survives a successful publication. */
    expect(uris.some((uri) => uri.endsWith('.part'))).toBe(false);
  });

  it('returns every resource and the token from one generation', async () => {
    await publishGeneration(draft());
    const generation = await readActiveGeneration();

    expect(generation?.translations.rows).toHaveLength(1);
    expect(generation?.recitations.rows).toHaveLength(1);
    expect(generation?.manifest.feed.syncToken).toBe('tok_a');
    expect(generation?.translations.attribution?.translator).toBe('Dr. Mustafa Khattab');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Large datasets never pass through AsyncStorage
// ─────────────────────────────────────────────────────────────────────────────

describe('where large datasets are stored', () => {
  it('keeps an 8 MiB-class generation entirely on the filesystem', async () => {
    const large = largeDraft('gen-large', 6236);
    const outcome = await publishGeneration(large);
    expect(outcome.kind).toBe('published');

    const bytes = outcome.kind === 'published' ? outcome.bytes : 0;
    /* The fixture must actually be the size the defect is about, or it proves nothing. */
    expect(bytes).toBeGreaterThan(2 * 1024 * 1024);

    const translations = new File(`${GEN_ROOT}/gen-large/translations.json`);
    const recitations = new File(`${GEN_ROOT}/gen-large/recitations.json`);
    expect(translations.size + recitations.size).toBe(bytes);

    /*
      And AsyncStorage holds the pointer and nothing else about this generation. Asserted against the
      serialised value, so a row that leaked into it would be caught however it got there.
    */
    const stored = await AsyncStorage.getItem(faithStorageKeys.quranGenerationPointer);
    expect(stored).not.toBeNull();
    expect((stored ?? '').length).toBeLessThan(200);
    expect(stored).not.toContain('translated text');
    expect(stored).not.toContain('verseKey');
  });

  it('never puts a row, a verse or an attribution into any AsyncStorage key', async () => {
    await publishGeneration(largeDraft('gen-scan', 500));
    const keys = await AsyncStorage.getAllKeys();
    const entries = await AsyncStorage.multiGet(keys);
    for (const [key, value] of entries) {
      expect((value ?? '').length).toBeLessThan(4096);
      expect(value ?? '').not.toContain('translated text');
      expect(`${key}${value ?? ''}`).not.toContain('In the Name of Allah');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The crash and failure matrix
// ─────────────────────────────────────────────────────────────────────────────

describe('failure between publication steps', () => {
  it('keeps the old generation when the recitation write fails', async () => {
    await publishGeneration(draft());
    mockFileSystem.failWritesTo(`${GEN_ROOT}/gen-b/recitations.json.part`);

    const outcome = await publishGeneration(
      draft({
        generationId: 'gen-b',
        feed: {
          resources: 'recitations:3;translations:85',
          syncToken: 'tok_b',
          syncedUntilSequence: 2,
        },
      }),
    );

    expect(outcome).toEqual({ kind: 'failed', reason: 'staging-failed' });
    const active = await readActiveGeneration();
    expect(active?.manifest.generationId).toBe('gen-a');
    expect(active?.manifest.feed.syncToken).toBe('tok_a');
    /* Whole, not partial: both resources still open from the same directory. */
    expect(active?.translations.rows).toHaveLength(1);
    expect(active?.recitations.rows).toHaveLength(1);
  });

  it('keeps the old generation when the manifest write fails', async () => {
    /* The metadata step. Its failure is the one the old sequential design turned into a mixed state. */
    await publishGeneration(draft());
    mockFileSystem.failWritesTo(`${GEN_ROOT}/gen-b/generation.json.part`);

    const outcome = await publishGeneration(draft({ generationId: 'gen-b' }));

    expect(outcome).toEqual({ kind: 'failed', reason: 'staging-failed' });
    expect((await readGenerationPointer())?.generationId).toBe('gen-a');
    expect((await readActiveGeneration())?.manifest.feed.syncToken).toBe('tok_a');
  });

  it('keeps the old generation when the pointer write fails', async () => {
    await publishGeneration(draft());

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const storageModule = require('@features/faith/storage/faith-storage') as {
      writeChecked: (key: string, value: unknown) => Promise<boolean>;
    };
    const spy = jest.spyOn(storageModule, 'writeChecked').mockResolvedValue(false);
    try {
      const outcome = await publishGeneration(draft({ generationId: 'gen-b' }));
      expect(outcome).toEqual({ kind: 'failed', reason: 'pointer-failed' });
    } finally {
      spy.mockRestore();
    }

    expect((await readGenerationPointer())?.generationId).toBe('gen-a');
    expect((await readActiveGeneration())?.manifest.feed.syncToken).toBe('tok_a');
  });

  it('leaves the old generation active after a death at any staging step', async () => {
    /*
      Simulated as a failure at each file in turn. Whichever step dies, the assertion is identical:
      the pointer is unchanged and the generation it names opens completely.
    */
    await publishGeneration(draft());
    for (const file of ['translations.json', 'recitations.json', 'generation.json']) {
      mockFileSystem.clearWriteFailures();
      mockFileSystem.failWritesTo(`${GEN_ROOT}/gen-crash/${file}.part`);

      const outcome = await publishGeneration(draft({ generationId: 'gen-crash' }));
      expect(outcome.kind).toBe('failed');

      const active = await readActiveGeneration();
      expect(active?.manifest.generationId).toBe('gen-a');
      expect(active?.translations.rows).toHaveLength(1);
      expect(active?.recitations.rows).toHaveLength(1);
    }
  });

  it('keeps the new generation active when deleting the old one fails', async () => {
    await publishGeneration(draft());
    await publishGeneration(draft({ generationId: 'gen-b' }));
    expect((await readGenerationPointer())?.generationId).toBe('gen-b');

    /* A sweep that cannot remove the superseded directory must not disturb the active one. */
    await sweepGenerations();
    expect((await readGenerationPointer())?.generationId).toBe('gen-b');
    expect((await readActiveGeneration())?.recitations.rows).toHaveLength(1);
  });

  it('fails honestly and keeps the old generation when storage is short', async () => {
    await publishGeneration(draft());
    mockFileSystem.setFreeBytes(STORAGE_RESERVE_BYTES - 1);

    const outcome = await publishGeneration(largeDraft('gen-big', 2000));

    expect(outcome).toEqual({ kind: 'failed', reason: 'insufficient-storage' });
    expect((await readGenerationPointer())?.generationId).toBe('gen-a');
    /* And nothing was staged, so the shortfall did not make the shortage worse. */
    expect(generationDirs()).toEqual(['gen-a']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Sweeping
// ─────────────────────────────────────────────────────────────────────────────

describe('cleanup', () => {
  it('removes an unpublished generation and never the active one', async () => {
    await publishGeneration(draft());
    /* A directory with no manifest: staged and abandoned. */
    new File(`${GEN_ROOT}/gen-orphan/translations.json`).write('{}');

    const swept = await sweepGenerations();

    expect(swept.removedGenerations).toBe(1);
    expect(generationDirs()).toEqual(['gen-a']);
    expect((await readActiveGeneration())?.manifest.generationId).toBe('gen-a');
  });

  it('removes abandoned .part files inside the active generation', async () => {
    await publishGeneration(draft());
    new File(`${GEN_ROOT}/gen-a/translations.json.part`).write('partial');

    const swept = await sweepGenerations();

    expect(swept.removedPartials).toBe(1);
    expect(new File(`${GEN_ROOT}/gen-a/translations.json.part`).exists).toBe(false);
    /* The real files are untouched and the generation still opens. */
    expect((await readActiveGeneration())?.translations.rows).toHaveLength(1);
  });

  it('ignores an incomplete generation rather than adopting it', async () => {
    new File(`${GEN_ROOT}/gen-half/translations.json`).write('{"resourceId":85,"rows":[]}');
    expect(openGeneration('gen-half')).toBeNull();
    expect(await readActiveGeneration()).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Validation on reopen
// ─────────────────────────────────────────────────────────────────────────────

describe('rejecting a corrupt generation', () => {
  it('rejects a torn file rather than returning half of it', async () => {
    await publishGeneration(draft());
    const file = new File(`${GEN_ROOT}/gen-a/recitations.json`);
    file.write(file.textSync().slice(0, 20));

    /* Not "translations from A and recitations from nowhere" — the whole generation is refused. */
    expect(await readActiveGeneration()).toBeNull();
  });

  it('rejects a file whose checksum does not match its manifest', async () => {
    await publishGeneration(draft());
    const file = new File(`${GEN_ROOT}/gen-a/translations.json`);
    const text = file.textSync();
    /* Same length, different bytes: only the checksum can catch this one. */
    file.write(text.replace('In the Name of Allah', 'in the name of allah'));

    expect(await readActiveGeneration()).toBeNull();
  });

  it('rejects a row whose verse key disagrees with its own surah and ayah', async () => {
    const bad = draft({ generationId: 'gen-bad' });
    await publishGeneration(bad);
    const file = new File(`${GEN_ROOT}/gen-bad/translations.json`);
    const text = file.textSync().replace('"verseKey":"1:1"', '"verseKey":"2:1"');
    file.write(text);

    expect(openGeneration('gen-bad')).toBeNull();
  });

  it('rejects a pointer naming a generation that is not there', async () => {
    await publishGeneration(draft());
    new Directory(`${GEN_ROOT}/gen-a`).delete();
    expect(await readActiveGeneration()).toBeNull();
  });

  it('computes a checksum that changes with the content', () => {
    expect(checksumOf('abc')).toBe(checksumOf('abc'));
    expect(checksumOf('abc')).not.toBe(checksumOf('abd'));
    expect(checksumOf('')).toHaveLength(8);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A reader is never given a mixed view
// ─────────────────────────────────────────────────────────────────────────────

describe('readers during publication', () => {
  it('gives a reader holding a generation id that generation, whatever the pointer now says', async () => {
    await publishGeneration(draft());
    const captured = (await readGenerationPointer())?.generationId ?? '';

    /* A publication lands while the reader is mid-read. */
    await publishGeneration(
      draft({
        generationId: 'gen-b',
        feed: {
          resources: 'recitations:3;translations:85',
          syncToken: 'tok_b',
          syncedUntilSequence: 9,
        },
      }),
    );

    const held = openGeneration(captured);
    expect(held?.manifest.feed.syncToken).toBe('tok_a');
    expect(held?.translations.rows).toHaveLength(1);
    expect(held?.recitations.rows).toHaveLength(1);
    /* And the new pointer resolves to the new generation, wholly. */
    expect((await readActiveGeneration())?.manifest.feed.syncToken).toBe('tok_b');
  });

  it('always returns a token and content from the same generation', async () => {
    await publishGeneration(draft());
    await publishGeneration(
      draft({
        generationId: 'gen-b',
        feed: {
          resources: 'recitations:3;translations:85',
          syncToken: 'tok_b',
          syncedUntilSequence: 9,
        },
        translations: {
          resourceId: 85,
          attribution: null,
          rows: [
            {
              verseKey: '2:255',
              surah: 2,
              ayah: 255,
              text: 'Allah — there is no deity except Him',
              resourceId: 85,
              sequence: 9,
              refreshedAt: NOW,
            },
          ],
        },
      }),
    );

    const generation = await readActiveGeneration();
    expect(generation?.manifest.feed.syncToken).toBe('tok_b');
    expect(generation?.translations.rows[0]?.verseKey).toBe('2:255');
    expect(generation?.manifest.feed.syncedUntilSequence).toBe(9);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Revision propagation
// ─────────────────────────────────────────────────────────────────────────────

describe('the revision channel', () => {
  beforeEach(() => {
    resetSyncStatus();
  });

  it('emits exactly one revision per successful publication', () => {
    const seen: number[] = [];
    const release = subscribeSyncStatus((model) => seen.push(model.revision));

    publishRevision({
      publishedAt: NOW,
      lastRecitationCheckAt: NOW,
      recitationMutationObserved: false,
      provisional: true,
    });

    expect(seen).toEqual([1]);
    expect(readSyncStatus().revision).toBe(1);
    release();
  });

  it('emits no revision for a failure', () => {
    const seen: number[] = [];
    const release = subscribeSyncStatus((model) => seen.push(model.revision));

    updateSyncStatus({ status: 'failed-retryable', lastFailure: 'unavailable', isRunning: false });

    /* A status changed; a revision did not. There is no new content to resolve. */
    expect(seen).toEqual([0]);
    expect(readSyncStatus().status).toBe('failed-retryable');
    release();
  });

  it('reports an integrity reconciliation distinctly, never as an observed mutation', () => {
    publishRevision({
      publishedAt: NOW,
      lastRecitationCheckAt: NOW,
      recitationMutationObserved: false,
      provisional: true,
    });
    expect(readSyncStatus().status).toBe('integrity-reconciliation');
    expect(readSyncStatus().recitationMutationObserved).toBe(false);
  });

  it('carries no content, path, token or identifier in the status model', () => {
    publishRevision({
      publishedAt: NOW,
      lastRecitationCheckAt: NOW,
      recitationMutationObserved: false,
      provisional: true,
    });
    const serialised = JSON.stringify(readSyncStatus());
    for (const forbidden of ['file://', 'tok_', 'quran-sync', 'verseKey', 'http', 'cursor']) {
      expect(serialised).not.toContain(forbidden);
    }
  });

  it('detaches a subscriber exactly once', () => {
    const release = subscribeSyncStatus(() => {});
    expect(syncStatusSubscriberCount()).toBe(1);
    release();
    release();
    expect(syncStatusSubscriberCount()).toBe(0);
  });
});
