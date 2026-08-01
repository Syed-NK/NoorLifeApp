import { StyleSheet, View } from 'react-native';

import { EntryAuthText } from '@features/entry-auth/components/entry-auth-text';
import { PrimaryButton } from '@features/entry-auth/components/primary-button';
import { useEntryAuthMetrics } from '@features/entry-auth/use-entry-auth-metrics';
import { PlanBadge } from '@features/subscription/components/plan-badge';
import { RestorePurchasesButton } from '@features/subscription/components/restore-purchases-button';
import { subscriptionColors } from '@features/subscription/subscription-tokens';

import { profileCopy } from '../profile-copy';
import type { MembershipPresentation } from '../profile-membership';
import { PROFILE_LAYOUT } from '../profile-metrics';
import { ProfileSkeletonBar } from './profile-skeleton-bar';

export type ProfileMembershipCardProps = {
  /** Null while entitlement is unresolved — the card must not assume a plan to render one. */
  readonly presentation: MembershipPresentation | null;
  /** True once the load has been waiting long enough to be treated as failed. */
  readonly isUnavailable: boolean;
  /** True only in a development build whose adapter cannot take money. */
  readonly showDevelopmentBadge: boolean;
  readonly onPrimary: () => void;
  readonly onRestore: () => void;
  readonly onRetry: () => void;
  readonly testID?: string;
};

/**
 * The plan, in 112 dp, in every state.
 *
 * ── One height, four states ─────────────────────────────────────────────────
 * Free, Premium Single, Premium Family and "still loading" all occupy the same box: a title row, a
 * line of supporting copy and a 44 dp action row. Nothing about a resolved entitlement adds or
 * removes a line, which is what makes the resolve invisible rather than a jump.
 *
 * ── The development marker ──────────────────────────────────────────────────
 * The previous screen carried a permanent full-width row reading "Development mock — purchases are
 * simulated". It is now three characters in the title row's trailing slot, and `__DEV__` gates it
 * *here* rather than at the call site — a production build cannot render it however the prop is
 * passed. The mock purchase architecture underneath is untouched; only its presentation changed.
 *
 * ── Never "Free" by default ─────────────────────────────────────────────────
 * `presentation` is null until entitlement resolves, and null renders skeletons. There is no code
 * path in which an unresolved plan is drawn as a free one.
 */
export function ProfileMembershipCard({
  presentation,
  isUnavailable,
  showDevelopmentBadge,
  onPrimary,
  onRestore,
  onRetry,
  testID = 'profile-membership',
}: ProfileMembershipCardProps) {
  const { dp } = useEntryAuthMetrics();
  const { membership } = PROFILE_LAYOUT;

  const cardStyle = [
    styles.card,
    {
      // `minHeight`, never `height`: the card grows with the OS text size instead of clipping.
      minHeight: dp(membership.height),
      padding: dp(membership.padding),
      borderRadius: dp(PROFILE_LAYOUT.cardRadius),
    },
  ];

  if (presentation === null && !isUnavailable) {
    return (
      <View
        style={cardStyle}
        accessible
        accessibilityLabel={profileCopy.membership.loadingAccessibilityLabel}
        testID={testID}
      >
        <View style={{ minHeight: dp(membership.titleRow), justifyContent: 'center' }}>
          <ProfileSkeletonBar height={16} width={132} testID={`${testID}-loading`} />
        </View>
        <View style={{ marginTop: dp(membership.gapAfterTitle) }}>
          <ProfileSkeletonBar height={12} width={214} />
        </View>
        <View style={{ marginTop: dp(membership.gapAfterSupporting) }}>
          <ProfileSkeletonBar height={membership.actionHeight} width="100%" />
        </View>
      </View>
    );
  }

  const title = presentation?.title ?? profileCopy.membership.unavailable;
  const supporting = presentation?.supporting ?? profileCopy.membership.unavailableSupporting;
  const primaryLabel = presentation?.primaryLabel ?? profileCopy.membership.retry;
  const fact = presentation?.fact ?? null;

  return (
    <View style={cardStyle} testID={testID}>
      <View style={[styles.titleRow, { minHeight: dp(membership.titleRow), columnGap: dp(8) }]}>
        <EntryAuthText
          token="button"
          numberOfLines={1}
          ellipsizeMode="tail"
          color={subscriptionColors.textPrimary}
          style={styles.title}
          testID={`${testID}-title`}
        >
          {title}
        </EntryAuthText>

        <View style={[styles.trailing, { columnGap: dp(6) }]}>
          {/* `__DEV__` is checked here so a production bundle cannot render this at all. */}
          {showDevelopmentBadge && __DEV__ ? (
            <PlanBadge
              label={profileCopy.membership.devBadge}
              tone="warning"
              accessibilityLabel={profileCopy.membership.devBadgeAccessibilityLabel}
              testID={`${testID}-dev-badge`}
            />
          ) : null}

          {fact === null ? null : (
            <EntryAuthText
              token="caption"
              numberOfLines={1}
              color={subscriptionColors.textSecondary}
              testID={`${testID}-fact`}
            >
              {fact}
            </EntryAuthText>
          )}
        </View>
      </View>

      <EntryAuthText
        token="caption"
        color={subscriptionColors.textSecondary}
        style={{ marginTop: dp(membership.gapAfterTitle) }}
        testID={`${testID}-supporting`}
      >
        {supporting}
      </EntryAuthText>

      <View
        style={[
          styles.actionRow,
          {
            marginTop: dp(membership.gapAfterSupporting),
            minHeight: dp(membership.actionHeight),
            columnGap: dp(membership.actionGap),
          },
        ]}
      >
        <View style={styles.primaryWrap}>
          <PrimaryButton
            label={primaryLabel}
            // 44 dp rather than the entry flow's 48: the card's budget is 112 dp, and 44 is
            // already the accessibility minimum. The override is geometry only — fill, radius,
            // label capping and busy semantics all still come from the shared component.
            style={{ height: dp(membership.actionHeight) }}
            onPress={presentation === null ? onRetry : onPrimary}
            testID={`${testID}-primary`}
          />
        </View>

        {presentation?.showRestore === true ? (
          <View style={{ width: dp(membership.restoreWidth) }}>
            <RestorePurchasesButton onPress={onRestore} testID={`${testID}-restore`} />
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: '100%',
    borderWidth: PROFILE_LAYOUT.cardBorder,
    borderColor: subscriptionColors.border,
    backgroundColor: subscriptionColors.surface,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    flexShrink: 1,
  },
  trailing: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  primaryWrap: {
    flex: 1,
  },
});
