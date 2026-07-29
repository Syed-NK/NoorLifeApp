import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { entryAuthColors } from '../entry-auth-tokens';
import { useEntryAuthMetrics } from '../use-entry-auth-metrics';

export type AuthScaffoldProps = {
  readonly children: React.ReactNode;
  /** Fixed content pinned to the bottom, e.g. an onboarding control row. */
  readonly footer?: React.ReactNode;
  /** Set false for screens that manage their own horizontal padding. */
  readonly padded?: boolean;
  readonly contentStyle?: StyleProp<ViewStyle>;
  readonly testID?: string;
};

/**
 * The shell every entry/authentication screen is built on.
 *
 * Responsibilities, so no screen repeats them:
 *   • the Soft Mint page background — the rejection gates fail a grey, lavender or heavily
 *     blue background, so it is set in exactly one place
 *   • safe-area insets, top and bottom
 *   • 16 dp side padding
 *   • a content column capped at the 393 dp baseline and centred, so a wider handset gets
 *     margins instead of stretched cards
 *
 * The column is capped by `maxWidth` rather than by scaling children up, which is the same
 * never-upscale rule the metrics hook enforces for type and spacing.
 */
export function AuthScaffold({
  children,
  footer,
  padded = true,
  contentStyle,
  testID,
}: AuthScaffoldProps) {
  const insets = useSafeAreaInsets();
  const { pagePadding, dp } = useEntryAuthMetrics();

  return (
    <View style={styles.root} testID={testID}>
      {/* Dark icons: the page is near-white, so light content would be invisible. */}
      <StatusBar style="dark" />
      <View style={[styles.column, { paddingTop: insets.top }]}>
        <View
          style={[
            styles.content,
            padded ? { paddingHorizontal: pagePadding } : null,
            contentStyle,
          ]}
        >
          {children}
        </View>
        {footer === undefined ? null : (
          <View
            style={[
              padded ? { paddingHorizontal: pagePadding } : null,
              // The bottom inset is added to a fixed margin rather than replacing it, so the
              // footer never sits flush against the gesture bar on a device that has one.
              { paddingBottom: insets.bottom + dp(16) },
            ]}
          >
            {footer}
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: entryAuthColors.pageBackground,
    alignItems: 'center',
  },
  column: {
    flex: 1,
    width: '100%',
    maxWidth: 393,
  },
  content: {
    flex: 1,
  },
});
