/**
 * **May a contained user go here yet?** — the recovery restriction, as a pure function.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Not an identity decision ───────────────────────────────────────────────
 * `protectedRouteAccess` answers *is there authority*. This answers something narrower and
 * temporary: *there is authority, but is this session still owed a password it has not set*. A user
 * in recovery is fully signed in — Supabase establishes a real session before `updateUser` can be
 * called — so the authentication boundary correctly admits them, and folding this into it would
 * conflate a permanent property of a session with a condition that clears in the next minute.
 *
 * Kept as its own function for the same reason `resolveRecoveryContainment` is one: every branch is
 * a security decision, and a function is assertable without a navigator, a provider tree or a
 * mounted screen.
 *
 * ── Why the live grant is the signal, and the marker is not ────────────────
 * The marker on disk says a recovery *was started*. The in-memory grant says one *is open right
 * now*. Only the second can release: `set-new-password-screen` clears both the marker and the grant
 * on success, on cancel, on hardware Back and on "send me a new link", and it is the grant that every
 * consumer sees change within the process. A gate reading the marker's launch-time verdict would
 * still be holding the user at the password screen after they had set their password, because that
 * verdict was resolved once at launch and never re-read.
 *
 * So the ordering below is deliberate: **an open grant contains, whatever the launch-time verdict
 * said.** That is what makes release exactly-once and automatic — nothing has to remember to tell
 * this function that the recovery finished.
 *
 * ── Why `wait` exists ─────────────────────────────────────────────────────
 * On a cold direct link the marker read has not finished when the first frame renders. Admitting
 * during that window would flash a protected screen for a session that is about to be contained —
 * and on a link into Planner, that screen would have issued its reads. Refusing would strand every
 * ordinary launch. Waiting is the only answer that is correct in both cases, and it costs one local
 * storage read, which the actor starts on mount rather than after the session resolves.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export type RecoveryRouteAccess =
  /** No recovery is open. Ordinary routing applies. */
  | 'allow'
  /** A recovery is open. Only the routes that complete or safely exit it are reachable. */
  | 'contain'
  /** The launch-time read has not answered yet, and nothing protected may render. */
  | 'wait';

export type RecoveryAccessInput = {
  /**
   * Whether a recovery grant is live in this process.
   *
   * Minted by the containment actor on a launch that resumes one, and by the callback screen on a
   * fresh exchange. Cleared by the password screen on every exit path.
   */
  readonly recoveryOpen: boolean;
  /**
   * Whether the one containment actor has produced a verdict for this launch.
   *
   * Not the verdict itself — `pending !== null`. The verdict's *content* is only needed by the
   * startup machine, which reads it from the same context; here all that matters is whether the
   * marker has been looked at yet.
   */
  readonly resolved: boolean;
};

export function recoveryRouteAccess({
  recoveryOpen,
  resolved,
}: RecoveryAccessInput): RecoveryRouteAccess {
  /*
    Checked first, and before `resolved`. A grant can exist before the launch-time read finishes —
    the callback screen mints one directly — and in that case the answer is already known. Reversing
    these two would let a fresh recovery through for one render.
  */
  if (recoveryOpen) {
    return 'contain';
  }
  if (!resolved) {
    return 'wait';
  }
  return 'allow';
}
