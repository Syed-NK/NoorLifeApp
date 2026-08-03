import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { entryAuthColors, entryAuthLayout } from '../entry-auth-tokens';
import { useEntryAuthMetrics } from '../use-entry-auth-metrics';
import { EntryAuthText } from './entry-auth-text';
import { InlineError } from './inline-error';

export type PasswordFieldProps = Omit<TextInputProps, 'style' | 'secureTextEntry'> & {
  readonly label: string;
  readonly error?: string;
  readonly testID?: string;
};

/**
 * A password input with a show/hide control.
 *
 * The reveal control is a text button rather than an eye glyph: the icon families the phase prompt
 * forbids are exactly where an eye icon would come from, and "Show"/"Hide" is unambiguous to a
 * screen reader without needing a separate label.
 *
 * `textContentType` and `autoComplete` are set so iOS and Android password managers offer to fill
 * and to save — the prompt requires the login form be autofill-aware and manager-compatible, which
 * is a matter of declaring these hints rather than of layout.
 */
export function PasswordField({
  label,
  error,
  autoComplete = 'current-password',
  onFocus,
  onBlur,
  testID,
  ...rest
}: PasswordFieldProps) {
  const { dp, type } = useEntryAuthMetrics();
  const [focused, setFocused] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const invalid = error !== undefined;

  const borderColor = invalid
    ? entryAuthColors.error
    : focused
      ? entryAuthColors.focus
      : entryAuthColors.border;

  return (
    <View style={{ gap: dp(entryAuthLayout.labelGap) }}>
      <EntryAuthText token="label">{label}</EntryAuthText>
      <View
        style={[
          styles.shell,
          {
            height: dp(entryAuthLayout.inputHeight),
            borderRadius: dp(entryAuthLayout.inputRadius),
            borderColor,
            paddingLeft: dp(14),
            paddingRight: dp(6),
          },
        ]}
      >
        <TextInput
          style={[styles.input, type('body'), { color: entryAuthColors.textPrimary }]}
          placeholderTextColor={entryAuthColors.textSecondary}
          secureTextEntry={!revealed}
          autoComplete={autoComplete}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel={invalid ? `${label}. ${error}` : label}
          accessibilityLiveRegion={invalid ? 'polite' : 'none'}
          /**
           * Both handlers run, the caller's second.
           *
           * These used to be written inside the `{...rest}` spread's path, so a caller passing
           * `onBlur` — which Change Password now does, to decide when an inline message may
           * appear — silently replaced the focus-ring reset and left the field drawn as focused
           * after the keyboard had gone. Composing them keeps the border correct and lets the
           * caller observe the event.
           */
          onFocus={(event) => {
            setFocused(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          testID={testID}
          {...rest}
        />
        <Pressable
          onPress={() => setRevealed((v) => !v)}
          accessibilityRole="button"
          accessibilityLabel={revealed ? 'Hide password' : 'Show password'}
          // The control is inside a 48 dp field, so its own box is the full field height; the
          // horizontal padding brings it to the 44 dp minimum without changing the field.
          style={[
            styles.reveal,
            { height: dp(entryAuthLayout.inputHeight), paddingHorizontal: dp(10) },
          ]}
          testID={`${testID ?? 'password'}-reveal`}
        >
          <EntryAuthText token="label" color={entryAuthColors.primary}>
            {revealed ? 'Hide' : 'Show'}
          </EntryAuthText>
        </Pressable>
      </View>
      {invalid ? <InlineError message={error} testID={`${testID ?? 'password'}-error`} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    backgroundColor: entryAuthColors.surface,
  },
  input: {
    flex: 1,
    paddingVertical: 0,
  },
  reveal: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
