import type { Entitlement, FamilySeatUsage } from '@features/subscription/domain/entitlement';
import { formatRenewalDate } from '@features/subscription/domain/pricing';
import { statusGrantsPaidAccess } from '@features/subscription/domain/subscription';
import { billingCopy, planNames } from '@features/subscription/subscription-copy';

import { profileCopy } from './profile-copy';

/**
 * What Family & Membership says, for a given entitlement and whatever family data has arrived.
 *
 * ── Why this is a pure function and not JSX ─────────────────────────────────
 * Almost every requirement this screen has to satisfy is a claim about *absence*: no invented
 * renewal date, no invented organizer, no invented members, no invented seat usage. Absence is far
 * easier to prove against a function that returns `null` than against a rendered tree, where "the
 * date is not there" and "the date is there but the test looked in the wrong place" are the same
 * failing assertion.
 *
 * So every optional fact below is `string | null`, and null is the *default* rather than the
 * exception. There is no fallback wording anywhere in this file and it is not permitted one: an
 * unknown renewal date is an absent line, never "Renews soon"; an unknown seat count is an absent
 * line, never "1 of 6".
 *
 * ── The organizer is the one identity that can be real ──────────────────────
 * There is no family table, so this function cannot know who anyone else is. It *can* know the
 * organizer when the signed-in user is the organizer — `isFamilyOrganizer` says so and the session
 * supplies their name. That is a real fact about a real person, and it is the only identity this
 * screen will show. A member of someone else's family gets no organizer line, because we genuinely
 * do not know who they are.
 */
export type FamilyMembershipPresentation = {
  /** The plan's display name, from the subscription copy. */
  readonly planName: string;
  readonly supporting: string;
  readonly primaryLabel: string;
  /** A real billing period. Null on the free plan, which is not billed. */
  readonly billingPeriod: string | null;
  /** A real renewal or expiry date. Null whenever the provider reported none. */
  readonly renewal: string | null;
  /** Real seat usage. Null until family seat data has actually arrived. */
  readonly seats: string | null;
  /** Real pending invitations. Null when there are none, or when nothing is known. */
  readonly pendingInvitations: string | null;
  /** The organizer's name — only ever the signed-in user's own. Null otherwise. */
  readonly organizerName: string | null;
  /** Whether to show the two plan summaries a free account is choosing between. */
  readonly showPlanSummaries: boolean;
  /** Whether to offer the route up to Premium Family. */
  readonly showFamilyUpgrade: boolean;
  /** Whether this plan has a family to talk about at all. */
  readonly showFamilySection: boolean;
  readonly showRestore: boolean;
};

/** The billing-period line, only for a plan that is actually billed on one. */
function billingPeriodLabel(entitlement: Entitlement): string | null {
  switch (entitlement.billingPeriod) {
    case 'monthly':
      return billingCopy.billedMonthly;
    case 'yearly':
      return billingCopy.billedYearly;
    case 'none':
      return null;
  }
}

/**
 * The renewal line.
 *
 * A cancelled or expiring subscription still has a real date — it just is not a renewal, and
 * calling it one would be the invention this phase forbids.
 */
function renewalLabel(entitlement: Entitlement): string | null {
  const formatted = formatRenewalDate(entitlement.currentPeriodEnd);
  if (formatted === null) {
    return null;
  }
  return statusGrantsPaidAccess(entitlement.status) && !entitlement.cancelAtPeriodEnd
    ? profileCopy.membership.renews(formatted)
    : profileCopy.membership.accessEnds(formatted);
}

export function familyMembershipPresentation(
  entitlement: Entitlement,
  seatUsage: FamilySeatUsage | null,
  /** The signed-in user's own name, for the organizer line. Null when it is not known. */
  selfName: string | null,
): FamilyMembershipPresentation {
  const detail = profileCopy.membershipDetail;

  if (entitlement.plan === 'premium_family') {
    return {
      planName: planNames.premium_family,
      // The capacity sentence is the supporting line here: on the Family plan it is the fact that
      // matters most, and it is the wording the phase fixes verbatim.
      supporting: detail.capacity,
      primaryLabel: detail.family.primary,
      billingPeriod: billingPeriodLabel(entitlement),
      renewal: renewalLabel(entitlement),
      // Seats only once real usage has arrived. `seatUsage` starts null and stays null if the read
      // fails, so there is no state in which a count is guessed.
      seats: seatUsage === null ? null : detail.family.seats(seatUsage.used, seatUsage.limit),
      pendingInvitations:
        seatUsage === null || seatUsage.pendingInvitations === 0
          ? null
          : detail.family.pending(seatUsage.pendingInvitations),
      // Only the signed-in organizer. See the note above.
      organizerName: entitlement.isFamilyOrganizer ? selfName : null,
      showPlanSummaries: false,
      showFamilyUpgrade: false,
      showFamilySection: true,
      showRestore: true,
    };
  }

  if (entitlement.plan === 'premium_single') {
    return {
      planName: planNames.premium_single,
      supporting: detail.single.supporting,
      primaryLabel: detail.single.primary,
      billingPeriod: billingPeriodLabel(entitlement),
      renewal: renewalLabel(entitlement),
      // A single plan has one account and no family, so there is nothing to count.
      seats: null,
      pendingInvitations: null,
      organizerName: null,
      showPlanSummaries: false,
      showFamilyUpgrade: true,
      showFamilySection: false,
      showRestore: true,
    };
  }

  return {
    planName: planNames.free,
    supporting: detail.free.supporting,
    primaryLabel: detail.free.primary,
    // A free account has no billing period and therefore no date, whatever the provider happens to
    // have left in `currentPeriodEnd`.
    billingPeriod: null,
    renewal: null,
    seats: null,
    pendingInvitations: null,
    organizerName: null,
    showPlanSummaries: true,
    showFamilyUpgrade: false,
    showFamilySection: false,
    showRestore: true,
  };
}
