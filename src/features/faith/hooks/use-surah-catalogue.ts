import { useCallback, useEffect, useRef, useState } from 'react';

import type { FaithResult } from '../data/faith-result';
import { hasData } from '../data/faith-result';
import { surahCatalogueSnapshot, warmSurahCatalogue } from '../data/quran-catalogue-warmup';
import type { SurahSummary } from '../data/quran-content.repository';
import { useFaithRepositories } from '../di/faith-repository-context';
import type { UseFaithResource } from './use-faith-resource';

/**
 * The 114 surahs: drawn from what is already in memory, then quietly re-checked.
 *
 * ── The three layers, and which one this hook is about ──────────────────────
 *   1. **The persisted store** removed the network from the cold open.
 *   2. **The startup snapshot** removed the *await* from it — see `quran-catalogue-warmup.ts` for
 *      why an asynchronous read that takes three milliseconds still costs a visible skeleton frame.
 *   3. **This hook** is what makes the screen use them: it seeds its state from the snapshot during
 *      the first render, so `status` is `settled` in the very first committed frame and no loading
 *      state is ever drawn for a catalogue the process already has.
 *
 * It deliberately no longer builds on `useFaithResource`. That hook's contract is "nothing has
 * settled on the first render, so report loading", which is correct for every resource that genuinely
 * has to be fetched and is exactly wrong for one that is already in memory.
 *
 * ── What it never waits for ─────────────────────────────────────────────────
 * Translation resolution, the reciter catalogue, audio preparation, stored preferences and the
 * background re-check. None of them is referenced here, and none can be: the only input is the
 * repository. A surah list that waited on which translation the user reads would be a table of
 * contents held up by a question about its footnotes.
 *
 * ── The re-check, and why it is targeted ────────────────────────────────────
 * The repository answers a stored catalogue as `ok` while it is inside the server's freshness
 * instruction and as `stale` once past it, still inside the licence week. Revalidation happens on
 * `stale` and on nothing else. Re-checking after every paint was written first and was wrong: it
 * spends a network read on every switch to the Qur'an tab, which is most of the latency saving
 * handed back, to confirm a table of contents that has not changed since the seventh century.
 *
 * A revalidation that **fails** is not surfaced. The user is looking at a complete, valid catalogue
 * inside its licence window; telling them a background check they did not request did not succeed
 * would be noise about a problem they do not have.
 */
export function useSurahCatalogue(): UseFaithResource<readonly SurahSummary[]> {
  const { quran } = useFaithRepositories();

  /**
   * Seeded from the startup snapshot **during render**, not in an effect.
   *
   * This is the whole latency fix and it only works in an initialiser: an effect runs after the
   * first commit, so seeding there would still draw one skeleton frame — the exact frame this hook
   * exists to remove.
   */
  const [result, setResult] = useState<FaithResult<readonly SurahSummary[]> | null>(() =>
    surahCatalogueSnapshot(),
  );
  const [refreshing, setRefreshing] = useState(false);
  const [attempt, setAttempt] = useState(0);

  /** Guards the background re-check, so it cannot run twice for one settled answer. */
  const revalidated = useRef(false);

  /**
   * Hydrates when the snapshot was empty, and joins the startup read when it is still in flight.
   *
   * `warmSurahCatalogue` deduplicates, so a mount that races application startup costs a promise
   * join rather than a second storage read or a second request.
   */
  useEffect(() => {
    let active = true;
    if (surahCatalogueSnapshot() !== null && attempt === 0) {
      // Already answered before this component existed. Nothing to do — the state was seeded above.
      return;
    }
    void warmSurahCatalogue(quran).then((answer) => {
      if (active) {
        setResult(answer);
      }
    });
    return () => {
      active = false;
    };
  }, [quran, attempt]);

  /**
   * The one condition that warrants a network read behind content already on screen.
   *
   * `stale` means the stored catalogue is past the server's freshness window and inside the licence
   * week — servable, and worth confirming. An `ok` result needs nothing.
   */
  const dueRevalidation = result !== null && result.kind === 'stale';

  useEffect(() => {
    if (!dueRevalidation || revalidated.current) {
      return;
    }
    revalidated.current = true;
    let active = true;
    setRefreshing(true);

    void (async () => {
      /**
       * `refresh: true` steps over both cache layers. Without it this call would be answered by the
       * very entry it is checking, and would confirm the catalogue against itself.
       */
      const answer = await quran.listSurahs({ refresh: true }).catch((): null => null);
      if (!active) {
        return;
      }
      setRefreshing(false);
      // Only a genuinely better answer replaces what is on screen.
      if (answer !== null && answer.kind === 'ok') {
        setResult(answer);
      }
    })();

    return () => {
      active = false;
    };
  }, [dueRevalidation, quran]);

  const reload = useCallback(() => {
    // A user-initiated retry starts the whole cycle again, including the re-check.
    revalidated.current = false;
    setAttempt((value) => value + 1);
  }, []);

  if (result === null) {
    return { status: 'loading', reload, refreshing: false };
  }

  return {
    status: 'settled',
    result,
    reload,
    /** True while the background re-check is outstanding behind rows that are already drawn. */
    refreshing: refreshing && hasData(result),
  };
}
