import { StyleSheet, View } from 'react-native';

import { useModuleTheme } from '../module-context';
import { moduleLayout, moduleNeutrals } from '../module-tokens';
import { useModuleMetrics } from '../use-module-metrics';
import { ModuleText } from './module-text';

export type ModuleProgressBarProps = {
  /** 0–1. Values outside the range are clamped. */
  readonly value: number;
  /** Baseline dp. */
  readonly height?: number;
  /**
   * Renders for a coloured surface rather than a white card.
   *
   * The default ink-on-grey fill disappears over hero artwork, so the on-fill variant uses
   * white on a translucent track — the treatment the Finance reference shows.
   */
  readonly onFillSurface?: boolean;
  /** Screen-reader description, e.g. "Surah Al-Kahf, 55 percent read". */
  readonly accessibilityLabel: string;
  readonly testID?: string;
};

/**
 * A rounded track with a module-coloured fill — Faith's Continue-Quran progress.
 *
 * The fill is a percentage width inside a fixed-height track, so it cannot grow
 * vertically. `accessibilityValue` carries the number, because a bar's length is not
 * available to a screen reader and progress must never be conveyed by width alone.
 */
export function ModuleProgressBar({
  value,
  height = 5,
  onFillSurface = false,
  accessibilityLabel,
  testID,
}: ModuleProgressBarProps) {
  const theme = useModuleTheme();
  const { dp } = useModuleMetrics();
  const clamped = Math.max(0, Math.min(1, value));
  const h = dp(height);

  return (
    <View
      style={[
        styles.track,
        {
          height: h,
          borderRadius: h / 2,
          backgroundColor: onFillSurface ? 'rgba(255,255,255,0.34)' : moduleNeutrals.skeleton,
        },
      ]}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped * 100) }}
      testID={testID}
    >
      <View
        style={{
          width: `${clamped * 100}%`,
          height: '100%',
          borderRadius: h / 2,
          backgroundColor: onFillSurface ? '#FFFFFF' : theme.ink,
        }}
      />
    </View>
  );
}

export type ModuleLineChartProps = {
  /** One value per point, in any numeric range. At least two points. */
  readonly values: readonly number[];
  /** Axis labels, one per value. */
  readonly labels: readonly string[];
  /** Baseline dp height of the plot area, excluding the axis labels. */
  readonly plotHeight?: number;
  /** Describes the trend in words — the chart's shape is not available to a reader. */
  readonly accessibilityLabel: string;
  readonly testID?: string;
};

/**
 * Health's seven-day trend line.
 *
 * ── Why this is drawn with rotated views rather than SVG ─────────────────────
 * `react-native-svg` is a native module, and adding it would mean a new dependency and
 * a rebuild of every development client for one polyline and one ring. Phase 1 made the
 * same call for `ProgressRing`, which draws a full arc with `View` transforms; matching
 * that keeps the build simple and the precedent consistent.
 *
 * Each segment is a thin view sized to the distance between two points, positioned at
 * their midpoint and rotated about its own centre — which is where React Native rotates
 * by default, so no transform-origin gymnastics are needed. Markers are hollow circles
 * drawn on top, as the reference shows.
 *
 * The plot is laid out with percentages inside a fixed-height box, so the chart cannot
 * stretch the card vertically.
 */
export function ModuleLineChart({
  values,
  labels,
  plotHeight = 58,
  accessibilityLabel,
  testID,
}: ModuleLineChartProps) {
  const theme = useModuleTheme();
  const { dp, contentWidth } = useModuleMetrics();

  const h = dp(plotHeight);
  const marker = dp(7);
  const stroke = dp(2);

  // The plot's usable width: the two-column card, minus its padding, minus a marker so
  // the first and last points sit fully inside the box rather than half-clipped.
  const columnWidth = (contentWidth - dp(moduleLayout.twoColumnGap)) / 2;
  const plotWidth = columnWidth - dp(moduleLayout.cardPadding) * 2 - marker;

  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;

  /** Point coordinates inside the plot box, in dp. */
  const points = values.map((value, index) => ({
    x: marker / 2 + (index / (values.length - 1)) * plotWidth,
    // Inverted: a higher value sits nearer the top.
    y: marker / 2 + (1 - (value - min) / span) * (h - marker),
  }));

  const segments = points.slice(1).map((to, index) => {
    const from = points[index]!;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy);
    return {
      key: `${index}`,
      length,
      angle: `${(Math.atan2(dy, dx) * 180) / Math.PI}deg`,
      midX: (from.x + to.x) / 2,
      midY: (from.y + to.y) / 2,
    };
  });

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
    >
      <View style={{ height: h }}>
        {segments.map((segment) => (
          <View
            key={segment.key}
            style={{
              position: 'absolute',
              width: segment.length,
              height: stroke,
              borderRadius: stroke / 2,
              backgroundColor: theme.border,
              left: segment.midX - segment.length / 2,
              top: segment.midY - stroke / 2,
              transform: [{ rotate: segment.angle }],
            }}
          />
        ))}
        {points.map((point, index) => (
          <View
            key={index}
            style={{
              position: 'absolute',
              width: marker,
              height: marker,
              borderRadius: marker / 2,
              borderWidth: dp(1.5),
              borderColor: theme.border,
              backgroundColor: moduleNeutrals.surface,
              left: point.x - marker / 2,
              top: point.y - marker / 2,
            }}
          />
        ))}
      </View>

      <View style={styles.axis}>
        {labels.map((label) => (
          <ModuleText
            key={label}
            token="chartAxis"
            color={moduleNeutrals.textTertiary}
            numberOfLines={1}
            maxFontSizeMultiplier={1.2}
            style={styles.axisLabel}
          >
            {label}
          </ModuleText>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    width: '100%',
    backgroundColor: moduleNeutrals.skeleton,
    overflow: 'hidden',
  },
  axis: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 2,
  },
  axisLabel: {
    flex: 1,
    textAlign: 'center',
  },
});
