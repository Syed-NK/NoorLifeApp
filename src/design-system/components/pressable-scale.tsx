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
import { useReducedMotion } from '@shared/utils/a11y';

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

  return (
    // The caller's style goes on the *outer* view and the Pressable is an absolute touch
    // overlay filling it, rather than the style going on the Pressable with the wrapper
    // shrink-wrapped around it.
    //
    // That ordering matters. With the style on the inner Pressable, layout properties a
    // caller reasonably expects to work — `flex`, `width`, `alignSelf`, margins — silently
    // did nothing, because the wrapper sized itself to content. It caused two real bugs:
    // bottom-navigation slots that sized to their labels instead of even fifths, and a
    // quick-action row whose tiles collapsed to zero width.
    //
    // Children render in the wrapper so the caller's `padding`, `alignItems` and
    // `justifyContent` position them as written; the overlay sits above them and captures
    // the press. Accessibility props stay on the Pressable, so it remains the single
    // focusable, labelled control.
    <Animated.View style={[style, { transform: [{ scale }] }]}>
      {children}
      <Pressable
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
        style={StyleSheet.absoluteFill}
      />
    </Animated.View>
  );
}
