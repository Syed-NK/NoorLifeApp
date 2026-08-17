import {
  createTestOfflineService,
  downloadedUri,
  generationFor,
  resolverFor,
} from '@/test-support/faith-reader';

import { mockFileSystem } from '../../../../jest.setup';
import {
  createOfflineDownloadService,
  type BoundGeneration,
} from '../data/audio/offline-download.service';
import { createExpoAudioStore } from '../data/audio/expo-audio-store';
import { createExpoManifestFile } from '../data/audio/expo-manifest-file';
import { createOfflineManifestStore } from '../data/audio/offline-manifest.store';
import {
  ayatBySurah,
  pendingWork,
  planReconciliation,
  queuedRowFor,
  type PublishedRow,
} from '../data/audio/offline-reconcile';
import {
  EMPTY_MANIFEST,
  offlineFileName,
  PERMITTED_RESOURCE_ID,
  upsertRows,
  verseKeyOf,
  type OfflineFileRow,
} from '../storage/faith-offline-recitation';
import { isCheckDue, describeSync, SYNC_CHECK_INTERVAL_MS } from '../screens/offline-audio-screen';

/**
 * Reconciling what the device holds with what a published generation says.
 *
 * ── The provisional truth these tests are careful not to overstate ──────────
 * The change feed has **never** emitted a recitation mutation on any device to date — assumption
 * **A1**, recorded in `docs/QURAN_FOUNDATION_AUDIO_PERMISSION.md` §8.4. So nothing here proves a
 * mutation mechanism works in production; what it proves is that *given* a newer generation whose
 * rows differ, the device does the right thing with it. Every fixture below constructs that newer
 * generation directly, and no test asserts that one has ever arrived over the wire.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

function published(surah: number, ayah: number, overrides?: Partial<PublishedRow>): PublishedRow {
  return {
    surah,
    ayah,
    verseKey: verseKeyOf(surah, ayah),
    bytes: null,
    durationSeconds: null,
    sequence: ayah,
    ...overrides,
  };
}

function row(surah: number, ayah: number, overrides?: Partial<OfflineFileRow>): OfflineFileRow {
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
    completedAt: 1_000,
    verifiedAt: 1_000,
    ...overrides,
  };
}

beforeEach(() => {
  mockFileSystem.reset();
});

describe('the plan, as pure comparison', () => {
  it('leaves an unchanged row alone and advances only when it was last verified', () => {
    const manifest = upsertRows(EMPTY_MANIFEST, [row(1, 1), row(1, 2)]);
    const plan = planReconciliation({
      manifest,
      generationId: 'gen-2',
      published: [published(1, 1), published(1, 2)],
      at: 5_000,
    });

    expect(plan.updated).toHaveLength(0);
    expect(plan.withdrawn).toHaveLength(0);
    expect(plan.unchanged).toHaveLength(2);
    expect(plan.unchanged.every((entry) => entry.state === 'available')).toBe(true);
    expect(plan.unchanged.every((entry) => entry.verifiedAt === 5_000)).toBe(true);
    expect(plan.unchanged.every((entry) => entry.generationId === 'gen-2')).toBe(true);
  });

  it('marks a row update-required when the publisher sequence moved, and keeps it playable', () => {
    const manifest = upsertRows(EMPTY_MANIFEST, [row(1, 1, { sequence: 10 })]);
    const plan = planReconciliation({
      manifest,
      generationId: 'gen-2',
      published: [published(1, 1, { sequence: 11 })],
      at: 5_000,
    });

    expect(plan.updated).toHaveLength(1);
    expect(plan.updated[0]?.state).toBe('update-required');
    /*
      The file is untouched. A superseded recitation is still a recitation, and there is no instant at
      which the verse becomes unavailable — the replacement is promoted over it by an atomic rename.
    */
    expect(plan.updated[0]?.sequence).toBe(11);
  });

  it('marks a row update-required when the published size changed', () => {
    const manifest = upsertRows(EMPTY_MANIFEST, [row(1, 1, { expectedBytes: 4096 })]);
    const plan = planReconciliation({
      manifest,
      generationId: 'gen-2',
      published: [published(1, 1, { bytes: 8192 })],
      at: 5_000,
    });
    expect(plan.updated).toHaveLength(1);
    expect(plan.updated[0]?.expectedBytes).toBe(8192);
  });

  it('does not mark the whole Qur’an update-required on a feed that publishes no sizes', () => {
    /*
      The obvious bug: comparing *downloaded* bytes against the publisher would flag every file whose
      transfer legitimately differs from a stated size, and would flag every file at all when the feed
      states none. That is 6,236 spurious updates on the first sync.
    */
    const manifest = upsertRows(
      EMPTY_MANIFEST,
      Array.from({ length: 50 }, (_, index) => row(1, index + 1, { bytes: 3000 + index })),
    );
    const plan = planReconciliation({
      manifest,
      generationId: 'gen-2',
      published: Array.from({ length: 50 }, (_, index) => published(1, index + 1)),
      at: 5_000,
    });
    expect(plan.updated).toHaveLength(0);
  });

  it('reports a verse the publisher no longer publishes as withdrawn', () => {
    const manifest = upsertRows(EMPTY_MANIFEST, [row(1, 1), row(1, 2), row(1, 3)]);
    const plan = planReconciliation({
      manifest,
      generationId: 'gen-2',
      published: [published(1, 1), published(1, 3)],
      at: 5_000,
    });

    expect(plan.withdrawn.map((entry) => entry.ayah)).toEqual([2]);
    expect(plan.unchanged.map((entry) => entry.ayah)).toEqual([1, 3]);
  });

  it('reports verses the device does not hold without deciding to fetch them', () => {
    /*
      A device that downloaded three surahs is not "missing 6,000 files" — it is missing nothing.
      Whether an absent verse is wanted depends on the user's scope, which this module deliberately
      does not know.
    */
    const manifest = upsertRows(EMPTY_MANIFEST, [row(1, 1)]);
    const plan = planReconciliation({
      manifest,
      generationId: 'gen-2',
      published: [published(1, 1), published(1, 2), published(2, 1)],
      at: 5_000,
    });
    expect(plan.absentVerseKeys).toEqual(['1:2', '2:1']);
  });
});

describe('what still needs fetching', () => {
  it('skips what is verified and includes what is not', () => {
    const manifest = upsertRows(EMPTY_MANIFEST, [
      row(1, 1),
      row(1, 2, { state: 'failed' }),
      row(1, 3, { validation: 'unverified' }),
      row(1, 4, { bytes: 0 }),
    ]);
    const work = pendingWork({
      manifest,
      published: [1, 2, 3, 4, 5].map((ayah) => published(1, ayah)),
      surahs: [],
    });
    expect(work.map((entry) => entry.ayah)).toEqual([2, 3, 4, 5]);
  });

  it('includes an update-required row, because it is owed a replacement', () => {
    const manifest = upsertRows(EMPTY_MANIFEST, [row(1, 1, { state: 'update-required' })]);
    const work = pendingWork({ manifest, published: [published(1, 1)], surahs: [] });
    expect(work).toHaveLength(1);
  });

  it('honours a selected scope', () => {
    const work = pendingWork({
      manifest: EMPTY_MANIFEST,
      published: [published(1, 1), published(2, 1), published(3, 1)],
      surahs: [2],
    });
    expect(work.map((entry) => entry.surah)).toEqual([2]);
  });

  it('orders by surah then ayah, whatever order the publisher listed', () => {
    const work = pendingWork({
      manifest: EMPTY_MANIFEST,
      published: [published(2, 5), published(1, 3), published(2, 1), published(1, 1)],
      surahs: [],
    });
    expect(work.map((entry) => `${entry.surah}:${entry.ayah}`)).toEqual([
      '1:1',
      '1:3',
      '2:1',
      '2:5',
    ]);
  });
});

describe('queued rows keep a replacement playable', () => {
  it('queues a fresh verse as `queued`', () => {
    const queued = queuedRowFor({
      resourceId: PERMITTED_RESOURCE_ID,
      published: published(1, 1),
      generationId: 'gen-2',
    });
    expect(queued.state).toBe('queued');
    expect(queued.bytes).toBe(0);
  });

  it('keeps a replacement in `update-required` rather than dropping it to `queued`', () => {
    /*
      The distinction is what keeps the existing bytes playable while their replacement is fetched.
      `queued` describes a verse with nothing on disk, and a player that saw one would correctly
      refuse to source it — which would make the verse silently unavailable for the whole download.
    */
    const queued = queuedRowFor({
      resourceId: PERMITTED_RESOURCE_ID,
      published: published(1, 1),
      generationId: 'gen-2',
      previous: row(1, 1, { state: 'update-required' }),
    });
    expect(queued.state).toBe('update-required');
    expect(queued.bytes).toBe(4096);
  });
});

describe('the ayah counts come from the publication, not from a table in the app', () => {
  it('counts each surah from the rows it was given', () => {
    const counts = ayatBySurah([
      published(1, 1),
      published(1, 2),
      published(1, 3),
      published(114, 1),
    ]);
    expect(counts.get(1)).toBe(3);
    expect(counts.get(114)).toBe(1);
    expect(counts.get(2)).toBeUndefined();
  });
});

describe('applied against a live device', () => {
  /** A service whose generation can be swapped, so a newer publication can land between runs. */
  function serviceWithSwappableGeneration(initial: BoundGeneration) {
    let current = initial;
    const known = new Map<string, BoundGeneration>([[initial.generationId, initial]]);
    const service = createOfflineDownloadService({
      manifest: createOfflineManifestStore({ file: createExpoManifestFile() }),
      store: createExpoAudioStore('downloaded'),
      resolver: {
        resolve: async (surah, signal) => await resolverFor(current).resolve(surah, signal),
      },
      connectivity: {
        current: async () =>
          await Promise.resolve({
            isConnected: true,
            reachability: 'online' as const,
            kind: 'wifi' as const,
            isWifi: true,
            isMetered: false,
          }),
        currentOrUnknown: async () =>
          await Promise.resolve({
            isConnected: true,
            reachability: 'online' as const,
            kind: 'wifi' as const,
            isWifi: true,
            isMetered: false,
          }),
        subscribe: () => () => undefined,
      },
      generations: {
        active: async () => await Promise.resolve(current),
        open: (id) => known.get(id) ?? null,
      },
    });
    return {
      service,
      publish: (next: BoundGeneration) => {
        known.set(next.generationId, next);
        current = next;
      },
    };
  }

  it('never deletes a playable file before its replacement is ready', async () => {
    const { service, publish } = serviceWithSwappableGeneration(
      generationFor(1, 7, { generationId: 'gen-1' }),
    );
    await service.hydrate();
    await service.start({ kind: 'complete' });
    expect(service.snapshot().playableAyat).toBe(7);

    /* A newer publication in which verse 3 was re-recorded. */
    const newer: BoundGeneration = {
      generationId: 'gen-2',
      rows: generationFor(1, 7).rows.map((entry) =>
        entry.ayah === 3 ? { ...entry, sequence: 999 } : entry,
      ),
    };
    publish(newer);
    await service.reconcile();

    expect(service.snapshot().state).toBe('update-required');
    expect(service.snapshot().updateRequiredAyat).toBe(1);
    /*
      The bytes for verse 3 are still on disk and still the recitation the user has. The only thing
      that changed is that a replacement is owed.
    */
    expect(mockFileSystem.files.has(downloadedUri(1, 3))).toBe(true);
  });

  it('promotes the replacement and returns the verse to playable', async () => {
    const { service, publish } = serviceWithSwappableGeneration(
      generationFor(1, 7, { generationId: 'gen-1' }),
    );
    await service.hydrate();
    await service.start({ kind: 'complete' });

    publish({
      generationId: 'gen-2',
      rows: generationFor(1, 7).rows.map((entry) =>
        entry.ayah === 3 ? { ...entry, sequence: 999 } : entry,
      ),
    });
    await service.reconcile();
    await service.resume();

    expect(service.snapshot().updateRequiredAyat).toBe(0);
    expect(service.playableAyat(1)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(service.snapshot().generationId).toBe('gen-2');
  });

  it('keeps the previous recitation when the replacement fails to validate', async () => {
    const { service, publish } = serviceWithSwappableGeneration(
      generationFor(1, 7, { generationId: 'gen-1' }),
    );
    await service.hydrate();
    await service.start({ kind: 'complete' });

    publish({
      generationId: 'gen-2',
      rows: generationFor(1, 7).rows.map((entry) =>
        entry.ayah === 3 ? { ...entry, sequence: 999 } : entry,
      ),
    });
    await service.reconcile();

    /* The replacement arrives as a captive-portal page. */
    mockFileSystem.respondWith(() => new TextEncoder().encode('<html>portal</html>'));
    await service.resume();

    /*
      Nothing was lost. The old bytes are exactly where they were, and the verse is still playable —
      a failed replacement must never leave a hole where a recitation was.
    */
    expect(mockFileSystem.files.has(downloadedUri(1, 3))).toBe(true);
    expect(service.localUriFor(1, 3)).not.toBeNull();
  });

  it('removes a withdrawn verse promptly and takes its file with it', async () => {
    const { service, publish } = serviceWithSwappableGeneration(
      generationFor(1, 7, { generationId: 'gen-1' }),
    );
    await service.hydrate();
    await service.start({ kind: 'complete' });

    publish({
      generationId: 'gen-2',
      rows: generationFor(1, 7).rows.filter((entry) => entry.ayah !== 5),
    });
    await service.reconcile();

    expect(mockFileSystem.files.has(downloadedUri(1, 5))).toBe(false);
    expect(service.localUriFor(1, 5)).toBeNull();
    expect(service.playableAyat(1)).toEqual([1, 2, 3, 4, 6, 7]);
  });

  it('refuses to reconcile while a run is live', async () => {
    /*
      Applying a newer generation mid-run would mix publications inside one mutation, which is the
      single thing the generation model exists to forbid.
    */
    const generation = generationFor(1, 60, { generationId: 'gen-1' });
    const { service, publish } = serviceWithSwappableGeneration(generation);
    await service.hydrate();

    let reconciledDuringRun = false;
    mockFileSystem.respondWith(() => {
      if (!reconciledDuringRun) {
        reconciledDuringRun = true;
        publish({ generationId: 'gen-2', rows: generation.rows.slice(0, 3) });
        void service.reconcile();
      }
      return mockFileSystem.audioBytes(4096);
    });

    await service.start({ kind: 'complete' });

    /* The run finished under its own binding rather than being moved onto gen-2 mid-flight. */
    expect(service.snapshot().generationId).toBe('gen-1');
    expect(service.snapshot().playableAyat).toBe(60);
  });

  it('records when the check last succeeded', async () => {
    const service = createTestOfflineService({
      generation: generationFor(1, 7),
      now: () => 1_700_000_000_000,
    });
    await service.hydrate();
    await service.start({ kind: 'complete' });
    await service.reconcile();
    expect(service.snapshot().reconciledAt).toBe(1_700_000_000_000);
  });
});

describe('seven days is a check obligation, never a deletion rule', () => {
  it('reports a check due once the window has elapsed', () => {
    const now = 1_700_000_000_000;
    expect(isCheckDue(null, now)).toBe(true);
    expect(isCheckDue(now - 6 * DAY_MS, now)).toBe(false);
    expect(isCheckDue(now - 8 * DAY_MS, now)).toBe(true);
    /* A clock that moved backwards fails toward a check rather than toward freshness. */
    expect(isCheckDue(now + DAY_MS, now)).toBe(true);
    expect(SYNC_CHECK_INTERVAL_MS).toBe(7 * DAY_MS);
  });

  it('says the audio still plays when a check is overdue', () => {
    const now = 1_700_000_000_000;
    const message = describeSync(now - 30 * DAY_MS, 0, now);
    /*
      The wording is the licence condition. C7 obliges a *check*; C9 protects a device that has been
      offline. Any sentence here that threatened deletion by elapsed time would describe behaviour the
      permission forbids — and behaviour this app does not have.
    */
    expect(message).toMatch(/check is due/i);
    expect(message).toMatch(/still plays/i);
    expect(message).not.toMatch(/delete|remove|expire/i);
  });

  it('keeps audio playable after thirty offline days', async () => {
    let clock = 1_700_000_000_000;
    const service = createTestOfflineService({
      generation: generationFor(1, 7),
      now: () => clock,
    });
    await service.hydrate();
    await service.start({ kind: 'complete' });
    expect(service.snapshot().playableAyat).toBe(7);

    clock += 30 * DAY_MS;
    await service.hydrate();

    /*
      Nothing expires. There is no code path in this feature that deletes a permitted file because
      time passed, and this is the executable statement of that.
    */
    expect(service.snapshot().playableAyat).toBe(7);
    expect(service.localUriFor(1, 1)).not.toBeNull();
    expect(isCheckDue(service.snapshot().reconciledAt, clock)).toBe(true);
  });
});
