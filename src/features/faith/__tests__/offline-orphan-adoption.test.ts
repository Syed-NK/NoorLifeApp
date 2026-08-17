import {
  classifyOrphans,
  isSafeToRemoveOrphan,
  MIN_ADOPTABLE_BYTES,
  type DiscoveredFile,
} from '@features/faith/data/audio/offline-orphan-adoption';
import type { PublishedRow } from '@features/faith/data/audio/offline-reconcile';
import { isPlausibleAudio } from '@features/faith/data/audio/audio-store.port';
import { adoptPromotedOrphans } from '@features/faith/data/audio/offline-migration';
import type { OfflineFileRow } from '@features/faith/storage/faith-offline-recitation';

/**
 * Adopting audio the manifest lost track of — and refusing everything else.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── The device state these cases were written from ─────────────────────────
 * **3,490 files against 3,483 manifest rows.** A force-stop landed between a batch of promotions and
 * the manifest's atomic write, so seven files sat on disk under their final names with nothing
 * describing them. The existing reconciliation compares manifest against generation and never
 * enumerates the directory, so it swept the `.part` leftovers and walked past these.
 *
 * ── What most of this file is about ────────────────────────────────────────
 * The refusals. Adopting on the strength of a filename is the defect, not the fix: a name is an
 * assertion by whatever wrote the file, and that writer might have been an interrupted transfer or an
 * error body. Every case below that ends in `unverifiable` is a way a plausible-looking file can fail
 * to be the verse it claims — and each one must cost a re-download rather than become scripture the
 * user hears.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const GENERATION = 'gen-under-test';
const AT = 1_800_000_000_000;

/** Bytes that begin with an ID3 tag, which is what the download path accepts. */
function audioBytes(): Uint8Array {
  const bytes = new Uint8Array(64);
  bytes[0] = 0x49;
  bytes[1] = 0x44;
  bytes[2] = 0x33;
  return bytes;
}

function file(over: Partial<DiscoveredFile> = {}): DiscoveredFile {
  return {
    fileName: 'r3-s1-a1.mp3',
    bytes: 75_786,
    isRegularFinalFile: true,
    header: audioBytes(),
    ...over,
  };
}

function publishedRow(surah: number, ayah: number): PublishedRow {
  return {
    surah,
    ayah,
    verseKey: `${surah}:${ayah}`,
    bytes: null,
    durationSeconds: 3,
    sequence: 1354,
  };
}

function manifestRow(over: Partial<OfflineFileRow> = {}): OfflineFileRow {
  return {
    resourceId: 3,
    surah: 1,
    ayah: 1,
    verseKey: '1:1',
    fileName: 'r3-s1-a1.mp3',
    state: 'available',
    bytes: 75_786,
    expectedBytes: null,
    validation: 'signature-ok',
    generationId: GENERATION,
    sequence: 1354,
    completedAt: AT,
    verifiedAt: AT,
    ...over,
  } as OfflineFileRow;
}

function classify(
  discovered: readonly DiscoveredFile[],
  rows: readonly OfflineFileRow[] = [],
  published: readonly PublishedRow[] = [publishedRow(1, 1)],
) {
  return classifyOrphans({
    discovered,
    manifest: { rows },
    generationId: GENERATION,
    published,
    at: AT,
    isAudio: isPlausibleAudio,
  });
}

describe('the exact crash that produced the device state', () => {
  it('adopts seven corroborated files the manifest never recorded', async () => {
    /*
      The measured case, in miniature: the manifest ends at ayah 3 and four more files are on disk,
      each corroborated by the active generation.
    */
    const published = [1, 2, 3, 4, 5, 6, 7].map((ayah) => publishedRow(1, ayah));
    const rows = [1, 2, 3].map((ayah) =>
      manifestRow({ ayah, verseKey: `1:${ayah}`, fileName: `r3-s1-a${ayah}.mp3` }),
    );
    const discovered = [1, 2, 3, 4, 5, 6, 7].map((ayah) =>
      file({ fileName: `r3-s1-a${ayah}.mp3` }),
    );

    const audit = classify(discovered, rows, published);

    expect(audit.adoptable).toHaveLength(4);
    expect(audit.adoptable.map((row) => row.ayah).sort((a, b) => a - b)).toEqual([4, 5, 6, 7]);
    expect(audit.unverifiable).toEqual([]);
    expect(audit.unexpected).toEqual([]);
  });

  it('stamps an adopted row with the generation that corroborated it', async () => {
    /*
      Not null. A null generation is reserved for adopted *legacy* files, and these are not legacy —
      they were downloaded under this publication and checked against it.
    */
    const audit = classify([file()]);
    expect(audit.adoptable[0]?.generationId).toBe(GENERATION);
    expect(audit.adoptable[0]?.validation).toBe('signature-ok');
    expect(audit.adoptable[0]?.state).toBe('available');
    expect(audit.adoptable[0]?.sequence).toBe(1354);
  });

  it('leaves files the manifest already owns entirely alone', async () => {
    const audit = classify([file()], [manifestRow()]);
    expect(audit.adoptable).toEqual([]);
    expect(audit.classifications[0]?.kind).toBe('manifest-owned');
  });

  it('is idempotent — a second pass adopts nothing', async () => {
    const first = classify([file()]);
    const rows = first.adoptable;
    const second = classify([file()], rows);

    expect(second.adoptable).toEqual([]);
    expect(second.unverifiable).toEqual([]);
  });
});

describe('files that must never be adopted', () => {
  it('refuses another reciter’s audio', () => {
    const audit = classify([file({ fileName: 'r7-s1-a1.mp3' })]);
    expect(audit.unverifiable).toEqual([{ fileName: 'r7-s1-a1.mp3', reason: 'wrong-reciter' }]);
  });

  it('refuses a verse the active generation does not publish', () => {
    /* Nothing corroborates it, so the device cannot say it is that verse. */
    const audit = classify([file({ fileName: 'r3-s2-a99.mp3' })]);
    expect(audit.unverifiable[0]?.reason).toBe('absent-from-generation');
  });

  it('refuses a row the generation contradicts', () => {
    const audit = classify([file()], [], [{ ...publishedRow(1, 1), surah: 2 }]);
    expect(audit.unverifiable[0]?.reason).toBe('generation-disagrees');
  });

  it.each([
    ['a traversal attempt', '../../../etc/passwd'],
    ['a nested path', 'sub/r3-s1-a1.mp3'],
    ['a partial file', 'r3-s1-a1.mp3.part'],
    ['a wrong extension', 'r3-s1-a1.wav'],
    ['no structure at all', 'recitation.mp3'],
    ['a negative ayah', 'r3-s1-a-1.mp3'],
  ])('treats %s as unexpected rather than adoptable', (_label, fileName) => {
    /*
      Reported, never adopted, and never deleted by this module — the caller must prove the manifest
      does not reference it first. A mis-parse must cost a wasted file, not a working one.
    */
    const audit = classify([file({ fileName })]);
    expect(audit.adoptable).toEqual([]);
    expect(audit.unexpected).toContain(fileName);
  });

  it('refuses a name that parses but is not a regular final file', () => {
    const audit = classify([file({ isRegularFinalFile: false })]);
    expect(audit.unverifiable[0]?.reason).toBe('not-regular-file');
  });

  it('refuses a surah outside the Qur’an', () => {
    const audit = classify([file({ fileName: 'r3-s115-a1.mp3' })], [], [publishedRow(115, 1)]);
    expect(audit.unverifiable[0]?.reason).toBe('identity-mismatch');
  });

  it('refuses a file below the minimum valid size', () => {
    const audit = classify([file({ bytes: MIN_ADOPTABLE_BYTES - 1 })]);
    expect(audit.unverifiable[0]?.reason).toBe('too-small');
  });

  it.each([
    ['an HTML error body', '<!DOCTYPE html><html><body>404'],
    ['a JSON error envelope', '{"error":"not found"}'],
    ['plain text', 'could not find that verse'],
  ])('refuses %s saved under a valid name', (_label, body) => {
    const audit = classify([file({ header: new TextEncoder().encode(body) })]);
    expect(audit.unverifiable[0]?.reason).toBe('not-audio');
  });

  it('refuses a file whose header could not be read', () => {
    const audit = classify([file({ header: null })]);
    expect(audit.unverifiable[0]?.reason).toBe('not-audio');
  });

  it('refuses a corrupt audio header', () => {
    const audit = classify([file({ header: new Uint8Array([0x00, 0x00, 0x00, 0x00]) })]);
    expect(audit.unverifiable[0]?.reason).toBe('not-audio');
  });

  it('refuses both files when two claim the same verse', () => {
    /*
      Picking either would make which one plays depend on directory ordering. Neither is adopted, and
      the downloader resolves the verse cleanly next time.
    */
    const audit = classify([
      file({ fileName: 'r3-s1-a1.mp3' }),
      file({ fileName: 'r3-s1-a1.mp3' }),
    ]);
    expect(audit.adoptable).toEqual([]);
    expect(audit.unverifiable.map((entry) => entry.reason)).toEqual([
      'duplicate-identity',
      'duplicate-identity',
    ]);
  });

  it('refuses a file whose verse the manifest already holds under another name', () => {
    const audit = classify(
      [file({ fileName: 'r3-s1-a1.mp3' })],
      [manifestRow({ fileName: 'r3-s1-a1-old.mp3' })],
    );
    expect(audit.unverifiable[0]?.reason).toBe('conflicting-manifest-row');
  });

  it('reports a closed reason enum and never echoes a path', () => {
    const audit = classify([file({ fileName: 'r7-s1-a1.mp3' })]);
    const reasons = audit.unverifiable.map((entry) => entry.reason);
    for (const reason of reasons) {
      expect(reason).toMatch(/^[a-z-]+$/);
    }
  });
});

describe('removing an unreferenced private orphan', () => {
  it('permits removal only when the manifest does not name the file', () => {
    expect(isSafeToRemoveOrphan('r3-s9-a9.mp3', { rows: [manifestRow()] })).toBe(true);
  });

  it('refuses to remove a file the manifest references, whatever its classification', () => {
    /*
      The one irreversible act here, so it is gated on the manifest by name rather than on the
      classification that produced it.
    */
    expect(isSafeToRemoveOrphan('r3-s1-a1.mp3', { rows: [manifestRow()] })).toBe(false);
  });
});

describe('accounting after reconciliation', () => {
  it('makes adopted bytes measurable from the rows rather than from a file count', () => {
    /*
      The reason the discrepancy mattered: totals are computed from the manifest, so a file the
      manifest does not list is a file the app cannot count. After adoption the row carries the
      measured byte length, and the two agree.
    */
    const audit = classify([file({ bytes: 12_345 })]);
    expect(audit.adoptable[0]?.bytes).toBe(12_345);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The runner — adoption applied through the serialised manifest boundary
// ─────────────────────────────────────────────────────────────────────────────

describe('adoptPromotedOrphans', () => {
  /*
    `classifyOrphans` above is pure. These cover the runner: the guards it applies before touching the
    manifest, and the fact that it writes exactly once through the serialised boundary.
  */

  function stubStore(files: readonly { name: string; bytes: number }[], valid = true) {
    return {
      list: () => files.map((f) => ({ ...f, uri: `file:///x/${f.name}`, storedAt: AT })),
      validate: () => valid,
    } as never;
  }

  function stubManifest(rows: readonly OfflineFileRow[]) {
    const state = { rows: [...rows], migratedLegacyFiles: true, resourceId: 3, version: 1 };
    const calls: number[] = [];
    return {
      store: {
        load: async () => state as never,
        current: () => state as never,
        mutate: async (apply: (m: never) => never) => {
          calls.push(1);
          Object.assign(state, apply(state as never));
          return true;
        },
        record: async () => true,
        flush: async () => true,
      } as never,
      state,
      writes: () => calls.length,
    };
  }

  it('adopts nothing and reports why when no generation is active', async () => {
    /*
      Without a publication there is nothing to corroborate against, and adopting on a filename alone
      is the defect this path refuses to be. The manifest must not be written at all.
    */
    const manifest = stubManifest([]);
    const outcome = await adoptPromotedOrphans({
      downloaded: stubStore([{ name: 'r3-s1-a1.mp3', bytes: 75_786 }]),
      manifest: manifest.store,
      generation: null,
      now: () => AT,
    });

    expect(outcome).toEqual({
      adopted: 0,
      unverifiable: 0,
      unexpected: 0,
      reason: 'no-generation',
    });
    expect(manifest.writes()).toBe(0);
  });

  it('adopts nothing when the active generation publishes no rows', async () => {
    const manifest = stubManifest([]);
    const outcome = await adoptPromotedOrphans({
      downloaded: stubStore([{ name: 'r3-s1-a1.mp3', bytes: 75_786 }]),
      manifest: manifest.store,
      generation: { generationId: GENERATION, rows: [] },
      now: () => AT,
    });

    expect(outcome.reason).toBe('no-generation');
    expect(manifest.writes()).toBe(0);
  });

  it('writes the manifest exactly once for a batch of adoptions', async () => {
    /*
      One mutation through the serialised boundary, not one per file. A per-file write would make a
      crash mid-batch leave a partially-adopted manifest — the very hybrid this must not produce.
    */
    const manifest = stubManifest([]);
    const files = [1, 2, 3].map((ayah) => ({ name: `r3-s1-a${ayah}.mp3`, bytes: 75_786 }));
    const outcome = await adoptPromotedOrphans({
      downloaded: stubStore(files),
      manifest: manifest.store,
      generation: { generationId: GENERATION, rows: [1, 2, 3].map((a) => publishedRow(1, a)) },
      now: () => AT,
    });

    expect(outcome.adopted).toBe(3);
    expect(manifest.writes()).toBe(1);
    expect(manifest.state.rows).toHaveLength(3);
  });

  it('does not write when there is nothing to adopt', async () => {
    const manifest = stubManifest([manifestRow()]);
    const outcome = await adoptPromotedOrphans({
      downloaded: stubStore([{ name: 'r3-s1-a1.mp3', bytes: 75_786 }]),
      manifest: manifest.store,
      generation: { generationId: GENERATION, rows: [publishedRow(1, 1)] },
      now: () => AT,
    });

    expect(outcome.reason).toBe('nothing-to-do');
    expect(manifest.writes()).toBe(0);
  });

  it('leaves the previous manifest intact when the write fails', async () => {
    const manifest = stubManifest([]);
    /* Same store, refusing the write. Cast once at the boundary rather than spreading a `never`. */
    const failing = {
      ...(manifest.store as unknown as Record<string, unknown>),
      mutate: async () => false,
    } as never;
    const outcome = await adoptPromotedOrphans({
      downloaded: stubStore([{ name: 'r3-s1-a1.mp3', bytes: 75_786 }]),
      manifest: failing,
      generation: { generationId: GENERATION, rows: [publishedRow(1, 1)] },
      now: () => AT,
    });

    expect(outcome).toMatchObject({ adopted: 0, reason: 'write-failed' });
    expect(manifest.state.rows).toEqual([]);
  });

  it('never adopts a file the store refuses to validate', async () => {
    const manifest = stubManifest([]);
    const outcome = await adoptPromotedOrphans({
      downloaded: stubStore([{ name: 'r3-s1-a1.mp3', bytes: 75_786 }], false),
      manifest: manifest.store,
      generation: { generationId: GENERATION, rows: [publishedRow(1, 1)] },
      now: () => AT,
    });

    expect(outcome.adopted).toBe(0);
    expect(outcome.unverifiable).toBe(1);
    expect(manifest.writes()).toBe(0);
  });
});
