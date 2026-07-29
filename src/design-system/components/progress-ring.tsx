import { StyleSheet, View } from 'react-native';

import { AppText } from '@ds/typography/app-text';

import { neutralColors, radius } from '@ds/tokens';

export type ProgressRingProps = {
  /** Progress from 0 to 100. Values outside the range are clamped. */
  readonly progress: number;
  /** Outer diameter in px. */
  readonly size?: number;
  /** Ring thickness in px. */
  readonly thickness?: number;
  /** Filled-arc colour. Pass the module primary. */
  readonly color: string;
  /** Unfilled-track colour. */
  readonly trackColor?: string;
  /**
   * Colour of the ring's centre. Must match the surface behind the ring, since
   * the ring is drawn by masking a filled pie with a centre disc.
   */
  readonly holeColor?: string;
  /** Centred label, e.g. "68%". Omit for a bare ring. */
  readonly label?: string;
  /** Screen-reader text. Defaults to "<progress> percent complete". */
  readonly accessibilityLabel?: string;
  readonly testID?: string;
};

/**
 * Circular progress indicator (§3.0 item 5, §08/§10 hero progress rings).
 *
 * Implementation note: this is drawn with `View` transforms rather than SVG.
 * `react-native-svg` is a native module and adding it would require rebuilding
 * the installed Android development client, so Phase 1 avoids it. The technique
 * is a two-semicircle masked pie:
 *
 *   1. a track circle,
 *   2. a right-half clip containing a rotating coloured semicircle — the first
 *      50% of progress, rotation 0°→180°,
 *   3. a left-half clip doing the same for 50–100%,
 *   4. a centre disc that turns the filled pie into a ring.
 *
 * Fill runs clockwise from the top, matching the reference design.
 *
 * The ring is static; §7 permits a 400–600 ms fill animation, which is deferred
 * with the rest of the motion work.
 *
 * Accessibility: the value is exposed via `accessibilityValue` and the label, so
 * progress is never conveyed by the arc colour alone (§8).
 */
export function ProgressRing({
  progress,
  size = 64,
  thickness = 8,
  color,
  trackColor = neutralColors.surfaceSoft,
  holeColor = neutralColors.surface,
  label,
  accessibilityLabel,
  testID,
}: ProgressRingProps) {
  const clamped = Math.max(0, Math.min(100, progress));
  const half = size / 2;

  // 0–50% sweeps the right half; 50–100% sweeps the left half.
  const firstHalfDegrees = (Math.min(clamped, 50) / 50) * 180;
  const secondHalfDegrees = (Math.max(clamped - 50, 0) / 50) * 180;

  const holeSize = size - thickness * 2;

  return (
    <View
      style={[styles.root, { width: size, height: size, borderRadius: half }]}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel ?? `${Math.round(clamped)} percent complete`}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped) }}
      testID={testID}
    >
      <View
        style={[styles.track, { borderRadius: half, backgroundColor: trackColor }]}
        pointerEvents="none"
      />

      {/* Right-half clip — first 50%. */}
      <View style={[styles.clip, { width: half, height: size, right: 0 }]} pointerEvents="none">
        <View
          style={{
            width: size,
            height: size,
            marginLeft: -half,
            transform: [{ rotate: `${firstHalfDegrees}deg` }],
          }}
        >
          <View
            style={{
              width: half,
              height: size,
              borderTopLeftRadius: half,
              borderBottomLeftRadius: half,
              backgroundColor: color,
            }}
          />
        </View>
      </View>

      {/* Left-half clip — 50% to 100%. */}
      {clamped > 50 ? (
        <View style={[styles.clip, { width: half, height: size, left: 0 }]} pointerEvents="none">
          <View
            style={{
              width: size,
              height: size,
              transform: [{ rotate: `${secondHalfDegrees}deg` }],
            }}
          >
            <View
              style={{
                width: half,
                height: size,
                marginLeft: half,
                borderTopRightRadius: half,
                borderBottomRightRadius: half,
                backgroundColor: color,
              }}
            />
          </View>
        </View>
      ) : null}

      {/* Centre disc turns the pie into a ring. */}
      <View
        style={{
          width: holeSize,
          height: holeSize,
          borderRadius: radius.pill,
          backgroundColor: holeColor,
          alignItems: 'center',
          justifyContent: 'center',
        }}
        pointerEvents="none"
      >
        {label === undefined ? null : (
          <AppText variant="label" numberOfLines={1} maxFontSizeMultiplier={1.2}>
            {label}
          </AppText>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  track: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
  },
  clip: {
    position: 'absolute',
    top: 0,
    overflow: 'hidden',
  },
});
