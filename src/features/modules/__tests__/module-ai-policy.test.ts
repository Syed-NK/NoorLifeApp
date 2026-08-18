import { canAccessModule } from '@shared/permissions/ai-scope';

import {
  moduleAIBoundaryResponse,
  moduleAIPolicies,
  moduleAIRequestContext,
} from '../module-ai-policy';
import { FRAMEWORK_MODULE_IDS } from '../module-tokens';

/**
 * The module-AI policy.
 *
 * Two things are being protected here. First, that a module AI cannot silently answer
 * about another module — the scope rule. Second, that the modules with a regulatory or
 * safety obligation actually carry it, in wording a reviewer can read.
 */

describe.each(FRAMEWORK_MODULE_IDS)('module AI policy: %s', (moduleId) => {
  const policy = moduleAIPolicies[moduleId];

  it('is scoped to its own module', () => {
    const context = moduleAIRequestContext(moduleId, '/test');
    expect(context.scope).toEqual({ kind: 'module', moduleId });
    expect(canAccessModule(context, moduleId)).toEqual({ allowed: true });
  });

  it('refuses every other module', () => {
    for (const other of FRAMEWORK_MODULE_IDS) {
      if (other === moduleId) {
        continue;
      }
      const decision = canAccessModule(moduleAIRequestContext(moduleId, '/test'), other);
      expect(decision.allowed).toBe(false);
    }
  });

  it('offers a hand-off instead of widening its own scope', () => {
    const other = FRAMEWORK_MODULE_IDS.find((id) => id !== moduleId)!;
    const response = moduleAIBoundaryResponse(moduleId, other, '/test');
    expect(response).not.toBeNull();
    expect(response?.message).toBe(policy.outOfScopeMessage);
    // The offer requires the user to accept — the AI never crosses on its own. A module AI
    // hands off to Noor AI; Noor AI is the destination, so it points back at NoorLife instead.
    expect(response?.handoffPrompt).toMatch(moduleId === 'noor-ai' ? /NoorLife/ : /Noor AI/);
  });

  it('returns no boundary response for an in-scope request', () => {
    expect(moduleAIBoundaryResponse(moduleId, moduleId, '/test')).toBeNull();
  });

  it('states its limits in wording the user would see', () => {
    expect(policy.safetyRules.length).toBeGreaterThan(0);
    for (const rule of policy.safetyRules) {
      expect(rule.subject.length).toBeGreaterThan(0);
      // A limit with no message would be enforced invisibly, which reads as a bug.
      expect(rule.message.length).toBeGreaterThan(10);
      expect(['refuse', 'qualify']).toContain(rule.kind);
    }
  });

  it('has at least one capability, each with a mutation flag', () => {
    expect(policy.capabilities.length).toBeGreaterThan(0);
    for (const capability of policy.capabilities) {
      expect(typeof capability.mutatesData).toBe('boolean');
    }
  });
});

describe('medical safety — Health', () => {
  const policy = moduleAIPolicies.health;

  it('carries a standing disclaimer, visible before the first question', () => {
    expect(policy.standingDisclaimer).toBeDefined();
    expect(policy.standingDisclaimer).toMatch(/not a medical service|cannot diagnose/i);
  });

  it('refuses diagnosis and medication advice outright', () => {
    const refusals = policy.safetyRules.filter((rule) => rule.kind === 'refuse');
    expect(refusals.some((rule) => /diagnos|prescription|dosage/i.test(rule.subject))).toBe(true);
    expect(refusals.some((rule) => /prescribed treatment/i.test(rule.subject))).toBe(true);
  });

  it('directs an apparent emergency to urgent care rather than answering it', () => {
    const emergency = policy.safetyRules.find((rule) => /emergency/i.test(rule.subject));
    expect(emergency?.kind).toBe('refuse');
    expect(emergency?.message).toMatch(/emergency (number|department)/i);
  });
});

describe('financial safety — Finance', () => {
  const policy = moduleAIPolicies.finance;

  it('is positioned as educational rather than regulated advice', () => {
    expect(policy.standingDisclaimer).toBeDefined();
    expect(policy.standingDisclaimer).toMatch(/educational/i);
    expect(policy.standingDisclaimer).toMatch(/not regulated financial advice/i);
  });

  it('refuses investment, tax and legal advice', () => {
    const refusal = policy.safetyRules.find((rule) => /investment, tax or legal/i.test(rule.subject));
    expect(refusal?.kind).toBe('refuse');
  });

  it('refuses to forecast returns or recommend a product', () => {
    const refusal = policy.safetyRules.find((rule) => /predicting returns/i.test(rule.subject));
    expect(refusal?.kind).toBe('refuse');
  });
});

describe('privacy safety — Family', () => {
  it("will not reveal another member's private entry", () => {
    const rule = moduleAIPolicies.family.safetyRules.find((item) =>
      /private entry/i.test(item.subject),
    );
    expect(rule?.kind).toBe('refuse');
  });

  it("will not share a child's activity without consent", () => {
    const rule = moduleAIPolicies.family.safetyRules.find((item) => /child/i.test(item.subject));
    expect(rule?.kind).toBe('refuse');
    expect(rule?.message).toMatch(/consent/i);
  });
});

describe('academic integrity — Learning', () => {
  it('will not produce work to be submitted as the user’s own', () => {
    const rule = moduleAIPolicies.learning.safetyRules.find((item) => /graded work/i.test(item.subject));
    expect(rule?.kind).toBe('refuse');
  });
});

describe('modules without a regulatory obligation', () => {
  it('carry no standing disclaimer, so the ones that do still stand out', () => {
    // A disclaimer on every screen is a disclaimer nobody reads.
    for (const moduleId of ['planner', 'goals', 'learning', 'family', 'faith', 'noor-ai'] as const) {
      expect(moduleAIPolicies[moduleId].standingDisclaimer).toBeUndefined();
    }
  });
});
