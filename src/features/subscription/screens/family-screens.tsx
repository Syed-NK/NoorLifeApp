import { useRouter } from 'expo-router';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { StyleSheet, View } from 'react-native';

import { moduleRoutes } from '@application/navigation/routes';
import { AuthTextField } from '@features/entry-auth/components/auth-text-field';
import { EntryAuthText } from '@features/entry-auth/components/entry-auth-text';
import { PrimaryButton } from '@features/entry-auth/components/primary-button';
import { SecondaryButton } from '@features/entry-auth/components/secondary-button';
import { useEntryAuthMetrics } from '@features/entry-auth/use-entry-auth-metrics';

import {
  FamilyMemberRow,
  FamilySeatIndicator,
  InvitationRow,
} from '../components/family-membership';
import { SubscriptionScreenScaffold } from '../components/subscription-screen-scaffold';
import { SubscriptionErrorState, SubscriptionStateBanner } from '../components/subscription-states';
import { canUseSharedFamily } from '../domain/entitlement';
import { useEntitlement } from '../services/entitlement-context';
import { mockFamilyStore } from '../services/mock-family-store';
import {
  familyFullCopy,
  familyInvitationsCopy,
  familyPlanCopy,
  familyInviteCopy,
  familyMembersCopy,
  familySetupCopy,
  familyWording,
} from '../subscription-copy';
import { subscriptionColors, subscriptionLayout } from '../subscription-tokens';
import { familyRoutes, subscriptionRoutes } from '../subscription-routes';

/**
 * Screens 11–15 — the family-membership system.
 *
 * Grouped because they share one gate and one invariant. The gate: every screen here requires an
 * active Premium Family entitlement, and a non-organizer sees membership information rather than
 * management controls. The invariant: six accounts total, organizer included.
 */

/** Subscribes to the mock family store. */
function useFamilyState() {
  return useSyncExternalStore(mockFamilyStore.subscribe, mockFamilyStore.getState);
}

/**
 * The shared gate.
 *
 * Returns a screen when the user should not be here, or null to proceed. Rendered rather than
 * redirected so the user is told *why* — silently bouncing someone to a paywall is disorienting.
 */
function useFamilyGate() {
  const router = useRouter();
  const { entitlement, isResolved } = useEntitlement();

  if (!isResolved) {
    return null;
  }
  if (!canUseSharedFamily(entitlement)) {
    return (
      <SubscriptionScreenScaffold
        title="Family is part of Premium Family"
        subtitle={familyWording.headline}
        onBack={() => router.back()}
        testID="family-not-entitled"
      >
        <SubscriptionErrorState
          title="You need Premium Family"
          body={familyWording.supporting}
          actionLabel="See Premium Family"
          onAction={() => router.push(subscriptionRoutes.family('yearly'))}
          secondaryLabel="Continue to Faith"
          onSecondary={() => router.replace(moduleRoutes.faith.home)}
          testID="family-gate"
        />
      </SubscriptionScreenScaffold>
    );
  }
  return null;
}

/** Screen 11 — Create Family Group. Organizer only. */
export function FamilySetupScreen() {
  const router = useRouter();
  const { dp } = useEntryAuthMetrics();
  const { entitlement, isMockMode } = useEntitlement();
  const gate = useFamilyGate();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);

  if (gate !== null) {
    return gate;
  }

  const create = () => {
    if (name.trim().length === 0) {
      setError('Give your family a name.');
      return;
    }
    setError(undefined);
    mockFamilyStore.create(name);
    router.replace(familyRoutes.invite);
  };

  return (
    <SubscriptionScreenScaffold
      title={familySetupCopy.heading}
      subtitle={familySetupCopy.body}
      onBack={() => router.back()}
      isMockMode={isMockMode}
      footer={
        <View style={{ rowGap: dp(8) }}>
          <PrimaryButton
            label={familySetupCopy.create}
            onPress={create}
            testID="family-setup-create"
          />
          {/* Never forced: the brief requires "Do this later" to remain available. */}
          <SecondaryButton
            label={familySetupCopy.later}
            onPress={() => router.back()}
            testID="family-setup-later"
          />
        </View>
      }
      testID="family-setup"
    >
      <View style={{ rowGap: dp(subscriptionLayout.cardGap) }}>
        <AuthTextField
          label={familySetupCopy.nameLabel}
          placeholder={familySetupCopy.namePlaceholder}
          value={name}
          onChangeText={setName}
          error={error}
          testID="family-setup-name"
        />

        <Card testID="family-setup-organizer">
          <EntryAuthText token="label" color={subscriptionColors.textPrimary}>
            {familySetupCopy.organizerLabel}
          </EntryAuthText>
          <EntryAuthText token="caption" color={subscriptionColors.textSecondary}>
            {entitlement.isFamilyOrganizer
              ? 'You are the organizer. You hold one of the six accounts.'
              : 'The organizer holds one of the six accounts.'}
          </EntryAuthText>
        </Card>

        <Card testID="family-setup-privacy">
          <EntryAuthText token="label" color={subscriptionColors.textPrimary}>
            {familySetupCopy.privacyHeading}
          </EntryAuthText>
          <EntryAuthText token="caption" color={subscriptionColors.textSecondary}>
            {familySetupCopy.privacyBody}
          </EntryAuthText>
        </Card>
      </View>
    </SubscriptionScreenScaffold>
  );
}

/** Screen 12 — Invite Family Member. */
export function FamilyInviteScreen() {
  const router = useRouter();
  const { dp } = useEntryAuthMetrics();
  const { isMockMode } = useEntitlement();
  const gate = useFamilyGate();
  const family = useFamilyState();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const [sent, setSent] = useState<string | null>(null);

  if (gate !== null) {
    return gate;
  }

  const usage = mockFamilyStore.getSeatUsage();
  const isFull = mockFamilyStore.isFull();

  const send = () => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Enter a valid email address.');
      return;
    }
    setError(undefined);
    const outcome = mockFamilyStore.invite(email, familyInviteCopy.expiryNote);
    if (outcome === 'family_full') {
      // Routed to the dedicated full-plan state rather than shown as a form error: the user needs
      // to manage members, which is a different screen's job.
      router.push(familyRoutes.planFull);
      return;
    }
    if (outcome === 'already_invited') {
      setError('That address already has a pending invitation.');
      return;
    }
    setSent(email.trim());
    setEmail('');
  };

  return (
    <SubscriptionScreenScaffold
      title={familyInviteCopy.heading}
      subtitle={familyInviteCopy.body}
      onBack={() => router.back()}
      isMockMode={isMockMode}
      footer={
        <View style={{ rowGap: dp(8) }}>
          <PrimaryButton
            label={familyInviteCopy.sendInvite}
            onPress={send}
            disabled={isFull}
            testID="family-invite-send"
          />
          <SecondaryButton
            label={familyInviteCopy.shareLink}
            onPress={() => setSent('link')}
            disabled={isFull}
            testID="family-invite-link"
          />
          <SecondaryButton
            label="Pending invitations"
            onPress={() => router.push(familyRoutes.invitations)}
            testID="family-invite-pending"
          />
        </View>
      }
      testID="family-invite"
    >
      <View style={{ rowGap: dp(subscriptionLayout.cardGap) }}>
        <FamilySeatIndicator usage={usage} testID="family-invite-seats" />

        {isFull ? (
          <SubscriptionStateBanner
            tone="warning"
            message={familyInviteCopy.fullNotice}
            testID="family-invite-full"
          />
        ) : null}

        {sent === null ? null : (
          <SubscriptionStateBanner
            tone="success"
            message={
              sent === 'link' ? 'Invitation link ready to share.' : `Invitation sent to ${sent}.`
            }
            testID="family-invite-sent"
          />
        )}

        <AuthTextField
          label={familyInviteCopy.emailLabel}
          placeholder={familyInviteCopy.emailPlaceholder}
          value={email}
          onChangeText={setEmail}
          error={error}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          testID="family-invite-email"
        />

        <EntryAuthText token="caption" color={subscriptionColors.textSecondary}>
          {familyInviteCopy.newOrExisting}
        </EntryAuthText>
        <EntryAuthText token="caption" color={subscriptionColors.textSecondary}>
          {familyInviteCopy.expiryNote}
        </EntryAuthText>
        <EntryAuthText token="caption" color={subscriptionColors.textSecondary}>
          {`${family.invitations.filter((i) => i.status === 'pending').length} pending`}
        </EntryAuthText>
      </View>
    </SubscriptionScreenScaffold>
  );
}

/** Screen 13 — Pending Family Invitations. */
export function FamilyInvitationsScreen() {
  const router = useRouter();
  const { dp } = useEntryAuthMetrics();
  const { isMockMode } = useEntitlement();
  const gate = useFamilyGate();
  const family = useFamilyState();
  const [isLoading, setIsLoading] = useState(true);

  // A brief load, so the loading state is a real state rather than a theoretical one.
  useEffect(() => {
    const timer = setTimeout(() => setIsLoading(false), 350);
    return () => clearTimeout(timer);
  }, []);

  if (gate !== null) {
    return gate;
  }

  return (
    <SubscriptionScreenScaffold
      title={familyInvitationsCopy.heading}
      onBack={() => router.back()}
      isMockMode={isMockMode}
      footer={
        <SecondaryButton
          label="Invite someone"
          onPress={() => router.push(familyRoutes.invite)}
          testID="invitations-invite"
        />
      }
      testID="family-invitations"
    >
      {isLoading ? (
        <EntryAuthText
          token="body"
          color={subscriptionColors.textSecondary}
          accessibilityLiveRegion="polite"
          testID="invitations-loading"
        >
          {familyInvitationsCopy.loading}
        </EntryAuthText>
      ) : family.invitations.length === 0 ? (
        <View style={{ rowGap: dp(6) }} testID="invitations-empty">
          <EntryAuthText token="titleCompact" color={subscriptionColors.textPrimary}>
            {familyInvitationsCopy.empty}
          </EntryAuthText>
          <EntryAuthText token="caption" color={subscriptionColors.textSecondary}>
            {familyInvitationsCopy.emptyBody}
          </EntryAuthText>
        </View>
      ) : (
        <View>
          {family.invitations.map((invitation) => (
            <InvitationRow
              key={invitation.id}
              invitation={invitation}
              onResend={() => undefined}
              onCancel={() => mockFamilyStore.revokeInvitation(invitation.id)}
              testID={`invitation-${invitation.id}`}
            />
          ))}
        </View>
      )}
    </SubscriptionScreenScaffold>
  );
}

/**
 * Screen 14 — Manage Family Members.
 *
 * ── Why the screen carries sections rather than just a list ──────────────────
 * A one-member family is the *normal* first state — the organizer has just bought the plan and
 * invited nobody. Phase 5 rendered that as a single row above a pinned footer, leaving a blank band
 * down most of the screen.
 *
 * The fix is real information, not decorative filler: seat usage with how many accounts remain, the
 * roster, a pending-invitations section that states plainly when there are none, and the shared
 * versus private summary — which is the thing a new organizer most needs to read before inviting
 * anyone. Every element is content the screen owes the user at 1 of 6 as much as at 6 of 6.
 */
export function FamilyMembersScreen() {
  const router = useRouter();
  const { dp } = useEntryAuthMetrics();
  const { entitlement, isMockMode } = useEntitlement();
  const gate = useFamilyGate();
  const family = useFamilyState();
  const [notice, setNotice] = useState<string | null>(null);

  if (gate !== null) {
    return gate;
  }

  const usage = mockFamilyStore.getSeatUsage();
  const pending = family.invitations.filter((invitation) => invitation.status === 'pending');
  // Only the organizer manages. A member sees the roster and the privacy explanation.
  const isOrganizer = entitlement.isFamilyOrganizer;

  const remove = (id: string) => {
    const outcome = mockFamilyStore.removeMember(id);
    if (outcome === 'organizer_cannot_leave') {
      setNotice(familyMembersCopy.cannotRemoveSelf);
      return;
    }
    setNotice(null);
  };

  return (
    <SubscriptionScreenScaffold
      title={familyMembersCopy.heading}
      onBack={() => router.back()}
      isMockMode={isMockMode}
      footer={
        isOrganizer ? (
          <View style={{ rowGap: dp(8) }}>
            <PrimaryButton
              label={familyMembersCopy.invite}
              onPress={() =>
                router.push(mockFamilyStore.isFull() ? familyRoutes.planFull : familyRoutes.invite)
              }
              testID="members-invite"
            />
            <SecondaryButton
              label={familyMembersCopy.pendingSection}
              onPress={() => router.push(familyRoutes.invitations)}
              testID="members-invitations"
            />
          </View>
        ) : undefined
      }
      testID="family-members"
    >
      <View style={{ rowGap: dp(subscriptionLayout.cardGap) }}>
        {notice === null ? null : (
          <SubscriptionStateBanner tone="info" message={notice} testID="members-notice" />
        )}

        {isOrganizer ? null : (
          <SubscriptionStateBanner
            tone="info"
            message={familyMembersCopy.memberOnlyNote}
            testID="members-member-only"
          />
        )}

        {/* Seat usage, with the remaining count spelled out rather than left to be inferred
            from six dots. */}
        <Card testID="members-seat-card">
          <FamilySeatIndicator usage={usage} testID="members-seats" />
          <EntryAuthText token="caption" color={subscriptionColors.textSecondary}>
            {familyMembersCopy.seatsFree(Math.max(0, usage.limit - usage.used))}
          </EntryAuthText>
        </Card>

        <Card testID="members-roster">
          <EntryAuthText token="label" color={subscriptionColors.textPrimary}>
            {familyMembersCopy.membersSection}
          </EntryAuthText>
          {family.members.map((member) => (
            <FamilyMemberRow
              key={member.id}
              member={member}
              onRemove={isOrganizer ? () => remove(member.id) : undefined}
              testID={`member-${member.id}`}
            />
          ))}
        </Card>

        {/* Present whether or not there is anything in it: "no invitations waiting" is the answer
            to a question the organizer will otherwise go looking for. */}
        <Card testID="members-pending">
          <EntryAuthText token="label" color={subscriptionColors.textPrimary}>
            {familyMembersCopy.pendingSection}
          </EntryAuthText>
          {pending.length === 0 ? (
            <EntryAuthText
              token="caption"
              color={subscriptionColors.textSecondary}
              testID="members-no-pending"
            >
              {familyMembersCopy.noPending}
            </EntryAuthText>
          ) : (
            <>
              <EntryAuthText
                token="caption"
                color={subscriptionColors.textSecondary}
                testID="members-pending-count"
              >
                {familyMembersCopy.pendingCount(pending.length)}
              </EntryAuthText>
              {pending.map((invitation) => (
                <InvitationRow
                  key={invitation.id}
                  invitation={invitation}
                  onCancel={
                    isOrganizer ? () => mockFamilyStore.revokeInvitation(invitation.id) : undefined
                  }
                  testID={`members-invitation-${invitation.id}`}
                />
              ))}
            </>
          )}
        </Card>

        {/* The shared-versus-private summary. The single most useful thing on this screen for an
            organizer who is about to invite people into their account. */}
        <Card testID="members-sharing">
          <EntryAuthText token="label" color={subscriptionColors.textPrimary}>
            {familyPlanCopy.sharedHeading}
          </EntryAuthText>
          <EntryAuthText token="caption" color={subscriptionColors.textSecondary}>
            {familyPlanCopy.sharedBody}
          </EntryAuthText>
        </Card>

        <Card testID="members-privacy">
          <EntryAuthText token="label" color={subscriptionColors.textPrimary}>
            {familyPlanCopy.privacyHeading}
          </EntryAuthText>
          <EntryAuthText token="caption" color={subscriptionColors.textSecondary}>
            {familyPlanCopy.privacyBody}
          </EntryAuthText>
          <EntryAuthText
            token="caption"
            color={subscriptionColors.accent}
            accessibilityRole="link"
            onPress={() => router.push(subscriptionRoutes.family('yearly'))}
            testID="members-privacy-link"
          >
            {familyMembersCopy.privacyLink}
          </EntryAuthText>
        </Card>
      </View>
    </SubscriptionScreenScaffold>
  );
}

/** Screen 15 — Family Plan Full. */
export function FamilyPlanFullScreen() {
  const router = useRouter();
  const { dp } = useEntryAuthMetrics();
  const { isMockMode } = useEntitlement();
  const gate = useFamilyGate();

  if (gate !== null) {
    return gate;
  }

  const usage = mockFamilyStore.getSeatUsage();

  return (
    <SubscriptionScreenScaffold
      title={familyFullCopy.heading}
      subtitle={familyFullCopy.body(usage.limit)}
      onBack={() => router.back()}
      isMockMode={isMockMode}
      footer={
        <View style={{ rowGap: dp(8) }}>
          <PrimaryButton
            label={familyFullCopy.manage}
            onPress={() => router.replace(familyRoutes.members)}
            testID="plan-full-manage"
          />
          <SecondaryButton
            label={familyFullCopy.close}
            onPress={() => router.back()}
            testID="plan-full-close"
          />
        </View>
      }
      testID="family-plan-full"
    >
      <View style={{ rowGap: dp(subscriptionLayout.cardGap) }}>
        <FamilySeatIndicator usage={usage} testID="plan-full-seats" />
        {/* Stated explicitly: no one is ever displaced to make room. */}
        <EntryAuthText
          token="body"
          color={subscriptionColors.textPrimary}
          testID="plan-full-notice"
        >
          {familyFullCopy.neverAutoRemove}
        </EntryAuthText>
        <EntryAuthText token="caption" color={subscriptionColors.textSecondary}>
          {familyWording.supporting}
        </EntryAuthText>
      </View>
    </SubscriptionScreenScaffold>
  );
}

type CardProps = { readonly children: React.ReactNode; readonly testID?: string };

function Card({ children, testID }: CardProps) {
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
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: '100%',
    borderWidth: 1,
  },
});
