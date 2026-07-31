import { StyleSheet, View } from 'react-native';

import { EntryAuthText } from '@features/entry-auth/components/entry-auth-text';
import { useEntryAuthMetrics } from '@features/entry-auth/use-entry-auth-metrics';

import type { BillingPeriod } from '../domain/subscription';
import type { LocalizedPrice as PriceValue } from '../domain/pricing';
import { billingCopy } from '../subscription-copy';
import { subscriptionColors } from '../subscription-tokens';

export type LocalizedPriceProps = {
  readonly price: PriceValue;
  readonly billingPeriod: Extract<BillingPeriod, 'monthly' | 'yearly'>;
  /** The yearly price restated per month, shown beneath as a like-for-like comparison. */
  readonly perMonthEquivalent?: PriceValue;
  readonly testID?: string;
};

/**
 * A price with its billing frequency.
 *
 * ── The frequency is never separable from the number ────────────────────────
 * The accessibility requirements say prices must be read with their billing frequency, and the
 * commercial rules say every recurring offer must show it. So the amount and the period are one
 * accessible node — "AED 189.99 per year" — rather than two adjacent texts a screen reader would
 * read as unrelated fragments, or worse, read the number and stop.
 *
 * ── Fallback prices are marked ─────────────────────────────────────────────
 * When `source` is `fallback` the store has not answered yet, so the figure is a design default
 * and is labelled approximate. Presenting it as the user's real price would be a claim the store
 * contradicts at checkout.
 */
export function LocalizedPrice({
  price,
  billingPeriod,
  perMonthEquivalent,
  testID,
}: LocalizedPriceProps) {
  const { dp } = useEntryAuthMetrics();
  const periodWord = billingPeriod === 'yearly' ? billingCopy.perYear : billingCopy.perMonth;
  const spoken = `${price.formatted} ${periodWord}`;

  return (
    <View style={{ rowGap: dp(2) }} testID={testID}>
      <View style={[styles.row, { columnGap: dp(4) }]} accessible accessibilityLabel={spoken}>
        <EntryAuthText token="title" color={subscriptionColors.textPrimary}>
          {price.formatted}
        </EntryAuthText>
        <EntryAuthText token="label" color={subscriptionColors.textSecondary}>
          {periodWord}
        </EntryAuthText>
      </View>

      {perMonthEquivalent === undefined ? null : (
        <EntryAuthText token="caption" color={subscriptionColors.textSecondary}>
          {billingCopy.equivalentPerMonth(perMonthEquivalent.formatted)}
        </EntryAuthText>
      )}

      {price.source === 'fallback' ? (
        <EntryAuthText
          token="caption"
          color={subscriptionColors.textSecondary}
          testID={`${testID ?? 'price'}-approximate`}
        >
          {billingCopy.approximate}
        </EntryAuthText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'baseline',
    flexWrap: 'wrap',
  },
});
