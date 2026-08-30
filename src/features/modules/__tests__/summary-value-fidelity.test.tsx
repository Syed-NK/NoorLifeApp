import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { render, screen, waitFor } from '@testing-library/react-native';
import { StyleSheet, type ViewStyle } from 'react-native';

import { pinModuleWindow } from '@/test-support/module-window';
import { MAX_MINOR_UNITS } from '@features/finance/data/finance-money';
import { formatAmount } from '@features/finance/data/finance-format';

import { ModuleSummaryCard, type ModuleSummaryMetric } from '../components/module-summary-card';
import { ModuleProvider } from '../module-context';
import { moduleLayout, moduleScale, moduleType } from '../module-tokens';
import { summaryColumns, summaryColumnHeadroom } from '../summary-fit';

/**
 * **A summary may get taller; it may not get vaguer** — issue #125.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── What was wrong ─────────────────────────────────────────────────────────
 * `ModuleSummaryCard` gave every metric `flex: 1` inside a fixed row, so three metrics each got a
 * third of the card whatever they held, and the value was capped at one line. A count survives that.
 * A formatted amount does not: Finance rendered `129.35…` on a phone and `0.00 P…` beside it, and a
 * *wider* emulator truncated a *shorter* amount — which is the tell that the third was the
 * constraint rather than the screen.
 *
 * ── What this file refuses ─────────────────────────────────────────────────
 * Every cheap way out of that. Shrinking the type, capping the OS text size, ellipsising, dropping
 * the ISO code, dropping fractional digits, compacting to `1.2K` — each would make the card fit and
 * each would make it lie about money. The layout is the thing that gives way, so the assertions here
 * are about arrangement and about the exact characters that survive it.
 *
 * ── Why the rule measures instead of thresholding ──────────────────────────
 * `shouldStackTwoColumn` uses a fixed threshold and explains why: its strings are observance names
 * that change with the date, so measuring would make one device stack on a Tuesday and not on a
 * Wednesday. Money is the opposite. `0 JPY` and a maximum KWD differ fourfold in width and are
 * decided by the user's own ledger, so no single threshold is right for both — and the advance
 * tables the hero fit rule already trusts in production give an answer that is still deterministic.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const MODULES_ROOT = join(__dirname, '..');
const CARD = join(MODULES_ROOT, 'components', 'module-summary-card.tsx');
const FIT = join(MODULES_ROOT, 'summary-fit.ts');

function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

/** The widths and OS text sizes #125 has to hold across. */
const WIDTHS = [411, 393, 384, 360, 320] as const;
const FONT_SCALES = [1, 1.5] as const;

/** The card's geometry at one width, derived exactly as the component derives it. */
function geometry(width: number) {
  const scale = moduleScale(width);
  const dp = (value: number): number => Math.round(value * scale);
  const contentWidth =
    Math.min(width, moduleLayout.referenceWidth) - dp(moduleLayout.pagePadding) * 2;
  const padding = dp(moduleLayout.cardPadding);
  /* Padding *and* border, both sides — React Native lays the border inside the box. */
  return {
    availableWidth: contentWidth - (padding + 1) * 2,
    columnGap: dp(moduleLayout.cardGap),
    valueGap: dp(3),
    valueFontSize: +(moduleType.metric[0] * scale).toFixed(1),
    unitFontSize: +(moduleType.metricUnit[0] * scale).toFixed(1),
    valueMaxMultiplier: 1.4,
  };
}

function columnsFor(
  values: readonly string[],
  width: number,
  fontScale: number,
  units: readonly (string | undefined)[] = [],
): number {
  return summaryColumns({
    items: values.map((value, index) => ({ value, unit: units[index] })),
    fontScale,
    ...geometry(width),
  });
}

function metricsOf(...values: readonly string[]): readonly ModuleSummaryMetric[] {
  return values.map((value, index) => ({ key: `m${index}`, label: `Label ${index}`, value }));
}

function flat(node: { props: { style?: unknown } }): ViewStyle {
  return (StyleSheet.flatten(node.props.style) ?? {}) as ViewStyle;
}

async function renderCard(
  metrics: readonly ModuleSummaryMetric[],
  width = 393,
  fontScale = 1,
  moduleId: 'finance' | 'planner' | 'goals' = 'finance',
): Promise<void> {
  pinModuleWindow({ width, fontScale });
  await render(
    <ModuleProvider moduleId={moduleId}>
      <ModuleSummaryCard metrics={metrics} testID="summary" />
    </ModuleProvider>,
  );
  await waitFor(() => expect(screen.getByTestId('summary')).toBeTruthy());
}

/* The Finance figures the issue records, and the boundary cases around them. */
const AED_ZERO = formatAmount(0, 'AED');
const AED_SMALL = formatAmount(1, 'AED');
const AED_OBSERVED = formatAmount(6420, 'AED');
const JPY_ZERO = formatAmount(0, 'JPY');
const JPY_LARGE = formatAmount(9_876_543, 'JPY');
const KWD_SMALL = formatAmount(1, 'KWD');
const KWD_NEGATIVE = formatAmount(-1_234_567_890, 'KWD');
const KWD_MAX = formatAmount(MAX_MINOR_UNITS, 'KWD');

describe('the arrangement gives way, and it does so predictably', () => {
  it.each(WIDTHS)('keeps counts in one compact row at %i dp, both text sizes', (width) => {
    /*
      The arrangement everything else is measured against. Planner's cards hold counts, they have
      always fitted, and nothing in this issue is a reason to change how they look.
    */
    for (const fontScale of FONT_SCALES) {
      expect(columnsFor(['3', '12', '7'], width, fontScale)).toBe(3);
    }
  });

  it.each(WIDTHS)('never returns more columns than there are metrics, at %i dp', (width) => {
    for (const fontScale of FONT_SCALES) {
      expect(columnsFor(['3'], width, fontScale)).toBe(1);
      expect(columnsFor(['3', '12'], width, fontScale)).toBeLessThanOrEqual(2);
      expect(columnsFor(['3', '12', '7', '9'], width, fontScale)).toBeLessThanOrEqual(4);
    }
  });

  it.each(WIDTHS)('steps down rather than truncating the observed values, at %i dp', (width) => {
    /*
      `64.20 AED` is the emulator observation from the issue and `129.35 PKR` the phone's. Both now
      resolve to fewer columns than three, at either text size — which is the whole fix.
    */
    for (const fontScale of FONT_SCALES) {
      expect(columnsFor(['1', AED_OBSERVED, AED_ZERO], width, fontScale)).toBeLessThan(3);
      expect(columnsFor(['1', '129.35 PKR', '0.00 PKR'], width, fontScale)).toBeLessThan(3);
    }
  });

  it('uses the two-column arrangement rather than jumping straight to a stack', () => {
    /*
      The middle rung has to exist. A rule that only ever answered "all of them" or "one" would pass
      every "fewer than three" assertion above while making Finance a full-height stack on a phone
      that had room for two — so the reachable arrangement is named, at a width and text size where
      the value genuinely fits a half and not a third.
    */
    expect(columnsFor(['1', AED_OBSERVED, AED_ZERO], 411, 1)).toBe(2);

    const reachable = new Set(
      WIDTHS.flatMap((width) =>
        FONT_SCALES.map((fontScale) => columnsFor(['1', AED_OBSERVED, AED_ZERO], width, fontScale)),
      ),
    );
    expect(reachable.has(2)).toBe(true);
    expect([...reachable].every((columns) => columns >= 1 && columns <= 3)).toBe(true);
  });

  it('stacks completely when even a pair cannot hold the value', () => {
    /* A maximum three-decimal amount is the widest thing the ledger can produce. */
    for (const width of WIDTHS) {
      for (const fontScale of FONT_SCALES) {
        expect(columnsFor(['1', KWD_MAX, KWD_NEGATIVE], width, fontScale)).toBe(1);
      }
    }
  });

  it('is a pure function of width, text size and the strings themselves', () => {
    /*
      Determinism stated directly: the same inputs answer the same way every time, so the layout can
      never depend on a device that happened to render first. Repeated rather than asserted once
      because a rule that consulted anything ambient would drift between calls.
    */
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(columnsFor(['1', AED_OBSERVED, AED_ZERO], 393, 1.5)).toBe(
        columnsFor(['1', AED_OBSERVED, AED_ZERO], 393, 1.5),
      );
    }
  });

  it('gives a wider value no more room than a narrower one', () => {
    /* Monotonic: growing a value can only ever cost columns, never win them. */
    for (const width of WIDTHS) {
      const short = columnsFor(['1', AED_ZERO, AED_ZERO], width, 1);
      const long = columnsFor(['1', KWD_MAX, AED_ZERO], width, 1);
      expect(long).toBeLessThanOrEqual(short);
    }
  });

  it('gives a larger text size no more room than a smaller one', () => {
    for (const width of WIDTHS) {
      expect(columnsFor(['1', AED_OBSERVED, AED_ZERO], width, 1.5)).toBeLessThanOrEqual(
        columnsFor(['1', AED_OBSERVED, AED_ZERO], width, 1),
      );
    }
  });

  it('counts a unit and its gap as part of what the column must hold', () => {
    /*
      The gallery's sample metric carries a unit. A column sized for `12` and not for `12 units` is
      the same defect one element to the right.
    */
    const width = 393;
    const withoutUnit = columnsFor(['12', '34', '56'], width, 1.5);
    const withUnit = columnsFor(['12', '34', '56'], width, 1.5, [
      'units of measurement',
      undefined,
      undefined,
    ]);
    expect(withUnit).toBeLessThanOrEqual(withoutUnit);
  });

  it('keeps a rendering margin over the bare arithmetic', () => {
    expect(summaryColumnHeadroom).toBeGreaterThan(1);
    expect(code(FIT)).toContain('summaryColumnHeadroom');
  });
});

describe('the rendered card follows the rule', () => {
  const CELLS: readonly (readonly [number, number])[] = WIDTHS.flatMap((width) =>
    FONT_SCALES.map((fontScale): readonly [number, number] => [width, fontScale]),
  );

  it.each(CELLS)(
    'sizes each metric to its share at %i dp, font scale %s',
    async (width, fontScale) => {
      const metrics = metricsOf('1', AED_OBSERVED, AED_ZERO);
      await renderCard(metrics, width, fontScale);

      const expected = columnsFor(
        metrics.map((metric) => metric.value),
        width,
        fontScale,
      );
      const g = geometry(width);
      const columnWidth = Math.floor((g.availableWidth - g.columnGap * (expected - 1)) / expected);

      for (const metric of metrics) {
        const style = flat(screen.getByTestId(`summary-${metric.key}`));
        expect(style.width).toBeCloseTo(columnWidth, 5);
      }
    },
  );

  it.each(CELLS)('fits its own row at %i dp, font scale %s', async (width, fontScale) => {
    /*
      The arithmetic that a device caught and this file had not.

      The card reserves padding *and* a 1 dp border on each side, and React Native rounds every dp
      width to whole pixels on its own. Miss either and the sum of the columns plus their gaps runs
      a hair past the row — which, in a wrapping row, silently drops the last metric onto a line of
      its own while still sizing it as though it had a share of the first. The layout then disagrees
      with the rule that chose it, which is worse than either arrangement.
    */
    for (const metrics of [
      metricsOf('1', AED_OBSERVED, AED_ZERO),
      metricsOf('3', '12', '7'),
      metricsOf('1', KWD_MAX, KWD_NEGATIVE),
    ]) {
      await renderCard(metrics, width, fontScale);
      const columnWidth = Number(flat(screen.getByTestId('summary-m0')).width);
      const g = geometry(width);
      const columns = columnsFor(
        metrics.map((metric) => metric.value),
        width,
        fontScale,
      );
      const used = columnWidth * columns + g.columnGap * (columns - 1);
      expect(used).toBeLessThanOrEqual(g.availableWidth);
    }
  });

  it('wraps rather than overflowing, and keeps no fixed height', async () => {
    await renderCard(metricsOf('1', KWD_MAX, KWD_NEGATIVE), 320, 1.5);
    const card = flat(screen.getByTestId('summary'));
    /* A wrapped row needs somewhere to wrap to; a fixed height is what would clip the second row. */
    expect(card.flexWrap).toBe('wrap');
    expect(card.height).toBeUndefined();
    expect(card.maxHeight).toBeUndefined();
    expect(card.overflow).not.toBe('hidden');
    expect(typeof card.rowGap).toBe('number');
  });

  it('renders every metric in source order, in every arrangement', async () => {
    const metrics = metricsOf('1', KWD_MAX, AED_ZERO);
    for (const width of WIDTHS) {
      for (const fontScale of FONT_SCALES) {
        await renderCard(metrics, width, fontScale);
        /*
          Order is what a stacked layout is most likely to lose, and a summary whose figures swap
          places between text sizes is unreadable in a different way from a truncated one.
        */
        /*
          Read out of the tree in render order, not looked up by id: `getByTestId` finds a node
          wherever it sits, so it would report a reversed card as correct.
        */
        const order = screen
          .getAllByTestId(/^summary-m\d+$/)
          .map((node) => String(node.props.testID));
        expect(order).toEqual(metrics.map((metric) => `summary-${metric.key}`));
        for (const [index, node] of screen.getAllByTestId(/^summary-m\d+$/).entries()) {
          expect(node.props.accessibilityLabel).toContain(metrics[index]?.value ?? '');
        }
      }
    }
  });
});

describe('the value survives every arrangement, character for character', () => {
  const CASES: readonly (readonly [string, string])[] = [
    ['zero, no fractional digits', JPY_ZERO],
    ['large, no fractional digits', JPY_LARGE],
    ['smallest two-digit amount', AED_SMALL],
    ['the observed amount', AED_OBSERVED],
    ['smallest three-digit amount', KWD_SMALL],
    ['negative three-digit amount', KWD_NEGATIVE],
    ['the ledger maximum', KWD_MAX],
  ];

  it.each(CASES)('%s renders in full at every width and text size', async (_name, value) => {
    for (const width of WIDTHS) {
      for (const fontScale of FONT_SCALES) {
        await renderCard(metricsOf('1', value, AED_ZERO), width, fontScale);
        /*
          The text node holds the whole string. Nothing here can shorten it — but a `numberOfLines`
          would let the platform do so at draw time, which is why the source guard below exists too.
        */
        expect(screen.getByText(value)).toBeTruthy();
      }
    }
  });

  it.each(CASES)('%s keeps its ISO code and its digits', (_name, value) => {
    expect(value).toMatch(/[A-Z]{3}$/);
    expect(value).not.toMatch(/…|\.\.\./);
    /* No compact or scientific notation ever reaches the card. */
    expect(value).not.toMatch(/[KMBTe]\d|\de[+-]?\d/i);
  });

  it('carries exactly one minus sign on a negative, and none on zero', () => {
    expect([...KWD_NEGATIVE].filter((character) => character === '−')).toHaveLength(1);
    expect(KWD_NEGATIVE).not.toContain('-');
    expect(JPY_ZERO).not.toContain('−');
  });

  it('keeps each currency’s own number of fractional digits', () => {
    expect(JPY_ZERO).toBe('0 JPY');
    expect(AED_ZERO.split(' ')[0]).toMatch(/^\d+\.\d{2}$/);
    expect(KWD_SMALL.split(' ')[0]).toMatch(/^\d+\.\d{3}$/);
  });

  it('says the same thing to a screen reader as it draws', async () => {
    await renderCard(metricsOf('1', KWD_NEGATIVE, AED_ZERO), 320, 1.5);
    const node = screen.getByTestId('summary-m1');
    /* The accessible sentence was already complete while the visible value was not. Now both are. */
    expect(node.props.accessibilityLabel).toBe(`Label 1, ${KWD_NEGATIVE}`);
    expect(screen.getByText(KWD_NEGATIVE)).toBeTruthy();
  });

  it('leaves the money formatter untouched and still uses it', () => {
    /* #96 owns exactness. #125 owns arrangement, and must not have reached across that line. */
    expect(code(CARD)).not.toContain('formatAmount');
    expect(code(CARD)).not.toContain('toFixed');
    expect(code(CARD)).not.toContain('Intl');
    expect(code(FIT)).not.toContain('formatAmount');
    const finance = code(
      join(MODULES_ROOT, '..', 'finance', 'screens', 'finance-home-content.tsx'),
    );
    expect(finance).toContain('financeMoney(currency, locale).amount(summary.expenseMinor)');
    expect(finance).toContain('financeMoney(currency, locale).amount(summary.incomeMinor)');
  });
});

describe('the shared consumers keep what they had', () => {
  it('leaves every consumer’s metrics, labels and icons unchanged', () => {
    const finance = code(
      join(MODULES_ROOT, '..', 'finance', 'screens', 'finance-home-content.tsx'),
    );
    for (const fragment of ["label: 'Entries'", "label: 'Spent'", "label: 'Received'"]) {
      expect(finance).toContain(fragment);
    }
    for (const icon of ["icon: 'transactions'", "icon: 'budgets'", "icon: 'trends'"]) {
      expect(finance).toContain(icon);
    }

    const planner = code(
      join(MODULES_ROOT, '..', 'planner', 'screens', 'planner-home-content.tsx'),
    );
    /* Both of Planner's cards — the second is the one a consumer sweep is most likely to miss. */
    expect(planner).toContain('testID="planner-summary"');
    expect(planner).toContain('testID="planner-routines-summary"');
    for (const fragment of ["label: 'Due today'", "label: 'Open tasks'", "label: 'Completed'"]) {
      expect(planner).toContain(fragment);
    }
    for (const fragment of ["label: 'Scheduled'", "label: 'Done'"]) {
      expect(planner).toContain(fragment);
    }

    expect(code(join(MODULES_ROOT, 'screens', 'module-home-screen.tsx'))).toContain(
      'metrics={state.overview.metrics}',
    );
    expect(code(join(MODULES_ROOT, 'screens', 'module-gallery-screen.tsx'))).toContain(
      'metrics={fixture.metrics}',
    );
  });

  it('handles the two-metric card Planner actually renders', () => {
    for (const width of WIDTHS) {
      for (const fontScale of FONT_SCALES) {
        expect(columnsFor(['3', '2'], width, fontScale)).toBe(2);
      }
    }
  });

  it('keeps the surface roles and the border it always drew', async () => {
    await renderCard(metricsOf('1', AED_ZERO, AED_ZERO));
    const card = flat(screen.getByTestId('summary'));
    expect(card.backgroundColor).toBe('#FFFFFF');
    expect(card.borderWidth).toBe(1);
    expect(typeof card.borderRadius).toBe('number');
  });

  it('leaves the items non-interactive, without inventing button semantics', async () => {
    await renderCard(metricsOf('1', AED_ZERO, AED_ZERO));
    const node = screen.getByTestId('summary-m1');
    /*
      They were never pressable and this issue gives no reason to make them so. A 44 dp rule would
      not apply here, and an `accessibilityRole` of button would promise a press that never comes.
    */
    expect(node.props.accessibilityRole).toBeUndefined();
    expect(node.props.onPress).toBeUndefined();
    expect(code(CARD)).not.toContain('Pressable');
    expect(code(CARD)).not.toContain('accessibilityRole="button"');
  });
});

describe('the guards that stop this coming back', () => {
  it('refuses any way of shortening a value', () => {
    const card = code(CARD);
    const valueRow = /<View style=\{\[styles\.valueRow[\s\S]*?<\/View>/.exec(card)?.[0] ?? '';
    expect(valueRow).not.toBe('');

    /* The exact mechanisms that produced `129.35…`, each named. */
    expect(valueRow).not.toContain('numberOfLines');
    expect(valueRow).not.toContain('ellipsizeMode');
    expect(card).not.toContain('ellipsizeMode');
    expect(card).not.toContain('allowFontScaling={false}');
    expect(card).not.toContain('minimumFontScale');
    expect(card).not.toContain('adjustsFontSizeToFit');
  });

  it('refuses a fixed height that a wrapped row could not fit inside', () => {
    const card = code(CARD);
    const cardStyle = /card: \{([\s\S]*?)\n  \}/.exec(card)?.[1] ?? '';
    expect(cardStyle).toContain("flexWrap: 'wrap'");
    expect(cardStyle).not.toMatch(/\bheight:/);
    expect(cardStyle).not.toMatch(/maxHeight:/);
    expect(cardStyle).not.toContain("overflow: 'hidden'");
    /* `flex: 1` on a metric is the fixed-share sizing this issue replaced. */
    const metricStyle = /metric: \{([\s\S]*?)\n  \}/.exec(card)?.[1] ?? '';
    expect(metricStyle).not.toMatch(/flex: 1/);
  });

  it('keeps the decision in one shared place, with no module knowing its own name', () => {
    const card = code(CARD);
    expect(card).toContain('summaryColumns(');
    expect(card).not.toMatch(/moduleId\s*===/);
    expect(card).not.toMatch(/['"](finance|planner|learning|family|goals)['"]/);
    expect(code(FIT)).not.toMatch(/['"](finance|planner|learning|family|goals)['"]/);
    /*
      A branch can be spelled without naming a module — `theme.ink === '#A85F17'` is Finance by
      another route. So the card reads nothing off the theme except the colours it paints with.
    */
    expect(card).not.toMatch(/theme\.\w+\s*===/);
    expect(card).not.toMatch(/#[0-9a-fA-F]{6}/);
  });

  it('sizes the columns identically whichever module is providing the theme', async () => {
    /*
      The behavioural half of the same rule. Rendering only Finance would let a Finance-shaped branch
      pass every assertion in this file, so three different providers are given identical metrics and
      must produce identical geometry.
    */
    const metrics = metricsOf('1', AED_OBSERVED, AED_ZERO);
    const widths: number[] = [];
    for (const moduleId of ['finance', 'planner', 'goals'] as const) {
      await renderCard(metrics, 393, 1.5, moduleId);
      widths.push(Number(flat(screen.getByTestId('summary-m1')).width));
    }
    expect(new Set(widths).size).toBe(1);
  });

  it('keeps the rendered cap and the measured cap the same number', () => {
    /*
      The rule is only right if it measures what will be drawn. Two literals drifting apart would make
      it confidently wrong, so the component holds one constant and hands it to both.
    */
    const card = code(CARD);
    expect(card).toContain('const VALUE_MAX_FONT_MULTIPLIER = 1.4');
    expect(card).toContain('maxFontSizeMultiplier={VALUE_MAX_FONT_MULTIPLIER}');
    expect(card).toContain('valueMaxMultiplier: VALUE_MAX_FONT_MULTIPLIER');
    expect((card.match(/1\.4/g) ?? []).length).toBe(1);
  });

  it('uses the production advance tables rather than a second estimator', () => {
    expect(code(FIT)).toContain("from './hero-copy-fit'");
    expect(code(FIT)).toContain('textWidthEm');
  });
});
