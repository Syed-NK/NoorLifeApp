import { StyleSheet, View } from 'react-native';

import { AppIcon } from '@ds/components';
import type { IconName } from '@shared/models/icon';

import { useModuleTheme } from '../module-context';
import { useModuleSurfaces } from '../module-surfaces';
import { moduleLayout, moduleNeutrals } from '../module-tokens';
import { summaryColumns } from '../summary-fit';
import { useModuleMetrics } from '../use-module-metrics';
import { ModuleText } from './module-text';

/** Direction of change. Carried by an arrow icon and a word, never by colour alone. */
export type ModuleTrend = 'up' | 'down' | 'flat';

export type ModuleSummaryMetric = {
  readonly key: string;
  /** What the number is, e.g. "Steps". */
  readonly label: string;
  /** The figure itself, pre-formatted, e.g. "6,240". */
  readonly value: string;
  /** Unit or period suffix, e.g. "today". */
  readonly unit?: string;
  readonly icon?: IconName;
  readonly trend?: ModuleTrend;
  /** Change text, e.g. "12% more than last week". Required when `trend` is set. */
  readonly trendLabel?: string;
};

export type ModuleSummaryCardProps = {
  readonly metrics: readonly ModuleSummaryMetric[];
  readonly testID?: string;
};

/**
 * The approved cap on how far the 22 dp figure grows with the OS text size.
 *
 * Named rather than inline because two places now depend on it agreeing: the text that renders and
 * the rule that decides how many columns those renders can fit in.
 */
const VALUE_MAX_FONT_MULTIPLIER = 1.4;

/**
 * The card's own border, which React Native lays out *inside* the box.
 *
 * Named because the fit rule has to subtract it. Two dp sounds ignorable and is not: it is the
 * difference between three columns fitting and the third wrapping onto a line of its own.
 */
const CARD_BORDER_WIDTH = 1;

const TREND_ICON: Readonly<Record<ModuleTrend, IconName>> = {
  up: 'trends',
  down: 'trends',
  flat: 'chevron-forward',
};

/**
 * A row of the module's headline numbers.
 *
 * ── Why `trendLabel` is required alongside `trend` ──────────────────────────
 * A green up-arrow is not self-explanatory: up is good for steps and bad for
 * spending. The card therefore always renders the sentence, and `trend` only chooses
 * the icon rotation and tint. The accessible label is the sentence, so a screen
 * reader gets the meaning rather than "up arrow".
 *
 * ── The row gives way before a number does — issue #125 ────────────────────
 * Metrics used to share the row equally with `flex: 1`, so three of them each got a third of the
 * card whatever they held. That is right for a count and wrong for an amount: at the OS text size
 * 1.5 Finance rendered `129.35…` and `0.00 P…`, and a wider emulator truncated a *shorter* value —
 * the third was the constraint, not the screen.
 *
 * `summaryColumns` now decides how many columns the values can actually be read in, and the row
 * wraps into that many. A card whose values fit keeps the compact arrangement it has today; one
 * whose values do not becomes two-plus-one and then a stack, growing taller rather than hiding a
 * digit. Source order is the render order in every arrangement, so the reading order never moves.
 */
export function ModuleSummaryCard({ metrics, testID }: ModuleSummaryCardProps) {
  const theme = useModuleTheme();
  const surfaces = useModuleSurfaces();
  const { dp, type, fontScale, contentWidth } = useModuleMetrics();

  const padding = dp(moduleLayout.cardPadding);
  const columnGap = dp(moduleLayout.cardGap);
  const valueGap = dp(3);
  /*
    The width the metrics actually share.

    The card is laid out at the page's content width — measured 352 dp inside a 384 dp screen — so
    what it keeps for itself is padding **and border**, both sides. Missing the border cost two dp,
    which was enough on a device: the rule said three columns fitted, the columns were sized for
    three, and the last one wrapped anyway. A layout that disagrees with its own measurement is
    worse than one that is merely conservative.
  */
  const availableWidth = contentWidth - (padding + CARD_BORDER_WIDTH) * 2;
  const columns = summaryColumns({
    items: metrics.map((metric) => ({ value: metric.value, unit: metric.unit })),
    availableWidth,
    columnGap,
    valueGap,
    valueFontSize: type('metric').fontSize,
    unitFontSize: type('metricUnit').fontSize,
    fontScale,
    valueMaxMultiplier: VALUE_MAX_FONT_MULTIPLIER,
  });
  /*
    Floored, so the columns and their gaps can never sum past the row they sit in. React Native
    rounds each dp width to whole device pixels independently, and three columns each rounded up is
    how an exact fit becomes an overflow — and an overflow, in a wrapping row, becomes a stray line.
  */
  const columnWidth = Math.floor((availableWidth - columnGap * (columns - 1)) / columns);

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: surfaces.card, borderColor: surfaces.border },
        {
          borderRadius: dp(moduleLayout.cardRadius),
          padding,
          columnGap,
          /* Wrapping is what turns a column count into rows; the gap keeps the rows apart. */
          rowGap: dp(moduleLayout.cardGap),
        },
      ]}
      testID={testID}
    >
      {metrics.map((metric) => {
        const trendColor =
          metric.trend === 'down'
            ? moduleNeutrals.warning
            : metric.trend === 'up'
              ? moduleNeutrals.success
              : moduleNeutrals.textSecondary;

        const accessibleValue = `${metric.label}, ${metric.value}${metric.unit === undefined ? '' : ` ${metric.unit}`}`;

        return (
          <View
            key={metric.key}
            style={[styles.metric, { width: columnWidth }]}
            accessible
            accessibilityLabel={
              metric.trendLabel === undefined
                ? accessibleValue
                : `${accessibleValue}, ${metric.trendLabel}`
            }
            testID={`${testID ?? 'module-summary'}-${metric.key}`}
          >
            <View style={[styles.labelRow, { columnGap: dp(4) }]}>
              {metric.icon === undefined ? null : (
                <AppIcon name={metric.icon} size={dp(13)} color={theme.ink} />
              )}
              {/* Two lines, so a long or translated label wraps in its column instead of ellipsing. */}
              <ModuleText token="caption" numberOfLines={2} style={styles.flexText}>
                {metric.label}
              </ModuleText>
            </View>

            <View style={[styles.valueRow, { columnGap: valueGap }]}>
              {/*
                No `numberOfLines` on either — issue #125.

                The column is now sized to the value, so wrapping is the safety net rather than the
                normal case: it catches a value longer than anything the ledger can currently hold,
                and a device whose shaping runs wider than the advance tables predict. A limit of one
                line here would turn both of those into an ellipsis, which is the defect.

                `maxFontSizeMultiplier` stays exactly as it was. It is the approved typographic cap on
                a 22 dp figure, it predates this issue, and `summaryColumns` is given the same number
                so the measurement matches what will be drawn.
              */}
              <ModuleText
                token="metric"
                color={theme.ink}
                maxFontSizeMultiplier={VALUE_MAX_FONT_MULTIPLIER}
              >
                {metric.value}
              </ModuleText>
              {metric.unit === undefined ? null : (
                <ModuleText token="metricUnit">{metric.unit}</ModuleText>
              )}
            </View>

            {metric.trend === undefined || metric.trendLabel === undefined ? null : (
              <View style={[styles.labelRow, { columnGap: dp(3), marginTop: dp(2) }]}>
                <AppIcon
                  name={TREND_ICON[metric.trend]}
                  size={dp(11)}
                  color={trendColor}
                  // 'down' reuses the trend glyph rotated, so one icon covers both directions.
                  style={metric.trend === 'down' ? styles.flipped : undefined}
                />
                <ModuleText
                  token="caption"
                  color={trendColor}
                  numberOfLines={2}
                  style={styles.flexText}
                >
                  {metric.trendLabel}
                </ModuleText>
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    /* Overridden per module — issue #91. */
    borderWidth: CARD_BORDER_WIDTH,
    /* Overridden per module — issue #91. */
  },
  metric: {
    minWidth: 0,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  valueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  flexText: {
    flex: 1,
    minWidth: 0,
  },
  flipped: {
    transform: [{ scaleY: -1 }],
  },
});
