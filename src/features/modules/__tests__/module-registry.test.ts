import { moduleThemes } from '@ds/modules/module-themes';
import { AI_NAV_INDEX, MODULE_NAV_ITEM_COUNT } from '@shared/models/module-theme';

import { allModuleDefinitions, getModuleDefinition, moduleRegistry } from '../module-registry';
import { FRAMEWORK_MODULE_IDS } from '../module-tokens';

/**
 * The registry's invariants.
 *
 * These are the properties the shared components rely on. A module that violates one
 * of them would render a broken screen, and the framework's whole claim is that adding
 * a module cannot do that — so each is a test rather than a convention.
 */

describe('module registry', () => {
  it('defines exactly the eight core modules', () => {
    expect(Object.keys(moduleRegistry).sort()).toEqual([...FRAMEWORK_MODULE_IDS].sort());
    expect(allModuleDefinitions).toHaveLength(8);
    expect([...FRAMEWORK_MODULE_IDS].sort()).toEqual([
      'faith',
      'family',
      'finance',
      'goals',
      'health',
      'learning',
      'noor-ai',
      'planner',
    ]);
  });

  it('includes Noor AI and excludes locked Main Home', () => {
    // Noor AI was previously excluded as "global, not a module". It has its own approved
    // reference, navigation and hero, so it is a core module; excluding it is what left a
    // placeholder screen in the app. Main Home stays out because it is locked.
    expect(Object.keys(moduleRegistry)).toContain('noor-ai');
    expect(Object.keys(moduleRegistry)).not.toContain('main');
  });

  it('throws on an unknown module rather than returning a default', () => {
    expect(() => getModuleDefinition('nope' as never)).toThrow(/Unknown module/);
  });
});

describe.each(FRAMEWORK_MODULE_IDS)('module definition: %s', (moduleId) => {
  const definition = moduleRegistry[moduleId];

  it('has an id matching its registry key', () => {
    expect(definition.id).toBe(moduleId);
  });

  it('has exactly five navigation items with AI third', () => {
    expect(definition.navigation).toHaveLength(MODULE_NAV_ITEM_COUNT);
    expect(definition.navigation[AI_NAV_INDEX].isAI).toBe(true);
    // Exactly one, so the centre control is unambiguous.
    expect(definition.navigation.filter((item) => item.isAI === true)).toHaveLength(1);
  });

  it('reuses the validated Phase 1 navigation rather than redeclaring it', () => {
    expect(definition.navigation).toBe(moduleThemes[moduleId].navigation);
  });

  it('routes its AI to the same destination as its AI navigation item', () => {
    expect(definition.routes.ai).toBe(definition.navigation[AI_NAV_INDEX].href);
  });

  it('opens its home at the module root', () => {
    expect(definition.routes.home).toBe(moduleThemes[moduleId].homeHref);
  });

  it('names its AI the same as the spec-derived theme does', () => {
    // One assistant, one name. Two sources for it is how "Money AI" and "Finance AI"
    // end up on adjacent screens.
    expect(definition.ai.label).toBe(moduleThemes[moduleId].aiLabel);
  });

  it('scopes its AI policy to itself', () => {
    expect(definition.ai.moduleId).toBe(moduleId);
  });

  it('resolves a pictogram', () => {
    expect(definition.pictogram).toBeDefined();
  });

  it('ships a complete hero with no blank upper area', () => {
    // The brief's requirement, asserted: a module cannot ship an empty hero.
    // Every hero carries an approved headline. Eyebrow and action are empty only for Noor AI,
    // whose reference shows a question rather than a labelled figure with a button.
    expect(definition.hero.headline.length).toBeGreaterThan(0);
    expect(definition.heroPictogram).toBeDefined();
  });

  it('gives every unavailable capability a reason and no destination', () => {
    for (const capability of definition.capabilities) {
      if (capability.available) {
        expect(capability.href).toBeDefined();
      } else {
        // A tile that looks live and does nothing is the failure this prevents.
        expect(capability.unavailableReason).toBeDefined();
        expect(capability.unavailableReason?.length ?? 0).toBeGreaterThan(0);
        expect(capability.href).toBeUndefined();
      }
    }
  });

  it('has unique capability and quick-action keys', () => {
    const capabilityKeys = definition.capabilities.map((item) => item.key);
    expect(new Set(capabilityKeys).size).toBe(capabilityKeys.length);
    const actionKeys = definition.quickActions.map((item) => item.key);
    expect(new Set(actionKeys).size).toBe(actionKeys.length);
  });

  it('explains every permission it asks for', () => {
    expect(definition.permissions.length).toBeGreaterThan(0);
    for (const permission of definition.permissions) {
      expect(permission.title.length).toBeGreaterThan(0);
      // A permission whose rationale is a stub should not be requested at all.
      expect(permission.rationale.length).toBeGreaterThan(20);
    }
  });

  it('supplies copy for every state', () => {
    const { empty, error, offline, loading } = definition.stateCopy;
    for (const value of [
      empty.title,
      empty.body,
      empty.action,
      error.title,
      error.body,
      error.action,
      offline.title,
      offline.body,
      loading,
    ]) {
      expect(value.length).toBeGreaterThan(0);
    }
  });

  it('writes error copy that does not blame the user or say "something went wrong"', () => {
    // "Something went wrong on our side" is exactly the unreadable message a real
    // signup failure produced earlier in this project.
    expect(definition.stateCopy.error.title.toLowerCase()).not.toContain('something went wrong');
    expect(definition.stateCopy.error.body.toLowerCase()).not.toContain('you did');
  });
});
