import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { authRoutes } from '@application/navigation/routes';
import { useAuth, useAuthActions } from '@application/providers/auth-provider';
import { RESEND_COOLDOWN_SECONDS } from '@services/auth/mock-auth-service';

import { AuthFormScaffold } from '../components/auth-form-scaffold';
import { AuthHeader } from '../components/auth-header';
import { AuthIllustration } from '../components/auth-illustration';
import { AuthStatusBanner } from '../components/auth-status-banner';
import { EntryAuthText } from '../components/entry-auth-text';
import { OTP_LENGTH, OtpInput } from '../components/otp-input';
import { PrimaryButton } from '../components/primary-button';
import { noorLifeAssets } from '@shared/assets/noorlife-assets';
import { illustrationLabels, verifyEmailCopy } from '../entry-auth-copy';
import { entryAuthColors } from '../entry-auth-tokens';
import { useEntryAuthMetrics } from '../use-entry-auth-metrics';
import { useResendCountdown } from '../use-resend-countdown';
import { useSubmit } from '../use-auth-error';

/**
 * Screen 08 — Verify Email.
 *
 * The address comes from the auth boundary, not from a route parameter: a parameter would put the
 * user's email into navigation history and into any deep link to this screen.
 *
 * `Resend code` is disabled until the countdown elapses, so the cooldown is visible rather than only
 * enforced by a rejected request. An expired code is a distinct service error and lands in the
 * banner with its own copy.
 */
export function VerifyEmailScreen() {
  const router = useRouter();
  const { pendingVerificationEmail } = useAuth();
  const { verifyEmail, resendVerificationCode } = useAuthActions();
  const submit = useSubmit();
  const resend = useResendCountdown(RESEND_COOLDOWN_SECONDS);
  const { dp } = useEntryAuthMetrics();

  const [code, setCode] = useState('');
  const [invalid, setInvalid] = useState(false);

  /**
   * There is nothing to verify.
   *
   * Reached when the project auto-confirms new accounts — Supabase returns a live session and sends no
   * email — or when this route is opened directly. Either way no code exists, so the screen says so
   * instead of showing six empty boxes and a subtitle promising a message that will never arrive.
   */
  const hasPendingVerification = pendingVerificationEmail !== null;
  const email = pendingVerificationEmail ?? 'your email';

  const onVerify = () => {
    if (code.length !== OTP_LENGTH) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    void submit
      .run(() => verifyEmail(code))
      .then((ok) => {
        if (ok) {
          router.replace(authRoutes.accountReady);
        } else {
          setInvalid(true);
        }
      });
  };

  return (
    <AuthFormScaffold testID="verify-screen">
      <AuthHeader
        onBack={() => router.back()}
        title={verifyEmailCopy.title}
        subtitle={
          hasPendingVerification
            ? verifyEmailCopy.subtitleFor(email)
            : verifyEmailCopy.noPendingSubtitle
        }
        testID="verify-header"
      />

      <View style={{ height: dp(120) }}>
        <AuthIllustration
          source={noorLifeAssets.entryAuth.emailEnvelope}
          accessibilityLabel={illustrationLabels.emailEnvelope}
          testID="verify-artwork"
        />
      </View>

      {hasPendingVerification ? null : (
        <AuthStatusBanner
          tone="info"
          message={verifyEmailCopy.nothingToVerify}
          testID="verify-nothing-pending"
        />
      )}

      {submit.error === null ? null : (
        <AuthStatusBanner tone="error" message={submit.error.message} testID="verify-banner" />
      )}

      <OtpInput
        value={code}
        onChange={(next) => {
          setCode(next);
          setInvalid(false);
          submit.clear();
        }}
        invalid={invalid}
        onComplete={onVerify}
        testID="verify-otp"
      />

      <PrimaryButton
        label={verifyEmailCopy.submit}
        onPress={onVerify}
        loading={submit.loading}
        disabled={!hasPendingVerification || code.length !== OTP_LENGTH}
        testID="verify-submit"
      />

      <View style={[styles.row, { columnGap: dp(12) }]}>
        <EntryAuthText
          token="label"
          color={resend.ready ? entryAuthColors.primary : entryAuthColors.textSecondary}
          onPress={
            resend.ready && hasPendingVerification
              ? () => {
                  resend.restart();
                  void submit.run(() => resendVerificationCode());
                }
              : undefined
          }
          accessibilityRole="button"
          accessibilityState={{ disabled: !resend.ready }}
          testID="verify-resend"
        >
          {resend.ready ? verifyEmailCopy.resend : `${verifyEmailCopy.resend} (${resend.label})`}
        </EntryAuthText>

        <EntryAuthText
          token="label"
          color={entryAuthColors.primary}
          onPress={() => router.replace(authRoutes.signUp)}
          accessibilityRole="link"
          testID="verify-change-email"
        >
          {verifyEmailCopy.changeEmail}
        </EntryAuthText>
      </View>
    </AuthFormScaffold>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
});
