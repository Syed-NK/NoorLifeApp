import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { AppText } from '@ds/typography/app-text';
import { AppIcon } from './app-icon';
import { SurfaceCard } from './surface-card';

import { iconSize, neutralColors, radius, spacing } from '@ds/tokens';
import type { IconName } from '@shared/models/icon';
import { statusLabel } from '@shared/utils/a11y';

export type MetricCardProps = {
  readonly icon: IconName;
  /** The primary value, e.g. "7,542" or "4 of 5". */
  readonly value: string;
  /** What the value measures, e.g. "Steps". */
  readonly label: string;
  /** Optional third line, e.g. "This month". */
  readonly caption?: string;
  /** Icon and accent colour — pass the module primary or a supporting accent. */
  readonly accentColor: string;
  /** Soft tint behind the icon. Pass the module `soft` value. */
  readonly accentSoftColor: string;
  readonly onPress?: () => void;
  /** `stacked` puts the icon above the value; `inline` puts it beside. */
  readonly layout?: 'inline' | 'stacked';
  readonly style?: StyleProp<ViewStyle>;
  readonly testID?: string;
};

/**
 * Compact metric tile for the metric rows on every home screen (§3.0 item 3).
 *
 * The value is `cardTitle`, not `dataLarge`: `dataLarge` (34 px) is reserved for
 * hero scores and balances, and would break a 2- or 4-across metric row.
 *
 * Accessibility: the whole tile is one node reading "label, value, caption" so a
 * screen reader is not forced through three separate fragments.
 */
export function MetricCard({
  icon,
  value,
  label,
  caption,
  accentColor,
  accentSoftColor,
  onPress,
  layout = 'stacked',
  style,
  testID,
}: MetricCardProps) {
  const readout = statusLabel(label, caption === undefined ? value : `${value}, ${caption}`);

  return (
    <SurfaceCard
      {...(onPress === undefined ? {} : { onPress, accessibilityLabel: readout })}
      style={[styles.root, style]}
      testID={testID}
    >
      <View
        style={layout === 'inline' ? styles.inline : styles.stacked}
        accessible
        accessibilityRole="text"
        accessibilityLabel={readout}
      >
        <View style={[styles.iconBadge, { backgroundColor: accentSoftColor }]}>
          <AppIcon name={icon} size={iconSize.sm} color={accentColor} />
        </View>
        <View style={styles.textColumn}>
          <AppText variant="cardTitle" numberOfLines={1}>
            {value}
          </AppText>
          <AppText variant="caption" color={neutralColors.textSecondary} numberOfLines={1}>
            {label}
          </AppText>
          {caption === undefined ? null : (
            <AppText variant="caption" color={neutralColors.textMuted} numberOfLines={1}>
              {caption}
            </AppText>
          )}
        </View>
      </View>
    </SurfaceCard>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  inline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  stacked: {
    gap: spacing.sm,
  },
  iconBadge: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textColumn: {
    flexShrink: 1,
  },
});
