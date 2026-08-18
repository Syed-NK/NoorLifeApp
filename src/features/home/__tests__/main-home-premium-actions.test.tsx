import { act, render, screen, userEvent, within } from '@testing-library/react-native';
import fs from 'node:fs';
import path from 'node:path';
import { useEffect } from 'react';
import { StyleSheet, Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider } from '@application/providers/auth-provider';
import { DesignSystemProvider } from '@application/providers/design-system-provider';
import { FontProvider } from '@application/providers/font-provider';
import { LocalizationProvider } from '@application/providers/localization-provider';
import { moduleThemes } from '@ds/modules/module-themes';
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
import { mockMainHomeDashboard } from '@mocks/main-home';
import { installMockLatencyTimers } from '@/test-support/mock-latency-timers';

import { HomeBottomNavigation } from '../components/home-bottom-navigation';
import { QuickActionsRow } from '../components/quick-actions-row';
import { TodayTimeline } from '../components/today-timeline';
import { UPGRADE_SOURCES } from '../home-premium-surfaces';
import { LOCKED } from '../main-home-metrics';
import { MainHomeMetricsProvider } from '../main-home-metrics-context';
import { MainHomeScreen } from '../screens/main-home-screen';
import { mockRouter } from '../../../../jest.setup';

// Two costs this removes: the 450 ms the mock dashboard sleeps on every mount, and the one-off
// compile cost of the first mount, which is warmed up in `beforeAll` so no test is charged for it.
installMockLatencyTimers(() => free());

/**
 * The remaining premium interactions on Main Home: Today's "View All", the Noor AI insight, the
 * three quick actions and the Insights tab.
 *
 * The same three questions the timeline and summary suite asks of every surface — free, paid, and
 * not-yet-resolved — with one addition that only applies here: Noor AI must come out *available*.
 * It is on the free plan, so a lock badge or an upgrade sheet on it would be a bug in the opposite
 * direction from the rest of this work.
 *
 * Two harnesses, because two different things need proving:
 *
 *   • `renderMainHome` mounts the real screen, which is where behaviour, navigation and the
 *     single-sheet guarantee live. The screen mounts its own upgrade controller, so nothing here
 *     wraps one around it.
 *   • `renderSurface` mounts one component beside a probe on the same controller, which is the only
 *     way to read the exact `featureTitle` / `moduleId` / `source` a surface sends. The sheet names
 *     the feature and its module, but not the surface that asked, and `source` is never shown at all.
 */

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

/** An adapter whose entitlement never arrives, so the provider stays `unknown` for the whole test. */
const neverResolves: PurchaseAdapter = {
  id: 'mock',
  canTransact: false,
  getOffers: () => new Promise(() => {}),
  getEntitlement: () => new Promise(() => {}),
  purchase: () => new Promise(() => {}),
  restore: () => new Promise(() => {}),
  openManagement: () => new Promise(() => {}),
};

/** The real provider stack, in `AppProviders` order, with a known entitlement injected. */
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
  // The hero marks the ready branch; the screen's root renders in every branch.
  await screen.findByTestId('main-home-hero');
  return view;
}

const onPlan = (plan: Entitlement['plan']) =>
  renderMainHome(new MockPurchaseAdapter({ initialEntitlement: entitlement(plan) }));

const free = () => onPlan('free');
const paid = () => onPlan('premium_family');
const unresolved = () => renderMainHome(neverResolves);

// ── The payload probe ───────────────────────────────────────────────────────

/**
 * A mutable box rather than a reassigned module variable.
 *
 * The react-hooks rules reject a render writing to module scope, and rightly. Writing into a stable
 * object from an effect is the same capture without the reassignment, after commit, when the value
 * has settled — the pattern `upgrade-sheet.test.tsx` already uses.
 */
const probe: { request: UpgradeRequest | null } = { request: null };

function RequestProbe() {
  const { request } = useUpgradeSheet();

  useEffect(() => {
    probe.request = request;
  }, [request]);

  return <Text>probe</Text>;
}

/** Renders one Main Home surface on a real controller, with the probe reading what it sends. */
async function renderSurface(node: React.ReactNode, adapter: PurchaseAdapter) {
  probe.request = null;
  return render(
    <Providers adapter={adapter}>
      <MainHomeMetricsProvider>
        <UpgradeSheetProvider>
          {node}
          <RequestProbe />
        </UpgradeSheetProvider>
      </MainHomeMetricsProvider>
    </Providers>,
  );
}

const freeAdapter = () => new MockPurchaseAdapter({ initialEntitlement: entitlement('free') });

/*
 * The Noor AI insight card has no `renderSurface` harness of its own: it never raises an upgrade
 * request — Noor AI is on the free plan — so there is no payload to read. Everything about it is
 * asserted through the real screen below, which is also the only place its locked geometry is worth
 * measuring.
 */

/**
 * The sheet's contextual body, which is how an open upgrade explanation is recognised on screen.
 *
 * The title is one fixed line for every request, so the body is what identifies *which* request is
 * showing — and it names the feature as well as the module, which is the correction the device pass
 * asked for. Composed from the shared copy, so a wording change moves these assertions with it.
 */
const sheetBodyFor = (featureTitle: string, moduleName: string) =>
  lockedModuleCopy.body({ featureTitle, moduleName });

/** Every route these surfaces must not reach without an explicit confirmation. */
const PROTECTED_ROUTES = ['/planner', '/health', '/family', '/goals', '/insights'];

function expectNoProtectedRouteEntered() {
  for (const route of PROTECTED_ROUTES) {
    expect(mockRouter.push).not.toHaveBeenCalledWith(route);
  }
}

/**
 * The resolved style of the box a testID names.
 *
 * `PressableScale` keeps the caller's style on its wrapper and puts the testID on the absolute touch
 * overlay inside it, so a pressable surface measures one level up. A plain `View` measures where it
 * stands.
 */
function flat(testID: string) {
  const node = screen.getByTestId(testID);
  const own = StyleSheet.flatten(node.props.style);
  return own?.height === undefined ? StyleSheet.flatten(node.parent?.props.style) : own;
}

// ── Today at a Glance: View All ─────────────────────────────────────────────

describe("Today at a Glance's View All on a free plan", () => {
  it('raises the Planner upgrade explanation instead of opening Planner', async () => {
    const user = userEvent.setup();
    await free();

    await user.press(screen.getByTestId('main-home-timeline-view-all'));

    expect(screen.getByText(sheetBodyFor('Today at a Glance', 'Planner'))).toBeTruthy();
    expectNoProtectedRouteEntered();
  });

  it('does not enter Planner before the user confirms anything', async () => {
    const user = userEvent.setup();
    await free();

    await user.press(screen.getByTestId('main-home-timeline-view-all'));

    // Not "pushed then bounced by the route gate" — never pushed. Planner's gate stays in place
    // behind this as defence in depth, and is asserted separately.
    expect(mockRouter.push).not.toHaveBeenCalled();
  });

  it('announces the restriction in its accessible name, naming the destination', async () => {
    await free();
    // The approved name for the locked control. It says where "View All" would have gone, which the
    // old wording ("today's schedule") did not.
    expect(screen.getByLabelText('View all Planner activities, Premium feature')).toBeTruthy();
    expect(screen.queryByLabelText("View all of today's schedule")).toBeNull();
  });

  it('shows a visible lock beside the label, in place of the forward chevron', async () => {
    await free();

    // The defect this replaces: a control that looked exactly like the paid one and only explained
    // itself after being tapped. The lock is visible, and it is a shape rather than a colour.
    expect(screen.getByTestId('main-home-timeline-view-all-lock')).toBeTruthy();
  });

  it('keeps the control visible and in place, still reading "View All"', async () => {
    await free();
    // Nothing is removed: the heading row is unchanged, so the card's 22 dp heading and the four rows
    // below it keep their exact positions.
    expect(screen.getByText('View All')).toBeTruthy();
    expect(flat('main-home-timeline')?.height).toBe(LOCKED.today.cardHeight);
  });

  it('sends the section as the feature, Planner as the module, and its own source', async () => {
    const user = userEvent.setup();
    await renderSurface(
      <TodayTimeline
        entries={mockMainHomeDashboard.timeline}
        theme={moduleThemes.main}
        onViewAll={() => undefined}
        onSelectEntry={() => undefined}
        testID="today"
      />,
      freeAdapter(),
    );
    await screen.findByText('probe');

    await user.press(screen.getByTestId('today-view-all'));

    expect(probe.request).toEqual({
      featureTitle: 'Today at a Glance',
      moduleId: 'planner',
      moduleName: 'Planner',
      source: UPGRADE_SOURCES.todayTimelineViewAll,
    });
    expect(probe.request?.source).toBe('today_timeline_view_all');
  });
});

describe("Today at a Glance's View All before the entitlement resolves", () => {
  it('defaults to the upgrade explanation rather than opening Planner', async () => {
    const user = userEvent.setup();
    await unresolved();

    await user.press(screen.getByTestId('main-home-timeline-view-all'));

    expect(screen.getByText(sheetBodyFor('Today at a Glance', 'Planner'))).toBeTruthy();
    expect(mockRouter.push).not.toHaveBeenCalled();
  });
});

describe("Today at a Glance's View All on a paid plan", () => {
  it('opens Planner, exactly as before', async () => {
    const user = userEvent.setup();
    await paid();

    await user.press(screen.getByTestId('main-home-timeline-view-all'));

    expect(mockRouter.push).toHaveBeenCalledWith('/planner');
    expect(screen.queryByTestId('main-home-upgrade-sheet')).toBeNull();
  });

  it('announces it without a premium suffix, and carries no lock', async () => {
    await paid();

    expect(screen.getByLabelText("View all of today's schedule")).toBeTruthy();
    expect(screen.queryByLabelText('View all Planner activities, Premium feature')).toBeNull();
    // The forward chevron is back, and there is nothing to badge.
    expect(screen.queryByTestId('main-home-timeline-view-all-lock')).toBeNull();
  });
});

// ── Noor AI insight ────────────────────────────────────────────────────────

describe('the Noor AI insight on a free plan', () => {
  it('states what Noor AI can actually help with, verbatim', async () => {
    await free();
    expect(screen.getByText('Noor AI Insight')).toBeTruthy();
    expect(
      screen.getByText('Ask Noor AI how to find features or manage your account.'),
    ).toBeTruthy();
  });

  it('makes no claim about a schedule the user does not have', async () => {
    await free();
    // The paid insight reports a free window in a Planner day. A free user has no Planner.
    expect(screen.queryByText('You have a free 30-minute window at 4 PM.')).toBeNull();
  });

  it('announces the narrower scope it is working in', async () => {
    await free();
    const label = screen.getByTestId('main-home-ai-insight').props.accessibilityLabel as string;
    expect(label).toContain('Scope: NoorLife app help only');
    expect(label).toContain('Ask Noor AI how to find features or manage your account.');
  });

  it('opens Noor AI on a tap, and raises no upgrade sheet', async () => {
    const user = userEvent.setup();
    await free();

    await user.press(screen.getByTestId('main-home-ai-insight'));

    // Noor AI is included on the free plan. Scope-limited is not locked.
    expect(mockRouter.push).toHaveBeenCalledWith('/ai');
    expect(screen.queryByTestId('main-home-upgrade-sheet')).toBeNull();
  });

  it('carries no lock badge and stays a plain button', async () => {
    await free();

    const card = screen.getByTestId('main-home-ai-insight');
    expect(card.props.accessibilityRole).toBe('button');
    expect(card.props.accessibilityState?.disabled).toBeFalsy();
    expect(screen.queryByTestId('main-home-ai-insight-lock')).toBeNull();
  });

  it('keeps the approved robot asset', async () => {
    await free();
    expect(screen.getByTestId('main-home-ai-insight-robot')).toBeTruthy();
  });
});

describe('the Noor AI insight before the entitlement resolves', () => {
  it('defaults to the application-guidance copy', async () => {
    await unresolved();
    expect(
      screen.getByText('Ask Noor AI how to find features or manage your account.'),
    ).toBeTruthy();
    expect(screen.queryByText('You have a free 30-minute window at 4 PM.')).toBeNull();
  });

  it('still opens Noor AI, because Noor AI is never gated', async () => {
    const user = userEvent.setup();
    await unresolved();

    await user.press(screen.getByTestId('main-home-ai-insight'));
    expect(mockRouter.push).toHaveBeenCalledWith('/ai');
  });
});

describe('the Noor AI insight on a paid plan', () => {
  it('shows the personalized insight and its full scope', async () => {
    await paid();

    expect(screen.getByText('You have a free 30-minute window at 4 PM.')).toBeTruthy();
    expect(
      screen.queryByText('Ask Noor AI how to find features or manage your account.'),
    ).toBeNull();
    expect(screen.getByTestId('main-home-ai-insight').props.accessibilityLabel).toContain(
      'Scope: NoorLife only',
    );
  });

  it('opens Noor AI, exactly as before', async () => {
    const user = userEvent.setup();
    await paid();

    await user.press(screen.getByTestId('main-home-ai-insight'));
    expect(mockRouter.push).toHaveBeenCalledWith('/ai');
  });
});

describe('the Noor AI insight card geometry', () => {
  it.each([
    ['free', free],
    ['paid', paid],
  ])('is identical on a %s plan', async (_, mount) => {
    await mount();

    const card = flat('main-home-ai-insight');
    expect(card?.height).toBe(LOCKED.aiInsight.height);
    expect(card?.borderRadius).toBe(LOCKED.aiInsight.radius);
    expect(card?.paddingLeft).toBe(LOCKED.aiInsight.paddingHorizontal);
    expect(card?.paddingVertical).toBe(LOCKED.aiInsight.paddingVertical);
    expect(card?.borderWidth).toBe(1);
  });
});

// ── Quick actions ──────────────────────────────────────────────────────────

/** The three quick actions, the module each belongs to, and the sheet it must raise. */
const QUICK_ACTIONS = [
  { key: 'add-task', label: 'Add Task', module: 'planner', moduleName: 'Planner' },
  { key: 'log-wellness', label: 'Log Wellness', module: 'health', moduleName: 'Health' },
  { key: 'family-check-in', label: 'Family Check-in', module: 'family', moduleName: 'Family' },
] as const;

describe('the quick actions on a free plan', () => {
  it.each(QUICK_ACTIONS)('locks $label, keeping its tile and icon', async ({ key }) => {
    await free();

    // Still a tile in the same position with the same approved icon — locked, not removed.
    expect(screen.getByTestId(`quick-action-${key}`)).toBeTruthy();
    expect(screen.getByTestId(`quick-action-lock-${key}`)).toBeTruthy();
  });

  it('locks all three, because all three belong to premium modules', async () => {
    await free();

    expect(screen.getAllByTestId(/^quick-action-lock-/)).toHaveLength(3);
    // And all three tiles are still there. Counted by name rather than by pattern, because the
    // badge testIDs share the prefix.
    for (const { key } of QUICK_ACTIONS) {
      expect(screen.getByTestId(`quick-action-${key}`)).toBeTruthy();
    }
  });

  it.each(QUICK_ACTIONS)('announces $label as a premium feature', async ({ key, label }) => {
    await free();
    expect(screen.getByTestId(`quick-action-${key}`).props.accessibilityLabel).toBe(
      `${label}, Premium feature`,
    );
  });

  it.each(QUICK_ACTIONS)(
    'raises the $moduleName explanation from $label without entering the module',
    async ({ key, label, moduleName }) => {
      const user = userEvent.setup();
      await free();

      await user.press(screen.getByTestId(`quick-action-${key}`));

      expect(screen.getByText(sheetBodyFor(label, moduleName))).toBeTruthy();
      expectNoProtectedRouteEntered();
    },
  );

  it.each(QUICK_ACTIONS)(
    'sends $label as the feature, $moduleName as the module, and the quick-action source',
    async ({ key, label, module, moduleName }) => {
      const user = userEvent.setup();
      await renderSurface(
        <QuickActionsRow
          actions={mockMainHomeDashboard.quickActions}
          onSelectAction={() => undefined}
          testID="quick-actions"
        />,
        freeAdapter(),
      );
      await screen.findByText('probe');

      await user.press(screen.getByTestId(`quick-action-${key}`));

      expect(probe.request).toEqual({
        featureTitle: label,
        moduleId: module,
        moduleName,
        source: UPGRADE_SOURCES.quickAction,
      });
      expect(probe.request?.source).toBe('quick_action');
    },
  );

  it('executes no protected action and starts no edit before confirmation', async () => {
    const user = userEvent.setup();
    const selected: string[] = [];
    await renderSurface(
      <QuickActionsRow
        actions={mockMainHomeDashboard.quickActions}
        onSelectAction={(action) => selected.push(action.key)}
        testID="quick-actions"
      />,
      freeAdapter(),
    );
    await screen.findByText('probe');

    for (const { key } of QUICK_ACTIONS) {
      await user.press(screen.getByTestId(`quick-action-${key}`));
    }

    // `onSelectAction` is the only path to the module, and it is what would open an editor. It is
    // never called for a locked action, so nothing happens that the user has not agreed to.
    expect(selected).toEqual([]);
    expect(mockRouter.push).not.toHaveBeenCalled();
  });

  it.each(QUICK_ACTIONS)('keeps $label focusable rather than disabling it', async ({ key }) => {
    await free();

    const tile = screen.getByTestId(`quick-action-${key}`);
    expect(tile.props.accessibilityRole).toBe('button');
    expect(tile.props.accessibilityState?.disabled).toBeFalsy();
  });
});

describe('the quick actions before the entitlement resolves', () => {
  it.each(QUICK_ACTIONS)(
    'defaults $label to locked rather than flashing it open',
    async ({ key }) => {
      await unresolved();
      expect(screen.getByTestId(`quick-action-lock-${key}`)).toBeTruthy();
    },
  );
});

describe('the quick actions on a paid plan', () => {
  it('carries no lock indicator on any tile', async () => {
    await paid();
    expect(screen.queryAllByTestId(/^quick-action-lock-/)).toHaveLength(0);
  });

  it.each(QUICK_ACTIONS)('announces $label without a premium suffix', async ({ key, label }) => {
    await paid();
    expect(screen.getByTestId(`quick-action-${key}`).props.accessibilityLabel).toBe(label);
  });

  it.each([
    ['add-task', '/planner'],
    ['log-wellness', '/health'],
    ['family-check-in', '/family'],
  ])('navigates to the owning module from %s', async (key, route) => {
    const user = userEvent.setup();
    await paid();

    await user.press(screen.getByTestId(`quick-action-${key}`));
    expect(mockRouter.push).toHaveBeenCalledWith(route);
  });
});

describe('the quick-action geometry', () => {
  it.each([
    ['free', free],
    ['paid', paid],
  ])('is identical on a %s plan', async (_, mount) => {
    await mount();

    for (const { key } of QUICK_ACTIONS) {
      const tile = flat(`quick-action-${key}`);
      expect(tile?.height).toBe(LOCKED.quickAction.height);
      expect(tile?.borderRadius).toBe(LOCKED.quickAction.radius);
      expect(tile?.paddingHorizontal).toBe(LOCKED.quickAction.paddingHorizontal);
      expect(tile?.flex).toBe(1);
    }
  });

  it('keeps the label at the same shrink allowance in both states', async () => {
    await free();
    // Scoped to the row: "Family Check-in" is also the Family summary card's heading.
    const label = within(screen.getByTestId('main-home-quick-actions')).getByText(
      'Family Check-in',
    );
    // The locked tile must not steal width from the label — which is why the padlock is out of flow.
    expect(label.props.minimumFontScale).toBe(LOCKED.quickAction.minimumFontScale);
    expect(label.props.numberOfLines).toBe(1);
  });

  it.each([
    ['free', free],
    ['paid', paid],
  ])('reaches the 44 dp touch minimum on a %s plan without resizing the tile', async (_, mount) => {
    await mount();

    for (const { key } of QUICK_ACTIONS) {
      const tile = screen.getByTestId(`quick-action-${key}`);
      // The locked geometry is 2 dp under the floor and may not change, so the deficit is made up
      // with hit-slop — in both states, since a locked tile is a control like any other.
      expect(flat(`quick-action-${key}`)?.height).toBe(LOCKED.quickAction.height);
      expect(tile.props.hitSlop).toEqual({ top: 1, bottom: 1, left: 1, right: 1 });
      const target = LOCKED.quickAction.height + 2;
      expect(target).toBeGreaterThanOrEqual(44);
      // And the slop cannot reach into a neighbour: the row's gap is wider than the slop it adds.
      expect(LOCKED.quickAction.gap).toBeGreaterThan(2);
    }
  });
});

// ── Bottom navigation ──────────────────────────────────────────────────────

describe('the bottom navigation on a free plan', () => {
  it('locks Insights', async () => {
    await free();
    expect(screen.getByTestId('main-home-nav-insights')).toBeTruthy();
    expect(screen.getByTestId('main-home-nav-insights-lock')).toBeTruthy();
    expect(screen.getByTestId('main-home-nav-insights').props.accessibilityLabel).toBe(
      'Insights, Premium feature',
    );
  });

  it('locks nothing else', async () => {
    await free();

    // Home, Modules and Profile are on every plan; the centre Noor AI control is not premium at all.
    for (const key of ['home', 'modules', 'profile']) {
      expect(screen.queryByTestId(`main-home-nav-${key}-lock`)).toBeNull();
    }
    expect(screen.queryByTestId('main-home-nav-ai-lock')).toBeNull();
    expect(screen.getAllByTestId(/^main-home-nav-[a-z-]+-lock$/)).toHaveLength(1);
  });

  it('raises the Goals explanation from Insights without entering it', async () => {
    const user = userEvent.setup();
    await free();

    await user.press(screen.getByTestId('main-home-nav-insights'));

    expect(screen.getByText(sheetBodyFor('Insights', 'Goals'))).toBeTruthy();
    expect(mockRouter.push).not.toHaveBeenCalled();
    expectNoProtectedRouteEntered();
  });

  it('sends Insights as the feature, Goals as the module, and the navigation source', async () => {
    const user = userEvent.setup();
    await renderSurface(
      <HomeBottomNavigation
        theme={moduleThemes.main}
        activeKey="home"
        onNavigate={() => undefined}
        testID="nav"
      />,
      freeAdapter(),
    );
    await screen.findByText('probe');

    await user.press(screen.getByTestId('nav-insights'));

    expect(probe.request).toEqual({
      featureTitle: 'Insights',
      moduleId: 'goals',
      moduleName: 'Goals',
      source: UPGRADE_SOURCES.bottomNavigation,
    });
    expect(probe.request?.source).toBe('bottom_navigation');
  });

  it('never navigates from a locked tab, so the destination stays out of the back stack', async () => {
    const user = userEvent.setup();
    const navigated: string[] = [];
    await renderSurface(
      <HomeBottomNavigation
        theme={moduleThemes.main}
        activeKey="home"
        onNavigate={(item) => navigated.push(item.key)}
        testID="nav"
      />,
      freeAdapter(),
    );
    await screen.findByText('probe');

    await user.press(screen.getByTestId('nav-insights'));
    expect(navigated).toEqual([]);

    // The available tabs still navigate normally.
    await user.press(screen.getByTestId('nav-modules'));
    expect(navigated).toEqual(['modules']);
  });

  it.each([
    ['home', '/home'],
    ['modules', '/modules'],
    ['profile', '/profile'],
  ])('keeps %s available', async (key, route) => {
    const user = userEvent.setup();
    await free();

    await user.press(screen.getByTestId(`main-home-nav-${key}`));
    expect(mockRouter.push).toHaveBeenCalledWith(route);
  });

  it('keeps the centre Noor AI control available, badge-free, on its approved asset', async () => {
    const user = userEvent.setup();
    await free();

    const control = screen.getByTestId('main-home-nav-ai');
    expect(control.props.accessibilityLabel).toBe('Open Noor AI');
    expect(screen.queryByTestId('main-home-nav-ai-lock')).toBeNull();

    await user.press(control);
    // Free users enter Noor AI in its application-guidance scope — they still enter it.
    expect(mockRouter.push).toHaveBeenCalledWith('/ai');
  });

  it('still renders all five labels', async () => {
    await free();
    for (const label of ['Home', 'Modules', 'Insights', 'Profile']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    // Noor AI's slot carries no visible caption by design, so its name is on the control.
    expect(screen.getByLabelText('Open Noor AI')).toBeTruthy();
  });

  it('keeps Insights focusable rather than disabling it', async () => {
    await free();
    const tab = screen.getByTestId('main-home-nav-insights');
    expect(tab.props.accessibilityRole).toBe('tab');
    expect(tab.props.accessibilityState?.disabled).toBeFalsy();
  });
});

describe('the bottom navigation before the entitlement resolves', () => {
  it('defaults Insights to locked', async () => {
    await unresolved();
    expect(screen.getByTestId('main-home-nav-insights-lock')).toBeTruthy();
  });

  it('keeps Noor AI and Modules available', async () => {
    await unresolved();
    expect(screen.queryByTestId('main-home-nav-ai-lock')).toBeNull();
    expect(screen.queryByTestId('main-home-nav-modules-lock')).toBeNull();
  });
});

describe('the bottom navigation on a paid plan', () => {
  it('carries no lock anywhere', async () => {
    await paid();
    expect(screen.queryAllByTestId(/^main-home-nav-[a-z-]+-lock$/)).toHaveLength(0);
  });

  it('opens Insights normally', async () => {
    const user = userEvent.setup();
    await paid();

    await user.press(screen.getByTestId('main-home-nav-insights'));
    expect(mockRouter.push).toHaveBeenCalledWith('/insights');
    expect(screen.queryByTestId('main-home-upgrade-sheet')).toBeNull();
  });

  it('announces Insights without a premium suffix', async () => {
    await paid();
    expect(screen.getByTestId('main-home-nav-insights').props.accessibilityLabel).toBe('Insights');
  });
});

describe('the bottom-navigation geometry', () => {
  it.each([
    ['free', free],
    ['paid', paid],
  ])('keeps the bar and its slots identical on a %s plan', async (_, mount) => {
    await mount();

    // The bar's height comes from the locked value plus the safe-area inset, which is 0 in the test
    // environment — so the flattened height is the locked height exactly.
    const bar = StyleSheet.flatten(screen.getByTestId('main-home-nav').props.style);
    expect(bar?.height).toBe(LOCKED.bottomNav.height);
    expect(bar?.position).toBe('absolute');

    for (const key of ['home', 'modules', 'insights', 'profile']) {
      const slot = StyleSheet.flatten(
        screen.getByTestId(`main-home-nav-${key}`).parent?.props.style,
      );
      expect(slot?.alignSelf).toBe('stretch');
    }
  });

  it.each([
    ['free', free],
    ['paid', paid],
  ])('keeps the centre control at its locked size on a %s plan', async (_, mount) => {
    await mount();

    const control = flat('main-home-nav-ai');
    expect(control?.width).toBe(LOCKED.bottomNav.aiButton);
    expect(control?.height).toBe(LOCKED.bottomNav.aiButton);
    expect(control?.borderRadius).toBe(LOCKED.bottomNav.aiButton / 2);
    expect(control?.borderWidth).toBe(LOCKED.bottomNav.aiBorder);
  });
});

// ── The one controller, one sheet ──────────────────────────────────────────

describe('every locked surface shares the one provider', () => {
  it('shows the most recent request after taps on three different surfaces', async () => {
    const user = userEvent.setup();
    await free();

    await user.press(screen.getByTestId('main-home-timeline-view-all'));
    await user.press(screen.getByTestId('quick-action-log-wellness'));
    await user.press(screen.getByTestId('main-home-nav-insights'));

    // Three surfaces writing to the same slot is what proves there is one provider instance and not
    // one per component: a second instance would leave an earlier request standing in its own.
    expect(screen.getByText(sheetBodyFor('Insights', 'Goals'))).toBeTruthy();
    expect(screen.queryByText(sheetBodyFor('Today at a Glance', 'Planner'))).toBeNull();
    expect(screen.queryByText(sheetBodyFor('Log Wellness', 'Health'))).toBeNull();
  });

  it('renders exactly one sheet however many surfaces have asked', async () => {
    const user = userEvent.setup();
    await free();

    await user.press(screen.getByTestId('quick-action-add-task'));
    await user.press(screen.getByTestId('quick-action-add-task'));
    await user.press(screen.getByTestId('main-home-nav-insights'));

    expect(screen.getAllByTestId('main-home-upgrade-sheet')).toHaveLength(1);
    expect(screen.getAllByTestId('main-home-upgrade-sheet-panel')).toHaveLength(1);
  });

  it('dismisses without navigating, from any of them', async () => {
    const user = userEvent.setup();
    await free();

    await user.press(screen.getByTestId('main-home-nav-insights'));
    await user.press(screen.getByTestId('main-home-upgrade-sheet-not-now'));

    expect(screen.queryByTestId('main-home-upgrade-sheet')).toBeNull();
    expect(mockRouter.push).not.toHaveBeenCalled();
  });

  it('dismisses on the scrim, without navigating', async () => {
    const user = userEvent.setup();
    await free();

    await user.press(screen.getByTestId('quick-action-family-check-in'));
    await user.press(screen.getByTestId('main-home-upgrade-sheet-scrim'));

    expect(screen.queryByTestId('main-home-upgrade-sheet')).toBeNull();
    expect(mockRouter.push).not.toHaveBeenCalled();
  });

  it('dismisses on Android back, without navigating', async () => {
    const user = userEvent.setup();
    await free();

    await user.press(screen.getByTestId('main-home-timeline-view-all'));

    // The `Modal`'s own back handler, invoked as the platform would rather than simulated. Wrapped
    // in `act` because it is called directly rather than through a press, and it sets state.
    const onRequestClose = screen.getByTestId('main-home-upgrade-sheet').props
      .onRequestClose as () => void;
    await act(async () => {
      onRequestClose();
    });

    expect(screen.queryByTestId('main-home-upgrade-sheet-panel')).toBeNull();
    expect(mockRouter.push).not.toHaveBeenCalled();
  });

  it('reaches the plans only on an explicit confirmation', async () => {
    const user = userEvent.setup();
    await free();

    await user.press(screen.getByTestId('main-home-nav-insights'));
    expect(mockRouter.push).not.toHaveBeenCalled();

    await user.press(screen.getByTestId('main-home-upgrade-sheet-view-plans'));
    expect(mockRouter.push).toHaveBeenCalledWith('/subscription');
  });
});

// ── Regression ─────────────────────────────────────────────────────────────

describe('what this phase must not have changed', () => {
  it('leaves the Faith prayer row active and unbadged on a free plan', async () => {
    const user = userEvent.setup();
    await free();

    expect(screen.queryByTestId('timeline-lock-next-prayer')).toBeNull();
    await user.press(screen.getByTestId('timeline-row-next-prayer'));
    expect(mockRouter.push).toHaveBeenCalledWith('/faith');
    expect(screen.queryByTestId('main-home-upgrade-sheet')).toBeNull();
  });

  it('never raises an upgrade explanation for Faith, however it is asked', async () => {
    const user = userEvent.setup();
    await free();

    // The controller refuses a non-premium module, so a caller that got it wrong could not produce
    // one either. Faith's tile and its timeline row are the two surfaces that could try.
    await user.press(screen.getByTestId('module-card-faith'));
    await user.press(screen.getByTestId('timeline-row-next-prayer'));
    expect(screen.queryByTestId('main-home-upgrade-sheet')).toBeNull();
    expect(screen.queryByText(sheetBodyFor('Faith', 'Faith'))).toBeNull();
  });

  it('never raises one for Noor AI either', async () => {
    const user = userEvent.setup();
    await free();

    await user.press(screen.getByTestId('main-home-ai-insight'));
    await user.press(screen.getByTestId('main-home-nav-ai'));
    await user.press(screen.getByTestId('module-card-noor-ai'));
    expect(screen.queryByTestId('main-home-upgrade-sheet')).toBeNull();
  });

  it('keeps the six paid module tiles locked, with the grid untouched', async () => {
    await free();

    for (const id of ['health', 'planner', 'finance', 'learning', 'family', 'goals']) {
      expect(screen.getByTestId(`module-card-${id}-locked`)).toBeTruthy();
      expect(screen.getByTestId(`module-pictogram-${id}`)).toBeTruthy();
    }
    expect(screen.getAllByTestId(/^module-pictogram-/)).toHaveLength(8);
  });

  it('leaves every paid module route gated, so a deep link cannot bypass any of this', async () => {
    // Defence in depth, and the reason none of the surfaces above need to be trusted: a locked
    // surface refusing to navigate is the good experience, and the route gate is the guarantee.
    // Asserted against the route layouts themselves — a gate removed from one of them would
    // otherwise leave that module reachable by URL with every Main Home surface still correct.
    for (const moduleId of ['health', 'planner', 'finance', 'learning', 'family', 'goals']) {
      const layout = fs.readFileSync(
        path.join(process.cwd(), 'src', 'app', moduleId, '_layout.tsx'),
        'utf8',
      );
      expect(layout).toContain(`<ModuleEntitlementGate moduleId="${moduleId}">`);
    }
  });

  it('keeps all seven sections in the locked order', async () => {
    await free();

    const order = [
      'main-home-header',
      'main-home-hero',
      'main-home-module-grid',
      'main-home-timeline',
      'main-home-summary-row',
      'main-home-ai-insight',
      'main-home-quick-actions',
    ];
    const tree = JSON.stringify(screen.toJSON());
    const positions = order.map((id) => tree.indexOf(`"${id}"`));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });
});
