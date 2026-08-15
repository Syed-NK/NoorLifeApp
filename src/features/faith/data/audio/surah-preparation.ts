import type { AyahRecitation } from '../quran-content.repository';
import type { PreparationFailure, RecitationPreparation } from './recitation-preparation';

/**
 * Preparing a contiguous run of ayat *before* playback starts, rather than one ahead of the needle.
 *
 * ── The rule this exists to enforce ─────────────────────────────────────────
 * Never wait until an ayah finishes to fetch the next one. The architecture being replaced did
 * exactly that whenever the prefetch fell behind, and the cost was an audible pause at a verse
 * boundary — the defect this whole pass is about.
 *
 * So preparation happens up front, with a progress state the screen can show and a cancel the user
 * can press, and the playlist is built only from what is already on disk. A queue containing a
 * source that has not arrived is a queue with a gap in it, and the native player would stall at
 * exactly the moment this work exists to protect.
 *
 * ── Why this is not part of `RecitationPreparation` ─────────────────────────
 * That engine's job is one ayah, deduplicated, cancellable, inside a byte budget. This is a
 * *policy* on top of it: how many, in what order, how many at once, and what to report while it
 * happens. Keeping them apart means the budget and the eviction rules have one owner and the
 * playback readiness rule has another, and neither has to know the other's business.
 */

/**
 * How many ayat are fetched at once while preparing a run.
 *
 * Three, matching the explicit surah download. One is needlessly slow over a high-latency link where
 * most of each transfer is the round trip; ten saturates a connection the user may also be reading
 * over, and multiplies the damage of a cancellation. Three keeps the pipe busy without becoming the
 * only thing the device is doing.
 */
export const SURAH_PREPARE_CONCURRENCY = 3;

/**
 * How many contiguous ayat are prepared before playback may begin.
 *
 * ── Why a window rather than the whole surah ────────────────────────────────
 * Al-Fatihah is seven files and Al-Baqarah is 286; waiting for the second before a single verse
 * plays would be a minute of staring at a progress bar to hear one ayah. The window is the run that
 * has to be local *before the needle moves*, and the rest is appended to the live native queue well
 * ahead of playback — see `useRecitationPlayer`.
 *
 * Twenty is chosen against the measured file size rather than by feel: Sudais ayat measured on
 * device average roughly 90 KB, so a twenty-ayah window is about 1.8 MB — a few seconds on any
 * usable connection, and minutes of recitation to extend behind.
 */
export const SURAH_PREPARE_WINDOW = 20;

/** How far ahead of the playing track the queue is extended. */
export const PLAYLIST_EXTEND_AHEAD = 8;

export type SurahPreparationProgress = {
  readonly completed: number;
  readonly total: number;
};

export type SurahPreparationOutcome =
  /** Every requested ayah is on disk and validated. */
  | { readonly kind: 'ready'; readonly prepared: number }
  /**
   * At least one ayah could not be prepared.
   *
   * `prepared` is still reported: a run that got eighteen of twenty is worth playing, and the caller
   * decides whether the readiness rule is met rather than having that decided here.
   */
  | { readonly kind: 'failed'; readonly failure: PreparationFailure; readonly prepared: number }
  /** Superseded — the surah, the reciter or the session changed. Never rendered. */
  | { readonly kind: 'cancelled'; readonly prepared: number };

export type SurahPreparationRequest = {
  readonly preparation: RecitationPreparation;
  /** The recitations to prepare, already narrowed to one surah and reciter. */
  readonly recitations: readonly AyahRecitation[];
  readonly onProgress?: (progress: SurahPreparationProgress) => void;
  /**
   * Cancels the run. Individual transfers already in flight are left to the engine, which aborts
   * them when the scope changes; this stops *new* ones being started.
   */
  readonly signal?: AbortSignal;
  readonly concurrency?: number;
};

/**
 * Prepares every recitation in the list, in ayah order, with bounded concurrency.
 *
 * ── Order matters even though the work is concurrent ────────────────────────
 * The list is sorted before the workers start, so the first files to land are the first that will be
 * played. A run that prepared in arrival order would frequently have the tail on disk and the head
 * missing, which is the one shape that cannot start playing at all.
 *
 * Files already local cost nothing: `localUriFor` is consulted first, and an ayah that is already
 * prepared is counted as complete without touching the network. That is what makes pressing Play a
 * second time instant, and what keeps a re-entry after navigation from re-downloading a surah.
 */
export async function prepareSurahRun(
  request: SurahPreparationRequest,
): Promise<SurahPreparationOutcome> {
  const { preparation, recitations, onProgress, signal } = request;
  const concurrency = request.concurrency ?? SURAH_PREPARE_CONCURRENCY;

  const ordered = [...recitations].sort((left, right) => left.ayah - right.ayah);
  const total = ordered.length;
  if (total === 0) {
    return { kind: 'ready', prepared: 0 };
  }

  let completed = 0;
  let failure: PreparationFailure | null = null;
  let cancelled = false;
  let cursor = 0;

  const report = (): void => onProgress?.({ completed, total });
  report();

  const worker = async (): Promise<void> => {
    for (;;) {
      if (cancelled || failure !== null || signal?.aborted === true) {
        return;
      }
      const index = cursor;
      cursor += 1;
      const recitation = ordered[index];
      if (recitation === undefined) {
        return;
      }

      /* Already on disk and unexpired — no request, and it still counts toward readiness. */
      if (preparation.localUriFor(recitation) !== null) {
        completed += 1;
        report();
        continue;
      }

      const outcome = await preparation.prepare(recitation);
      if (outcome.kind === 'cancelled') {
        cancelled = true;
        return;
      }
      if (outcome.kind === 'failed') {
        /*
          The first failure stops the run rather than pressing on. Continuing would produce a queue
          with a hole in it — the exact shape `buildPlaylistTracks` refuses — and would spend the
          user's connection discovering that the same failure repeats.
        */
        failure = outcome.failure;
        return;
      }
      completed += 1;
      report();
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, total) }, () => worker()),
  );

  if (cancelled || signal?.aborted === true) {
    return { kind: 'cancelled', prepared: completed };
  }
  if (failure !== null) {
    return { kind: 'failed', failure, prepared: completed };
  }
  return { kind: 'ready', prepared: completed };
}

/**
 * The contiguous run to prepare before playback may start.
 *
 * Anchored at the requested ayah and running forward, because that is the direction playback moves.
 * Verses *before* the start ayah are deliberately excluded: a deep link to 2:255 should not download
 * 254 files the listener has not asked for and will not hear.
 */
export function preparationWindow(
  recitations: readonly AyahRecitation[],
  startAyah: number,
  window: number = SURAH_PREPARE_WINDOW,
): readonly AyahRecitation[] {
  return [...recitations]
    .filter((entry) => entry.ayah >= startAyah)
    .sort((left, right) => left.ayah - right.ayah)
    .slice(0, window);
}

/**
 * The next run to append to a live queue, given how far playback has got.
 *
 * Returns the ayat that follow the last queued one, bounded so the queue stays ahead of the needle
 * without downloading the rest of the surah at once. Empty when the queue is already far enough
 * ahead, which is the ordinary case and costs nothing.
 */
export function extensionWindow(
  recitations: readonly AyahRecitation[],
  lastQueuedAyah: number,
  playingAyah: number,
  aheadOf: number = PLAYLIST_EXTEND_AHEAD,
): readonly AyahRecitation[] {
  if (lastQueuedAyah - playingAyah >= aheadOf) {
    return [];
  }
  return [...recitations]
    .filter((entry) => entry.ayah > lastQueuedAyah)
    .sort((left, right) => left.ayah - right.ayah)
    .slice(0, aheadOf);
}
