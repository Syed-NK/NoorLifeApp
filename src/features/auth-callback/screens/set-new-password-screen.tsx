import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

import { authRoutes } from '@application/navigation/routes';
import {
  useAuthCallback,
  useAuthCallbackActions,
} from '@application/providers/auth-callback-provider';
import { useAuth } from '@application/providers/auth-provider';
import { AuthFormScaffold } from '@features/entry-auth/components/auth-form-scaffold';
import { AuthHeader } from '@features/entry-auth/components/auth-header';
import { AuthStatusBanner } from '@features/entry-auth/components/auth-status-banner';
import { EntryAuthText } from '@features/entry-auth/components/entry-auth-text';
import { PasswordField } from '@features/entry-auth/components/password-field';
import { PasswordStrengthMeter } from '@features/entry-auth/components/password-strength-meter';
import { PrimaryButton } from '@features/entry-auth/components/primary-button';
import { SecondaryButton } from '@features/entry-auth/components/secondary-button';
import { entryAuthColors } from '@features/entry-auth/entry-auth-tokens';
import { useEntryAuthMetrics } from '@features/entry-auth/use-entry-auth-metrics';
import {
  evaluatePasswordDraft,
  type PasswordDraftState,
} from '@features/profile/password-change-validation';
import {
  AccountSecurityError,
  type AccountSecurityPort,
  type SecurityErrorCode,
} from '@services/account/account-security.contract';
import { accountSecurityPort } from '@services/account/account-security.service';
import { privacySecurityCopy } from '@features/profile/privacy-security-copy';

import { authCallbackCopy } from '../auth-callback-copy';

/**
 * `/auth/set-new-password` — the only screen that completes a password recovery.
 *
 * ── Why this exists when `/new-password` already did ────────────────────────
 * The audited `/new-password` screen read a `code` parameter, showed a banner when it was absent, and
 * then called `updateUser({ password })` regardless. It never exchanged the code, so the password it
 * set belonged to *whatever session happened to exist*. Reached with an ordinary live session — one
 * tap from Reset Link Sent, or by deep link — it silently became an unauthenticated Change Password
 * for the signed-in account.
 *
 * This screen cannot do that. It renders a form only while a recovery grant minted by a successful
 * recovery exchange is live, and it checks that grant against the session it actually finds. Without a
 * grant there is no form at all, and the copy explains where a reset has to start.
 *
 * ── The grant is memory-only, and consumed ──────────────────────────────────
 * It is never written to storage. A persisted grant would outlive the recovery it was minted for and
 * become a standing permission to rotate the account's password; losing it on a restart is correct.
 * It is cleared the moment the password is set, so Back cannot re-enter a completed recovery and a
 * second submission has nothing to act on.
 *
 * ── One evaluator, shared with Change Password ───────────────────────────────
 * `evaluatePasswordDraft` is the same function Change Password uses, so the two screens cannot drift
 * apart on what a submittable password is — and the `Set Password` button is disabled for exactly the
 * states it disables there, plus a missing or mismatched grant, which arrive as
 * `sessionReady: false`.
 */

const FIELD_ERROR_COPY: Partial<Record<PasswordDraftState, string>> = {
  empty: authCallbackCopy.setNewPassword.errors.empty,
  'confirm-empty': authCallbackCopy.setNewPassword.errors.confirmEmpty,
  weak: authCallbackCopy.setNewPassword.errors.weak,
  mismatch: authCallbackCopy.setNewPassword.errors.mismatch,
};

export function SetNewPasswordScreen({
  port = accountSecurityPort,
}: {
  readonly port?: AccountSecurityPort;
} = {}) {
  const router = useRouter();
  const { dp } = useEntryAuthMetrics();
  const { recovery } = useAuthCallback();
  const { clearRecovery } = useAuthCallbackActions();
  const auth = useAuth();
  const copy = authCallbackCopy.setNewPassword;

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [touched, setTouched] = useState<{ password: boolean; confirm: boolean }>({
    password: false,
    confirm: false,
  });
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [errorCode, setErrorCode] = useState<SecurityErrorCode | null>(null);
  const [succeeded, setSucceeded] = useState(false);

  /**
   * Whether the grant belongs to the account that is actually signed in.
   *
   * A recovery exchange establishes a session, so by the time this screen renders `auth.user` should be
   * the recovering account. If it is somebody else — a grant that survived while another account signed
   * in on a shared device — the two disagree, and proceeding would change the wrong account's password.
   * `null` on either side is not a mismatch: the session may still be resolving, and that is handled as
   * "not ready" below rather than as a conflict.
   */
  const mismatched =
    recovery !== null && auth.user !== null && auth.user.id !== recovery.userId;

  /**
   * A grant, a matching account, and no request already open.
   *
   * Feeding this to the shared evaluator as `sessionReady` is what makes a missing grant disable the
   * button through the same path as an empty field, rather than through a second check that could
   * disagree with it.
   */
  const grantUsable = recovery !== null && !mismatched && auth.user !== null;

  const evaluation = evaluatePasswordDraft({
    password,
    confirm,
    sessionReady: grantUsable,
    // Recovery is an email-identity flow by construction: a social identity has no NoorLife password
    // to reset and Supabase would not send the link.
    canManagePassword: true,
    submitting: busy,
  });

  const fieldMessage: { password?: string; confirm?: string } =
    evaluation.isFieldProblem && evaluation.field !== null && touched[evaluation.field]
      ? { [evaluation.field]: FIELD_ERROR_COPY[evaluation.state] ?? '' }
      : {};

  const inactive = !evaluation.canSubmit && evaluation.state !== 'submitting';

  /**
   * The grant is released when the screen goes away without completing.
   *
   * Without this a user who backed out would leave a live grant behind, and returning to the route
   * later — by any means — would find it still usable. A recovery that was abandoned is a recovery
   * that has to be restarted from a fresh link.
   */
  useEffect(
    () => () => {
      clearRecovery();
    },
    [clearRecovery],
  );

  const submit = useCallback(async () => {
    setTouched({ password: true, confirm: true });
    if (inFlight.current) {
      return;
    }

    // Re-evaluated rather than read from the render that drew the button, so the keyboard's Submit and
    // a queued press are refused by the same function.
    const check = evaluatePasswordDraft({
      password,
      confirm,
      sessionReady: grantUsable,
      canManagePassword: true,
      submitting: false,
    });
    if (!check.canSubmit) {
      return;
    }

    inFlight.current = true;
    setBusy(true);
    setErrorCode(null);
    try {
      await port.updatePassword({ newPassword: password });
      /**
       * Cleared, then consumed, in that order.
       *
       * The fields go first because there is no reason for the value to outlive the request that used
       * it, and the grant goes with them: a completed recovery must not be replayable, and leaving the
       * grant live would let a second submission act on the same authorisation.
       */
      setPassword('');
      setConfirm('');
      setSucceeded(true);
      clearRecovery();
    } catch (thrown) {
      setErrorCode(thrown instanceof AccountSecurityError ? thrown.code : 'unknown');
      if (thrown instanceof AccountSecurityError && thrown.code === 'session-expired') {
        // The recovery session is gone. Holding a password for a request that can no longer be made is
        // pointless risk, and the grant it depended on is no longer meaningful.
        setPassword('');
        setConfirm('');
        clearRecovery();
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, [clearRecovery, confirm, grantUsable, password, port]);

  const goToSignIn = useCallback(() => {
    // `replace`, so Back cannot return to a completed recovery.
    router.replace(authRoutes.signIn);
  }, [router]);

  const requestNewLink = useCallback(() => {
    router.replace(authRoutes.forgotPassword);
  }, [router]);

  if (succeeded) {
    return (
      <AuthFormScaffold testID="set-new-password-screen">
        <AuthHeader title={copy.title} testID="set-new-password-header" />
        <View style={{ rowGap: dp(12) }} testID="set-new-password-success">
          <AuthStatusBanner
            tone="success"
            message={copy.success}
            testID="set-new-password-success-banner"
          />
          <EntryAuthText token="body" align="center" color={entryAuthColors.textSecondary}>
            {copy.successSupporting}
          </EntryAuthText>
          <PrimaryButton
            label={copy.signIn}
            onPress={goToSignIn}
            testID="set-new-password-success-sign-in"
          />
        </View>
      </AuthFormScaffold>
    );
  }

  if (mismatched) {
    return (
      <AuthFormScaffold testID="set-new-password-screen">
        <AuthHeader onBack={goToSignIn} title={copy.title} testID="set-new-password-header" />
        <View style={{ rowGap: dp(12) }} testID="set-new-password-mismatch">
          <AuthStatusBanner
            tone="error"
            message={copy.mismatchTitle}
            testID="set-new-password-mismatch-banner"
          />
          <EntryAuthText token="body" align="center" color={entryAuthColors.textSecondary}>
            {copy.mismatchSupporting}
          </EntryAuthText>
          <SecondaryButton
            label={copy.requestNewLink}
            onPress={requestNewLink}
            testID="set-new-password-mismatch-request"
          />
        </View>
      </AuthFormScaffold>
    );
  }

  if (recovery === null) {
    /**
     * No grant — no form.
     *
     * Not a disabled form, and certainly not a form that submits against the ambient session. There is
     * nothing this screen can legitimately do without a grant, and the copy says where a reset starts.
     */
    return (
      <AuthFormScaffold testID="set-new-password-screen">
        <AuthHeader onBack={goToSignIn} title={copy.title} testID="set-new-password-header" />
        <View style={{ rowGap: dp(12) }} testID="set-new-password-no-grant">
          <AuthStatusBanner
            tone="info"
            message={copy.noGrantTitle}
            testID="set-new-password-no-grant-banner"
          />
          <EntryAuthText token="body" align="center" color={entryAuthColors.textSecondary}>
            {copy.noGrantSupporting}
          </EntryAuthText>
          <PrimaryButton
            label={copy.requestNewLink}
            onPress={requestNewLink}
            testID="set-new-password-no-grant-request"
          />
        </View>
      </AuthFormScaffold>
    );
  }

  return (
    <AuthFormScaffold testID="set-new-password-screen">
      <AuthHeader
        onBack={goToSignIn}
        title={copy.title}
        subtitle={copy.intro}
        testID="set-new-password-header"
      />

      <View style={{ rowGap: dp(8) }} testID="set-new-password-form">
        <PasswordField
          label={copy.newLabel}
          placeholder={copy.placeholder}
          value={password}
          onChangeText={(next) => {
            setPassword(next);
            setErrorCode(null);
          }}
          onBlur={() => setTouched((previous) => ({ ...previous, password: true }))}
          autoComplete="new-password"
          textContentType="newPassword"
          {...(fieldMessage.password === undefined ? {} : { error: fieldMessage.password })}
          testID="set-new-password-new"
        />
        <PasswordStrengthMeter password={password} testID="set-new-password-strength" />
      </View>

      <PasswordField
        label={copy.confirmLabel}
        placeholder={copy.placeholder}
        value={confirm}
        onChangeText={(next) => {
          setConfirm(next);
          setErrorCode(null);
        }}
        onBlur={() => setTouched((previous) => ({ ...previous, confirm: true }))}
        // The keyboard's Submit takes the same route as the button.
        onSubmitEditing={() => void submit()}
        returnKeyType="done"
        autoComplete="new-password"
        textContentType="newPassword"
        {...(fieldMessage.confirm === undefined ? {} : { error: fieldMessage.confirm })}
        testID="set-new-password-confirm"
      />

      {errorCode === null ? null : (
        <AuthStatusBanner
          tone="error"
          message={privacySecurityCopy.errors[errorCode]}
          testID="set-new-password-error"
        />
      )}

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
        testID="set-new-password-submit"
      />
    </AuthFormScaffold>
  );
}
