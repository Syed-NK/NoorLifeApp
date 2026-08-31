import { render, screen } from '@testing-library/react-native';

import { pinModuleWindow } from '@/test-support/module-window';

import { ModuleBottomNavigation } from '../components/module-bottom-navigation';
import { textWidthEm } from '../hero-copy-fit';
import { ModuleProvider } from '../module-context';
import { moduleRegistry } from '../module-registry';
import { FRAMEWORK_MODULE_IDS, moduleLayout, moduleScale, moduleType } from '../module-tokens';

/**
 * **A navigation label is read in full, or it is not a destination name** — issue #133.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── What was wrong ─────────────────────────────────────────────────────────
 * Each of the five slots is a fifth of the bar, and each held back `paddingHorizontal: 2`. That
 * cost the label 4 dp, and exactly one label in the whole app needed them: Finance's
 * "Transactions", over by 0.47 dp at 320 dp, 0.21 dp at 384 dp, and level at 393 dp. A Samsung at
 * 384 dp drew "Transactio…"; an emulator at 411 dp, the first width with room to spare, never
 * reproduced it. The label is a single word, so `numberOfLines={2}` could not have saved it and
 * only horizontal space could.
 *
 * ── Why this measures rather than asserts a constant ───────────────────────
 * Jest has no layout engine, so the rendered box cannot be read. What can be read is the size the
 * renderer was handed — the label's own `fontSize` and `maxFontSizeMultiplier` — and those, run
 * through the same `textWidthEm` advance tables production trusts for the hero and summary rules,
 * give the width the device will draw to within a bounded error.
 *
 * The available width is measured too, not assumed: `slotInset` walks the label's ancestors and
 * sums every horizontal padding and margin between it and the bar. Re-introducing an inset
 * anywhere in that chain shrinks the budget these tests check against, so the defect cannot come
 * back by a different route than it arrived.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** 320 and 360 are narrow handsets, 384 the Samsung, 393 the reference, 411 the emulator. */
const WIDTHS = [320, 360, 384, 393, 411] as const;
const SCALES = [1, 1.5] as const;

type Node = {
  readonly props: Record<string, unknown>;
  readonly parent?: Node | null;
};

function merge(style: unknown): Record<string, number | undefined> {
  const parts = Array.isArray(style) ? style.flat(4) : [style];
  return Object.assign({}, ...parts.filter(Boolean)) as Record<string, number | undefined>;
}

/**
 * Every horizontal padding and margin between the label and the bar, summed.
 *
 * Bounded so a missing ancestor ends the walk rather than climbing to the root. The row, the bar
 * and the carrier declare no horizontal inset, so summing the whole chain is safe and errs toward
 * a smaller budget rather than a larger one.
 */
function slotInset(node: Node): number {
  const sides = [
    'paddingHorizontal',
    'paddingLeft',
    'paddingRight',
    'marginHorizontal',
    'marginLeft',
    'marginRight',
  ] as const;
  let total = 0;
  let current: Node | null | undefined = node;
  for (let depth = 0; depth < 8 && current; depth += 1) {
    const style = merge(current.props.style);
    for (const side of sides) {
      const value = style[side];
      if (typeof value === 'number') {
        total += side.endsWith('Horizontal') ? value * 2 : value;
      }
    }
    current = current.parent;
  }
  return total;
}

/** The labels a module actually paints: the four side tabs, plus the centre caption if it opts in. */
function visibleLabels(moduleId: (typeof FRAMEWORK_MODULE_IDS)[number]): readonly string[] {
  const module = moduleRegistry[moduleId];
  return module.navigation
    .filter((item) => item.isAI !== true || module.showAICaption)
    .map((item) => item.label);
}

async function renderNav(moduleId: (typeof FRAMEWORK_MODULE_IDS)[number]) {
  await render(
    <ModuleProvider moduleId={moduleId}>
      <ModuleBottomNavigation activeKey={moduleRegistry[moduleId].navigation[0].key} testID="nav" />
    </ModuleProvider>,
  );
}

describe.each(WIDTHS)('at %i dp wide', (width) => {
  describe.each(SCALES)('at font scale %s', (fontScale) => {
    beforeEach(() => {
      pinModuleWindow({ width, fontScale });
    });

    it.each(FRAMEWORK_MODULE_IDS)('draws every %s label in full', async (moduleId) => {
      await renderNav(moduleId);

      const slot = width / 5;

      for (const label of visibleLabels(moduleId)) {
        const node = screen.getByText(label) as unknown as Node;
        const style = merge(node.props.style);
        const fontSize = style.fontSize;
        const cap = node.props.maxFontSizeMultiplier as number | undefined;

        expect(fontSize).toBeGreaterThan(0);
        expect(cap).toBeGreaterThan(0);

        const drawn =
          textWidthEm(label, 'medium') * (fontSize ?? 0) * Math.min(fontScale, cap ?? 1);
        const budget = slot - slotInset(node);

        /*
          The whole contract in one line. A label wider than its budget is the ellipsis: the label
          is `numberOfLines={1}`, so there is no second line for it to fall to.
        */
        expect(drawn).toBeLessThanOrEqual(budget);
      }
    });

    it.each(FRAMEWORK_MODULE_IDS)('holds nothing back from the %s slot', async (moduleId) => {
      await renderNav(moduleId);

      for (const label of visibleLabels(moduleId)) {
        const node = screen.getByText(label) as unknown as Node;
        // The fifth is the budget. Anything subtracted from it is what caused #133.
        expect(slotInset(node)).toBe(0);
      }
    });

    it('keeps two neighbouring labels visibly apart', async () => {
      // Finance carries the widest label, so it is the closest pair anywhere in the app.
      await renderNav('finance');

      const slot = width / 5;
      const drawn = (label: string) => {
        const node = screen.getByText(label) as unknown as Node;
        const style = merge(node.props.style);
        const cap = node.props.maxFontSizeMultiplier as number | undefined;
        return textWidthEm(label, 'medium') * (style.fontSize ?? 0) * Math.min(fontScale, cap ?? 1);
      };

      // Each label is centred in its own fifth, so the gap is the two half-remainders.
      const gap = (slot - drawn('Overview')) / 2 + (slot - drawn('Transactions')) / 2;
      expect(gap).toBeGreaterThanOrEqual(8);
    });
  });
});

describe('the label role and its scaling are untouched', () => {
  beforeEach(() => {
    pinModuleWindow({ width: 384, fontScale: 1.5 });
  });

  it('leaves the shared role at the size it had before the fix', () => {
    /*
      Pinned deliberately, and the only literal in this file.

      Every other assertion here derives its expectation from `moduleType.navLabel`, so shrinking
      the role would move the expectation with it and the whole suite would still pass while the
      label got quietly smaller on every screen in the app. Buying width with smaller type is one
      of the fixes #133 rules out, so the role itself is the thing to hold still.
    */
    expect(moduleType.navLabel).toEqual([9.5, 13]);
  });

  it('still renders the shared navLabel size, not a smaller one', async () => {
    await renderNav('finance');

    const expected = +(moduleType.navLabel[0] * moduleScale(384)).toFixed(1);
    for (const label of visibleLabels('finance')) {
      const style = merge((screen.getByText(label) as unknown as Node).props.style);
      expect(style.fontSize).toBe(expected);
    }
  });

  it('still lets the OS enlarge the label, and to the same ceiling', async () => {
    await renderNav('finance');

    for (const label of visibleLabels('finance')) {
      const node = screen.getByText(label) as unknown as Node;
      // Scaling is retained, not disabled, and not quietly lowered to buy width.
      expect(node.props.maxFontSizeMultiplier).toBe(1.2);
      expect(node.props.numberOfLines).toBe(1);
    }
  });

  it.each(FRAMEWORK_MODULE_IDS)(
    'routes %s through the same label path, with no per-module branch',
    async (moduleId) => {
      await renderNav(moduleId);

      for (const label of visibleLabels(moduleId)) {
        const node = screen.getByText(label) as unknown as Node;
        expect(node.props.maxFontSizeMultiplier).toBe(1.2);
        expect(node.props.numberOfLines).toBe(1);
        expect(slotInset(node)).toBe(0);
      }
    },
  );
});

describe('nothing else about the bar moved', () => {
  beforeEach(() => {
    pinModuleWindow({ width: 384, fontScale: 1.5 });
  });

  it.each(FRAMEWORK_MODULE_IDS)('keeps every %s destination, in order', async (moduleId) => {
    await renderNav(moduleId);
    const module = moduleRegistry[moduleId];

    expect(module.navigation).toHaveLength(5);
    for (const item of module.navigation) {
      // The raised centre control is addressed by its role, not by its key.
      const testID = item.isAI === true ? 'nav-ai' : `nav-${item.key}`;
      expect(screen.getByTestId(testID)).toBeTruthy();
    }
  });

  it('keeps the selected state on the active tab only', async () => {
    await renderNav('finance');
    const [first, second] = moduleRegistry.finance.navigation;

    expect(screen.getByTestId(`nav-${first.key}`).props.accessibilityState?.selected).toBe(true);
    expect(screen.getByTestId(`nav-${second.key}`).props.accessibilityState?.selected).toBe(false);
  });

  it('leaves the pressable filling its slot above the touch minimum', async () => {
    await renderNav('finance');

    for (const item of moduleRegistry.finance.navigation) {
      if (item.isAI === true) continue;
      const node = screen.getByTestId(`nav-${item.key}`) as unknown as Node;
      const style = merge(node.props.style);
      expect(style.flex).toBe(1);
      expect(style.minHeight).toBeGreaterThanOrEqual(moduleLayout.minTouchTarget);
    }
  });
});
