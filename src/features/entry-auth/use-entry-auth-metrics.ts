import { useWindowDimensions } from 'react-native';

import { entryAuthLayout, entryAuthScale, entryAuthType } from './entry-auth-tokens';
import type { EntryAuthTypeToken } from './entry-auth-tokens';

export type EntryAuthMetrics = {
  /** Applied layout scale. Always ≤ 1. */
  readonly scale: number;
  /** Scales a locked dp value. Downscales on narrow screens, never upscales. */
  readonly dp: (value: number) => number;
  /** Resolved `[fontSize, lineHeight]` for a type token, scaled the same way. */
  readonly type: (token: EntryAuthTypeToken) => { fontSize: number; lineHeight: number };
  readonly screenWidth: number;
  readonly screenHeight: number;
  /** Horizontal page padding at the current scale. */
  readonly pagePadding: number;
  /** Width available to content: the capped column minus both paddings. */
  readonly contentWidth: number;
};

/**
 * Resolved geometry for every entry/authentication screen.
 *
 * The content column is capped at the 393 dp baseline and centred, so a wider handset
 * gets margins rather than stretched cards. Height is deliberately absent from every
 * calculation — the visual lock forbids scaling cards or fonts to fill a tall device.
 */
export function useEntryAuthMetrics(): EntryAuthMetrics {
  const { width, height } = useWindowDimensions();

  const scale = entryAuthScale(width);
  const dp = (value: number): number => Math.round(value * scale);
  const columnWidth = Math.min(width, entryAuthLayout.referenceWidth);
  const pagePadding = dp(entryAuthLayout.pagePadding);

  return {
    scale,
    dp,
    type: (token) => {
      const [fontSize, lineHeight] = entryAuthType[token];
      return {
        // Font sizes keep one decimal: rounding to whole dp at 0.93 scale visibly
        // flattens the ramp's smaller steps into each other.
        fontSize: +(fontSize * scale).toFixed(1),
        lineHeight: +(lineHeight * scale).toFixed(1),
      };
    },
    screenWidth: width,
    screenHeight: height,
    pagePadding,
    contentWidth: columnWidth - pagePadding * 2,
  };
}
