import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { AuthProvider } from '@application/providers/auth-provider';
import * as authService from '@services/auth/auth.service';
import type { AuthUser, ProfileRow } from '@services/auth/auth.service';
import {
  PLAN_CAPABILITIES,
  UNKNOWN_ENTITLEMENT,
  type Entitlement,
} from '@features/subscription/domain/entitlement';
import { EntitlementProvider } from '@features/subscription/services/entitlement-context';
import { MockPurchaseAdapter } from '@features/subscription/services/mock-purchase-adapter';
import type {
  PricedOffer,
  PurchaseAdapter,
  PurchaseResult,
  RestoreResult,
} from '@features/subscription/services/purchase-adapter';

import { mockRouter } from '../../../../jest.setup';
import { ProfileIdentityCard } from '../components/profile-identity-card';
import { PROFILE_LAYOUT } from '../profile-metrics';
import { ProfileHomeScreen } from '../screens/profile-home-screen';

/**
 * The states Profile Home has to survive: no session yet, no session at all, a profile row that
 * will not load, and an entitlement that never resolves.
 *
 * The rule every one of them serves is the same — the screen may say "I do not know yet", and it
 * may say "I could not find out", but it may never fill the gap with something plausible.
 */

const SIGNED_IN: AuthUser = {
  id: 'test-user-id',
  email: 'ahmed@example.com',
  fullName: 'Ahmed Al-Rashid',
  avatarUrl: null,
  emailConfirmed: true,
};

const PROFILE_ROW: ProfileRow = {
  id: 'test-user-id',
  full_name: 'Ahmed Al-Rashid',
  avatar_url: null,
  onboarding_completed: true,
};

function freeEntitlement(): Entitlement {
  return {
    plan: 'free',
    billingPeriod: 'none',
    status: 'free',
    provider: 'development_mock',
    currentPeriodEnd: null,
    trialEnd: null,
    cancelAtPeriodEnd: false,
    isFamilyOrganizer: false,
    capabilities: PLAN_CAPABILITIES.free,
  };
}

/**
 * An adapter whose entitlement never arrives.
 *
 * This is the only way to hold the screen in its unresolved state long enough to assert that it
 * shows a skeleton rather than guessing "Free".
 */
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

async function renderProfile(adapter: PurchaseAdapter) {
  return await render(
    <AuthProvider>
      <EntitlementProvider adapter={adapter}>
        <ProfileHomeScreen />
      </EntitlementProvider>
    </AuthProvider>,
  );
}

/**
 * Spies, not a module double.
 *
 * `jest.spyOn` leaves the real module in place and is undone by `restoreAllMocks` after every
 * test, so a test that forgets to reset one cannot leak a signed-out session into the next.
 */
let getSession: jest.SpyInstance<Promise<AuthUser | null>, []>;
/**
 * The launch boundary the provider actually reads.
 *
 * `getSession` alone is no longer enough to describe a launch: it answers "who is signed in", and the
 * provider needs to know *why* nobody is — a server that said so, or a device that could not ask.
 * Spying on `resolveSession` is how each case below states which one it means.
 */
let resolveSession: jest.SpyInstance<Promise<{ kind: string; user?: AuthUser }>, []>;
let getProfile: jest.SpyInstance<Promise<ProfileRow | null>, [string]>;

beforeEach(() => {
  getSession = jest.spyOn(authService, 'getSession').mockResolvedValue(SIGNED_IN);
  resolveSession = jest
    .spyOn(authService, 'resolveSession')
    .mockResolvedValue({ kind: 'authenticated', user: SIGNED_IN }) as never;
  getProfile = jest.spyOn(authService, 'getProfile').mockResolvedValue(PROFILE_ROW);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('while the plan is still unknown', () => {
  it('never flashes Free', async () => {
    await renderProfile(new NeverResolvingAdapter());

    await waitFor(() => expect(screen.getByTestId('profile-identity-name')).toBeTruthy());

    // The entitlement is `unknown`, not free — and an unknown plan is drawn as a placeholder.
    expect(UNKNOWN_ENTITLEMENT.status).toBe('unknown');
    expect(screen.queryByTestId('profile-membership-title')).toBeNull();
    expect(screen.queryByText('Free plan')).toBeNull();
    expect(screen.queryByText('Free')).toBeNull();
    expect(screen.queryByText('View Premium')).toBeNull();
    expect(screen.queryByTestId('profile-identity-plan-badge')).toBeNull();
  });

  it('holds the membership card at its final height while it waits', async () => {
    await renderProfile(new NeverResolvingAdapter());
    await waitFor(() => expect(screen.getByTestId('profile-membership')).toBeTruthy());

    const style = screen.getByTestId('profile-membership').props.style;
    const flat = Array.isArray(style) ? Object.assign({}, ...style.filter(Boolean)) : style;
    // The same 112 dp the resolved card occupies, so resolving is invisible rather than a jump.
    expect(flat.minHeight).toBe(PROFILE_LAYOUT.membership.height);
  });

  it('announces the wait rather than leaving a silent gap', async () => {
    await renderProfile(new NeverResolvingAdapter());
    await waitFor(() => expect(screen.getByTestId('profile-membership')).toBeTruthy());

    expect(screen.getByLabelText('Loading your plan')).toBeTruthy();
  });
});

describe('when the plan load fails', () => {
  it('offers a retry instead of a permanent skeleton', async () => {
    jest.useFakeTimers();
    try {
      await renderProfile(new NeverResolvingAdapter());
      await waitFor(() => expect(screen.getByTestId('profile-membership')).toBeTruthy());

      // Past the grace period, an unresolved plan is treated as a failed one.
      jest.advanceTimersByTime(6001);

      await waitFor(() => expect(screen.getByTestId('profile-membership-title')).toBeTruthy());
      expect(screen.getByTestId('profile-membership-title')).toHaveTextContent(
        'Plan details unavailable',
      );
      expect(screen.getByTestId('profile-membership-supporting')).toHaveTextContent(
        'Your access has not changed.',
      );
      expect(screen.getByTestId('profile-membership-primary')).toHaveTextContent('Retry');
      // Still no invented plan.
      expect(screen.queryByText('Free plan')).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('when the profile row cannot be read', () => {
  it('keeps the cached session name and offers a retry', async () => {
    getProfile.mockRejectedValue(new Error('offline'));

    await renderProfile(new MockPurchaseAdapter({ initialEntitlement: freeEntitlement() }));

    await waitFor(() => expect(screen.getByTestId('profile-identity-retry')).toBeTruthy());
    // The session's own cached copy of the name — shown, not blanked and not invented.
    expect(screen.getByTestId('profile-identity-name')).toHaveTextContent('Ahmed Al-Rashid');
    expect(screen.getByTestId('profile-identity-email')).toHaveTextContent('ahmed@example.com');
  });

  it('re-reads the row when the retry is pressed', async () => {
    // Rejected for as long as it takes: `AuthProvider` reads the same row at launch, so a
    // one-shot rejection would be consumed there and never reach the card.
    getProfile.mockRejectedValue(new Error('offline'));

    await renderProfile(new MockPurchaseAdapter({ initialEntitlement: freeEntitlement() }));
    await waitFor(() => expect(screen.getByTestId('profile-identity-retry')).toBeTruthy());
    const readsBeforeRetry = getProfile.mock.calls.length;

    getProfile.mockResolvedValue(PROFILE_ROW);
    await fireEvent.press(screen.getByTestId('profile-identity-retry'));

    // The retry disappears because the row was read again, not because the state was reset.
    await waitFor(() => expect(screen.queryByTestId('profile-identity-retry')).toBeNull());
    expect(getProfile.mock.calls.length).toBeGreaterThan(readsBeforeRetry);
    expect(screen.getByTestId('profile-identity-name')).toHaveTextContent('Ahmed Al-Rashid');
  });

  it('says so plainly when there is no name or address anywhere', async () => {
    // Rendered directly, because this is a claim about the card rather than about the session:
    // given nothing, it must state the absence rather than fill it with something plausible.
    await render(
      <ProfileIdentityCard
        fullName={null}
        email={null}
        planName="Free"
        isPaidPlan={false}
        isLoading={false}
        onEdit={() => undefined}
      />,
    );

    expect(screen.getByTestId('profile-identity-name')).toHaveTextContent('Your account');
    expect(screen.getByTestId('profile-identity-email')).toHaveTextContent('No email on file');
  });
});

describe('when nobody is signed in', () => {
  it('routes to Authentication and renders no profile data', async () => {
    getSession.mockResolvedValue(null);
    /*
      **No session**, not an outage. Supabase looked and found nothing, which is the one branch that
      legitimately routes to Authentication — and which must delete any offline receipt.
    */
    resolveSession.mockResolvedValue({ kind: 'no-session' });

    await renderProfile(new MockPurchaseAdapter({ initialEntitlement: freeEntitlement() }));

    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/welcome'));
    expect(screen.getByTestId('profile-signed-out')).toBeTruthy();
    expect(screen.queryByTestId('profile-identity')).toBeNull();
    expect(screen.queryByTestId('profile-menu')).toBeNull();
  });
});

describe('scrolling', () => {
  it('stays off while the content fits, and turns on when it does not', async () => {
    await renderProfile(new MockPurchaseAdapter({ initialEntitlement: freeEntitlement() }));
    await waitFor(() => expect(screen.getByTestId('profile-membership-title')).toBeTruthy());

    const scroll = screen.getByTestId('profile-home-scroll');

    // The reference case: 598 dp of content in an 840 dp viewport.
    await fireEvent(scroll, 'layout', { nativeEvent: { layout: { height: 840, width: 393 } } });
    await fireEvent(scroll, 'contentSizeChange', 393, 598);
    expect(screen.getByTestId('profile-home-scroll').props.scrollEnabled).toBe(false);
  });

  it('turns scrolling on rather than clipping once large text overflows', async () => {
    await renderProfile(new MockPurchaseAdapter({ initialEntitlement: freeEntitlement() }));
    await waitFor(() => expect(screen.getByTestId('profile-membership-title')).toBeTruthy());

    const scroll = screen.getByTestId('profile-home-scroll');
    await fireEvent(scroll, 'layout', { nativeEvent: { layout: { height: 840, width: 393 } } });
    // What a large accessibility font size produces: wrapped labels and taller cards.
    await fireEvent(scroll, 'contentSizeChange', 393, 1180);

    expect(screen.getByTestId('profile-home-scroll').props.scrollEnabled).toBe(true);
  });
});
