import type { FrameworkModuleId } from '@features/modules/module-tokens';

import {
  UNKNOWN_ENTITLEMENT,
  canAccessModule as canAccessModuleRule,
  canUseModuleAI as canUseModuleAIRule,
  type Entitlement,
  type FamilySeatUsage,
} from '../domain/entitlement';
import type { ProductId } from '../domain/products';
import { MockPurchaseAdapter } from './mock-purchase-adapter';
import type {
  PricedOffer,
  PurchaseAdapter,
  PurchaseResult,
  RestoreResult,
} from './purchase-adapter';

/**
 * The one service presentation code uses.
 *
 * Screens call these methods and nothing else. No component imports RevenueCat, StoreKit, Google
 * Play or Supabase — the brief requires that separation, and it is what makes the store
 * integration replaceable without reopening seventeen screens.
 *
 * The service holds the *rules*; the adapter holds the *platform*. Access questions are answered
 * here from the entitlement domain, so they give the same answer whether the entitlement came
 * from a real store or the mock.
 */
export type EntitlementService = {
  getCurrentEntitlement(): Entitlement;
  refreshEntitlement(): Promise<Entitlement>;
  canAccessModule(moduleId: FrameworkModuleId): boolean;
  canUseModuleAI(moduleId: FrameworkModuleId): boolean;
  getAvailablePlans(): Promise<readonly PricedOffer[]>;
  purchasePlan(productId: ProductId): Promise<PurchaseResult>;
  restorePurchases(): Promise<RestoreResult>;
  openPlatformSubscriptionManagement(): Promise<boolean>;
  getFamilySeatUsage(): Promise<FamilySeatUsage>;
  /** True when the active adapter cannot take money — drives the development mock badge. */
  readonly isMockMode: boolean;
};

export function createEntitlementService(adapter: PurchaseAdapter): EntitlementService {
  /**
   * Cached so synchronous access questions are answerable.
   *
   * `canAccessModule` is called during render by module layouts, which cannot await. It starts as
   * `UNKNOWN_ENTITLEMENT` rather than free so a not-yet-loaded state is distinguishable from an
   * actually-free user — see the note on `UNKNOWN_ENTITLEMENT`.
   */
  let current: Entitlement = UNKNOWN_ENTITLEMENT;

  const applyResult = (result: { readonly entitlement?: Entitlement }): void => {
    if (result.entitlement !== undefined) {
      current = result.entitlement;
    }
  };

  return {
    isMockMode: !adapter.canTransact,

    getCurrentEntitlement: () => current,

    refreshEntitlement: async () => {
      current = await adapter.getEntitlement();
      return current;
    },

    canAccessModule: (moduleId) => canAccessModuleRule(current, moduleId),
    canUseModuleAI: (moduleId) => canUseModuleAIRule(current, moduleId),

    getAvailablePlans: () => adapter.getOffers(),

    purchasePlan: async (productId) => {
      const result = await adapter.purchase(productId);
      // Only a completed purchase moves the entitlement. Cancelled, pending and declined all
      // leave the user exactly where they were, which is the behaviour the brief requires.
      applyResult(result);
      return result;
    },

    restorePurchases: async () => {
      const result = await adapter.restore();
      applyResult(result);
      return result;
    },

    openPlatformSubscriptionManagement: () => adapter.openManagement(),

    getFamilySeatUsage: async () => {
      if (adapter instanceof MockPurchaseAdapter) {
        return adapter.getSeatUsage();
      }
      // A real adapter reads seats from the backend, not the store. Until that exists, report the
      // organizer's own seat against the plan's limit rather than inventing members.
      return { used: 1, limit: current.capabilities.memberLimit, pendingInvitations: 0 };
    },
  };
}

/**
 * The adapter this build uses.
 *
 * One line to change when store products exist: construct the RevenueCat or StoreKit adapter
 * here instead. Every screen keeps working, because none of them knows which adapter it is.
 */
export function createDefaultAdapter(): PurchaseAdapter {
  return new MockPurchaseAdapter();
}
