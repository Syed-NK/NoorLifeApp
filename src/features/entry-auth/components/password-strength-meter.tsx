import { StyleSheet, View } from 'react-native';

import { MIN_PASSWORD_LENGTH, scorePassword } from '@services/auth/mock-auth-service';

import { entryAuthColors } from '../entry-auth-tokens';
import { useEntryAuthMetrics } from '../use-entry-auth-metrics';
import { EntryAuthText } from './entry-auth-text';

export type PasswordStrengthMeterProps = {
  readonly password: string;
  readonly testID?: string;
};

const TONE = {
  weak: { colour: entryAuthColors.error, label: 'Weak', filled: 1 },
  fair: { colour: entryAuthColors.primary, label: 'Fair', filled: 2 },
  strong: { colour: entryAuthColors.success, label: 'Strong', filled: 3 },
} as const;

/**
 * Three-segment strength meter with a word label, as the reference shows.
 *
 * Scored by the same `scorePassword` the service validates with, so the meter can never say
 * "Strong" for a password the service will then reject as weak — a divergence that would be
 * invisible until submit.
 *
 * The word label is what carries the meaning; the colour only reinforces it. The requirement is that
 * the rules be visible *before* submission, so the meter renders as soon as anything is typed and
 * the length requirement is stated in words alongside it.
 */
export function PasswordStrengthMeter({ password, testID }: PasswordStrengthMeterProps) {
  const { dp } = useEntryAuthMetrics();

  if (password.length === 0) {
    return (
      <EntryAuthText token="caption" testID={`${testID ?? 'strength'}-hint'`}>
        {`Use at least ${MIN_PASSWORD_LENGTH} characters, mixing letters, numbers and symbols.`}
      </EntryAuthText>
    );
  }

  const strength = scorePassword(password);
  const tone = TONE[strength];

  return (
    <View style={{ gap: dp(6) }} testID={testID}>
      <View style={[styles.track, { columnGap: dp(6) }]}>
        {[0, 1, 2].map((index) => (
          <View
            key={index}
            style={{
              flex: 1,
              height: dp(4),
              borderRadius: dp(2),
              backgroundColor: index < tone.filled ? tone.colour : entryAuthColors.border,
            }}
          />
        ))}
      </View>
      <EntryAuthText
        token="caption"
        color={tone.colour}
        accessibilityLiveRegion="polite"
        testID={`${testID ?? 'strength'}-label`}
      >
        {strength === 'weak'
          ? `${tone.label} — use at least ${MIN_PASSWORD_LENGTH} characters with a mix of types.`
          : tone.label}
      </EntryAuthText>
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});
