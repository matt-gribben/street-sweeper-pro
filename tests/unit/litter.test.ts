// LitterField (SSP-057, TECHNICAL_DESIGN §10.2, LEVEL_DESIGN §9.1): the store and its counters, re-bucketing
// in the 4 m spatial hash, swap-remove, the fling arc (side, distance, uncollectable until it lands, the glass
// hook), the drift hook, one-tick pushes, the brush query box, the Puddle Lane shift-start spawn (determinism,
// count, spacing, per-tile cap, type constraints) and the zero-allocation check of the per-tick functions.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Aabb } from '../../src/sim/collision/obb.ts';
import { SIM_HZ, TILE_M } from '../../src/sim/constants.ts';
import { LITTER_IDS, type LitterId } from '../../src/sim/entities.ts';
import {
  addLitter,
  beginLitterTick,
  collectLitter,
  createLitterField,
  type FlingSource,
  flingLitter,
  isLitterCollectable,
  LITTER_CAPACITY,
  LITTER_HASH_CELL_M,
  LITTER_MAX_PER_TILE,
  type LitterField,
  LitterFlag,
  litterCellIndex,
  localRectToWorldAabb,
  queryLitter,
  removeLitter,
  spawnInitialLitter,
  startLitterDrift,
  stepLitter,
  updateLitterCell,
} from '../../src/sim/litter.ts';
import {
  createBlankLevel,
  decodeLevel,
  Ground,
  type Level,
  LITTER_CELL_M,
  LITTER_CELLS_PER_TILE,
  LITTER_PLACE,
  litterFieldLength,
} from '../../src/sim/map.ts';
import { createStream, nextFloat, type Sfc32, sfc32 } from '../../src/sim/rng.ts';
import { DEFAULT_ENTITIES, DEFAULT_TUNING } from '../../src/sim/tuning.ts';
import { assertHeapDeltaWithinThresholds, measureHeapDelta } from '../support/heapDelta.ts';

const REPO_ROOT = new URL('../../', import.meta.url).pathname;
const PUDDLE_LANE: Level = decodeLevel(
  readFileSync(`${REPO_ROOT}public/assets/levels/puddle_lane.json`, 'utf8'),
);
const FLING = DEFAULT_TUNING.sweeping.fling;
const ARC_TICKS = Math.round(FLING.arcDurationS * SIM_HZ);

const kindOf = (id: LitterId): number => LITTER_IDS.indexOf(id);
const CRISP = kindOf('litter.crisp_packet');
const CAN = kindOf('litter.drink_can');
const NEWSPAPER = kindOf('litter.newspaper');
const GLASS = kindOf('litter.glass_bottle');

function newField(level: Level = createBlankLevel('test', 16, 16), capacity = LITTER_CAPACITY): LitterField {
  return createLitterField(level, DEFAULT_TUNING, DEFAULT_ENTITIES, capacity);
}

/** Item indices in a cell's list, head first. */
function cellList(field: LitterField, cell: number): number[] {
  const out: number[] = [];
  for (let i = field.cellHead[cell] as number; i >= 0; i = field.cellNext[i] as number) out.push(i);
  return out;
}

function box(minX: number, minY: number, maxX: number, maxY: number): Aabb {
  return { minX, minY, maxX, maxY };
}

/** A snapshot of every live per-item field, for comparing stores. */
function snapshot(field: LitterField): Record<string, number[]> {
  const n = field.count;
  const take = (a: ArrayLike<number>): number[] => Array.from(a).slice(0, n);
  return {
    x: take(field.x),
    y: take(field.y),
    kind: take(field.kind),
    rot: take(field.rot),
    flags: take(field.flags),
    cellOf: take(field.cellOf),
    cellNext: take(field.cellNext),
  };
}

describe('LitterField store', () => {
  it('sizes the spatial hash in 4 m cells over the level', () => {
    const field = newField(PUDDLE_LANE);
    expect(LITTER_HASH_CELL_M).toBe(4);
    expect(field.hashCols).toBe(32); // 64 tiles × 2 m / 4 m
    expect(field.hashRows).toBe(24);
    expect(field.capacity).toBe(2000);
  });

  it('adds items at rest, counts them as spawned and refuses past capacity', () => {
    const field = newField(undefined, 3);
    expect(addLitter(field, CRISP, 1.25, 2.5, 0)).toBe(0);
    expect(addLitter(field, CAN, 5.5, 9.0, 3)).toBe(1);
    expect(addLitter(field, CAN, 6, 9, 1)).toBe(2);
    expect(addLitter(field, CAN, 7, 9, 1)).toBe(-1);
    expect(field.count).toBe(3);
    expect(field.litterSpawned).toBe(3);
    expect([field.x[1], field.y[1], field.prevX[1], field.prevY[1]]).toEqual([5.5, 9, 5.5, 9]);
    expect([field.kind[1], field.rot[1], field.flags[1]]).toEqual([CAN, 3, 0]);
    expect(() => addLitter(field, LITTER_IDS.length, 0, 0, 0)).toThrow(/kind/);
    expect(() => addLitter(field, CRISP, 0, 0, 4)).toThrow(/rot/);
  });

  it('does not re-bucket an item moving inside its cell, and moves it when it crosses a boundary', () => {
    const field = newField();
    const a = addLitter(field, CRISP, 1, 1, 0);
    const b = addLitter(field, CRISP, 2, 2, 0);
    const cell0 = litterCellIndex(field, a);
    expect(cellList(field, cell0)).toEqual([b, a]);

    // Inside the same 4 m cell: no re-bucket, the list (and its order) is untouched.
    field.x[a] = 3.9;
    field.y[a] = 0.1;
    expect(updateLitterCell(field, a)).toBe(false);
    expect(field.cellOf[a]).toBe(cell0);
    expect(cellList(field, cell0)).toEqual([b, a]);

    // Across the x = 4 m boundary: out of the old list, into the new cell.
    field.x[a] = 4.0;
    expect(updateLitterCell(field, a)).toBe(true);
    const cell1 = litterCellIndex(field, a);
    expect(cell1).toBe(cell0 + 1);
    expect(field.cellOf[a]).toBe(cell1);
    expect(cellList(field, cell0)).toEqual([b]);
    expect(cellList(field, cell1)).toEqual([a]);
  });

  it('keeps positions off the map in the nearest edge cell', () => {
    const field = newField();
    const i = addLitter(field, CRISP, -3, 1000, 0);
    expect(field.cellOf[i]).toBe((field.hashRows - 1) * field.hashCols);
    const out = new Int32Array(field.capacity);
    expect(queryLitter(field, box(-4, 999, -2, 1001), out)).toBe(1);
  });

  it('swap-removes: the last item takes the slot and its place in its cell list', () => {
    const field = newField();
    const a = addLitter(field, CRISP, 1, 1, 0);
    const b = addLitter(field, CAN, 10, 10, 1);
    const c = addLitter(field, NEWSPAPER, 1.5, 1.5, 2); // same cell as a, ahead of it
    const d = addLitter(field, CAN, 2, 2, 3); // same cell, head
    expect(cellList(field, field.cellOf[a] as number)).toEqual([d, c, a]);
    removeLitter(field, a);
    expect(field.count).toBe(3);
    // d moved into slot a and kept its place at the head.
    expect([field.x[a], field.y[a], field.kind[a], field.rot[a]]).toEqual([2, 2, CAN, 3]);
    expect(cellList(field, field.cellOf[a] as number)).toEqual([a, c]);
    expect(cellList(field, field.cellOf[b] as number)).toEqual([b]);
    expect(field.litterSpawned).toBe(4);
    expect(field.litterCollected).toBe(0);
    expect(() => removeLitter(field, 3)).toThrow(/not a live item/);
    void d;
  });

  it('collects an item into litterCollected', () => {
    const field = newField();
    addLitter(field, CRISP, 1, 1, 0);
    addLitter(field, CAN, 2, 2, 0);
    expect(collectLitter(field, 0)).toBe(true);
    expect(field.count).toBe(1);
    expect(field.kind[0]).toBe(CAN);
    expect([field.litterSpawned, field.litterCollected]).toEqual([2, 1]);
  });

  it('copies x/y into prevX/prevY at the start of the tick', () => {
    const field = newField();
    const i = addLitter(field, CRISP, 1, 1, 0);
    field.vx[i] = 6;
    stepLitter(field);
    expect(field.prevX[i]).toBe(1);
    beginLitterTick(field);
    expect(field.prevX[i]).toBe(field.x[i]);
  });

  it('applies a non-drift velocity for one tick only', () => {
    const field = newField();
    const i = addLitter(field, CAN, 1, 1, 0);
    field.vx[i] = 3;
    field.vy[i] = -6;
    stepLitter(field);
    expect(field.x[i]).toBeCloseTo(1 + 3 / SIM_HZ, 12);
    expect(field.y[i]).toBeCloseTo(1 - 6 / SIM_HZ, 12);
    expect([field.vx[i], field.vy[i]]).toEqual([0, 0]);
    const x = field.x[i];
    stepLitter(field);
    expect(field.x[i]).toBe(x);
  });

  it('leaves PINNED items to the brush', () => {
    const field = newField();
    const i = addLitter(field, CAN, 1, 1, 0);
    field.flags[i] = LitterFlag.Pinned;
    field.vx[i] = 3;
    stepLitter(field);
    expect(field.x[i]).toBe(1);
  });
});

describe('brush query box', () => {
  const suction: Aabb = box(
    DEFAULT_TUNING.sweeping.suction.minXM,
    DEFAULT_TUNING.sweeping.suction.minYM,
    DEFAULT_TUNING.sweeping.suction.maxXM,
    DEFAULT_TUNING.sweeping.suction.maxYM,
  );

  it('transforms a vehicle-local rect to the world AABB of its corners', () => {
    for (const headingRad of [0, 0.3, Math.PI / 2, 2.1, Math.PI, -1.2, 5.9]) {
      const pose: FlingSource = { xM: 20, yM: 30, headingRad };
      const out = localRectToWorldAabb(pose, suction, box(0, 0, 0, 0));
      const c = Math.cos(headingRad);
      const s = Math.sin(headingRad);
      const xs: number[] = [];
      const ys: number[] = [];
      for (const lx of [suction.minX, suction.maxX]) {
        for (const ly of [suction.minY, suction.maxY]) {
          xs.push(20 + c * lx + s * ly);
          ys.push(30 + s * lx - c * ly);
        }
      }
      expect(out.minX).toBeCloseTo(Math.min(...xs), 12);
      expect(out.maxX).toBeCloseTo(Math.max(...xs), 12);
      expect(out.minY).toBeCloseTo(Math.min(...ys), 12);
      expect(out.maxY).toBeCloseTo(Math.max(...ys), 12);
    }
  });

  it('visits only the 2–4 cells the brush box overlaps', () => {
    const field = newField(PUDDLE_LANE);
    const out = new Int32Array(field.capacity);
    const rng = sfc32(7);
    let maxCells = 0;
    for (let k = 0; k < 500; k++) {
      const pose: FlingSource = {
        xM: 4 + nextFloat(rng) * 120,
        yM: 4 + nextFloat(rng) * 88,
        headingRad: nextFloat(rng) * 2 * Math.PI,
      };
      queryLitter(field, localRectToWorldAabb(pose, suction, box(0, 0, 0, 0)), out);
      maxCells = Math.max(maxCells, field.lastQueryCells);
    }
    expect(maxCells).toBeLessThanOrEqual(4);
  });
});

describe('fling arc', () => {
  const north: FlingSource = { xM: 10, yM: 10, headingRad: 0 };

  function flungOnce(field: LitterField, i: number, source: FlingSource, rng: Sfc32): void {
    expect(flingLitter(field, i, source, rng)).toBe(true);
  }

  it('lands 1.5–3 m to the right of a sweeper whose item is on its right, uncollectable until it lands', () => {
    const field = newField();
    const i = addLitter(field, CAN, 10.4, 8, 0); // local x = +0.4 for a north-facing sweeper
    const rng = createStream(1, 'brush');
    flungOnce(field, i, north, rng);
    expect(field.flags[i]).toBe(LitterFlag.Flung);
    expect(field.arcDur[i]).toBe(ARC_TICKS);
    for (let t = 1; t < ARC_TICKS; t++) {
      stepLitter(field);
      expect(isLitterCollectable(field, i)).toBe(false);
      expect(collectLitter(field, i)).toBe(false);
      expect(field.y[i]).toBe(8);
    }
    expect(field.count).toBe(1);
    stepLitter(field);
    expect(isLitterCollectable(field, i)).toBe(true);
    const moved = (field.x[i] as number) - 10.4;
    expect(moved).toBeGreaterThanOrEqual(FLING.minDistanceM);
    expect(moved).toBeLessThan(FLING.maxDistanceM);
    expect(field.y[i]).toBe(8);
    expect([field.vx[i], field.vy[i]]).toEqual([0, 0]);
    stepLitter(field); // stays put once landed
    expect(field.x[i]).toBe(10.4 + moved);
    expect(collectLitter(field, i)).toBe(true);
  });

  it('flings to the left when the item is on the sweeper’s left, for any heading', () => {
    const rng = createStream(2, 'brush');
    for (const headingRad of [0, 0.7, Math.PI / 2, 2.5, Math.PI, 4, -0.9]) {
      for (const localX of [-0.6, 0.6]) {
        const field = newField();
        const right = { x: Math.cos(headingRad), y: Math.sin(headingRad) };
        const fwd = { x: Math.sin(headingRad), y: -Math.cos(headingRad) };
        const source: FlingSource = { xM: 16, yM: 16, headingRad };
        const x0 = 16 + right.x * localX + fwd.x * 1.8;
        const y0 = 16 + right.y * localX + fwd.y * 1.8;
        const i = addLitter(field, CAN, x0, y0, 0);
        flungOnce(field, i, source, rng);
        for (let t = 0; t < ARC_TICKS; t++) stepLitter(field);
        const dx = (field.x[i] as number) - x0;
        const dy = (field.y[i] as number) - y0;
        const along = dx * right.x + dy * right.y;
        const across = dx * fwd.x + dy * fwd.y;
        expect(Math.sign(along)).toBe(Math.sign(localX));
        expect(Math.abs(along)).toBeGreaterThanOrEqual(FLING.minDistanceM - 1e-9);
        expect(Math.abs(along)).toBeLessThan(FLING.maxDistanceM);
        expect(Math.abs(across)).toBeLessThan(1e-9);
        expect(field.cellOf[i]).toBe(litterCellIndex(field, i));
      }
    }
  });

  it('draws exactly one number from the brush stream and ignores an item already in the air', () => {
    const field = newField();
    const i = addLitter(field, CAN, 10.4, 8, 0);
    const rng = createStream(3, 'brush');
    const twin = createStream(3, 'brush');
    flungOnce(field, i, north, rng);
    nextFloat(twin);
    expect(rng).toEqual(twin);
    expect(flingLitter(field, i, north, rng)).toBe(false);
    expect(rng).toEqual(twin);
  });

  it('clears IN_SUCTION, PINNED and drift when flung', () => {
    const field = newField();
    const i = addLitter(field, NEWSPAPER, 10.4, 8, 0);
    startLitterDrift(field, { x: 0, y: 1 });
    field.flags[i] = LitterFlag.InSuction | LitterFlag.Pinned;
    flungOnce(field, i, north, createStream(4, 'brush'));
    expect(field.flags[i]).toBe(LitterFlag.Flung);
    expect(field.driftTicks[i]).toBe(0);
  });

  it('hands a landed glass bottle to the flung hook, which may remove it', () => {
    const field = newField();
    const glass = addLitter(field, GLASS, 10.4, 8, 0);
    const can = addLitter(field, CAN, 9.6, 8, 0);
    const other = addLitter(field, CAN, 3, 3, 0);
    field.vx[other] = 6; // a one-tick push, to prove the swapped-in item is still stepped this tick
    const calls: [number, string, number, number][] = [];
    field.onFlungLand = (f, index, hazard) => {
      calls.push([index, hazard, f.x[index] as number, f.y[index] as number]);
      removeLitter(f, index);
      return true;
    };
    const rng = createStream(5, 'brush');
    flungOnce(field, glass, north, rng);
    flungOnce(field, can, north, rng);
    for (let t = 1; t < ARC_TICKS; t++) {
      field.vx[other] = 0;
      stepLitter(field);
    }
    field.vx[other] = 6;
    const xOther = field.x[other] as number;
    stepLitter(field);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toBe(glass);
    expect(calls[0]?.[1]).toBe('haz.broken_glass');
    expect(field.count).toBe(2);
    // The last item (other) moved into the glass bottle's slot and was stepped exactly once.
    expect(field.x[glass]).toBeCloseTo(xOther + 6 / SIM_HZ, 12);
    expect(field.kind[can]).toBe(CAN);
    expect(field.flags[can]).toBe(0);
    expect(field.litterSpawned).toBe(3);
    expect(field.litterCollected).toBe(0);
  });

  it('lands a glass bottle as litter while no hook is attached (no hazard store until M3)', () => {
    const field = newField();
    const glass = addLitter(field, GLASS, 10.4, 8, 0);
    flungOnce(field, glass, north, createStream(6, 'brush'));
    for (let t = 0; t < ARC_TICKS; t++) stepLitter(field);
    expect(field.count).toBe(1);
    expect(isLitterCollectable(field, glass)).toBe(true);
  });
});

describe('drift hook', () => {
  it('moves newspapers and crisp packets 1.5 m/s for 4 s along the gust, and nothing else', () => {
    const field = newField(createBlankLevel('test', 32, 32));
    const ids = LITTER_IDS;
    for (let k = 0; k < ids.length; k++) addLitter(field, k, 4 + k * 2, 4, 0);
    const started = startLitterDrift(field, { x: 3, y: 4 }); // normalised to (0.6, 0.8)
    expect(started).toBe(2);
    const ticks = 4 * SIM_HZ;
    for (let t = 0; t < ticks + 30; t++) stepLitter(field);
    for (let k = 0; k < ids.length; k++) {
      const dx = (field.x[k] as number) - (4 + k * 2);
      const dy = (field.y[k] as number) - 4;
      if (ids[k] === 'litter.newspaper' || ids[k] === 'litter.crisp_packet') {
        expect(dx).toBeCloseTo(1.5 * 4 * 0.6, 9);
        expect(dy).toBeCloseTo(1.5 * 4 * 0.8, 9);
        expect(field.driftTicks[k]).toBe(0);
        expect([field.vx[k], field.vy[k]]).toEqual([0, 0]);
      } else {
        expect([dx, dy]).toEqual([0, 0]);
      }
      expect(field.cellOf[k]).toBe(litterCellIndex(field, k));
    }
  });

  it('ignores a zero direction and flung items', () => {
    const field = newField();
    const i = addLitter(field, NEWSPAPER, 10.4, 8, 0);
    expect(startLitterDrift(field, { x: 0, y: 0 })).toBe(0);
    flingLitter(field, i, { xM: 10, yM: 10, headingRad: 0 }, createStream(1, 'brush'));
    expect(startLitterDrift(field, { x: 1, y: 0 })).toBe(0);
  });
});

describe('shift-start spawn on Puddle Lane (LEVEL_DESIGN §9.1)', () => {
  const spec = PUDDLE_LANE.litter;
  if (spec === null) throw new Error('Puddle Lane has no litter spec');

  it('places litter.initial (130) items, on every seed tried', () => {
    expect(spec.initial).toBe(130);
    const field = newField(PUDDLE_LANE);
    for (let seed = 0; seed < 40; seed++) {
      expect(spawnInitialLitter(field, PUDDLE_LANE, seed * 7919 + 1)).toBe(130);
      expect(field.count).toBe(130);
      expect(field.litterSpawned).toBe(130);
      expect(field.litterCollected).toBe(0);
    }
  });

  it('gives identical stores for the same seed and a different layout for a different seed', () => {
    const a = newField(PUDDLE_LANE);
    const b = newField(PUDDLE_LANE);
    spawnInitialLitter(a, PUDDLE_LANE, 12345);
    spawnInitialLitter(b, PUDDLE_LANE, 12345);
    expect(snapshot(b)).toEqual(snapshot(a));
    // Re-spawning into a used field starts from scratch.
    addLitter(b, CRISP, 1, 1, 0);
    spawnInitialLitter(b, PUDDLE_LANE, 12345);
    expect(snapshot(b)).toEqual(snapshot(a));
    const c = newField(PUDDLE_LANE);
    spawnInitialLitter(c, PUDDLE_LANE, 12346);
    expect(snapshot(c).x).not.toEqual(snapshot(a).x);
  });

  it('respects minSpacingM, the per-tile cap and the type constraints, on spawnable sub-cells only', () => {
    const w = PUDDLE_LANE.size[0];
    const cellsW = w * LITTER_CELLS_PER_TILE;
    const requires = new Map(spec.table.map((e) => [LITTER_IDS.indexOf(e.id as LitterId), e.requires]));
    const field = newField(PUDDLE_LANE);
    const rots = new Set<number>();
    const kinds = new Set<number>();
    for (const seed of [1, 2, 3, 99, 4242]) {
      spawnInitialLitter(field, PUDDLE_LANE, seed);
      const perTile = new Map<number, number>();
      for (let i = 0; i < field.count; i++) {
        const x = field.x[i] as number;
        const y = field.y[i] as number;
        for (let j = 0; j < i; j++) {
          const d = Math.hypot((field.x[j] as number) - x, (field.y[j] as number) - y);
          expect(d).toBeGreaterThanOrEqual(spec.minSpacingM);
        }
        const tile = Math.floor(y / TILE_M) * w + Math.floor(x / TILE_M);
        perTile.set(tile, (perTile.get(tile) ?? 0) + 1);
        const sub = Math.floor(y / LITTER_CELL_M) * cellsW + Math.floor(x / LITTER_CELL_M);
        expect(spec.weights[sub]).toBeGreaterThan(0);
        const kind = field.kind[i] as number;
        const req = requires.get(kind);
        expect(req).toBeDefined();
        expect((spec.places[sub] as number) & (req as number)).toBe(req);
        if (LITTER_IDS[kind] === 'litter.dog_mess') {
          // Dog mess only on pavements and grass (grass is never route area, so pavement).
          expect([Ground.Pavement, Ground.Grass]).toContain(PUDDLE_LANE.layers.ground[tile]);
        }
        expect(field.cellOf[i]).toBe(litterCellIndex(field, i));
        rots.add(field.rot[i] as number);
        kinds.add(kind);
      }
      expect(Math.max(...perTile.values())).toBeLessThanOrEqual(LITTER_MAX_PER_TILE);
    }
    expect([...rots].sort()).toEqual([0, 1, 2, 3]);
    expect(kinds.size).toBe(spec.table.length);
  });
});

describe('shift-start spawn on a synthetic level', () => {
  /** A 6 × 6 tile level whose litter field puts random place bits and weights on every sub-cell. */
  function synthetic(initial: number, seed: number, weightOn: (sub: number) => boolean): Level {
    const level = createBlankLevel('test', 6, 6);
    const n = litterFieldLength(6, 6);
    const places = new Uint8Array(n);
    const weights = new Uint16Array(n);
    const rng = sfc32(seed);
    for (let k = 0; k < n; k++) {
      places[k] = Math.floor(nextFloat(rng) * 16);
      weights[k] = weightOn(k) ? 1 + Math.floor(nextFloat(rng) * 65535) : 0;
    }
    level.litter = {
      initial,
      minSpacingM: 0.5,
      table: [
        { id: 'litter.bin_bag', weight: 5, requires: LITTER_PLACE.NEAR_KERB },
        { id: 'litter.crisp_packet', weight: 30, requires: 0 },
        { id: 'litter.dog_mess', weight: 8, requires: LITTER_PLACE.PAVEMENT },
        { id: 'litter.leaf_pile', weight: 10, requires: LITTER_PLACE.NEAR_TREE },
      ],
      places,
      weights,
    };
    return level;
  }

  it('puts leaf piles near trees, bin bags near kerbs and dog mess on pavements only', () => {
    const counts = new Map<string, number>();
    for (let seed = 1; seed <= 20; seed++) {
      const level = synthetic(40, seed, () => true);
      const spec = level.litter;
      if (spec === null) throw new Error('unreachable');
      const field = newField(level);
      expect(spawnInitialLitter(field, level, seed)).toBe(40);
      const cellsW = 6 * LITTER_CELLS_PER_TILE;
      for (let i = 0; i < field.count; i++) {
        const sub =
          Math.floor((field.y[i] as number) / LITTER_CELL_M) * cellsW +
          Math.floor((field.x[i] as number) / LITTER_CELL_M);
        const places = spec.places[sub] as number;
        const id = LITTER_IDS[field.kind[i] as number] as string;
        counts.set(id, (counts.get(id) ?? 0) + 1);
        if (id === 'litter.leaf_pile') expect(places & LITTER_PLACE.NEAR_TREE).not.toBe(0);
        if (id === 'litter.bin_bag') expect(places & LITTER_PLACE.NEAR_KERB).not.toBe(0);
        if (id === 'litter.dog_mess') expect(places & LITTER_PLACE.PAVEMENT).not.toBe(0);
      }
    }
    expect(counts.size).toBe(4);
  });

  it('caps a tile at 6 items and stops when the weight runs out', () => {
    // All the weight on tile (2, 2): 16 sub-cells, but only 6 items may go there.
    const level = synthetic(50, 9, (sub) => {
      const cx = sub % 24;
      const cy = Math.floor(sub / 24);
      return Math.floor(cx / 4) === 2 && Math.floor(cy / 4) === 2;
    });
    const field = newField(level);
    expect(spawnInitialLitter(field, level, 9)).toBe(LITTER_MAX_PER_TILE);
    for (let i = 0; i < field.count; i++) {
      expect(Math.floor((field.x[i] as number) / TILE_M)).toBe(2);
      expect(Math.floor((field.y[i] as number) / TILE_M)).toBe(2);
    }
  });

  it('places nothing on a level without a litter spec', () => {
    const field = newField();
    addLitter(field, CRISP, 1, 1, 0);
    expect(spawnInitialLitter(field, createBlankLevel('empty', 4, 4), 1)).toBe(0);
    expect(field.count).toBe(0);
    expect(field.litterSpawned).toBe(0);
  });
});

describe('zero allocation per tick (TECHNICAL_DESIGN §17)', () => {
  it('steps, queries, flings and pushes 2,000 items without growing the heap', () => {
    const level = createBlankLevel('stress', 64, 48);
    const field = newField(level);
    const rng = sfc32(11);
    const brush = createStream(11, 'brush');
    for (let i = 0; i < LITTER_CAPACITY; i++) {
      addLitter(field, i % LITTER_IDS.length, 2 + nextFloat(rng) * 124, 2 + nextFloat(rng) * 92, i % 4);
    }
    field.onFlungLand = () => false;
    const out = new Int32Array(field.capacity);
    const source = { xM: 64.5, yM: 48.5, headingRad: 0.5 };
    const local: Aabb = box(-1.3, 1.6, 1.3, 2.8);
    const world: Aabb = box(0.5, 0.5, 0.5, 0.5);
    const gust = { x: 0.5, y: -0.25 };
    const step = (tick: number): void => {
      beginLitterTick(field);
      source.headingRad = (tick % 628) * 0.01;
      source.xM = 20.5 + (tick % 80);
      localRectToWorldAabb(source, local, world);
      const n = queryLitter(field, world, out);
      for (let h = 0; h < n; h++) {
        const i = out[h] as number;
        if (isLitterCollectable(field, i)) field.vx[i] = -0.5;
      }
      if (tick % 7 === 0) flingLitter(field, tick % field.count, source, brush);
      if (tick % 240 === 0) startLitterDrift(field, gust);
      stepLitter(field);
      // Keep everything on the map so the pattern stays steady.
      for (let i = 0; i < field.count; i++) {
        if ((field.x[i] as number) < 1 || (field.x[i] as number) > 127) {
          field.x[i] = 64;
          updateLitterCell(field, i);
        }
        if ((field.y[i] as number) < 1 || (field.y[i] as number) > 95) {
          field.y[i] = 48;
          updateLitterCell(field, i);
        }
      }
    };
    for (let tick = 0; tick < 30_000; tick++) step(tick);
    const delta = measureHeapDelta((tick) => step(30_000 + tick));
    assertHeapDeltaWithinThresholds(delta);
    expect(field.count).toBe(LITTER_CAPACITY);
  });
});
