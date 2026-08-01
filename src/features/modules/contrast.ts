/**
 * WCAG contrast arithmetic.
 *
 * Extracted from the token tests so the Module Gallery can *display* the same ratios the
 * suite asserts. One implementation, two consumers — a gallery computing contrast its own
 * way could show a passing number for a combination the tests reject.
 *
 * Only the sRGB relative-luminance formula from WCAG 2.x is implemented; that is all the
 * app's flat colours need. `contrastRatio` still refuses alpha, deliberately: a translucent
 * foreground has no single contrast ratio. Where the app *does* layer a translucent fill —
 * the locked module tile's scrim — `composite` resolves it to the opaque colour that is
 * actually rendered, and that result is what gets measured. Measuring the intended colour
 * rather than the rendered one is how a locked label passed review at 15:1 and shipped at
 * 2.7:1.
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

/** Formats 0–255 channels back to `#RRGGBB`. */
function toHex(values: readonly [number, number, number]): string {
  return `#${values.map((value) => Math.round(value).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * The opaque colour produced by drawing `foreground` at `alpha` over `background`.
 *
 * Standard source-over compositing. Both inputs must be opaque `#RRGGBB`; the result is the
 * colour a screen-reader-blind eye and a contrast meter both actually see, so it is what the
 * ratio should be taken against.
 */
export function composite(foreground: string, alpha: number, background: string): string {
  if (alpha < 0 || alpha > 1) {
    throw new Error(`composite(): alpha must be between 0 and 1, received ${alpha}`);
  }
  const front = channels(foreground);
  const back = channels(background);
  return toHex([
    front[0] * alpha + back[0] * (1 - alpha),
    front[1] * alpha + back[1] * (1 - alpha),
    front[2] * alpha + back[2] * (1 - alpha),
  ]);
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
