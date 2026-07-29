import { StyleSheet, View } from 'react-native';

import { AuthScaffold } from '../components/auth-scaffold';
import { EntryAuthText } from '../components/entry-auth-text';
import { PrimaryButton } from '../components/primary-button';
import { ProgressDots } from '../components/progress-dots';
import { SecondaryButton } from '../components/secondary-button';
import { entryAuthLayout } from '../entry-auth-tokens';
import { useEntryAuthMetrics } from '../use-entry-auth-metrics';

/** Total onboarding panels. Drives the step indicator; see ProgressDots for why it is three. */
export const ONBOARDING_STEPS = 3;

export type OnboardingScreenProps = {
  /** Zero-based panel index. */
  readonly step: number;
  readonly title: string;
  readonly subtitle: string;
  /**
   * The panel's artwork.
   *
   * A node rather than an image source: panel 02 is a single extracted PNG, while 03 and 04
   * compose several approved PNGs into a ring. Keeping the slot generic means the shared layout
   * does not have to know which.
   */
  readonly illustration: React.ReactNode;
  /** Primary label — "Next" on panels 1–2, "Get Started" on the last. */
  readonly primaryLabel: string;
  readonly onPrimary: () => void;
  /**
   * Skip handler. Omitted on the final panel, which the reference gives a single full-width
   * primary — there is nothing left to skip to.
   */
  readonly onSkip?: () => void;
  readonly testID?: string;
};

/**
 * The shared onboarding panel used by screens 02, 03 and 04.
 *
 * ── Layout ──────────────────────────────────────────────────────────────────
 * Fixed text block at the top, fixed control block at the bottom, illustration absorbing
 * everything between. That ordering is what keeps the copy and controls at identical positions
 * across the three panels while the artwork differs in size, and it means a shorter device
 * shrinks the illustration instead of clipping or scrolling.
 *
 * ── Skip appears once ───────────────────────────────────────────────────────
 * The prompt describes a top-right `Skip` *and* a bottom secondary `Skip`, but qualifies the
 * bottom pair with "only if both are present in the approved reference; avoid duplicate Skip
 * actions". The reference shows the bottom pair and no top-right action, so Skip lives at the
 * bottom only.
 *
 * The button widths follow the reference's proportion — the primary is about 10% wider than the
 * secondary (measured 115 px against 103 px) — expressed as flex so it holds at any scale.
 */
export function OnboardingScreen({
  step,
  title,
  subtitle,
  illustration,
  primaryLabel,
  onPrimary,
  onSkip,
  testID,
}: OnboardingScreenProps) {
  const { dp } = useEntryAuthMetrics();

  return (
    <AuthScaffold
      testID={testID}
      footer={
        <View style={{ gap: dp(20) }}>
          <ProgressDots
            count={ONBOARDING_STEPS}
            activeIndex={step}
            testID={`${testID ?? 'onboarding'}-dots`}
          />
          {onSkip === undefined ? (
            <PrimaryButton
              label={primaryLabel}
              onPress={onPrimary}
              testID={`${testID ?? 'onboarding'}-primary`}
            />
          ) : (
            <View style={[styles.controls, { gap: dp(12) }]}>
              <SecondaryButton
                label="Skip"
                onPress={onSkip}
                style={styles.secondary}
                testID={`${testID ?? 'onboarding'}-skip`}
              />
              <PrimaryButton
                label={primaryLabel}
                onPress={onPrimary}
                style={styles.primary}
                testID={`${testID ?? 'onboarding'}-primary`}
              />
            </View>
          )}
        </View>
      }
    >
      {/* Both measures are capped and centred rather than filling the column — see
          headingMaxWidth and subtitleMaxWidth for the measurements behind the numbers. */}
      <View style={[styles.copy, { paddingTop: dp(28), gap: dp(10) }]}>
        <EntryAuthText
          token="title"
          align="center"
          accessibilityRole="header"
          style={{ maxWidth: dp(entryAuthLayout.headingMaxWidth) }}
        >
          {title}
        </EntryAuthText>
        <EntryAuthText
          token="subtitle"
          align="center"
          style={{ maxWidth: dp(entryAuthLayout.subtitleMaxWidth) }}
        >
          {subtitle}
        </EntryAuthText>
      </View>

      {/* Absorbs the space left between the fixed text and the fixed controls, so a shorter
          device shrinks the artwork rather than clipping it or scrolling. */}
      <View
        style={[styles.illustration, { marginTop: dp(8) }]}
        testID={`${testID ?? 'onboarding'}-illustration`}
      >
        {illustration}
      </View>
    </AuthScaffold>
  );
}

const styles = StyleSheet.create({
  copy: {
    alignItems: 'center',
  },
  /**
   * `stretch`, not `center`.
   *
   * Centring on the cross axis makes children shrink-wrap their width. `AuthIllustration` is
   * `flex: 1` with no explicit width, so it collapsed to zero and its `width: '100%'` image
   * rendered nothing — panel 02 lost its artwork entirely while 03 and 04 were unaffected,
   * because `MedallionRing` sets an explicit width and was immune.
   *
   * Children that want to be centred say so themselves: `MedallionRing` carries
   * `alignSelf: 'center'`.
   */
  illustration: {
    flex: 1,
    alignItems: 'stretch',
    justifyContent: 'center',
    minHeight: 0,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  /** 0.9 : 1 against the primary, matching the reference's 103 : 115 measurement. */
  secondary: {
    flex: 0.9,
  },
  primary: {
    flex: 1,
  },
});
