/**
 * Compact Profile Home geometry.
 *
 * Source of truth for Phase 6C-1: the complete Profile index must fit one Pixel 8 viewport at
 * normal Android display size and font scale 1.0, without tiny text and without clipping.
 *
 * ── Why the numbers live here rather than in the components ──────────────────
 * "It fits" is a *dimensional* claim, and a claim nobody can check by eye is a claim that quietly
 * stops being true. Every height below is asserted against the Pixel 8 budget in
 * `__tests__/profile-metrics.test.ts`, so a card that grows past its band fails a test rather than
 * being noticed in a screenshot three sessions later.
 *
 * ── Where these values come from ────────────────────────────────────────────
 * The 393 dp baseline, the 16 dp page padding and the never-upscale rule are the entry/auth lock's,
 * consumed through `useEntryAuthMetrics` exactly as the subscription screens consume them. The
 * header geometry (54 dp tall, 36 dp control disc, 19 dp glyph, 44 dp target) is the approved
 * module header's, so Back and Help are the same controls the user meets on every module screen.
 * Nothing here modifies either lock.
 */

/** The baseline width every dp value below is expressed against. */
export const PROFILE_REFERENCE_WIDTH = 393;

export const PROFILE_LAYOUT = {
  pagePadding: 16,
  /** Vertical gap between the five stacked sections. The brief's band is 10–12 dp. */
  sectionGap: 12,
  cardRadius: 14,
  cardBorder: 1,
  minTouchTarget: 44,
  /** Added to the safe-area bottom inset, so nothing sits under the gesture bar. */
  bottomPadding: 16,

  /** The approved module header, reused so Back and Help are the same controls. */
  header: {
    height: 54,
    /** The bordered white disc drawn around each glyph. */
    control: 36,
    icon: 19,
  },

  /**
   * The identity card.
   *
   * 84 dp total, inside the brief's 76–88 dp band. Its content is the taller of the 44 dp portrait
   * and the three-line text block: 21 (name) + 2 + 16 (email) + 2 + 22 (plan badge) = 63, plus
   * 10 dp padding top and bottom = 83. The declared 84 leaves the card one whole dp rather than a
   * fractional one, and the extra is not enough to read as space.
   */
  identity: {
    height: 84,
    padding: 10,
    /** The approved profile PNG, at the ~44 dp the brief specifies. */
    avatar: 44,
    columnGap: 10,
    rowGap: 2,
    /** The visible Edit control. Its 44 dp target comes from hit slop, not from this box. */
    editHeight: 30,
    editPaddingHorizontal: 12,
    editRadius: 8,
  },

  /**
   * The membership card.
   *
   * 112 dp total, inside the brief's 100–116 dp band, and **the same 112 dp in every state** —
   * Free, Premium Single, Premium Family, and while entitlement is still loading.
   *
   *   10 padding + 22 title row + 4 + 16 supporting copy + 6 + 44 action row + 10 padding = 112
   *
   * A renewal date or a seat count, when one genuinely exists, rides in the *trailing slot of the
   * title row* rather than on a line of its own. That is what keeps the three plan presentations
   * dimensionally identical: adding a fourth line would take the card to ~132 dp and out of band,
   * and a card that changes height when data resolves is the flicker §9 forbids.
   */
  membership: {
    height: 112,
    padding: 10,
    titleRow: 22,
    gapAfterTitle: 4,
    supportingRow: 16,
    gapAfterSupporting: 6,
    actionHeight: 44,
    actionGap: 10,
    /** Width reserved for the compact "Restore Purchases" text action beside the primary CTA. */
    restoreWidth: 118,
  },

  /**
   * The five-row primary menu, as one card.
   *
   * 46 dp rows, inside the brief's 44–48 dp band and already above the 44 dp touch minimum, so the
   * target is the row itself rather than a hit-slop approximation of one.
   */
  menu: {
    rows: 5,
    rowHeight: 46,
    separator: 1,
    paddingHorizontal: 12,
    icon: 20,
    chevron: 16,
    columnGap: 12,
  },

  /** The logout row. 48 dp, its own card, visually separated from the menu above it. */
  logout: {
    height: 48,
    paddingHorizontal: 12,
    chevron: 16,
  },
} as const;

/**
 * The menu card's outer height, derived rather than restated.
 *
 * Five 46 dp rows, four hairlines between them, and the card's own top and bottom border.
 */
export function menuCardHeight(): number {
  const { menu, cardBorder } = PROFILE_LAYOUT;
  return menu.rows * menu.rowHeight + (menu.rows - 1) * menu.separator + 2 * cardBorder;
}

/**
 * The reference vertical budget, in unscaled baseline dp.
 *
 * Section order is fixed by the brief: header, identity, membership, menu, logout.
 */
export const PROFILE_HEIGHTS = {
  header: PROFILE_LAYOUT.header.height,
  gapAfterHeader: PROFILE_LAYOUT.sectionGap,
  identityCard: PROFILE_LAYOUT.identity.height,
  gapAfterIdentity: PROFILE_LAYOUT.sectionGap,
  membershipCard: PROFILE_LAYOUT.membership.height,
  gapAfterMembership: PROFILE_LAYOUT.sectionGap,
  menuCard: menuCardHeight(),
  gapAfterMenu: PROFILE_LAYOUT.sectionGap,
  logoutRow: PROFILE_LAYOUT.logout.height,
  bottomPadding: PROFILE_LAYOUT.bottomPadding,
} as const;

/** Everything the screen draws, at font scale 1.0 on the 393 dp baseline. */
export const PROFILE_CONTENT_HEIGHT = Object.values(PROFILE_HEIGHTS).reduce(
  (sum, value) => sum + value,
  0,
);

/**
 * The reference device, with the insets this emulator actually reports.
 *
 * Identical to the constant Main Home's dimensional tests use, so both screens are measured
 * against the same device rather than against two slightly different ideas of one.
 */
export const PIXEL_8 = {
  width: 1080 / 2.625,
  height: 2400 / 2.625,
  topInset: 50.3,
  bottomInset: 24,
} as const;

export type Viewport = {
  readonly height: number;
  readonly topInset: number;
  readonly bottomInset: number;
};

/** Height available to content between the status bar and the gesture bar. */
export function usableHeight(viewport: Viewport): number {
  return viewport.height - viewport.topInset - viewport.bottomInset;
}

/**
 * Whether the screen must scroll.
 *
 * ── Why this is measured rather than predicted ──────────────────────────────
 * The honest input is what the content *actually* laid out to, not a model of it. A prediction
 * would have to guess where "Personal Information" wraps at font scale 2.0, and a wrong guess
 * either clips text (unacceptable) or scrolls a screen that fits (the defect this phase removes).
 * The screen therefore feeds real `onLayout` and `onContentSizeChange` values in here, and this
 * decides — so scrolling is enabled exactly when, and only when, there is something to scroll to.
 *
 * The half-dp tolerance stops sub-pixel rounding from enabling a scroll of 0.2 dp, which reads as
 * a bouncing screen that will not settle.
 */
export function shouldEnableScroll(contentHeight: number, viewportHeight: number): boolean {
  if (contentHeight <= 0 || viewportHeight <= 0) {
    return false;
  }
  return contentHeight > viewportHeight + 0.5;
}

/** Layout scale — downscale narrow screens, never upscale. The same rule as Main Home. */
export function profileScale(screenWidth: number): number {
  return Math.min(screenWidth / PROFILE_REFERENCE_WIDTH, 1);
}
