import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { authRoutes } from '@application/navigation/routes';
import { useAuth } from '@application/providers/auth-provider';
import { AuthStatusBanner } from '@features/entry-auth/components/auth-status-banner';
import { AuthTextField } from '@features/entry-auth/components/auth-text-field';
import { EntryAuthText } from '@features/entry-auth/components/entry-auth-text';
import { PasswordField } from '@features/entry-auth/components/password-field';
import { PasswordStrengthMeter } from '@features/entry-auth/components/password-strength-meter';
import { PrimaryButton } from '@features/entry-auth/components/primary-button';
import { SecondaryButton } from '@features/entry-auth/components/secondary-button';
import { useEntryAuthMetrics } from '@features/entry-auth/use-entry-auth-metrics';
import { subscriptionColors } from '@features/subscription/subscription-tokens';
import {
  AccountSecurityError,
  type AccountSecurityPort,
  type SecurityErrorCode,
} from '@services/account/account-security.contract';
import { accountSecurityPort } from '@services/account/account-security.service';
import { scorePassword } from '@services/auth/mock-auth-service';

import { ProfileDetailCard } from '../components/profile-detail-card';
import { ProfileDetailScaffold } from '../components/profile-detail-scaffold';
import { useAccountSecurity } from '../hooks/use-account-security';
import { privacySecurityCopy } from '../privacy-security-copy';
import { PRIVACY_SECURITY_ROUTE } from '../privacy-routes';

/**
 * Change Password — `/profile/privacy-security/change-password`.
 *
 * ── There is no "current password" field, and that is a decision ────────────
 * Supabase's supported proof for a credential change is a nonce it emails, not a re-submitted old
 * password. A client cannot discover whether a project has
 * `GOTRUE_SECURITY_UPDATE_PASSWORD_REQUIRE_CURRENT_PASSWORD` set, so a current-password field would
 * enforce something on some projects and nothing on others, with the user unable to tell which —
 * a control that looks like a security check and might be decoration.
 *
 * The obvious workaround is worse: signing in again with the typed old password to "verify" it
 * rotates the session and turns this form into a credential-testing endpoint. So the flow is the
 * backend's own. Submit; if GoTrue answers `reauthentication_needed`, ask for the code it emails
 * and submit again with it. Nothing is verified locally, and no requirement is bypassed.
 *
 * ── What the form never does ────────────────────────────────────────────────
 * The password is component state and an argument. It is never written to storage, never attached
 * to a diagnostic report, and never logged — this file contains no logging, and the service it
 * calls contains none either. `account-security-source-scan.test.ts` asserts both.
 *
 * ── Geometry under load ─────────────────────────────────────────────────────
 * `PrimaryButton` swallows a press while loading and replaces its label with a spinner *in place*,
 * so the control does not resize mid-request. The submit guard is a separate `busy` flag, so a
 * double tap cannot produce two update calls even if the button were pressed twice in one frame.
 */
export function ChangePasswordScreen({
  port = accountSecurityPort,
}: {
  readonly port?: AccountSecurityPort;
} = {}) {
  const router = useRouter();
  const { dp } = useEntryAuthMetrics();
  const { status } = useAuth();
  const security = useAccountSecurity(port);
  const copy = privacySecurityCopy.password;

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ password?: string; confirm?: string }>({});

  const [busy, setBusy] = useState(false);
  /**
   * The double-submit guard, and why it is a ref rather than the `busy` flag.
   *
   * Two presses inside one frame both run before React re-renders, so both read `busy === false`
   * and both start a request — the button's own `disabled` prop has not been applied yet either.
   * A ref is written synchronously, so the second press sees the first one's mark. `busy` remains
   * for the spinner, which is a rendering concern and correctly lives in state.
   */
  const inFlight = useRef(false);
  const [errorCode, setErrorCode] = useState<SecurityErrorCode | null>(null);
  const [succeeded, setSucceeded] = useState(false);

  /**
   * Reauthentication state.
   *
   * `required` is set only by the backend answering `reauthentication-required`. Nothing predicts
   * it: predicting wrongly means either an email the user did not need or a form that fails after
   * they have chosen a password.
   */
  const [reauthRequired, setReauthRequired] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);

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

  const submit = useCallback(async () => {
    if (inFlight.current) {
      // Synchronous, so a second press inside the same frame is swallowed before it can start a
      // second update. Validation below is deliberately after this check — a rejected duplicate
      // must not also rewrite the field errors under the request that is already running.
      return;
    }

    const next: { password?: string; confirm?: string } = {
      ...(password.length === 0
        ? { password: copy.errors.empty }
        : scorePassword(password) === 'weak'
          ? { password: copy.errors.weak }
          : {}),
      ...(password !== confirm ? { confirm: copy.errors.mismatch } : {}),
    };
    setFieldErrors(next);
    if (next.password !== undefined || next.confirm !== undefined) {
      return;
    }

    if (reauthRequired && code.trim().length === 0) {
      setCodeError(copy.reauth.missingCode);
      return;
    }

    inFlight.current = true;
    setBusy(true);
    setErrorCode(null);
    setCodeError(null);
    setSucceeded(false);
    try {
      await port.updatePassword({
        newPassword: password,
        ...(reauthRequired && code.trim().length > 0 ? { nonce: code.trim() } : {}),
      });
      // Cleared on success: there is no reason for the value to outlive the request that used it.
      setPassword('');
      setConfirm('');
      setCode('');
      setReauthRequired(false);
      setCodeSent(false);
      setSucceeded(true);
    } catch (thrown) {
      const mapped = thrown instanceof AccountSecurityError ? thrown.code : 'unknown';
      setErrorCode(mapped);
      if (mapped === 'reauthentication-required') {
        // The backend asked. Reveal the confirmation step and keep the chosen password so the
        // user finishes the flow rather than restarting it.
        setReauthRequired(true);
      }
      if (mapped === 'session-expired') {
        // The session is gone; holding a password for a request that can no longer be made is
        // pointless risk.
        setPassword('');
        setConfirm('');
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, [code, confirm, copy, password, port, reauthRequired]);

  const sendCode = useCallback(async () => {
    if (inFlight.current) {
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setErrorCode(null);
    setCodeError(null);
    try {
      await port.sendReauthenticationCode();
      setCodeSent(true);
    } catch (thrown) {
      setErrorCode(thrown instanceof AccountSecurityError ? thrown.code : 'unknown');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, [port]);

  if (status === 'signed-out') {
    return <View style={styles.blank} testID="change-password-signed-out" />;
  }

  const summary = security.summary;
  const providerLabel =
    summary === null || summary.provider === 'unknown'
      ? privacySecurityCopy.account.providerUnknown
      : privacySecurityCopy.account.providerNames[summary.provider];

  return (
    <ProfileDetailScaffold
      title={copy.title}
      onBack={leave}
      backLabel={privacySecurityCopy.backLabel}
      testID="change-password"
    >
      {summary === null ? (
        <ProfileDetailCard testID="change-password-loading-card">
          <EntryAuthText
            token="caption"
            color={subscriptionColors.textSecondary}
            accessibilityLabel={privacySecurityCopy.account.loading}
            testID="change-password-loading"
          >
            {privacySecurityCopy.account.loading}
          </EntryAuthText>
        </ProfileDetailCard>
      ) : !summary.canManagePassword ? (
        /* A social identity. No form, no disabled button — NoorLife holds no password to change,
           and a greyed control would imply it does. */
        <ProfileDetailCard testID="change-password-provider-managed">
          <EntryAuthText token="body" color={subscriptionColors.textPrimary}>
            {copy.providerManagedTitle(providerLabel)}
          </EntryAuthText>
          <EntryAuthText token="caption" color={subscriptionColors.textSecondary}>
            {copy.providerManagedBody(providerLabel)}
          </EntryAuthText>
          <SecondaryButton
            label={copy.back}
            onPress={leave}
            testID="change-password-provider-managed-back"
          />
        </ProfileDetailCard>
      ) : (
        <>
          <ProfileDetailCard heading={copy.heading} testID="change-password-form">
            <EntryAuthText token="caption" color={subscriptionColors.textSecondary}>
              {copy.intro}
            </EntryAuthText>

            <View style={{ rowGap: dp(8) }}>
              <PasswordField
                label={copy.newLabel}
                placeholder={copy.placeholder}
                value={password}
                onChangeText={(next) => {
                  setPassword(next);
                  setFieldErrors({});
                  setErrorCode(null);
                  setSucceeded(false);
                }}
                // The password-manager hint that lets iOS and Android offer to save the new value.
                autoComplete="new-password"
                textContentType="newPassword"
                {...(fieldErrors.password === undefined ? {} : { error: fieldErrors.password })}
                testID="change-password-new"
              />
              <PasswordStrengthMeter password={password} testID="change-password-strength" />
            </View>

            <PasswordField
              label={copy.confirmLabel}
              placeholder={copy.placeholder}
              value={confirm}
              onChangeText={(next) => {
                setConfirm(next);
                setFieldErrors({});
                setErrorCode(null);
                setSucceeded(false);
              }}
              autoComplete="new-password"
              textContentType="newPassword"
              {...(fieldErrors.confirm === undefined ? {} : { error: fieldErrors.confirm })}
              testID="change-password-confirm"
            />
          </ProfileDetailCard>

          {/* Present only after the backend asked for it. */}
          {reauthRequired ? (
            <ProfileDetailCard heading={copy.reauth.heading} testID="change-password-reauth">
              <EntryAuthText token="caption" color={subscriptionColors.textSecondary}>
                {copy.reauth.required}
              </EntryAuthText>

              {codeSent ? (
                <>
                  <AuthStatusBanner
                    tone="info"
                    message={copy.reauth.sent}
                    testID="change-password-reauth-sent"
                  />
                  <AuthTextField
                    label={copy.reauth.codeLabel}
                    placeholder={copy.reauth.codePlaceholder}
                    value={code}
                    onChangeText={(next) => {
                      setCode(next);
                      setCodeError(null);
                    }}
                    keyboardType="number-pad"
                    autoComplete="one-time-code"
                    textContentType="oneTimeCode"
                    maxLength={10}
                    {...(codeError === null ? {} : { error: codeError })}
                    testID="change-password-reauth-code"
                  />
                  <SecondaryButton
                    label={copy.reauth.resend}
                    onPress={() => void sendCode()}
                    testID="change-password-reauth-resend"
                  />
                </>
              ) : (
                <PrimaryButton
                  label={copy.reauth.send}
                  onPress={() => void sendCode()}
                  loading={busy}
                  testID="change-password-reauth-send"
                />
              )}
            </ProfileDetailCard>
          ) : null}

          {errorCode === null ? null : (
            <AuthStatusBanner
              tone="error"
              message={privacySecurityCopy.errors[errorCode]}
              testID="change-password-error"
            />
          )}

          {succeeded ? (
            <View style={{ rowGap: dp(6) }} testID="change-password-success">
              <AuthStatusBanner
                tone="success"
                message={copy.success}
                testID="change-password-success-banner"
              />
              <EntryAuthText token="caption" color={subscriptionColors.textSecondary}>
                {copy.successSupporting}
              </EntryAuthText>
              <SecondaryButton
                label={copy.back}
                onPress={leave}
                testID="change-password-success-back"
              />
            </View>
          ) : null}

          {/* In the scrolling content rather than a pinned footer — a keyboard-bearing screen must
              keep its action there. See the note on `ProfileDetailScaffold`. */}
          <PrimaryButton
            label={copy.submit}
            onPress={() => void submit()}
            loading={busy}
            accessibilityHint={copy.submitHint}
            testID="change-password-submit"
          />
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
