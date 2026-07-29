import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { neutralColors, radius } from '@ds/tokens';

export type ProgressBarProps = {
  /** Progress from 0 to 100. Values outside the range are clamped. */
  readonly progress: number;
  /** Filled colour. Pass the module primary. */
  readonly color: string;
  readonly trackColor?: string;
  readonly height?: number;
  readonly accessibilityLabel: string;
  readonly style?: StyleProp<ViewStyle>;
  readonly testID?: string;
};

/**
 * Linear progress track.
 *
 * Not one of the §5 named primitives, but the reference home screens use a linear
 * track in several places (check-in completion, goal progress, task progress).
 * It exists so those never inline a bar out of raw Views and drift apart.
 *
 * Callers must always pair the bar with a visible textual value — §8 forbids
 * conveying status by colour alone — and supply an `accessibilityLabel`.
 */
export function ProgressBar({
  progress,
  color,
  trackColor = neutralColors.surfaceSoft,
  height = 6,
  accessibilityLabel,
  style,
  testID,
}: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(100, progress));

  return (
    <View
      style={[
        styles.track,
        { height, borderRadius: radius.pill, backgroundColor: trackColor },
        style,
      ]}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped) }}
      testID={testID}
    >
      <View
        style={{
          width: `${clamped}%`,
          height: '100%',
          borderRadius: radius.pill,
          backgroundColor: color,
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    overflow: 'hidden',
    alignSelf: 'stretch',
  },
});
