import { useEffect, useState } from 'react';
import { Animated, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { layout, motionDuration, neutralColors, radius, spacing } from '@ds/tokens';
import { useReducedMotion } from '@shared/utils/a11y';

export type SkeletonCardProps = {
  /** Number of placeholder text lines. */
  readonly lines?: number;
  /** Reserves a leading square block, e.g. for an icon or thumbnail. */
  readonly withLeadingBlock?: boolean;
  /** Fixed height, for skeletons that stand in for a hero or a chart. */
  readonly height?: number;
  readonly style?: StyleProp<ViewStyle>;
  readonly accessibilityLabel?: string;
  readonly testID?: string;
};

/**
 * Skeleton placeholder for loading content (§20: "Skeleton representation of
 * expected content").
 *
 * Loading states show the *shape* of what is coming rather than a bare spinner,
 * which also keeps the §3.0 density rule satisfied while data is in flight: the
 * section keeps its footprint instead of collapsing into blank space.
 *
 * The shimmer is a slow opacity pulse and is disabled entirely under
 * reduce-motion (§7). It never sits behind text — the skeleton *is* the content.
 */
export function SkeletonCard({
  lines = 3,
  withLeadingBlock = false,
  height,
  style,
  accessibilityLabel = 'Loading content',
  testID,
}: SkeletonCardProps) {
  const reducedMotion = useReducedMotion();

  // Lazy `useState` initialiser rather than `useRef(...).current`, so the
  // Animated.Value is created once without a render-phase ref read.
  const [pulse] = useState(() => new Animated.Value(0.6));

  useEffect(() => {
    if (reducedMotion) {
      pulse.setValue(0.75);
      return;
    }

    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: motionDuration.progressMax,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0.6,
          duration: motionDuration.progressMax,
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();

    return () => {
      animation.stop();
    };
  }, [pulse, reducedMotion]);

  return (
    <View
      style={[styles.card, height === undefined ? null : { height }, style]}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
    >
      <View style={styles.row}>
        {withLeadingBlock ? (
          <Animated.View style={[styles.leadingBlock, { opacity: pulse }]} />
        ) : null}
        <View style={styles.lineColumn}>
          {Array.from({ length: lines }, (_unused, index) => (
            <Animated.View
              key={index}
              style={[
                styles.line,
                // Last line is shorter, so the block reads as text rather than bars.
                index === lines - 1 ? styles.lineShort : null,
                { opacity: pulse },
              ]}
            />
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: neutralColors.surface,
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: neutralColors.border,
    padding: layout.cardPadding,
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  leadingBlock: {
    width: 44,
    height: 44,
    borderRadius: radius.control,
    backgroundColor: neutralColors.surfaceSoft,
  },
  lineColumn: {
    flex: 1,
    gap: spacing.sm,
  },
  line: {
    height: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: neutralColors.surfaceSoft,
  },
  lineShort: {
    width: '58%',
  },
});
