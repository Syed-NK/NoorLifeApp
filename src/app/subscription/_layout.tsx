import { Stack } from 'expo-router';

import { ProtectedRouteBoundary } from '@application/navigation/protected-route-boundary';

/**
 * Subscription navigator (workflow §14).
 *
 * The subscription flow was reachable with no session at all — observed in issue #28, where a
 * simulated purchase completed end to end from a signed-out launch. Whether a purchase should ever
 * be startable without an account is a product question recorded in that issue; this boundary
 * answers the narrower one, which is that it must not be reachable without authority.
 */
export default function Layout() {
  return (
    <ProtectedRouteBoundary>
      <Stack screenOptions={{ headerShown: false }} />
    </ProtectedRouteBoundary>
  );
}
