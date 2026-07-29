import { mainHomeModules, moduleThemes } from '../module-themes';
import { findModuleThemeViolations } from '../validate-module-theme';

import { modulePalettes } from '@ds/tokens';
import { AI_NAV_INDEX, MODULE_NAV_ITEM_COUNT } from '@shared/models/module-theme';
import type { ModuleTheme } from '@shared/models/module-theme';

/**
 * Module-theme contract tests.
 *
 * These guard the two invariants the design specification is most emphatic about
 * (§6, §3.2): every module has exactly five navigation items, and the third is
 * always the module-AI destination.
 */

const allThemes = Object.values(moduleThemes);
const expectedIds = [
  'main',
  'noor-ai',
  'faith',
  'health',
  'planner',
  'finance',
  'learning',
  'family',
  'goals',
] as const;

describe('module theme completeness', () => {
  it('defines a theme for all nine modules', () => {
    expect(Object.keys(moduleThemes).sort()).toEqual([...expectedIds].sort());
  });

  it.each(expectedIds)('%s has every required field populated', (id) => {
    const theme: ModuleTheme = moduleThemes[id];
    expect(theme.id).toBe(id);
    expect(theme.name.length).toBeGreaterThan(0);
    expect(theme.aiLabel.length).toBeGreaterThan(0);
    expect(theme.heroIllustration.length).toBeGreaterThan(0);
    expect(theme.icon.length).toBeGreaterThan(0);
  });

  it.each(expectedIds)('%s colours come from the locked §2.3 palette', (id) => {
    const theme = moduleThemes[id];
    const palette = modulePalettes[id];
    expect(theme.primary).toBe(palette.primary);
    expect(theme.dark).toBe(palette.dark);
    expect(theme.soft).toBe(palette.soft);
    expect(theme.supporting).toBe(palette.supporting);
  });

  it('passes its own runtime validator with zero violations', () => {
    const violations = allThemes.flatMap(findModuleThemeViolations);
    expect(violations).toEqual([]);
  });
});

describe('centre AI navigation invariant', () => {
  it.each(expectedIds)('%s has exactly five navigation items', (id) => {
    expect(moduleThemes[id].navigation).toHaveLength(MODULE_NAV_ITEM_COUNT);
  });

  it.each(expectedIds)('%s reserves the third navigation item for module AI', (id) => {
    const centre = moduleThemes[id].navigation[AI_NAV_INDEX];
    expect(centre.isAI).toBe(true);
  });

  it.each(expectedIds)('%s flags exactly one navigation item as AI', (id) => {
    const aiItems = moduleThemes[id].navigation.filter((item) => item.isAI === true);
    expect(aiItems).toHaveLength(1);
  });

  it.each(expectedIds)('%s AI item uses the robot icon, never an orb or a glyph', (id) => {
    expect(moduleThemes[id].navigation[AI_NAV_INDEX].icon).toBe('robot');
  });

  it.each(expectedIds)('%s AI item carries a screen-reader label', (id) => {
    const centre = moduleThemes[id].navigation[AI_NAV_INDEX];
    expect(centre.accessibilityLabel).toBeDefined();
    expect(centre.accessibilityLabel?.length ?? 0).toBeGreaterThan(0);
  });

  it.each(expectedIds)('%s navigation keys are unique', (id) => {
    const keys = moduleThemes[id].navigation.map((item) => item.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('module AI labels match the specification', () => {
  it.each([
    ['faith', 'Faith AI'],
    ['health', 'Health AI'],
    ['planner', 'Plan AI'],
    ['finance', 'Money AI'],
    ['learning', 'Learn AI'],
    ['family', 'Family AI'],
    ['goals', 'Goal AI'],
    ['noor-ai', 'Noor AI'],
  ] as const)('%s uses the AI label "%s"', (id, label) => {
    expect(moduleThemes[id].aiLabel).toBe(label);
  });
});

describe('Main Home module grid', () => {
  it('lists exactly the eight destination modules, excluding the shell', () => {
    expect(mainHomeModules).toHaveLength(8);
    expect(mainHomeModules.map((theme) => theme.id)).not.toContain('main');
  });

  it('orders modules as the reference design lays them out', () => {
    expect(mainHomeModules.map((theme) => theme.name)).toEqual([
      'Noor AI',
      'Faith',
      'Health',
      'Planner',
      'Finance',
      'Learning',
      'Family',
      'Goals',
    ]);
  });
});

describe('validator rejects contract violations', () => {
  const base = moduleThemes.faith;

  it('rejects a theme whose third item is not AI', () => {
    const broken: ModuleTheme = {
      ...base,
      navigation: [
        base.navigation[0],
        base.navigation[1],
        { key: 'not-ai', label: 'Not AI', icon: 'home', href: '/faith' },
        base.navigation[3],
        base.navigation[4],
      ],
    };
    const rules = findModuleThemeViolations(broken).map((violation) => violation.rule);
    expect(rules).toContain('centre-item-is-ai');
    expect(rules).toContain('single-ai-item');
  });

  it('rejects duplicate navigation keys', () => {
    const broken: ModuleTheme = {
      ...base,
      navigation: [
        base.navigation[0],
        { ...base.navigation[1], key: base.navigation[0].key },
        base.navigation[2],
        base.navigation[3],
        base.navigation[4],
      ],
    };
    expect(findModuleThemeViolations(broken).map((v) => v.rule)).toContain(
      'unique-navigation-keys',
    );
  });

  it('rejects an off-format colour value', () => {
    const broken: ModuleTheme = { ...base, primary: 'green' };
    expect(findModuleThemeViolations(broken).map((v) => v.rule)).toContain('colour-format');
  });
});
