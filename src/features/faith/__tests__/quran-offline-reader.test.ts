import AsyncStorage from '@react-native-async-storage/async-storage';

import type {
  AyahText,
  AyahTranslation,
  QuranContentRepository,
  SurahNumber,
} from '@features/faith/data/quran-content.repository';
import { surahNumber } from '@features/faith/data/quran-content.repository';
import type { FaithPage, FaithPageRequest, FaithResult } from '@features/faith/data/faith-result';
import { createOfflineQuranRepository } from '@features/faith/data/offline/offline-quran.repository';
import {
  createRetainedQuranSource,
  RETAINED_PUBLISHER,
} from '@features/faith/data/offline/retained-quran.source';
import * as generationStorage from '@features/faith/storage/faith-sync-generation';
import {
  clearAllGenerations,
  type GenerationDraft,
  publishGeneration,
} from '@features/faith/storage/faith-sync-generation';
import { writeCachedCatalogue } from '@features/faith/storage/faith-quran-catalogue';
import { ARABIC_SCRIPT, type ArabicRow } from '@features/faith/storage/faith-arabic-rows';
import { mockFileSystem } from '@/../jest.setup';

/**
 * Reading the Qur'an with no network at all.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── What "cold offline" has to mean to be worth claiming ───────────────────
 * Not "the last surah you opened is still in memory". The process has died, the in-memory cache
 * died with it, and there is no connection — and the reader still opens a surah it has never opened
 * before in this process, renders every verse, and names its source. That is the whole of what the
 * 2026-08-18 permission's "in-app offline reading" buys the user, and it is only true if the reader
 * asks the retained generation *before* the network rather than after it fails.
 *
 * So the inner repository in these cases is a spy that fails every call. A case that passes with it
 * is a case that never touched the network; a case that would have fallen through to it fails
 * loudly, which is exactly the signal wanted.
 *
 * ── The one thing this layer must never do ─────────────────────────────────
 * Substitute. Not one translator's reading of the meaning for another's, not a page half from disk
 * and half from the wire, not scripture with a verse quietly missing. Every case below that looks
 * like a "fall through to the network" case is really a case about refusing to substitute.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * The backup boundary answers `excluded` throughout.
 *
 * Under Jest `Platform.OS` is `ios` and no native module is built, so the real boundary answers
 * `unavailable` and — correctly — refuses to retain Arabic at all. That fail-closed behaviour is
 * asserted in `quran-arabic-backup-exclusion.test.ts` and `quran-arabic-generation.test.ts`; leaving it in
 * force here would mean no case in this file could publish the Arabic it then reads back.
 */
jest.mock('@features/faith/storage/faith-backup-exclusion', () => ({
  ensureExcludedFromBackup: () => 'excluded',
  isBackupSafe: (outcome: string) => outcome === 'excluded' || outcome === 'not-required',
}));

const NOW = 1_700_000_000_000;
const TRANSLATION_ID = '85';

/** Verses for the surahs under test. Ayah counts are the fixture's own, not a scholarly table. */
const SHAPE: ReadonlyMap<number, number> = new Map([
  [1, 7],
  [2, 45],
  [3, 3],
]);

function arabicRows(): ArabicRow[] {
  const rows: ArabicRow[] = [];
  for (const [surah, count] of SHAPE) {
    for (let ayah = 1; ayah <= count; ayah += 1) {
      rows.push({
        verseKey: `${surah}:${ayah}`,
        surah,
        ayah,
        text: `arabic-${surah}-${ayah}`,
        script: ARABIC_SCRIPT,
      });
    }
  }
  return rows;
}

function draft(over: Partial<GenerationDraft> = {}): GenerationDraft {
  return {
    generationId: 'gen-a',
    createdAt: NOW,
    feed: { resources: 'recitations:3;translations:85', syncToken: 'tok', syncedUntilSequence: 1 },
    translations: {
      resourceId: 85,
      attribution: { resourceId: 85, name: 'The Clear Quran', translator: 'Dr. Mustafa Khattab' },
      rows: [...SHAPE].flatMap(([surah, count]) =>
        Array.from({ length: count }, (_, index) => ({
          verseKey: `${surah}:${index + 1}`,
          surah,
          ayah: index + 1,
          text: `meaning-${surah}-${index + 1}`,
          resourceId: 85,
          sequence: 1,
          refreshedAt: NOW,
        })),
      ),
    },
    recitations: { resourceId: 3, rows: [] },
    recitation: { lastCheckedAt: NOW, method: 'snapshot', mutationEverObserved: false },
    arabic: { script: ARABIC_SCRIPT, rows: arabicRows(), lastCheckedAt: NOW },
    ...over,
  };
}

/**
 * A repository with no network, which is what an aeroplane is.
 *
 * Every method answers `offline` and records that it was asked. A retained-content case that reaches
 * this has already failed, whatever it goes on to assert.
 */
function offlineInner(): QuranContentRepository & { readonly calls: string[] } {
  const calls: string[] = [];
  const answer = async <T>(name: string): Promise<FaithResult<T>> => {
    calls.push(name);
    return await Promise.resolve({ kind: 'offline' as const });
  };
  return {
    calls,
    source: { name: 'Quran Foundation Content API', verified: true },
    listSurahs: async () => await answer('listSurahs'),
    getSurah: async () => await answer('getSurah'),
    listAyahs: async () => await answer('listAyahs'),
    listTranslations: async () => await answer('listTranslations'),
    getAyahOfTheDay: async () => await answer('getAyahOfTheDay'),
    searchTranslations: async () => await answer('searchTranslations'),
    availableTranslations: async () => await answer('availableTranslations'),
    availableReciters: async () => await answer('availableReciters'),
    listRecitations: async () => await answer('listRecitations'),
  } as unknown as QuranContentRepository & { readonly calls: string[] };
}

function repositoryOver(inner: QuranContentRepository): QuranContentRepository {
  return createOfflineQuranRepository(inner, createRetainedQuranSource());
}

async function ayahsOf(
  repository: QuranContentRepository,
  surah: SurahNumber,
  page?: FaithPageRequest,
): Promise<FaithResult<FaithPage<AyahText>>> {
  return await repository.listAyahs(surah, page);
}

beforeEach(async () => {
  mockFileSystem.reset();
  await AsyncStorage.clear();
  await clearAllGenerations();
});

describe('scripture with no network', () => {
  it('serves a surah from the retained generation without asking the network', async () => {
    await publishGeneration(draft());
    const inner = offlineInner();
    const result = await ayahsOf(repositoryOver(inner), surahNumber(1));

    expect(result.kind).toBe('ok');
    expect(result.kind === 'ok' && result.data.items).toHaveLength(7);
    expect(inner.calls).toEqual([]);
  });

  it('returns the publisher’s text byte for byte', async () => {
    await publishGeneration(draft());
    const result = await ayahsOf(repositoryOver(offlineInner()), surahNumber(2));

    const first = result.kind === 'ok' ? result.data.items[0] : null;
    expect(first?.arabic).toBe('arabic-2-1');
    expect(first?.ayah).toBe(1);
    expect(first?.surah).toBe(2);
  });

  it('names Quran Foundation as the source, verified', async () => {
    await publishGeneration(draft());
    const result = await ayahsOf(repositoryOver(offlineInner()), surahNumber(1));

    const source = result.kind === 'ok' ? result.data.items[0]?.source : null;
    expect(source?.name).toBe(RETAINED_PUBLISHER);
    expect(source?.verified).toBe(true);
    /*
      Verified because it came from the approved source through the approved transport and was
      validated in full before publication. Retaining it did not make it less checked, and marking
      it unverified would put a warning on screen that says nothing true.
    */
    expect(source?.edition).toContain(ARABIC_SCRIPT);
  });

  it('returns verses in ayah order regardless of the order the dataset was written in', async () => {
    const shuffled = [...arabicRows()].reverse();
    await publishGeneration(
      draft({ arabic: { script: ARABIC_SCRIPT, rows: shuffled, lastCheckedAt: NOW } }),
    );

    const result = await ayahsOf(repositoryOver(offlineInner()), surahNumber(1));
    const ayat = result.kind === 'ok' ? result.data.items.map((item) => item.ayah) : [];
    expect(ayat).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});

describe('paging retained scripture', () => {
  it('pages a long surah and issues a cursor the next call accepts', async () => {
    await publishGeneration(draft());
    const repository = repositoryOver(offlineInner());

    const first = await ayahsOf(repository, surahNumber(2));
    expect(first.kind === 'ok' && first.data.items).toHaveLength(20);
    expect(first.kind === 'ok' && first.data.total).toBe(45);
    const cursor = first.kind === 'ok' ? first.data.nextCursor : null;
    expect(cursor).not.toBeNull();

    const second = await ayahsOf(repository, surahNumber(2), { cursor: cursor as string });
    expect(second.kind === 'ok' && second.data.items[0]?.ayah).toBe(21);
  });

  it('ends the surah rather than offering a cursor past it', async () => {
    await publishGeneration(draft());
    const repository = repositoryOver(offlineInner());

    const only = await ayahsOf(repository, surahNumber(3));
    expect(only.kind === 'ok' && only.data.items).toHaveLength(3);
    expect(only.kind === 'ok' && only.data.nextCursor).toBeNull();
  });

  it('answers empty when paged past the end, as the network repository does', async () => {
    await publishGeneration(draft());
    const result = await ayahsOf(repositoryOver(offlineInner()), surahNumber(3), { cursor: '4' });
    expect(result.kind).toBe('empty');
  });

  it('honours a caller’s larger page size, which is how a deep link reads forward', async () => {
    await publishGeneration(draft());
    const result = await ayahsOf(repositoryOver(offlineInner()), surahNumber(2), { limit: 50 });
    expect(result.kind === 'ok' && result.data.items).toHaveLength(45);
  });
});

describe('the retained translation', () => {
  it('is served with its translator, without asking the network', async () => {
    await publishGeneration(draft());
    const inner = offlineInner();
    const result = await repositoryOver(inner).listTranslations(surahNumber(1), TRANSLATION_ID);

    expect(result.kind).toBe('ok');
    const first: AyahTranslation | undefined =
      result.kind === 'ok' ? result.data.items[0] : undefined;
    expect(first?.text).toBe('meaning-1-1');
    expect(first?.source.attribution).toBe('Dr. Mustafa Khattab');
    expect(inner.calls).toEqual([]);
  });

  it('refuses to substitute another edition and goes to the network instead', async () => {
    await publishGeneration(draft());
    const inner = offlineInner();
    /*
      The single worst thing this layer could do is answer a request for translation 20 with
      translation 85's text — one translator's reading of the meaning presented as another's.
    */
    const result = await repositoryOver(inner).listTranslations(surahNumber(1), '20');

    expect(result.kind).toBe('offline');
    expect(inner.calls).toEqual(['listTranslations']);
  });

  it('goes to the network when the retained rows carry no translator credit', async () => {
    await publishGeneration(
      draft({ translations: { resourceId: 85, attribution: null, rows: [] } }),
    );
    const inner = offlineInner();
    const result = await repositoryOver(inner).listTranslations(surahNumber(1), TRANSLATION_ID);

    /* The licence requires the credit wherever the translation appears, so an uncredited page is
       not one this reader may draw. The Arabic is unaffected. */
    expect(result.kind).toBe('offline');
    expect(inner.calls).toEqual(['listTranslations']);
    expect((await ayahsOf(repositoryOver(inner), surahNumber(1))).kind).toBe('ok');
  });
});

describe('falling through, which is never a substitution', () => {
  it('asks the network when nothing is published at all', async () => {
    const inner = offlineInner();
    const result = await ayahsOf(repositoryOver(inner), surahNumber(1));

    expect(result.kind).toBe('offline');
    expect(inner.calls).toEqual(['listAyahs']);
  });

  it('asks the network when the generation holds no Arabic', async () => {
    await publishGeneration(draft({ arabic: undefined }));
    const inner = offlineInner();
    const result = await ayahsOf(repositoryOver(inner), surahNumber(1));

    /* A v1 generation, or a device that could not confirm backup exclusion. Absence, not corruption. */
    expect(result.kind).toBe('offline');
    expect(inner.calls).toEqual(['listAyahs']);
  });

  it('asks the network for a surah the retained dataset does not cover', async () => {
    await publishGeneration(draft());
    const inner = offlineInner();
    const result = await ayahsOf(repositoryOver(inner), surahNumber(9));

    expect(result.kind).toBe('offline');
    expect(inner.calls).toEqual(['listAyahs']);
  });

  it('leaves every other method to the inner repository untouched', async () => {
    await publishGeneration(draft());
    const inner = offlineInner();
    const repository = repositoryOver(inner);

    await repository.listSurahs();
    await repository.availableReciters();
    await repository.searchTranslations('x', TRANSLATION_ID);
    expect(inner.calls).toEqual(['listSurahs', 'availableReciters', 'searchTranslations']);
  });
});

describe('chapter metadata keeps its own, shorter window', () => {
  it('answers the surah summary from the metadata cache', async () => {
    await writeCachedCatalogue(
      Array.from({ length: 114 }, (_, index) => ({
        number: index + 1,
        name: `Surah ${index + 1}`,
        arabicName: 'name',
        meaning: 'meaning',
        ayahCount: SHAPE.get(index + 1) ?? 5,
        revelation: 'meccan' as const,
      })),
    );
    await publishGeneration(draft());

    const inner = offlineInner();
    const result = await repositoryOver(inner).getSurah(surahNumber(1));
    expect(result.kind === 'ok' && result.data.ayahCount).toBe(7);
    expect(inner.calls).toEqual([]);
  });

  it('asks the network once the metadata cache is empty, even with the scripture still retained', async () => {
    await publishGeneration(draft());
    const inner = offlineInner();

    /*
      The honest asymmetry. This app may hold the scripture indefinitely under the 2026-08-18
      permission and the chapter list only for the metadata window — that permission expressly does
      not broaden metadata rights, so nothing extends it here.
    */
    expect((await repositoryOver(inner).getSurah(surahNumber(1))).kind).toBe('offline');
    expect((await ayahsOf(repositoryOver(inner), surahNumber(1))).kind).toBe('ok');
  });
});

describe('the generation is re-read only when it changes', () => {
  it('serves many pages from one read of the published generation', async () => {
    await publishGeneration(draft());
    const repository = repositoryOver(offlineInner());

    await ayahsOf(repository, surahNumber(1));

    /* Installed after the first page, so what it counts is re-reads and not the initial read. */
    const opened = jest.spyOn(generationStorage, 'readActiveGenerationSync');
    for (let index = 0; index < 10; index += 1) {
      await ayahsOf(repository, surahNumber(2), { cursor: '1' });
    }

    /*
      Opening a generation re-checksums every dataset file and re-validates 6,236 rows. Doing that
      per page of a scrolling reader is what this cache exists to prevent, so ten further pages cost
      no further opens — only the cheap pointer read that decides whether the cache still applies.
    */
    expect(opened).not.toHaveBeenCalled();
    opened.mockRestore();
  });

  it('picks up a newly published generation without being told', async () => {
    await publishGeneration(draft());
    const repository = repositoryOver(offlineInner());
    expect((await ayahsOf(repository, surahNumber(1))).kind).toBe('ok');

    const replaced = arabicRows().map((row) =>
      row.verseKey === '1:1' ? { ...row, text: 'corrected-1-1' } : row,
    );
    await publishGeneration(
      draft({
        generationId: 'gen-b',
        arabic: { script: ARABIC_SCRIPT, rows: replaced, lastCheckedAt: NOW + 1 },
      }),
    );

    /*
      A generation is immutable, so a correction is a new directory and a new pointer. The pointer is
      therefore the only thing that has to be watched, and there is no staleness this can miss.
    */
    const after = await ayahsOf(repository, surahNumber(1));
    expect(after.kind === 'ok' && after.data.items[0]?.arabic).toBe('corrected-1-1');
  });
});
