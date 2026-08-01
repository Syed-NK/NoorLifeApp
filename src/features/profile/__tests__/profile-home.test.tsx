import { render, screen, waitFor, within } from '@testing-library/react-native';

import { AuthProvider } from '@application/providers/auth-provider';
import { PLAN_CAPABILITIES, type Entitlement } from '@features/subscription/domain/entitlement';
import { EntitlementProvider } from '@features/subscription/services/entitlement-context';
import { MockPurchaseAdapter } from '@features/subscription/services/mock-purchase-adapter';

import { PROFILE_LAYOUT } from '../profile-metrics';
import { PROFILE_MENU } from '../profile-routes';
import { ProfileHomeScreen } from '../screens/profile-home-screen';

/**
 * Compact Profile Home — layout and data.
 *
 * The jest environment signs in as Ahmed Al-Rashid / ahmed@example.com (see jest.setup.ts), so the
 * identity assertions are against a real authenticated session rather than a fixture the screen
 * was handed.
 */

const SESSION_NAME = 'Ahmed Al-Rashid';
const SESSION_EMAIL = 'ahmed@example.com';

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

async function renderProfile(
  current: Entitlement,
  options: { readonly seats?: { used: number; limit: number; pendingInvitations: number } } = {},
) {
  const adapter = new MockPurchaseAdapter({
    initialEntitlement: current,
    ...(options.seats === undefined ? {} : { initialSeatUsage: options.seats }),
  });

  const utils = await render(
    <AuthProvider>
      <EntitlementProvider adapter={adapter}>
        <ProfileHomeScreen />
      </EntitlementProvider>
    </AuthProvider>,
  );

  // The session and the entitlement resolve on separate async chains; wait for both so no
  // assertion below is reading a loading frame by accident.
  await waitFor(() => {
    expect(screen.getByTestId('profile-identity-name')).toBeTruthy();
    expect(screen.getByTestId('profile-membership-title')).toBeTruthy();
  });
  return utils;
}

/** The membership card's declared minimum height, read back off the rendered card. */
function membershipMinHeight(): number {
  const style = screen.getByTestId('profile-membership').props.style;
  const flat = Array.isArray(style) ? Object.assign({}, ...style.filter(Boolean)) : style;
  return flat.minHeight as number;
}

describe('the compact layout', () => {
  it('renders the five sections in the order the brief fixes', async () => {
    await renderProfile(entitlement('free'));

    for (const id of [
      'profile-header',
      'profile-identity',
      'profile-membership',
      'profile-menu',
      'profile-log-out',
    ]) {
      expect(screen.getByTestId(id)).toBeTruthy();
    }
  });

  it('offers exactly five primary menu rows', async () => {
    await renderProfile(entitlement('free'));

    const menu = screen.getByTestId('profile-menu');
    const rows = within(menu).getAllByRole('menuitem');
    expect(rows).toHaveLength(5);
    expect(PROFILE_MENU).toHaveLength(5);
  });

  it('names them Personal Information, Family & Membership, Preferences, Privacy & Security and Help & Support', async () => {
    await renderProfile(entitlement('free'));

    expect(screen.getByTestId('profile-menu-personal-information-label')).toHaveTextContent(
      'Personal Information',
    );
    expect(screen.getByTestId('profile-menu-family-membership-label')).toHaveTextContent(
      'Family & Membership',
    );
    expect(screen.getByTestId('profile-menu-preferences-label')).toHaveTextContent('Preferences');
    expect(screen.getByTestId('profile-menu-privacy-security-label')).toHaveTextContent(
      'Privacy & Security',
    );
    expect(screen.getByTestId('profile-menu-help-support-label')).toHaveTextContent(
      'Help & Support',
    );
  });

  it('leaves none of the legacy long list behind', async () => {
    await renderProfile(entitlement('free'));

    // The seven titled sections and the settings rows that used to live directly on this screen.
    for (const gone of [
      'profile-section-account',
      'profile-section-subscription',
      'profile-section-family',
      'profile-section-preferences',
      'profile-section-privacy',
      'profile-section-help',
      'profile-section-session',
      'row-notifications',
      'row-language',
      'row-appearance',
      'row-accessibility',
      'row-download',
      'row-delete-account',
      'row-terms',
      'row-privacy-policy',
      'row-about',
      'row-current-plan',
      'row-billing-period',
      'row-seats',
    ]) {
      expect(screen.queryByTestId(gone)).toBeNull();
    }
  });

  it('keeps Delete Account off the summary entirely', async () => {
    await renderProfile(entitlement('free'));
    expect(screen.queryByText('Delete Account')).toBeNull();
  });

  it('replaces the tall full-width Edit Profile button with a compact control', async () => {
    await renderProfile(entitlement('free'));

    const edit = screen.getByTestId('profile-identity-edit');
    expect(edit).toHaveTextContent('Edit');
    expect(screen.queryByText('Edit Profile')).toBeNull();

    // Compact: it is 30 dp tall and reaches 44 dp through hit slop, and it does not span the card.
    const style = Array.isArray(edit.props.style)
      ? Object.assign({}, ...edit.props.style.filter(Boolean))
      : edit.props.style;
    expect(style.minHeight).toBe(PROFILE_LAYOUT.identity.editHeight);
    expect(style.width).toBeUndefined();
    expect(edit.props.hitSlop).toEqual({ top: 7, bottom: 7, left: 7, right: 7 });
  });

  it('sizes every card with minHeight, so large text expands rather than clips', async () => {
    await renderProfile(entitlement('free'));

    const cards: readonly [string, number][] = [
      ['profile-identity', PROFILE_LAYOUT.identity.height],
      ['profile-membership', PROFILE_LAYOUT.membership.height],
      ['profile-log-out', PROFILE_LAYOUT.logout.height],
    ];

    for (const [id, expected] of cards) {
      const node = screen.getByTestId(id);
      const style = Array.isArray(node.props.style)
        ? Object.assign({}, ...node.props.style.filter(Boolean))
        : node.props.style;
      expect(style.minHeight).toBe(expected);
      // A fixed height is what clips; there must not be one.
      expect(style.height).toBeUndefined();
    }
  });

  it('gives every menu row at least a 44 dp target', async () => {
    await renderProfile(entitlement('free'));

    for (const item of PROFILE_MENU) {
      const row = screen.getByTestId(item.testID);
      const style = Array.isArray(row.props.style)
        ? Object.assign({}, ...row.props.style.filter(Boolean))
        : row.props.style;
      expect(style.minHeight).toBeGreaterThanOrEqual(44);
    }
  });

  it('does not scroll before anything has overflowed', async () => {
    await renderProfile(entitlement('free'));
    // No layout has been measured in the test renderer, so there is nothing to scroll to.
    expect(screen.getByTestId('profile-home-scroll').props.scrollEnabled).toBe(false);
  });
});

describe('the identity card', () => {
  it('shows the authenticated name and email, not a hardcoded one', async () => {
    await renderProfile(entitlement('free'));

    expect(screen.getByTestId('profile-identity-name')).toHaveTextContent(SESSION_NAME);
    expect(screen.getByTestId('profile-identity-email')).toHaveTextContent(SESSION_EMAIL);

    // The names the previous build shipped with, and the ones a fixture would reach for.
    for (const invented of ['test', 'Syed Gmail', 'user@example.com', 'Test User']) {
      expect(screen.queryByText(invented)).toBeNull();
    }
  });

  it('keeps a long name and a long address to one line each, with the full value read aloud', async () => {
    await renderProfile(entitlement('free'));

    const name = screen.getByTestId('profile-identity-name');
    const email = screen.getByTestId('profile-identity-email');

    expect(name.props.numberOfLines).toBe(1);
    expect(email.props.numberOfLines).toBe(1);
    expect(name.props.ellipsizeMode).toBe('tail');
    expect(email.props.ellipsizeMode).toBe('tail');
    // Truncation is visual only: the complete value stays available to assistive technology.
    expect(name.props.accessibilityLabel).toContain(SESSION_NAME);
    expect(email.props.accessibilityLabel).toContain(SESSION_EMAIL);
  });

  it('reads a free plan badge from live entitlement', async () => {
    await renderProfile(entitlement('free'));
    expect(screen.getByTestId('profile-identity-plan-badge')).toHaveTextContent('Free');
  });

  it('reads a paid plan badge from live entitlement', async () => {
    await renderProfile(entitlement('premium_family'));
    expect(screen.getByTestId('profile-identity-plan-badge')).toHaveTextContent('Premium Family');
  });
});

describe('the membership card', () => {
  it('states the Free plan wording and offers both actions', async () => {
    await renderProfile(entitlement('free'));

    expect(screen.getByTestId('profile-membership-title')).toHaveTextContent('Free plan');
    expect(screen.getByTestId('profile-membership-supporting')).toHaveTextContent(
      'Faith is always free.',
    );
    expect(screen.getByTestId('profile-membership-primary')).toHaveTextContent('View Premium');
    expect(screen.getByTestId('profile-membership-restore')).toHaveTextContent('Restore Purchases');
    expect(screen.queryByTestId('profile-membership-fact')).toBeNull();
  });

  it('states the Premium Single wording with its real renewal date', async () => {
    await renderProfile(entitlement('premium_single'));

    expect(screen.getByTestId('profile-membership-title')).toHaveTextContent('Premium Single');
    expect(screen.getByTestId('profile-membership-supporting')).toHaveTextContent(
      'All NoorLife modules are available.',
    );
    expect(screen.getByTestId('profile-membership-primary')).toHaveTextContent('Manage Plan');
    expect(screen.getByTestId('profile-membership-fact')).toHaveTextContent('Renews 1 March 2027');
  });

  it('omits the renewal line entirely when there is no verified date', async () => {
    await renderProfile(entitlement('premium_single', { currentPeriodEnd: null }));

    expect(screen.getByTestId('profile-membership-title')).toHaveTextContent('Premium Single');
    expect(screen.queryByTestId('profile-membership-fact')).toBeNull();
  });

  it('states the Premium Family wording with real seat usage', async () => {
    await renderProfile(entitlement('premium_family'), {
      seats: { used: 3, limit: 6, pendingInvitations: 0 },
    });

    expect(screen.getByTestId('profile-membership-title')).toHaveTextContent('Premium Family');
    expect(screen.getByTestId('profile-membership-supporting')).toHaveTextContent(
      'Share with up to five additional family members.',
    );
    await waitFor(() =>
      expect(screen.getByTestId('profile-membership-fact')).toHaveTextContent('3 of 6 seats'),
    );
  });

  it.each(['free', 'premium_single', 'premium_family'] as const)(
    'gives the %s card the same 112 dp geometry',
    async (plan) => {
      await renderProfile(entitlement(plan));
      expect(membershipMinHeight()).toBe(PROFILE_LAYOUT.membership.height);
    },
  );

  it('shows the development marker as a badge, never the old permanent sentence', async () => {
    // The jest adapter is the mock, so this is the development presentation.
    await renderProfile(entitlement('free'));

    expect(screen.getByTestId('profile-membership-dev-badge')).toHaveTextContent('DEV');
    expect(screen.queryByText('Development mock — purchases are simulated')).toBeNull();
  });
});
