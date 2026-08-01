import { StyleSheet, View } from 'react-native';

import { AppIcon, PressableScale, StateView } from '@ds/components';
import { moduleThemes } from '@ds/modules/module-themes';
import { neutralColors, semanticColors } from '@ds/tokens';
import type { FrameworkModuleId } from '@features/modules/module-tokens';
import { useUpgradeSheetActions } from '@features/subscription/services/upgrade-sheet-context';
import { useModuleLock } from '@features/subscription/use-module-lock';
import type { TimelineEntry } from '@shared/models/dashboard';
import type { ModuleTheme } from '@shared/models/module-theme';
import { minimumHitSlop } from '@shared/utils/a11y';
import { forwardChevron } from '@shared/utils/rtl';

import { LOCKED } from '../main-home-metrics';
import { useMetrics } from '../main-home-metrics-context';
import { LOCKED_CONTENT_OPACITY, LOCKED_LABEL_OPACITY } from '../module-lock-theme';
import { HomeLockBadge } from './home-lock-badge';
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
 * vertical padding, 1 dp border in `neutralColors.border`. A 22 dp heading (title 14/18
 * w600, `View All` 10/13 in `semanticColors.primary`) over four 23 dp rows, each with a
 * 7 dp dot on a 2 dp rail, a 62 dp time column at 10/13, a 10/13 activity label and a
 * 15 dp trailing icon.
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
 *
 * ── Phase 6B: entitlement states inside the locked geometry ─────────────────
 * A row whose source module needs a subscription the user does not hold stays exactly where it is,
 * at exactly its height, with its own semantic accent. What changes is that the dot and trailing
 * icon are muted, a small padlock joins the row, and the tap opens the shared upgrade explanation
 * instead of the module. Nothing is removed, nothing is disabled, and no row's geometry moves.
 *
 * Which rows those are is not written here. `useModuleLock` answers per entry from the entry's own
 * `sourceModule`, through the same `canAccessModule` rule the route gate applies — so Dhuhr stays
 * open because Faith is never premium, not because this file knows it is a prayer.
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
            <TimelineRow
              key={entry.id}
              entry={entry}
              rowHeight={rowHeight}
              dotSize={dotSize}
              onSelectEntry={onSelectEntry}
            />
          ))}
        </View>
      )}
    </View>
  );
}

type TimelineRowProps = {
  readonly entry: TimelineEntry;
  readonly rowHeight: number;
  readonly dotSize: number;
  readonly onSelectEntry: (entry: TimelineEntry) => void;
};

/**
 * One row, in its entitled or locked state.
 *
 * Extracted so each row can consult the entitlement selector with its own source module — hooks
 * cannot run inside the `map` above.
 *
 * ── The locked tap never enters the module ──────────────────────────────────
 * It raises the shared upgrade explanation and stops. Pushing Planner and letting its own gate
 * bounce the user back would flash a screen they are not entitled to and leave it in the back
 * stack, which is both worse to use and a weaker guarantee than never going there.
 *
 * ── The row is not disabled ─────────────────────────────────────────────────
 * A disabled control is unreachable by keyboard and touch exploration, and announces "dimmed" with
 * no way to find out why. A locked row stays a full, focusable button whose accessible name ends
 * "…, Premium feature" and whose press explains itself.
 */
function TimelineRow({ entry, rowHeight, dotSize, onSelectEntry }: TimelineRowProps) {
  const { dp } = useMetrics();
  const moduleName = moduleThemes[entry.sourceModule].name;
  const { isLocked } = useModuleLock(entry.sourceModule, moduleName);
  const { requestUpgrade } = useUpgradeSheetActions();

  // The restriction is part of the accessible name rather than a hint, so a screen reader
  // announces it in the same breath as the activity — a hint is easily skipped.
  const accessibilityLabel = isLocked
    ? `${entry.time}, ${entry.title}, Premium feature`
    : `${entry.time}, ${entry.title}`;

  return (
    <PressableScale
      onPress={() => {
        if (isLocked) {
          requestUpgrade({
            // The feature the user actually tapped, not the module that owns it: the sheet should
            // answer "why can't I open School drop-off?", which "Planner" alone does not.
            featureTitle: entry.title,
            // Locked implies premium, and `main` is never premium — so the narrowing is safe.
            moduleId: entry.sourceModule as FrameworkModuleId,
            moduleName,
            source: 'today_timeline',
          });
          return;
        }
        onSelectEntry(entry);
      }}
      hitSlop={minimumHitSlop(rowHeight)}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      {...(isLocked ? { accessibilityHint: 'Explains what NoorLife Premium includes' } : {})}
      style={[styles.row, { height: rowHeight, gap: dp(10) }]}
      testID={`timeline-row-${entry.id}`}
    >
      <View
        style={{
          width: dotSize,
          height: dotSize,
          borderRadius: dotSize / 2,
          backgroundColor: entry.accent,
          opacity: isLocked ? LOCKED_CONTENT_OPACITY : 1,
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
        style={[styles.activity, isLocked ? { opacity: LOCKED_LABEL_OPACITY } : null]}
      >
        {entry.title}
      </HomeText>
      {/* Additional to the trailing icon below, never a replacement for it. */}
      {isLocked ? <HomeLockBadge size={dp(11)} testID={`timeline-lock-${entry.id}`} /> : null}
      <AppIcon
        name={entry.icon}
        size={dp(LOCKED.today.trailingIcon)}
        color={entry.accent}
        style={{ opacity: isLocked ? LOCKED_CONTENT_OPACITY : 1 }}
      />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: neutralColors.surface,
    borderWidth: 1,
    borderColor: neutralColors.border,
    // The token, not the literal it replaced. Same value, so no visual change — but this file is
    // now on the reopened list, which is held to sourcing every colour from a token rather than
    // spelling one out. (The scan is textual, so naming the old value here would fail it too.)
    shadowColor: neutralColors.textPrimary,
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
