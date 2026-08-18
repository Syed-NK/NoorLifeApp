import { Pressable, StyleSheet, View } from 'react-native';

import { entryAuthColors, entryAuthLayout } from '../entry-auth-tokens';
import { useEntryAuthMetrics } from '../use-entry-auth-metrics';

export type ProgressDotsProps = {
  readonly count: number;
  /** Zero-based index of the active step. */
  readonly activeIndex: number;
  /**
   * Makes the dots *before* the active one tappable, to return to that step.
   *
   * Omit for a purely decorative indicator. Dots at or after the active index are never pressable:
   * the sequence only navigates backward.
   */
  readonly onSelect?: (index: number) => void;
  readonly testID?: string;
};

/**
 * Touch area around a tappable dot.
 *
 * The dots are 7 dp with a 6 dp gap, so a 44 dp *square* target is geometrically impossible without
 * neighbouring targets overlapping — and overlapping targets produce wrong destinations, which is
 * worse than a small one. The slop therefore takes the full 44 dp vertically and stops at half the
 * gap horizontally, so every dot has a tall, unambiguous strip. This is why the dots are a
 * convenience rather than the accessible route back: the swipe gesture and the header's Back arrow
 * both remain, and neither depends on hitting a 7 dp circle.
 */
const DOT_HIT_SLOP = { top: 19, bottom: 19, left: 3, right: 3 } as const;

/**
 * Step indicator for the entry sequence.
 *
 * The component is generic in `count`; how many steps the entry flow has, and why, lives with
 * `ENTRY_STEP_COUNT` in entry-steps.ts. The earlier three-dot reasoning moved there when the
 * sequence was extended past onboarding to cover Welcome and the credentials screens.
 *
 * All dots are equal-diameter circles, as the reference shows; the active one differs by colour
 * only. The row is announced as a progress bar so a screen reader reports "step 1 of 5" rather
 * than describing five unlabelled shapes, and each returnable dot adds its own button label on
 * top of that.
 */
export function ProgressDots({ count, activeIndex, onSelect, testID }: ProgressDotsProps) {
  const { dp } = useEntryAuthMetrics();
  const size = dp(entryAuthLayout.progressDot);
  const prefix = testID ?? 'progress-dots';

  return (
    <View
      style={[styles.row, { gap: dp(entryAuthLayout.progressDotGap) }]}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 1, max: count, now: activeIndex + 1 }}
      accessibilityLabel={`Step ${activeIndex + 1} of ${count}`}
      testID={testID}
    >
      {Array.from({ length: count }, (_, index) => {
        const isActive = index === activeIndex;
        const dotStyle = {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: isActive ? entryAuthColors.primary : entryAuthColors.disabled,
        };
        // Suffix kept on the active dot so existing queries by testID keep resolving.
        const dotTestID = `${prefix}-${index}${isActive ? '-active' : ''}`;

        // Backward only: the flow cannot skip ahead, so later dots stay inert.
        if (onSelect === undefined || index >= activeIndex) {
          return <View key={index} style={dotStyle} testID={dotTestID} />;
        }

        return (
          <Pressable
            key={index}
            onPress={() => onSelect(index)}
            hitSlop={DOT_HIT_SLOP}
            accessibilityRole="button"
            accessibilityLabel={`Go back to step ${index + 1} of ${count}`}
            style={dotStyle}
            testID={dotTestID}
          />
        );
      })}
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
