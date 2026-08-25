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

export type RasterIconReport = {
  readonly width: number;
  readonly height: number;
  readonly bitDepth: number;
  readonly colourType: number;
  readonly hasAlpha: boolean;
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
  const corners =
    hasAlpha && !interlaced ? cornerAlpha(buf, width, height, colourType, bitDepth) : null;

  return {
    width,
    height,
    bitDepth,
    colourType,
    hasAlpha,
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
  if (bitDepth !== 8 || colourType !== 6) {
    /*
      Only 8-bit RGBA is read here. Greyscale+alpha also carries alpha and is accepted by the header
      rule above; it is simply not a format this project's assets are delivered in, so rather than
      guess at its layout the corner evidence is reported as unavailable.
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
