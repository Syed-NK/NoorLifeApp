import type { FrameworkModuleId } from '@features/modules/module-tokens';

import type {
  BillingPeriod,
  SubscriptionPlan,
  SubscriptionProvider,
  SubscriptionStatus,
} from './subscription';
import { statusGrantsPaidAccess } from './subscription';

/**
 * What a plan is allowed to do.
 *
 * One table, four booleans, no per-screen conditionals. Every access question in the app
 * resolves through this file, so "can this user open Finance?" has exactly one answer and one
 * place to change it.
 */
export type PlanCapabilities = {
  /** Total accounts the plan covers, organizer included. */
  readonly memberLimit: number;
  /** Faith. True on every plan, without exception. */
  readonly faith: boolean;
  /** Health, Planner, Finance, Learning, Family, Goals. */
  readonly premiumModules: boolean;
  /** Shared family calendar, events, goals, check-ins, memories. */
  readonly sharedFamily: boolean;
};

export const PLAN_CAPABILITIES: Readonly<Record<SubscriptionPlan, PlanCapabilities>> = {
  free: { memberLimit: 1, faith: true, premiumModules: false, sharedFamily: false },
  premium_single: { memberLimit: 1, faith: true, premiumModules: true, sharedFamily: false },
  /**
   * Six, not five.
   *
   * The organizer is one of the six. Every seat calculation in the app and the database counts
   * them, so "up to 5 family members" in the customer-facing copy means five *additional*
   * accounts on top of the organizer's.
   */
  premium_family: { memberLimit: 6, faith: true, premiumModules: true, sharedFamily: true },
};

/**
 * The modules a subscription is required for.
 *
 * Faith is absent, and that absence is the point: it can never be added here without failing
 * the test that asserts Faith is reachable under every subscription status. Noor AI is also
 * absent — the free plan includes basic app-navigation help from it.
 */
export const PREMIUM_MODULE_IDS: readonly FrameworkModuleId[] = [
  'health',
  'planner',
  'finance',
  'learning',
  'family',
  'goals',
] as const;

export function isPremiumModule(moduleId: FrameworkModuleId): boolean {
  return PREMIUM_MODULE_IDS.includes(moduleId);
}

/** The resolved answer for the signed-in user, as the app sees it. */
export type Entitlement = {
  readonly plan: SubscriptionPlan;
  readonly billingPeriod: BillingPeriod;
  readonly status: SubscriptionStatus;
  readonly provider: SubscriptionProvider;
  /** ISO date the current period ends, when the provider reports one. */
  readonly currentPeriodEnd: string | null;
  /** ISO date a trial ends. Non-null only while `status` is `trialing`. */
  readonly trialEnd: string | null;
  /** True when the user has cancelled but paid access runs to the period end. */
  readonly cancelAtPeriodEnd: boolean;
  /**
   * Whether this user is a family member rather than the plan's owner.
   *
   * Drives what the Family screens offer: an organizer manages seats, a member sees membership
   * and privacy information only.
   */
  readonly isFamilyOrganizer: boolean;
  readonly capabilities: PlanCapabilities;
};

/** The permanent free plan — also the safe fallback whenever nothing better is known. */
export const FREE_ENTITLEMENT: Entitlement = {
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

/**
 * The pre-resolution state.
 *
 * Deliberately *not* the free entitlement. A screen that cannot tell "no subscription" from
 * "not loaded yet" will flash a paywall at a paying subscriber on every cold start.
 */
export const UNKNOWN_ENTITLEMENT: Entitlement = {
  ...FREE_ENTITLEMENT,
  status: 'unknown',
};

export function isEntitlementResolved(entitlement: Entitlement): boolean {
  return entitlement.status !== 'unknown';
}

/**
 * Whether paid features are currently live for this entitlement.
 *
 * Two conditions, both required: the plan must include premium modules *and* the status must
 * still be granting access. An expired `premium_family` therefore behaves as free for paid
 * modules while Faith continues — which is precisely the expiry behaviour the brief describes.
 */
export function hasPremiumAccess(entitlement: Entitlement): boolean {
  return entitlement.capabilities.premiumModules && statusGrantsPaidAccess(entitlement.status);
}

/**
 * Can this user open this module?
 *
 * Faith short-circuits before anything else is consulted — before the plan, before the status,
 * before whether the entitlement has even loaded. That ordering is the implementation of "Faith
 * must never be presented as a paid feature".
 */
export function canAccessModule(entitlement: Entitlement, moduleId: FrameworkModuleId): boolean {
  if (!isPremiumModule(moduleId)) {
    return true;
  }
  return hasPremiumAccess(entitlement);
}

/**
 * Can this user use this module's AI assistant?
 *
 * Faith AI is free: the free plan includes the *complete* Faith module, and gating its assistant
 * would make part of Faith paid. Noor AI's own module is free too, at the basic
 * app-navigation level the free plan describes. Every other module's assistant follows its
 * module's access.
 */
export function canUseModuleAI(entitlement: Entitlement, moduleId: FrameworkModuleId): boolean {
  return canAccessModule(entitlement, moduleId);
}

/** Whether the shared family surfaces should be offered at all. */
export function canUseSharedFamily(entitlement: Entitlement): boolean {
  return entitlement.capabilities.sharedFamily && statusGrantsPaidAccess(entitlement.status);
}

/** Seat usage for the family screens. `limit` is the total, organizer included. */
export type FamilySeatUsage = {
  readonly used: number;
  readonly limit: number;
  /** Invitations sent and not yet accepted. They hold no seat until accepted. */
  readonly pendingInvitations: number;
};

export function isFamilyFull(usage: FamilySeatUsage): boolean {
  return usage.used >= usage.limit;
}

export function remainingSeats(usage: FamilySeatUsage): number {
  return Math.max(0, usage.limit - usage.used);
}
