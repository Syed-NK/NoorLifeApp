import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { AppIcon } from './app-icon';
import { PressableScale } from './pressable-scale';

import { elementSize, neutralColors, semanticColors, touchTarget } from '@ds/tokens';
import { iconButtonA11y } from '@shared/utils/a11y';

export type RobotAIButtonProps = {
  readonly onPress: () => void;
  /**
   * Ring colour.
   *
   * Design spec §3.2 says the ring uses the current module primary; Main Home
   * implementation-lock §13 fixes it at `#3157C8`. Callers pass the value that
   * applies — Main Home passes the locked global primary, modules pass their own
   * primary — and the default is the locked value.
   */
  readonly ringColor?: string;
  /** Screen-reader label, e.g. "Open Faith AI". Required by design spec §8. */
  readonly accessibilityLabel: string;
  /** True when the AI destination is the active route. */
  readonly active?: boolean;
  /** Overrides the locked 54 dp diameter only where a design fixes another size. */
  readonly size?: number;
  /** Robot asset size inside the button. Defaults to the locked 38 dp. */
  readonly robotSize?: number;
  readonly style?: StyleProp<ViewStyle>;
  readonly testID?: string;
};

/**
 * The approved robot-head AI control.
 *
 * Locked by Main Home implementation-lock §13: a 54 × 54 dp circle with a **white**
 * background and a 3 dp `#3157C8` border, holding a 38 dp robot head, raised 17 dp
 * above the bar.
 *
 * ── Asset note ──────────────────────────────────────────────────────────────
 * The lock requires the approved robot-head raster and forbids drawing the mascot
 * with CSS or vector primitives. That asset is not in the project, so this renders
 * the nearest approved stand-in — the `robot` glyph from the MaterialCommunityIcons
 * set the lock itself mandates — at the locked size. See assets/noorlife/README.md.
 * An abstract AI orb is never used.
 */
export function RobotAIButton({
  onPress,
  ringColor = semanticColors.primary,
  accessibilityLabel,
  active = false,
  size = elementSize.aiNavButton,
  robotSize = elementSize.aiNavRobot,
  style,
  testID,
}: RobotAIButtonProps) {
  return (
    <PressableScale
      onPress={onPress}
      style={[
        styles.root,
        {
          width: size,
          height: size,
          minWidth: touchTarget.minimum,
          minHeight: touchTarget.minimum,
          borderRadius: size / 2,
          borderColor: ringColor,
          // Active state thickens the ring rather than only recolouring it, so it
          // does not rely on colour alone (design spec §8).
          borderWidth: active ? elementSize.aiNavButtonBorder + 1 : elementSize.aiNavButtonBorder,
        },
        style,
      ]}
      {...iconButtonA11y(accessibilityLabel, { selected: active })}
      testID={testID}
    >
      <View style={styles.inner}>
        <AppIcon name="robot" size={robotSize} color={ringColor} />
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: neutralColors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  inner: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
