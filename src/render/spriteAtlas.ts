// Sprite atlas loading (TECHNICAL_DESIGN §12.5, ASSET_PIPELINE §9.3). An atlas is
// `public/assets/atlas/<name>.png` + `<name>.json`, fetched relative to `import.meta.env.BASE_URL`.
//
// The documented R8 index-texture path: at load, every pixel is turned into its Kerbside-32 index by an exact
// hex lookup, so the GPU texture holds indices, not colours. A pixel that is not exactly a Kerbside-32 colour,
// or that is semi-transparent, is a load-time error naming the atlas and the pixel. Fully transparent pixels
// become TRANSPARENT_INDEX (255), which the sprite shaders discard (binary alpha). The shaders then map the
// index through the instance's row of a 32×8 swap texture and look the result up in the palette texture.
//
// Swap tables (SSP-297): the atlas JSON `swaps` is parsed provisionally as an object of at most 8 tables keyed
// `slot_0`..`slot_7`, each `{ "<srcIndex>": dstIndex }` with both indices in 0..31. A missing slot, and every
// index a table does not name, is identity; slot 0 is always identity. Anything else (a 9th table, another key,
// an index outside 0..31, a non-identity slot 0) is a load-time error. The tables are authored in M4 (SSP-114),
// which may lock a different representation (named vs slot) and update this parser; until then `swaps` is {}
// and the swap texture is identity, so drawing through it is pixel-identical to drawing without it.
//
// The atlas JSON must agree with the generated FRAME table (src/gen/assets.ts) frame for frame: a mismatch
// means the generated code is stale, which is a load-time error too.
import { DataTexture, RedFormat, UnsignedByteType } from 'three';
import { FRAME, type FrameId } from '../gen/assets.ts';
import { KERBSIDE32, type Kerbside32, nearestDataTexture, PALETTE_SIZE } from './palettePass.ts';

/** Atlas names, derived from the generated table so only atlases that exist can be named. */
export type AtlasName = (typeof FRAME)[FrameId]['atlas'];

/** Index-texture value of a fully transparent pixel; the sprite shaders discard it. */
export const TRANSPARENT_INDEX = 255;

/** Swap tables per atlas (rows of the swap texture), TECHNICAL_DESIGN §12.5. */
export const SWAP_ROWS = 8;

/** A decoded image: RGBA8, rows top to bottom, no colour-space conversion and no premultiplied alpha. */
export type RgbaImage = {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array | Uint8ClampedArray;
};

/** A frame rect and pivot as stored in the atlas JSON (atlas pixels, pivot relative to the rect). */
export type AtlasFrameRect = {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly px: number;
  readonly py: number;
};

/** A loaded atlas: the R8 index data and its GPU textures. */
export type SpriteAtlas = {
  readonly name: AtlasName;
  readonly width: number;
  readonly height: number;
  /** One Kerbside-32 index per pixel (TRANSPARENT_INDEX for transparent), rows top to bottom. */
  readonly indices: Uint8Array;
  /** `indices` as an R8 texture: texelFetch(x, y) is atlas pixel (x, y), y down. */
  readonly texture: DataTexture;
  /** The 32×8 swap tables (`swapTexture` data): entry row * 32 + i is index i's replacement in table `row`. */
  readonly swaps: Uint8Array;
  /** 32×8 R8 swap texture: row k maps an index to its swap-table-k replacement (identity where unset). */
  readonly swapTexture: DataTexture;
};

/** Where an atlas comes from: injectable so tests can load fixtures without a browser. */
export type AtlasSource = {
  fetchJson(url: string): Promise<unknown>;
  fetchImage(url: string): Promise<RgbaImage>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function rgbKey(r: number, g: number, b: number): number {
  return (r << 16) | (g << 8) | b;
}

function hexOf(r: number, g: number, b: number): string {
  return rgbKey(r, g, b).toString(16).padStart(6, '0');
}

/**
 * Converts an atlas image to Kerbside-32 indices by exact colour lookup (the load-time palette check).
 * Throws, naming the atlas and the pixel, for a colour outside Kerbside-32 or an alpha other than 0 or 255.
 */
export function indexAtlasPixels(
  name: string,
  image: RgbaImage,
  palette: Kerbside32 = KERBSIDE32,
): Uint8Array {
  const { width, height, data } = image;
  if (data.length !== width * height * 4) {
    throw new Error(`atlas '${name}': image data is not ${width}x${height} RGBA8`);
  }
  const lookup = new Map<number, number>();
  for (let i = 0; i < PALETTE_SIZE; i++) {
    const o = i * 3;
    lookup.set(rgbKey(palette.rgb[o] ?? 0, palette.rgb[o + 1] ?? 0, palette.rgb[o + 2] ?? 0), i);
  }
  const indices = new Uint8Array(width * height);
  for (let p = 0; p < indices.length; p++) {
    const o = p * 4;
    const alpha = data[o + 3] ?? 0;
    if (alpha === 0) {
      indices[p] = TRANSPARENT_INDEX;
      continue;
    }
    const r = data[o] ?? 0;
    const g = data[o + 1] ?? 0;
    const b = data[o + 2] ?? 0;
    const x = p % width;
    const y = Math.floor(p / width);
    if (alpha !== 255) {
      throw new Error(`atlas '${name}': pixel (${x}, ${y}) is semi-transparent (alpha ${alpha})`);
    }
    const index = lookup.get(rgbKey(r, g, b));
    if (index === undefined) {
      throw new Error(`atlas '${name}': pixel (${x}, ${y}) colour ${hexOf(r, g, b)} is not in Kerbside-32`);
    }
    indices[p] = index;
  }
  return indices;
}

function isRect(value: unknown): value is AtlasFrameRect {
  if (!isRecord(value)) return false;
  return ['x', 'y', 'w', 'h', 'px', 'py'].every((k) => Number.isInteger(value[k]));
}

function isFrameId(id: string): id is FrameId {
  return Object.hasOwn(FRAME, id);
}

/**
 * Validates an atlas JSON document (`{ frames, swaps }`) against the generated FRAME table: the same frame IDs
 * for this atlas, with the same rects and pivots, all inside the image. `swaps` is checked by swapTableData.
 */
export function validateAtlasJson(name: AtlasName, data: unknown, width: number, height: number): void {
  if (!isRecord(data) || !isRecord(data.frames) || !isRecord(data.swaps)) {
    throw new Error(`atlas '${name}': JSON must be { frames, swaps }`);
  }
  const expected = new Set<string>();
  for (const id of Object.keys(FRAME)) {
    if (isFrameId(id) && FRAME[id].atlas === name) expected.add(id);
  }
  for (const [id, rect] of Object.entries(data.frames)) {
    if (!isFrameId(id) || !expected.delete(id)) {
      throw new Error(
        `atlas '${name}': frame ${id} is not in src/gen/assets.ts for this atlas (run npm run assets)`,
      );
    }
    const frame = FRAME[id];
    if (
      !isRect(rect) ||
      rect.x !== frame.x ||
      rect.y !== frame.y ||
      rect.w !== frame.w ||
      rect.h !== frame.h ||
      rect.px !== frame.px ||
      rect.py !== frame.py
    ) {
      throw new Error(`atlas '${name}': frame ${id} differs from src/gen/assets.ts (run npm run assets)`);
    }
    if (rect.x < 0 || rect.y < 0 || rect.x + rect.w > width || rect.y + rect.h > height) {
      throw new Error(`atlas '${name}': frame ${id} lies outside the ${width}x${height} image`);
    }
  }
  if (expected.size > 0) {
    throw new Error(
      `atlas '${name}': ${expected.size} frames of src/gen/assets.ts are missing from the JSON`,
    );
  }
}

/** Identity 32×8 swap table data: row k, column i holds i. */
export function identitySwapData(): Uint8Array {
  const data = new Uint8Array(PALETTE_SIZE * SWAP_ROWS);
  for (let row = 0; row < SWAP_ROWS; row++) {
    for (let i = 0; i < PALETTE_SIZE; i++) data[row * PALETTE_SIZE + i] = i;
  }
  return data;
}

const SLOT_KEY = /^slot_([0-7])$/;
const INDEX_KEY = /^(0|[1-9][0-9]?)$/;

/**
 * Builds the 32×8 swap table data from an atlas JSON `swaps` value (provisional slot form, see the file
 * header): identity everywhere except the entries the tables name. Throws, naming the atlas, for more than
 * SWAP_ROWS tables, a key other than `slot_0`..`slot_7`, a table that is not an object, a source or destination
 * index outside 0..31, or a slot 0 that is not identity.
 */
export function swapTableData(name: string, swaps: unknown): Uint8Array {
  if (!isRecord(swaps)) throw new Error(`atlas '${name}': swaps must be an object of swap tables`);
  const slots = Object.keys(swaps);
  if (slots.length > SWAP_ROWS) {
    throw new Error(`atlas '${name}': ${slots.length} swap tables, at most ${SWAP_ROWS} per atlas`);
  }
  const data = identitySwapData();
  for (const slot of slots) {
    const match = SLOT_KEY.exec(slot);
    if (match === null) {
      throw new Error(`atlas '${name}': swap table '${slot}' is not slot_0..slot_${SWAP_ROWS - 1}`);
    }
    const row = Number(match[1]);
    const table = swaps[slot];
    if (!isRecord(table)) throw new Error(`atlas '${name}': swap table ${slot} must be { "<src>": dst }`);
    for (const [src, dst] of Object.entries(table)) {
      const srcIndex = INDEX_KEY.test(src) ? Number(src) : -1;
      if (srcIndex < 0 || srcIndex >= PALETTE_SIZE) {
        throw new Error(
          `atlas '${name}': swap table ${slot} source index '${src}' is not 0..${PALETTE_SIZE - 1}`,
        );
      }
      if (typeof dst !== 'number' || !Number.isInteger(dst) || dst < 0 || dst >= PALETTE_SIZE) {
        throw new Error(
          `atlas '${name}': swap table ${slot} maps ${src} to ${String(dst)}, not an index 0..${PALETTE_SIZE - 1}`,
        );
      }
      if (row === 0 && dst !== srcIndex) {
        throw new Error(`atlas '${name}': swap table slot_0 must be identity (maps ${src} to ${dst})`);
      }
      data[row * PALETTE_SIZE + srcIndex] = dst;
    }
  }
  return data;
}

function r8Texture(data: Uint8Array, width: number, height: number): DataTexture {
  return nearestDataTexture(new DataTexture(data, width, height, RedFormat, UnsignedByteType));
}

/** URL of an atlas file, relative to the app base (`import.meta.env.BASE_URL`). */
export function atlasUrl(
  name: AtlasName,
  extension: 'png' | 'json',
  base: string = import.meta.env.BASE_URL,
): string {
  return `${base}assets/atlas/${name}.${extension}`;
}

/** Decodes a PNG in the browser with no colour-space conversion, so opaque pixels keep their exact bytes. */
async function decodePng(blob: Blob): Promise<RgbaImage> {
  const bitmap = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (context === null) throw new Error('atlas decode: no 2D canvas context');
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  return { width: pixels.width, height: pixels.height, data: pixels.data };
}

async function fetchOk(url: string): Promise<Response> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`atlas fetch ${url}: HTTP ${response.status}`);
  return response;
}

/** The browser source: fetch + createImageBitmap. */
export const browserAtlasSource: AtlasSource = {
  async fetchJson(url: string): Promise<unknown> {
    return (await fetchOk(url)).json();
  },
  async fetchImage(url: string): Promise<RgbaImage> {
    return decodePng(await (await fetchOk(url)).blob());
  },
};

/**
 * Loads an atlas: fetches its PNG and JSON, checks every pixel against Kerbside-32 (throws on the first
 * non-palette or semi-transparent pixel), checks the JSON against FRAME, parses its swap tables, and builds the
 * R8 index texture and the 32×8 R8 swap texture.
 */
export async function loadAtlas(
  name: AtlasName,
  source: AtlasSource = browserAtlasSource,
  palette: Kerbside32 = KERBSIDE32,
): Promise<SpriteAtlas> {
  const [json, image] = await Promise.all([
    source.fetchJson(atlasUrl(name, 'json')),
    source.fetchImage(atlasUrl(name, 'png')),
  ]);
  const indices = indexAtlasPixels(name, image, palette);
  validateAtlasJson(name, json, image.width, image.height);
  const swaps = swapTableData(name, isRecord(json) ? json.swaps : undefined);
  return {
    name,
    width: image.width,
    height: image.height,
    indices,
    texture: r8Texture(indices, image.width, image.height),
    swaps,
    swapTexture: r8Texture(swaps, PALETTE_SIZE, SWAP_ROWS),
  };
}
