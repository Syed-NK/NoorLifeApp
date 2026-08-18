import { Pressable, StyleSheet, View } from 'react-native';

import { EntryAuthText } from '@features/entry-auth/components/entry-auth-text';
import { useEntryAuthMetrics } from '@features/entry-auth/use-entry-auth-metrics';

import type { BillingPeriod } from '../domain/subscription';
import { billingCopy } from '../subscription-copy';
import { subscriptionColors, subscriptionLayout } from '../subscription-tokens';

export type BillingPeriodToggleProps = {
  readonly value: Extract<BillingPeriod, 'monthly' | 'yearly'>;
  readonly onChange: (period: Extract<BillingPeriod, 'monthly' | 'yearly'>) => void;
  /** Percent saved on yearly, rendered as a badge. Omitted when there is no honest figure. */
  readonly savingPercent?: number | null;
  readonly testID?: string;
};

/**
 * Monthly / Yearly segmented control.
 *
 * ── Selection is not carried by colour ──────────────────────────────────────
 * The selected half gets the electric-blue fill *and* `accessibilityState.selected`, and its
 * label switches to the on-accent colour at a weight change. A screen reader announces
 * "Yearly, selected"; a user who cannot distinguish the fill still has the state. The
 * accessibility requirements forbid colour as the sole carrier, and a segmented control is the
 * easiest place to get that wrong.
 *
 * The visual pill is 40 dp so it does not compete with the 48 dp primary button below it, and
 * each half carries hit slop to bring its touch target to the 44 dp minimum.
 */
export function BillingPeriodToggle({
  value,
  onChange,
  savingPercent,
  testID,
}: BillingPeriodToggleProps) {
  const { dp } = useEntryAuthMetrics();
  const height = dp(subscriptionLayout.toggleHeight);
  const padding = dp(subscriptionLayout.togglePadding);
  // Brings the 40 dp control up to the 44 dp accessible minimum without changing its look.
  const verticalSlop = Math.max(0, Math.ceil((dp(subscriptionLayout.minTouchTarget) - height) / 2));

  return (
    <View
      style={[
        styles.track,
        {
          height,
          padding,
          borderRadius: subscriptionLayout.toggleRadius,
          backgroundColor: subscriptionColors.surfaceMuted,
          borderColor: subscriptionColors.border,
        },
      ]}
      testID={testID}
    >
      <Segment
        label={billingCopy.monthly}
        selected={value === 'monthly'}
        onPress={() => onChange('monthly')}
        verticalSlop={verticalSlop}
        testID={`${testID ?? 'billing-toggle'}-monthly`}
      />
      <Segment
        label={billingCopy.yearly}
        selected={value === 'yearly'}
        onPress={() => onChange('yearly')}
        verticalSlop={verticalSlop}
        badge={
          savingPercent === null || savingPercent === undefined
            ? undefined
            : billingCopy.saveBadge(savingPercent)
        }
        testID={`${testID ?? 'billing-toggle'}-yearly`}
      />
    </View>
  );
}

type SegmentProps = {
  readonly label: string;
  readonly selected: boolean;
  readonly onPress: () => void;
  readonly verticalSlop: number;
  readonly badge?: string;
  readonly testID: string;
};

function Segment({ label, selected, onPress, verticalSlop, badge, testID }: SegmentProps) {
  const { dp } = useEntryAuthMetrics();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      // The badge is part of what this control means, so it belongs in the accessible name
      // rather than being left as a decorative flourish beside it.
      accessibilityLabel={badge === undefined ? label : `${label}, ${badge}`}
      hitSlop={{ top: verticalSlop, bottom: verticalSlop, left: 0, right: 0 }}
      style={[
        styles.segment,
        {
          borderRadius: subscriptionLayout.toggleRadius,
          columnGap: dp(6),
          backgroundColor: selected ? subscriptionColors.accent : 'transparent',
        },
      ]}
      testID={selected ? `${testID}-selected` : testID}
    >
      <EntryAuthText
        token="label"
        color={selected ? subscriptionColors.onAccent : subscriptionColors.textSecondary}
      >
        {label}
      </EntryAuthText>
      {badge === undefined ? null : (
        <View
          style={[
            styles.badge,
            {
              paddingHorizontal: dp(6),
              paddingVertical: dp(2),
              borderRadius: subscriptionLayout.toggleRadius,
              backgroundColor: selected
                ? subscriptionColors.onAccent
                : subscriptionColors.accentSurface,
            },
          ]}
        >
          <EntryAuthText token="caption" color={subscriptionColors.accent}>
            {badge}
          </EntryAuthText>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
  },
  segment: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
  },
  badge: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
