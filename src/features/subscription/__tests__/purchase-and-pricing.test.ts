import { PLAN_CAPABILITIES } from '../domain/entitlement';
import {
  fallbackPrice,
  formatRenewalDate,
  storePrice,
  yearlyPerMonth,
  yearlySavingPercent,
} from '../domain/pricing';
import { PLAN_OFFERS, PRODUCT_IDS, findOffer, findOfferByProductId } from '../domain/products';
import { MockPurchaseAdapter } from '../services/mock-purchase-adapter';
import { createEntitlementService } from '../services/entitlement-service';

/**
 * Product mapping, price fallbacks, and every purchase and restore outcome.
 */

describe('product identifiers', () => {
  it('map each plan and period to exactly one product', () => {
    expect(findOffer('premium_single', 'monthly')?.productId).toBe(PRODUCT_IDS.singleMonthly);
    expect(findOffer('premium_single', 'yearly')?.productId).toBe(PRODUCT_IDS.singleYearly);
    expect(findOffer('premium_family', 'monthly')?.productId).toBe(PRODUCT_IDS.familyMonthly);
    expect(findOffer('premium_family', 'yearly')?.productId).toBe(PRODUCT_IDS.familyYearly);
  });

  it('use the exact identifiers the store will be configured with', () => {
    expect(Object.values(PRODUCT_IDS).sort()).toEqual([
      'noorlife_family_monthly',
      'noorlife_family_yearly',
      'noorlife_single_monthly',
      'noorlife_single_yearly',
    ]);
  });

  it('do not sell the free plan', () => {
    expect(findOffer('free', 'monthly')).toBeUndefined();
    expect(findOffer('free', 'none')).toBeUndefined();
    // The offer type itself excludes `free`, so there are exactly four purchasable offers.
    expect(PLAN_OFFERS).toHaveLength(4);
  });

  it('offer the trial on yearly only', () => {
    for (const offer of PLAN_OFFERS) {
      expect(offer.trialEligibleByDesign).toBe(offer.billingPeriod === 'yearly');
    }
  });

  it('resolve back from a product id', () => {
    expect(findOfferByProductId('noorlife_family_yearly')?.plan).toBe('premium_family');
    expect(findOfferByProductId('not_a_product')).toBeUndefined();
  });
});

describe('price fallbacks', () => {
  it('carry the approved AED figures and are marked as fallbacks', () => {
    expect(fallbackPrice(PRODUCT_IDS.singleMonthly).formatted).toBe('AED 19.99');
    expect(fallbackPrice(PRODUCT_IDS.singleYearly).formatted).toBe('AED 189.99');
    expect(fallbackPrice(PRODUCT_IDS.familyMonthly).formatted).toBe('AED 39.99');
    expect(fallbackPrice(PRODUCT_IDS.familyYearly).formatted).toBe('AED 379.99');

    // The source is what tells the UI to label the figure approximate.
    expect(fallbackPrice(PRODUCT_IDS.singleYearly).source).toBe('fallback');
    expect(storePrice('₹1,499.00', 1499, 'INR').source).toBe('store');
  });

  it('compute the yearly saving rather than hardcoding 20%', () => {
    const monthly = fallbackPrice(PRODUCT_IDS.singleMonthly);
    const yearly = fallbackPrice(PRODUCT_IDS.singleYearly);
    // 19.99 * 12 = 239.88; 189.99 is ~20.8% less.
    expect(yearlySavingPercent(monthly, yearly)).toBe(21);
    expect(
      yearlySavingPercent(
        fallbackPrice(PRODUCT_IDS.familyMonthly),
        fallbackPrice(PRODUCT_IDS.familyYearly),
      ),
    ).toBe(21);
  });

  it('refuse to claim a saving that does not exist', () => {
    const monthly = storePrice('X 10.00', 10, 'X');
    // A yearly price above twelve months is not a discount.
    expect(yearlySavingPercent(monthly, storePrice('X 200.00', 200, 'X'))).toBeNull();
    // Mismatched currencies have no honest single percentage.
    expect(yearlySavingPercent(monthly, storePrice('Y 50.00', 50, 'Y'))).toBeNull();
  });

  it('restate a yearly price per month', () => {
    expect(yearlyPerMonth(fallbackPrice(PRODUCT_IDS.singleYearly)).formatted).toBe('AED 15.83');
  });

  it('format renewal dates and tolerate missing ones', () => {
    expect(formatRenewalDate('2026-08-12T09:00:00.000Z')).toBe('12 August 2026');
    expect(formatRenewalDate(null)).toBeNull();
    expect(formatRenewalDate('not-a-date')).toBeNull();
  });
});

describe('purchasing', () => {
  const service = (adapter: MockPurchaseAdapter) => createEntitlementService(adapter);

  it('grants the purchased plan and starts a trial when eligible', async () => {
    const adapter = new MockPurchaseAdapter({ trialEligible: true });
    const subject = service(adapter);

    const result = await subject.purchasePlan(PRODUCT_IDS.familyYearly);

    expect(result.outcome).toBe('purchased');
    expect(result.entitlement?.plan).toBe('premium_family');
    expect(result.entitlement?.status).toBe('trialing');
    expect(result.entitlement?.trialEnd).not.toBeNull();
    expect(result.entitlement?.capabilities).toEqual(PLAN_CAPABILITIES.premium_family);
    // A new family starts with the organizer in seat one of six.
    expect(await subject.getFamilySeatUsage()).toEqual({
      used: 1,
      limit: 6,
      pendingInvitations: 0,
    });
  });

  it('activates without a trial when the user is not eligible', async () => {
    const adapter = new MockPurchaseAdapter({ trialEligible: false });
    const result = await service(adapter).purchasePlan(PRODUCT_IDS.singleYearly);

    expect(result.entitlement?.status).toBe('active');
    // No fake eligibility state: there is no trial end to display.
    expect(result.entitlement?.trialEnd).toBeNull();
  });

  it('never puts a trial on a monthly purchase', async () => {
    const result = await service(new MockPurchaseAdapter()).purchasePlan(PRODUCT_IDS.singleMonthly);
    expect(result.entitlement?.status).toBe('active');
    expect(result.entitlement?.trialEnd).toBeNull();
  });

  it('treats cancellation as a non-error that changes nothing', async () => {
    const adapter = new MockPurchaseAdapter();
    const subject = service(adapter);
    adapter.setNextPurchaseOutcome('cancelled');

    const result = await subject.purchasePlan(PRODUCT_IDS.singleYearly);

    expect(result.outcome).toBe('cancelled');
    // The entitlement is untouched, and nothing threw.
    expect(result.entitlement).toBeUndefined();
    expect(subject.getCurrentEntitlement().plan).toBe('free');
  });

  it('reports pending, declined and already-owned without granting access', async () => {
    for (const outcome of ['pending', 'declined', 'already_owned', 'error'] as const) {
      const adapter = new MockPurchaseAdapter();
      const subject = service(adapter);
      adapter.setNextPurchaseOutcome(outcome);

      const result = await subject.purchasePlan(PRODUCT_IDS.familyMonthly);

      expect(result.outcome).toBe(outcome);
      expect(result.entitlement).toBeUndefined();
      expect(subject.getCurrentEntitlement().capabilities.premiumModules).toBe(false);
    }
  });

  it('detects a plan the user already has', async () => {
    const adapter = new MockPurchaseAdapter();
    const subject = service(adapter);
    await subject.purchasePlan(PRODUCT_IDS.singleMonthly);

    const again = await subject.purchasePlan(PRODUCT_IDS.singleMonthly);
    expect(again.outcome).toBe('already_owned');
  });

  it('reports offline and store-unavailable rather than failing obscurely', async () => {
    const offline = new MockPurchaseAdapter({ online: false });
    expect((await offline.purchase(PRODUCT_IDS.singleYearly)).outcome).toBe('offline');

    const down = new MockPurchaseAdapter({ storeAvailable: false });
    expect((await down.purchase(PRODUCT_IDS.singleYearly)).outcome).toBe('store_unavailable');
  });
});

describe('restoring', () => {
  it('restores a previous entitlement', async () => {
    const restorable = {
      ...({ plan: 'premium_single', billingPeriod: 'yearly', status: 'active' } as const),
      provider: 'development_mock' as const,
      currentPeriodEnd: '2027-01-01T00:00:00.000Z',
      trialEnd: null,
      cancelAtPeriodEnd: false,
      isFamilyOrganizer: false,
      capabilities: PLAN_CAPABILITIES.premium_single,
    };
    const adapter = new MockPurchaseAdapter({ restorableEntitlement: restorable });
    const subject = createEntitlementService(adapter);

    const result = await subject.restorePurchases();

    expect(result.outcome).toBe('restored');
    expect(subject.getCurrentEntitlement().plan).toBe('premium_single');
    expect(subject.canAccessModule('finance')).toBe(true);
  });

  it('reports nothing to restore without treating it as an error', async () => {
    const result = await createEntitlementService(new MockPurchaseAdapter()).restorePurchases();
    expect(result.outcome).toBe('nothing_to_restore');
  });

  it('reports offline and store-unavailable separately', async () => {
    expect((await new MockPurchaseAdapter({ online: false }).restore()).outcome).toBe('offline');
    expect((await new MockPurchaseAdapter({ storeAvailable: false }).restore()).outcome).toBe(
      'store_unavailable',
    );
  });
});

describe('the mock adapter', () => {
  it('declares that it cannot transact', () => {
    // This is the structural guarantee behind "do not activate live billing without stores".
    const adapter = new MockPurchaseAdapter();
    expect(adapter.canTransact).toBe(false);
    expect(createEntitlementService(adapter).isMockMode).toBe(true);
  });

  it('reports a mock provider, never Apple or Google', async () => {
    const subject = createEntitlementService(new MockPurchaseAdapter());
    const result = await subject.purchasePlan(PRODUCT_IDS.singleYearly);
    expect(result.entitlement?.provider).toBe('development_mock');
  });

  it('offers no store management surface', async () => {
    expect(await new MockPurchaseAdapter().openManagement()).toBe(false);
  });

  it('prices every offer with a labelled fallback', async () => {
    const offers = await new MockPurchaseAdapter().getOffers();
    expect(offers).toHaveLength(4);
    expect(offers.every((offer) => offer.price.source === 'fallback')).toBe(true);
  });
});
