import { useState } from 'react';
import { StyleSheet, View, type TextInputProps } from 'react-native';

import { AppTextInput } from '@ds/typography/app-text-input';

import { entryAuthColors, entryAuthLayout } from '../entry-auth-tokens';
import { useEntryAuthMetrics } from '../use-entry-auth-metrics';
import { EntryAuthText } from './entry-auth-text';
import { InlineError } from './inline-error';

export type AuthTextFieldProps = Omit<TextInputProps, 'style'> & {
  /** Visible label. Required — a placeholder is not a label. */
  readonly label: string;
  /** Validation message. Its presence switches the field to its error state. */
  readonly error?: string;
  readonly testID?: string;
};

/**
 * A labelled text input.
 *
 * Every field carries a visible label above the control, because the accessibility rules state
 * plainly that placeholders are not labels — a placeholder disappears the moment typing starts and
 * is invisible to some screen readers.
 *
 * Three visual states, driven by props and focus rather than by a caller-managed flag: default,
 * focused (a `#3B82F6` border) and error (a `#E5484D` border plus a message below). The error
 * message is tied to the input with `accessibilityLabel`, so a screen reader announces the field
 * and its problem together instead of reading an orphaned line of red text.
 */
export function AuthTextField({
  label,
  error,
  editable = true,
  onFocus,
  onBlur,
  testID,
  ...rest
}: AuthTextFieldProps) {
  const { dp, type } = useEntryAuthMetrics();
  const [focused, setFocused] = useState(false);
  const invalid = error !== undefined;

  const borderColor = invalid
    ? entryAuthColors.error
    : focused
      ? entryAuthColors.focus
      : entryAuthColors.border;

  return (
    <View style={{ gap: dp(entryAuthLayout.labelGap) }}>
      <EntryAuthText token="label" nativeID={`${testID ?? 'field'}-label`}>
        {label}
      </EntryAuthText>
      <AppTextInput
        style={[
          styles.input,
          type('body'),
          {
            height: dp(entryAuthLayout.inputHeight),
            borderRadius: dp(entryAuthLayout.inputRadius),
            borderColor,
            paddingHorizontal: dp(14),
            backgroundColor: editable ? entryAuthColors.surface : entryAuthColors.secondaryMint,
            color: entryAuthColors.textPrimary,
          },
        ]}
        placeholderTextColor={entryAuthColors.textSecondary}
        editable={editable}
        accessibilityLabel={invalid ? `${label}. ${error}` : label}
        accessibilityState={{ disabled: !editable }}
        // Announced on change so a validation message reaches a screen reader without the user
        // having to navigate back to the field.
        accessibilityLiveRegion={invalid ? 'polite' : 'none'}
        testID={testID}
        {...rest}
        // After the spread, so a caller's own handlers are composed with the focus tracking rather
        // than silently replacing it.
        onFocus={(event) => {
          setFocused(true);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          onBlur?.(event);
        }}
      />
      {invalid ? <InlineError message={error} testID={`${testID ?? 'field'}-error`} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  input: {
    borderWidth: 1,
    // Android centres single-line input text by default only when the height is content-driven;
    // with a fixed height the vertical padding has to be neutralised explicitly.
    paddingVertical: 0,
  },
});
