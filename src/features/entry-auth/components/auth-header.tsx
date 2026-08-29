import { Pressable, StyleSheet, View } from 'react-native';

import { entryAuthColors, entryAuthLayout } from '../entry-auth-tokens';
import type { EntryAuthTypeToken } from '../entry-auth-tokens';
import { useEntryAuthMetrics } from '../use-entry-auth-metrics';
import { EntryAuthText } from './entry-auth-text';
import { minimumTouchTargetSize } from '@shared/utils/a11y';

export type AuthHeaderProps = {
  /** Omitted on screens the workflow gives no back destination. */
  readonly onBack?: () => void;
  readonly title: string;
  readonly subtitle?: string;
  /**
   * Type token for the heading. Defaults to `title`, so every existing screen is unchanged.
   *
   * Added in Phase 5B for the subscription screens, which carry longer headings than an auth form
   * and looked oversized at 22 dp — "Choose how NoorLife supports you" wrapped to two lines and
   * dominated the plan cards beneath it.
   */
  readonly titleToken?: Extract<EntryAuthTypeToken, 'title' | 'titleCompact'>;
  readonly testID?: string;
};

/**
 * Back control, heading and optional subheading.
 *
 * The chevron is two rotated borders rather than an icon-font glyph, for the same reason the
 * provider marks are primitives: the icon families available here are the ones the phase prompt
 * forbids on these screens.
 *
 * The back control's touch target is 44 dp square — the accessibility minimum — while the chevron
 * itself is 10 dp, so the target is generous without the mark being oversized. It sits in a row of
 * its own so the heading below stays optically centred on the page rather than being pushed by it.
 */
export function AuthHeader({
  onBack,
  title,
  subtitle,
  titleToken = 'title',
  testID,
}: AuthHeaderProps) {
  const { dp } = useEntryAuthMetrics();
  const target = dp(entryAuthLayout.minTouchTarget);

  return (
    <View style={{ gap: dp(6) }} testID={testID}>
      <View style={[styles.backRow, { height: target }]}>
        {onBack === undefined ? null : (
          <Pressable
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            hitSlop={8}
            style={[
              styles.backTarget,
              { width: target, height: target },
              {
                minWidth: minimumTouchTargetSize(),
                minHeight: minimumTouchTargetSize(),
                alignItems: 'center',
                justifyContent: 'center',
              },
            ]}
            testID={`${testID ?? 'auth-header'}-back`}
          >
            <View
              style={{
                width: dp(10),
                height: dp(10),
                borderLeftWidth: 2,
                borderBottomWidth: 2,
                borderColor: entryAuthColors.textPrimary,
                transform: [{ rotate: '45deg' }],
              }}
            />
          </Pressable>
        )}
      </View>

      <EntryAuthText token={titleToken} align="center" accessibilityRole="header">
        {title}
      </EntryAuthText>
      {subtitle === undefined ? null : (
        <EntryAuthText token="subtitle" align="center">
          {subtitle}
        </EntryAuthText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  backRow: {
    justifyContent: 'center',
  },
  backTarget: {
    alignItems: 'center',
    justifyContent: 'center',
    // Pulled left so the 44 dp target's edge lines up with the page padding, not its centre.
    marginLeft: -10,
  },
});
