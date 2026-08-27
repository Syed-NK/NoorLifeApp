import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import type { FrameworkModuleId } from '@features/modules/module-tokens';

import {
  UNKNOWN_ENTITLEMENT,
  canAccessModule as canAccessModuleRule,
  canUseModuleAI as canUseModuleAIRule,
  isEntitlementResolved,
  type Entitlement,
  type FamilySeatUsage,
} from '../domain/entitlement';
import type { ProductId } from '../domain/products';
import {
  createDefaultAdapter,
  createEntitlementService,
  type EntitlementService,
} from './entitlement-service';
import type {
  PricedOffer,
  PurchaseAdapter,
  PurchaseResult,
  RestoreResult,
} from './purchase-adapter';

/**
 * The entitlement boundary for React.
 *
 * Mirrors the service into state so components re-render when entitlement changes, in the same
 * shape `AuthProvider` uses for the session. Components read `useEntitlement()` and never
 * construct a service or an adapter themselves.
 *
 * `adapter` is injectable purely so tests and the screenshot harness can supply a mock in a
 * known state. Production passes nothing and gets the default.
 */

export type EntitlementState = {
  readonly entitlement: Entitlement;
  /** False until the first resolve completes. */
  readonly isResolved: boolean;
  /** True while a refresh, purchase or restore is in flight. */
  readonly isBusy: boolean;
  readonly seatUsage: FamilySeatUsage | null;
  /** True when purchases are simulated. Never true in a production build. */
  readonly isMockMode: boolean;
};

export type EntitlementActions = {
  refresh(): Promise<void>;
  /** The purchasable offers with prices. Screens read plans through here, never from an adapter. */
  getAvailablePlans(): Promise<readonly PricedOffer[]>;
  purchase(productId: ProductId): Promise<PurchaseResult>;
  restore(): Promise<RestoreResult>;
  openStoreManagement(): Promise<boolean>;
  canAccessModule(moduleId: FrameworkModuleId): boolean;
  canUseModuleAI(moduleId: FrameworkModuleId): boolean;
  refreshSeatUsage(): Promise<void>;
};

const StateContext = createContext<EntitlementState | null>(null);
const ActionsContext = createContext<EntitlementActions | null>(null);

export type EntitlementProviderProps = {
  readonly children: React.ReactNode;
  /** Test and screenshot seam. Omit in the app. */
  readonly adapter?: PurchaseAdapter;
};

export function EntitlementProvider({ children, adapter }: EntitlementProviderProps) {
  // One service for the provider's lifetime. Recreating it would reset the cached entitlement.
  const service: EntitlementService = useMemo(
    () => createEntitlementService(adapter ?? createDefaultAdapter()),
    [adapter],
  );

  const [entitlement, setEntitlement] = useState<Entitlement>(UNKNOWN_ENTITLEMENT);
  const [isBusy, setIsBusy] = useState(false);
  const [seatUsage, setSeatUsage] = useState<FamilySeatUsage | null>(null);

  const refresh = useCallback(async () => {
    setIsBusy(true);
    try {
      setEntitlement(await service.refreshEntitlement());
    } finally {
      setIsBusy(false);
    }
  }, [service]);

  const refreshSeatUsage = useCallback(async () => {
    setSeatUsage(await service.getFamilySeatUsage());
  }, [service]);

  // Resolve once on mount. Until this lands, `status` is `unknown` and gates must not treat the
  // user as free.
  useEffect(() => {
    let cancelled = false;
    void service.refreshEntitlement().then((resolved) => {
      if (!cancelled) {
        setEntitlement(resolved);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [service]);

  const purchase = useCallback(
    async (productId: ProductId) => {
      setIsBusy(true);
      try {
        const result = await service.purchasePlan(productId);
        if (result.entitlement !== undefined) {
          setEntitlement(result.entitlement);
          setSeatUsage(await service.getFamilySeatUsage());
        }
        return result;
      } finally {
        setIsBusy(false);
      }
    },
    [service],
  );

  const restore = useCallback(async () => {
    setIsBusy(true);
    try {
      const result = await service.restorePurchases();
      if (result.entitlement !== undefined) {
        setEntitlement(result.entitlement);
      }
      return result;
    } finally {
      setIsBusy(false);
    }
  }, [service]);

  const state = useMemo<EntitlementState>(
    () => ({
      entitlement,
      isResolved: isEntitlementResolved(entitlement),
      isBusy,
      seatUsage,
      isMockMode: service.isMockMode,
    }),
    [entitlement, isBusy, seatUsage, service.isMockMode],
  );

  const actions = useMemo<EntitlementActions>(
    () => ({
      refresh,
      getAvailablePlans: () => service.getAvailablePlans(),
      purchase,
      restore,
      openStoreManagement: () => service.openPlatformSubscriptionManagement(),
      // Answered from the rules against current state, so a component's answer and the
      // service's answer cannot disagree mid-render.
      canAccessModule: (moduleId) => canAccessModuleRule(entitlement, moduleId),
      canUseModuleAI: (moduleId) => canUseModuleAIRule(entitlement, moduleId),
      refreshSeatUsage,
    }),
    [refresh, purchase, restore, service, entitlement, refreshSeatUsage],
  );

  return (
    <StateContext.Provider value={state}>
      <ActionsContext.Provider value={actions}>{children}</ActionsContext.Provider>
    </StateContext.Provider>
  );
}

export function useEntitlement(): EntitlementState {
  const value = useContext(StateContext);
  if (value === null) {
    throw new Error('useEntitlement must be used inside an EntitlementProvider.');
  }
  return value;
}

/**
 * The entitlement, or `null` outside the provider.
 *
 * `useEntitlement` throws, deliberately — a screen that gates on a missing entitlement would be
 * gating on nothing. But a surface that must **fail closed** needs to distinguish "no provider" from
 * "free plan" so it can treat both as unentitled rather than crashing, and a thrown error on Main
 * Home would take down the app first screen over a subscription lookup.
 *
 * Read it through `useOptionalModuleAccess`, which applies the closed default in one place, rather
 * than each caller inventing its own.
 */
export function useOptionalEntitlement(): EntitlementState | null {
  return useContext(StateContext);
}

export function useEntitlementActions(): EntitlementActions {
  const value = useContext(ActionsContext);
  if (value === null) {
    throw new Error('useEntitlementActions must be used inside an EntitlementProvider.');
  }
  return value;
}
