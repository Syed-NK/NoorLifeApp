import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, View } from 'react-native';

import { authRoutes } from '@application/navigation/routes';
import {
  useAuthCallback,
  useAuthCallbackActions,
} from '@application/providers/auth-callback-provider';
import { useAuth, useAuthActions } from '@application/providers/auth-provider';
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
import { clearRecoveryPending } from '@services/auth/recovery-pending';
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
 * ── What *is* persisted, and why it is not the same thing (Phase 6C-3D) ─────
 * A recovery-pending **marker** — see `services/auth/recovery-pending.ts`. It is not a grant and
 * confers nothing: it only tells startup that the live session came from an unfinished recovery, so
 * that a force-close or a process death between the exchange and the update cannot leave an
 * authenticated session wandering into Main Home. Losing the grant on a restart is still correct;
 * what was wrong before was losing the *containment* with it.
 *
 * The marker is released on exactly three paths, and there is no fourth: the update succeeded, the
 * user abandoned the recovery, or the recovery session expired. All three also end the session or
 * hand it back as an ordinary one.
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
  const { signOut } = useAuthActions();
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
      /**
       * The containment marker is released only now, and only after the update has resolved.
       *
       * Awaited before the success state is shown, so there is no instant in which the screen says
       * the recovery is finished while storage still says it is open. If the process dies during
       * this await the marker survives, the next launch resumes here, and the user sets a password
       * that is already set — harmless, and the right direction to be wrong in. The opposite order
       * would clear containment for an update that might still fail.
       */
      await clearRecoveryPending();
      setSucceeded(true);
      clearRecovery();
    } catch (thrown) {
      setErrorCode(thrown instanceof AccountSecurityError ? thrown.code : 'unknown');
      if (thrown instanceof AccountSecurityError && thrown.code === 'session-expired') {
        // The recovery session is gone. Holding a password for a request that can no longer be made is
        // pointless risk, and the grant it depended on is no longer meaningful.
        setPassword('');
        setConfirm('');
        /**
         * The marker goes too, and this is the third of its three release paths.
         *
         * A marker whose session has expired can never be satisfied: the containment would hold the
         * user at a form that cannot submit, on this launch and every one after it. Clearing it
         * hands them back to Sign In, which is the only place the recovery can actually restart.
         */
        await clearRecoveryPending();
        clearRecovery();
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, [clearRecovery, confirm, grantUsable, password, port]);

  /**
   * Leaving a recovery that was never completed.
   *
   * ── Why this signs out rather than just navigating ──────────────────────────
   * The exchange created a real authenticated session before any password was set. Walking away
   * from this screen with that session alive is precisely the state this phase exists to prevent —
   * an account signed in on the strength of an emailed link, with the reset abandoned. Navigating
   * alone would leave it; the marker would still contain it on the next launch, but *this* run
   * would have a live session and no containment in front of it.
   *
   * So abandonment destroys all three: the session, the in-memory grant, and the marker.
   *
   * ── Order ───────────────────────────────────────────────────────────────────
   * Marker first, for the reason in `use-recovery-containment.ts`: `signOut` re-renders every
   * consumer, and a marker still present at that moment describes a session that no longer exists.
   * Navigation last, so nothing routes while the session is mid-flip.
   */
  const abandonRecovery = useCallback(async () => {
    await clearRecoveryPending();
    clearRecovery();
    await signOut().catch(() => {
      // Already gone, or the revocation call failed. The local session is dropped either way, and
      // the marker is cleared, so the destination below is correct regardless.
    });
    // `replace`, so Back cannot return to an abandoned recovery.
    router.replace(authRoutes.signIn);
  }, [clearRecovery, router, signOut]);

  /**
   * Where a *completed* recovery goes.
   *
   * The entry gate, not a fixed screen. With the marker cleared the startup machine re-runs and
   * names the destination this account should actually have — Main Home, or the plan chooser if it
   * never made that choice. Hard-coding Home here would skip the subscription introduction for an
   * account that still owes it, and hard-coding Sign In would ask a signed-in user to sign in
   * again.
   */
  const goToPostRecovery = useCallback(() => {
    router.replace('/');
  }, [router]);

  const goToSignIn = useCallback(() => {
    void abandonRecovery();
  }, [abandonRecovery]);

  /**
   * Restarting the recovery from a fresh email.
   *
   * Also an abandonment: whatever session and marker are here belong to a recovery that is not
   * going to be finished, so they are torn down before the new request begins. Reached from the
   * no-grant and mismatch states, both of which mean this run cannot complete.
   */
  const requestNewLink = useCallback(() => {
    void (async () => {
      await clearRecoveryPending();
      clearRecovery();
      await signOut().catch(() => {
        // See `abandonRecovery`.
      });
      router.replace(authRoutes.forgotPassword);
    })();
  }, [clearRecovery, router, signOut]);

  /**
   * Android's hardware Back is the same abandonment as the header arrow.
   *
   * Without this the system default applies, and on a cold-start recovery the gate reached this
   * screen by `Redirect` — so there is no history entry behind it and Back drops the user out of
   * the app with the recovery session still live. The next launch would be contained by the marker,
   * but "Back leaves a live half-finished recovery behind" is exactly the state this phase closes.
   *
   * Returning true claims the event, so nothing else handles it. Not installed once the update has
   * succeeded: at that point the session is ordinary and Back should behave normally again.
   */
  useEffect(() => {
    if (succeeded) {
      return;
    }
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      void abandonRecovery();
      return true;
    });
    return () => {
      subscription.remove();
    };
  }, [abandonRecovery, succeeded]);

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
            label={copy.continueToApp}
            onPress={goToPostRecovery}
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
