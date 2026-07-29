/**
 * Splash geometry.
 *
 * The artwork itself now lives in the shared registry (`@shared/assets/noorlife-assets`), which is the
 * single place every approved PNG is required from. What stays here is the *measurement* the splash
 * screen reasons about, because it belongs with the screen rather than with the asset table.
 */

/**
 * Content-safe inset of the splash artwork, in source pixels.
 *
 * Measured from the PNG: meaningful content — medallions, wordmark, tagline, family — spans x 38..810
 * of 852, so 38 px is the narrowest side margin of pure background. `cover` may crop up to this much
 * per side without touching artwork, which is what makes the cover-versus-contain decision provable
 * rather than a judgement call.
 */
export const SPLASH_SOURCE = {
  width: 852,
  height: 1846,
  contentSafeInsetX: 38,
} as const;
