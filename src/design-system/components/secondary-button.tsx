import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

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

export type SecondaryButtonProps = {
  readonly label: string;
  readonly onPress: () => void;
  readonly icon?: IconName;
  /** Outline and label colour. Defaults to the global `primary`. */
  readonly color?: string;
  readonly disabled?: boolean;
  readonly fullWidth?: boolean;
  readonly size?: 'default' | 'auth';
  /**
   * `subtle` drops the outline for genuinely tertiary actions (e.g. `Not Now`).
   * Cancellation stays visually secondary but findable (§18).
   */
  readonly variant?: 'outline' | 'subtle';
  readonly accessibilityHint?: string;
  readonly style?: StyleProp<ViewStyle>;
  readonly testID?: string;
};

/**
 * The secondary action, paired with PrimaryButton in state views and dialogs.
 *
 * Outlined on a white surface, same geometry as PrimaryButton so a side-by-side
 * pair aligns exactly.
 */
export function SecondaryButton({
  label,
  onPress,
  icon,
  color = semanticColors.primary,
  disabled = false,
  fullWidth = false,
  size = 'default',
  variant = 'outline',
  accessibilityHint,
  style,
  testID,
}: SecondaryButtonProps) {
  const height = size === 'auth' ? elementSize.authButton : elementSize.buttonHeight;
  const contentColor = disabled ? neutralColors.disabled : color;

  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled }}
      style={[
        styles.root,
        { height, minHeight: touchTarget.minimum },
        variant === 'outline'
          ? { borderWidth: 1, borderColor: disabled ? neutralColors.disabled : color }
          : null,
        fullWidth ? styles.fullWidth : styles.hugging,
        style,
      ]}
      testID={testID}
    >
      <View style={styles.content}>
        {icon === undefined ? null : (
          <AppIcon name={icon} size={iconSize.sm} color={contentColor} />
        )}
        <AppText variant="bodyMedium" color={contentColor} numberOfLines={1}>
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
    backgroundColor: neutralColors.surface,
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
