import { StyleSheet, View } from 'react-native';

import { AppIcon, PressableScale, StateView } from '@ds/components';
import { neutralColors, semanticColors } from '@ds/tokens';
import type { TimelineEntry } from '@shared/models/dashboard';
import type { ModuleTheme } from '@shared/models/module-theme';
import { minimumHitSlop } from '@shared/utils/a11y';
import { forwardChevron } from '@shared/utils/rtl';

import { LOCKED } from '../main-home-metrics';
import { useMetrics } from '../main-home-metrics-context';
import { HomeText } from './home-text';

export type TodayTimelineProps = {
  readonly entries: readonly TimelineEntry[];
  /** Theme used only by the empty state, which inherits the module accent (§19–28). */
  readonly theme: ModuleTheme;
  readonly onViewAll: () => void;
  /** Called with the entry's source module — Main Home never edits records. */
  readonly onSelectEntry: (entry: TimelineEntry) => void;
  readonly testID?: string;
};

/**
 * "Today at a Glance", locked by 04-today-timeline-reference.png and the compact-layout
 * correction.
 *
 * Locked geometry: a fixed **126 dp** card, 13 dp radius, 12 dp horizontal and 8 dp
 * vertical padding, 1 dp `#E2E6EC` border. A 22 dp heading (title 14/18 w600, `View All`
 * 10/13 `#3157C8`) over four 23 dp rows, each with a 7 dp dot on a 2 dp rail, a 62 dp time
 * column at 10/13, a 10/13 activity label and a 15 dp trailing icon.
 *
 * Internal padding and row height were reduced to reach 126 dp — line heights were not,
 * so the text stays legible while the card returns the vertical space the no-scroll
 * Pixel 8 layout needs. All four rows are preserved.
 *
 * Rows render at 23 dp but carry hit-slop up to 44 dp, so the density matches the
 * reference without a touch target falling below the accessibility floor.
 *
 * When there are no entries the section renders its designed empty state rather than
 * collapsing, per design spec §3.0.
 */
export function TodayTimeline({
  entries,
  theme,
  onViewAll,
  onSelectEntry,
  testID,
}: TodayTimelineProps) {
  const { dp } = useMetrics();

  const rowHeight = dp(LOCKED.today.rowHeight);
  const dotSize = dp(LOCKED.today.dot);
  const lineWidth = dp(LOCKED.today.line);

  return (
    <View
      style={[
        styles.card,
        {
          height: dp(LOCKED.today.cardHeight),
          borderRadius: dp(LOCKED.today.cardRadius),
          paddingHorizontal: dp(LOCKED.today.paddingHorizontal),
          paddingVertical: dp(LOCKED.today.paddingVertical),
        },
      ]}
      testID={testID}
    >
      <View style={[styles.heading, { height: dp(LOCKED.today.headingHeight) }]}>
        <HomeText token="sectionTitle" numberOfLines={1} style={styles.headingTitle}>
          Today at a Glance
        </HomeText>
        <PressableScale
          onPress={onViewAll}
          hitSlop={minimumHitSlop(dp(LOCKED.today.headingHeight))}
          accessibilityRole="button"
          accessibilityLabel="View all of today's schedule"
          style={styles.viewAll}
          testID={`${testID ?? 'today'}-view-all`}
        >
          {/* Lock §9: View All is the global primary, not a module colour. */}
          <HomeText token="viewAll" color={semanticColors.primary} numberOfLines={1}>
            View All
          </HomeText>
          <AppIcon name={forwardChevron()} size={dp(12)} color={semanticColors.primary} />
        </PressableScale>
      </View>

      <View style={styles.divider} />

      {entries.length === 0 ? (
        <StateView
          kind="empty"
          theme={theme}
          title="Nothing scheduled today"
          message="Add an event or task in Planner and it will appear here."
          testID="timeline-empty-state"
        />
      ) : (
        <View>
          {/* Rail behind the dots, stopping at the first and last dot centres. */}
          <View
            style={[
              styles.rail,
              {
                width: lineWidth,
                left: (dotSize - lineWidth) / 2,
                top: rowHeight / 2,
                bottom: rowHeight / 2,
              },
            ]}
            pointerEvents="none"
          />

          {entries.map((entry) => (
            <PressableScale
              key={entry.id}
              onPress={() => onSelectEntry(entry)}
              hitSlop={minimumHitSlop(rowHeight)}
              accessibilityRole="button"
              accessibilityLabel={`${entry.time}, ${entry.title}`}
              style={[styles.row, { height: rowHeight, gap: dp(10) }]}
              testID={`timeline-row-${entry.id}`}
            >
              <View
                style={{
                  width: dotSize,
                  height: dotSize,
                  borderRadius: dotSize / 2,
                  backgroundColor: entry.accent,
                }}
              />
              <HomeText
                token="time"
                color={neutralColors.textSecondary}
                numberOfLines={1}
                style={{ width: dp(LOCKED.today.timeWidth) }}
              >
                {entry.time}
              </HomeText>
              <HomeText
                token="activity"
                color={entry.accent}
                numberOfLines={1}
                style={styles.activity}
              >
                {entry.title}
              </HomeText>
              <AppIcon
                name={entry.icon}
                size={dp(LOCKED.today.trailingIcon)}
                color={entry.accent}
              />
            </PressableScale>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: neutralColors.surface,
    borderWidth: 1,
    borderColor: neutralColors.border,
    shadowColor: '#172033',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 1,
  },
  heading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headingTitle: {
    flexShrink: 1,
    minWidth: 0,
  },
  viewAll: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: neutralColors.divider,
  },
  rail: {
    position: 'absolute',
    backgroundColor: neutralColors.divider,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  activity: {
    flex: 1,
    minWidth: 0,
  },
});
