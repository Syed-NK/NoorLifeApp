import { Stack } from 'expo-router';

import { ProtectedRouteBoundary } from '@application/navigation/protected-route-boundary';

/**
 * Profile navigator (workflow §14).
 *
 * Profile is the account itself — the identity row, the plan, the privacy controls — so a
 * direct link to it with no authority is the plainest form of the issue #28 exposure.
 */
export default function Layout() {
  return (
    <ProtectedRouteBoundary>
      <Stack screenOptions={{ headerShown: false }} />
    </ProtectedRouteBoundary>
  );
}
