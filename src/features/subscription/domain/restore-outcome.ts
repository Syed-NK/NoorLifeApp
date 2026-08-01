import { planNames, restoreCopy } from '../subscription-copy';
import type { RestoreOutcome } from '../services/purchase-adapter';

/**
 * How a restore result is described to the user.
 *
 * ── Why this is not inside the restore screen ───────────────────────────────
 * Restore is reachable from more than one place — the dedicated screen, and Family & Membership,
 * which runs the same service inline rather than sending the user somewhere to press the same
 * button. Two descriptions of one outcome is two places for "nothing found" to drift into sounding
 * like a failure, so the mapping lives here and both render it.
 *
 * `nothing_to_restore` is deliberately informational rather than an error. A user with no prior
 * purchase has done nothing wrong, and the useful thing to tell them is that a different store
 * account might be the reason.
 */
export type RestorePresentation = {
  readonly tone: 'success' | 'info' | 'warning' | 'error';
  readonly title: string;
  readonly body: string;
};

export function describeRestoreOutcome(
  outcome: RestoreOutcome | null,
  plan: keyof typeof planNames,
): RestorePresentation | null {
  switch (outcome) {
    case null:
      return null;
    case 'restored':
      return {
        tone: 'success',
        title: restoreCopy.restored(planNames[plan]),
        body: 'Your plan is active on this device again.',
      };
    case 'nothing_to_restore':
      return {
        tone: 'info',
        title: restoreCopy.nothingFound,
        body: restoreCopy.nothingFoundBody,
      };
    case 'store_unavailable':
      return {
        tone: 'warning',
        title: restoreCopy.storeUnavailable,
        body: restoreCopy.storeUnavailableBody,
      };
    case 'offline':
      return { tone: 'warning', title: restoreCopy.offline, body: restoreCopy.offlineBody };
    case 'error':
      return { tone: 'error', title: restoreCopy.error, body: restoreCopy.errorBody };
  }
}
