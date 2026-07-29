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

  useEffect(() => {
    const timer = setTimeout(() => {
      setBrandIntervalElapsed(true);
    }, SPLASH_MINIMUM_MS);
    return () => {
      clearTimeout(timer);
    };
  }, []);

  // 'unknown' means the session has not resolved. Redirecting now would flash the wrong entry
  // and then correct itself.
  if (status === 'unknown' || !brandIntervalElapsed) {
    return <SplashScreen />;
  }

  if (status === 'signed-in') {
    return <Redirect href={globalRoutes.home} />;
  }

  return <Redirect href={hasCompletedOnboarding ? authRoutes.welcome : onboardingRoutes.one} />;
}
