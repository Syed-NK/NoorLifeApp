import { render, screen, userEvent, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider } from '@application/providers/auth-provider';
import { DesignSystemProvider } from '@application/providers/design-system-provider';
import { FontProvider } from '@application/providers/font-provider';
import { LocalizationProvider } from '@application/providers/localization-provider';
import { PLAN_CAPABILITIES, type Entitlement } from '@features/subscription/domain/entitlement';
import { EntitlementProvider } from '@features/subscription/services/entitlement-context';
import { MockPurchaseAdapter } from '@features/subscription/services/mock-purchase-adapter';
import type { PurchaseAdapter } from '@features/subscription/services/purchase-adapter';
import { lockedModuleCopy } from '@features/subscription/subscription-copy';
import { installMockLatencyTimers } from '@/test-support/mock-latency-timers';

import { LOCKED } from '../main-home-metrics';
import { MainHomeScreen } from '../screens/main-home-screen';
import { mockRouter } from '../../../../jest.setup';

// Two costs this removes: the 450 ms the mock dashboard sleeps on every mount, and the one-off
// compile cost of the first mount, which is warmed up in `beforeAll` so no test is charged for it.
installMockLatencyTimers(() => free());

/**
 * Paid content on Main Home: the timeline rows and the two summary cards.
 *
 * Three questions, asked of every surface:
 *
 *   • **Free** — is it plainly locked, does it explain itself, and does the tap raise the shared
 *     upgrade sheet *instead of* entering the module?
 *   • **Paid** — is it exactly what it always was, with no lock anywhere?
 *   • **Unresolved** — before entitlement has loaded, does it default to locked rather than
 *     flashing paid content at someone who may turn out to be free?
 *
 * The last one is the subtle one and the reason `UNKNOWN_ENTITLEMENT` exists: a screen that cannot
 * tell "no subscription" from "not loaded yet" shows one of the two the wrong thing on every cold
 * start. The rule itself is not restated here — `canAccessModule` already answers "unknown" as
 * "not entitled", and these tests only prove Main Home inherits that answer rather than inventing
 * its own. Faith stays available throughout, because it is never premium.
 *
 * Every render below mounts `MainHomeScreen` with no upgrade-sheet provider around it, because the
 * screen mounts its own — that is the architecture these tests hold in place.
 */

function entitlement(plan: Entitlement['plan']): Entitlement {
  return {
    plan,
    billingPeriod: plan === 'free' ? 'none' : 'yearly',
    status: plan === 'free' ? 'free' : 'active',
    provider: 'development_mock',
    currentPeriodEnd: plan === 'free' ? null : '2027-03-01T00:00:00.000Z',
    trialEnd: null,
    cancelAtPeriodEnd: plan === 'premium_family',
    isFamilyOrganizer: plan === 'premium_family',
    capabilities: PLAN_CAPABILITIES[plan],
  };
}

/**
 * An adapter whose entitlement never arrives.
 *
 * The provider therefore stays on `UNKNOWN_ENTITLEMENT` for the whole test, which is exactly the
 * window this suite is about — a slow store call, a cold start, an offline launch. Nothing here
 * rejects either: a pending promise, not a failure.
 */
const neverResolves: PurchaseAdapter = {
  id: 'mock',
  canTransact: false,
  getOffers: () => new Promise(() => {}),
  getEntitlement: () => new Promise(() => {}),
  purchase: () => new Promise(() => {}),
  restore: () => new Promise(() => {}),
  openManagement: () => new Promise(() => {}),
};

/**
 * The real provider stack with the entitlement adapter injected.
 *
 * Mirrors `AppProviders` in the same order; only the adapter differs, since `AppProviders` takes
 * the default one and these tests need a known plan.
 */
async function renderMainHome(adapter: PurchaseAdapter) {
  // RNTL 14's `render` is asynchronous; awaiting it is what commits the tree.
  const view = await render(
    <SafeAreaProvider>
      <DesignSystemProvider>
        <LocalizationProvider>
          <FontProvider>
            <AuthProvider>
              <EntitlementProvider adapter={adapter}>
                <MainHomeScreen />
              </EntitlementProvider>
            </AuthProvider>
          </FontProvider>
        </LocalizationProvider>
      </DesignSystemProvider>
    </SafeAreaProvider>,
  );

  // The hero marks the ready branch; the screen's root renders in every branch, including the
  // skeleton, so waiting on that would return too early.
  await screen.findByTestId('main-home-hero');
  return view;
}

const onPlan = (plan: Entitlement['plan']) =>
  renderMainHome(new MockPurchaseAdapter({ initialEntitlement: entitlement(plan) }));

const free = () => onPlan('free');
const paid = () => onPlan('premium_family');
const unresolved = () => renderMainHome(neverResolves);

/** The three timeline rows that belong to a premium module, and what each must say. */
const PROTECTED_ROWS = [
  { id: 'school-drop-off', title: 'School drop-off', time: '8:00 AM', module: 'Planner' },
  { id: 'work-focus', title: 'Work focus time', time: '10:00 AM', module: 'Planner' },
  { id: 'family-dinner', title: 'Family dinner', time: '5:30 PM', module: 'Family' },
] as const;

/** Every route a locked Main Home surface must not reach without an explicit confirmation. */
const PROTECTED_ROUTES = ['/planner', '/family', '/goals'];

function expectNoProtectedRouteEntered() {
  for (const route of PROTECTED_ROUTES) {
    expect(mockRouter.push).not.toHaveBeenCalledWith(route);
  }
}

/**
 * The sheet's contextual body, which is how an open upgrade explanation is recognised on screen.
 *
 * It used to be the heading, which was built from the module — "Planner is part of Premium". The
 * title is now one fixed line for every request, so the *body* is the part that identifies which
 * request is on screen, and it names the feature as well as the module. Composed from the shared copy
 * rather than restated, so a wording change moves these assertions with it instead of quietly
 * failing them.
 */
const sheetBodyFor = (featureTitle: string, moduleName: string) =>
  lockedModuleCopy.body({ featureTitle, moduleName });

// ── The controller and its single sheet ─────────────────────────────────────

describe('the upgrade sheet on Main Home', () => {
  it('is mounted by the screen itself, not by a wrapper around it', async () => {
    const user = userEvent.setup();
    await free();

    // Nothing in `renderMainHome` mounts an UpgradeSheetProvider. If the screen did not mount
    // its own, `useUpgradeSheetActions` would have thrown while rendering the first locked row,
    // and this render would never have reached the hero.
    await user.press(screen.getByTestId('timeline-row-school-drop-off'));
    expect(screen.getByTestId('main-home-upgrade-sheet')).toBeTruthy();
  });

  it('is not mounted until something asks for it', async () => {
    await free();
    expect(screen.queryByTestId('main-home-upgrade-sheet')).toBeNull();
  });

  it('renders exactly one sheet, however many surfaces have asked', async () => {
    const user = userEvent.setup();
    await free();

    await user.press(screen.getByTestId('timeline-row-school-drop-off'));
    await user.press(screen.getByTestId('family-check-in-card'));
    await user.press(screen.getByTestId('overall-progress-card'));

    // One controller, one slot, one presentation. Three requests in a row replace each other's
    // contents rather than stacking three modals.
    expect(screen.getAllByTestId('main-home-upgrade-sheet')).toHaveLength(1);
    expect(screen.getAllByTestId('main-home-upgrade-sheet-panel')).toHaveLength(1);
  });

  it('shows the most recent request after rapid taps, not the first', async () => {
    const user = userEvent.setup();
    await free();

    await user.press(screen.getByTestId('timeline-row-school-drop-off'));
    await user.press(screen.getByTestId('overall-progress-card'));

    // A timeline row and a summary card writing to the same slot is what proves there is one
    // provider instance and not one per surface: a second instance would leave the Planner
    // request standing in its own controller.
    expect(screen.getByText(sheetBodyFor('Overall Progress', 'Goals'))).toBeTruthy();
    expect(screen.queryByText(sheetBodyFor('School drop-off', 'Planner'))).toBeNull();
  });

  it('clears the request on dismissal, without navigating', async () => {
    const user = userEvent.setup();
    await free();

    await user.press(screen.getByTestId('timeline-row-family-dinner'));
    expect(screen.getByTestId('main-home-upgrade-sheet')).toBeTruthy();

    await user.press(screen.getByTestId('main-home-upgrade-sheet-not-now'));

    // Unmounted, not merely hidden — and "Not now" is not a route change.
    expect(screen.queryByTestId('main-home-upgrade-sheet')).toBeNull();
    expectNoProtectedRouteEntered();
    expect(mockRouter.push).not.toHaveBeenCalled();
  });

  it('reaches the plans only on an explicit confirmation', async () => {
    const user = userEvent.setup();
    await free();

    await user.press(screen.getByTestId('family-check-in-card'));
    expect(mockRouter.push).not.toHaveBeenCalled();

    await user.press(screen.getByTestId('main-home-upgrade-sheet-view-plans'));
    expect(mockRouter.push).toHaveBeenCalledWith('/subscription');
    expect(screen.queryByTestId('main-home-upgrade-sheet')).toBeNull();
  });
});

// ── Today at a Glance ───────────────────────────────────────────────────────

describe('the timeline on a free plan', () => {
  it('leaves Dhuhr Prayer active and unbadged', async () => {
    await free();

    // Faith is never premium, so its row is untouched by any of this.
    expect(screen.getByTestId('timeline-row-dhuhr')).toBeTruthy();
    expect(screen.queryByTestId('timeline-lock-dhuhr')).toBeNull();
    expect(screen.getByLabelText('12:35 PM, Dhuhr Prayer')).toBeTruthy();
  });

  it('opens Faith from Dhuhr Prayer and never raises an upgrade prompt', async () => {
    const user = userEvent.setup();
    await free();

    await user.press(screen.getByTestId('timeline-row-dhuhr'));
    expect(mockRouter.push).toHaveBeenCalledWith('/faith');
    expect(screen.queryByTestId('main-home-upgrade-sheet')).toBeNull();
  });

  it.each(PROTECTED_ROWS)('locks $title', async ({ id }) => {
    await free();
    expect(screen.getByTestId(`timeline-row-${id}`)).toBeTruthy();
    expect(screen.getByTestId(`timeline-lock-${id}`)).toBeTruthy();
  });

  it.each(PROTECTED_ROWS)('announces $title as a premium feature', async ({ time, title }) => {
    await free();

    const label = screen.getByLabelText(`${time}, ${title}, Premium feature`).props
      .accessibilityLabel as string;
    // The restriction travels with the feature's own name, not the module's.
    expect(label).toContain(`${title}, Premium feature`);
  });

  it.each(PROTECTED_ROWS)(
    'raises the upgrade sheet for $title, naming $module, without entering it',
    async ({ id, title, module }) => {
      const user = userEvent.setup();
      await free();

      await user.press(screen.getByTestId(`timeline-row-${id}`));

      // The sheet names the row the user tapped *and* the module that owns it.
      expect(screen.getByText(sheetBodyFor(title, module))).toBeTruthy();
      // And the module itself was never pushed — no flash, nothing in the back stack.
      expectNoProtectedRouteEntered();
    },
  );

  it('keeps a locked row focusable rather than disabling it', async () => {
    await free();

    const row = screen.getByTestId('timeline-row-school-drop-off');
    expect(row.props.accessibilityState?.disabled).toBeFalsy();
    expect(row.props.accessibilityRole).toBe('button');
    // A 23 dp row with hit-slop up to the 44 dp floor, locked or not.
    expect(row.props.hitSlop).toEqual({ top: 11, bottom: 11, left: 11, right: 11 });
  });

  it('keeps every row, in the same order, locked or not', async () => {
    await free();
    // Locking changes a row's surface and its destination. It never removes one.
    expect(screen.getAllByTestId(/^timeline-row-/)).toHaveLength(4);
  });
});

describe('the timeline on a paid plan', () => {
  it('carries no lock indicator on any row', async () => {
    await paid();
    expect(screen.queryAllByTestId(/^timeline-lock-/)).toHaveLength(0);
  });

  it.each(PROTECTED_ROWS)('announces $title without a premium suffix', async ({ time, title }) => {
    await paid();
    expect(screen.getByLabelText(`${time}, ${title}`)).toBeTruthy();
    expect(screen.queryByLabelText(`${time}, ${title}, Premium feature`)).toBeNull();
  });

  it('navigates to the owning module from a previously locked row', async () => {
    const user = userEvent.setup();
    await paid();

    await user.press(screen.getByTestId('timeline-row-family-dinner'));
    expect(mockRouter.push).toHaveBeenCalledWith('/family');
    expect(screen.queryByTestId('main-home-upgrade-sheet')).toBeNull();
  });
});

describe('the timeline before entitlement resolves', () => {
  it('keeps Dhuhr Prayer available', async () => {
    await unresolved();
    // Faith short-circuits before the plan or the status is consulted, so it does not wait.
    expect(screen.getByTestId('timeline-row-dhuhr')).toBeTruthy();
    expect(screen.queryByTestId('timeline-lock-dhuhr')).toBeNull();
  });

  it.each(PROTECTED_ROWS)('defaults $title to locked rather than flashing it open', async ({ id }) => {
    await unresolved();
    expect(screen.getByTestId(`timeline-lock-${id}`)).toBeTruthy();
  });
});

// ── Summary cards ───────────────────────────────────────────────────────────

describe('the summary cards on a free plan', () => {
  /**
   * Locked cards are queried from the screen rather than scoped with `within`.
   *
   * `PressableScale` puts the caller's style on its wrapper and the caller's `testID` on the
   * absolutely-positioned touch overlay inside it, so a locked card's testID identifies the
   * overlay — which has no children to search. The strings below appear nowhere else on Main
   * Home, so screen-level queries are unambiguous anyway.
   */
  it('states Premium on the Family card instead of a completion figure', async () => {
    await free();

    expect(screen.getByText('Premium')).toBeTruthy();
    expect(screen.getByText('Unlock family connection')).toBeTruthy();
    expect(screen.queryByText('4 of 5')).toBeNull();
    expect(screen.queryByText('complete')).toBeNull();
    // No bar reporting a completion the user has not made, and nothing announcing a value.
    expect(screen.getByTestId('family-check-in-locked-track')).toBeTruthy();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('states Unlock progress on the Progress card instead of a percentage', async () => {
    await free();

    expect(screen.getByText('Overall Progress')).toBeTruthy();
    expect(screen.getByText('Unlock progress')).toBeTruthy();
    expect(screen.getByText('Included with Premium')).toBeTruthy();
    expect(screen.queryByText('68%')).toBeNull();
    expect(screen.queryByText("You're on track")).toBeNull();
    // A neutral circle, not a swept arc: nothing here implies a percentage.
    expect(screen.getByTestId('overall-progress-locked-ring')).toBeTruthy();
    expect(screen.queryByTestId('overall-progress-ring')).toBeNull();
  });

  it.each([
    ['family-check-in-card', 'family-check-in-lock', 'Family Check-in, Premium feature'],
    ['overall-progress-card', 'overall-progress-lock', 'Overall Progress, Premium feature'],
  ])('marks %s as locked and announces it as a premium feature', async (card, lock, label) => {
    await free();
    expect(screen.getByTestId(lock)).toBeTruthy();
    expect(screen.getByTestId(card).props.accessibilityLabel).toBe(label);
  });

  it('offers no View All into a module the user cannot open', async () => {
    await free();

    // The card itself is the affordance; a "View All" on it would be an invitation to a screen
    // the free plan does not include. The timeline's own "View All" is a separate control and is
    // out of this phase's scope, so exactly one is expected to remain on the screen.
    expect(screen.queryByLabelText('View all, Family check-in')).toBeNull();
    expect(screen.queryByLabelText('View all, Overall progress')).toBeNull();
    expect(screen.getAllByText('View All')).toHaveLength(1);
  });

  it.each([
    ['family-check-in-card', 'Family Check-in', 'Family'],
    ['overall-progress-card', 'Overall Progress', 'Goals'],
  ])('raises the upgrade sheet from %s without entering the module', async (card, feature, module) => {
    const user = userEvent.setup();
    await free();

    await user.press(screen.getByTestId(card));

    expect(screen.getByText(sheetBodyFor(feature, module))).toBeTruthy();
    expectNoProtectedRouteEntered();
  });
});

describe('the summary cards on a paid plan', () => {
  it('shows the real Family check-in figure and its progress bar', async () => {
    await paid();

    const card = within(screen.getByTestId('family-check-in-card'));
    expect(card.getByText('4 of 5')).toBeTruthy();
    expect(card.getByText('complete')).toBeTruthy();
    expect(card.getByLabelText('Family check-in, 4 of 5 complete')).toBeTruthy();
    expect(card.queryByTestId('family-check-in-lock')).toBeNull();
  });

  it('shows the real overall percentage and its ring', async () => {
    await paid();

    const card = within(screen.getByTestId('overall-progress-card'));
    expect(card.getByText('68%')).toBeTruthy();
    expect(card.getByText("You're on track")).toBeTruthy();
    expect(card.getByTestId('overall-progress-ring')).toBeTruthy();
    expect(card.queryByTestId('overall-progress-locked-ring')).toBeNull();
    expect(screen.getByLabelText("Overall progress 68 percent, You're on track")).toBeTruthy();
  });

  it('keeps both View All actions and their navigation', async () => {
    const user = userEvent.setup();
    await paid();

    await user.press(screen.getByLabelText('View all, Family check-in'));
    expect(mockRouter.push).toHaveBeenCalledWith('/family');

    await user.press(screen.getByLabelText('View all, Overall progress'));
    expect(mockRouter.push).toHaveBeenCalledWith('/goals');
  });
});

describe('the summary cards before entitlement resolves', () => {
  it('default to the locked presentation rather than showing paid figures', async () => {
    await unresolved();

    expect(screen.getByText('Premium')).toBeTruthy();
    expect(screen.getByText('Unlock progress')).toBeTruthy();
    expect(screen.queryByText('4 of 5')).toBeNull();
    expect(screen.queryByText('68%')).toBeNull();
    expect(screen.queryByText("You're on track")).toBeNull();
  });
});

// ── Geometry ────────────────────────────────────────────────────────────────

/**
 * The locked measurements, asserted against the rendered tree.
 *
 * This is the guarantee the two reopened entries in `protected-files.test.ts` gave up. The files
 * may now branch on entitlement; what they may not do is move a card, resize a row or shrink a
 * ring while doing it — so both states are measured, and against the same numbers.
 */
describe('locked geometry survives both states', () => {
  /**
   * The resolved style of the box a testID names.
   *
   * `PressableScale` keeps the caller's style on its wrapper and puts the testID on the absolute
   * touch overlay inside it, so a pressable surface — every timeline row, and a locked summary
   * card — measures one level up. A plain `View` measures where it stands.
   */
  function flat(testID: string) {
    const node = screen.getByTestId(testID);
    const own = StyleSheet.flatten(node.props.style);
    return own?.height === undefined ? StyleSheet.flatten(node.parent?.props.style) : own;
  }

  it.each([
    ['free', free],
    ['paid', paid],
  ])('keeps the Today card and its rows at their locked heights on a %s plan', async (_, mount) => {
    await mount();

    expect(flat('main-home-timeline')?.height).toBe(LOCKED.today.cardHeight);
    expect(flat('main-home-timeline')?.borderRadius).toBe(LOCKED.today.cardRadius);
    for (const id of ['dhuhr', ...PROTECTED_ROWS.map((row) => row.id)]) {
      expect(flat(`timeline-row-${id}`)?.height).toBe(LOCKED.today.rowHeight);
    }
  });

  it.each([
    ['free', free],
    ['paid', paid],
  ])('keeps both summary cards at their locked dimensions on a %s plan', async (_, mount) => {
    await mount();

    for (const id of ['family-check-in-card', 'overall-progress-card']) {
      expect(flat(id)?.height).toBe(LOCKED.summary.height);
      expect(flat(id)?.borderRadius).toBe(LOCKED.summary.radius);
      expect(flat(id)?.padding).toBe(LOCKED.summary.padding);
    }
  });

  it('draws the locked ring placeholder at the real ring size and stroke', async () => {
    await free();

    const ring = flat('overall-progress-locked-ring');
    expect(ring?.width).toBe(LOCKED.summary.ring);
    expect(ring?.height).toBe(LOCKED.summary.ring);
    expect(ring?.borderWidth).toBe(LOCKED.summary.ringStroke);
  });
});
