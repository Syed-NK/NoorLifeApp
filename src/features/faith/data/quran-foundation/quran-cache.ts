import {
  MAX_CACHE_AGE_MS,
  MAX_CACHE_ENTRIES,
  type QuranContentPayload,
} from './quran-foundation.contract';

/**
 * The response cache — bounded, expiring, and deliberately unable to become a mirror.
 *
 * ── What the Quran Foundation developer terms actually require ──────────────
 * Two things, and they pull in the same direction. Content may not be cached or stored "longer than
 * 1 week", and a developer must not "extract, scrape, or index QF Content ... outside the API
 * responses" or retain it beyond that window. A cache that satisfies the first and quietly
 * accumulates every page a user ever opened would still fail the second.
 *
 * So this store has three properties, each of which is a term rather than a preference:
 *
 *   • **Nothing outlives one week.** `MAX_CACHE_AGE_MS` is a hard drop, applied on read as well as on
 *     write, so an entry cannot survive by being written before a policy changed.
 *   • **It is bounded.** `MAX_CACHE_ENTRIES` evicts the least recently used entry, so however long
 *     the app runs the store cannot grow into a copy of the Qur'an.
 *   • **It is in memory only.** Nothing is written to AsyncStorage, SecureStore or the filesystem, so
 *     the cache does not survive the process — which is the strongest available answer to "does
 *     NoorLife keep a permanent copy?".
 *
 * ── Two ages, and why the shorter one is not the interesting one ────────────
 * `maxAgeMs` is the server's per-operation freshness instruction: a day for translations and
 * catalogues, a week for scripture. Past it an entry is **stale**, not gone — it is still servable
 * offline, through the `stale` result that tells the user what they are looking at. Past
 * `MAX_CACHE_AGE_MS` it is gone outright, with no offline exception, because that one is the licence.
 */

export type QuranCacheHit = {
  readonly payload: QuranContentPayload;
  /** When this response was stored, as an ISO string the `stale` result carries to the screen. */
  readonly cachedAt: string;
  /** False once the server's freshness window has passed but the licence window has not. */
  readonly fresh: boolean;
};

export type QuranCache = {
  read(key: string): QuranCacheHit | null;
  /** `maxAgeMs` is the server's instruction; anything above the licence ceiling is clamped to it. */
  write(key: string, payload: QuranContentPayload, maxAgeMs: number): void;
  /**
   * Forgets one entry, so the next read of it reaches the source.
   *
   * Used by a deliberate revalidation, which has to step over the cache rather than consult it. The
   * alternative — writing a placeholder with a zero age, which this store treats as "do not store" —
   * worked and read as though a payload mattered when none did.
   */
  invalidate(key: string): void;
  /** Exposed for tests and for the eviction assertion. */
  readonly size: () => number;
};

type Entry = {
  readonly payload: QuranContentPayload;
  readonly storedAt: number;
  readonly freshUntil: number;
};

/**
 * Builds a cache.
 *
 * `now` is injected so expiry is a value a test can control rather than something a test has to wait
 * for — a suite that proved a one-week ceiling by sleeping would not be a suite.
 */
export function createQuranCache(now: () => number = Date.now): QuranCache {
  /**
   * A `Map` is used for its **insertion-order** guarantee, which is what makes least-recently-used
   * eviction three lines instead of a second index: re-inserting a key on read moves it to the end,
   * so the oldest key is always the first one the iterator yields.
   */
  const entries = new Map<string, Entry>();

  const drop = (key: string): null => {
    entries.delete(key);
    return null;
  };

  return {
    read(key) {
      const entry = entries.get(key);
      if (entry === undefined) {
        return null;
      }

      const age = now() - entry.storedAt;
      if (age >= MAX_CACHE_AGE_MS || age < 0) {
        /**
         * Past the licence window, or stored in the future.
         *
         * The second case is not paranoia: the device clock can move backwards across a timezone fix
         * or an NTP correction, and an entry whose age computes as negative is an entry whose expiry
         * cannot be reasoned about. Dropping it costs one request.
         */
        return drop(key);
      }

      // Re-insert so this key becomes the most recently used.
      entries.delete(key);
      entries.set(key, entry);

      return {
        payload: entry.payload,
        cachedAt: new Date(entry.storedAt).toISOString(),
        fresh: now() < entry.freshUntil,
      };
    },

    write(key, payload, maxAgeMs) {
      if (!Number.isFinite(maxAgeMs) || maxAgeMs <= 0) {
        // The server declined to authorise caching. Storing it anyway would be the client deciding a
        // licence question the server already answered.
        entries.delete(key);
        return;
      }
      const storedAt = now();
      const bounded = Math.min(maxAgeMs, MAX_CACHE_AGE_MS);

      entries.delete(key);
      entries.set(key, { payload, storedAt, freshUntil: storedAt + bounded });

      while (entries.size > MAX_CACHE_ENTRIES) {
        const oldest = entries.keys().next();
        if (oldest.done === true) {
          break;
        }
        entries.delete(oldest.value);
      }
    },

    invalidate(key) {
      entries.delete(key);
    },

    size: () => entries.size,
  };
}
