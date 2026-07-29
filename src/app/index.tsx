import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';

import { authRoutes, globalRoutes, onboardingRoutes } from '@application/navigation/routes';
import { useAuth } from '@application/providers/auth-provider';
import { SplashScreen } from '@features/entry-auth/screens/splash-screen';

/**
 * Minimum time the branded splash stays on screen, in ms.
 *
 * The phase prompt asks for "1.5–2 seconds only while routing state is resolved" and forbids a
 * fake progress spinner. Read together those mean: budget this long for the brand moment and
 * resolve routing inside it — not "resolve, then idle". In practice resolution is two storage
 * reads and finishes in tens of ms, so without a floor the locked splash would flash past
 * unseen. The wait is therefore `max(resolve, 1500 ms)`: never padded beyond the floor, never
 * cut short if resolution runs long.
 */
const SPLASH_MINIMUM_MS = 1500;

/**
 * Application entry gate — Screen 01's routing behaviour.
 *
 * Three destinations, exactly as the entry lock specifies:
 *   • a valid session          → Main Home
 *   • first launch, no session → Onboarding 1
 *   • returning, no session    → Authentication Options
 *
 * The decision reads from the auth boundary only, so connecting a real backend changes the
 * provider and not this file. The splash is rendered here rather than pushed as a route, so it
 * leaves no history entry for Back to return to.
 */
export default function Index() {
  const { status, hasCompletedOnboarding } = useAuth();
  const [brandIntervalElapsed, setBrandIntervalElapsed] = useState(false);
  /**
   * The entry decision, taken once.
   *
   * This screen stays mounted after rendering its `Redirect` — it is the stack's root. Recomputing the
   * destination on every render therefore made it a permanent redirector: signing up flipped the
   * session to signed-in, this component re-rendered, and its fresh `Redirect` to Main Home overrode
   * the `replace` that had just sent the user to Account Ready. The account was created correctly and
   * the success screen was simply skipped.
   *
   * Freezing the answer keeps the gate doing what its name says — deciding where a launch begins — and
   * leaves navigation after that to the screens that own it.
   */
  const [destination, setDestination] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setBrandIntervalElapsed(true);
    }, SPLASH_MINIMUM_MS);
    return () => {
      clearTimeout(timer);
    };
  }, []);

  // 'unknown' means the session has not resolved. Deciding now would flash the wrong entry and then
  // correct itself.
  const resolved = status !== 'unknown' && brandIntervalElapsed;

  if (resolved && destination === null) {
    // Set during render, guarded so it happens exactly once — React's sanctioned way to derive state
    // that must not be recomputed afterwards.
    setDestination(
      status === 'signed-in'
        ? globalRoutes.home
        : hasCompletedOnboarding
          ? authRoutes.welcome
          : onboardingRoutes.one,
    );
  }

  if (destination === null) {
    return <SplashScreen />;
  }

  return <Redirect href={destination as Parameters<typeof Redirect>[0]['href']} />;
}
