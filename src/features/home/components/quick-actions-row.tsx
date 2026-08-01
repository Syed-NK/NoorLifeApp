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
import { LOCKED_CONTENT_OPACITY, LOCKED_LABEL_OPACITY } from '../module-lock-theme';
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
 * border, position and approved icon; the icon and label are muted, a small padlock appears at the
 * upper right, and the press raises the shared upgrade explanation instead of writing anything.
 *
 * ── Why the padlock is absolutely positioned ────────────────────────────────
 * The tile is 42 dp tall with a 5 dp horizontal padding and a label that already shrinks to fit —
 * adding a fourth item to the row would take width from "Family Check-in" and visibly re-flow all
 * three. Out of flow, the badge costs the layout nothing, and the label renders at exactly the size
 * it does on a paid plan.
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
      <AppIcon
        name={action.icon}
        size={dp(LOCKED.quickAction.icon)}
        color={sourceTheme.primary}
        style={{ opacity: isLocked ? LOCKED_CONTENT_OPACITY : 1 }}
      />
      <HomeText
        token="quickActionLabel"
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={LOCKED.quickAction.minimumFontScale}
        style={[styles.label, isLocked ? { opacity: LOCKED_LABEL_OPACITY } : null]}
      >
        {action.label}
      </HomeText>
      {/* Out of flow, so the label keeps the width it has on a paid plan. Additional to the
          approved icon, never a replacement for it. */}
      {isLocked ? (
        <View style={[styles.lock, { top: dp(3), right: dp(3) }]} pointerEvents="none">
          <HomeLockBadge size={dp(9)} testID={`quick-action-lock-${action.key}`} />
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
