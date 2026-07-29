import { StyleSheet, View } from 'react-native';

import { entryAuthColors } from '../entry-auth-tokens';
import { useEntryAuthMetrics } from '../use-entry-auth-metrics';
import { EntryAuthText } from './entry-auth-text';

export type InlineErrorProps = {
  readonly message: string;
  readonly testID?: string;
};

/**
 * A field-level validation message.
 *
 * Deliberately small and reusable: the phase prompt warns against designing a separate full-screen
 * state for every inline validation error, so every field-level problem renders through this.
 *
 * The dot is a coloured `View`, not a glyph or an icon-font character — one less font dependency,
 * and colour is never the only signal because the message itself states the problem.
 */
export function InlineError({ message, testID }: InlineErrorProps) {
  const { dp } = useEntryAuthMetrics();

  return (
    <View style={[styles.row, { gap: dp(6) }]} accessibilityLiveRegion="polite" testID={testID}>
      <View
        style={{
          width: dp(4),
          height: dp(4),
          borderRadius: dp(2),
          backgroundColor: entryAuthColors.error,
          marginTop: dp(6),
        }}
      />
      <EntryAuthText token="caption" color={entryAuthColors.error} style={styles.text}>
        {message}
      </EntryAuthText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  text: {
    flexShrink: 1,
  },
});
