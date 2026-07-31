import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { moduleRoutes } from '@application/navigation/routes';
import { moduleRegistry } from '@features/modules/module-registry';
import type { FrameworkModuleId } from '@features/modules/module-tokens';

import { isPremiumModule } from '../domain/entitlement';
import { useEntitlement } from '../services/entitlement-context';
import { subscriptionRoutes } from '../subscription-routes';
import { LockedModuleSheet } from './locked-module-sheet';

export type ModuleEntitlementGateProps = {
  readonly moduleId: FrameworkModuleId;
  readonly children: React.ReactNode;
};

/**
 * Gates a paid module at its own route.
 *
 * ── Why the gate lives here and not in Main Home ────────────────────────────
 * `main-home-screen.tsx` is design-locked and pushes module routes directly, from four separate
 * places — the module grid, timeline entries, quick actions, and hardcoded pushes to `/planner`
 * and `/family`. Gating the grid's callback would need an edit to a locked file *and* would still
 * leave the other three paths open, along with deep links and the module AI routes.
 *
 * Gating the destination closes every path at once and touches nothing that is locked. Main Home
 * keeps navigating exactly as before; the module decides whether it renders.
 *
 * ── Faith is never gated ────────────────────────────────────────────────────
 * `isPremiumModule` returns false for Faith and Noor AI, so this returns children untouched for
 * them before any entitlement is consulted. Mounting the gate around Faith would still be safe,
 * which is deliberate: the safety does not depend on remembering where not to put it.
 *
 * ── The unresolved state does not lock ──────────────────────────────────────
 * While `isResolved` is false the children render. A gate that showed a paywall during the first
 * entitlement load would flash one at a paying subscriber on every cold start, which is worse than
 * briefly showing a module to someone who turns out not to have it — the module's own content
 * loads behind the same entitlement.
 */
export function ModuleEntitlementGate({ moduleId, children }: ModuleEntitlementGateProps) {
  const router = useRouter();
  const { entitlement, isResolved } = useEntitlement();
  const [dismissed, setDismissed] = useState(false);

  const requiresSubscription = isPremiumModule(moduleId);
  const permitted =
    !requiresSubscription ||
    !isResolved ||
    (entitlement.capabilities.premiumModules &&
      (entitlement.status === 'active' ||
        entitlement.status === 'trialing' ||
        entitlement.status === 'grace_period'));

  if (permitted) {
    return <>{children}</>;
  }

  const definition = moduleRegistry[moduleId];

  return (
    // The module's own frame is not rendered behind the sheet: a locked module has no content to
    // show, and rendering it under a scrim would imply it is one dismissal away.
    <View style={{ flex: 1 }} testID={`module-locked-${moduleId}`}>
      <LockedModuleSheet
        visible={!dismissed}
        moduleId={moduleId}
        moduleName={definition.name}
        onViewPlans={() => {
          setDismissed(true);
          router.push(subscriptionRoutes.welcome);
        }}
        onNotNow={() => {
          setDismissed(true);
          // Back to wherever they came from. `back()` is right here rather than a hardcoded route:
          // the brief requires back navigation to return to the actual parent, not always Main Home.
          if (router.canGoBack()) {
            router.back();
          } else {
            router.replace(moduleRoutes.faith.home);
          }
        }}
        onContinueToFaith={() => {
          setDismissed(true);
          router.replace(moduleRoutes.faith.home);
        }}
        testID={`locked-sheet-${moduleId}`}
      />
    </View>
  );
}
