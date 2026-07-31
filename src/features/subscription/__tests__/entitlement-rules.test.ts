import { FRAMEWORK_MODULE_IDS, type FrameworkModuleId } from '@features/modules/module-tokens';

import {
  FREE_ENTITLEMENT,
  PLAN_CAPABILITIES,
  PREMIUM_MODULE_IDS,
  UNKNOWN_ENTITLEMENT,
  canAccessModule,
  canUseModuleAI,
  canUseSharedFamily,
  hasPremiumAccess,
  isEntitlementResolved,
  isPremiumModule,
  type Entitlement,
} from '../domain/entitlement';
import {
  statusGrantsPaidAccess,
  statusIsBillingProblem,
  providerHasManagementSurface,
  type SubscriptionStatus,
} from '../domain/subscription';

/**
 * The access rules.
 *
 * These are the tests that matter most in the whole phase: they are what stop Faith from ever
 * becoming a paid feature, and what stop a free user from reaching a paid module.
 */

const ALL_STATUSES: readonly SubscriptionStatus[] = [
  'free',
  'trialing',
  'active',
  'grace_period',
  'account_hold',
  'paused',
  'expired',
  'revoked',
  'unknown',
];

function entitlement(overrides: Partial<Entitlement>): Entitlement {
  return { ...FREE_ENTITLEMENT, ...overrides };
}

function paid(
  plan: 'premium_single' | 'premium_family',
  status: SubscriptionStatus = 'active',
): Entitlement {
  return entitlement({
    plan,
    status,
    billingPeriod: 'yearly',
    capabilities: PLAN_CAPABILITIES[plan],
    isFamilyOrganizer: plan === 'premium_family',
  });
}

describe('Faith is never gated', () => {
  it('is accessible under every subscription status', () => {
    for (const status of ALL_STATUSES) {
      for (const plan of ['free', 'premium_single', 'premium_family'] as const) {
        const current = entitlement({ plan, status, capabilities: PLAN_CAPABILITIES[plan] });
        expect(canAccessModule(current, 'faith')).toBe(true);
      }
    }
  });

  it('is accessible after expiry, revocation and account hold', () => {
    for (const status of ['expired', 'revoked', 'account_hold'] as const) {
      expect(canAccessModule(paid('premium_family', status), 'faith')).toBe(true);
    }
  });

  it('is accessible before the entitlement has resolved', () => {
    // The regression this prevents: gating on a not-yet-loaded entitlement and locking Faith on
    // every cold start.
    expect(isEntitlementResolved(UNKNOWN_ENTITLEMENT)).toBe(false);
    expect(canAccessModule(UNKNOWN_ENTITLEMENT, 'faith')).toBe(true);
  });

  it('keeps its AI free, because the free plan includes the complete Faith module', () => {
    expect(canUseModuleAI(FREE_ENTITLEMENT, 'faith')).toBe(true);
  });

  it('is not in the premium module list at all', () => {
    // Stronger than checking access: Faith cannot be gated by a future caller either.
    expect(PREMIUM_MODULE_IDS).not.toContain('faith');
    expect(isPremiumModule('faith')).toBe(false);
  });

  it('leaves Noor AI free too, at the basic navigation level the free plan describes', () => {
    expect(canAccessModule(FREE_ENTITLEMENT, 'noor-ai')).toBe(true);
    expect(isPremiumModule('noor-ai')).toBe(false);
  });
});

describe('free users and paid modules', () => {
  const PAID: readonly FrameworkModuleId[] = [
    'health',
    'planner',
    'finance',
    'learning',
    'family',
    'goals',
  ];

  it('cannot enter any paid module', () => {
    for (const moduleId of PAID) {
      expect(canAccessModule(FREE_ENTITLEMENT, moduleId)).toBe(false);
      expect(canUseModuleAI(FREE_ENTITLEMENT, moduleId)).toBe(false);
    }
  });

  it('covers every framework module: each is either free or explicitly premium', () => {
    // Guards against a future module being added and silently defaulting to free.
    for (const moduleId of FRAMEWORK_MODULE_IDS) {
      const premium = isPremiumModule(moduleId);
      expect(canAccessModule(FREE_ENTITLEMENT, moduleId)).toBe(!premium);
    }
  });

  it('has no shared family surfaces', () => {
    expect(canUseSharedFamily(FREE_ENTITLEMENT)).toBe(false);
    expect(PLAN_CAPABILITIES.free.sharedFamily).toBe(false);
  });
});

describe('premium single', () => {
  it('reaches every paid module and its AI', () => {
    for (const moduleId of PREMIUM_MODULE_IDS) {
      expect(canAccessModule(paid('premium_single'), moduleId)).toBe(true);
      expect(canUseModuleAI(paid('premium_single'), moduleId)).toBe(true);
    }
  });

  it('covers one account and no shared family', () => {
    expect(PLAN_CAPABILITIES.premium_single.memberLimit).toBe(1);
    expect(canUseSharedFamily(paid('premium_single'))).toBe(false);
  });
});

describe('premium family', () => {
  it('reaches every paid module', () => {
    for (const moduleId of PREMIUM_MODULE_IDS) {
      expect(canAccessModule(paid('premium_family'), moduleId)).toBe(true);
    }
  });

  it('covers six accounts in total', () => {
    expect(PLAN_CAPABILITIES.premium_family.memberLimit).toBe(6);
  });

  it('grants a member the same module access as the organizer', () => {
    // A member is not the organizer but shares the plan's capabilities.
    const member = entitlement({
      plan: 'premium_family',
      status: 'active',
      capabilities: PLAN_CAPABILITIES.premium_family,
      isFamilyOrganizer: false,
    });
    for (const moduleId of PREMIUM_MODULE_IDS) {
      expect(canAccessModule(member, moduleId)).toBe(true);
    }
    expect(canUseSharedFamily(member)).toBe(true);
  });
});

describe('status transitions', () => {
  it('keeps paid access during a trial, active period and grace period', () => {
    for (const status of ['trialing', 'active', 'grace_period'] as const) {
      expect(statusGrantsPaidAccess(status)).toBe(true);
      expect(hasPremiumAccess(paid('premium_single', status))).toBe(true);
      expect(canAccessModule(paid('premium_single', status), 'finance')).toBe(true);
    }
  });

  it('withdraws paid access on account hold, pause, expiry and revocation', () => {
    for (const status of ['account_hold', 'paused', 'expired', 'revoked'] as const) {
      expect(statusGrantsPaidAccess(status)).toBe(false);
      expect(hasPremiumAccess(paid('premium_single', status))).toBe(false);
      expect(canAccessModule(paid('premium_single', status), 'finance')).toBe(false);
      // ...while Faith is untouched.
      expect(canAccessModule(paid('premium_single', status), 'faith')).toBe(true);
    }
  });

  it('treats grace period as a billing problem the user should see, but not a lockout', () => {
    expect(statusIsBillingProblem('grace_period')).toBe(true);
    expect(statusGrantsPaidAccess('grace_period')).toBe(true);
  });

  it('does not treat an unresolved entitlement as free', () => {
    expect(UNKNOWN_ENTITLEMENT.status).toBe('unknown');
    expect(statusGrantsPaidAccess('unknown')).toBe(false);
    expect(isEntitlementResolved(FREE_ENTITLEMENT)).toBe(true);
  });
});

describe('store management hand-off', () => {
  it('is available for Apple and Google only', () => {
    expect(providerHasManagementSurface('apple')).toBe(true);
    expect(providerHasManagementSurface('google')).toBe(true);
    // The mock has nowhere to send the user, which is what stops the Manage screen from claiming
    // NoorLife can cancel a store subscription.
    expect(providerHasManagementSurface('development_mock')).toBe(false);
  });
});
