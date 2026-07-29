import { Image } from 'expo-image';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { noorLifeAssets, type ModuleAssetKey } from '@shared/assets/noorlife-assets';

import { medallionColors, medallionSpec } from '../entry-auth-tokens';
import { useEntryAuthMetrics } from '../use-entry-auth-metrics';

export type ModuleMedallionProps = {
  readonly module: ModuleAssetKey;
  /** Overrides the shared diameter. Use sparingly — §7 wants equal size across a set. */
  readonly diameter?: number;
  readonly style?: StyleProp<ViewStyle>;
  readonly testID?: string;
};

/**
 * An approved module pictogram on a saturated circular medallion.
 *
 * §7's treatment, built from the tokens rather than per-screen numbers: one diameter for every
 * module, the module's saturated fill, a thin translucent white highlight ring, a restrained shadow,
 * and the PNG centred at 76% of the diameter.
 *
 * ── Why the depth is two stacked layers ─────────────────────────────────────
 * "Subtle radial depth" without a gradient dependency: the disc carries the flat module colour and a
 * slightly lighter inset overlay sits on its upper portion at low opacity. That reads as a soft
 * top-light on a sphere, which is what the reference shows, and it costs no extra library.
 *
 * The pictogram is never tinted and never stretched — `contentFit="contain"` on a square box, per
 * §6. The medallion is decorative; the caller labels the group.
 */
export function ModuleMedallion({ module, diameter, style, testID }: ModuleMedallionProps) {
  const { dp } = useEntryAuthMetrics();
  const size = dp(diameter ?? medallionSpec.diameter);
  const picto = Math.round(size * medallionSpec.pictogramRatio);

  return (
    <View
      style={[
        styles.disc,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: medallionColors[module],
          borderWidth: medallionSpec.ringWidth,
          borderColor: medallionSpec.ringColor,
        },
        style,
      ]}
      accessible={false}
      testID={testID}
    >
      {/* Specular highlight.
          A fully rounded ellipse offset above centre, not a rectangle clipped to the top half: the
          rectangle version left a hard horizontal seam across every disc, which read as a join rather
          than as light. An ellipse has no straight edge, so at low opacity it falls off the way a
          top-lit sphere does. */}
      <View
        style={[
          styles.sheen,
          {
            width: size * 0.82,
            height: size * 0.58,
            borderRadius: size,
            top: -size * 0.2,
          },
        ]}
        pointerEvents="none"
      />
      <Image
        source={noorLifeAssets.modules[module]}
        style={{ width: picto, height: picto }}
        contentFit="contain"
        accessible={false}
        testID={testID === undefined ? undefined : `${testID}-pictogram`}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  disc: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    // Restrained: the medallions sit on a near-white page, so a heavy shadow would read as grime.
    shadowColor: '#0B2B4A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 5,
    elevation: 2,
  },
  sheen: {
    position: 'absolute',
    alignSelf: 'center',
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
});
