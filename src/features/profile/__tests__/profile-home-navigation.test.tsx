import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { AuthProvider } from '@application/providers/auth-provider';
import { PLAN_CAPABILITIES, type Entitlement } from '@features/subscription/domain/entitlement';
import { EntitlementProvider } from '@features/subscription/services/entitlement-context';
import { MockPurchaseAdapter } from '@features/subscription/services/mock-purchase-adapter';

import { mockRouter } from '../../../../jest.setup';
import { PROFILE_MENU } from '../profile-routes';
import { ProfileHomeScreen } from '../screens/profile-home-screen';

/**
 * Where Profile Home goes, and what it does instead when there is nowhere to go.
 *
 * The rule under test is the one in `profile-routes.ts`: a row with an existing destination
 * navigates, and a row without one opens the centralized note naming itself. No row is inert, and
 * no row pushes a route that is not there.
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

async function renderProfile(plan: Entitlement['plan'] = 'free') {
  await render(
    <AuthProvider>
      <EntitlementProvider
        adapter={new MockPurchaseAdapter({ initialEntitlement: entitlement(plan) })}
      >
        <ProfileHomeScreen />
      </EntitlementProvider>
    </AuthProvider>,
  );

  await waitFor(
    () => {
      expect(screen.getByTestId('profile-identity-name')).toBeTruthy();
      expect(screen.getByTestId('profile-membership-title')).toBeTruthy();
    },
    // The session and the entitlement each resolve through several awaited hops; the default
    // one-second budget is marginal once a file has a dozen renders behind it.
    { timeout: 5000 },
  );
}

describe('the header', () => {
  it('returns to Main Home', async () => {
    await renderProfile();
    await fireEvent.press(screen.getByTestId('profile-header-back'));

    // `dismissTo`, the same rule the module headers use: pop to Main Home when it is on the stack,
    // replace when it is not, so any entry point produces the same visible outcome.
    expect(mockRouter.dismissTo).toHaveBeenCalledWith('/home');
  });

  it('opens Profile’s own help screen rather than a dead tap', async () => {
    await renderProfile();
    await fireEvent.press(screen.getByTestId('profile-header-help'));

    // The same destination as the Help & Support row: one help screen, two ways to ask for it.
    // The loop is closed on `/profile/help` itself, which renders no Help control.
    expect(mockRouter.push).toHaveBeenCalledWith('/profile/help');
  });
});

describe('the membership actions', () => {
  it('opens the subscription chooser from View Premium', async () => {
    await renderProfile('free');
    await fireEvent.press(screen.getByTestId('profile-membership-primary'));

    expect(mockRouter.push).toHaveBeenCalledWith('/subscription');
  });

  it('opens the existing manage destination from Manage Plan', async () => {
    await renderProfile('premium_single');
    await fireEvent.press(screen.getByTestId('profile-membership-primary'));

    expect(mockRouter.push).toHaveBeenCalledWith('/settings/subscription');
  });

  it('hands Restore Purchases to the existing restore flow', async () => {
    await renderProfile('free');
    await fireEvent.press(screen.getByTestId('profile-membership-restore'));

    // The restore screen runs the real handler and reports its own outcome; nothing here
    // fabricates a success.
    expect(mockRouter.push).toHaveBeenCalledWith('/subscription/restore');
  });
});

describe('the five menu rows', () => {
  it('opens the edit screen from Personal Information', async () => {
    await renderProfile();
    await fireEvent.press(screen.getByTestId('profile-menu-personal-information'));

    expect(mockRouter.push).toHaveBeenCalledWith('/profile/edit');
  });

  it('opens the membership detail screen from Family & Membership', async () => {
    await renderProfile();
    await fireEvent.press(screen.getByTestId('profile-menu-family-membership'));

    // Built in Phase 6C-2A. The centralized note is gone from this row because the screen exists.
    expect(mockRouter.push).toHaveBeenCalledWith('/profile/family-membership');
    expect(screen.queryByTestId('profile-coming-later-panel')).toBeNull();
  });

  it('opens the preferences screen from Preferences', async () => {
    await renderProfile();
    await fireEvent.press(screen.getByTestId('profile-menu-preferences'));

    // Built in Phase 6C-2B. The centralized note is gone from this row because the screen exists.
    expect(mockRouter.push).toHaveBeenCalledWith('/profile/preferences');
    expect(screen.queryByTestId('profile-coming-later-panel')).toBeNull();
  });

  it('opens Profile’s own help screen from Help & Support', async () => {
    await renderProfile();
    await fireEvent.press(screen.getByTestId('profile-menu-help-support'));

    expect(mockRouter.push).toHaveBeenCalledWith('/profile/help');
  });

  it('opens the privacy and security screen from Privacy & Security', async () => {
    await renderProfile();
    await fireEvent.press(screen.getByTestId('profile-menu-privacy-security'));

    // Built in Phase 6C-3A. The centralized note is gone from this row because the screen exists.
    expect(mockRouter.push).toHaveBeenCalledWith('/profile/privacy-security');
    expect(screen.queryByTestId('profile-coming-later-panel')).toBeNull();
  });

  it('leaves no row on the centralized note, now that all five destinations exist', async () => {
    await renderProfile();

    for (const row of PROFILE_MENU) {
      await fireEvent.press(screen.getByTestId(row.testID));
      // The note is the honest answer for a destination that does not exist. None remain, so it
      // must never appear — and the mechanism is kept rather than deleted, for the next deferral.
      expect(screen.queryByTestId('profile-coming-later-panel')).toBeNull();
    }
    expect(mockRouter.push).toHaveBeenCalledTimes(PROFILE_MENU.length);
  });

  it('records the future destination for every row, so the placeholder is swappable', () => {
    expect(PROFILE_MENU.map((item) => item.intended)).toEqual([
      '/profile/edit',
      '/profile/family-membership',
      '/profile/preferences',
      '/profile/privacy-security',
      '/profile/help',
    ]);
  });
});

describe('the identity card’s Edit action', () => {
  it('opens the existing edit route', async () => {
    await renderProfile();
    await fireEvent.press(screen.getByTestId('profile-identity-edit'));

    expect(mockRouter.push).toHaveBeenCalledWith('/profile/edit');
  });
});

describe('logging out', () => {
  it('asks before doing anything', async () => {
    await renderProfile();
    await fireEvent.press(screen.getByTestId('profile-log-out'));

    expect(await screen.findByTestId('profile-log-out-confirm-panel')).toBeTruthy();
    expect(screen.getByText('Log out of NoorLife?')).toBeTruthy();
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  it('keeps the session when the confirmation is cancelled', async () => {
    await renderProfile();
    await fireEvent.press(screen.getByTestId('profile-log-out'));
    await fireEvent.press(await screen.findByTestId('profile-log-out-confirm-cancel'));

    await waitFor(() => expect(screen.queryByTestId('profile-log-out-confirm-panel')).toBeNull());
    expect(mockRouter.replace).not.toHaveBeenCalled();
    expect(mockRouter.dismissAll).not.toHaveBeenCalled();
    // Still signed in: the authenticated identity is still on screen.
    expect(screen.getByTestId('profile-identity-name')).toHaveTextContent('Ahmed Al-Rashid');
  });

  it('keeps the session when the scrim is tapped', async () => {
    await renderProfile();
    await fireEvent.press(screen.getByTestId('profile-log-out'));
    await fireEvent.press(await screen.findByTestId('profile-log-out-confirm-scrim'));

    await waitFor(() => expect(screen.queryByTestId('profile-log-out-confirm-panel')).toBeNull());
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  it('calls the real sign-out service and lands on Authentication', async () => {
    await renderProfile();
    await fireEvent.press(screen.getByTestId('profile-log-out'));
    await fireEvent.press(await screen.findByTestId('profile-log-out-confirm-accept'));

    // The navigation only happens after `AuthProvider.signOut` — the real service, through the
    // real provider — has resolved. A stubbed or skipped sign-out would never reach this.
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/welcome'));
  });

  it('leaves no protected screen behind to go Back to', async () => {
    await renderProfile();
    await fireEvent.press(screen.getByTestId('profile-log-out'));
    await fireEvent.press(await screen.findByTestId('profile-log-out-confirm-accept'));

    await waitFor(() => expect(mockRouter.dismissAll).toHaveBeenCalled());
    // Replaced, never pushed: Profile is gone from history and the stack beneath it is cleared.
    expect(mockRouter.replace).toHaveBeenCalledWith('/welcome');
    expect(mockRouter.push).not.toHaveBeenCalledWith('/welcome');
  });
});
