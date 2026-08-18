import { useCallback, useEffect, useMemo, useState } from 'react';

import { yearlySavingPercent, type LocalizedPrice } from './domain/pricing';
import type { SubscriptionPlan } from './domain/subscription';
import type { PricedOffer } from './services/purchase-adapter';
import { useEntitlementActions } from './services/entitlement-context';

/**
 * Loads the purchasable offers and derives everything the plan screens need from them.
 *
 * One hook rather than each screen fetching and computing its own, so a savings percentage or a
 * price cannot differ between the welcome screen and the plan detail screen.
 */
export type PlanOffersState = {
  readonly offers: readonly PricedOffer[];
  readonly isLoading: boolean;
  /** Non-null when offers could not be loaded at all. */
  readonly error: string | null;
  /** The offer for a plan at a period, or undefined if not sold. */
  readonly offerFor: (
    plan: SubscriptionPlan,
    period: 'monthly' | 'yearly',
  ) => PricedOffer | undefined;
  /**
   * Yearly saving for a plan, computed from its own two prices.
   *
   * Never a hardcoded 20%: if a store returns prices where yearly is not actually cheaper, this
   * returns null and the badge disappears rather than claiming a discount that is not there.
   */
  readonly savingPercentFor: (plan: SubscriptionPlan) => number | null;
  /** The largest honest saving across plans, for the shared billing toggle's badge. */
  readonly headlineSavingPercent: number | null;
  readonly reload: () => Promise<void>;
};

export function usePlanOffers(): PlanOffersState {
  const [offers, setOffers] = useState<readonly PricedOffer[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Read through the context's service rather than constructing an adapter here: a screen-level
  // hook that built its own adapter would report prices from a different source than the one the
  // purchase goes through.
  const actions = useEntitlementActions();

  /**
   * Applies a settled load. Shared by the mount effect and the manual retry.
   *
   * The message stays generic: a raw store error is not something to show a user.
   */
  const apply = useCallback((result: readonly PricedOffer[] | 'failed'): void => {
    if (result === 'failed') {
      setError('We could not load plans right now.');
    } else {
      setOffers(result);
      setError(null);
    }
    setIsLoading(false);
  }, []);

  /**
   * Loads on mount, and whenever the entitlement service changes identity.
   *
   * ── Why nothing is set synchronously here ───────────────────────────────────
   * `isLoading` is initialised to `true` rather than being set at the top of this effect. Calling
   * setState synchronously in an effect body triggers a cascading render, which the project's
   * react-hooks rules reject outright — and it is unnecessary, since the initial value already
   * describes the state the hook starts in. Every update below lands in a promise callback, which
   * is the "subscribe to an external system" shape the rule permits.
   */
  useEffect(() => {
    let cancelled = false;
    actions.getAvailablePlans().then(
      (loaded) => {
        if (!cancelled) {
          apply(loaded);
        }
      },
      () => {
        if (!cancelled) {
          apply('failed');
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [actions, apply]);

  /** Manual retry. A user-initiated event, so setting the loading flag here is fine. */
  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      apply(await actions.getAvailablePlans());
    } catch {
      apply('failed');
    }
  }, [actions, apply]);

  const offerFor = useCallback(
    (plan: SubscriptionPlan, period: 'monthly' | 'yearly') =>
      offers.find((offer) => offer.plan === plan && offer.billingPeriod === period),
    [offers],
  );

  const savingPercentFor = useCallback(
    (plan: SubscriptionPlan): number | null => {
      const monthly = offerFor(plan, 'monthly');
      const yearly = offerFor(plan, 'yearly');
      if (monthly === undefined || yearly === undefined) {
        return null;
      }
      return yearlySavingPercent(monthly.price, yearly.price);
    },
    [offerFor],
  );

  const headlineSavingPercent = useMemo(() => {
    const values = (['premium_single', 'premium_family'] as const)
      .map(savingPercentFor)
      .filter((value): value is number => value !== null);
    return values.length === 0 ? null : Math.max(...values);
  }, [savingPercentFor]);

  return {
    offers,
    isLoading,
    error,
    offerFor,
    savingPercentFor,
    headlineSavingPercent,
    reload: load,
  };
}

/** Convenience: a price or undefined, for screens that only need the figure. */
export function priceOf(offer: PricedOffer | undefined): LocalizedPrice | undefined {
  return offer?.price;
}
