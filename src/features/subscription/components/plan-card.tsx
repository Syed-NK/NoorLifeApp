import { Pressable, StyleSheet, View } from 'react-native';

import { EntryAuthText } from '@features/entry-auth/components/entry-auth-text';
import { useEntryAuthMetrics } from '@features/entry-auth/use-entry-auth-metrics';

import type { SubscriptionPlan } from '../domain/subscription';
import { subscriptionColors, subscriptionLayout } from '../subscription-tokens';
import { PlanBadge } from './plan-badge';

export type PlanCardProps = {
  readonly plan: SubscriptionPlan;
  readonly name: string;
  readonly tagline: string;
  /** The price block, or the "Free forever" line. Composed by the caller. */
  readonly priceSlot: React.ReactNode;
  readonly selected: boolean;
  readonly onPress: () => void;
  readonly badge?: { readonly label: string; readonly accessibilityLabel?: string };
  /** A short feature summary. The full list lives on the plan's detail screen. */
  readonly children?: React.ReactNode;
  readonly testID?: string;
};

/**
 * A selectable plan.
 *
 * ── Selection is carried three ways ─────────────────────────────────────────
 * A 2 dp electric-blue ring, a filled check mark, and `accessibilityState.selected`. The
 * accessibility requirements forbid communicating the selected plan by colour alone, and a
 * paywall is exactly where that shortcut is normally taken.
 *
 * ── No dark patterns ────────────────────────────────────────────────────────
 * The card does not grow when selected, the Free card is styled identically to the paid ones,
 * and nothing here dims or shrinks Free to steer the choice. The only visual difference between
 * plans is the badge a caller chooses to pass.
 *
 * ── Height ──────────────────────────────────────────────────────────────────
 * The card is content-height with fixed padding. It is never stretched to fill, which is what
 * keeps three cards on one screen without the large empty bands the brief rules out.
 */
export function PlanCard({
  plan,
  name,
  tagline,
  priceSlot,
  selected,
  onPress,
  badge,
  children,
  testID,
}: PlanCardProps) {
  const { dp } = useEntryAuthMetrics();
  const check = dp(subscriptionLayout.checkSize);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected, checked: selected }}
      // The plan's name and tagline are the accessible name; price and features are read from
      // the children that follow, so this is not repeated here.
      accessibilityLabel={`${name}. ${tagline}`}
      style={[
        styles.card,
        {
          padding: dp(subscriptionLayout.cardPadding),
          borderRadius: dp(subscriptionLayout.cardRadius),
          rowGap: dp(subscriptionLayout.rowGap),
          backgroundColor: subscriptionColors.surface,
          borderColor: selected ? subscriptionColors.selectedRing : subscriptionColors.border,
          borderWidth: selected ? 2 : 1,
        },
      ]}
      testID={selected ? `${testID ?? `plan-${plan}`}-selected` : (testID ?? `plan-${plan}`)}
    >
      <View style={[styles.headRow, { columnGap: dp(8) }]}>
        <View style={[styles.headText, { rowGap: dp(2) }]}>
          <View style={[styles.nameRow, { columnGap: dp(6) }]}>
            {/* `button` (15 dp SemiBold), not `titleCompact` (20). The price is the number that
                should dominate a plan card; at 20 dp the plan *name* was competing with it, and two
                20 dp lines per card is what made three cards overflow the screen. */}
            <EntryAuthText token="button" color={subscriptionColors.textPrimary}>
              {name}
            </EntryAuthText>
            {badge === undefined ? null : (
              <PlanBadge
                label={badge.label}
                accessibilityLabel={badge.accessibilityLabel}
                testID={`${testID ?? `plan-${plan}`}-badge`}
              />
            )}
          </View>
          <EntryAuthText token="caption" color={subscriptionColors.textSecondary}>
            {tagline}
          </EntryAuthText>
        </View>

        {/* The radio mark. Its border is always visible so the control reads as selectable
            before anything is chosen. */}
        <View
          style={[
            styles.check,
            {
              width: check,
              height: check,
              borderRadius: check / 2,
              borderColor: selected ? subscriptionColors.accent : subscriptionColors.border,
              backgroundColor: selected ? subscriptionColors.accent : 'transparent',
            },
          ]}
        >
          {selected ? (
            <View
              style={{
                width: dp(8),
                height: dp(4),
                borderLeftWidth: 2,
                borderBottomWidth: 2,
                borderColor: subscriptionColors.onAccent,
                transform: [{ rotate: '-45deg' }, { translateY: -dp(1) }],
              }}
            />
          ) : null}
        </View>
      </View>

      {priceSlot}
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    width: '100%',
  },
  headRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  headText: {
    flex: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  check: {
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
