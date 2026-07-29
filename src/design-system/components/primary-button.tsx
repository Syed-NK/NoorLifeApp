import { ActivityIndicator, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { AppText } from '@ds/typography/app-text';
import { AppIcon } from './app-icon';
import { PressableScale } from './pressable-scale';

import {
  elementSize,
  iconSize,
  neutralColors,
  radius,
  semanticColors,
  spacing,
  touchTarget,
} from '@ds/tokens';
import type { IconName } from '@shared/models/icon';

export type PrimaryButtonProps = {
  readonly label: string;
  readonly onPress: () => void;
  readonly icon?: IconName;
  /**
   * Fill colour. Defaults to the global `primary`. Inside a module, pass the
   * module primary so the button matches the active theme (§1.3).
   */
  readonly color?: string;
  /** Label/icon colour. Defaults to white. */
  readonly textColor?: string;
  readonly disabled?: boolean;
  readonly loading?: boolean;
  /** Stretches to the container width. Default `false`. */
  readonly fullWidth?: boolean;
  /** `auth` renders the 52 px equal-height variant from §01–§03. */
  readonly size?: 'default' | 'auth';
  readonly accessibilityHint?: string;
  readonly style?: StyleProp<ViewStyle>;
  readonly testID?: string;
};

/**
 * The primary call to action.
 *
 * Height is 48 px by default (52 px for the auth variant), both above the 44 px
 * minimum touch target. Radius is the 12 px control radius (§2.5).
 *
 * While `loading`, the button is disabled and announces a busy state, so a
 * double submit is impossible and the change is not signalled by colour alone.
 */
export function PrimaryButton({
  label,
  onPress,
  icon,
  color = semanticColors.primary,
  textColor = neutralColors.surface,
  disabled = false,
  loading = false,
  fullWidth = false,
  size = 'default',
  accessibilityHint,
  style,
  testID,
}: PrimaryButtonProps) {
  const isInactive = disabled || loading;
  const height = size === 'auth' ? elementSize.authButton : elementSize.buttonHeight;

  return (
    <PressableScale
      onPress={onPress}
      disabled={isInactive}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: isInactive, busy: loading }}
      style={[
        styles.root,
        {
          height,
          minHeight: touchTarget.minimum,
          backgroundColor: isInactive ? neutralColors.disabled : color,
        },
        fullWidth ? styles.fullWidth : styles.hugging,
        style,
      ]}
      testID={testID}
    >
      <View style={styles.content}>
        {loading ? (
          <ActivityIndicator size="small" color={textColor} />
        ) : icon === undefined ? null : (
          <AppIcon name={icon} size={iconSize.sm} color={textColor} />
        )}
        <AppText variant="bodyMedium" color={textColor} numberOfLines={1}>
          {label}
        </AppText>
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  root: {
    borderRadius: radius.control,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  hugging: {
    alignSelf: 'flex-start',
  },
  fullWidth: {
    alignSelf: 'stretch',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
});
