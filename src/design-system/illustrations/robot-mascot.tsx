import { StyleSheet, View } from 'react-native';

import { modulePalettes, neutralColors, radius } from '@ds/tokens';
import { RobotHead } from './robot-head';

export type RobotMascotProps = {
  /** Overall height in px; the body proportions derive from this. */
  readonly size: number;
  /** Set on light surfaces where the white shell needs a visible edge. */
  readonly outlined?: boolean;
};

/**
 * The full approved robot mascot — head, torso with a cyan chest gem, and arms.
 *
 * Spec §1.7 restricts the full mascot to hero cards, onboarding, authentication
 * help and system states. Compact AI actions use `RobotHead` instead.
 *
 * ── PLACEHOLDER BOUNDARY ────────────────────────────────────────────────────
 * Same status as RobotHead: a token-driven construction that reads as the
 * approved white-robot-with-cyan-expression mascot, standing in for production
 * artwork. See ASSETS-REQUIRED.md. Not an abstract orb, and never to be replaced
 * by one.
 */
export function RobotMascot({ size, outlined = false }: RobotMascotProps) {
  // Proportions tuned so the mark reads as one figure at ~52 px (the AI insight
  // card) as well as at ~132 px (a full-screen state view). Two earlier attempts
  // failed: a wide torso with detached arms broke apart at small sizes, and an
  // over-narrow torso left the head looking like it had no body at all.
  const headSize = size * 0.5;
  const torsoWidth = size * 0.42;
  const torsoHeight = size * 0.32;
  const armWidth = size * 0.09;
  const armHeight = size * 0.22;
  const gemSize = torsoWidth * 0.28;
  const cyan = modulePalettes['noor-ai'].supporting;

  const shellBorder = outlined
    ? { borderWidth: StyleSheet.hairlineWidth * 2, borderColor: neutralColors.border }
    : null;

  return (
    <View
      style={[styles.root, { width: size * 0.78, height: size }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <RobotHead size={headSize} />

      {/* Negative margin tucks the torso under the head so the figure reads as one
          body rather than a head floating above a separate block. */}
      <View style={[styles.torsoRow, { marginTop: -size * 0.04 }]}>
        {/* Left arm, raised in the approved waving pose. */}
        <View
          style={[
            styles.arm,
            shellBorder,
            {
              width: armWidth,
              height: armHeight,
              borderRadius: armWidth / 2,
              marginBottom: torsoHeight * 0.3,
            },
          ]}
        />

        <View
          style={[
            styles.torso,
            shellBorder,
            {
              width: torsoWidth,
              height: torsoHeight,
              borderRadius: torsoWidth * 0.34,
              marginHorizontal: size * 0.012,
            },
          ]}
        >
          {/* Chest gem: the mascot's cyan heart detail. */}
          <View
            style={{
              width: gemSize,
              height: gemSize,
              borderRadius: radius.pill,
              backgroundColor: cyan,
            }}
          />
        </View>

        <View
          style={[
            styles.arm,
            shellBorder,
            {
              width: armWidth,
              height: armHeight,
              borderRadius: armWidth / 2,
              marginTop: torsoHeight * 0.16,
            },
          ]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  torsoRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  torso: {
    backgroundColor: neutralColors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  arm: {
    backgroundColor: neutralColors.surface,
  },
});
