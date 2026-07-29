/**
 * NoorLife locked spacing tokens.
 *
 * Source of truth: docs/NOORLIFE_UI_DESIGN_SPEC.md §2.5.
 *
 * 8-point system: 4, 8, 12, 16, 24, 32, 40, 48. Every gap, padding and margin in
 * the application must be one of these values.
 */

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 40,
  xxxxl: 48,
} as const;

export type SpacingToken = keyof typeof spacing;

/** Ordered scale, used by the token tests to assert the 8-point system. */
export const spacingScale = [4, 8, 12, 16, 24, 32, 40, 48] as const;

/** §2.5 named layout constants. */
export const layout = {
  /** Screen horizontal padding. */
  screenPaddingHorizontal: 20,
  /** Card internal padding. */
  cardPadding: 16,
  /** Hero-card internal padding (§3.3). */
  heroPadding: 20,
  /** Gap between top-level sections. */
  sectionGap: 24,
  /** Gap between related cards inside a section. */
  cardGap: 12,
  /**
   * §3.0 content-density rule: no unexplained blank region may exceed this.
   * Used as the assertion value in layout tests and as the maximum permitted
   * trailing scroll gap before bottom navigation.
   */
  maxUnexplainedGap: 24,
  /** Minimum hero-card height (§3.3). */
  heroMinHeight: 180,
} as const;

export type LayoutToken = keyof typeof layout;
