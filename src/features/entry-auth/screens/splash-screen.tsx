import { Image } from 'expo-image';
import { StyleSheet, View, useWindowDimensions } from 'react-native';

import { noorLifeAssets } from '@shared/assets/noorlife-assets';

import { SPLASH_SOURCE } from '../entry-auth-assets';
import { entryAuthColors } from '../entry-auth-tokens';

/**
 * Chooses the resize mode that shows the locked artwork without cropping meaning.
 *
 * `cover` fills the viewport edge to edge, which is what the reference shows, but on a
 * viewport narrower in aspect than the artwork it crops the sides. The artwork carries
 * `contentSafeInsetX` px of pure background at each edge, so cover is safe exactly while the
 * crop stays inside that band:
 *
 *   cropPerSide(sourcePx) = (sourceWidth − viewportAspect × sourceHeight) / 2
 *
 * For the locked 852 × 1846 splash that stays under 38 px for any viewport aspect down to
 * ~0.42 (about 21.4:9) — every mainstream handset, Pixel 8 (0.450, 11 px crop) included.
 * Beyond that the function returns `contain`, and the letterbox lands on a page background
 * already matched to the artwork's own edge colour, so it reads as margin rather than as bars.
 *
 * Neither branch distorts: both preserve the source aspect ratio.
 */
export function resolveSplashResizeMode(
  viewportWidth: number,
  viewportHeight: number,
): 'cover' | 'contain' {
  if (viewportWidth <= 0 || viewportHeight <= 0) {
    return 'contain';
  }
  const aspect = viewportWidth / viewportHeight;
  const cropPerSide = (SPLASH_SOURCE.width - aspect * SPLASH_SOURCE.height) / 2;
  // Negative crop means the viewport is *wider* than the artwork, so cover crops vertically
  // instead — which would cut the tagline. Contain is correct there too.
  if (cropPerSide < 0) {
    return 'contain';
  }
  return cropPerSide <= SPLASH_SOURCE.contentSafeInsetX ? 'cover' : 'contain';
}

/**
 * Screen 01 — Splash.
 *
 * The locked PNG rendered unchanged and full-bleed. Nothing is drawn over it: no wordmark
 * re-typeset in live text, no spinner, no version string. The design lock forbids altering
 * its composition, and the phase prompt permits using the reference PNG directly here
 * precisely because the screen has no interactive controls.
 *
 * There is no timer in this component. Routing is decided by the entry gate as soon as the
 * session resolves, so what holds this screen up is real work rather than a fixed delay, and
 * a fast resolve is not padded out to look busy. The spec's 1.5–2 s figure is a ceiling on
 * that wait, not a duration to enforce.
 *
 * The `View` behind the image is the page background rather than transparent: it covers the
 * letterbox on an unusually tall device, and it is the colour the native splash is matched to
 * in app.json, so the handoff from native splash to first frame has no colour step in it.
 */
export function SplashScreen() {
  const { width, height } = useWindowDimensions();
  const contentFit = resolveSplashResizeMode(width, height);

  return (
    <View style={styles.root} testID="splash-screen">
      <Image
        source={noorLifeAssets.entryAuth.splash}
        style={styles.artwork}
        contentFit={contentFit}
        // Decorative: the tagline it contains is repeated by the accessibility label below,
        // so a screen reader announces the brand once rather than describing an image.
        accessible
        accessibilityRole="image"
        accessibilityLabel="NoorLife — Your family, your day, beautifully in sync."
        testID="splash-artwork"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: entryAuthColors.pageBackground,
  },
  artwork: {
    // Fills the window including both safe areas: the artwork is edge-to-edge by design and
    // its outer band is background, so insets would introduce visible margins.
    flex: 1,
    width: '100%',
  },
});
