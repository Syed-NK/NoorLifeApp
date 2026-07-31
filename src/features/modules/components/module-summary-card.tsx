import { StyleSheet, View } from 'react-native';

import { AppIcon } from '@ds/components';
import type { IconName } from '@shared/models/icon';

import { useModuleTheme } from '../module-context';
import { moduleLayout, moduleNeutrals } from '../module-tokens';
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
 * Metrics share the row equally with `minWidth: 0`, so a long figure shrinks its own
 * column instead of pushing its neighbour off-screen.
 */
export function ModuleSummaryCard({ metrics, testID }: ModuleSummaryCardProps) {
  const theme = useModuleTheme();
  const { dp } = useModuleMetrics();

  return (
    <View
      style={[
        styles.card,
        {
          borderRadius: dp(moduleLayout.cardRadius),
          padding: dp(moduleLayout.cardPadding),
          columnGap: dp(moduleLayout.cardGap),
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
            style={styles.metric}
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
              <ModuleText token="caption" numberOfLines={1} style={styles.flexText}>
                {metric.label}
              </ModuleText>
            </View>

            <View style={[styles.valueRow, { columnGap: dp(3) }]}>
              <ModuleText
                token="metric"
                color={theme.ink}
                numberOfLines={1}
                maxFontSizeMultiplier={1.4}
              >
                {metric.value}
              </ModuleText>
              {metric.unit === undefined ? null : (
                <ModuleText token="metricUnit" numberOfLines={1}>
                  {metric.unit}
                </ModuleText>
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
    backgroundColor: moduleNeutrals.surface,
    borderWidth: 1,
    borderColor: moduleNeutrals.border,
  },
  metric: {
    flex: 1,
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
