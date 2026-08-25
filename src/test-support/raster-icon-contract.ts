import { readFileSync } from 'node:fs';

import { decodePng } from './decode-png';

/**
 * The contract every commissioned raster icon must satisfy, as one reusable check.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Why this is shared rather than per-batch ─────────────────────────────────
 * Eight asset batches are planned. Checked by eye, or by a fresh assertion written per batch, they
 * will drift: the batch somebody was in a hurry for is the one that ships a white-boxed PNG with the
 * illustrator's name in a `tEXt` chunk. One validator means a batch either satisfies the same rules
 * as Faith's did or fails.
 *
 * ── Why it reads bytes rather than trusting the file name ───────────────────
 * Every property below is invisible in a file listing and fatal on screen. A PNG with no alpha
 * channel renders a white rectangle behind the artwork on a coloured card. A `.png` that is actually
 * a JPEG loads on one platform and not the other. Metadata chunks carry the authoring tool, the
 * timestamp and sometimes a person's name into the shipped app.
 *
 * `decode-png.ts` already reads headers and pixels for Faith's audits, so the pixel work is reused
 * from there rather than re-implemented; what is added here is the header, alpha, corner and
 * metadata contract, plus the static-resolvability rule that keeps Metro able to see the asset.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** PNG's eight-byte signature (§5.2 of the specification). */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Chunks that may carry authoring provenance into the bundle.
 *
 * Text in any of its three forms, EXIF, and the timestamp. None affects rendering, all of them
 * travel, and `eXIf` in particular can carry a camera, a location or a copyright line that nobody
 * reviewing a picture of an icon would think to look for.
 */
const FORBIDDEN_CHUNKS = ['tEXt', 'iTXt', 'zTXt', 'eXIf', 'tIME'] as const;

/** PNG colour types that include an alpha channel: greyscale+alpha and truecolour+alpha. */
const ALPHA_COLOUR_TYPES = new Set([4, 6]);

/** Indexed palette. Carries transparency through `tRNS` rather than through a channel. */
const PALETTE_COLOUR_TYPE = 3;

export type RasterIconReport = {
  readonly width: number;
  readonly height: number;
  readonly bitDepth: number;
  readonly colourType: number;
  /** True for colour types 4 and 6 — a real alpha *channel*. Palette `tRNS` is reported separately. */
  readonly hasAlpha: boolean;
  /**
   * True for an indexed-palette image carrying a `tRNS` chunk — issue #70.
   *
   * Kept distinct from `hasAlpha` on purpose. Both mean "this image has transparency", and only one
   * of them is acceptable for newly commissioned artwork, so collapsing them into a single boolean is
   * how a palette asset would eventually pass a batch check that only asked whether alpha existed.
   */
  readonly paletteTransparency: boolean;
  readonly interlaced: boolean;
  /** Every chunk type present, in file order, so a caller can assert on absence. */
  readonly chunks: readonly string[];
  readonly forbiddenChunks: readonly string[];
  /** True when all four corner pixels are fully transparent. */
  readonly transparentCorners: boolean;
  /** True when any corner is opaque and near-white — the classic exported-with-a-background defect. */
  readonly whiteBoxCorner: boolean;
};

/**
 * Reads a PNG's structure without inflating the image data.
 *
 * Header fields come from the IHDR at a fixed offset; the chunk walk is needed for the metadata
 * rule. Corner transparency does require pixels, so that is delegated.
 *
 * @throws if the file is missing, is not a PNG, or is interlaced — each of which is a defect rather
 *   than a variation to tolerate. A validator that shrugged at an unreadable asset would report the
 *   absence of problems it never looked for.
 */
export function inspectRasterIcon(absolutePath: string): RasterIconReport {
  return inspectRasterIconBuffer(readFileSync(absolutePath), absolutePath);
}

/**
 * The same contract, over bytes already in hand.
 *
 * Separated so the rejection cases can be proven against buffers assembled in memory. A validator
 * whose failure paths are only exercised by real files can only be tested by committing broken
 * assets, which is the one thing it exists to prevent.
 */
export function inspectRasterIconBuffer(buf: Buffer, label = '<buffer>'): RasterIconReport {
  if (!buf.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error(`not a PNG: ${label}`);
  }

  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  const bitDepth = buf[24] ?? 0;
  const colourType = buf[25] ?? 0;
  const interlaced = (buf[28] ?? 0) !== 0;

  const chunks: string[] = [];
  let offset = 8;
  while (offset + 8 <= buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.subarray(offset + 4, offset + 8).toString('latin1');
    chunks.push(type);
    if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }

  const hasAlpha = ALPHA_COLOUR_TYPES.has(colourType);
  const paletteTransparency = colourType === PALETTE_COLOUR_TYPE && chunks.includes('tRNS');
  const corners =
    (hasAlpha || paletteTransparency) && !interlaced
      ? cornerAlpha(buf, width, height, colourType, bitDepth)
      : null;

  return {
    width,
    height,
    bitDepth,
    colourType,
    hasAlpha,
    paletteTransparency,
    interlaced,
    chunks,
    forbiddenChunks: chunks.filter((type) =>
      (FORBIDDEN_CHUNKS as readonly string[]).includes(type),
    ),
    transparentCorners: corners?.allTransparent ?? false,
    whiteBoxCorner: corners?.anyWhiteOpaque ?? false,
  };
}

/**
 * Corner evidence, from the decoded pixels.
 *
 * The corners and not a full histogram: an icon drawn to sit on a coloured card must be transparent
 * where it does not draw, and the four extremes are where an accidental exported background shows
 * first and most visibly. A near-white opaque corner is reported separately from "not transparent",
 * because it names the specific defect — artwork flattened onto a white canvas — rather than the
 * general condition.
 */
function cornerAlpha(
  buf: Buffer,
  width: number,
  height: number,
  colourType: number,
  bitDepth: number,
): { allTransparent: boolean; anyWhiteOpaque: boolean } | null {
  if (bitDepth !== 8 || (colourType !== 6 && colourType !== PALETTE_COLOUR_TYPE)) {
    /*
      Only 8-bit RGBA and 8-bit indexed palette are read here. Greyscale+alpha also carries alpha and
      is accepted by the header rule above; it is simply not a format this project's assets are
      delivered in, so rather than guess at its layout the corner evidence is reported as unavailable.

      Palette is read because the legacy Faith pictograms are palette PNGs and they do have exactly
      transparent corners — issue #70. Reporting `transparentCorners: false` about an image whose
      corners are transparent is not a safe default, it is a false statement that a later audit would
      act on. Being able to read them changes nothing about what a *new* commission may be encoded
      as; `commissionedAssetViolations` requires colour type 6 by name.
    */
    return null;
  }

  let png;
  try {
    png = decodePng(buf);
  } catch {
    /*
      Header-valid and pixel-unreadable. Truncated, missing its image data, or in a variant the
      decoder does not support.

      Reported as *corner evidence unavailable* rather than thrown, and the caller then sees
      `transparentCorners: false` — which fails the corner assertion. That is the safe direction: an
      asset whose pixels cannot be read does not get to pass the transparency check by default, and it
      is distinguishable from a genuine white box because `whiteBoxCorner` stays false too.
    */
    return null;
  }
  const at = (x: number, y: number): readonly [number, number, number, number] => {
    const index = (y * png.width + x) * png.channels;
    return [
      png.data[index] ?? 0,
      png.data[index + 1] ?? 0,
      png.data[index + 2] ?? 0,
      png.channels === 4 ? (png.data[index + 3] ?? 0) : 255,
    ];
  };

  const corners = [at(0, 0), at(width - 1, 0), at(0, height - 1), at(width - 1, height - 1)];

  return {
    allTransparent: corners.every(([, , , alpha]) => alpha === 0),
    /* Opaque and near-white. 240 is well above any anti-aliased edge and below a true white card. */
    anyWhiteOpaque: corners.some(
      ([r, g, b, alpha]) => alpha > 250 && r > 240 && g > 240 && b > 240,
    ),
  };
}

/**
 * Brand terms that must not appear in a registry key or an asset path.
 *
 * Short, and about provenance rather than taste: an asset named after somebody else's product is
 * either their artwork or an imitation of it, and neither belongs in the bundle. The list is the
 * obvious offenders for an app of this kind; it is not a trademark search.
 */
export const FORBIDDEN_BRAND_TERMS: readonly string[] = [
  'google',
  'apple',
  'meta',
  'facebook',
  'instagram',
  'whatsapp',
  'twitter',
  'tiktok',
  'youtube',
  'microsoft',
  'amazon',
  'netflix',
  'spotify',
];

/** Whether a key or path is free of any forbidden brand term, case-insensitively. */
export function isBrandNeutral(keyOrPath: string): boolean {
  const lowered = keyOrPath.toLowerCase();
  return !FORBIDDEN_BRAND_TERMS.some((term) => lowered.includes(term));
}

/**
 * A synthetic PNG, for proving the validator rejects what it should.
 *
 * Built rather than committed. A test that needs a metadata-bearing, alpha-less or truncated asset
 * must not add one to the repository to get it: the bad file would then ship, and a future audit
 * would find it and be right to. So the malformed cases are assembled in memory.
 */
export function syntheticPng(options: {
  readonly width?: number;
  readonly height?: number;
  /** 2 = RGB (no alpha), 6 = RGBA. */
  readonly colourType?: 2 | 6;
  readonly signature?: Buffer;
  /** Extra chunk types to append before IEND, e.g. `['tEXt']`. */
  readonly extraChunks?: readonly string[];
}): Buffer {
  const width = options.width ?? 8;
  const height = options.height ?? 8;
  const colourType = options.colourType ?? 6;

  const ihdrBody = Buffer.alloc(13);
  ihdrBody.writeUInt32BE(width, 0);
  ihdrBody.writeUInt32BE(height, 4);
  ihdrBody[8] = 8;
  ihdrBody[9] = colourType;

  const chunk = (type: string, body: Buffer): Buffer => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(body.length, 0);
    head.write(type, 4, 'latin1');
    /* CRC is not validated by `inspectRasterIcon`, so four zero bytes stand in for it. */
    return Buffer.concat([head, body, Buffer.alloc(4)]);
  };

  return Buffer.concat([
    options.signature ?? PNG_SIGNATURE,
    chunk('IHDR', ihdrBody),
    ...(options.extraChunks ?? []).map((type) => chunk(type, Buffer.from('x', 'latin1'))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * The optical contract for **newly commissioned** raster artwork — issue #70.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Why bytes and headers were not enough ───────────────────────────────────
 * `inspectRasterIcon` checks the signature, the header, alpha, corner transparency and metadata.
 * Everything it looks at passed for Finance's first delivery, which nevertheless shipped at 512×512
 * instead of 256, and for a staged Planner asset whose safety margin was 5 px instead of 19. Neither
 * is visible in a header and both change how large an icon looks.
 *
 * So this adds the part that was missing: where the ink actually is on the canvas.
 *
 * ── The numbers, and where they come from ───────────────────────────────────
 * Not invented. `module-pictograms.ts` records the approved normalisation for Main Home — cropped to
 * visible bounds, rescaled and recentred on a transparent 256 × 256 canvas, largest bounding box at
 * 85%, every icon keeping a transparent safety margin. These are those rules, made checkable.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** The delivery canvas every newly commissioned asset is exported at. */
export const COMMISSIONED_CANVAS = 256;

/**
 * The most of the canvas the visible artwork may occupy, on its longer edge.
 *
 * 85% is Main Home's own ceiling. Above it an icon has no room to breathe beside its neighbours and
 * begins to look like a different size class rather than a bolder drawing.
 */
export const MAX_OPTICAL_BOX_RATIO = 0.85;

/** The transparent safety margin required on **every** side, in pixels at the delivery canvas. */
export const MIN_SAFETY_MARGIN_PX = 19;

/**
 * How far the optical centre may sit from the canvas centre, in pixels.
 *
 * 1 px, which in practice means *exactly* centred. A box of even width can land dead on the canvas
 * centre; a box of odd width cannot, and leaves half a pixel on one axis — hypot(0.5, 0.5) ≈ 0.71.
 * So 1 px admits the parity residue and nothing else.
 *
 * It was 8 px first, to accommodate the fact that a mechanically normalised asset centres its
 * *scaled* bounding box while the box that actually comes out is slightly smaller: area-average
 * downscaling rounds near-zero edge alpha to zero, asymmetrically for an asymmetric drawing.
 * Measured, three of the five Finance re-exports landed 8–10 px off. Widening the rule to fit them
 * would have been the wrong direction — the rule was right and the export was sloppy — so the
 * normaliser now measures the composed canvas and shifts it by whole pixels, which changes no pixel
 * value and redraws nothing. All five then centred within 0.71 px, and the rule could tighten to
 * what mechanical normalisation genuinely achieves.
 *
 * What it buys: an asset delivered straight from an illustrator with the mark off to one side fails
 * here. That is the `planner-today` class of defect, and at 8 px a 7 px misplacement passed.
 */
export const MAX_CENTRE_OFFSET_PX = 1;

export type OpticalReport = {
  readonly canvas: number;
  readonly boxWidth: number;
  readonly boxHeight: number;
  /** Longer edge of the visible box, as a fraction of the canvas. */
  readonly boxRatio: number;
  /** Smallest transparent margin across the four sides, in pixels. */
  readonly minMargin: number;
  readonly margins: readonly [number, number, number, number];
  /** Distance from the canvas centre to the optical centre, in pixels. */
  readonly centreOffset: number;
};

/**
 * Measures where the ink sits. Square canvases only, which every commissioned asset is.
 *
 * @param alphaFloor Alpha above which a pixel counts as visible. `0` by default, so nothing faint is
 *   ignored — an icon whose only content is barely-there should fail the box check, not pass it.
 */
export function inspectOpticalBounds(absolutePath: string, alphaFloor = 0): OpticalReport {
  // Local import keeps the module's single static dependency graph unchanged.
  const png = decodePng(readFileSync(absolutePath));
  const alphaAt = (x: number, y: number): number =>
    png.channels === 4 ? (png.data[(y * png.width + x) * png.channels + 3] ?? 0) : 255;

  let minX = png.width;
  let minY = png.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      if (alphaAt(x, y) > alphaFloor) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) {
    throw new Error(`no visible pixels: ${absolutePath}`);
  }

  const boxWidth = maxX - minX + 1;
  const boxHeight = maxY - minY + 1;
  const margins = [minX, minY, png.width - 1 - maxX, png.height - 1 - maxY] as const;
  const centre = (png.width - 1) / 2;
  const centreOffset = Math.hypot((minX + maxX) / 2 - centre, (minY + maxY) / 2 - centre);

  return {
    canvas: png.width,
    boxWidth,
    boxHeight,
    boxRatio: Math.max(boxWidth, boxHeight) / png.width,
    minMargin: Math.min(...margins),
    margins,
    centreOffset,
  };
}

/**
 * Every way a newly commissioned asset can fail the optical contract, as reasons.
 *
 * A list rather than a boolean so a failing batch says *which* rule it broke. An empty array is a
 * pass.
 */
export function commissionedAssetViolations(absolutePath: string): readonly string[] {
  const header = inspectRasterIcon(absolutePath);
  const reasons: string[] = [];

  if (header.width !== COMMISSIONED_CANVAS || header.height !== COMMISSIONED_CANVAS) {
    reasons.push(`canvas ${header.width}x${header.height}, expected ${COMMISSIONED_CANVAS} square`);
  }
  /*
    Colour type 6 specifically, not merely "carries alpha". Palette + `tRNS` also carries
    transparency and is how the legacy Faith pictograms are encoded; decoding those is supported, and
    that support must not become a licence for a new commission to arrive as an indexed palette.
  */
  if (header.colourType !== 6) {
    reasons.push(`colour type ${header.colourType}, expected 6 (RGBA)`);
  }
  if (header.bitDepth !== 8) {
    reasons.push(`bit depth ${header.bitDepth}, expected 8`);
  }
  if (header.interlaced) {
    reasons.push('interlaced');
  }
  if (!header.transparentCorners) {
    reasons.push('corners are not fully transparent');
  }
  if (header.whiteBoxCorner) {
    reasons.push('opaque near-white corner: artwork appears flattened onto a background');
  }
  if (header.forbiddenChunks.length > 0) {
    reasons.push(`metadata chunks present: ${header.forbiddenChunks.join(', ')}`);
  }

  /*
    An unreadable asset fails with a reason rather than throwing.

    `inspectOpticalBounds` has to inflate the image, so a 16-bit or interlaced PNG reaches it and
    throws — and a validator that crashes on the very files it exists to reject reports nothing at all
    about them. The header reasons above are already collected by this point, so the caller still gets
    "bit depth 16" *and* an honest note that the ink could not be located. Never an empty list.
  */
  let optical: OpticalReport;
  try {
    optical = inspectOpticalBounds(absolutePath);
  } catch (error) {
    reasons.push(
      `optical bounds unreadable: ${error instanceof Error ? error.message : String(error)}`,
    );
    return reasons;
  }

  if (optical.boxRatio > MAX_OPTICAL_BOX_RATIO) {
    reasons.push(
      `optical box ${(optical.boxRatio * 100).toFixed(1)}% exceeds ${MAX_OPTICAL_BOX_RATIO * 100}%`,
    );
  }
  if (optical.minMargin < MIN_SAFETY_MARGIN_PX) {
    reasons.push(
      `safety margin ${optical.minMargin}px below ${MIN_SAFETY_MARGIN_PX}px on at least one side`,
    );
  }
  if (optical.centreOffset > MAX_CENTRE_OFFSET_PX) {
    reasons.push(
      `optical centre ${optical.centreOffset.toFixed(1)}px off canvas centre, tolerance ${MAX_CENTRE_OFFSET_PX}px`,
    );
  }

  return reasons;
}
