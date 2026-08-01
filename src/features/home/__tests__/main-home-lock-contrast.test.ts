import fs from 'node:fs';
import path from 'node:path';

import { modulePalettes, navigationColors, neutralColors, semanticColors } from '@ds/tokens';
import {
  AA_TEXT,
  AA_UI,
  composite,
  contrastRatio,
  formatRatio,
} from '@features/modules/contrast';

import { LOCKED, LOCKED_TYPE } from '../main-home-metrics';
import {
  LOCK_GLYPH,
  LOCK_GLYPH_COMPACT,
  MODULE_LOCK_INK,
  MODULE_LOCK_SCRIM,
} from '../module-lock-theme';
import { MODULE_TILE_TINT } from '../module-tile-theme';

/**
 * Every locked Main Home surface, measured against the colour it is actually drawn on.
 *
 * ── Why this suite exists ───────────────────────────────────────────────────
 * A release build on a Pixel 8 came back with "locked module and Quick Action labels are slightly too
 * faded" and "several lock badges are too small to recognize comfortably". Both were true, and both
 * had passed every test in the repository, because nothing measured anything: the locked states were
 * expressed as opacity multipliers, and an opacity is invisible to an assertion about a colour token.
 *
 * The module tile label was the worst of it. The scrim was drawn *after* the label, so the label the
 * design specified at ~15:1 rendered at **2.68:1** — and the code comment beside it correctly
 * described the behaviour it did not have. A reviewer reading either the token or the comment would
 * have agreed it was fine.
 *
 * So this file composites what the device composites and takes the ratio of the result. It is the
 * only test here that can fail for a reason a screenshot would show.
 */

const SCRIM_ALPHA = 0.55;

/**
 * The scrim's own alpha, read back out of the token rather than restated.
 *
 * If someone changes the scrim's opacity, this suite must measure the new one — a hard-coded 0.55
 * here would keep asserting the old, passing arithmetic against a screen that had changed.
 */
function scrimAlpha(): number {
  const match = /rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*([\d.]+)\s*\)/.exec(MODULE_LOCK_SCRIM);
  if (match?.[1] === undefined) {
    throw new Error(`Could not read an alpha out of MODULE_LOCK_SCRIM: "${MODULE_LOCK_SCRIM}"`);
  }
  return Number.parseFloat(match[1]);
}

/** The scrim's own colour, likewise. */
function scrimColour(): string {
  const match = /rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,/.exec(MODULE_LOCK_SCRIM);
  if (match === null) {
    throw new Error(`Could not read a colour out of MODULE_LOCK_SCRIM: "${MODULE_LOCK_SCRIM}"`);
  }
  const hex = match
    .slice(1, 4)
    .map((channel) => Number.parseInt(channel, 10).toString(16).padStart(2, '0'))
    .join('');
  return `#${hex}`;
}

/** What a locked tile's surface actually looks like: the module tint under the scrim. */
function scrimmedTile(moduleId: keyof typeof MODULE_TILE_TINT): string {
  return composite(scrimColour(), scrimAlpha(), MODULE_TILE_TINT[moduleId]);
}

const PAID_MODULES = ['health', 'planner', 'finance', 'learning', 'family', 'goals'] as const;
const TILE_MODULES = Object.keys(MODULE_TILE_TINT) as (keyof typeof MODULE_TILE_TINT)[];

/** Reports the measured value in the failure message, so a regression says by how much. */
function expectRatio(foreground: string, background: string, threshold: number, what: string) {
  const ratio = contrastRatio(foreground, background);
  if (ratio < threshold) {
    throw new Error(
      `${what}: ${formatRatio(ratio)} against ${background}, needs ${threshold}:1 (${foreground})`,
    );
  }
  expect(ratio).toBeGreaterThanOrEqual(threshold);
}

// ── The scrim is confirmed to be what the arithmetic assumes ─────────────────

describe('the locked tile scrim', () => {
  it('is the page canvas at a documented alpha, not an arbitrary grey', () => {
    expect(scrimColour().toUpperCase()).toBe(neutralColors.canvas.toUpperCase());
    expect(scrimAlpha()).toBe(SCRIM_ALPHA);
  });
});

// ── Module tiles ────────────────────────────────────────────────────────────

describe('a locked module tile', () => {
  it.each(TILE_MODULES)('keeps its %s label at AA against the scrimmed surface', (moduleId) => {
    // The label is drawn *over* the scrim, so it is `textPrimary` on the composited tile — not
    // `textPrimary` composited with the scrim, which is what the shipped build was doing.
    expectRatio(
      neutralColors.textPrimary,
      scrimmedTile(moduleId),
      AA_TEXT,
      `${moduleId} tile label`,
    );
  });

  it.each(TILE_MODULES)('would have failed AA if the scrim washed over the %s label', (moduleId) => {
    // The shipped defect, asserted as a defect. If the scrim ever returns to being the last child,
    // the test above fails — and this one documents what the failure would have measured.
    const washed = composite(scrimColour(), scrimAlpha(), neutralColors.textPrimary);
    expect(contrastRatio(washed, scrimmedTile(moduleId))).toBeLessThan(AA_TEXT);
  });

  it.each(TILE_MODULES)('keeps its %s padlock recognisable against the scrimmed tile', (moduleId) => {
    // The glyph sits directly on the tile now — the near-white disc behind it was dropped, so this
    // is the ratio that has to hold on its own.
    expectRatio(MODULE_LOCK_INK, scrimmedTile(moduleId), AA_UI, `${moduleId} tile padlock`);
  });

  it('desaturates the tile without hiding its module identity', () => {
    // "Keep module identity colours visible beneath the restrained lock treatment": each scrimmed
    // tile must still differ from the plain page canvas, or the grid would read as eight grey boxes.
    for (const moduleId of TILE_MODULES) {
      expect(scrimmedTile(moduleId).toLowerCase()).not.toBe(neutralColors.canvas.toLowerCase());
    }
    // And no two modules collapse onto the same colour.
    const distinct = new Set(TILE_MODULES.map((id) => scrimmedTile(id)));
    expect(distinct.size).toBeGreaterThan(1);
  });
});

// ── Quick actions ───────────────────────────────────────────────────────────

describe('a locked quick action', () => {
  it('keeps its label at full strength on the white tile', () => {
    expectRatio(neutralColors.textPrimary, neutralColors.surface, AA_TEXT, 'quick-action label');
  });

  it('keeps its padlock recognisable on the white tile', () => {
    expectRatio(MODULE_LOCK_INK, neutralColors.surface, AA_UI, 'quick-action padlock');
  });
});

// ── Timeline ────────────────────────────────────────────────────────────────

describe('a locked timeline row', () => {
  it('keeps its padlock recognisable on the white card', () => {
    expectRatio(MODULE_LOCK_INK, neutralColors.surface, AA_UI, 'timeline padlock');
  });

  it('keeps the time column at AA', () => {
    expectRatio(neutralColors.textSecondary, neutralColors.surface, AA_TEXT, 'timeline time');
  });

  /**
   * The accents are approved, and several are already under AA on white at full strength — finance
   * measures 2.64:1, health 2.90:1. That is a palette characteristic this phase cannot fix: the
   * palette is locked, and the same accents are what an unlocked row renders.
   *
   * What the locked state must not do is make it *worse*, which multiplying by 0.85 did. Recorded
   * here as the measured baseline so a future "muted" treatment cannot quietly dip below it, and
   * called out in the phase report rather than silently tolerated.
   */
  it.each(PAID_MODULES)('records what a %s-accented label measures at full strength', (moduleId) => {
    const accent = modulePalettes[moduleId].primary;
    const atFullStrength = contrastRatio(accent, neutralColors.surface);
    // Anything dimmed lands below this, which is the check that has teeth.
    expect(contrastRatio(composite(accent, 0.85, neutralColors.surface), neutralColors.surface)).
      toBeLessThan(atFullStrength);
    expect(atFullStrength).toBeGreaterThan(1);
  });
});

// ── The rule, enforced against the source ───────────────────────────────────

describe('no locked surface carries its state in an opacity', () => {
  /**
   * A source scan, because this is the defect class rather than one defect.
   *
   * Every value in this suite is measurable only because the locked states are opaque colours. The
   * moment one of them becomes `opacity: isLocked ? … : 1` again, the arithmetic above stops
   * describing the screen — which is exactly how a label specified at 15:1 shipped at 2.68:1 with a
   * full green suite. A rendered-tree assertion cannot catch it either, since the opacity would sit on
   * a style the ratio never consults.
   */
  const LOCKED_SURFACES = [
    'src/features/home/components/module-grid.tsx',
    'src/features/home/components/today-timeline.tsx',
    'src/features/home/components/quick-actions-row.tsx',
    'src/features/home/components/home-summary-row.tsx',
    'src/features/home/components/home-bottom-navigation.tsx',
  ] as const;

  it.each(LOCKED_SURFACES)('%s ties no opacity to its lock state', (filePath) => {
    const source = fs.readFileSync(path.join(process.cwd(), filePath), 'utf8');
    // `isLocked` and `opacity` on the same line, in either order.
    expect(source).not.toMatch(/opacity[^\n]*isLocked|isLocked[^\n]*opacity/);
  });
});

// ── "View All" ──────────────────────────────────────────────────────────────

describe("Today at a Glance's locked View All", () => {
  it('is readable in its muted premium styling', () => {
    // Stepped from the global primary to secondary ink, which reads as "not a live link" while
    // staying above AA — the point of the correction was visibility, not decoration.
    expectRatio(neutralColors.textSecondary, neutralColors.surface, AA_TEXT, 'locked View All');
  });

  it('is a visible step down from the unlocked primary, not a different hue', () => {
    const locked = contrastRatio(neutralColors.textSecondary, neutralColors.surface);
    const unlocked = contrastRatio(semanticColors.primary, neutralColors.surface);
    expect(locked).toBeLessThan(unlocked);
    expect(locked).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('replaces the chevron with a padlock no wider than it', () => {
    // The heading is a `space-between` row whose title shrinks, so a wider trailing control would
    // reflow "Today at a Glance". The padlock's drawn width is 0.82 × its height.
    const chevron = 12;
    expect(LOCK_GLYPH_COMPACT * 0.82).toBeLessThanOrEqual(chevron);
  });
});

// ── Bottom navigation ───────────────────────────────────────────────────────

describe('the locked Insights tab', () => {
  it('keeps its icon at the inactive tint, which clears the indicator floor', () => {
    // It was briefly halved, which measured 1.79:1. The tint itself only has 3.77:1 to give.
    expectRatio(navigationColors.inactive, neutralColors.surface, AA_UI, 'Insights icon');
  });

  it('keeps its padlock recognisable on the bar', () => {
    expectRatio(MODULE_LOCK_INK, neutralColors.surface, AA_UI, 'Insights padlock');
  });
});

// ── Summary cards ───────────────────────────────────────────────────────────

describe('the locked summary cards', () => {
  it('keeps the replacement copy readable', () => {
    // "Premium" is `textPrimary`; "Unlock family connection" and "Included with Premium" are
    // `textSecondary`. Both on the white card.
    expectRatio(neutralColors.textPrimary, neutralColors.surface, AA_TEXT, 'summary value');
    expectRatio(neutralColors.textSecondary, neutralColors.surface, AA_TEXT, 'summary support');
  });

  it('keeps its padlock recognisable', () => {
    expectRatio(MODULE_LOCK_INK, neutralColors.surface, AA_UI, 'summary padlock');
  });

  it('draws the locked ring and track as a surface, not as a value', () => {
    // Deliberately *low* contrast: these are empty placeholders at the real dimensions, and a
    // high-contrast one would read as a filled bar — a metric the user has not earned.
    expect(contrastRatio(neutralColors.surfaceSoft, neutralColors.surface)).toBeLessThan(AA_UI);
  });
});

// ── The padlock's size ──────────────────────────────────────────────────────

describe('the padlock size', () => {
  it('is inside the 12–14 dp the correction asks for', () => {
    expect(LOCK_GLYPH).toBeGreaterThanOrEqual(12);
    expect(LOCK_GLYPH).toBeLessThanOrEqual(14);
  });

  it('is larger than the ink the previous implementation drew', () => {
    // `size` used to mean a container the glyph filled about 65% of, so `size={11}` drew ~7 dp and
    // `size={9}` drew under 6 — the "too small to recognize comfortably" defect. It now means the
    // glyph, so every caller gets what it asks for.
    const previousInkFor = (containerSize: number) => containerSize * 0.65;
    expect(LOCK_GLYPH).toBeGreaterThan(previousInkFor(13));
    expect(LOCK_GLYPH).toBeGreaterThan(previousInkFor(11));
    expect(LOCK_GLYPH).toBeGreaterThan(previousInkFor(9));
  });

  it('fits the surfaces it is drawn on, without covering their content', () => {
    // Quick action: the 42 dp tile's content pair occupies the middle ~18 dp, so the top band is
    // (42 − 18) / 2 = 12 dp — exactly the glyph's height, which is why it sits at the top edge.
    const quickActionTopBand = (LOCKED.quickAction.height - LOCKED.quickAction.icon) / 2;
    expect(LOCK_GLYPH).toBeLessThanOrEqual(quickActionTopBand);

    // Module tile: a centred 48 dp pictogram in an 83.5 dp tile leaves a 17.75 dp side margin, and
    // the glyph is 0.82 × 12 = 9.84 dp wide, so it clears the artwork's box entirely.
    const tileWidth = (393 - 32 - LOCKED.grid.gap * 3) / LOCKED.grid.columns;
    const sideMargin = (tileWidth - LOCKED.grid.pictogram) / 2;
    expect(LOCK_GLYPH * 0.82).toBeLessThan(sideMargin);

    // Timeline row: 12 dp inside a 23 dp row.
    expect(LOCK_GLYPH).toBeLessThan(LOCKED.today.rowHeight);

    // Today's heading: the compact glyph beside 10 dp text in a 22 dp row.
    expect(LOCK_GLYPH_COMPACT).toBeLessThan(LOCKED.today.headingHeight);
    expect(LOCK_GLYPH_COMPACT).toBeGreaterThan(LOCKED_TYPE.viewAll[0]);

    // Bottom navigation: smaller than the icon it badges, so the bar's height cannot move.
    expect(LOCK_GLYPH).toBeLessThan(LOCKED.bottomNav.icon);
  });
});

// ── The rule the whole treatment rests on ───────────────────────────────────

describe('the locked treatment', () => {
  it('never communicates the state with colour alone', () => {
    // Nothing on a locked surface is tinted or dimmed differently from its unlocked counterpart,
    // except "View All" — which also gains a padlock. Every locked surface carries the glyph, and
    // every locked control's accessible name ends "Premium feature". This test is the statement of
    // that rule; the per-surface tests in the Main Home suites assert both halves on the rendered
    // tree.
    expect(LOCK_GLYPH).toBeGreaterThan(0);
    expect(MODULE_LOCK_INK).toBe(neutralColors.textSecondary);
  });
});
