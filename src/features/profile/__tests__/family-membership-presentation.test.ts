import {
  PLAN_CAPABILITIES,
  type Entitlement,
  type FamilySeatUsage,
} from '@features/subscription/domain/entitlement';

import { familyMembershipPresentation } from '../family-membership-presentation';
import { profileCopy } from '../profile-copy';

/**
 * What Family & Membership is allowed to claim.
 *
 * Almost every assertion here is about *absence* — no renewal date, no organizer, no seat count —
 * because those are the failures that matter. A screen that omits a fact it does know is a missed
 * opportunity; a screen that states a fact it does not know is a lie, and this phase forbids the
 * second one specifically.
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

const SEATS: FamilySeatUsage = { used: 3, limit: 6, pendingInvitations: 0 };

describe('the free plan', () => {
  const presentation = familyMembershipPresentation(entitlement('free'), null, 'Ahmed Al-Rashid');

  it('names the plan Free and says faith is always free', () => {
    expect(presentation.planName).toBe('Free');
    expect(presentation.supporting).toBe('Faith is always free.');
  });

  it('offers the plan chooser as its primary action', () => {
    expect(presentation.primaryLabel).toBe('View Premium Plans');
  });

  it('shows both paid plans to compare, and no family of its own', () => {
    expect(presentation.showPlanSummaries).toBe(true);
    expect(presentation.showFamilySection).toBe(false);
    expect(presentation.showFamilyUpgrade).toBe(false);
  });

  it('offers Restore Purchases', () => {
    expect(presentation.showRestore).toBe(true);
  });

  it('invents no billing period, date, seat count or organizer', () => {
    expect(presentation.billingPeriod).toBeNull();
    expect(presentation.renewal).toBeNull();
    expect(presentation.seats).toBeNull();
    expect(presentation.pendingInvitations).toBeNull();
    expect(presentation.organizerName).toBeNull();
  });

  it('shows no date even when the provider left one behind on a free entitlement', () => {
    const stale = familyMembershipPresentation(
      entitlement('free', { currentPeriodEnd: '2027-03-01T00:00:00.000Z' }),
      null,
      'Ahmed Al-Rashid',
    );
    expect(stale.renewal).toBeNull();
  });
});

describe('Premium Single', () => {
  const presentation = familyMembershipPresentation(
    entitlement('premium_single'),
    null,
    'Ahmed Al-Rashid',
  );

  it('names the plan and states that every module is available', () => {
    expect(presentation.planName).toBe('Premium Single');
    expect(presentation.supporting).toBe('All NoorLife modules are available.');
  });

  it('offers Manage Plan and the route up to Family', () => {
    expect(presentation.primaryLabel).toBe('Manage Plan');
    expect(presentation.showFamilyUpgrade).toBe(true);
  });

  it('reports the real billing period and renewal date', () => {
    expect(presentation.billingPeriod).toBe('Billed yearly');
    expect(presentation.renewal).toBe('Renews 1 March 2027');
  });

  it('omits the renewal line entirely when no date was reported', () => {
    const undated = familyMembershipPresentation(
      entitlement('premium_single', { currentPeriodEnd: null }),
      null,
      'Ahmed Al-Rashid',
    );
    expect(undated.renewal).toBeNull();
    expect(undated.billingPeriod).toBe('Billed yearly');
  });

  it('calls a cancelled subscription’s date an ending rather than a renewal', () => {
    const cancelled = familyMembershipPresentation(
      entitlement('premium_single', { cancelAtPeriodEnd: true }),
      null,
      'Ahmed Al-Rashid',
    );
    expect(cancelled.renewal).toBe('Access ends 1 March 2027');
  });

  it('has no seats or organizer, because a single plan has no family', () => {
    expect(presentation.seats).toBeNull();
    expect(presentation.organizerName).toBeNull();
    expect(presentation.showFamilySection).toBe(false);
  });

  it('does not show seats even if seat data is somehow supplied', () => {
    const withSeats = familyMembershipPresentation(
      entitlement('premium_single'),
      SEATS,
      'Ahmed Al-Rashid',
    );
    expect(withSeats.seats).toBeNull();
  });
});

describe('Premium Family', () => {
  it('states the six-account capacity in the approved wording', () => {
    const presentation = familyMembershipPresentation(
      entitlement('premium_family'),
      SEATS,
      'Ahmed Al-Rashid',
    );
    expect(presentation.supporting).toBe(
      'Premium Family supports six accounts: one organizer and five additional members.',
    );
  });

  it('renders real seat usage when it has arrived', () => {
    const presentation = familyMembershipPresentation(
      entitlement('premium_family'),
      SEATS,
      'Ahmed Al-Rashid',
    );
    expect(presentation.seats).toBe('3 of 6 accounts in use');
  });

  it('shows no seat count at all until seat data arrives', () => {
    const presentation = familyMembershipPresentation(
      entitlement('premium_family'),
      null,
      'Ahmed Al-Rashid',
    );
    // Never "1 of 6", never "0 of 6" — an unknown count is an absent line.
    expect(presentation.seats).toBeNull();
    expect(presentation.pendingInvitations).toBeNull();
  });

  it('names the organizer only when the signed-in user is the organizer', () => {
    const organizer = familyMembershipPresentation(
      entitlement('premium_family', { isFamilyOrganizer: true }),
      SEATS,
      'Ahmed Al-Rashid',
    );
    expect(organizer.organizerName).toBe('Ahmed Al-Rashid');
  });

  it('names no organizer for a member of someone else’s family', () => {
    // We genuinely do not know who they are, and there is no family table to ask.
    const member = familyMembershipPresentation(
      entitlement('premium_family', { isFamilyOrganizer: false }),
      SEATS,
      'Ahmed Al-Rashid',
    );
    expect(member.organizerName).toBeNull();
  });

  it('names no organizer when the session has no name to offer', () => {
    const anonymous = familyMembershipPresentation(
      entitlement('premium_family', { isFamilyOrganizer: true }),
      SEATS,
      null,
    );
    expect(anonymous.organizerName).toBeNull();
  });

  it('reports pending invitations only when there are real ones', () => {
    const none = familyMembershipPresentation(
      entitlement('premium_family'),
      { used: 2, limit: 6, pendingInvitations: 0 },
      'Ahmed Al-Rashid',
    );
    expect(none.pendingInvitations).toBeNull();

    const one = familyMembershipPresentation(
      entitlement('premium_family'),
      { used: 2, limit: 6, pendingInvitations: 1 },
      'Ahmed Al-Rashid',
    );
    expect(one.pendingInvitations).toBe('1 invitation waiting to be accepted');

    const several = familyMembershipPresentation(
      entitlement('premium_family'),
      { used: 2, limit: 6, pendingInvitations: 3 },
      'Ahmed Al-Rashid',
    );
    expect(several.pendingInvitations).toBe('3 invitations waiting to be accepted');
  });

  it('keeps Manage Plan and Restore available', () => {
    const presentation = familyMembershipPresentation(
      entitlement('premium_family'),
      SEATS,
      'Ahmed Al-Rashid',
    );
    expect(presentation.primaryLabel).toBe('Manage Plan');
    expect(presentation.showRestore).toBe(true);
  });
});

describe('the capacity wording', () => {
  it('is the exact approved sentence, and counts six rather than five', () => {
    expect(profileCopy.membershipDetail.capacity).toBe(
      'Premium Family supports six accounts: one organizer and five additional members.',
    );
    expect(PLAN_CAPABILITIES.premium_family.memberLimit).toBe(6);
  });

  it('states the missing family backend in the exact approved sentence', () => {
    expect(profileCopy.membershipDetail.backendMissing).toBe(
      'Family membership management will be available when store subscriptions and family invitations are connected.',
    );
  });
});
