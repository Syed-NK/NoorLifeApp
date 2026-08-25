import { readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { decodePng, pixelAt } from '@/test-support/decode-png';
import {
  commissionedAssetViolations,
  inspectOpticalBounds,
  inspectRasterIcon,
  syntheticPng,
} from '@/test-support/raster-icon-contract';
import { syntheticPalettePng } from '@/test-support/synthetic-png-bytes';

/**
 * Indexed-palette PNG decoding, and the line it must not cross — issue #70.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * All fifteen legacy Faith pictograms are palette PNGs with `tRNS`. Before this, `decodePng` threw on
 * every one of them, so the one surface with approved, shipped, full-box pictograms was the one
 * surface whose optical bounds could not be measured. That is the gap being closed.
 *
 * The risk in closing it is that "the decoder reads palettes now" quietly becomes "palette artwork is
 * fine", and the next commissioned batch arrives as an indexed palette with a 5 px margin. So the
 * same file that proves the decoding works proves the standard did not move: a palette asset is
 * readable and *still* rejected as a new commission.
 *
 * No Faith byte is rewritten to make any of this pass. Their encoding is not a defect to be fixed;
 * being unable to audit it was.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const FAITH_PICTOGRAMS = 'assets/images/modules/faith/pictograms';

const SCRATCH = process.env['TMPDIR'] ?? process.env['TEMP'] ?? '.';

/** A three-entry palette: index 0 transparent ground, index 1 red, index 2 green. */
const PALETTE = [
  [0, 0, 0],
  [220, 40, 40],
  [40, 180, 90],
] as const;

/** A 4 × 4 ring of index 1 around a 2 × 2 core of index 2, on a transparent index-0 ground. */
const RING_INDICES = [0, 1, 1, 0, 1, 2, 2, 1, 1, 2, 2, 1, 0, 1, 1, 0];

/** The valid fixture every failing case below is a single mutation away from. */
const validRing = (): Buffer =>
  syntheticPalettePng({
    width: 4,
    height: 4,
    palette: PALETTE,
    transparency: [0, 255, 255],
    indices: RING_INDICES,
  });

describe('palette PNG decoding', () => {
  it('expands indices through PLTE and tRNS into RGBA', () => {
    const png = decodePng(validRing());

    /* Callers see RGBA regardless of how the file stored it, so nothing downstream branches on it. */
    expect(png.channels).toBe(4);
    expect(png.width).toBe(4);
    expect(png.height).toBe(4);
    expect(png.data.length).toBe(4 * 4 * 4);

    const alphaAt = (x: number, y: number): number => png.data[(y * 4 + x) * 4 + 3] ?? -1;
    expect(alphaAt(0, 0)).toBe(0); // index 0, tRNS alpha 0
    expect(alphaAt(1, 0)).toBe(255); // index 1
    expect(alphaAt(1, 1)).toBe(255); // index 2

    expect(pixelAt(png, 1, 0)).toEqual([220, 40, 40]);
    expect(pixelAt(png, 1, 1)).toEqual([40, 180, 90]);
  });

  it('treats palette entries beyond a short tRNS as opaque, per §11.3.2', () => {
    /* tRNS names only entry 0. Entries 1 and 2 are unmentioned, which means opaque — not undefined. */
    const png = decodePng(
      syntheticPalettePng({
        width: 4,
        height: 4,
        palette: PALETTE,
        transparency: [0],
        indices: RING_INDICES,
      }),
    );

    expect(png.data[(0 * 4 + 0) * 4 + 3]).toBe(0);
    expect(png.data[(0 * 4 + 1) * 4 + 3]).toBe(255);
    expect(png.data[(1 * 4 + 1) * 4 + 3]).toBe(255);
  });

  it('decodes a palette image with no tRNS at all as fully opaque', () => {
    const png = decodePng(
      syntheticPalettePng({ width: 4, height: 4, palette: PALETTE, indices: RING_INDICES }),
    );

    for (let i = 3; i < png.data.length; i += 4) {
      expect(png.data[i]).toBe(255);
    }
  });

  it('measures optical bounds on a palette image', () => {
    /*
      The point of the whole extension. A 16 × 16 canvas with a 4 × 4 mark inset by 6 px: 25% of the
      canvas, 6 px margin on every side. If palette alpha were being read wrongly the visible box
      would come back as the full canvas, which is exactly the failure this catches.
    */
    const indices: number[] = [];
    for (let y = 0; y < 16; y += 1) {
      for (let x = 0; x < 16; x += 1) {
        indices.push(x >= 6 && x <= 9 && y >= 6 && y <= 9 ? 1 : 0);
      }
    }
    const path = join(SCRATCH, 'noorlife-palette-bounds.png');
    writeFileSync(
      path,
      syntheticPalettePng({
        width: 16,
        height: 16,
        palette: PALETTE,
        transparency: [0, 255, 255],
        indices,
      }),
    );

    try {
      const optical = inspectOpticalBounds(path);
      expect(optical.boxWidth).toBe(4);
      expect(optical.boxHeight).toBe(4);
      expect(optical.boxRatio).toBeCloseTo(0.25, 5);
      expect(optical.minMargin).toBe(6);
      expect(optical.centreOffset).toBeCloseTo(0, 5);
    } finally {
      unlinkSync(path);
    }
  });
});

describe('palette PNG decoding fails honestly', () => {
  it('refuses a palette image with no PLTE rather than inventing a ramp', () => {
    expect(() =>
      decodePng(
        syntheticPalettePng({
          width: 4,
          height: 4,
          palette: PALETTE,
          transparency: [0, 255, 255],
          indices: RING_INDICES,
          omitPalette: true,
        }),
      ),
    ).toThrow(/no PLTE/i);
  });

  it('refuses a PLTE whose length is not a whole number of entries', () => {
    expect(() =>
      decodePng(
        syntheticPalettePng({
          width: 4,
          height: 4,
          palette: PALETTE,
          transparency: [0, 255, 255],
          indices: RING_INDICES,
          truncatePalette: true,
        }),
      ),
    ).toThrow(/malformed PLTE/i);
  });

  it('refuses a tRNS carrying more alphas than the palette has entries', () => {
    /* Four alphas for a three-entry palette. Ignoring the extra would hide a broken export. */
    expect(() =>
      decodePng(
        syntheticPalettePng({
          width: 4,
          height: 4,
          palette: PALETTE,
          transparency: [0, 255, 255, 128],
          indices: RING_INDICES,
        }),
      ),
    ).toThrow(/malformed tRNS/i);
  });

  it('refuses a pixel index the palette does not contain', () => {
    /* Index 7 against a three-entry palette would otherwise read past PLTE and report a colour. */
    expect(() =>
      decodePng(
        syntheticPalettePng({
          width: 4,
          height: 4,
          palette: PALETTE,
          transparency: [0, 255, 255],
          indices: RING_INDICES.map((index, at) => (at === 5 ? 7 : index)),
        }),
      ),
    ).toThrow(/index 7 out of range/i);
  });

  it('still refuses the formats it never claimed to support', () => {
    /* Widening the guard for colour type 3 must not have widened it for anything else. */
    expect(() => decodePng(syntheticPng({ colourType: 2, extraChunks: [] }))).toThrow();

    const interlaced = validRing();
    interlaced[28] = 1; // Adam7
    expect(() => decodePng(interlaced)).toThrow(/unsupported PNG/i);

    const fourBit = validRing();
    fourBit[24] = 4; // 4-bit indices, two pixels per byte — a real palette depth, still unsupported
    expect(() => decodePng(fourBit)).toThrow(/unsupported PNG/i);
  });
});

describe('palette support does not relax the commissioned-asset standard', () => {
  it('rejects a palette asset as a new commission even though it decodes cleanly', () => {
    /*
      The load-bearing test of this file. The fixture is 256 × 256, has exactly transparent corners,
      carries no metadata, and sits inside both the box and the margin rules. It fails on one thing
      only — its encoding — which is precisely the guarantee that reading palettes did not license
      shipping them.
    */
    const indices: number[] = [];
    for (let y = 0; y < 256; y += 1) {
      for (let x = 0; x < 256; x += 1) {
        indices.push(x >= 40 && x < 216 && y >= 40 && y < 216 ? 1 : 0);
      }
    }
    const path = join(SCRATCH, 'noorlife-palette-commission.png');
    writeFileSync(
      path,
      syntheticPalettePng({
        width: 256,
        height: 256,
        palette: PALETTE,
        transparency: [0, 255, 255],
        indices,
      }),
    );

    try {
      const optical = inspectOpticalBounds(path);
      expect(optical.canvas).toBe(256);
      expect(optical.boxRatio).toBeLessThanOrEqual(0.85);
      expect(optical.minMargin).toBeGreaterThanOrEqual(19);

      expect(commissionedAssetViolations(path)).toEqual(['colour type 3, expected 6 (RGBA)']);
    } finally {
      unlinkSync(path);
    }
  });
});

describe('legacy Faith pictograms', () => {
  const files = readdirSync(FAITH_PICTOGRAMS)
    .filter((name) => name.endsWith('.png'))
    .sort();

  it('are all indexed-palette PNGs with tRNS, which is why this support was needed', () => {
    expect(files).toHaveLength(15);
    for (const name of files) {
      const header = inspectRasterIcon(join(FAITH_PICTOGRAMS, name));
      expect(header.colourType).toBe(3);
      expect(header.chunks).toContain('PLTE');
      expect(header.chunks).toContain('tRNS');
    }
  });

  it.each(files)('%s decodes to RGBA at its shipped size, and is left alone', (name) => {
    const path = join(FAITH_PICTOGRAMS, name);
    const before = readFileSync(path);
    const png = decodePng(before);

    /*
      1024² is what Faith ships and what Faith keeps. The commissioned standard is 256², and these
      are deliberately not held to it: they are already approved, already on screen at the right
      optical weight, and re-exporting them to satisfy a rule written after them would change
      shipped artwork for no visible gain. What the rule buys here is the ability to measure them.
    */
    expect(png.width).toBe(1024);
    expect(png.height).toBe(1024);
    expect(png.channels).toBe(4);

    const optical = inspectOpticalBounds(path);
    expect(optical.canvas).toBe(1024);
    /* Non-vacuous: there is real transparency, so the alpha channel was genuinely expanded. */
    expect(optical.boxRatio).toBeLessThan(1);
    expect(optical.minMargin).toBeGreaterThan(0);

    /* Reading is reading. Nothing in the audit path may write. */
    expect(readFileSync(path).equals(before)).toBe(true);
  });
});
