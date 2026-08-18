import { LinearGradient } from 'expo-linear-gradient';
import { Image, StyleSheet, View } from 'react-native';
import type { ImageSourcePropType } from 'react-native';

/**
 * Where the scrim reaches zero, as a fraction of the hero's width.
 *
 * The copy occupies the left ~50%; finishing at 0.72 lets the ramp clear the text entirely
 * so no line sits on the fading edge, while leaving the artwork's subject side untouched.
 */
const SCRIM_END = 0.72;

export type ModuleHeroArtworkProps = {
  /** The locked hero PNG. Never a pictogram. */
  readonly source: ImageSourcePropType;
  /**
   * Scrim strength at the copy edge, or 0 for none.
   *
   * Derived per module by measuring the 95th-percentile luminance of that asset's own copy
   * area and solving for the opacity at which white text clears 4.5:1. Five of the eight
   * heroes need none; Health needs the most, its copy area being bright sky at 1.60:1.
   */
  readonly scrim: number;
  /** Which side the live copy sits on — the scrim ramps away from it. */
  readonly copySide: 'left' | 'right';
  readonly testID?: string;
};

/**
 * The locked hero artwork, full-bleed behind a module hero's live UI.
 *
 * The image is `cover` and fills its parent. It carries no tint, border, background or
 * padding — the parent card owns the radius and the clipping.
 *
 * ── Why this uses a real gradient ───────────────────────────────────────────
 * Three earlier attempts at the contrast overlay failed on device, and it is worth recording
 * why so nobody repeats them: thirty stacked translucent `View`s left visible vertical
 * hairlines on Health's flat sky, because adjacent translucent views are composited
 * separately and every boundary shows; anchoring both edges to identical percentages did not
 * remove them; and a stretched 1 px alpha-ramp PNG rendered far weaker than its opacity
 * implied. `expo-linear-gradient` is the tool that actually does this — an official Expo
 * module, interpolated on the GPU, no seams and no per-band arithmetic.
 *
 * It is the one dependency added for this work. `ProgressRing` and the weekly-trend chart
 * still use `View` transforms, because an arc and a polyline genuinely do not need it; a
 * horizontal alpha gradient does.
 */
export function ModuleHeroArtwork({ source, scrim, copySide, testID }: ModuleHeroArtworkProps) {
  return (
    <View style={styles.fill} pointerEvents="none">
      {/*
        `width/height: '100%'` rather than absolute insets.

        With `position: 'absolute'` and all four insets at 0, Android laid the image out at its
        *intrinsic* 1083 × 396 and then covered inside that, so the hero showed only the
        artwork's top-left corner at roughly 3× — the mosque never appeared. Sizing relative to
        the parent gives Yoga a definite box before `cover` is applied.
      */}
      <Image
        source={source}
        style={styles.image}
        resizeMode="cover"
        accessible={false}
        testID={testID}
      />

      {scrim <= 0 ? null : (
        <LinearGradient
          // Horizontal, running from the copy edge toward the artwork's subject.
          start={{ x: copySide === 'left' ? 0 : 1, y: 0.5 }}
          end={{ x: copySide === 'left' ? 1 : 0, y: 0.5 }}
          colors={[`rgba(0,0,0,${scrim})`, `rgba(0,0,0,${scrim * 0.55})`, 'rgba(0,0,0,0)']}
          // Holds most of its strength under the copy, then falls away quickly.
          locations={[0, SCRIM_END * 0.55, SCRIM_END]}
          style={styles.fill}
          testID={testID === undefined ? undefined : `${testID}-scrim`}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  image: {
    width: '100%',
    height: '100%',
  },
});
