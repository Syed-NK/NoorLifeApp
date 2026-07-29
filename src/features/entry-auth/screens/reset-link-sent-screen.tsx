import * as Linking from 'expo-linking';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { authRoutes } from '@application/navigation/routes';
import { useAuthActions } from '@application/providers/auth-provider';
import { RESEND_COOLDOWN_SECONDS } from '@services/auth/mock-auth-service';

import { AuthFormScaffold } from '../components/auth-form-scaffold';
import { AuthHeader } from '../components/auth-header';
import { AuthIllustration } from '../components/auth-illustration';
import { AuthStatusBanner } from '../components/auth-status-banner';
import { EntryAuthText } from '../components/entry-auth-text';
import { PrimaryButton } from '../components/primary-button';
import { SecondaryButton } from '../components/secondary-button';
import { noorLifeAssets } from '@shared/assets/noorlife-assets';
import { forgotPasswordCopy, illustrationLabels, resetLinkSentCopy } from '../entry-auth-copy';
import { entryAuthColors } from '../entry-auth-tokens';
import { useEntryAuthMetrics } from '../use-entry-auth-metrics';
import { useResendCountdown } from '../use-resend-countdown';
import { useSubmit } from '../use-auth-error';

/**
 * Screen 10 — Reset Link Sent.
 *
 * `Open Email App` uses a `mailto:` intent, and its absence is handled rather than assumed: on a
 * device or emulator with no mail client `canOpenURL` is false, and the screen says so instead of
 * silently doing nothing. That is the "handle absence of an installed mail application gracefully"
 * requirement.
 *
 * The banner still carries the privacy-safe wording from the previous screen, so this screen also
 * never confirms the address is registered.
 */
export function ResetLinkSentScreen() {
  const router = useRouter();
  const { requestPasswordReset } = useAuthActions();
  const submit = useSubmit();
  const resend = useResendCountdown(RESEND_COOLDOWN_SECONDS);
  const { dp } = useEntryAuthMetrics();
  const params = useLocalSearchParams<{ email?: string }>();
  const [mailFailure, setMailFailure] = useState<string | null>(null);

  const email = typeof params.email === 'string' ? params.email : 'your email';

  const openMail = () => {
    void (async () => {
      const url = 'mailto:';
      try {
        if (await Linking.canOpenURL(url)) {
          await Linking.openURL(url);
          return;
        }
      } catch {
        // Fall through to the message below — an intent failure is the same outcome as none.
      }
      setMailFailure(resetLinkSentCopy.noMailApp);
    })();
  };

  return (
    <AuthFormScaffold testID="reset-sent-screen">
      <AuthHeader
        onBack={() => router.back()}
        title={resetLinkSentCopy.title}
        subtitle={resetLinkSentCopy.subtitleFor(email)}
        testID="reset-sent-header"
      />

      <View style={{ height: dp(150) }}>
        <AuthIllustration
          source={noorLifeAssets.entryAuth.emailEnvelope}
          accessibilityLabel={illustrationLabels.emailEnvelope}
          testID="reset-sent-artwork"
        />
      </View>

      <AuthStatusBanner
        tone="info"
        message={forgotPasswordCopy.sent}
        testID="reset-sent-privacy-note"
      />

      {mailFailure === null ? null : (
        <AuthStatusBanner tone="error" message={mailFailure} testID="reset-sent-mail-error" />
      )}
      {submit.error === null ? null : (
        <AuthStatusBanner tone="error" message={submit.error.message} testID="reset-sent-banner" />
      )}

      <PrimaryButton
        label={resetLinkSentCopy.openEmail}
        onPress={openMail}
        testID="reset-sent-open-mail"
      />

      <SecondaryButton
        label={resend.ready ? resetLinkSentCopy.resend : `${resetLinkSentCopy.resend} (${resend.label})`}
        disabled={!resend.ready || submit.loading}
        onPress={() => {
          resend.restart();
          void submit.run(() => requestPasswordReset(email));
        }}
        testID="reset-sent-resend"
      />

      {/* Present so the reset flow can be walked end to end before a real emailed link exists. */}
      <EntryAuthText
        token="label"
        align="center"
        color={entryAuthColors.primary}
        onPress={() => router.push(authRoutes.newPassword)}
        accessibilityRole="link"
        testID="reset-sent-continue"
      >
        I have the link — set a new password
      </EntryAuthText>

      <EntryAuthText
        token="label"
        align="center"
        color={entryAuthColors.primary}
        onPress={() => router.replace(authRoutes.signIn)}
        accessibilityRole="link"
        testID="reset-sent-back"
      >
        {resetLinkSentCopy.backToSignIn}
      </EntryAuthText>
    </AuthFormScaffold>
  );
}
