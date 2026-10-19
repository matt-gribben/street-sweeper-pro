// LitterField spatial hash properties (SSP-057, TECHNICAL_DESIGN §10.2, §18.2):
//
//   - for random item sets and random boxes, queryLitter returns exactly the items a brute-force scan of the
//     store finds (as a set; the hash order is its own, deterministic one);
//   - for random sequences of adds, removes (swap-remove and collect), moves and fling arcs, the hash stays
//     consistent after every operation: each live item is listed exactly once, in the cell its position maps
//     to, the lists' prev/next links agree, no dead slot is listed, and queries still match brute force;
//   - a flung item lands 1.5–3 m sideways on the side of its vehicle-local x, for any pose.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Aabb } from '../../src/sim/collision/obb.ts';
import { SIM_HZ } from '../../src/sim/constants.ts';
import { LITTER_IDS } from '../../src/sim/entities.ts';
import {
  addLitter,
  collectLitter,
  createLitterField,
  flingLitter,
  type LitterField,
  litterCellIndex,
  queryLitter,
  removeLitter,
  stepLitter,
  updateLitterCell,
} from '../../src/sim/litter.ts';
import { createBlankLevel } from '../../src/sim/map.ts';
import { createStream } from '../../src/sim/rng.ts';
import { DEFAULT_ENTITIES, DEFAULT_TUNING } from '../../src/sim/tuning.ts';
import { assertProperty } from '../support/fcCheck.ts';

/** A 20 × 15 tile level: 40 × 30 m, a 10 × 8 hash (the last row is half a cell). */
const LEVEL = createBlankLevel('prop', 20, 15);
const W_M = 40;
const H_M = 30;
const FLING = DEFAULT_TUNING.sweeping.fling;

function newField(capacity = 400): LitterField {
  return createLitterField(LEVEL, DEFAULT_TUNING, DEFAULT_ENTITIES, capacity);
}

/** Positions mostly on the map, some just off it (they clamp into edge cells), some exactly on cell edges. */
const coordArb = (max: number): fc.Arbitrary<number> =>
  fc.oneof(
    { weight: 6, arbitrary: fc.double({ min: 0, max, noNaN: true }) },
    { weight: 2, arbitrary: fc.integer({ min: 0, max: Math.floor(max / 4) }).map((c) => c * 4) },
    { weight: 1, arbitrary: fc.double({ min: -6, max: max + 6, noNaN: true }) },
  );
const pointArb = fc.record({ x: coordArb(W_M), y: coordArb(H_M) });
const boxArb: fc.Arbitrary<Aabb> = fc.record({ a: pointArb, b: pointArb }).map(({ a, b }) => ({
  minX: Math.min(a.x, b.x),
  minY: Math.min(a.y, b.y),
  maxX: Math.max(a.x, b.x),
  maxY: Math.max(a.y, b.y),
}));

function bruteForce(field: LitterField, box: Aabb): number[] {
  const out: number[] = [];
  for (let i = 0; i < field.count; i++) {
    const x = field.x[i] as number;
    const y = field.y[i] as number;
    if (x >= box.minX && x <= box.maxX && y >= box.minY && y <= box.maxY) out.push(i);
  }
  return out;
}

function hashed(field: LitterField, box: Aabb, out: Int32Array): number[] {
  const n = queryLitter(field, box, out);
  return Array.from(out.subarray(0, n)).sort((p, q) => p - q);
}

/** Throws unless the hash lists exactly the live items, each once, in the cell of its position. */
function checkHash(field: LitterField): void {
  const seen = new Uint8Array(field.capacity);
  let listed = 0;
  for (let cell = 0; cell < field.cellHead.length; cell++) {
    let prev = -1;
    for (let i = field.cellHead[cell] as number; i >= 0; i = field.cellNext[i] as number) {
      expect(i).toBeLessThan(field.count);
      expect(seen[i]).toBe(0);
      seen[i] = 1;
      listed++;
      expect(field.cellPrev[i]).toBe(prev);
      expect(field.cellOf[i]).toBe(cell);
      expect(litterCellIndex(field, i)).toBe(cell);
      prev = i;
    }
  }
  expect(listed).toBe(field.count);
}

type Op =
  | { readonly op: 'add'; readonly x: number; readonly y: number; readonly kind: number }
  | { readonly op: 'remove'; readonly pick: number }
  | { readonly op: 'collect'; readonly pick: number }
  | { readonly op: 'move'; readonly pick: number; readonly x: number; readonly y: number }
  | { readonly op: 'nudge'; readonly pick: number; readonly dx: number; readonly dy: number }
  | { readonly op: 'fling'; readonly pick: number; readonly heading: number }
  | { readonly op: 'step'; readonly n: number }
  | { readonly op: 'query'; readonly box: Aabb };

const pickArb = fc.nat({ max: 10_000 });
const opArb: fc.Arbitrary<Op> = fc.oneof(
  {
    weight: 6,
    arbitrary: fc
      .record({ p: pointArb, kind: fc.nat({ max: LITTER_IDS.length - 1 }) })
      .map(({ p, kind }) => ({ op: 'add', x: p.x, y: p.y, kind }) as const),
  },
  { weight: 3, arbitrary: pickArb.map((pick) => ({ op: 'remove', pick }) as const) },
  { weight: 2, arbitrary: pickArb.map((pick) => ({ op: 'collect', pick }) as const) },
  {
    weight: 2,
    arbitrary: fc
      .record({ pick: pickArb, p: pointArb })
      .map(({ pick, p }) => ({ op: 'move', pick, ...p }) as const),
  },
  {
    weight: 2,
    arbitrary: fc
      .record({
        pick: pickArb,
        dx: fc.double({ min: -1, max: 1, noNaN: true }),
        dy: fc.double({ min: -1, max: 1, noNaN: true }),
      })
      .map((r) => ({ op: 'nudge', ...r }) as const),
  },
  {
    weight: 2,
    arbitrary: fc
      .record({ pick: pickArb, heading: fc.double({ min: -7, max: 7, noNaN: true }) })
      .map((r) => ({ op: 'fling', ...r }) as const),
  },
  { weight: 1, arbitrary: fc.integer({ min: 1, max: 40 }).map((n) => ({ op: 'step', n }) as const) },
  { weight: 2, arbitrary: boxArb.map((box) => ({ op: 'query', box }) as const) },
);

describe('LitterField spatial hash (property)', () => {
  it('a box query returns exactly the items a brute-force scan finds', () => {
    assertProperty(
      fc.property(
        fc.array(pointArb, { maxLength: 300 }),
        fc.array(boxArb, { minLength: 1, maxLength: 20 }),
        (points, boxes) => {
          const field = newField();
          for (const p of points) addLitter(field, 0, p.x, p.y, 0);
          const out = new Int32Array(field.capacity);
          for (const box of boxes) expect(hashed(field, box, out)).toEqual(bruteForce(field, box));
        },
      ),
      { seed: 57_001, numRuns: 300 },
    );
  });

  it('stays consistent over random add / remove / collect / move / fling sequences', () => {
    assertProperty(
      fc.property(fc.array(opArb, { maxLength: 200 }), fc.nat(), (ops, seed) => {
        const field = newField(120);
        const out = new Int32Array(field.capacity);
        const brush = createStream(seed, 'brush');
        let spawned = 0;
        let collected = 0;
        for (const o of ops) {
          const i = field.count === 0 ? -1 : ('pick' in o ? o.pick : 0) % field.count;
          switch (o.op) {
            case 'add':
              if (addLitter(field, o.kind, o.x, o.y, 0) >= 0) spawned++;
              break;
            case 'remove':
              if (i >= 0) removeLitter(field, i);
              break;
            case 'collect':
              if (i >= 0 && collectLitter(field, i)) collected++;
              break;
            case 'move':
              if (i >= 0) {
                field.x[i] = o.x;
                field.y[i] = o.y;
                updateLitterCell(field, i);
              }
              break;
            case 'nudge':
              if (i >= 0) {
                field.x[i] = (field.x[i] as number) + o.dx;
                field.y[i] = (field.y[i] as number) + o.dy;
                updateLitterCell(field, i);
              }
              break;
            case 'fling':
              if (i >= 0) flingLitter(field, i, { xM: 20, yM: 15, headingRad: o.heading }, brush);
              break;
            case 'step':
              for (let t = 0; t < o.n; t++) stepLitter(field);
              break;
            case 'query':
              expect(hashed(field, o.box, out)).toEqual(bruteForce(field, o.box));
              break;
          }
          checkHash(field);
        }
        expect(field.litterSpawned).toBe(spawned);
        expect(field.litterCollected).toBe(collected);
      }),
      { seed: 57_002, numRuns: 300 },
    );
  });

  it('a flung item lands 1.5–3 m sideways on the side of its local x', () => {
    const ticks = Math.round(FLING.arcDurationS * SIM_HZ);
    assertProperty(
      fc.property(
        fc.double({ min: -7, max: 7, noNaN: true }),
        fc.double({ min: -1.3, max: 1.3, noNaN: true }).filter((v) => Math.abs(v) > 1e-6),
        fc.double({ min: -1, max: 3, noNaN: true }),
        fc.nat(),
        (headingRad, localX, localY, seed) => {
          const field = newField(4);
          const c = Math.cos(headingRad);
          const s = Math.sin(headingRad);
          const x0 = 20 + c * localX + s * localY;
          const y0 = 15 + s * localX - c * localY;
          const i = addLitter(field, 1, x0, y0, 0);
          flingLitter(field, i, { xM: 20, yM: 15, headingRad }, createStream(seed, 'brush'));
          for (let t = 1; t < ticks; t++) {
            stepLitter(field);
            expect(collectLitter(field, i)).toBe(false);
          }
          stepLitter(field);
          const dx = (field.x[i] as number) - x0;
          const dy = (field.y[i] as number) - y0;
          const sideways = dx * c + dy * s;
          const forward = dx * s - dy * c;
          expect(sideways >= 0).toBe(localX >= 0);
          expect(Math.abs(sideways)).toBeGreaterThanOrEqual(FLING.minDistanceM - 1e-9);
          expect(Math.abs(sideways)).toBeLessThanOrEqual(FLING.maxDistanceM);
          expect(Math.abs(forward)).toBeLessThan(1e-9);
        },
      ),
      { seed: 57_003, numRuns: 300 },
    );
  });
});
