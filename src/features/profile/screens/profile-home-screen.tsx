import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { authRoutes, globalRoutes } from '@application/navigation/routes';
import { useAuth, useAuthActions } from '@application/providers/auth-provider';
import { AuthScaffold } from '@features/entry-auth/components/auth-scaffold';
import { useEntryAuthMetrics } from '@features/entry-auth/use-entry-auth-metrics';
import { canUseSharedFamily } from '@features/subscription/domain/entitlement';
import {
  useEntitlement,
  useEntitlementActions,
} from '@features/subscription/services/entitlement-context';
import { planNames } from '@features/subscription/subscription-copy';
import { subscriptionColors } from '@features/subscription/subscription-tokens';
import { subscriptionRoutes } from '@features/subscription/subscription-routes';

import { ComingLaterSheet } from '../components/coming-later-sheet';
import { ProfileHeader } from '../components/profile-header';
import { ProfileIdentityCard } from '../components/profile-identity-card';
import { ProfileLogoutRow } from '../components/profile-logout-row';
import { ProfileMembershipCard } from '../components/profile-membership-card';
import { ProfileMenuCard } from '../components/profile-menu-card';
import { useLoadTimeout } from '../hooks/use-load-timeout';
import { useProfileRecord } from '../hooks/use-profile-record';
import { profileCopy } from '../profile-copy';
import { membershipPresentation } from '../profile-membership';
import { PROFILE_LAYOUT, shouldEnableScroll } from '../profile-metrics';
import { PROFILE_EDIT_ROUTE, PROFILE_HELP_ROUTE, type ProfileMenuItem } from '../profile-routes';
import { ComingLaterProvider, useComingLaterActions } from '../services/coming-later-context';

/**
 * How long an unresolved entitlement is treated as "loading" before it is treated as "failed".
 *
 * The entitlement provider reports no error — a failed refresh simply leaves the plan at `unknown`
 * — so time is the only signal available. Six seconds is deliberately generous: offering a retry
 * at two would fire on any slow connection, and a skeleton that resolves on its own is a better
 * outcome than a retry button the user did not need.
 */
const ENTITLEMENT_GRACE_MS = 6000;

/**
 * Profile Home — the compact account summary.
 *
 * ── What this replaced ──────────────────────────────────────────────────────
 * Twenty-six rows across seven titled sections, roughly two and a half Pixel 8 viewports of
 * scrolling to reach Log Out. The individual settings were not deleted; they move to the five
 * detail screens this menu points at. What is here now is the summary a user actually opens
 * Profile for: who is signed in, what plan they are on, five ways further in, and a way out.
 *
 * ── Why it fits without scrolling ───────────────────────────────────────────
 * Every height is declared in `profile-metrics.ts` and asserted against the Pixel 8 budget in
 * `__tests__/profile-metrics.test.ts` — 598 dp of content against 840 dp of usable height. Nothing
 * is achieved by shrinking type: the type ramp is the entry/auth lock's, unchanged, and the saving
 * comes entirely from cutting content that belongs on other screens.
 *
 * ── Why it still has a ScrollView ───────────────────────────────────────────
 * A larger OS text size, a shorter device or a longer name must all be able to expand the page
 * rather than clip it. Scrolling is therefore *enabled by measurement*: the screen compares what
 * the content actually laid out to against the viewport it actually has, and turns scrolling on
 * only when there is something to scroll to. At the reference metrics that comparison is false, so
 * nothing scrolls and nothing hides.
 *
 * ── The provider lives here ─────────────────────────────────────────────────
 * `ComingLaterProvider` wraps the body so the three unbuilt menu rows share one dialog mounted once
 * beside the page, rather than three modals mounted inside three rows.
 */
export function ProfileHomeScreen() {
  return (
    <ComingLaterProvider>
      <ProfileHomeBody />
      <ComingLaterSheet />
    </ComingLaterProvider>
  );
}

function ProfileHomeBody() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { dp } = useEntryAuthMetrics();

  const { status, user } = useAuth();
  const { signOut } = useAuthActions();
  const { entitlement, isResolved, seatUsage, isMockMode } = useEntitlement();
  const { refresh, refreshSeatUsage } = useEntitlementActions();
  const { showComingLater } = useComingLaterActions();

  const record = useProfileRecord(user?.id ?? null);
  // An entitlement that has not resolved after the grace period is treated as a failed load.
  const entitlementUnavailable = useLoadTimeout(!isResolved, ENTITLEMENT_GRACE_MS);

  const [viewportHeight, setViewportHeight] = useState(0);
  const [contentHeight, setContentHeight] = useState(0);

  /**
   * Signed out — leave, without drawing anything.
   *
   * `dismissAll` before `replace` is what makes Back unable to return: replacing alone would swap
   * Profile for Authentication while leaving Main Home beneath it in the stack.
   */
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
    // A failed read leaves `seatUsage` null, which the membership card renders as *no* seat line
    // rather than as a guessed one.
    void refreshSeatUsage().catch(() => undefined);
  }, [hasFamily, refreshSeatUsage]);

  const openComingLater = useCallback(
    (feature: string, intendedRoute: string) => {
      showComingLater({ feature, intendedRoute });
    },
    [showComingLater],
  );

  const openMenuItem = useCallback(
    (item: ProfileMenuItem) => {
      if (item.available === null) {
        openComingLater(item.label, item.intended);
        return;
      }
      router.push(item.available);
    },
    [openComingLater, router],
  );

  const openEdit = useCallback(() => {
    if (PROFILE_EDIT_ROUTE === null) {
      openComingLater(profileCopy.menu.personalInformation, '/profile/edit');
      return;
    }
    router.push(PROFILE_EDIT_ROUTE);
  }, [openComingLater, router]);

  const openHelp = useCallback(() => {
    if (PROFILE_HELP_ROUTE === null) {
      openComingLater(profileCopy.menu.helpSupport, '/profile/help');
      return;
    }
    router.push(PROFILE_HELP_ROUTE);
  }, [openComingLater, router]);

  const handleSignOut = useCallback(async () => {
    // The real service, through the auth provider. Navigation happens only after it resolves.
    await signOut();
    if (router.canDismiss()) {
      router.dismissAll();
    }
    router.replace(authRoutes.welcome);
  }, [router, signOut]);

  if (status === 'signed-out') {
    // The effect above is already navigating. Rendering nothing is the point: there is no honest
    // Profile to draw for a user who is not signed in, and a placeholder one would be a fake.
    return <View style={styles.blank} testID="profile-signed-out" />;
  }

  /**
   * The name, from the durable record where possible and the session's cached copy otherwise.
   *
   * Neither is a guess: `profiles.full_name` is the record, and `user.fullName` is the session's
   * own copy of it. The fallback is what keeps the card populated while offline.
   */
  const displayName = record.fullName ?? user?.fullName ?? null;
  const identityLoading =
    status !== 'signed-in' || (record.status === 'loading' && displayName === null);

  return (
    <AuthScaffold testID="profile-home">
      <ScrollView
        // Measured, not predicted — see the note on `shouldEnableScroll`.
        scrollEnabled={shouldEnableScroll(contentHeight, viewportHeight)}
        onLayout={(event) => setViewportHeight(event.nativeEvent.layout.height)}
        onContentSizeChange={(_width, height) => setContentHeight(height)}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          rowGap: dp(PROFILE_LAYOUT.sectionGap),
          // The inset is added to a fixed margin rather than replacing it, so the logout row never
          // sits flush against the gesture bar.
          paddingBottom: insets.bottom + dp(PROFILE_LAYOUT.bottomPadding),
        }}
        testID="profile-home-scroll"
      >
        <ProfileHeader onBack={() => router.dismissTo(globalRoutes.home)} onHelp={openHelp} />

        <ProfileIdentityCard
          fullName={displayName}
          email={user?.email ?? null}
          // Null until entitlement resolves. Never defaulted to Free.
          planName={isResolved ? planNames[entitlement.plan] : null}
          isPaidPlan={isResolved && entitlement.plan !== 'free'}
          isLoading={identityLoading}
          {...(record.status === 'unavailable' ? { onRetry: record.retry } : {})}
          onEdit={openEdit}
        />

        <ProfileMembershipCard
          presentation={isResolved ? membershipPresentation(entitlement, seatUsage) : null}
          isUnavailable={!isResolved && entitlementUnavailable}
          showDevelopmentBadge={isMockMode}
          onPrimary={() =>
            router.push(
              entitlement.plan === 'free' ? subscriptionRoutes.welcome : subscriptionRoutes.manage,
            )
          }
          // The existing restore flow, which runs the real handler and reports its own result.
          // Nothing here invents a success.
          onRestore={() => router.push(subscriptionRoutes.restore)}
          onRetry={() => void refresh().catch(() => undefined)}
        />

        <ProfileMenuCard onSelect={openMenuItem} />

        <ProfileLogoutRow onConfirm={handleSignOut} />
      </ScrollView>
    </AuthScaffold>
  );
}

const styles = StyleSheet.create({
  blank: {
    flex: 1,
    backgroundColor: subscriptionColors.pageBackground,
  },
});
