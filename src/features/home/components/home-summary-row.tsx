import { StyleSheet, View } from 'react-native';

import { AppIcon, PressableScale, ProgressRing } from '@ds/components';
import { moduleThemes } from '@ds/modules/module-themes';
import { neutralColors, radius, semanticColors } from '@ds/tokens';
import type { FamilyCheckInSummary, OverallProgressSummary } from '@shared/models/dashboard';
import { minimumHitSlop } from '@shared/utils/a11y';

import { LOCKED } from '../main-home-metrics';
import { useMetrics } from '../main-home-metrics-context';
import { HomeText } from './home-text';

export type HomeSummaryRowProps = {
  readonly familyCheckIn: FamilyCheckInSummary;
  readonly overallProgress: OverallProgressSummary;
  readonly onViewFamily: () => void;
  readonly onViewProgress: () => void;
  readonly testID?: string;
};

/**
 * Family Check-in and Overall Progress, locked by implementation-lock §10 and
 * 05-summary-cards-reference.png.
 *
 * Locked geometry: two equal columns, 8 dp gap, 98 dp tall, 14 dp radius, 12 dp
 * padding. Family: 20 dp `account-group` in `#D95B82`, title 11/15 w600, value
 * 19/24 w600, 4 dp progress bar. Progress: 54 dp ring with a 7 dp stroke, value
 * 22/27 w600, supporting text 9.5/13.
 *
 * §10 is explicit that titles may not truncate, and that the remedy is a smaller
 * title rather than a narrower card — hence the locked 11 dp title with the value,
 * not the heading, carrying the visual weight. `View All` is the global primary
 * `#3157C8` in both cards, per §9 and the crop.
 *
 * Both values are stated as text beside their indicator, so neither depends on the
 * bar or the arc alone (design spec §8).
 */
export function HomeSummaryRow({
  familyCheckIn,
  overallProgress,
  onViewFamily,
  onViewProgress,
  testID,
}: HomeSummaryRowProps) {
  const { dp } = useMetrics();
  const familyTheme = moduleThemes.family;
  const goalsTheme = moduleThemes.goals;

  const checkInPercentage =
    familyCheckIn.total === 0 ? 0 : (familyCheckIn.completed / familyCheckIn.total) * 100;

  const cardStyle = [
    styles.card,
    {
      height: dp(LOCKED.summary.height),
      borderRadius: dp(LOCKED.summary.radius),
      padding: dp(LOCKED.summary.padding),
    },
  ];

  return (
    <View style={[styles.row, { gap: dp(LOCKED.summary.gap) }]} testID={testID}>
      <View style={cardStyle} testID="family-check-in-card">
        <View style={styles.headingRow}>
          <AppIcon name="family" size={dp(16)} color={familyTheme.primary} />
          <HomeText token="summaryTitle" numberOfLines={1} style={styles.headingTitle}>
            Family Check-in
          </HomeText>
          <ViewAll onPress={onViewFamily} label="Family check-in" hitSize={dp(20)} />
        </View>

        <HomeText token="summaryValue" numberOfLines={1}>
          {familyCheckIn.completed} of {familyCheckIn.total}
        </HomeText>
        <HomeText token="progressSupport" color={neutralColors.textSecondary} numberOfLines={1}>
          {familyCheckIn.statusLabel}
        </HomeText>

        <View
          style={[
            styles.track,
            { height: dp(LOCKED.summary.progressBarHeight), marginTop: 'auto' },
          ]}
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel={`Family check-in, ${familyCheckIn.completed} of ${familyCheckIn.total} ${familyCheckIn.statusLabel}`}
          accessibilityValue={{ min: 0, max: 100, now: Math.round(checkInPercentage) }}
        >
          <View
            style={{
              width: `${checkInPercentage}%`,
              height: '100%',
              borderRadius: radius.pill,
              backgroundColor: familyTheme.primary,
            }}
          />
        </View>
      </View>

      <View style={cardStyle} testID="overall-progress-card">
        <View style={styles.headingRow}>
          <HomeText token="summaryTitle" numberOfLines={1} style={styles.headingTitle}>
            Overall Progress
          </HomeText>
          <ViewAll onPress={onViewProgress} label="Overall progress" hitSize={dp(20)} />
        </View>

        <View style={[styles.progressRow, { gap: dp(10) }]}>
          <ProgressRing
            progress={overallProgress.percentage}
            size={dp(LOCKED.summary.ring)}
            thickness={dp(LOCKED.summary.ringStroke)}
            color={goalsTheme.primary}
            accessibilityLabel={`Overall progress ${overallProgress.percentage} percent, ${overallProgress.statusLabel}`}
            testID="overall-progress-ring"
          />
          <View style={styles.progressText}>
            <HomeText token="progressValue" numberOfLines={1}>
              {overallProgress.percentage}%
            </HomeText>
            <HomeText token="progressSupport" color={goalsTheme.primary} numberOfLines={2}>
              {overallProgress.statusLabel}
            </HomeText>
          </View>
        </View>
      </View>
    </View>
  );
}

/** The shared `View All` affordance: 11/16 w500 `#3157C8`, 44 dp touch area. */
function ViewAll({
  onPress,
  label,
  hitSize,
}: {
  readonly onPress: () => void;
  readonly label: string;
  readonly hitSize: number;
}) {
  return (
    <PressableScale
      onPress={onPress}
      hitSlop={minimumHitSlop(hitSize)}
      accessibilityRole="button"
      accessibilityLabel={`View all, ${label}`}
      style={styles.viewAll}
    >
      <HomeText token="viewAll" color={semanticColors.primary} numberOfLines={1}>
        View All
      </HomeText>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
  },
  card: {
    flex: 1,
    minWidth: 0,
    backgroundColor: neutralColors.surface,
    borderWidth: 1,
    borderColor: neutralColors.border,
    shadowColor: '#172033',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 1,
  },
  headingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  headingTitle: {
    flexShrink: 1,
    minWidth: 0,
  },
  viewAll: {
    flexShrink: 0,
  },
  track: {
    alignSelf: 'stretch',
    borderRadius: radius.pill,
    backgroundColor: neutralColors.surfaceSoft,
    overflow: 'hidden',
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  progressText: {
    flex: 1,
    minWidth: 0,
  },
});
