import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { authRoutes } from '@application/navigation/routes';
import { useAuthActions } from '@application/providers/auth-provider';

import { AuthIllustration } from '../components/auth-illustration';
import { AuthScaffold } from '../components/auth-scaffold';
import { AuthStatusBanner } from '../components/auth-status-banner';
import { EntryAuthText } from '../components/entry-auth-text';
import { AppleSignInButton } from '../components/apple-sign-in-button';
import { SocialAuthButton } from '../components/social-auth-button';
import { noorLifeAssets } from '@shared/assets/noorlife-assets';
import { illustrationLabels, welcomeCopy } from '../entry-auth-copy';
import { entryAuthColors } from '../entry-auth-tokens';
import { useEntryAuthMetrics } from '../use-entry-auth-metrics';
import { useSubmit } from '../use-auth-error';

/**
 * Screen 05 — Welcome / Authentication Options.
 *
 * Three equal provider buttons, a sign-up link and the legal line, over the Noor AI artwork.
 *
 * Google and Apple are wired to the service and will report `provider-not-configured`, which the
 * banner states plainly. The prompt is explicit that the UI must not imply provider sign-in works
 * before it is configured, so the buttons are present and honest rather than hidden or faked.
 */
export function WelcomeScreen() {
  const router = useRouter();
  const { signInWithProvider } = useAuthActions();
  const submit = useSubmit();
  const { dp } = useEntryAuthMetrics();

  return (
    <AuthScaffold testID="welcome-screen" contentStyle={styles.centred}>
      {/* One vertically centred block — artwork, heading, provider stack, links — rather than an
          illustration that grows to fill. The reference groups them tightly, and a flexible
          illustration area here blew the robot up to three times its intended size, which also
          exposed the extraction's rough edges. */}
      <View style={{ gap: dp(12) }}>
        <View style={{ height: dp(150) }}>
          <AuthIllustration
            source={noorLifeAssets.entryAuth.noorAiRobot}
            accessibilityLabel={illustrationLabels.noorAi}
            testID="welcome-artwork"
          />
        </View>
        <EntryAuthText token="title" align="center" accessibilityRole="header">
          {welcomeCopy.title}
        </EntryAuthText>

        {submit.error === null ? null : (
          <AuthStatusBanner tone="error" message={submit.error.message} testID="welcome-banner" />
        )}

        <View style={{ gap: dp(10) }}>
          <SocialAuthButton
            provider="email"
            label={welcomeCopy.continueWithEmail}
            onPress={() => router.push(authRoutes.signIn)}
            testID="welcome-email"
          />
          <SocialAuthButton
            provider="google"
            label={welcomeCopy.continueWithGoogle}
            disabled={submit.loading}
            onPress={() => void submit.run(() => signInWithProvider('google'))}
            testID="welcome-google"
          />
          {/* Apple's own component, which carries the official mark. It renders nothing on
              platforms without Sign in with Apple, which is why the Pixel 8 shows no Apple row. */}
          <AppleSignInButton
            onPress={() => void submit.run(() => signInWithProvider('apple'))}
            testID="welcome-apple"
          />
        </View>

        <EntryAuthText token="caption" align="center">
          {welcomeCopy.signUpPrompt}
          <EntryAuthText
            token="caption"
            color={entryAuthColors.primary}
            onPress={() => router.push(authRoutes.signUp)}
            accessibilityRole="link"
            testID="welcome-signup"
          >
            {welcomeCopy.signUpAction}
          </EntryAuthText>
        </EntryAuthText>

        <EntryAuthText token="caption" align="center">
          {welcomeCopy.legalPrefix}
          <EntryAuthText token="caption" color={entryAuthColors.primary} accessibilityRole="link">
            {welcomeCopy.terms}
          </EntryAuthText>
          {welcomeCopy.legalJoin}
          <EntryAuthText token="caption" color={entryAuthColors.primary} accessibilityRole="link">
            {welcomeCopy.privacy}
          </EntryAuthText>
        </EntryAuthText>
      </View>
    </AuthScaffold>
  );
}

const styles = StyleSheet.create({
  centred: {
    justifyContent: 'center',
  },
});
