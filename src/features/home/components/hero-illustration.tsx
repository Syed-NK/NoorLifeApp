import { StyleSheet, View } from 'react-native';

export type HeroIllustrationProps = {
  /** Locked display box: 184 dp wide at the 393 dp baseline. */
  readonly width: number;
  /** Locked display box: 156 dp tall at the 393 dp baseline. */
  readonly height: number;
  readonly testID?: string;
};

/**
 * Main Home hero illustration slot — the locked 184 × 156 dp display box.
 *
 * ── BLOCKING MISSING ASSET ──────────────────────────────────────────────────
 * The hero needs `assets/noorlife/main-home-hero.webp`: the full composition of
 * robot + day-path + mosque + family + sun + lightbulb + clipboard, transparent
 * background, no baked headline or button text. It was **not** among the supplied
 * files — the pack provided the eight module pictograms only.
 *
 * The box is therefore rendered **empty**, deliberately.
 *
 * Why not fall back to the robot pictogram: the PNG pictogram lock states the supplied
 * crops "have a white presentation background and are intended for the white Main Home
 * module cards. Do not place them on dark surfaces." The supplied files are in fact
 * fully opaque (sampled at `#FDFEFE`, alpha 255, not transparent as the preview
 * claims), so placing one on the indigo hero paints a solid white rectangle across it —
 * which is exactly what an earlier revision did. An empty slot is correct; a white block
 * is not.
 *
 * The box is kept at its locked size so the hero's text column geometry and the
 * illustration's eventual footprint are already correct when the asset lands.
 */
export function HeroIllustration({ width, height, testID }: HeroIllustrationProps) {
  return <View style={[styles.box, { width, height }]} testID={testID} pointerEvents="none" />;
}

const styles = StyleSheet.create({
  box: {
    alignItems: 'flex-end',
    justifyContent: 'flex-end',
  },
});
