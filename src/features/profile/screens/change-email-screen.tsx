import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { authRoutes } from '@application/navigation/routes';
import { useAuth } from '@application/providers/auth-provider';
import { AuthStatusBanner } from '@features/entry-auth/components/auth-status-banner';
import { AuthTextField } from '@features/entry-auth/components/auth-text-field';
import { EntryAuthText } from '@features/entry-auth/components/entry-auth-text';
import { PrimaryButton } from '@features/entry-auth/components/primary-button';
import { SecondaryButton } from '@features/entry-auth/components/secondary-button';
import { useEntryAuthMetrics } from '@features/entry-auth/use-entry-auth-metrics';
import { subscriptionColors } from '@features/subscription/subscription-tokens';
import {
  AccountSecurityError,
  type AccountSecurityPort,
  type SecurityErrorCode,
} from '@services/account/account-security.contract';
import { accountSecurityPort, normalizeEmail } from '@services/account/account-security.service';
import { isValidEmail } from '@services/auth/mock-auth-service';

import { ProfileDetailCard, ProfileDetailRow } from '../components/profile-detail-card';
import { ProfileDetailScaffold } from '../components/profile-detail-scaffold';
import { ProfileStatusRow } from '../components/profile-status-row';
import { useAccountSecurity } from '../hooks/use-account-security';
import { privacySecurityCopy } from '../privacy-security-copy';
import { PRIVACY_SECURITY_ROUTE } from '../privacy-routes';

/**
 * Change Email — `/profile/privacy-security/change-email`.
 *
 * ── The one thing this screen must never do ─────────────────────────────────
 * Show the new address as the account's address. `updateUser({ email })` *starts* a confirmation;
 * it does not finish one. With Secure Email Change enabled — which this project has, and which
 * this code does not disable — GoTrue emails both the current address and the new one, and the
 * session's `email` stays on the current address until both are actioned.
 *
 * So the visible authenticated address is read from the session on every render and is never
 * replaced by what the user typed. The new address appears only under "Awaiting confirmation",
 * which is read back from Supabase's own `new_email` after the request — not from local state,
 * so leaving and returning shows the backend's answer rather than this screen's memory of it.
 *
 * ── Auth, never `profiles` ──────────────────────────────────────────────────
 * The address lives in `auth.users`. Writing one into `public.profiles` would produce a screen
 * showing the new address, a credential still answering to the old one, and a user locked out at
 * the next sign-in. `profile.service.ts` refuses to write an email for the same reason, and a
 * source scan asserts that neither path exists.
 *
 * ── Email delivery ──────────────────────────────────────────────────────────
 * Production SMTP is not configured for this project, so a confirmation may not arrive. The screen
 * says so plainly and without exposing any configuration detail. Claiming reliable delivery would
 * leave a user waiting for a message that is not coming, and Secure Email Change is not turned off
 * to make the flow look smoother.
 */
export function ChangeEmailScreen({
  port = accountSecurityPort,
}: {
  readonly port?: AccountSecurityPort;
} = {}) {
  const router = useRouter();
  const { dp } = useEntryAuthMetrics();
  const { status } = useAuth();
  const security = useAccountSecurity(port);
  const copy = privacySecurityCopy.email;

  const [draft, setDraft] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /**
   * The double-submit guard.
   *
   * A ref rather than the `busy` flag, because two presses inside one frame both run before React
   * re-renders — so both would read `busy === false`, and the button's own `disabled` prop would
   * not have been applied yet either. A ref is written synchronously, so the second press sees the
   * first one's mark and no second confirmation is emailed.
   */
  const inFlight = useRef(false);
  const [errorCode, setErrorCode] = useState<SecurityErrorCode | null>(null);
  /** The address a confirmation was requested for, as the service normalized it. */
  const [requested, setRequested] = useState<string | null>(null);

  useEffect(() => {
    if (status !== 'signed-out') {
      return;
    }
    if (router.canDismiss()) {
      router.dismissAll();
    }
    router.replace(authRoutes.welcome);
  }, [router, status]);

  const leave = useCallback(() => {
    router.dismissTo(PRIVACY_SECURITY_ROUTE);
  }, [router]);

  const summary = security.summary;
  const currentEmail = summary?.email ?? null;
  const { reload } = security;

  const submit = useCallback(async () => {
    if (inFlight.current) {
      return;
    }

    const candidate = normalizeEmail(draft);
    if (candidate.length === 0) {
      setFieldError(copy.errors.empty);
      return;
    }
    if (!isValidEmail(candidate)) {
      setFieldError(copy.errors.invalid);
      return;
    }
    // Compared after normalization, so "Ahmed@Example.com " is recognised as the current address
    // rather than sent as a change that would confirm to the same mailbox.
    if (currentEmail !== null && candidate === normalizeEmail(currentEmail)) {
      setFieldError(copy.errors.unchanged);
      return;
    }

    inFlight.current = true;
    setBusy(true);
    setFieldError(null);
    setErrorCode(null);
    try {
      const outcome = await port.requestEmailChange(candidate);
      setRequested(outcome.requestedEmail);
      setDraft('');
      // Re-read the session so the pending row reflects Supabase's `new_email` rather than this
      // screen's belief about what it just asked for.
      await reload();
    } catch (thrown) {
      setErrorCode(thrown instanceof AccountSecurityError ? thrown.code : 'unknown');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, [copy.errors, currentEmail, draft, port, reload]);

  if (status === 'signed-out') {
    return <View style={styles.blank} testID="change-email-signed-out" />;
  }

  const providerLabel =
    summary === null || summary.provider === 'unknown'
      ? privacySecurityCopy.account.providerUnknown
      : privacySecurityCopy.account.providerNames[summary.provider];

  /** The backend's pending address where it has one, and the just-requested one otherwise. */
  const pending = summary?.pendingEmail ?? requested;

  return (
    <ProfileDetailScaffold
      title={copy.title}
      onBack={leave}
      backLabel={privacySecurityCopy.backLabel}
      testID="change-email"
    >
      {summary === null ? (
        <ProfileDetailCard testID="change-email-loading-card">
          <EntryAuthText
            token="caption"
            color={subscriptionColors.textSecondary}
            accessibilityLabel={privacySecurityCopy.account.loading}
            testID="change-email-loading"
          >
            {privacySecurityCopy.account.loading}
          </EntryAuthText>
        </ProfileDetailCard>
      ) : !summary.canManagePassword ? (
        /* A social identity owns the address. No form — changing it here is not something this
           application can do, and a field that failed on submit would be worse than a sentence. */
        <ProfileDetailCard testID="change-email-provider-managed">
          <EntryAuthText token="body" color={subscriptionColors.textPrimary}>
            {copy.providerManagedTitle(providerLabel)}
          </EntryAuthText>
          <EntryAuthText token="caption" color={subscriptionColors.textSecondary}>
            {copy.providerManagedBody(providerLabel)}
          </EntryAuthText>
          <SecondaryButton
            label={copy.back}
            onPress={leave}
            testID="change-email-provider-managed-back"
          />
        </ProfileDetailCard>
      ) : (
        <>
          <ProfileDetailCard testID="change-email-form">
            {/* Read from the session on every render. Never replaced by the typed value. */}
            <ProfileDetailRow
              label={copy.currentLabel}
              value={currentEmail ?? privacySecurityCopy.account.emailUnknown}
              supporting={copy.currentSupporting}
              testID="change-email-current"
            />

            <EntryAuthText
              token="caption"
              color={subscriptionColors.textSecondary}
              testID="change-email-intro"
            >
              {copy.intro}
            </EntryAuthText>

            <AuthTextField
              label={copy.newLabel}
              placeholder={copy.newPlaceholder}
              value={draft}
              onChangeText={(next) => {
                setDraft(next);
                setFieldError(null);
                setErrorCode(null);
              }}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              textContentType="emailAddress"
              returnKeyType="done"
              {...(fieldError === null ? {} : { error: fieldError })}
              testID="change-email-new"
            />

            <EntryAuthText
              token="caption"
              color={subscriptionColors.warning}
              testID="change-email-delivery-note"
            >
              {copy.deliveryNote}
            </EntryAuthText>

            <PrimaryButton
              label={copy.submit}
              onPress={() => void submit()}
              loading={busy}
              accessibilityHint={copy.submitHint}
              testID="change-email-submit"
            />
          </ProfileDetailCard>

          {errorCode === null ? null : (
            <AuthStatusBanner
              tone="error"
              message={privacySecurityCopy.errors[errorCode]}
              testID="change-email-error"
            />
          )}

          {/* The pending state. It never says the address changed, because it has not. */}
          {pending === null || errorCode !== null ? null : (
            <View style={{ rowGap: dp(6) }} testID="change-email-pending">
              <AuthStatusBanner
                tone="info"
                message={copy.pending(pending)}
                testID="change-email-pending-banner"
              />
              <ProfileStatusRow
                label={copy.pendingRowLabel}
                value={pending}
                supporting={copy.pendingSupporting}
                testID="change-email-pending-row"
              />
              <SecondaryButton
                label={copy.back}
                onPress={leave}
                testID="change-email-pending-back"
              />
            </View>
          )}
        </>
      )}
    </ProfileDetailScaffold>
  );
}

const styles = StyleSheet.create({
  blank: {
    flex: 1,
    backgroundColor: subscriptionColors.pageBackground,
  },
});
