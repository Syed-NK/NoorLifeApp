/**
 * The normalized subscription vocabulary.
 *
 * These are NoorLife's own values, not any store's. Apple calls a lapsed-payment state
 * "billing retry", Google calls the equivalent "account hold" with a distinct grace period
 * before it; RevenueCat exposes a third shape again. Presentation code must not have to know
 * which provider it is talking to, so every adapter translates *into* this vocabulary and the
 * app reasons only in these terms.
 *
 * Adding a provider means writing one adapter, not touching a screen.
 */

/** The three commercial plans. `free` is a permanent plan, never an absence of one. */
export type SubscriptionPlan = 'free' | 'premium_single' | 'premium_family';

/** `none` belongs to the free plan, which is not billed. */
export type BillingPeriod = 'none' | 'monthly' | 'yearly';

/**
 * Lifecycle state.
 *
 * `unknown` is load-bearing: it is the state before the first entitlement resolves, and it must
 * never be treated as `free`. Rendering a paywall over a paying subscriber because their
 * entitlement had not loaded yet is the failure this value exists to prevent.
 */
export type SubscriptionStatus =
  | 'free'
  | 'trialing'
  | 'active'
  | 'grace_period'
  | 'account_hold'
  | 'paused'
  | 'expired'
  | 'revoked'
  | 'unknown';

export type SubscriptionProvider = 'apple' | 'google' | 'development_mock';

/**
 * States in which paid access is still granted.
 *
 * `grace_period` is included deliberately. The payment has failed but the provider is retrying,
 * and both Apple and Google expect the app to keep serving content during that window — cutting
 * access at the first failed charge punishes a user whose card simply expired.
 *
 * `account_hold` is excluded, equally deliberately: by then the retry window has closed and the
 * provider has stopped granting entitlement. `paused` is excluded because the user asked for it.
 */
const ACCESS_GRANTING: readonly SubscriptionStatus[] = [
  'trialing',
  'active',
  'grace_period',
] as const;

export function statusGrantsPaidAccess(status: SubscriptionStatus): boolean {
  return ACCESS_GRANTING.includes(status);
}

/** States the user should be told about, because they require an action in the store. */
export type BillingProblemStatus = 'grace_period' | 'account_hold' | 'expired';

const BILLING_PROBLEM: readonly BillingProblemStatus[] = [
  'grace_period',
  'account_hold',
  'expired',
] as const;

/**
 * A type predicate, not a plain boolean.
 *
 * Callers index the billing-issue copy by status immediately after checking this, and a `boolean`
 * would leave them casting. Narrowing here means the compiler enforces that only a status with
 * copy can be looked up.
 */
export function statusIsBillingProblem(status: SubscriptionStatus): status is BillingProblemStatus {
  return BILLING_PROBLEM.includes(status as BillingProblemStatus);
}

/** Where the user manages this subscription. Only the two real stores can be opened. */
export function providerStoreName(provider: SubscriptionProvider): string {
  switch (provider) {
    case 'apple':
      return 'App Store';
    case 'google':
      return 'Google Play';
    case 'development_mock':
      // Named plainly rather than dressed as a store. A build showing this is not a build that
      // can take money.
      return 'Development mock';
  }
}

/**
 * Whether NoorLife can hand the user off to a real subscription-management surface.
 *
 * False for the mock, which is what stops the Manage screen from offering a button that would
 * do nothing — and what keeps rule 15 of the brief honest: never claim NoorLife can cancel an
 * Apple or Google subscription it cannot reach.
 */
export function providerHasManagementSurface(provider: SubscriptionProvider): boolean {
  return provider === 'apple' || provider === 'google';
}
