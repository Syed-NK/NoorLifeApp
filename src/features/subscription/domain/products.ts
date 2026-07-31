import type { BillingPeriod, SubscriptionPlan } from './subscription';

/**
 * Store product identifiers — the only place they appear.
 *
 * A product id typed into a screen is a string that has to match a store configuration nobody
 * can see from that screen. Centralising them means a rename is one edit, and the plan/period
 * mapping below can be asserted by test rather than trusted.
 */
export const PRODUCT_IDS = {
  singleMonthly: 'noorlife_single_monthly',
  singleYearly: 'noorlife_single_yearly',
  familyMonthly: 'noorlife_family_monthly',
  familyYearly: 'noorlife_family_yearly',
} as const;

export type ProductId = (typeof PRODUCT_IDS)[keyof typeof PRODUCT_IDS];

/** A purchasable offer: one plan at one billing period. */
export type PlanOffer = {
  readonly productId: ProductId;
  readonly plan: Extract<SubscriptionPlan, 'premium_single' | 'premium_family'>;
  readonly billingPeriod: Extract<BillingPeriod, 'monthly' | 'yearly'>;
  /** Whether a first-time subscriber may receive the seven-day trial on this offer. */
  readonly trialEligibleByDesign: boolean;
};

/**
 * Every offer NoorLife sells.
 *
 * The free plan is absent because it is not purchasable. `trialEligibleByDesign` is true only on
 * the yearly offers, matching the approved model — and it is only the *design* half of the
 * answer: whether a given user actually gets a trial is a store question, answered per user, and
 * the UI must never promise one from this flag alone.
 */
export const PLAN_OFFERS: readonly PlanOffer[] = [
  {
    productId: PRODUCT_IDS.singleMonthly,
    plan: 'premium_single',
    billingPeriod: 'monthly',
    trialEligibleByDesign: false,
  },
  {
    productId: PRODUCT_IDS.singleYearly,
    plan: 'premium_single',
    billingPeriod: 'yearly',
    trialEligibleByDesign: true,
  },
  {
    productId: PRODUCT_IDS.familyMonthly,
    plan: 'premium_family',
    billingPeriod: 'monthly',
    trialEligibleByDesign: false,
  },
  {
    productId: PRODUCT_IDS.familyYearly,
    plan: 'premium_family',
    billingPeriod: 'yearly',
    trialEligibleByDesign: true,
  },
] as const;

/** Resolves the offer for a plan and period, or undefined when the pair is not sold. */
export function findOffer(
  plan: SubscriptionPlan,
  billingPeriod: BillingPeriod,
): PlanOffer | undefined {
  return PLAN_OFFERS.find((offer) => offer.plan === plan && offer.billingPeriod === billingPeriod);
}

export function findOfferByProductId(productId: string): PlanOffer | undefined {
  return PLAN_OFFERS.find((offer) => offer.productId === productId);
}
