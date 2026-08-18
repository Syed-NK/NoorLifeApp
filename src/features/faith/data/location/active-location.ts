import { useSyncExternalStore } from 'react';

/**
 * The signal that says "the active prayer location changed".
 *
 * ── The defect this exists to make impossible ───────────────────────────────
 * Prayer Times and Faith Home both derive everything from `resolveCurrentLocation()`, so they have
 * always read the *same* stored coordinate. What they did not share was a reason to re-read it. Each
 * screen cached its resources under a key built from the calculation preferences, and a location
 * saved on a third screen changed neither key — so Prayer Times could show Dubai while Faith Home
 * still showed Mountain View's times, from one storage record, until something unrelated forced a
 * reload.
 *
 * A monotonically increasing revision, included in every location-derived resource key, closes that:
 * saving a location bumps it once, and every subscriber's key changes in the same commit. There is
 * still exactly one source of truth — storage — and now exactly one way to learn it moved.
 *
 * ── Why a module-level store rather than context ────────────────────────────
 * The bump happens inside the repository, which is not a React tree and must not need one. A context
 * would force every writer to be a component; this is readable from a hook and writable from a
 * repository, which is the shape the seam actually has.
 */

let revision = 0;
const listeners = new Set<() => void>();

/**
 * Records that the active location has changed.
 *
 * Called by the repository after a coordinate is *persisted*, never before. Bumping earlier would
 * have subscribers re-read storage that still holds the previous value — the exact half-updated
 * state the revision exists to prevent.
 */
export function markActiveLocationChanged(): void {
  revision += 1;
  for (const listener of listeners) {
    listener();
  }
}

/** The current revision. Exported for tests and for non-React readers. */
export function activeLocationRevision(): number {
  return revision;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * The current revision, as a hook.
 *
 * `useSyncExternalStore` rather than state plus an effect: it is the API that guarantees a component
 * cannot render a value older than the one the store held when React started the render, which is
 * precisely the guarantee "no mixed state" needs.
 */
export function useActiveLocationRevision(): number {
  return useSyncExternalStore(subscribe, activeLocationRevision, activeLocationRevision);
}

/** Resets the counter. Test-only — production has no reason to move a revision backwards. */
export function resetActiveLocationRevisionForTest(): void {
  revision = 0;
  listeners.clear();
}
