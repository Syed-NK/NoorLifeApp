import { Stack } from 'expo-router';

import { ProtectedRouteBoundary } from '@application/navigation/protected-route-boundary';
import { ModuleEntitlementGate } from '@features/subscription/components/module-entitlement-gate';

/**
 * planner module navigator (workflow §3.2).
 *
 * The entitlement gate wraps the whole stack, so every route in this module — its home, its
 * children and its AI — is gated once. Main Home is design-locked and pushes module routes
 * directly, so gating the destination is what closes the grid, the timeline, the quick actions
 * and deep links together without editing a locked file. See PHASE_5_SUBSCRIPTION_AUDIT.md §2.2.
 *
 * The authentication boundary sits **outside** the entitlement gate, because the questions are
 * ordered: who are you, then what may you use. Reversed, a signed-out visitor arriving by direct
 * link would be shown a purchase offer — which is what issue #28 observed on device, where the
 * entitlement gate was the only thing between a link and a module home.
 */
export default function Layout() {
  return (
    <ProtectedRouteBoundary>
      <ModuleEntitlementGate moduleId="planner">
        <Stack screenOptions={{ headerShown: false }} />
      </ModuleEntitlementGate>
    </ProtectedRouteBoundary>
  );
}
