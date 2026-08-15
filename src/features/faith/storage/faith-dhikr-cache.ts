import { MAX_CACHE_AGE_MS } from '../data/quran-foundation/quran-foundation.contract';
import { faithStorageKeys, isRecord, readJson, writeJson } from './faith-storage';

/**
 * The private cache for Quran-derived Dhikr content, and the two different rules it enforces.
 *
 * ── Arabic and translations are not retained under the same permission ──────
 * This is the whole reason the cache is split rather than one blob with one timestamp.
 *
 * **Arabic** may be retained **beyond one week** when Content Sync is unavailable for it, provided
 * it is unchanged, stays in private application storage, is used only inside NoorLife, and is
 * **refreshed through the Content API** so corrections, updates and removals are applied promptly.
 * So the Arabic entry carries a `refreshedAt` that drives a refresh, not an expiry: a stale copy is
 * re-fetched, and it remains playable to the user in the meantime, which is exactly the offline case
 * the permission contemplates.
 *
 * **Translations** may be retained beyond one week **only** through supported Content Sync, with a
 * next sync at least every seven days and all available changes applied. NoorLife has not
 * implemented Content Sync — the mechanism is still an open question with the vendor and no endpoint
 * may be invented for it — so translations keep the ordinary **one-week ceiling** and are dropped
 * when they pass it. That is a deliberate under-retention: holding a translation too briefly fails
 * toward re-fetching the vendor's current text, and holding one too long fails toward serving a
 * correction they have already made.
 *
 * See `docs/QURAN_FOUNDATION_DHIKR_PERMISSION.md` §3 and §4.
 *
 * ── What is emphatically not in here ────────────────────────────────────────
 * The user's state. Favorites, the selected reference, recents, counts and targets are retained
 * indefinitely under the same permission and live in `faith-dhikr-state.ts`, in a **different
 * storage key**, precisely so that content expiry can never take a count with it. A user must not
 * lose a session's counting because a translation needed refreshing.
 */

/** One entry's cached content, keyed by the catalogue id it was fetched for. */
export type CachedDhikrContent = {
  readonly entryId: string;
  /** The catalogue entry's version at fetch time. A bumped version invalidates the cache. */
  readonly version: number;
  readonly verses: readonly CachedDhikrVerse[];
  readonly translator: string;
  /** Epoch ms the Arabic was last confirmed against the Content API. Drives refresh, not deletion. */
  readonly refreshedAt: number;
  /** Epoch ms the translations were fetched. Drives the one-week drop. */
  readonly translationFetchedAt: number;
};

export type CachedDhikrVerse = {
  readonly verseKey: string;
  /** Stored exactly as received. Nothing in this file reads, parses or rewrites it. */
  readonly arabic: string;
  readonly translation: string;
};

/**
 * How old the Arabic may get before a refresh is attempted.
 *
 * A *refresh* threshold, not a deletion one — the cached copy stays usable while the refresh is
 * pending or the device is offline, which is what the permission's "safe last-known valid copy"
 * allows and what a hard expiry would break. Set to the same seven days the translation ceiling
 * uses, so both are re-checked on the same cadence and there is one number to reason about.
 */
export const ARABIC_REFRESH_INTERVAL_MS = MAX_CACHE_AGE_MS;

type StoredCache = {
  readonly version: number;
  readonly entries: readonly CachedDhikrContent[];
};

const CACHE_VERSION = 1;

function isVerse(value: unknown): value is CachedDhikrVerse {
  return (
    isRecord(value) &&
    typeof value.verseKey === 'string' &&
    typeof value.arabic === 'string' &&
    typeof value.translation === 'string'
  );
}

function isEntry(value: unknown): value is CachedDhikrContent {
  return (
    isRecord(value) &&
    typeof value.entryId === 'string' &&
    typeof value.version === 'number' &&
    typeof value.translator === 'string' &&
    typeof value.refreshedAt === 'number' &&
    typeof value.translationFetchedAt === 'number' &&
    Array.isArray(value.verses) &&
    value.verses.every(isVerse)
  );
}

function isStored(value: unknown): value is StoredCache {
  return (
    isRecord(value) &&
    value.version === CACHE_VERSION &&
    Array.isArray(value.entries) &&
    value.entries.every(isEntry)
  );
}

/** Whether the translations in an entry have passed the one-week ceiling and must not be shown. */
export function translationsExpired(entry: CachedDhikrContent, now: number = Date.now()): boolean {
  const age = now - entry.translationFetchedAt;
  // A negative age is a clock that moved backwards, treated as expired for the same reason the
  // content cache treats it that way: an age that cannot be reasoned about is not a freshness claim.
  return age >= MAX_CACHE_AGE_MS || age < 0;
}

/** Whether the Arabic is due a refresh. Due is not the same as unusable — see the note above. */
export function arabicNeedsRefresh(entry: CachedDhikrContent, now: number = Date.now()): boolean {
  const age = now - entry.refreshedAt;
  return age >= ARABIC_REFRESH_INTERVAL_MS || age < 0;
}

export async function readDhikrCache(): Promise<readonly CachedDhikrContent[]> {
  const stored = await readJson<StoredCache | null>(
    faithStorageKeys.dhikrContentCache,
    null,
    (value): value is StoredCache | null => value === null || isStored(value),
  );
  return stored?.entries ?? [];
}

/**
 * The usable form of a cached entry, with the translation dropped once it is past a week.
 *
 * ── Why the Arabic survives and the translation does not ────────────────────
 * The two are held under different permissions and this is where that difference becomes visible to
 * the rest of the app. An expired entry does not disappear: the scripture is still retained
 * legitimately, so the caller gets the verses with empty translations and can say "the meaning is
 * being refreshed" rather than "this dhikr is unavailable". The user's count is untouched either
 * way — it is not in this file.
 */
export function usableCacheEntry(
  entry: CachedDhikrContent,
  now: number = Date.now(),
): CachedDhikrContent {
  if (!translationsExpired(entry, now)) {
    return entry;
  }
  return {
    ...entry,
    verses: entry.verses.map((verse) => ({ ...verse, translation: '' })),
    /*
      The translator is cleared with the text it credited. A translator's name left standing over a
      dropped translation would credit them for nothing, and would be the one field a screen might
      still render as an attribution.
    */
    translator: '',
  };
}

/** Writes one entry, replacing any previous content for the same catalogue id. */
export async function writeDhikrCacheEntry(entry: CachedDhikrContent): Promise<void> {
  const existing = await readDhikrCache();
  const entries = [...existing.filter((item) => item.entryId !== entry.entryId), entry];
  await writeJson(faithStorageKeys.dhikrContentCache, { version: CACHE_VERSION, entries });
}

/**
 * Drops entries the catalogue no longer approves, and translations past their ceiling.
 *
 * ── This is the "corrections and removals are applied promptly" path ────────
 * A reference withdrawn upstream, or de-approved by a later review, must not keep being served from
 * a private cache written when it was still current. The catalogue is the authority on what may be
 * shown; this makes the cache agree with it rather than outlive it.
 */
export async function pruneDhikrCache(
  approvedIds: ReadonlySet<string>,
  now: number = Date.now(),
): Promise<readonly CachedDhikrContent[]> {
  const existing = await readDhikrCache();
  const entries = existing
    .filter((entry) => approvedIds.has(entry.entryId))
    .map((entry) =>
      translationsExpired(entry, now)
        ? /*
            Rewritten rather than deleted: the Arabic is still retained under permission, and
            discarding it because its translation aged would throw away content NoorLife is entitled
            to hold and would force a re-fetch of scripture that has not changed.
          */
          {
            ...entry,
            verses: entry.verses.map((verse) => ({ ...verse, translation: '' })),
            translator: '',
          }
        : entry,
    );
  await writeJson(faithStorageKeys.dhikrContentCache, { version: CACHE_VERSION, entries });
  return entries;
}
