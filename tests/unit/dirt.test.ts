// The grime mask (SSP-060; TECHNICAL_DESIGN §10.3, GDD §9.1 and §8.1, LEVEL_DESIGN §9.2): Puddle Lane's exact
// shift-start selection (count, gutter share, determinism, placement, the (score desc, index asc) order), the
// value noise, the footprint erase (single pass, gutter cells left alone, bulldozing erases too), the Kerb
// Hugger distance threshold (0.19 m clears, 0.21 m does not), the counters and dirty rectangle, and the
// zero-allocation per-tick path (heap delta plus a source scan for `new`, literals and closures).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BrushState, createBrush, isBrushCollecting } from '../../src/sim/brush.ts';
import { GRIME_CELL_M, TILE_M } from '../../src/sim/constants.ts';
import {
  createDirt,
  type Dirt,
  GRIME_GUTTER_BIT,
  GRIME_INTENSITY_MASK,
  GRIME_INTENSITY_MIN,
  grimeNoise,
  grimeScores,
  hasDirtyRect,
  initGrime,
  setDirtTuning,
  stepDirt,
  viewDirt,
} from '../../src/sim/dirt.ts';
import { STATIC_PROP_IDS, type StaticPropId } from '../../src/sim/entities.ts';
import { COLLIDE, createBlankLevel, decodeLevel, GRIME_CELL, Ground, type Level } from '../../src/sim/map.ts';
import { DEFAULT_TUNING, type Tuning } from '../../src/sim/tuning.ts';
import { createVehicleState, type VehicleState } from '../../src/sim/vehicle.ts';
import { assertHeapDeltaWithinThresholds, measureHeapDelta } from '../support/heapDelta.ts';

const REPO_ROOT = new URL('../../', import.meta.url).pathname;
const PUDDLE_LANE: Level = decodeLevel(
  readFileSync(`${REPO_ROOT}public/assets/levels/puddle_lane.json`, 'utf8'),
);
const SW = DEFAULT_TUNING.sweeping;
const SEEDS = [1, 2, 42, 0xdeadbeef, 2026];
const EAST = Math.PI / 2;
const WEST = (3 * Math.PI) / 2;

type Pose = { xM: number; yM: number; headingRad: number };

/**
 * A pose for stepDirt. Always a VehicleState, as in the game, so stepDirt's property loads stay monomorphic
 * (several object shapes would make V8 box the double loads, which the heap-delta test below would catch).
 */
function at(xM: number, yM: number, headingRad: number): VehicleState {
  return createVehicleState(DEFAULT_TUNING.vehicle.sweeper, xM, yM, headingRad);
}

function laid(level: Level, seed: number): Dirt {
  const dirt = createDirt(level, DEFAULT_TUNING);
  initGrime(dirt, level, seed);
  return dirt;
}

function count(mask: Uint8Array, pred: (v: number) => boolean): number {
  let n = 0;
  for (const v of mask) if (pred(v)) n += 1;
  return n;
}

/** Vehicle-local coordinates of world point (x, y) for `pose` (right = (c, s), forward = (s, −c)). */
function toLocal(pose: Pose, x: number, y: number): { lx: number; ly: number } {
  const c = Math.cos(pose.headingRad);
  const s = Math.sin(pose.headingRad);
  const dx = x - pose.xM;
  const dy = y - pose.yM;
  return { lx: dx * c + dy * s, ly: dx * s - dy * c };
}

function cellCentre(i: number, maskW: number): { x: number; y: number } {
  return { x: ((i % maskW) + 0.5) * GRIME_CELL_M, y: (Math.floor(i / maskW) + 0.5) * GRIME_CELL_M };
}

describe('initial grime on Puddle Lane (LEVEL_DESIGN §9.2)', () => {
  const grime = PUDDLE_LANE.grime;

  it('compiles grime 9,000 with 15% (1,350) gutter cells', () => {
    expect(grime).toEqual({ cells: 9000, gutterCells: 1350, speckle: 0.03 });
  });

  it.each(SEEDS)('lays exactly 9,000 cells, ≥ 15%% of them gutter cells, for seed %i', (seed) => {
    const dirt = laid(PUDDLE_LANE, seed);
    expect(dirt.maskW).toBe(512);
    expect(dirt.maskH).toBe(384);
    expect(dirt.mask.length).toBe(196_608);
    const cells = count(dirt.mask, (v) => v !== 0);
    const gutter = count(dirt.mask, (v) => (v & GRIME_GUTTER_BIT) !== 0);
    expect(cells).toBe(9000);
    expect(gutter).toBe(1350);
    expect(gutter / cells).toBeGreaterThanOrEqual(0.15);
    expect(dirt.initialCells).toBe(9000);
    expect(dirt.initialGutterCells).toBe(1350);
    expect(dirt.cleanedCells).toBe(0);
    expect(dirt.cleanedGutterCells).toBe(0);
  });

  it('is identical for a given seed and differs between seeds', () => {
    for (const seed of SEEDS) {
      expect(laid(PUDDLE_LANE, seed).mask).toEqual(laid(PUDDLE_LANE, seed).mask);
    }
    const a = laid(PUDDLE_LANE, 1).mask;
    const b = laid(PUDDLE_LANE, 2).mask;
    let differ = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) differ++;
    expect(differ).toBeGreaterThan(0);
  });

  it('re-initialising restores the same mask and zeroes the cleaned counters', () => {
    const dirt = laid(PUDDLE_LANE, 7);
    const first = dirt.mask.slice();
    dirt.mask.fill(0);
    dirt.cleanedCells = 5;
    initGrime(dirt, PUDDLE_LANE, 7);
    expect(dirt.mask).toEqual(first);
    expect(dirt.cleanedCells).toBe(0);
    // The whole mask is dirty after initGrime, so the renderer uploads it.
    expect([dirt.dirtyMinX, dirt.dirtyMinY, dirt.dirtyMaxX, dirt.dirtyMaxY]).toEqual([0, 0, 511, 383]);
  });

  it('never lays grime on grass, aprons, solid tiles (footways, buildings), off-route tiles or solid props', () => {
    const [w] = PUDDLE_LANE.size;
    const L = PUDDLE_LANE.layers;
    const solidProps = PUDDLE_LANE.props.filter((p) => (STATIC_PROP_IDS as readonly string[]).includes(p.id));
    expect(solidProps.length).toBeGreaterThan(0);
    // Violations are collected and asserted once: one `expect` per grime cell (about 600k calls over three
    // seeds) took 2.7 s alone and timed out under parallel load, with no extra coverage.
    const bad: string[] = [];
    const ban = [Ground.Grass, Ground.Apron, Ground.Void, Ground.Water, Ground.Sand] as readonly number[];
    for (const seed of SEEDS.slice(0, 3)) {
      const dirt = laid(PUDDLE_LANE, seed);
      for (let i = 0; i < dirt.mask.length; i++) {
        const v = dirt.mask[i] as number;
        if (v === 0) continue;
        const cell = L.gutter[i] as number;
        if ((cell & GRIME_CELL.OPEN) === 0) bad.push(`seed ${seed}: grime cell ${i} is not open`);
        // The gutter bit is set exactly on gutter-band cells.
        if (((v & GRIME_GUTTER_BIT) !== 0) !== ((cell & GRIME_CELL.GUTTER) !== 0)) {
          bad.push(`seed ${seed}: grime cell ${i} gutter bit disagrees with the gutter band`);
        }
        const { x, y } = cellCentre(i, dirt.maskW);
        const t = Math.floor(y / TILE_M) * w + Math.floor(x / TILE_M);
        const ground = L.ground[t] as number;
        if (ban.includes(ground)) bad.push(`seed ${seed}: grime cell ${i} on banned ground ${ground}`);
        if (L.route[t] !== 1) bad.push(`seed ${seed}: grime cell ${i} off route`);
        if (((L.collide[t] as number) & COLLIDE.SOLID) !== 0)
          bad.push(`seed ${seed}: grime cell ${i} on a solid tile`);
        for (const p of solidProps) {
          const fp = DEFAULT_TUNING.propFootprints.shapes[p.id as StaticPropId];
          const { lx, ly } = toLocal({ xM: p.x, yM: p.y, headingRad: p.rot }, x, y);
          const inside =
            fp.shape === 'circle'
              ? lx * lx + ly * ly < fp.radiusM * fp.radiusM
              : Math.abs(lx) < fp.widthM / 2 && Math.abs(ly) < fp.lengthM / 2;
          if (inside) bad.push(`seed ${seed}: ${p.id} at (${p.x}, ${p.y}) covers grime cell ${i}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('takes each part by (score desc, index asc)', () => {
    const seed = 3;
    const dirt = laid(PUDDLE_LANE, seed);
    const scores = grimeScores(PUDDLE_LANE, seed);
    for (const gutterPart of [true, false]) {
      // The lowest-ranked selected cell must outrank every unselected open cell of the same part.
      let worstScore = Number.POSITIVE_INFINITY;
      let worstIndex = -1;
      let bestScore = Number.NEGATIVE_INFINITY;
      let bestIndex = -1;
      for (let i = 0; i < scores.length; i++) {
        const q = scores[i] as number;
        if (q < 0) continue;
        if ((((PUDDLE_LANE.layers.gutter[i] as number) & GRIME_CELL.GUTTER) !== 0) !== gutterPart) continue;
        if (dirt.mask[i] !== 0) {
          if (q < worstScore || (q === worstScore && i > worstIndex)) {
            worstScore = q;
            worstIndex = i;
          }
        } else if (q > bestScore || (q === bestScore && i < bestIndex)) {
          bestScore = q;
          bestIndex = i;
        }
      }
      expect(worstScore > bestScore || (worstScore === bestScore && worstIndex < bestIndex)).toBe(true);
    }
  });

  it('gives every grimy cell an intensity in GRIME_INTENSITY_MIN..127', () => {
    const dirt = laid(PUDDLE_LANE, 9);
    for (const v of dirt.mask) {
      if (v === 0) continue;
      const intensity = v & GRIME_INTENSITY_MASK;
      expect(intensity).toBeGreaterThanOrEqual(GRIME_INTENSITY_MIN);
      expect(intensity).toBeLessThanOrEqual(127);
    }
  });
});

describe('selection rules on a hand-made level', () => {
  /** A 2 × 2-tile level (16 × 16 cells) whose cells are all OPEN; the bottom two cell rows are GUTTER. */
  function openLevel(cells: number, gutterCells: number, speckle: number): Level {
    const level = createBlankLevel('sel', 2, 2);
    level.layers.gutter.fill(GRIME_CELL.OPEN);
    for (let i = 14 * 16; i < 16 * 16; i++) level.layers.gutter[i] = GRIME_CELL.OPEN | GRIME_CELL.GUTTER;
    level.grime = { cells, gutterCells, speckle };
    return level;
  }

  it('breaks score ties by index ascending', () => {
    const level = openLevel(20, 3, 0); // speckle 0 and density 0: every score ties
    const dirt = laid(level, 5);
    const set: number[] = [];
    for (let i = 0; i < dirt.mask.length; i++) if (dirt.mask[i] !== 0) set.push(i);
    const expected = [...Array.from({ length: 17 }, (_, i) => i), 224, 225, 226];
    expect(set).toEqual(expected);
    expect(dirt.mask[224]).toBe(GRIME_GUTTER_BIT | GRIME_INTENSITY_MIN);
    expect(dirt.mask[0]).toBe(GRIME_INTENSITY_MIN);
  });

  it('prefers higher zone density over the noise', () => {
    const level = openLevel(64, 0, 1);
    level.layers.grimeDensity[0] = 255; // tile (0, 0): cells x 0..7, y 0..7
    const dirt = laid(level, 11);
    for (let i = 0; i < dirt.mask.length; i++) {
      const cx = i % 16;
      const cy = Math.floor(i / 16);
      expect(dirt.mask[i] !== 0).toBe(cx < 8 && cy < 8);
    }
  });

  it('lays nothing without spawns.grime and refuses impossible counts', () => {
    const level = openLevel(0, 0, 0);
    level.grime = null;
    expect(laid(level, 1).initialCells).toBe(0);
    expect(() => laid(openLevel(40, 33, 0), 1)).toThrow(/gutter band has 32/);
    expect(() => laid(openLevel(240, 0, 0), 1)).toThrow(/only 224 are open/);
  });
});

describe('grimeNoise', () => {
  it('is in [0, 1), deterministic, seed dependent and smooth', () => {
    const a = grimeNoise(64, 48, 1);
    expect(grimeNoise(64, 48, 1)).toEqual(a);
    expect(grimeNoise(64, 48, 2)).not.toEqual(a);
    let min = 1;
    let max = 0;
    for (let y = 0; y < 48; y++) {
      for (let x = 0; x < 64; x++) {
        const v = a[y * 64 + x] as number;
        min = Math.min(min, v);
        max = Math.max(max, v);
        // Neighbouring cells move by at most one fine-lattice step's worth (smooth, not white noise).
        if (x > 0) expect(Math.abs(v - (a[y * 64 + x - 1] as number))).toBeLessThan(0.4);
      }
    }
    expect(min).toBeGreaterThanOrEqual(0);
    expect(max).toBeLessThan(1);
    expect(max - min).toBeGreaterThan(0.3);
  });
});

// ---------------------------------------------------------------------------------------------------------
// Erase
// ---------------------------------------------------------------------------------------------------------

/** A 16 × 16-tile level with no kerbs and a Dirt whose mask is filled with `value`. */
function filled(value: number, tuning: Tuning = DEFAULT_TUNING): { level: Level; dirt: Dirt } {
  const level = createBlankLevel('erase', 16, 16);
  const dirt = createDirt(level, tuning);
  dirt.mask.fill(value);
  return { level, dirt };
}

describe('footprint erase (TECHNICAL_DESIGN §10.3)', () => {
  it('does nothing while the brush is not collecting', () => {
    const { dirt } = filled(100);
    stepDirt(dirt, at(16, 16, 0), false);
    expect(count(dirt.mask, (v) => v === 0)).toBe(0);
    expect(dirt.tickCleanedCells).toBe(0);
    expect(hasDirtyRect(dirt)).toBe(false);
  });

  it('clears, in a single pass, exactly the non-gutter cells whose centre is inside the rotated footprint', () => {
    for (const heading of [0, 0.3, EAST, 2.5, Math.PI, 4.1, WEST]) {
      const { dirt } = filled(100);
      // Every third cell is gutter grime, which the footprint must leave alone.
      for (let i = 0; i < dirt.mask.length; i += 3) dirt.mask[i] = GRIME_GUTTER_BIT | 100;
      const before = dirt.mask.slice();
      const pose = at(16.1, 15.9, heading);
      stepDirt(dirt, pose, true);
      let expected = 0;
      for (let i = 0; i < before.length; i++) {
        const { x, y } = cellCentre(i, dirt.maskW);
        const { lx, ly } = toLocal(pose, x, y);
        const inside =
          lx >= SW.grimeFootprint.minXM + 1e-9 &&
          lx <= SW.grimeFootprint.maxXM - 1e-9 &&
          ly >= SW.grimeFootprint.minYM + 1e-9 &&
          ly <= SW.grimeFootprint.maxYM - 1e-9;
        const outside =
          lx < SW.grimeFootprint.minXM - 1e-9 ||
          lx > SW.grimeFootprint.maxXM + 1e-9 ||
          ly < SW.grimeFootprint.minYM - 1e-9 ||
          ly > SW.grimeFootprint.maxYM + 1e-9;
        const gutter = ((before[i] as number) & GRIME_GUTTER_BIT) !== 0;
        if (gutter || outside) expect(dirt.mask[i]).toBe(before[i]);
        else if (inside) expect(dirt.mask[i]).toBe(0);
        if (dirt.mask[i] !== before[i]) expected++;
      }
      // 2.6 m × 0.9 m of 0.25 m cells is about 37 cells, two thirds of them non-gutter.
      expect(expected).toBeGreaterThan(20);
      expect(dirt.tickCleanedCells).toBe(expected);
      expect(dirt.tickCleanedGutterCells).toBe(0);
      expect(dirt.cleanedCells).toBe(expected);
    }
  });

  it('accumulates the shift counters and resets the per-tick ones', () => {
    const { dirt } = filled(100);
    const pose = at(16, 16, 0);
    stepDirt(dirt, pose, true);
    const first = dirt.tickCleanedCells;
    expect(first).toBeGreaterThan(0);
    stepDirt(dirt, pose, true); // the same footprint again: nothing left to clean
    expect(dirt.tickCleanedCells).toBe(0);
    expect(hasDirtyRect(dirt)).toBe(false);
    expect(dirt.cleanedCells).toBe(first);
    pose.yM -= 1;
    stepDirt(dirt, pose, true);
    expect(dirt.cleanedCells).toBe(first + dirt.tickCleanedCells);
  });

  it('records the bounding rectangle of the changed cells', () => {
    const { dirt } = filled(100);
    const before = dirt.mask.slice();
    stepDirt(dirt, at(20.3, 11.7, 0.7), true);
    let minX = 1e9;
    let minY = 1e9;
    let maxX = -1;
    let maxY = -1;
    for (let i = 0; i < before.length; i++) {
      if (before[i] === dirt.mask[i]) continue;
      const x = i % dirt.maskW;
      const y = Math.floor(i / dirt.maskW);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    expect([dirt.dirtyMinX, dirt.dirtyMinY, dirt.dirtyMaxX, dirt.dirtyMaxY]).toEqual([
      minX,
      minY,
      maxX,
      maxY,
    ]);
  });

  it('clips at the map edge', () => {
    const { dirt } = filled(100);
    // Heading south from the west edge: the footprint hangs 1.1 m off the map.
    stepDirt(dirt, at(0.2, 0.5, Math.PI), true);
    expect(dirt.tickCleanedCells).toBe(6 * 4); // x 0..1.5 m (6 cells) × y 1.8..2.7 m (4 cells)
    expect(dirt.dirtyMinX).toBe(0);
  });

  it('erases while Collecting and while Bulldozing, not while spinning up (isBrushCollecting)', () => {
    const vehicle = createVehicleState(DEFAULT_TUNING.vehicle.sweeper, 16, 16, 0);
    vehicle.brushPos = 1;
    vehicle.rpm = 1;
    const brush = createBrush(DEFAULT_TUNING, 1);
    for (const [state, erases] of [
      [BrushState.Collecting, true],
      [BrushState.Bulldozing, true],
      [BrushState.SpinningUp, false],
      [BrushState.Raising, false],
    ] as const) {
      const { dirt } = filled(100);
      brush.state = state;
      stepDirt(dirt, vehicle, isBrushCollecting(brush, vehicle, DEFAULT_TUNING));
      expect(dirt.tickCleanedCells > 0).toBe(erases);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------
// Kerb Hugger
// ---------------------------------------------------------------------------------------------------------

const KERB_Y = 16; // a raised kerb along y = 16 m: road to the north, pavement to the south
const KERB_X = 16; // a raised kerb along x = 16 m: road to the west, pavement to the east

/** A 16 × 16-tile level with a horizontal kerb (tiles x0..x1 along y = 16 m) and gutter cells along its road side. */
function kerbLevel(x0 = 0, x1 = 15): { level: Level; dirt: Dirt } {
  const level = createBlankLevel('kerb', 16, 16);
  const w = 16;
  const row = KERB_Y / TILE_M;
  for (let x = x0; x <= x1; x++) {
    level.layers.collide[row * w + x] = COLLIDE.KERB_EDGE_N;
    level.layers.collide[(row - 1) * w + x] = COLLIDE.KERB_EDGE_S;
  }
  const dirt = createDirt(level, DEFAULT_TUNING);
  const cy = KERB_Y / GRIME_CELL_M;
  for (let y = 0; y < cy; y++) {
    for (let x = 0; x < dirt.maskW; x++) {
      dirt.mask[y * dirt.maskW + x] = y >= cy - 2 ? GRIME_GUTTER_BIT | 100 : 100;
    }
  }
  return { level, dirt };
}

/** A 16 × 16-tile level with a vertical kerb along x = 16 m and gutter cells along its road (west) side. */
function verticalKerbLevel(): Dirt {
  const level = createBlankLevel('kerb_v', 16, 16);
  const col = KERB_X / TILE_M;
  for (let y = 0; y < 16; y++) {
    level.layers.collide[y * 16 + col] = COLLIDE.KERB_EDGE_W;
    level.layers.collide[y * 16 + col - 1] = COLLIDE.KERB_EDGE_E;
  }
  const dirt = createDirt(level, DEFAULT_TUNING);
  const cx = KERB_X / GRIME_CELL_M;
  for (let y = 0; y < dirt.maskH; y++) {
    for (let x = 0; x < cx; x++) dirt.mask[y * dirt.maskW + x] = x >= cx - 2 ? GRIME_GUTTER_BIT | 100 : 100;
  }
  return dirt;
}

/** Gutter cells whose centre is inside the gutter brush circle at world (bx, by). */
function gutterCellsUnder(dirt: Dirt, before: Uint8Array, bx: number, by: number): number[] {
  const r = SW.gutterBrush.radiusM;
  const out: number[] = [];
  for (let i = 0; i < before.length; i++) {
    if (((before[i] as number) & GRIME_GUTTER_BIT) === 0) continue;
    const { x, y } = cellCentre(i, dirt.maskW);
    if ((x - bx) ** 2 + (y - by) ** 2 <= r * r) out.push(i);
  }
  return out;
}

function clearedGutter(dirt: Dirt, before: Uint8Array): number[] {
  const out: number[] = [];
  for (let i = 0; i < before.length; i++) {
    if (((before[i] as number) & GRIME_GUTTER_BIT) !== 0 && dirt.mask[i] === 0) out.push(i);
  }
  return out;
}

describe('Kerb Hugger (GDD §8.1)', () => {
  const g = SW.gutterBrush;

  it('reads the 0.2 m threshold from tuning.json', () => {
    expect(SW.kerbHugger.maxKerbDistanceM).toBe(0.2);
  });

  it('the right brush clears gutter cells under its circle at 0.19 m from the kerb edge', () => {
    const { dirt } = kerbLevel();
    const before = dirt.mask.slice();
    // Heading east: right = +y (toward the kerb), forward = +x. The right brush centre is at (x + 1.75, y + 0.85).
    const pose = at(10, KERB_Y - 0.19 - g.centreXM, EAST);
    stepDirt(dirt, pose, true);
    expect(dirt.kerbContact).toBe(true);
    expect(dirt.kerbContactRight).toBe(true);
    expect(dirt.kerbContactLeft).toBe(false);
    const under = gutterCellsUnder(dirt, before, 10 + g.centreYM, KERB_Y - 0.19);
    expect(under.length).toBeGreaterThanOrEqual(6);
    expect(clearedGutter(dirt, before)).toEqual(under);
    expect(dirt.tickCleanedGutterCells).toBe(under.length);
    expect(dirt.cleanedGutterCells).toBe(under.length);
    expect(dirt.tickCleanedCells).toBeGreaterThan(under.length); // the footprint's non-gutter cells too
  });

  it('clears no gutter cell and reports no contact at 0.21 m', () => {
    const { dirt } = kerbLevel();
    const before = dirt.mask.slice();
    stepDirt(dirt, at(10, KERB_Y - 0.21 - g.centreXM, EAST), true);
    expect(dirt.kerbContact).toBe(false);
    expect(clearedGutter(dirt, before)).toEqual([]);
    expect(dirt.tickCleanedGutterCells).toBe(0);
    // The footprint still clears the non-gutter road cells.
    expect(dirt.tickCleanedCells).toBeGreaterThan(0);
  });

  it('works for the left brush and from the pavement side', () => {
    // Heading west: right = −y, so the left brush (−x local) is toward +y, at (x − 1.75, y + 0.85).
    const left = kerbLevel().dirt;
    const before = left.mask.slice();
    stepDirt(left, at(20, KERB_Y - 0.19 - g.centreXM, WEST), true);
    expect(left.kerbContactLeft).toBe(true);
    expect(left.kerbContactRight).toBe(false);
    expect(clearedGutter(left, before)).toEqual(
      gutterCellsUnder(left, before, 20 - g.centreYM, KERB_Y - 0.19),
    );

    // Brush centre 0.19 m onto the pavement (heading east, the left brush is north of the body).
    const pave = kerbLevel().dirt;
    stepDirt(pave, at(10, KERB_Y + 0.19 + g.centreXM, EAST), true);
    expect(pave.kerbContactLeft).toBe(true);
    expect(pave.tickCleanedGutterCells).toBeGreaterThan(0);
  });

  it('works along a vertical kerb (0.19 m hugs, 0.21 m does not)', () => {
    // Heading north: right = +x, the right brush centre is at (x + 0.85, y − 1.75).
    const near = verticalKerbLevel();
    const before = near.mask.slice();
    stepDirt(near, at(KERB_X - 0.19 - g.centreXM, 20, 0), true);
    expect(near.kerbContactRight).toBe(true);
    expect(clearedGutter(near, before)).toEqual(
      gutterCellsUnder(near, before, KERB_X - 0.19, 20 - g.centreYM),
    );
    const far = verticalKerbLevel();
    stepDirt(far, at(KERB_X - 0.21 - g.centreXM, 20, 0), true);
    expect(far.kerbContact).toBe(false);
    expect(far.tickCleanedGutterCells).toBe(0);
  });

  it('measures to the kerb edge segment, so a kerb that ends is not hugged past its end', () => {
    // Kerb along tiles 0..4 only: x 0..10 m. Brush centre 0.19 m from the line, 0.5 m past the end.
    const { dirt } = kerbLevel(0, 4);
    stepDirt(dirt, at(10.5 - g.centreYM, KERB_Y - 0.19 - g.centreXM, EAST), true);
    expect(dirt.kerbContact).toBe(false);
    // 0.1 m past the end, 0.1 m from the line: 0.141 m from the segment's end point.
    const end = kerbLevel(0, 4).dirt;
    stepDirt(end, at(10.1 - g.centreYM, KERB_Y - 0.1 - g.centreXM, EAST), true);
    expect(end.kerbContact).toBe(true);
  });

  it('reports no contact while the brush is not collecting', () => {
    const { dirt } = kerbLevel();
    stepDirt(dirt, at(10, KERB_Y - 0.1 - g.centreXM, EAST), false);
    expect(dirt.kerbContact).toBe(false);
    expect(dirt.tickCleanedCells).toBe(0);
  });

  it('follows a tuning change and refuses a threshold a 3 × 3 tile search cannot honour', () => {
    const { dirt } = kerbLevel();
    const wide: Tuning = {
      ...DEFAULT_TUNING,
      sweeping: { ...SW, kerbHugger: { maxKerbDistanceM: 0.3 } },
    };
    setDirtTuning(dirt, wide);
    stepDirt(dirt, at(10, KERB_Y - 0.25 - g.centreXM, EAST), true);
    expect(dirt.kerbContact).toBe(true);
    const tooWide: Tuning = { ...DEFAULT_TUNING, sweeping: { ...SW, kerbHugger: { maxKerbDistanceM: 2 } } };
    expect(() => setDirtTuning(dirt, tooWide)).toThrow(/below 2 m/);
  });
});

// ---------------------------------------------------------------------------------------------------------
// Hot path
// ---------------------------------------------------------------------------------------------------------

describe('per-tick allocation (TECHNICAL_DESIGN §17)', () => {
  it('stepDirt allocates nothing over a minute of collecting on Puddle Lane', () => {
    const dirt = laid(PUDDLE_LANE, 1);
    const fresh = dirt.mask.slice();
    const view = viewDirt(dirt);
    // Find a straight run of 6 tiles with a raised kerb on their north edge and sweep east and west along it
    // with the gutter brush hugging it, weaving ±0.3 rad, re-laying the grime every 10 s so there is always
    // something to erase. The poses are precomputed so the harness itself allocates nothing.
    const [w, h] = PUDDLE_LANE.size;
    const collide = PUDDLE_LANE.layers.collide;
    let run = -1;
    for (let t = 0; t < w * h && run < 0; t++) {
      let ok = t % w <= w - 6;
      for (let k = 0; k < 6 && ok; k++) ok = ((collide[t + k] as number) & COLLIDE.KERB_EDGE_N) !== 0;
      if (ok) run = t;
    }
    expect(run).toBeGreaterThanOrEqual(0);
    const x0 = (run % w) * TILE_M;
    const kerbY = Math.floor(run / w) * TILE_M;
    const period = 600;
    const xs = new Float64Array(period);
    const ys = new Float64Array(period);
    const hs = new Float64Array(period);
    for (let k = 0; k < period; k++) {
      const east = k < period / 2;
      const u = east ? k / (period / 2) : (period - k) / (period / 2);
      const heading = east ? EAST : WEST;
      xs[k] = x0 + 2 + u * 8;
      // Heading east the left brush is on the north (−y) side, heading west the right one; both 0.1 m off.
      ys[k] = kerbY + 0.1 + SW.gutterBrush.centreXM;
      hs[k] = heading + 0.3 * Math.sin((k * 2 * Math.PI) / 75);
    }
    const pose = at(0.5, 0.5, 0.5);
    let cleaned = 0;
    let contact = 0;
    const step = (tick: number): void => {
      const k = tick % period;
      if (k === 0) dirt.mask.set(fresh);
      pose.xM = xs[k] as number;
      pose.yM = ys[k] as number;
      pose.headingRad = hs[k] as number;
      stepDirt(dirt, pose, tick % 7 !== 0);
      cleaned += view.tickCleanedCells;
      if (view.kerbContact) contact += 1;
    };
    for (let tick = 0; tick < 60_000; tick++) step(tick);
    expect(cleaned).toBeGreaterThan(0);
    expect(contact).toBeGreaterThan(0);
    const delta = measureHeapDelta((tick) => step(60_000 + tick));
    assertHeapDeltaWithinThresholds(delta);
  });

  it('per-tick functions contain no `new`, object or array literals, or closures', () => {
    const src = readFileSync(`${REPO_ROOT}src/sim/dirt.ts`, 'utf8');
    for (const name of ['stepDirt', 'brushHugsKerb']) {
      const start = src.indexOf(`function ${name}(`);
      expect(start, name).toBeGreaterThan(0);
      const open = src.indexOf('{', src.indexOf(')', start));
      let depth = 0;
      let end = open;
      for (; end < src.length; end++) {
        if (src[end] === '{') depth++;
        else if (src[end] === '}' && --depth === 0) break;
      }
      const body = src
        .slice(open + 1, end)
        .replace(/\/\/.*$/gm, '')
        .replace(/'[^']*'/g, "''");
      expect(body, `${name}: new`).not.toMatch(/\bnew\b/);
      expect(body, `${name}: closure`).not.toMatch(/=>|\bfunction\b/);
      expect(body, `${name}: object literal`).not.toMatch(/(=|\(|,|:|\breturn)\s*\{/);
      expect(body, `${name}: array literal`).not.toMatch(/(=|\(|,|:|\breturn)\s*\[/);
      expect(body, `${name}: template literal`).not.toMatch(/`/);
    }
  });
});

describe('docs', () => {
  it('GDD §20 Q2 records the single-pass decision', () => {
    const gdd = readFileSync(`${REPO_ROOT}docs/GDD.md`, 'utf8');
    const openQuestions = gdd.slice(gdd.indexOf('## 20. Open design questions'));
    const q2 = openQuestions.split('\n').find((l) => l.startsWith('| 2 |'));
    expect(q2).toMatch(/Resolved in M2.*single pass/i);
    expect(q2).toMatch(/SSP-060/);
  });
});
