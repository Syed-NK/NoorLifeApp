import * as SplashScreen from 'expo-splash-screen';
import { Stack } from 'expo-router';
import { View } from 'react-native';

import { AppProviders } from '@application/providers/app-providers';
import { useAppStartup } from '@application/startup/use-app-startup';
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
  const { ready, onLayoutRootView } = useAppStartup();

  if (!ready) {
    return <View style={{ flex: 1, backgroundColor: neutralColors.canvas }} />;
  }

  return (
    <View style={{ flex: 1, backgroundColor: neutralColors.canvas }} onLayout={onLayoutRootView}>
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
