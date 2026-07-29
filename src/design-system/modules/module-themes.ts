import { modulePalettes, type ModuleId } from '@ds/tokens';
import type { ModuleTheme } from '@shared/models/module-theme';

import { assertValidModuleThemes } from './validate-module-theme';

/**
 * The nine NoorLife module themes.
 *
 * Colours come from `modulePalettes` (spec §2.3) — never re-typed here, so a
 * palette can only ever be changed in one place. Navigation labels come from the
 * per-module `Navigation:` lines in spec §05–§13.
 *
 * Invariant (§6 / §3.2): every theme has exactly five navigation items and the
 * third is the module-AI destination. `assertValidModuleThemes` enforces this at
 * module-evaluation time, so a violation fails at import rather than at render.
 */

const main: ModuleTheme = {
  id: 'main',
  name: 'Main Home',
  ...modulePalettes.main,
  aiLabel: 'Noor AI',
  heroIllustration: 'main-day-timeline',
  icon: 'home',
  homeHref: '/home',
  navigation: [
    { key: 'home', label: 'Home', icon: 'home', href: '/home' },
    { key: 'modules', label: 'Modules', icon: 'modules', href: '/modules' },
    {
      key: 'noor-ai',
      label: 'Noor AI',
      icon: 'robot',
      href: '/ai',
      isAI: true,
      accessibilityLabel: 'Open Noor AI',
    },
    { key: 'insights', label: 'Insights', icon: 'insights', href: '/insights' },
    { key: 'profile', label: 'Profile', icon: 'profile', href: '/profile' },
  ],
};

const noorAI: ModuleTheme = {
  id: 'noor-ai',
  name: 'Noor AI',
  ...modulePalettes['noor-ai'],
  aiLabel: 'Noor AI',
  heroIllustration: 'noor-ai-robot-wave',
  icon: 'module-noor-ai',
  homeHref: '/ai',
  navigation: [
    { key: 'home', label: 'Home', icon: 'home', href: '/home' },
    { key: 'history', label: 'History', icon: 'history', href: '/ai/history' },
    {
      key: 'ask-ai',
      label: 'Ask AI',
      icon: 'robot',
      href: '/ai',
      isAI: true,
      accessibilityLabel: 'Ask Noor AI',
    },
    { key: 'saved', label: 'Saved', icon: 'bookmark', href: '/ai/saved' },
    { key: 'settings', label: 'Settings', icon: 'settings', href: '/settings' },
  ],
};

const faith: ModuleTheme = {
  id: 'faith',
  name: 'Faith',
  ...modulePalettes.faith,
  aiLabel: 'Faith AI',
  heroIllustration: 'faith-mosque-geometry',
  icon: 'module-faith',
  homeHref: '/faith',
  navigation: [
    { key: 'today', label: 'Today', icon: 'today', href: '/faith' },
    { key: 'quran', label: 'Quran', icon: 'quran', href: '/faith/quran' },
    {
      key: 'faith-ai',
      label: 'Faith AI',
      icon: 'robot',
      href: '/faith/ai',
      isAI: true,
      accessibilityLabel: 'Open Faith AI',
    },
    { key: 'worship', label: 'Worship', icon: 'worship', href: '/faith/prayer-times' },
    { key: 'more', label: 'More', icon: 'more', href: '/faith/more' },
  ],
};

const health: ModuleTheme = {
  id: 'health',
  name: 'Health',
  ...modulePalettes.health,
  aiLabel: 'Health AI',
  heroIllustration: 'health-pulse-landscape',
  icon: 'module-health',
  homeHref: '/health',
  navigation: [
    { key: 'overview', label: 'Overview', icon: 'home', href: '/health' },
    { key: 'track', label: 'Track', icon: 'track', href: '/health/log' },
    {
      key: 'health-ai',
      label: 'Health AI',
      icon: 'robot',
      href: '/health/ai',
      isAI: true,
      accessibilityLabel: 'Open Health AI',
    },
    { key: 'trends', label: 'Trends', icon: 'trends', href: '/health/trends' },
    { key: 'records', label: 'Records', icon: 'records', href: '/health/records' },
  ],
};

const planner: ModuleTheme = {
  id: 'planner',
  name: 'Planner',
  ...modulePalettes.planner,
  aiLabel: 'Plan AI',
  heroIllustration: 'planner-calendar-stack',
  icon: 'module-planner',
  homeHref: '/planner',
  navigation: [
    { key: 'today', label: 'Today', icon: 'today', href: '/planner' },
    { key: 'calendar', label: 'Calendar', icon: 'calendar', href: '/planner/calendar' },
    {
      key: 'plan-ai',
      label: 'Plan AI',
      icon: 'robot',
      href: '/planner/ai',
      isAI: true,
      accessibilityLabel: 'Open Plan AI',
    },
    { key: 'tasks', label: 'Tasks', icon: 'tasks', href: '/planner/tasks' },
    { key: 'routines', label: 'Routines', icon: 'routines', href: '/planner/routines' },
  ],
};

const finance: ModuleTheme = {
  id: 'finance',
  name: 'Finance',
  ...modulePalettes.finance,
  aiLabel: 'Money AI',
  heroIllustration: 'finance-wallet-chart',
  icon: 'module-finance',
  homeHref: '/finance',
  navigation: [
    { key: 'overview', label: 'Overview', icon: 'home', href: '/finance' },
    {
      key: 'transactions',
      label: 'Transactions',
      icon: 'transactions',
      href: '/finance/transactions',
    },
    {
      key: 'money-ai',
      label: 'Money AI',
      icon: 'robot',
      href: '/finance/ai',
      isAI: true,
      accessibilityLabel: 'Open Money AI',
    },
    { key: 'budgets', label: 'Budgets', icon: 'budgets', href: '/finance/budgets' },
    { key: 'goals', label: 'Goals', icon: 'target', href: '/finance/goals' },
  ],
};

const learning: ModuleTheme = {
  id: 'learning',
  name: 'Learning',
  ...modulePalettes.learning,
  aiLabel: 'Learn AI',
  heroIllustration: 'learning-glowing-book',
  icon: 'module-learning',
  homeHref: '/learning',
  navigation: [
    { key: 'learn', label: 'Learn', icon: 'learn', href: '/learning' },
    { key: 'library', label: 'Library', icon: 'library', href: '/learning/library' },
    {
      key: 'learn-ai',
      label: 'Learn AI',
      icon: 'robot',
      href: '/learning/ai',
      isAI: true,
      accessibilityLabel: 'Open Learn AI',
    },
    { key: 'progress', label: 'Progress', icon: 'progress', href: '/learning/progress' },
    { key: 'saved', label: 'Saved', icon: 'bookmark', href: '/learning/saved' },
  ],
};

const family: ModuleTheme = {
  id: 'family',
  name: 'Family',
  ...modulePalettes.family,
  aiLabel: 'Family AI',
  heroIllustration: 'family-portrait',
  icon: 'module-family',
  homeHref: '/family',
  navigation: [
    { key: 'family', label: 'Family', icon: 'family', href: '/family' },
    { key: 'calendar', label: 'Calendar', icon: 'calendar', href: '/family/calendar' },
    {
      key: 'family-ai',
      label: 'Family AI',
      icon: 'robot',
      href: '/family/ai',
      isAI: true,
      accessibilityLabel: 'Open Family AI',
    },
    { key: 'memories', label: 'Memories', icon: 'memories', href: '/family/memories' },
    { key: 'safety', label: 'Safety', icon: 'safety', href: '/family/safety' },
  ],
};

const goals: ModuleTheme = {
  id: 'goals',
  name: 'Goals',
  ...modulePalettes.goals,
  aiLabel: 'Goal AI',
  heroIllustration: 'goals-summit-target',
  icon: 'module-goals',
  homeHref: '/goals',
  navigation: [
    { key: 'goals', label: 'Goals', icon: 'target', href: '/goals' },
    { key: 'habits', label: 'Habits', icon: 'habits', href: '/goals/habits' },
    {
      key: 'goal-ai',
      label: 'Goal AI',
      icon: 'robot',
      href: '/goals/ai',
      isAI: true,
      accessibilityLabel: 'Open Goal AI',
    },
    { key: 'progress', label: 'Progress', icon: 'progress', href: '/goals/progress' },
    { key: 'wins', label: 'Wins', icon: 'wins', href: '/goals/wins' },
  ],
};

export const moduleThemes = {
  main,
  'noor-ai': noorAI,
  faith,
  health,
  planner,
  finance,
  learning,
  family,
  goals,
} as const satisfies Record<ModuleId, ModuleTheme>;

// Fail fast at import time if a theme ever violates the §6 navigation contract.
assertValidModuleThemes(Object.values(moduleThemes));

/** Resolve a module theme by id. */
export function getModuleTheme(id: ModuleId): ModuleTheme {
  return moduleThemes[id];
}

/**
 * The eight modules shown on the Main Home grid, in the order the reference
 * design lays them out (design-reference/full-core-screens/01-*.png).
 *
 * `main` is excluded: it is the aggregating shell, not a destination module.
 */
export const mainHomeModuleOrder = [
  'noor-ai',
  'faith',
  'health',
  'planner',
  'finance',
  'learning',
  'family',
  'goals',
] as const satisfies readonly Exclude<ModuleId, 'main'>[];

/**
 * A Main Home grid entry — a module theme whose id is narrowed to exclude the `main`
 * shell, so consumers such as the PNG pictogram registry can index by it without
 * re-checking.
 */
export type MainHomeModuleTheme = ModuleTheme & { readonly id: Exclude<ModuleId, 'main'> };

export const mainHomeModules: readonly MainHomeModuleTheme[] = mainHomeModuleOrder.map((id) => ({
  ...moduleThemes[id],
  // `moduleThemes[id]` widens `id` back to the full ModuleId union, so it is restated
  // from the loop variable — which is already narrowed by `mainHomeModuleOrder`.
  id,
}));
