// Minimal PNG codec for the forge's indexed atlases (ASSET_PIPELINE §9.2: colour type 3, bit depth 8,
// PLTE + tRNS, non-interlaced), so Node-side tests and tools can read `public/assets/atlas/*.png` as RGBA8
// exactly as a browser decodes it, without a PNG dependency. It also reads 8-bit RGB/RGBA (browser
// screenshots) and encodes RGBA8 (colour type 6) for fixtures and evidence sheets.
import { deflateSync, inflateSync } from 'node:zlib';
import type { RgbaImage } from '../../src/render/spriteAtlas.ts';

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

function readU32(bytes: Uint8Array, offset: number): number {
  return (
    (((bytes[offset] ?? 0) << 24) |
      ((bytes[offset + 1] ?? 0) << 16) |
      ((bytes[offset + 2] ?? 0) << 8) |
      (bytes[offset + 3] ?? 0)) >>>
    0
  );
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/** Reverses the per-row PNG filters in place order; returns the raw scanlines without filter bytes. */
function unfilter(data: Uint8Array, width: number, height: number, bytesPerPixel: number): Uint8Array {
  const stride = width * bytesPerPixel;
  const out = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = data[y * (stride + 1)] ?? 0;
    const src = y * (stride + 1) + 1;
    const row = y * stride;
    for (let i = 0; i < stride; i++) {
      const raw = data[src + i] ?? 0;
      const a = i >= bytesPerPixel ? (out[row + i - bytesPerPixel] ?? 0) : 0;
      const b = y > 0 ? (out[row - stride + i] ?? 0) : 0;
      const c = y > 0 && i >= bytesPerPixel ? (out[row - stride + i - bytesPerPixel] ?? 0) : 0;
      let value: number;
      if (filter === 0) value = raw;
      else if (filter === 1) value = raw + a;
      else if (filter === 2) value = raw + b;
      else if (filter === 3) value = raw + ((a + b) >> 1);
      else if (filter === 4) value = raw + paeth(a, b, c);
      else throw new Error(`PNG: unknown filter ${filter} on row ${y}`);
      out[row + i] = value & 0xff;
    }
  }
  return out;
}

/** Decodes an 8-bit RGB (2), indexed (3) or RGBA (6) non-interlaced PNG to RGBA8. */
export function decodePng(bytes: Uint8Array): RgbaImage {
  if (!SIGNATURE.every((v, i) => bytes[i] === v)) throw new Error('PNG: bad signature');
  let offset = 8;
  let width = 0;
  let height = 0;
  let colourType = -1;
  let palette: Uint8Array = new Uint8Array(0);
  let alpha: Uint8Array = new Uint8Array(0);
  const idat: Uint8Array[] = [];
  while (offset < bytes.length) {
    const length = readU32(bytes, offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    const body = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = readU32(body, 0);
      height = readU32(body, 4);
      colourType = body[9] ?? -1;
      if (body[8] !== 8 || body[12] !== 0 || (colourType !== 2 && colourType !== 3 && colourType !== 6)) {
        throw new Error('PNG: only 8-bit RGB, indexed or RGBA, non-interlaced, is supported');
      }
    } else if (type === 'PLTE') palette = body;
    else if (type === 'tRNS') alpha = body;
    else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    offset += 12 + length;
  }
  const bpp = colourType === 3 ? 1 : colourType === 2 ? 3 : 4;
  const raw = unfilter(inflateSync(Buffer.concat(idat)), width, height, bpp);
  if (colourType === 6) return { width, height, data: raw };
  if (colourType === 2) {
    const data = new Uint8Array(width * height * 4);
    for (let p = 0; p < width * height; p++) {
      data.set(raw.subarray(p * 3, p * 3 + 3), p * 4);
      data[p * 4 + 3] = 255;
    }
    return { width, height, data };
  }
  const data = new Uint8Array(width * height * 4);
  for (let p = 0; p < width * height; p++) {
    const entry = raw[p] ?? 0;
    data[p * 4] = palette[entry * 3] ?? 0;
    data[p * 4 + 1] = palette[entry * 3 + 1] ?? 0;
    data[p * 4 + 2] = palette[entry * 3 + 2] ?? 0;
    data[p * 4 + 3] = entry < alpha.length ? (alpha[entry] ?? 255) : 255;
  }
  return { width, height, data };
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = (CRC_TABLE[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, body: Uint8Array): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, crc]);
}

/** Encodes RGBA8 as a colour-type-6 PNG (filter 0 on every row). For test fixtures. */
export function encodeRgbaPng(image: RgbaImage): Uint8Array {
  const { width, height, data } = image;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const scanlines = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    Buffer.from(data.buffer, data.byteOffset + y * width * 4, width * 4).copy(
      scanlines,
      y * (width * 4 + 1) + 1,
    );
  }
  return Buffer.concat([
    Buffer.from(SIGNATURE),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(scanlines)),
    chunk('IEND', new Uint8Array(0)),
  ]);
}
