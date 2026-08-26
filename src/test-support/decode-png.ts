import { inflateSync } from 'node:zlib';

/**
 * A minimal PNG decoder, for asserting things about shipped raster assets.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * The selector thumbnails were twice accepted on evidence that could not see the defect. The first
 * report measured the *wrapper* bounds and concluded the row was centred; it was, and the beads
 * inside the wrappers were not. Nothing short of reading the pixels can tell a centred control from
 * a centred picture inside it, so the bytes are read here.
 *
 * Supports 8-bit RGB, RGBA and indexed-palette (with optional `tRNS`) PNGs, non-interlaced.
 * Anything else throws rather than being silently mishandled: a decoder that guessed at a bit depth
 * or de-interlaced by eye would produce confident numbers about the wrong pixels.
 *
 * ── Why palette support was added ───────────────────────────────────────────
 * All fifteen legacy Faith pictograms are indexed-palette PNGs, so before issue #70 this decoder
 * threw on every one of them and their optical bounds could not be audited at all. Reading them is
 * strictly additive: their bytes are never rewritten, and being able to *read* palette encoding does
 * not make it acceptable for a *new* commission. That line is drawn in
 * `commissionedAssetViolations`, which requires colour type 6 — not here.
 */

export type DecodedPng = {
  readonly width: number;
  readonly height: number;
  /** 3 for RGB, 4 for RGBA. */
  readonly channels: number;
  readonly data: Buffer;
};

export function decodePng(buf: Buffer): DecodedPng {
  if (buf.slice(1, 4).toString('latin1') !== 'PNG') {
    throw new Error('not a PNG');
  }
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  const bitDepth = buf[24] ?? 0;
  const colorType = buf[25] ?? 0;
  const interlace = buf[28] ?? 0;
  const paletted = colorType === 3;
  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6 && !paletted) || interlace !== 0) {
    throw new Error(`unsupported PNG: depth ${bitDepth}, colorType ${colorType}`);
  }

  const parts: Buffer[] = [];
  /** Palette entries, three bytes each. Colour type 3 only. */
  let palette: Buffer | null = null;
  /** Per-entry alpha, one byte each. May be shorter than the palette (§11.3.2). */
  let transparency: Buffer | null = null;
  let offset = 8;
  while (offset < buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.slice(offset + 4, offset + 8).toString('latin1');
    if (type === 'IDAT') {
      parts.push(buf.slice(offset + 8, offset + 8 + length));
    }
    if (type === 'PLTE') {
      palette = buf.slice(offset + 8, offset + 8 + length);
    }
    if (type === 'tRNS') {
      transparency = buf.slice(offset + 8, offset + 8 + length);
    }
    if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(parts));

  /*
    A palette image stores one *index* per pixel, so unfiltering runs at one byte per pixel and the
    expansion to RGBA happens afterwards. Filtering at 3 or 4 would read neighbours that do not
    exist and produce plausible noise instead of an error.
  */
  const channels = paletted ? 1 : colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const data = Buffer.alloc(height * stride);
  let pos = 0;

  for (let y = 0; y < height; y += 1) {
    const filter = raw[pos] ?? 0;
    pos += 1;
    const line = raw.slice(pos, pos + stride);
    pos += stride;
    const rowStart = y * stride;

    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? (data[rowStart + x - channels] ?? 0) : 0;
      const up = y > 0 ? (data[rowStart - stride + x] ?? 0) : 0;
      const upLeft = x >= channels && y > 0 ? (data[rowStart - stride + x - channels] ?? 0) : 0;
      const value = line[x] ?? 0;

      let restored: number;
      switch (filter) {
        case 0:
          restored = value;
          break;
        case 1:
          restored = value + left;
          break;
        case 2:
          restored = value + up;
          break;
        case 3:
          restored = value + ((left + up) >> 1);
          break;
        case 4: {
          const estimate = left + up - upLeft;
          const dLeft = Math.abs(estimate - left);
          const dUp = Math.abs(estimate - up);
          const dUpLeft = Math.abs(estimate - upLeft);
          restored =
            value + (dLeft <= dUp && dLeft <= dUpLeft ? left : dUp <= dUpLeft ? up : upLeft);
          break;
        }
        default:
          throw new Error(`unknown PNG filter ${filter} on row ${y}`);
      }
      data[rowStart + x] = restored & 0xff;
    }
  }

  if (!paletted) {
    return { width, height, channels, data };
  }

  if (palette === null) {
    /*
      Honest failure. A colour-type-3 image with no PLTE is malformed, and inventing a greyscale
      ramp would report confident numbers about the wrong pixels — the same reason an interlaced
      file throws above rather than being mishandled.
    */
    throw new Error('unsupported PNG: colorType 3 with no PLTE chunk');
  }
  if (palette.length % 3 !== 0) {
    throw new Error(`malformed PLTE: ${palette.length} bytes is not a whole number of entries`);
  }
  const entries = palette.length / 3;
  if (transparency !== null && transparency.length > entries) {
    throw new Error(`malformed tRNS: ${transparency.length} alphas for ${entries} palette entries`);
  }

  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0, j = 0; i < data.length; i += 1, j += 4) {
    const index = data[i] ?? 0;
    if (index >= entries) {
      throw new Error(`palette index ${index} out of range (${entries} entries)`);
    }
    const at = index * 3;
    rgba[j] = palette[at] ?? 0;
    rgba[j + 1] = palette[at + 1] ?? 0;
    rgba[j + 2] = palette[at + 2] ?? 0;
    /*
      §11.3.2: tRNS may be shorter than the palette, and the entries it omits are fully opaque. A
      missing tRNS altogether means an opaque image — legal, and not the same thing as malformed.
    */
    rgba[j + 3] = transparency === null ? 255 : (transparency[index] ?? 255);
  }
  return { width, height, channels: 4, data: rgba };
}

export function pixelAt(png: DecodedPng, x: number, y: number): readonly [number, number, number] {
  const i = (y * png.width + x) * png.channels;
  return [png.data[i] ?? 0, png.data[i + 1] ?? 0, png.data[i + 2] ?? 0];
}

export type BeadFit = {
  /** Diameter in pixels, measured across the sphere's equator. */
  readonly diameter: number;
  readonly centreX: number;
  readonly centreY: number;
};

/**
 * Fits the visible bead in a selector thumbnail.
 *
 * ── Why the equator, and not a bounding box ─────────────────────────────────
 * Each bead is photographed with a soft contact shadow beneath it and a faint halo around it. A
 * plain bounding box swallows both: measured that way the beads came out 218–256 px across in a
 * 256 px canvas, with the "bead" apparently touching three edges. Reading the widest row inside a
 * band across the sphere's middle ignores the shadow entirely, and the vertical extent is then taken
 * down the bead's own centre column, which the shadow does not widen.
 *
 * `tolerance` is per material because white jade is a near-white sphere on a near-white ground; at
 * the threshold that suits the other five, its edge is not found at all.
 */
export function fitBead(png: DecodedPng, tolerance: number): BeadFit {
  const background = pixelAt(png, 3, 3);
  const differs = (x: number, y: number): boolean => {
    const p = pixelAt(png, x, y);
    return (
      Math.max(
        Math.abs(p[0] - background[0]),
        Math.abs(p[1] - background[1]),
        Math.abs(p[2] - background[2]),
      ) > tolerance
    );
  };

  const bandTop = Math.round(png.height * 0.37);
  const bandBottom = Math.round(png.height * 0.63);
  let widest = { width: 0, x0: 0, x1: 0 };

  for (let y = bandTop; y <= bandBottom; y += 1) {
    let x0 = -1;
    let x1 = -1;
    for (let x = 0; x < png.width; x += 1) {
      if (differs(x, y)) {
        if (x0 < 0) x0 = x;
        x1 = x;
      }
    }
    if (x0 >= 0 && x1 - x0 + 1 > widest.width) {
      widest = { width: x1 - x0 + 1, x0, x1 };
    }
  }

  const centreX = (widest.x0 + widest.x1) / 2;
  const column = Math.round(centreX);
  let top = -1;
  for (let y = 0; y < png.height; y += 1) {
    if (differs(column, y)) {
      top = y;
      break;
    }
  }

  return { diameter: widest.width, centreX, centreY: top + widest.width / 2 };
}
