import { StyleSheet, View } from 'react-native';

import { entryAuthColors, entryAuthLayout } from '../entry-auth-tokens';
import { useEntryAuthMetrics } from '../use-entry-auth-metrics';

export type ProgressDotsProps = {
  readonly count: number;
  /** Zero-based index of the active step. */
  readonly activeIndex: number;
  readonly testID?: string;
};

/**
 * Onboarding step indicator.
 *
 * ── Why three dots and not the reference's four ──────────────────────────────
 * The overview mockup draws four dots, and draws the *first* one active on both panel 02 and
 * panel 04. Those two cannot both be right, so the mockup's indicator is unreliable. The
 * written spec is self-consistent — "three progress indicators; first active" (02), "second
 * progress indicator active" (03), "third progress indicator active" (04) — and matches the
 * three onboarding screens that actually exist. Four dots would tell the user a fourth panel is
 * coming, which is a functional error rather than a styling one, so the written spec wins.
 *
 * All dots are equal-diameter circles, as the reference shows; the active one differs by colour
 * only. It is announced as a progress bar so a screen reader reports "step 1 of 3" rather than
 * describing four unlabelled shapes.
 */
export function ProgressDots({ count, activeIndex, testID }: ProgressDotsProps) {
  const { dp } = useEntryAuthMetrics();
  const size = dp(entryAuthLayout.progressDot);

  return (
    <View
      style={[styles.row, { gap: dp(entryAuthLayout.progressDotGap) }]}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 1, max: count, now: activeIndex + 1 }}
      accessibilityLabel={`Step ${activeIndex + 1} of ${count}`}
      testID={testID}
    >
      {Array.from({ length: count }, (_, index) => (
        <View
          key={index}
          style={{
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor:
              index === activeIndex ? entryAuthColors.primary : entryAuthColors.disabled,
          }}
          testID={`${testID ?? 'progress-dots'}-${index}${index === activeIndex ? '-active' : ''}`}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
