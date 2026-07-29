import { StyleSheet, View } from 'react-native';

import { modulePalettes, neutralColors, radius } from '@ds/tokens';

export type RobotHeadProps = {
  /** Overall square size in px. Every internal dimension derives from this. */
  readonly size: number;
  /** Head shell colour. Defaults to the white shell of the approved mascot. */
  readonly shellColor?: string;
  /** Visor (face plate) colour. */
  readonly visorColor?: string;
  /** Expression colour. Defaults to the approved cyan. */
  readonly expressionColor?: string;
};

/**
 * The approved robot-head mark — NoorLife's compact AI icon.
 *
 * Spec §1.6–1.7: the white robot with a dark face and a cyan expression is the
 * *only* AI mascot, and the head alone is used for compact AI actions. An
 * abstract AI orb is explicitly forbidden, so this is deliberately a *head*:
 * shell, side ears, a dark visor and two cyan eyes above a cyan smile.
 *
 * ── PLACEHOLDER BOUNDARY ────────────────────────────────────────────────────
 * This is a token-driven vector-free construction, not the final artwork. It is
 * geometrically faithful to the approved mascot and safe to ship in Phase 1, but
 * `design-system/illustrations/ASSETS-REQUIRED.md` specifies the production asset
 * that should replace it. Swapping it touches only this file.
 *
 * Colours: the shell is `surface`, the visor is `textPrimary` and the expression
 * is the Noor AI supporting accent — no new values are introduced.
 */
export function RobotHead({
  size,
  shellColor = neutralColors.surface,
  visorColor = neutralColors.textPrimary,
  expressionColor = modulePalettes['noor-ai'].supporting,
}: RobotHeadProps) {
  // Proportions are ratios of `size` so the mark stays correct at 20 px and 96 px.
  const shellWidth = size * 0.86;
  const shellHeight = size * 0.78;
  const visorWidth = shellWidth * 0.78;
  const visorHeight = shellHeight * 0.66;
  const eyeWidth = visorWidth * 0.2;
  const eyeHeight = visorHeight * 0.42;
  const eyeGap = visorWidth * 0.18;
  const earWidth = size * 0.1;
  const earHeight = shellHeight * 0.34;
  const smileWidth = visorWidth * 0.3;
  const smileHeight = Math.max(1.5, visorHeight * 0.1);

  return (
    <View
      style={[styles.root, { width: size, height: size }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {/* Side ears sit behind the shell, mirrored — direction-agnostic. */}
      <View
        style={[
          styles.ear,
          {
            width: earWidth,
            height: earHeight,
            borderRadius: earWidth / 2,
            backgroundColor: expressionColor,
            left: (size - shellWidth) / 2 - earWidth * 0.55,
          },
        ]}
      />
      <View
        style={[
          styles.ear,
          {
            width: earWidth,
            height: earHeight,
            borderRadius: earWidth / 2,
            backgroundColor: expressionColor,
            right: (size - shellWidth) / 2 - earWidth * 0.55,
          },
        ]}
      />

      <View
        style={{
          width: shellWidth,
          height: shellHeight,
          borderRadius: shellHeight * 0.34,
          backgroundColor: shellColor,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <View
          style={{
            width: visorWidth,
            height: visorHeight,
            borderRadius: visorHeight * 0.38,
            backgroundColor: visorColor,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <View style={[styles.eyeRow, { gap: eyeGap }]}>
            <View
              style={{
                width: eyeWidth,
                height: eyeHeight,
                borderRadius: eyeWidth / 2,
                backgroundColor: expressionColor,
              }}
            />
            <View
              style={{
                width: eyeWidth,
                height: eyeHeight,
                borderRadius: eyeWidth / 2,
                backgroundColor: expressionColor,
              }}
            />
          </View>
          {/* Smile: a flat cyan bar with a fully rounded lower edge. */}
          <View
            style={{
              marginTop: visorHeight * 0.12,
              width: smileWidth,
              height: smileHeight,
              borderRadius: radius.pill,
              backgroundColor: expressionColor,
            }}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  ear: {
    position: 'absolute',
  },
  eyeRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});
