import { useCallback, useEffect, useMemo, useState } from 'react';

import type { RetainedQuran, RetainedQuranSource } from '../data/offline/retained-quran.source';
import {
  checkSelectionRange,
  selectionIdFor,
  type QuranSelection,
  type QuranSelectionRef,
  type SelectionRangeFault,
} from '../data/quran-selection/quran-selection';
import {
  resolveSelectionFrom,
  retainedSurahIndex,
  type RetainedSurahIndex,
  type SelectionResolution,
} from '../data/quran-selection/retained-selection.resolver';
import { useFaithRepositories } from '../di/faith-repository-context';
import {
  labelQuranSelection,
  markQuranSelectionUsed,
  readQuranSelections,
  removeQuranSelection,
  saveQuranSelection,
  toggleQuranSelectionFavourite,
  type SaveSelectionOutcome,
} from '../storage/faith-quran-selections';
import { subscribeToFaithScope } from '../storage/faith-user-scope';

/**
 * The retained generation, remembered per source, across every consumer of this hook.
 *
 * ── Why a cache on top of the source's own ─────────────────────────────────
 * `sharedRetainedQuranSource` already reads the generation once per publication and serves an
 * in-memory index afterwards. What it cannot remove is the *promise hop*: every mount of every
 * consumer still awaits `read()`, resolves in an effect, and commits a second render. Three surfaces
 * mount this hook — the Tasbih control card, the Duas screen and the selector — and on the counter
 * that hop lands between the session arriving and the screen settling, on a screen whose whole job is
 * to be usable the instant it opens.
 *
 * So the resolved value is remembered and seeded into state **during render**, which is the only
 * place that removes the extra commit. Consumers after the first pay nothing.
 *
 * ── Keyed on the source object, not global ─────────────────────────────────
 * A bare module variable would make the *first* source answered for every later one — which in
 * production is harmless (there is one shared source) and in a test is a component rendering
 * another test's content. A `WeakMap` makes "which generation?" mean "which source?", which is what
 * it always meant, and lets an injected double be its own answer with no reset hook to remember.
 *
 * Safe across a change of account: retained content is publisher content under a device-wide key,
 * identical for everybody. The user's *selections* are account-scoped and are deliberately not
 * cached — see the scope subscription below.
 */
const retainedCache = new WeakMap<RetainedQuranSource, RetainedQuran | null>();
const retainedInFlight = new WeakMap<RetainedQuranSource, Promise<RetainedQuran | null>>();

/**
 * The user's Quran selections, and the retained scripture they resolve against.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Two reads, once, and then nothing ──────────────────────────────────────
 * The stored references (one AsyncStorage key) and the published generation (one pointer read, then
 * an in-memory index shared process-wide). Neither can reach the network — `retainedQuran` exposes
 * `read()` and nothing else — so mounting this hook on the Duas screen, the selector or the Tasbih
 * card starts no request, which is the offline requirement stated as a property of the dependency
 * rather than as a rule somebody has to keep.
 *
 * Resolution itself is **synchronous** afterwards: `resolve(ref)` is a pure function over the index
 * this hook is already holding, so a list of twenty selections resolves during one render rather
 * than through twenty promises that settle in an order nobody controls.
 *
 * ── Why it re-reads on a change of account ─────────────────────────────────
 * Selections are user-scoped, so the answer to "what is stored here" changes when the owner does.
 * Storage already refuses a cross-account read — the address carries the owner — but a component
 * mounted across a sign-out would keep rendering the previous account's list from React state until
 * something happened to re-run the effect. Subscribing makes the change of owner itself be that
 * something.
 *
 * The retained content is deliberately **not** re-read on a scope change: it is publisher content
 * under a device-wide key, identical for every account, and re-opening 6,236 rows because somebody
 * signed in would be work with no result.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export type UseQuranSelections = {
  /** True until the first read of both the stored list and the generation has settled. */
  readonly loading: boolean;
  readonly selections: readonly QuranSelection[];
  /** Whether this device holds Arabic at all. `false` means selections cannot be previewed. */
  readonly hasRetainedQuran: boolean;
  /**
   * The retained generation itself, or `null` when this device holds none.
   *
   * ── Why the object and not another derived flag ────────────────────────────
   * The browser's translation search scans `translations.bySurah`, which is already in memory here —
   * the source read it once for the published generation and every consumer shares the same map. Adding
   * a third read, or copying rows into a searchable shape, would be the "second copy of scripture" that
   * `searchDuaLibrary` refuses on principle. Handing over the map that already exists creates nothing.
   *
   * Read-only by type all the way down, so a consumer can scan it and cannot alter it.
   */
  readonly retained: RetainedQuran | null;
  /** Surah number → its ayah count, from the generation. Empty when nothing is retained. */
  readonly surahIndex: RetainedSurahIndex;
  /** Resolves a reference against retained content. Pure, synchronous, never a request. */
  readonly resolve: (ref: QuranSelectionRef) => SelectionResolution;
  /** Whether a range may be saved, checked against the surah's own length where it is known. */
  readonly check: (ref: QuranSelectionRef) => SelectionRangeFault | null;
  readonly save: (ref: QuranSelectionRef, label?: string | null) => Promise<SaveSelectionOutcome>;
  readonly remove: (id: string) => Promise<void>;
  readonly toggleFavourite: (id: string) => Promise<void>;
  readonly setLabel: (id: string, label: string | null) => Promise<void>;
  /** Stamps a selection as used. Called when it is sent to Tasbih or opened, never by rendering. */
  readonly markUsed: (id: string) => Promise<void>;
  /** Whether a reference is already saved. Lets a screen say "saved" rather than offering it twice. */
  readonly isSaved: (ref: QuranSelectionRef) => boolean;
};

export function useQuranSelections(): UseQuranSelections {
  const { retainedQuran } = useFaithRepositories();
  const [selections, setSelections] = useState<readonly QuranSelection[]>([]);
  /*
    Seeded during render when the generation has already been read by any consumer in this process.
    An effect would work and would cost one extra commit on every mount — the one the counter cannot
    afford.
  */
  const [retained, setRetained] = useState<RetainedQuran | null>(
    () => retainedCache.get(retainedQuran) ?? null,
  );
  const [loadedSelections, setLoadedSelections] = useState(false);
  const [loadedRetained, setLoadedRetained] = useState(() => retainedCache.has(retainedQuran));

  useEffect(() => {
    let active = true;

    const readSelections = (): void => {
      void readQuranSelections().then((stored) => {
        if (active) {
          setSelections(stored);
          setLoadedSelections(true);
        }
      });
    };

    readSelections();
    const unsubscribe = subscribeToFaithScope(readSelections);

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (retainedCache.has(retainedQuran)) {
      /* Already known and already seeded above. Nothing to read and nothing to commit. */
      return;
    }
    let active = true;
    /*
      One read in flight per source, whatever mounts. Three surfaces opening at once otherwise issue
      three pointer reads and three validations of the same generation.
    */
    const pending = retainedInFlight.get(retainedQuran) ?? retainedQuran.read();
    retainedInFlight.set(retainedQuran, pending);
    void pending.then((content) => {
      retainedCache.set(retainedQuran, content);
      retainedInFlight.delete(retainedQuran);
      if (active) {
        setRetained(content);
        setLoadedRetained(true);
      }
    });
    return () => {
      active = false;
    };
  }, [retainedQuran]);

  const surahIndex = useMemo(() => retainedSurahIndex(retained), [retained]);

  const resolve = useCallback(
    (ref: QuranSelectionRef): SelectionResolution => resolveSelectionFrom(retained, ref),
    [retained],
  );

  const check = useCallback(
    (ref: QuranSelectionRef): SelectionRangeFault | null => {
      /*
        `null` where the device holds no generation: the length of the surah is genuinely unknown, so
        the range check proves everything it still can and the resolver refuses a verse it cannot
        find. Guessing a count here would let the selector offer a verse that does not exist.
      */
      const result = checkSelectionRange(ref, surahIndex.get(ref.surah) ?? null);
      return result.ok ? null : result.fault;
    },
    [surahIndex],
  );

  const saved = useMemo(() => new Set(selections.map((selection) => selection.id)), [selections]);

  return {
    loading: !loadedSelections || !loadedRetained,
    selections,
    hasRetainedQuran: retained?.arabic != null,
    retained,
    surahIndex,
    resolve,
    check,
    isSaved: useCallback((ref: QuranSelectionRef) => saved.has(selectionIdFor(ref)), [saved]),
    save: useCallback(async (ref: QuranSelectionRef, label: string | null = null) => {
      const outcome = await saveQuranSelection(ref, label);
      /*
        Re-read rather than patched locally. The store deduplicates by reference and bounds the list,
        so what it holds after a save is not always what a local splice would have produced.
      */
      setSelections(await readQuranSelections());
      return outcome;
    }, []),
    remove: useCallback(async (id: string) => {
      setSelections(await removeQuranSelection(id));
    }, []),
    toggleFavourite: useCallback(async (id: string) => {
      setSelections(await toggleQuranSelectionFavourite(id));
    }, []),
    setLabel: useCallback(async (id: string, label: string | null) => {
      setSelections(await labelQuranSelection(id, label));
    }, []),
    markUsed: useCallback(async (id: string) => {
      setSelections(await markQuranSelectionUsed(id));
    }, []),
  };
}
