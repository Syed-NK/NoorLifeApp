/**
 * WCAG contrast arithmetic.
 *
 * Extracted from the token tests so the Module Gallery can *display* the same ratios the
 * suite asserts. One implementation, two consumers — a gallery computing contrast its own
 * way could show a passing number for a combination the tests reject.
 *
 * Only the sRGB relative-luminance formula from WCAG 2.x is implemented; that is all the
 * app's flat colours need. Alpha is not handled, deliberately: a translucent foreground
 * has no single contrast ratio, so any colour passed here must be opaque.
 */

/** WCAG AA for normal-size text. */
export const AA_TEXT = 4.5;
/** WCAG AA for large text (≥18.66 dp bold, or ≥24 dp). */
export const AA_LARGE_TEXT = 3;
/** WCAG AA for non-text UI components and graphical boundaries. */
export const AA_UI = 3;

/** Parses `#RRGGBB` into 0–255 channels. Throws on anything else. */
function channels(hex: string): readonly [number, number, number] {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) {
    throw new Error(`contrast(): expected an opaque #RRGGBB colour, received "${hex}"`);
  }
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ] as const;
}

/** WCAG relative luminance. */
export function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((value) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contrast ratio between two opaque colours. Ranges 1 (identical) to 21 (black on white). */
export function contrastRatio(a: string, b: string): number {
  const first = luminance(a);
  const second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

/** Formats a ratio the way the gallery and a review note would write it. */
export function formatRatio(ratio: number): string {
  return `${ratio.toFixed(2)}:1`;
}

/** Whether a foreground/background pair meets a threshold. */
export function meets(foreground: string, background: string, threshold: number): boolean {
  return contrastRatio(foreground, background) >= threshold;
}
