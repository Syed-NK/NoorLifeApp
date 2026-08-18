import { StyleSheet, View } from 'react-native';

import { AppIcon, PressableScale } from '@ds/components';
import { moduleThemes } from '@ds/modules/module-themes';
import { neutralColors } from '@ds/tokens';
import type { FrameworkModuleId } from '@features/modules/module-tokens';
import { useUpgradeSheetActions } from '@features/subscription/services/upgrade-sheet-context';
import { useModuleLock } from '@features/subscription/use-module-lock';
import type { QuickAction } from '@shared/models/dashboard';
import { minimumHitSlop } from '@shared/utils/a11y';

import { UPGRADE_SOURCES } from '../home-premium-surfaces';
import { LOCKED } from '../main-home-metrics';
import { useMetrics } from '../main-home-metrics-context';
import { LOCK_GLYPH } from '../module-lock-theme';
import { HomeLockBadge } from './home-lock-badge';
import { HomeText } from './home-text';

export type QuickActionsRowProps = {
  readonly actions: readonly QuickAction[];
  /** Receives the action, whose `sourceModule` determines the destination. */
  readonly onSelectAction: (action: QuickAction) => void;
  readonly testID?: string;
};

/**
 * Quick actions, locked by implementation-lock §12 and
 * 06-ai-quick-actions-reference.png.
 *
 * Locked geometry: three equal-width buttons, white background, a 1 dp border in
 * `neutralColors.border`, and an 18 dp icon over a 9.5/13 w500 label. Every measurement comes
 * from `LOCKED.quickAction` — height, radius, gap, paddings and the label's shrink allowance —
 * which the compact-layout correction lowered from the pack's original figures. No section
 * heading: the row sits directly above the bottom navigation.
 *
 * (The border is named by its token rather than its value, and the sizes by their tokens rather
 * than numbers that have already moved once: this file is on the reopened list, which is held to
 * sourcing every colour from a token rather than spelling one out, and the scan is textual — so
 * quoting a value in a comment would fail it too.)
 *
 * Each tile takes its colour from the module that owns the action — Add Task is
 * Planner, Log Wellness is Health, Family Check-in is Family — and navigates there.
 * Main Home never opens an editor of its own (workflow §5).
 *
 * The compact tile is 2 dp under the 44 dp touch minimum, so it carries hit-slop up to the floor.
 * The row's gap is wider than the slop it adds, so no tile's target reaches into its neighbour's.
 *
 * ── Phase 6B: all three actions belong to premium modules ───────────────────
 * Add Task is Planner, Log Wellness is Health, Family Check-in is Family — every one of them is a
 * paid module, so on a free plan all three are locked. Each keeps its exact width, height, radius,
 * border, position, approved icon *and* colours; a padlock appears at the upper right, and the press
 * raises the shared upgrade explanation instead of writing anything.
 *
 * ── Nothing is dimmed ───────────────────────────────────────────────────────
 * The icon used to render at 0.5 and the label at 0.85. On white that put the icons at 1.6–2.1:1,
 * under the 3:1 an indicator needs — and the approved module primaries have no headroom to give
 * back, health measuring 2.90:1 and finance 2.64:1 even at full strength. The label at 0.85 measured
 * 10.2:1, which passed, but it is the pair the device pass called "slightly too faded". Both are now
 * at full strength: 16.27:1 for the label, and the icon exactly as a paid user sees it. The padlock
 * carries the state, and it is a shape rather than a colour.
 *
 * ── Why the padlock is absolutely positioned, and at the top ────────────────
 * The row is nearly full: three 115.67 dp tiles, and "Family Check-in" at its locked type size
 * leaves only ~2 dp of slack either side of the icon-and-label pair. So an in-flow badge would take
 * width from the label and visibly re-flow all three, and one at the trailing edge would sit on top
 * of it. Out of flow at the tile's top edge it does neither: the content pair occupies the middle
 * ~18 dp of the 42 dp tile, leaving the top 12 dp free, which is exactly the padlock's height.
 * The label renders at precisely the size and position it does on a paid plan.
 *
 * ── Nothing runs before the user agrees ─────────────────────────────────────
 * A locked press never calls `onSelectAction`, so it neither navigates into the module nor starts an
 * edit. "Add Task" that silently opens Planner's composer and fails at the gate is worse than one
 * that explains itself; and the whole tile remains the target, so the 42 dp control keeps its full
 * area rather than the tap landing only on the badge.
 *
 * Lock state comes from `useModuleLock` against the action's own `sourceModule`, the same rule the
 * module route gate applies — so a quick action and its destination cannot disagree.
 */
export function QuickActionsRow({ actions, onSelectAction, testID }: QuickActionsRowProps) {
  const { dp } = useMetrics();

  return (
    <View style={[styles.row, { gap: dp(LOCKED.quickAction.gap) }]} testID={testID}>
      {actions.map((action) => (
        <QuickActionTile key={action.key} action={action} onSelectAction={onSelectAction} />
      ))}
    </View>
  );
}

type QuickActionTileProps = {
  readonly action: QuickAction;
  readonly onSelectAction: (action: QuickAction) => void;
};

/**
 * One quick action, in its entitled or locked state.
 *
 * Extracted so each tile can consult the entitlement selector with its own source module — hooks
 * cannot run inside the `map` above.
 *
 * The tile is never `disabled`: a disabled control announces "dimmed" with no way to find out why,
 * and cannot be reached by touch exploration. A locked action stays a full button whose accessible
 * name ends "…, Premium feature" and whose press explains itself.
 */
function QuickActionTile({ action, onSelectAction }: QuickActionTileProps) {
  const { dp } = useMetrics();
  const sourceTheme = moduleThemes[action.sourceModule];
  const { isLocked } = useModuleLock(action.sourceModule, sourceTheme.name);
  const { requestUpgrade } = useUpgradeSheetActions();

  return (
    <PressableScale
      onPress={() => {
        if (isLocked) {
          requestUpgrade({
            // The action the user tapped, not the module: the sheet should answer "why can't I add
            // a task?", which "Planner" on its own does not.
            featureTitle: action.label,
            // Locked implies premium, and `main` is never premium — so the narrowing is safe.
            moduleId: action.sourceModule as FrameworkModuleId,
            moduleName: sourceTheme.name,
            source: UPGRADE_SOURCES.quickAction,
          });
          return;
        }
        onSelectAction(action);
      }}
      hitSlop={minimumHitSlop(dp(LOCKED.quickAction.height))}
      accessibilityRole="button"
      // The restriction is part of the accessible name rather than a hint, so a screen reader
      // announces it in the same breath as the action — a hint is easily skipped.
      accessibilityLabel={isLocked ? `${action.label}, Premium feature` : action.label}
      accessibilityHint={
        isLocked ? 'Explains what NoorLife Premium includes' : `Opens ${sourceTheme.name}`
      }
      style={[
        styles.tile,
        {
          height: dp(LOCKED.quickAction.height),
          borderRadius: dp(LOCKED.quickAction.radius),
          paddingHorizontal: dp(LOCKED.quickAction.paddingHorizontal),
          gap: dp(LOCKED.quickAction.contentGap),
        },
      ]}
      testID={`quick-action-${action.key}`}
    >
      <AppIcon name={action.icon} size={dp(LOCKED.quickAction.icon)} color={sourceTheme.primary} />
      <HomeText
        token="quickActionLabel"
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={LOCKED.quickAction.minimumFontScale}
        style={styles.label}
      >
        {action.label}
      </HomeText>
      {/* Out of flow and above the content band, so the label keeps the exact width and position it
          has on a paid plan. Additional to the approved icon, never a replacement for it. */}
      {isLocked ? (
        <View style={[styles.lock, { top: dp(1), right: dp(2) }]} pointerEvents="none">
          <HomeLockBadge size={dp(LOCK_GLYPH)} testID={`quick-action-lock-${action.key}`} />
        </View>
      ) : null}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
  },
  tile: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
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
  label: {
    flexShrink: 1,
    minWidth: 0,
  },
  lock: {
    position: 'absolute',
  },
});
