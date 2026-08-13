import { hasData, type FaithResult } from './faith-result';
import type { QuranContentRepository, SurahSummary } from './quran-content.repository';

/**
 * The 114 surahs, hydrated once at application startup and readable synchronously thereafter.
 *
 * ── The measured cause of the slow Qur'an screen ────────────────────────────
 * Persisting the catalogue removed the *network* from the cold open, and the screen was still slow.
 * The reason is that everything left was still **asynchronous**, and `useFaithResource` reports
 * `status: 'loading'` on any render where nothing has settled — which is, unavoidably, the first
 * one. So the sequence on every open of the Qur'an tab was:
 *
 *   1. mount → `settled === null` → render `ModuleLoadingState`, six grey skeleton rows;
 *   2. effect runs → `listSurahs()` → an `await` into AsyncStorage;
 *   3. storage answers → `setSettled` → second render, 114 rows.
 *
 * Step 2 is fast — single-digit milliseconds — but it is still a *frame*, and it is a frame in which
 * the screen has deliberately drawn something else. The user does not perceive "3 ms of storage
 * read"; they perceive a skeleton appearing and being replaced, which reads as slower than a plain
 * pause of the same length. Pressing Quran, seeing grey blocks, then seeing surahs is the whole of
 * the complaint.
 *
 * ── What this changes ───────────────────────────────────────────────────────
 * The read happens **once, at startup**, into a module-level snapshot. By the time the user reaches
 * the Qur'an tab the answer is already in memory, so `useSurahCatalogue` can seed its state from it
 * during the first render and the list is in the first committed frame. No skeleton, no second
 * render, nothing awaited on the path to paint.
 *
 * ── Why a module singleton and not a context ────────────────────────────────
 * A context value can only be read during render *through a hook*, and a hook cannot be consulted
 * before the provider above it has run its effect — which is exactly the ordering problem this
 * exists to remove. The snapshot has to be readable by a `useState` initialiser on a component's
 * first render, and a module-level value is the only thing that is. It is reset explicitly for
 * tests rather than being allowed to leak between them.
 *
 * ── This is not a bundled copy ──────────────────────────────────────────────
 * Nothing is shipped in the APK. The snapshot is empty on a fresh process and is populated from the
 * persisted store — itself bounded by the one-week licence ceiling — or, when that is empty, from
 * one request to the approved source. A launch with no stored catalogue and no network leaves the
 * snapshot empty and the screen renders its ordinary offline state.
 */

/** The last good answer, or `null` before one has arrived. */
let snapshot: FaithResult<readonly SurahSummary[]> | null = null;

/** The hydration in flight, so two callers in one tick produce one read. */
let pending: Promise<FaithResult<readonly SurahSummary[]>> | null = null;

/**
 * The hydrated catalogue, readable during render.
 *
 * Returns `null` when startup has not produced one yet, which the caller renders as its ordinary
 * loading state. It never returns a failure: a snapshot exists only for an answer that carried data,
 * because a cached error is not a thing worth seeding a screen with.
 */
export function surahCatalogueSnapshot(): FaithResult<readonly SurahSummary[]> | null {
  return snapshot;
}

/**
 * Hydrates the catalogue, at most once per process unless forced.
 *
 * ── The deduplication is the point of the function ──────────────────────────
 * Startup calls it, the Qur'an screen's hook calls it on mount, and the reader's surah picker calls
 * it too. Without the `pending` join those are three `listSurahs()` calls in the same second, and on
 * a first install — where the store is empty — three authenticated round trips against a rate limit
 * NoorLife shares across every user. The repository has its own in-flight join for the same reason,
 * and this one sits above it so the storage read is deduplicated as well as the request.
 */
export function warmSurahCatalogue(
  quran: QuranContentRepository,
): Promise<FaithResult<readonly SurahSummary[]>> {
  if (pending !== null) {
    return pending;
  }
  if (snapshot !== null) {
    return Promise.resolve(snapshot);
  }

  pending = quran
    .listSurahs()
    .then((result) => {
      /**
       * Only an answer carrying data is kept.
       *
       * `ok` and `stale` both carry a complete catalogue and both are worth seeding a screen with —
       * the difference between them is whether a background re-check is warranted, which is the
       * hook's business, not this one's. Everything else is a failure state that the screen must
       * render freshly rather than inherit from a launch the user has forgotten about.
       */
      if (hasData(result)) {
        snapshot = result;
      }
      return result;
    })
    .catch((): FaithResult<readonly SurahSummary[]> => {
      // A repository that throws is a bug rather than a user-facing condition, and the screen's own
      // request will surface it. Nothing is cached, so the next caller retries.
      return { kind: 'error', code: 'unknown' };
    })
    .finally(() => {
      pending = null;
    });

  return pending;
}

/** Clears the snapshot. Used by the Faith data reset and by tests, and by nothing else. */
export function resetSurahCatalogueWarmup(): void {
  snapshot = null;
  pending = null;
}
