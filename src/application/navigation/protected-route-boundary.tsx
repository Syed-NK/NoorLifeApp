import { Redirect } from 'expo-router';
import type { ReactNode } from 'react';

import { authRoutes } from '@application/navigation/routes';
import { useAuth } from '@application/providers/auth-provider';

import { protectedRouteAccess } from './protected-routes';

/**
 * **The application's authentication boundary for every route that needs one.**
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Where this is mounted, and why not in one place ────────────────────────
 * Once per authenticated branch: at the outermost point of each module and account stack's
 * `_layout.tsx`, and around each authenticated top-level screen that has no layout of its own.
 *
 * A single mount point would be better and there is no correct one. The narrowest layout that
 * contains every authenticated route is the **root** layout — which also contains the entry gate,
 * onboarding, the authentication screens and the callback, so a boundary there would gate the
 * screens a signed-out user must be able to reach. Rendering a `Redirect` in place of the root
 * `<Stack>` is not an option either: `Redirect` navigates, and with the root navigator replaced
 * there is nothing left to navigate. The alternatives considered were moving all ~110 authenticated
 * route files into a `(protected)` group — a mechanical change to the entire route tree, to buy one
 * mount point — and `Stack.Protected`, which expo-router 57 does provide. `Stack.Protected` excludes
 * a screen from the navigator entirely while its guard is false, which is a *stronger* guarantee
 * than this component gives; it was not used because what a rejected deep link then resolves to is
 * decided by the router's fallback rather than by us, and this boundary has to send the user to a
 * named authentication route. Worth revisiting if that fallback is ever pinned down.
 *
 * So the rule is one function and one component, mounted at several points. The thing that must not
 * be duplicated — the decision — is not. `protected-route-boundary.test.ts` asserts every
 * authenticated route entry is behind exactly one of these, and that no public or callback route is.
 *
 * ── Outermost, above the entitlement gate ──────────────────────────────────
 * Every module layout wraps its stack in `ModuleEntitlementGate`. This sits *outside* that, because
 * the questions are ordered: who are you, then what may you use. Reversed, a signed-out visitor
 * would be shown a purchase offer for a module — which is what was observed on device, where the
 * entitlement gate was the only thing standing between a direct link and a module home. Entitlement
 * is untouched by this change and still runs on every module route once authority is established.
 *
 * ── Why a redirect rather than a rendered "please sign in" ─────────────────
 * `Redirect` replaces rather than pushes, so Back from Authentication Options cannot fall through to
 * the screen the link named. A pushed navigation would leave the guarded screen mounted underneath —
 * one gesture away, and already having issued its reads. Rendering a message instead would leave the
 * protected route as the current route, which is the same problem wearing different copy.
 * ═══════════════════════════════════════════════════════════════════════════
 */
export function ProtectedRouteBoundary({ children }: { readonly children: ReactNode }) {
  const auth = useAuth();
  const access = protectedRouteAccess(auth);

  if (access === 'wait') {
    /*
      Nothing — not a spinner. The entry gate owns the branded splash and is still on screen for an
      ordinary launch; a second loading affordance here would flash over it. On a cold deep link
      there is no splash to protect, and a blank frame for the few hundred milliseconds a session
      takes to resolve is the honest representation of "we have not finished asking".
    */
    return null;
  }
  if (access === 'redirect') {
    return <Redirect href={authRoutes.welcome} />;
  }
  return <>{children}</>;
}
