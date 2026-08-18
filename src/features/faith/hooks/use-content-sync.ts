import { useCallback, useSyncExternalStore } from 'react';

import { isContentSyncRunning, runContentSync } from '../di/content-sync-coordinator';
import {
  readSyncStatus,
  subscribeSyncStatus,
  type SyncStatusModel,
} from '../data/sync/content-sync.revision';

/**
 * What a Faith screen may know about synchronisation, and the one action it may take.
 *
 * ── Why a hook rather than a screen ────────────────────────────────────────
 * The Offline audio screen is Phase 4 work and does not exist yet. Adding a temporary screen to hang
 * a status on would be a screen to delete later and a navigation entry to explain in the meantime, so
 * the model and the action are exposed here and the screen consumes them when it is built. The
 * reciter settings surface already exists and can adopt `checkForUpdates` without any new route.
 *
 * ── What it deliberately cannot give a screen ──────────────────────────────
 * There is no way through this hook to reach Qur'an text, translation text, an audio URL, a sync
 * token, a page cursor or a filesystem path. `SyncStatusModel` is closed literals, booleans and
 * timestamps — see `content-sync.revision.ts` — so a status view cannot leak content even if somebody
 * later renders every field it has.
 *
 * ── `revision` is the re-read signal, not the content ──────────────────────
 * A consumer that resolved the active generation keeps reading that generation until it chooses to
 * resolve again. `revision` increments once per successful publication, so a screen can re-resolve on
 * change without holding a subscription to the rows themselves — and a reader mid-read is never
 * switched underneath.
 */

export type ContentSyncView = SyncStatusModel & {
  /**
   * Runs a check now, bypassing only the "not due" calculation.
   *
   * It cannot bypass the single-flight guard, the signed-in requirement, confirmed reachability,
   * schema validation or the transactional publication — none of those is decided here, and a manual
   * press during an automatic run simply joins the run already in flight.
   */
  readonly checkForUpdates: () => void;
};

export function useContentSync(): ContentSyncView {
  /**
   * `useSyncExternalStore` rather than state plus an effect.
   *
   * The revision channel is exactly what this API exists for: a value living outside React that
   * components need to stay current with. Subscribing in an effect and mirroring into state would
   * add a render on every mount and open the gap this hook would then have to close — a publication
   * landing between the initial read and the subscription. `useSyncExternalStore` reads the snapshot
   * at render time and subscribes without that window.
   */
  const model = useSyncExternalStore(subscribeSyncStatus, readSyncStatus, readSyncStatus);

  const checkForUpdates = useCallback(() => {
    void runContentSync({ force: true });
  }, []);

  return {
    ...model,
    /* Read through rather than stored, so a render during a run reports the run. */
    isRunning: model.isRunning || isContentSyncRunning(),
    checkForUpdates,
  };
}
