import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { entryAuthColors, entryAuthLayout } from '../entry-auth-tokens';
import { useEntryAuthMetrics } from '../use-entry-auth-metrics';
import { EntryAuthText } from './entry-auth-text';

export type PrimaryButtonProps = {
  readonly label: string;
  readonly onPress: () => void;
  readonly disabled?: boolean;
  /** Shows a spinner and blocks presses. Distinct from `disabled`. */
  readonly loading?: boolean;
  readonly style?: StyleProp<ViewStyle>;
  readonly accessibilityHint?: string;
  readonly testID?: string;
};

/**
 * The primary action for the entry flow — 48 dp, `#1677FF`, 12 dp radius.
 *
 * Separate from `@ds/components`' PrimaryButton, which is locked to Main Home's `#3157C8`
 * primary and its own geometry. Duplicating the component is what lets both palettes stay
 * correct without either being edited.
 *
 * A loading press is swallowed rather than the button being disabled, so the label stays put
 * and the control does not change size mid-request. The spinner replaces the label in place;
 * `accessibilityState.busy` is what conveys the change to a screen reader.
 *
 * ── The disabled label is not white ─────────────────────────────────────────
 * `onPrimary` on the `#C8CED8` disabled fill measures 1.9:1, which is unreadable — a disabled
 * control still has to say what it is, or the user cannot tell a refused action from a missing one.
 * The label switches to `textPrimary` instead, which is 9.0:1 on that fill and reads unmistakably
 * as inactive beside the `#1677FF` enabled state. Both come from the locked token set; no colour
 * was added. Geometry is identical in both states, so the 48 dp target never shrinks.
 */
export function PrimaryButton({
  label,
  onPress,
  disabled = false,
  loading = false,
  style,
  accessibilityHint,
  testID,
}: PrimaryButtonProps) {
  const { dp } = useEntryAuthMetrics();
  const inert = disabled || loading;

  return (
    <Pressable
      onPress={onPress}
      disabled={inert}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled, busy: loading }}
      style={({ pressed }) => [
        styles.root,
        {
          height: dp(entryAuthLayout.buttonHeight),
          borderRadius: dp(entryAuthLayout.buttonRadius),
          backgroundColor: disabled
            ? entryAuthColors.disabled
            : pressed
              ? entryAuthColors.primaryDeep
              : entryAuthColors.primary,
        },
        style,
      ]}
      testID={testID}
    >
      {loading ? (
        <ActivityIndicator
          color={entryAuthColors.onPrimary}
          testID={`${testID ?? 'primary'}-spinner`}
        />
      ) : (
        <View style={styles.labelWrap}>
          <EntryAuthText
            token="button"
            color={disabled ? entryAuthColors.textPrimary : entryAuthColors.onPrimary}
            numberOfLines={1}
            // The button is a fixed 48 dp, so the label is capped rather than allowed to grow
            // past the control. Scaling still applies up to this point.
            maxFontSizeMultiplier={1.3}
          >
            {label}
          </EntryAuthText>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  labelWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
