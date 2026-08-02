import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { authRoutes, globalRoutes } from '@application/navigation/routes';
import { useAuth } from '@application/providers/auth-provider';
import { EntryAuthText } from '@features/entry-auth/components/entry-auth-text';
import { PrimaryButton } from '@features/entry-auth/components/primary-button';
import { SecondaryButton } from '@features/entry-auth/components/secondary-button';
import { useEntryAuthMetrics } from '@features/entry-auth/use-entry-auth-metrics';
import { SubscriptionStateBanner } from '@features/subscription/components/subscription-states';
import { formatRenewalDate as formatIsoDate } from '@features/subscription/domain/pricing';
import { useEntitlement } from '@features/subscription/services/entitlement-context';
import { subscriptionColors } from '@features/subscription/subscription-tokens';
import type {
  AccountProvider,
  AccountSecurityPort,
  AccountSecuritySummary,
} from '@services/account/account-security.contract';
import { accountSecurityPort } from '@services/account/account-security.service';
import {
  copyToClipboard,
  openEmailDraft,
  openExternalUrl,
  type LinkOutcome,
} from '@services/links/external-link.service';

import { ProfileDetailCard, ProfileDetailRow } from '../components/profile-detail-card';
import { ProfileDetailScaffold } from '../components/profile-detail-scaffold';
import { ProfileDestructiveRow } from '../components/profile-destructive-row';
import { ProfileDialog } from '../components/profile-dialog';
import { ProfileStatusRow } from '../components/profile-status-row';
import { useAccountSecurity } from '../hooks/use-account-security';
import {
  AI_BOUNDARIES,
  AI_CONVERSATION_STORAGE_EXISTS,
  AI_GRANT_EDITING_AVAILABLE,
  effectiveAIScope,
} from '../privacy/ai-effective-scope';
import {
  ACCOUNT_HELD_DATA,
  DEVICE_STORAGE_NAMESPACES,
  PRIVACY_CAPABILITIES,
} from '../privacy/privacy-capabilities';
import { privacySecurityCopy } from '../privacy-security-copy';
import { CHANGE_EMAIL_ROUTE, CHANGE_PASSWORD_ROUTE } from '../privacy-routes';
import { profileCopy } from '../profile-copy';

/**
 * Privacy & Security — `/profile/privacy-security`.
 *
 * ── The rule this screen is built to ────────────────────────────────────────
 * Every line states something the application can actually demonstrate. Where a capability does
 * not exist — an analytics SDK, a stored AI conversation, a server-side account deletion — the
 * screen says so in a sentence rather than offering a control that would remember a position and
 * change nothing. A privacy screen full of inert switches is the most convincing lie an
 * application can tell, because it looks exactly like a finished one.
 *
 * ── Five sections, and what each is allowed to claim ────────────────────────
 *   1. Account Security — facts read from the authenticated session. Never a token, never the user
 *      id, never a raw metadata bag; an unreported provider is labelled as unreported.
 *   2. Privacy Controls — the audited collection status per category. Three of the five are
 *      "Not collected", and `privacy-capabilities.test.ts` verifies that against `package.json`.
 *   3. AI Data & Permissions — the *effective* scope, derived from the same functions that enforce
 *      it. Editing grants is deferred because no grant store exists; no switches are drawn.
 *   4. Sessions — this device only, because Supabase gives the app no device list and inventing
 *      one would be the easiest lie on the screen to tell and the hardest for a user to catch.
 *   5. Account Management — Delete Account, which this build cannot perform and therefore does
 *      not, in any partial form.
 *
 * ── Nothing here touches Supabase ───────────────────────────────────────────
 * Every backend call goes through `AccountSecurityPort`. `profile-isolation.test.ts` asserts that
 * no file in this feature references the client, the SDK or AsyncStorage.
 */
export function PrivacySecurityScreen({
  /** Injected by tests and the capture harness for states a real account cannot safely reach. */
  port = accountSecurityPort,
}: {
  readonly port?: AccountSecurityPort;
} = {}) {
  const router = useRouter();
  const { status } = useAuth();
  const security = useAccountSecurity(port);

  /**
   * Signed out — leave, without drawing anything.
   *
   * `dismissAll` before `replace` is what makes Back unable to return: replacing alone would swap
   * this screen for Authentication while leaving Profile and Main Home beneath it in the stack.
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

  if (status === 'signed-out') {
    return <View style={styles.blank} testID="privacy-security-signed-out" />;
  }

  return (
    <ProfileDetailScaffold
      title={privacySecurityCopy.title}
      onBack={() => router.dismissTo(globalRoutes.profile)}
      backLabel={profileCopy.detail.backToProfile}
      testID="privacy-security"
    >
      <AccountSecuritySection
        summary={security.summary}
        onChangePassword={() => router.push(CHANGE_PASSWORD_ROUTE)}
        onChangeEmail={() => router.push(CHANGE_EMAIL_ROUTE)}
      />
      <PrivacyControlsSection />
      <AIPermissionsSection />
      <SessionsSection port={port} summary={security.summary} />
      <AccountManagementSection />
    </ProfileDetailScaffold>
  );
}

/** The display name for a provider, or null when the session did not report one we implement. */
function providerName(provider: AccountProvider): string | null {
  const { providerNames } = privacySecurityCopy.account;
  return provider === 'unknown' ? null : providerNames[provider];
}

/**
 * Account Security.
 *
 * ── What is displayed, and what is deliberately not ─────────────────────────
 * The sign-in method, the address, whether that address is confirmed, and the last sign-in when
 * the provider reported one. That is the entire list. The user id, the access and refresh tokens,
 * the provider token, the Supabase project reference and every raw metadata field are absent by
 * construction — `AccountSecuritySummary` has six fields and none of them is any of those, so
 * there is no path by which one could be rendered. A test asserts the key set.
 *
 * ── Verification is a word, not a colour ────────────────────────────────────
 * "Verified" / "Not verified" / "Unknown" are read as text, and the supporting sentence explains
 * what to do. Nothing about the state is carried by hue alone.
 */
function AccountSecuritySection({
  summary,
  onChangePassword,
  onChangeEmail,
}: {
  readonly summary: AccountSecuritySummary | null;
  readonly onChangePassword: () => void;
  readonly onChangeEmail: () => void;
}) {
  const { dp } = useEntryAuthMetrics();
  const copy = privacySecurityCopy.account;

  if (summary === null) {
    return (
      <ProfileDetailCard heading={copy.heading} testID="privacy-security-account">
        <EntryAuthText
          token="caption"
          color={subscriptionColors.textSecondary}
          accessibilityLabel={copy.loading}
          testID="privacy-security-account-loading"
        >
          {copy.loading}
        </EntryAuthText>
      </ProfileDetailCard>
    );
  }

  const provider = providerName(summary.provider);
  const lastSignIn = formatIsoDate(summary.lastSignInAt);
  const verificationWord = copy.verification[summary.emailVerification];

  return (
    <ProfileDetailCard heading={copy.heading} testID="privacy-security-account">
      {/* An unreported provider is labelled as unreported rather than defaulted to Email — the
          plausible fallback that would be a claim about somebody's own credentials. */}
      <ProfileDetailRow
        label={copy.providerLabel}
        value={provider ?? copy.providerUnknown}
        {...(provider === null ? { supporting: copy.providerUnknownSupporting } : {})}
        testID="privacy-security-provider"
      />

      <ProfileDetailRow
        label={copy.emailLabel}
        value={summary.email ?? copy.emailUnknown}
        testID="privacy-security-email"
      />

      {/* The state is the word, and the word appears once. The device pass caught this rendering
          "Verified  Verified" — a value and a pill saying the same thing, which is noise rather
          than emphasis. Colour was never carrying the meaning, so dropping the pill costs nothing
          and the accessible label still announces the pair. */}
      <ProfileStatusRow
        label={copy.verificationLabel}
        value={verificationWord}
        {...(summary.emailVerification === 'not-verified'
          ? { supporting: copy.notVerifiedSupporting }
          : summary.emailVerification === 'unknown'
            ? { supporting: copy.verificationUnknownSupporting }
            : {})}
        accessibilityLabel={copy.verificationAccessibility(verificationWord)}
        testID="privacy-security-verification"
      />

      {/* Rendered only when the provider actually reported a date. A "last seen" line that fell
          back to now would be a fabricated security fact on a security screen. */}
      {lastSignIn === null ? null : (
        <ProfileDetailRow
          label={copy.lastSignInLabel}
          value={lastSignIn}
          supporting={copy.lastSignInSupporting}
          testID="privacy-security-last-sign-in"
        />
      )}

      {summary.canManagePassword ? (
        <View style={{ rowGap: dp(8) }}>
          <SecondaryButton
            label={copy.changePassword}
            onPress={onChangePassword}
            testID="privacy-security-change-password"
          />
          <SecondaryButton
            label={copy.changeEmail}
            onPress={onChangeEmail}
            testID="privacy-security-change-email"
          />
        </View>
      ) : (
        /* No password form and no disabled buttons: the credential is not ours to change, and a
           greyed control would imply it is merely unavailable. */
        <View style={{ rowGap: dp(6) }} testID="privacy-security-provider-managed">
          <EntryAuthText token="body" color={subscriptionColors.textPrimary}>
            {copy.providerManagedPassword(provider ?? copy.providerUnknown)}
          </EntryAuthText>
          <EntryAuthText token="caption" color={subscriptionColors.textSecondary}>
            {copy.providerManagedSupporting(provider ?? copy.providerUnknown)}
          </EntryAuthText>
          <EntryAuthText token="caption" color={subscriptionColors.textSecondary}>
            {copy.providerManagedEmailSupporting(provider ?? copy.providerUnknown)}
          </EntryAuthText>
        </View>
      )}
    </ProfileDetailCard>
  );
}

/**
 * Privacy Controls.
 *
 * Five audited categories, each a status rather than a switch. Three read "Not collected", and
 * that is a statement about the installed dependencies which `privacy-capabilities.test.ts`
 * verifies by reading `package.json` — so the claim fails a test before it can become stale.
 *
 * The Privacy Policy link opens the published URL from centralized configuration. A failure offers
 * a retry and the URL to copy rather than leaving a dead button.
 */
function PrivacyControlsSection() {
  const { dp } = useEntryAuthMetrics();
  const copy = privacySecurityCopy.privacy;

  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);

  const open = useCallback(async () => {
    setFailed(false);
    setCopied(false);
    const outcome: LinkOutcome = await openExternalUrl(copy.privacyPolicyUrl);
    if (outcome !== 'opened') {
      setFailed(true);
    }
  }, [copy.privacyPolicyUrl]);

  return (
    <ProfileDetailCard heading={copy.heading} testID="privacy-security-privacy">
      <EntryAuthText
        token="caption"
        color={subscriptionColors.textSecondary}
        testID="privacy-security-privacy-intro"
      >
        {copy.intro}
      </EntryAuthText>

      {/* Scope leads the supporting sentence rather than riding in a pill beside the value. The
          device pass caught "On this device" clipped mid-word on the Diagnostic information row:
          a two-line label, a four-word status and a three-word pill do not fit one 361 dp line,
          and a truncated privacy statement is worse than a plain one. */}
      {PRIVACY_CAPABILITIES.map((capability) => (
        <ProfileStatusRow
          key={capability.key}
          label={capability.label}
          value={copy.statusWords[capability.status]}
          supporting={
            capability.scope === 'none'
              ? capability.detail
              : `${copy.scopeWords[capability.scope]}. ${capability.detail}`
          }
          testID={capability.testID}
        />
      ))}

      {/* The qualifier leads, so the list is read as "what this version stores" rather than as a
          closed inventory that a later feature would quietly falsify. */}
      <ProfileStatusRow
        label={copy.accountDataHeading}
        supporting={`${copy.accountDataSupporting} ${ACCOUNT_HELD_DATA.join('. ')}.`}
        accessibilityLabel={`${copy.accountDataHeading}. ${copy.accountDataSupporting} ${ACCOUNT_HELD_DATA.join('. ')}`}
        testID="privacy-security-account-data"
      />

      <ProfileStatusRow
        label={copy.storageHeading}
        supporting={`${DEVICE_STORAGE_NAMESPACES.join(', ')}. ${copy.storageSupporting}`}
        accessibilityLabel={`${copy.storageHeading}. ${copy.storageSupporting}`}
        testID="privacy-security-device-storage"
      />

      {/* Stated rather than omitted: "encrypted" without "not end-to-end" is the single most
          consequential overstatement available on this screen. */}
      <EntryAuthText
        token="caption"
        color={subscriptionColors.textSecondary}
        testID="privacy-security-encryption-note"
      >
        {copy.encryptionNote}
      </EntryAuthText>

      <EntryAuthText
        token="caption"
        color={subscriptionColors.textSecondary}
        testID="privacy-security-diagnostics-exclusion"
      >
        {copy.diagnosticsExclusion}
      </EntryAuthText>

      <SecondaryButton
        label={copy.privacyPolicy}
        onPress={() => void open()}
        testID="privacy-security-privacy-policy"
      />

      {failed ? (
        <View style={{ rowGap: dp(6) }} testID="privacy-security-privacy-policy-failed">
          <SubscriptionStateBanner
            tone="warning"
            message={copy.privacyPolicyFailed}
            testID="privacy-security-privacy-policy-failed-banner"
          />
          <SecondaryButton
            label={copy.retry}
            onPress={() => void open()}
            testID="privacy-security-privacy-policy-retry"
          />
          <SecondaryButton
            label={copied ? copy.copied : copy.copyLink}
            onPress={() => {
              void copyToClipboard(copy.privacyPolicyUrl).then(setCopied);
            }}
            testID="privacy-security-privacy-policy-copy"
          />
        </View>
      ) : null}
    </ProfileDetailCard>
  );
}

/**
 * AI Data & Permissions.
 *
 * ── Two questions, kept apart ───────────────────────────────────────────────
 * "Can I open this module's assistant?" is answered by the entitlement. "May Noor AI read this
 * module's records?" is answered by the entitlement *and* an explicit grant. Collapsing them is
 * how a subscription silently becomes a data-access permission, so they are two lists.
 *
 * ── Why there are no switches ───────────────────────────────────────────────
 * No grant store exists — `grantedModules` is a parameter every caller passes literally, and
 * nothing persists a decision. So the effective grant set is empty, every permitted module reads
 * "Asks first", and editing is deferred in a sentence. Drawing switches over a store that does not
 * exist would produce controls that remember a position and change nothing.
 */
function AIPermissionsSection() {
  const { dp } = useEntryAuthMetrics();
  const { entitlement } = useEntitlement();
  const copy = privacySecurityCopy.ai;

  // Grants default to empty because nothing persists them. Passing the real (absent) set rather
  // than assuming access is what makes this display match what the orchestrator would decide.
  const scope = effectiveAIScope(entitlement);

  return (
    <ProfileDetailCard heading={copy.heading} testID="privacy-security-ai">
      <EntryAuthText
        token="caption"
        color={subscriptionColors.textSecondary}
        testID="privacy-security-ai-intro"
      >
        {copy.intro}
      </EntryAuthText>

      <EntryAuthText token="label" testID="privacy-security-ai-assistants-heading">
        {copy.assistantHeading}
      </EntryAuthText>
      {scope.map((module) => (
        <ProfileStatusRow
          key={`assistant-${module.moduleId}`}
          label={module.name}
          value={
            module.assistantAvailable ? copy.assistantWords.available : copy.assistantWords.unavailable
          }
          accessibilityLabel={copy.accessAccessibility(
            module.name,
            module.assistantAvailable
              ? copy.assistantWords.available
              : copy.assistantWords.unavailable,
          )}
          testID={`privacy-security-ai-assistant-${module.moduleId}`}
        />
      ))}

      <EntryAuthText token="label" testID="privacy-security-ai-access-heading">
        {copy.accessHeading}
      </EntryAuthText>
      {scope.map((module) => (
        <ProfileStatusRow
          key={`access-${module.moduleId}`}
          label={module.name}
          value={copy.accessWords[module.noorAIAccess]}
          accessibilityLabel={copy.accessAccessibility(
            module.name,
            copy.accessWords[module.noorAIAccess],
          )}
          testID={`privacy-security-ai-access-${module.moduleId}`}
        />
      ))}

      <View style={{ rowGap: dp(6) }}>
        <EntryAuthText
          token="caption"
          color={subscriptionColors.textSecondary}
          testID="privacy-security-ai-asks-first"
        >
          {copy.asksFirstNote}
        </EntryAuthText>
        <EntryAuthText
          token="caption"
          color={subscriptionColors.textSecondary}
          testID="privacy-security-ai-free-scope"
        >
          {copy.freeScopeNote}
        </EntryAuthText>
        <EntryAuthText
          token="caption"
          color={subscriptionColors.textSecondary}
          testID="privacy-security-ai-lapsed"
        >
          {copy.lapsedNote}
        </EntryAuthText>
      </View>

      {/* The module boundaries, read from the shared policy object rather than restated here — a
          rule softened there is softened on this screen too, instead of the screen describing a
          stricter product than the one shipping. */}
      <EntryAuthText token="label" testID="privacy-security-ai-boundaries-heading">
        {copy.boundariesHeading}
      </EntryAuthText>
      {(Object.keys(AI_BOUNDARIES) as (keyof typeof AI_BOUNDARIES)[]).map((subject) => (
        <ProfileStatusRow
          key={`boundary-${subject}`}
          label={copy.boundaryLabels[subject]}
          supporting={AI_BOUNDARIES[subject]}
          accessibilityLabel={`${copy.boundaryLabels[subject]}. ${AI_BOUNDARIES[subject]}`}
          testID={`privacy-security-ai-boundary-${subject}`}
        />
      ))}
      <EntryAuthText
        token="caption"
        color={subscriptionColors.textSecondary}
        testID="privacy-security-ai-cross-module"
      >
        {copy.crossModule}
      </EntryAuthText>

      {/* Audited, not assumed. No conversation store exists anywhere in the application, so there
          is nothing to offer a delete control for — and offering one would be a fake. */}
      {AI_CONVERSATION_STORAGE_EXISTS ? null : (
        <View style={{ rowGap: dp(4) }} testID="privacy-security-ai-no-history">
          <EntryAuthText
            token="body"
            color={subscriptionColors.textPrimary}
            testID="privacy-security-ai-no-history-claim"
          >
            {copy.noHistory}
          </EntryAuthText>
          <EntryAuthText token="caption" color={subscriptionColors.textSecondary}>
            {copy.noHistorySupporting}
          </EntryAuthText>
        </View>
      )}

      {AI_GRANT_EDITING_AVAILABLE ? null : (
        <View style={{ rowGap: dp(4) }} testID="privacy-security-ai-editing-deferred">
          <EntryAuthText token="body" color={subscriptionColors.textPrimary}>
            {copy.editingDeferred}
          </EntryAuthText>
          <EntryAuthText token="caption" color={subscriptionColors.textSecondary}>
            {copy.editingDeferredSupporting}
          </EntryAuthText>
        </View>
      )}
    </ProfileDetailCard>
  );
}

/**
 * Sessions.
 *
 * ── Why only one device is listed ───────────────────────────────────────────
 * Supabase exposes no session list to a client holding a publishable key, and this application
 * consumes none. A "your devices" list would therefore be invented, and an invented device list is
 * both the easiest lie on this screen to tell and the hardest for a user to catch. The section
 * says what it can see and says what it cannot.
 *
 * ── The two sign-outs are genuinely different calls ─────────────────────────
 * `signOutThisDevice` passes `scope: 'local'`; `signOutEverywhere` passes `scope: 'global'`. Both
 * go to the server before anything is claimed. The global one returns an outcome rather than
 * throwing, because `supabase-js` clears the local session even when the remote half fails — so
 * "signed out here, other devices unconfirmed" is a real state and is rendered as exactly that.
 *
 * Nothing here deletes data, and the onboarding preference is untouched.
 */
function SessionsSection({
  port,
  summary,
}: {
  readonly port: AccountSecurityPort;
  readonly summary: AccountSecuritySummary | null;
}) {
  const router = useRouter();
  const { dp } = useEntryAuthMetrics();
  const copy = privacySecurityCopy.sessions;

  const [confirming, setConfirming] = useState<'this-device' | 'all-sessions' | null>(null);
  const [busy, setBusy] = useState(false);
  /**
   * The double-submit guard.
   *
   * A ref rather than the `busy` flag: two presses inside one frame both run before React
   * re-renders, so both would read `busy === false` and both would reach the server. Ending every
   * session twice is harmless; ending it once and reporting it once is what the user was promised.
   */
  const inFlight = useRef(false);
  const [localOnly, setLocalOnly] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  /** Replaces the protected stack with Authentication, so Back cannot return to Profile. */
  const leaveToAuthentication = useCallback(() => {
    if (router.canDismiss()) {
      router.dismissAll();
    }
    router.replace(authRoutes.welcome);
  }, [router]);

  const signOutThisDevice = useCallback(async () => {
    if (inFlight.current) {
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setFailure(null);
    try {
      await port.signOutThisDevice();
      setConfirming(null);
      leaveToAuthentication();
    } catch {
      // The session is still live. Say so rather than navigating to a signed-out interface over a
      // signed-in account.
      setConfirming(null);
      setFailure(privacySecurityCopy.errors.unknown);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, [leaveToAuthentication, port]);

  const signOutEverywhere = useCallback(async () => {
    if (inFlight.current) {
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setFailure(null);
    try {
      const outcome = await port.signOutEverywhere();
      setConfirming(null);
      if (outcome.status === 'local-only') {
        // Do not claim the other devices ended. The dialog says what actually happened, and the
        // user leaves for Authentication afterwards because the local session is genuinely gone.
        setLocalOnly(true);
        return;
      }
      leaveToAuthentication();
    } catch {
      setConfirming(null);
      setFailure(privacySecurityCopy.errors.unknown);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, [leaveToAuthentication, port]);

  const provider = summary === null ? null : providerName(summary.provider);

  return (
    <>
      <ProfileDetailCard heading={copy.heading} testID="privacy-security-sessions">
        <EntryAuthText
          token="caption"
          color={subscriptionColors.textSecondary}
          testID="privacy-security-sessions-intro"
        >
          {copy.intro}
        </EntryAuthText>

        {/* One word, not a word and a pill repeating it — the same correction the verification row
            needed. */}
        <ProfileStatusRow
          label={copy.statusLabel}
          value={copy.signedIn}
          testID="privacy-security-session-status"
        />

        {provider === null ? null : (
          <ProfileStatusRow
            label={privacySecurityCopy.account.providerLabel}
            value={provider}
            testID="privacy-security-session-provider"
          />
        )}

        {summary?.lastSignInAt === undefined ||
        summary?.lastSignInAt === null ||
        formatIsoDate(summary.lastSignInAt) === null ? null : (
          <ProfileStatusRow
            label={privacySecurityCopy.account.lastSignInLabel}
            value={formatIsoDate(summary.lastSignInAt) as string}
            testID="privacy-security-session-last-sign-in"
          />
        )}

        <View style={{ rowGap: dp(8) }}>
          <SecondaryButton
            label={copy.thisDevice}
            onPress={() => setConfirming('this-device')}
            testID="privacy-security-sign-out-device"
          />
          <SecondaryButton
            label={copy.allSessions}
            onPress={() => setConfirming('all-sessions')}
            testID="privacy-security-sign-out-all"
          />
        </View>

        {/* The warning is visible before the control is pressed, not only inside the dialog. */}
        <EntryAuthText
          token="caption"
          color={subscriptionColors.warning}
          testID="privacy-security-sign-out-all-warning"
        >
          {copy.allSessionsWarning}
        </EntryAuthText>

        {failure === null ? null : (
          <SubscriptionStateBanner
            tone="error"
            message={failure}
            testID="privacy-security-sign-out-failed"
          />
        )}
      </ProfileDetailCard>

      {confirming === 'this-device' ? (
        <ProfileDialog
          visible
          title={copy.thisDeviceTitle}
          body={copy.thisDeviceBody}
          onRequestClose={() => setConfirming(null)}
          testID="privacy-security-sign-out-device-confirm"
        >
          <PrimaryButton
            label={copy.thisDeviceConfirm}
            onPress={() => void signOutThisDevice()}
            loading={busy}
            testID="privacy-security-sign-out-device-accept"
          />
          <SecondaryButton
            label={copy.cancel}
            onPress={() => setConfirming(null)}
            testID="privacy-security-sign-out-device-cancel"
          />
        </ProfileDialog>
      ) : null}

      {confirming === 'all-sessions' ? (
        <ProfileDialog
          visible
          title={copy.allSessionsTitle}
          body={copy.allSessionsBody}
          onRequestClose={() => setConfirming(null)}
          testID="privacy-security-sign-out-all-confirm"
        >
          <PrimaryButton
            label={copy.allSessionsConfirm}
            onPress={() => void signOutEverywhere()}
            loading={busy}
            testID="privacy-security-sign-out-all-accept"
          />
          <SecondaryButton
            label={copy.cancel}
            onPress={() => setConfirming(null)}
            testID="privacy-security-sign-out-all-cancel"
          />
        </ProfileDialog>
      ) : null}

      {localOnly ? (
        <ProfileDialog
          visible
          title={copy.localOnlyTitle}
          body={copy.localOnlyBody}
          onRequestClose={() => {
            setLocalOnly(false);
            leaveToAuthentication();
          }}
          testID="privacy-security-sign-out-local-only"
        >
          <SecondaryButton
            label={copy.localOnlyDismiss}
            onPress={() => {
              setLocalOnly(false);
              leaveToAuthentication();
            }}
            testID="privacy-security-sign-out-local-only-dismiss"
          />
        </ProfileDialog>
      ) : null}
    </>
  );
}

/**
 * Account Management.
 *
 * ── This section deletes nothing, in any partial form ───────────────────────
 * Pressing Delete Account opens an informational sheet and stops. There is no call to an auth
 * admin API — one would need the service-role key, which bypasses Row Level Security entirely and
 * must never exist in a mobile bundle. There is no `profiles` row deletion either: removing the
 * profile while `auth.users` keeps the credential produces an account that can still sign in and
 * has lost its name, which is worse than not deleting at all. And sign-out is not offered here,
 * because sign-out dressed as deletion is the specific deception this section exists to refuse.
 *
 * The required architecture is recorded in `docs/ACCOUNT_DELETION_ARCHITECTURE.md`.
 */
function AccountManagementSection() {
  const { dp } = useEntryAuthMetrics();
  const copy = privacySecurityCopy.account_management;

  const [open, setOpen] = useState(false);
  const [mailOutcome, setMailOutcome] = useState<LinkOutcome | null>(null);
  const [copied, setCopied] = useState(false);

  const contactSupport = useCallback(async () => {
    setMailOutcome(null);
    setCopied(false);
    // A draft in the user's own mail application. Nothing is posted — there is no support backend,
    // and a form that appeared to file a deletion request would be the worst fake on this screen.
    const outcome = await openEmailDraft({
      to: copy.supportEmail,
      subject: copy.supportSubject,
      body: copy.supportIntro,
    });
    setMailOutcome(outcome);
  }, [copy.supportEmail, copy.supportIntro, copy.supportSubject]);

  return (
    <>
      <ProfileDetailCard heading={copy.heading} testID="privacy-security-account-management">
        <ProfileDestructiveRow
          label={copy.deleteLabel}
          accessibilityHint={copy.deleteHint}
          onPress={() => setOpen(true)}
          testID="privacy-security-delete-account"
        />
      </ProfileDetailCard>

      {open ? (
        <ProfileDialog
          visible
          title={copy.unavailableTitle}
          body={copy.unavailableBody}
          onRequestClose={() => setOpen(false)}
          testID="privacy-security-delete-account-sheet"
        >
          <SecondaryButton
            label={copy.close}
            onPress={() => setOpen(false)}
            testID="privacy-security-delete-account-close"
          />
          <SecondaryButton
            label={copy.contactSupport}
            onPress={() => void contactSupport()}
            testID="privacy-security-delete-account-support"
          />

          {mailOutcome === 'no-handler' || mailOutcome === 'failed' ? (
            <View style={{ rowGap: dp(6) }} testID="privacy-security-delete-account-mail-fallback">
              <EntryAuthText token="caption" color={subscriptionColors.warning}>
                {`${mailOutcome === 'no-handler' ? copy.noMailApp : copy.mailFailed} ${copy.supportEmail}`}
              </EntryAuthText>
              <SecondaryButton
                label={copied ? copy.copied : copy.copyEmail}
                onPress={() => {
                  void copyToClipboard(copy.supportEmail).then(setCopied);
                }}
                testID="privacy-security-delete-account-copy-email"
              />
            </View>
          ) : null}
        </ProfileDialog>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  blank: {
    flex: 1,
    backgroundColor: subscriptionColors.pageBackground,
  },
});
