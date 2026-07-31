import { Image, StyleSheet, View } from 'react-native';

import { PressableScale } from '@ds/components';
import { getModulePictogram } from '@features/home/module-pictograms';
import { iconButtonA11y } from '@shared/utils/a11y';

import { useModuleTheme } from '../module-context';
import { moduleNeutrals } from '../module-tokens';

/**
 * The one Noor AI mark, resolved through the same locked registry Main Home's centre control
 * renders from.
 *
 * ── Why this is a module-level constant and not a new require ───────────────
 * Every module's raised control must be the *same asset instance* as Main Home's, and the
 * framework previously used `noorLifeAssets.entryAuth.noorAiRobot` — a different file, the
 * standing robot extracted from the splash. That is exactly the "second visually similar file"
 * the correction rules out, and it is why the centre robot differed between screens.
 *
 * Resolved once here rather than inside the component so identity is stable, and via
 * `getModulePictogram` rather than a fresh `require()` so there is no duplicate path to drift.
 */
const NOOR_AI_MARK = getModulePictogram('noor-ai');

export type ModuleAICenterButtonProps = {
  /** Outer diameter in dp, already scaled. */
  readonly size: number;
  /** Robot image box in dp, already scaled. */
  readonly imageSize: number;
  readonly onPress: () => void;
  /** Accessible name, e.g. "Open Faith AI". */
  readonly accessibilityLabel: string;
  readonly selected?: boolean;
  readonly testID?: string;
};

/**
 * The raised centre control that opens a module's AI.
 *
 * It is the approved Noor AI robot PNG in a white circle, ringed in the module's
 * colour — one recognisable control whose ring tells you which assistant it opens.
 * The ring uses the theme's `border` role, which is the variant measured at ≥3:1
 * against both white and the module surface, so the ring is a visible boundary on
 * every module rather than a pale suggestion on the lighter ones.
 *
 * Two rules from the locked Main Home navigation are kept deliberately:
 *
 *   • the PNG is never tinted and never swapped for a vector glyph
 *   • there is **no visible label** beneath it
 *
 * The label's absence is a visual decision only — `accessibilityLabel` is required
 * by the signature, so a screen reader still announces exactly which AI this opens.
 */
export function ModuleAICenterButton({
  size,
  imageSize,
  onPress,
  accessibilityLabel,
  selected = false,
  testID,
}: ModuleAICenterButtonProps) {
  const theme = useModuleTheme();

  return (
    <PressableScale
      onPress={onPress}
      style={[
        styles.button,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          borderColor: theme.border,
        },
      ]}
      {...iconButtonA11y(accessibilityLabel, { selected })}
      testID={testID}
    >
      {/* A faint wash of the module colour behind the robot, so the control reads as
          the module's assistant even before the ring is noticed. */}
      <View
        style={[styles.wash, { borderRadius: size / 2, backgroundColor: theme.lightSurface }]}
      />
      <Image
        source={NOOR_AI_MARK}
        style={{ width: imageSize, height: imageSize }}
        resizeMode="contain"
        accessible={false}
        testID={testID === undefined ? undefined : `${testID}-mark`}
      />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  button: {
    backgroundColor: moduleNeutrals.surface,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  wash: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
});
