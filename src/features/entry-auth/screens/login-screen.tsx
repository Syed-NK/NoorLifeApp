import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import { authRoutes, globalRoutes } from '@application/navigation/routes';
import { useAuthActions } from '@application/providers/auth-provider';
import { isValidEmail } from '@services/auth/mock-auth-service';
import { readRememberedEmail, writeRememberedEmail } from '@services/auth/session-storage';

import { AuthHeader } from '../components/auth-header';
import { AuthScaffold } from '../components/auth-scaffold';
import { AuthStatusBanner } from '../components/auth-status-banner';
import { AuthTextField } from '../components/auth-text-field';
import { EntryAuthText } from '../components/entry-auth-text';
import { PasswordField } from '../components/password-field';
import { PrimaryButton } from '../components/primary-button';
import { AppleSignInButton } from '../components/apple-sign-in-button';
import { SocialAuthButton } from '../components/social-auth-button';
import { authErrorCopy, loginCopy, welcomeCopy } from '../entry-auth-copy';
import { entryAuthColors } from '../entry-auth-tokens';
import { useEntryAuthMetrics } from '../use-entry-auth-metrics';
import { useSubmit } from '../use-auth-error';

/**
 * Screen 06 — Login.
 *
 * ── Keyboard safety ─────────────────────────────────────────────────────────
 * The form sits in a `ScrollView` inside a `KeyboardAvoidingView`. That combination is what keeps
 * "content is clipped when the keyboard opens" — a listed rejection gate — from happening: the
 * avoiding view shrinks the available height and the scroll view lets the fields move up past the
 * keyboard rather than being cut off. `keyboardShouldPersistTaps="handled"` means the first tap on
 * Sign In submits instead of being swallowed by keyboard dismissal.
 *
 * ── Validation timing ───────────────────────────────────────────────────────
 * Field errors appear on submit, not while typing: validating an email on every keystroke marks it
 * invalid for as long as it is incomplete, which is noise. Server failures land in the banner, field
 * problems land on the field.
 */
export function LoginScreen() {
  const router = useRouter();
  const { signIn, signInWithProvider } = useAuthActions();
  const submit = useSubmit();
  const { dp } = useEntryAuthMetrics();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [emailError, setEmailError] = useState<string | undefined>(undefined);
  const [passwordError, setPasswordError] = useState<string | undefined>(undefined);

  // Prefill from the last "Remember me" sign-in. Only the address is stored, never the password.
  useEffect(() => {
    let cancelled = false;
    void readRememberedEmail().then((saved) => {
      if (!cancelled && saved !== null) {
        setEmail(saved);
        setRemember(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const onSubmit = () => {
    const trimmed = email.trim();
    const nextEmailError = isValidEmail(trimmed) ? undefined : authErrorCopy['invalid-email'];
    const nextPasswordError = password.length === 0 ? 'Enter your password.' : undefined;
    setEmailError(nextEmailError);
    setPasswordError(nextPasswordError);
    if (nextEmailError !== undefined || nextPasswordError !== undefined) {
      return;
    }

    void submit
      .run(async () => {
        await signIn(trimmed, password);
        await writeRememberedEmail(remember ? trimmed : null);
      })
      .then((ok) => {
        if (ok) {
          // Replaces the stack: Back from Main Home must not return to the sign-in form.
          router.replace(globalRoutes.home);
        }
      });
  };

  // No step indicator, and no swipe-back. The indicator describes the three onboarding panels, and
  // a user on Sign In is not progressing through a finite sequence — they may sit here, or move
  // between Sign In and Sign Up, neither of which is progress. The swipe went with it: Welcome is
  // reached by `replace`, so there is usually nothing behind this screen, and the header's own Back
  // control covers the case where there is.
  return (
    <AuthScaffold testID="login-screen">
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          style={styles.fill}
          contentContainerStyle={{ paddingBottom: dp(24), gap: dp(16) }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <AuthHeader
            onBack={() => router.back()}
            title={loginCopy.title}
            subtitle={loginCopy.subtitle}
            testID="login-header"
          />

          {submit.error === null ? null : (
            <AuthStatusBanner tone="error" message={submit.error.message} testID="login-banner" />
          )}

          <View style={{ gap: dp(14) }}>
            <AuthTextField
              label={loginCopy.email}
              placeholder={loginCopy.emailPlaceholder}
              value={email}
              onChangeText={setEmail}
              error={emailError}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              textContentType="emailAddress"
              returnKeyType="next"
              testID="login-email"
            />
            <PasswordField
              label={loginCopy.password}
              placeholder="••••••••"
              value={password}
              onChangeText={setPassword}
              error={passwordError}
              returnKeyType="go"
              onSubmitEditing={onSubmit}
              testID="login-password"
            />
          </View>

          <View style={styles.row}>
            <Pressable
              onPress={() => setRemember((v) => !v)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: remember }}
              accessibilityLabel={loginCopy.rememberMe}
              hitSlop={8}
              style={[styles.remember, { columnGap: dp(8), minHeight: dp(44) }]}
              testID="login-remember"
            >
              <View
                style={{
                  width: dp(18),
                  height: dp(18),
                  borderRadius: dp(4),
                  borderWidth: 1.5,
                  borderColor: remember ? entryAuthColors.primary : entryAuthColors.border,
                  backgroundColor: remember ? entryAuthColors.primary : entryAuthColors.surface,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {remember ? (
                  // A tick drawn from two borders — no icon font on these screens.
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
              <EntryAuthText token="label">{loginCopy.rememberMe}</EntryAuthText>
            </Pressable>

            <EntryAuthText
              token="label"
              color={entryAuthColors.primary}
              onPress={() => router.push(authRoutes.forgotPassword)}
              accessibilityRole="link"
              testID="login-forgot"
            >
              {loginCopy.forgotPassword}
            </EntryAuthText>
          </View>

          <PrimaryButton
            label={loginCopy.submit}
            onPress={onSubmit}
            loading={submit.loading}
            testID="login-submit"
          />

          <View style={[styles.dividerRow, { columnGap: dp(10) }]}>
            <View style={styles.rule} />
            <EntryAuthText token="caption">{loginCopy.divider}</EntryAuthText>
            <View style={styles.rule} />
          </View>

          <View style={{ gap: dp(10) }}>
            <SocialAuthButton
              provider="google"
              label={welcomeCopy.continueWithGoogle}
              loading={submit.loading}
              onPress={() => void submit.run(() => signInWithProvider('google'))}
              testID="login-google"
            />
            <AppleSignInButton
              onPress={() => void submit.run(() => signInWithProvider('apple'))}
              testID="login-apple"
            />
          </View>

          <EntryAuthText token="caption" align="center">
            {loginCopy.signUpPrompt}
            <EntryAuthText
              token="caption"
              color={entryAuthColors.primary}
              onPress={() => router.replace(authRoutes.signUp)}
              accessibilityRole="link"
              testID="login-signup"
            >
              {loginCopy.signUpAction}
            </EntryAuthText>
          </EntryAuthText>
        </ScrollView>
      </KeyboardAvoidingView>
    </AuthScaffold>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  remember: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  rule: {
    flex: 1,
    height: 1,
    backgroundColor: entryAuthColors.border,
  },
});
