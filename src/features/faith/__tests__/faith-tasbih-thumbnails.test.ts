import fs from 'node:fs';
import path from 'node:path';

import { decodePng, fitBead, pixelAt } from '@/test-support/decode-png';

import { TASBIH_MATERIALS } from '../data/tasbih/tasbih-materials';

/**
 * **The six selector thumbnails, measured as pictures rather than as files.**
 *
 * ── The defect this exists to catch ─────────────────────────────────────────
 * The delivered thumbnails were cut from a contact sheet by a crop that ignored where each bead
 * actually sat. Every one was clipped at its bottom edge, each sat about 24 px low, and the
 * horizontal centres spread over 22.5 px — walnut +3.5, figured brown −19.0. On screen the swatch
 * *controls* were centred to within 0.2 dp and the beads inside them plainly were not, which is a
 * defect no amount of layout assertion can see.
 *
 * So this suite reads the pixels. It is the only kind of test that could have caught it, and it is
 * cheap: six 256 px images, decoded once.
 */

const ASSET_DIR = path.join(process.cwd(), 'assets/images/modules/faith/tasbih');

/**
 * Detection threshold per material.
 *
 * Five of the six are strongly darker or more saturated than the ivory ground. White jade is a
 * near-white sphere on a near-white ground and needs a finer threshold; at the others' setting its
 * edge is not found until well inside the bead, which reported it as small and low.
 */
const TOLERANCE: Record<string, number> = {
  walnut: 35,
  'green-jade': 35,
  'black-onyx': 35,
  'white-jade': 15,
  sandalwood: 35,
  'figured-brown': 35,
};

const fits = TASBIH_MATERIALS.map((material) => {
  const png = decodePng(
    fs.readFileSync(path.join(ASSET_DIR, `tasbih-material-${material.id}.png`)),
  );
  return { id: material.id, png, fit: fitBead(png, TOLERANCE[material.id] ?? 35) };
});

describe('every thumbnail is the same picture of a different bead', () => {
  it.each(fits)('$id is a 256 x 256 canvas', ({ png }) => {
    expect([png.width, png.height]).toEqual([256, 256]);
  });

  it.each(fits)('$id centres its bead horizontally', ({ png, fit }) => {
    /*
      Within one pixel of the canvas centre. At a 46 dp swatch a pixel is 0.18 dp, so this is an
      order of magnitude tighter than the eye can resolve — and the delivered assets missed it by up
      to 17.5 px.
    */
    expect(Math.abs(fit.centreX - (png.width - 1) / 2)).toBeLessThanOrEqual(1);
  });

  it.each(fits)('$id centres its bead vertically', ({ png, fit }) => {
    // Slightly looser than the horizontal bound: the top edge of a matte sphere is a soft gradient,
    // so the fitted centre carries a pixel or two of honest measurement noise.
    expect(Math.abs(fit.centreY - (png.height - 1) / 2)).toBeLessThanOrEqual(3);
  });

  it.each(fits)('$id keeps the bead clear of every canvas edge', ({ png, fit }) => {
    /*
      The delivered set was clipped flat along the bottom on all six — a sphere with a straight edge.
      A real margin on every side is what makes the swatch read as a bead rather than as a crop.
    */
    const radius = fit.diameter / 2;
    expect(fit.centreX - radius).toBeGreaterThan(4);
    expect(png.width - (fit.centreX + radius)).toBeGreaterThan(4);
    expect(fit.centreY - radius).toBeGreaterThan(4);
    expect(png.height - (fit.centreY + radius)).toBeGreaterThan(4);
  });

  it('draws every bead at the same size', () => {
    const diameters = fits.map((entry) => entry.fit.diameter);
    // No material may look larger or smaller than another; 4 px at 256 is under 1 dp on screen.
    expect(Math.max(...diameters) - Math.min(...diameters)).toBeLessThanOrEqual(4);
  });

  it('puts every bead on one horizontal centreline', () => {
    const centres = fits.map((entry) => entry.fit.centreY);
    expect(Math.max(...centres) - Math.min(...centres)).toBeLessThanOrEqual(4);
  });

  it('grounds all six on the same background, so no swatch reads as a different surface', () => {
    const corners = fits.map(({ png }) => pixelAt(png, 3, 3));
    for (const channel of [0, 1, 2]) {
      const values = corners.map((corner) => corner[channel] ?? 0);
      expect(Math.max(...values) - Math.min(...values)).toBeLessThanOrEqual(6);
    }
  });

  it('carries no baked ring, border or label', () => {
    /*
      The selection ring is drawn by the component so it can be centred on the control. A ring baked
      into one thumbnail would sit wherever that crop happened to put it — and would show on the
      unselected swatches too. Checked as the absence of a hard edge running along the canvas border.
    */
    for (const { png } of fits) {
      const topLeft = pixelAt(png, 3, 3);
      for (const [x, y] of [
        [png.width - 4, 3],
        [3, png.height - 4],
        [png.width - 4, png.height - 4],
      ] as const) {
        const corner = pixelAt(png, x, y);
        const delta = Math.max(
          Math.abs(corner[0] - topLeft[0]),
          Math.abs(corner[1] - topLeft[1]),
          Math.abs(corner[2] - topLeft[2]),
        );
        expect(delta).toBeLessThanOrEqual(12);
      }
    }
  });
});
