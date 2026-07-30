import { MODULE_TILE_TINT } from '@features/home/module-tile-theme';
import { modulePalettes } from '@ds/tokens';

import {
  FRAMEWORK_MODULE_IDS,
  moduleColorThemes,
  moduleLayout,
  moduleNeutrals,
  moduleScale,
  moduleType,
} from '../module-tokens';

/**
 * The module theme system's contract.
 *
 * Every claim the token file makes in a comment is asserted here. The point is that a
 * future colour edit fails a test rather than silently shipping unreadable text — the
 * failure mode this whole derivation exists to prevent.
 */

/** WCAG relative luminance. */
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((index) => {
    const value = parseInt(hex.slice(index, index + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
  }) as [number, number, number];
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(a: string, b: string): number {
  const first = luminance(a);
  const second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

const WHITE = '#FFFFFF';
/** WCAG AA for normal text. */
const AA_TEXT = 4.5;
/** WCAG AA for non-text UI components and boundaries. */
const AA_UI = 3;

describe('contrast helper', () => {
  it('matches the known reference ratios', () => {
    // Black on white is exactly 21:1, and a colour against itself is 1:1.
    expect(contrast('#000000', WHITE)).toBeCloseTo(21, 2);
    expect(contrast('#777777', '#777777')).toBeCloseTo(1, 5);
  });
});

describe.each(FRAMEWORK_MODULE_IDS)('module theme: %s', (moduleId) => {
  const theme = moduleColorThemes[moduleId];

  it('uses ink that clears AA text contrast on its own surface and on white', () => {
    expect(contrast(theme.ink, theme.lightSurface)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrast(theme.ink, WHITE)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('uses a fill that clears AA text contrast against its own label colour', () => {
    expect(contrast(theme.onFill, theme.fill)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('uses a border that clears the non-text threshold on its surface and on white', () => {
    expect(contrast(theme.border, theme.lightSurface)).toBeGreaterThanOrEqual(AA_UI);
    expect(contrast(theme.border, WHITE)).toBeGreaterThanOrEqual(AA_UI);
  });

  it('keeps white hero text readable across the whole gradient', () => {
    // The start is the deeper end, so it must clear the stricter bar; both ends must
    // clear AA, because the headline can sit over either.
    expect(contrast(theme.onFill, theme.gradientStart)).toBeGreaterThanOrEqual(7);
    expect(contrast(theme.onFill, theme.gradientEnd)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('keeps the shared neutrals readable on the module surface', () => {
    expect(contrast(moduleNeutrals.textPrimary, theme.lightSurface)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrast(moduleNeutrals.textSecondary, theme.lightSurface)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('takes its brand hue from the locked palette rather than re-typing it', () => {
    expect(theme.primary).toBe(modulePalettes[moduleId].primary);
  });

  it('continues the Main Home tile tint', () => {
    // Opening a module should feel like its tile expanded. This is the assertion that
    // keeps the two in step without the module layer importing a locked file.
    expect(theme.lightSurface).toBe(MODULE_TILE_TINT[moduleId]);
  });
});

describe('module scale', () => {
  it('never exceeds 1, however wide the screen', () => {
    for (const width of [360, 393, 412, 480, 768, 1280]) {
      expect(moduleScale(width)).toBeLessThanOrEqual(1);
    }
  });

  it('downscales below the reference width', () => {
    expect(moduleScale(360)).toBeCloseTo(360 / 393, 5);
  });

  it('is exactly 1 at the reference width', () => {
    expect(moduleScale(moduleLayout.referenceWidth)).toBe(1);
  });
});

describe('module layout', () => {
  it('meets the minimum touch target', () => {
    expect(moduleLayout.minTouchTarget).toBeGreaterThanOrEqual(44);
  });

  it('divides the content column into four whole feature columns with no remainder lost', () => {
    const contentWidth = moduleLayout.referenceWidth - moduleLayout.pagePadding * 2;
    const tile =
      (contentWidth - moduleLayout.featureGap * (moduleLayout.featureColumns - 1)) /
      moduleLayout.featureColumns;
    const consumed = tile * moduleLayout.featureColumns + moduleLayout.featureGap * 3;
    // Fractional tile widths are deliberate: flooring is what left a visible sliver
    // down the right of Main Home's grid.
    expect(consumed).toBeCloseTo(contentWidth, 6);
  });
});

describe('module type ramp', () => {
  it('gives every token a line height taller than its font size', () => {
    for (const [token, [fontSize, lineHeight]] of Object.entries(moduleType)) {
      expect(lineHeight).toBeGreaterThan(fontSize);
      expect(token).toBeTruthy();
    }
  });
});
