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
 * Supports exactly what the Faith assets are delivered in — 8-bit RGB or RGBA, non-interlaced.
 * Anything else throws rather than being silently mishandled: a decoder that guessed at a palette
 * would produce confident numbers about the wrong pixels.
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
  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6) || interlace !== 0) {
    throw new Error(`unsupported PNG: depth ${bitDepth}, colorType ${colorType}`);
  }

  const parts: Buffer[] = [];
  let offset = 8;
  while (offset < buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.slice(offset + 4, offset + 8).toString('latin1');
    if (type === 'IDAT') {
      parts.push(buf.slice(offset + 8, offset + 8 + length));
    }
    if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(parts));

  const channels = colorType === 6 ? 4 : 3;
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

  return { width, height, channels, data };
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
