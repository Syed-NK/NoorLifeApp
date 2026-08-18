import type { Entitlement, FamilySeatUsage } from '@features/subscription/domain/entitlement';
import { formatRenewalDate } from '@features/subscription/domain/pricing';
import { statusGrantsPaidAccess } from '@features/subscription/domain/subscription';

import { profileCopy } from './profile-copy';

/**
 * What the membership card says, for a given entitlement.
 *
 * ── Why this is a pure function and not JSX ─────────────────────────────────
 * Three of this phase's requirements are claims about *wording*, not about layout: the Free card
 * must say "Faith is always free", a renewal date must never appear unless the provider reported
 * one, and a seat count must never appear unless seat data has actually arrived. Those are far
 * easier to prove — and far harder to accidentally break — against a function that returns strings
 * than against a rendered tree.
 *
 * ── The single trailing fact ────────────────────────────────────────────────
 * At most one supporting fact is returned, and it rides in the title row's trailing slot rather
 * than on a line of its own. That is what keeps all three plan presentations at exactly the same
 * 112 dp: a fourth line would take the card out of its 100–116 dp band, and a card whose height
 * depends on whether a date happened to load is the flicker §9 rules out.
 *
 * `fact` is null far more often than not, and that is the point. An absent date is an absent
 * string, never "Renews soon"; an unknown seat count is an absent string, never "1 of 6".
 */
export type MembershipPresentation = {
  readonly title: string;
  readonly supporting: string;
  readonly primaryLabel: string;
  /**
   * A real renewal date or a real seat count. Null whenever the underlying value is unknown —
   * this function has no fallback wording and is not permitted one.
   */
  readonly fact: string | null;
  /** The compact secondary text action. Offered on the Free card, per the brief. */
  readonly showRestore: boolean;
};

export function membershipPresentation(
  entitlement: Entitlement,
  seatUsage: FamilySeatUsage | null,
): MembershipPresentation {
  const { membership } = profileCopy;

  if (entitlement.plan === 'premium_family') {
    return {
      title: membership.premiumFamily.title,
      supporting: membership.premiumFamily.supporting,
      primaryLabel: membership.premiumFamily.primary,
      // Seats only once the real usage has arrived. `seatUsage` starts null and stays null if the
      // read fails, so there is no state in which a count is guessed.
      fact: seatUsage === null ? null : membership.seats(seatUsage.used, seatUsage.limit),
      showRestore: false,
    };
  }

  if (entitlement.plan === 'premium_single') {
    const renewal = formatRenewalDate(entitlement.currentPeriodEnd);
    return {
      title: membership.premiumSingle.title,
      supporting: membership.premiumSingle.supporting,
      primaryLabel: membership.premiumSingle.primary,
      fact:
        renewal === null
          ? null
          : // A cancelled or expiring subscription still has a real date — it just is not a
            // renewal, and calling it one would be the invention this phase forbids.
            statusGrantsPaidAccess(entitlement.status) && !entitlement.cancelAtPeriodEnd
            ? membership.renews(renewal)
            : membership.accessEnds(renewal),
      showRestore: false,
    };
  }

  return {
    title: membership.free.title,
    supporting: membership.free.supporting,
    primaryLabel: membership.free.primary,
    // A free account has no billing period and therefore no date to show, whatever the provider
    // happens to have left in `currentPeriodEnd`.
    fact: null,
    showRestore: true,
  };
}
