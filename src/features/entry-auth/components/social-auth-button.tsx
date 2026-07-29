import { Image } from 'expo-image';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { noorLifeAssets } from '@shared/assets/noorlife-assets';

import { entryAuthColors, entryAuthLayout } from '../entry-auth-tokens';
import { useEntryAuthMetrics } from '../use-entry-auth-metrics';
import { EntryAuthText } from './entry-auth-text';

export type SocialProviderKind = 'email' | 'google' | 'apple';

export type SocialAuthButtonProps = {
  readonly provider: SocialProviderKind;
  readonly label: string;
  readonly onPress: () => void;
  readonly disabled?: boolean;
  readonly loading?: boolean;
  readonly style?: StyleProp<ViewStyle>;
  readonly testID?: string;
};

/**
 * A full-width provider button — 48 dp, 12 dp radius, white surface, hairline border.
 *
 * ── Provider marks ──────────────────────────────────────────────────────────
 * `email` uses the approved 3D `email-envelope.png`, as §8-05 requires.
 *
 * `google` renders **no mark** until `assets/brand/google/g-logo.png` is supplied. Google's branding
 * guidelines require their official multicolour "G" used unmodified; drawing one, recolouring one, or
 * standing a coloured shape in its place all violate those guidelines. The previous blue circle is
 * gone and nothing has replaced it — the requirement is recorded in the asset registry rather than
 * papered over. Adding the file is the only change needed to make the mark appear.
 *
 * `apple` is not rendered by this component at all. Apple requires its own artwork or its own
 * button, so the Apple action uses `expo-apple-authentication`'s official `AppleAuthenticationButton`
 * on platforms that support it — see AppleSignInButton — and is hidden elsewhere.
 */
export function SocialAuthButton({
  provider,
  label,
  onPress,
  disabled = false,
  loading = false,
  style,
  testID,
}: SocialAuthButtonProps) {
  const { dp } = useEntryAuthMetrics();
  const inert = disabled || loading;
  const markSize = dp(20);

  const mark =
    provider === 'email' ? (
      <Image
        source={noorLifeAssets.entryAuth.emailEnvelope}
        style={{ width: markSize, height: markSize }}
        contentFit="contain"
        accessible={false}
        testID={testID === undefined ? undefined : `${testID}-mark`}
      />
    ) : provider === 'google' && noorLifeAssets.brand.googleMark !== null ? (
      <Image
        source={noorLifeAssets.brand.googleMark}
        style={{ width: markSize, height: markSize }}
        contentFit="contain"
        accessible={false}
        testID={testID === undefined ? undefined : `${testID}-mark`}
      />
    ) : null;

  return (
    <Pressable
      onPress={onPress}
      disabled={inert}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, busy: loading }}
      style={({ pressed }) => [
        styles.root,
        {
          height: dp(entryAuthLayout.buttonHeight),
          borderRadius: dp(entryAuthLayout.buttonRadius),
          paddingHorizontal: dp(16),
          columnGap: dp(10),
          backgroundColor: pressed ? entryAuthColors.secondaryMint : entryAuthColors.surface,
          opacity: inert ? 0.55 : 1,
        },
        style,
      ]}
      testID={testID}
    >
      {mark}
      <EntryAuthText token="button" numberOfLines={1} maxFontSizeMultiplier={1.3}>
        {label}
      </EntryAuthText>
      {/* Keeps the label optically centred when a mark is present, without absolute positioning. */}
      {mark === null ? null : <View style={{ width: markSize }} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: entryAuthColors.border,
  },
});
