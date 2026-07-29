import * as SplashScreen from 'expo-splash-screen';
import { useCallback } from 'react';

import { useAuth } from '@application/providers/auth-provider';
import { useFontReadiness } from '@application/providers/font-provider';

export type AppStartup = {
  /** True once every startup dependency has resolved. */
  readonly ready: boolean;
  /** Attach to the root view's `onLayout` to hide the splash after first paint. */
  readonly onLayoutRootView: () => void;
};

/**
 * Startup readiness gate.
 *
 * Collects every condition that must hold before the first frame is shown:
 *   • fonts registered (so text never paints in a fallback face first)
 *   • session status resolved (so the router does not flash the wrong entry)
 *
 * The splash screen is hidden from `onLayoutRootView` rather than from an effect
 * on `ready`. Hiding on `ready` reveals the frame *before* it has laid out, which
 * is exactly the unstyled flash the splash exists to prevent; hiding on the root
 * view's first layout guarantees there is something correct to show.
 */
export function useAppStartup(): AppStartup {
  const fonts = useFontReadiness();
  const auth = useAuth();

  const ready = fonts.ready && auth.status !== 'unknown';

  const onLayoutRootView = useCallback(() => {
    if (!ready) {
      return;
    }
    // Fire-and-forget: a failure here only means the splash lingers, and there is
    // no recovery action to take.
    void SplashScreen.hideAsync().catch(() => undefined);
  }, [ready]);

  return { ready, onLayoutRootView };
}
