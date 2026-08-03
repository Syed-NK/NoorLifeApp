import type { RecoveryPendingRead } from '@services/auth/recovery-pending';

/**
 * What to do about a recovery-pending marker, decided as a pure function.
 *
 * ── Why the decision is separated from the doing ────────────────────────────
 * The matrix is small but every cell is a security decision, and two of them differ only in whether
 * a session exists. Expressed as a hook it would be reachable only by rendering, with storage and a
 * live session mocked, which is a lot of apparatus between a test and the claim it is making. As a
 * pure function each cell is one assertion, and `use-recovery-containment.ts` is left with nothing
 * to get wrong except carrying the decision out.
 *
 * ── The rule every cell obeys ───────────────────────────────────────────────
 * A session created through password recovery is never an ordinary completed sign-in until the
 * password update succeeds. So no input combination here returns `proceed` while a marker is
 * present and usable. The only ways past a marker are completing the recovery or destroying the
 * session — never merely restarting the app, and never a value the app failed to understand.
 */

export type RecoveryContainment =
  /** No recovery in progress. Startup behaves exactly as it did before this phase. */
  | { readonly action: 'proceed' }
  /**
   * A valid marker and a matching session: hold the user in the recovery journey.
   *
   * `userId` is handed back so the caller can reconstruct the in-memory grant the password screen
   * needs — the minimum authorization, rebuilt from the session that already exists rather than
   * from anything the marker itself confers.
   */
  | { readonly action: 'resume'; readonly userId: string }
  /**
   * Drop the marker and send the user to Sign In. No sign-out, because there is no session.
   *
   * This is the marker-without-session cell: the recovery session is already gone, so the marker
   * describes nothing and would otherwise contain a user who has no way to satisfy it.
   */
  | { readonly action: 'discard'; readonly reason: 'no-session' }
  /**
   * Destroy the session, drop the marker, send the user to Sign In.
   *
   * `mismatch` — the live session is a different account than the one that started the recovery.
   * Refusing is not enough: the wrong-account session is itself the hazard, because it arrived
   * while a recovery was open. `expired` — the window has closed and the user needs a fresh link.
   * `corrupt` — the marker could not be understood, so the only safe reading is the closed one.
   */
  | {
      readonly action: 'sign-out';
      readonly reason: 'mismatch' | 'expired' | 'corrupt';
    };

/**
 * @param read what storage returned
 * @param sessionUserId the live session's user id, or null when signed out. `undefined` means the
 *   session has not resolved yet, which is not the same as signed out and must not be decided on.
 */
export function resolveRecoveryContainment(
  read: RecoveryPendingRead,
  sessionUserId: string | null | undefined,
): RecoveryContainment | null {
  /**
   * Corrupt is answered before the session is even consulted.
   *
   * Fail closed: a value that could not be parsed, or that carries a version this build does not
   * recognise, might be describing a recovery in progress. Waiting for the session to resolve
   * before discarding it would be treating an unreadable marker as informative.
   */
  if (read.status === 'corrupt') {
    return { action: 'sign-out', reason: 'corrupt' };
  }
  if (read.status === 'expired') {
    return { action: 'sign-out', reason: 'expired' };
  }
  if (read.status === 'none') {
    return { action: 'proceed' };
  }

  if (sessionUserId === undefined) {
    // Session still resolving. Null would be an answer; undefined is the absence of one, and
    // deciding here would race the provider and discard a marker that is about to match.
    return null;
  }
  if (sessionUserId === null) {
    return { action: 'discard', reason: 'no-session' };
  }
  if (sessionUserId !== read.marker.userId) {
    return { action: 'sign-out', reason: 'mismatch' };
  }
  return { action: 'resume', userId: read.marker.userId };
}

/** Whether a decision means the user must be held in the recovery journey. */
export function containsUser(containment: RecoveryContainment | null): boolean {
  return containment?.action === 'resume';
}
