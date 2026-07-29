import { StyleSheet, View } from 'react-native';

import { SkeletonCard } from '@ds/components';

import { LOCKED, LOCKED_HEIGHTS } from '../main-home-metrics';
import { useMetrics } from '../main-home-metrics-context';

/**
 * Main Home loading state.
 *
 * Design spec §20 requires a skeleton representation of the expected content rather
 * than a bare spinner. Each block matches the locked height of the section it stands
 * in for, so nothing shifts when data arrives and no blank region appears while
 * loading.
 */
export function MainHomeSkeleton({ testID }: { readonly testID?: string }) {
  const { dp, contentWidth } = useMetrics();

  const gap = dp(LOCKED.grid.gap);
  const tileWidth = Math.floor(
    (contentWidth - gap * (LOCKED.grid.columns - 1)) / LOCKED.grid.columns,
  );

  return (
    <View testID={testID}>
      <SkeletonCard
        height={dp(LOCKED_HEIGHTS.hero)}
        lines={3}
        accessibilityLabel="Loading your day"
      />

      <View style={{ height: dp(LOCKED_HEIGHTS.gapAfterHero) }} />
      <View style={[styles.grid, { gap }]}>
        {Array.from({ length: LOCKED.grid.columns * LOCKED.grid.rows }, (_unused, index) => (
          <View key={index} style={{ width: tileWidth }}>
            <SkeletonCard
              height={dp(LOCKED.grid.tileHeight)}
              lines={1}
              accessibilityLabel="Loading module"
            />
          </View>
        ))}
      </View>

      <View style={{ height: dp(LOCKED_HEIGHTS.gapAfterGrid) }} />
      <SkeletonCard
        height={dp(LOCKED_HEIGHTS.todayCard)}
        lines={4}
        accessibilityLabel="Loading today's schedule"
      />

      <View style={{ height: dp(LOCKED_HEIGHTS.gapAfterToday) }} />
      <View style={[styles.row, { gap: dp(LOCKED.summary.gap) }]}>
        <View style={styles.cell}>
          <SkeletonCard
            height={dp(LOCKED_HEIGHTS.summaryCards)}
            lines={2}
            accessibilityLabel="Loading family check-in"
          />
        </View>
        <View style={styles.cell}>
          <SkeletonCard
            height={dp(LOCKED_HEIGHTS.summaryCards)}
            lines={2}
            accessibilityLabel="Loading overall progress"
          />
        </View>
      </View>

      <View style={{ height: dp(LOCKED_HEIGHTS.gapAfterSummary) }} />
      <SkeletonCard
        height={dp(LOCKED_HEIGHTS.aiInsight)}
        lines={2}
        withLeadingBlock
        accessibilityLabel="Loading Noor AI insight"
      />

      <View style={{ height: dp(LOCKED_HEIGHTS.gapAfterInsight) }} />
      <View style={[styles.row, { gap: dp(LOCKED.quickAction.gap) }]}>
        {Array.from({ length: 3 }, (_unused, index) => (
          <View key={index} style={styles.cell}>
            <SkeletonCard
              height={dp(LOCKED_HEIGHTS.quickActions)}
              lines={1}
              accessibilityLabel="Loading quick action"
            />
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  row: {
    flexDirection: 'row',
  },
  cell: {
    flex: 1,
    minWidth: 0,
  },
});
