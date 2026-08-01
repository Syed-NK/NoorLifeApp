import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { authRoutes } from '@application/navigation/routes';
import { useAuthActions, type SignUpOutcome } from '@application/providers/auth-provider';
import { isValidEmail, scorePassword } from '@services/auth/mock-auth-service';

import { AuthFormScaffold } from '../components/auth-form-scaffold';
import { AuthHeader } from '../components/auth-header';
import { AuthStatusBanner } from '../components/auth-status-banner';
import { AuthTextField } from '../components/auth-text-field';
import { EntryAuthText } from '../components/entry-auth-text';
import { PasswordField } from '../components/password-field';
import { PasswordStrengthMeter } from '../components/password-strength-meter';
import { PrimaryButton } from '../components/primary-button';
import { authErrorCopy, signUpCopy } from '../entry-auth-copy';
import { entryAuthColors } from '../entry-auth-tokens';
import { useEntryAuthMetrics } from '../use-entry-auth-metrics';
import { useSubmit } from '../use-auth-error';

/**
 * Screen 07 — Create Account.
 *
 * Password rules are visible before submission through the strength meter, which scores with the
 * same function the service validates with, so the meter and the server can never disagree.
 *
 * Where success leads depends on the project. With email confirmation on, the account exists but is
 * unverified, the provider keeps the session signed out, and the flow goes to Verify Email — so a deep
 * link to Main Home cannot skip verification. With confirmation off the project auto-confirms, Supabase
 * returns a live session and sends no email, so the flow goes straight to Account Ready.
 */
export function SignUpScreen() {
  const router = useRouter();
  const { signUp } = useAuthActions();
  const submit = useSubmit();
  const { dp } = useEntryAuthMetrics();

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});

  const onSubmit = () => {
    const next: Record<string, string | undefined> = {
      fullName: fullName.trim().length === 0 ? 'Enter your name.' : undefined,
      email: isValidEmail(email) ? undefined : authErrorCopy['invalid-email'],
      password: scorePassword(password) === 'weak' ? authErrorCopy['weak-password'] : undefined,
      confirm: password !== confirm ? authErrorCopy['passwords-do-not-match'] : undefined,
      terms: accepted ? undefined : authErrorCopy['terms-not-accepted'],
    };
    setErrors(next);
    if (Object.values(next).some((v) => v !== undefined)) {
      return;
    }

    let outcome: SignUpOutcome | null = null;
    void submit
      .run(async () => {
        outcome = await signUp({
          fullName: fullName.trim(),
          email: email.trim(),
          password,
          acceptedTerms: accepted,
        });
      })
      .then((ok) => {
        if (!ok) {
          return;
        }
        /**
         * Branch on what actually happened, rather than assuming a code was sent.
         *
         * When the project auto-confirms, Supabase returns a live session and sends no email — so
         * Verify Email would ask for a code that does not exist and never will. Sending every signup
         * there regardless is what produced exactly that dead end.
         *
         * `push` for verification, so Back and "Change email" can return to this form. `replace` for
         * the confirmed path, because the account is already signed in and Back must not reopen the
         * form that created it.
         */
        if (outcome?.needsVerification === true) {
          router.push(authRoutes.verifyEmail);
          return;
        }
        router.replace(authRoutes.accountReady);
      });
  };

  // No step indicator and no swipe-back — see the note in login-screen.
  return (
    <AuthFormScaffold testID="signup-screen">
      <AuthHeader
        onBack={() => router.back()}
        title={signUpCopy.title}
        subtitle={signUpCopy.subtitle}
        testID="signup-header"
      />

      {submit.error === null ? null : (
        <AuthStatusBanner tone="error" message={submit.error.message} testID="signup-banner" />
      )}

      <View style={{ gap: dp(14) }}>
        <AuthTextField
          label={signUpCopy.fullName}
          placeholder={signUpCopy.fullNamePlaceholder}
          value={fullName}
          onChangeText={setFullName}
          error={errors.fullName}
          autoComplete="name"
          textContentType="name"
          testID="signup-name"
        />
        <AuthTextField
          label={signUpCopy.email}
          placeholder={signUpCopy.emailPlaceholder}
          value={email}
          onChangeText={setEmail}
          error={errors.email}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          textContentType="emailAddress"
          testID="signup-email"
        />
        <View style={{ gap: dp(8) }}>
          <PasswordField
            label={signUpCopy.password}
            placeholder="••••••••"
            value={password}
            onChangeText={setPassword}
            error={errors.password}
            autoComplete="new-password"
            testID="signup-password"
          />
          <PasswordStrengthMeter password={password} testID="signup-strength" />
        </View>
        <PasswordField
          label={signUpCopy.confirmPassword}
          placeholder="••••••••"
          value={confirm}
          onChangeText={setConfirm}
          error={errors.confirm}
          autoComplete="new-password"
          testID="signup-confirm"
        />
      </View>

      <Pressable
        onPress={() => setAccepted((v) => !v)}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: accepted }}
        accessibilityLabel="I agree to the Terms of Service and Privacy Policy"
        hitSlop={8}
        style={[styles.termsRow, { columnGap: dp(10), minHeight: dp(44) }]}
        testID="signup-terms"
      >
        <View
          style={{
            width: dp(18),
            height: dp(18),
            borderRadius: dp(4),
            borderWidth: 1.5,
            borderColor:
              errors.terms !== undefined
                ? entryAuthColors.error
                : accepted
                  ? entryAuthColors.primary
                  : entryAuthColors.border,
            backgroundColor: accepted ? entryAuthColors.primary : entryAuthColors.surface,
            alignItems: 'center',
            justifyContent: 'center',
            marginTop: dp(2),
          }}
        >
          {accepted ? (
            <View
              style={{
                width: dp(9),
                height: dp(5),
                borderLeftWidth: 2,
                borderBottomWidth: 2,
                borderColor: entryAuthColors.onPrimary,
                transform: [{ rotate: '-45deg' }, { translateY: -dp(1) }],
              }}
            />
          ) : null}
        </View>
        <EntryAuthText token="caption" style={styles.termsText}>
          {signUpCopy.termsPrefix}
          <EntryAuthText token="caption" color={entryAuthColors.primary}>
            {signUpCopy.terms}
          </EntryAuthText>
          {signUpCopy.termsJoin}
          <EntryAuthText token="caption" color={entryAuthColors.primary}>
            {signUpCopy.privacy}
          </EntryAuthText>
        </EntryAuthText>
      </Pressable>
      {errors.terms === undefined ? null : (
        <EntryAuthText
          token="caption"
          color={entryAuthColors.error}
          accessibilityLiveRegion="polite"
        >
          {errors.terms}
        </EntryAuthText>
      )}

      <PrimaryButton
        label={signUpCopy.submit}
        onPress={onSubmit}
        loading={submit.loading}
        testID="signup-submit"
      />

      <EntryAuthText token="caption" align="center">
        {signUpCopy.signInPrompt}
        <EntryAuthText
          token="caption"
          color={entryAuthColors.primary}
          onPress={() => router.replace(authRoutes.signIn)}
          accessibilityRole="link"
          testID="signup-signin"
        >
          {signUpCopy.signInAction}
        </EntryAuthText>
      </EntryAuthText>
    </AuthFormScaffold>
  );
}

const styles = StyleSheet.create({
  termsRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  termsText: {
    flexShrink: 1,
  },
});
