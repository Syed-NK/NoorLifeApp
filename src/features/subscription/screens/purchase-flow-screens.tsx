import { Image } from 'expo-image';
import { Redirect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { globalRoutes } from '@application/navigation/routes';
import { EntryAuthText } from '@features/entry-auth/components/entry-auth-text';
import { PrimaryButton } from '@features/entry-auth/components/primary-button';
import { SecondaryButton } from '@features/entry-auth/components/secondary-button';
import { useEntryAuthMetrics } from '@features/entry-auth/use-entry-auth-metrics';
import { getModulePictogram } from '@features/home/module-pictograms';

import {
  RenewalDisclosure,
  SubscriptionLegalLinks,
  TrialDisclosure,
} from '../components/disclosures';
import { LocalizedPrice } from '../components/localized-price';
import { SubscriptionScreenScaffold } from '../components/subscription-screen-scaffold';
import {
  SubscriptionErrorState,
  SubscriptionLoadingState,
  SubscriptionStateBanner,
} from '../components/subscription-states';
import { formatRenewalDate, yearlyPerMonth } from '../domain/pricing';
import {
  authoritativeRenewal,
  displayableTrialEnd,
  projectedTrialEnd,
} from '../domain/trial-period';
import { providerStoreName } from '../domain/subscription';
import type { PurchaseOutcome } from '../services/purchase-adapter';
import { useEntitlement, useEntitlementActions } from '../services/entitlement-context';
import {
  clearPendingIntent,
  consumePendingIntent,
  createPendingIntent,
  type PendingPurchaseIntent,
} from '../services/purchase-intent';
import { confirmCopy, planNames, processingCopy, successCopy } from '../subscription-copy';
import { subscriptionColors, subscriptionLayout } from '../subscription-tokens';
import { familyRoutes, subscriptionRoutes, type PeriodParam } from '../subscription-routes';
import { usePlanOffers } from '../use-plan-offers';

/**
 * Screens 05, 06 and 07 — the purchase transaction.
 *
 * One file because they are one transaction seen in three states, and because the guarantee that
 * matters spans all three: **a purchase is attempted exactly once.** Splitting them invites a
 * second entry point into the same attempt.
 */

export type PurchaseConfirmScreenProps = {
  readonly plan: 'premium_single' | 'premium_family';
  readonly period: PeriodParam;
};

/**
 * Screen 05 — Purchase Confirmation.
 *
 * ── This is not a checkout ──────────────────────────────────────────────────
 * There is no card field here and there never will be. The screen restates what is about to be
 * bought and says plainly which store will take the payment, then hands off. The brief forbids
 * collecting card details inside NoorLife, and the clearest way to honour that is a screen that
 * states who does.
 */
export function PurchaseConfirmScreen({ plan, period }: PurchaseConfirmScreenProps) {
  const router = useRouter();
  const { dp } = useEntryAuthMetrics();
  const { entitlement, isMockMode } = useEntitlement();
  const offers = usePlanOffers();

  const offer = offers.offerFor(plan, period);
  const storeName = providerStoreName(entitlement.provider);

  return (
    <SubscriptionScreenScaffold
      title={confirmCopy.heading}
      subtitle={confirmCopy.body}
      onBack={() => router.back()}
      isMockMode={isMockMode}
      footer={
        <View style={{ rowGap: dp(8) }}>
          {/* The only place a purchase is authorised. Pressing this mints a one-time intent; the
              processing screen can do nothing without it. */}
          <PrimaryButton
            label={confirmCopy.confirm}
            onPress={() => {
              if (offer === undefined) {
                return;
              }
              const intent = createPendingIntent(offer.productId, plan, period);
              router.replace(subscriptionRoutes.processing(plan, period, intent.nonce));
            }}
            disabled={offer === undefined}
            testID="confirm-continue"
          />
          <SecondaryButton
            label={confirmCopy.changePlan}
            onPress={() => {
              // Backing out withdraws the authorisation rather than leaving it to be picked up.
              clearPendingIntent();
              router.back();
            }}
            testID="confirm-change"
          />
          <SubscriptionLegalLinks testID="confirm-legal" />
        </View>
      }
      testID="purchase-confirm"
    >
      {offers.isLoading ? (
        <SubscriptionLoadingState message="Loading plan…" testID="confirm-loading" />
      ) : offer === undefined ? (
        <SubscriptionErrorState
          title="This plan is unavailable"
          body="We could not confirm the price. Please choose a plan again."
          actionLabel="Back to plans"
          onAction={() => router.replace(subscriptionRoutes.welcome)}
          testID="confirm-error"
        />
      ) : (
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
          <EntryAuthText token="titleCompact" color={subscriptionColors.textPrimary}>
            {planNames[plan]}
          </EntryAuthText>

          <LocalizedPrice
            price={offer.price}
            billingPeriod={period}
            perMonthEquivalent={period === 'yearly' ? yearlyPerMonth(offer.price) : undefined}
            testID="confirm-price"
          />

          {period === 'yearly' ? (
            <TrialDisclosure
              eligible={offer.trialEligibleForUser}
              priceAfterTrial={offer.price.formatted}
              renewalDate={formatRenewalDate(projectedTrialEnd(new Date()))}
              testID="confirm-trial"
            />
          ) : null}

          <RenewalDisclosure
            billingPeriod={period}
            price={offer.price.formatted}
            testID="confirm-renewal"
          />

          <EntryAuthText
            token="caption"
            color={subscriptionColors.textSecondary}
            testID="confirm-store"
          >
            {confirmCopy.paidVia(storeName)}
          </EntryAuthText>
        </View>
      )}
    </SubscriptionScreenScaffold>
  );
}

export type PurchaseProcessingScreenProps = {
  readonly plan: 'premium_single' | 'premium_family';
  readonly period: PeriodParam;
  /** The nonce minted by Confirmation. Absent on a direct deep link. */
  readonly intentNonce?: string;
};

/** How long before the screen offers a way out rather than spinning indefinitely. */
const SLOW_PURCHASE_MS = 12000;

/**
 * Screen 06 — Purchase Processing.
 *
 * ── One attempt, guaranteed ─────────────────────────────────────────────────
 * `attempted` is a ref, not state, and it is set *before* the await. React 18 mounts effects
 * twice in development, and a state flag would not have been committed yet on the second run —
 * which is precisely how a screen like this charges someone twice. The ref is checked and set
 * synchronously, so the second invocation returns immediately.
 *
 * ── The layout does not move ────────────────────────────────────────────────
 * The robot, the heading and the spinner keep their positions for the whole wait; only the
 * message beneath changes when the wait runs long. A layout that reflows while a payment is in
 * flight reads as a fault.
 */
export function PurchaseProcessingScreen({
  plan,
  period,
  intentNonce,
}: PurchaseProcessingScreenProps) {
  const router = useRouter();
  const { dp } = useEntryAuthMetrics();
  const { isMockMode } = useEntitlement();
  const { purchase } = useEntitlementActions();
  const offers = usePlanOffers();

  /**
   * The authorisation for this screen, taken exactly once per mount.
   *
   * A ref, read during the first render rather than in an effect or a state initialiser. A state
   * initialiser can be invoked twice for one mount under StrictMode, which would consume the intent
   * on the first call and see null on the second — turning the guard into a bug that rejects
   * legitimate purchases. `undefined` means not yet attempted, `null` means no valid authorisation,
   * and a ref survives both renders of a double-invoked mount.
   */
  const intent = useRef<PendingPurchaseIntent | null | undefined>(undefined);
  if (intent.current === undefined) {
    intent.current = consumePendingIntent(intentNonce);
  }
  const authorised = intent.current;

  const attempted = useRef(false);
  const [outcome, setOutcome] = useState<PurchaseOutcome | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isSlow, setIsSlow] = useState(false);

  const offer = offers.offerFor(plan, period);

  const run = useCallback(async () => {
    // No authorisation: nothing is purchased, whatever the route parameters say.
    if (authorised === null || authorised === undefined) {
      return;
    }
    if (offer === undefined) {
      return;
    }
    // Set before awaiting: see the note above on double-mount.
    if (attempted.current) {
      return;
    }
    attempted.current = true;

    // The product comes from the *intent*, not from the route, so a crafted URL cannot point a
    // legitimate authorisation at a different product.
    const result = await purchase(authorised.productId);
    setOutcome(result.outcome);
    setMessage(result.message ?? null);

    if (result.outcome === 'purchased') {
      // Replace, so Back cannot return to a completed purchase and retry it.
      router.replace(subscriptionRoutes.success);
      return;
    }
    // Any terminal non-purchase outcome ends the authorisation; a retry mints a fresh one.
    clearPendingIntent();
  }, [authorised, offer, purchase, router]);

  useEffect(() => {
    void run();
  }, [run]);

  useEffect(() => {
    const timer = setTimeout(() => setIsSlow(true), SLOW_PURCHASE_MS);
    return () => clearTimeout(timer);
  }, []);

  const backToPlans = () => {
    clearPendingIntent();
    router.replace(subscriptionRoutes.welcome);
  };

  const retry = () => {
    // A deliberate retry re-authorises. The previous intent was spent, so mint and immediately
    // consume a fresh one rather than letting the screen run on a consumed authorisation.
    if (offer !== undefined) {
      const fresh = createPendingIntent(offer.productId, plan, period);
      intent.current = consumePendingIntent(fresh.nonce);
    }
    attempted.current = false;
    setOutcome(null);
    setMessage(null);
    setIsSlow(false);
    void run();
  };

  /**
   * Cancellation is not an error.
   *
   * It gets a neutral banner and a route back to the plans, never an error screen — the brief is
   * explicit, and treating a user's own choice as a fault is both wrong and alarming.
   */
  const cancelled = outcome === 'cancelled';
  const pending = outcome === 'pending';
  const failed = outcome !== null && outcome !== 'purchased' && !cancelled && !pending;

  // Arrived without confirming. Redirect rather than render a spinner that will never resolve —
  // and, crucially, rather than purchase.
  if (authorised === null) {
    return <Redirect href={subscriptionRoutes.welcome} />;
  }

  return (
    <SubscriptionScreenScaffold
      title={cancelled ? 'Purchase cancelled' : processingCopy.heading}
      onBack={outcome === null ? undefined : backToPlans}
      isMockMode={isMockMode}
      scrollable={false}
      footer={
        outcome === null && !isSlow ? undefined : (
          <View style={{ rowGap: dp(8) }}>
            {failed || isSlow ? (
              <PrimaryButton
                label={processingCopy.retry}
                onPress={retry}
                testID="processing-retry"
              />
            ) : null}
            <SecondaryButton
              label={processingCopy.cancel}
              onPress={backToPlans}
              testID="processing-back"
            />
          </View>
        )
      }
      testID="purchase-processing"
    >
      <View style={[styles.centred, { rowGap: dp(12), paddingTop: dp(24) }]}>
        <Image
          source={getModulePictogram('noor-ai')}
          style={{
            width: dp(subscriptionLayout.robotSize),
            height: dp(subscriptionLayout.robotSize),
          }}
          contentFit="contain"
          accessible
          accessibilityRole="image"
          accessibilityLabel="Noor AI"
          testID="processing-robot"
        />

        {outcome === null ? (
          <SubscriptionLoadingState
            message={isSlow ? processingCopy.slow : processingCopy.body}
            testID="processing-status"
          />
        ) : cancelled ? (
          <SubscriptionStateBanner
            tone="info"
            message="Nothing was charged. You can pick a plan whenever you are ready."
            testID="processing-cancelled"
          />
        ) : pending ? (
          <SubscriptionStateBanner
            tone="warning"
            message={message ?? processingCopy.body}
            testID="processing-pending"
          />
        ) : (
          <SubscriptionStateBanner
            tone="error"
            message={message ?? 'Something went wrong. Please try again.'}
            testID="processing-failed"
          />
        )}
      </View>
    </SubscriptionScreenScaffold>
  );
}

/**
 * Screen 07 — Purchase Success.
 *
 * For Family, the secondary action offers family setup and the brief requires "Do this later" to
 * remain available — so setup is offered, never forced.
 */
export function PurchaseSuccessScreen() {
  const router = useRouter();
  const { dp } = useEntryAuthMetrics();
  const { entitlement, isMockMode } = useEntitlement();

  const isFamily = entitlement.plan === 'premium_family';

  /*
    Both dates come from the entitlement the provider issued — nothing is recomputed here, and the
    trial sentence reads `trialEnd` rather than the period end it used to borrow.
    `displayableTrialEnd` also refuses a trial that does not end after this moment: the defect this
    screen had was announcing a trial end already in the past, and a value that cannot be true must go
    missing rather than be rendered confidently.
  */
  const now = useMemo(() => new Date(), []);
  const trialEnd = formatRenewalDate(displayableTrialEnd(entitlement, now));
  const renewal = formatRenewalDate(authoritativeRenewal(entitlement));
  const isTrialing = entitlement.status === 'trialing';
  const shown = isTrialing ? trialEnd : renewal;

  return (
    <SubscriptionScreenScaffold
      title={successCopy.heading}
      subtitle={successCopy.activated(planNames[entitlement.plan])}
      isMockMode={isMockMode}
      footer={
        <View style={{ rowGap: dp(8) }}>
          <PrimaryButton
            label={successCopy.start}
            onPress={() => router.replace(globalRoutes.home)}
            testID="success-start"
          />
          {isFamily ? (
            <SecondaryButton
              label={successCopy.inviteFamily}
              onPress={() => router.push(familyRoutes.setup)}
              testID="success-invite"
            />
          ) : null}
        </View>
      }
      testID="purchase-success"
    >
      <View style={[styles.centred, { rowGap: dp(12), paddingTop: dp(20) }]}>
        <Image
          source={getModulePictogram(isFamily ? 'family' : 'noor-ai')}
          style={{
            width: dp(subscriptionLayout.robotSize),
            height: dp(subscriptionLayout.robotSize),
          }}
          contentFit="contain"
          accessible
          accessibilityRole="image"
          accessibilityLabel={isFamily ? 'Premium Family' : 'Premium Single'}
          testID="success-artwork"
        />

        <SubscriptionStateBanner
          tone="success"
          message={successCopy.activated(planNames[entitlement.plan])}
          testID="success-banner"
        />

        {shown === null ? (
          /*
            No date to state. Either the provider issued none, or the one it issued could not be
            true — and the subscription is active either way, so this says what is known and stops.
            Inventing a date here is precisely the failure this screen is being fixed for.
          */
          <EntryAuthText
            token="caption"
            align="center"
            color={subscriptionColors.textSecondary}
            testID="success-no-date"
          >
            {isTrialing ? successCopy.trialDateUnknown : successCopy.renewalDateUnknown}
          </EntryAuthText>
        ) : (
          <EntryAuthText
            token="caption"
            align="center"
            color={subscriptionColors.textSecondary}
            testID="success-renewal"
          >
            {isTrialing ? `Your free trial runs until ${shown}.` : `Next billing date: ${shown}.`}
          </EntryAuthText>
        )}

        {isFamily ? (
          <EntryAuthText token="caption" align="center" color={subscriptionColors.textSecondary}>
            {successCopy.setupLater}
          </EntryAuthText>
        ) : null}
      </View>
    </SubscriptionScreenScaffold>
  );
}

/** Seven days out, for the trial disclosure on a purchase that has not happened yet. */
/*
  `sevenDaysFromNow` lived here and projected the trial end from the device clock, while the success
  screen read the entitlement, whose dates came from a fixed `now`. Two clocks, and the screens
  disagreed by however far the real date had drifted past the fixture. The projection is now
  `projectedTrialEnd`, the only one in the app.
*/

const styles = StyleSheet.create({
  card: {
    width: '100%',
    borderWidth: 1,
  },
  centred: {
    alignItems: 'center',
  },
});
