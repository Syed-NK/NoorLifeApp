import * as SplashScreen from 'expo-splash-screen';
import { Stack } from 'expo-router';
import { View } from 'react-native';

import { AppProviders } from '@application/providers/app-providers';
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
