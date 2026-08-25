import { deflateSync } from 'node:zlib';

/**
 * Builds genuinely decodable PNGs — indexed palette and RGBA — for testing the asset rules.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Why this exists rather than reusing `syntheticPng` ──────────────────────
 * `syntheticPng` in `raster-icon-contract.ts` builds a *header* — an IHDR, optional marker chunks and
 * an IEND, with four zero bytes standing in for each CRC. That is exactly right for testing
 * `inspectRasterIcon`, which reads structure and never inflates. It cannot be decoded, so it cannot
 * test a decoder.
 *
 * ── Why synthetic rather than the Faith files ───────────────────────────────
 * The fifteen legacy Faith pictograms are the *reason* palette decoding exists, and they are asserted
 * against directly elsewhere. What they cannot do is fail: they are all well-formed, so decoding them
 * proves the happy path and nothing about a malformed `tRNS`, an out-of-range index or a missing
 * PLTE. Deliberately broken fixtures are the only way to prove the decoder refuses rather than
 * guesses, and building them here means never writing a corrupt PNG into the repository to do it.
 *
 * The RGBA builder is here for the same reason, one rule further on: the optical contract is about
 * where the ink sits, and proving it rejects a 5 px margin or an off-centre mark needs a real image
 * with real alpha. Committing nine deliberately-wrong PNGs to assert against would put nine wrong
 * PNGs in the bundle, which is the defect the contract exists to catch.
 *
 * Every fixture is deterministic: fixed dimensions, fixed palette, filter 0 on every row.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = ((): Int32Array => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) === 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buf) {
    c = (CRC_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, body: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'latin1'), body])), 0);
  return Buffer.concat([head, body, crc]);
}

export type PalettePngOptions = {
  readonly width: number;
  readonly height: number;
  /** Palette entries as RGB triples. */
  readonly palette: readonly (readonly [number, number, number])[];
  /**
   * Per-entry alpha. Omit for no `tRNS` chunk at all, which is a legal fully-opaque palette image.
   * May legally be shorter than the palette; the entries it omits are opaque.
   */
  readonly transparency?: readonly number[];
  /** One palette index per pixel, row-major. */
  readonly indices: readonly number[];
  /** Drops the PLTE chunk, making the file malformed. */
  readonly omitPalette?: boolean;
  /** Appends a stray byte to PLTE so its length is not a whole number of entries. */
  readonly truncatePalette?: boolean;
};

export function syntheticPalettePng(options: PalettePngOptions): Buffer {
  const { width, height, palette, transparency, indices } = options;

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 3; // colour type: indexed palette
  // Compression 0, filter method 0, interlace 0 — already zero from `alloc`.

  const plte = Buffer.from(palette.flatMap((entry) => [...entry]));

  /* Filter 0 on every scanline, so the fixture's bytes are readable in a hex dump. */
  const raw = Buffer.alloc(height * (width + 1));
  for (let y = 0; y < height; y += 1) {
    raw[y * (width + 1)] = 0;
    for (let x = 0; x < width; x += 1) {
      raw[y * (width + 1) + 1 + x] = indices[y * width + x] ?? 0;
    }
  }

  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', ihdr),
    ...(options.omitPalette === true
      ? []
      : [
          chunk(
            'PLTE',
            options.truncatePalette === true ? Buffer.concat([plte, Buffer.from([0x00])]) : plte,
          ),
        ]),
    ...(transparency === undefined ? [] : [chunk('tRNS', Buffer.from([...transparency]))]),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export type RgbaPngOptions = {
  readonly width: number;
  readonly height: number;
  /**
   * Fills one axis-aligned opaque rectangle, in inclusive pixel coordinates. Everything outside it is
   * transparent black. A rectangle is enough: every optical rule is about a bounding box, and a
   * rectangle *is* its own bounding box, so the expected numbers are arithmetic rather than measured.
   */
  readonly box: {
    readonly x0: number;
    readonly y0: number;
    readonly x1: number;
    readonly y1: number;
  };
  /** Colour of the filled rectangle. Defaults to an unremarkable mid-blue. */
  readonly colour?: readonly [number, number, number];
  /** Paints all four corners this opaque colour, for the flattened-onto-a-background case. */
  readonly cornerColour?: readonly [number, number, number];
  /** Ancillary chunk types to append before IEND, e.g. `['tEXt']`. */
  readonly extraChunks?: readonly string[];
  /** Overrides the IHDR bit depth *after* the pixels are written, to fake an unsupported depth. */
  readonly bitDepth?: number;
  /** Sets the IHDR interlace byte. */
  readonly interlace?: number;
  /** Writes colour type 2 (RGB, no alpha) instead of 6, keeping three channels of pixel data. */
  readonly noAlphaChannel?: boolean;
};

export function syntheticRgbaPng(options: RgbaPngOptions): Buffer {
  const { width, height, box } = options;
  const colour = options.colour ?? ([60, 110, 200] as const);
  const channels = options.noAlphaChannel === true ? 3 : 4;

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = options.bitDepth ?? 8;
  ihdr[9] = options.noAlphaChannel === true ? 2 : 6;
  ihdr[12] = options.interlace ?? 0;

  const stride = width * channels;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    for (let x = 0; x < width; x += 1) {
      const inside = x >= box.x0 && x <= box.x1 && y >= box.y0 && y <= box.y1;
      const isCorner =
        options.cornerColour !== undefined &&
        (x === 0 || x === width - 1) &&
        (y === 0 || y === height - 1);
      const at = y * (stride + 1) + 1 + x * channels;
      const fill = isCorner ? options.cornerColour : inside ? colour : undefined;
      if (fill !== undefined) {
        raw[at] = fill[0];
        raw[at + 1] = fill[1];
        raw[at + 2] = fill[2];
        if (channels === 4) {
          raw[at + 3] = 255;
        }
      } else if (channels === 4) {
        /* Transparent black: already zero, stated for the reader rather than written again. */
        raw[at + 3] = 0;
      }
    }
  }

  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', ihdr),
    ...(options.extraChunks ?? []).map((type) => chunk(type, Buffer.from('x', 'latin1'))),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
