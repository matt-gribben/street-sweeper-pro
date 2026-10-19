// The 47-tile kerb blob autotile table (LEVEL_DESIGN §7.2, TECHNICAL_DESIGN §15.1 step 2; SSP-034).
//
// The canonical index ↔ 8-bit neighbour-mask table lives exactly once, in
// assets-src/procedural/tiles/kerb_blob.json → `params.blob_masks`, beside its bit order
// (`params.mask_bits`). This compiler and the forge kerb tile generator (SSP-040) both read that file, so
// autotile index n here is always the frame `tile.kerb:blob:-:n` there. Nothing in this module duplicates
// the table: it only holds the reduction rule ("a corner bit counts only when both adjacent edge bits are
// set") and checks the file against it.
//
// Mask meaning: a bit is set when that neighbour is NOT road (a raised cell, a building, a dropped kerb, or
// outside the map), so a clear edge bit is a kerb on that edge and a clear corner bit between two set edges
// is an inner-corner nub. Mask 255 (no road neighbour) is in the table for completeness, but the compiler
// writes AUTOTILE_NONE for it.
import { readFileSync } from 'node:fs';
import { AUTOTILE_COUNT } from '../../src/sim/map.ts';

/** The eight neighbour directions, edges and corners, in the order of `mask_bits` in kerb_blob.json. */
export const BLOB_DIRS = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'] as const;
export type BlobDir = (typeof BLOB_DIRS)[number];

/** Grid offset of each direction (x east, y south; row 0 is the north edge). */
export const BLOB_OFFSETS: { readonly [d in BlobDir]: readonly [dx: number, dy: number] } = {
  n: [0, -1],
  ne: [1, -1],
  e: [1, 0],
  se: [1, 1],
  s: [0, 1],
  sw: [-1, 1],
  w: [-1, 0],
  nw: [-1, -1],
};

/** Each corner and the two edges it sits between. */
const CORNERS: readonly [corner: BlobDir, a: BlobDir, b: BlobDir][] = [
  ['ne', 'n', 'e'],
  ['se', 's', 'e'],
  ['sw', 's', 'w'],
  ['nw', 'n', 'w'],
];

/** The parsed, checked table. */
export type KerbBlob = {
  /** Direction → its single bit in an 8-bit mask. */
  readonly bits: { readonly [d in BlobDir]: number };
  /** Index → reduced mask (47 entries, as committed). */
  readonly masks: readonly number[];
  /** Any raw 8-bit mask → its blob index 0..46 (reduce, then look up). */
  readonly indexOfRaw: Uint8Array;
};

/** Repo-relative path of the committed table. */
export const KERB_BLOB_PATH = 'assets-src/procedural/tiles/kerb_blob.json';

/** Clear every corner bit whose two adjacent edge bits are not both set. */
export function reduceBlobMask(raw: number, bits: KerbBlob['bits']): number {
  let mask = raw & (bits.n | bits.e | bits.s | bits.w);
  for (const [corner, a, b] of CORNERS) {
    if ((raw & bits[corner]) !== 0 && (raw & bits[a]) !== 0 && (raw & bits[b]) !== 0) mask |= bits[corner];
  }
  return mask;
}

const isObject = (v: unknown): v is { [key: string]: unknown } =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Check a parsed kerb_blob.json and build the raw-mask lookup. Throws, naming the problem, unless
 * `mask_bits` gives each of the 8 directions a distinct single bit of a byte and `blob_masks` holds exactly
 * 47 distinct, already-reduced masks that every one of the 256 raw masks reduces to.
 */
export function parseKerbBlob(doc: unknown): KerbBlob {
  function fail(message: string): never {
    throw new Error(`kerb_blob.json: ${message}`);
  }
  const params = isObject(doc) ? doc.params : undefined;
  if (!isObject(params)) fail('expected an object with "params"');
  const rawBits = params.mask_bits;
  if (!isObject(rawBits)) fail('params.mask_bits must be an object');
  const keys = Object.keys(rawBits).sort();
  if (keys.join() !== [...BLOB_DIRS].sort().join())
    fail(`params.mask_bits must name exactly ${BLOB_DIRS.join(', ')}`);
  const bits = {} as { [d in BlobDir]: number };
  let seen = 0;
  for (const d of BLOB_DIRS) {
    const v = rawBits[d];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 128 || (v & (v - 1)) !== 0)
      fail(`params.mask_bits.${d} must be a single bit 1..128`);
    if ((seen & v) !== 0) fail(`params.mask_bits.${d} repeats bit ${v}`);
    seen |= v;
    bits[d] = v;
  }
  const list = params.blob_masks;
  if (!Array.isArray(list)) fail('params.blob_masks must be an array');
  if (list.length !== AUTOTILE_COUNT)
    fail(`params.blob_masks has ${list.length} entries; the kerb blob has ${AUTOTILE_COUNT}`);
  const masks: number[] = [];
  const index = new Map<number, number>();
  for (const [i, v] of list.entries()) {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 255)
      fail(`params.blob_masks[${i}] must be an integer 0..255`);
    if (reduceBlobMask(v, bits) !== v)
      fail(`params.blob_masks[${i}] = ${v} is not reduced (a corner bit without both edge bits)`);
    if (index.has(v)) fail(`params.blob_masks[${i}] = ${v} repeats entry ${index.get(v)}`);
    index.set(v, i);
    masks.push(v);
  }
  const indexOfRaw = new Uint8Array(256);
  for (let raw = 0; raw < 256; raw += 1) {
    const i = index.get(reduceBlobMask(raw, bits));
    if (i === undefined) fail(`raw mask ${raw} reduces to ${reduceBlobMask(raw, bits)}, not in the table`);
    indexOfRaw[raw] = i;
  }
  return { bits, masks, indexOfRaw };
}

/** Read and check the table from a file (the compiler passes the repo's KERB_BLOB_PATH). */
export function readKerbBlob(path: string): KerbBlob {
  return parseKerbBlob(JSON.parse(readFileSync(path, 'utf8')));
}
