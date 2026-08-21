import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { globalRoutes } from '@application/navigation/routes';
import { EntryAuthText } from '@features/entry-auth/components/entry-auth-text';
import { PrimaryButton } from '@features/entry-auth/components/primary-button';
import { SecondaryButton } from '@features/entry-auth/components/secondary-button';
import { useEntryAuthMetrics } from '@features/entry-auth/use-entry-auth-metrics';
import { getModulePictogram } from '@features/home/module-pictograms';

import { BillingPeriodToggle } from '../components/billing-period-toggle';
import {
  RenewalDisclosure,
  SubscriptionLegalLinks,
  TrialDisclosure,
} from '../components/disclosures';
import { FamilySeatRow } from '../components/family-membership';
import { LocalizedPrice } from '../components/localized-price';
import { PlanFeatureRow } from '../components/plan-feature-row';
import { RestorePurchasesButton } from '../components/restore-purchases-button';
import { SubscriptionScreenScaffold } from '../components/subscription-screen-scaffold';
import {
  SubscriptionErrorState,
  SubscriptionLoadingState,
} from '../components/subscription-states';
import { formatRenewalDate, yearlyPerMonth } from '../domain/pricing';
import { projectedTrialEnd } from '../domain/trial-period';
import { useEntitlement } from '../services/entitlement-context';
import {
  billingCopy,
  familyPlanCopy,
  familyWording,
  singlePlanCopy,
  welcomeCopy,
} from '../subscription-copy';
import { subscriptionColors, subscriptionLayout } from '../subscription-tokens';
import { subscriptionRoutes, type PeriodParam } from '../subscription-routes';
import { usePlanOffers } from '../use-plan-offers';

export type PlanDetailsScreenProps = {
  readonly plan: 'premium_single' | 'premium_family';
  readonly initialPeriod: PeriodParam;
};

/**
 * Screens 03 and 04 — Premium Single and Premium Family details.
 *
 * ── Why one component for both ──────────────────────────────────────────────
 * The two screens are the same layout: identity pictogram, period selector, price, trial terms,
 * full benefit list, purchase CTA, Continue with Free, Restore. Only the content differs, plus
 * the family-only seat row and privacy explanation. Building them separately would guarantee they
 * drift — one would gain a disclosure the other lacked, and the renewal small print is exactly
 * the thing that must not be inconsistent between two paywalls.
 *
 * ── The pictogram is an approved PNG ────────────────────────────────────────
 * Family uses the locked Family pictogram; Single uses the Noor AI robot, since there is no
 * "single user" asset in the approved set and inventing one is forbidden. Both come from
 * `getModulePictogram`, which throws rather than substituting a glyph if an asset is missing.
 */
export function PlanDetailsScreen({ plan, initialPeriod }: PlanDetailsScreenProps) {
  const router = useRouter();
  const { dp } = useEntryAuthMetrics();
  const { isMockMode } = useEntitlement();
  const offers = usePlanOffers();

  /**
   * The billing period, with the route parameter as the source of truth on entry.
   *
   * ── Why this is not plain `useState(initialPeriod)` ─────────────────────────
   * It was, and that was a bug. `useState` reads its initial value once per *mount*, but navigating
   * to this screen again with a different `period` reuses the mounted instance — so the parameter
   * changed and the toggle did not. Two paths hit it: a deep link to
   * `/subscription/single?period=monthly` while the yearly screen was open, and Manage's "Switch
   * billing period", whose whole job is to arrive here with the other period. It surfaced as two
   * byte-identical monthly/yearly screenshots.
   *
   * Derived rather than synchronised in an effect: the override records which parameter it belongs
   * to, so a new parameter invalidates it automatically. No effect, no cascading render, and no
   * setState-in-effect for the lint rules to reject.
   */
  const [override, setOverride] = useState<{
    readonly period: PeriodParam;
    readonly forParam: PeriodParam;
  } | null>(null);
  const period =
    override !== null && override.forParam === initialPeriod ? override.period : initialPeriod;
  const setPeriod = (next: PeriodParam) => setOverride({ period: next, forParam: initialPeriod });

  const isFamily = plan === 'premium_family';
  const copy = isFamily ? familyPlanCopy : singlePlanCopy;
  const offer = offers.offerFor(plan, period);
  const yearlyOffer = offers.offerFor(plan, 'yearly');

  const continueFree = () => router.replace(globalRoutes.home);

  const footer = (
    <View style={{ rowGap: dp(8) }}>
      <PrimaryButton
        label={`Continue with ${copy.name}`}
        onPress={() => router.push(subscriptionRoutes.confirm(plan, period))}
        disabled={offer === undefined}
        testID="plan-details-purchase"
      />
      <SecondaryButton
        label={welcomeCopy.continueFree}
        onPress={continueFree}
        testID="plan-details-free"
      />
      <RestorePurchasesButton
        onPress={() => router.push(subscriptionRoutes.restore)}
        testID="plan-details-restore"
      />
      <SubscriptionLegalLinks testID="plan-details-legal" />
    </View>
  );

  return (
    <SubscriptionScreenScaffold
      title={copy.name}
      subtitle={isFamily ? familyWording.headline : singlePlanCopy.tagline}
      onBack={() => router.back()}
      isMockMode={isMockMode}
      footer={footer}
      testID={isFamily ? 'plan-details-family' : 'plan-details-single'}
    >
      {offers.isLoading ? (
        <SubscriptionLoadingState message="Loading plan…" testID="plan-details-loading" />
      ) : offer === undefined ? (
        <SubscriptionErrorState
          title="This plan is unavailable"
          body={offers.error ?? 'We could not load this plan right now.'}
          actionLabel="Try again"
          onAction={() => void offers.reload()}
          secondaryLabel={welcomeCopy.continueFree}
          onSecondary={continueFree}
          testID="plan-details-error"
        />
      ) : (
        <View style={{ rowGap: dp(subscriptionLayout.cardGap) }}>
          {/* Family gets 104 dp, Single 72. Same asset treatment — `contain`, no tint, no crop —
              but the Family mark introduces a six-seat product and was reading as a list icon
              stranded in whitespace at 72. Grouped with the seat row below rather than floating
              above the toggle, so artwork and seats read as one block. */}
          {isFamily ? (
            <View style={[styles.familyIdentity, { rowGap: dp(6) }]}>
              <Image
                source={getModulePictogram('family')}
                style={[
                  styles.identity,
                  {
                    width: dp(subscriptionLayout.familyIdentityImage),
                    height: dp(subscriptionLayout.familyIdentityImage),
                  },
                ]}
                contentFit="contain"
                accessible
                accessibilityRole="image"
                accessibilityLabel="Premium Family"
                testID="plan-details-pictogram"
              />
              <FamilySeatRow
                usage={{ used: 1, limit: 6, pendingInvitations: 0 }}
                organizerName="You"
                showPictogram={false}
                testID="plan-details-seats"
              />
              <EntryAuthText
                token="caption"
                align="center"
                color={subscriptionColors.textSecondary}
              >
                {familyWording.supporting}
              </EntryAuthText>
            </View>
          ) : (
            <Image
              source={getModulePictogram('noor-ai')}
              style={[
                styles.identity,
                {
                  width: dp(subscriptionLayout.planIdentityImage),
                  height: dp(subscriptionLayout.planIdentityImage),
                },
              ]}
              contentFit="contain"
              accessible
              accessibilityRole="image"
              accessibilityLabel="Premium Single"
              testID="plan-details-pictogram"
            />
          )}

          <BillingPeriodToggle
            value={period}
            onChange={setPeriod}
            savingPercent={offers.savingPercentFor(plan)}
            testID="plan-details-toggle"
          />

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
          >
            <LocalizedPrice
              price={offer.price}
              billingPeriod={period}
              perMonthEquivalent={period === 'yearly' ? yearlyPerMonth(offer.price) : undefined}
              testID="plan-details-price"
            />

            {/* Trial terms appear only on yearly, and only when the store says this user is
                eligible. `trialEligibleForUser` is the store's answer, not the offer's design. */}
            {period === 'yearly' ? (
              <TrialDisclosure
                eligible={offer.trialEligibleForUser}
                priceAfterTrial={offer.price.formatted}
                renewalDate={
                  yearlyOffer === undefined
                    ? null
                    : formatRenewalDate(projectedTrialEnd(new Date()))
                }
                testID="plan-details-trial"
              />
            ) : null}

            <RenewalDisclosure
              billingPeriod={period}
              price={offer.price.formatted}
              testID="plan-details-renewal"
            />
          </View>

          {isFamily ? (
            <View style={{ rowGap: dp(subscriptionLayout.cardGap) }}>
              <ExplainerCard
                heading={familyPlanCopy.sharedHeading}
                body={familyPlanCopy.sharedBody}
                testID="plan-details-shared"
              />
              <ExplainerCard
                heading={familyPlanCopy.privacyHeading}
                body={familyPlanCopy.privacyBody}
                testID="plan-details-privacy"
              />
            </View>
          ) : null}

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
          >
            <EntryAuthText token="label" color={subscriptionColors.textPrimary}>
              {`What ${copy.name} includes`}
            </EntryAuthText>
            {copy.features.map((feature) => (
              <PlanFeatureRow
                key={feature}
                label={feature}
                testID={`plan-details-feature-${feature.toLowerCase().replace(/[^a-z]+/g, '-')}`}
              />
            ))}
          </View>

          <EntryAuthText token="caption" color={subscriptionColors.textSecondary}>
            {period === 'yearly' ? billingCopy.billedYearly : billingCopy.billedMonthly}
          </EntryAuthText>
        </View>
      )}
    </SubscriptionScreenScaffold>
  );
}

/**
 * The date a seven-day trial would first charge.
 *
 * Computed from today rather than read from the adapter, because no purchase exists yet — this is
 * a disclosure about what *would* happen. Returns null when there is no yearly offer to trial.
 */
/*
  `trialRenewalDate` was the second of three independent computations of the same date. The projection
  is now `projectedTrialEnd`, and the "is there a yearly offer" question stayed at the call site where
  it was already answered.
*/

type ExplainerCardProps = {
  readonly heading: string;
  readonly body: string;
  readonly testID: string;
};

function ExplainerCard({ heading, body, testID }: ExplainerCardProps) {
  const { dp } = useEntryAuthMetrics();

  return (
    <View
      style={[
        styles.card,
        {
          padding: dp(subscriptionLayout.cardPadding),
          borderRadius: dp(subscriptionLayout.cardRadius),
          rowGap: dp(4),
          backgroundColor: subscriptionColors.surface,
          borderColor: subscriptionColors.border,
        },
      ]}
      testID={testID}
    >
      <EntryAuthText token="label" color={subscriptionColors.textPrimary}>
        {heading}
      </EntryAuthText>
      <EntryAuthText token="caption" color={subscriptionColors.textSecondary}>
        {body}
      </EntryAuthText>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: '100%',
    borderWidth: 1,
  },
  identity: {
    alignSelf: 'center',
  },
  familyIdentity: {
    alignItems: 'center',
  },
});
