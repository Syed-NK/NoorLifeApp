import { useEffect, useMemo, useRef, type ReactNode } from 'react';

import { isLocallyAuthenticated, useAuth } from '@application/providers/auth-provider';

import { createExpoNotificationPort } from '../data/notifications/expo-notifications.port';
import { cancelEveryPendingPrayerAlert } from '../data/notifications/prayer-notifications.service';
import { sweepLegacyFaithData } from '../storage/faith-legacy-quarantine';
import { setActiveFaithScope } from '../storage/faith-user-scope';

/**
 * Supplies the Faith storage boundary with whose data it is looking at.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── The one place a user id enters Faith ───────────────────────────────────
 * Locked requirement: the authenticated id arrives through the session context, and **no repository
 * asks Supabase anything on its own**. This component is that seam. It reads `useAuth()` — which is
 * already the app's single authentication boundary — and hands the id to the storage layer. Nothing
 * else in Faith imports the auth provider, and `faith-account-isolation.test.ts` scans for it.
 *
 * ── Why the scope is set during render, not in an effect ───────────────────
 * Effects run **after** children mount, and children read storage in their own mount effects. A
 * provider that set the scope in `useEffect` would let a Qur'an screen's first read happen while
 * the scope was still the previous account's — or still `null` on a cold launch, which would render
 * empty and then repopulate. Neither is acceptable when the value being resolved is *whose data
 * this is*: the first read of a launch is exactly the one that must not go to the wrong namespace.
 *
 * `useMemo` runs during render, before any child does anything, so the boundary is correct before
 * the first read can be issued. `setActiveFaithScope` is idempotent and publishes nothing when the
 * owner is unchanged, so a re-render, a development double-render or a Fast Refresh cannot
 * invalidate a cache or trigger the sweep twice.
 *
 * ── Why offline authority counts ───────────────────────────────────────────
 * `isLocallyAuthenticated`, not `isOnlineAuthenticated`. Opening the user's own bookmarks is
 * precisely what an offline receipt is *for*; requiring a live session would leave a user in
 * airplane mode signed in, looking at their downloaded recitations, with an empty reading list.
 * The receipt names one user id, so the namespace it selects is that user's and nobody else's.
 * ═══════════════════════════════════════════════════════════════════════════
 */
export function FaithScopeProvider({ children }: { readonly children: ReactNode }) {
  const auth = useAuth();

  /*
    ── "Not yet decided" is not "signed out", and collapsing the two is a bug ─
    `status` is a three-state value and only two of them are verdicts. `signed-out` means the launch
    established that nobody is signed in; `unknown` means it has not finished asking. Writing
    `isLocallyAuthenticated(auth) ? id : null` treats them identically, and the cost is not
    theoretical: every launch would flip the owner from nothing to the user, and any read issued in
    that window — a warmup, a coordinator, a screen mounted by a test — resolves to no address,
    returns its default, and caches the emptiness. That is the same mistake `resolveSession` was
    written to remove one layer up, reintroduced here.

    So `unknown` returns `undefined`, meaning *leave the owner alone*. At process start there is no
    owner, so nothing is readable until the session resolves — the safe state, reached by not acting
    rather than by acting wrongly. Only an actual `signed-out` clears it.
  */
  const userId: string | null | undefined =
    auth.status === 'unknown'
      ? undefined
      : isLocallyAuthenticated(auth)
        ? (auth.user?.id ?? null)
        : null;

  useMemo(() => {
    if (userId !== undefined) {
      setActiveFaithScope(userId);
    }
  }, [userId]);

  /**
   * The owner as of the previous resolution, so a *change* can be told from a first answer.
   *
   * `undefined` until the launch resolves once. A cold launch moves from "no owner yet" to "user A",
   * and that is not somebody being replaced.
   */
  const previousUserId = useRef<string | null | undefined>(undefined);

  /**
   * Cancels scheduled prayer alerts when the account changes — and only then.
   *
   * ── Why this is an effect and the scope assignment above is not ────────────
   * Setting the owner has to precede a child's first read, so it happens in render. This does not:
   * it is a side effect on the platform, and it reads a ref, both of which render must not do.
   * Running one frame later costs nothing, because the alarms it cancels are for a time in the
   * future.
   *
   * ── Why the condition is so narrow ─────────────────────────────────────────
   * The previous owner must have been *resolved* and must actually differ. A cold launch goes
   * `undefined → A`, which is not a replacement, and cancelling there would silently drop every
   * pending alert on every launch — they are rebuilt only when a Faith screen mounts and
   * reconciles, so somebody who did not open Faith that day would simply stop being reminded. That
   * is a far worse failure than the one being fixed.
   *
   * A sign-out (`A → null`) and a switch (`A → B`) both cancel. The alarms belong to whoever set
   * them, and the record naming them is about to become unreadable — see
   * `cancelEveryPendingPrayerAlert` for why the stored identifiers cannot be used after the fact.
   */
  useEffect(() => {
    if (userId === undefined) {
      return;
    }
    const previous = previousUserId.current;
    previousUserId.current = userId;
    if (previous !== undefined && previous !== userId) {
      void cancelEveryPendingPrayerAlert(createExpoNotificationPort());
    }
  }, [userId]);

  /**
   * The legacy sweep, in an effect rather than in render.
   *
   * ── Why it does not need render's timing, and must not have it ─────────────
   * Setting the owner does need to precede a child's first read; this does not. The addresses it
   * moves are the **unscoped** ones, and after this change no scoped reader can name them — so
   * there is no read the sweep can lose a race to. What it would cost in render is real: it reads
   * a clock, which makes render impure, and React is entitled to call render more than once.
   *
   * Mounted once, not per account. It is idempotent and serialised internally, and after the first
   * launch it costs one `multiGet` that finds nothing.
   */
  useEffect(() => {
    void sweepLegacyFaithData(Date.now());
  }, []);

  return <>{children}</>;
}
