/**
 * Session ownership for Content Sync — who a synchronisation transaction belongs to.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── The defect this exists to close ────────────────────────────────────────
 * The coordinator removed its AppState and connectivity listeners when auth left `signed-in`, and
 * that is all it did. Removing a listener stops *new* triggers; it does nothing to a transaction
 * already in flight. The orchestrator was a module singleton, so a run started under one session
 * stayed alive across sign-out and into the next sign-in — free to fetch a further page, stage a
 * generation, flip the pointer, publish a revision and write current-session status, all on the
 * authority of a session that had ended.
 *
 * Dropping the reference (`orchestrator = null`) does not fix that. It loses the handle to the
 * promise; the promise keeps running and keeps its closure over every dependency it was given.
 *
 * ── What a session is here ─────────────────────────────────────────────────
 * A **flag that can only go one way**, minted when a session becomes authenticated and turned off
 * when it ends. Every transaction holds one and consults it at each boundary where it is about to do
 * something irreversible. That is the whole mechanism, and its smallness is the point: there is one
 * bit to reason about and one function that can change it.
 *
 * ── What it deliberately is not ────────────────────────────────────────────
 * Not an `AbortController`. Nothing here cancels an outward request mid-flight — the request will
 * complete, and its answer will be discarded. That is the honest guarantee: this feature cannot
 * unsend an HTTP request, and pretending otherwise by wiring an abort signal it could not honour
 * everywhere would be a weaker claim dressed as a stronger one. What it *can* guarantee absolutely
 * is that nothing an ended session fetched is ever published, and that is what the checkpoints do.
 *
 * ── Identity, and what never crosses this boundary ─────────────────────────
 * `ownerKey` is the authenticated user id — stable, non-secret, and used for exactly one comparison:
 * whether the signed-in user is still the one who started the run. It is never persisted, never
 * logged, and never leaves this module's consumers. **No access token, refresh token or email is
 * held here, and there is no field that could carry one.**
 *
 * The orchestrator is given `SyncSessionGuard` and not the handle: it receives the ability to ask
 * *"am I still valid?"* and nothing else — not the owner key, not the epoch, not the power to
 * invalidate. A transaction cannot leak an identity it was never given.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * What a transaction is given: one question, answerable at any moment.
 *
 * Deliberately the narrowest possible surface. See the note above on why the orchestrator gets this
 * rather than the handle.
 */
export type SyncSessionGuard = {
  /** False once the owning authenticated session has ended. Never returns to true. */
  readonly isValid: () => boolean;
};

/** A session, from the owner's side. Only the holder of the handle can end it. */
export type SyncSession = SyncSessionGuard & {
  /**
   * Which authenticated user owns this session.
   *
   * Compared, never transmitted. A different value means a different person is signed in, which is
   * the case a plain "is anybody signed in" check cannot see.
   */
  readonly ownerKey: string;
  /**
   * A monotonically increasing generation, unique for the life of the process.
   *
   * Distinct from `ownerKey` because the same person signing out and back in is a *new* session and
   * must not inherit the previous one's in-flight work. The pair answers both questions: `ownerKey`
   * says who, `epoch` says which visit.
   */
  readonly epoch: number;
  /** Ends the session. Idempotent, and irreversible by construction. */
  readonly invalidate: () => void;
};

/**
 * The process-wide epoch counter.
 *
 * Never persisted and never reset: a value that could repeat within a process would let a stale
 * comparison match a session that had already ended.
 */
let nextEpoch = 1;

export function createSyncSession(ownerKey: string): SyncSession {
  const epoch = nextEpoch;
  nextEpoch += 1;
  let valid = true;
  return {
    ownerKey,
    epoch,
    isValid: () => valid,
    invalidate: () => {
      valid = false;
    },
  };
}
