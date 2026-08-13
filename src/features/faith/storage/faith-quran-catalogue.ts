import { MAX_CACHE_AGE_MS } from '../data/quran-foundation/quran-foundation.contract';
import { faithStorageKeys, isRecord, readJson, removeKey, writeJson } from './faith-storage';

/**
 * The surah catalogue, kept across restarts so Qur'an home opens without a network round trip.
 *
 * ── The defect this exists to close ─────────────────────────────────────────
 * `quran-cache.ts` is a `Map`, and says so: "It is in memory only ... the cache does not survive the
 * process." That is a genuine privacy property for *scripture*, and it was also the whole reason
 * opening the Qur'an was slow. Every cold start re-issued `list_chapters` — a Supabase session read,
 * an authenticated function invocation, a vendor round trip and a 114-row validation — before a
 * single row could be drawn. The list that came back was byte-identical to the one the previous
 * launch had already fetched.
 *
 * ── Why persisting *this* is a different question from persisting scripture ──
 * The 114 chapters are the Qur'an's table of contents: numbers, names, meanings, ayah counts and
 * revelation places. It is catalogue metadata, not Qur'an Content — no verse, no translation and no
 * recitation is written here, and `isChapter` below rejects any field this shape does not name, so
 * one cannot start being written by widening a type upstream.
 *
 * ── The licence is still the ceiling, and it is enforced on read ────────────
 * `MAX_CACHE_AGE_MS` is the same one-week constant the in-memory cache and the edge function are
 * pinned to. It is applied when the entry is *read*, not only when it is written, so an entry cannot
 * outlive the policy by having been stored before the policy was tightened. Past it the entry is
 * deleted rather than returned, exactly as `quran-cache.read` does.
 *
 * This is a **cache**, not a bundled copy. Nothing here ships in the APK, the store is empty on a
 * fresh install until the approved source has answered once, and a week of not opening the app
 * empties it again.
 */

/** One catalogue row, mirroring `WireChapter` — and deliberately nothing wider. */
export type CachedChapter = {
  readonly number: number;
  readonly name: string;
  readonly arabicName: string;
  readonly meaning: string;
  readonly ayahCount: number;
  readonly revelation: 'meccan' | 'medinan';
};

export type CachedCatalogue = {
  readonly storedAt: number;
  readonly chapters: readonly CachedChapter[];
};

/**
 * The number of surahs in the Qur'an.
 *
 * Checked as an equality rather than a lower bound, and that is the point of the check: a stored
 * catalogue that is not all 114 is a truncated write or a partial response, and serving it would put
 * a Qur'an with a missing surah on screen — a far worse outcome than one extra network read.
 */
export const SURAH_COUNT = 114;

/** The stored shape's version. A bump discards every prior entry rather than migrating it. */
const CATALOGUE_VERSION = 1;

type StoredCatalogue = {
  readonly version: number;
  readonly storedAt: number;
  readonly chapters: readonly CachedChapter[];
};

function isChapter(value: unknown): value is CachedChapter {
  if (!isRecord(value)) {
    return false;
  }
  const { number, name, arabicName, meaning, ayahCount, revelation } = value;
  return (
    typeof number === 'number' &&
    Number.isInteger(number) &&
    number >= 1 &&
    number <= SURAH_COUNT &&
    typeof name === 'string' &&
    name.length > 0 &&
    typeof arabicName === 'string' &&
    arabicName.length > 0 &&
    typeof meaning === 'string' &&
    meaning.length > 0 &&
    typeof ayahCount === 'number' &&
    Number.isInteger(ayahCount) &&
    ayahCount > 0 &&
    (revelation === 'meccan' || revelation === 'medinan')
  );
}

/**
 * Whether a stored blob is a complete, well-formed catalogue.
 *
 * Every condition is load-bearing, and the last one is the one a shape check would miss: 114 valid
 * rows that are all surah 3 is 114 valid rows. Requiring the numbers to be the complete set 1–114 is
 * what makes "validated" mean the catalogue is usable rather than merely parseable.
 */
export function isValidCatalogue(value: unknown): value is StoredCatalogue {
  if (!isRecord(value) || value.version !== CATALOGUE_VERSION) {
    return false;
  }
  if (typeof value.storedAt !== 'number' || !Number.isFinite(value.storedAt)) {
    return false;
  }
  const { chapters } = value;
  if (!Array.isArray(chapters) || chapters.length !== SURAH_COUNT) {
    return false;
  }
  if (!chapters.every(isChapter)) {
    return false;
  }
  const numbers = new Set(chapters.map((chapter: CachedChapter) => chapter.number));
  return numbers.size === SURAH_COUNT;
}

/**
 * Reads the catalogue, or `null` when there is none this build may serve.
 *
 * `now` is injected so the licence ceiling is a value a test can move rather than one a test has to
 * wait a week for — the same reason `createQuranCache` takes it.
 */
export async function readCachedCatalogue(
  now: () => number = Date.now,
): Promise<CachedCatalogue | null> {
  const stored = await readJson<StoredCatalogue | null>(
    faithStorageKeys.quranCatalogue,
    null,
    (value): value is StoredCatalogue | null => value === null || isValidCatalogue(value),
  );
  if (stored === null) {
    return null;
  }

  const age = now() - stored.storedAt;
  /**
   * Past the licence window, or stored in the future.
   *
   * The negative case is the device clock moving backwards across a timezone fix or an NTP
   * correction. An entry whose age cannot be reasoned about is dropped, which costs one request —
   * the identical rule, for the identical reason, as `quran-cache.read`.
   */
  if (age >= MAX_CACHE_AGE_MS || age < 0) {
    await removeKey(faithStorageKeys.quranCatalogue);
    return null;
  }

  return { storedAt: stored.storedAt, chapters: stored.chapters };
}

/**
 * Stores a catalogue, if it is one.
 *
 * The validation runs on the way *in* as well as on the way out. A short or malformed list is not
 * written at all, so the store cannot end up holding something that will only be discovered to be
 * unusable on the next launch — and the caller keeps whatever it fetched either way.
 */
export async function writeCachedCatalogue(
  chapters: readonly CachedChapter[],
  now: () => number = Date.now,
): Promise<boolean> {
  const candidate: StoredCatalogue = {
    version: CATALOGUE_VERSION,
    storedAt: now(),
    chapters,
  };
  if (!isValidCatalogue(candidate)) {
    return false;
  }
  await writeJson(faithStorageKeys.quranCatalogue, candidate);
  return true;
}

/** Drops the stored catalogue. Used by the Faith data reset and by tests. */
export async function clearCachedCatalogue(): Promise<void> {
  await removeKey(faithStorageKeys.quranCatalogue);
}
