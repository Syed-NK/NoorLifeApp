import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { authRoutes } from '@application/navigation/routes';
import { isOnlineAuthenticated, useAuth } from '@application/providers/auth-provider';
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

import { ProfileDetailCard } from '../components/profile-detail-card';
import { ProfileDetailScaffold } from '../components/profile-detail-scaffold';
import { useAccountSecurity } from '../hooks/use-account-security';
import { evaluatePasswordDraft, type PasswordDraftState } from '../password-change-validation';
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
 *
 * ── One guard, read twice ───────────────────────────────────────────────────
 * The device pass found Update Password drawn at full `#1677FF` fill over two empty fields: the
 * button carried no `disabled` prop at all, and the only refusal lived inside `submit`. So the
 * control invited a press, accepted it, and answered with a validation message — the wrong order
 * for an action that rotates a credential, and the same defect Change Email had before
 * `evaluateEmailDraft`.
 *
 * Both readings now come from `evaluatePasswordDraft`. It is the `disabled` prop, it is the
 * keyboard's Submit, and it is the handler's guard, so a state that cannot be submitted also cannot
 * be pressed and the three can no longer drift apart.
 *
 * The one thing the screen composes rather than reads straight is *how* a refusal is drawn: a
 * `submitting` verdict becomes the spinner, and every other refusal becomes the grey fill. Both come
 * from the same single evaluation — this is not a second reading of the question — and it keeps the
 * `onPrimary` spinner off the `#C8CED8` disabled fill, where it would be close to invisible. The
 * `Pressable` is inert either way and geometry is identical in all three states.
 */

/**
 * The inline message for each state the user can fix by typing.
 *
 * A partial record on purpose: `submitting`, `session-unavailable`, `provider-unsupported` and
 * `valid` have no message under a field, and the evaluator's `isFieldProblem` already refuses to
 * put one there. Listing them with empty strings would invite one.
 */
const FIELD_ERROR_COPY: Partial<Record<PasswordDraftState, string>> = {
  empty: privacySecurityCopy.password.errors.empty,
  'confirm-empty': privacySecurityCopy.password.errors.confirmEmpty,
  weak: privacySecurityCopy.password.errors.weak,
  mismatch: privacySecurityCopy.password.errors.mismatch,
};
export function ChangePasswordScreen({
  port = accountSecurityPort,
}: {
  readonly port?: AccountSecurityPort;
} = {}) {
  const router = useRouter();
  const { dp } = useEntryAuthMetrics();
  const auth = useAuth();
  const { status } = auth;
  const security = useAccountSecurity(port);
  const copy = privacySecurityCopy.password;

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  /**
   * Which fields have been interacted with.
   *
   * Inline validation is silent until the field it belongs to is in here, so a screen that has only
   * just opened does not greet the user with "Enter a new password." above an untouched box. Set on
   * blur and on a submit attempt, and never cleared — after the first blur the message tracks what
   * is actually typed, which is what makes the disabled button explain itself.
   */
  const [touched, setTouched] = useState<{ password: boolean; confirm: boolean }>({
    password: false,
    confirm: false,
  });

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

  const summary = security.summary;

  /**
   * Whether a request could be made at all, independent of what is typed.
   *
   * A summary that has not loaded and an authentication state that is not `signed-in` both mean
   * there is no account this form can act on. The control stays disabled rather than offering a
   * credential change against a session nobody has confirmed.
   */
  /*
    ── Online authority, not merely "signed in" ──────────────────────────────
    This screen changes a credential through Supabase. Under offline authority there is no token, so
    submitting could only fail at the transport — after the user had typed a password into a form that
    looked ready. Gating the readiness flag disables the control *before* that, which is what locked
    decision 7 asks for.
  */
  const sessionReady = isOnlineAuthenticated(auth) && summary !== null;

  const evaluation = evaluatePasswordDraft({
    password,
    confirm,
    sessionReady,
    // `null` summary is already covered by `sessionReady`; `true` here keeps the *reason* the
    // control is off as "we do not know yet" rather than mislabelling a loading screen as a social
    // identity.
    canManagePassword: summary === null ? true : summary.canManagePassword,
    submitting: busy,
  });

  /**
   * The one message under a field, shown only for a field the user has reached.
   *
   * `isFieldProblem` is what keeps a session or provider failure out from under the password box:
   * neither is fixed by typing, and an inline error there would be advice that cannot help.
   */
  const fieldMessage: { password?: string; confirm?: string } =
    evaluation.isFieldProblem && evaluation.field !== null && touched[evaluation.field]
      ? { [evaluation.field]: FIELD_ERROR_COPY[evaluation.state] ?? '' }
      : {};

  /**
   * Drawn grey, as opposed to drawn spinning.
   *
   * `submitting` is excluded so the in-flight state keeps its `#1677FF` fill under the spinner —
   * both branches read the one `evaluation` above, so this is a rendering decision rather than a
   * second answer to "can this be submitted?".
   */
  const inactive = !evaluation.canSubmit && evaluation.state !== 'submitting';

  const submit = useCallback(async () => {
    // A submit attempt counts as interaction on both fields, so a refusal is explained rather than
    // silent — including the keyboard's own Submit, which arrives here too.
    setTouched({ password: true, confirm: true });

    if (inFlight.current) {
      // Synchronous, so a second press inside the same frame is swallowed before it can start a
      // second update. The check is first so a rejected duplicate cannot rewrite state under the
      // request that is already running.
      return;
    }

    /**
     * Re-evaluated here rather than read from the render that drew the button.
     *
     * A keyboard Submit, a queued press and a programmatic call all arrive at this line, and the
     * service must not be reachable from any of them while the answer is anything but `valid`. This
     * is the same function the `disabled` prop reads, so the two cannot disagree.
     */
    const check = evaluatePasswordDraft({
      password,
      confirm,
      sessionReady: isOnlineAuthenticated(auth) && summary !== null,
      canManagePassword: summary?.canManagePassword ?? false,
      submitting: false,
    });
    if (!check.canSubmit) {
      return;
    }

    /**
     * The emailed nonce is checked here rather than in the evaluator, deliberately.
     *
     * It is a *second* step, revealed only after the backend asked for it, and by the time it is on
     * screen the user has already satisfied every password requirement. Greying the primary action
     * for a field in a different card would read as the password being wrong again. So its absence
     * is announced under the code field instead, and no request is made.
     */
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
  }, [auth, code, confirm, copy, password, port, reauthRequired, summary]);

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
                  setErrorCode(null);
                  setSucceeded(false);
                }}
                // Validation is announced when the user leaves the field, not while they are still
                // half-way through typing.
                onBlur={() => setTouched((previous) => ({ ...previous, password: true }))}
                // The password-manager hint that lets iOS and Android offer to save the new value.
                autoComplete="new-password"
                textContentType="newPassword"
                {...(fieldMessage.password === undefined ? {} : { error: fieldMessage.password })}
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
                setErrorCode(null);
                setSucceeded(false);
              }}
              onBlur={() => setTouched((previous) => ({ ...previous, confirm: true }))}
              // The keyboard's own Submit takes the same route as the button, so "Done" cannot send
              // a request the button is refusing to send.
              onSubmitEditing={() => void submit()}
              returnKeyType="done"
              autoComplete="new-password"
              textContentType="newPassword"
              {...(fieldMessage.confirm === undefined ? {} : { error: fieldMessage.confirm })}
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
              keep its action there. See the note on `ProfileDetailScaffold`.

              Disabled unless `evaluatePasswordDraft` says the form is submittable. The hint changes
              with the refusal, so a screen reader reaching a greyed control is told what would
              enable it rather than what it would do. */}
          <PrimaryButton
            label={copy.submit}
            onPress={() => void submit()}
            disabled={inactive}
            loading={busy}
            accessibilityHint={
              evaluation.canSubmit
                ? copy.submitHint
                : (copy.submitDisabledHints[
                    evaluation.state as keyof typeof copy.submitDisabledHints
                  ] ?? copy.submitHint)
            }
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
