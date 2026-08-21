import { Stack } from 'expo-router';

import { ProtectedRouteBoundary } from '@application/navigation/protected-route-boundary';

/**
 * Settings navigator (workflow §14).
 *
 * Settings carries account-scoped preferences and the sign-out control, so it needs authority
 * even though most of its rows look like device settings.
 */
export default function Layout() {
  return (
    <ProtectedRouteBoundary>
      <Stack screenOptions={{ headerShown: false }} />
    </ProtectedRouteBoundary>
  );
}
