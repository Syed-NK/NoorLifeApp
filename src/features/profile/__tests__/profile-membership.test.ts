import { PLAN_CAPABILITIES, type Entitlement } from '@features/subscription/domain/entitlement';

import { profileCopy } from '../profile-copy';
import { membershipPresentation } from '../profile-membership';

/**
 * What the membership card is allowed to say.
 *
 * Three of this phase's requirements are claims about wording rather than layout — the exact Free,
 * Single and Family copy, no invented renewal date, no invented seat count — so they are asserted
 * against the pure function that produces the strings.
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

describe('a free account', () => {
  const presentation = membershipPresentation(entitlement('free'), null);

  it('uses the approved Free wording', () => {
    expect(presentation.title).toBe('Free plan');
    expect(presentation.supporting).toBe('Faith is always free.');
    expect(presentation.primaryLabel).toBe('View Premium');
  });

  it('offers Restore Purchases as the compact secondary action', () => {
    expect(presentation.showRestore).toBe(true);
    expect(profileCopy.membership.restore).toBe('Restore Purchases');
  });

  it('states no renewal date, whatever the provider left on the record', () => {
    expect(presentation.fact).toBeNull();
    // Even with a date on a free entitlement — which should not happen, but is not this screen's
    // job to trust — nothing is shown, because a free account has nothing to renew.
    const withStrayDate = membershipPresentation(
      entitlement('free', { currentPeriodEnd: '2027-03-01T00:00:00.000Z' }),
      null,
    );
    expect(withStrayDate.fact).toBeNull();
  });
});

describe('a Premium Single account', () => {
  it('uses the approved Single wording', () => {
    const presentation = membershipPresentation(entitlement('premium_single'), null);

    expect(presentation.title).toBe('Premium Single');
    expect(presentation.supporting).toBe('All NoorLife modules are available.');
    expect(presentation.primaryLabel).toBe('Manage Plan');
    expect(presentation.showRestore).toBe(false);
  });

  it('shows a renewal date only when the provider reported one', () => {
    expect(membershipPresentation(entitlement('premium_single'), null).fact).toBe(
      'Renews 1 March 2027',
    );
  });

  it('shows nothing at all when there is no date', () => {
    // The regression this guards: filling the slot with "Renews soon" or a computed guess.
    const presentation = membershipPresentation(
      entitlement('premium_single', { currentPeriodEnd: null }),
      null,
    );
    expect(presentation.fact).toBeNull();
  });

  it('shows nothing when the stored date is unreadable', () => {
    const presentation = membershipPresentation(
      entitlement('premium_single', { currentPeriodEnd: 'not-a-date' }),
      null,
    );
    expect(presentation.fact).toBeNull();
  });

  it('calls an ending subscription’s date an ending, not a renewal', () => {
    const cancelling = membershipPresentation(
      entitlement('premium_single', { cancelAtPeriodEnd: true }),
      null,
    );
    expect(cancelling.fact).toBe('Access ends 1 March 2027');

    const expired = membershipPresentation(
      entitlement('premium_single', { status: 'expired' }),
      null,
    );
    expect(expired.fact).toBe('Access ends 1 March 2027');
  });
});

describe('a Premium Family account', () => {
  it('uses the approved Family wording', () => {
    const presentation = membershipPresentation(entitlement('premium_family'), null);

    expect(presentation.title).toBe('Premium Family');
    expect(presentation.supporting).toBe('Share with up to five additional family members.');
    expect(presentation.primaryLabel).toBe('Manage Plan');
    expect(presentation.showRestore).toBe(false);
  });

  it('shows a seat count only once real seat data has arrived', () => {
    expect(membershipPresentation(entitlement('premium_family'), null).fact).toBeNull();

    const withSeats = membershipPresentation(entitlement('premium_family'), {
      used: 2,
      limit: 6,
      pendingInvitations: 1,
    });
    expect(withSeats.fact).toBe('2 of 6 seats');
  });

  it('never falls back to a plan-limit guess when seats are unknown', () => {
    // The regression this guards: rendering "1 of 6" because the plan allows six, before the
    // backend has said how many are actually in use.
    const presentation = membershipPresentation(entitlement('premium_family'), null);
    expect(presentation.fact).toBeNull();
  });
});

describe('the development mock notice', () => {
  it('is a three-character marker, not the previous permanent sentence', () => {
    expect(profileCopy.membership.devBadge).toBe('DEV');
    const strings = JSON.stringify(profileCopy);
    expect(strings).not.toContain('Development mock — purchases are simulated');
  });
});
