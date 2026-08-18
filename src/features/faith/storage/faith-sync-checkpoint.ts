import { faithStorageKeys, isRecord, readJson, removeKey, writeChecked } from './faith-storage';

/**
 * Sync **health** — why the last attempt failed, and when to try again. Nothing else.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── What this module used to be, and why that was a defect ─────────────────
 * It used to hold the sync token, the synchronised sequence, the canonical filter it belonged to,
 * and a `lastSyncedAt` that stood for "synchronisation succeeded". Once content moved into
 * file-backed generations — where the token lives beside the rows it acknowledges — that made two
 * authorities for the same fact, and the two could disagree.
 *
 * A dormant second authority is worse than an active one. Nothing read it, so nothing would have
 * caught it drifting; and the drift it invites is the exact failure the generation design removes —
 * a token that outlives the content it was issued for is a claim that work was done which was not.
 *
 * **The active generation manifest is the sole authority** for the sync token, the canonical filter,
 * the synchronised sequence, the successful-publication timestamp, the translation rows and their
 * attribution, the recitation rows, and the recitation reconciliation clock. None of those appear
 * below, and a source scan asserts it.
 *
 * ── What is left, and why it may live outside a generation ─────────────────
 * Failure and backoff. A failed run publishes no generation by definition, so there is nowhere in a
 * generation to record that it failed — and the record has to survive a relaunch or every cold start
 * would retry immediately into whatever is broken. It is bounded: one closed reason, two timestamps
 * and a counter. It **cannot advance a token and cannot claim content was published**, because there
 * is no field here for either.
 *
 * ── Legacy checkpoints ─────────────────────────────────────────────────────
 * A device upgrading from the old shape has a stored token and no generation. That token is
 * discarded rather than used: it acknowledges content that was written by the old sequential path
 * and may never have been fully applied, and there is no generation to bind it to. The device
 * bootstraps and builds its first complete generation. Only the failure fields, if valid, survive.
 * See `readSyncHealth`.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * The schema version.
 *
 * Bumped from 1 to 2 by the removal of the token. A stored record at version 1 is read for its
 * failure fields and its token is ignored — see `readSyncHealth` — rather than being migrated,
 * because there is no safe migration for a token whose content generation does not exist.
 */
export const SYNC_HEALTH_VERSION = 2;

/** The version this key held while it was still a token store. Read for failure fields only. */
export const LEGACY_CHECKPOINT_VERSION = 1;

/**
 * Why the last run stopped, from a closed set.
 *
 * No free text and no message. A failure reason is read by code that decides whether to retry, and a
 * string a human wrote is a string a human will match on.
 *
 * `stale-token` survives the refactor and now means something narrower: the **vendor** refused the
 * token carried by the active generation. The remedy is unchanged and is the vendor's own guidance —
 * bootstrap again — but it is no longer implemented by mutating a token here, because there is no
 * token here. The orchestrator bootstraps when no *generation* is active, and a refused token is
 * handled by publishing a fresh generation from a bootstrap run.
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

export type SyncHealth = {
  readonly version: number;
  readonly lastFailure: SyncFailure | null;
  /** Epoch milliseconds of the last failure. `null` when nothing has failed. */
  readonly failedAt: number | null;
  /**
   * Consecutive failures, for backoff.
   *
   * Reset by `clearSyncFailure` after a successful publication. Bounded when the delay is computed
   * rather than here, so the record stays a plain count.
   */
  readonly consecutiveFailures: number;
  /**
   * Epoch milliseconds a run was last *attempted*, successful or not.
   *
   * Deliberately **not** proof of synchronisation. It exists so a reconnect storm cannot start a run
   * per event, and it says only that the app tried. Whether anything was published is a question the
   * generation pointer answers.
   */
  readonly lastAttemptedAt: number | null;
};

export const EMPTY_SYNC_HEALTH: SyncHealth = {
  version: SYNC_HEALTH_VERSION,
  lastFailure: null,
  failedAt: null,
  consecutiveFailures: 0,
  lastAttemptedAt: null,
};

/** The shortest gap between attempts, so a flapping connection cannot start a run per event. */
export const MIN_ATTEMPT_INTERVAL_MS = 30_000;

/** The first backoff step, doubled per consecutive failure. */
export const BASE_BACKOFF_MS = 60_000;

/** The ceiling. Beyond six hours a device is better served by the ordinary seven-day check. */
export const MAX_BACKOFF_MS = 6 * 60 * 60 * 1000;

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

function nullableNumber(value: unknown): boolean {
  return value === null || (typeof value === 'number' && Number.isFinite(value));
}

/**
 * Reads the health record, salvaging the failure fields from a legacy checkpoint.
 *
 * ── The legacy path, and what is deliberately thrown away ──────────────────
 * A version-1 record carries `syncToken`, `syncedUntilSequence`, `resources` and `lastSyncedAt`.
 * **None of them is read.** A token without the generation that contains the content it acknowledges
 * cannot represent completed work: the old sequential publication could have died between any two of
 * its four writes, so the rows that token stands for may be partial, mixed, or absent entirely.
 *
 * Using it would tell the vendor "everything before this point is applied" on the strength of a
 * record that cannot support the claim, and the mutations it skipped would never be offered again.
 * So the device bootstraps and builds its first complete generation instead.
 *
 * The failure fields are salvaged because they are still true and still bounded — a device that was
 * rate-limited a minute ago is still rate-limited.
 */
export async function readSyncHealth(): Promise<SyncHealth> {
  const stored = await readJson<Record<string, unknown> | null>(
    faithStorageKeys.quranSyncCheckpoint,
    null,
    (value): value is Record<string, unknown> | null => value === null || isRecord(value),
  );
  if (stored === null) {
    return EMPTY_SYNC_HEALTH;
  }
  const { version, lastFailure, failedAt, consecutiveFailures, lastAttemptedAt } = stored;
  if (version !== SYNC_HEALTH_VERSION && version !== LEGACY_CHECKPOINT_VERSION) {
    return EMPTY_SYNC_HEALTH;
  }
  if (!nullableNumber(failedAt) || (lastFailure !== null && !isFailure(lastFailure))) {
    return EMPTY_SYNC_HEALTH;
  }
  return {
    version: SYNC_HEALTH_VERSION,
    lastFailure: isFailure(lastFailure) ? lastFailure : null,
    failedAt: typeof failedAt === 'number' ? failedAt : null,
    /* Absent on a legacy record; a salvaged failure counts as one. */
    consecutiveFailures:
      typeof consecutiveFailures === 'number' && Number.isInteger(consecutiveFailures)
        ? consecutiveFailures
        : isFailure(lastFailure)
          ? 1
          : 0,
    lastAttemptedAt: typeof lastAttemptedAt === 'number' ? lastAttemptedAt : null,
  };
}

/** Records that a run was attempted. Says nothing about whether anything was published. */
export async function recordSyncAttempt(at: number): Promise<boolean> {
  const previous = await readSyncHealth();
  return await writeChecked(faithStorageKeys.quranSyncCheckpoint, {
    ...previous,
    version: SYNC_HEALTH_VERSION,
    lastAttemptedAt: at,
  } satisfies SyncHealth);
}

/** Records a run that did not complete, and advances the backoff. */
export async function recordSyncFailure(failure: SyncFailure, at: number): Promise<boolean> {
  const previous = await readSyncHealth();
  return await writeChecked(faithStorageKeys.quranSyncCheckpoint, {
    version: SYNC_HEALTH_VERSION,
    lastFailure: failure,
    failedAt: at,
    consecutiveFailures: previous.consecutiveFailures + 1,
    lastAttemptedAt: at,
  } satisfies SyncHealth);
}

/**
 * Clears the failure state after a successful publication.
 *
 * Note what this does *not* do: it records no success. Success is the existence of a new generation,
 * and there is no field here that could stand in for one.
 */
export async function clearSyncFailure(at: number): Promise<boolean> {
  return await writeChecked(faithStorageKeys.quranSyncCheckpoint, {
    version: SYNC_HEALTH_VERSION,
    lastFailure: null,
    failedAt: null,
    consecutiveFailures: 0,
    lastAttemptedAt: at,
  } satisfies SyncHealth);
}

/**
 * How long a failing device must wait before trying again.
 *
 * Exponential from `BASE_BACKOFF_MS`, capped. `0` when nothing has failed. This is what stops a
 * reconnect loop: a device that flaps between networks fires a connectivity trigger each time, and
 * without a backoff each one would start a run against a server that is still refusing.
 */
export function backoffDelayMs(health: SyncHealth): number {
  if (health.consecutiveFailures <= 0 || health.failedAt === null) {
    return 0;
  }
  const exponent = Math.min(health.consecutiveFailures - 1, 20);
  return Math.min(BASE_BACKOFF_MS * 2 ** exponent, MAX_BACKOFF_MS);
}

/**
 * Whether an attempt is permitted now, given backoff and the minimum gap.
 *
 * Two separate guards, and both are needed. Backoff answers "this keeps failing, wait longer"; the
 * minimum interval answers "several triggers just fired at once", which happens on every foreground
 * that coincides with a reconnect. The orchestrator's single-flight guard covers the *simultaneous*
 * case; this covers the closely-spaced one.
 */
export function mayAttempt(health: SyncHealth, now: number): boolean {
  if (health.lastAttemptedAt !== null) {
    const sinceAttempt = now - health.lastAttemptedAt;
    if (sinceAttempt >= 0 && sinceAttempt < MIN_ATTEMPT_INTERVAL_MS) {
      return false;
    }
  }
  if (health.failedAt === null) {
    return true;
  }
  const sinceFailure = now - health.failedAt;
  /* A clock that moved backwards is treated as due rather than as blocked. */
  return sinceFailure < 0 || sinceFailure >= backoffDelayMs(health);
}

/** Discards the health record entirely. Used by the Faith data reset and by sign-out. */
export async function clearSyncHealth(): Promise<void> {
  await removeKey(faithStorageKeys.quranSyncCheckpoint);
}
