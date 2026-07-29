import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { AppText } from '@ds/typography/app-text';
import { AppIcon } from './app-icon';

import { iconSize, neutralColors, radius, spacing } from '@ds/tokens';
import type { IconName } from '@shared/models/icon';

export type PillProps = {
  readonly label: string;
  readonly icon?: IconName;
  readonly backgroundColor?: string;
  readonly textColor?: string;
  readonly style?: StyleProp<ViewStyle>;
  /**
   * Screen-reader text when the pill communicates status. Required by §8: status
   * must never be conveyed by colour alone — the label carries it, and this adds
   * context where the visible label is terse.
   */
  readonly accessibilityLabel?: string;
  readonly testID?: string;
};

/**
 * Small non-interactive status / scope chip. Pill radius (999) per §2.5.
 *
 * Used for AI scope pills (§06 `NoorLife questions only`), badges and inline
 * status. Interactive chips are buttons, not pills.
 */
export function Pill({
  label,
  icon,
  backgroundColor = neutralColors.surfaceSoft,
  textColor = neutralColors.textSecondary,
  style,
  accessibilityLabel,
  testID,
}: PillProps) {
  return (
    <View
      style={[styles.root, { backgroundColor }, style]}
      accessible
      accessibilityRole="text"
      accessibilityLabel={accessibilityLabel ?? label}
      testID={testID}
    >
      {icon === undefined ? null : <AppIcon name={icon} size={iconSize.xs} color={textColor} />}
      <AppText variant="label" color={textColor} numberOfLines={1}>
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.pill,
    alignSelf: 'flex-start',
  },
});
