import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { globalRoutes, moduleRoutes } from '@application/navigation/routes';
import { useAuth, useAuthActions } from '@application/providers/auth-provider';
import { EntryAuthText } from '@features/entry-auth/components/entry-auth-text';
import { useEntryAuthMetrics } from '@features/entry-auth/use-entry-auth-metrics';
import { profileAvatar } from '@features/home/module-pictograms';
import { PlanBadge } from '@features/subscription/components/plan-badge';
import { formatRenewalDate } from '@features/subscription/domain/pricing';
import { canUseSharedFamily } from '@features/subscription/domain/entitlement';
import { statusGrantsPaidAccess } from '@features/subscription/domain/subscription';
import {
  useEntitlement,
  useEntitlementActions,
} from '@features/subscription/services/entitlement-context';
import { familyWording, planNames, statusLabels } from '@features/subscription/subscription-copy';
import { familyRoutes, subscriptionRoutes } from '@features/subscription/subscription-routes';
import { subscriptionColors, subscriptionLayout } from '@features/subscription/subscription-tokens';

import { profileCopy } from '../profile-copy';
import { ProfileRow, ProfileSection } from '../components/profile-row';

/**
 * The Profile home.
 *
 * Replaces the Phase 1 placeholder. Built from the entry/auth visual language rather than a new
 * one — soft mint page, white cards, hairline borders, navy text — because Profile is reached from
 * the same shell and a second palette here would read as a different app.
 *
 * ── Every row goes somewhere, or says it does not ───────────────────────────
 * The brief forbids nonfunctional toggles. Rows that open a working screen are plain rows; rows
 * whose destination does not exist yet carry a visible "Coming later" marker **and are shown in
 * development only**, so a production build never presents a setting that does nothing. That rule
 * lives in `ProfileRow` rather than at each call site, so it cannot be forgotten one row at a time.
 */
export function ProfileHomeScreen() {
  const router = useRouter();
  const { dp } = useEntryAuthMetrics();
  const { user } = useAuth();
  const { signOut } = useAuthActions();
  const { entitlement, seatUsage, isMockMode } = useEntitlement();
  const { refreshSeatUsage } = useEntitlementActions();

  const isPaid = entitlement.plan !== 'free';
  const isFamily = entitlement.plan === 'premium_family';
  const hasFamily = canUseSharedFamily(entitlement);
  const periodEnd = formatRenewalDate(entitlement.currentPeriodEnd);

  useEffect(() => {
    if (hasFamily) {
      void refreshSeatUsage();
    }
  }, [hasFamily, refreshSeatUsage]);

  const displayName = user?.fullName ?? profileCopy.unknownName;
  const initials = displayName
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');

  return (
    <View style={styles.page} testID="profile-home">
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: dp(subscriptionLayout.pagePadding),
          paddingBottom: dp(28),
          rowGap: dp(subscriptionLayout.cardGap),
        }}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.header, { minHeight: dp(subscriptionLayout.minTouchTarget) }]}>
          <Pressable
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            hitSlop={10}
            style={{
              width: dp(subscriptionLayout.minTouchTarget),
              height: dp(subscriptionLayout.minTouchTarget),
              justifyContent: 'center',
            }}
            testID="profile-back"
          >
            <View
              style={{
                width: dp(10),
                height: dp(10),
                borderLeftWidth: 2,
                borderBottomWidth: 2,
                borderColor: subscriptionColors.textPrimary,
                transform: [{ rotate: '45deg' }],
              }}
            />
          </Pressable>
          <EntryAuthText
            token="titleCompact"
            accessibilityRole="header"
            color={subscriptionColors.textPrimary}
          >
            {profileCopy.title}
          </EntryAuthText>
          <View style={{ width: dp(subscriptionLayout.minTouchTarget) }} />
        </View>

        {/* Identity. The plan badge is read from live entitlement, never assumed. */}
        <View
          style={[
            styles.card,
            {
              padding: dp(subscriptionLayout.cardPadding),
              borderRadius: dp(subscriptionLayout.cardRadius),
              rowGap: dp(subscriptionLayout.rowGap),
            },
          ]}
          testID="profile-identity"
        >
          <View style={[styles.identityRow, { columnGap: dp(12) }]}>
            {profileAvatar === undefined ? (
              <View
                style={[
                  styles.avatarFallback,
                  { width: dp(56), height: dp(56), borderRadius: dp(28) },
                ]}
              >
                <EntryAuthText token="titleCompact" color={subscriptionColors.accent}>
                  {initials}
                </EntryAuthText>
              </View>
            ) : (
              <Image
                source={profileAvatar}
                style={{ width: dp(56), height: dp(56), borderRadius: dp(28) }}
                contentFit="cover"
                accessible
                accessibilityRole="image"
                accessibilityLabel={`${displayName}'s profile picture`}
                testID="profile-avatar"
              />
            )}

            <View style={[styles.identityText, { rowGap: dp(3) }]}>
              <EntryAuthText token="button" color={subscriptionColors.textPrimary}>
                {displayName}
              </EntryAuthText>
              <EntryAuthText token="caption" color={subscriptionColors.textSecondary}>
                {user?.email ?? profileCopy.unknownEmail}
              </EntryAuthText>
              <PlanBadge
                label={planNames[entitlement.plan]}
                tone={isPaid ? 'accent' : 'neutral'}
                testID="profile-plan-badge"
              />
            </View>
          </View>

          <Pressable
            onPress={() => router.push('/profile/edit')}
            accessibilityRole="button"
            style={[
              styles.editButton,
              {
                minHeight: dp(subscriptionLayout.minTouchTarget),
                borderRadius: dp(subscriptionLayout.buttonRadius),
              },
            ]}
            testID="profile-edit"
          >
            <EntryAuthText token="label" color={subscriptionColors.accent}>
              {profileCopy.editProfile}
            </EntryAuthText>
          </Pressable>
        </View>

        {/* A — Account */}
        <ProfileSection title={profileCopy.sections.account} testID="profile-section-account">
          <ProfileRow
            label={profileCopy.rows.personalInfo}
            onPress={() => router.push('/profile/edit')}
            testID="row-personal"
          />
          <ProfileRow label={profileCopy.rows.emailAddress} comingLater testID="row-email" />
          <ProfileRow label={profileCopy.rows.passwordSecurity} comingLater testID="row-security" />
        </ProfileSection>

        {/* B — Subscription. Renewal dates come from entitlement or are omitted; never invented. */}
        <ProfileSection
          title={profileCopy.sections.subscription}
          testID="profile-section-subscription"
        >
          <ProfileRow
            label={profileCopy.rows.currentPlan}
            value={planNames[entitlement.plan]}
            testID="row-current-plan"
          />
          {isPaid ? (
            <>
              <ProfileRow
                label={profileCopy.rows.status}
                value={statusLabels[entitlement.status]}
                testID="row-status"
              />
              <ProfileRow
                label={profileCopy.rows.billingPeriod}
                value={
                  entitlement.billingPeriod === 'yearly' ? profileCopy.yearly : profileCopy.monthly
                }
                testID="row-billing-period"
              />
              {periodEnd === null ? null : (
                <ProfileRow
                  label={
                    statusGrantsPaidAccess(entitlement.status)
                      ? profileCopy.rows.renews
                      : profileCopy.rows.expires
                  }
                  value={periodEnd}
                  testID="row-renewal"
                />
              )}
              <ProfileRow
                label={profileCopy.rows.manageSubscription}
                onPress={() => router.push(subscriptionRoutes.manage)}
                testID="row-manage-subscription"
              />
            </>
          ) : (
            <>
              <ProfileRow label={profileCopy.faithAlwaysFree} testID="row-faith-free" />
              <ProfileRow
                label={profileCopy.rows.viewPremium}
                onPress={() => router.push(subscriptionRoutes.welcome)}
                testID="row-view-premium"
              />
            </>
          )}
          <ProfileRow
            label={profileCopy.rows.restorePurchases}
            onPress={() => router.push(subscriptionRoutes.restore)}
            testID="row-restore"
          />
          {isMockMode ? (
            <ProfileRow label={profileCopy.mockNotice} testID="row-mock-notice" />
          ) : null}
        </ProfileSection>

        {/* C — Family. Three different presentations; no invented members in any of them. */}
        <ProfileSection title={profileCopy.sections.family} testID="profile-section-family">
          {hasFamily && isFamily ? (
            <>
              <ProfileRow
                label={profileCopy.rows.seats}
                value={
                  seatUsage === null
                    ? profileCopy.loading
                    : `${seatUsage.used} of ${seatUsage.limit}`
                }
                testID="row-seats"
              />
              {entitlement.isFamilyOrganizer ? (
                <>
                  <ProfileRow
                    label={profileCopy.rows.manageFamily}
                    onPress={() => router.push(familyRoutes.members)}
                    testID="row-manage-family"
                  />
                  <ProfileRow
                    label={profileCopy.rows.inviteMember}
                    onPress={() => router.push(familyRoutes.invite)}
                    testID="row-invite"
                  />
                  <ProfileRow
                    label={profileCopy.rows.pendingInvitations}
                    onPress={() => router.push(familyRoutes.invitations)}
                    testID="row-pending"
                  />
                </>
              ) : (
                <>
                  <ProfileRow label={profileCopy.memberNotice} testID="row-member-notice" />
                  <ProfileRow
                    label={profileCopy.rows.familyPrivacy}
                    onPress={() => router.push(familyRoutes.members)}
                    testID="row-family-privacy"
                  />
                </>
              )}
            </>
          ) : (
            <>
              <ProfileRow label={familyWording.headline} testID="row-family-pitch" />
              <ProfileRow
                label={profileCopy.rows.viewFamilyPlan}
                onPress={() => router.push(subscriptionRoutes.family('yearly'))}
                testID="row-view-family"
              />
            </>
          )}
        </ProfileSection>

        {/* D — Preferences. Each opens a real settings screen. */}
        <ProfileSection
          title={profileCopy.sections.preferences}
          testID="profile-section-preferences"
        >
          <ProfileRow
            label={profileCopy.rows.notifications}
            onPress={() => router.push('/settings/notifications')}
            testID="row-notifications"
          />
          <ProfileRow
            label={profileCopy.rows.language}
            onPress={() => router.push('/settings/language')}
            testID="row-language"
          />
          <ProfileRow
            label={profileCopy.rows.appearance}
            onPress={() => router.push('/settings/appearance')}
            testID="row-appearance"
          />
          <ProfileRow
            label={profileCopy.rows.accessibility}
            onPress={() => router.push('/settings/accessibility')}
            testID="row-accessibility"
          />
        </ProfileSection>

        {/* E — Privacy and data */}
        <ProfileSection title={profileCopy.sections.privacy} testID="profile-section-privacy">
          <ProfileRow
            label={profileCopy.rows.privacyControls}
            onPress={() => router.push('/settings/privacy')}
            testID="row-privacy"
          />
          <ProfileRow
            label={profileCopy.rows.aiPermissions}
            onPress={() => router.push('/settings/ai-permissions')}
            testID="row-ai-permissions"
          />
          <ProfileRow label={profileCopy.rows.downloadData} comingLater testID="row-download" />
          <ProfileRow
            label={profileCopy.rows.deleteAccount}
            comingLater
            destructive
            testID="row-delete-account"
          />
        </ProfileSection>

        {/* F — Help */}
        <ProfileSection title={profileCopy.sections.help} testID="profile-section-help">
          <ProfileRow
            label={profileCopy.rows.helpCenter}
            onPress={() => router.push('/settings/help')}
            testID="row-help"
          />
          <ProfileRow label={profileCopy.rows.contactSupport} comingLater testID="row-support" />
          <ProfileRow label={profileCopy.rows.reportProblem} comingLater testID="row-report" />
          <ProfileRow label={profileCopy.rows.terms} comingLater testID="row-terms" />
          <ProfileRow
            label={profileCopy.rows.privacyPolicy}
            comingLater
            testID="row-privacy-policy"
          />
          <ProfileRow label={profileCopy.rows.about} comingLater testID="row-about" />
        </ProfileSection>

        {/* G — Session */}
        <ProfileSection title={profileCopy.sections.session} testID="profile-section-session">
          <ProfileRow
            label={profileCopy.rows.logOut}
            destructive
            onPress={() => {
              // Replace, so Back cannot return into an authenticated screen after signing out.
              void signOut().finally(() => router.replace(globalRoutes.splash));
            }}
            testID="row-log-out"
          />
        </ProfileSection>

        <Pressable
          onPress={() => router.push(moduleRoutes.faith.home)}
          accessibilityRole="button"
          style={{ minHeight: dp(subscriptionLayout.minTouchTarget), justifyContent: 'center' }}
          testID="profile-faith"
        >
          <EntryAuthText token="caption" align="center" color={subscriptionColors.textSecondary}>
            {profileCopy.faithAlwaysFree}
          </EntryAuthText>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: subscriptionColors.pageBackground,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  card: {
    width: '100%',
    borderWidth: 1,
    borderColor: subscriptionColors.border,
    backgroundColor: subscriptionColors.surface,
  },
  identityRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  identityText: {
    flex: 1,
    alignItems: 'flex-start',
  },
  avatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: subscriptionColors.accentSurface,
  },
  editButton: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: subscriptionColors.accent,
  },
});
