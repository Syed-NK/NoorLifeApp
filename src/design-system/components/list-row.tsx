import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { AppText } from '@ds/typography/app-text';
import { AppIcon } from './app-icon';
import { PressableScale } from './pressable-scale';

import { iconSize, neutralColors, radius, spacing } from '@ds/tokens';
import type { IconName } from '@shared/models/icon';
import { forwardChevron } from '@shared/utils/rtl';
import { minimumTouchTargetSize } from '@shared/utils/a11y';

export type ListRowProps = {
  readonly title: string;
  readonly subtitle?: string;
  /** Trailing value, e.g. a time or an amount. */
  readonly value?: string;
  readonly icon?: IconName;
  /** Icon colour. Pass the module primary or a semantic colour. */
  readonly iconColor?: string;
  /** Soft tint behind the icon; omit for a bare glyph. */
  readonly iconBackgroundColor?: string;
  /** Leading colour dot, used by timelines instead of an icon. */
  readonly leadingDotColor?: string;
  readonly onPress?: () => void;
  /** Shows a trailing chevron. Implied when `onPress` is set and no value is given. */
  readonly showChevron?: boolean;
  /** Custom trailing content, e.g. a checkbox or a small progress bar. */
  readonly trailing?: React.ReactNode;
  /** Colour override for the trailing value text. */
  readonly valueColor?: string;
  readonly style?: StyleProp<ViewStyle>;
  readonly testID?: string;
};

/**
 * Generic list row — timelines, prayer lists, transactions, settings.
 *
 * Deliberately free of screen-specific text: everything visible is a prop, so the
 * same row serves every module.
 *
 * The chevron is direction-aware (RTL) and the whole row is a single
 * accessibility node reading "title, subtitle, value", so a screen reader gets
 * one coherent announcement rather than three fragments.
 */
export function ListRow({
  title,
  subtitle,
  value,
  icon,
  iconColor = neutralColors.textSecondary,
  iconBackgroundColor,
  leadingDotColor,
  onPress,
  showChevron,
  trailing,
  valueColor = neutralColors.textSecondary,
  style,
  testID,
}: ListRowProps) {
  const withChevron = showChevron ?? (onPress !== undefined && value === undefined);
  const readout = [title, subtitle, value].filter((part) => part !== undefined).join(', ');

  const content = (
    /* The floor is read at render, never cached in a StyleSheet - issue #115. */
    <View style={[styles.root, { minHeight: minimumTouchTargetSize() }, style]}>
      {leadingDotColor === undefined ? null : (
        <View style={[styles.dot, { backgroundColor: leadingDotColor }]} />
      )}

      {icon === undefined ? null : (
        <View
          style={[
            styles.iconSlot,
            iconBackgroundColor === undefined
              ? null
              : { backgroundColor: iconBackgroundColor, borderRadius: radius.control },
          ]}
        >
          <AppIcon name={icon} size={iconSize.sm} color={iconColor} />
        </View>
      )}

      <View style={styles.textColumn}>
        <AppText variant="cardTitle" numberOfLines={2}>
          {title}
        </AppText>
        {subtitle === undefined ? null : (
          <AppText variant="caption" color={neutralColors.textSecondary} numberOfLines={2}>
            {subtitle}
          </AppText>
        )}
      </View>

      {value === undefined ? null : (
        <AppText variant="label" color={valueColor} numberOfLines={1}>
          {value}
        </AppText>
      )}

      {trailing}

      {withChevron ? (
        <AppIcon name={forwardChevron()} size={iconSize.sm} color={neutralColors.textMuted} />
      ) : null}
    </View>
  );

  if (onPress === undefined) {
    return (
      <View accessible accessibilityRole="text" accessibilityLabel={readout} testID={testID}>
        {content}
      </View>
    );
  }

  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={readout}
      testID={testID}
    >
      {content}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: radius.pill,
  },
  iconSlot: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textColumn: {
    flex: 1,
  },
});
