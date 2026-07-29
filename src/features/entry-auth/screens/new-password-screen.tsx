import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { authRoutes } from '@application/navigation/routes';
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
 * The reset token arrives as a route parameter, because that is how it arrives in reality — carried
 * by the emailed link. It is a single-use capability, not a credential, and it is never persisted.
 *
 * An invalid or expired token is a first-class outcome: the service rejects it with
 * `expired-reset-link` and the banner tells the user to request a new one, rather than the screen
 * appearing to work and failing silently.
 */
export function NewPasswordScreen() {
  const router = useRouter();
  const { resetPassword } = useAuthActions();
  const submit = useSubmit();
  const { dp } = useEntryAuthMetrics();
  const params = useLocalSearchParams<{ code?: string; email?: string }>();

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<{ password?: string; confirm?: string }>({});

  /**
   * Whether this screen was reached through a real reset link.
   *
   * Supabase's reset flow works by *establishing a session* from the emailed code — the deep-link
   * handler exchanges it, and `updateUser({ password })` then acts on that session. So there is no
   * token to pass into the update call, and the presence of a code in the link is what tells us the
   * screen is reachable for a genuine reset rather than by direct navigation.
   */
  const arrivedFromLink = typeof params.code === 'string' && params.code.length > 0;

  const onSubmit = () => {
    const next = {
      password: scorePassword(password) === 'weak' ? authErrorCopy['weak-password'] : undefined,
      confirm: password !== confirm ? authErrorCopy['passwords-do-not-match'] : undefined,
    };
    setErrors(next);
    if (next.password !== undefined || next.confirm !== undefined) {
      return;
    }
    void submit.run(() => resetPassword(password)).then((ok) => {
      if (ok) {
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
        <AuthStatusBanner tone="error" message={submit.error.message} testID="new-password-banner" />
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

      <PrimaryButton
        label={newPasswordCopy.submit}
        onPress={onSubmit}
        loading={submit.loading}
        testID="new-password-submit"
      />
    </AuthFormScaffold>
  );
}
