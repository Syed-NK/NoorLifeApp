import { StyleSheet, View } from 'react-native';

import { AppIcon, PressableScale } from '@ds/components';
import { moduleThemes } from '@ds/modules/module-themes';
import { neutralColors } from '@ds/tokens';
import type { QuickAction } from '@shared/models/dashboard';

import { LOCKED } from '../main-home-metrics';
import { useMetrics } from '../main-home-metrics-context';
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
 * Locked geometry: three equal-width buttons, 8 dp gap, 46 dp tall, 12 dp radius,
 * white background, 1 dp `#E2E6EC` border, 18 dp icon, label 9.5/13 w500. No section
 * heading — the row sits directly above the bottom navigation.
 *
 * Each tile takes its colour from the module that owns the action — Add Task is
 * Planner, Log Wellness is Health, Family Check-in is Family — and navigates there.
 * Main Home never opens an editor of its own (workflow §5).
 *
 * The 46 dp height sits above the 44 dp touch minimum, so the compact row needs no
 * hit-slop.
 */
export function QuickActionsRow({ actions, onSelectAction, testID }: QuickActionsRowProps) {
  const { dp } = useMetrics();

  return (
    <View style={[styles.row, { gap: dp(LOCKED.quickAction.gap) }]} testID={testID}>
      {actions.map((action) => {
        const sourceTheme = moduleThemes[action.sourceModule];
        return (
          <PressableScale
            key={action.key}
            onPress={() => onSelectAction(action)}
            accessibilityRole="button"
            accessibilityLabel={action.label}
            accessibilityHint={`Opens ${sourceTheme.name}`}
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
            />
            <HomeText
              token="quickActionLabel"
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={LOCKED.quickAction.minimumFontScale}
              style={styles.label}
            >
              {action.label}
            </HomeText>
          </PressableScale>
        );
      })}
    </View>
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
    shadowColor: '#172033',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 1,
  },
  label: {
    flexShrink: 1,
    minWidth: 0,
  },
});
