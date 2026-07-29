import { useRef, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { entryAuthColors, entryAuthLayout } from '../entry-auth-tokens';
import { useEntryAuthMetrics } from '../use-entry-auth-metrics';
import { EntryAuthText } from './entry-auth-text';

export const OTP_LENGTH = 6;

export type OtpInputProps = {
  readonly value: string;
  readonly onChange: (value: string) => void;
  /** Marks every box as invalid. The message itself belongs to the caller's banner. */
  readonly invalid?: boolean;
  readonly onComplete?: (value: string) => void;
  readonly testID?: string;
};

/**
 * A six-digit code entry.
 *
 * ── One input, six boxes ────────────────────────────────────────────────────
 * The boxes are presentation; there is a single hidden `TextInput` behind them holding the whole
 * code. Six separate inputs are the usual approach and the usual source of bugs: pasting a code
 * only fills the first box, SMS autofill targets one field, and backspace across boundaries has to
 * be simulated. With one input, paste, autofill and backspace are simply the platform's own
 * behaviour, and the requirement to "support paste, backspace navigation, autofill" is met by not
 * breaking it in the first place.
 *
 * `autoComplete="sms-otp"` (Android) and `textContentType="oneTimeCode"` (iOS) are what let the OS
 * offer a received code.
 */
export function OtpInput({ value, onChange, invalid = false, onComplete, testID }: OtpInputProps) {
  const { dp, type } = useEntryAuthMetrics();
  const inputRef = useRef<TextInput>(null);
  const [focused, setFocused] = useState(false);

  const digits = value.padEnd(OTP_LENGTH, ' ').slice(0, OTP_LENGTH).split('');
  const boxWidth = dp(46);

  const handleChange = (next: string) => {
    const cleaned = next.replace(/\D/g, '').slice(0, OTP_LENGTH);
    onChange(cleaned);
    if (cleaned.length === OTP_LENGTH) {
      onComplete?.(cleaned);
    }
  };

  return (
    <View>
      <View
        style={[styles.row, { columnGap: dp(8) }]}
        // The boxes are decorative; the real control is the input below, which carries the label.
        accessible={false}
      >
        {digits.map((digit, index) => {
          const active = focused && index === Math.min(value.length, OTP_LENGTH - 1);
          return (
            <View
              key={index}
              style={[
                styles.box,
                {
                  width: boxWidth,
                  height: dp(entryAuthLayout.inputHeight),
                  borderRadius: dp(entryAuthLayout.inputRadius),
                  borderColor: invalid
                    ? entryAuthColors.error
                    : active
                      ? entryAuthColors.focus
                      : entryAuthColors.border,
                  borderWidth: active || invalid ? 1.5 : 1,
                },
              ]}
              testID={`${testID ?? 'otp'}-box-${index}`}
            >
              <EntryAuthText token="otp">{digit.trim()}</EntryAuthText>
            </View>
          );
        })}
      </View>

      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={handleChange}
        keyboardType="number-pad"
        maxLength={OTP_LENGTH}
        autoComplete="sms-otp"
        textContentType="oneTimeCode"
        accessibilityLabel={`Verification code, ${OTP_LENGTH} digits`}
        accessibilityLiveRegion={invalid ? 'polite' : 'none'}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        // Transparent and stretched over the boxes: it stays the real focus target and the real
        // paste target, while the boxes render the value. Hiding it off-screen instead would break
        // the tap-to-focus gesture and, on some Androids, autofill.
        style={[styles.hidden, type('otp')]}
        caretHidden
        testID={testID}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
  box: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: entryAuthColors.surface,
  },
  hidden: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    opacity: 0,
    color: 'transparent',
  },
});
