import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { EntryAuthText } from '@features/entry-auth/components/entry-auth-text';
import { PrimaryButton } from '@features/entry-auth/components/primary-button';
import { SecondaryButton } from '@features/entry-auth/components/secondary-button';
import { useEntryAuthMetrics } from '@features/entry-auth/use-entry-auth-metrics';
import { globalRoutes } from '@application/navigation/routes';

import { BillingPeriodToggle } from '../components/billing-period-toggle';
import { LocalizedPrice } from '../components/localized-price';
import { PlanCard } from '../components/plan-card';
import { RestorePurchasesButton } from '../components/restore-purchases-button';
import { SubscriptionLegalLinks } from '../components/disclosures';
import { SubscriptionScreenScaffold } from '../components/subscription-screen-scaffold';
import {
  SubscriptionErrorState,
  SubscriptionLoadingState,
} from '../components/subscription-states';
import { yearlyPerMonth } from '../domain/pricing';
import type { SubscriptionPlan } from '../domain/subscription';
import { useEntitlement } from '../services/entitlement-context';
import {
  billingCopy,
  familyPlanCopy,
  freePlanCopy,
  singlePlanCopy,
  welcomeCopy,
} from '../subscription-copy';
import { subscriptionColors, subscriptionLayout } from '../subscription-tokens';
import { subscriptionRoutes } from '../subscription-routes';
import { usePlanOffers } from '../use-plan-offers';

/**
 * Screen 01 — Subscription Welcome.
 *
 * Reached after account creation, from Profile, and from a locked paid module.
 *
 * ── Free is a real choice, not a decline ────────────────────────────────────
 * No plan is preselected. `selected` starts as `null`, so the purchase CTA is inert until the
 * user picks something, and "Continue with Free" sits beside it as an equal-weight control rather
 * than a grey link at the bottom of the page. The brief forbids preselecting a paid plan without
 * clearly allowing Free, and the cheapest way to comply is to preselect nothing.
 *
 * The Free card is styled identically to the paid cards and carries a real feature list. It is a
 * product, not the option you are punished for taking.
 */
export function SubscriptionWelcomeScreen() {
  const router = useRouter();
  const { dp } = useEntryAuthMetrics();
  const { isMockMode } = useEntitlement();
  const offers = usePlanOffers();

  const [period, setPeriod] = useState<'monthly' | 'yearly'>('yearly');
  const [selected, setSelected] = useState<SubscriptionPlan | null>(null);

  const single = offers.offerFor('premium_single', period);
  const family = offers.offerFor('premium_family', period);

  const continueFree = () => {
    // Replaces rather than pushes: choosing Free ends the subscription flow, and Back from Main
    // Home must not return to a paywall the user has already declined.
    router.replace(globalRoutes.home);
  };

  const openSelectedPlan = () => {
    if (selected === 'premium_single') {
      router.push(subscriptionRoutes.single(period));
      return;
    }
    if (selected === 'premium_family') {
      router.push(subscriptionRoutes.family(period));
    }
  };

  const footer = (
    <View style={{ rowGap: dp(8) }}>
      <PrimaryButton
        label={selected === null ? 'Choose a plan to continue' : 'Continue'}
        onPress={openSelectedPlan}
        disabled={selected === null}
        testID="subscription-welcome-continue"
      />
      <SecondaryButton
        label={welcomeCopy.continueFree}
        onPress={continueFree}
        testID="subscription-welcome-free"
      />
      <RestorePurchasesButton
        onPress={() => router.push(subscriptionRoutes.restore)}
        testID="subscription-welcome-restore"
      />
      <SubscriptionLegalLinks testID="subscription-welcome-legal" />
    </View>
  );

  return (
    <SubscriptionScreenScaffold
      title={welcomeCopy.heading}
      subtitle={welcomeCopy.subheading}
      isMockMode={isMockMode}
      footer={footer}
      testID="subscription-welcome"
    >
      {offers.isLoading ? (
        <SubscriptionLoadingState message="Loading plans…" testID="subscription-welcome-loading" />
      ) : offers.error !== null ? (
        <SubscriptionErrorState
          title="Plans are unavailable"
          body={offers.error}
          actionLabel="Try again"
          onAction={() => void offers.reload()}
          secondaryLabel={welcomeCopy.continueFree}
          onSecondary={continueFree}
          testID="subscription-welcome-error"
        />
      ) : (
        <View style={{ rowGap: dp(subscriptionLayout.cardGap) }}>
          <BillingPeriodToggle
            value={period}
            onChange={setPeriod}
            savingPercent={offers.headlineSavingPercent}
            testID="subscription-welcome-toggle"
          />

          <PlanCard
            plan="free"
            name={freePlanCopy.name}
            tagline={freePlanCopy.tagline}
            selected={false}
            // Tapping Free takes the Free path directly. It is not a selectable "plan" to then
            // confirm — there is nothing to confirm and no payment to make.
            onPress={continueFree}
            priceSlot={
              <EntryAuthText token="titleCompact" color={subscriptionColors.textPrimary}>
                {freePlanCopy.price}
              </EntryAuthText>
            }
            badge={{ label: 'Always available' }}
            testID="plan-free"
          />

          {single === undefined ? null : (
            <PlanCard
              plan="premium_single"
              name={singlePlanCopy.name}
              tagline={singlePlanCopy.tagline}
              selected={selected === 'premium_single'}
              onPress={() => setSelected('premium_single')}
              priceSlot={
                <LocalizedPrice
                  price={single.price}
                  billingPeriod={period}
                  perMonthEquivalent={
                    period === 'yearly' ? yearlyPerMonth(single.price) : undefined
                  }
                  testID="plan-single-price"
                />
              }
              badge={
                period === 'yearly' && offers.savingPercentFor('premium_single') !== null
                  ? {
                      label: billingCopy.saveBadge(offers.savingPercentFor('premium_single') ?? 0),
                      accessibilityLabel: `Save ${offers.savingPercentFor('premium_single')}% compared with monthly billing`,
                    }
                  : undefined
              }
              testID="plan-single"
            />
          )}

          {family === undefined ? null : (
            <PlanCard
              plan="premium_family"
              name={familyPlanCopy.name}
              tagline={familyPlanCopy.tagline}
              selected={selected === 'premium_family'}
              onPress={() => setSelected('premium_family')}
              priceSlot={
                <LocalizedPrice
                  price={family.price}
                  billingPeriod={period}
                  perMonthEquivalent={
                    period === 'yearly' ? yearlyPerMonth(family.price) : undefined
                  }
                  testID="plan-family-price"
                />
              }
              badge={{ label: 'Up to 6 accounts' }}
              testID="plan-family"
            >
              <EntryAuthText token="caption" color={subscriptionColors.textSecondary}>
                {familyPlanCopy.features[1]}
              </EntryAuthText>
            </PlanCard>
          )}

          <SecondaryButton
            label={welcomeCopy.comparePlans}
            onPress={() => router.push(subscriptionRoutes.compare)}
            testID="subscription-welcome-compare"
          />
        </View>
      )}
    </SubscriptionScreenScaffold>
  );
}
