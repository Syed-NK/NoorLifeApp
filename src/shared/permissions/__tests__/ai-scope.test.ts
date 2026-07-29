import { canAccessModule, requiresConfirmation, type AIRequestContext } from '../ai-scope';

/**
 * AI scope-policy tests.
 *
 * The architecture rules these enforce:
 *   • module AI stays inside its module and must not silently cross over
 *   • Noor AI is limited to NoorLife and explicitly permitted modules
 *   • private module data requires a granted permission
 *   • an AI action that changes data requires confirmation
 */

const moduleContext = (moduleId: 'faith' | 'health'): AIRequestContext => ({
  scope: { kind: 'module', moduleId },
  currentScreen: `/${moduleId}`,
  grantedModules: ['faith', 'health', 'planner'],
});

const noorAIContext = (
  permitted: readonly ('faith' | 'health' | 'planner')[],
  granted: readonly ('faith' | 'health' | 'planner')[],
): AIRequestContext => ({
  scope: { kind: 'noorlife', permittedModules: permitted },
  currentScreen: '/ai',
  grantedModules: granted,
});

describe('module AI stays inside its module', () => {
  it('allows a module AI to read its own module', () => {
    expect(canAccessModule(moduleContext('faith'), 'faith')).toEqual({ allowed: true });
  });

  it('refuses a cross-module read as out of scope, even when the user granted that module', () => {
    const decision = canAccessModule(moduleContext('faith'), 'health');
    expect(decision).toEqual({
      allowed: false,
      reason: 'out-of-scope',
      requiredModule: 'health',
    });
  });

  it('does not widen scope just because a permission exists', () => {
    // 'planner' is in grantedModules, but Faith AI still may not read it.
    const decision = canAccessModule(moduleContext('faith'), 'planner');
    expect(decision.allowed).toBe(false);
  });
});

describe('Noor AI scope and permissions', () => {
  it('allows a permitted and granted module', () => {
    expect(canAccessModule(noorAIContext(['planner'], ['planner']), 'planner')).toEqual({
      allowed: true,
    });
  });

  it('requires permission for a permitted but ungranted module', () => {
    expect(canAccessModule(noorAIContext(['planner'], []), 'planner')).toEqual({
      allowed: false,
      reason: 'permission-required',
      requiredModule: 'planner',
    });
  });

  it('refuses a module that is not in scope at all', () => {
    expect(canAccessModule(noorAIContext(['planner'], ['planner']), 'health')).toEqual({
      allowed: false,
      reason: 'out-of-scope',
      requiredModule: 'health',
    });
  });

  it('refuses everything when no module is permitted', () => {
    for (const target of ['faith', 'health', 'planner'] as const) {
      expect(canAccessModule(noorAIContext([], []), target).allowed).toBe(false);
    }
  });
});

describe('mutating AI actions require confirmation', () => {
  it('requires confirmation for a data change', () => {
    expect(requiresConfirmation({ mutatesData: true })).toBe(true);
  });

  it('does not require confirmation for a read', () => {
    expect(requiresConfirmation({ mutatesData: false })).toBe(false);
  });
});
