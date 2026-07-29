import { useWindowDimensions } from 'react-native';

/**
 * Main Home layout metrics.
 *
 * Locked by the implementation pack at
 * design/production-mockups/implementation-pack/main-home — PNG_PICTOGRAM_IMPLEMENTATION_LOCK.md
 * plus the compact-layout correction, which together override any conflicting scaling or
 * icon guidance for this screen.
 *
 * ── The scale rule ──────────────────────────────────────────────────────────
 *
 *   layoutScale = Math.min(screenWidth / 393, 1)
 *
 * **Never above 1.** A Pixel 8 (411 dp) or wider handset renders at the baseline 393 dp
 * dimensions with the content column centred; it must not enlarge cards, fonts, icons or
 * spacing to fill the extra width.
 *
 * Screen *height* is never an input. Nothing scales or grows to fill a taller device, and
 * no section uses `flexGrow` to absorb vertical slack.
 *
 * ── Why these overrides are scoped here ─────────────────────────────────────
 * The pack's geometry (16 dp page padding, 6–8 dp section gaps) and its type ramp
 * (10/13 … 22/27) differ from the global tokens in NOORLIFE_UI_DESIGN_SPEC.md §2.
 * Confining them to Main Home keeps both contracts true: this screen follows its pack,
 * every other route keeps the global scale.
 */

/** The baseline width every locked dp value is expressed against. */
export const REFERENCE_WIDTH = 393;

/**
 * Usable height below which the dashboard falls back to a `ScrollView`.
 *
 * ── Why this is not the literal 820 dp ──────────────────────────────────────
 * The correction suggests scrolling below "approximately 820 dp usable height". Taken
 * literally that would scroll a Pixel 8, which is the one device required *not* to scroll:
 * its usable height is only 772 dp (914 total − 50 dp status/cutout inset − 68 dp bar −
 * 24 dp gesture inset), yet the 759 dp of content fits inside it.
 *
 * The gate is therefore the thing the suggestion was approximating — whether the content
 * actually fits — expressed as the content height plus a small margin. Above it the screen
 * renders in a plain `View` and never scrolls; below it a `ScrollView` takes over so a
 * genuinely short device clips nothing.
 */
export const SCROLL_FALLBACK_USABLE_HEIGHT = 764;

export type MainHomeMetrics = {
  /** Applied layout scale. Always ≤ 1. */
  readonly scale: number;
  /** Scales a locked dp value. Downscales on narrow screens, never upscales. */
  readonly dp: (value: number) => number;
  /** Scales a locked font size. Same cap — never enlarges. */
  readonly fs: (value: number) => number;
  readonly screenWidth: number;
  readonly screenHeight: number;
  /** Horizontal page padding (16 dp at baseline). */
  readonly pagePadding: number;
  /** Width available to cards: baseline column width minus both paddings. */
  readonly contentWidth: number;
};

export function useMainHomeMetrics(): MainHomeMetrics {
  const { width, height } = useWindowDimensions();

  // Capped at 1 — see the module note.
  const scale = Math.min(width / REFERENCE_WIDTH, 1);

  const dp = (value: number): number => Math.round(value * scale);
  const fs = (value: number): number => +(value * scale).toFixed(1);

  const columnWidth = Math.min(width, REFERENCE_WIDTH);
  const pagePadding = dp(16);

  return {
    scale,
    dp,
    fs,
    screenWidth: width,
    screenHeight: height,
    pagePadding,
    contentWidth: columnWidth - pagePadding * 2,
  };
}

/**
 * The compact vertical budget, in unscaled baseline dp.
 *
 * ── How the gaps were chosen ────────────────────────────────────────────────
 * The locked component heights total 689 dp (48 + 158 + 157 + 126 + 90 + 68 + 42). A
 * Pixel 8 offers 772 dp between its 50 dp status inset and the 68 + 24 dp navigation, so
 * 83 dp is available for the six section gaps *and* the clearance above the bar.
 *
 * The correction asks for ~8–12 dp of clearance above the navigation and for the excess
 * blank space to be removed. Twelve-dp gaps (ten below the grid, per the grid-spacing
 * section) consume 70 dp and leave ~13 dp of clearance — which lands on target without
 * enlarging a single card. Larger gaps would eat the clearance; smaller ones would leave
 * the dead space the correction is removing.
 */
export const LOCKED_HEIGHTS = {
  header: 48,
  /** 13 with `gapAfterInsight`, to bring the clearance above the bar inside 8–12 dp. */
  gapAfterHeader: 13,
  hero: 158,
  gapAfterHero: 12,
  /** 2 × 74 + 9 = 157. */
  moduleGrid: 157,
  /** Fixed at 10 by the grid-spacing correction. */
  gapAfterGrid: 10,
  todayCard: 126,
  gapAfterToday: 12,
  summaryCards: 90,
  gapAfterSummary: 12,
  aiInsight: 68,
  /**
   * 13, one more than the other section gaps.
   *
   * With every gap at 12 the clearance between the quick-action row and the navigation bar
   * measured 13.7 dp on a Pixel 8 — outside the "approximately 8–12 dp" the vertical-spacing
   * section asks for. This gap and `gapAfterHeader` each take 1 dp, shifting the column down
   * 2 dp and landing the clearance at ~11.7 dp without touching a single card height, which is
   * the adjustment the grid-spacing section permits.
   */
  gapAfterInsight: 13,
  quickActions: 42,
  bottomNavigation: 68,
} as const;

/** Total content height, excluding the fixed navigation and any safe-area inset. */
export const CONTENT_HEIGHT = Object.entries(LOCKED_HEIGHTS)
  .filter(([key]) => key !== 'bottomNavigation')
  .reduce((sum, [, value]) => sum + value, 0);

/** Locked per-component dimensions, in unscaled baseline dp. */
export const LOCKED = {
  header: {
    height: 48,
    /** Circular container; the image inside is `avatarImage`. */
    avatar: 36,
    avatarImage: 34,
    avatarBorderWidth: 1,
    avatarGap: 10,
    notificationTarget: 44,
    notificationIcon: 22,
    badge: 16,
  },
  hero: {
    height: 158,
    radius: 16,
    /**
     * All left-side hero content lives in one absolutely positioned container; the eyebrow,
     * title and button then stack normally inside it with margins. Positioning the title
     * from the top and the button from the bottom independently is what previously let them
     * close up on each other.
     */
    copyLeft: 16,
    /**
     * 21, not the polish pass's literal 13.
     *
     * 13 was measured for the previous, shorter headline, whose three lines at 24.5 dp filled
     * the hero (block height 134.5 dp in a 158 dp card, ending 10.5 dp above the bottom). The
     * new headline needs a smaller size to clear the artwork — see `LOCKED_TYPE.heroHeadline`
     * — so its block is only 115 dp. Keeping top at 13 would leave 30 dp of dead space under
     * the button and read visibly top-heavy.
     *
     * 22 = round((158 − 115) / 2), which restores the near-centred relationship the pack's own
     * geometry describes. Every gap *inside* the block stays exactly as specified.
     */
    copyTop: 22,
    copyWidth: 182,
    eyebrowMarginBottom: 5,
    /** The visible gap between the title and the button. */
    titleMarginBottom: 11,
    buttonHeight: 31,
    buttonPaddingHorizontal: 12,
    buttonRadius: 9,
    buttonGap: 5,
    starSize: 13,
  },
  grid: {
    columns: 4,
    rows: 2,
    /** Both axes, per the grid-spacing correction. */
    gap: 9,
    tileHeight: 74,
    tileRadius: 13,
    tileBorderWidth: 0.75,
    tilePaddingHorizontal: 4,
    tilePaddingVertical: 5,
    /** One shared size for all eight; per-module differences live in the PNG canvases. */
    pictogram: 48,
    pictogramLabelGap: 1,
  },
  today: {
    cardHeight: 126,
    cardRadius: 13,
    paddingHorizontal: 12,
    // 6, not 8: the card is a fixed 126 dp and must hold a 22 dp heading plus four 23 dp
    // rows — 22 + 92 + 12 = 126 exactly. The correction asks for reduced internal padding
    // rather than reduced line heights, which is what this is.
    paddingVertical: 6,
    headingHeight: 22,
    rowHeight: 23,
    dot: 7,
    line: 2,
    timeWidth: 62,
    trailingIcon: 15,
  },
  summary: {
    height: 90,
    radius: 13,
    padding: 10,
    gap: 7,
    familyIcon: 15,
    progressBarHeight: 4,
    ring: 46,
    ringStroke: 6,
  },
  aiInsight: {
    height: 68,
    radius: 13,
    paddingHorizontal: 12,
    paddingVertical: 8,
    robot: 44,
    chevronTarget: 44,
  },
  quickAction: {
    height: 42,
    radius: 11,
    gap: 7,
    icon: 18,
    paddingHorizontal: 5,
    contentGap: 5,
    /** Lets "Family Check-in" shrink slightly rather than ellipsise. */
    minimumFontScale: 0.86,
  },
  bottomNav: {
    height: 68,
    icon: 24,
    aiButton: 58,
    aiImage: 50,
    aiRaise: 15,
    aiBorder: 2.5,
    labelMarginTop: 2,
  },
} as const;

/**
 * Locked Main Home type ramp, as `[fontSize, lineHeight]` in unscaled baseline dp.
 *
 * The hero heading is **600**, never 700 or above — the correction is explicit that the
 * previous heading read too bold against the reference.
 *
 * ── Why `heroHeadline` is 15/18 and not the specified 20.5/24.5 ──────────────
 * The polish pass changes the headline to "Your family, / your day, / beautifully in sync."
 * *and* keeps 20.5 dp, a 180 dp maximum width, exactly three lines, and the artwork fixed in
 * place. Those cannot all hold at once, and the measurements say so:
 *
 *   • "beautifully in sync." at Poppins SemiBold 20.5 dp with −0.25 letter spacing is
 *     **190.9 dp** wide (measured from the font's own `hmtx` advances) — already past the
 *     180 dp cap the same section sets.
 *   • The hero artwork's clear indigo column ends where the robot's ear and white head begin.
 *     In the third line's vertical band that boundary is at **~161–166 dp** from the hero's
 *     left edge, so with `copyLeft: 16` the line has ~145 dp to work in.
 *   • The previous headline fitted because its longest line, "with NoorLife.", is only
 *     135.6 dp at 20.5 dp. The new sentence is 41% longer.
 *
 * The consequence at 20.5 dp is not a clipped line but an invisible one: white glyphs land on
 * the robot's white head. §5 forbids moving the artwork, §2 requires all three lines to
 * render, and a scrim or text shadow is explicitly disallowed — so size is the only variable
 * left. 15/18 is the largest half-point size whose longest line clears the artwork with a
 * safe margin (~12 dp); 16 dp clears by only 0.2 dp and 16.5 dp overlaps.
 *
 * Weight, family, colour, letter spacing, line count and the 180 dp cap are all still met,
 * and no §15 or §18G reject criterion depends on the point size.
 */
export const LOCKED_TYPE = {
  greeting: [10.5, 14],
  name: [15, 20],
  badge: [9, 12],
  heroEyebrow: [10.5, 14],
  heroHeadline: [15, 18],
  heroButton: [10.5, 14],
  /** 9.5/12 per the grid-spacing section, which supersedes the earlier 10/13. */
  tileLabel: [9.5, 12],
  sectionTitle: [14, 18],
  viewAll: [10, 13],
  time: [10, 13],
  activity: [10, 13],
  summaryTitle: [10.5, 14],
  summaryValue: [21, 25],
  progressValue: [21, 25],
  progressSupport: [9.5, 12],
  aiTitle: [10.5, 14],
  aiBody: [10, 13],
  quickActionLabel: [10, 13],
  navLabel: [9.5, 12],
} as const satisfies Record<string, readonly [number, number]>;

export type LockedTypeToken = keyof typeof LOCKED_TYPE;
