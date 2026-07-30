import { Image, StyleSheet, View } from 'react-native';

import { PressableScale } from '@ds/components';
import { noorLifeAssets } from '@shared/assets/noorlife-assets';
import { iconButtonA11y } from '@shared/utils/a11y';

import { useModuleTheme } from '../module-context';
import { moduleNeutrals } from '../module-tokens';

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
        style={[
          styles.wash,
          { borderRadius: size / 2, backgroundColor: theme.lightSurface },
        ]}
      />
      <Image
        source={noorLifeAssets.entryAuth.noorAiRobot}
        style={{ width: imageSize, height: imageSize }}
        resizeMode="contain"
        accessible={false}
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
