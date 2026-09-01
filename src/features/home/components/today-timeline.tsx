import { StyleSheet, View } from 'react-native';

import { AppIcon, PressableScale, StateView } from '@ds/components';
import { moduleThemes } from '@ds/modules/module-themes';
import { neutralColors, semanticColors } from '@ds/tokens';
import type { FrameworkModuleId } from '@features/modules/module-tokens';
import { useUpgradeSheetActions } from '@features/subscription/services/upgrade-sheet-context';
import { useModuleLock } from '@features/subscription/use-module-lock';
import type { TimelineEntry } from '@shared/models/dashboard';
import type { ModuleTheme } from '@shared/models/module-theme';
import { minimumHitSlop, minimumTouchTargetSize } from '@shared/utils/a11y';
import { forwardChevron } from '@shared/utils/rtl';

import { UPGRADE_SOURCES } from '../home-premium-surfaces';
import { LOCKED } from '../main-home-metrics';
import { useMetrics } from '../main-home-metrics-context';
import { LOCK_GLYPH, LOCK_GLYPH_COMPACT } from '../module-lock-theme';
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
 *
 * ── "View All" is the whole section's destination, and it is Planner ─────────
 * The heading's `View All` opens Planner's full day. On a free plan it therefore behaves like a
 * locked row: it raises the shared upgrade explanation, naming Planner, and Planner is never pushed.
 * Planner's own route gate stays in place behind all of this as defence in depth.
 *
 * It says so visibly. The first attempt left it looking exactly like the paid control, on the
 * argument that nothing was muted so nothing needed backing up — which the device pass rejected for
 * the obvious reason: a control that looks like a live link and then explains why it is not is a
 * small betrayal every time. Locked, the label steps from the global primary to secondary ink
 * (4.97:1, comfortably readable) and the forward chevron is replaced by the padlock. The chevron is
 * the right thing to give up: it promises forward navigation, which is precisely what this press does
 * not do. Position, type token and touch target are unchanged, and swapping a 12 dp chevron for an
 * 11 dp padlock keeps the heading's width where it was, so the title beside it cannot reflow.
 */
export function TodayTimeline({
  entries,
  theme,
  onViewAll,
  onSelectEntry,
  testID,
}: TodayTimelineProps) {
  const { dp } = useMetrics();
  const plannerName = moduleThemes.planner.name;
  const { isLocked: isPlannerLocked } = useModuleLock('planner', plannerName);
  const { requestUpgrade } = useUpgradeSheetActions();

  const rowHeight = dp(LOCKED.today.rowHeight);
  const dotSize = dp(LOCKED.today.dot);
  const lineWidth = dp(LOCKED.today.line);

  return (
    <View
      style={[
        styles.card,
        {
          /*
            A minimum, not a fixed height — issue 115.

            The card was tall enough for three rows at their old 23 dp. At the 44 dp floor those
            rows no longer fit, and the last one was clipped to 8.381 dp on device. The locked
            value stays as the card the design drew; what changes is that accessible rows may
            push it taller rather than being cut off inside it.
          */
          minHeight: dp(LOCKED.today.cardHeight),
          borderRadius: dp(LOCKED.today.cardRadius),
          paddingHorizontal: dp(LOCKED.today.paddingHorizontal),
          paddingVertical: dp(LOCKED.today.paddingVertical),
        },
      ]}
      testID={testID}
    >
      {/*
        Also a minimum — issue 115. View All sits in this row, and a fixed heading height held it
        at 40.000 dp and pushed its box down over the first timeline row, which measured as two
        overlapping targets.
      */}
      <View style={[styles.heading, { minHeight: dp(LOCKED.today.headingHeight) }]}>
        <HomeText token="sectionTitle" numberOfLines={1} style={styles.headingTitle}>
          Today at a Glance
        </HomeText>
        <PressableScale
          onPress={() => {
            if (isPlannerLocked) {
              requestUpgrade({
                // The section the user was looking at, not the module — the sheet has to answer
                // "why can't I see all of today?".
                featureTitle: 'Today at a Glance',
                moduleId: 'planner',
                moduleName: plannerName,
                source: UPGRADE_SOURCES.todayTimelineViewAll,
              });
              return;
            }
            onViewAll();
          }}
          hitSlop={minimumHitSlop(dp(LOCKED.today.headingHeight))}
          accessibilityRole="button"
          accessibilityLabel={
            isPlannerLocked
              ? 'View all Planner activities, Premium feature'
              : "View all of today's schedule"
          }
          {...(isPlannerLocked
            ? { accessibilityHint: 'Explains what NoorLife Premium includes' }
            : {})}
          style={[
            styles.viewAll,
            {
              minWidth: minimumTouchTargetSize(),
              minHeight: minimumTouchTargetSize(),
              alignItems: 'center',
              justifyContent: 'center',
            },
          ]}
          testID={`${testID ?? 'today'}-view-all`}
        >
          {/* Lock §9: View All is the global primary, not a module colour — until it is locked, when
              secondary ink says "not a live link" without dropping below 4.5:1. */}
          <HomeText
            token="viewAll"
            color={isPlannerLocked ? neutralColors.textSecondary : semanticColors.primary}
            numberOfLines={1}
          >
            View All
          </HomeText>
          {isPlannerLocked ? (
            <HomeLockBadge
              size={dp(LOCK_GLYPH_COMPACT)}
              testID={`${testID ?? 'today'}-view-all-lock`}
            />
          ) : (
            <AppIcon name={forwardChevron()} size={dp(12)} color={semanticColors.primary} />
          )}
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
 *
 * ── And it is not dimmed either, any more ───────────────────────────────────
 * The dot, the label and the trailing icon used to be multiplied by 0.5 and 0.85. Measured against
 * the white card that put the dots at 1.6–2.1:1 and the finance-accented label at 2.26:1 — and the
 * approved accents have no headroom to give, since finance already measures 2.64:1 at full strength.
 * So the row now renders in exactly the colours its unlocked counterpart does, the semantic accent
 * intact, and the padlock alone says "locked". The state was never safe to carry in a colour.
 */
function TimelineRow({ entry, rowHeight, dotSize, onSelectEntry }: TimelineRowProps) {
  const { dp } = useMetrics();
  const moduleName = moduleThemes[entry.sourceModule].name;
  const { isLocked } = useModuleLock(entry.sourceModule, moduleName);
  const { requestUpgrade } = useUpgradeSheetActions();

  /*
    The restriction is part of the accessible name rather than a hint, so a screen reader announces it
    in the same breath as the activity — a hint is easily skipped.

    An empty `time` is dropped rather than read. The live prayer row has no time while the calculation
    is running and none at all when there is no location, and its title is then an instruction — "Set
    your location to see prayer times". Joining a blank time onto that produced a leading comma, which
    a screen reader renders as a pause before the sentence or, with an em dash in its place, as the
    word "dash". Filtering is layout-neutral: the visible time column is unaffected.
  */
  const accessibilityLabel = [entry.time, entry.title, isLocked ? 'Premium feature' : null]
    .filter((part): part is string => typeof part === 'string' && part.length > 0)
    .join(', ');

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
            source: UPGRADE_SOURCES.todayTimeline,
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
      {/*
        Two lines since #148. `Nothing planned for today` drew `Nothing planned for tod…` at a 1.5
        text scale once #141 restored scaling — the label's box is capped by the row it shares with
        the time, the lock badge and the trailing icon, so the glyphs grew and the box did not.
      */}
      <HomeText token="activity" color={entry.accent} numberOfLines={2} style={styles.activity}>
        {entry.title}
      </HomeText>
      {/* Additional to the trailing icon below, never a replacement for it. */}
      {isLocked ? (
        <HomeLockBadge size={dp(LOCK_GLYPH)} testID={`timeline-lock-${entry.id}`} />
      ) : null}
      <AppIcon name={entry.icon} size={dp(LOCKED.today.trailingIcon)} color={entry.accent} />
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
