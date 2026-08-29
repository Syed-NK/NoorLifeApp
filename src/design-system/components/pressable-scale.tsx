import { useCallback, useState } from 'react';
import {
  Animated,
  Pressable,
  StyleSheet,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { motionDuration, pressScale } from '@ds/tokens';
import { minimumTouchTargetSize, useReducedMotion } from '@shared/utils/a11y';

export type PressableScaleProps = Omit<PressableProps, 'style'> & {
  /**
   * Narrowed from Pressable's `style`, which also accepts a function of press
   * state. The function form is deliberately unavailable: press feedback is this
   * component's job, so a caller styling by press state would compete with it.
   */
  readonly style?: StyleProp<ViewStyle>;
  readonly children?: React.ReactNode;
};

/**
 * Pressable with the specified press feedback (§7: scale to 0.98 for 100 ms).
 *
 * Every tappable NoorLife surface uses this so press feedback is identical
 * app-wide and the reduced-motion setting is honoured in one place — when
 * reduce-motion is on, the scale is skipped entirely and only the native ripple /
 * opacity remains.
 */
export function PressableScale({
  style,
  children,
  onPressIn,
  onPressOut,
  disabled,
  ...rest
}: PressableScaleProps) {
  const reducedMotion = useReducedMotion();

  // A lazy `useState` initialiser, not `useRef(...).current`: reading a ref during
  // render is what `react-hooks/refs` correctly flags, and the initialiser is
  // guaranteed to run exactly once, so the Animated.Value stays stable across
  // renders without a render-phase ref read.
  const [scale] = useState(() => new Animated.Value(1));

  const animateTo = useCallback(
    (value: number) => {
      if (reducedMotion) {
        return;
      }
      Animated.timing(scale, {
        toValue: value,
        duration: motionDuration.press,
        useNativeDriver: true,
      }).start();
    },
    [reducedMotion, scale],
  );

  /*
    The floor, raised to whatever the caller already asked for — issue #115.

    A caller may make a control larger; it may not make one smaller than the app-wide minimum, so
    this is a `Math.max` rather than an override in either direction. Content-driven layouts keep
    growing past it, because these are minimums and not dimensions.
  */
  const floor = minimumTouchTargetSize();
  const requested = StyleSheet.flatten(style) ?? {};
  const minWidth = Math.max(Number(requested.minWidth ?? 0), floor);
  const minHeight = Math.max(Number(requested.minHeight ?? 0), floor);

  return (
    /*
      ── One element, and it is the accessibility node — issue #115 ──────────
      This used to be a styled wrapper with an `absoluteFill` Pressable laid over it. The overlay
      carried the role, the label, the state and the testID, so it was the node a screen reader and
      an accessibility scanner measured — and `absoluteFill` resolves against the *padding* box.
      On any bordered control the labelled node was therefore smaller than the box the caller
      sized: a Main Home quick action inside a 116 px wrapper with a 1 dp border reported
      **113 px / 43.048 dp**. Flooring the wrapper could not fix that, because the wrapper is not
      the node; flooring the overlay could not either, because a rounded wrapper clips it.

      An animated `Pressable` is both. It takes the border-box bounds the caller styles *and*
      carries every accessibility prop, so the measured node and the announced node are the same
      box by construction.

      The original arrangement existed because putting the style on an *inner* Pressable left the
      outer wrapper shrink-wrapped, so `flex`, `width`, `alignSelf` and margins silently did
      nothing — it caused bottom-navigation slots that sized to their labels and quick-action tiles
      that collapsed to zero width. That reasoning does not apply here: with no wrapper at all, the
      caller style lands on the outermost element and those properties work as written.
    */
    <AnimatedPressable
      {...rest}
      disabled={disabled}
      onPressIn={(event) => {
        animateTo(pressScale);
        onPressIn?.(event);
      }}
      onPressOut={(event) => {
        animateTo(1);
        onPressOut?.(event);
      }}
      style={[style, { minWidth, minHeight }, { transform: [{ scale }] }]}
    >
      {children}
    </AnimatedPressable>
  );
}

/*
  Created once at module scope. A component identity rebuilt per render remounts its subtree on
  every render, which would restart the scale animation mid-press.
*/
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
