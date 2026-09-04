import { Redirect } from 'expo-router';
import type { ReactNode } from 'react';

import { authRoutes } from '@application/navigation/routes';
import { useAuthCallback } from '@application/providers/auth-callback-provider';
import { useAuth } from '@application/providers/auth-provider';
import { useRecoveryContainmentState } from '@application/providers/recovery-containment-provider';
import { SET_NEW_PASSWORD_ROUTE } from '@features/auth-callback/auth-callback-routes';
import { StartupWaitPresentation } from '@application/startup/startup-wait-presentation';

import { RememberIntendedRoute } from './remember-intended-route';
import { protectedRouteAccess } from './protected-routes';
import { recoveryRouteAccess } from './recovery-route-access';

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
      Nothing yet — and, past the presentation ceiling, something true.

      For the few hundred milliseconds an ordinary launch takes, this still renders nothing: the
      entry gate owns the branded splash and is on screen, and a second loading affordance would
      flash over it. That was the whole of this branch, and on a launcher launch it still is.

      What it missed is the launch that has no gate behind it. Expo Router makes a deep-linked route
      the initial route, so on a cold link this `null` is not sitting under a splash — it *is* the
      screen, for as long as authority takes. Measured at nine to eleven seconds on both Android
      targets, which is a blank canvas with nothing to say for itself (issue #58).

      `StartupWaitPresentation` renders nothing below the ceiling and the identity-free notice at or
      past it, from the same clock the gate uses. It decides nothing and navigates nowhere:
      `children` is still not referenced, so no protected provider mounts and no account-scoped read
      is issued while we do not know.
    */
    return <StartupWaitPresentation />;
  }
  if (access === 'redirect') {
    /*
      Refused — and, unlike before, the request is not thrown away with the route (issue #62).

      `RememberIntendedRoute` records the path this visitor was reaching for so the authentication
      landings can return them to it. It renders nothing and decides nothing; the verdict above is
      unchanged, and it is mounted *only* on this branch so the gate itself stays the pure,
      effect-free consumer that `recovery-containment-boundary.test.ts` requires it to be.

      Ordered before the redirect so the record exists before the navigation is issued.
    */
    return (
      <>
        <RememberIntendedRoute />
        <Redirect href={authRoutes.welcome} />
      </>
    );
  }
  /*
    Authority established. One more question before protected content mounts — see below. Composed
    here rather than mounted separately at all nineteen points, so the two decisions stay distinct
    functions without doubling the places a layout has to remember to wrap.
  */
  return <RecoveryContainmentGate>{children}</RecoveryContainmentGate>;
}

/**
 * Holds a session that is still owed a password at the recovery screen — issue #30.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Why this is inside the authentication boundary, not beside it ───────────
 * The order is a dependency, not a preference. A recovery-contained user **is** signed in — Supabase
 * establishes a real session before `updateUser({ password })` can be called, which is the whole
 * reason the marker exists — so asking "is this recovery open" is only meaningful once authority is
 * established. Running it first would mean answering it for signed-out visitors, whose containment
 * question is already answered by the redirect above.
 *
 * It stays a separate component and a separate pure function because it is a separate kind of claim:
 * `protectedRouteAccess` decides identity and is permanent for the session;
 * `recoveryRouteAccess` decides a temporary navigation restriction that clears the moment the
 * password is set. Entitlement then runs inside this, unchanged — three questions in dependency
 * order: who are you, do you owe a password, what may you use.
 *
 * ── It holds no state and performs no side effect ──────────────────────────
 * Every effect belongs to the one actor in `RecoveryContainmentProvider` — the marker read, the
 * grant, the clean-up, the sign-out. This reads two values and renders. That separation is what lets
 * the same component sit at nineteen mount points without becoming nineteen actors: mounting a pure
 * consumer more widely cannot duplicate a read, a navigation-driving state transition, a listener or
 * a session clear, because it does none of them.
 * ═══════════════════════════════════════════════════════════════════════════
 */
function RecoveryContainmentGate({ children }: { readonly children: ReactNode }) {
  const { recovery } = useAuthCallback();
  const { pending } = useRecoveryContainmentState();

  const access = recoveryRouteAccess({
    recoveryOpen: recovery !== null,
    resolved: pending !== null,
  });

  if (access === 'wait') {
    /*
      The launch-time marker read has not answered. The same surface as the branch above, for the
      same reason and with the same guarantee: `children` is not referenced, so no protected
      provider mounts and no account-scoped read is issued while we do not know.

      It matters that this branch gets it too. A cold deep link waits here as well as above — the
      containment marker is read once per launch, and on a slow launch it can be the outstanding
      answer after authority has already landed. A notice on one branch and a blank on the other
      would make the same wait look like two different things.
    */
    return <StartupWaitPresentation />;
  }
  if (access === 'contain') {
    /*
      `Redirect`, so it replaces: Back from the password screen cannot fall through to the route the
      link named. `SET_NEW_PASSWORD_ROUTE` is classified `callback`, so it sits outside this boundary
      and this redirect cannot loop against itself.
    */
    return <Redirect href={SET_NEW_PASSWORD_ROUTE} />;
  }
  return <>{children}</>;
}
