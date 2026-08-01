import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { authRoutes, globalRoutes } from '@application/navigation/routes';
import { useAuth } from '@application/providers/auth-provider';
import { EntryAuthText } from '@features/entry-auth/components/entry-auth-text';
import { PrimaryButton } from '@features/entry-auth/components/primary-button';
import { SecondaryButton } from '@features/entry-auth/components/secondary-button';
import { useEntryAuthMetrics } from '@features/entry-auth/use-entry-auth-metrics';
import { PlanBadge } from '@features/subscription/components/plan-badge';
import { RestorePurchasesButton } from '@features/subscription/components/restore-purchases-button';
import { SubscriptionStateBanner } from '@features/subscription/components/subscription-states';
import { canUseSharedFamily } from '@features/subscription/domain/entitlement';
import { describeRestoreOutcome } from '@features/subscription/domain/restore-outcome';
import {
  useEntitlement,
  useEntitlementActions,
} from '@features/subscription/services/entitlement-context';
import type { RestoreOutcome } from '@features/subscription/services/purchase-adapter';
import { familyPlanCopy, singlePlanCopy } from '@features/subscription/subscription-copy';
import { subscriptionColors } from '@features/subscription/subscription-tokens';
import { subscriptionRoutes } from '@features/subscription/subscription-routes';

import { ComingLaterSheet } from '../components/coming-later-sheet';
import { ProfileDetailCard, ProfileDetailRow } from '../components/profile-detail-card';
import { ProfileDetailScaffold } from '../components/profile-detail-scaffold';
import { ProfileSkeletonBar } from '../components/profile-skeleton-bar';
import { familyMembershipPresentation } from '../family-membership-presentation';
import { useLoadTimeout } from '../hooks/use-load-timeout';
import { profileCopy } from '../profile-copy';
import { PROFILE_LAYOUT } from '../profile-metrics';
import { ComingLaterProvider, useComingLaterActions } from '../services/coming-later-context';

/**
 * How long an unresolved entitlement is treated as "loading" before it is treated as "failed".
 *
 * The same six seconds compact Profile Home allows, for the same reason: the entitlement provider
 * reports no error — a failed refresh simply leaves the plan at `unknown` — so time is the only
 * signal available, and a retry offered at two seconds would fire on any slow connection.
 */
const ENTITLEMENT_GRACE_MS = 6000;

/**
 * Family & Membership — `/profile/family-membership`.
 *
 * ── What is real on this screen ─────────────────────────────────────────────
 * The plan, its billing period, its renewal date and — on the Family plan — the seat count, all
 * from the entitlement provider. The organizer's name, but only when the signed-in user *is* the
 * organizer, because that is the one family identity the session actually knows.
 *
 * ── What is deliberately absent ─────────────────────────────────────────────
 * The roster. There is no family table and no invitation service: the in-memory store the
 * `/family/*` screens use is a development fixture with a hardcoded organizer, so reading it here
 * would present invented people as this user's family. The screen therefore states the missing
 * contract in a sentence and offers no member list, no seat avatars and no invitation rows.
 *
 * "Manage Family" follows from the same fact. There is a *route* at `/family/members`, but no
 * service behind it, so the control opens the centralized Coming Later note rather than a screen
 * that would show a fixture as though it were the user's family. Manage Plan and Restore Purchases
 * both remain available, because both are real.
 *
 * ── Purchases ───────────────────────────────────────────────────────────────
 * Nothing here writes an entitlement. View Premium Plans opens the existing chooser, Manage Plan
 * opens the existing management destination, and Restore runs the existing entitlement service and
 * reports whatever it returned — including its failures, in the service's own words.
 */
export function FamilyMembershipScreen() {
  return (
    <ComingLaterProvider>
      <FamilyMembershipBody />
      <ComingLaterSheet testID="family-membership-coming-later" />
    </ComingLaterProvider>
  );
}

function FamilyMembershipBody() {
  const router = useRouter();
  const { dp } = useEntryAuthMetrics();

  const { status, user } = useAuth();
  const { entitlement, isResolved, isBusy, seatUsage, isMockMode } = useEntitlement();
  const { refresh, refreshSeatUsage, restore } = useEntitlementActions();
  const { showComingLater } = useComingLaterActions();

  const [restoreOutcome, setRestoreOutcome] = useState<RestoreOutcome | null>(null);
  // An entitlement that has not resolved after the grace period is treated as a failed load.
  const entitlementUnavailable = useLoadTimeout(!isResolved, ENTITLEMENT_GRACE_MS);

  useEffect(() => {
    if (status !== 'signed-out') {
      return;
    }
    if (router.canDismiss()) {
      router.dismissAll();
    }
    router.replace(authRoutes.welcome);
  }, [router, status]);

  const hasFamily = canUseSharedFamily(entitlement);
  useEffect(() => {
    if (!hasFamily) {
      return;
    }
    // A failed read leaves `seatUsage` null, which this screen renders as *no* seat line rather
    // than as a guessed one.
    void refreshSeatUsage().catch(() => undefined);
  }, [hasFamily, refreshSeatUsage]);

  const runRestore = useCallback(async () => {
    setRestoreOutcome(null);
    // The existing entitlement service. Its result is reported verbatim — a failure is rendered as
    // a failure, and nothing here invents a success.
    const result = await restore().catch((): { outcome: RestoreOutcome } => ({ outcome: 'error' }));
    setRestoreOutcome(result.outcome);
  }, [restore]);

  if (status === 'signed-out') {
    return <View style={styles.blank} testID="family-membership-signed-out" />;
  }

  const detail = profileCopy.membershipDetail;
  const presentation = isResolved
    ? familyMembershipPresentation(entitlement, seatUsage, user?.fullName ?? null)
    : null;
  const restorePresentation = describeRestoreOutcome(restoreOutcome, entitlement.plan);

  const back = () => router.dismissTo(globalRoutes.profile);

  /**
   * Still resolving, or failed.
   *
   * Neither state is allowed to draw a plan. The skeleton and the failure card are rendered at the
   * same width and inside the same scaffold, so resolving does not move the page.
   */
  if (presentation === null) {
    return (
      <ProfileDetailScaffold
        title={detail.title}
        onBack={back}
        backLabel={profileCopy.detail.backToProfile}
        testID="family-membership"
      >
        {entitlementUnavailable ? (
          <ProfileDetailCard testID="family-membership-unavailable">
            <EntryAuthText
              token="button"
              color={subscriptionColors.textPrimary}
              testID="family-membership-unavailable-title"
            >
              {detail.unavailable}
            </EntryAuthText>
            <EntryAuthText
              token="caption"
              color={subscriptionColors.textSecondary}
              testID="family-membership-unavailable-supporting"
            >
              {detail.unavailableSupporting}
            </EntryAuthText>
            <PrimaryButton
              label={detail.retry}
              onPress={() => void refresh().catch(() => undefined)}
              testID="family-membership-retry"
            />
          </ProfileDetailCard>
        ) : (
          <ProfileDetailCard style={styles.loadingCard} testID="family-membership-loading">
            <View
              accessible
              accessibilityLabel={detail.loadingAccessibilityLabel}
              style={{ rowGap: dp(10) }}
            >
              <ProfileSkeletonBar height={17} width={96} />
              <ProfileSkeletonBar height={21} width={148} />
              <ProfileSkeletonBar height={16} width="100%" />
            </View>
          </ProfileDetailCard>
        )}
      </ProfileDetailScaffold>
    );
  }

  return (
    <ProfileDetailScaffold
      title={detail.title}
      onBack={back}
      backLabel={profileCopy.detail.backToProfile}
      testID="family-membership"
      footer={
        <View style={{ rowGap: dp(8) }}>
          <PrimaryButton
            label={presentation.primaryLabel}
            onPress={() =>
              router.push(
                entitlement.plan === 'free'
                  ? subscriptionRoutes.welcome
                  : subscriptionRoutes.manage,
              )
            }
            testID="family-membership-primary"
          />
          {presentation.showRestore ? (
            <RestorePurchasesButton
              onPress={() => void runRestore()}
              busy={isBusy}
              testID="family-membership-restore"
            />
          ) : null}
        </View>
      }
    >
      {/* The plan itself. Only facts the provider actually reported get a row. */}
      <ProfileDetailCard testID="family-membership-plan">
        <View style={[styles.titleRow, { columnGap: dp(8) }]}>
          <View style={[styles.planText, { rowGap: dp(2) }]}>
            <EntryAuthText token="label">{detail.currentPlanLabel}</EntryAuthText>
            <EntryAuthText
              token="titleCompact"
              color={subscriptionColors.textPrimary}
              testID="family-membership-plan-name"
            >
              {presentation.planName}
            </EntryAuthText>
          </View>

          {/* Development only: `__DEV__` is checked here so a release bundle cannot render it
              however the adapter reports itself. */}
          {isMockMode && __DEV__ ? (
            <PlanBadge
              label={profileCopy.membership.devBadge}
              tone="warning"
              accessibilityLabel={profileCopy.membership.devBadgeAccessibilityLabel}
              testID="family-membership-dev-badge"
            />
          ) : null}
        </View>

        <EntryAuthText
          token="caption"
          color={subscriptionColors.textSecondary}
          testID="family-membership-supporting"
        >
          {presentation.supporting}
        </EntryAuthText>

        {presentation.billingPeriod === null ? null : (
          <EntryAuthText
            token="caption"
            color={subscriptionColors.textSecondary}
            testID="family-membership-billing-period"
          >
            {presentation.billingPeriod}
          </EntryAuthText>
        )}

        {presentation.renewal === null ? null : (
          <EntryAuthText
            token="caption"
            color={subscriptionColors.textSecondary}
            testID="family-membership-renewal"
          >
            {presentation.renewal}
          </EntryAuthText>
        )}
      </ProfileDetailCard>

      {/* Free: what the two paid plans are, and what Family's six accounts mean. No prices —
          those belong to the chooser, which owns the store's own figures. */}
      {presentation.showPlanSummaries ? (
        <ProfileDetailCard heading={detail.plans.heading} testID="family-membership-plan-summaries">
          <ProfileDetailRow
            label={detail.plans.singleTitle}
            value={singlePlanCopy.tagline}
            testID="family-membership-single-summary"
          />
          <ProfileDetailRow
            label={detail.plans.familyTitle}
            value={familyPlanCopy.tagline}
            supporting={detail.capacity}
            testID="family-membership-family-summary"
          />
        </ProfileDetailCard>
      ) : null}

      {/* Premium Single: the route up, stated in accounts rather than features. */}
      {presentation.showFamilyUpgrade ? (
        <ProfileDetailCard heading={detail.plans.familyTitle} testID="family-membership-upgrade">
          <EntryAuthText
            token="caption"
            color={subscriptionColors.textSecondary}
            testID="family-membership-family-adds"
          >
            {detail.single.familyAdds}
          </EntryAuthText>
          <EntryAuthText
            token="caption"
            color={subscriptionColors.textSecondary}
            testID="family-membership-upgrade-capacity"
          >
            {detail.capacity}
          </EntryAuthText>
          <SecondaryButton
            label={detail.single.viewFamily}
            // Carries the period the user is already billed on, so Family opens on the offer that
            // matches their current plan rather than resetting their choice.
            onPress={() =>
              router.push(
                subscriptionRoutes.family(
                  entitlement.billingPeriod === 'monthly' ? 'monthly' : 'yearly',
                ),
              )
            }
            testID="family-membership-view-family"
          />
        </ProfileDetailCard>
      ) : null}

      {/* Premium Family: real seat facts where they exist, and the missing contract stated where
          the roster would be. */}
      {presentation.showFamilySection ? (
        <ProfileDetailCard
          heading={detail.family.membersHeading}
          testID="family-membership-family-section"
        >
          {presentation.organizerName === null ? null : (
            <ProfileDetailRow
              label={detail.family.organizerLabel}
              value={presentation.organizerName}
              testID="family-membership-organizer"
            />
          )}

          {presentation.seats === null ? null : (
            <EntryAuthText
              token="body"
              color={subscriptionColors.textPrimary}
              testID="family-membership-seats"
            >
              {presentation.seats}
            </EntryAuthText>
          )}

          {presentation.pendingInvitations === null ? null : (
            <EntryAuthText
              token="caption"
              color={subscriptionColors.textSecondary}
              testID="family-membership-pending"
            >
              {presentation.pendingInvitations}
            </EntryAuthText>
          )}

          <EntryAuthText
            token="caption"
            color={subscriptionColors.textSecondary}
            testID="family-membership-backend-missing"
          >
            {detail.backendMissing}
          </EntryAuthText>

          <SecondaryButton
            label={detail.family.manageFamily}
            // No family service exists, so this explains rather than opening a fixture.
            onPress={() =>
              showComingLater({
                feature: detail.family.manageFamily,
                intendedRoute: '/family/members',
              })
            }
            testID="family-membership-manage-family"
          />
        </ProfileDetailCard>
      ) : null}

      {restorePresentation === null ? null : (
        <View style={{ rowGap: dp(6) }} testID="family-membership-restore-result">
          <SubscriptionStateBanner
            tone={restorePresentation.tone}
            message={restorePresentation.title}
            testID={`family-membership-restore-${restoreOutcome ?? 'none'}`}
          />
          <EntryAuthText token="caption" color={subscriptionColors.textSecondary}>
            {restorePresentation.body}
          </EntryAuthText>
        </View>
      )}
    </ProfileDetailScaffold>
  );
}

const styles = StyleSheet.create({
  blank: {
    flex: 1,
    backgroundColor: subscriptionColors.pageBackground,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  planText: {
    flexShrink: 1,
  },
  /**
   * The loading card holds the resolved card's height.
   *
   * A label, a plan name and a supporting line, plus the card's own padding — so the entitlement
   * arriving fills the box rather than growing it.
   */
  loadingCard: {
    minHeight: PROFILE_LAYOUT.membership.height,
  },
});
