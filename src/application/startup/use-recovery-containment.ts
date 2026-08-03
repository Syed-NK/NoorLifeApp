import { useEffect, useRef, useState } from 'react';

import { useAuth, useAuthActions } from '@application/providers/auth-provider';
import { useAuthCallbackActions } from '@application/providers/auth-callback-provider';
import { clearRecoveryPending, readRecoveryPending } from '@services/auth/recovery-pending';

import { resolveRecoveryContainment, type RecoveryContainment } from './recovery-containment';

/**
 * Reads the recovery-pending marker once per launch and acts on what it finds.
 *
 * ── What this hook is responsible for ───────────────────────────────────────
 * Exactly two things: telling the startup machine whether a recovery is open, and carrying out the
 * clean-up the decision calls for. The decision itself is `resolveRecoveryContainment`, which is
 * pure and tested cell by cell — everything below is the side effects.
 *
 * ── Why the read is once, and guarded ───────────────────────────────────────
 * The session resolves asynchronously, so this runs again when it does. Without a guard the
 * sign-out branch would fire repeatedly, and the resume branch would re-mint the grant after the
 * password screen had deliberately released it on unmount — which would resurrect a consumed
 * recovery. The ref records that the decision has been acted on; the answer it produced is kept in
 * state so re-renders keep reporting it.
 */

export type RecoveryContainmentState = {
  /**
   * Whether a recovery is open and the user must be held in it.
   *
   * Null while unresolved. The startup machine treats null as "not yet answered" and keeps the
   * splash up rather than assuming false — see `hasPendingRecovery`.
   */
  readonly pending: boolean | null;
  /** The decision, for callers that need the reason rather than just the verdict. */
  readonly containment: RecoveryContainment | null;
};

export function useRecoveryContainment(): RecoveryContainmentState {
  const auth = useAuth();
  const { signOut } = useAuthActions();
  const { grantRecovery, clearRecovery } = useAuthCallbackActions();

  const [state, setState] = useState<RecoveryContainmentState>({
    pending: null,
    containment: null,
  });

  /** Set once the decision has been carried out, so its effects are never applied twice. */
  const settled = useRef(false);

  const sessionUserId =
    auth.status === 'unknown' ? undefined : auth.status === 'signed-in' ? (auth.user?.id ?? null) : null;

  useEffect(() => {
    if (settled.current) {
      return;
    }
    let cancelled = false;

    void (async () => {
      /**
       * A read failure is treated as a corrupt marker, not as an absent one.
       *
       * `readRecoveryPending` already swallows storage errors into `none`/`corrupt`, so reaching
       * this catch means something unforeseen. Failing closed here costs a signed-out user one
       * extra sign-in; failing open would be the whole defect back again.
       */
      const read = await readRecoveryPending().catch(() => ({ status: 'corrupt' }) as const);
      if (cancelled) {
        return;
      }

      const decision = resolveRecoveryContainment(read, sessionUserId);
      if (decision === null) {
        // Session still resolving. Leave `settled` false so this runs again when it lands.
        return;
      }

      settled.current = true;

      switch (decision.action) {
        case 'proceed':
          break;
        case 'resume':
          /**
           * The minimum authorization, rebuilt.
           *
           * Only the in-memory grant, and only after the marker has been matched against a live
           * session for the same account. Nothing that was on the callback URL is reconstructed,
           * because nothing from it was stored and none of it is needed: the password update is
           * authorised by the session, not by the link.
           */
          grantRecovery({ userId: decision.userId });
          break;
        case 'discard':
          // No session to end. Just stop containing a user who cannot satisfy the marker.
          await clearRecoveryPending();
          clearRecovery();
          break;
        case 'sign-out':
          /**
           * Order matters: the marker goes first.
           *
           * `signOut` flips the session, which re-renders every consumer. If the marker were still
           * present at that moment a subsequent read could see marker-without-session and route
           * through `discard`, which is harmless but muddies what actually happened. Clearing first
           * makes the sequence describe itself.
           */
          await clearRecoveryPending();
          clearRecovery();
          await signOut().catch(() => {
            // Already signed out, or the network refused the revocation. The local session is gone
            // either way and the marker is cleared, so the user lands on Sign In regardless.
          });
          break;
      }

      if (!cancelled) {
        setState({ pending: decision.action === 'resume', containment: decision });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sessionUserId, grantRecovery, clearRecovery, signOut]);

  return state;
}
