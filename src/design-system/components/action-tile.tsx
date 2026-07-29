import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { RobotHead } from '@ds/illustrations/robot-head';
import { AppText } from '@ds/typography/app-text';
import { AppIcon } from './app-icon';
import { SurfaceCard } from './surface-card';

import { iconSize, neutralColors, radius, spacing, touchTarget } from '@ds/tokens';
import type { IconName } from '@shared/models/icon';

/**
 * Tile density.
 *
 * `grid` — the Main Home 4-across module grid. Measured from
 * design-reference/individual-core-screens/01-main-home.png: cards are wider than
 * they are tall (≈77 × 58 dp) with a small icon badge above a single-line label.
 * The standard 16 dp card padding is too generous at this width — it forces
 * "Learning" to wrap mid-word — so `grid` uses 8 dp and an 11 dp label.
 *
 * `row` — the quick-action row: icon and label side by side on one line, matching
 * the reference's three compact actions above the bottom navigation.
 *
 * `comfortable` — the default 16 dp-padded stacked tile for everywhere else.
 */
export type ActionTileDensity = 'comfortable' | 'grid' | 'row';

export type ActionTileProps = {
  readonly label: string;
  /** Optional second line. Ignored by the `row` density, which is single-line. */
  readonly caption?: string;
  readonly icon: IconName;
  /** Icon colour — the module's owned colour. Card background stays white (§05). */
  readonly accentColor: string;
  /** Soft tint behind the icon. Pass the module `soft` value. */
  readonly accentSoftColor: string;
  readonly onPress: () => void;
  readonly density?: ActionTileDensity;
  /**
   * Renders the approved robot-head mark instead of a glyph.
   *
   * Required for the Noor AI tile: §1.7 reserves compact AI actions for the
   * robot head, and an abstract orb is forbidden.
   */
  readonly useRobotHead?: boolean;
  readonly accessibilityHint?: string;
  readonly style?: StyleProp<ViewStyle>;
  readonly testID?: string;
};

/**
 * Tappable tile — the Main Home module grid and the quick-action row.
 *
 * The icon carries the module colour on a soft tint; the card itself stays white,
 * as §05 requires ("Each module icon uses its owned color, but card backgrounds
 * stay white").
 *
 * Every density keeps the tile at or above the 44 dp minimum touch target.
 */
export function ActionTile({
  label,
  caption,
  icon,
  accentColor,
  accentSoftColor,
  onPress,
  density = 'comfortable',
  useRobotHead = false,
  accessibilityHint,
  style,
  testID,
}: ActionTileProps) {
  const isRow = density === 'row';
  const isGrid = density === 'grid';

  const badgeSize = isGrid ? 32 : isRow ? 26 : 38;
  const glyphSize = isGrid ? iconSize.sm : isRow ? iconSize.xs : iconSize.md;
  const labelVariant = isGrid || isRow ? 'caption' : 'label';
  // A three-across row leaves ~60 dp for the label, and "Family Check-in" needs
  // ~72 dp at the 11 dp caption size. Wrapping to a second line is preferable to
  // ellipsising a control's name, and the tile's 44 dp min-height absorbs it.
  const labelLines = isRow ? 2 : 1;

  return (
    <SurfaceCard
      onPress={onPress}
      accessibilityLabel={caption === undefined ? label : `${label}, ${caption}`}
      {...(accessibilityHint === undefined ? {} : { accessibilityHint })}
      padded={false}
      style={[
        styles.root,
        isGrid ? styles.gridRoot : isRow ? styles.rowRoot : styles.comfortableRoot,
        style,
      ]}
      testID={testID}
    >
      <View style={isRow ? styles.rowContent : styles.stackedContent}>
        <View
          style={[
            styles.iconBadge,
            {
              width: badgeSize,
              height: badgeSize,
              borderRadius: isRow ? radius.pill : radius.control,
              backgroundColor: useRobotHead ? accentColor : accentSoftColor,
            },
          ]}
        >
          {useRobotHead ? (
            <RobotHead size={badgeSize * 0.82} />
          ) : (
            <AppIcon name={icon} size={glyphSize} color={accentColor} />
          )}
        </View>

        <View style={isRow ? styles.rowTextColumn : styles.stackedTextColumn}>
          <AppText variant={labelVariant} numberOfLines={labelLines}>
            {label}
          </AppText>
          {caption === undefined || isRow ? null : (
            <AppText variant="caption" color={neutralColors.textSecondary} numberOfLines={1}>
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
    justifyContent: 'center',
  },
  comfortableRoot: {
    padding: spacing.lg,
    minHeight: 84,
  },
  gridRoot: {
    // 8 dp padding, not the standard 16: at the reference's ~77 dp card width the
    // larger padding leaves too little room for a one-line "Learning".
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    minHeight: 62,
  },
  rowRoot: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    minHeight: touchTarget.minimum,
  },
  stackedContent: {
    alignItems: 'flex-start',
    gap: spacing.xs,
  },
  rowContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
  },
  iconBadge: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  stackedTextColumn: {
    alignSelf: 'stretch',
  },
  rowTextColumn: {
    flex: 1,
    minWidth: 0,
  },
});
