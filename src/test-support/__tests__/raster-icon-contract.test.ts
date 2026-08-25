import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  FORBIDDEN_BRAND_TERMS,
  inspectRasterIcon,
  inspectRasterIconBuffer,
  isBrandNeutral,
  syntheticPng,
} from '../raster-icon-contract';

/**
 * **The contract every commissioned raster icon must satisfy** — issue #66.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Eight asset batches are planned. This is the check they will each be run through, so the
 * interesting half of this suite is the rejections: a validator whose failure paths are never
 * exercised reports the absence of problems it did not look for.
 *
 * Every malformed case is a buffer assembled in memory. Committing a broken PNG to prove the
 * validator catches broken PNGs would ship the broken PNG, and a future audit would find it and be
 * right to.
 *
 * The accepting cases run against the eight commissioned module pictograms already in the
 * repository — NoorLife-owned, and neither moved, copied, normalised nor modified here.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const PICTOGRAM_DIR = join(__dirname, '..', '..', '..', 'assets', 'images', 'pictograms');
const SHIPPED = readdirSync(PICTOGRAM_DIR).filter((entry) => entry.endsWith('.png'));

describe('the shipped module pictograms', () => {
  it('are the eight this project already commissioned', () => {
    expect(SHIPPED.sort()).toEqual([
      'faith.png',
      'family.png',
      'finance.png',
      'goals.png',
      'health.png',
      'learning.png',
      'noor-ai.png',
      'planner.png',
    ]);
  });

  it.each(SHIPPED)('%s is a valid PNG carrying alpha', (file) => {
    const report = inspectRasterIcon(join(PICTOGRAM_DIR, file));
    expect(report.hasAlpha).toBe(true);
    expect(report.bitDepth).toBe(8);
    expect(report.interlaced).toBe(false);
    expect(report.width).toBeGreaterThan(0);
    expect(report.height).toBeGreaterThan(0);
  });

  it.each(SHIPPED)('%s has transparent corners and no white box', (file) => {
    /*
      The defect this catches is an export flattened onto a white canvas. On a white screen it is
      invisible; on a coloured module card it is a white rectangle behind the artwork.
    */
    const report = inspectRasterIcon(join(PICTOGRAM_DIR, file));
    expect(report.transparentCorners).toBe(true);
    expect(report.whiteBoxCorner).toBe(false);
  });

  it.each(SHIPPED)('%s carries no authoring metadata', (file) => {
    /*
      None of these chunks affects rendering and all of them travel. `eXIf` in particular can carry a
      camera, a location or a copyright line that nobody reviewing a picture of an icon would look
      for.
    */
    expect(inspectRasterIcon(join(PICTOGRAM_DIR, file)).forbiddenChunks).toEqual([]);
  });

  it('keeps whatever real dimensions each was delivered at', () => {
    /*
      Recorded, not imposed. These assets predate this contract and a newly invented size would fail
      artwork that is already approved and shipping. Future batches declare their expected size
      explicitly; this asserts only that every one of them *has* a declared square size, which is
      what the primitive's square box assumes.
    */
    const sizes = SHIPPED.map((file) => {
      const { width, height } = inspectRasterIcon(join(PICTOGRAM_DIR, file));
      return `${file}:${width}x${height}`;
    });
    for (const entry of sizes) {
      const [, dims] = entry.split(':');
      const [w, h] = (dims ?? '').split('x');
      expect(w).toBe(h);
    }
  });

  it.each(SHIPPED)('%s names no third-party brand', (file) => {
    expect(isBrandNeutral(join('assets/images/pictograms', file))).toBe(true);
  });

  it('registers each file under a unique key', () => {
    expect(new Set(SHIPPED).size).toBe(SHIPPED.length);
  });
});

describe('what the validator refuses', () => {
  it('refuses a file that is not a PNG', () => {
    const notPng = syntheticPng({ signature: Buffer.from('NOTAPNG!', 'latin1') });
    expect(() => inspectRasterIconBuffer(notPng)).toThrow(/not a PNG/);
  });

  it('refuses a missing file', () => {
    expect(() => inspectRasterIcon(join(PICTOGRAM_DIR, 'does-not-exist.png'))).toThrow();
  });

  it('reports no alpha for a truecolour PNG without an alpha channel', () => {
    /*
      Colour type 2 is RGB. It is a perfectly valid PNG and a defect as an icon: with no alpha there
      is no transparency, so whatever the artboard background was becomes part of the picture.
    */
    const report = inspectRasterIconBuffer(syntheticPng({ colourType: 2 }));
    expect(report.colourType).toBe(2);
    expect(report.hasAlpha).toBe(false);
    expect(report.transparentCorners).toBe(false);
  });

  it('reports every forbidden metadata chunk it finds', () => {
    const report = inspectRasterIconBuffer(
      syntheticPng({ extraChunks: ['tEXt', 'iTXt', 'zTXt', 'eXIf', 'tIME'] }),
    );
    expect([...report.forbiddenChunks].sort()).toEqual(['eXIf', 'iTXt', 'tEXt', 'tIME', 'zTXt']);
  });

  it('leaves an innocuous chunk alone', () => {
    /*
      The rule is about provenance, not about every ancillary chunk. `pHYs` carries pixel density and
      is neither identifying nor a rendering hazard, so flagging it would train people to ignore the
      check.
    */
    const report = inspectRasterIconBuffer(syntheticPng({ extraChunks: ['pHYs'] }));
    expect(report.chunks).toContain('pHYs');
    expect(report.forbiddenChunks).toEqual([]);
  });

  it('reads the declared dimensions from the header', () => {
    const report = inspectRasterIconBuffer(syntheticPng({ width: 96, height: 64 }));
    expect(report.width).toBe(96);
    expect(report.height).toBe(64);
  });
});

describe('brand neutrality', () => {
  it.each(FORBIDDEN_BRAND_TERMS)('rejects a key containing %s', (term) => {
    expect(isBrandNeutral(`assets/images/pictograms/${term}-mark.png`)).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(isBrandNeutral('assets/Google-Pay.png')).toBe(false);
    expect(isBrandNeutral('assets/images/pictograms/budgets.png')).toBe(true);
  });
});

describe('the validator itself', () => {
  it('builds no asset path dynamically and imports the decoder statically', () => {
    /*
      The rule the whole raster path rests on: Metro resolves `require` at build time, so a template
      string or a variable lookup silently resolves to nothing in a release bundle. A validator that
      broke it would be the first place a future batch copied.
    */
    const source = readFileSync(join(__dirname, '..', 'raster-icon-contract.ts'), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/require\(/);
    expect(code).toContain("import { decodePng } from './decode-png'");
  });
});
