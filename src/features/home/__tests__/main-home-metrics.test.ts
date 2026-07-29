import {
  CONTENT_HEIGHT,
  LOCKED,
  LOCKED_HEIGHTS,
  LOCKED_TYPE,
  REFERENCE_WIDTH,
  SCROLL_FALLBACK_USABLE_HEIGHT,
} from '../main-home-metrics';

/**
 * Main Home dimensional contract tests.
 *
 * These assert the values in the implementation pack so a regression fails here rather
 * than being spotted by eye in a screenshot, and they encode the pack's own rejection
 * criteria — the checks most worth making unmissable.
 */

/** Pixel 8: 1080 × 2400 px at 420 dpi, with the insets this emulator actually reports. */
const PIXEL8 = { width: 1080 / 2.625, height: 2400 / 2.625, topInset: 50.3, bottomInset: 24 };

describe('scale model', () => {
  it('uses a 393 dp reference width', () => {
    expect(REFERENCE_WIDTH).toBe(393);
  });

  /** Mirrors the production rule, which lives inside a hook. */
  const layoutScale = (width: number) => Math.min(width / REFERENCE_WIDTH, 1);

  it('never upscales above 1, whatever the screen width', () => {
    for (const width of [393, 411, 412, 430, 480, 600, 1024]) {
      expect(layoutScale(width)).toBe(1);
    }
  });

  it('renders a Pixel 8 at exactly baseline scale', () => {
    expect(layoutScale(PIXEL8.width)).toBe(1);
  });

  it('downscales below the reference width', () => {
    expect(layoutScale(360)).toBeCloseTo(0.916, 3);
    expect(layoutScale(320)).toBeCloseTo(0.8142, 3);
  });
});

describe('compact vertical budget', () => {
  it('matches the locked component heights', () => {
    expect(LOCKED_HEIGHTS).toEqual({
      header: 48,
      gapAfterHeader: 13,
      hero: 158,
      gapAfterHero: 12,
      moduleGrid: 157,
      gapAfterGrid: 10,
      todayCard: 126,
      gapAfterToday: 12,
      summaryCards: 90,
      gapAfterSummary: 12,
      aiInsight: 68,
      gapAfterInsight: 13,
      quickActions: 42,
      bottomNavigation: 68,
    });
  });

  it('sums the content to 761 dp', () => {
    expect(CONTENT_HEIGHT).toBe(761);
  });

  it('keeps every section gap within the 10–13 dp band', () => {
    const gaps = Object.entries(LOCKED_HEIGHTS)
      .filter(([key]) => key.startsWith('gapAfter'))
      .map(([, value]) => value);
    expect(gaps).toHaveLength(6);
    for (const gap of gaps) {
      expect(gap).toBeGreaterThanOrEqual(10);
      expect(gap).toBeLessThanOrEqual(13);
    }
    // Fixed at 10 by the grid-spacing correction.
    expect(LOCKED_HEIGHTS.gapAfterGrid).toBe(10);
  });

  it('leaves 8–14 dp of clearance above the navigation', () => {
    const usable =
      PIXEL8.height - PIXEL8.topInset - (LOCKED_HEIGHTS.bottomNavigation + PIXEL8.bottomInset);
    const clearance = usable - CONTENT_HEIGHT;
    expect(clearance).toBeGreaterThanOrEqual(8);
    expect(clearance).toBeLessThanOrEqual(14);
  });

  it('fits the entire dashboard on a Pixel 8 with no scrolling', () => {
    const usable =
      PIXEL8.height - PIXEL8.topInset - (LOCKED_HEIGHTS.bottomNavigation + PIXEL8.bottomInset);
    // Every section, including all three quick actions, must sit above the navigation.
    expect(CONTENT_HEIGHT).toBeLessThanOrEqual(usable);
    // Clearance above the bar, which the polish pass deliberately tightened to ~8–14 dp.
    expect(usable - CONTENT_HEIGHT).toBeGreaterThanOrEqual(8);
  });

  it('keeps the module grid equal to two tile rows plus their gap', () => {
    expect(LOCKED.grid.rows * LOCKED.grid.tileHeight + LOCKED.grid.gap).toBe(
      LOCKED_HEIGHTS.moduleGrid,
    );
  });

  it('fits the Today card heading, four rows and padding inside its height', () => {
    const used =
      LOCKED.today.headingHeight + 4 * LOCKED.today.rowHeight + LOCKED.today.paddingVertical * 2;
    expect(used).toBeLessThanOrEqual(LOCKED.today.cardHeight);
  });

  it('scrolls only when the viewport is genuinely too short', () => {
    // The gate sits just above the content height, not at a literal 820 dp: a Pixel 8's
    // usable height is 772 dp, so an 820 dp gate would scroll the one device that must not.
    expect(SCROLL_FALLBACK_USABLE_HEIGHT).toBeGreaterThan(CONTENT_HEIGHT);
    expect(SCROLL_FALLBACK_USABLE_HEIGHT - CONTENT_HEIGHT).toBeLessThanOrEqual(8);

    const pixel8Usable =
      PIXEL8.height - PIXEL8.topInset - (LOCKED_HEIGHTS.bottomNavigation + PIXEL8.bottomInset);
    expect(pixel8Usable).toBeGreaterThanOrEqual(SCROLL_FALLBACK_USABLE_HEIGHT);
  });
});

describe('pack rejection criteria', () => {
  it('keeps the hero at or below 165 dp', () => {
    expect(LOCKED.hero.height).toBe(158);
    expect(LOCKED.hero.height).toBeLessThanOrEqual(165);
  });

  it('sets the module tile height to 74 dp', () => {
    expect(LOCKED.grid.tileHeight).toBe(74);
  });

  it('uses 9 dp grid gaps on both axes, never below 8', () => {
    expect(LOCKED.grid.gap).toBe(9);
    expect(LOCKED.grid.gap).toBeGreaterThanOrEqual(8);
    expect(LOCKED.grid.gap).toBeLessThanOrEqual(10);
  });

  it('lays the grid out as exactly four columns by two rows', () => {
    expect(LOCKED.grid.columns).toBe(4);
    expect(LOCKED.grid.rows).toBe(2);
    expect(LOCKED.grid.columns * LOCKED.grid.rows).toBe(8);
  });

  it('renders module pictograms at 48 dp so the artwork reads at ~41–46 dp', () => {
    expect(LOCKED.grid.pictogram).toBe(48);
    // The cleaned PNGs place the artwork at ~85% of the canvas.
    const visible = LOCKED.grid.pictogram * 0.85;
    expect(visible).toBeGreaterThanOrEqual(40);
    expect(visible).toBeLessThanOrEqual(46);
  });

  it('sizes the centre navigation control and its image as locked', () => {
    expect(LOCKED.bottomNav.aiButton).toBe(58);
    expect(LOCKED.bottomNav.aiImage).toBe(50);
    expect(LOCKED.bottomNav.aiRaise).toBe(15);
    expect(LOCKED.bottomNav.height).toBe(68);
    expect(LOCKED.bottomNav.icon).toBe(24);
  });

  it('sizes the hero heading so its longest line clears the artwork', () => {
    // 15/18, not the polish pass's 20.5/24.5. "beautifully in sync." measures 190.9 dp at
    // 20.5 dp (Poppins SemiBold advances, −0.25 letter spacing) but the artwork's clear indigo
    // column ends ~161–166 dp from the hero's left edge, so at 20.5 dp the line renders white
    // on the robot's white head. 15 dp is the largest half-point size that clears it with a
    // safe margin. See LOCKED_TYPE's note for the full derivation.
    expect(LOCKED_TYPE.heroHeadline).toEqual([15, 18]);
  });

  it('centres the hero copy block vertically in the hero', () => {
    const [, lineHeight] = LOCKED_TYPE.heroHeadline;
    const [, eyebrowLineHeight] = LOCKED_TYPE.heroEyebrow;
    const block =
      eyebrowLineHeight +
      LOCKED.hero.eyebrowMarginBottom +
      lineHeight * 3 +
      LOCKED.hero.titleMarginBottom +
      LOCKED.hero.buttonHeight;

    expect(block).toBe(115);
    expect(LOCKED.hero.copyTop).toBe(Math.round((LOCKED.hero.height - block) / 2));
    // Symmetric to within the odd remainder — never top-heavy.
    expect(Math.abs(LOCKED.hero.height - block - LOCKED.hero.copyTop * 2)).toBeLessThanOrEqual(1);
  });
});

describe('locked component dimensions', () => {
  it('matches the header', () => {
    expect(LOCKED.header.height).toBe(48);
    expect(LOCKED.header.avatar).toBe(36);
    expect(LOCKED.header.avatarImage).toBe(34);
    expect(LOCKED.header.avatarBorderWidth).toBe(1);
    expect(LOCKED.header.notificationTarget).toBe(44);
  });

  it('matches the hero copy container and button', () => {
    expect(LOCKED.hero.radius).toBe(16);
    expect(LOCKED.hero.copyLeft).toBe(16);
    expect(LOCKED.hero.copyTop).toBe(22);
    expect(LOCKED.hero.copyWidth).toBe(182);
    expect(LOCKED.hero.eyebrowMarginBottom).toBe(5);
    expect(LOCKED.hero.buttonHeight).toBe(31);
    expect(LOCKED.hero.buttonPaddingHorizontal).toBe(12);
    expect(LOCKED.hero.buttonRadius).toBe(9);
  });

  it('keeps a visible gap of at least 10 dp between the hero title and its button', () => {
    expect(LOCKED.hero.titleMarginBottom).toBe(11);
    expect(LOCKED.hero.titleMarginBottom).toBeGreaterThanOrEqual(10);
  });

  it('matches the grid tile treatment', () => {
    expect(LOCKED.grid.tileRadius).toBe(13);
    expect(LOCKED.grid.tileBorderWidth).toBe(0.75);
    expect(LOCKED.grid.tilePaddingHorizontal).toBe(4);
    expect(LOCKED.grid.tilePaddingVertical).toBe(5);
    expect(LOCKED.grid.pictogramLabelGap).toBe(1);
  });

  it('matches the compact cards', () => {
    expect(LOCKED.today.cardHeight).toBe(126);
    expect(LOCKED.summary.height).toBe(90);
    expect(LOCKED.summary.gap).toBe(7);
    expect(LOCKED.aiInsight.height).toBe(68);
    expect(LOCKED.aiInsight.robot).toBe(44);
    expect(LOCKED.aiInsight.paddingHorizontal).toBe(12);
    expect(LOCKED.aiInsight.paddingVertical).toBe(8);
    expect(LOCKED.quickAction.height).toBe(42);
    expect(LOCKED.quickAction.gap).toBe(7);
    expect(LOCKED.quickAction.icon).toBe(18);
    expect(LOCKED.quickAction.minimumFontScale).toBe(0.86);
  });
});

describe('locked type ramp', () => {
  it('matches the correction typography', () => {
    expect(LOCKED_TYPE.greeting).toEqual([10.5, 14]);
    expect(LOCKED_TYPE.name).toEqual([15, 20]);
    expect(LOCKED_TYPE.heroEyebrow).toEqual([10.5, 14]);
    expect(LOCKED_TYPE.heroButton).toEqual([10.5, 14]);
    expect(LOCKED_TYPE.sectionTitle).toEqual([14, 18]);
    expect(LOCKED_TYPE.tileLabel).toEqual([9.5, 12]);
    expect(LOCKED_TYPE.summaryValue).toEqual([21, 25]);
    expect(LOCKED_TYPE.navLabel).toEqual([9.5, 12]);
  });

  it('keeps timeline and card body text at 9.5–11 dp', () => {
    for (const token of ['time', 'activity', 'aiBody', 'quickActionLabel'] as const) {
      const [size] = LOCKED_TYPE[token];
      expect(size).toBeGreaterThanOrEqual(9.5);
      expect(size).toBeLessThanOrEqual(11);
    }
  });

  it('keeps every line height above its font size', () => {
    for (const [size, lineHeight] of Object.values(LOCKED_TYPE)) {
      expect(lineHeight).toBeGreaterThan(size);
    }
  });
});
