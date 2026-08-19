import { Redirect } from 'expo-router';
import type { ReactNode } from 'react';

import { authRoutes } from '@application/navigation/routes';
import {
  isLocallyAuthenticated,
  useAuth,
  type AuthState,
} from '@application/providers/auth-provider';

/**
 * The authentication guard on the Faith stack.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── The exposure this closes, exactly as it was found ──────────────────────
 * `src/app/index.tsx` was the application's only authentication gate, and it is the *entry route*.
 * A deep link — `noorlifeapp://faith/duas` — renders its target directly and never touches it. So
 * every Faith screen was reachable by link with no authentication decision taken by anybody, and
 * the module's storage boundary resolved whatever owner the auth provider currently held.
 *
 * Observed on the emulator: the app's own startup routing had sent the visible navigation to
 * Authentication Options, and a deep link into Faith rendered the previous account's saved
 * selections beside it. Two notions of "may proceed" disagreed, and the link consulted neither.
 *
 * ── Why the guard admits offline authority ─────────────────────────────────
 * `isLocallyAuthenticated`, not `isOnlineAuthenticated`. Opening your own downloaded Qur'an in an
 * aeroplane is precisely what an offline receipt is *for*, and a guard that required a live session
 * would lock a legitimately signed-in user out of data already on their phone. The receipt names one
 * user id, so the namespace it selects is that user's and nobody else's.
 *
 * What it refuses is the case with **no authority of either kind**: no session, no receipt, or a
 * receipt the provider has already discarded on a definitive server verdict.
 *
 * ── Why `unknown` renders nothing rather than redirecting ──────────────────
 * `unknown` means the launch has not finished asking, and it is not a verdict. Redirecting on it
 * would bounce a signed-in user to Authentication Options on every cold deep link, one frame before
 * the session resolves — the same conflation of "not yet decided" with "signed out" that
 * `FaithScopeProvider` documents at length. Rendering nothing is the safe half: no Faith screen
 * mounts, so no read is issued, and the decision is taken once the answer exists.
 *
 * ── What this guard is not ─────────────────────────────────────────────────
 * It is not the data boundary. Even with the guard in place, `resolveFaithAddress` returns `null`
 * without an owner and every read answers its caller's default — see `faith-storage.ts`. This stops
 * the *screen* from being reachable; the storage layer independently stops the *data* from being
 * readable. Neither is a substitute for the other, and the tests assert them separately.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * What the guard decided, as a value.
 *
 * Exported and pure so the rule can be asserted directly rather than inferred from a rendered tree
 * — the same reason `shouldStackTwoColumn` is a function rather than a `useMemo` inside a screen.
 */
export type FaithRouteAccess = 'allow' | 'redirect' | 'wait';

export function faithRouteAccess(auth: AuthState): FaithRouteAccess {
  if (auth.status === 'unknown') {
    return 'wait';
  }
  return isLocallyAuthenticated(auth) ? 'allow' : 'redirect';
}

export function FaithRouteGuard({ children }: { readonly children: ReactNode }) {
  const auth = useAuth();
  const access = faithRouteAccess(auth);

  if (access === 'wait') {
    return null;
  }
  if (access === 'redirect') {
    /*
      `Redirect` replaces rather than pushes, so Back from Authentication Options cannot fall through
      to the Faith screen the link named. A pushed navigation would leave the guarded screen mounted
      underneath — reachable with one gesture, and already having issued its reads.
    */
    return <Redirect href={authRoutes.welcome} />;
  }
  return <>{children}</>;
}
