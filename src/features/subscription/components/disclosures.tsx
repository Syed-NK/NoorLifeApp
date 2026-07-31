import { StyleSheet, View } from 'react-native';

import { EntryAuthText } from '@features/entry-auth/components/entry-auth-text';
import { useEntryAuthMetrics } from '@features/entry-auth/use-entry-auth-metrics';

import { billingCopy, renewalCopy, trialCopy, welcomeCopy } from '../subscription-copy';
import { subscriptionColors } from '../subscription-tokens';

/**
 * The required small print: trial terms, renewal terms, and the legal links.
 *
 * Grouped in one file because they are one obligation. Every recurring offer must show billing
 * frequency, automatic renewal and cancellation language, and every paywall must reach Terms and
 * Privacy — so these three are always rendered together, and keeping them adjacent makes an
 * omission visible in review.
 */

export type TrialDisclosureProps = {
  /**
   * Whether the store has confirmed *this user* is eligible.
   *
   * The component renders trial terms only when this is true. It is never derived from "the offer
   * has a trial configured" — the brief forbids displaying a fake eligibility state, and a
   * returning subscriber seeing "7 days free" would be exactly that.
   */
  readonly eligible: boolean;
  /** What the user pays when the trial ends. */
  readonly priceAfterTrial: string;
  /** The date the first real charge lands. */
  readonly renewalDate: string | null;
  readonly testID?: string;
};

export function TrialDisclosure({
  eligible,
  priceAfterTrial,
  renewalDate,
  testID,
}: TrialDisclosureProps) {
  const { dp } = useEntryAuthMetrics();

  // No eligibility, or no date to renew on: say what is true rather than approximating a date.
  if (!eligible || renewalDate === null) {
    return (
      <EntryAuthText
        token="caption"
        color={subscriptionColors.textSecondary}
        testID={`${testID ?? 'trial'}-not-eligible`}
      >
        {trialCopy.notEligible}
      </EntryAuthText>
    );
  }

  return (
    <View
      style={[
        styles.panel,
        {
          padding: dp(11),
          borderRadius: dp(12),
          rowGap: dp(3),
          backgroundColor: subscriptionColors.accentSurface,
        },
      ]}
      testID={`${testID ?? 'trial'}-eligible`}
    >
      <EntryAuthText token="label" color={subscriptionColors.accent}>
        {trialCopy.heading}
      </EntryAuthText>
      <EntryAuthText token="caption" color={subscriptionColors.textPrimary}>
        {trialCopy.body(priceAfterTrial, renewalDate)}
      </EntryAuthText>
    </View>
  );
}

export type RenewalDisclosureProps = {
  readonly billingPeriod: 'monthly' | 'yearly';
  readonly price: string;
  readonly testID?: string;
};

/**
 * Automatic-renewal and cancellation language.
 *
 * Always rendered on a screen that sells something. Not collapsible, not behind a link, and not
 * in a lighter grey than the rest of the small print — the brief's "do not hide renewal
 * information" is a layout requirement, not a wording one.
 */
export function RenewalDisclosure({ billingPeriod, price, testID }: RenewalDisclosureProps) {
  const { dp } = useEntryAuthMetrics();
  const period = billingPeriod === 'yearly' ? billingCopy.billedYearly : billingCopy.billedMonthly;

  return (
    <View style={{ rowGap: dp(3) }} testID={testID}>
      <EntryAuthText token="caption" color={subscriptionColors.textSecondary}>
        {renewalCopy.autoRenews(period.toLowerCase(), price)}
      </EntryAuthText>
      <EntryAuthText token="caption" color={subscriptionColors.textSecondary}>
        {renewalCopy.cancelAnyTime}
      </EntryAuthText>
    </View>
  );
}

export type SubscriptionLegalLinksProps = {
  readonly onTerms?: () => void;
  readonly onPrivacy?: () => void;
  readonly testID?: string;
};

/** Terms and Privacy, reachable from every paywall screen. */
export function SubscriptionLegalLinks({
  onTerms,
  onPrivacy,
  testID,
}: SubscriptionLegalLinksProps) {
  return (
    <EntryAuthText token="caption" align="center" testID={testID}>
      {welcomeCopy.legalPrefix}
      <EntryAuthText
        token="caption"
        color={subscriptionColors.accent}
        accessibilityRole="link"
        onPress={onTerms}
        testID={`${testID ?? 'legal'}-terms`}
      >
        {welcomeCopy.terms}
      </EntryAuthText>
      {welcomeCopy.legalJoin}
      <EntryAuthText
        token="caption"
        color={subscriptionColors.accent}
        accessibilityRole="link"
        onPress={onPrivacy}
        testID={`${testID ?? 'legal'}-privacy`}
      >
        {welcomeCopy.privacy}
      </EntryAuthText>
    </EntryAuthText>
  );
}

const styles = StyleSheet.create({
  panel: {
    width: '100%',
  },
});
