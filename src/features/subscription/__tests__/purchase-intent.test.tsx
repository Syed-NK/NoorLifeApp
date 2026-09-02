import { render, screen, waitFor } from '@testing-library/react-native';

import { PRODUCT_IDS } from '../domain/products';
import { EntitlementProvider } from '../services/entitlement-context';
import { MockPurchaseAdapter } from '../services/mock-purchase-adapter';
import {
  clearPendingIntent,
  consumePendingIntent,
  createPendingIntent,
  hasPendingIntent,
} from '../services/purchase-intent';
import { PurchaseProcessingScreen } from '../screens/purchase-flow-screens';
import { subscriptionRoutes } from '../subscription-routes';

/**
 * Deep-link purchase protection.
 *
 * The regression these lock down was real and shipped in Phase 5: the processing screen started a
 * purchase because it mounted, so `noorlifeapp://subscription/processing?plan=premium_family` bought
 * a plan with no confirmation anywhere. It was found while capturing screenshots — the sweep bought
 * Premium Family and unlocked every paid module as a side effect.
 */

beforeEach(() => {
  clearPendingIntent();
});

describe('the intent store', () => {
  it('starts empty', () => {
    expect(hasPendingIntent()).toBe(false);
    expect(consumePendingIntent('anything')).toBeNull();
  });

  it('yields an intent exactly once', () => {
    const intent = createPendingIntent(PRODUCT_IDS.singleYearly, 'premium_single', 'yearly');

    expect(consumePendingIntent(intent.nonce)).toEqual(intent);
    // Spent. A second processing screen cannot reuse it.
    expect(consumePendingIntent(intent.nonce)).toBeNull();
    expect(hasPendingIntent()).toBe(false);
  });

  it('rejects a nonce that does not match', () => {
    createPendingIntent(PRODUCT_IDS.familyMonthly, 'premium_family', 'monthly');

    expect(consumePendingIntent('forged-nonce')).toBeNull();
    // The real intent survives a failed guess rather than being burned by it.
    expect(hasPendingIntent()).toBe(true);
  });

  it('rejects a missing nonce', () => {
    createPendingIntent(PRODUCT_IDS.familyMonthly, 'premium_family', 'monthly');

    expect(consumePendingIntent(undefined)).toBeNull();
  });

  it('replaces an earlier intent rather than queueing one', () => {
    const first = createPendingIntent(PRODUCT_IDS.singleMonthly, 'premium_single', 'monthly');
    const second = createPendingIntent(PRODUCT_IDS.familyYearly, 'premium_family', 'yearly');

    // A user who backs out and reconfirms a different plan leaves no stale authorisation.
    expect(consumePendingIntent(first.nonce)).toBeNull();
    expect(consumePendingIntent(second.nonce)).toEqual(second);
  });

  it('mints unique nonces', () => {
    const nonces = new Set(
      Array.from(
        { length: 50 },
        () => createPendingIntent(PRODUCT_IDS.singleYearly, 'premium_single', 'yearly').nonce,
      ),
    );

    expect(nonces.size).toBe(50);
  });

  it('is cleared explicitly on cancel', () => {
    createPendingIntent(PRODUCT_IDS.singleYearly, 'premium_single', 'yearly');
    clearPendingIntent();

    expect(hasPendingIntent()).toBe(false);
  });
});

describe('the route helper', () => {
  it('omits the intent parameter when no nonce is supplied', () => {
    expect(subscriptionRoutes.processing('premium_single', 'yearly')).toBe(
      '/subscription/processing?plan=premium_single&period=yearly',
    );
  });

  it('carries the nonce when one is supplied', () => {
    expect(subscriptionRoutes.processing('premium_family', 'monthly', 'abc123')).toBe(
      '/subscription/processing?plan=premium_family&period=monthly&intent=abc123',
    );
  });
});

describe('the processing screen', () => {
  function renderProcessing(adapter: MockPurchaseAdapter, nonce?: string) {
    return render(
      <EntitlementProvider adapter={adapter}>
        <PurchaseProcessingScreen plan="premium_family" period="yearly" intentNonce={nonce} />
      </EntitlementProvider>,
    );
  }

  it('grants nothing on a direct deep link with no intent', async () => {
    const adapter = new MockPurchaseAdapter();
    const spy = jest.spyOn(adapter, 'purchase');

    await renderProcessing(adapter);
    await waitFor(() => expect(screen.queryByTestId('purchase-processing')).toBeNull());

    // The screen redirected instead of rendering, and no purchase was attempted at all.
    expect(spy).not.toHaveBeenCalled();
    expect((await adapter.getEntitlement()).plan).toBe('free');
  });

  it('grants nothing when the nonce is forged', async () => {
    const adapter = new MockPurchaseAdapter();
    const spy = jest.spyOn(adapter, 'purchase');
    createPendingIntent(PRODUCT_IDS.familyYearly, 'premium_family', 'yearly');

    await renderProcessing(adapter, 'not-the-real-nonce');
    await waitFor(() => expect(spy).not.toHaveBeenCalled());

    expect((await adapter.getEntitlement()).plan).toBe('free');
  });

  it('purchases once when the intent is valid', async () => {
    const adapter = new MockPurchaseAdapter();
    const spy = jest.spyOn(adapter, 'purchase');
    const intent = createPendingIntent(PRODUCT_IDS.familyYearly, 'premium_family', 'yearly');

    await renderProcessing(adapter, intent.nonce);

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(spy).toHaveBeenCalledWith(PRODUCT_IDS.familyYearly);
  });

  it('cannot be replayed after a completed purchase', async () => {
    const adapter = new MockPurchaseAdapter();
    const intent = createPendingIntent(PRODUCT_IDS.familyYearly, 'premium_family', 'yearly');

    const first = await renderProcessing(adapter, intent.nonce);
    await waitFor(() => expect(hasPendingIntent()).toBe(false));
    await first.unmount();

    // Reopening the same URL: the intent is spent, so the screen redirects and buys nothing more.
    const spy = jest.spyOn(adapter, 'purchase');
    await renderProcessing(adapter, intent.nonce);
    await waitFor(() => expect(screen.queryByTestId('purchase-processing')).toBeNull());

    expect(spy).not.toHaveBeenCalled();
  });

  it('buys the product from the intent, not the one named in the route', async () => {
    const adapter = new MockPurchaseAdapter();
    const spy = jest.spyOn(adapter, 'purchase');
    // Authorised for Single monthly, but the route claims Family yearly.
    const intent = createPendingIntent(PRODUCT_IDS.singleMonthly, 'premium_single', 'monthly');

    await renderProcessing(adapter, intent.nonce);

    await waitFor(() => expect(spy).toHaveBeenCalledWith(PRODUCT_IDS.singleMonthly));
  });
});
