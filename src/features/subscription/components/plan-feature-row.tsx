import { StyleSheet, View } from 'react-native';

import { EntryAuthText } from '@features/entry-auth/components/entry-auth-text';
import { useEntryAuthMetrics } from '@features/entry-auth/use-entry-auth-metrics';

import { subscriptionColors, subscriptionLayout } from '../subscription-tokens';

export type PlanFeatureRowProps = {
  readonly label: string;
  /** False renders the muted, unavailable presentation. */
  readonly included?: boolean;
  readonly testID?: string;
};

/**
 * One line in a plan's benefit list.
 *
 * The mark is drawn from two rotated borders, not an icon font: these screens are forbidden from
 * substituting glyph artwork, and a tick is simple enough to draw honestly. An excluded row gets
 * a dash rather than a cross — a cross beside a Free plan's feature reads as a penalty, and the
 * Free plan is a real product here, not a punishment.
 *
 * Availability is conveyed by the mark's *shape* and by the accessible label, never by colour
 * alone.
 */
export function PlanFeatureRow({ label, included = true, testID }: PlanFeatureRowProps) {
  const { dp } = useEntryAuthMetrics();
  const box = dp(subscriptionLayout.checkSize);

  return (
    <View
      style={[styles.row, { columnGap: dp(8) }]}
      accessible
      accessibilityLabel={included ? `Included: ${label}` : `Not included: ${label}`}
      testID={testID}
    >
      <View style={[styles.markBox, { width: box, height: box }]}>
        {included ? (
          <View
            style={{
              width: dp(9),
              height: dp(5),
              borderLeftWidth: 2,
              borderBottomWidth: 2,
              borderColor: subscriptionColors.accent,
              transform: [{ rotate: '-45deg' }, { translateY: -dp(1) }],
            }}
          />
        ) : (
          <View
            style={{
              width: dp(9),
              height: 2,
              backgroundColor: subscriptionColors.disabled,
            }}
          />
        )}
      </View>
      <EntryAuthText
        token="body"
        color={included ? subscriptionColors.textPrimary : subscriptionColors.textSecondary}
        style={styles.label}
      >
        {label}
      </EntryAuthText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  markBox: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  /** Shrinks so a long feature name wraps inside the card instead of widening it. */
  label: {
    flexShrink: 1,
  },
});
