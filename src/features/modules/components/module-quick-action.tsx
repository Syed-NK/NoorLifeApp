import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { AppIcon, PressableScale } from '@ds/components';

import { useModule, useModuleTheme } from '../module-context';
import type { ModuleQuickActionSpec } from '../module-definition';
import { moduleLayout, moduleNeutrals } from '../module-tokens';
import { useModuleMetrics } from '../use-module-metrics';
import { ModuleText } from './module-text';

export type ModuleQuickActionProps = {
  readonly action: ModuleQuickActionSpec;
  readonly onPress?: () => void;
  readonly testID?: string;
};

/**
 * One quick action.
 *
 * A 62 dp card holding an icon and a label. The label is `numberOfLines={2}` rather
 * than one: Main Home's review specifically rejected truncated quick-action labels,
 * and "Ask Faith AI" does not fit one line in a third of the content width.
 *
 * ── Why the icon well and gaps are as tight as they are ─────────────────────
 * At one third of a 393 dp column there are about 66 dp for text. The first build spent
 * 30 dp on the icon well and 8 dp on the gap, leaving ~56 dp — and "Memories" needs
 * ~50 dp plus bearing, so on the Pixel 8 it broke mid-word as "Memorie / s". React
 * Native breaks inside a word when the word cannot fit, so the fix is room, not a
 * shorter label: the registry's copy is the product's copy, and trimming it to suit the
 * layout would be the wrong way round.
 */
export function ModuleQuickAction({ action, onPress, testID }: ModuleQuickActionProps) {
  const router = useRouter();
  const theme = useModuleTheme();
  const { dp } = useModuleMetrics();

  return (
    <PressableScale
      onPress={
        onPress ??
        (() => {
          if (action.href !== undefined) {
            router.push(action.href);
          }
        })
      }
      accessibilityRole="button"
      accessibilityLabel={action.accessibilityLabel ?? action.label}
      style={[
        styles.card,
        {
          minHeight: dp(moduleLayout.quickActionHeight),
          borderRadius: dp(moduleLayout.radiusSmall),
          borderColor: moduleNeutrals.border,
          columnGap: dp(6),
          paddingHorizontal: dp(8),
          paddingVertical: dp(8),
        },
      ]}
      testID={testID}
    >
      <View
        style={[
          styles.iconWell,
          {
            width: dp(26),
            height: dp(26),
            borderRadius: dp(13),
            backgroundColor: theme.lightSurface,
          },
        ]}
      >
        <AppIcon name={action.icon} size={dp(moduleLayout.quickActionIcon * 0.75)} color={theme.ink} />
      </View>
      <ModuleText token="quickAction" numberOfLines={2} style={styles.label}>
        {action.label}
      </ModuleText>
    </PressableScale>
  );
}

export type ModuleQuickActionRowProps = {
  /** Defaults to the module's own quick actions. */
  readonly actions?: readonly ModuleQuickActionSpec[];
  readonly onSelect?: (action: ModuleQuickActionSpec) => void;
  readonly testID?: string;
};

/** The quick-action row beneath the hero. Equal-width cards, so none dominates. */
export function ModuleQuickActionRow({ actions, onSelect, testID }: ModuleQuickActionRowProps) {
  const module = useModule();
  const { dp } = useModuleMetrics();
  const items = actions ?? module.quickActions;
  const prefix = testID ?? `${module.id}-quick`;

  return (
    <View style={[styles.row, { columnGap: dp(moduleLayout.cardGap) }]} testID={testID}>
      {items.map((action) => (
        <View key={action.key} style={styles.rowItem}>
          <ModuleQuickAction
            action={action}
            onPress={onSelect === undefined ? undefined : () => onSelect(action)}
            testID={`${prefix}-${action.key}`}
          />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: moduleNeutrals.surface,
    borderWidth: 1,
  },
  iconWell: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    flex: 1,
    minWidth: 0,
  },
  row: {
    flexDirection: 'row',
  },
  rowItem: {
    flex: 1,
    minWidth: 0,
  },
});
