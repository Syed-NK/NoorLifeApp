import * as AppleAuthentication from 'expo-apple-authentication';
import { useEffect, useState } from 'react';
import { Platform, StyleSheet } from 'react-native';

import { entryAuthLayout } from '../entry-auth-tokens';
import { useEntryAuthMetrics } from '../use-entry-auth-metrics';

export type AppleSignInButtonProps = {
  readonly onPress: () => void;
  readonly testID?: string;
};

/**
 * Sign in with Apple, rendered by Apple's own component.
 *
 * ── Why this is not a `SocialAuthButton` ────────────────────────────────────
 * Apple's Human Interface Guidelines require their supplied artwork or their supplied button. Drawing
 * the logo, recolouring it, or cropping it are all prohibited, and the black square this replaces was
 * none of those things — it was a stand-in. `AppleAuthenticationButton` ships the real mark and the
 * approved treatment, so the correct move is to render Apple's component rather than to imitate it.
 *
 * ── Why it can return null ──────────────────────────────────────────────────
 * The component only exists where Sign in with Apple exists. On Android the flow has to go through
 * web OAuth, which is not configured yet, so the guideline-compliant behaviour is to *hide* the
 * action rather than to offer one that cannot complete. `isAvailableAsync` is the authoritative check
 * — the platform test alone is not enough, since an older iOS also lacks it.
 *
 * That means the Pixel 8 shows no Apple button. That is the specified behaviour, not a gap.
 */
export function AppleSignInButton({ onPress, testID }: AppleSignInButtonProps) {
  const { dp } = useEntryAuthMetrics();
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (Platform.OS !== 'ios') {
      return;
    }
    void AppleAuthentication.isAvailableAsync()
      .then((supported) => {
        if (!cancelled) {
          setAvailable(supported);
        }
      })
      .catch(() => {
        // Treated as unsupported: a failed capability check must not render an action that cannot run.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!available) {
    return null;
  }

  return (
    <AppleAuthentication.AppleAuthenticationButton
      buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
      // The light treatment sits with the white Google and email buttons on the Soft Mint page; the
      // black variant would out-weight them, which Apple's equal-prominence guidance discourages.
      buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE_OUTLINE}
      cornerRadius={dp(entryAuthLayout.buttonRadius)}
      style={[styles.button, { height: dp(entryAuthLayout.buttonHeight) }]}
      onPress={onPress}
      testID={testID}
    />
  );
}

const styles = StyleSheet.create({
  button: {
    width: '100%',
  },
});
