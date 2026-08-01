import { canAccessModule as decideAIScope } from '@shared/permissions/ai-scope';
import { FRAMEWORK_MODULE_IDS, type FrameworkModuleId } from '@features/modules/module-tokens';

import {
  FREE_ENTITLEMENT,
  PLAN_CAPABILITIES,
  PREMIUM_MODULE_IDS,
  UNKNOWN_ENTITLEMENT,
  type Entitlement,
} from '../domain/entitlement';
import {
  NOOR_AI_APPLICATION_GUIDANCE_TOPICS,
  isNoorAILimited,
  noorAIMayDiscussModule,
  noorAIModeFor,
  noorAIModuleDecision,
  noorAIPermittedModules,
  noorAIRequestContext,
  noorAIScopeFor,
} from '../domain/noor-ai-scope';
import { noorAIFreeCopy } from '../subscription-copy';

/**
 * Noor AI's free scope.
 *
 * Noor AI is on every plan, so none of this is about locking it. It is about what it may be *asked
 * to be*: the free plan includes navigation and account help, and it does not include Noor AI
 * standing in for Planner, Health, Finance, Learning, Family or Goals. An assistant that plans a
 * free user's week has delivered Planner without anyone paying for it, which is the failure this
 * file exists to prevent.
 *
 * Every assertion here is against the derived scope object rather than any wording, because the
 * wording is a consequence and the scope is the mechanism.
 */

const paid = (plan: 'premium_single' | 'premium_family'): Entitlement => ({
  ...FREE_ENTITLEMENT,
  plan,
  billingPeriod: 'yearly',
  status: 'active',
  capabilities: PLAN_CAPABILITIES[plan],
});

/** A subscription that has lapsed: the plan still includes the modules, the status no longer grants. */
const expired: Entitlement = { ...paid('premium_family'), status: 'expired' };

/** A user who has granted Noor AI permission to read everything it could ever ask for. */
const grantedEverything = FRAMEWORK_MODULE_IDS;

const SCREEN = '/home';

describe('the mode Noor AI resolves to', () => {
  it('is application guidance on the free plan', () => {
    expect(noorAIModeFor(FREE_ENTITLEMENT)).toBe('application_guidance');
    expect(isNoorAILimited(FREE_ENTITLEMENT)).toBe(true);
  });

  it('is application guidance before the entitlement has resolved', () => {
    // The same defaulting every locked surface uses. A subscriber briefly gets the free scope on a
    // cold start; a free user never gets the paid one.
    expect(noorAIModeFor(UNKNOWN_ENTITLEMENT)).toBe('application_guidance');
    expect(isNoorAILimited(UNKNOWN_ENTITLEMENT)).toBe(true);
  });

  it('is full on either paid plan', () => {
    expect(noorAIModeFor(paid('premium_single'))).toBe('full');
    expect(noorAIModeFor(paid('premium_family'))).toBe('full');
    expect(isNoorAILimited(paid('premium_single'))).toBe(false);
  });

  it('falls back to application guidance when a paid plan has expired', () => {
    // The plan's capability table still says premium; the status says access has stopped. Both are
    // required, so Noor AI narrows with the rest of the app rather than staying wide open.
    expect(noorAIModeFor(expired)).toBe('application_guidance');
  });
});

describe('the modules Noor AI may reach', () => {
  it('is Faith and Noor AI itself on the free plan', () => {
    expect(noorAIPermittedModules(FREE_ENTITLEMENT)).toEqual(['noor-ai', 'faith']);
  });

  it('is every module on a paid plan', () => {
    expect(noorAIPermittedModules(paid('premium_family'))).toEqual([...FRAMEWORK_MODULE_IDS]);
  });

  it.each(PREMIUM_MODULE_IDS)('excludes %s from the free scope', (moduleId) => {
    expect(noorAIScopeFor(FREE_ENTITLEMENT)).toEqual({
      kind: 'noorlife',
      permittedModules: ['noor-ai', 'faith'],
    });
    expect(noorAIMayDiscussModule(FREE_ENTITLEMENT, moduleId)).toBe(false);
  });

  it('keeps Faith reachable on every plan, including before resolution', () => {
    // Faith is not premium, so it short-circuits before the plan or the status is consulted.
    for (const entitlement of [FREE_ENTITLEMENT, UNKNOWN_ENTITLEMENT, expired]) {
      expect(noorAIMayDiscussModule(entitlement, 'faith')).toBe(true);
      expect(noorAIPermittedModules(entitlement)).toContain('faith');
    }
  });
});

describe('a free request about a paid module', () => {
  it.each(PREMIUM_MODULE_IDS)('is refused for %s as out of scope', (moduleId) => {
    const decision = noorAIModuleDecision(FREE_ENTITLEMENT, moduleId, SCREEN, grantedEverything);
    expect(decision.allowed).toBe(false);
    expect(decision).toEqual({ allowed: false, reason: 'out-of-scope', requiredModule: moduleId });
  });

  it.each(PREMIUM_MODULE_IDS)('is refused for %s before the entitlement resolves', (moduleId) => {
    expect(
      noorAIModuleDecision(UNKNOWN_ENTITLEMENT, moduleId, SCREEN, grantedEverything).allowed,
    ).toBe(false);
  });

  it('is refused even when the user has granted that module', () => {
    // The grant is real and on record — a subscriber who granted Finance and then let the plan
    // lapse. Permission and entitlement are separate questions, and neither answers the other.
    const context = noorAIRequestContext(expired, SCREEN, ['finance', 'faith']);
    expect(context.grantedModules).toEqual(['faith']);
    expect(decideAIScope(context, 'finance').allowed).toBe(false);
  });

  it('never widens the scope to match a grant', () => {
    const context = noorAIRequestContext(FREE_ENTITLEMENT, SCREEN, grantedEverything);
    const permitted = (context.scope as { readonly permittedModules: readonly string[] })
      .permittedModules;
    for (const moduleId of PREMIUM_MODULE_IDS) {
      expect(permitted).not.toContain(moduleId);
      expect(context.grantedModules).not.toContain(moduleId);
    }
  });
});

describe('what a free user may still ask', () => {
  it('covers navigation, discovery, the module directory, account and subscription help', () => {
    // The five subjects the free plan includes, recorded as data so the scope is inspectable and a
    // future orchestrator has something to satisfy rather than a paragraph to interpret.
    expect(Object.keys(NOOR_AI_APPLICATION_GUIDANCE_TOPICS).sort()).toEqual([
      'account_help',
      'app_navigation',
      'feature_discovery',
      'module_directory',
      'subscription_help',
    ]);
  });

  it('includes Faith, whose module is free in full', () => {
    const context = noorAIRequestContext(FREE_ENTITLEMENT, SCREEN, ['faith']);
    expect(decideAIScope(context, 'faith')).toEqual({ allowed: true });
  });

  it('includes Noor AI itself, so app questions are answerable', () => {
    const context = noorAIRequestContext(FREE_ENTITLEMENT, SCREEN, ['noor-ai']);
    expect(decideAIScope(context, 'noor-ai')).toEqual({ allowed: true });
  });

  it('still asks permission for Faith when the user has not granted it', () => {
    // In scope is not the same as granted. §06 requires asking before reading private module data,
    // and widening the entitlement scope must not quietly satisfy that separate requirement.
    const context = noorAIRequestContext(FREE_ENTITLEMENT, SCREEN, []);
    expect(decideAIScope(context, 'faith')).toEqual({
      allowed: false,
      reason: 'permission-required',
      requiredModule: 'faith',
    });
  });
});

describe('a paid request', () => {
  it.each(PREMIUM_MODULE_IDS)('is allowed for %s once granted', (moduleId) => {
    const context = noorAIRequestContext(paid('premium_family'), SCREEN, grantedEverything);
    expect(decideAIScope(context, moduleId)).toEqual({ allowed: true });
  });
});

describe('the free wording', () => {
  it('is exactly the approved application-guidance line', () => {
    expect(noorAIFreeCopy.insightBody).toBe(
      'Ask Noor AI how to find features or manage your account.',
    );
  });

  it('never presents Noor AI as locked or as something to buy', () => {
    // Noor AI is included. The free copy describes a scope; it must not read as a paywall.
    expect(noorAIFreeCopy.insightBody).not.toMatch(/premium|upgrade|unlock|locked/i);
    expect(noorAIFreeCopy.scopeLabel).not.toMatch(/premium|upgrade|unlock|locked/i);
  });

  it('names the module it cannot work with, and offers what it can', () => {
    const message = noorAIFreeCopy.outOfPlan('Planner');
    expect(message).toContain('Planner');
    expect(message).toContain('Premium');
    expect(message).toContain('NoorLife');
  });
});

describe('the framework module list this all rests on', () => {
  it('is the eight modules, six of them premium', () => {
    // A guard on the arithmetic above: if a module were added without deciding whether it is
    // premium, `noorAIPermittedModules` would silently include it in the free scope.
    expect(FRAMEWORK_MODULE_IDS).toHaveLength(8);
    expect(PREMIUM_MODULE_IDS).toHaveLength(6);
    const free = FRAMEWORK_MODULE_IDS.filter(
      (id: FrameworkModuleId) => !PREMIUM_MODULE_IDS.includes(id),
    );
    expect(free).toEqual(['noor-ai', 'faith']);
  });
});
