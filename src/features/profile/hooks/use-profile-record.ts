import { useCallback, useEffect, useState } from 'react';

import * as authService from '@services/auth/auth.service';
import * as profileService from '@services/profile/profile.service';

/**
 * The durable profile row behind the identity card.
 *
 * ── Why Profile reads this itself ───────────────────────────────────────────
 * `AuthProvider` already reads `public.profiles` once at launch, but it swallows a failed read
 * (`.catch(() => null)`) because a profile that will not load must never block the app from
 * starting. That is the right call there and the wrong one here: Profile Home is the screen whose
 * whole job is to display `profiles.full_name`, so it is the screen that has to know the
 * difference between "loaded", "there is no row" and "we could not reach it".
 *
 * ── The three states, and what each one is allowed to show ──────────────────
 *   loading      — the read is in flight. The card renders skeletons inside its final geometry.
 *   ready        — the row was read. `fullName` is whatever it holds, including null for a row
 *                  with no name; the caller falls back to the session's cached name.
 *   unavailable  — the read failed: offline, unconfigured backend, or a server error. The caller
 *                  keeps showing the session's cached name and offers a retry. It never invents a
 *                  name and never blanks one it already had.
 *
 * ── Why the outcome carries its own inputs ──────────────────────────────────
 * The result records which user and which attempt produced it, and the status is *derived* by
 * comparing those against the current ones. A read that has not answered for the current attempt
 * is therefore "loading" without the effect having to write that state synchronously — and a
 * retry keeps the last known name on screen while it re-reads, so nothing flickers and the card's
 * height does not move.
 */
export type ProfileRecordStatus = 'loading' | 'ready' | 'unavailable';

export type ProfileRecordState = {
  readonly status: ProfileRecordStatus;
  /** `profiles.full_name`, or null when the row has no name or has not been read. */
  readonly fullName: string | null;
  /** Re-reads the row. Safe to call while a read is already in flight. */
  readonly retry: () => void;
};

type ReadOutcome = {
  readonly userId: string;
  readonly attempt: number;
  readonly status: Exclude<ProfileRecordStatus, 'loading'>;
  readonly fullName: string | null;
};

export function useProfileRecord(userId: string | null): ProfileRecordState {
  const [outcome, setOutcome] = useState<ReadOutcome | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (userId === null) {
      // No session to read against. The screen redirects in this case, and the derived status
      // below already reports "loading" until one exists.
      return;
    }

    let cancelled = false;

    void authService
      .getProfile(userId)
      .then((row) => {
        if (!cancelled) {
          setOutcome({ userId, attempt, status: 'ready', fullName: row?.full_name ?? null });
        }
      })
      .catch(() => {
        if (!cancelled) {
          // The previously known name is deliberately carried forward — it is the session's own
          // cached copy, not a guess, and blanking it would be less honest than showing it with a
          // retry beside it.
          setOutcome((previous) => ({
            userId,
            attempt,
            status: 'unavailable',
            fullName: previous?.fullName ?? null,
          }));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [userId, attempt]);

  /**
   * A successful write anywhere re-reads the row here.
   *
   * Profile Home stays mounted underneath Personal Information, so without this it would still be
   * holding the name it read before the edit. Re-reading rather than adopting the writer's string
   * keeps the card showing what the database holds. The last known name stays on screen throughout,
   * so the refresh is invisible rather than a blank-then-refill.
   */
  useEffect(
    () => profileService.subscribeToProfileChanges(() => setAttempt((value) => value + 1)),
    [],
  );

  const retry = useCallback(() => {
    setAttempt((value) => value + 1);
  }, []);

  const current = outcome?.userId === userId && outcome?.attempt === attempt ? outcome : null;

  return {
    status: current?.status ?? 'loading',
    // The last known name, even mid-retry, so the card never blanks and then refills.
    fullName: outcome?.fullName ?? null,
    retry,
  };
}
