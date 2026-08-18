import { render, screen, waitFor } from '@testing-library/react-native';

import { PLAN_CAPABILITIES, type Entitlement } from '../domain/entitlement';
import { EntitlementProvider } from '../services/entitlement-context';
import { MockPurchaseAdapter } from '../services/mock-purchase-adapter';
import { mockFamilyStore } from '../services/mock-family-store';
import { FamilyMembersScreen } from '../screens/family-screens';

/**
 * The Family Members screen at every seat count.
 *
 * Phase 5 rendered a one-member family as a single row above a pinned footer, leaving most of the
 * screen blank. These assert the screen carries real content at 1 of 6 — seat usage, roster, a
 * pending-invitations section and the sharing summary — and that the counts stay honest as it fills.
 */

const ORGANIZER: Entitlement = {
  plan: 'premium_family',
  billingPeriod: 'yearly',
  status: 'active',
  provider: 'development_mock',
  currentPeriodEnd: '2027-01-01T00:00:00.000Z',
  trialEnd: null,
  cancelAtPeriodEnd: false,
  isFamilyOrganizer: true,
  capabilities: PLAN_CAPABILITIES.premium_family,
};

async function renderMembers(entitlement: Entitlement = ORGANIZER) {
  return render(
    <EntitlementProvider adapter={new MockPurchaseAdapter({ initialEntitlement: entitlement })}>
      <FamilyMembersScreen />
    </EntitlementProvider>,
  );
}

beforeEach(() => {
  mockFamilyStore.reset();
});

describe('1 of 6 accounts', () => {
  it('still fills the screen with real content rather than a blank band', async () => {
    await renderMembers();

    await waitFor(() => expect(screen.getByTestId('members-seat-card')).toBeTruthy());
    expect(screen.getByText('1 of 6 members')).toBeTruthy();
    // Four content sections, none of them decorative filler.
    expect(screen.getByTestId('members-roster')).toBeTruthy();
    expect(screen.getByTestId('members-pending')).toBeTruthy();
    expect(screen.getByTestId('members-sharing')).toBeTruthy();
    expect(screen.getByTestId('members-privacy')).toBeTruthy();
  });

  it('says how many accounts remain', async () => {
    await renderMembers();

    await waitFor(() => expect(screen.getByText('5 accounts still free.')).toBeTruthy());
  });

  it('states plainly that no invitations are waiting', async () => {
    await renderMembers();

    await waitFor(() => expect(screen.getByTestId('members-no-pending')).toBeTruthy());
  });

  it('shows the organizer, badged, and offers no way to remove them', async () => {
    await renderMembers();

    await waitFor(() => expect(screen.getByText('Ahmed Al-Rashid')).toBeTruthy());
    // The badge names the role; the line beneath explains it rather than repeating the word.
    expect(screen.getByText('Organizer')).toBeTruthy();
    expect(screen.getByText('Manages the family and holds one of the six accounts')).toBeTruthy();
    // The organizer holds a seat and cannot leave; no control is offered rather than one that fails.
    expect(screen.queryByTestId('member-organizer-remove')).toBeNull();
  });
});

describe('3 of 6 accounts', () => {
  it('counts the organizer plus two members', async () => {
    mockFamilyStore.addMember('Fatima');
    mockFamilyStore.addMember('Yusuf');

    await renderMembers();

    await waitFor(() => expect(screen.getByText('3 of 6 members')).toBeTruthy());
    expect(screen.getByText('3 accounts still free.')).toBeTruthy();
  });

  it('offers Remove on members but never on the organizer', async () => {
    mockFamilyStore.addMember('Fatima');
    mockFamilyStore.addMember('Yusuf');

    await renderMembers();

    await waitFor(() => expect(screen.getByTestId('member-member-2-remove')).toBeTruthy());
    expect(screen.getByTestId('member-member-3-remove')).toBeTruthy();
    expect(screen.queryByTestId('member-organizer-remove')).toBeNull();
  });
});

describe('6 of 6 accounts', () => {
  it('reports the plan as full with no accounts remaining', async () => {
    for (const name of ['Fatima', 'Yusuf', 'Maryam', 'Omar', 'Aisha']) {
      mockFamilyStore.addMember(name);
    }

    await renderMembers();

    await waitFor(() => expect(screen.getByText('6 of 6 members')).toBeTruthy());
    expect(screen.getByText('All accounts are in use.')).toBeTruthy();
    expect(screen.getByTestId('members-seats-full')).toBeTruthy();
  });
});

describe('pending invitations', () => {
  it('lists them with a count when present', async () => {
    mockFamilyStore.invite('fatima@example.com', 'Expires in 7 days');
    mockFamilyStore.invite('yusuf@example.com', 'Expires in 7 days');

    await renderMembers();

    await waitFor(() => expect(screen.getByTestId('members-pending-count')).toBeTruthy());
    expect(screen.getByText('2 invitations waiting to be accepted.')).toBeTruthy();
    expect(screen.getByText('fatima@example.com')).toBeTruthy();
  });

  it('does not count a pending invitation as a used seat', async () => {
    mockFamilyStore.invite('fatima@example.com', 'Expires in 7 days');

    await renderMembers();

    // The seat is consumed on acceptance, not on sending.
    await waitFor(() => expect(screen.getByText('1 of 6 members')).toBeTruthy());
  });
});

describe('a non-organizer member', () => {
  it('sees membership information and no management controls', async () => {
    mockFamilyStore.addMember('Fatima');

    await renderMembers({ ...ORGANIZER, isFamilyOrganizer: false });

    await waitFor(() => expect(screen.getByTestId('members-member-only')).toBeTruthy());
    expect(screen.queryByTestId('members-invite')).toBeNull();
    expect(screen.queryByTestId('member-member-2-remove')).toBeNull();
    // Privacy information is still theirs to read.
    expect(screen.getByTestId('members-privacy')).toBeTruthy();
  });
});
