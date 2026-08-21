import { Stack } from 'expo-router';

import { ProtectedRouteBoundary } from '@application/navigation/protected-route-boundary';

/**
 * noor-ai module navigator. The module owns its own stack (workflow §3.2).
 *
 * Noor AI reads the account’s own modules to answer, so it needs authority before it mounts.
 */
export default function Layout() {
  return (
    <ProtectedRouteBoundary>
      <Stack screenOptions={{ headerShown: false }} />
    </ProtectedRouteBoundary>
  );
}
