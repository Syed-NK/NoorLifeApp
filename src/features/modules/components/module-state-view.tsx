import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppIcon, PressableScale } from '@ds/components';
import type { IconName } from '@shared/models/icon';

import { useModuleTheme } from '../module-context';
import { moduleLayout, moduleNeutrals } from '../module-tokens';
import { useModuleMetrics } from '../use-module-metrics';
import { ModuleText } from './module-text';

export type ModuleStateAction = {
  readonly label: string;
  readonly onPress: () => void;
};

export type ModuleStateViewProps = {
  readonly icon: IconName;
  readonly title: string;
  readonly body: string;
  /** Filled button in the module's colour. */
  readonly primaryAction?: ModuleStateAction;
  /** Text button beneath it, for the lesser option. */
  readonly secondaryAction?: ModuleStateAction;
  /** Extra content between the body and the actions. */
  readonly children?: ReactNode;
  /**
   * Announced to a screen reader when the state appears.
   *
   * Defaults to "title. body". Every state screen sets a live region, because a state
   * change that replaces the whole screen is precisely what a non-sighted user needs
   * told about.
   */
  readonly announcement?: string;
  readonly testID?: string;
};

/**
 * The shared body of every module state screen.
 *
 * Empty, error, offline and permission are the same composition — a marked icon, a
 * short title, an explanation, and at most two actions — differing only in tone and
 * copy. Building them on one component is what guarantees they cannot drift apart
 * visually, and that each of them keeps the accessibility behaviour: a role, a live
 * region, and a full-sentence announcement.
 *
 * Not exported from the feature's barrel: screens use the five named states, which
 * carry the correct icon and tone for their situation. Reaching for the base directly
 * would make it possible to build an "error" that looks like an empty state.
 */
export function ModuleStateView({
  icon,
  title,
  body,
  primaryAction,
  secondaryAction,
  children,
  announcement,
  testID,
}: ModuleStateViewProps) {
  const theme = useModuleTheme();
  const { dp } = useModuleMetrics();

  return (
    <View
      style={[styles.root, { paddingVertical: dp(24), rowGap: dp(10) }]}
      accessible
      accessibilityLiveRegion="polite"
      accessibilityLabel={announcement ?? `${title}. ${body}`}
      testID={testID}
    >
      <View
        style={[
          styles.iconWell,
          {
            width: dp(62),
            height: dp(62),
            borderRadius: dp(31),
            backgroundColor: theme.lightSurface,
            borderColor: theme.border,
            marginBottom: dp(4),
          },
        ]}
      >
        <AppIcon name={icon} size={dp(28)} color={theme.ink} />
      </View>

      <ModuleText token="stateTitle" align="center" numberOfLines={2}>
        {title}
      </ModuleText>
      <ModuleText token="stateBody" align="center" numberOfLines={4} style={styles.body}>
        {body}
      </ModuleText>

      {children}

      {primaryAction === undefined ? null : (
        <PressableScale
          onPress={primaryAction.onPress}
          accessibilityRole="button"
          accessibilityLabel={primaryAction.label}
          style={[
            styles.primary,
            {
              minHeight: dp(moduleLayout.minTouchTarget),
              borderRadius: dp(moduleLayout.radiusSmall),
              backgroundColor: theme.fill,
              paddingHorizontal: dp(18),
              marginTop: dp(4),
            },
          ]}
          testID={`${testID ?? 'module-state'}-primary`}
        >
          <ModuleText token="button" color={theme.onFill} numberOfLines={1}>
            {primaryAction.label}
          </ModuleText>
        </PressableScale>
      )}

      {secondaryAction === undefined ? null : (
        <PressableScale
          onPress={secondaryAction.onPress}
          accessibilityRole="button"
          accessibilityLabel={secondaryAction.label}
          style={[styles.secondary, { minHeight: dp(moduleLayout.minTouchTarget) }]}
          testID={`${testID ?? 'module-state'}-secondary`}
        >
          <ModuleText token="button" color={theme.ink} numberOfLines={1}>
            {secondaryAction.label}
          </ModuleText>
        </PressableScale>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWell: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  body: {
    maxWidth: 280,
  },
  primary: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondary: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    backgroundColor: moduleNeutrals.pageBackground,
  },
});
