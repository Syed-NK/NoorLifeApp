import { useWindowDimensions } from 'react-native';

import {
  moduleLayout,
  moduleScale,
  moduleType,
  shouldStackTwoColumn,
  type ModuleTypeToken,
} from './module-tokens';

export type ModuleMetrics = {
  /** Applied layout scale. Always ≤ 1. */
  readonly scale: number;
  /** Scales a baseline dp value. Downscales on narrow screens, never upscales. */
  readonly dp: (value: number) => number;
  /** Resolved `[fontSize, lineHeight]` for a type token, scaled the same way. */
  readonly type: (token: ModuleTypeToken) => { fontSize: number; lineHeight: number };
  readonly screenWidth: number;
  readonly screenHeight: number;
  /**
   * The OS text-size setting, reported for diagnostics only.
   *
   * Nothing in this hook multiplies by it, and nothing should: React Native applies the OS font
   * scale itself when it converts a `fontSize` to pixels, so an app that also multiplied by it
   * would scale text twice.
   *
   * It is exposed because a layout decision can legitimately depend on how large the user's text
   * is — `shouldStackTwoColumn` is the standing example, dividing the measured half-column by this
   * value. It was also read by a development typography probe, which has since been deleted along
   * with its route; see `docs/DEV_ROUTE_BACKLOG.md`.
   */
  readonly fontScale: number;
  /** Horizontal page padding at the current scale. */
  readonly pagePadding: number;
  /** Width available to content: the capped column minus both paddings. */
  readonly contentWidth: number;
  /** Width of one feature-grid tile at the current scale, including the fractional remainder. */
  readonly featureTileWidth: number;
  /** Width one card of a two-column pair gets, at the current scale. */
  readonly twoColumnWidth: number;
  /**
   * Whether a two-column pair must render as a one-column stack here.
   *
   * True when `twoColumnWidth` is too narrow *for the current OS text size* to hold a heading, a
   * prayer label or an observance date without ellipsis — see `shouldStackTwoColumn`. This is the
   * one place the decision is made, so both of Faith Home's pairs and any future one answer it
   * identically.
   */
  readonly stackTwoColumns: boolean;
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
  const { width, height, fontScale } = useWindowDimensions();

  const scale = moduleScale(width);
  const dp = (value: number): number => Math.round(value * scale);
  const columnWidth = Math.min(width, moduleLayout.referenceWidth);
  const pagePadding = dp(moduleLayout.pagePadding);
  const contentWidth = columnWidth - pagePadding * 2;
  const featureGap = dp(moduleLayout.featureGap);
  const twoColumnWidth = (contentWidth - dp(moduleLayout.twoColumnGap)) / 2;

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
    fontScale,
    pagePadding,
    contentWidth,
    featureTileWidth:
      (contentWidth - featureGap * (moduleLayout.featureColumns - 1)) / moduleLayout.featureColumns,
    twoColumnWidth,
    stackTwoColumns: shouldStackTwoColumn(twoColumnWidth, fontScale),
  };
}
