import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { authRoutes } from '@application/navigation/routes';
import { useAuthCallback } from '@application/providers/auth-callback-provider';
import { useAuthActions } from '@application/providers/auth-provider';
import { scorePassword } from '@services/auth/mock-auth-service';

import { AuthFormScaffold } from '../components/auth-form-scaffold';
import { AuthHeader } from '../components/auth-header';
import { AuthIllustration } from '../components/auth-illustration';
import { AuthStatusBanner } from '../components/auth-status-banner';
import { PasswordField } from '../components/password-field';
import { PasswordStrengthMeter } from '../components/password-strength-meter';
import { PrimaryButton } from '../components/primary-button';
import { noorLifeAssets } from '@shared/assets/noorlife-assets';
import { authErrorCopy, illustrationLabels, newPasswordCopy } from '../entry-auth-copy';
import { useEntryAuthMetrics } from '../use-entry-auth-metrics';
import { useSubmit } from '../use-auth-error';

/**
 * Screen 11 — New Password.
 *
 * ── What this screen used to do, and why it could not stay that way ──────────
 * It read a `code` route parameter and showed `noLink` when it was absent — then called
 * `resetPassword(password)` regardless. That call is `updateUser({ password })`, which acts on
 * **whatever session exists**. The code was never exchanged and never checked, so the parameter was
 * decoration: reached with an ordinary live session — one tap from Reset Link Sent, or by deep link —
 * this screen silently became an unauthenticated Change Password for the signed-in account.
 *
 * Phase 6C-3C's authorized callback wiring closes that. Submission now requires a **recovery grant**,
 * which only a successful `PASSWORD_RECOVERY` exchange in `auth-callback.service.ts` mints; it lives in
 * memory, is scoped to one account, and is consumed once. Without a grant the existing `noLink` banner
 * is shown *and the control is disabled*, so the screen can no longer act on a session it was not
 * given permission to act on.
 *
 * The presence of a `code` in the URL is deliberately no longer consulted. A parameter on an untrusted
 * link is a claim; the grant is a fact this device established. Treating the two as equivalent is what
 * made the original check ineffective.
 *
 * ── Why this screen still exists beside `/auth/set-new-password` ─────────────
 * It is Screen 11 of the approved entry sequence and is reachable from Reset Link Sent, so deleting it
 * would remove a screen from a design-locked flow. `/auth/set-new-password` is where the callback sends
 * a user, with the fuller states — grant missing, grant belonging to another account — that its own copy
 * file can describe. Both require the same grant, so neither is a way around the other.
 */
export function NewPasswordScreen() {
  const router = useRouter();
  const { resetPassword } = useAuthActions();
  const submit = useSubmit();
  const { dp } = useEntryAuthMetrics();
  const { recovery } = useAuthCallback();

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<{ password?: string; confirm?: string }>({});

  /**
   * Whether a genuine password recovery is in progress.
   *
   * The grant, and nothing else. Supabase's reset works by *establishing a session* from the emailed
   * code, so there is no token to pass into the update call — which means the only honest evidence that
   * this screen may rotate the credential is that this device exchanged a recovery code and recorded it.
   */
  const arrivedFromLink = recovery !== null;

  const onSubmit = () => {
    if (!arrivedFromLink) {
      // Second reading of the same guard, so a keyboard Submit or a queued press cannot reach the
      // service while the button is refusing to.
      return;
    }
    const next = {
      password: scorePassword(password) === 'weak' ? authErrorCopy['weak-password'] : undefined,
      confirm: password !== confirm ? authErrorCopy['passwords-do-not-match'] : undefined,
    };
    setErrors(next);
    if (next.password !== undefined || next.confirm !== undefined) {
      return;
    }
    void submit
      .run(() => resetPassword(password))
      .then((ok) => {
        if (ok) {
          // `replace`, so Back cannot re-enter a completed recovery.
          router.replace(authRoutes.signIn);
        }
      });
  };

  return (
    <AuthFormScaffold testID="new-password-screen">
      <AuthHeader
        onBack={() => router.back()}
        title={newPasswordCopy.title}
        subtitle={newPasswordCopy.subtitle}
        testID="new-password-header"
      />

      <View style={{ height: dp(140) }}>
        <AuthIllustration
          source={noorLifeAssets.entryAuth.privacyShield}
          accessibilityLabel={illustrationLabels.privacyShield}
          testID="new-password-artwork"
        />
      </View>

      {arrivedFromLink ? null : (
        <AuthStatusBanner
          tone="info"
          message={newPasswordCopy.noLink}
          testID="new-password-no-link"
        />
      )}
      {submit.error === null ? null : (
        <AuthStatusBanner
          tone="error"
          message={submit.error.message}
          testID="new-password-banner"
        />
      )}

      <View style={{ gap: dp(8) }}>
        <PasswordField
          label={newPasswordCopy.newPassword}
          placeholder="••••••••"
          value={password}
          onChangeText={setPassword}
          error={errors.password}
          autoComplete="new-password"
          testID="new-password-field"
        />
        <PasswordStrengthMeter password={password} testID="new-password-strength" />
      </View>

      <PasswordField
        label={newPasswordCopy.confirmPassword}
        placeholder="••••••••"
        value={confirm}
        onChangeText={setConfirm}
        error={errors.confirm}
        autoComplete="new-password"
        testID="new-password-confirm"
      />

      {/* Disabled without a recovery grant. The banner above says why, and no press can reach the
          service — the previous version's parameter check refused nothing. */}
      <PrimaryButton
        label={newPasswordCopy.submit}
        onPress={onSubmit}
        disabled={!arrivedFromLink}
        loading={submit.loading}
        accessibilityHint={arrivedFromLink ? undefined : newPasswordCopy.noLink}
        testID="new-password-submit"
      />
    </AuthFormScaffold>
  );
}
