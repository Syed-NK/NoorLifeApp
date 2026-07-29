/**
 * NoorLife locked size tokens: icons, touch targets and named element sizes.
 *
 * Source of truth: docs/NOORLIFE_UI_DESIGN_SPEC.md §2.5, §3.1, §3.2, §8.
 */

/**
 * Icon sizes.
 *
 * Specification note: §2.5 and §8 fix the touch target (44) and §3.1/§3.2 fix
 * the AI control (52). The intermediate glyph sizes below are the minimum set
 * needed to render the referenced screens on an 8-point grid (16/20/24/28/32)
 * and are documented here as a necessary technical addition.
 */
export const iconSize = {
  /** Inline metadata and chevrons. */
  xs: 16,
  /** Bottom-navigation glyphs and list-row leading icons. */
  sm: 20,
  /** Default action / top-bar glyph. */
  md: 24,
  /** Module-card and metric-card glyph. */
  lg: 28,
  /** Hero and state-view glyph. */
  xl: 32,
} as const;

export type IconSizeToken = keyof typeof iconSize;

export const touchTarget = {
  /** §8 / §2.5: absolute minimum interactive size, both axes. */
  minimum: 44,
} as const;

export const elementSize = {
  /**
   * Centre module-AI navigation control.
   *
   * Design spec §3.1/§3.2 states 52; the Main Home implementation lock §13 fixes it
   * at 54 with a 3 dp ring and a 17 dp raise. The lock is the later, more specific
   * contract and the navigation bar is shared, so 54 is used throughout.
   */
  aiNavButton: 54,
  /** Lock §13: ring thickness of the centre AI control. */
  aiNavButtonBorder: 3,
  /** Lock §13: how far the centre AI control rises above the bar. */
  aiNavButtonRaise: 17,
  /** Lock §13: robot asset size inside the centre AI control. */
  aiNavRobot: 38,
  /** §3.2: module top-bar back and help buttons. */
  moduleTopBarButton: 44,
  /** §3.2: module top-bar profile photo. */
  moduleTopBarAvatar: 36,
  /**
   * §3.1: Main Home greeting avatar.
   *
   * Measured at ~36 dp in
   * design-reference/individual-core-screens/01-main-home.png, matching the §3.2
   * module avatar. The 44 dp touch minimum is met by the whole greeting row, not
   * by the image itself.
   */
  globalTopBarAvatar: 36,
  /** §01–§03: authentication buttons are equal-height 52 px. */
  authButton: 52,
  /** Primary/secondary button height; satisfies the 44 px minimum. */
  buttonHeight: 48,
  /** Bottom-navigation bar content height, excluding safe-area inset (lock §13). */
  bottomNavHeight: 72,
  /** Bottom-navigation glyph size (lock §13). */
  bottomNavIcon: 22,
} as const;

export type ElementSizeToken = keyof typeof elementSize;

/**
 * Maximum font-scale multiplier applied to display-only text.
 *
 * Specification note (§8: "Dynamic text scaling without clipping"): large
 * numeric display values must scale but cannot scale without bound inside fixed
 * hero geometry. Body and label text is left unclamped.
 */
export const maxFontSizeMultiplier = {
  /** Long-form and body copy — unclamped. */
  body: undefined,
  /** Titles inside fixed-height surfaces. */
  title: 1.6,
  /** Large numeric values (Data large). */
  data: 1.4,
  /** Navigation labels and compact chips. */
  compact: 1.3,
} as const;

export const sizes = {
  icon: iconSize,
  touchTarget,
  element: elementSize,
  maxFontSizeMultiplier,
} as const;
