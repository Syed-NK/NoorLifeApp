import { Redirect } from 'expo-router';
import { View } from 'react-native';

import { authRoutes, globalRoutes, onboardingRoutes } from '@application/navigation/routes';
import { useAuthCallback } from '@application/providers/auth-callback-provider';
import { subscriptionRoutes } from '@features/subscription/subscription-routes';
import { useNativeSplashHandoff } from '@application/startup/use-native-splash-handoff';
import { useStartupRouting } from '@application/startup/use-startup-routing';
import { AUTH_CALLBACK_ROUTE } from '@features/auth-callback/auth-callback-routes';
import { SplashScreen } from '@features/entry-auth/screens/splash-screen';

/**
 * Application entry gate — the branded splash, and the one routing decision.
 *
 * ── What this replaced, and why ─────────────────────────────────────────────
 * The startup sequence measured on a Pixel 8 was: native robot icon for ~2.2 s, a blank mint view
 * while the root layout waited on `ready`, the branded splash at ~3.7 s, then onboarding. The brand
 * arrived last, after two seconds of nothing, which is why it read as skipped.
 *
 * Two changes fixed it. The native icon is gone (see android/.../styles.xml), and the root layout
 * no longer renders a blank placeholder — this screen mounts immediately and shows the emblem while
 * fonts, session and onboarding resolve behind it. The branded splash is now the first
 * React-rendered screen, and nothing can paint before it.
 *
 * ── Why it is not a route ───────────────────────────────────────────────────
 * The splash renders here rather than being pushed, so it leaves no history entry. Back from
 * Main Home, from onboarding or from authentication can never return to it.
 */
export default function Index() {
  const { destination } = useStartupRouting();
  // The native layer is dismissed on its own schedule — as soon as the branded splash can paint,
  // never waiting for session, onboarding or the 1800 ms brand minimum. See the hook for why that
  // separation is the fix rather than a tidy-up.
  const { onBrandedSplashLayout } = useNativeSplashHandoff();
  const { pending } = useAuthCallback();

  /**
   * A cold-start authentication callback takes precedence over the startup destination.
   *
   * ── Why here, and why it does not shorten the splash ────────────────────────
   * `AuthCallbackProvider` reads `getInitialURL` on the first tick, so a link that launched the app is
   * already captured by the time the machine names a destination. Overriding the destination — rather
   * than adding a second navigation — is what guarantees the rule the phase brief states directly: no
   * redirect to Home before callback processing completes. The alternative, letting the gate route
   * normally and then pushing the callback screen, means Main Home mounts first and a confirmed signup
   * can be seen to skip the plan chooser before being sent back to it.
   *
   * The brand minimum is deliberately still honoured: this is read *after* `destination`, so the
   * splash keeps its 1800 ms on a first launch and 900 ms on a returning one, and the callback simply
   * waits. A deep link is not a reason to truncate the one uninterrupted brand moment, and the
   * callback is held in memory rather than raced against.
   *
   * A **warm** callback is not handled here — the gate is not mounted then. See
   * `use-callback-navigation.ts`.
   */
  if (destination !== null && pending !== null && pending.origin === 'cold') {
    return <Redirect href={AUTH_CALLBACK_ROUTE} />;
  }

  if (destination === null) {
    // Still resolving, or holding the brand for its minimum.
    //
    // `onLayout` sits on a wrapper rather than on `SplashScreen` itself, which is a design-locked
    // file and takes no props. The wrapper's layout fires once the splash has actually painted,
    // which is the signal to hide the native splash — so the handoff has no blank frame in it.
    return (
      <View style={{ flex: 1 }} onLayout={onBrandedSplashLayout} testID="startup-branded-splash">
        <SplashScreen />
      </View>
    );
  }

  return <Redirect href={hrefFor(destination)} />;
}

/**
 * Maps a terminal startup state to its route.
 *
 * `startup_error` deliberately resolves to Authentication Options rather than an error screen:
 * every dependency here has a safe fallback, so an unresolved startup means "we do not know who
 * you are", and the honest response to that is the signed-out entry point. It never resolves to
 * Main Home — the app does not invent a session it could not confirm.
 */
function hrefFor(destination: string): Parameters<typeof Redirect>[0]['href'] {
  switch (destination) {
    case 'authenticated_home':
      return globalRoutes.home as Parameters<typeof Redirect>[0]['href'];
    case 'subscription_choice':
      // Signed in, but the account has not chosen a plan. It resumes here rather than at Main Home,
      // so an interrupted signup picks up where it left off on the next launch.
      return subscriptionRoutes.welcome;
    case 'onboarding':
      return onboardingRoutes.one as Parameters<typeof Redirect>[0]['href'];
    default:
      return authRoutes.welcome as Parameters<typeof Redirect>[0]['href'];
  }
}
