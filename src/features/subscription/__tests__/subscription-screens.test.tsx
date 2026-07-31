import { render, screen, userEvent, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';

import { PLAN_CAPABILITIES, type Entitlement } from '../domain/entitlement';
import { PRODUCT_IDS } from '../domain/products';
import { LockedModuleSheet } from '../components/locked-module-sheet';
import { ModuleEntitlementGate } from '../components/module-entitlement-gate';
import { PlanComparisonTable } from '../components/plan-comparison-table';
import { EntitlementProvider } from '../services/entitlement-context';
import { MockPurchaseAdapter } from '../services/mock-purchase-adapter';
import { SubscriptionWelcomeScreen } from '../screens/subscription-welcome-screen';
import { SubscriptionExpiredScreen } from '../screens/subscription-problem-screens';
import { mockRouter } from '../../../../jest.setup';

/**
 * The rendered behaviour: the gate, the paywall sheet, and the routes out of a paywall.
 *
 * ── Every test settles before it returns ────────────────────────────────────
 * These screens resolve in two stages: `EntitlementProvider` loads the entitlement in a mount
 * effect, and that unblocks `usePlanOffers`, which then loads the offers. A test that asserts
 * synchronously and returns leaves a `setState` to fire outside any act scope, which corrupts
 * React's act environment for **every later test in the file** — the symptom being several
 * unrelated tests suddenly unable to find any element at all.
 *
 * So each test's first assertion is a `waitFor` or `findBy*`, which retries inside act until the
 * screen has settled. That is the same discipline the existing `signup-routing` tests use against
 * `AuthProvider`, which resolves the same way.
 */

function premiumEntitlement(
  plan: 'premium_single' | 'premium_family',
  status: Entitlement['status'] = 'active',
): Entitlement {
  return {
    plan,
    billingPeriod: 'yearly',
    status,
    provider: 'development_mock',
    currentPeriodEnd: '2027-01-01T00:00:00.000Z',
    trialEnd: null,
    cancelAtPeriodEnd: false,
    isFamilyOrganizer: plan === 'premium_family',
    capabilities: PLAN_CAPABILITIES[plan],
  };
}

/** A fresh adapter per render: the mock is stateful, so a shared one leaks between tests. */
async function renderWith(entitlement: Entitlement | undefined, node: React.ReactNode) {
  const adapter = new MockPurchaseAdapter(
    entitlement === undefined ? {} : { initialEntitlement: entitlement },
  );
  return render(<EntitlementProvider adapter={adapter}>{node}</EntitlementProvider>);
}

describe('the module entitlement gate', () => {
  it('renders Faith for a free user, with no paywall', async () => {
    await renderWith(
      undefined,
      <ModuleEntitlementGate moduleId="faith">
        <Text>Faith content</Text>
      </ModuleEntitlementGate>,
    );

    await waitFor(() => expect(screen.getByText('Faith content')).toBeTruthy());
    expect(screen.queryByTestId('module-locked-faith')).toBeNull();
  });

  it('renders Noor AI for a free user', async () => {
    await renderWith(
      undefined,
      <ModuleEntitlementGate moduleId="noor-ai">
        <Text>Noor AI content</Text>
      </ModuleEntitlementGate>,
    );

    await waitFor(() => expect(screen.getByText('Noor AI content')).toBeTruthy());
  });

  it('blocks a paid module for a free user and shows the sheet instead of the content', async () => {
    await renderWith(
      undefined,
      <ModuleEntitlementGate moduleId="finance">
        <Text>Finance content</Text>
      </ModuleEntitlementGate>,
    );

    await waitFor(() => expect(screen.getByTestId('module-locked-finance')).toBeTruthy());
    // The module's content is not rendered behind the sheet.
    expect(screen.queryByText('Finance content')).toBeNull();
  });

  it('lets a Premium Single subscriber through', async () => {
    await renderWith(
      premiumEntitlement('premium_single'),
      <ModuleEntitlementGate moduleId="health">
        <Text>Health content</Text>
      </ModuleEntitlementGate>,
    );

    await waitFor(() => expect(screen.getByText('Health content')).toBeTruthy());
  });

  it('lets a Premium Family member through', async () => {
    await renderWith(
      { ...premiumEntitlement('premium_family'), isFamilyOrganizer: false },
      <ModuleEntitlementGate moduleId="goals">
        <Text>Goals content</Text>
      </ModuleEntitlementGate>,
    );

    await waitFor(() => expect(screen.getByText('Goals content')).toBeTruthy());
  });

  it('blocks a paid module once the subscription has expired', async () => {
    await renderWith(
      premiumEntitlement('premium_family', 'expired'),
      <ModuleEntitlementGate moduleId="planner">
        <Text>Planner content</Text>
      </ModuleEntitlementGate>,
    );

    await waitFor(() => expect(screen.getByTestId('module-locked-planner')).toBeTruthy());
    expect(screen.queryByText('Planner content')).toBeNull();
  });

  it('keeps Faith open after expiry', async () => {
    await renderWith(
      premiumEntitlement('premium_family', 'expired'),
      <ModuleEntitlementGate moduleId="faith">
        <Text>Faith still works</Text>
      </ModuleEntitlementGate>,
    );

    await waitFor(() => expect(screen.getByText('Faith still works')).toBeTruthy());
  });

  it('keeps a paid module open during a grace period', async () => {
    await renderWith(
      premiumEntitlement('premium_single', 'grace_period'),
      <ModuleEntitlementGate moduleId="learning">
        <Text>Learning content</Text>
      </ModuleEntitlementGate>,
    );

    // Payment is retrying; both stores expect access to continue during that window.
    await waitFor(() => expect(screen.getByText('Learning content')).toBeTruthy());
  });

  it('blocks a paid module on account hold', async () => {
    await renderWith(
      premiumEntitlement('premium_single', 'account_hold'),
      <ModuleEntitlementGate moduleId="finance">
        <Text>Finance content</Text>
      </ModuleEntitlementGate>,
    );

    await waitFor(() => expect(screen.getByTestId('module-locked-finance')).toBeTruthy());
  });
});

describe('the locked module sheet', () => {
  it('renders nothing at all for Faith, whatever the caller asks', async () => {
    // Belt and braces: even a mistaken call cannot produce a Faith paywall.
    await render(
      <LockedModuleSheet
        visible
        moduleId="faith"
        moduleName="Faith"
        onViewPlans={() => undefined}
        onNotNow={() => undefined}
        testID="faith-sheet"
      />,
    );

    await waitFor(() => expect(screen.queryByTestId('faith-sheet-panel')).toBeNull());
  });

  it('offers View plans, Not now and Continue to Faith for a paid module', async () => {
    const onViewPlans = jest.fn();
    const onNotNow = jest.fn();
    const onFaith = jest.fn();

    await render(
      <LockedModuleSheet
        visible
        moduleId="health"
        moduleName="Health"
        onViewPlans={onViewPlans}
        onNotNow={onNotNow}
        onContinueToFaith={onFaith}
        testID="health-sheet"
      />,
    );

    await waitFor(() => expect(screen.getByTestId('health-sheet-pictogram')).toBeTruthy());

    const user = userEvent.setup();
    await user.press(screen.getByTestId('health-sheet-not-now'));
    expect(onNotNow).toHaveBeenCalledTimes(1);

    await user.press(screen.getByTestId('health-sheet-view-plans'));
    expect(onViewPlans).toHaveBeenCalledTimes(1);

    await user.press(screen.getByTestId('health-sheet-faith'));
    expect(onFaith).toHaveBeenCalledTimes(1);
  });
});

describe('Subscription Welcome', () => {
  it('preselects no paid plan, so Free is never the option you decline', async () => {
    await renderWith(undefined, <SubscriptionWelcomeScreen />);

    await waitFor(() => expect(screen.getByTestId('plan-single')).toBeTruthy());
    // Nothing is marked selected until the user chooses.
    expect(screen.queryByTestId('plan-single-selected')).toBeNull();
    expect(screen.queryByTestId('plan-family-selected')).toBeNull();
  });

  it('always offers Continue with Free, and it leaves the flow', async () => {
    await renderWith(undefined, <SubscriptionWelcomeScreen />);

    await waitFor(() => expect(screen.getByTestId('subscription-welcome-free')).toBeTruthy());
    const user = userEvent.setup();
    await user.press(screen.getByTestId('subscription-welcome-free'));

    // Replace, not push: Back from Main Home must not return to a declined paywall.
    expect(mockRouter.replace).toHaveBeenCalledWith('/home');
  });

  it('shows Restore Purchases and the legal links', async () => {
    await renderWith(undefined, <SubscriptionWelcomeScreen />);

    await waitFor(() => expect(screen.getByTestId('subscription-welcome-restore')).toBeTruthy());
    expect(screen.getByTestId('subscription-welcome-legal-terms')).toBeTruthy();
    expect(screen.getByTestId('subscription-welcome-legal-privacy')).toBeTruthy();
  });

  it('labels the build as a development mock, since it cannot take money', async () => {
    await renderWith(undefined, <SubscriptionWelcomeScreen />);

    await waitFor(() => expect(screen.getByTestId('subscription-welcome-mock-badge')).toBeTruthy());
  });

  it('marks fallback prices as approximate', async () => {
    await renderWith(undefined, <SubscriptionWelcomeScreen />);

    // The store has not answered, so the AED figure must not be presented as the user's price.
    await waitFor(() => expect(screen.getByTestId('plan-single-price-approximate')).toBeTruthy());
  });

  it('selects a plan and routes to its details', async () => {
    await renderWith(undefined, <SubscriptionWelcomeScreen />);

    await waitFor(() => expect(screen.getByTestId('plan-family')).toBeTruthy());
    const user = userEvent.setup();
    await user.press(screen.getByTestId('plan-family'));
    expect(screen.getByTestId('plan-family-selected')).toBeTruthy();

    await user.press(screen.getByTestId('subscription-welcome-continue'));
    expect(mockRouter.push).toHaveBeenCalledWith('/subscription/family?period=yearly');
  });
});

describe('the comparison table', () => {
  it('marks Faith as always included', async () => {
    await render(<PlanComparisonTable testID="table" />);

    await waitFor(() => expect(screen.getByTestId('table-faith-always-included')).toBeTruthy());
  });

  it('shows one account on Free and Single, and six on Family', async () => {
    await render(<PlanComparisonTable testID="table" />);

    const row = await screen.findByTestId('table-family-accounts');
    // The row announces the whole comparison, which is where the six is stated.
    expect(row.props.accessibilityLabel).toContain('6 on Premium Family');
    expect(row.props.accessibilityLabel).toContain('1 on Free');
  });
});

describe('Subscription Expired', () => {
  it('says Faith is free, premium is locked, and nothing was deleted', async () => {
    await renderWith(
      premiumEntitlement('premium_single', 'expired'),
      <SubscriptionExpiredScreen />,
    );

    await waitFor(() => expect(screen.getByTestId('expired-faith-banner')).toBeTruthy());
    expect(screen.getByTestId('expired-locked')).toBeTruthy();
    expect(screen.getByTestId('expired-data')).toBeTruthy();
  });

  it('offers Continue to Faith as well as Renew', async () => {
    await renderWith(
      premiumEntitlement('premium_single', 'expired'),
      <SubscriptionExpiredScreen />,
    );

    await waitFor(() => expect(screen.getByTestId('expired-faith')).toBeTruthy());
    const user = userEvent.setup();
    await user.press(screen.getByTestId('expired-faith'));

    expect(mockRouter.replace).toHaveBeenCalledWith('/faith');
  });
});

describe('purchase never happens without a store', () => {
  it('reports the mock provider after a simulated purchase', async () => {
    const adapter = new MockPurchaseAdapter();
    const result = await adapter.purchase(PRODUCT_IDS.familyYearly);

    expect(result.entitlement?.provider).toBe('development_mock');
  });
});
