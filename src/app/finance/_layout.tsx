import { Stack } from 'expo-router';

import { ModuleEntitlementGate } from '@features/subscription/components/module-entitlement-gate';

/**
 * finance module navigator (workflow §3.2).
 *
 * The entitlement gate wraps the whole stack, so every route in this module — its home, its
 * children and its AI — is gated once. Main Home is design-locked and pushes module routes
 * directly, so gating the destination is what closes the grid, the timeline, the quick actions
 * and deep links together without editing a locked file. See PHASE_5_SUBSCRIPTION_AUDIT.md §2.2.
 */
export default function Layout() {
  return (
    <ModuleEntitlementGate moduleId="finance">
      <Stack screenOptions={{ headerShown: false }} />
    </ModuleEntitlementGate>
  );
}
