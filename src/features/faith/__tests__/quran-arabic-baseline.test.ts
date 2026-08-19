import type {
  QuranContentEndpoint,
  QuranContentPayload,
  QuranContentRequest,
  QuranEndpointFailure,
  WireChapter,
} from '@features/faith/data/quran-foundation/quran-foundation.contract';
import {
  ARABIC_INTERVAL_MS,
  CANONICAL_SYNC_FILTER,
  createContentSyncOrchestrator,
  RECITATION_INTEGRITY_INTERVAL_MS,
  SUDAIS_RESOURCE_ID,
  SYNC_INTERVAL_MS,
  TOTAL_AYAH_COUNT,
  TRANSLATION_RESOURCE_ID,
} from '@features/faith/data/sync/content-sync.orchestrator';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { clearSyncHealth } from '@features/faith/storage/faith-sync-checkpoint';
import { resetSyncStatus } from '@features/faith/data/sync/content-sync.revision';
import { createSyncSession } from '@features/faith/data/sync/content-sync.session';
import {
  ARABIC_STAGING_DIRECTORY,
  clearAllGenerations,
  readActiveGeneration,
  sweepGenerations,
} from '@features/faith/storage/faith-sync-generation';
import {
  areAyahCountsUsable,
  readArabicStagingPlan,
} from '@features/faith/storage/faith-arabic-staging';
import { ARABIC_SCRIPT, MAX_SURAH } from '@features/faith/storage/faith-arabic-rows';
import { mockFileSystem } from '@/../jest.setup';
import { createFakeConnectivity, WIFI_ONLINE } from '@/test-support/fake-connectivity-port';

/**
 * Building the complete Arabic baseline: paginated, resumable, and published only when whole.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── The two properties every case here is a facet of ───────────────────────
 * **Nothing incomplete is ever published.** The permission is for the complete, unmodified text, so
 * a dataset missing one verse is not a smaller licensed artefact — it is an unlicensed one. Partial
 * work therefore lives in a staging area with no reader, and only a fully validated 6,236-verse set
 * crosses into a generation.
 *
 * **Interrupted work is not lost work.** A complete baseline is about 180 authenticated requests,
 * shared against a rate limit every NoorLife device draws on. A design that restarted from surah 1
 * after every rate limit, lost connection or process death would spend that limit repeatedly to
 * arrive nowhere, so progress is durable and the next run resumes at the first missing surah.
 *
 * ── Ayah counts are the publisher's, never this repository's ───────────────
 * The counts below sum to 6,236 and are otherwise deliberately synthetic — a flat table with the
 * remainder on the last surah. Writing the real per-surah counts into a fixture would be authoring
 * scholarly content, which is exactly the reconstruction the licence forbids, and the production
 * code has no table either: it asks `list_chapters` and checks only that the answer sums to the
 * total the feature already states as a constant.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const NOW = 1_700_000_000_000;
const GEN_ROOT = 'file:///documents/quran-sync';

/** Synthetic per-surah counts summing to 6,236. Shaped like the real thing, and not it. */
function syntheticCounts(): number[] {
  const flat = 54;
  const counts = Array.from({ length: MAX_SURAH }, () => flat);
  counts[MAX_SURAH - 1] = TOTAL_AYAH_COUNT - flat * (MAX_SURAH - 1);
  return counts;
}

const COUNTS = syntheticCounts();

function chapters(counts: readonly number[]): readonly WireChapter[] {
  return counts.map((ayahCount, index) => ({
    number: index + 1,
    name: `Surah ${index + 1}`,
    arabicName: 'name',
    meaning: 'meaning',
    ayahCount,
    revelation: index % 2 === 0 ? ('meccan' as const) : ('medinan' as const),
  }));
}

type EndpointSpec = {
  readonly counts?: readonly number[];
  /** Fails every `list_verses` for these surahs, so a run can be interrupted at a known point. */
  readonly failVersesFrom?: number;
  /** Returns one verse fewer than the publisher's own count for this surah. */
  readonly shortSurah?: number;
  readonly versesPerPage?: number;
};

type Recorded = QuranContentEndpoint & { readonly requests: QuranContentRequest[] };

/**
 * An endpoint that answers the whole content surface, so a run can be exercised end to end.
 *
 * The feed answers with no mutations and a final token — a clean incremental response — because
 * these cases are about the Arabic path and not about the feed. Snapshots answer with a single row
 * for the same reason.
 */
function endpointFor(spec: EndpointSpec = {}): Recorded {
  const counts = spec.counts ?? COUNTS;
  const perPage = spec.versesPerPage ?? 50;
  const requests: QuranContentRequest[] = [];

  const answer = (body: QuranContentRequest): QuranContentPayload | QuranEndpointFailure => {
    switch (body.operation) {
      case 'sync_content_resources':
        return {
          operation: 'sync_content_resources',
          resources: CANONICAL_SYNC_FILTER,
          syncUntilSequence: 4200,
          hasMore: false,
          nextCursor: null,
          nextSyncToken: 'tok_final',
          mutations: [],
        };
      case 'get_content_snapshot':
        return {
          operation: 'get_content_snapshot',
          resourceGroup: body.resource_group,
          resourceId:
            body.resource_group === 'recitations' ? SUDAIS_RESOURCE_ID : TRANSLATION_RESOURCE_ID,
          schemaVersion: 1,
          syncSequence: 4200,
          rows: [
            body.resource_group === 'translations'
              ? { group: 'translations', surah: 1, ayah: 1, text: 'In the Name of Allah' }
              : { group: 'recitations', surah: 1, ayah: 1, durationSeconds: 5, bytes: 40_000 },
          ],
        };
      case 'list_translation_resources':
        return {
          operation: 'list_translation_resources',
          editions: [
            {
              id: '85',
              language: 'english',
              name: 'M.A.S. Abdel Haleem',
              translator: 'Abdul Haleem',
            },
          ],
        };
      case 'list_chapters':
        return { operation: 'list_chapters', chapters: chapters(counts) };
      case 'list_verses': {
        if (spec.failVersesFrom !== undefined && body.surah >= spec.failVersesFrom) {
          return 'unavailable';
        }
        const total = (counts[body.surah - 1] ?? 0) - (spec.shortSurah === body.surah ? 1 : 0);
        const page = body.page ?? 1;
        const start = (page - 1) * perPage;
        const slice = Array.from(
          { length: Math.max(0, Math.min(perPage, total - start)) },
          (_, index) => ({
            surah: body.surah,
            ayah: start + index + 1,
            arabic: `verse-${body.surah}-${start + index + 1}`,
          }),
        );
        return {
          operation: 'list_verses',
          verses: slice,
          pagination: { nextCursor: start + perPage < total ? String(page + 1) : null },
          source: { name: 'Quran Foundation', verified: true },
        };
      }
      default:
        return 'invalid-response';
    }
  };

  return {
    requests,
    request: async (body) => {
      requests.push(body);
      const result = answer(body);
      return await Promise.resolve(
        typeof result === 'string'
          ? { kind: 'failed' as const, failure: result }
          : { kind: 'ok' as const, data: result, cacheMaxAgeMs: 0 },
      );
    },
  };
}

function verseRequests(endpoint: Recorded): QuranContentRequest[] {
  return endpoint.requests.filter((request) => request.operation === 'list_verses');
}

function surahsAsked(endpoint: Recorded): number[] {
  return [
    ...new Set(
      verseRequests(endpoint).map((request) =>
        request.operation === 'list_verses' ? request.surah : 0,
      ),
    ),
  ];
}

/**
 * The backup boundary answers `excluded` unless a case says otherwise.
 *
 * Under Jest `Platform.OS` is `ios` and no native module is built, so the real boundary answers
 * `unavailable` and — correctly — refuses to retain Arabic at all. That is the fail-closed behaviour,
 * asserted in its own case below and in `quran-arabic-backup-exclusion.test.ts`; leaving it in force
 * for every case here would mean nothing under test ever fetches a verse.
 */
let mockExclusionOutcome: 'excluded' | 'not-required' | 'unavailable' | 'failed' = 'excluded';

jest.mock('@features/faith/storage/faith-backup-exclusion', () => ({
  ensureExcludedFromBackup: () => mockExclusionOutcome,
  isExcludedFromBackup: () => mockExclusionOutcome === 'excluded',
  isBackupSafe: (outcome: string) => outcome === 'excluded' || outcome === 'not-required',
}));

function runnerFor(endpoint: QuranContentEndpoint, clock: { current: number }) {
  return createContentSyncOrchestrator({
    endpoint,
    connectivity: createFakeConnectivity(WIFI_ONLINE),
    now: () => clock.current,
    session: createSyncSession('user-under-test'),
  });
}

beforeEach(async () => {
  mockFileSystem.reset();
  await clearAllGenerations();
  await clearSyncHealth();
  resetSyncStatus();
  mockExclusionOutcome = 'excluded';
});

describe('the ayah counts a baseline is measured against', () => {
  it('accepts a complete chapter list that sums to the whole Qur’an', () => {
    expect(areAyahCountsUsable(COUNTS)).toBe(true);
    expect(COUNTS.reduce((sum, count) => sum + count, 0)).toBe(TOTAL_AYAH_COUNT);
  });

  it.each([
    ['a surah missing', COUNTS.slice(0, -1)],
    ['a surah too many', [...COUNTS, 1]],
    ['a zero count', [0, ...COUNTS.slice(1)]],
    ['a fractional count', [1.5, ...COUNTS.slice(1)]],
  ])('refuses %s', (_label, counts) => {
    expect(areAyahCountsUsable(counts)).toBe(false);
  });

  it('refuses counts that sum to anything but the complete total', () => {
    const short = [...COUNTS];
    short[0] = (short[0] ?? 0) - 1;
    /* One verse short across the whole book. The only check that would catch it is the sum. */
    expect(areAyahCountsUsable(short)).toBe(false);
  });
});

describe('a complete baseline', () => {
  it('is fetched surah by surah and published inside the generation', async () => {
    const endpoint = endpointFor();
    const outcome = await runnerFor(endpoint, { current: NOW }).run();

    expect(outcome.kind).toBe('synced');
    expect(outcome.kind === 'synced' && outcome.arabic).toBe('complete');

    const active = await readActiveGeneration();
    expect(active?.arabic?.rows).toHaveLength(TOTAL_AYAH_COUNT);
    expect(active?.arabic?.script).toBe(ARABIC_SCRIPT);
    expect(active?.manifest.arabic?.lastCheckedAt).toBe(NOW);
  });

  it('asks the publisher for its chapter list rather than assuming ayah counts', async () => {
    const endpoint = endpointFor();
    await runnerFor(endpoint, { current: NOW }).run();

    const chapterCalls = endpoint.requests.filter((r) => r.operation === 'list_chapters');
    expect(chapterCalls).toHaveLength(1);
    expect(surahsAsked(endpoint)).toHaveLength(MAX_SURAH);
  });

  it('preserves the publisher’s Arabic byte for byte', async () => {
    const endpoint = endpointFor();
    await runnerFor(endpoint, { current: NOW }).run();

    const active = await readActiveGeneration();
    const first = active?.arabic?.rows[0];
    expect(first?.verseKey).toBe('1:1');
    expect(first?.text).toBe('verse-1-1');
  });

  it('clears the staging area once the text is inside a published generation', async () => {
    await runnerFor(endpointFor(), { current: NOW }).run();
    expect(readArabicStagingPlan()).toBeNull();
  });
});

describe('pagination', () => {
  it('follows the cursor the server gave instead of computing the next page', async () => {
    /*
      The server answers page 1 with a cursor of "9". A client that computed `page + 1` would ask for
      page 2 and silently skip fifty verses; one that follows the cursor asks for 9.
    */
    const requests: QuranContentRequest[] = [];
    const endpoint: Recorded = {
      requests,
      request: async (body) => {
        requests.push(body);
        if (body.operation !== 'list_verses') {
          return await endpointFor().request(body);
        }
        const page = body.page ?? 1;
        const count = COUNTS[body.surah - 1] ?? 0;
        const half = Math.ceil(count / 2);
        const isFirst = page === 1;
        const verses = Array.from({ length: isFirst ? half : count - half }, (_, index) => ({
          surah: body.surah,
          ayah: (isFirst ? 0 : half) + index + 1,
          arabic: `verse-${body.surah}-${(isFirst ? 0 : half) + index + 1}`,
        }));
        return await Promise.resolve({
          kind: 'ok' as const,
          data: {
            operation: 'list_verses' as const,
            verses,
            pagination: { nextCursor: isFirst ? '9' : null },
            source: { name: 'Quran Foundation', verified: true as const },
          },
          cacheMaxAgeMs: 0,
        });
      },
    };

    const outcome = await runnerFor(endpoint, { current: NOW }).run();
    expect(outcome.kind === 'synced' && outcome.arabic).toBe('complete');

    const pagesForSurahOne = verseRequests(endpoint)
      .filter((request) => request.operation === 'list_verses' && request.surah === 1)
      .map((request) => (request.operation === 'list_verses' ? request.page : undefined));
    expect(pagesForSurahOne).toEqual([1, 9]);
  });

  it('refuses a cursor that does not advance rather than looping on it', async () => {
    const requests: QuranContentRequest[] = [];
    const endpoint: Recorded = {
      requests,
      request: async (body) => {
        requests.push(body);
        if (body.operation !== 'list_verses') {
          return await endpointFor().request(body);
        }
        return await Promise.resolve({
          kind: 'ok' as const,
          data: {
            operation: 'list_verses' as const,
            verses: [{ surah: body.surah, ayah: 1, arabic: 'verse' }],
            /* Always page 1. A client that trusted this would never stop asking. */
            pagination: { nextCursor: '1' },
            source: { name: 'Quran Foundation', verified: true as const },
          },
          cacheMaxAgeMs: 0,
        });
      },
    };

    const outcome = await runnerFor(endpoint, { current: NOW }).run();
    expect(outcome.kind).toBe('failed');
    expect((await readActiveGeneration())?.arabic ?? null).toBeNull();
  });
});

describe('resuming an interrupted baseline', () => {
  it('keeps the surahs it already fetched and asks only for the rest', async () => {
    /* The first run is refused from surah 40 onward, so it stops with 39 surahs on disk. */
    const first = endpointFor({ failVersesFrom: 40 });
    const clock = { current: NOW };
    const interrupted = await runnerFor(first, clock).run();

    expect(interrupted.kind).toBe('failed');
    const plan = readArabicStagingPlan();
    expect(plan?.completed).toHaveLength(39);
    expect((await readActiveGeneration())?.arabic ?? null).toBeNull();

    /* Past the backoff, with a server that now answers everything. */
    clock.current = NOW + 60 * 60 * 1000;
    const second = endpointFor();
    const outcome = await runnerFor(second, clock).run();

    expect(outcome.kind === 'synced' && outcome.arabic).toBe('complete');
    expect(surahsAsked(second)).toHaveLength(MAX_SURAH - 39);
    expect(surahsAsked(second)).not.toContain(1);
    expect((await readActiveGeneration())?.arabic?.rows).toHaveLength(TOTAL_AYAH_COUNT);
  });

  it('reports partial progress as partial rather than as a fresh check', async () => {
    const endpoint = endpointFor({ failVersesFrom: 40 });
    const outcome = await runnerFor(endpoint, { current: NOW }).run();
    /* A failed run publishes nothing at all, so there is no outcome claiming a check happened. */
    expect(outcome.kind).toBe('failed');
    expect(readArabicStagingPlan()).not.toBeNull();
  });

  it('starts over when the publisher’s ayah counts changed', async () => {
    const first = endpointFor({ failVersesFrom: 40 });
    const clock = { current: NOW };
    await runnerFor(first, clock).run();
    expect(readArabicStagingPlan()?.completed).toHaveLength(39);

    /*
      A different chapter list describes a different dataset. Continuing across it would blend two
      publisher answers into one Qur'an, which is not the unmodified text of either.
    */
    const moved = [...COUNTS];
    moved[0] = (moved[0] ?? 0) + 1;
    moved[1] = (moved[1] ?? 0) - 1;

    clock.current = NOW + 60 * 60 * 1000;
    const second = endpointFor({ counts: moved });
    await runnerFor(second, clock).run();

    expect(surahsAsked(second)).toHaveLength(MAX_SURAH);
    expect(surahsAsked(second)).toContain(1);
  });

  it('survives the generation sweeper, which would otherwise reset it every publication', async () => {
    const endpoint = endpointFor({ failVersesFrom: 40 });
    await runnerFor(endpoint, { current: NOW }).run();
    expect(readArabicStagingPlan()?.completed).toHaveLength(39);

    await sweepGenerations();
    expect(readArabicStagingPlan()?.completed).toHaveLength(39);
    expect(ARABIC_STAGING_DIRECTORY).toBe('_arabic-staging');
  });
});

describe('a baseline that cannot be completed', () => {
  it('publishes no Arabic when a surah is short of the publisher’s own count', async () => {
    const endpoint = endpointFor({ shortSurah: 3 });
    const outcome = await runnerFor(endpoint, { current: NOW }).run();

    expect(outcome.kind).toBe('failed');
    expect((await readActiveGeneration())?.arabic ?? null).toBeNull();
    /* It stopped at the bad surah rather than spending the remaining requests to fail anyway. */
    expect(Math.max(...surahsAsked(endpoint))).toBe(3);
  });

  it('publishes the other datasets, which have their own terms, when Arabic is refused', async () => {
    mockExclusionOutcome = 'unavailable';
    const outcome = await runnerFor(endpointFor(), { current: NOW }).run();

    expect(outcome.kind).toBe('synced');
    const active = await readActiveGeneration();
    expect(active?.arabic ?? null).toBeNull();
    /*
      Recitations carry their own permission and their own terms, and refusing them because Arabic
      could not be retained would be a second wrong. The generation published, whole, without Arabic.
    */
    expect(active?.recitations.rows.length).toBeGreaterThan(0);
    expect(active?.manifest.feed.syncToken).toBe('tok_final');
  });

  it('asks for nothing at all when the device may not retain Arabic', async () => {
    mockExclusionOutcome = 'unavailable';
    const endpoint = endpointFor();
    const outcome = await runnerFor(endpoint, { current: NOW }).run();

    expect(outcome.kind === 'synced' && outcome.arabic).toBe('skipped');
    /* Not one of the ~180 requests is spent on text that would be refused at publication. */
    expect(verseRequests(endpoint)).toHaveLength(0);
    expect(endpoint.requests.filter((r) => r.operation === 'list_chapters')).toHaveLength(0);
  });
});

describe('telling a publisher fault apart from a device fault', () => {
  it('reports a short surah as an invalid response, which is a claim about the payload', async () => {
    const endpoint = endpointFor({ shortSurah: 3 });
    const outcome = await runnerFor(endpoint, { current: NOW }).run();

    expect(outcome.kind === 'failed' && outcome.failure).toBe('invalid-response');
  });

  it('reports a staging area it cannot write to as a write failure, not a bad payload', async () => {
    /*
      The distinction the first release-device run proved was needed. A plan file that could not be
      rewritten surfaced as `invalid-response`, and an operator reading that would go and look at the
      vendor's payloads for a fault that was entirely local.
    */
    mockFileSystem.failWritesTo(`${GEN_ROOT}/_arabic-staging/s-1.json.part`);

    const outcome = await runnerFor(endpointFor(), { current: NOW }).run();
    expect(outcome.kind === 'failed' && outcome.failure).toBe('write-failed');
  });
});

describe('the seven-day Arabic check', () => {
  it('does not re-read the text before its own clock elapses', async () => {
    const clock = { current: NOW };
    await runnerFor(endpointFor(), clock).run();

    clock.current = NOW + ARABIC_INTERVAL_MS - 1;
    const later = endpointFor();
    await runnerFor(later, clock).run({ force: true });

    expect(verseRequests(later)).toHaveLength(0);
    /* And the text it already holds is carried forward rather than dropped. */
    expect((await readActiveGeneration())?.arabic?.rows).toHaveLength(TOTAL_AYAH_COUNT);
  });

  it('re-reads the text once seven connected days have passed', async () => {
    const clock = { current: NOW };
    await runnerFor(endpointFor(), clock).run();

    clock.current = NOW + ARABIC_INTERVAL_MS;
    const later = endpointFor();
    const outcome = await runnerFor(later, clock).run();

    expect(outcome.kind === 'synced' && outcome.arabic).toBe('complete');
    expect(surahsAsked(later)).toHaveLength(MAX_SURAH);
    expect((await readActiveGeneration())?.manifest.arabic?.lastCheckedAt).toBe(
      NOW + ARABIC_INTERVAL_MS,
    );
  });

  it('is a clock of its own, not the feed clock or the recitation clock', () => {
    /*
      Equal to the feed interval by licence and separate from it by construction: the feed carries no
      scripture, so reading it says nothing about whether the Arabic text is current. The recitation
      clock is longer still, being an integrity safeguard rather than a currency obligation.
    */
    expect(ARABIC_INTERVAL_MS).toBe(SYNC_INTERVAL_MS);
    expect(ARABIC_INTERVAL_MS).toBeLessThan(RECITATION_INTEGRITY_INTERVAL_MS);
  });

  it('records the clock inside the generation and nowhere else', async () => {
    await runnerFor(endpointFor(), { current: NOW }).run();
    const keys = await AsyncStorage.getAllKeys();
    expect(keys.filter((key) => /arabic/i.test(key))).toEqual([]);
  });
});
