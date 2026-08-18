import { RECOVERY_JOURNEY_VERSION } from '@services/auth/recovery-pending';

import { containsUser, resolveRecoveryContainment } from '../recovery-containment';

/**
 * The invalid-state matrix, one cell per assertion.
 *
 * ── The invariant every case here defends ───────────────────────────────────
 * A session created through password recovery is never an ordinary completed sign-in until the
 * password update succeeds. The interesting property of this table is therefore a negative one:
 * **no row returns `proceed` while a marker is present**, whatever the session looks like. The
 * final test asserts that directly rather than leaving it implied by the rows above it.
 */

const USER = 'user-abc-123';
const OTHER = 'user-zzz-999';

const marker = (userId: string = USER) =>
  ({
    status: 'valid',
    marker: { userId, createdAt: 0, expiresAt: 1e15, version: RECOVERY_JOURNEY_VERSION },
  }) as const;

describe('no recovery in progress', () => {
  it('proceeds with ordinary startup when there is no marker', () => {
    expect(resolveRecoveryContainment({ status: 'none' }, USER)).toEqual({ action: 'proceed' });
  });

  it('proceeds for a signed-out launch with no marker', () => {
    expect(resolveRecoveryContainment({ status: 'none' }, null)).toEqual({ action: 'proceed' });
  });

  it('proceeds before the session has resolved, when there is no marker', () => {
    // No marker means nothing to cross-check, so there is no reason to hold the splash.
    expect(resolveRecoveryContainment({ status: 'none' }, undefined)).toEqual({
      action: 'proceed',
    });
  });
});

describe('a recovery that can be resumed', () => {
  it('resumes when the marker matches the live session', () => {
    expect(resolveRecoveryContainment(marker(), USER)).toEqual({ action: 'resume', userId: USER });
  });

  it('reports that the user is contained', () => {
    expect(containsUser(resolveRecoveryContainment(marker(), USER))).toBe(true);
  });

  it('waits rather than deciding while the session is still resolving', () => {
    /**
     * `undefined` is the absence of an answer, not the answer "signed out". Deciding here would
     * race the auth provider and discard a marker that is about to match — which would drop the
     * user out of a recovery that was proceeding perfectly well.
     */
    expect(resolveRecoveryContainment(marker(), undefined)).toBeNull();
  });
});

describe('invalid states', () => {
  it('discards the marker when there is no session to satisfy it', () => {
    expect(resolveRecoveryContainment(marker(), null)).toEqual({
      action: 'discard',
      reason: 'no-session',
    });
  });

  it('signs out when the live session is a different account', () => {
    // The wrong-account session is itself the hazard: it arrived while a recovery was open.
    expect(resolveRecoveryContainment(marker(USER), OTHER)).toEqual({
      action: 'sign-out',
      reason: 'mismatch',
    });
  });

  it('signs out when the marker has expired', () => {
    expect(resolveRecoveryContainment({ status: 'expired' }, USER)).toEqual({
      action: 'sign-out',
      reason: 'expired',
    });
  });

  it('signs out on a corrupt marker without waiting for the session', () => {
    // Fail closed, and fail early: an unreadable marker might describe a recovery in progress, so
    // it is answered before the session is even consulted.
    expect(resolveRecoveryContainment({ status: 'corrupt' }, undefined)).toEqual({
      action: 'sign-out',
      reason: 'corrupt',
    });
  });

  it('signs out on a corrupt marker whatever the session says', () => {
    for (const session of [USER, OTHER, null, undefined]) {
      expect(resolveRecoveryContainment({ status: 'corrupt' }, session)).toEqual({
        action: 'sign-out',
        reason: 'corrupt',
      });
    }
  });
});

describe('the invariant itself', () => {
  it('never proceeds while a marker of any kind is present', () => {
    const reads = [
      marker(USER),
      marker(OTHER),
      { status: 'expired' } as const,
      { status: 'corrupt' } as const,
    ];
    const sessions = [USER, OTHER, null, undefined];

    for (const read of reads) {
      for (const session of sessions) {
        const decision = resolveRecoveryContainment(read, session);
        // Null (still resolving) is acceptable; `proceed` never is.
        expect(decision?.action).not.toBe('proceed');
      }
    }
  });

  it('only reports containment for a resumable recovery', () => {
    expect(containsUser({ action: 'proceed' })).toBe(false);
    expect(containsUser({ action: 'discard', reason: 'no-session' })).toBe(false);
    expect(containsUser({ action: 'sign-out', reason: 'expired' })).toBe(false);
    expect(containsUser(null)).toBe(false);
  });
});
