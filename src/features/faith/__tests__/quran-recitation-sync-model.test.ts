import type {
  QuranContentEndpoint,
  QuranContentPayload,
  QuranContentRequest,
  WireMutation,
  WireSyncRow,
} from '@features/faith/data/quran-foundation/quran-foundation.contract';
import {
  CANONICAL_SYNC_FILTER,
  createContentSyncOrchestrator,
  RECITATION_INTEGRITY_INTERVAL_MS,
  SUDAIS_RESOURCE_ID,
  SYNC_INTERVAL_MS,
  TOTAL_AYAH_COUNT,
  TRANSLATION_RESOURCE_ID,
} from '@features/faith/data/sync/content-sync.orchestrator';
import { resetSyncStatus } from '@features/faith/data/sync/content-sync.revision';
import {
  clearAllGenerations,
  publishGeneration,
  readActiveGeneration,
} from '@features/faith/storage/faith-sync-generation';
import { clearSyncHealth } from '@features/faith/storage/faith-sync-checkpoint';
import { mockFileSystem } from '@/../jest.setup';
import { createFakeConnectivity, WIFI_ONLINE } from '@/test-support/fake-connectivity-port';

/**
 * The recitation synchronisation model, as Quran Foundation confirmed it in writing.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── What was assumed, and what is now known ────────────────────────────────
 * NoorLife had never seen a recitation mutation on the change feed, and treated that as an open
 * question: "assumption A1, provisional". The working theory was that audio currency had to rest on
 * re-fetching the approved resource-3 snapshot every seven connected days and comparing it.
 *
 * Quran Foundation has now confirmed the actual behaviour: **existing recitations were intentionally
 * not backfilled into Content Sync change history.** A bootstrap therefore legitimately contains no
 * initial `RESOURCE_CREATE` for resource 3, and a feed returning no recitation mutation means no
 * recitation change has been recorded — a complete answer, not an absence of one.
 *
 * ── What that makes true, and what it deliberately does not ────────────────
 * The snapshot becomes the **baseline** mechanism (bootstrap) and an **integrity safeguard**
 * afterwards. It is no longer a weekly obligation, so a clean run costs one small feed read instead
 * of 6,236 rows against a vendor whose rate limits every NoorLife user shares.
 *
 * What does **not** change: the seven-connected-day feed obligation, the atomic generation
 * publication, and the rule that `recitationMutationObserved` is only ever true when a mutation was
 * genuinely read off the wire. "The vendor says none is expected" and "one arrived" are different
 * facts, and that field reports the second.
 *
 * Scope: **resource 3 audio only.** Nothing here authorises retaining the complete Arabic Qur'an for
 * the reader, which remains blocked on a separate written answer.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const NOW = 1_800_000_000_000;

function translationRow(surah: number, ayah: number): WireSyncRow {
  return { group: 'translations', surah, ayah, text: `Verse ${surah}:${ayah}` };
}

function recitationRow(surah: number, ayah: number): WireSyncRow {
  return { group: 'recitations', surah, ayah, durationSeconds: 5, bytes: 40_000 };
}

/** A complete, valid snapshot for one group — the same shape the session suite uses. */
function fullSnapshot(group: 'recitations' | 'translations'): QuranContentPayload {
  const rows: WireSyncRow[] = [];
  for (let index = 0; index < TOTAL_AYAH_COUNT; index += 1) {
    const surah = (index % 114) + 1;
    const ayah = Math.floor(index / 114) + 1;
    rows.push(group === 'translations' ? translationRow(surah, ayah) : recitationRow(surah, ayah));
  }
  return {
    operation: 'get_content_snapshot',
    resourceGroup: group,
    resourceId: group === 'recitations' ? SUDAIS_RESOURCE_ID : TRANSLATION_RESOURCE_ID,
    schemaVersion: 1,
    syncSequence: 4200,
    rows,
  };
}

/**
 * The bootstrap mutation a real feed carries — **translations only**.
 *
 * Quran Foundation confirmed existing recitations were intentionally not backfilled, so there is no
 * recitation  to model. Adding one would test a feed that does not exist.
 */
function translationResourceCreate(): WireMutation {
  return {
    sequence: 1,
    type: 'RESOURCE_CREATE',
    resourceGroup: 'translations',
    resourceId: TRANSLATION_RESOURCE_ID,
    snapshotRequired: true,
  };
}

function page(
  over: { readonly token?: string; readonly mutations?: readonly WireMutation[] } = {},
) {
  return {
    operation: 'sync_content_resources',
    resources: CANONICAL_SYNC_FILTER,
    syncUntilSequence: 4200,
    hasMore: false,
    nextCursor: null,
    nextSyncToken: over.token ?? 'tok_final',
    mutations: over.mutations ?? [],
  } satisfies QuranContentPayload;
}
/** The publisher catalogue the translator credit is resolved from. */
function translationCatalogue(): QuranContentPayload {
  return {
    operation: 'list_translation_resources',
    editions: [
      { id: '85', language: 'english', name: 'M.A.S. Abdel Haleem', translator: 'Abdul Haleem' },
    ],
  };
}

function endpointOf(answers: readonly QuranContentPayload[]) {
  const requests: QuranContentRequest[] = [];
  const endpoint: QuranContentEndpoint = {
    request: async (body) => {
      const index = requests.length;
      requests.push(body);
      const answer = answers[index];
      return await Promise.resolve(
        answer === undefined
          ? ({ kind: 'failed', failure: 'invalid-response' } as never)
          : ({ kind: 'ok', data: answer, cacheMaxAgeMs: 0 } as never),
      );
    },
  };
  return { endpoint, requests };
}

function orchestratorFor(endpoint: QuranContentEndpoint, now: number) {
  return createContentSyncOrchestrator({
    endpoint,
    connectivity: createFakeConnectivity(WIFI_ONLINE),
    now: () => now,
    session: { isValid: () => true },
  });
}

/** A published baseline with a full recitation row set, as a real bootstrap leaves behind. */
async function seedBaseline(
  checkedAt: number,
  options: { rows?: number; resourceId?: number } = {},
) {
  const rowCount = options.rows ?? 1;
  const recitationRows = [];
  for (let ayah = 1; ayah <= rowCount; ayah += 1) {
    recitationRows.push({
      verseKey: `1:${ayah}`,
      resourceId: options.resourceId ?? SUDAIS_RESOURCE_ID,
      surah: 1,
      ayah,
      durationSeconds: 3,
      bytes: null,
      sequence: 10,
      refreshedAt: checkedAt,
    });
  }
  const outcome = await publishGeneration({
    generationId: 'gen-baseline',
    createdAt: checkedAt,
    feed: { resources: CANONICAL_SYNC_FILTER, syncToken: 'tok_baseline', syncedUntilSequence: 10 },
    translations: {
      resourceId: TRANSLATION_RESOURCE_ID,
      attribution: {
        resourceId: TRANSLATION_RESOURCE_ID,
        name: 'The Clear Quran',
        translator: 'Dr. Mustafa Khattab',
      },
      rows: [
        {
          verseKey: '1:1',
          surah: 1,
          ayah: 1,
          text: 'baseline',
          resourceId: TRANSLATION_RESOURCE_ID,
          sequence: 10,
          refreshedAt: checkedAt,
        },
      ],
    },
    recitations: { resourceId: options.resourceId ?? SUDAIS_RESOURCE_ID, rows: recitationRows },
    recitation: { lastCheckedAt: checkedAt, method: 'snapshot', mutationEverObserved: false },
  });
  if (outcome.kind !== 'published') {
    throw new Error('seed did not publish');
  }
}

/** How many of the recorded requests asked for a resource-3 snapshot. */
function recitationSnapshotCount(requests: readonly QuranContentRequest[]): number {
  return requests.filter(
    (request) =>
      JSON.stringify(request).includes('snapshot') &&
      JSON.stringify(request).includes('recitation'),
  ).length;
}

beforeEach(async () => {
  mockFileSystem.reset();
  resetSyncStatus();
  await clearSyncHealth();
  await clearAllGenerations();
});

describe('the bootstrap, with no historical recitation mutation', () => {
  it('publishes a baseline from the snapshot rather than treating the absence as a fault', async () => {
    /*
      The confirmed shape: the feed carries a translation `RESOURCE_CREATE` and **nothing** for
      recitations, because history was never backfilled. That is a clean bootstrap, not a gap.
    */
    const { endpoint, requests } = endpointOf([
      page({ mutations: [translationResourceCreate()] }),
      fullSnapshot('translations'),
      /* Resolved between the two snapshots — see the orchestrator. */
      translationCatalogue(),
      fullSnapshot('recitations'),
    ]);

    const result = await orchestratorFor(endpoint, NOW).run();

    expect(result.kind).toBe('synced');
    const active = await readActiveGeneration();
    expect(active?.recitations.rows).toHaveLength(6236);
    expect(active?.recitations.resourceId).toBe(SUDAIS_RESOURCE_ID);
    /* And the snapshot really was read — the baseline came from somewhere. */
    expect(recitationSnapshotCount(requests)).toBe(1);
  });

  it('persists the final bootstrap sync token with the generation it acknowledges', async () => {
    const { endpoint } = endpointOf([
      page({ token: 'tok_bootstrap_final', mutations: [translationResourceCreate()] }),
      fullSnapshot('translations'),
      /* Resolved between the two snapshots — see the orchestrator. */
      translationCatalogue(),
      fullSnapshot('recitations'),
    ]);

    await orchestratorFor(endpoint, NOW).run();

    const active = await readActiveGeneration();
    expect(active?.manifest.feed.syncToken).toBe('tok_bootstrap_final');
    expect(active?.manifest.feed.resources).toBe(CANONICAL_SYNC_FILTER);
  });

  it('does not claim a recitation mutation was observed', async () => {
    /*
      The distinction the confirmation does **not** erase. Quran Foundation saying none is expected
      is not the same as one having arrived, and this field reports the second.
    */
    const { endpoint } = endpointOf([
      page({ mutations: [translationResourceCreate()] }),
      fullSnapshot('translations'),
      /* Resolved between the two snapshots — see the orchestrator. */
      translationCatalogue(),
      fullSnapshot('recitations'),
    ]);

    const result = await orchestratorFor(endpoint, NOW).run();

    expect(result.kind === 'synced' && result.recitationMutationObserved).toBe(false);
    expect((await readActiveGeneration())?.manifest.recitation.mutationEverObserved).toBe(false);
  });
});

describe('a clean no-mutation response', () => {
  it('does not re-fetch the 6,236-row snapshot merely because seven days passed', async () => {
    /*
      ── The behaviour this whole confirmation changes ────────────────────────
      The old code read `audioDue || force`, so every weekly check with no mutation pulled the entire
      recitation snapshot again. Now that a no-mutation feed is known to be a complete answer, that
      request is redundant traffic — and this is the assertion that keeps it gone.
    */
    await seedBaseline(NOW - SYNC_INTERVAL_MS - 1);
    const { endpoint, requests } = endpointOf([page({ token: 'tok_next' })]);

    const result = await orchestratorFor(endpoint, NOW).run();

    expect(result.kind).toBe('synced');
    expect(recitationSnapshotCount(requests)).toBe(0);
  });

  it('leaves the existing baseline and its audio clock standing', async () => {
    const checkedAt = NOW - SYNC_INTERVAL_MS - 1;
    await seedBaseline(checkedAt);
    const { endpoint } = endpointOf([page({ token: 'tok_next' })]);

    await orchestratorFor(endpoint, NOW).run();

    const active = await readActiveGeneration();
    expect(active?.recitations.rows).toHaveLength(1);
    expect(active?.recitations.rows[0]?.resourceId).toBe(SUDAIS_RESOURCE_ID);
  });
});

describe('the integrity safeguard, which is kept but reclassified', () => {
  it('re-reads the baseline when the local recitation rows are missing', async () => {
    /*
      A generation with no recitation rows cannot be incrementally corrected — there is nothing for a
      future mutation to apply to. This is one of the four documented reasons a snapshot is still
      taken, and it is about this device rather than about the vendor.
    */
    /* Feed due, so a normal weekly run happens — and finds the baseline unusable. */
    await seedBaseline(NOW - SYNC_INTERVAL_MS - 1, { rows: 0 });
    const { endpoint, requests } = endpointOf([
      page({ mutations: [translationResourceCreate()] }),
      fullSnapshot('translations'),
      /* Resolved between the two snapshots — see the orchestrator. */
      translationCatalogue(),
      fullSnapshot('recitations'),
    ]);

    await orchestratorFor(endpoint, NOW).run();

    expect(recitationSnapshotCount(requests)).toBe(1);
  });

  it('re-reads the baseline when the stored resource identity is not the approved reciter', async () => {
    /* Rows published under a different reciter are not this reciter's, and must not be merged. */
    await seedBaseline(NOW - SYNC_INTERVAL_MS - 1, { resourceId: 7 });
    const { endpoint, requests } = endpointOf([
      page({ mutations: [translationResourceCreate()] }),
      fullSnapshot('translations'),
      /* Resolved between the two snapshots — see the orchestrator. */
      translationCatalogue(),
      fullSnapshot('recitations'),
    ]);

    await orchestratorFor(endpoint, NOW).run();

    expect(recitationSnapshotCount(requests)).toBe(1);
  });

  it('re-reads the baseline once the bounded reconciliation interval has elapsed', async () => {
    await seedBaseline(NOW - RECITATION_INTEGRITY_INTERVAL_MS - 1);
    const { endpoint, requests } = endpointOf([
      page({ mutations: [translationResourceCreate()] }),
      fullSnapshot('translations'),
      /* Resolved between the two snapshots — see the orchestrator. */
      translationCatalogue(),
      fullSnapshot('recitations'),
    ]);

    await orchestratorFor(endpoint, NOW).run();

    expect(recitationSnapshotCount(requests)).toBe(1);
  });

  it('keeps the safeguard interval well clear of the weekly compliance cadence', () => {
    /*
      If these two converged, the safeguard would silently become the weekly snapshot again — which
      is the behaviour the confirmation removed.
    */
    expect(RECITATION_INTEGRITY_INTERVAL_MS).toBeGreaterThan(SYNC_INTERVAL_MS * 3);
  });
});
