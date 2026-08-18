import { StyleSheet, View } from 'react-native';

import { entryAuthColors, entryAuthLayout } from '../entry-auth-tokens';
import { useEntryAuthMetrics } from '../use-entry-auth-metrics';
import { EntryAuthText } from './entry-auth-text';

export type AuthStatusTone = 'error' | 'success' | 'info';

export type AuthStatusBannerProps = {
  readonly tone: AuthStatusTone;
  readonly message: string;
  readonly testID?: string;
};

const TONE = {
  error: { fill: '#FDECEC', border: '#F5C2C2', text: entryAuthColors.error },
  success: { fill: '#E7F7F0', border: '#B8E6D2', text: entryAuthColors.success },
  info: {
    fill: entryAuthColors.secondaryMint,
    border: '#CDE7DD',
    text: entryAuthColors.textPrimary,
  },
} as const;

/**
 * A screen-level status message: server errors, offline, and privacy-safe successes.
 *
 * Separate from `InlineError`, which belongs to one field. This carries the states that are not
 * about a single input — an API failure, no connection, "if that address is registered we've sent a
 * link" — so no screen needs a bespoke full-page error design.
 *
 * `accessibilityLiveRegion="polite"` plus `role="alert"` moves screen-reader focus here when the
 * banner appears, which is what the accessibility requirement for validation and success messages
 * asks for. Tone is carried by the message text as well as the colour, never by colour alone.
 */
export function AuthStatusBanner({ tone, message, testID }: AuthStatusBannerProps) {
  const { dp } = useEntryAuthMetrics();
  const palette = TONE[tone];

  return (
    <View
      style={[
        styles.root,
        {
          borderRadius: dp(entryAuthLayout.inputRadius),
          paddingHorizontal: dp(12),
          paddingVertical: dp(10),
          backgroundColor: palette.fill,
          borderColor: palette.border,
        },
      ]}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      testID={testID}
    >
      <EntryAuthText token="caption" color={palette.text}>
        {message}
      </EntryAuthText>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    borderWidth: 1,
  },
});
