import * as SplashScreen from 'expo-splash-screen';
import { Stack } from 'expo-router';
import { View } from 'react-native';

import { AppProviders } from '@application/providers/app-providers';
import { useCallbackNavigation } from '@application/startup/use-callback-navigation';
import { useNativeSplashBackstop } from '@application/startup/use-native-splash-handoff';
import { neutralColors } from '@ds/tokens';

// Hold the native splash screen until fonts are registered and the session is
// resolved, so the first painted frame is already in Poppins (deliverable 7).
void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  return (
    <AppProviders>
      <RootNavigator />
    </AppProviders>
  );
}

/**
 * Lives inside AppProviders so it can read font and session readiness.
 *
 * While not ready, a bare canvas-coloured view is rendered under the still-visible
 * splash screen: mounting the navigator before fonts resolve is what produces a
 * flash of unstyled text.
 */
function RootNavigator() {
  /**
   * Warm-start deep links.
   *
   * Called here because it needs `useRouter`, which requires a mounted navigator — and it has to sit
   * above every screen so a link arriving while the user is anywhere in the app is handled. A
   * cold-start link is *not* handled here: the entry gate resolves to the callback route instead of
   * its usual destination, so nothing can navigate to Home before the callback is processed. See
   * `use-callback-navigation.ts` for why the two are separate.
   */
  useCallbackNavigation();

  /**
   * The native splash's route-independent ceiling.
   *
   * `useNativeSplashHandoff` lives in the entry gate, which owns the "branded splash has painted"
   * signal — but Expo Router makes a deep-linked route the *initial* route, so a cold-start
   * authentication callback never mounts the gate and never armed its ceiling. Measured on the
   * emulator: `noorlifeapp://auth/callback` from a force-stopped app left the native splash up over a
   * working callback screen indefinitely. This layout mounts for every route, so the ceiling is armed
   * on every launch however it started. On an ordinary launch the gate still wins.
   */
  useNativeSplashBackstop();

  return (
    /**
     * The navigator mounts immediately.
     *
     * It used to be gated behind a readiness flag, rendering a blank canvas-coloured view until
     * fonts and session resolved. Measured on a Pixel 8 that blank lasted about two seconds and sat
     * *between* the native splash and the branded one — so the brand appeared at ~3.7 s, after the
     * user had already been staring at nothing, which is what made it feel skipped.
     *
     * The entry gate at `index.tsx` now renders the branded splash as the first React screen and
     * holds it for its minimum, so there is nothing left for a placeholder to protect against.
     * Hiding the native splash moved there too: it fires on the splash's own layout, which is the
     * only moment that guarantees something correct is already painted underneath.
     */
    <View style={{ flex: 1, backgroundColor: neutralColors.canvas }}>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: neutralColors.canvas },
          // §7: standard transition is 200 ms ease-out. Expo Router's default
          // native animation matches this closely; the explicit value keeps the
          // intent recorded rather than inherited.
          animation: 'slide_from_right',
          animationDuration: 200,
        }}
      />
    </View>
  );
}
