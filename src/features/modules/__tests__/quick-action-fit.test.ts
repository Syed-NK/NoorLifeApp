import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { COMPOSED_MODULE_IDS } from '../module-compositions';
import { allModuleDefinitions } from '../module-registry';
import { moduleLayout, moduleScale, moduleType } from '../module-tokens';
import {
  quickActionRoundingAllowanceDp,
  quickActionColumns,
  quickActionLabelFits,
  quickActionMinimumBox,
  quickActionTextBox,
  type QuickActionFitInput,
} from '../quick-action-fit';

/**
 * The rule that keeps every quick-action label readable — issue #52.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── What was wrong ─────────────────────────────────────────────────────────
 * The row was one flex line, so its column count was its *action* count, and each tile spent 40 dp
 * of its width on chrome. At 320 dp that leaves 52.7 dp of text, and the label — which sets no
 * `maxFontSizeMultiplier` — renders at 13.5 dp at OS scale 1.5. "Memories" is 67.2 dp as one word,
 * so Android split it between letters; "Ask Family AI" needed a third line it was not allowed and
 * ellipsised instead.
 *
 * ── What this file measures ────────────────────────────────────────────────
 * The same instrument #50 established: exact advance widths from the committed Poppins TTFs, via
 * `hero-copy-fit.ts`, whose tables are drift-checked against those files there. `quickAction`
 * resolves to Poppins Medium, already one of its three faces, so nothing is re-implemented here.
 *
 * Every case enumerates `allModuleDefinitions` rather than a list, so a new module or a new action
 * is covered the moment it is registered.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const MODULES_ROOT = join(__dirname, '..');
const TILE = join(MODULES_ROOT, 'components', 'module-quick-action.tsx');
const RULE = join(MODULES_ROOT, 'quick-action-fit.ts');
const TEXT = join(MODULES_ROOT, 'components', 'module-text.tsx');
const HOME = join(MODULES_ROOT, 'screens', 'module-home-screen.tsx');

function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

/** A constant the tile declares, read from source so the rule and the style cannot drift apart. */
function tileConstant(name: string): number {
  const found = new RegExp(`const ${name} = (\\d+(?:\\.\\d+)?);`).exec(readFileSync(TILE, 'utf8'));
  if (found === null) throw new Error(`the tile no longer declares ${name}`);
  return Number(found[1]);
}
const PADDING_H = tileConstant('TILE_PADDING_H');
const ICON_WELL = tileConstant('TILE_ICON_WELL');
const INNER_GAP = tileConstant('TILE_INNER_GAP');
const LABEL_LINES = tileConstant('LABEL_LINES');
const BORDER = tileConstant('TILE_BORDER');

/** The nine cells issue #52 names. */
const WIDTHS = [320, 384, 411] as const;
const FONT_SCALES = [1, 1.3, 1.5] as const;
const CELLS = WIDTHS.flatMap((width) => FONT_SCALES.map((fontScale) => ({ width, fontScale })));

/** Modules whose home renders `ModuleQuickActionRow` — the generic branch. */
const PRODUCTION = allModuleDefinitions.filter(
  (module) => !COMPOSED_MODULE_IDS.includes(module.id),
);

const scaledDp = (width: number) => (value: number) => Math.round(value * moduleScale(width));

/** Row geometry, exactly as `useModuleMetrics` and the row derive it. */
function geometry(width: number) {
  const dp = scaledDp(width);
  return {
    contentWidth: Math.min(width, moduleLayout.referenceWidth) - dp(moduleLayout.pagePadding) * 2,
    columnGap: dp(moduleLayout.cardGap),
    tileChromeWidth: BORDER * 2 + dp(PADDING_H) * 2 + dp(ICON_WELL) + dp(INNER_GAP),
  };
}

/** `quickAction` at the layout scale only — what the row passes the rule. */
const layoutSize = (width: number) => +(moduleType.quickAction[0] * moduleScale(width)).toFixed(1);

/** …and as it finally renders, with the OS scale applied once and uncapped. */
const renderedSize = (width: number, fontScale: number) =>
  layoutSize(width) * Math.max(fontScale, 1);

type Registered = (typeof allModuleDefinitions)[number];

function inputFor(
  module: Registered,
  width: number,
  fontScale: number,
  overrides: Partial<QuickActionFitInput> = {},
): QuickActionFitInput {
  return {
    labels: module.quickActions.map((action) => action.label),
    ...geometry(width),
    fontSize: layoutSize(width),
    fontScale,
    maxLines: LABEL_LINES,
    ...overrides,
  };
}

/** The box a module's tiles actually get in one cell. */
function chosenBox(module: Registered, width: number, fontScale: number): number {
  return quickActionTextBox(
    geometry(width),
    quickActionColumns(inputFor(module, width, fontScale)),
  );
}

describe('the audit this rule is built on', () => {
  it('counts the registered actions and names the widest labels', () => {
    /*
      Recorded because issue #52 estimated "~40 labels across the eight modules" and the repository
      says otherwise. Every module registers quick actions, but only the four on the generic home
      branch render them through this row; Noor AI, Faith, Health and Planner draw their own
      compositions. The rule is still evaluated per row, so all of them are covered — but the count
      that matters for production is the smaller one, and a report that said forty would be wrong.
    */
    const total = allModuleDefinitions.reduce((sum, m) => sum + m.quickActions.length, 0);
    const production = PRODUCTION.reduce((sum, m) => sum + m.quickActions.length, 0);
    expect({ total, production, productionModules: PRODUCTION.map((m) => m.id).sort() }).toEqual({
      total: 22,
      production: 12,
      productionModules: ['family', 'finance', 'goals', 'learning'],
    });

    /*
      ── The binding label, measured rather than guessed ──────────────────────
      "Memories" drives the column count, and it is also the label the device split. Those two facts
      coincide for a reason worth recording: a one-word label's narrowest workable box is the word
      itself, whereas a three-word label can reach two lines in a *narrower* box than its longest
      pair suggests. "Ask Money AI" has the widest total advance of the twelve, but greedy wrapping
      gets it onto two lines at 45.89 units against "Memories" at 49.75, so the single word wins.

      That is why a rule built on total width, or on "the longest label", would have been aimed at the
      wrong string.
    */
    const labels = PRODUCTION.flatMap((m) => m.quickActions.map((a) => a.label));
    const byBox = [...labels].sort(
      (a, b) =>
        quickActionMinimumBox(b, 10, LABEL_LINES) - quickActionMinimumBox(a, 10, LABEL_LINES),
    );
    expect(byBox.slice(0, 2)).toEqual(['Memories', 'Continue']);

    const byWord = [...labels].sort(
      (a, b) =>
        Math.max(...b.split(' ').map((w) => quickActionMinimumBox(w, 10, 1))) -
        Math.max(...a.split(' ').map((w) => quickActionMinimumBox(w, 10, 1))),
    );
    expect(byWord[0]).toBe('Memories');

    // The widest *total* advance is a different label, and is not what the rule keys on.
    const byTotal = [...labels].sort(
      (a, b) => quickActionMinimumBox(b, 10, 1) - quickActionMinimumBox(a, 10, 1),
    );
    expect(byTotal[0]).toBe('Ask Money AI');
  });

  it('includes a new action by construction', () => {
    /*
      The property the issue asks for, asserted rather than promised: the rule reads the labels it is
      handed, so an action nobody has written yet is measured the same way. A registry-shaped module
      with an absurd label must reduce to one column.
    */
    const invented: Registered = {
      ...PRODUCTION[0]!,
      quickActions: [
        { key: 'a', label: 'Short', icon: 'search' },
        // One unbreakable word, which no line count can help — the "Memories" failure, exaggerated.
        { key: 'b', label: 'Unsplittableextraordinarilylonglabel', icon: 'search' },
      ],
    };
    expect(quickActionColumns(inputFor(invented, 411, 1))).toBe(1);
    // The same row with two ordinary labels keeps both columns, so the rule is not simply pessimistic.
    expect(quickActionColumns(inputFor(invented, 411, 1, { labels: ['Short', 'Brief'] }))).toBe(2);
  });
});

describe('every registered label renders complete', () => {
  it.each(CELLS)('at $width dp, font scale $fontScale', ({ width, fontScale }) => {
    /*
      The requirement itself. Whatever column count the rule picks, every label in that row must
      render inside the resulting box without splitting a word and within the line clamp. Asserted
      per module so a failure names the module rather than a boolean.
    */
    for (const module of allModuleDefinitions) {
      const box = chosenBox(module, width, fontScale);
      const rendered = renderedSize(width, fontScale);
      const failing = module.quickActions
        .filter((action) => !quickActionLabelFits(action.label, box, rendered, LABEL_LINES))
        .map((action) => action.label);
      expect({ module: module.id, failing }).toEqual({ module: module.id, failing: [] });
    }
  });

  it('never splits a word, in any cell', () => {
    /*
      Stated separately from the line clamp because it is the failure the device showed. A word wider
      than its box has nowhere to break, so the rule must never hand a row a box narrower than its
      widest word.
    */
    for (const { width, fontScale } of CELLS) {
      const rendered = renderedSize(width, fontScale);
      for (const module of allModuleDefinitions) {
        const box = chosenBox(module, width, fontScale);
        for (const action of module.quickActions) {
          const widestWord = Math.max(
            ...action.label.split(/\s+/).map((word) => quickActionMinimumBox(word, rendered, 1)),
          );
          expect({
            label: action.label,
            width,
            fontScale,
            unsplit: widestWord <= box,
          }).toEqual({ label: action.label, width, fontScale, unsplit: true });
        }
      }
    }
  });

  it('keeps the two labels the issue reported whole', () => {
    // Named, so a change that regressed exactly the reported strings could not pass quietly.
    const family = allModuleDefinitions.find((module) => module.id === 'family');
    expect(family?.quickActions.map((action) => action.label)).toEqual([
      'Add event',
      'Memories',
      'Ask Family AI',
    ]);
    for (const label of ['Memories', 'Ask Family AI']) {
      for (const { width, fontScale } of CELLS) {
        const box = chosenBox(family!, width, fontScale);
        expect({
          label,
          width,
          fontScale,
          whole: quickActionLabelFits(label, box, renderedSize(width, fontScale), LABEL_LINES),
        }).toEqual({ label, width, fontScale, whole: true });
      }
    }
  });
});

describe('the ordinary layout survives wherever it fits', () => {
  it('keeps every row at its full column count at the default text size', () => {
    /*
      The approved design, unchanged. At OS scale 1.0 no registered label needs more room than a
      third of the content column gives it, at any tested width — so nothing about the row moves for
      the overwhelming majority of users.
    */
    for (const width of WIDTHS) {
      for (const module of allModuleDefinitions) {
        expect({
          module: module.id,
          width,
          columns: quickActionColumns(inputFor(module, width, 1)),
        }).toEqual({ module: module.id, width, columns: module.quickActions.length });
      }
    }
  });

  it('reduces columns only where a label would otherwise clip', () => {
    /*
      The converse, and the one that stops the rule being over-eager: a row may lose a column only
      when its own labels could not have rendered at the count above. Checked against the raw fit,
      without the headroom, so the assertion is "there was a real problem here" rather than "the
      rule said so".
    */
    for (const { width, fontScale } of CELLS) {
      const rendered = renderedSize(width, fontScale);
      for (const module of allModuleDefinitions) {
        const columns = quickActionColumns(inputFor(module, width, fontScale));
        if (columns === module.quickActions.length) continue;
        /*
          A reduction is justified when the count above either could not render the copy at all, or
          could only render it inside the margin — which is the rounding crowd the threshold exists to
          stay out of. Both count; what must not happen is a reduction with real room to spare.
        */
        const boxAbove = quickActionTextBox(geometry(width), columns + 1);
        const required = Math.max(
          ...module.quickActions.map((action) =>
            quickActionMinimumBox(action.label, rendered, LABEL_LINES),
          ),
        );
        expect({
          module: module.id,
          width,
          fontScale,
          justified: boxAbove - quickActionRoundingAllowanceDp < required,
        }).toEqual({ module: module.id, width, fontScale, justified: true });
      }
    }
  });

  it('names the whole decision surface', () => {
    /*
      Every cell in one assertion, so any change to the threshold, the chrome, the token or an
      approved label has to be seen and re-approved rather than merely re-passing. Faith and Goals
      keep three columns everywhere because their labels are short; Health registers one action, so
      one column is its natural row.
    */
    const surface = CELLS.map(({ width, fontScale }) => ({
      cell: `${width}dp x${fontScale}`,
      columns: Object.fromEntries(
        allModuleDefinitions.map((module) => [
          module.id,
          quickActionColumns(inputFor(module, width, fontScale)),
        ]),
      ),
    }));

    const ORDINARY = {
      'noor-ai': 3,
      faith: 3,
      health: 1,
      planner: 3,
      finance: 3,
      learning: 3,
      family: 3,
      goals: 3,
    };
    const CONSTRAINED = {
      'noor-ai': 2,
      faith: 3,
      health: 1,
      planner: 2,
      finance: 2,
      learning: 2,
      family: 2,
      goals: 3,
    };
    /*
      One cell differs from its siblings: at the narrowest width and the largest text size, Faith's
      three short labels no longer clear a third of the column either. Faith draws its own home and
      never renders this row, so nothing in production changes — but the surface records it rather
      than hiding it behind a shared constant.
    */
    const NARROWEST = { ...CONSTRAINED, faith: 2 };
    expect(surface).toEqual([
      { cell: '320dp x1', columns: ORDINARY },
      { cell: '320dp x1.3', columns: CONSTRAINED },
      { cell: '320dp x1.5', columns: NARROWEST },
      { cell: '384dp x1', columns: ORDINARY },
      { cell: '384dp x1.3', columns: CONSTRAINED },
      { cell: '384dp x1.5', columns: CONSTRAINED },
      { cell: '411dp x1', columns: ORDINARY },
      { cell: '411dp x1.3', columns: CONSTRAINED },
      { cell: '411dp x1.5', columns: CONSTRAINED },
    ]);
  });
});

describe('the boundary is derived and off the rounding edge', () => {
  /** Every (module, cell, candidate column count) and how much true slack that count would leave. */
  function slacks(): { slack: number; tag: string; kept: boolean }[] {
    const all: { slack: number; tag: string; kept: boolean }[] = [];
    for (const { width, fontScale } of CELLS) {
      const rendered = renderedSize(width, fontScale);
      for (const module of allModuleDefinitions) {
        const required = Math.max(
          ...module.quickActions.map((action) =>
            quickActionMinimumBox(action.label, rendered, LABEL_LINES),
          ),
        );
        const chosen = quickActionColumns(inputFor(module, width, fontScale));
        for (let columns = 1; columns <= module.quickActions.length; columns += 1) {
          all.push({
            slack: quickActionTextBox(geometry(width), columns) - required,
            tag: `${module.id} ${width}x${fontScale} n=${columns}`,
            kept: columns === chosen,
          });
        }
      }
    }
    return all;
  }

  it('leaves every chosen column count real slack, not a rounding coin-toss', () => {
    /*
      The property the allowance exists for. Every count the rule actually picks must have room to
      spare over what its labels need — and by a margin that dwarfs what layout rounding can move.
      Rounding is at most 0.31 dp on the densest screen tested; the worst slack here is over five
      times that.
    */
    const kept = slacks().filter((entry) => entry.kept);
    const worst = kept.reduce((low, entry) => (entry.slack < low.slack ? entry : low));
    expect(worst.slack).toBeGreaterThan(1.5);
    // And nothing chosen is ever actually short.
    expect(kept.every((entry) => entry.slack > 0)).toBe(true);
  });

  it('is the smallest allowance that reaches its plateau', () => {
    /*
      Derived rather than chosen. Raising the allowance past 1 dp changes no decision and buys no
      further slack, so anything larger would be reserving space for nothing; lowering it to 0.5 dp
      drops the worst slack back to 0.73 dp, which is inside the range a different device's rounding
      could plausibly move. This asserts both ends of that, so a future edit to the constant has to
      confront the measurement.
    */
    const worstAt = (allowance: number): number => {
      let worst = Infinity;
      for (const { width, fontScale } of CELLS) {
        const rendered = renderedSize(width, fontScale);
        for (const module of allModuleDefinitions) {
          const required = Math.max(
            ...module.quickActions.map((action) =>
              quickActionMinimumBox(action.label, rendered, LABEL_LINES),
            ),
          );
          let chosen = 1;
          for (let columns = module.quickActions.length; columns > 1; columns -= 1) {
            if (quickActionTextBox(geometry(width), columns) - allowance >= required) {
              chosen = columns;
              break;
            }
          }
          worst = Math.min(worst, quickActionTextBox(geometry(width), chosen) - required);
        }
      }
      return worst;
    };

    expect(quickActionRoundingAllowanceDp).toBe(1);
    expect(worstAt(0.5)).toBeLessThan(1);
    expect(worstAt(1)).toBeGreaterThan(1.5);
    // The plateau: more allowance, no more slack.
    expect(worstAt(2)).toBeLessThanOrEqual(worstAt(1) + 0.6);
  });

  it('covers several times the worst layout rounding', () => {
    /*
      The densest configuration tested is 320 dp at 540 dpi, where one physical pixel is 0.30 dp, so
      rounding a laid-out width can move it by at most half of that. The allowance is an order above.
    */
    const worstRoundingDp = 0.5 / (540 / 160);
    expect(worstRoundingDp).toBeLessThan(0.2);
    expect(quickActionRoundingAllowanceDp).toBeGreaterThan(worstRoundingDp * 3);
  });

  it('decides nothing differently inside the rounding it guards against', () => {
    /*
      Stated at the rounding bound rather than at the allowance's own width, because those are
      different quantities and only the first is a claim the measurements support. Half a physical
      pixel is under 0.2 dp on the densest screen tested, so ±0.3 dp of row width is already generous —
      and nothing moves inside it.

      At a full ±1 dp one cell does move: Faith at 320 dp and text size 1.5 sits 0.06 dp from the
      decision, so a dp either way flips it between two and three columns. Both are readable — the
      three-column form clears its labels by 0.73 dp — and Faith never renders this row in production.
      Recorded rather than smoothed over by widening the tolerance until it passed.
    */
    for (const shift of [-0.3, 0, 0.3]) {
      for (const { width, fontScale } of CELLS) {
        for (const module of allModuleDefinitions) {
          const geo = geometry(width);
          expect(
            quickActionColumns(
              inputFor(module, width, fontScale, { contentWidth: geo.contentWidth + shift }),
            ),
          ).toBe(quickActionColumns(inputFor(module, width, fontScale)));
        }
      }
    }
  });

  it('never hands a row a box it cannot fill, however far the model is out', () => {
    /*
      The safety property, well beyond the allowance. A narrower-than-modelled row can only reduce
      columns, which is safe; a wider one is bounded. In both directions the chosen count must still
      hold the copy.
    */
    for (const shift of [-8, -4, 1, 2]) {
      for (const { width, fontScale } of CELLS) {
        const geo = geometry(width);
        const perturbed = { ...geo, contentWidth: geo.contentWidth + shift };
        for (const module of allModuleDefinitions) {
          const columns = quickActionColumns(
            inputFor(module, width, fontScale, { contentWidth: perturbed.contentWidth }),
          );
          const box = quickActionTextBox(perturbed, columns);
          const failing = module.quickActions
            .filter(
              (action) =>
                !quickActionLabelFits(
                  action.label,
                  box,
                  renderedSize(width, fontScale),
                  LABEL_LINES,
                ),
            )
            .map((action) => action.label);
          expect({ module: module.id, shift, failing }).toEqual({
            module: module.id,
            shift,
            failing: [],
          });
        }
      }
    }
  });
});

describe('the tile and the rule read one geometry', () => {
  const tile = code(TILE);

  it('takes its chrome from the constants the style uses', () => {
    /*
      Omitting the icon well, the inner gap or either padding understates the label's box by up to
      40 dp — three quarters of it at the narrowest width — so the style and the rule must read one
      source. They do, by name.
    */
    expect(tile).toContain('paddingHorizontal: dp(TILE_PADDING_H)');
    expect(tile).toContain('paddingVertical: dp(TILE_PADDING_H)');
    expect(tile).toContain('columnGap: dp(TILE_INNER_GAP)');
    expect(tile).toContain('width: dp(TILE_ICON_WELL)');
    expect(tile).toContain(
      'TILE_BORDER * 2 + dp(TILE_PADDING_H) * 2 + dp(TILE_ICON_WELL) + dp(TILE_INNER_GAP)',
    );
    expect(tile).toContain('borderWidth: TILE_BORDER,');
    expect(tile).toContain('tileChromeWidth: tileChromeWidth(dp)');
    expect([PADDING_H, ICON_WELL, INNER_GAP, LABEL_LINES, BORDER]).toEqual([8, 26, 6, 2, 1]);
  });

  it('measures the label in the face and token that renders it', () => {
    // A label measured in the wrong face or token is a plausible number and a wrong column count.
    expect(code(TEXT)).toMatch(/quickAction: 'medium'/);
    expect(moduleType.quickAction[0]).toBe(11);
    expect(code(RULE)).toContain("textWidthEm(word, 'medium')");
    expect(tile).toContain("fontSize: type('quickAction').fontSize");
  });

  it('reuses #50’s font metrics instead of a second copy', () => {
    // One advance table in the codebase, drift-checked in one place.
    expect(code(RULE)).toContain("import { textWidthEm } from './hero-copy-fit';");
    expect(code(RULE)).not.toContain('ADVANCE_PER_MILLE');
  });

  it('lets the label wrap and the tile grow rather than clipping', () => {
    expect(tile).toContain('minHeight: dp(moduleLayout.quickActionHeight)');
    expect(tile).not.toMatch(/\bheight: dp\(moduleLayout\.quickActionHeight\)/);
    expect(tile).toMatch(/numberOfLines=\{LABEL_LINES\}/);
    // The row itself wraps onto another line rather than squeezing tiles sideways.
    expect(tile).toContain("flexWrap: 'wrap'");
    expect(tile).toContain('rowGap: columnGap');
  });

  it('does not shrink, hyphenate or split anything', () => {
    expect(tile).not.toContain('adjustsFontSizeToFit');
    expect(tile).not.toContain('minimumFontScale');
    expect(tile).not.toContain('hyphenationFrequency');
    expect(tile).not.toMatch(/\.slice\(|\.substring\(|…/);
  });

  it('sizes tiles explicitly so a wrapped row keeps equal widths', () => {
    /*
      `flex: 1` cannot make the last line of a wrapping grid match the lines above it, so the tile
      width is computed from the same column count the rule returned. Equal widths are the approved
      property: a lone tile on a second line stays one column wide instead of stretching.
    */
    expect(tile).toContain(
      'const tileWidth = (contentWidth - columnGap * (columns - 1)) / columns;',
    );
    expect(tile).toContain('style={{ width: tileWidth }}');
    expect(tile).not.toContain('rowItem');
  });

  it('keeps every tile at a 44 dp effective target', () => {
    /*
      No `hitSlop` is needed here, unlike the hero's pill: the tile's own box already clears the
      minimum at every column count this rule can choose. Asserted rather than assumed, because a
      narrower tile is exactly what this change introduces.
    */
    for (const width of WIDTHS) {
      const geo = geometry(width);
      const height = scaledDp(width)(moduleLayout.quickActionHeight);
      for (const module of allModuleDefinitions) {
        for (const fontScale of FONT_SCALES) {
          const columns = quickActionColumns(inputFor(module, width, fontScale));
          const tileWidth = (geo.contentWidth - geo.columnGap * (columns - 1)) / columns;
          expect({
            module: module.id,
            width,
            fontScale,
            target: Math.min(tileWidth, height) >= 44,
          }).toEqual({ module: module.id, width, fontScale, target: true });
        }
      }
    }
  });
});

describe('only the generic module home renders this row', () => {
  it('is reached from the home screen and the development gallery, and nowhere else', () => {
    const callSites: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        // Tests render it too; this counts production call sites.
        if (
          entry.name.endsWith('.tsx') &&
          !entry.name.includes('.test.') &&
          code(full).includes('<ModuleQuickActionRow')
        ) {
          callSites.push(entry.name);
        }
      }
    };
    walk(join(MODULES_ROOT, '..'));
    expect(callSites.sort()).toEqual(['module-gallery-screen.tsx', 'module-home-screen.tsx']);
    // The composed modules take the other branch of the home screen, so they never reach it.
    expect(code(HOME)).toContain('hasApprovedComposition');
    expect([...COMPOSED_MODULE_IDS].sort()).toEqual(['faith', 'health', 'noor-ai', 'planner']);
  });
});

describe('the #50 hero rule is untouched', () => {
  it('keeps its own predicates and thresholds', () => {
    /*
      This change imports #50's advance tables and nothing else. Asserted here as well as in
      `hero-copy-fit.test.ts` so a quick-action edit that reached into the hero would fail from both
      sides.
    */
    const hero = code(join(MODULES_ROOT, 'hero-copy-fit.ts'));
    expect(hero).toContain('export const heroCopyColumnHeadroom = 1.02;');
    expect(hero).toContain('export const heroActionColumnHeadroom = 1.1;');
    expect(hero).not.toContain('quickAction');
    expect(moduleLayout.heroCopyColumnRatio).toBe(0.545);
    expect(moduleLayout.heroTextColumnRatio).toBe(0.52);

    const card = code(join(MODULES_ROOT, 'components', 'module-hero-card.tsx'));
    expect(card).toContain('source={fullWidthCopy ? undefined : module.heroArtwork}');
    expect(card).not.toContain('quickActionColumns');
  });

  it('does not import the quick-action rule anywhere but its own row', () => {
    const importers: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.tsx?$/.test(entry.name) || entry.name.includes('.test.')) continue;
        if (code(full).includes('quickActionColumns')) importers.push(entry.name);
      }
    };
    walk(join(MODULES_ROOT, '..'));
    expect(importers.sort()).toEqual(['module-quick-action.tsx', 'quick-action-fit.ts']);
  });
});
