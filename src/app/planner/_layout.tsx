import { Stack } from 'expo-router';

import { ProtectedRouteBoundary } from '@application/navigation/protected-route-boundary';
import { PlannerRoutineProvider } from '@features/planner/di/planner-routine-provider';
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
 *
 * ── The routine store is owned here — issue #73 ────────────────────────────
 * Routines used to be read through a provider mounted by the Routines route *and* another mounted by
 * the Planner home composition, so completing a routine on one left the other stale until it
 * remounted. One owner sits here instead, and both consumers read it.
 *
 * This layout is the narrowest boundary that covers every routine consumer: both live inside the
 * Planner stack, and Main Home shows today's tasks rather than routines. Inside the gate rather than
 * outside it, because a visitor who may not open Planner has no reason to have their routine keys
 * read — and because the gate renders an offer instead of children, so nothing under it mounts.
 *
 * Tasks are owned further up, in `TodayAgendaProvider`, for the opposite reason: Main Home consumes
 * them, and Main Home is not in this stack.
 */
export default function Layout() {
  return (
    <ProtectedRouteBoundary>
      <ModuleEntitlementGate moduleId="planner">
        <PlannerRoutineProvider>
          <Stack screenOptions={{ headerShown: false }} />
        </PlannerRoutineProvider>
      </ModuleEntitlementGate>
    </ProtectedRouteBoundary>
  );
}
