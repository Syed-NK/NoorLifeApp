import { useEffect, useMemo, useState } from 'react';

import { retainedSurahIndex } from '../data/quran-selection/retained-selection.resolver';
import { useFaithRepositories } from '../di/faith-repository-context';
import { readCachedCatalogue, type CachedChapter } from '../storage/faith-quran-catalogue';

/**
 * The surah list a screen can browse **without issuing a request**.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Why this exists beside `useSurahCatalogue` ─────────────────────────────
 * `useSurahCatalogue` is the right hook for the Qur'an screen: it serves the startup snapshot, then
 * quietly re-checks a stale catalogue against the source. The re-check is a network read, and it is
 * correct there — that screen is the table of contents and wants to be current.
 *
 * It is wrong for the selection browser, which must work cold in aeroplane mode. So this reads the
 * two things the device already holds and stops:
 *
 *   1. **The metadata cache**, for names and meanings. Bounded by the one-week licence ceiling that
 *      `readCachedCatalogue` enforces on read, so nothing here extends a right the app does not have.
 *   2. **The retained generation**, for how many verses each surah has. That is the publisher's own
 *      count, delivered with a dataset validated as complete, and it is what the range check is
 *      measured against — a hard-coded table would be scholarly reference data NoorLife has no
 *      standing to author, and one that disagreed by a verse would offer a selection the resolver
 *      then refuses.
 *
 * ── What the user sees when only one of them is present ────────────────────
 * With retained Arabic and an expired metadata cache, the list is 114 numbered rows with verse
 * counts and no names. That is worse-looking and entirely honest: this app may hold the scripture
 * indefinitely and the chapter list for a week, and inventing "Al-Baqarah" from the retained text
 * is not something the text can support. With neither, the browser says so and points at the one
 * connected action that fixes it.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** One row of the browser. Every field but the number is nullable, because either source may be absent. */
export type BrowsableSurah = {
  readonly number: number;
  readonly name: string | null;
  readonly meaning: string | null;
  readonly ayahCount: number | null;
};

export type UseCachedSurahNames = {
  readonly loading: boolean;
  readonly surahs: readonly BrowsableSurah[];
  /** Which of the two sources answered. Drives what an empty list is allowed to say. */
  readonly source: 'catalogue' | 'retained' | 'none';
};

export function useCachedSurahNames(): UseCachedSurahNames {
  const { retainedQuran } = useFaithRepositories();
  const [chapters, setChapters] = useState<readonly CachedChapter[] | null>(null);
  const [counts, setCounts] = useState<ReadonlyMap<number, number>>(new Map());
  const [loadedCatalogue, setLoadedCatalogue] = useState(false);
  const [loadedRetained, setLoadedRetained] = useState(false);

  useEffect(() => {
    let active = true;
    void readCachedCatalogue().then((catalogue) => {
      if (active) {
        setChapters(catalogue?.chapters ?? null);
        setLoadedCatalogue(true);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    void retainedQuran.read().then((content) => {
      if (active) {
        setCounts(retainedSurahIndex(content));
        setLoadedRetained(true);
      }
    });
    return () => {
      active = false;
    };
  }, [retainedQuran]);

  const surahs = useMemo<readonly BrowsableSurah[]>(() => {
    if (chapters !== null) {
      return chapters
        .slice()
        .sort((left, right) => left.number - right.number)
        .map((chapter) => ({
          number: chapter.number,
          name: chapter.name,
          meaning: chapter.meaning,
          /*
            The retained count wins where both are present. The catalogue is metadata under a
            one-week cache and the generation is the dataset the resolver actually reads; where they
            differ, the one that can produce a verse is the one to offer.
          */
          ayahCount: counts.get(chapter.number) ?? chapter.ayahCount,
        }));
    }
    return [...counts.entries()]
      .sort(([left], [right]) => left - right)
      .map(([number, ayahCount]) => ({ number, name: null, meaning: null, ayahCount }));
  }, [chapters, counts]);

  return {
    loading: !loadedCatalogue || !loadedRetained,
    surahs,
    source: chapters !== null ? 'catalogue' : counts.size > 0 ? 'retained' : 'none',
  };
}
