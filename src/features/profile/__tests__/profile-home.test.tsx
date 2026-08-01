import { render, screen, waitFor } from '@testing-library/react-native';

import { AuthProvider } from '@application/providers/auth-provider';
import { PLAN_CAPABILITIES, type Entitlement } from '@features/subscription/domain/entitlement';
import { EntitlementProvider } from '@features/subscription/services/entitlement-context';
import { MockPurchaseAdapter } from '@features/subscription/services/mock-purchase-adapter';

import { ProfileHomeScreen } from '../screens/profile-home-screen';

/**
 * The Profile home.
 *
 * Covers the three plan presentations and the rule that no row may be shown that does nothing.
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

async function renderProfile(current: Entitlement) {
  return render(
    <AuthProvider>
      <EntitlementProvider adapter={new MockPurchaseAdapter({ initialEntitlement: current })}>
        <ProfileHomeScreen />
      </EntitlementProvider>
    </AuthProvider>,
  );
}

describe('the identity card', () => {
  it('shows the account, its email and its plan badge', async () => {
    await renderProfile(entitlement('free'));

    await waitFor(() => expect(screen.getByTestId('profile-identity')).toBeTruthy());
    expect(screen.getByTestId('profile-plan-badge')).toBeTruthy();
    expect(screen.getByTestId('profile-edit')).toBeTruthy();
  });
});

describe('a free user', () => {
  it('is told Faith is free and offered the plans, with no invented renewal date', async () => {
    await renderProfile(entitlement('free'));

    await waitFor(() => expect(screen.getByTestId('row-view-premium')).toBeTruthy());
    expect(screen.getByTestId('row-faith-free')).toBeTruthy();
    // The regression this guards: showing a renewal row for an account that has no subscription.
    expect(screen.queryByTestId('row-renewal')).toBeNull();
    expect(screen.queryByTestId('row-manage-subscription')).toBeNull();
  });

  it('sees the family plan explained rather than fake members', async () => {
    await renderProfile(entitlement('free'));

    await waitFor(() => expect(screen.getByTestId('row-family-pitch')).toBeTruthy());
    expect(screen.getByTestId('row-view-family')).toBeTruthy();
    expect(screen.queryByTestId('row-seats')).toBeNull();
    expect(screen.queryByTestId('row-manage-family')).toBeNull();
  });

  it('can still restore purchases', async () => {
    await renderProfile(entitlement('free'));

    await waitFor(() => expect(screen.getByTestId('row-restore')).toBeTruthy());
  });
});

describe('a paid user', () => {
  it('sees status, billing period and a real renewal date', async () => {
    await renderProfile(entitlement('premium_single'));

    await waitFor(() => expect(screen.getByTestId('row-status')).toBeTruthy());
    expect(screen.getByTestId('row-billing-period')).toBeTruthy();
    expect(screen.getByTestId('row-renewal')).toBeTruthy();
    expect(screen.getByTestId('row-manage-subscription')).toBeTruthy();
  });

  it('omits the renewal row when the provider reports no date', async () => {
    // Never invent renewal information: an absent date means an absent row.
    await renderProfile(entitlement('premium_single', { currentPeriodEnd: null }));

    await waitFor(() => expect(screen.getByTestId('row-status')).toBeTruthy());
    expect(screen.queryByTestId('row-renewal')).toBeNull();
  });
});

describe('a family organizer', () => {
  it('sees seat usage and the management entry points', async () => {
    await renderProfile(entitlement('premium_family'));

    await waitFor(() => expect(screen.getByTestId('row-seats')).toBeTruthy());
    expect(screen.getByTestId('row-manage-family')).toBeTruthy();
    expect(screen.getByTestId('row-invite')).toBeTruthy();
    expect(screen.getByTestId('row-pending')).toBeTruthy();
  });
});

describe('a family member', () => {
  it('sees membership and privacy information, not management controls', async () => {
    await renderProfile(entitlement('premium_family', { isFamilyOrganizer: false }));

    await waitFor(() => expect(screen.getByTestId('row-member-notice')).toBeTruthy());
    expect(screen.getByTestId('row-family-privacy')).toBeTruthy();
    expect(screen.queryByTestId('row-invite')).toBeNull();
    expect(screen.queryByTestId('row-manage-family')).toBeNull();
  });
});

describe('every section is present', () => {
  it('renders account, subscription, family, preferences, privacy, help and session', async () => {
    await renderProfile(entitlement('free'));

    await waitFor(() => expect(screen.getByTestId('profile-section-account')).toBeTruthy());
    for (const section of ['subscription', 'family', 'preferences', 'privacy', 'help', 'session']) {
      expect(screen.getByTestId(`profile-section-${section}`)).toBeTruthy();
    }
    expect(screen.getByTestId('row-log-out')).toBeTruthy();
  });
});

describe('no misleading settings', () => {
  it('marks every not-yet-built row as coming later', async () => {
    await renderProfile(entitlement('free'));

    // Jest runs with __DEV__ true, so these render *and* must carry the marker. In production the
    // same rows are absent entirely — a missing row is honest, a dead one is not.
    await waitFor(() => expect(screen.getByTestId('row-download')).toBeTruthy());
    expect(screen.getByTestId('row-download-later')).toBeTruthy();
    expect(screen.getByTestId('row-delete-account-later')).toBeTruthy();
    expect(screen.getByTestId('row-terms-later')).toBeTruthy();
  });

  it('gives working rows no coming-later marker', async () => {
    await renderProfile(entitlement('free'));

    await waitFor(() => expect(screen.getByTestId('row-notifications')).toBeTruthy());
    expect(screen.queryByTestId('row-notifications-later')).toBeNull();
    expect(screen.queryByTestId('row-restore-later')).toBeNull();
  });
});
