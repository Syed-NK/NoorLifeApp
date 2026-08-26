import { unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  COMMISSIONED_CANVAS,
  MAX_CENTRE_OFFSET_PX,
  MAX_OPTICAL_BOX_RATIO,
  MIN_SAFETY_MARGIN_PX,
  commissionedAssetViolations,
  inspectOpticalBounds,
} from '@/test-support/raster-icon-contract';
import { syntheticRgbaPng, type RgbaPngOptions } from '@/test-support/synthetic-png-bytes';

/**
 * The optical contract, proven by making it fail — issue #70.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * `inspectRasterIcon` checked signature, header, alpha, corners and metadata. Everything it looked at
 * passed for Finance's first delivery, which shipped at 512 × 512 instead of 256, and for a staged
 * Planner asset whose safety margin was 5 px instead of 19. Neither is visible in a header, and both
 * change how large an icon looks on a phone.
 *
 * So a rule was added, and a rule nobody has watched fail is a rule that might not work. Each case
 * below is one deliberate mutation of a known-good 256 × 256 fixture, asserted to produce that
 * specific reason and — where the mutation is orthogonal — *only* that reason. A test that merely
 * asserted `violations.length > 0` would still pass if every fixture failed for the same unrelated
 * cause.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const SCRATCH = process.env['TMPDIR'] ?? process.env['TEMP'] ?? '.';

/**
 * A compliant fixture: 256 × 256, a 176 px mark centred with a 40 px margin on every side.
 *
 * 176/256 = 68.75%, inside the 85% ceiling; 40 px, twice the 19 px floor; exactly centred. Every
 * failing case below is this, with one thing changed.
 */
const GOOD: RgbaPngOptions = {
  width: COMMISSIONED_CANVAS,
  height: COMMISSIONED_CANVAS,
  box: { x0: 40, y0: 40, x1: 215, y1: 215 },
};

/** Writes a fixture, hands its path to the assertion, and removes it either way. */
function withFixture(name: string, options: RgbaPngOptions, assert: (path: string) => void): void {
  const path = join(SCRATCH, `noorlife-optical-${name}.png`);
  writeFileSync(path, syntheticRgbaPng(options));
  try {
    assert(path);
  } finally {
    unlinkSync(path);
  }
}

describe('inspectOpticalBounds measures where the ink is', () => {
  it('reports the visible box, its margins and its centre', () => {
    withFixture('good', GOOD, (path) => {
      const optical = inspectOpticalBounds(path);
      expect(optical.canvas).toBe(256);
      expect(optical.boxWidth).toBe(176);
      expect(optical.boxHeight).toBe(176);
      expect(optical.boxRatio).toBeCloseTo(176 / 256, 6);
      expect(optical.margins).toEqual([40, 40, 40, 40]);
      expect(optical.minMargin).toBe(40);
      expect(optical.centreOffset).toBeCloseTo(0, 6);
    });
  });

  it('measures each side separately, so one tight edge cannot hide behind three loose ones', () => {
    /* Shifted 25 px right: 65 px of margin on the left, 15 px on the right. */
    withFixture('lopsided', { ...GOOD, box: { x0: 65, y0: 40, x1: 240, y1: 215 } }, (path) => {
      const optical = inspectOpticalBounds(path);
      expect(optical.margins).toEqual([65, 40, 15, 40]);
      expect(optical.minMargin).toBe(15);
    });
  });

  it('counts a barely-visible pixel as visible', () => {
    /*
      `alphaFloor` defaults to 0. An icon whose outermost ink is at alpha 1/255 has ink there, and the
      two Finance masters that were rejected in #68 each carried exactly one such pixel in a corner.
      Treating faint as absent is how that defect would have passed.
    */
    const bytes = syntheticRgbaPng(GOOD);
    const path = join(SCRATCH, 'noorlife-optical-faint.png');
    writeFileSync(path, bytes);
    try {
      const strict = inspectOpticalBounds(path, 0);
      const lenient = inspectOpticalBounds(path, 200);
      expect(strict.boxWidth).toBe(176);
      /* Same box either way here, because the fixture's mark is fully opaque — the floor is what
         differs, and this pins that a raised floor is a deliberate argument, never the default. */
      expect(lenient.boxWidth).toBe(176);
    } finally {
      unlinkSync(path);
    }
  });

  it('refuses to report bounds for an image with no visible pixels', () => {
    /* A fully transparent PNG has no box. Returning 0 × 0 would pass every rule below. */
    withFixture('empty', { ...GOOD, box: { x0: 1, y0: 1, x1: 0, y1: 0 } }, (path) => {
      expect(() => inspectOpticalBounds(path)).toThrow(/no visible pixels/i);
    });
  });
});

describe('commissionedAssetViolations accepts a compliant asset', () => {
  it('returns no reasons at all', () => {
    withFixture('compliant', GOOD, (path) => {
      expect(commissionedAssetViolations(path)).toEqual([]);
    });
  });
});

describe('commissionedAssetViolations names each way an asset can fail', () => {
  it('rejects the wrong canvas — the defect that shipped in Finance batch 1', () => {
    /* 512 × 512, and otherwise proportionally identical: 68.75% box, 80 px margins, centred. */
    withFixture(
      'canvas',
      { width: 512, height: 512, box: { x0: 80, y0: 80, x1: 431, y1: 431 } },
      (path) => {
        expect(commissionedAssetViolations(path)).toEqual(['canvas 512x512, expected 256 square']);
      },
    );
  });

  it('rejects a non-square canvas', () => {
    withFixture(
      'oblong',
      { width: 256, height: 200, box: { x0: 40, y0: 40, x1: 215, y1: 159 } },
      (path) => {
        expect(commissionedAssetViolations(path)).toContain('canvas 256x200, expected 256 square');
      },
    );
  });

  it('rejects RGB with no alpha channel — the white-rectangle-on-a-coloured-card defect', () => {
    withFixture('noalpha', { ...GOOD, noAlphaChannel: true }, (path) => {
      expect(commissionedAssetViolations(path)).toContain('colour type 2, expected 6 (RGBA)');
    });
  });

  it('rejects an unsupported bit depth', () => {
    withFixture('depth', { ...GOOD, bitDepth: 16 }, (path) => {
      expect(commissionedAssetViolations(path)).toContain('bit depth 16, expected 8');
    });
  });

  it('rejects an interlaced asset', () => {
    withFixture('interlaced', { ...GOOD, interlace: 1 }, (path) => {
      expect(commissionedAssetViolations(path)).toContain('interlaced');
    });
  });

  it('rejects opaque corners', () => {
    withFixture('corners', { ...GOOD, cornerColour: [10, 20, 30] }, (path) => {
      expect(commissionedAssetViolations(path)).toContain('corners are not fully transparent');
    });
  });

  it('names a near-white opaque corner as a flattened background, not merely as opaque', () => {
    /*
      Two reasons, deliberately. "Not transparent" is the condition; "appears flattened onto a
      background" is the diagnosis, and it is the one that tells an illustrator what to re-export.
    */
    withFixture('whitebox', { ...GOOD, cornerColour: [255, 255, 255] }, (path) => {
      const reasons = commissionedAssetViolations(path);
      expect(reasons).toContain('corners are not fully transparent');
      expect(reasons).toContain(
        'opaque near-white corner: artwork appears flattened onto a background',
      );
    });
  });

  it('rejects authoring metadata', () => {
    /* Any of the five. Each can carry a tool, a timestamp or a person's name into the bundle. */
    withFixture('metadata', { ...GOOD, extraChunks: ['tEXt', 'eXIf'] }, (path) => {
      expect(commissionedAssetViolations(path)).toContain('metadata chunks present: tEXt, eXIf');
    });
  });

  it('rejects an optical box over the ceiling', () => {
    /* 224/256 = 87.5%, above 85%. Margins are 16 px, so the margin rule fires too — stated, not hidden. */
    withFixture('toobig', { ...GOOD, box: { x0: 16, y0: 16, x1: 239, y1: 239 } }, (path) => {
      const reasons = commissionedAssetViolations(path);
      expect(reasons).toContain('optical box 87.5% exceeds 85%');
      expect(reasons).toContain(
        `safety margin 16px below ${MIN_SAFETY_MARGIN_PX}px on at least one side`,
      );
    });
  });

  it('rejects a thin safety margin without the box rule firing — the staged Planner defect', () => {
    /*
      `planner-today` is 256² with a 5 px margin. Its *box* is 246/256 = 96%, so both rules fire on
      the real asset. Here the two are separated on purpose: a 176 px mark pushed into the corner has
      a compliant 68.75% box and a 5 px margin, which proves the margin rule is doing its own work
      rather than riding along behind the ratio.
    */
    withFixture('thinmargin', { ...GOOD, box: { x0: 5, y0: 5, x1: 180, y1: 180 } }, (path) => {
      const reasons = commissionedAssetViolations(path);
      expect(reasons).toContain(
        `safety margin 5px below ${MIN_SAFETY_MARGIN_PX}px on at least one side`,
      );
      expect(reasons.some((reason) => reason.startsWith('optical box'))).toBe(false);
      expect(reasons.some((reason) => reason.startsWith('optical centre'))).toBe(true);
    });
  });

  it('rejects a mark placed off centre', () => {
    /*
      A 156 px mark shifted 10 px right and down: 60.9% box and a 40 px minimum margin, both well
      inside their rules, with an optical centre 14.1 px off. The centre rule is the only one that
      can catch this, and the single-element list is what proves it did so on its own.
    */
    withFixture('offcentre', { ...GOOD, box: { x0: 60, y0: 60, x1: 215, y1: 215 } }, (path) => {
      /* hypot(10, 10) = 14.142…, reported to one decimal. A single exact reason, so nothing else
         fires and the number itself is pinned. */
      expect(commissionedAssetViolations(path)).toEqual([
        `optical centre 14.1px off canvas centre, tolerance ${MAX_CENTRE_OFFSET_PX}px`,
      ]);
    });
  });

  it('accepts the half-pixel residue an odd-sized box leaves', () => {
    /*
      A 177 px mark — odd, so it cannot sit exactly on a 256 px canvas's centre of 127.5. Placed as
      well as it can be, it is 0.71 px off, and that is the only slack the 1 px tolerance grants. A
      4 px misplacement, which the original 8 px tolerance waved through, now fails.
    */
    withFixture('odd', { ...GOOD, box: { x0: 40, y0: 40, x1: 216, y1: 216 } }, (path) => {
      const optical = inspectOpticalBounds(path);
      expect(optical.boxWidth).toBe(177);
      expect(optical.centreOffset).toBeCloseTo(Math.hypot(0.5, 0.5), 6);
      expect(commissionedAssetViolations(path)).toEqual([]);
    });

    withFixture('nudged', { ...GOOD, box: { x0: 44, y0: 44, x1: 219, y1: 219 } }, (path) => {
      expect(commissionedAssetViolations(path)).toEqual([
        `optical centre 5.7px off canvas centre, tolerance ${MAX_CENTRE_OFFSET_PX}px`,
      ]);
    });
  });
});

describe('the contract constants are the approved numbers', () => {
  it('matches what Main Home was normalised to', () => {
    /*
      Not decoration. These four values came from `module-pictograms.ts`, which records the approved
      Main Home normalisation: a transparent 256 × 256 canvas, the largest bounding box at 85%, and a
      transparent safety margin on every side. Pinning them here means a future batch cannot quietly
      relax the standard by editing a constant and re-running a green suite.
    */
    expect(COMMISSIONED_CANVAS).toBe(256);
    expect(MAX_OPTICAL_BOX_RATIO).toBe(0.85);
    expect(MIN_SAFETY_MARGIN_PX).toBe(19);
    expect(MAX_CENTRE_OFFSET_PX).toBe(1);

    /* 19 px is what a mark at exactly the 85% ceiling leaves behind on each side. */
    expect(Math.floor((COMMISSIONED_CANVAS * (1 - MAX_OPTICAL_BOX_RATIO)) / 2)).toBe(
      MIN_SAFETY_MARGIN_PX,
    );
  });
});
