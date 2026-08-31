import { render, screen } from '@testing-library/react-native';

import { pinModuleWindow } from '@/test-support/module-window';

import { ModuleFeatureGrid } from '../components/module-feature-grid';
import { textWidthEm } from '../hero-copy-fit';
import { COMPOSED_MODULE_IDS } from '../module-compositions';
import { ModuleProvider } from '../module-context';
import { moduleRegistry } from '../module-registry';
import { FRAMEWORK_MODULE_IDS, moduleLayout, moduleType } from '../module-tokens';

/**
 * **A capability label is read in full, or the tile is naming nothing** — issue #136.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── What was wrong ─────────────────────────────────────────────────────────
 * The tile label was `numberOfLines={1}` in a four-column, fixed 74 dp tile. Exactly one label in
 * the registry needed more than that line: Finance's `Bank sync`, the longest capability copy in
 * the app. At OS text size 1.5 it wants 71.44 dp of a 71.25 dp box at 384 dp, and at 411 dp the
 * 0.06 dp it nominally has left is inside the rounding React Native applies when it resolves the
 * fractional tile width to whole physical pixels. A Samsung at 384 dp drew `Bank sy…`; an emulator
 * at 411 dp drew `Bank syn…`. At text size 1.0 both drew it in full, which is why a sweep that only
 * ran the default size saw nothing.
 *
 * Unlike #133's `Transactions`, `Bank sync` is two words, so a second line is a fix available here
 * and horizontal space is not the only lever.
 *
 * ── Why this measures rather than asserts a constant ───────────────────────
 * Jest has no layout engine, so the drawn box cannot be read. What can be read is what the renderer
 * was handed — the tile's own resolved `width`, the label's `fontSize` and its
 * `maxFontSizeMultiplier` — and those, through the same `textWidthEm` advance tables production
 * trusts for the hero, nav and summary rules, give the width the device draws to within a bounded
 * error.
 *
 * The budget is measured too: `tileInset` walks from the label up to the tile and sums every
 * horizontal padding, margin and border between them. Re-introducing chrome anywhere in that chain
 * shrinks the budget these tests check against, so the defect cannot return by a different route
 * than it arrived by.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** 320 and 360 are narrow handsets, 384 the Samsung, 393 the reference, 411 the emulator. */
const WIDTHS = [320, 360, 384, 393, 411] as const;
const SCALES = [1, 1.5] as const;

/**
 * The modules that actually paint this grid.
 *
 * Finance and Health render it from their own compositions; Learning, Family and Goals reach it
 * through the generic home branch. Noor AI, Faith and Planner are composed to bespoke homes that
 * render no capability grid — Noor AI's home was read on device to confirm it, and its four
 * registered labels are the longest in the registry precisely because nothing measures them. A
 * label that is never drawn is not a layout defect, and asserting it would fail this suite for copy
 * no user can see. `every module on the generic branch is covered` below is what stops that
 * exclusion from going stale.
 */
const GRID_MODULE_IDS = ['finance', 'health', 'learning', 'family', 'goals'] as const;

/**
 * Slack a label must keep on the line it draws, in dp.
 *
 * The same quantity and reason as `quickActionRoundingAllowanceDp`: React Native resolves the tile's
 * fractional width to whole physical pixels, so the box the device lays text into is up to a pixel
 * narrower than the arithmetic says. Both of the labels that truncated on a device did so with
 * nominal slack inside this margin — `Bank sync` by 0.06 dp at 411 dp, `Memories` by 0.04 dp at
 * 320 dp — so slack that thin is indistinguishable from none, and a model without this allowance
 * calls both of them "fits" while the screen shows an ellipsis.
 */
const ROUNDING_ALLOWANCE_DP = 1;

/*
  There is no longer a cell this suite measures, agrees is broken, and skips — issue #138.

  `Memories` was that cell: a single word with 0.04 dp of nominal slack at 320 dp and text size 1.5,
  which a 320 dp emulator drew as `Memorie…`. #136 could not reach it, because a word wider than its
  line has nowhere to break and a second line would only have split it mid-word. #138 gave the tile
  back 2 dp of horizontal padding a side, which turns that 0.04 dp into 4.04 dp, so the label is now
  asserted by the loop below like every other one and the exclusion machinery is gone with it.
*/

type Node = {
  readonly props: Record<string, unknown>;
  readonly parent?: Node | null;
};

function merge(style: unknown): Record<string, number | undefined> {
  const parts = Array.isArray(style) ? style.flat(4) : [style];
  return Object.assign({}, ...parts.filter(Boolean)) as Record<string, number | undefined>;
}

/**
 * Every horizontal padding, margin and border between the label and the tile, summed.
 *
 * Borders count: React Native draws them inside the box, so a border eats content width exactly as
 * a padding does. The walk stops at the node carrying an explicit `width`, which is the tile.
 */
function tileInset(label: Node): { readonly inset: number; readonly tileWidth: number } {
  const sides = [
    'paddingHorizontal',
    'paddingLeft',
    'paddingRight',
    'marginHorizontal',
    'marginLeft',
    'marginRight',
    'borderWidth',
    'borderLeftWidth',
    'borderRightWidth',
  ] as const;
  let inset = 0;
  let current: Node | null | undefined = label;
  for (let depth = 0; depth < 8 && current; depth += 1) {
    const style = merge(current.props.style);
    for (const side of sides) {
      const value = style[side];
      if (typeof value === 'number') {
        inset += side.endsWith('Horizontal') || side === 'borderWidth' ? value * 2 : value;
      }
    }
    if (typeof style.width === 'number') {
      return { inset, tileWidth: style.width };
    }
    current = current.parent;
  }
  throw new Error('no tile with an explicit width found above the label');
}

/**
 * Lines a label needs under greedy word wrapping, or `null` when a single word is wider than the box.
 *
 * `null` is the unbreakable case and is reported separately: a word wider than its line has nowhere
 * to break, so Android splits it between letters rather than wrapping it, and no line count helps.
 */
function linesNeeded(label: string, box: number, fontSize: number): number | null {
  const words = label.split(/\s+/).filter((word) => word !== '');
  if (words.length === 0) {
    return 1;
  }
  const width = (text: string) => textWidthEm(text, 'medium') * fontSize;
  if (words.some((word) => width(word) > box)) {
    return null;
  }
  const space = width(' ');
  let lines = 1;
  let used = width(words[0] ?? '');
  for (const word of words.slice(1)) {
    const extra = space + width(word);
    if (used + extra <= box) {
      used += extra;
    } else {
      lines += 1;
      used = width(word);
    }
  }
  return lines;
}

/**
 * The widest line the renderer actually draws, given the clamp it was handed.
 *
 * A one-line clamp has no wrap to fall to, so the drawn line is the whole string however wide that
 * is — which is exactly why the slack check below distinguishes a clamp of 1 from a clamp of 2.
 */
function longestDrawnLine(label: string, box: number, fontSize: number, clamp: number): number {
  const width = (text: string) => textWidthEm(text, 'medium') * fontSize;
  if (clamp <= 1) {
    return width(label);
  }
  const words = label.split(/\s+/).filter((word) => word !== '');
  const space = width(' ');
  let longest = 0;
  let used = width(words[0] ?? '');
  for (const word of words.slice(1)) {
    const extra = space + width(word);
    if (used + extra <= box) {
      used += extra;
    } else {
      longest = Math.max(longest, used);
      used = width(word);
    }
  }
  return Math.max(longest, used);
}

function capabilityLabels(moduleId: (typeof GRID_MODULE_IDS)[number]): readonly string[] {
  return moduleRegistry[moduleId].capabilities.map((item) => item.label);
}

async function renderGrid(moduleId: (typeof GRID_MODULE_IDS)[number]) {
  await render(
    <ModuleProvider moduleId={moduleId}>
      <ModuleFeatureGrid />
    </ModuleProvider>,
  );
}

describe.each(WIDTHS)('at %i dp wide', (width) => {
  describe.each(SCALES)('at font scale %s', (fontScale) => {
    beforeEach(() => {
      pinModuleWindow({ width, fontScale });
    });

    it.each(GRID_MODULE_IDS)('draws every %s capability label in full', async (moduleId) => {
      await renderGrid(moduleId);

      for (const label of capabilityLabels(moduleId)) {
        const node = screen.getByText(label) as unknown as Node;
        const style = merge(node.props.style);
        const fontSize = style.fontSize ?? 0;
        const cap = node.props.maxFontSizeMultiplier as number | undefined;
        const clamp = node.props.numberOfLines as number | undefined;

        expect(fontSize).toBeGreaterThan(0);
        expect(cap).toBeGreaterThan(0);
        expect(clamp).toBeGreaterThan(0);

        const { inset, tileWidth } = tileInset(node);
        const box = tileWidth - inset - ROUNDING_ALLOWANCE_DP;
        const drawn = fontSize * Math.min(fontScale, cap ?? 1);
        const lines = linesNeeded(label, box, drawn);

        /*
          The whole contract. `null` means one word is wider than the box, which is the mid-word
          split; a line count over the clamp is the ellipsis. Either is a label the user cannot read.
        */
        expect(lines).not.toBeNull();
        expect(lines as number).toBeLessThanOrEqual(clamp as number);
      }
    });

    it('gives Finance Bank sync a second line to fall to', async () => {
      /*
        The reported label, named. Every other assertion here is derived, so a registry that renamed
        `Bank sync` to something short would keep the suite green while the fix was reverted; this
        pins the case the issue was filed for.
      */
      await renderGrid('finance');

      const node = screen.getByText('Bank sync') as unknown as Node;
      expect(node.props.numberOfLines).toBeGreaterThanOrEqual(2);

      /*
        And the line it falls back to has real margin, not another knife edge.

        The point of the second line is that the renderer's one-line decision stops mattering: at
        411 dp `Bank sync` is within 0.06 dp of the box either way, so whether it stays on one line
        or wraps is decided by rounding. What has to be true is that the wrapped line is comfortable,
        and `sync` clears the box by tens of dp. With the old clamp there was no such line, which is
        why rounding produced an ellipsis instead of a wrap.
      */
      const style = merge(node.props.style);
      const { inset, tileWidth } = tileInset(node);
      const box = tileWidth - inset;
      const drawn =
        (style.fontSize ?? 0) * Math.min(fontScale, node.props.maxFontSizeMultiplier as number);
      const fallback = longestDrawnLine('Bank sync', 0, drawn, 2);
      expect(box - fallback).toBeGreaterThanOrEqual(ROUNDING_ALLOWANCE_DP);

      /*
        And it is not the cap that paid for it.

        Every fit assertion above scales by `min(fontScale, cap)`, so dropping the cap would shrink
        the drawn width and turn this suite green while large-text users got smaller labels. #125
        settled that the cap is the approved typographic limit, so it is pinned rather than derived.
      */
      expect(node.props.maxFontSizeMultiplier).toBe(1.3);
    });

    it('gives Family Memories the horizontal room it was short of', async () => {
      /*
        #138's reported label, named for the same reason `Bank sync` is: every other assertion here
        derives its label from the registry, so a rename would keep this suite green while the fix
        was reverted.

        It is the opposite case to `Bank sync`. `Memories` is one word, so the second line #136 added
        can never reach it — a word wider than its line is split between letters rather than wrapped,
        which is the worse failure #52 identified. What it needed was width, and #138 gave it back
        2 dp of tile padding a side.
      */
      await renderGrid('family');

      const node = screen.getByText('Memories') as unknown as Node;
      // One line, deliberately: #136 withholds the second line from copy that cannot break.
      expect(node.props.numberOfLines).toBe(1);

      const style = merge(node.props.style);
      const fontSize = style.fontSize ?? 0;
      const cap = node.props.maxFontSizeMultiplier as number | undefined;
      const { inset, tileWidth } = tileInset(node);
      const drawn = textWidthEm('Memories', 'medium') * fontSize * Math.min(fontScale, cap ?? 1);

      /*
        Slack past the rounding allowance, not merely a positive number. Before #138 this cell had
        0.04 dp of it at 320 dp and text size 1.5 and the device still drew `Memorie…`, so "fits" by
        arithmetic alone is precisely the answer that was wrong.
      */
      expect(tileWidth - inset - drawn).toBeGreaterThanOrEqual(ROUNDING_ALLOWANCE_DP);
    });

    it.each(GRID_MODULE_IDS)('leaves every single-word %s label on one line', async (moduleId) => {
      /*
        The containment half of #136, and the reason #138 is still #138.

        A word wider than its line is split between letters rather than wrapped, so a second line
        would turn `Memorie…` into `Memorie` / `s`. Measured on a 320 dp emulator at text size 1.5
        when the clamp was two for everything. Every single-word label therefore renders exactly as
        it did before this change, and a clamp handed out by default rather than by need fails here.
      */
      await renderGrid(moduleId);

      for (const label of capabilityLabels(moduleId)) {
        if (/\s/.test(label)) {
          continue;
        }
        const node = screen.getByText(label) as unknown as Node;
        expect(node.props.numberOfLines).toBe(1);
      }
    });
  });
});

describe('the tile keeps its rhythm without clipping the second line', () => {
  beforeEach(() => {
    pinModuleWindow({ width: 384, fontScale: 1.5 });
  });

  it('gives the tile a floor rather than a fixed height', async () => {
    await renderGrid('finance');

    const style = merge(
      (screen.getByTestId('finance-features-bank-sync') as unknown as Node).props.style,
    );

    /*
      A hard `height` is what would clip the second line the fix depends on, turning a horizontal
      ellipsis into a vertical one. 74 dp stays as the floor, so a one-line tile is unchanged.
    */
    expect(style.height).toBeUndefined();
    expect(style.minHeight).toBeGreaterThan(0);
  });

  it('holds no more chrome back from the label than #138 left it', async () => {
    await renderGrid('family');

    const { inset } = tileInset(screen.getByText('Memories') as unknown as Node);

    /*
      1 dp of border and 2 dp of padding a side — six in total.

      Pinned rather than derived, because every fit assertion in this file measures its budget as
      `tileWidth - inset`: restoring the old 4 dp padding would shrink the budget and the drawn width
      with it, and the suite would stay green while `Memories` went back to `Memorie…` on a 320 dp
      screen. This is the one assertion that names the chrome instead of reading it.
    */
    expect(inset).toBe(6);
  });

  it('leaves the shared label role at the size it had before the fix', () => {
    /*
      Pinned deliberately, and the only type literal in this file.

      Every other assertion derives its expectation from the rendered `fontSize`, so shrinking the
      role would move the expectation with it and the suite would stay green while the label got
      quietly smaller on every module. Buying width with smaller type is a fix #136 rules out, so the
      role itself is the thing to hold still.
    */
    expect(moduleType.tileLabel).toEqual([11, 15]);
  });

  it('keeps the four-column grain the tile width is derived from', () => {
    // #136 buys room with a line, not with columns. A narrower grid would be a different layout.
    expect(moduleLayout.featureColumns).toBe(4);
    expect(moduleLayout.featureTileHeight).toBe(74);
  });

  it('covers every module on the generic branch', () => {
    /*
      The exclusion above is only safe while the three modules left out are bespoke.

      A module with no approved composition falls through to `ModuleHomeScreen`'s generic branch,
      which renders this grid unconditionally — so it paints capability labels and has to be
      measured. Adding a module, or dropping one's composition, makes this fail rather than quietly
      leaving its labels unchecked.
    */
    for (const moduleId of FRAMEWORK_MODULE_IDS) {
      if (GRID_MODULE_IDS.includes(moduleId as (typeof GRID_MODULE_IDS)[number])) {
        continue;
      }
      expect(COMPOSED_MODULE_IDS).toContain(moduleId);
    }
  });
});
