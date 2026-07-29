import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { layout, neutralColors, radius, shadowCard } from '@ds/tokens';
import { PressableScale } from './pressable-scale';

export type SurfaceCardProps = {
  readonly children?: React.ReactNode;
  /** `soft` uses `surfaceSoft` for secondary/grouped cards (§2.1). */
  readonly tone?: 'surface' | 'soft';
  /** Module-soft tint, for AI-insight and status cards only. Never a full screen. */
  readonly backgroundColor?: string;
  /** Left accent / border colour, e.g. a module primary on an insight card. */
  readonly borderColor?: string;
  /** Removes the default 16 px card padding when a child manages its own. */
  readonly padded?: boolean;
  readonly style?: StyleProp<ViewStyle>;
  readonly onPress?: () => void;
  readonly accessibilityLabel?: string;
  readonly accessibilityHint?: string;
  readonly testID?: string;
};

/**
 * The base card surface: white, 18 px radius, 16 px padding, `--shadow-card`.
 *
 * Every card in NoorLife composes this rather than restating radius, padding,
 * border and shadow. Module colour reaches a card only through `backgroundColor`
 * (a module `soft`) or `borderColor` (a module `primary`) — card backgrounds stay
 * white on Main Home by §05, and §1.4 forbids tinting whole screens.
 *
 * Passing `onPress` makes the whole card a button, with the standard §7 press
 * feedback and a required accessibility label.
 */
export function SurfaceCard({
  children,
  tone = 'surface',
  backgroundColor,
  borderColor,
  padded = true,
  style,
  onPress,
  accessibilityLabel,
  accessibilityHint,
  testID,
}: SurfaceCardProps) {
  const resolvedBackground =
    backgroundColor ?? (tone === 'soft' ? neutralColors.surfaceSoft : neutralColors.surface);

  const cardStyle: StyleProp<ViewStyle> = [
    styles.card,
    shadowCard,
    { backgroundColor: resolvedBackground },
    borderColor === undefined ? null : { borderColor },
    padded ? styles.padded : null,
    style,
  ];

  if (onPress === undefined) {
    return (
      <View style={cardStyle} testID={testID}>
        {children}
      </View>
    );
  }

  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      style={cardStyle}
      testID={testID}
    >
      {children}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: neutralColors.border,
    overflow: 'hidden',
  },
  padded: {
    padding: layout.cardPadding,
  },
});
