import {
  AYAH_COUNTS,
  SURAH_COUNT,
  TOTAL_AYAT,
  ayahCountOf,
} from '@/test-support/quran-ayah-counts';

import { mockFileSystem } from '../../../../jest.setup';
import { createExpoManifestFile } from '../data/audio/expo-manifest-file';
import {
  createOfflineManifestStore,
  type ManifestFilePort,
} from '../data/audio/offline-manifest.store';
import {
  bindGeneration,
  COMPLETE_AYAH_COUNT,
  decodeManifest,
  deserialiseManifest,
  EMPTY_MANIFEST,
  encodeManifest,
  envelopeFor,
  findRow,
  isPlayable,
  offlineFileName,
  parseOfflineFileName,
  PERMITTED_RESOURCE_ID,
  permanentDownloadPermitted,
  playableAyatOf,
  removeRows,
  removeSurahRows,
  serialiseManifest,
  setDownloadState,
  setScope,
  setWifiOnly,
  surahIsComplete,
  totalsOf,
  upsertRows,
  verseKeyOf,
  type OfflineFileRow,
  type OfflineManifest,
} from '../storage/faith-offline-recitation';

/**
 * The offline recitation manifest: its schema, its codec, and the boundary that mutates it.
 *
 * ── What these tests are actually protecting ────────────────────────────────
 * One document describes 6,236 files, and every claim a user sees about their storage is derived
 * from it. Three things must therefore hold under conditions no unit of UI can reach:
 *
 *   1. It survives a round trip at full size, exactly, including the fields that carry `null`.
 *   2. A torn or edited document is **rejected whole** rather than partly believed.
 *   3. Concurrent mutations serialise, because a lost one silently un-downloads a file the user paid
 *      for and the repair pass then fetches again.
 */

function rowFor(surah: number, ayah: number, overrides?: Partial<OfflineFileRow>): OfflineFileRow {
  return {
    resourceId: PERMITTED_RESOURCE_ID,
    surah,
    ayah,
    verseKey: verseKeyOf(surah, ayah),
    fileName: offlineFileName(PERMITTED_RESOURCE_ID, surah, ayah),
    state: 'available',
    bytes: 4096,
    expectedBytes: null,
    validation: 'signature-ok',
    generationId: 'gen-1',
    sequence: ayah,
    completedAt: 1_755_000_000_000,
    verifiedAt: 1_755_000_000_000,
    ...overrides,
  };
}

/** Every ayah of the Qur'an, as manifest rows. Built from the independent count table. */
function completeManifest(): OfflineManifest {
  const rows: OfflineFileRow[] = [];
  for (let surah = 1; surah <= SURAH_COUNT; surah += 1) {
    for (let ayah = 1; ayah <= ayahCountOf(surah); ayah += 1) {
      rows.push(rowFor(surah, ayah));
    }
  }
  return { ...EMPTY_MANIFEST, download: 'complete', rows, generationId: 'gen-1' };
}

/** An in-memory file port, so the store's queue can be tested without the filesystem double. */
function memoryFile(): ManifestFilePort & {
  writes: number;
  fail: boolean;
  contents: string | null;
} {
  const port = {
    contents: null as string | null,
    writes: 0,
    fail: false,
    read: () => port.contents,
    write: (text: string) => {
      port.writes += 1;
      if (port.fail) {
        return false;
      }
      port.contents = text;
      return true;
    },
    remove: () => {
      port.contents = null;
    },
  };
  return port;
}

beforeEach(() => {
  mockFileSystem.reset();
});

describe('the permission is a property of the resource id, not a parameter', () => {
  it('permits resource 3 and refuses every other reciter', () => {
    expect(permanentDownloadPermitted(PERMITTED_RESOURCE_ID)).toBe(true);
    /*
      The regression this pins is the one the brief names as a stop gate: no permanent-download
      behaviour may apply to another reciter. There is deliberately no argument that could widen it,
      so this is a check that the function stayed a lookup rather than becoming a policy.
    */
    for (const other of [1, 2, 4, 7, 10, 168]) {
      expect(permanentDownloadPermitted(other)).toBe(false);
    }
  });

  it('names the permitted resource as 3, so the constant cannot drift silently', () => {
    expect(PERMITTED_RESOURCE_ID).toBe(3);
  });
});

describe('file names are deterministic and reversible', () => {
  it('derives a name from three integers and reads the same three back', () => {
    for (const [surah, ayah] of [
      [1, 1],
      [2, 255],
      [114, 6],
    ] as const) {
      const name = offlineFileName(PERMITTED_RESOURCE_ID, surah, ayah);
      expect(name).toBe(`r3-s${surah}-a${ayah}.mp3`);
      expect(parseOfflineFileName(name)).toEqual({
        resourceId: PERMITTED_RESOURCE_ID,
        surah,
        ayah,
      });
    }
  });

  it('produces 6,236 distinct names across all 114 surahs', () => {
    const names = new Set<string>();
    for (let surah = 1; surah <= SURAH_COUNT; surah += 1) {
      for (let ayah = 1; ayah <= ayahCountOf(surah); ayah += 1) {
        names.add(offlineFileName(PERMITTED_RESOURCE_ID, surah, ayah));
      }
    }
    expect(names.size).toBe(TOTAL_AYAT);
    expect(names.size).toBe(COMPLETE_AYAH_COUNT);
  });

  it('refuses a name that is not one of ours', () => {
    for (const name of ['', 'note.txt', 'r3-s1-a1.mp3.part', '../escape.mp3', 'rx-s1-a1.mp3']) {
      expect(parseOfflineFileName(name)).toBeNull();
    }
  });
});

describe('the complete manifest, at full size', () => {
  it('holds 6,236 rows over 114 surahs', () => {
    const manifest = completeManifest();
    expect(manifest.rows).toHaveLength(COMPLETE_AYAH_COUNT);
    expect(new Set(manifest.rows.map((row) => row.surah)).size).toBe(SURAH_COUNT);
  });

  it('round-trips through the codec without losing or inventing a field', () => {
    const manifest = completeManifest();
    const decoded = decodeManifest(encodeManifest(manifest));
    expect(decoded).not.toBeNull();
    expect(decoded?.rows).toHaveLength(COMPLETE_AYAH_COUNT);
    expect(decoded).toEqual(manifest);
  });

  it('reports per-surah completeness against the published counts', () => {
    const manifest = completeManifest();
    const expected = new Map(AYAH_COUNTS.map((count, index) => [index + 1, count]));
    const totals = totalsOf(manifest, expected);

    expect(totals.playableAyat).toBe(COMPLETE_AYAH_COUNT);
    expect(totals.completeSurahs).toBe(SURAH_COUNT);
    expect(totals.partialSurahs).toBe(0);
    expect(totals.failedAyat).toBe(0);
  });

  it('encodes 6,236 rows in a document small enough to rewrite repeatedly', () => {
    /*
      Not a style assertion. The manifest is rewritten as files land, and the short-key codec is the
      reason that is affordable at all — full field names would roughly double this. The bound is
      generous; what it catches is a future edit that puts a long field on every row.
    */
    const bytes = envelopeFor(completeManifest()).byteLength;
    expect(bytes).toBeLessThan(1_200_000);
  });
});

describe('a damaged document is rejected whole, never partly believed', () => {
  it('rejects a body whose checksum does not match', () => {
    const text = serialiseManifest(completeManifest());
    /*
      The body is a JSON string *inside* the envelope, so its own quotes arrive escaped. Editing the
      escaped form is what a hand-edit on a rooted device would actually look like, and it is the case
      the checksum exists to catch.
    */
    const tampered = text.replace('\\"available\\"', '\\"failed\\"');
    expect(tampered).not.toBe(text);
    expect(deserialiseManifest(tampered)).toBeNull();
  });

  it('rejects a truncated document', () => {
    const text = serialiseManifest(completeManifest());
    expect(deserialiseManifest(text.slice(0, text.length - 40))).toBeNull();
  });

  it('rejects the whole manifest when one row is unreadable', () => {
    /*
      All-or-nothing, deliberately. A manifest that dropped the rows it could not read would report
      fewer downloaded ayat than the device holds, and the repair pass would re-download files that
      are sitting right there. Discarding it costs a verification sweep instead.
    */
    const manifest = upsertRows(EMPTY_MANIFEST, [rowFor(1, 1), rowFor(1, 2)]);
    const encoded = JSON.parse(encodeManifest(manifest)) as { rows: unknown[] };
    encoded.rows[1] = [1, 0, 'available', 4096, null, 'signature-ok', 'gen-1', 2, null, null];
    expect(decodeManifest(JSON.stringify(encoded))).toBeNull();
  });

  it('rejects a manifest claiming a resource the permission does not cover', () => {
    const manifest = completeManifest();
    const encoded = JSON.parse(encodeManifest(manifest)) as { r: number };
    encoded.r = 7;
    expect(decodeManifest(JSON.stringify(encoded))).toBeNull();
  });

  it('rejects a document that is not JSON at all', () => {
    expect(deserialiseManifest('<html><body>Sign in to continue</body></html>')).toBeNull();
    expect(decodeManifest('not json')).toBeNull();
  });
});

describe('playability is a claim about validation, not about presence', () => {
  it('accepts only a checked, non-empty, available row', () => {
    expect(isPlayable(rowFor(1, 1))).toBe(true);
    expect(isPlayable(rowFor(1, 1, { state: 'downloaded' }))).toBe(false);
    expect(isPlayable(rowFor(1, 1, { validation: 'unverified' }))).toBe(false);
    expect(isPlayable(rowFor(1, 1, { validation: 'rejected' }))).toBe(false);
    expect(isPlayable(rowFor(1, 1, { bytes: 0 }))).toBe(false);
    expect(isPlayable(null)).toBe(false);
  });

  it('keeps an update-required file playable until its replacement is promoted', () => {
    /*
      ── The regression this exists to prevent, stated plainly ──────────────────
      Excluding `update-required` from the playable set looks conservative and is the opposite. The
      bytes were validated when they arrived and have not changed; what changed is that the publisher
      now offers a different recording. Withholding them would put a **hole in the surah** for the
      whole update window — playback would stop at that verse and the reader would tell the user a
      verse they demonstrably have is not downloaded.

      It is also the same harm Phase 4 forbids in the other direction: never remove the currently
      playable valid file before its replacement is ready. Making it unplayable without removing it is
      that rule broken by a quieter route.
    */
    const manifest = upsertRows(EMPTY_MANIFEST, [
      rowFor(1, 1),
      rowFor(1, 2, { state: 'update-required' }),
      rowFor(1, 3),
    ]);
    expect(playableAyatOf(manifest, 1)).toEqual([1, 2, 3]);
    expect(findRow(manifest, 1, 2)).not.toBeNull();
  });

  it('does not treat an unvalidated or empty file as playable whatever its state says', () => {
    for (const state of ['available', 'update-required'] as const) {
      expect(isPlayable(rowFor(1, 1, { state, validation: 'unverified' }))).toBe(false);
      expect(isPlayable(rowFor(1, 1, { state, validation: 'rejected' }))).toBe(false);
      expect(isPlayable(rowFor(1, 1, { state, bytes: 0 }))).toBe(false);
    }
  });

  it('reports a surah complete only when every published ayah is playable', () => {
    const seven = upsertRows(
      EMPTY_MANIFEST,
      Array.from({ length: 7 }, (_, index) => rowFor(1, index + 1)),
    );
    expect(surahIsComplete(seven, 1, 7)).toBe(true);

    const withGap = removeRows(seven, [{ surah: 1, ayah: 4 }]);
    expect(surahIsComplete(withGap, 1, 7)).toBe(false);
    /* And the run before the gap is still exactly what is playable. */
    expect(playableAyatOf(withGap, 1)).toEqual([1, 2, 3, 5, 6, 7]);
  });
});

describe('pure mutations return a whole manifest', () => {
  it('upserts by identity rather than appending', () => {
    const once = upsertRows(EMPTY_MANIFEST, [rowFor(2, 255)]);
    const twice = upsertRows(once, [rowFor(2, 255, { bytes: 8192 })]);
    expect(twice.rows).toHaveLength(1);
    expect(twice.rows[0]?.bytes).toBe(8192);
  });

  it('keeps rows in surah then ayah order however they arrive', () => {
    const manifest = upsertRows(EMPTY_MANIFEST, [rowFor(2, 3), rowFor(1, 2), rowFor(2, 1)]);
    expect(manifest.rows.map((row) => `${row.surah}:${row.ayah}`)).toEqual(['1:2', '2:1', '2:3']);
  });

  it('removes one surah without touching the others', () => {
    const manifest = upsertRows(EMPTY_MANIFEST, [rowFor(1, 1), rowFor(2, 1), rowFor(3, 1)]);
    const dropped = removeSurahRows(manifest, 2);
    expect(dropped.rows.map((row) => row.surah)).toEqual([1, 3]);
  });

  it('carries the download state, the scope and the Wi-Fi preference independently', () => {
    let manifest = setDownloadState(EMPTY_MANIFEST, 'waiting-for-wifi');
    manifest = setScope(manifest, { kind: 'selected', surahs: [3, 1, 1] });
    manifest = setWifiOnly(manifest, false);

    expect(manifest.download).toBe('waiting-for-wifi');
    /* Deduplicated and sorted, so a scope written twice is one scope. */
    expect(manifest.scope).toEqual({ kind: 'selected', surahs: [1, 3] });
    expect(manifest.wifiOnly).toBe(false);
    expect(decodeManifest(encodeManifest(manifest))).toEqual(manifest);
  });

  it('defaults Wi-Fi-only to on', () => {
    expect(EMPTY_MANIFEST.wifiOnly).toBe(true);
  });
});

describe('one run, one generation', () => {
  it('binds when nothing is bound', () => {
    const outcome = bindGeneration(EMPTY_MANIFEST, 'gen-1');
    expect(outcome.kind).toBe('bound');
  });

  it('refuses to rebind while a run is active', () => {
    /*
      The rule the whole reconciliation depends on. A run resolves URLs from a generation and records
      files as validated under it; moving the binding mid-run would make the manifest claim agreement
      with a publication those bytes were never compared to.
    */
    const running = { ...EMPTY_MANIFEST, generationId: 'gen-1', download: 'downloading' as const };
    expect(bindGeneration(running, 'gen-2').kind).toBe('refused');
  });

  it('allows rebinding once the run has stopped', () => {
    const stopped = {
      ...EMPTY_MANIFEST,
      generationId: 'gen-1',
      download: 'partially-downloaded' as const,
    };
    const outcome = bindGeneration(stopped, 'gen-2');
    expect(outcome.kind).toBe('bound');
    expect(outcome.kind === 'bound' && outcome.manifest.generationId).toBe('gen-2');
  });
});

describe('the mutation boundary serialises', () => {
  it('does not lose a mutation when two run concurrently', async () => {
    /*
      ── The defect this exists to make impossible ─────────────────────────────
      `read -> mutate -> write` with an await in the middle loses whichever of two interleaved
      mutations finishes first. In practice that is a promoted file silently reverting to
      not-downloaded, which the repair pass then re-downloads: the user pays for the same bytes twice
      and nothing reports a fault.
    */
    const file = memoryFile();
    const store = createOfflineManifestStore({ file });
    await store.load();

    await Promise.all([
      store.mutate((manifest) => upsertRows(manifest, [rowFor(1, 1)])),
      store.mutate((manifest) => upsertRows(manifest, [rowFor(1, 2)])),
      store.mutate((manifest) => setDownloadState(manifest, 'downloading')),
    ]);

    expect(store.current().rows).toHaveLength(2);
    expect(store.current().download).toBe('downloading');
    expect(deserialiseManifest(file.contents ?? '')?.rows).toHaveLength(2);
  });

  it('applies pause, remove and reconcile in the order they were requested', async () => {
    const file = memoryFile();
    const store = createOfflineManifestStore({ file });
    await store.load();
    await store.mutate((manifest) => upsertRows(manifest, [rowFor(1, 1), rowFor(2, 1)]));

    const order: string[] = [];
    await Promise.all([
      store.mutate((manifest) => {
        order.push('pause');
        return setDownloadState(manifest, 'paused');
      }),
      store.mutate((manifest) => {
        order.push('remove');
        return removeSurahRows(manifest, 2);
      }),
      store.mutate((manifest) => {
        order.push('reconcile');
        return { ...manifest, reconciledAt: 42 };
      }),
    ]);

    expect(order).toEqual(['pause', 'remove', 'reconcile']);
    expect(store.current().download).toBe('paused');
    expect(store.current().rows.map((row) => row.surah)).toEqual([1]);
    expect(store.current().reconciledAt).toBe(42);
  });

  it('reports a failed write rather than letting memory run ahead of the disk', async () => {
    const file = memoryFile();
    const store = createOfflineManifestStore({ file });
    await store.load();
    file.fail = true;

    /*
      The in-memory manifest still advances — the caller asked for the change and the run continues —
      but `false` is returned so the caller can stop rather than continue believing the device holds
      something it does not. `offline-download-service.test.ts` asserts the run actually stops.
    */
    expect(await store.mutate((manifest) => upsertRows(manifest, [rowFor(1, 1)]))).toBe(false);
    expect(file.contents).toBeNull();
  });

  it('does not poison the queue when one mutation throws', async () => {
    const file = memoryFile();
    const store = createOfflineManifestStore({ file });
    await store.load();

    await expect(
      store.mutate(() => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    /* The next mutation still runs. A single fault must not make the manifest unwritable forever. */
    expect(await store.mutate((manifest) => upsertRows(manifest, [rowFor(1, 1)]))).toBe(true);
    expect(store.current().rows).toHaveLength(1);
  });

  it('batches recorded promotions and flushes on demand', async () => {
    const file = memoryFile();
    const store = createOfflineManifestStore({ file, flushEvery: 5 });
    await store.load();

    for (let ayah = 1; ayah <= 4; ayah += 1) {
      await store.record((manifest) => upsertRows(manifest, [rowFor(1, ayah)]));
    }
    /* Four recorded, none written: the bytes are already durable, the index is not yet. */
    expect(file.writes).toBe(0);

    await store.record((manifest) => upsertRows(manifest, [rowFor(1, 5)]));
    expect(file.writes).toBe(1);
    expect(deserialiseManifest(file.contents ?? '')?.rows).toHaveLength(5);
  });

  it('writes far less than once per file over a complete download', async () => {
    /*
      3.7 GB of filesystem traffic to record 6,236 facts is not a micro-optimisation to avoid; it is
      the difference between a download that finishes and one that cooks the device. This pins the
      batching rather than the exact number.
    */
    const file = memoryFile();
    const store = createOfflineManifestStore({ file, flushEvery: 25 });
    await store.load();

    for (let index = 0; index < 500; index += 1) {
      await store.record((manifest) => upsertRows(manifest, [rowFor(1, index + 1)]));
    }
    expect(file.writes).toBe(20);
  });
});

describe('the manifest file itself', () => {
  it('lives in private application storage and nowhere else', async () => {
    const store = createOfflineManifestStore({ file: createExpoManifestFile() });
    await store.load();
    await store.mutate((manifest) => upsertRows(manifest, [rowFor(1, 1)]));

    const written = mockFileSystem.uris().filter((uri) => uri.includes('offline-recitation'));
    expect(written).toHaveLength(1);
    expect(written[0]).toBe('file:///documents/faith-offline-recitation/manifest.json');
    /*
      `Paths.document` is the app-internal files directory. Not the cache the OS may reclaim, not
      MediaStore, not shared storage. Licence condition C1 is a property of this path.
    */
    expect(written[0]).not.toContain('/cache/');
  });

  it('leaves no partial behind after a successful write', async () => {
    const store = createOfflineManifestStore({ file: createExpoManifestFile() });
    await store.load();
    await store.mutate((manifest) => upsertRows(manifest, [rowFor(1, 1)]));
    expect(mockFileSystem.uris().filter((uri) => uri.endsWith('.part'))).toHaveLength(0);
  });

  it('survives a reopen with every field intact', async () => {
    const first = createOfflineManifestStore({ file: createExpoManifestFile() });
    await first.load();
    await first.mutate((manifest) =>
      setScope(upsertRows(manifest, [rowFor(2, 255, { expectedBytes: 4096 })]), {
        kind: 'complete',
      }),
    );

    const second = createOfflineManifestStore({ file: createExpoManifestFile() });
    const reopened = await second.load();
    expect(reopened.rows).toHaveLength(1);
    expect(reopened.rows[0]?.expectedBytes).toBe(4096);
    expect(reopened.scope).toEqual({ kind: 'complete' });
  });

  it('falls back to the empty manifest rather than throwing on an unreadable document', async () => {
    mockFileSystem.seed(
      'file:///documents/faith-offline-recitation/manifest.json',
      new TextEncoder().encode('{"not":"a manifest"}'),
    );
    const store = createOfflineManifestStore({ file: createExpoManifestFile() });
    /*
      The bytes on disk are the durable fact; the index is rebuildable. A lost manifest costs a
      verification sweep and must never cost a user their downloads.
    */
    expect(await store.load()).toEqual(EMPTY_MANIFEST);
  });
});
