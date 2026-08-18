import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { EntryAuthText } from '@features/entry-auth/components/entry-auth-text';
import { useEntryAuthMetrics } from '@features/entry-auth/use-entry-auth-metrics';
import { subscriptionColors } from '@features/subscription/subscription-tokens';

import { PROFILE_LAYOUT } from '../profile-metrics';

export type ProfileDetailCardProps = {
  /** Rendered as a section header when present. Omitted where the content names itself. */
  readonly heading?: string;
  readonly children: React.ReactNode;
  readonly style?: StyleProp<ViewStyle>;
  readonly testID: string;
};

/**
 * A white section on the mint page: one border, one radius, one padding.
 *
 * Exists so the two detail screens cannot drift into two card treatments. Every value comes from
 * `PROFILE_LAYOUT`, the same source compact Profile Home's cards read, so a detail card sits on the
 * identical grid — 14 dp radius, 1 dp `#E4E9F0` hairline, white surface.
 *
 * Padding is 12 rather than Profile Home's 10: these cards hold stacked rows of labelled content
 * rather than a single measured row, and at 10 the text sat visibly tighter to the border than the
 * summary cards do.
 */
export function ProfileDetailCard({ heading, children, style, testID }: ProfileDetailCardProps) {
  const { dp } = useEntryAuthMetrics();

  return (
    <View
      style={[
        styles.card,
        {
          padding: dp(12),
          borderRadius: dp(PROFILE_LAYOUT.cardRadius),
          rowGap: dp(10),
        },
        style,
      ]}
      testID={testID}
    >
      {heading === undefined ? null : (
        <EntryAuthText
          token="button"
          accessibilityRole="header"
          color={subscriptionColors.textPrimary}
          testID={`${testID}-heading`}
        >
          {heading}
        </EntryAuthText>
      )}
      {children}
    </View>
  );
}

export type ProfileDetailRowProps = {
  readonly label: string;
  readonly value: string;
  /** Explanatory line beneath the value, e.g. where an email change actually happens. */
  readonly supporting?: string;
  /** Longer spoken text where the visible value is abbreviated or needs context. */
  readonly accessibilityHint?: string;
  readonly testID: string;
};

/**
 * A read-only labelled value.
 *
 * The label is a visible line above the value rather than a placeholder inside it, matching
 * `AuthTextField` — a placeholder is not a label, and these rows sit directly beneath one that is a
 * real input. The pair is announced together through one accessibility label, so a screen reader
 * reads "Email, ahmed@example.com" instead of two unrelated fragments.
 */
export function ProfileDetailRow({
  label,
  value,
  supporting,
  accessibilityHint,
  testID,
}: ProfileDetailRowProps) {
  const { dp } = useEntryAuthMetrics();

  return (
    <View style={{ rowGap: dp(4) }} testID={testID}>
      <View
        style={{ rowGap: dp(2) }}
        accessible
        accessibilityLabel={`${label}, ${value}`}
        {...(accessibilityHint === undefined ? {} : { accessibilityHint })}
      >
        <EntryAuthText token="label" testID={`${testID}-label`}>
          {label}
        </EntryAuthText>
        <EntryAuthText
          token="body"
          color={subscriptionColors.textPrimary}
          testID={`${testID}-value`}
        >
          {value}
        </EntryAuthText>
      </View>

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
  );
}

const styles = StyleSheet.create({
  card: {
    width: '100%',
    borderWidth: PROFILE_LAYOUT.cardBorder,
    borderColor: subscriptionColors.border,
    backgroundColor: subscriptionColors.surface,
  },
});
