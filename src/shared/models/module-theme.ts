import type { Href } from 'expo-router';

import type { ModuleId } from '@ds/tokens';
import type { IconName } from './icon';

/**
 * Module theme contract.
 *
 * Source of truth: docs/NOORLIFE_UI_DESIGN_SPEC.md §6 and §3.2.
 *
 * Shared components must never hard-code module styling; they receive a
 * ModuleTheme and read colour, label and navigation from it.
 */

/** A single bottom-navigation destination. */
export type NavItem = {
  /** Stable key, unique within the module. */
  readonly key: string;
  /** Visible label (§2.4 Label style, 12/17 · 500). */
  readonly label: string;
  readonly icon: IconName;
  /** Typed Expo Router destination. */
  readonly href: Href;
  /**
   * True for the module-AI destination only.
   *
   * §3.2: exactly one item per module is the AI destination and it must be the
   * third of five. Enforced at runtime by validateModuleTheme.
   */
  readonly isAI?: boolean;
  /** Screen-reader label, when the visible label is insufficient. */
  readonly accessibilityLabel?: string;
};

/** Exactly five navigation items; the third is always module AI (§6). */
export type ModuleNavigation = readonly [NavItem, NavItem, NavItem, NavItem, NavItem];

/**
 * Key identifying the hero illustration a module home must render.
 *
 * Resolved by design-system/illustrations/hero-artwork.tsx. Kept as a key rather
 * than an asset import so the illustration layer can be swapped for final art
 * without touching module configuration.
 */
export type HeroIllustrationKey =
  | 'main-day-timeline'
  | 'noor-ai-robot-wave'
  | 'faith-mosque-geometry'
  | 'health-pulse-landscape'
  | 'planner-calendar-stack'
  | 'finance-wallet-chart'
  | 'learning-glowing-book'
  | 'family-portrait'
  | 'goals-summit-target';

export type ModuleTheme = {
  readonly id: ModuleId;
  /** Display name used in the module top bar and on Main Home cards. */
  readonly name: string;
  /** Module primary — hero gradient end, active controls, icons, charts. */
  readonly primary: string;
  /** Module dark — hero gradient start. */
  readonly dark: string;
  /**
   * Soft background — grouped controls and tinted chips only.
   *
   * @deprecated For a module *surface*, read `ModuleColorTheme.pageSurface`, which carries this
   * exact value under the role it fills — issue #86. This field stays because `modulePalettes` is
   * the locked spec's own shape, but a screen that reaches for it is choosing between two
   * near-identical tints with no rule to guide it, which is the defect the contract removes.
   */
  readonly soft: string;
  /** Supporting accent — small highlights only, never a large area. */
  readonly supporting: string;
  /** The module's AI product name, e.g. "Faith AI" (§7–§13). */
  readonly aiLabel: string;
  readonly heroIllustration: HeroIllustrationKey;
  /** Icon shown on the Main Home module grid. */
  readonly icon: IconName;
  /** The module's default home route (§3.2 module entry rule). */
  readonly homeHref: Href;
  readonly navigation: ModuleNavigation;
};

/** Index of the mandatory module-AI navigation item (§6: the third of five). */
export const AI_NAV_INDEX = 2;

/** Required navigation item count (§6). */
export const MODULE_NAV_ITEM_COUNT = 5;
