import type {
  QuranContentEndpoint,
  QuranContentPayload,
  QuranContentRequest,
  QuranEndpointFailure,
  WireMutation,
  WireSyncRow,
} from '@features/faith/data/quran-foundation/quran-foundation.contract';
import {
  CANONICAL_SYNC_FILTER,
  createContentSyncOrchestrator,
  SUDAIS_RESOURCE_ID,
  TOTAL_AYAH_COUNT,
  SYNC_INTERVAL_MS,
  TRANSLATION_RESOURCE_ID,
} from '@features/faith/data/sync/content-sync.orchestrator';
import {
  BASE_BACKOFF_MS,
  clearSyncHealth,
  MIN_ATTEMPT_INTERVAL_MS,
  readSyncHealth,
} from '@features/faith/storage/faith-sync-checkpoint';
import { resetSyncStatus } from '@features/faith/data/sync/content-sync.revision';
import {
  createSyncSession,
  type SyncSession,
} from '@features/faith/data/sync/content-sync.session';
import {
  type ActiveGeneration,
  clearAllGenerations,
  publishGeneration,
  readActiveGeneration,
  readGenerationPointer,
} from '@features/faith/storage/faith-sync-generation';
import { mockFileSystem } from '@/../jest.setup';
import { createFakeConnectivity, WIFI_ONLINE } from '@/test-support/fake-connectivity-port';

/**
 * The Content Sync transaction.
 *
 * ── The one invariant every case here is a facet of ─────────────────────────
 * **A sync token is a claim that everything before it has been applied.** So the token is written
 * last, once, and only after every page and every required snapshot has published. Every failure
 * path must leave the previous token exactly where it was, because a token stored over work that did
 * not happen skips mutations the vendor will never offer again.
 *
 * ── The second theme: what has never been observed stays unobserved ─────────
 * The feed has never emitted a recitation mutation. Reconciliation therefore happens by re-fetching
 * the approved snapshot — assumption **A1**, provisional pending Quran Foundation's confirmation —
 * and several cases below exist purely to prove that path is recorded as `snapshot` and never
 * reported as a mutation that was seen.
 */

const NOW = 1_700_000_000_000;

/** One ayah row, shaped as the wire delivers it. */
function translationRow(surah: number, ayah: number): WireSyncRow {
  return { group: 'translations', surah, ayah, text: `Verse ${surah}:${ayah}` };
}

function recitationRow(surah: number, ayah: number): WireSyncRow {
  return { group: 'recitations', surah, ayah, durationSeconds: 5, bytes: 40_000 };
}

function resourceCreate(group: 'recitations' | 'translations', sequence: number): WireMutation {
  return {
    sequence,
    type: 'RESOURCE_CREATE',
    resourceGroup: group,
    resourceId: group === 'recitations' ? SUDAIS_RESOURCE_ID : TRANSLATION_RESOURCE_ID,
    snapshotRequired: true,
  };
}

type PageSpec = {
  readonly mutations?: readonly WireMutation[];
  readonly hasMore?: boolean;
  readonly nextCursor?: string | null;
  readonly nextSyncToken?: string | null;
  readonly resources?: string;
  readonly syncUntilSequence?: number;
};

function page(spec: PageSpec = {}): QuranContentPayload {
  const hasMore = spec.hasMore ?? false;
  return {
    operation: 'sync_content_resources',
    resources: spec.resources ?? CANONICAL_SYNC_FILTER,
    syncUntilSequence: spec.syncUntilSequence ?? 4200,
    hasMore,
    /* `in` rather than `??`: an explicitly-null token is the case under test, not an absent one. */
    nextCursor: 'nextCursor' in spec ? (spec.nextCursor ?? null) : hasMore ? 'cursor-1' : null,
    nextSyncToken:
      'nextSyncToken' in spec ? (spec.nextSyncToken ?? null) : hasMore ? null : 'tok_final',
    mutations: spec.mutations ?? [],
  };
}

function snapshot(
  group: 'recitations' | 'translations',
  rows: readonly WireSyncRow[],
): QuranContentPayload {
  return {
    operation: 'get_content_snapshot',
    resourceGroup: group,
    resourceId: group === 'recitations' ? SUDAIS_RESOURCE_ID : TRANSLATION_RESOURCE_ID,
    schemaVersion: 1,
    syncSequence: 4200,
    rows,
  };
}

/** A full-size snapshot, so completeness assertions are about the real count. */
function fullSnapshot(group: 'recitations' | 'translations'): QuranContentPayload {
  const rows: WireSyncRow[] = [];
  for (let index = 0; index < TOTAL_AYAH_COUNT; index += 1) {
    const surah = (index % 114) + 1;
    const ayah = Math.floor(index / 114) + 1;
    rows.push(group === 'translations' ? translationRow(surah, ayah) : recitationRow(surah, ayah));
  }
  return snapshot(group, rows);
}

type Scripted = QuranContentPayload | QuranEndpointFailure;

/**
 * An endpoint that answers **by operation** and records every request it was given.
 *
 * ── Why routed rather than sequential ───────────────────────────────────────
 * A positional script ties every test to the exact number of calls the transaction happens to make,
 * and a fresh device makes one more than an obvious reading suggests: with no stored audio clock the
 * recitation check is due, so a bootstrap legitimately fetches the recitation snapshot under
 * assumption A1. Routing by operation lets each case state the thing it is actually about.
 *
 * Snapshots default to a complete, correct one for the group asked for, so a case that does not care
 * about snapshots does not have to script them — and a case that *is* about a snapshot failure says
 * so explicitly.
 *
 * `requests` is what proves the transaction's shape: that a bootstrap sent no token, that an
 * incremental run sent the stored one, that pagination followed the cursor, and — most often — that
 * some request was **never** made.
 */
function scriptedEndpoint(spec: {
  readonly pages: readonly Scripted[];
  readonly snapshots?: Partial<Record<'recitations' | 'translations', Scripted>>;
}): QuranContentEndpoint & { readonly requests: QuranContentRequest[] } {
  const requests: QuranContentRequest[] = [];
  let pageIndex = 0;
  return {
    requests,
    request: async (body) => {
      requests.push(body);
      /*
        Narrowed by explicit operation rather than by an else-branch: the request union has nine
        members, so `else` is "any of the other eight" and does not reach `resource_group`.
      */
      let answer: Scripted = 'invalid-response';
      if (body.operation === 'sync_content_resources') {
        answer = spec.pages[Math.min(pageIndex++, spec.pages.length - 1)] ?? 'invalid-response';
      } else if (body.operation === 'get_content_snapshot') {
        answer = spec.snapshots?.[body.resource_group] ?? fullSnapshot(body.resource_group);
      }
      if (typeof answer === 'string') {
        return await Promise.resolve({ kind: 'failed' as const, failure: answer });
      }
      return await Promise.resolve({ kind: 'ok' as const, data: answer, cacheMaxAgeMs: 0 });
    },
  };
}

/** How many change-feed pages were requested. Snapshot calls are not pages. */
function pageRequests(endpoint: {
  readonly requests: QuranContentRequest[];
}): QuranContentRequest[] {
  return endpoint.requests.filter((r) => r.operation === 'sync_content_resources');
}

/**
 * A live owner for a transaction that is not about ownership.
 *
 * Every orchestrator has one — the dependency is required rather than optional precisely so a run
 * with no owner cannot be constructed. The session cases live in
 * `quran-content-sync-session.test.ts`; here it is simply the ordinary signed-in condition.
 */
function liveSession(): SyncSession {
  return createSyncSession('user-under-test');
}

function orchestratorWith(
  endpoint: QuranContentEndpoint,
  options: { readonly now?: () => number; readonly session?: SyncSession } = {},
) {
  const connectivity = createFakeConnectivity(WIFI_ONLINE);
  const session = options.session ?? liveSession();
  return {
    connectivity,
    session,
    orchestrator: createContentSyncOrchestrator({
      endpoint,
      connectivity,
      now: options.now ?? (() => NOW),
      session,
    }),
  };
}

/** Publishes a generation directly, so a test can start from a device that already has one. */
async function seedGeneration(
  over: {
    readonly token?: string;
    readonly createdAt?: number;
    readonly lastCheckedAt?: number;
    readonly translationText?: string;
  } = {},
): Promise<void> {
  const at = over.createdAt ?? NOW;
  const outcome = await publishGeneration({
    generationId: `gen-seed-${at}`,
    createdAt: at,
    feed: {
      resources: CANONICAL_SYNC_FILTER,
      syncToken: over.token ?? 'tok_stored',
      syncedUntilSequence: 10,
    },
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
          text: over.translationText ?? 'previous generation',
          resourceId: TRANSLATION_RESOURCE_ID,
          sequence: 1,
          refreshedAt: at,
        },
      ],
    },
    recitations: {
      resourceId: SUDAIS_RESOURCE_ID,
      rows: [
        {
          verseKey: '1:1',
          resourceId: SUDAIS_RESOURCE_ID,
          surah: 1,
          ayah: 1,
          durationSeconds: 5,
          bytes: 40_000,
          sequence: 1,
          refreshedAt: at,
        },
      ],
    },
    recitation: {
      lastCheckedAt: over.lastCheckedAt ?? at,
      method: 'snapshot',
      mutationEverObserved: false,
    },
  });
  if (outcome.kind !== 'published') {
    throw new Error('the seed generation did not publish');
  }
}

/** The active generation, or a thrown assertion. Every content read goes through the pointer. */
async function activeGeneration(): Promise<ActiveGeneration> {
  const generation = await readActiveGeneration();
  if (generation === null) {
    throw new Error('no active generation');
  }
  return generation;
}

beforeEach(async () => {
  mockFileSystem.reset();
  resetSyncStatus();
  await clearSyncHealth();
  await clearAllGenerations();
});

// ─────────────────────────────────────────────────────────────────────────────
// Bootstrap versus incremental
// ─────────────────────────────────────────────────────────────────────────────

describe('choosing bootstrap or incremental', () => {
  it('bootstraps when no token is stored, sending no sync_token', async () => {
    const endpoint = scriptedEndpoint({ pages: [page()] });
    const { orchestrator } = orchestratorWith(endpoint);

    const outcome = await orchestrator.run();

    expect(outcome.kind).toBe('synced');
    expect(outcome.kind === 'synced' && outcome.bootstrapped).toBe(true);
    const first = endpoint.requests[0];
    expect(first?.operation).toBe('sync_content_resources');
    expect(first && 'sync_token' in first).toBe(false);
  });

  it('runs incrementally with the stored token once one exists', async () => {
    await seedGeneration({ createdAt: NOW - SYNC_INTERVAL_MS });
    const endpoint = scriptedEndpoint({ pages: [page({ nextSyncToken: 'tok_next' })] });
    const { orchestrator } = orchestratorWith(endpoint);

    const outcome = await orchestrator.run();

    expect(outcome.kind === 'synced' && outcome.bootstrapped).toBe(false);
    const first = endpoint.requests[0];
    expect(first && 'sync_token' in first && first.sync_token).toBe('tok_stored');
  });

  it('never falls back from a failed incremental run to a bootstrap', async () => {
    /*
      A silent fallback would re-download every resource and hide a token problem behind a full
      refresh that looks like success. The failure is reported and the token is left alone.
    */
    await seedGeneration({ createdAt: NOW - SYNC_INTERVAL_MS });
    const endpoint = scriptedEndpoint({ pages: ['unavailable'] });
    const { orchestrator } = orchestratorWith(endpoint);

    const outcome = await orchestrator.run();

    expect(outcome).toEqual({ kind: 'failed', failure: 'unavailable' });
    expect(endpoint.requests).toHaveLength(1);
    expect((await activeGeneration()).manifest.feed.syncToken).toBe('tok_stored');
  });

  it('does nothing when neither clock is due', async () => {
    await seedGeneration({ createdAt: NOW, lastCheckedAt: NOW });
    const endpoint = scriptedEndpoint({ pages: [page()] });
    const { orchestrator } = orchestratorWith(endpoint);

    expect(await orchestrator.run()).toEqual({ kind: 'not-due' });
    expect(endpoint.requests).toHaveLength(0);
  });

  it('runs anyway when forced, without disturbing the due logic', async () => {
    await seedGeneration({ createdAt: NOW, lastCheckedAt: NOW });
    const endpoint = scriptedEndpoint({ pages: [page()] });
    const { orchestrator } = orchestratorWith(endpoint);

    expect((await orchestrator.run({ force: true })).kind).toBe('synced');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Pagination
// ─────────────────────────────────────────────────────────────────────────────

describe('pagination', () => {
  it('follows every page until has_more is false, carrying the cursor', async () => {
    const endpoint = scriptedEndpoint({
      pages: [
        page({ hasMore: true, nextCursor: 'c1' }),
        page({ hasMore: true, nextCursor: 'c2' }),
        page({ nextSyncToken: 'tok_end' }),
      ],
    });
    const { orchestrator } = orchestratorWith(endpoint);

    const outcome = await orchestrator.run();

    expect(outcome.kind === 'synced' && outcome.pages).toBe(3);
    const cursors = pageRequests(endpoint).map((r) =>
      r.operation === 'sync_content_resources' ? (r.cursor ?? null) : 'not-a-page',
    );
    expect(cursors).toEqual([null, 'c1', 'c2']);
    expect((await activeGeneration()).manifest.feed.syncToken).toBe('tok_end');
  });

  it('refuses a page that claims more and gives no cursor', async () => {
    const endpoint = scriptedEndpoint({ pages: [page({ hasMore: true, nextCursor: null })] });
    const { orchestrator } = orchestratorWith(endpoint);

    expect(await orchestrator.run()).toEqual({ kind: 'failed', failure: 'invalid-response' });
    expect(await readGenerationPointer()).toBeNull();
  });

  it('refuses a page answering for a different scope', async () => {
    /* Binding the token to the wrong filter is how a token answers for resources nobody asked for. */
    const endpoint = scriptedEndpoint({ pages: [page({ resources: 'translations:85' })] });
    const { orchestrator } = orchestratorWith(endpoint);

    expect(await orchestrator.run()).toEqual({ kind: 'failed', failure: 'invalid-response' });
  });

  it('refuses a run that ends with no token to commit', async () => {
    const endpoint = scriptedEndpoint({ pages: [page({ nextSyncToken: null })] });
    const { orchestrator } = orchestratorWith(endpoint);

    expect(await orchestrator.run()).toEqual({ kind: 'failed', failure: 'invalid-response' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The token is written last, or not at all
// ─────────────────────────────────────────────────────────────────────────────

describe('token commit ordering', () => {
  it('does not commit the token when a required snapshot fails', async () => {
    const endpoint = scriptedEndpoint({
      pages: [page({ mutations: [resourceCreate('translations', 1)] })],
      snapshots: { translations: 'unavailable' },
    });
    const { orchestrator } = orchestratorWith(endpoint);

    const outcome = await orchestrator.run();

    expect(outcome).toEqual({ kind: 'failed', failure: 'unavailable' });
    expect(await readGenerationPointer()).toBeNull();
    expect((await readSyncHealth()).lastFailure).toBe('unavailable');
  });

  it('preserves the previous rows when a later page fails mid-run', async () => {
    await seedGeneration({
      createdAt: NOW - SYNC_INTERVAL_MS,
      translationText: 'previous generation',
    });
    const endpoint = scriptedEndpoint({
      pages: [page({ hasMore: true, nextCursor: 'c1' }), 'timed-out'],
    });
    const { orchestrator } = orchestratorWith(endpoint);

    expect((await orchestrator.run()).kind).toBe('failed');

    const generation = await activeGeneration();
    expect(generation.translations.rows).toHaveLength(1);
    expect(generation.translations.rows[0]?.text).toBe('previous generation');
    /* And the token is still the previous generation's — content and token moved together, or not. */
    expect(generation.manifest.feed.syncToken).toBe('tok_stored');
  });

  it('commits the token only after the snapshot has published', async () => {
    const endpoint = scriptedEndpoint({
      pages: [page({ mutations: [resourceCreate('translations', 1)], nextSyncToken: 'tok_after' })],
    });
    const { orchestrator } = orchestratorWith(endpoint);

    const outcome = await orchestrator.run();

    expect(outcome.kind === 'synced' && outcome.translationsReplaced).toBe(true);
    expect((await activeGeneration()).translations.rows).toHaveLength(TOTAL_AYAH_COUNT);
    expect((await activeGeneration()).manifest.feed.syncToken).toBe('tok_after');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Translation replacement
// ─────────────────────────────────────────────────────────────────────────────

describe('translation snapshot replacement', () => {
  it('replaces resource 85 atomically with all 6,236 rows', async () => {
    const endpoint = scriptedEndpoint({
      pages: [page({ mutations: [resourceCreate('translations', 1)] })],
    });
    const { orchestrator } = orchestratorWith(endpoint);

    await orchestrator.run();

    const stored = (await activeGeneration()).translations;
    expect(stored.resourceId).toBe(TRANSLATION_RESOURCE_ID);
    expect(stored.rows).toHaveLength(TOTAL_AYAH_COUNT);
  });

  it('preserves the translator attribution across a replacement', async () => {
    /*
      The snapshot carries rows, not a credit. A screen that cannot name the translator must not
      render the translation — so replacing rows while dropping the credit would take a lawful
      offline translation and make it unshowable.
    */
    await seedGeneration({ createdAt: NOW - SYNC_INTERVAL_MS });
    const endpoint = scriptedEndpoint({
      pages: [page({ mutations: [resourceCreate('translations', 1)] })],
    });
    const { orchestrator } = orchestratorWith(endpoint);

    await orchestrator.run();

    expect((await activeGeneration()).translations.attribution?.translator).toBe(
      'Dr. Mustafa Khattab',
    );
  });

  it('refuses a snapshot answering for the wrong resource', async () => {
    const endpoint = scriptedEndpoint({
      pages: [page({ mutations: [resourceCreate('translations', 1)] })],
      snapshots: {
        translations: { ...snapshot('translations', []), resourceId: 20 } as QuranContentPayload,
      },
    });
    const { orchestrator } = orchestratorWith(endpoint);

    expect(await orchestrator.run()).toEqual({ kind: 'failed', failure: 'invalid-response' });
    expect(await readGenerationPointer()).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Recitations: the mutation that has never arrived, and A1
// ─────────────────────────────────────────────────────────────────────────────

describe('recitation reconciliation', () => {
  it('records a snapshot reconciliation as snapshot, never as an observed mutation', async () => {
    /*
      The live case. The bootstrap returns only the translation mutation, so the audio check falls
      due and the approved snapshot is reconciled — assumption A1, provisional.
    */
    const endpoint = scriptedEndpoint({
      pages: [page({ mutations: [resourceCreate('translations', 1)] })],
    });
    const { orchestrator } = orchestratorWith(endpoint);

    const outcome = await orchestrator.run();

    expect(outcome.kind).toBe('synced');
    expect(outcome.kind === 'synced' && outcome.recitationMutationObserved).toBe(false);
    expect(outcome.kind === 'synced' && outcome.recitationReconciliation).toBe('snapshot');

    const check = (await activeGeneration()).manifest.recitation;
    expect(check.method).toBe('snapshot');
    expect(check.mutationEverObserved).toBe(false);
    expect(check.lastCheckedAt).toBe(NOW);
  });

  it('records an actual recitation mutation as a mutation, and remembers it was seen', async () => {
    const endpoint = scriptedEndpoint({
      pages: [page({ mutations: [resourceCreate('recitations', 1)] })],
    });
    const { orchestrator } = orchestratorWith(endpoint);

    const outcome = await orchestrator.run();

    expect(outcome.kind === 'synced' && outcome.recitationMutationObserved).toBe(true);
    expect(outcome.kind === 'synced' && outcome.recitationReconciliation).toBe('mutation');
    const check = (await activeGeneration()).manifest.recitation;
    expect(check.method).toBe('mutation');
    expect(check.mutationEverObserved).toBe(true);
  });

  it('never unsets the record that a mutation was once observed', async () => {
    /* A later snapshot reconciliation must not erase that the feed was once seen to emit one. */
    const withMutation = scriptedEndpoint({
      pages: [page({ mutations: [resourceCreate('recitations', 1)], nextSyncToken: 'tok_m' })],
    });
    await orchestratorWith(withMutation).orchestrator.run();
    expect((await activeGeneration()).manifest.recitation.mutationEverObserved).toBe(true);

    const later = NOW + SYNC_INTERVAL_MS + 1;
    const snapshotOnly = scriptedEndpoint({ pages: [page({ nextSyncToken: 'tok_s' })] });
    await orchestratorWith(snapshotOnly, { now: () => later }).orchestrator.run();

    const check = (await activeGeneration()).manifest.recitation;
    expect(check.method).toBe('snapshot');
    expect(check.mutationEverObserved).toBe(true);
  });

  it('stores all 6,236 recitation rows for resource 3', async () => {
    const endpoint = scriptedEndpoint({ pages: [page()] });
    const { orchestrator } = orchestratorWith(endpoint);

    await orchestrator.run();

    const stored = (await activeGeneration()).recitations;
    expect(stored.resourceId).toBe(SUDAIS_RESOURCE_ID);
    expect(stored.rows).toHaveLength(TOTAL_AYAH_COUNT);
    /* And no audio URL crossed into storage — identity is surah and ayah, never an address. */
    expect(JSON.stringify(stored)).not.toContain('http');
  });

  it('skips the recitation snapshot when the audio check is not yet due', async () => {
    await seedGeneration({ createdAt: NOW - SYNC_INTERVAL_MS, lastCheckedAt: NOW });
    const endpoint = scriptedEndpoint({ pages: [page({ nextSyncToken: 'tok_2' })] });
    const { orchestrator } = orchestratorWith(endpoint);

    const outcome = await orchestrator.run();

    expect(outcome.kind === 'synced' && outcome.recitationReconciliation).toBe('none');
    expect(endpoint.requests).toHaveLength(1);
    expect(pageRequests(endpoint)).toHaveLength(1);
  });

  it('does not advance the audio clock when the recitation snapshot fails', async () => {
    const endpoint = scriptedEndpoint({
      pages: [page()],
      snapshots: { recitations: 'unavailable' },
    });
    const { orchestrator } = orchestratorWith(endpoint);

    expect((await orchestrator.run()).kind).toBe('failed');
    expect(await readGenerationPointer()).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Clocks stay apart
// ─────────────────────────────────────────────────────────────────────────────

describe('the separate clocks', () => {
  it('advances the feed clock while carrying the audio clock forward unchanged', async () => {
    /**
     * The independence that matters, and the shape that can actually show it.
     *
     * Both windows are seven days, so a run that reconciles both leaves them equal and they fall due
     * together thereafter. The clocks are genuinely separate fields recording different facts, and
     * the case that proves it is a generation whose clocks are **offset**: the feed is overdue and
     * the audio is not.
     *
     * The new generation must then carry the audio clock forward untouched rather than stamping it
     * with "now" — writing today's date onto a check that did not happen is exactly the substitution
     * that makes a licence obligation unauditable.
     */
    const audioAt = NOW - 1000;
    await seedGeneration({ createdAt: NOW - SYNC_INTERVAL_MS - 1, lastCheckedAt: audioAt });

    const endpoint = scriptedEndpoint({ pages: [page({ nextSyncToken: 'tok_feed_only' })] });
    const { orchestrator } = orchestratorWith(endpoint, { now: () => NOW });
    const outcome = await orchestrator.run();

    expect(outcome.kind === 'synced' && outcome.recitationReconciliation).toBe('none');
    /* One page, and no snapshot: the audio was not due, so nothing fetched it. */
    expect(pageRequests(endpoint)).toHaveLength(1);
    expect(endpoint.requests).toHaveLength(1);

    const generation = await activeGeneration();
    expect(generation.manifest.createdAt).toBe(NOW);
    expect(generation.manifest.recitation.lastCheckedAt).toBe(audioAt);
    expect(generation.manifest.feed.syncToken).toBe('tok_feed_only');
    /* And the previous generation's rows came with it, rather than being lost to a feed-only run. */
    expect(generation.translations.rows).toHaveLength(1);
    expect(generation.recitations.rows).toHaveLength(1);
  });

  it('treats an audio check falling due as reason enough to run', async () => {
    await seedGeneration({ createdAt: NOW, lastCheckedAt: NOW - SYNC_INTERVAL_MS - 1 });
    const endpoint = scriptedEndpoint({ pages: [page({ nextSyncToken: 'tok_4' })] });
    const { orchestrator } = orchestratorWith(endpoint);

    const outcome = await orchestrator.run();
    expect(outcome.kind === 'synced' && outcome.recitationReconciliation).toBe('snapshot');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// One transaction, however many callers
// ─────────────────────────────────────────────────────────────────────────────

describe('the single-flight guard', () => {
  it('runs one transaction when several subscribers ask at once', async () => {
    /*
      Captured through a holder rather than a `let`: TypeScript's control-flow analysis cannot see an
      assignment made inside the executor, and narrows the binding to `null` at every later use.
    */
    const gate: { open: (value: unknown) => void } = { open: () => {} };
    const held = new Promise((resolve) => {
      gate.open = resolve;
    });
    const requests: QuranContentRequest[] = [];
    const endpoint: QuranContentEndpoint = {
      request: async (body) => {
        requests.push(body);
        await held;
        const data =
          body.operation === 'get_content_snapshot' ? fullSnapshot(body.resource_group) : page();
        return { kind: 'ok', data, cacheMaxAgeMs: 0 };
      },
    };
    const { orchestrator } = orchestratorWith(endpoint);

    const first = orchestrator.run();
    const second = orchestrator.run();
    const third = orchestrator.run();

    expect(await second).toEqual({ kind: 'already-running' });
    expect(await third).toEqual({ kind: 'already-running' });
    expect(orchestrator.isRunning()).toBe(true);

    gate.open(null);
    expect((await first).kind).toBe('synced');
    expect(requests.filter((r) => r.operation === 'sync_content_resources')).toHaveLength(1);
    expect(orchestrator.isRunning()).toBe(false);
  });

  it('releases the guard after a failure so the next attempt can run', async () => {
    const endpoint = scriptedEndpoint({
      pages: ['unavailable', page({ nextSyncToken: 'tok_ok' })],
    });
    const { orchestrator } = orchestratorWith(endpoint);

    expect((await orchestrator.run()).kind).toBe('failed');
    expect(orchestrator.isRunning()).toBe(false);

    /*
      Immediately afterwards the backoff refuses, which is the whole point of it: a device flapping
      between networks fires a trigger per event, and each one would otherwise be a fresh run against
      a server still refusing. `throttled` is distinct from `already-running` — nothing is in flight;
      it is simply too soon.
    */
    const throttled = await orchestrator.run();
    expect(throttled.kind).toBe('throttled');
    expect(throttled.kind === 'throttled' && throttled.retryAfterMs).toBeGreaterThan(0);

    /* Past the window, the guard is released and the retry runs. */
    const later = NOW + BASE_BACKOFF_MS + MIN_ATTEMPT_INTERVAL_MS;
    const { orchestrator: retried } = orchestratorWith(endpoint, { now: () => later });
    expect((await retried.run()).kind).toBe('synced');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Connectivity
// ─────────────────────────────────────────────────────────────────────────────

describe('connectivity', () => {
  it('does not contact the endpoint when the device is offline', async () => {
    const endpoint = scriptedEndpoint({ pages: [page()] });
    const connectivity = createFakeConnectivity();
    const orchestrator = createContentSyncOrchestrator({
      endpoint,
      connectivity,
      now: () => NOW,
      session: liveSession(),
    });

    expect(await orchestrator.run()).toEqual({ kind: 'failed', failure: 'offline' });
    expect(endpoint.requests).toHaveLength(0);
  });

  it('does not run on a link that cannot reach the internet', async () => {
    const endpoint = scriptedEndpoint({ pages: [page()] });
    const connectivity = createFakeConnectivity();
    connectivity.set({ kind: 'wifi', reachability: 'link-only' });
    const orchestrator = createContentSyncOrchestrator({
      endpoint,
      connectivity,
      now: () => NOW,
      session: liveSession(),
    });

    expect(await orchestrator.run()).toEqual({ kind: 'failed', failure: 'offline' });
    expect(endpoint.requests).toHaveLength(0);
  });

  it('does not record an offline attempt as a checkpoint failure', async () => {
    /*
      Being offline is the expected state for an offline device. Writing a failure for it would make
      an ordinary aeroplane journey look like a broken integration.
    */
    const endpoint = scriptedEndpoint({ pages: [page()] });
    const connectivity = createFakeConnectivity();
    const orchestrator = createContentSyncOrchestrator({
      endpoint,
      connectivity,
      now: () => NOW,
      session: liveSession(),
    });

    await orchestrator.run();

    expect((await readSyncHealth()).lastFailure).toBeNull();
  });

  it('runs over cellular, because a licence check is not a bandwidth decision', async () => {
    const endpoint = scriptedEndpoint({ pages: [page()] });
    const connectivity = createFakeConnectivity();
    connectivity.set({ kind: 'cellular', reachability: 'online' });
    const orchestrator = createContentSyncOrchestrator({
      endpoint,
      connectivity,
      now: () => NOW,
      session: liveSession(),
    });

    expect((await orchestrator.run()).kind).toBe('synced');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Nothing sensitive crosses
// ─────────────────────────────────────────────────────────────────────────────

describe('what the transaction does not carry', () => {
  it('sends no resource name, filter or id in any request', async () => {
    /* The canonical filter lives on the server. A device says where it is, never what it wants. */
    const endpoint = scriptedEndpoint({
      pages: [page({ mutations: [resourceCreate('translations', 1)] })],
    });
    const { orchestrator } = orchestratorWith(endpoint);

    await orchestrator.run();

    const serialised = JSON.stringify(endpoint.requests);
    expect(serialised).not.toContain('recitations:3');
    expect(serialised).not.toContain('translations:85');
    expect(serialised).not.toContain('http');
    for (const request of endpoint.requests) {
      if (request.operation === 'get_content_snapshot') {
        expect(Object.keys(request).sort()).toEqual(['operation', 'resource_group']);
      }
    }
  });
});
