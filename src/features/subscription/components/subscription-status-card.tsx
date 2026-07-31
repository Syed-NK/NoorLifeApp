import { StyleSheet, View } from 'react-native';

import { EntryAuthText } from '@features/entry-auth/components/entry-auth-text';
import { useEntryAuthMetrics } from '@features/entry-auth/use-entry-auth-metrics';

import type { Entitlement } from '../domain/entitlement';
import { formatRenewalDate } from '../domain/pricing';
import { providerStoreName, statusGrantsPaidAccess } from '../domain/subscription';
import {
  billingCopy,
  manageCopy,
  planNames,
  renewalCopy,
  statusLabels,
} from '../subscription-copy';
import { subscriptionColors, subscriptionLayout } from '../subscription-tokens';
import { PlanBadge } from './plan-badge';

export type SubscriptionStatusCardProps = {
  readonly entitlement: Entitlement;
  readonly testID?: string;
};

/**
 * The current subscription, stated as facts in rows.
 *
 * ── Why a plain row list ────────────────────────────────────────────────────
 * This is the screen a user opens when they want to know what they are paying and when. A
 * marketing-styled card would be the wrong instrument; labelled rows can be read in any order and
 * translate cleanly to a screen reader.
 *
 * The renewal line changes wording rather than being omitted when a subscription is cancelled but
 * still running — "Cancelled. Paid access continues until 12 August 2026." is the fact, and
 * hiding it would leave the user thinking access had already stopped.
 */
export function SubscriptionStatusCard({ entitlement, testID }: SubscriptionStatusCardProps) {
  const { dp } = useEntryAuthMetrics();
  const periodEnd = formatRenewalDate(entitlement.currentPeriodEnd);

  const renewalLine = (() => {
    if (periodEnd === null) {
      return null;
    }
    if (entitlement.cancelAtPeriodEnd) {
      return renewalCopy.cancelledButActive(periodEnd);
    }
    return statusGrantsPaidAccess(entitlement.status)
      ? renewalCopy.renewsOn(periodEnd)
      : renewalCopy.expiresOn(periodEnd);
  })();

  return (
    <View
      style={[
        styles.card,
        {
          padding: dp(subscriptionLayout.cardPadding),
          borderRadius: dp(subscriptionLayout.cardRadius),
          rowGap: dp(subscriptionLayout.rowGap),
          backgroundColor: subscriptionColors.surface,
          borderColor: subscriptionColors.border,
        },
      ]}
      testID={testID}
    >
      <Row
        label={manageCopy.currentPlan}
        value={planNames[entitlement.plan]}
        testID={`${testID ?? 'status'}-plan`}
      />
      <Row
        label={manageCopy.status}
        value={statusLabels[entitlement.status]}
        badgeTone={statusGrantsPaidAccess(entitlement.status) ? 'success' : 'warning'}
        testID={`${testID ?? 'status'}-status`}
      />
      {entitlement.billingPeriod === 'none' ? null : (
        <Row
          label={manageCopy.billingPeriod}
          value={
            entitlement.billingPeriod === 'yearly'
              ? billingCopy.billedYearly
              : billingCopy.billedMonthly
          }
          testID={`${testID ?? 'status'}-period`}
        />
      )}
      <Row
        label={manageCopy.store}
        value={providerStoreName(entitlement.provider)}
        testID={`${testID ?? 'status'}-provider`}
      />
      {renewalLine === null ? null : (
        <EntryAuthText
          token="caption"
          color={subscriptionColors.textSecondary}
          testID={`${testID ?? 'status'}-renewal`}
        >
          {renewalLine}
        </EntryAuthText>
      )}
    </View>
  );
}

type RowProps = {
  readonly label: string;
  readonly value: string;
  readonly badgeTone?: 'success' | 'warning';
  readonly testID: string;
};

function Row({ label, value, badgeTone, testID }: RowProps) {
  const { dp } = useEntryAuthMetrics();

  return (
    // One accessible node per row, so a screen reader reads "Current plan, Premium Family"
    // instead of two disconnected fragments.
    <View
      style={[styles.row, { columnGap: dp(10) }]}
      accessible
      accessibilityLabel={`${label}, ${value}`}
      testID={testID}
    >
      <EntryAuthText token="caption" color={subscriptionColors.textSecondary}>
        {label}
      </EntryAuthText>
      {badgeTone === undefined ? (
        <EntryAuthText token="label" color={subscriptionColors.textPrimary} style={styles.value}>
          {value}
        </EntryAuthText>
      ) : (
        <PlanBadge label={value} tone={badgeTone} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: '100%',
    borderWidth: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  value: {
    flexShrink: 1,
    textAlign: 'right',
  },
});
