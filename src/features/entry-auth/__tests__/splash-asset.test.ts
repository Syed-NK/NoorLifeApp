import fs from 'node:fs';
import path from 'node:path';

import { PNG } from 'pngjs';

import { SPLASH_SOURCE } from '../entry-auth-assets';

/**
 * The installed splash artwork itself, not the component that renders it.
 *
 * `resolveSplashResizeMode` decides between cover and contain from `SPLASH_SOURCE`, whose
 * `contentSafeInsetX` was *measured off the PNG*. Swapping the artwork without re-measuring would
 * leave that arithmetic describing a file that no longer exists — and the failure mode is silent:
 * `cover` would crop into a pictogram on a tall handset and nothing would fail.
 *
 * Phase 5B replaced the artwork, so these assertions re-derive the measurement from the file on
 * disk and check the constant is still a safe floor.
 */

const SPLASH_PATH = path.join(
  process.cwd(),
  'assets',
  'images',
  'entry-auth',
  'splash-luminous-family-emblem.png',
);

/**
 * The horizontal margin of pure background, in source pixels.
 *
 * Content is detected by saturation or darkness rather than by difference from a flat colour: the
 * background is a soft gradient with sparkles, so a flat-colour diff marks the entire canvas as
 * content. Colourful pictograms and the dark navy wordmark both clear these thresholds; the
 * near-neutral backdrop does not. Calibration: this method returns exactly 38 px for the previous
 * artwork, which is the value `SPLASH_SOURCE.contentSafeInsetX` records.
 */
function measureHorizontalMargin(file: string): number {
  const png = PNG.sync.read(fs.readFileSync(file));
  const { width, height, data } = png;
  let minX = width;
  let maxX = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) << 2;
      const r = data[i] ?? 0;
      const g = data[i + 1] ?? 0;
      const b = data[i + 2] ?? 0;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const saturation = max === 0 ? 0 : (max - min) / max;

      if (saturation > 0.22 || max < 170) {
        if (x < minX) {
          minX = x;
        }
        if (x > maxX) {
          maxX = x;
        }
      }
    }
  }

  return Math.min(minX, width - 1 - maxX);
}

describe('the installed splash artwork', () => {
  it('exists at the approved path', () => {
    expect(fs.existsSync(SPLASH_PATH)).toBe(true);
  });

  it('keeps the 852 x 1846 source dimensions the resize arithmetic assumes', () => {
    const png = PNG.sync.read(fs.readFileSync(SPLASH_PATH));

    expect(png.width).toBe(SPLASH_SOURCE.width);
    expect(png.height).toBe(SPLASH_SOURCE.height);
  });

  it('carries at least the content-safe margin that cover is allowed to crop', () => {
    // 40 px measured against a 38 px allowance: `cover` cannot reach a pictogram. If a future
    // artwork tightens its margins, this fails instead of silently clipping the ring.
    const margin = measureHorizontalMargin(SPLASH_PATH);

    expect(margin).toBeGreaterThanOrEqual(SPLASH_SOURCE.contentSafeInsetX);
  });
});

describe('the superseded splash', () => {
  it('is still on disk, unmodified, so the supersession is reviewable', () => {
    // Phase 5B changed which file the registry points at rather than overwriting bytes behind an
    // unchanged filename. Keeping the old file makes that a visible one-line diff.
    const old = path.join(process.cwd(), 'assets', 'images', 'entry-auth', 'splash-soft-mint.png');

    expect(fs.existsSync(old)).toBe(true);
  });

  it('is no longer referenced by the asset registry', () => {
    const registry = fs.readFileSync(
      path.join(process.cwd(), 'src', 'shared', 'assets', 'noorlife-assets.ts'),
      'utf8',
    );

    // The only mention permitted is the comment explaining the supersession, never a `require`.
    expect(registry).not.toMatch(/require\([^)]*splash-soft-mint/);
    expect(registry).toMatch(/require\([^)]*splash-luminous-family-emblem/);
  });
});
