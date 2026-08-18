import type { Href } from 'expo-router';

import { globalRoutes, moduleRoutes } from './routes';

/**
 * Where a "back" gesture goes, for every module screen in the app.
 *
 * ── The problem this solves ─────────────────────────────────────────────────
 * `router.back()` pops whatever happens to be on the stack. That is correct exactly
 * when the user walked in through the front door, and wrong in three situations this
 * app actually has:
 *
 *   • a notification deep-links straight to `/faith/tasbih` — the stack below it is
 *     empty, so `back()` exits the app
 *   • a shared link opens `/faith/quran` cold — same
 *   • the user reaches a Faith child from Main Home's timeline rather than from Faith
 *     Home — `back()` returns to Main Home, skipping the module home entirely
 *
 * In all three the *visible* back arrow should mean the same thing: go up one level in
 * the information hierarchy. That is a property of the route, not of the history, so it
 * is declared here rather than inferred at runtime.
 *
 * ── The rule, stated once ───────────────────────────────────────────────────
 *   • a module **home** (`/faith`) goes up to Main Home
 *   • a module **child** (`/faith/quran`) goes up to its module home
 *   • nothing goes up to authentication, and no child skips its module home
 *
 * ── Android hardware back ───────────────────────────────────────────────────
 * Deliberately left alone. The hardware button is a *history* control and users expect
 * it to retrace their steps; the header arrow is a *hierarchy* control. Overriding the
 * hardware button to follow the hierarchy would break the one gesture Android users
 * rely on to undo a navigation. Expo Router's stack handles it, and on a cold deep link
 * it exits the app, which is the platform-correct behaviour.
 */

/** Modules whose children must return to a module home rather than to Main Home. */
const MODULE_HOMES = {
  faith: moduleRoutes.faith.home,
  health: moduleRoutes.health.home,
  planner: moduleRoutes.planner.home,
  finance: moduleRoutes.finance.home,
  learning: moduleRoutes.learning.home,
  family: moduleRoutes.family.home,
  goals: moduleRoutes.goals.home,
  // Noor AI's home *is* `/ai`, so a Noor AI child goes up to `/ai` and `/ai` itself
  // goes up to Main Home — the same rule, no special case.
  'noor-ai': globalRoutes.noorAI,
} as const satisfies Record<string, Href>;

export type ParentableModuleId = keyof typeof MODULE_HOMES;

/** The canonical Main Home destination. Everything above a module home lands here. */
export const MAIN_HOME: Href = globalRoutes.home;

/**
 * The parent of a module home. Always Main Home.
 *
 * A function rather than a constant so a call site reads as "the parent of this screen"
 * and can be swapped if the hierarchy ever gains a level.
 */
export function moduleHomeParent(): Href {
  return MAIN_HOME;
}

/** The parent of any child screen inside `moduleId` — that module's home. */
export function moduleChildParent(moduleId: ParentableModuleId): Href {
  return MODULE_HOMES[moduleId];
}

/**
 * Resolves the parent for a screen, given the module it belongs to and whether it is
 * that module's home.
 *
 * One entry point so a screen never decides the rule for itself. `ModuleScaffold`
 * calls this; individual screens pass `isHome` and nothing else.
 */
export function resolveBackDestination(moduleId: ParentableModuleId, isHome: boolean): Href {
  return isHome ? moduleHomeParent() : moduleChildParent(moduleId);
}

/** Every module home, for tests that assert the map is total. */
export const moduleHomeRoutes: Readonly<Record<ParentableModuleId, Href>> = MODULE_HOMES;
