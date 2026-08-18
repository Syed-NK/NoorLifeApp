import { StyleSheet, Switch, View } from 'react-native';

import { EntryAuthText } from '@features/entry-auth/components/entry-auth-text';
import { useEntryAuthMetrics } from '@features/entry-auth/use-entry-auth-metrics';
import { subscriptionColors } from '@features/subscription/subscription-tokens';

import { PROFILE_LAYOUT } from '../profile-metrics';

export type ProfileToggleRowProps = {
  readonly label: string;
  readonly supporting?: string;
  readonly value: boolean;
  readonly onValueChange: (value: boolean) => void;
  /**
   * Locked on, with the reason visible.
   *
   * Used where the operating system has already decided — a system Reduce Motion setting the
   * in-app preference cannot overrule. The switch stays visible and stays on rather than
   * disappearing, so the state is legible; `accessibilityState.disabled` tells a screen reader
   * why it will not move.
   */
  readonly disabled?: boolean;
  readonly accessibilityHint?: string;
  readonly testID: string;
};

/**
 * A real switch, for a preference that really does something.
 *
 * ── The bar this component has to clear ─────────────────────────────────────
 * There is exactly one of these on Preferences, and that is deliberate: a switch is a promise that
 * something changes, so the only preference that gets one is the one wired through the shared
 * accessibility service to every animation in the application. The notification, language and
 * appearance sections use `ProfileStatusRow` instead — a state and a sentence — because a switch
 * there would be a control with nothing behind it.
 *
 * ── Geometry ────────────────────────────────────────────────────────────────
 * The row is 44 dp minimum, and the whole row is the accessible element rather than the switch
 * alone: a bare `Switch` is roughly 51 × 31, below the touch minimum on its short axis, and a
 * label that is not part of the control is a label the user cannot tap.
 */
export function ProfileToggleRow({
  label,
  supporting,
  value,
  onValueChange,
  disabled = false,
  accessibilityHint,
  testID,
}: ProfileToggleRowProps) {
  const { dp } = useEntryAuthMetrics();

  return (
    <View
      style={[styles.row, { minHeight: dp(PROFILE_LAYOUT.minTouchTarget), columnGap: dp(12) }]}
      accessible
      accessibilityRole="switch"
      accessibilityLabel={label}
      {...(accessibilityHint === undefined ? {} : { accessibilityHint })}
      accessibilityState={{ checked: value, disabled }}
      testID={testID}
    >
      <View style={[styles.text, { rowGap: dp(2) }]}>
        <EntryAuthText
          token="body"
          color={subscriptionColors.textPrimary}
          testID={`${testID}-label`}
        >
          {label}
        </EntryAuthText>
        {supporting === undefined ? null : (
          <EntryAuthText
            token="caption"
            color={subscriptionColors.textSecondary}
            testID={`${testID}-supporting`}
          >
            {supporting}
          </EntryAuthText>
        )}
      </View>

      <Switch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        trackColor={{ false: subscriptionColors.border, true: subscriptionColors.accent }}
        thumbColor={subscriptionColors.surface}
        // No accessibility props of its own. The row above is marked `accessible`, which collapses
        // its descendants into one focusable element on both platforms — so the switch is reached
        // and toggled through the labelled row rather than announced a second time beside it.
        testID={`${testID}-switch`}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  text: {
    flexShrink: 1,
  },
});
