import { faithStorageKeys, isRecord, readJson, removeKey, writeChecked } from './faith-storage';

/**
 * When Sudais audio was last reconciled with the publisher, and how that was reached.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Four clocks, and why none may stand in for another ──────────────────────
 * This feature keeps four separate timestamps, and collapsing any two of them produces a specific,
 * user-visible wrong answer:
 *
 * | Clock | Where | What it means | What it must never be read as |
 * |---|---|---|---|
 * | Last successful sync transaction | `faith-sync-checkpoint.lastSyncedAt` | the **change feed** was read to completion | that the audio was checked |
 * | Last recitation reconciliation | **here** | resource 3's contents were compared with the device | that files were re-downloaded |
 * | Audio download time | `faith-audio-manifest.downloadedAt` | when these bytes arrived | when they were last known current |
 * | File validation time | `faith-audio-manifest.lastSyncedAt` | when this file last agreed with a synchronised row | when it was downloaded |
 *
 * The one that caused real harm is the third. The shipping behaviour expired Sudais audio seven days
 * after **download**, which is the wrong clock entirely: it deletes a permitted file from a user who
 * has been offline — exactly the user condition C9 protects — while telling a user who is online
 * daily nothing about whether a check ever succeeded.
 *
 * ── What this clock is for ──────────────────────────────────────────────────
 * C7 obliges a **connected** device to check at least every seven connected days. `checkDue` below is
 * a question about elapsed time, deliberately not about connectivity and emphatically not about
 * deletion: passing the window means a check is owed, never that anything may be removed. An offline
 * device accrues an owed check and keeps its audio.
 *
 * ── The `how` field, and the model it records ───────────────────────────────
 * The change feed has **not emitted a recitation mutation** on any device to date. Quran Foundation
 * has confirmed in writing why, and that this is the intended design — the resource 3 snapshot
 * establishes the baseline and historical recitations were **intentionally not backfilled as
 * mutations**. Recorded in `docs/QURAN_FOUNDATION_AUDIO_PERMISSION.md` §9.6. Reconciliation therefore
 * starts from the snapshot, future mutations are applied when they arrive, and a full snapshot
 * comparison after a clean no-mutation response is optional.
 *
 * `how` exists so the record says which of the two actually happened. A future run that receives a
 * real mutation writes `mutation`; every run so far writes `snapshot`. Nothing may write `mutation`
 * without one having been read off the wire, and nothing may report a `snapshot` reconciliation as
 * evidence that the feed has emitted a recitation mutation.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export const RECITATION_CHECK_VERSION = 1;

/**
 * How the last reconciliation was reached.
 *
 * `mutation` is the documented path and has never yet occurred. `snapshot` is assumption A1.
 * `none` is the initial state: nothing has been reconciled.
 */
export type RecitationCheckMethod = 'none' | 'mutation' | 'snapshot';

export type RecitationCheck = {
  readonly version: number;
  /** Epoch milliseconds resource 3 was last reconciled in full. `null` until one has succeeded. */
  readonly lastCheckedAt: number | null;
  readonly method: RecitationCheckMethod;
  /**
   * Whether a recitation mutation has **ever** been observed on the feed, on this device.
   *
   * **A factual diagnostic only.** Sticky once true, and false on every device to date. It is stored
   * rather than derived so that a single observation is not lost the next time a snapshot
   * reconciliation overwrites `method`.
   *
   * `false` is the **expected** value and carries no compliance meaning: Quran Foundation has
   * confirmed that historical recitations were intentionally not backfilled as mutations, so the
   * absence of one is by design and is **not** evidence that retention permission is unmet
   * (`docs/QURAN_FOUNDATION_AUDIO_PERMISSION.md` §9.6). Nothing may infer a compliance state from
   * this field, and nothing may set it true without a mutation read off the wire.
   */
  readonly mutationEverObserved: boolean;
};

/**
 * How long a connected device may go without reconciling the recitation resource.
 *
 * Seven days, the same window C7 sets for the change feed, because the obligation is the same one.
 * A **check** obligation: passing it means a reconciliation is owed. It is not a deletion rule and
 * there is no function in this module that deletes anything.
 */
export const RECITATION_CHECK_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

function isMethod(value: unknown): value is RecitationCheckMethod {
  return value === 'none' || value === 'mutation' || value === 'snapshot';
}

function isCheck(value: unknown): value is RecitationCheck {
  if (!isRecord(value)) {
    return false;
  }
  const { version, lastCheckedAt, method, mutationEverObserved } = value;
  return (
    version === RECITATION_CHECK_VERSION &&
    (lastCheckedAt === null ||
      (typeof lastCheckedAt === 'number' && Number.isFinite(lastCheckedAt))) &&
    isMethod(method) &&
    typeof mutationEverObserved === 'boolean'
  );
}

export const EMPTY_RECITATION_CHECK: RecitationCheck = {
  version: RECITATION_CHECK_VERSION,
  lastCheckedAt: null,
  method: 'none',
  mutationEverObserved: false,
};

export async function readRecitationCheck(): Promise<RecitationCheck> {
  return await readJson<RecitationCheck>(
    faithStorageKeys.quranRecitationCheck,
    EMPTY_RECITATION_CHECK,
    isCheck,
  );
}

/**
 * Records a reconciliation that completed in full.
 *
 * Checked rather than best-effort, for the reason `commitSync` gives about its own write: a check
 * the caller believes persisted when it did not would leave the device believing it is current when
 * the next launch will disagree.
 *
 * `mutationEverObserved` only ever goes false → true. A `snapshot` reconciliation after a `mutation`
 * one must not erase the fact that the feed was once seen to emit one.
 */
export async function recordRecitationCheck(
  at: number,
  method: 'mutation' | 'snapshot',
): Promise<boolean> {
  const previous = await readRecitationCheck();
  const next: RecitationCheck = {
    version: RECITATION_CHECK_VERSION,
    lastCheckedAt: at,
    method,
    mutationEverObserved: previous.mutationEverObserved || method === 'mutation',
  };
  return await writeChecked(faithStorageKeys.quranRecitationCheck, next);
}

/**
 * Whether a connected device owes a recitation reconciliation.
 *
 * True when none has ever run, and true once the window has elapsed. Independent of connectivity and
 * independent of what is downloaded — an offline device still *owes* the check, which is what makes
 * "reconcile at the next opportunity" expressible without implying anything about deletion.
 */
export function recitationCheckDue(check: RecitationCheck, now: number): boolean {
  if (check.lastCheckedAt === null) {
    return true;
  }
  const elapsed = now - check.lastCheckedAt;
  /* A clock that moved backwards is treated as due rather than as fresh; failing toward a check. */
  return elapsed < 0 || elapsed >= RECITATION_CHECK_INTERVAL_MS;
}

/**
 * How many days a device has gone without a successful reconciliation, for an honest UI string.
 *
 * `null` when none has ever run. Returned as a number the screen formats, so the wording lives with
 * the screen and this module states only the fact.
 */
export function daysSinceCheck(check: RecitationCheck, now: number): number | null {
  if (check.lastCheckedAt === null) {
    return null;
  }
  return Math.max(0, Math.floor((now - check.lastCheckedAt) / (24 * 60 * 60 * 1000)));
}

/** Discards the record entirely. Used by the Faith data reset. */
export async function clearRecitationCheck(): Promise<void> {
  await removeKey(faithStorageKeys.quranRecitationCheck);
}
