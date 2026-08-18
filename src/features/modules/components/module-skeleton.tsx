import { useEffect, useState } from 'react';
import { Animated, Easing, StyleSheet, View, type ViewStyle } from 'react-native';

import { useReducedMotion } from '@shared/utils/a11y';

import { moduleNeutrals } from '../module-tokens';
import { useModuleMetrics } from '../use-module-metrics';

export type ModuleSkeletonProps = {
  /** Height in baseline dp; scaled internally. */
  readonly height: number;
  /** Defaults to filling its parent's width. */
  readonly width?: ViewStyle['width'];
  /** Baseline dp. Defaults to the small radius. */
  readonly radius?: number;
  readonly style?: ViewStyle;
  readonly testID?: string;
};

/**
 * One shimmering placeholder block.
 *
 * ── Reduced motion ─────────────────────────────────────────────────────────
 * The shimmer is a looping opacity animation, which is exactly the kind of thing
 * "reduce motion" exists to stop. When the setting is on, the block renders as a
 * static tint instead — still clearly a placeholder, with no animation at all. The
 * loop is not started rather than being started and hidden, so it costs nothing.
 *
 * `useNativeDriver` keeps the loop off the JS thread, so it does not compete with the
 * request it is standing in for.
 */
export function ModuleSkeleton({ height, width, radius, style, testID }: ModuleSkeletonProps) {
  const { dp } = useModuleMetrics();
  const reduceMotion = useReducedMotion();
  /**
   * The animated value, created once.
   *
   * `useState` with a lazy initialiser rather than the older `useRef(new Animated.Value(0)).current`:
   * reading `.current` during render is a ref access, which the React Compiler rejects — and it is
   * right to, because a ref read in render is invisible to the reactivity model. A state value
   * initialised once is stable for the component's life and legal to read while rendering. The
   * setter is deliberately unused; the value mutates itself through the driver.
   */
  const [shimmer] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (reduceMotion) {
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmer, {
          toValue: 1,
          duration: 750,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(shimmer, {
          toValue: 0,
          duration: 750,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => {
      loop.stop();
    };
  }, [reduceMotion, shimmer]);

  const base: ViewStyle = {
    height: dp(height),
    width: width ?? '100%',
    borderRadius: dp(radius ?? 10),
    backgroundColor: moduleNeutrals.skeleton,
  };

  if (reduceMotion) {
    return <View style={[base, style]} accessible={false} testID={testID} />;
  }

  return (
    <Animated.View
      style={[
        base,
        { opacity: shimmer.interpolate({ inputRange: [0, 1], outputRange: [1, 0.45] }) },
        style,
      ]}
      accessible={false}
      testID={testID}
    />
  );
}

export type ModuleSkeletonGroupProps = {
  /** Number of placeholder rows. */
  readonly rows?: number;
  readonly testID?: string;
};

/**
 * A card-shaped group of placeholders.
 *
 * `accessible={false}` throughout and wrapped in an `importantForAccessibility="no-hide-descendants"`
 * container: a screen reader should hear the loading *announcement* once, from
 * `ModuleLoadingState`, not six unlabelled blocks.
 */
export function ModuleSkeletonGroup({ rows = 3, testID }: ModuleSkeletonGroupProps) {
  const { dp } = useModuleMetrics();

  return (
    <View
      style={[styles.group, { rowGap: dp(10) }]}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      testID={testID}
    >
      <ModuleSkeleton height={96} radius={16} />
      {Array.from({ length: rows }, (_, index) => (
        <ModuleSkeleton key={index} height={54} radius={12} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  group: {
    alignSelf: 'stretch',
  },
});
