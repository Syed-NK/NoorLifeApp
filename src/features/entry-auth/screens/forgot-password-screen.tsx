import { useRouter } from 'expo-router';
import { useState } from 'react';

import { authRoutes } from '@application/navigation/routes';
import { useAuthActions } from '@application/providers/auth-provider';
import { isValidEmail } from '@services/auth/mock-auth-service';

import { AuthFormScaffold } from '../components/auth-form-scaffold';
import { AuthHeader } from '../components/auth-header';
import { AuthIllustration } from '../components/auth-illustration';
import { AuthStatusBanner } from '../components/auth-status-banner';
import { AuthTextField } from '../components/auth-text-field';
import { EntryAuthText } from '../components/entry-auth-text';
import { PrimaryButton } from '../components/primary-button';
import { noorLifeAssets } from '@shared/assets/noorlife-assets';
import { authErrorCopy, forgotPasswordCopy, illustrationLabels } from '../entry-auth-copy';
import { entryAuthColors } from '../entry-auth-tokens';
import { useEntryAuthMetrics } from '../use-entry-auth-metrics';
import { useSubmit } from '../use-auth-error';
import { View } from 'react-native';

/**
 * Screen 09 — Forgot Password.
 *
 * The success path always advances, and the message never states whether the address is registered.
 * The requirement is explicit about privacy-safe messaging: confirming an account exists here would
 * turn this form into an account-enumeration tool.
 */
export function ForgotPasswordScreen() {
  const router = useRouter();
  const { requestPasswordReset } = useAuthActions();
  const submit = useSubmit();
  const { dp } = useEntryAuthMetrics();

  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState<string | undefined>(undefined);

  const onSubmit = () => {
    const trimmed = email.trim();
    if (!isValidEmail(trimmed)) {
      setEmailError(authErrorCopy['invalid-email']);
      return;
    }
    setEmailError(undefined);
    void submit.run(() => requestPasswordReset(trimmed)).then((ok) => {
      if (ok) {
        router.push({ pathname: authRoutes.resetLinkSent, params: { email: trimmed } });
      }
    });
  };

  return (
    <AuthFormScaffold testID="forgot-screen">
      <AuthHeader
        onBack={() => router.back()}
        title={forgotPasswordCopy.title}
        subtitle={forgotPasswordCopy.subtitle}
        testID="forgot-header"
      />

      <View style={{ height: dp(130) }}>
        <AuthIllustration
          source={noorLifeAssets.entryAuth.emailEnvelope}
          accessibilityLabel={illustrationLabels.emailEnvelope}
          testID="forgot-artwork"
        />
      </View>

      {submit.error === null ? null : (
        <AuthStatusBanner tone="error" message={submit.error.message} testID="forgot-banner" />
      )}

      <AuthTextField
        label={forgotPasswordCopy.email}
        placeholder={forgotPasswordCopy.emailPlaceholder}
        value={email}
        onChangeText={setEmail}
        error={emailError}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        textContentType="emailAddress"
        returnKeyType="go"
        onSubmitEditing={onSubmit}
        testID="forgot-email"
      />

      <PrimaryButton
        label={forgotPasswordCopy.submit}
        onPress={onSubmit}
        loading={submit.loading}
        testID="forgot-submit"
      />

      <EntryAuthText
        token="label"
        align="center"
        color={entryAuthColors.primary}
        onPress={() => router.replace(authRoutes.signIn)}
        accessibilityRole="link"
        testID="forgot-back"
      >
        {forgotPasswordCopy.backToSignIn}
      </EntryAuthText>
    </AuthFormScaffold>
  );
}
