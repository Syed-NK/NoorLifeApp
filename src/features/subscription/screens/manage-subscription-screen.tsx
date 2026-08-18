import { useRouter } from 'expo-router';
import { View } from 'react-native';

import { EntryAuthText } from '@features/entry-auth/components/entry-auth-text';
import { PrimaryButton } from '@features/entry-auth/components/primary-button';
import { SecondaryButton } from '@features/entry-auth/components/secondary-button';
import { useEntryAuthMetrics } from '@features/entry-auth/use-entry-auth-metrics';

import { RestorePurchasesButton } from '../components/restore-purchases-button';
import { SubscriptionScreenScaffold } from '../components/subscription-screen-scaffold';
import { SubscriptionStateBanner } from '../components/subscription-states';
import { SubscriptionStatusCard } from '../components/subscription-status-card';
import { hasPremiumAccess } from '../domain/entitlement';
import {
  providerHasManagementSurface,
  providerStoreName,
  statusIsBillingProblem,
} from '../domain/subscription';
import { useEntitlement, useEntitlementActions } from '../services/entitlement-context';
import { billingIssueCopy, manageCopy } from '../subscription-copy';
import { subscriptionColors, subscriptionLayout } from '../subscription-tokens';
import { familyRoutes, subscriptionRoutes } from '../subscription-routes';

/**
 * Screen 09 — Manage Subscription, at `/settings/subscription`.
 *
 * ── What NoorLife can and cannot do ─────────────────────────────────────────
 * It cannot cancel an Apple or Google subscription. So there is no "Cancel subscription" button
 * here — there is a hand-off to the store and a plain explanation of what cancelling does. The
 * brief is explicit that claiming otherwise is forbidden, and a disabled cancel button would
 * imply the capability exists.
 *
 * `providerHasManagementSurface` decides whether the hand-off appears at all. On the development
 * mock there is nowhere to go, so the button is replaced by a sentence saying so rather than
 * opening nothing.
 */
export function ManageSubscriptionScreen() {
  const router = useRouter();
  const { dp } = useEntryAuthMetrics();
  const { entitlement, isBusy, isMockMode } = useEntitlement();
  const { openStoreManagement } = useEntitlementActions();

  const storeName = providerStoreName(entitlement.provider);
  const canManageInStore = providerHasManagementSurface(entitlement.provider);
  const isPaid = entitlement.plan !== 'free';
  const isFamily = entitlement.plan === 'premium_family';

  return (
    <SubscriptionScreenScaffold
      title={manageCopy.heading}
      onBack={() => router.back()}
      isMockMode={isMockMode}
      footer={
        <View style={{ rowGap: dp(8) }}>
          {isPaid ? null : (
            <PrimaryButton
              label="See plans"
              onPress={() => router.push(subscriptionRoutes.welcome)}
              testID="manage-see-plans"
            />
          )}
          <RestorePurchasesButton
            onPress={() => router.push(subscriptionRoutes.restore)}
            busy={isBusy}
            testID="manage-restore"
          />
        </View>
      }
      testID="manage-subscription"
    >
      <View style={{ rowGap: dp(subscriptionLayout.cardGap) }}>
        {statusIsBillingProblem(entitlement.status) ? (
          <SubscriptionStateBanner
            tone={entitlement.status === 'grace_period' ? 'warning' : 'error'}
            message={billingIssueCopy[entitlement.status].heading}
            testID="manage-problem-banner"
          />
        ) : null}

        <SubscriptionStatusCard entitlement={entitlement} testID="manage-status" />

        {/* Upgrade and billing-period changes. Offered only where they mean something: a free
            user upgrades, a paying user switches period or moves up to Family. */}
        <View style={{ rowGap: dp(8) }}>
          {entitlement.plan === 'premium_single' ? (
            <SecondaryButton
              label="Upgrade to Premium Family"
              onPress={() =>
                router.push(
                  subscriptionRoutes.family(
                    entitlement.billingPeriod === 'monthly' ? 'monthly' : 'yearly',
                  ),
                )
              }
              testID="manage-upgrade"
            />
          ) : null}

          {isPaid ? (
            <SecondaryButton
              label={
                entitlement.billingPeriod === 'monthly'
                  ? manageCopy.switchToYearly
                  : manageCopy.switchToMonthly
              }
              onPress={() =>
                router.push(
                  entitlement.plan === 'premium_family'
                    ? subscriptionRoutes.family(
                        entitlement.billingPeriod === 'monthly' ? 'yearly' : 'monthly',
                      )
                    : subscriptionRoutes.single(
                        entitlement.billingPeriod === 'monthly' ? 'yearly' : 'monthly',
                      ),
                )
              }
              testID="manage-switch-period"
            />
          ) : null}

          {isFamily && hasPremiumAccess(entitlement) ? (
            <SecondaryButton
              label="Manage family members"
              onPress={() => router.push(familyRoutes.members)}
              testID="manage-family"
            />
          ) : null}

          {canManageInStore ? (
            <SecondaryButton
              label={manageCopy.manageInStore(storeName)}
              onPress={() => void openStoreManagement()}
              testID="manage-in-store"
            />
          ) : (
            <EntryAuthText
              token="caption"
              color={subscriptionColors.textSecondary}
              testID="manage-no-store"
            >
              {manageCopy.noManagementSurface}
            </EntryAuthText>
          )}
        </View>

        {/* Cancellation guidance, stated rather than offered as an action NoorLife cannot perform. */}
        {isPaid ? (
          <EntryAuthText
            token="caption"
            color={subscriptionColors.textSecondary}
            testID="manage-cancel-guidance"
          >
            {manageCopy.cancelGuidance}
          </EntryAuthText>
        ) : null}
      </View>
    </SubscriptionScreenScaffold>
  );
}
