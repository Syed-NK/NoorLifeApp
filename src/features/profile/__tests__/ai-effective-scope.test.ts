import {
  FREE_ENTITLEMENT,
  PLAN_CAPABILITIES,
  type Entitlement,
} from '@features/subscription/domain/entitlement';

import {
  AI_BOUNDARIES,
  AI_CONVERSATION_STORAGE_EXISTS,
  AI_GRANT_EDITING_AVAILABLE,
  effectiveAIScope,
  grantsDataAccess,
} from '../privacy/ai-effective-scope';
import { privacySecurityCopy } from '../privacy-security-copy';

/**
 * The effective AI scope — the two questions kept apart, and the ways a grant must not widen.
 *
 * Everything asserted here is decided by `entitlement.ts` and `noor-ai-scope.ts`; this suite proves
 * that the *display* reproduces those decisions rather than paraphrasing them, which is the failure
 * that produces a privacy screen describing a stricter product than the one shipping.
 */

const PREMIUM: Entitlement = {
  ...FREE_ENTITLEMENT,
  plan: 'premium_single',
  status: 'active',
  capabilities: PLAN_CAPABILITIES.premium_single,
};

const LAPSED: Entitlement = {
  ...PREMIUM,
  status: 'expired',
};

function scopeFor(entitlement: Entitlement, grants: readonly string[] = []) {
  return effectiveAIScope(entitlement, grants as never);
}

function find(entitlement: Entitlement, moduleId: string, grants: readonly string[] = []) {
  return scopeFor(entitlement, grants).find((entry) => entry.moduleId === moduleId);
}

describe('the free plan', () => {
  it('keeps Noor AI and Faith assistants available', () => {
    expect(find(FREE_ENTITLEMENT, 'noor-ai')?.assistantAvailable).toBe(true);
    expect(find(FREE_ENTITLEMENT, 'faith')?.assistantAvailable).toBe(true);
  });

  it('closes the six paid module assistants', () => {
    for (const paid of ['health', 'planner', 'finance', 'learning', 'family', 'goals']) {
      expect(find(FREE_ENTITLEMENT, paid)?.assistantAvailable).toBe(false);
    }
  });

  it('reports the paid modules as requiring Premium for Noor AI data access', () => {
    for (const paid of ['health', 'planner', 'finance', 'learning', 'family', 'goals']) {
      expect(find(FREE_ENTITLEMENT, paid)?.noorAIAccess).toBe('requires-premium');
    }
  });

  it('does not silently open Faith data to Noor AI just because Faith is free', () => {
    // Faith is reachable — it is never a paid module — but reading a user's Faith activity is a
    // permission question, and no grant exists. "Asks first" is the honest answer.
    expect(find(FREE_ENTITLEMENT, 'faith')?.noorAIAccess).toBe('permission-required');
  });
});

describe('a paid plan', () => {
  it('opens the paid module assistants', () => {
    for (const paid of ['health', 'planner', 'finance', 'learning', 'family', 'goals']) {
      expect(find(PREMIUM, paid)?.assistantAvailable).toBe(true);
    }
  });

  it('does not by itself grant Noor AI access to a module the user has not granted', () => {
    // The whole point: paying opens the module, it does not open the data to the assistant.
    for (const paid of ['health', 'finance', 'family']) {
      const entry = find(PREMIUM, paid);
      expect(entry?.noorAIAccess).toBe('permission-required');
      expect(grantsDataAccess(entry as never)).toBe(false);
    }
  });

  it('honours a grant the user has actually made', () => {
    expect(find(PREMIUM, 'finance', ['finance'])?.noorAIAccess).toBe('allowed');
  });

  it('leaves a module the user did not grant untouched by one they did', () => {
    expect(find(PREMIUM, 'health', ['finance'])?.noorAIAccess).toBe('permission-required');
  });
});

describe('a lapsed entitlement', () => {
  it('strips a stale grant rather than honouring it', () => {
    // A grant made while subscribed is still on record. The entitlement no longer covers it, and
    // the intersection resolves that in the only safe direction.
    expect(find(LAPSED, 'finance', ['finance'])?.noorAIAccess).toBe('requires-premium');
    expect(find(LAPSED, 'finance', ['finance'])?.assistantAvailable).toBe(false);
  });

  it('leaves Faith reachable, because Faith is never paid', () => {
    expect(find(LAPSED, 'faith')?.assistantAvailable).toBe(true);
    expect(find(LAPSED, 'noor-ai')?.assistantAvailable).toBe(true);
  });
});

describe('module boundaries', () => {
  it('are taken from the shared policy, not restated', () => {
    // Same object the orchestrator contract is written against, so softening a rule there softens
    // it here rather than leaving this screen describing an older product.
    expect(AI_BOUNDARIES.health).toContain('diagnose');
    expect(AI_BOUNDARIES.finance).toContain('investment');
    expect(AI_BOUNDARIES.faith).toContain('approved sources');
    expect(AI_BOUNDARIES.family).toContain('consent');
  });

  it('has a label for every boundary the policy declares', () => {
    for (const subject of Object.keys(AI_BOUNDARIES)) {
      expect(
        privacySecurityCopy.ai.boundaryLabels[
          subject as keyof typeof privacySecurityCopy.ai.boundaryLabels
        ],
      ).toBeTruthy();
    }
  });

  it('states the cross-module rule as a hand-off the user must accept', () => {
    const sentence = privacySecurityCopy.ai.crossModule;
    expect(sentence).toContain('never answers about another module on its own');
    expect(sentence).toContain('have to accept');
  });
});

describe('what does not exist yet', () => {
  it('records that no conversation store exists, so the screen can say so', () => {
    expect(AI_CONVERSATION_STORAGE_EXISTS).toBe(false);
  });

  it('uses the exact sentence the brief permits only if the audit confirms it', () => {
    expect(privacySecurityCopy.ai.noHistory).toBe(
      'In the current version of NoorLife, no AI conversation history is saved on this device or on your account.',
    );
  });

  /**
   * The claim is scoped to this build, and stays scoped.
   *
   * `AI_CONVERSATION_STORAGE_EXISTS` is a fact about the code today. A sentence that reads as a
   * policy — "NoorLife does not store AI conversations" — outlives the fact it was derived from,
   * and becomes false the first time a feature saves a transcript without anybody editing copy.
   */
  it('qualifies the claim to the current version rather than stating a policy', () => {
    expect(privacySecurityCopy.ai.noHistory).toContain('In the current version of NoorLife');
  });

  it.each([
    'NoorLife does not store',
    'NoorLife never stores',
    'will never be stored',
    'is never saved',
    'we do not store',
  ])('does not promise %s for all time', (phrase) => {
    expect(privacySecurityCopy.ai.noHistory.toLowerCase()).not.toContain(phrase.toLowerCase());
  });

  it('says the line changes if the behaviour does', () => {
    expect(privacySecurityCopy.ai.noHistorySupporting).toContain('future version');
  });

  it('records that grant editing is deferred rather than faked', () => {
    expect(AI_GRANT_EDITING_AVAILABLE).toBe(false);
  });
});

describe('the eight modules', () => {
  it('are all present, in the order the framework declares', () => {
    expect(scopeFor(FREE_ENTITLEMENT).map((entry) => entry.moduleId)).toEqual([
      'noor-ai',
      'faith',
      'health',
      'planner',
      'finance',
      'learning',
      'family',
      'goals',
    ]);
  });

  it('take their display names from the registry rather than a second list', () => {
    expect(find(FREE_ENTITLEMENT, 'noor-ai')?.name).toBe('Noor AI');
    expect(find(FREE_ENTITLEMENT, 'faith')?.name).toBe('Faith');
    expect(find(FREE_ENTITLEMENT, 'goals')?.name).toBe('Goals');
  });
});
