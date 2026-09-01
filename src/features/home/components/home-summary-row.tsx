import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { AppIcon, PressableScale, ProgressRing } from '@ds/components';
import { moduleThemes } from '@ds/modules/module-themes';
import { neutralColors, radius, semanticColors } from '@ds/tokens';
import { useUpgradeSheetActions } from '@features/subscription/services/upgrade-sheet-context';
import { usePaidContentLock } from '@features/subscription/use-module-lock';
import type { FamilyCheckInSummary, OverallProgressSummary } from '@shared/models/dashboard';
import { minimumHitSlop, minimumTouchTargetSize } from '@shared/utils/a11y';

import { UPGRADE_SOURCES } from '../home-premium-surfaces';
import { LOCKED } from '../main-home-metrics';
import { useMetrics } from '../main-home-metrics-context';
import { LOCK_GLYPH } from '../module-lock-theme';
import { HomeLockBadge } from './home-lock-badge';
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
 * padding. Family: 20 dp `account-group` in the Family primary, title 11/15 w600,
 * value 19/24 w600, 4 dp progress bar. Progress: 54 dp ring with a 7 dp stroke,
 * value 22/27 w600, supporting text 9.5/13.
 *
 * §10 is explicit that titles may not truncate, and that the remedy is a smaller
 * title rather than a narrower card — hence the locked 11 dp title with the value,
 * not the heading, carrying the visual weight. `View All` is the global primary in
 * both cards, per §9 and the crop.
 *
 * Both values are stated as text beside their indicator, so neither depends on the
 * bar or the arc alone (design spec §8).
 *
 * ── Phase 6B: paid metrics are not shown to a user who has not paid ─────────
 * Both figures are paid content. For a free user — and for a user whose entitlement has not
 * resolved yet — the cards keep their exact dimensions, position and type ramp but state plainly
 * that the content is Premium instead of showing a number.
 *
 * The rule this implements is that a locked card may not *fake* data. "4 of 5", "68%", "You're on
 * track", a part-filled bar and a part-swept ring are all claims about a real user's real week, and
 * a free user has no such week to report. So the bar is drawn empty with no `progressbar` role, and
 * the ring becomes a plain neutral circle at the same 46 dp diameter and 6 dp stroke — same
 * footprint, no implied percentage, nothing for a screen reader to read a value from.
 *
 * `View All` is not rendered on a locked card. It would be an invitation into a module the user
 * cannot open; the whole card is the affordance instead, and the lock badge takes its place so the
 * heading row keeps its shape.
 *
 * The answer comes from `usePaidContentLock`, the shared `canAccessModule` selector — not from a
 * plan check written into this file.
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
  const { isLocked } = usePaidContentLock();
  const { requestUpgrade } = useUpgradeSheetActions();

  const checkInPercentage =
    familyCheckIn.total === 0 ? 0 : (familyCheckIn.completed / familyCheckIn.total) * 100;

  const cardStyle = [
    styles.card,
    {
      /*
        A floor, not a fixed height — issue #141. Main Home now honours the OS text size, and a fixed
        height here clipped the scaled figure inside a card that could not grow instead of letting the
        column grow and the screen scroll. At 1.0 the content is shorter than the locked height, so the
        floor still decides and the reference geometry is unchanged.
      */
      minHeight: dp(LOCKED.summary.height),
      borderRadius: dp(LOCKED.summary.radius),
      padding: dp(LOCKED.summary.padding),
    },
  ];

  const ring = dp(LOCKED.summary.ring);

  return (
    <View style={[styles.row, { gap: dp(LOCKED.summary.gap) }]} testID={testID}>
      <SummaryCard
        locked={isLocked}
        cardStyle={cardStyle}
        accessibilityLabel="Family Check-in, Premium feature"
        onPressLocked={() =>
          requestUpgrade({
            featureTitle: 'Family Check-in',
            moduleId: 'family',
            moduleName: 'Family',
            source: UPGRADE_SOURCES.homeSummary,
          })
        }
        testID="family-check-in-card"
      >
        <View style={styles.headingRow}>
          <AppIcon name="family" size={dp(16)} color={familyTheme.primary} />
          {/*
            Two lines since #148. `Family Check-in` fitted while Main Home suppressed font scaling;
            once #141 restored it the half-width heading drew `Family Check…` at a 1.5 text scale.
            §10 forbids truncating a locked label, and the card carries `minHeight` rather than a
            fixed height, so the line has somewhere to go.
          */}
          <HomeText token="summaryTitle" numberOfLines={2} style={styles.headingTitle}>
            Family Check-in
          </HomeText>
          {isLocked ? (
            <HomeLockBadge size={dp(LOCK_GLYPH)} testID="family-check-in-lock" />
          ) : (
            <ViewAll onPress={onViewFamily} label="Family check-in" hitSize={dp(20)} />
          )}
        </View>

        <HomeText token="summaryValue" numberOfLines={1}>
          {isLocked ? 'Premium' : `${familyCheckIn.completed} of ${familyCheckIn.total}`}
        </HomeText>
        {/*
          Two, which is what the same role already gets on the card beside it — `Included with
          Premium` has wrapped there all along. This one was pinned to one line and drew
          `Unlock family conne…` at 1.5 once #141 restored scaling.
        */}
        <HomeText token="progressSupport" color={neutralColors.textSecondary} numberOfLines={2}>
          {isLocked ? 'Unlock family connection' : familyCheckIn.statusLabel}
        </HomeText>

        {isLocked ? (
          // The track alone: same height, same position, no fill and no `progressbar` role, so
          // nothing here reports a completion figure the user has not earned.
          <View
            style={[
              styles.track,
              { height: dp(LOCKED.summary.progressBarHeight), marginTop: 'auto' },
            ]}
            testID="family-check-in-locked-track"
          />
        ) : (
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
        )}
      </SummaryCard>

      <SummaryCard
        locked={isLocked}
        cardStyle={cardStyle}
        accessibilityLabel="Overall Progress, Premium feature"
        onPressLocked={() =>
          requestUpgrade({
            featureTitle: 'Overall Progress',
            moduleId: 'goals',
            moduleName: 'Goals',
            source: UPGRADE_SOURCES.homeSummary,
          })
        }
        testID="overall-progress-card"
      >
        <View style={styles.headingRow}>
          {/* The same role as the card beside it, so the same allowance — see #148. */}
          <HomeText token="summaryTitle" numberOfLines={2} style={styles.headingTitle}>
            Overall Progress
          </HomeText>
          {isLocked ? (
            <HomeLockBadge size={dp(LOCK_GLYPH)} testID="overall-progress-lock" />
          ) : (
            <ViewAll onPress={onViewProgress} label="Overall progress" hitSize={dp(20)} />
          )}
        </View>

        <View style={[styles.progressRow, { gap: dp(10) }]}>
          {isLocked ? (
            // A neutral circle at the ring's exact diameter and stroke. Not a ProgressRing at zero:
            // that would still announce itself as a progress bar reading nought per cent, which is
            // a figure about the user rather than an absence of one.
            <View
              style={{
                width: ring,
                height: ring,
                borderRadius: ring / 2,
                borderWidth: dp(LOCKED.summary.ringStroke),
                borderColor: neutralColors.surfaceSoft,
              }}
              testID="overall-progress-locked-ring"
            />
          ) : (
            <ProgressRing
              progress={overallProgress.percentage}
              size={ring}
              thickness={dp(LOCKED.summary.ringStroke)}
              color={goalsTheme.primary}
              accessibilityLabel={`Overall progress ${overallProgress.percentage} percent, ${overallProgress.statusLabel}`}
              testID="overall-progress-ring"
            />
          )}
          <View style={styles.progressText}>
            {/* The locked wording is longer than "68%" and the column is fixed, so it shrinks to
                fit rather than ellipsising — §10 forbids truncating, not resizing. */}
            <HomeText
              token="progressValue"
              numberOfLines={1}
              adjustsFontSizeToFit={isLocked}
              minimumFontScale={0.55}
            >
              {isLocked ? 'Unlock progress' : `${overallProgress.percentage}%`}
            </HomeText>
            <HomeText
              token="progressSupport"
              color={isLocked ? neutralColors.textSecondary : goalsTheme.primary}
              numberOfLines={2}
            >
              {isLocked ? 'Included with Premium' : overallProgress.statusLabel}
            </HomeText>
          </View>
        </View>
      </SummaryCard>
    </View>
  );
}

type SummaryCardProps = {
  readonly locked: boolean;
  readonly cardStyle: StyleProp<ViewStyle>;
  /** Announced only when locked; the unlocked card is a container, not a control. */
  readonly accessibilityLabel: string;
  readonly onPressLocked: () => void;
  readonly testID: string;
  readonly children: React.ReactNode;
};

/**
 * The card shell, identical in both states.
 *
 * Locked, the whole card becomes the button — a free user has no `View All` to aim at, and a lock
 * badge is too small a target on its own. The style, the height and the testID are the same either
 * way, so nothing about the card's geometry depends on entitlement.
 *
 * The card is never `disabled`: it stays focusable and its accessible name ends "…, Premium
 * feature", which is what tells the user why it looks different.
 */
function SummaryCard({
  locked,
  cardStyle,
  accessibilityLabel,
  onPressLocked,
  testID,
  children,
}: SummaryCardProps) {
  if (!locked) {
    return (
      <View style={cardStyle} testID={testID}>
        {children}
      </View>
    );
  }

  return (
    <PressableScale
      onPress={onPressLocked}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint="Explains what NoorLife Premium includes"
      style={cardStyle}
      testID={testID}
    >
      {children}
    </PressableScale>
  );
}

/** The shared `View All` affordance: 11/16 w500 in the global primary, 44 dp touch area. */
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
      style={[
        styles.viewAll,
        {
          minWidth: minimumTouchTargetSize(),
          minHeight: minimumTouchTargetSize(),
          alignItems: 'center',
          justifyContent: 'center',
        },
      ]}
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
    // The token, not the literal it replaced. Same value, so no visual change — but this file is
    // now on the reopened list, which is held to sourcing every colour from a token rather than
    // spelling one out. (The scan is textual, so naming the old value here would fail it too.)
    shadowColor: neutralColors.textPrimary,
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
