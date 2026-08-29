import { Image } from 'expo-image';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppIcon } from '@ds/components';
import { EntryAuthText } from '@features/entry-auth/components/entry-auth-text';
import { useEntryAuthMetrics } from '@features/entry-auth/use-entry-auth-metrics';
import { profileAvatar } from '@features/home/module-pictograms';
import { PlanBadge } from '@features/subscription/components/plan-badge';
import { subscriptionColors } from '@features/subscription/subscription-tokens';
import { minimumHitSlop, minimumTouchTargetSize } from '@shared/utils/a11y';

import { profileCopy } from '../profile-copy';
import { PROFILE_LAYOUT } from '../profile-metrics';
import { ProfileSkeletonBar } from './profile-skeleton-bar';

export type ProfileIdentityCardProps = {
  /** The authenticated full name, already resolved from the profile row or the session. */
  readonly fullName: string | null;
  readonly email: string | null;
  /** The plan's display name. Null while entitlement is unresolved — never defaulted to "Free". */
  readonly planName: string | null;
  readonly isPaidPlan: boolean;
  /** True while the profile row is being read for the first time. */
  readonly isLoading: boolean;
  /** Set when the profile row could not be read; the card then offers this. */
  readonly onRetry?: () => void;
  readonly onEdit: () => void;
  readonly testID?: string;
};

/**
 * Who is signed in, on one 84 dp row.
 *
 * ── What replaced the tall Edit Profile button ──────────────────────────────
 * Edit used to be a full-width 44 dp bordered button on its own line beneath the portrait, which
 * cost the card roughly half its height for one rarely-used action. It is now a 30 dp pill in the
 * card's trailing slot, carrying its 44 dp target through hit slop rather than through its own box
 * — the mechanism `minimumHitSlop` exists for.
 *
 * ── Long names and long addresses ───────────────────────────────────────────
 * Both lines are single-line and ellipsised, so neither can push the card past its band. Truncation
 * is a *visual* compromise only: each line carries the complete value in its accessibility label,
 * so a screen reader reads the whole address even when the display shows "ahmed.al-rashid@…".
 *
 * ── Nothing here is hardcoded ───────────────────────────────────────────────
 * Name, address and plan are all passed in from live sources. When a value is genuinely absent the
 * card says so ("Your account", "No email on file") rather than presenting a plausible-looking
 * stand-in; when it is merely late, it renders a skeleton in the same geometry.
 */
export function ProfileIdentityCard({
  fullName,
  email,
  planName,
  isPaidPlan,
  isLoading,
  onRetry,
  onEdit,
  testID = 'profile-identity',
}: ProfileIdentityCardProps) {
  const { dp } = useEntryAuthMetrics();
  const { identity } = PROFILE_LAYOUT;

  const avatar = dp(identity.avatar);
  const displayName = fullName ?? profileCopy.unknownName;
  const displayEmail = email ?? profileCopy.unknownEmail;

  return (
    <View
      style={[
        styles.card,
        {
          // `minHeight`, never `height`: at a large OS text size the card must grow, not clip.
          minHeight: dp(identity.height),
          padding: dp(identity.padding),
          borderRadius: dp(PROFILE_LAYOUT.cardRadius),
          columnGap: dp(identity.columnGap),
        },
      ]}
      testID={testID}
    >
      <Image
        source={profileAvatar}
        style={{ width: avatar, height: avatar, borderRadius: avatar / 2 }}
        contentFit="cover"
        accessible
        accessibilityRole="image"
        accessibilityLabel={profileCopy.identity.avatarAccessibilityLabel}
        testID={`${testID}-avatar`}
      />

      {isLoading ? (
        <View
          style={[styles.text, { rowGap: dp(identity.rowGap) }]}
          accessible
          accessibilityLabel={profileCopy.identity.loadingAccessibilityLabel}
          testID={`${testID}-loading`}
        >
          <ProfileSkeletonBar height={21} width={148} />
          <ProfileSkeletonBar height={16} width={188} />
          <ProfileSkeletonBar height={22} width={64} />
        </View>
      ) : (
        <View style={[styles.text, { rowGap: dp(identity.rowGap) }]}>
          <EntryAuthText
            token="body"
            numberOfLines={1}
            ellipsizeMode="tail"
            color={subscriptionColors.textPrimary}
            // The untruncated value, so the ellipsis is a visual compromise and not a data one.
            accessibilityLabel={`${profileCopy.identity.nameAccessibilityPrefix} ${displayName}`}
            testID={`${testID}-name`}
          >
            {displayName}
          </EntryAuthText>

          <EntryAuthText
            token="caption"
            numberOfLines={1}
            ellipsizeMode="tail"
            color={subscriptionColors.textSecondary}
            accessibilityLabel={`${profileCopy.identity.emailAccessibilityPrefix} ${displayEmail}`}
            testID={`${testID}-email`}
          >
            {displayEmail}
          </EntryAuthText>

          <View style={[styles.badgeRow, { columnGap: dp(8) }]}>
            {planName === null ? (
              <ProfileSkeletonBar height={22} width={64} testID={`${testID}-plan-loading`} />
            ) : (
              <PlanBadge
                label={planName}
                tone={isPaidPlan ? 'accent' : 'neutral'}
                testID={`${testID}-plan-badge`}
              />
            )}

            {onRetry === undefined ? null : (
              <Pressable
                onPress={onRetry}
                accessible
                accessibilityRole="button"
                accessibilityLabel="Profile details could not be refreshed. Retry."
                hitSlop={minimumHitSlop(22)}
                style={[
                  styles.retry,
                  { columnGap: dp(4) },
                  {
                    minWidth: minimumTouchTargetSize(),
                    minHeight: minimumTouchTargetSize(),
                    alignItems: 'center',
                    justifyContent: 'center',
                  },
                ]}
                testID={`${testID}-retry`}
              >
                <AppIcon name="retry" size={dp(13)} color={subscriptionColors.accent} />
                <EntryAuthText token="caption" color={subscriptionColors.accent}>
                  {profileCopy.membership.retry}
                </EntryAuthText>
              </Pressable>
            )}
          </View>
        </View>
      )}

      <Pressable
        onPress={onEdit}
        accessible
        accessibilityRole="button"
        accessibilityLabel={profileCopy.identity.editAccessibilityLabel}
        // The visible pill is 30 dp; the tappable rectangle is 44 dp. See the note above.
        hitSlop={minimumHitSlop(identity.editHeight)}
        style={[
          styles.edit,
          {
            minHeight: dp(identity.editHeight),
            paddingHorizontal: dp(identity.editPaddingHorizontal),
            borderRadius: dp(identity.editRadius),
          },
        ]}
        testID={`${testID}-edit`}
      >
        <EntryAuthText token="label" color={subscriptionColors.accent}>
          {profileCopy.identity.edit}
        </EntryAuthText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: PROFILE_LAYOUT.cardBorder,
    borderColor: subscriptionColors.border,
    backgroundColor: subscriptionColors.surface,
  },
  text: {
    flex: 1,
    alignItems: 'flex-start',
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  retry: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  edit: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: subscriptionColors.accent,
  },
});
