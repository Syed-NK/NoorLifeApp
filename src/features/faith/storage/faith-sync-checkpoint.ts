import { faithStorageKeys, isRecord, readJson, removeKey, writeChecked } from './faith-storage';

/**
 * Where NoorLife has reached in the Quran Foundation change feed.
 *
 * ── What a sync token actually claims ───────────────────────────────────────
 * It is not a bookmark. Presenting a token to the vendor asks "what has changed **since** this
 * point", and the answer is everything after it — so a token stored before the work it covers is
 * finished is a claim that work was done which was not. The mutations it skipped are not delayed;
 * they are gone, because nothing will ever offer them again. A local copy that has silently missed
 * a correction the publisher made is precisely what the sync obligation exists to prevent.
 *
 * Every rule in this module follows from that one asymmetry:
 *
 *   • A token is written **only** by `commitSync`, and only with the sequence it was reached at.
 *   • A failure writes the failure and leaves the token exactly where it was, so the same run is
 *     repeated rather than skipped.
 *   • A token is bound to the canonical filter it was issued for. The vendor derives the token from
 *     the filter, so presenting one against a different scope is at best rejected and at worst
 *     answers for the wrong resources; a filter change therefore invalidates the token rather than
 *     reusing it.
 *
 * ── Why this is a separate key from every content store ─────────────────────
 * Content stores hold what was synchronised. This holds *how far* — the audit trail for a licence
 * condition, not a cache. It must survive a content store being rebuilt from a snapshot, and it must
 * be discardable on its own when a token goes stale, so the two lifetimes are kept apart.
 */

/** The schema version. A mismatch discards rather than migrates: a wrong token is worse than none. */
export const SYNC_CHECKPOINT_VERSION = 1;

/**
 * Why the last run stopped, from a closed set.
 *
 * No free text and no message. A failure reason is read by code that decides whether to retry, and a
 * string a human wrote is a string a human will match on. `stale-token` is separated from the rest
 * because it has its own remedy — the vendor's guidance is to bootstrap again, not to retry.
 */
export type SyncFailure =
  | 'offline'
  | 'unauthorized'
  | 'rate-limited'
  | 'unavailable'
  | 'invalid-response'
  | 'stale-token'
  | 'write-failed'
  | 'cancelled';

export type SyncCheckpoint = {
  readonly version: number;
  /** The exact filter the token belongs to, e.g. `recitations:3;translations:85`. */
  readonly resources: string;
  /**
   * The vendor's opaque checkpoint, or `null` when the next run must bootstrap.
   *
   * `null` is the correct state in three different situations — never synchronised, a token the
   * vendor rejected, and a filter change — and all three want the same next action, so they share
   * one representation rather than three flags that could disagree.
   */
  readonly syncToken: string | null;
  /** Epoch milliseconds a run last completed in full. `null` until one has. */
  readonly lastSyncedAt: number | null;
  /** The vendor's `sync_until_sequence` at that point, kept for audit rather than for logic. */
  readonly syncedUntilSequence: number | null;
  readonly lastFailure: SyncFailure | null;
  /** Epoch milliseconds of the last failure, so a caller can back off without a second key. */
  readonly failedAt: number | null;
};

/**
 * How long a connected device may go without checking.
 *
 * Seven days, from licence condition C7. This is a **check** obligation and not a deletion rule:
 * passing it means a synchronisation is due, never that content must be discarded. An offline device
 * is expressly permitted to keep permitted audio past this window and synchronise when it can, which
 * is why `syncDue` is a question about elapsed time and not about connectivity.
 */
export const SYNC_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

function isFailure(value: unknown): value is SyncFailure {
  return (
    typeof value === 'string' &&
    [
      'offline',
      'unauthorized',
      'rate-limited',
      'unavailable',
      'invalid-response',
      'stale-token',
      'write-failed',
      'cancelled',
    ].includes(value)
  );
}

function isCheckpoint(value: unknown): value is SyncCheckpoint {
  if (!isRecord(value)) {
    return false;
  }
  const {
    version,
    resources,
    syncToken,
    lastSyncedAt,
    syncedUntilSequence,
    lastFailure,
    failedAt,
  } = value;
  return (
    version === SYNC_CHECKPOINT_VERSION &&
    typeof resources === 'string' &&
    resources.length > 0 &&
    (syncToken === null || (typeof syncToken === 'string' && syncToken.length > 0)) &&
    (lastSyncedAt === null ||
      (typeof lastSyncedAt === 'number' && Number.isFinite(lastSyncedAt))) &&
    (syncedUntilSequence === null ||
      (typeof syncedUntilSequence === 'number' && Number.isInteger(syncedUntilSequence))) &&
    (lastFailure === null || isFailure(lastFailure)) &&
    (failedAt === null || (typeof failedAt === 'number' && Number.isFinite(failedAt)))
  );
}

/** A checkpoint that has never synchronised. The state a bootstrap starts from. */
export function emptyCheckpoint(resources: string): SyncCheckpoint {
  return {
    version: SYNC_CHECKPOINT_VERSION,
    resources,
    syncToken: null,
    lastSyncedAt: null,
    syncedUntilSequence: null,
    lastFailure: null,
    failedAt: null,
  };
}

/**
 * The stored checkpoint for a filter, or an empty one.
 *
 * A checkpoint stored under a **different** filter is discarded rather than returned. The token in
 * it is meaningless for this scope, and the alternative — returning it and hoping the caller checks
 * — is how a token gets presented against the wrong resources.
 */
export async function readSyncCheckpoint(resources: string): Promise<SyncCheckpoint> {
  const stored = await readJson<SyncCheckpoint | null>(
    faithStorageKeys.quranSyncCheckpoint,
    null,
    (value): value is SyncCheckpoint | null => value === null || isCheckpoint(value),
  );
  if (stored === null || stored.resources !== resources) {
    return emptyCheckpoint(resources);
  }
  return stored;
}

/**
 * Records a run that completed in full.
 *
 * ── The one place a token may be written ────────────────────────────────────
 * Callers must reach this only after every page was fetched, every required snapshot was fetched,
 * every mutation was validated and every local write committed. That ordering cannot be enforced
 * from inside a storage module, so it is stated here and enforced by the caller having nothing else
 * to call: there is no `setToken`, no partial update, and no way to advance the token and record a
 * failure in the same write.
 *
 * The write is **checked** rather than best-effort. Every other Faith store swallows a write failure
 * because a preference that did not persist is a small loss; a token that did not persist means the
 * next run repeats work, which is safe, but a token the caller *believes* persisted when it did not
 * is a divergence nobody detects. So the result is returned and the caller treats a failure as a
 * failed run.
 */
export async function commitSync(next: {
  readonly resources: string;
  readonly syncToken: string;
  readonly syncedUntilSequence: number;
  readonly at: number;
}): Promise<boolean> {
  const checkpoint: SyncCheckpoint = {
    version: SYNC_CHECKPOINT_VERSION,
    resources: next.resources,
    syncToken: next.syncToken,
    lastSyncedAt: next.at,
    syncedUntilSequence: next.syncedUntilSequence,
    /* A successful run clears the failure. Keeping it would make a healthy checkpoint look broken. */
    lastFailure: null,
    failedAt: null,
  };
  return await writeChecked(faithStorageKeys.quranSyncCheckpoint, checkpoint);
}

/**
 * Records a run that did not complete, preserving the previous token.
 *
 * The token is carried across unchanged — including when it is `null`. That is the whole point: a
 * failed run must leave the next one asking the same question, so a partially-applied page is
 * re-delivered rather than skipped.
 *
 * `stale-token` is the exception, and it clears the token, because the vendor's own guidance for a
 * rejected token is to bootstrap again. Retrying with a token the server has refused would fail
 * identically for ever.
 */
export async function recordSyncFailure(
  previous: SyncCheckpoint,
  failure: SyncFailure,
  at: number,
): Promise<boolean> {
  const checkpoint: SyncCheckpoint = {
    ...previous,
    version: SYNC_CHECKPOINT_VERSION,
    syncToken: failure === 'stale-token' ? null : previous.syncToken,
    lastFailure: failure,
    failedAt: at,
  };
  return await writeChecked(faithStorageKeys.quranSyncCheckpoint, checkpoint);
}

/**
 * Whether a connected device owes the vendor a check.
 *
 * True when nothing has ever synchronised, and true once the interval has elapsed. Deliberately not
 * a function of connectivity or of content: an offline device still *owes* the check, which is what
 * makes "synchronise at the next opportunity" expressible rather than implied.
 */
export function syncDue(checkpoint: SyncCheckpoint, now: number): boolean {
  if (checkpoint.syncToken === null || checkpoint.lastSyncedAt === null) {
    return true;
  }
  const elapsed = now - checkpoint.lastSyncedAt;
  /* A clock that moved backwards is treated as due rather than as fresh; failing toward a check. */
  return elapsed < 0 || elapsed >= SYNC_INTERVAL_MS;
}

/** Discards the checkpoint entirely. Used when the canonical filter changes. */
export async function clearSyncCheckpoint(): Promise<void> {
  await removeKey(faithStorageKeys.quranSyncCheckpoint);
}
