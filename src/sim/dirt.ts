// The grime mask (TECHNICAL_DESIGN §10.3, GDD §9.1, LEVEL_DESIGN §9.2; SSP-060): one byte per 0.25 m grime cell
// over the whole district, the exact deterministic shift-start selection, the per-tick erase under the brush
// footprint, the Kerb Hugger check for gutter grime, the incremental counters and the per-tick dirty rectangle.
//
// Mask. (tilesW·8) × (tilesH·8) bytes, row-major (index = cy·maskW + cx); cell (cx, cy) covers
// [cx·0.25, (cx+1)·0.25) × [cy·0.25, (cy+1)·0.25) in sim metres and its centre is ((cx+0.5)·0.25, (cy+0.5)·0.25).
// Encoding: 0 = clean (or never grimy); bits 0–6 = intensity 1..127 (the ground shader's overlay strength,
// SSP-066); bit 7 (GRIME_GUTTER_BIT) = gutter grime (2 pts). A grimy cell always has intensity ≥ 1, so a byte is
// grimy exactly when it is non-zero.
//
// Shift start (initGrime; LEVEL_DESIGN §9.2, the compiler/sim split of SSP-054). Every OPEN cell of the
// compiled `gutter` layer is scored
//     score = grimeDensity[tile] / 255 + speckle × valueNoise(cell)
// where valueNoise is hand-written lattice value noise on the `grime` stream (two octaves, GRIME_NOISE_OCTAVES,
// lattice values drawn coarse octave first, each lattice row-major, one nextFloat each). The score is quantised
// to an integer (× GRIME_SCORE_SCALE, rounded) so the selection never branches on raw float noise
// (CLAUDE.md hard rule 12). Then exactly `spawns.grime.gutterCells` GUTTER cells and `cells − gutterCells` other
// OPEN cells are taken, each part by (score desc, index asc). The count is therefore identical on every attempt
// for every seed (the Tidy % denominator) and the gutter share is exact. A selected cell's intensity is
// GRIME_INTENSITY_MIN + round((127 − GRIME_INTENSITY_MIN) × min(score, 1)), so every grimy cell reads.
//
// Erase (stepDirt, tick phase 6). While the brush collects (isBrushCollecting: Collecting or Bulldozing, brushPos
// 1, rpm ≥ 0.8; grime is erased while bulldozing too, GDD §8.2) the grime footprint (tuning.json
// sweeping.grimeFootprint, the rotated vehicle-local rect x ∈ [−1.3, 1.3], y ∈ [+1.3, +2.2]) is rasterised into
// cells every tick: a cell is inside when its centre is (edges inclusive). A single pass clears a cell (GDD §20
// Q2, decided in SSP-060). The footprint clears only non-gutter cells.
//
// Kerb Hugger (GDD §8.1). A gutter brush hugs the kerb when its centre (sweeping.gutterBrush, (±0.85, +1.75)) is
// within sweeping.kerbHugger.maxKerbDistanceM (0.2 m, inclusive) of a raised kerb edge: a tile edge carrying a
// KERB_EDGE bit in the collide layer, measured to the edge segment. Only a hugging brush clears gutter cells,
// those whose centre is inside its circle (r 0.45). `kerbContact` is true on a tick in which the brush collects
// and either brush hugs a kerb; scoring turns 180 continuous ticks of it into +50 (SSP-063).
//
// Counters are incremental (nothing rescans the mask): initialCells / initialGutterCells from initGrime,
// cleanedCells / cleanedGutterCells over the shift, and tickCleanedCells / tickCleanedGutterCells for the
// current tick (gutter cells are included in the cleaned counts and also counted separately, so grime points are
// (tickCleanedCells − tickCleanedGutterCells) × 1 + tickCleanedGutterCells × 2). The dirty rectangle
// (dirtyMinX..dirtyMaxX, dirtyMinY..dirtyMaxY, inclusive mask cells) is the bounding box of the cells this tick
// changed, empty (max < min) when none did; render/groundLayer.ts merges the rects of a frame's ticks and
// uploads that sub-rectangle (SSP-066). After initGrime it covers the whole mask until the next stepDirt.
//
// Determinism: the selection sorts integer keys, the erase visits cells in row-major order and every branch
// compares quantised or exactly representable values except the inside tests, which use the same IEEE
// arithmetic on every V8. The mask and counters join the replay hash with SSP-065.
//
// Hot path: stepDirt allocates nothing (no `new`, literals or closures). The pose travels in scratch fields on
// the Dirt rather than as double arguments, which V8 boxes when it does not inline a call (see kerb.ts).
// createDirt, grimeNoise, grimeScores and initGrime run at shift start and may allocate.

import { GRIME_CELL_M, TILE_M } from './constants.ts';
import { cos, sin } from './fmath.ts';
import { COLLIDE, GRIME_CELL, GUTTER_CELLS_PER_TILE, type Level } from './map.ts';
import { createStream, nextFloat } from './rng.ts';
import type { Tuning } from './tuning.ts';

/** Mask bit 7: the cell holds gutter grime (2 pts, cleared only by a gutter brush hugging a kerb). */
export const GRIME_GUTTER_BIT = 0x80;

/** Mask bits 0–6: grime intensity 1..127 (0 with bit 7 clear means clean). */
export const GRIME_INTENSITY_MASK = 0x7f;

/** Intensity of the faintest selected cell (score 0); a score of 1 or more gives 127. Decided in SSP-060. */
export const GRIME_INTENSITY_MIN = 64;

/**
 * The value-noise octaves, coarse first: lattice spacing in grime cells and weight (the weights sum to 1, so the
 * noise is in [0, 1)). 4 m blotches with 1 m detail, decided in SSP-060 (LEVEL_DESIGN §9.2).
 */
export const GRIME_NOISE_OCTAVES: readonly { readonly periodCells: number; readonly weight: number }[] = [
  { periodCells: 16, weight: 0.625 },
  { periodCells: 4, weight: 0.375 },
];

/** Scores are quantised to integers in units of 1 / GRIME_SCORE_SCALE (2^-20) before the selection sort. */
export const GRIME_SCORE_SCALE = 2 ** 20;

/** Upper bound of a quantised score: density (≤ 1) + speckle (≤ 1) × noise (< 1) is below 2. */
const GRIME_SCORE_Q_MAX = 2 * GRIME_SCORE_SCALE;

/** Every KERB_EDGE bit of the collide layer. */
const KERB_EDGES = COLLIDE.KERB_EDGE_N | COLLIDE.KERB_EDGE_E | COLLIDE.KERB_EDGE_S | COLLIDE.KERB_EDGE_W;

/** A pose that erases grime: Bessie's VehicleState satisfies it (body centre in metres, heading in radians). */
export type DirtPose = { readonly xM: number; readonly yM: number; readonly headingRad: number };

/** The grime mask of one district and its counters. Create with createDirt; only the sim writes it. */
export type Dirt = {
  /** Map size in tiles. */
  readonly tilesW: number;
  readonly tilesH: number;
  /** Mask size in grime cells: tiles × 8. */
  readonly maskW: number;
  readonly maskH: number;
  /** The grime mask, maskW × maskH bytes (see the header for the encoding). */
  readonly mask: Uint8Array;
  /** The level's collide layer (KERB_EDGE bits), tilesW × tilesH. Read-only here. */
  readonly collide: Uint8Array;
  /** The tuning it runs on (sweeping.grimeFootprint, gutterBrush, kerbHugger). Replaced by setDirtTuning. */
  tuning: Tuning;
  /**
   * The tuning numbers stepDirt reads, copied from `tuning` by createDirt and setDirtTuning, so the per-tick
   * loads are monomorphic field reads on the Dirt whatever object shapes a tuning arrives in (polymorphic double
   * loads would box): the footprint rect, the gutter brush circle (right brush; the left is mirrored in x)
   * and the Kerb Hugger distance squared.
   */
  fpMinX: number;
  fpMaxX: number;
  fpMinY: number;
  fpMaxY: number;
  brushX: number;
  brushY: number;
  brushR: number;
  kerbMax2: number;
  /** Grime cells initGrime laid (the Tidy % denominator) and how many of them are gutter cells. */
  initialCells: number;
  initialGutterCells: number;
  /** Grime cells cleaned this shift, gutter cells included, and the gutter cells among them. */
  cleanedCells: number;
  cleanedGutterCells: number;
  /** Grime cells cleaned this tick, gutter cells included, and the gutter cells among them (for scoring). */
  tickCleanedCells: number;
  tickCleanedGutterCells: number;
  /** This tick: the brush collected and at least one gutter brush hugged a kerb (Kerb Hugger contact). */
  kerbContact: boolean;
  /** This tick: the left (−x) / right (+x) gutter brush hugged a kerb while collecting. */
  kerbContactLeft: boolean;
  kerbContactRight: boolean;
  /** This tick's dirty rectangle in mask cells, inclusive; empty when dirtyMaxX < dirtyMinX. */
  dirtyMinX: number;
  dirtyMinY: number;
  dirtyMaxX: number;
  dirtyMaxY: number;
  /** Per-tick scratch: the pose and the heading's cos and sin. */
  poseX: number;
  poseY: number;
  poseC: number;
  poseS: number;
};

/** What render, audio and UI may see: the same object, typed read-only. */
export type DirtView = {
  readonly maskW: number;
  readonly maskH: number;
  readonly mask: Readonly<Uint8Array>;
  readonly initialCells: number;
  readonly initialGutterCells: number;
  readonly cleanedCells: number;
  readonly cleanedGutterCells: number;
  readonly tickCleanedCells: number;
  readonly tickCleanedGutterCells: number;
  readonly kerbContact: boolean;
  readonly kerbContactLeft: boolean;
  readonly kerbContactRight: boolean;
  readonly dirtyMinX: number;
  readonly dirtyMinY: number;
  readonly dirtyMaxX: number;
  readonly dirtyMaxY: number;
};

/** Check `tuning` and copy the numbers stepDirt reads into `dirt`. */
function applyTuning(dirt: Dirt, tuning: Tuning): void {
  const sw = tuning.sweeping;
  const max = sw.kerbHugger.maxKerbDistanceM;
  // The kerb search looks at the 3 × 3 tiles around a brush centre, which finds every edge closer than a tile.
  if (!(max < TILE_M)) {
    throw new Error(`dirt: sweeping.kerbHugger.maxKerbDistanceM must be below ${TILE_M} m (got ${max})`);
  }
  dirt.tuning = tuning;
  dirt.fpMinX = sw.grimeFootprint.minXM;
  dirt.fpMaxX = sw.grimeFootprint.maxXM;
  dirt.fpMinY = sw.grimeFootprint.minYM;
  dirt.fpMaxY = sw.grimeFootprint.maxYM;
  dirt.brushX = sw.gutterBrush.centreXM;
  dirt.brushY = sw.gutterBrush.centreYM;
  dirt.brushR = sw.gutterBrush.radiusM;
  dirt.kerbMax2 = max * max;
}

/** A clean mask for `level` on `tuning`, with zeroed counters. Allocated once per shift. */
export function createDirt(level: Level, tuning: Tuning): Dirt {
  const tilesW = level.size[0];
  const tilesH = level.size[1];
  const maskW = tilesW * GUTTER_CELLS_PER_TILE;
  const maskH = tilesH * GUTTER_CELLS_PER_TILE;
  if (level.layers.collide.length !== tilesW * tilesH) {
    throw new Error('createDirt: the collide layer does not match the level size');
  }
  if (level.layers.gutter.length !== maskW * maskH) {
    throw new Error('createDirt: the gutter layer does not match the level size');
  }
  const dirt: Dirt = {
    tilesW,
    tilesH,
    maskW,
    maskH,
    mask: new Uint8Array(maskW * maskH),
    collide: level.layers.collide,
    tuning,
    // Fractional values first so the fields start as doubles (TECHNICAL_DESIGN §17, deprecated maps).
    fpMinX: 0.5,
    fpMaxX: 0.5,
    fpMinY: 0.5,
    fpMaxY: 0.5,
    brushX: 0.5,
    brushY: 0.5,
    brushR: 0.5,
    kerbMax2: 0.5,
    initialCells: 0,
    initialGutterCells: 0,
    cleanedCells: 0,
    cleanedGutterCells: 0,
    tickCleanedCells: 0,
    tickCleanedGutterCells: 0,
    kerbContact: false,
    kerbContactLeft: false,
    kerbContactRight: false,
    dirtyMinX: maskW,
    dirtyMinY: maskH,
    dirtyMaxX: -1,
    dirtyMaxY: -1,
    // Fractional values first so the fields start as doubles (TECHNICAL_DESIGN §17, deprecated maps).
    poseX: 0.5,
    poseY: 0.5,
    poseC: 0.5,
    poseS: 0.5,
  };
  applyTuning(dirt, tuning);
  return dirt;
}

/** The read-only view of `dirt`. No copy: it is the same object. */
export function viewDirt(dirt: Dirt): DirtView {
  return dirt;
}

/** Hand the Dirt a new tuning between ticks (the dev panel's live tuning; SSP-065 calls it from setWorldTuning). */
export function setDirtTuning(dirt: Dirt, tuning: Tuning): void {
  applyTuning(dirt, tuning);
}

/** True when this tick's dirty rectangle is non-empty. */
export function hasDirtyRect(dirt: DirtView): boolean {
  return dirt.dirtyMaxX >= dirt.dirtyMinX;
}

// ---------------------------------------------------------------------------------------------------------
// Shift start: value noise, scores and the exact selection
// ---------------------------------------------------------------------------------------------------------

/** Smoothstep fade of a lattice fraction u in [0, 1). */
function fade(u: number): number {
  return u * u * (3 - 2 * u);
}

/**
 * Lattice value noise in [0, 1) for every grime cell of a maskW × maskH mask, on the `grime` stream of `seed`
 * (LEVEL_DESIGN §9.2). Each octave draws (ceil(maskW / p) + 1) × (ceil(maskH / p) + 1) lattice values row-major
 * with nextFloat, coarse octave first, and interpolates them bilinearly with a smoothstep fade at the cell's
 * lattice position (cx / p, cy / p). Allocates; shift start only.
 */
export function grimeNoise(maskW: number, maskH: number, seed: number): Float64Array {
  const rng = createStream(seed >>> 0, 'grime');
  const out = new Float64Array(maskW * maskH);
  for (const { periodCells: p, weight } of GRIME_NOISE_OCTAVES) {
    const latW = Math.ceil(maskW / p) + 1;
    const latH = Math.ceil(maskH / p) + 1;
    const lattice = new Float64Array(latW * latH);
    for (let i = 0; i < lattice.length; i += 1) lattice[i] = nextFloat(rng);
    for (let cy = 0; cy < maskH; cy += 1) {
      const gy = Math.floor(cy / p);
      const fy = fade((cy - gy * p) / p);
      const row0 = gy * latW;
      const row1 = row0 + latW;
      for (let cx = 0; cx < maskW; cx += 1) {
        const gx = Math.floor(cx / p);
        const fx = fade((cx - gx * p) / p);
        const v00 = lattice[row0 + gx] as number;
        const v10 = lattice[row0 + gx + 1] as number;
        const v01 = lattice[row1 + gx] as number;
        const v11 = lattice[row1 + gx + 1] as number;
        const top = v00 + fx * (v10 - v00);
        const bottom = v01 + fx * (v11 - v01);
        const i = cy * maskW + cx;
        out[i] = (out[i] as number) + weight * (top + fy * (bottom - top));
      }
    }
  }
  return out;
}

/**
 * The quantised initial-grime score of every grime cell of `level` for `seed`:
 * round((grimeDensity[tile] / 255 + speckle × grimeNoise) × GRIME_SCORE_SCALE) for OPEN cells, −1 for the rest.
 * A level without `spawns.grime` scores with speckle 0. Allocates; shift start only.
 */
export function grimeScores(level: Level, seed: number): Int32Array {
  const tilesW = level.size[0];
  const maskW = tilesW * GUTTER_CELLS_PER_TILE;
  const maskH = level.size[1] * GUTTER_CELLS_PER_TILE;
  const gutter = level.layers.gutter;
  const density = level.layers.grimeDensity;
  const speckle = level.grime === null ? 0 : level.grime.speckle;
  const noise = grimeNoise(maskW, maskH, seed);
  const out = new Int32Array(maskW * maskH);
  for (let cy = 0; cy < maskH; cy += 1) {
    const tileRow = Math.floor(cy / GUTTER_CELLS_PER_TILE) * tilesW;
    for (let cx = 0; cx < maskW; cx += 1) {
      const i = cy * maskW + cx;
      if (((gutter[i] as number) & GRIME_CELL.OPEN) === 0) {
        out[i] = -1;
        continue;
      }
      const d = (density[tileRow + Math.floor(cx / GUTTER_CELLS_PER_TILE)] as number) / 255;
      out[i] = Math.round((d + speckle * (noise[i] as number)) * GRIME_SCORE_SCALE);
    }
  }
  return out;
}

/** Mask intensity 1..127 of a selected cell with quantised score `q`. */
export function grimeIntensity(q: number): number {
  const s = q < GRIME_SCORE_SCALE ? q : GRIME_SCORE_SCALE;
  return (
    GRIME_INTENSITY_MIN + Math.round(((GRIME_INTENSITY_MASK - GRIME_INTENSITY_MIN) * s) / GRIME_SCORE_SCALE)
  );
}

/**
 * Lay the shift-start grime for `seed` (see the header): exactly `level.grime.cells` cells, `gutterCells` of
 * them in the gutter band, each part by (score desc, index asc). Clears the mask first, sets initialCells and
 * initialGutterCells, zeroes the cleaned and per-tick counters and marks the whole mask dirty. A level without
 * `spawns.grime` gets no grime. Throws when the level cannot supply the counts (the compiler's L051 prevents
 * that for compiled levels). Allocates; shift start only.
 */
export function initGrime(dirt: Dirt, level: Level, seed: number): void {
  if (level.size[0] !== dirt.tilesW || level.size[1] !== dirt.tilesH) {
    throw new Error('initGrime: the level does not match the Dirt it was created for');
  }
  const mask = dirt.mask;
  const n = mask.length;
  mask.fill(0);
  const cells = level.grime === null ? 0 : level.grime.cells;
  const gutterCells = level.grime === null ? 0 : level.grime.gutterCells;
  let taken = 0;
  let takenGutter = 0;
  if (cells > 0) {
    const scores = grimeScores(level, seed);
    const gutter = level.layers.gutter;
    let nGutter = 0;
    let nOther = 0;
    for (let i = 0; i < n; i += 1) {
      if ((scores[i] as number) < 0) continue;
      if (((gutter[i] as number) & GRIME_CELL.GUTTER) !== 0) nGutter += 1;
      else nOther += 1;
    }
    if (gutterCells > nGutter) {
      throw new Error(`initGrime: ${gutterCells} gutter cells asked for; the gutter band has ${nGutter}`);
    }
    if (cells - gutterCells > nOther) {
      throw new Error(
        `initGrime: ${cells - gutterCells} non-gutter grime cells asked for; only ${nOther} are open`,
      );
    }
    // Integer sort keys: (Q_MAX − q) · n + index, ascending = (score desc, index asc). Below 2^53 because
    // Q_MAX · n is (2^21 · mask cells).
    if (GRIME_SCORE_Q_MAX * n >= Number.MAX_SAFE_INTEGER) throw new Error('initGrime: mask too large');
    const gutterKeys = new Float64Array(nGutter);
    const otherKeys = new Float64Array(nOther);
    let g = 0;
    let o = 0;
    for (let i = 0; i < n; i += 1) {
      const q = scores[i] as number;
      if (q < 0) continue;
      const key = (GRIME_SCORE_Q_MAX - q) * n + i;
      if (((gutter[i] as number) & GRIME_CELL.GUTTER) !== 0) gutterKeys[g++] = key;
      else otherKeys[o++] = key;
    }
    gutterKeys.sort();
    otherKeys.sort();
    for (let k = 0; k < gutterCells; k += 1) {
      const i = (gutterKeys[k] as number) % n;
      mask[i] = GRIME_GUTTER_BIT | grimeIntensity(scores[i] as number);
    }
    for (let k = 0; k < cells - gutterCells; k += 1) {
      const i = (otherKeys[k] as number) % n;
      mask[i] = grimeIntensity(scores[i] as number);
    }
    taken = cells;
    takenGutter = gutterCells;
  }
  dirt.initialCells = taken;
  dirt.initialGutterCells = takenGutter;
  dirt.cleanedCells = 0;
  dirt.cleanedGutterCells = 0;
  dirt.tickCleanedCells = 0;
  dirt.tickCleanedGutterCells = 0;
  dirt.kerbContact = false;
  dirt.kerbContactLeft = false;
  dirt.kerbContactRight = false;
  dirt.dirtyMinX = 0;
  dirt.dirtyMinY = 0;
  dirt.dirtyMaxX = dirt.maskW - 1;
  dirt.dirtyMaxY = dirt.maskH - 1;
}

// ---------------------------------------------------------------------------------------------------------
// Phase 6: erase
// ---------------------------------------------------------------------------------------------------------

/**
 * True when the gutter brush on `side` (+1 right, −1 left) has its centre within maxKerbDistanceM (inclusive) of
 * a raised kerb edge, for the pose in the Dirt's scratch fields. Searches the 3 × 3 tiles around the centre.
 */
function brushHugsKerb(dirt: Dirt, side: number): boolean {
  const lx = side * dirt.brushX;
  const ly = dirt.brushY;
  const bx = dirt.poseX + lx * dirt.poseC + ly * dirt.poseS;
  const by = dirt.poseY + lx * dirt.poseS - ly * dirt.poseC;
  const max2 = dirt.kerbMax2;
  const w = dirt.tilesW;
  const h = dirt.tilesH;
  const col = Math.floor(bx / TILE_M);
  const row = Math.floor(by / TILE_M);
  for (let r = row - 1; r <= row + 1; r += 1) {
    if (r < 0 || r >= h) continue;
    for (let c = col - 1; c <= col + 1; c += 1) {
      if (c < 0 || c >= w) continue;
      const bits = (dirt.collide[r * w + c] as number) & KERB_EDGES;
      if (bits === 0) continue;
      const x0 = c * TILE_M;
      const y0 = r * TILE_M;
      const x1 = x0 + TILE_M;
      const y1 = y0 + TILE_M;
      // Distance components to this tile's horizontal (N, S) and vertical (E, W) edge segments.
      const along = bx < x0 ? x0 - bx : bx > x1 ? bx - x1 : 0;
      const down = by < y0 ? y0 - by : by > y1 ? by - y1 : 0;
      if ((bits & COLLIDE.KERB_EDGE_N) !== 0) {
        const d = by - y0;
        if (along * along + d * d <= max2) return true;
      }
      if ((bits & COLLIDE.KERB_EDGE_S) !== 0) {
        const d = by - y1;
        if (along * along + d * d <= max2) return true;
      }
      if ((bits & COLLIDE.KERB_EDGE_W) !== 0) {
        const d = bx - x0;
        if (d * d + down * down <= max2) return true;
      }
      if ((bits & COLLIDE.KERB_EDGE_E) !== 0) {
        const d = bx - x1;
        if (d * d + down * down <= max2) return true;
      }
    }
  }
  return false;
}

/**
 * Tick phase 6 (see the header): reset the per-tick counters, kerb flags and dirty rectangle, then, when
 * `collecting` (isBrushCollecting), run the Kerb Hugger check for both gutter brushes and erase every cell under
 * the footprint (non-gutter cells) and under a hugging brush's circle (gutter cells). Allocation-free.
 */
export function stepDirt(dirt: Dirt, pose: DirtPose, collecting: boolean): void {
  dirt.tickCleanedCells = 0;
  dirt.tickCleanedGutterCells = 0;
  dirt.kerbContact = false;
  dirt.kerbContactLeft = false;
  dirt.kerbContactRight = false;
  const maskW = dirt.maskW;
  const maskH = dirt.maskH;
  dirt.dirtyMinX = maskW;
  dirt.dirtyMinY = maskH;
  dirt.dirtyMaxX = -1;
  dirt.dirtyMaxY = -1;
  if (!collecting) return;

  const px = pose.xM;
  const py = pose.yM;
  const c = cos(pose.headingRad);
  const s = sin(pose.headingRad);
  dirt.poseX = px;
  dirt.poseY = py;
  dirt.poseC = c;
  dirt.poseS = s;
  const hugRight = brushHugsKerb(dirt, 1);
  const hugLeft = brushHugsKerb(dirt, -1);
  dirt.kerbContactRight = hugRight;
  dirt.kerbContactLeft = hugLeft;
  dirt.kerbContact = hugRight || hugLeft;

  const fpMinX = dirt.fpMinX;
  const fpMaxX = dirt.fpMaxX;
  const fpMinY = dirt.fpMinY;
  const fpMaxY = dirt.fpMaxY;
  const gcx = dirt.brushX;
  const gcy = dirt.brushY;
  const gr = dirt.brushR;
  const r2 = gr * gr;

  // The vehicle-local box to visit: the footprint, grown to cover each hugging brush's circle.
  let lMinX = fpMinX;
  let lMaxX = fpMaxX;
  let lMinY = fpMinY;
  let lMaxY = fpMaxY;
  if (hugRight || hugLeft) {
    if (gcy - gr < lMinY) lMinY = gcy - gr;
    if (gcy + gr > lMaxY) lMaxY = gcy + gr;
  }
  if (hugRight && gcx + gr > lMaxX) lMaxX = gcx + gr;
  if (hugRight && gcx - gr < lMinX) lMinX = gcx - gr;
  if (hugLeft && -gcx - gr < lMinX) lMinX = -gcx - gr;
  if (hugLeft && -gcx + gr > lMaxX) lMaxX = -gcx + gr;

  // Its world AABB: world = p + lx·right + ly·forward, right = (c, s), forward = (s, −c).
  const ax = lMinX * c;
  const bx = lMaxX * c;
  const ay = lMinX * s;
  const by = lMaxX * s;
  const ex = lMinY * s;
  const fx = lMaxY * s;
  const ey = -lMinY * c;
  const fy = -lMaxY * c;
  const wMinX = px + (ax < bx ? ax : bx) + (ex < fx ? ex : fx);
  const wMaxX = px + (ax < bx ? bx : ax) + (ex < fx ? fx : ex);
  const wMinY = py + (ay < by ? ay : by) + (ey < fy ? ey : fy);
  const wMaxY = py + (ay < by ? by : ay) + (ey < fy ? fy : ey);
  // Cells whose centre may be inside, one spare cell each side; the inside test decides.
  let cx0 = Math.floor(wMinX / GRIME_CELL_M) - 1;
  let cx1 = Math.floor(wMaxX / GRIME_CELL_M) + 1;
  let cy0 = Math.floor(wMinY / GRIME_CELL_M) - 1;
  let cy1 = Math.floor(wMaxY / GRIME_CELL_M) + 1;
  if (cx0 < 0) cx0 = 0;
  if (cy0 < 0) cy0 = 0;
  if (cx1 > maskW - 1) cx1 = maskW - 1;
  if (cy1 > maskH - 1) cy1 = maskH - 1;

  const mask = dirt.mask;
  let cleaned = 0;
  let cleanedGutter = 0;
  let dMinX = maskW;
  let dMinY = maskH;
  let dMaxX = -1;
  let dMaxY = -1;
  for (let cy = cy0; cy <= cy1; cy += 1) {
    const dy = (cy + 0.5) * GRIME_CELL_M - py;
    const rowBase = cy * maskW;
    for (let cx = cx0; cx <= cx1; cx += 1) {
      const i = rowBase + cx;
      const v = mask[i] as number;
      if (v === 0) continue;
      const dx = (cx + 0.5) * GRIME_CELL_M - px;
      const lx = dx * c + dy * s;
      const ly = dx * s - dy * c;
      let clear: boolean;
      if ((v & GRIME_GUTTER_BIT) !== 0) {
        const dly = ly - gcy;
        const drx = lx - gcx;
        const dlx = lx + gcx;
        clear = (hugRight && drx * drx + dly * dly <= r2) || (hugLeft && dlx * dlx + dly * dly <= r2);
        if (clear) cleanedGutter += 1;
      } else {
        clear = lx >= fpMinX && lx <= fpMaxX && ly >= fpMinY && ly <= fpMaxY;
      }
      if (!clear) continue;
      mask[i] = 0;
      cleaned += 1;
      if (cx < dMinX) dMinX = cx;
      if (cx > dMaxX) dMaxX = cx;
      if (cy < dMinY) dMinY = cy;
      if (cy > dMaxY) dMaxY = cy;
    }
  }
  dirt.tickCleanedCells = cleaned;
  dirt.tickCleanedGutterCells = cleanedGutter;
  dirt.cleanedCells += cleaned;
  dirt.cleanedGutterCells += cleanedGutter;
  dirt.dirtyMinX = dMinX;
  dirt.dirtyMinY = dMinY;
  dirt.dirtyMaxX = dMaxX;
  dirt.dirtyMaxY = dMaxY;
}
