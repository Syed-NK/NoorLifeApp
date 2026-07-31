import { useRouter } from 'expo-router';
import { View } from 'react-native';

import { moduleRoutes } from '@application/navigation/routes';
import { EntryAuthText } from '@features/entry-auth/components/entry-auth-text';
import { PrimaryButton } from '@features/entry-auth/components/primary-button';
import { SecondaryButton } from '@features/entry-auth/components/secondary-button';
import { useEntryAuthMetrics } from '@features/entry-auth/use-entry-auth-metrics';

import { PlanFeatureRow } from '../components/plan-feature-row';
import { SubscriptionScreenScaffold } from '../components/subscription-screen-scaffold';
import { SubscriptionStateBanner } from '../components/subscription-states';
import { providerHasManagementSurface, providerStoreName } from '../domain/subscription';
import { useEntitlement, useEntitlementActions } from '../services/entitlement-context';
import { billingIssueCopy, expiredCopy } from '../subscription-copy';
import { subscriptionColors, subscriptionLayout } from '../subscription-tokens';
import { subscriptionRoutes } from '../subscription-routes';

/**
 * Screens 10 and 16 — Billing problem, and Subscription expired.
 *
 * One file because both answer the same user question — "what happened to my subscription, and
 * what still works?" — and both must give the same answer about Faith. Keeping them adjacent is
 * what stops one of them from forgetting the reassurance.
 */

/** Which billing states this screen has copy for. */
export type BillingIssueState =
  'grace_period' | 'account_hold' | 'expired' | 'store_unavailable' | 'paused';

export type BillingIssueScreenProps = {
  /** Overrides the entitlement's own status. Used by the screenshot harness. */
  readonly state?: BillingIssueState;
};

/**
 * Screen 10 — Billing and Renewal Problem.
 *
 * ── Faith is the headline, not a footnote ───────────────────────────────────
 * Every state on this screen carries the Faith reassurance in a success-toned banner, because
 * a user whose payment has failed is worried about losing what they use daily. The brief requires
 * the screen to explain Faith remains available; putting it in a green banner above the fold is
 * the strongest reading of that.
 */
export function BillingIssueScreen({ state }: BillingIssueScreenProps) {
  const router = useRouter();
  const { dp } = useEntryAuthMetrics();
  const { entitlement, isMockMode } = useEntitlement();
  const { openStoreManagement } = useEntitlementActions();

  const resolved: BillingIssueState =
    state ??
    (entitlement.status === 'grace_period' ||
    entitlement.status === 'account_hold' ||
    entitlement.status === 'paused' ||
    entitlement.status === 'expired'
      ? entitlement.status
      : 'store_unavailable');

  const copy = billingIssueCopy[resolved];
  const storeName = providerStoreName(entitlement.provider);
  const canManageInStore = providerHasManagementSurface(entitlement.provider);
  // In grace period the plan still works, so nothing is locked yet — say so precisely.
  const stillWorking = resolved === 'grace_period';

  return (
    <SubscriptionScreenScaffold
      title={copy.heading}
      subtitle={copy.body}
      onBack={() => router.back()}
      isMockMode={isMockMode}
      footer={
        <View style={{ rowGap: dp(8) }}>
          {canManageInStore ? (
            <PrimaryButton
              label={billingIssueCopy.fixInStore(storeName)}
              onPress={() => void openStoreManagement()}
              testID="billing-issue-fix"
            />
          ) : (
            <PrimaryButton
              label={expiredCopy.manage}
              onPress={() => router.push(subscriptionRoutes.manage)}
              testID="billing-issue-manage"
            />
          )}
          <SecondaryButton
            label={billingIssueCopy.continueToFaith}
            onPress={() => router.replace(moduleRoutes.faith.home)}
            testID="billing-issue-faith"
          />
        </View>
      }
      testID="billing-issue"
    >
      <View style={{ rowGap: dp(subscriptionLayout.cardGap) }}>
        <SubscriptionStateBanner
          tone="success"
          message={billingIssueCopy.faithReassurance}
          testID="billing-issue-faith-banner"
        />

        <View style={{ rowGap: dp(subscriptionLayout.rowGap) }}>
          <PlanFeatureRow label="Faith, in full" included testID="billing-issue-faith-row" />
          <PlanFeatureRow label="Main Home" included />
          <PlanFeatureRow
            label="Health, Planner, Finance, Learning, Family, Goals"
            included={stillWorking}
            testID="billing-issue-premium-row"
          />
        </View>

        <EntryAuthText token="caption" color={subscriptionColors.textSecondary}>
          {expiredCopy.dataBody}
        </EntryAuthText>
      </View>
    </SubscriptionScreenScaffold>
  );
}

/**
 * Screen 16 — Subscription Expired.
 *
 * Three facts, in the order that matters to the user: what is locked, what still works, and that
 * nothing was deleted. Renewing is the primary action, but continuing to Faith is offered with
 * equal prominence — a user who does not want to pay again is not stuck on this screen.
 */
export function SubscriptionExpiredScreen() {
  const router = useRouter();
  const { dp } = useEntryAuthMetrics();
  const { isMockMode } = useEntitlement();

  return (
    <SubscriptionScreenScaffold
      title={expiredCopy.heading}
      onBack={() => router.back()}
      isMockMode={isMockMode}
      footer={
        <View style={{ rowGap: dp(8) }}>
          <PrimaryButton
            label={expiredCopy.renew}
            onPress={() => router.push(subscriptionRoutes.welcome)}
            testID="expired-renew"
          />
          <SecondaryButton
            label={expiredCopy.continueToFaith}
            onPress={() => router.replace(moduleRoutes.faith.home)}
            testID="expired-faith"
          />
          <SecondaryButton
            label={expiredCopy.manage}
            onPress={() => router.push(subscriptionRoutes.manage)}
            testID="expired-manage"
          />
        </View>
      }
      testID="subscription-expired"
    >
      <View style={{ rowGap: dp(subscriptionLayout.cardGap) }}>
        <SubscriptionStateBanner
          tone="success"
          message={expiredCopy.faithBody}
          testID="expired-faith-banner"
        />

        <EntryAuthText token="body" color={subscriptionColors.textPrimary} testID="expired-locked">
          {expiredCopy.lockedBody}
        </EntryAuthText>

        <EntryAuthText
          token="caption"
          color={subscriptionColors.textSecondary}
          testID="expired-data"
        >
          {expiredCopy.dataBody}
        </EntryAuthText>
      </View>
    </SubscriptionScreenScaffold>
  );
}
