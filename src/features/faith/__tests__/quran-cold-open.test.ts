import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  createQuranFoundationRepository,
  defaultQuranCachePolicy,
  MAX_CACHE_AGE_MS,
  type QuranContentPayload,
  type QuranContentRequest,
  type QuranEndpointOutcome,
  type SurahCatalogueStore,
  type WireChapter,
} from '../data/quran-foundation';
import { hasData } from '../data/faith-result';
import {
  DEFAULT_TRANSLATION_CHOICE,
  defaultFaithPreferences,
  migratePreferences,
} from '../storage/faith-preferences';
import {
  clearCachedCatalogue,
  isValidCatalogue,
  readCachedCatalogue,
  SURAH_COUNT,
  writeCachedCatalogue,
} from '../storage/faith-quran-catalogue';

/**
 * Opening the Qur'an must not wait for the network twice for the same answer.
 *
 * Every test here pins one step of the cold-open path that was measured to be slow, and each would
 * have failed before this change:
 *
 *   • the catalogue was refetched on every process start, because the only cache died with it;
 *   • two callers asking at once produced two authenticated round trips;
 *   • the default translation was rediscovered from the live catalogue on every install, across up
 *     to six sequential requests, with the reader held until they finished.
 */

function chapter(number: number): WireChapter {
  return {
    number,
    name: `Surah ${number}`,
    arabicName: 'اسم',
    meaning: 'Meaning',
    ayahCount: 7,
    revelation: number % 2 === 0 ? 'medinan' : 'meccan',
  };
}

/** A complete, well-formed catalogue. Nothing here is scripture — these are chapter names. */
const fullCatalogue: readonly WireChapter[] = Array.from({ length: SURAH_COUNT }, (_, index) =>
  chapter(index + 1),
);

type Recorder = {
  readonly endpoint: {
    request(request: QuranContentRequest): Promise<QuranEndpointOutcome<QuranContentPayload>>;
  };
  readonly calls: QuranContentRequest[];
  /** Held open so a test can prove two callers joined one request rather than making two. */
  release: () => void;
};

function recordingEndpoint(options?: { readonly defer?: boolean }): Recorder {
  const calls: QuranContentRequest[] = [];
  let unblock: (() => void) | null = null;
  const gate = options?.defer === true ? new Promise<void>((resolve) => (unblock = resolve)) : null;

  return {
    calls,
    release: () => unblock?.(),
    endpoint: {
      async request(request) {
        calls.push(request);
        if (gate !== null) {
          await gate;
        }
        return {
          kind: 'ok',
          data: { operation: 'list_chapters', chapters: fullCatalogue },
          cacheMaxAgeMs: defaultQuranCachePolicy.catalogueMaxAgeMs,
        };
      },
    },
  };
}

/** A store backed by a plain object, so these tests assert the repository rather than AsyncStorage. */
function memoryStore(
  seed?: readonly WireChapter[],
  storedAt = NOW,
): SurahCatalogueStore & { readonly writes: number } {
  let held = seed === undefined ? null : { chapters: seed, storedAt };
  const state = { writes: 0 };
  return {
    get writes() {
      return state.writes;
    },
    read: () => Promise.resolve(held),
    write: (chapters) => {
      state.writes += 1;
      held = { chapters, storedAt: NOW };
      return Promise.resolve();
    },
  };
}

/** A fixed clock, so freshness is a value these tests set rather than one they race. */
const NOW = Date.UTC(2026, 7, 11, 12, 0, 0);

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('the persisted surah catalogue', () => {
  it('serves all 114 surahs without a request when one is already stored', async () => {
    const recorder = recordingEndpoint();
    const repository = createQuranFoundationRepository({
      cachePolicy: defaultQuranCachePolicy,
      serveStaleWhenOffline: true,
      endpoint: recorder.endpoint,
      now: () => NOW,
      catalogueStore: memoryStore(fullCatalogue),
    });

    const result = await repository.listSurahs();

    expect(hasData(result)).toBe(true);
    expect(hasData(result) ? result.data.length : 0).toBe(SURAH_COUNT);
    // The whole point: a cold process answered the catalogue with zero network reads.
    expect(recorder.calls).toEqual([]);
  });

  it('fetches once and writes through when nothing is stored', async () => {
    const recorder = recordingEndpoint();
    const store = memoryStore();
    const repository = createQuranFoundationRepository({
      cachePolicy: defaultQuranCachePolicy,
      serveStaleWhenOffline: true,
      endpoint: recorder.endpoint,
      catalogueStore: store,
    });

    await repository.listSurahs();

    expect(recorder.calls).toHaveLength(1);
    expect(store.writes).toBe(1);
    expect((await store.read())?.chapters).toHaveLength(SURAH_COUNT);
  });

  it('refresh: true steps over both caches and re-reads from the source', async () => {
    const recorder = recordingEndpoint();
    const repository = createQuranFoundationRepository({
      cachePolicy: defaultQuranCachePolicy,
      serveStaleWhenOffline: true,
      endpoint: recorder.endpoint,
      now: () => NOW,
      catalogueStore: memoryStore(fullCatalogue),
    });

    await repository.listSurahs();
    expect(recorder.calls).toHaveLength(0);

    const refreshed = await repository.listSurahs({ refresh: true });

    expect(recorder.calls).toHaveLength(1);
    expect(hasData(refreshed) ? refreshed.data.length : 0).toBe(SURAH_COUNT);
  });

  it('reports a catalogue past its freshness window as stale, and still draws it', async () => {
    const recorder = recordingEndpoint();
    const dayOld = NOW - defaultQuranCachePolicy.catalogueMaxAgeMs - 1;
    const repository = createQuranFoundationRepository({
      cachePolicy: defaultQuranCachePolicy,
      serveStaleWhenOffline: true,
      endpoint: recorder.endpoint,
      now: () => NOW,
      catalogueStore: memoryStore(fullCatalogue, dayOld),
    });

    const result = await repository.listSurahs();

    // Servable and complete — the rows are drawn. `stale` is only the signal that a background
    // re-check is warranted; it is not a failure and it costs no request here.
    expect(result.kind).toBe('stale');
    expect(hasData(result) ? result.data.length : 0).toBe(SURAH_COUNT);
    expect(recorder.calls).toEqual([]);
  });

  it('does not mark a catalogue stale while it is still inside the freshness window', async () => {
    const recorder = recordingEndpoint();
    const repository = createQuranFoundationRepository({
      cachePolicy: defaultQuranCachePolicy,
      serveStaleWhenOffline: true,
      endpoint: recorder.endpoint,
      now: () => NOW,
      catalogueStore: memoryStore(fullCatalogue, NOW - 1),
    });

    expect((await repository.listSurahs()).kind).toBe('ok');
    expect(recorder.calls).toEqual([]);
  });

  it('still answers from the store when the store itself throws', async () => {
    const recorder = recordingEndpoint();
    const repository = createQuranFoundationRepository({
      cachePolicy: defaultQuranCachePolicy,
      serveStaleWhenOffline: true,
      endpoint: recorder.endpoint,
      catalogueStore: {
        read: () => Promise.reject(new Error('storage backend unavailable')),
        write: () => Promise.reject(new Error('storage backend unavailable')),
      },
    });

    // A broken store is a cache miss, not a screen failure: the request happens as it always would.
    const result = await repository.listSurahs();

    expect(hasData(result)).toBe(true);
    expect(recorder.calls).toHaveLength(1);
  });
});

describe('duplicate requests', () => {
  it('joins two simultaneous identical reads into one invocation', async () => {
    const recorder = recordingEndpoint({ defer: true });
    const repository = createQuranFoundationRepository({
      cachePolicy: defaultQuranCachePolicy,
      serveStaleWhenOffline: true,
      endpoint: recorder.endpoint,
      catalogueStore: memoryStore(),
    });

    const first = repository.listSurahs();
    const second = repository.listSurahs();
    recorder.release();
    const [a, b] = await Promise.all([first, second]);

    expect(recorder.calls).toHaveLength(1);
    expect(hasData(a) && hasData(b)).toBe(true);
    expect(hasData(a) ? a.data.length : 0).toBe(SURAH_COUNT);
    expect(hasData(b) ? b.data.length : 0).toBe(SURAH_COUNT);
  });

  it('does not poison the key when the joined request fails', async () => {
    let attempts = 0;
    const repository = createQuranFoundationRepository({
      cachePolicy: defaultQuranCachePolicy,
      serveStaleWhenOffline: true,
      endpoint: {
        request: async () => {
          attempts += 1;
          if (attempts === 1) {
            return { kind: 'failed', failure: 'unavailable' };
          }
          return {
            kind: 'ok',
            data: { operation: 'list_chapters', chapters: fullCatalogue },
            cacheMaxAgeMs: defaultQuranCachePolicy.catalogueMaxAgeMs,
          };
        },
      },
      catalogueStore: memoryStore(),
    });

    const failed = await repository.listSurahs();
    expect(failed.kind).toBe('error');

    // A retry must reach the endpoint again rather than joining a dead entry.
    const recovered = await repository.listSurahs();
    expect(hasData(recovered)).toBe(true);
    expect(attempts).toBe(2);
  });
});

describe('the stored catalogue is validated, not merely parsed', () => {
  it('refuses a catalogue that is not all 114 surahs', async () => {
    expect(await writeCachedCatalogue(fullCatalogue.slice(0, 113))).toBe(false);
    expect(await readCachedCatalogue()).toBeNull();
  });

  it('refuses 114 rows that are not the complete set of numbers', () => {
    const duplicated = [...fullCatalogue.slice(0, 113), chapter(1)];
    expect(isValidCatalogue({ version: 1, storedAt: Date.now(), chapters: duplicated })).toBe(
      false,
    );
  });

  it('refuses a row with a missing field', () => {
    const broken = [...fullCatalogue.slice(0, 113), { ...chapter(114), arabicName: '' }];
    expect(isValidCatalogue({ version: 1, storedAt: Date.now(), chapters: broken })).toBe(false);
  });

  it('drops an entry past the one-week licence ceiling rather than serving it', async () => {
    const start = Date.UTC(2026, 7, 11);
    expect(await writeCachedCatalogue(fullCatalogue, () => start)).toBe(true);

    // One millisecond inside the window is servable; the ceiling itself is not.
    expect(await readCachedCatalogue(() => start + MAX_CACHE_AGE_MS - 1)).not.toBeNull();
    await writeCachedCatalogue(fullCatalogue, () => start);
    expect(await readCachedCatalogue(() => start + MAX_CACHE_AGE_MS)).toBeNull();
  });

  it('drops an entry stored in the future, because its age cannot be reasoned about', async () => {
    const start = Date.UTC(2026, 7, 11);
    await writeCachedCatalogue(fullCatalogue, () => start);
    expect(await readCachedCatalogue(() => start - 1)).toBeNull();
  });

  it('holds no verse, translation or audio URL — only chapter metadata', async () => {
    await writeCachedCatalogue(fullCatalogue);
    const raw = await AsyncStorage.getItem('noorlife.faith.quran.catalogue');
    const stored: unknown = JSON.parse(raw ?? 'null');
    const keys = new Set(
      (stored as { chapters: Record<string, unknown>[] }).chapters.flatMap((row) =>
        Object.keys(row),
      ),
    );
    expect([...keys].sort()).toEqual([
      'arabicName',
      'ayahCount',
      'meaning',
      'name',
      'number',
      'revelation',
    ]);
  });

  it('clears on request', async () => {
    await writeCachedCatalogue(fullCatalogue);
    await clearCachedCatalogue();
    expect(await readCachedCatalogue()).toBeNull();
  });
});

describe('the default translation is recorded, not rediscovered', () => {
  it('is the validated Abdel Haleem edition, resource 85', () => {
    expect(DEFAULT_TRANSLATION_CHOICE).toEqual({
      id: '85',
      language: 'english',
      name: 'M.A.S. Abdel Haleem',
      translator: 'Abdul Haleem',
    });
  });

  it('is present on a fresh install, so nothing is probed before the reader can ask', () => {
    expect(defaultFaithPreferences.translation).toEqual(DEFAULT_TRANSLATION_CHOICE);
    expect(defaultFaithPreferences.translationChosenByUser).toBe(false);
  });

  it('seeds an install that has never been seeded', () => {
    expect(migratePreferences({}).translation).toEqual(DEFAULT_TRANSLATION_CHOICE);
    expect(migratePreferences({ translationId: '131' }).translation).toEqual(
      DEFAULT_TRANSLATION_CHOICE,
    );
  });

  it('replaces a retired id NoorLife itself chose', () => {
    const migrated = migratePreferences({
      translation: { id: '131', language: 'english', name: 'Old', translator: 'Nobody' },
      translationChosenByUser: false,
      translationDefaultSeeded: true,
    });
    expect(migrated.translation).toEqual(DEFAULT_TRANSLATION_CHOICE);
  });

  it("keeps a user's own selection, retired or not", () => {
    const chosen = { id: '131', language: 'bosnian', name: 'Chosen', translator: 'Someone' };
    const migrated = migratePreferences({
      translation: chosen,
      translationChosenByUser: true,
      translationDefaultSeeded: true,
    });
    expect(migrated.translation).toEqual(chosen);
  });

  it('leaves a deliberately cleared choice cleared, so recovery is reachable', () => {
    /**
     * The case the seed must not swallow. `resetToDefault` writes `null` after the reader reports
     * `edition-unavailable`; re-seeding here would hand back the edition that had just failed and
     * make the recovery path unreachable forever.
     */
    const migrated = migratePreferences({
      translation: null,
      translationChosenByUser: false,
      translationDefaultSeeded: true,
    });
    expect(migrated.translation).toBeNull();
  });
});

describe('the default reciter is Sudais, and a deliberate choice survives', () => {
  it('is Quran Foundation recitation 3 on a fresh install', () => {
    expect(defaultFaithPreferences.reciterId).toBe('3');
    expect(defaultFaithPreferences.reciterChosenByUser).toBe(false);
  });

  it("migrates NoorLife's superseded default from AbdulBaset to Sudais", () => {
    /**
     * The defect the device screenshot showed: the transport named AbdulBaset AbdulSamad because a
     * stored `1` — NoorLife's own former default, taken from the vendor's specification example —
     * survived every migration untouched. Nothing corrected it, so it was permanent.
     */
    const migrated = migratePreferences({ reciterId: '1' });
    expect(migrated.reciterId).toBe('3');
    expect(migrated.reciterChosenByUser).toBe(false);
  });

  it('keeps AbdulBaset when the user chose him', () => {
    // Their choice, their recitation. NoorLife corrects its own defaults, not the user's decisions.
    const migrated = migratePreferences({ reciterId: '1', reciterChosenByUser: true });
    expect(migrated.reciterId).toBe('1');
    expect(migrated.reciterChosenByUser).toBe(true);
  });

  it('leaves any other stored reciter alone', () => {
    // Only the one superseded default is corrected. A reciter NoorLife never defaulted to was
    // necessarily chosen deliberately, whatever the flag says.
    expect(migratePreferences({ reciterId: '7' }).reciterId).toBe('7');
  });

  it('still replaces a fixture-era reciter id', () => {
    expect(migratePreferences({ reciterId: 'mock.ar.reciter' }).reciterId).toBe('3');
  });
});
