import { useWindowDimensions } from 'react-native';

import { moduleLayout, moduleScale, moduleType, type ModuleTypeToken } from './module-tokens';

export type ModuleMetrics = {
  /** Applied layout scale. Always ≤ 1. */
  readonly scale: number;
  /** Scales a baseline dp value. Downscales on narrow screens, never upscales. */
  readonly dp: (value: number) => number;
  /** Resolved `[fontSize, lineHeight]` for a type token, scaled the same way. */
  readonly type: (token: ModuleTypeToken) => { fontSize: number; lineHeight: number };
  readonly screenWidth: number;
  readonly screenHeight: number;
  /** Horizontal page padding at the current scale. */
  readonly pagePadding: number;
  /** Width available to content: the capped column minus both paddings. */
  readonly contentWidth: number;
  /** Width of one feature-grid tile at the current scale, including the fractional remainder. */
  readonly featureTileWidth: number;
};

/**
 * Resolved geometry for every module screen.
 *
 * Height is deliberately not an input. Main Home's lock forbids growing cards or
 * type to fill a tall device, and a module screen that did so would stop matching
 * the app it sits inside.
 *
 * `featureTileWidth` keeps its fraction rather than flooring. Flooring four
 * columns is what left a visible sliver on the right of Main Home's grid, and the
 * same arithmetic produces the same defect here.
 */
export function useModuleMetrics(): ModuleMetrics {
  const { width, height } = useWindowDimensions();

  const scale = moduleScale(width);
  const dp = (value: number): number => Math.round(value * scale);
  const columnWidth = Math.min(width, moduleLayout.referenceWidth);
  const pagePadding = dp(moduleLayout.pagePadding);
  const contentWidth = columnWidth - pagePadding * 2;
  const featureGap = dp(moduleLayout.featureGap);

  return {
    scale,
    dp,
    type: (token) => {
      const [fontSize, lineHeight] = moduleType[token];
      return {
        // One decimal kept on purpose: rounding to whole dp at 0.93 scale collapses
        // the ramp's smaller steps into each other.
        fontSize: +(fontSize * scale).toFixed(1),
        lineHeight: +(lineHeight * scale).toFixed(1),
      };
    },
    screenWidth: width,
    screenHeight: height,
    pagePadding,
    contentWidth,
    featureTileWidth:
      (contentWidth - featureGap * (moduleLayout.featureColumns - 1)) / moduleLayout.featureColumns,
  };
}
