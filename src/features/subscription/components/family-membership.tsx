import { Image } from 'expo-image';
import { Pressable, StyleSheet, View } from 'react-native';

import { EntryAuthText } from '@features/entry-auth/components/entry-auth-text';
import { getModulePictogram } from '@features/home/module-pictograms';
import { useEntryAuthMetrics } from '@features/entry-auth/use-entry-auth-metrics';

import type { FamilySeatUsage } from '../domain/entitlement';
import { isFamilyFull } from '../domain/entitlement';
import { familyInviteCopy, familyMembersCopy, familyInvitationsCopy } from '../subscription-copy';
import { subscriptionColors, subscriptionLayout } from '../subscription-tokens';
import { PlanBadge } from './plan-badge';
import { minimumTouchTargetSize } from '@shared/utils/a11y';

/**
 * The family-membership primitives: seat indicator, member avatar, member row, invitation row.
 *
 * Grouped because they only ever appear together, and because they share one invariant that is
 * easiest to keep correct in a single file: **the organizer occupies a seat.** Every count here
 * is "used of limit" where `used` already includes the organizer, so no component can present
 * "5 of 6" for a family that in fact has six people in it.
 */

export type FamilyRole = 'organizer' | 'adult' | 'child';

export type FamilyMemberView = {
  readonly id: string;
  readonly name: string;
  readonly role: FamilyRole;
  /** True for the signed-in user, which is what suppresses a Remove control on themselves. */
  readonly isSelf: boolean;
};

export type FamilySeatIndicatorProps = {
  readonly usage: FamilySeatUsage;
  readonly testID?: string;
};

/**
 * "3 of 6 members", with a dot per seat.
 *
 * The dots are a secondary reading of the same number, not the only one: the text is always
 * present, because a row of filled and empty circles is not information a screen reader can use.
 */
export function FamilySeatIndicator({ usage, testID }: FamilySeatIndicatorProps) {
  const { dp } = useEntryAuthMetrics();
  const dot = dp(10);
  const full = isFamilyFull(usage);

  return (
    <View style={{ rowGap: dp(6) }} testID={testID}>
      <View style={[styles.spread, { columnGap: dp(8) }]}>
        <EntryAuthText token="label" color={subscriptionColors.textPrimary}>
          {familyInviteCopy.seatCounter(usage.used, usage.limit)}
        </EntryAuthText>
        {full ? (
          <PlanBadge label="Full" tone="warning" testID={`${testID ?? 'seats'}-full`} />
        ) : null}
      </View>

      <View
        style={[styles.dots, { columnGap: dp(5) }]}
        // The dots repeat the text above, so they are hidden rather than read twice.
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {Array.from({ length: usage.limit }, (_, index) => (
          <View
            key={index}
            style={{
              width: dot,
              height: dot,
              borderRadius: dot / 2,
              borderWidth: 1,
              borderColor:
                index < usage.used ? subscriptionColors.accent : subscriptionColors.border,
              backgroundColor:
                index < usage.used ? subscriptionColors.accent : subscriptionColors.surface,
            }}
          />
        ))}
      </View>

      {usage.pendingInvitations > 0 ? (
        <EntryAuthText token="caption" color={subscriptionColors.textSecondary}>
          {`${usage.pendingInvitations} invitation${usage.pendingInvitations === 1 ? '' : 's'} pending. A seat is used only when an invitation is accepted.`}
        </EntryAuthText>
      ) : null}
    </View>
  );
}

export type FamilyMemberAvatarProps = {
  readonly name: string;
  /** An empty seat renders the outline placeholder instead of initials. */
  readonly empty?: boolean;
  readonly size?: number;
  readonly testID?: string;
};

/**
 * A member's initial in a tinted disc, or an empty-seat outline.
 *
 * Initials rather than a photo: there are no member photographs in this phase, and the approved
 * PNG set has no per-person artwork to borrow. A generated avatar image would be exactly the kind
 * of invented asset the brief forbids.
 */
export function FamilyMemberAvatar({ name, empty = false, size, testID }: FamilyMemberAvatarProps) {
  const { dp } = useEntryAuthMetrics();
  const box = size ?? dp(subscriptionLayout.memberAvatar);
  const initial = name.trim().charAt(0).toUpperCase();

  return (
    <View
      style={[
        styles.avatar,
        {
          width: box,
          height: box,
          borderRadius: box / 2,
          backgroundColor: empty ? subscriptionColors.surface : subscriptionColors.accentSurface,
          borderColor: empty ? subscriptionColors.border : subscriptionColors.accent,
          borderStyle: empty ? 'dashed' : 'solid',
        },
      ]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID={testID}
    >
      {empty ? null : (
        <EntryAuthText token="label" color={subscriptionColors.accent}>
          {initial}
        </EntryAuthText>
      )}
    </View>
  );
}

export type FamilyMemberRowProps = {
  readonly member: FamilyMemberView;
  /** Only the organizer may remove, and never themselves. */
  readonly onRemove?: () => void;
  readonly testID?: string;
};

export function FamilyMemberRow({ member, onRemove, testID }: FamilyMemberRowProps) {
  const { dp } = useEntryAuthMetrics();
  const isOrganizer = member.role === 'organizer';
  // The organizer holds a seat and cannot be removed while the family exists; transferring the
  // role is deferred, so no control is offered rather than one that fails.
  const canRemove = onRemove !== undefined && !isOrganizer && !member.isSelf;

  return (
    <View
      style={[
        styles.row,
        {
          paddingVertical: dp(9),
          columnGap: dp(10),
          minHeight: dp(subscriptionLayout.minTouchTarget),
          borderBottomColor: subscriptionColors.border,
        },
      ]}
      testID={testID}
    >
      <FamilyMemberAvatar name={member.name} />
      <View style={[styles.rowText, { rowGap: dp(2) }]}>
        <View style={[styles.nameRow, { columnGap: dp(6) }]}>
          <EntryAuthText token="label" color={subscriptionColors.textPrimary}>
            {member.name}
          </EntryAuthText>
          {isOrganizer ? <PlanBadge label={familyMembersCopy.organizerBadge} /> : null}
          {member.isSelf ? <PlanBadge label={familyMembersCopy.youBadge} tone="neutral" /> : null}
        </View>
        <EntryAuthText token="caption" color={subscriptionColors.textSecondary}>
          {familyMembersCopy.roleLabels[member.role]}
        </EntryAuthText>
      </View>

      {canRemove ? (
        <Pressable
          onPress={onRemove}
          accessibilityRole="button"
          accessibilityLabel={`Remove ${member.name} from the family`}
          hitSlop={8}
          style={[
            { minHeight: dp(subscriptionLayout.minTouchTarget), justifyContent: 'center' },
            {
              minWidth: minimumTouchTargetSize(),
              minHeight: minimumTouchTargetSize(),
              alignItems: 'center',
              justifyContent: 'center',
            },
          ]}
          testID={`${testID ?? 'member'}-remove`}
        >
          <EntryAuthText token="label" color={subscriptionColors.error}>
            {familyMembersCopy.remove}
          </EntryAuthText>
        </Pressable>
      ) : null}
    </View>
  );
}

export type InvitationStatus = 'pending' | 'accepted' | 'expired' | 'revoked';

export type InvitationView = {
  readonly id: string;
  readonly email: string;
  readonly status: InvitationStatus;
  /** Human-readable expiry, already formatted. */
  readonly expiresLabel: string | null;
};

export type InvitationRowProps = {
  readonly invitation: InvitationView;
  readonly onResend?: () => void;
  readonly onCancel?: () => void;
  readonly testID?: string;
};

const INVITATION_TONE: Record<InvitationStatus, 'accent' | 'success' | 'warning' | 'neutral'> = {
  pending: 'accent',
  accepted: 'success',
  expired: 'warning',
  revoked: 'neutral',
};

export function InvitationRow({ invitation, onResend, onCancel, testID }: InvitationRowProps) {
  const { dp } = useEntryAuthMetrics();
  // An accepted invitation is history; only a live or lapsed one can be acted on.
  const actionable = invitation.status === 'pending' || invitation.status === 'expired';

  return (
    <View
      style={[
        styles.invitation,
        {
          paddingVertical: dp(10),
          rowGap: dp(6),
          borderBottomColor: subscriptionColors.border,
        },
      ]}
      testID={testID}
    >
      <View style={[styles.spread, { columnGap: dp(8) }]}>
        <EntryAuthText token="label" color={subscriptionColors.textPrimary} style={styles.rowText}>
          {invitation.email}
        </EntryAuthText>
        <PlanBadge
          label={familyInvitationsCopy.statusLabels[invitation.status]}
          tone={INVITATION_TONE[invitation.status]}
          testID={`${testID ?? 'invitation'}-status-${invitation.status}`}
        />
      </View>

      {invitation.expiresLabel === null ? null : (
        <EntryAuthText token="caption" color={subscriptionColors.textSecondary}>
          {invitation.expiresLabel}
        </EntryAuthText>
      )}

      {actionable ? (
        <View style={[styles.inviteActions, { columnGap: dp(16) }]}>
          {onResend === undefined ? null : (
            <Pressable
              onPress={onResend}
              accessibilityRole="button"
              accessibilityLabel={`Resend the invitation to ${invitation.email}`}
              hitSlop={8}
              style={{ minHeight: dp(subscriptionLayout.minTouchTarget), justifyContent: 'center' }}
              testID={`${testID ?? 'invitation'}-resend`}
            >
              <EntryAuthText token="label" color={subscriptionColors.accent}>
                {familyInvitationsCopy.resend}
              </EntryAuthText>
            </Pressable>
          )}
          {onCancel === undefined ? null : (
            <Pressable
              onPress={onCancel}
              accessibilityRole="button"
              accessibilityLabel={`Cancel the invitation to ${invitation.email}`}
              hitSlop={8}
              style={{ minHeight: dp(subscriptionLayout.minTouchTarget), justifyContent: 'center' }}
              testID={`${testID ?? 'invitation'}-cancel`}
            >
              <EntryAuthText token="label" color={subscriptionColors.error}>
                {familyInvitationsCopy.cancel}
              </EntryAuthText>
            </Pressable>
          )}
        </View>
      ) : null}
    </View>
  );
}

export type FamilySeatRowProps = {
  readonly usage: FamilySeatUsage;
  readonly organizerName: string;
  /**
   * Whether to draw the small Family mark beside the seats.
   *
   * False on the Premium Family details screen, which already shows the same asset at 104 dp
   * directly above — two copies of one pictogram in one view reads as a mistake.
   */
  readonly showPictogram?: boolean;
  readonly testID?: string;
};

/**
 * Six seat positions: the organizer plus five member slots.
 *
 * Drawn as one row so the shape of the plan is visible at a glance — and drawn with the approved
 * Family pictogram beside it rather than a generated illustration.
 */
export function FamilySeatRow({
  usage,
  organizerName,
  showPictogram = true,
  testID,
}: FamilySeatRowProps) {
  const { dp } = useEntryAuthMetrics();
  const seat = dp(subscriptionLayout.seatDot);

  return (
    <View style={[styles.seatRow, { columnGap: dp(8) }]} testID={testID}>
      {showPictogram ? (
        <Image
          source={getModulePictogram('family')}
          style={{ width: dp(44), height: dp(44) }}
          contentFit="contain"
          accessible
          accessibilityRole="image"
          accessibilityLabel="Family"
          testID={`${testID ?? 'seats'}-pictogram`}
        />
      ) : null}
      <View
        style={[styles.dots, { columnGap: dp(5) }]}
        accessible
        accessibilityLabel={`${usage.used} of ${usage.limit} accounts in use. ${organizerName} is the organizer.`}
      >
        {Array.from({ length: usage.limit }, (_, index) => (
          <FamilyMemberAvatar
            key={index}
            name={index === 0 ? organizerName : ''}
            empty={index >= usage.used}
            size={seat}
            testID={`${testID ?? 'seats'}-seat-${index}`}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  spread: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dots: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowText: {
    flex: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  invitation: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  inviteActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  seatRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});
