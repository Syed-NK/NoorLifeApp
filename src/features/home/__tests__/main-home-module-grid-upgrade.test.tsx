import { render, screen, userEvent } from '@testing-library/react-native';
import { useEffect } from 'react';
import { Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider } from '@application/providers/auth-provider';
import { DesignSystemProvider } from '@application/providers/design-system-provider';
import { FontProvider } from '@application/providers/font-provider';
import { LocalizationProvider } from '@application/providers/localization-provider';
import { PLAN_CAPABILITIES, type Entitlement } from '@features/subscription/domain/entitlement';
import { EntitlementProvider } from '@features/subscription/services/entitlement-context';
import { MockPurchaseAdapter } from '@features/subscription/services/mock-purchase-adapter';
import type { PurchaseAdapter } from '@features/subscription/services/purchase-adapter';
import {
  UpgradeSheetProvider,
  useUpgradeSheet,
  type UpgradeRequest,
} from '@features/subscription/services/upgrade-sheet-context';
import { lockedModuleCopy } from '@features/subscription/subscription-copy';
import { subscriptionRoutes } from '@features/subscription/subscription-routes';
import { installMockLatencyTimers } from '@/test-support/mock-latency-timers';

import { ModuleGrid } from '../components/module-grid';
import { UPGRADE_SOURCES } from '../home-premium-surfaces';
import { MainHomeMetricsProvider } from '../main-home-metrics-context';
import { MainHomeScreen } from '../screens/main-home-screen';
import { mockRouter } from '../../../../jest.setup';

/**
 * The module grid's locked taps, and the sheet they raise.
 *
 * ── The defect this suite exists to hold shut ───────────────────────────────
 * A release build on a Pixel 8 with a real free account: tapping Health jumped straight to the plan
 * chooser. Every other locked surface on Main Home had been converted to the shared contextual sheet;
 * the grid — the first thing a user taps, and the only one that had a locked state before the sheet
 * existed — was still calling `router.push(subscriptionRoutes.welcome)` directly. So the six tiles
 * most likely to be tapped were the six that skipped the explanation.
 *
 * The tests below therefore assert the *absence* of that route as hard as they assert the presence of
 * the sheet: a tile that opens the sheet and also pushes the chooser would be just as wrong.
 */

// Two costs this removes: the 450 ms the mock dashboard sleeps on every mount, and the one-off
// compile cost of the first mount, which is warmed up in `beforeAll` so no test is charged for it.
installMockLatencyTimers(() => free());

function entitlement(plan: Entitlement['plan']): Entitlement {
  return {
    plan,
    billingPeriod: plan === 'free' ? 'none' : 'yearly',
    status: plan === 'free' ? 'free' : 'active',
    provider: 'development_mock',
    currentPeriodEnd: plan === 'free' ? null : '2027-03-01T00:00:00.000Z',
    trialEnd: null,
    cancelAtPeriodEnd: false,
    isFamilyOrganizer: plan === 'premium_family',
    capabilities: PLAN_CAPABILITIES[plan],
  };
}

/** An adapter whose entitlement never arrives, so the provider stays `unknown` throughout. */
const neverResolves: PurchaseAdapter = {
  id: 'mock',
  canTransact: false,
  getOffers: () => new Promise(() => {}),
  getEntitlement: () => new Promise(() => {}),
  purchase: () => new Promise(() => {}),
  restore: () => new Promise(() => {}),
  openManagement: () => new Promise(() => {}),
};

function Providers({
  adapter,
  children,
}: {
  readonly adapter: PurchaseAdapter;
  readonly children: React.ReactNode;
}) {
  return (
    <SafeAreaProvider>
      <DesignSystemProvider>
        <LocalizationProvider>
          <FontProvider>
            <AuthProvider>
              <EntitlementProvider adapter={adapter}>{children}</EntitlementProvider>
            </AuthProvider>
          </FontProvider>
        </LocalizationProvider>
      </DesignSystemProvider>
    </SafeAreaProvider>
  );
}

async function renderMainHome(adapter: PurchaseAdapter) {
  const view = await render(
    <Providers adapter={adapter}>
      <MainHomeScreen />
    </Providers>,
  );
  await screen.findByTestId('main-home-hero');
  return view;
}

const onPlan = (plan: Entitlement['plan']) =>
  renderMainHome(new MockPurchaseAdapter({ initialEntitlement: entitlement(plan) }));

const free = () => onPlan('free');
const paid = () => onPlan('premium_family');
const unresolved = () => renderMainHome(neverResolves);

// ── The payload probe ───────────────────────────────────────────────────────

const probe: { request: UpgradeRequest | null } = { request: null };

function RequestProbe() {
  const { request } = useUpgradeSheet();
  // Captured after commit, not during render: writing to module scope while rendering is what the
  // react-hooks rules object to.
  useEffect(() => {
    probe.request = request;
  }, [request]);
  return <Text>probe</Text>;
}

/** The grid on a real controller, with the probe reading exactly what a tile sends. */
async function renderGrid(adapter: PurchaseAdapter) {
  probe.request = null;
  const view = await render(
    <Providers adapter={adapter}>
      <MainHomeMetricsProvider>
        <UpgradeSheetProvider>
          <ModuleGrid onSelectModule={() => undefined} testID="grid" />
          <RequestProbe />
        </UpgradeSheetProvider>
      </MainHomeMetricsProvider>
    </Providers>,
  );
  await screen.findByText('probe');
  return view;
}

const freeAdapter = () => new MockPurchaseAdapter({ initialEntitlement: entitlement('free') });

/** The six paid modules, with the tile's route and the copy its sheet must carry. */
const PAID_MODULES = [
  { id: 'health', name: 'Health', route: '/health' },
  { id: 'planner', name: 'Planner', route: '/planner' },
  { id: 'finance', name: 'Finance', route: '/finance' },
  { id: 'learning', name: 'Learning', route: '/learning' },
  { id: 'family', name: 'Family', route: '/family' },
  { id: 'goals', name: 'Goals', route: '/goals' },
] as const;

const PAID_ROUTES = PAID_MODULES.map((module) => module.route);

const sheetBodyFor = (featureTitle: string, moduleName: string) =>
  lockedModuleCopy.body({ featureTitle, moduleName });

// ── Free ────────────────────────────────────────────────────────────────────

describe('a locked module tile on a free plan', () => {
  it.each(PAID_MODULES)('opens the shared contextual sheet for $name', async ({ id, name }) => {
    const user = userEvent.setup();
    await free();

    await user.press(screen.getByTestId(`module-card-${id}-locked`));

    // The one sheet, mounted by the screen — not a second one, and not the chooser.
    expect(screen.getByTestId('main-home-upgrade-sheet')).toBeTruthy();
    expect(screen.getByText(sheetBodyFor(name, name))).toBeTruthy();
  });

  it.each(PAID_MODULES)('does not reach the subscription chooser from $name', async ({ id }) => {
    const user = userEvent.setup();
    await free();

    await user.press(screen.getByTestId(`module-card-${id}-locked`));

    // The exact regression. Before this correction the tap *was* this push.
    expect(mockRouter.push).not.toHaveBeenCalledWith(subscriptionRoutes.welcome);
    expect(mockRouter.push).not.toHaveBeenCalled();
  });

  it.each(PAID_MODULES)('does not enter $name first either', async ({ id, route }) => {
    const user = userEvent.setup();
    await free();

    await user.press(screen.getByTestId(`module-card-${id}-locked`));

    expect(mockRouter.push).not.toHaveBeenCalledWith(route);
    for (const other of PAID_ROUTES) {
      expect(mockRouter.push).not.toHaveBeenCalledWith(other);
    }
  });

  it.each(PAID_MODULES)(
    'sends $name as both feature and module, from the grid',
    async ({ id, name }) => {
      const user = userEvent.setup();
      await renderGrid(freeAdapter());

      await user.press(screen.getByTestId(`module-card-${id}-locked`));

      // A tile *is* the module, so the feature and the module are the same name — which is what
      // makes the sheet say "included with" rather than "available with".
      expect(probe.request).toEqual({
        featureTitle: name,
        moduleId: id,
        moduleName: name,
        source: UPGRADE_SOURCES.moduleGrid,
      });
      expect(probe.request?.source).toBe('module_grid');
    },
  );

  it('reaches the chooser only after View Premium Plans is pressed', async () => {
    const user = userEvent.setup();
    await free();

    await user.press(screen.getByTestId('module-card-health-locked'));
    expect(mockRouter.push).not.toHaveBeenCalled();

    await user.press(screen.getByTestId('main-home-upgrade-sheet-view-plans'));
    expect(mockRouter.push).toHaveBeenCalledWith(subscriptionRoutes.welcome);
    expect(mockRouter.push).toHaveBeenCalledTimes(1);
  });

  it('opens Faith directly, with no sheet and no chooser', async () => {
    const user = userEvent.setup();
    await free();

    await user.press(screen.getByTestId('module-card-faith'));

    expect(mockRouter.push).toHaveBeenCalledWith('/faith');
    expect(screen.queryByTestId('main-home-upgrade-sheet')).toBeNull();
    expect(mockRouter.push).not.toHaveBeenCalledWith(subscriptionRoutes.welcome);
  });

  it('opens Noor AI directly, because it is scope-limited rather than locked', async () => {
    const user = userEvent.setup();
    await free();

    await user.press(screen.getByTestId('module-card-noor-ai'));

    expect(mockRouter.push).toHaveBeenCalledWith('/ai');
    expect(screen.queryByTestId('main-home-upgrade-sheet')).toBeNull();
  });

  it('replaces the request on rapid taps rather than stacking sheets', async () => {
    const user = userEvent.setup();
    await free();

    await user.press(screen.getByTestId('module-card-health-locked'));
    await user.press(screen.getByTestId('module-card-health-locked'));
    await user.press(screen.getByTestId('module-card-goals-locked'));

    expect(screen.getAllByTestId('main-home-upgrade-sheet')).toHaveLength(1);
    expect(screen.getAllByTestId('main-home-upgrade-sheet-panel')).toHaveLength(1);
    expect(screen.getByText(sheetBodyFor('Goals', 'Goals'))).toBeTruthy();
    expect(screen.queryByText(sheetBodyFor('Health', 'Health'))).toBeNull();
  });

  it('dismisses without navigating anywhere', async () => {
    const user = userEvent.setup();
    await free();

    await user.press(screen.getByTestId('module-card-finance-locked'));
    await user.press(screen.getByTestId('main-home-upgrade-sheet-not-now'));

    expect(screen.queryByTestId('main-home-upgrade-sheet')).toBeNull();
    expect(mockRouter.push).not.toHaveBeenCalled();
  });

  it('announces every locked tile as a premium feature that explains itself', async () => {
    await free();

    for (const { name } of PAID_MODULES) {
      const tile = screen.getByLabelText(`${name}, Premium feature`);
      // The hint changed with the behaviour: it used to promise the plans, and now promises the
      // explanation the tap actually produces.
      expect(tile.props.accessibilityHint).toBe('Explains what NoorLife Premium includes');
    }
  });
});

// ── Unresolved ──────────────────────────────────────────────────────────────

describe('a module tile before the entitlement resolves', () => {
  it.each(PAID_MODULES)('defaults $name to the sheet rather than the module', async ({ id, name, route }) => {
    const user = userEvent.setup();
    await unresolved();

    await user.press(screen.getByTestId(`module-card-${id}-locked`));

    expect(screen.getByText(sheetBodyFor(name, name))).toBeTruthy();
    expect(mockRouter.push).not.toHaveBeenCalledWith(route);
    expect(mockRouter.push).not.toHaveBeenCalledWith(subscriptionRoutes.welcome);
  });

  it('still opens Faith', async () => {
    const user = userEvent.setup();
    await unresolved();

    await user.press(screen.getByTestId('module-card-faith'));
    expect(mockRouter.push).toHaveBeenCalledWith('/faith');
  });
});

// ── Paid ────────────────────────────────────────────────────────────────────

describe('a module tile on a paid plan', () => {
  it.each(PAID_MODULES)('opens $name directly, with no sheet', async ({ id, route }) => {
    const user = userEvent.setup();
    await paid();

    await user.press(screen.getByTestId(`module-card-${id}`));

    expect(mockRouter.push).toHaveBeenCalledWith(route);
    expect(screen.queryByTestId('main-home-upgrade-sheet')).toBeNull();
  });

  it('carries no lock badge or scrim anywhere in the grid', async () => {
    await paid();
    expect(screen.queryAllByTestId(/^module-lock-/)).toHaveLength(0);
    expect(screen.queryAllByTestId(/^module-scrim-/)).toHaveLength(0);
  });

  it('announces each tile by name alone', async () => {
    await paid();
    for (const { name } of PAID_MODULES) {
      expect(screen.getByLabelText(name)).toBeTruthy();
      expect(screen.queryByLabelText(`${name}, Premium feature`)).toBeNull();
    }
  });
});

// ── The grid itself ─────────────────────────────────────────────────────────

describe('the grid keeps its shape through all of this', () => {
  it.each([
    ['free', free],
    ['paid', paid],
  ])('renders eight tiles and eight approved pictograms on a %s plan', async (_, mount) => {
    await mount();
    expect(screen.getAllByTestId(/^module-pictogram-/)).toHaveLength(8);
  });

  it('scrims and badges exactly the six paid tiles on a free plan', async () => {
    await free();
    expect(screen.getAllByTestId(/^module-scrim-/)).toHaveLength(6);
    expect(screen.getAllByTestId(/^module-lock-/)).toHaveLength(6);
    // And never Faith or Noor AI.
    expect(screen.queryByTestId('module-lock-faith')).toBeNull();
    expect(screen.queryByTestId('module-lock-noor-ai')).toBeNull();
  });
});
