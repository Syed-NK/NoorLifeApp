import { useCallback, useEffect, useMemo, useState } from 'react';

import type { CuratedDhikrReference } from '../data/dhikr/quran-dhikr-catalogue';
import { reviewedQuranDuas } from '../data/dhikr/reviewed-dua-manifest';
import {
  resolveDhikrReference,
  type DhikrResolutionFailure,
  type ResolvedDhikr,
} from '../data/dhikr/quran-dhikr.repository';
import { useFaithRepositories } from '../di/faith-repository-context';
import {
  arabicNeedsRefresh,
  pruneDhikrCache,
  usableCacheEntry,
  writeDhikrCacheEntry,
  type CachedDhikrContent,
} from '../storage/faith-dhikr-cache';
import {
  forgetUnapprovedDhikr,
  readDhikrUserState,
  recordDhikrSelection,
  toggleDhikrFavourite,
  type DhikrUserState,
} from '../storage/faith-dhikr-state';
import { useTranslationPreference } from './use-translation-preference';

/**
 * The Quran-derived Dhikr section's state, assembled from the catalogue, the cache and the source.
 *
 * ── The order of authority, which is what this hook encodes ─────────────────
 * 1. **The manifest decides what may exist.** `reviewedQuranDuas` parses it and applies the
 *    scholarly-review gate. Nothing below can widen that set — the cache is pruned to it, and the user's own
 *    favourites and recents are pruned to it too, so a withdrawn reference disappears everywhere
 *    rather than lingering wherever it was mentioned.
 * 2. **The source decides what is shown.** An approved entry whose text does not resolve, or whose
 *    translation has no translator, is not displayed. Approval is permission to *try*.
 * 3. **The cache is a fallback, never an authority.** It serves the last known valid copy while a
 *    refresh is pending or the device is offline, and it is refreshed rather than trusted.
 *
 * ── What survives all of it ─────────────────────────────────────────────────
 * The user's counter history, which this hook does not touch, and their selection, which is a
 * reference rather than a copy. Content expiring must never cost somebody a count.
 */

export type QuranDhikrSectionState =
  | { readonly kind: 'loading' }
  /**
   * The catalogue holds no approved entry.
   *
   * The honest state for this release: Quran Foundation's permission is in place, NoorLife's own
   * scholarly review is not, and no entry exists to show. Distinct from `failed`, because nothing
   * failed, and distinct from an empty list, because an empty list invites "try again".
   */
  | { readonly kind: 'awaiting-review' }
  | { readonly kind: 'ready'; readonly entries: readonly ResolvedDhikr[] }
  /** Approved entries exist and none of them resolved. Retryable. */
  | { readonly kind: 'failed'; readonly reason: DhikrResolutionFailure };

export type UseQuranDhikr = {
  readonly state: QuranDhikrSectionState;
  readonly userState: DhikrUserState;
  readonly favourite: (entryId: string) => Promise<void>;
  readonly select: (entryId: string) => Promise<void>;
  readonly retry: () => void;
};

export function useQuranDhikr(): UseQuranDhikr {
  const { quran } = useFaithRepositories();
  const { translation } = useTranslationPreference();
  const [state, setState] = useState<QuranDhikrSectionState>({ kind: 'loading' });
  const [userState, setUserState] = useState<DhikrUserState>({
    selectedEntryId: null,
    favouriteEntryIds: [],
    recentEntryIds: [],
  });
  const [attempt, setAttempt] = useState(0);

  /**
   * The approved set, recomputed from the reviewed manifest rather than cached anywhere durable.
   *
   * ── Why the manifest and not `productionDhikrEntries()` ────────────────────
   * They were two sources for one question, both empty, and two empty sources is one more than
   * anybody can keep true. The manifest is the one a real reviewed catalogue would arrive through —
   * it parses data, fails closed on a malformed row and names every rejection — and
   * `reviewedQuranDuas` puts whatever survives through `approvedForProduction` as well, so the
   * policy gate is unchanged and is now applied on the only path in.
   */
  const approved = useMemo<readonly CuratedDhikrReference[]>(() => reviewedQuranDuas(), []);
  const approvedIds = useMemo(() => new Set(approved.map((entry) => entry.id)), [approved]);

  const translationId = translation?.id ?? null;

  useEffect(() => {
    let active = true;

    void (async () => {
      /*
        Pruning runs first and runs unconditionally, including on the path where there is nothing to
        show. This is the "corrections and removals are applied promptly" obligation: an entry
        withdrawn upstream must lose its cached text and its place in the user's favourites on the
        next launch, not on the next launch that happens to render it.
      */
      const [cached, pruned] = await Promise.all([
        pruneDhikrCache(approvedIds),
        forgetUnapprovedDhikr(approvedIds),
      ]);
      if (!active) {
        return;
      }
      setUserState(pruned);

      if (approved.length === 0) {
        setState({ kind: 'awaiting-review' });
        return;
      }

      const resolved: ResolvedDhikr[] = [];
      let failure: DhikrResolutionFailure | null = null;

      for (const entry of approved) {
        const fromCache = cached.find(
          (item) => item.entryId === entry.id && item.version === entry.version,
        );
        const usable = fromCache === undefined ? null : usableCacheEntry(fromCache);

        /*
          Fetched when there is no usable copy, and also when the copy is merely *due a refresh* —
          the copy stays on screen either way. That is the shape the Arabic retention rule asks for:
          refresh promptly, but do not take the text away from somebody who is offline.
        */
        const stale =
          fromCache !== null && fromCache !== undefined && arabicNeedsRefresh(fromCache);
        if (usable !== null && !stale) {
          resolved.push(fromResolvedCache(entry, usable));
          continue;
        }

        const outcome = await resolveDhikrReference(quran, entry, translationId);
        if (!active) {
          return;
        }
        if (outcome.kind === 'resolved') {
          resolved.push(outcome.data);
          await writeDhikrCacheEntry(toCacheEntry(outcome.data));
          continue;
        }
        failure ??= outcome.reason;
        /* The refresh failed but the previous copy is still permitted — keep showing it. */
        if (usable !== null) {
          resolved.push(fromResolvedCache(entry, usable));
        }
      }

      if (!active) {
        return;
      }
      setState(
        resolved.length > 0
          ? { kind: 'ready', entries: resolved }
          : { kind: 'failed', reason: failure ?? 'unavailable' },
      );
    })();

    return () => {
      active = false;
    };
  }, [quran, approved, approvedIds, translationId, attempt]);

  useEffect(() => {
    let active = true;
    void readDhikrUserState().then((stored) => {
      if (active) {
        setUserState(stored);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const favourite = useCallback(async (entryId: string) => {
    setUserState(await toggleDhikrFavourite(entryId));
  }, []);

  const select = useCallback(async (entryId: string) => {
    setUserState(await recordDhikrSelection(entryId));
  }, []);

  return {
    state,
    userState,
    favourite,
    select,
    retry: useCallback(() => setAttempt((value) => value + 1), []),
  };
}

/*
  ── `useSelectedQuranDhikrTitle` was here, and is gone ──────────────────────
  It answered "what is the Tasbih row's current dhikr called?" by reading the stored dhikr id and
  resolving it against the reviewed catalogue. That question now has three possible answers — a
  private label, a Quran selection, or a reviewed entry — and answering only the third would have
  left the row reading "Not selected" for somebody counting a verse they had chosen themselves.

  `useActiveCounter` answers all three, resolves the scripture offline, and keeps the distinction
  between them, which is the part that carries a claim. See `hooks/use-active-counter.ts`.
*/

/**
 * A cached entry, in the shape the UI reads.
 *
 * The translation may be empty here — that is the one-week ceiling having dropped it while the
 * Arabic legitimately remains. The screen renders the scripture and says the meaning is being
 * refreshed, rather than hiding a verse NoorLife is entitled to show.
 */
function fromResolvedCache(
  entry: CuratedDhikrReference,
  cached: CachedDhikrContent,
): ResolvedDhikr {
  return {
    entry,
    verses: cached.verses.map((verse) => ({
      verseKey: verse.verseKey,
      arabic: verse.arabic,
      translation: verse.translation,
      translator: cached.translator,
    })),
    translator: cached.translator,
  };
}

function toCacheEntry(resolved: ResolvedDhikr): CachedDhikrContent {
  const now = Date.now();
  return {
    entryId: resolved.entry.id,
    version: resolved.entry.version,
    verses: resolved.verses.map((verse) => ({
      verseKey: verse.verseKey,
      arabic: verse.arabic,
      translation: verse.translation,
    })),
    translator: resolved.translator,
    /*
      Two separate stamps for two separate permissions. They are equal at write time and diverge
      afterwards: the Arabic one drives a refresh, the translation one drives a drop.
    */
    refreshedAt: now,
    translationFetchedAt: now,
  };
}
