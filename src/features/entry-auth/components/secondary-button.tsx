import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { entryAuthColors, entryAuthLayout } from '../entry-auth-tokens';
import { useEntryAuthMetrics } from '../use-entry-auth-metrics';
import { EntryAuthText } from './entry-auth-text';

export type SecondaryButtonProps = {
  readonly label: string;
  readonly onPress: () => void;
  readonly disabled?: boolean;
  readonly style?: StyleProp<ViewStyle>;
  readonly testID?: string;
};

/**
 * The secondary action — a white surface with a hairline border, matching the reference's Skip.
 *
 * Same 48 dp height and 12 dp radius as the primary, so a side-by-side pair aligns exactly; the
 * hierarchy comes from fill and label colour, not from size.
 */
export function SecondaryButton({
  label,
  onPress,
  disabled = false,
  style,
  testID,
}: SecondaryButtonProps) {
  const { dp } = useEntryAuthMetrics();

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        styles.root,
        {
          height: dp(entryAuthLayout.buttonHeight),
          borderRadius: dp(entryAuthLayout.buttonRadius),
          backgroundColor: pressed ? entryAuthColors.secondaryMint : entryAuthColors.surface,
          opacity: disabled ? 0.5 : 1,
        },
        style,
      ]}
      testID={testID}
    >
      <EntryAuthText
        token="button"
        color={entryAuthColors.textPrimary}
        numberOfLines={1}
        // Shrink to fit rather than ellipsize, for the reason recorded in `primary-button.tsx`: the
        // pair are used together on the callback screen and must behave identically.
        adjustsFontSizeToFit
        minimumFontScale={0.8}
        maxFontSizeMultiplier={1.3}
      >
        {label}
      </EntryAuthText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: entryAuthColors.border,
  },
});
