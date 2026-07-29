import { AI_NAV_INDEX, MODULE_NAV_ITEM_COUNT, type ModuleTheme } from '@shared/models/module-theme';

/**
 * Runtime validation of the module-theme contract.
 *
 * TypeScript already forces exactly five navigation items via the
 * `ModuleNavigation` tuple, but it cannot express "the third item is the AI
 * destination". These checks close that gap and are also the assertion surface
 * used by the module-theme tests.
 *
 * Rules enforced (docs/NOORLIFE_UI_DESIGN_SPEC.md §6, §3.2):
 *   1. Exactly five navigation items.
 *   2. Item index 2 (the third) is the module-AI destination.
 *   3. Exactly one item is flagged `isAI`.
 *   4. Navigation keys are unique within the module.
 *   5. Every palette colour and label is non-empty.
 */

export type ModuleThemeViolation = {
  readonly moduleId: string;
  readonly rule: string;
  readonly message: string;
};

export function findModuleThemeViolations(theme: ModuleTheme): ModuleThemeViolation[] {
  const violations: ModuleThemeViolation[] = [];
  const report = (rule: string, message: string): void => {
    violations.push({ moduleId: theme.id, rule, message });
  };

  const nav = theme.navigation;

  if (nav.length !== MODULE_NAV_ITEM_COUNT) {
    report(
      'navigation-item-count',
      `expected exactly ${MODULE_NAV_ITEM_COUNT} navigation items, found ${nav.length}`,
    );
  }

  const aiItems = nav.filter((item) => item.isAI === true);
  if (aiItems.length !== 1) {
    report('single-ai-item', `expected exactly 1 AI navigation item, found ${aiItems.length}`);
  }

  const centreItem = nav[AI_NAV_INDEX];
  if (centreItem === undefined) {
    report('centre-item-present', `navigation index ${AI_NAV_INDEX} is missing`);
  } else if (centreItem.isAI !== true) {
    report(
      'centre-item-is-ai',
      `navigation index ${AI_NAV_INDEX} ("${centreItem.label}") must be the module AI destination`,
    );
  }

  const keys = new Set<string>();
  for (const item of nav) {
    if (keys.has(item.key)) {
      report('unique-navigation-keys', `duplicate navigation key "${item.key}"`);
    }
    keys.add(item.key);
    if (item.label.trim().length === 0) {
      report('navigation-label-present', `navigation item "${item.key}" has an empty label`);
    }
  }

  const requiredStrings: readonly (readonly [string, string])[] = [
    ['name', theme.name],
    ['primary', theme.primary],
    ['dark', theme.dark],
    ['soft', theme.soft],
    ['supporting', theme.supporting],
    ['aiLabel', theme.aiLabel],
    ['heroIllustration', theme.heroIllustration],
  ];
  for (const [field, value] of requiredStrings) {
    if (value.trim().length === 0) {
      report('required-field-present', `"${field}" must not be empty`);
    }
  }

  const hexColour = /^#[0-9A-F]{6}$/i;
  const colourFields: readonly (readonly [string, string])[] = [
    ['primary', theme.primary],
    ['dark', theme.dark],
    ['soft', theme.soft],
    ['supporting', theme.supporting],
  ];
  for (const [field, value] of colourFields) {
    if (!hexColour.test(value)) {
      report('colour-format', `"${field}" must be a 6-digit hex colour, found "${value}"`);
    }
  }

  return violations;
}

/**
 * Throws if any theme violates the contract. Called at module-evaluation time by
 * module-themes.ts so a broken theme fails at import, not at render.
 */
export function assertValidModuleThemes(themes: readonly ModuleTheme[]): void {
  const violations = themes.flatMap(findModuleThemeViolations);
  if (violations.length > 0) {
    const detail = violations.map((v) => `  • [${v.moduleId}] ${v.rule}: ${v.message}`).join('\n');
    throw new Error(`Invalid NoorLife module theme configuration:\n${detail}`);
  }
}
