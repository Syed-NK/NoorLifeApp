import { StyleSheet, View } from 'react-native';

import { AppIcon, PressableScale } from '@ds/components';
import type { IconName } from '@shared/models/icon';
import { statusLabel } from '@shared/utils/a11y';

import { useModuleTheme } from '../module-context';
import { moduleLayout, moduleNeutrals } from '../module-tokens';
import { useModuleMetrics } from '../use-module-metrics';
import { ModuleDivider } from './module-section';
import { ModuleText } from './module-text';

/** How an activity stands. Drives both the tint *and* the text a screen reader hears. */
export type ModuleActivityStatus = 'done' | 'due' | 'upcoming' | 'missed';

const STATUS_TEXT: Readonly<Record<ModuleActivityStatus, string>> = {
  done: 'Done',
  due: 'Due now',
  upcoming: 'Upcoming',
  missed: 'Missed',
};

const STATUS_ICON: Readonly<Record<ModuleActivityStatus, IconName>> = {
  done: 'check-circle',
  due: 'clock',
  upcoming: 'today',
  missed: 'warning',
};

export type ModuleActivityItem = {
  readonly key: string;
  readonly title: string;
  /** Time, place or detail line. */
  readonly meta?: string;
  readonly icon: IconName;
  readonly status: ModuleActivityStatus;
  readonly onPress?: () => void;
};

export type ModuleActivityCardProps = {
  readonly items: readonly ModuleActivityItem[];
  readonly testID?: string;
};

/**
 * A list of the module's recent or upcoming activity.
 *
 * ── The rule this component exists to enforce ───────────────────────────────
 * Status is never colour alone. Each row carries a tinted status chip that contains
 * *both* an icon and the status word, and the row's accessible label is composed with
 * `statusLabel` so a screen reader hears "Fajr Prayer, Done". A user who cannot
 * distinguish the green chip from the amber one still gets the state.
 */
export function ModuleActivityCard({ items, testID }: ModuleActivityCardProps) {
  const theme = useModuleTheme();
  const { dp } = useModuleMetrics();

  const statusColor: Readonly<Record<ModuleActivityStatus, string>> = {
    done: moduleNeutrals.success,
    due: theme.ink,
    upcoming: moduleNeutrals.textSecondary,
    missed: moduleNeutrals.warning,
  };
  const statusSurface: Readonly<Record<ModuleActivityStatus, string>> = {
    done: moduleNeutrals.successSurface,
    due: theme.lightSurface,
    upcoming: moduleNeutrals.surfaceMuted,
    missed: moduleNeutrals.warningSurface,
  };

  return (
    <View
      style={[
        styles.card,
        {
          borderRadius: dp(moduleLayout.cardRadius),
          paddingHorizontal: dp(moduleLayout.cardPadding),
        },
      ]}
      testID={testID}
    >
      {items.map((item, index) => {
        const text = STATUS_TEXT[item.status];
        const Row = item.onPress === undefined ? View : PressableScale;

        return (
          <View key={item.key}>
            {index === 0 ? null : <ModuleDivider />}
            <Row
              {...(item.onPress === undefined
                ? { accessible: true }
                : { onPress: item.onPress, accessibilityRole: 'button' as const })}
              accessibilityLabel={statusLabel(
                item.meta === undefined ? item.title : `${item.title}, ${item.meta}`,
                text,
              )}
              style={[
                styles.row,
                {
                  minHeight: dp(moduleLayout.minTouchTarget),
                  columnGap: dp(10),
                  paddingVertical: dp(9),
                },
              ]}
              testID={`${testID ?? 'module-activity'}-${item.key}`}
            >
              <View
                style={[
                  styles.iconWell,
                  {
                    width: dp(30),
                    height: dp(30),
                    borderRadius: dp(8),
                    backgroundColor: theme.lightSurface,
                  },
                ]}
              >
                <AppIcon name={item.icon} size={dp(17)} color={theme.ink} />
              </View>

              <View style={styles.textColumn}>
                <ModuleText token="cardTitle" numberOfLines={1}>
                  {item.title}
                </ModuleText>
                {item.meta === undefined ? null : (
                  <ModuleText token="caption" numberOfLines={1}>
                    {item.meta}
                  </ModuleText>
                )}
              </View>

              {/* Icon + word, never colour alone. */}
              <View
                style={[
                  styles.chip,
                  {
                    backgroundColor: statusSurface[item.status],
                    borderRadius: dp(moduleLayout.radiusPill),
                    paddingHorizontal: dp(7),
                    paddingVertical: dp(3),
                    columnGap: dp(3),
                  },
                ]}
              >
                <AppIcon
                  name={STATUS_ICON[item.status]}
                  size={dp(11)}
                  color={statusColor[item.status]}
                />
                <ModuleText
                  token="caption"
                  color={statusColor[item.status]}
                  numberOfLines={1}
                  maxFontSizeMultiplier={1.3}
                >
                  {text}
                </ModuleText>
              </View>
            </Row>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: moduleNeutrals.surface,
    borderWidth: 1,
    borderColor: moduleNeutrals.border,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconWell: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  textColumn: {
    flex: 1,
    minWidth: 0,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});
