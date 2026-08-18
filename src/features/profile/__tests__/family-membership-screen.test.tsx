import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { AuthProvider } from '@application/providers/auth-provider';
import { PLAN_CAPABILITIES, type Entitlement } from '@features/subscription/domain/entitlement';
import { EntitlementProvider } from '@features/subscription/services/entitlement-context';
import { MockPurchaseAdapter } from '@features/subscription/services/mock-purchase-adapter';
import type {
  PricedOffer,
  PurchaseAdapter,
  PurchaseResult,
  RestoreResult,
} from '@features/subscription/services/purchase-adapter';

import { mockRouter } from '../../../../jest.setup';
import { profileCopy } from '../profile-copy';
import { FamilyMembershipScreen } from '../screens/family-membership-screen';

/**
 * Family & Membership — what it says on each plan, and what it refuses to say on any of them.
 *
 * Every plan presentation is driven by an injected adapter in a known state, which is the only
 * honest way to render a paid plan in this build: no store products exist, so a paid entitlement
 * cannot be *acquired*. It can only be supplied as a fixture, and it is supplied here at the
 * adapter — the same seam the screenshot harness uses — rather than by handing the screen a
 * pre-baked presentation object it would otherwise have computed itself.
 */

function entitlement(plan: Entitlement['plan'], overrides: Partial<Entitlement> = {}): Entitlement {
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
    ...overrides,
  };
}

type Seats = { used: number; limit: number; pendingInvitations: number };

async function renderScreen(
  current: Entitlement,
  options: { readonly seats?: Seats } = {},
): Promise<MockPurchaseAdapter> {
  const adapter = new MockPurchaseAdapter({
    initialEntitlement: current,
    ...(options.seats === undefined ? {} : { initialSeatUsage: options.seats }),
  });

  await render(
    <AuthProvider>
      <EntitlementProvider adapter={adapter}>
        <FamilyMembershipScreen />
      </EntitlementProvider>
    </AuthProvider>,
  );

  await waitFor(() => expect(screen.getByTestId('family-membership-plan-name')).toBeTruthy());
  return adapter;
}

/** An adapter whose entitlement never arrives, for the unresolved and failed states. */
class NeverResolvingAdapter implements PurchaseAdapter {
  readonly id = 'mock' as const;
  readonly canTransact = false;

  async getOffers(): Promise<readonly PricedOffer[]> {
    return [];
  }

  getEntitlement(): Promise<Entitlement> {
    return new Promise<Entitlement>(() => undefined);
  }

  async purchase(): Promise<PurchaseResult> {
    return { outcome: 'error' };
  }

  async restore(): Promise<RestoreResult> {
    return { outcome: 'error' };
  }

  async openManagement(): Promise<boolean> {
    return false;
  }
}

describe('the header', () => {
  it('is titled Family & Membership and returns to Profile Home', async () => {
    await renderScreen(entitlement('free'));

    expect(screen.getByTestId('family-membership-header-title')).toHaveTextContent(
      'Family & Membership',
    );
    await fireEvent.press(screen.getByTestId('family-membership-header-back'));

    // Profile Home, not Main Home.
    expect(mockRouter.dismissTo).toHaveBeenCalledWith('/profile');
    expect(mockRouter.dismissTo).not.toHaveBeenCalledWith('/home');
  });

  it('offers no Help control, because there is no membership help destination', async () => {
    await renderScreen(entitlement('free'));

    expect(screen.queryByTestId('family-membership-header-help')).toBeNull();
    // The slot is held open so the centred title stays centred.
    expect(screen.getByTestId('family-membership-header-help-spacer')).toBeTruthy();
  });
});

describe('a free account', () => {
  it('states the plan and that faith is always free', async () => {
    await renderScreen(entitlement('free'));

    expect(screen.getByTestId('family-membership-plan-name')).toHaveTextContent('Free');
    expect(screen.getByTestId('family-membership-supporting')).toHaveTextContent(
      'Faith is always free.',
    );
  });

  it('summarises both paid plans', async () => {
    await renderScreen(entitlement('free'));

    expect(screen.getByTestId('family-membership-single-summary-label')).toHaveTextContent(
      'Premium Single',
    );
    expect(screen.getByTestId('family-membership-family-summary-label')).toHaveTextContent(
      'Premium Family',
    );
  });

  it('explains the six-account capacity in the approved wording', async () => {
    await renderScreen(entitlement('free'));

    expect(screen.getByTestId('family-membership-family-summary-supporting')).toHaveTextContent(
      'Premium Family supports six accounts: one organizer and five additional members.',
    );
  });

  it('offers View Premium Plans and Restore Purchases', async () => {
    await renderScreen(entitlement('free'));

    expect(screen.getByTestId('family-membership-primary')).toHaveTextContent('View Premium Plans');
    expect(screen.getByTestId('family-membership-restore')).toHaveTextContent('Restore Purchases');
  });

  it('shows no family roster, seat count or organizer', async () => {
    await renderScreen(entitlement('free'));

    for (const absent of [
      'family-membership-family-section',
      'family-membership-organizer',
      'family-membership-seats',
      'family-membership-pending',
    ]) {
      expect(screen.queryByTestId(absent)).toBeNull();
    }
    // The development fixture's hardcoded organizer must never surface here.
    expect(screen.queryByText('Ahmed Al-Rashid')).toBeNull();
  });

  it('shows no billing period or renewal date', async () => {
    await renderScreen(entitlement('free'));

    expect(screen.queryByTestId('family-membership-billing-period')).toBeNull();
    expect(screen.queryByTestId('family-membership-renewal')).toBeNull();
  });
});

describe('Premium Single', () => {
  it('states the plan, its real billing period and its real renewal date', async () => {
    await renderScreen(entitlement('premium_single'));

    expect(screen.getByTestId('family-membership-plan-name')).toHaveTextContent('Premium Single');
    expect(screen.getByTestId('family-membership-supporting')).toHaveTextContent(
      'All NoorLife modules are available.',
    );
    expect(screen.getByTestId('family-membership-billing-period')).toHaveTextContent(
      'Billed yearly',
    );
    expect(screen.getByTestId('family-membership-renewal')).toHaveTextContent(
      'Renews 1 March 2027',
    );
  });

  it('invents no renewal date when the provider reported none', async () => {
    await renderScreen(entitlement('premium_single', { currentPeriodEnd: null }));

    expect(screen.queryByTestId('family-membership-renewal')).toBeNull();
    for (const invented of ['Renews soon', 'Renews monthly', 'Renews next month']) {
      expect(screen.queryByText(invented)).toBeNull();
    }
  });

  it('offers Manage Plan as its primary action', async () => {
    await renderScreen(entitlement('premium_single'));
    expect(screen.getByTestId('family-membership-primary')).toHaveTextContent('Manage Plan');
  });

  it('explains that Family adds five additional accounts, and offers the route there', async () => {
    await renderScreen(entitlement('premium_single'));

    expect(screen.getByTestId('family-membership-family-adds')).toHaveTextContent(
      'Premium Family adds five additional accounts.',
    );
    expect(screen.getByTestId('family-membership-upgrade-capacity')).toHaveTextContent(
      'Premium Family supports six accounts: one organizer and five additional members.',
    );
    expect(screen.getByTestId('family-membership-view-family')).toHaveTextContent(
      'View Premium Family',
    );
  });

  it('shows no family section, because a single plan has no family', async () => {
    await renderScreen(entitlement('premium_single'));

    expect(screen.queryByTestId('family-membership-family-section')).toBeNull();
    expect(screen.queryByTestId('family-membership-seats')).toBeNull();
  });
});

describe('Premium Family', () => {
  it('states the plan and its six-account capacity', async () => {
    await renderScreen(entitlement('premium_family'));

    expect(screen.getByTestId('family-membership-plan-name')).toHaveTextContent('Premium Family');
    expect(screen.getByTestId('family-membership-supporting')).toHaveTextContent(
      'Premium Family supports six accounts: one organizer and five additional members.',
    );
  });

  it('renders the real seat usage when the provider reports it', async () => {
    await renderScreen(entitlement('premium_family'), {
      seats: { used: 3, limit: 6, pendingInvitations: 0 },
    });

    await waitFor(() =>
      expect(screen.getByTestId('family-membership-seats')).toHaveTextContent(
        '3 of 6 accounts in use',
      ),
    );
  });

  it('names the signed-in organizer, which is real data', async () => {
    await renderScreen(entitlement('premium_family', { isFamilyOrganizer: true }));

    // The authenticated session's own name — not a fixture, and not another family's organizer.
    await waitFor(() =>
      expect(screen.getByTestId('family-membership-organizer-value')).toHaveTextContent(
        'Ahmed Al-Rashid',
      ),
    );
  });

  it('names no organizer for a member of someone else’s family', async () => {
    await renderScreen(entitlement('premium_family', { isFamilyOrganizer: false }));
    expect(screen.queryByTestId('family-membership-organizer')).toBeNull();
  });

  it('states the missing family backend rather than inventing a roster', async () => {
    await renderScreen(entitlement('premium_family'));

    expect(screen.getByTestId('family-membership-backend-missing')).toHaveTextContent(
      'Family membership management will be available when store subscriptions and family invitations are connected.',
    );
  });

  it('lists no members, no invitations and no seat avatars', async () => {
    await renderScreen(entitlement('premium_family'), {
      seats: { used: 3, limit: 6, pendingInvitations: 0 },
    });

    // The `/family/*` screens' fixture people and their controls must not appear here.
    for (const absent of ['Remove', 'Invite a family member', 'Resend', 'Cancel invitation']) {
      expect(screen.queryByText(absent)).toBeNull();
    }
    expect(screen.queryByTestId('family-membership-seats-seat-0')).toBeNull();
  });

  it('reports pending invitations only when the provider reports real ones', async () => {
    await renderScreen(entitlement('premium_family'), {
      seats: { used: 2, limit: 6, pendingInvitations: 0 },
    });
    expect(screen.queryByTestId('family-membership-pending')).toBeNull();
  });

  it('renders real pending invitations when there are some', async () => {
    await renderScreen(entitlement('premium_family'), {
      seats: { used: 2, limit: 6, pendingInvitations: 2 },
    });

    await waitFor(() =>
      expect(screen.getByTestId('family-membership-pending')).toHaveTextContent(
        '2 invitations waiting to be accepted',
      ),
    );
  });

  it('explains Manage Family honestly instead of opening a development fixture', async () => {
    await renderScreen(entitlement('premium_family'));

    await fireEvent.press(screen.getByTestId('family-membership-manage-family'));

    expect(await screen.findByTestId('family-membership-coming-later-panel')).toBeTruthy();
    expect(screen.getByText('Manage Family is coming later')).toBeTruthy();
    // Nothing was pushed: `/family/members` is the fixture-backed seat manager.
    expect(mockRouter.push).not.toHaveBeenCalled();
  });

  it('keeps Manage Plan and Restore Purchases available', async () => {
    await renderScreen(entitlement('premium_family'));

    expect(screen.getByTestId('family-membership-primary')).toHaveTextContent('Manage Plan');
    expect(screen.getByTestId('family-membership-restore')).toBeTruthy();
  });
});

describe('the purchase actions', () => {
  it('opens the existing chooser from View Premium Plans', async () => {
    await renderScreen(entitlement('free'));
    await fireEvent.press(screen.getByTestId('family-membership-primary'));

    expect(mockRouter.push).toHaveBeenCalledWith('/subscription');
  });

  it('opens the existing management destination from Manage Plan', async () => {
    await renderScreen(entitlement('premium_single'));
    await fireEvent.press(screen.getByTestId('family-membership-primary'));

    expect(mockRouter.push).toHaveBeenCalledWith('/settings/subscription');
  });

  it('opens the existing Premium Family details screen', async () => {
    await renderScreen(entitlement('premium_single'));
    await fireEvent.press(screen.getByTestId('family-membership-view-family'));

    expect(mockRouter.push).toHaveBeenCalledWith('/subscription/family?period=yearly');
  });

  it('runs the existing restore service and reports what it returned', async () => {
    const adapter = await renderScreen(entitlement('free'));
    const restore = jest.spyOn(adapter, 'restore');

    await fireEvent.press(screen.getByTestId('family-membership-restore'));

    await waitFor(() => expect(restore).toHaveBeenCalledTimes(1));
    // A free account with no prior purchase: informational, not an error, and not a fake success.
    expect(
      await screen.findByTestId('family-membership-restore-nothing_to_restore'),
    ).toHaveTextContent('No previous purchases found');
  });

  it('reports a restore failure honestly rather than claiming success', async () => {
    const adapter = await renderScreen(entitlement('free'));
    jest.spyOn(adapter, 'restore').mockResolvedValue({ outcome: 'offline' });

    await fireEvent.press(screen.getByTestId('family-membership-restore'));

    expect(await screen.findByTestId('family-membership-restore-offline')).toHaveTextContent(
      'You are offline',
    );
    // The plan did not change, and nothing said it did.
    expect(screen.getByTestId('family-membership-plan-name')).toHaveTextContent('Free');
  });

  it('reports a rejected restore as an error rather than crashing', async () => {
    const adapter = await renderScreen(entitlement('free'));
    jest.spyOn(adapter, 'restore').mockRejectedValue(new Error('transport'));

    await fireEvent.press(screen.getByTestId('family-membership-restore'));

    expect(await screen.findByTestId('family-membership-restore-error')).toHaveTextContent(
      'Something went wrong',
    );
    expect(screen.queryByTestId('family-membership-restore-restored')).toBeNull();
  });

  it('writes no entitlement of its own', async () => {
    const adapter = await renderScreen(entitlement('free'));
    const purchase = jest.spyOn(adapter, 'purchase');

    await fireEvent.press(screen.getByTestId('family-membership-primary'));
    await fireEvent.press(screen.getByTestId('family-membership-restore'));

    // This screen sends the user to the flows that can transact; it never grants access itself.
    expect(purchase).not.toHaveBeenCalled();
  });
});

describe('while the plan is unknown', () => {
  it('never draws a plan it has not resolved', async () => {
    await render(
      <AuthProvider>
        <EntitlementProvider adapter={new NeverResolvingAdapter()}>
          <FamilyMembershipScreen />
        </EntitlementProvider>
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('family-membership-loading')).toBeTruthy());
    expect(screen.queryByTestId('family-membership-plan-name')).toBeNull();
    for (const invented of ['Free', 'Premium Single', 'Premium Family', 'Faith is always free.']) {
      expect(screen.queryByText(invented)).toBeNull();
    }
    expect(screen.getByLabelText('Loading your plan')).toBeTruthy();
  });

  it('offers a retry once the wait has gone on long enough to be a failure', async () => {
    jest.useFakeTimers();
    try {
      await render(
        <AuthProvider>
          <EntitlementProvider adapter={new NeverResolvingAdapter()}>
            <FamilyMembershipScreen />
          </EntitlementProvider>
        </AuthProvider>,
      );
      await waitFor(() => expect(screen.getByTestId('family-membership-loading')).toBeTruthy());

      jest.advanceTimersByTime(6001);

      await waitFor(() =>
        expect(screen.getByTestId('family-membership-unavailable-title')).toBeTruthy(),
      );
      expect(screen.getByTestId('family-membership-unavailable-supporting')).toHaveTextContent(
        'Your access has not changed.',
      );
      expect(screen.getByTestId('family-membership-retry')).toHaveTextContent('Retry');
      // Still no invented plan.
      expect(screen.queryByText('Faith is always free.')).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('the development marker', () => {
  it('is shown while purchases are simulated, and gated on a development build', async () => {
    await renderScreen(entitlement('free'));

    // The jest adapter cannot transact, so this is the development presentation.
    expect(screen.getByTestId('family-membership-dev-badge')).toHaveTextContent(
      profileCopy.membership.devBadge,
    );
    // Not the old permanent full-width sentence.
    expect(screen.queryByText('Development mock — purchases are simulated')).toBeNull();
  });

  it('cannot render in a release bundle, whatever the adapter reports', () => {
    const source = readFileSync(
      join(__dirname, '..', 'screens', 'family-membership-screen.tsx'),
      'utf8',
    );
    // `__DEV__` is checked at the render site, so a production bundle strips the badge entirely.
    // Gating at the call site instead would leave a release build one forgotten prop away from
    // telling a paying customer their purchase was simulated.
    expect(source).toContain('isMockMode && __DEV__');
  });
});

describe('accessibility and layout', () => {
  it('gives every control at least a 44 dp target', async () => {
    await renderScreen(entitlement('premium_family'));

    for (const id of [
      'family-membership-primary',
      'family-membership-restore',
      'family-membership-manage-family',
    ]) {
      const style = screen.getByTestId(id).props.style;
      const flat = Array.isArray(style) ? Object.assign({}, ...style.filter(Boolean)) : style;
      expect(flat.height ?? flat.minHeight).toBeGreaterThanOrEqual(44);
    }
  });

  it('scrolls rather than clipping when content or text grows', async () => {
    await renderScreen(entitlement('premium_family'));
    expect(screen.getByTestId('family-membership-scroll')).toBeTruthy();
  });

  it('associates the labelled rows with their values', async () => {
    await renderScreen(entitlement('premium_family', { isFamilyOrganizer: true }));

    await waitFor(() => expect(screen.getByLabelText('Organizer, Ahmed Al-Rashid')).toBeTruthy());
  });
});
