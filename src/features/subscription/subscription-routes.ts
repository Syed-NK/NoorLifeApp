import type { Href } from 'expo-router';

/**
 * Routes for the subscription and family-membership system.
 *
 * Kept beside the feature rather than in `@application/navigation/routes` for the parameterised
 * ones: the billing period travels as a query parameter, so these are functions rather than
 * constants and do not fit that file's flat contract. The plain paths are mirrored into
 * `subscriptionRoutes` there so the global route contract stays complete.
 *
 * ── Why the period is a route parameter ─────────────────────────────────────
 * A user who picks Yearly on the welcome screen and taps through to the plan detail must land on
 * Yearly. Holding that in a context would work until the screen is deep-linked or the app is
 * killed mid-flow; a parameter survives both and makes each screen independently addressable —
 * which is also what lets the screenshot harness open "family, yearly" directly.
 */

export type PeriodParam = 'monthly' | 'yearly';

function withPeriod(path: string, period?: PeriodParam): Href {
  return (period === undefined ? path : `${path}?period=${period}`) as Href;
}

export const subscriptionRoutes = {
  welcome: '/subscription' as Href,
  compare: '/subscription/compare' as Href,
  single: (period?: PeriodParam) => withPeriod('/subscription/single', period),
  family: (period?: PeriodParam) => withPeriod('/subscription/family', period),
  /** The confirmation step carries both the plan and the period it is confirming. */
  confirm: (plan: 'premium_single' | 'premium_family', period: PeriodParam) =>
    `/subscription/confirm?plan=${plan}&period=${period}` as Href,
  /**
   * Processing requires the nonce minted by Confirmation.
   *
   * Optional in the signature only so no caller is tempted to invent one; a call without it
   * produces a URL the screen rejects and redirects away from.
   */
  processing: (plan: 'premium_single' | 'premium_family', period: PeriodParam, nonce?: string) =>
    (nonce === undefined
      ? `/subscription/processing?plan=${plan}&period=${period}`
      : `/subscription/processing?plan=${plan}&period=${period}&intent=${nonce}`) as Href,
  success: '/subscription/success' as Href,
  restore: '/subscription/restore' as Href,
  expired: '/subscription/expired' as Href,
  billingIssue: '/subscription/billing-issue' as Href,
  /** Manage lives under settings, as the brief specifies. */
  manage: '/settings/subscription' as Href,
} as const;

export const familyRoutes = {
  setup: '/family/setup' as Href,
  invite: '/family/invite' as Href,
  invitations: '/family/invitations' as Href,
  members: '/family/members' as Href,
  planFull: '/family/plan-full' as Href,
} as const;

/** Reads and validates a `period` search parameter, defaulting to yearly. */
export function parsePeriodParam(value: string | string[] | undefined): PeriodParam {
  const raw = Array.isArray(value) ? value[0] : value;
  // Yearly is the default because it is the offer that carries the trial, and an unreadable
  // parameter should not silently downgrade what the user chose.
  return raw === 'monthly' ? 'monthly' : 'yearly';
}

/** Reads a `plan` search parameter, defaulting to single. */
export function parsePlanParam(
  value: string | string[] | undefined,
): 'premium_single' | 'premium_family' {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === 'premium_family' ? 'premium_family' : 'premium_single';
}
