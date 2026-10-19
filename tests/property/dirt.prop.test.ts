// Grime mask properties (SSP-060; TECHNICAL_DESIGN §10.3, §18.2):
//   - driving straight with the brush collecting, at any speed up to 6.0 m/s (0.1 m per tick, against a 0.9 m
//     deep footprint) and any heading, leaves no uncleaned non-gutter cell whose centre lies inside the swept
//     band, and never touches a gutter cell when no kerb is near;
//   - every tick, the dirty rectangle is exactly the bounding box of the cells that tick changed (so it
//     contains every one of them), empty when none changed, and the per-tick and shift counters match the
//     cells that changed, over random masks, random kerb layouts and random poses.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DT_S, GRIME_CELL_M, TILE_M } from '../../src/sim/constants.ts';
import { createDirt, GRIME_GUTTER_BIT, hasDirtyRect, stepDirt } from '../../src/sim/dirt.ts';
import { COLLIDE, createBlankLevel } from '../../src/sim/map.ts';
import { nextFloat, nextInt, sfc32 } from '../../src/sim/rng.ts';
import { DEFAULT_TUNING } from '../../src/sim/tuning.ts';
import { createVehicleState } from '../../src/sim/vehicle.ts';
import { assertProperty } from '../support/fcCheck.ts';

const FP = DEFAULT_TUNING.sweeping.grimeFootprint;
const SWEEPER = DEFAULT_TUNING.vehicle.sweeper;
/** Margin for "inside the band": keeps cells whose centre sits on the band's edge (to rounding) out of the check. */
const EDGE_EPS_M = 1e-9;

describe('straight-line sweeping leaves no gaps (TECHNICAL_DESIGN §10.3)', () => {
  it('clears every non-gutter cell whose centre is inside the swept band, at ≤ 6.0 m/s and any heading', () => {
    const tiles = 24; // 48 m square
    const level = createBlankLevel('band', tiles, tiles);
    const dirt = createDirt(level, DEFAULT_TUNING);
    const maskW = dirt.maskW;
    assertProperty(
      fc.property(
        fc.double({ min: 0, max: 2 * Math.PI, noNaN: true, maxExcluded: true }),
        fc.oneof(fc.constant(6.0), fc.double({ min: 0.01, max: 6.0, noNaN: true })),
        fc.double({ min: 18, max: 30, noNaN: true }),
        fc.double({ min: 18, max: 30, noNaN: true }),
        fc.integer({ min: 2, max: 90 }),
        fc.integer({ min: 0, max: 0xffffffff }),
        (heading, speedMps, x0, y0, ticks, maskSeed) => {
          // Ordinary grime everywhere, with about one gutter cell in five.
          const rng = sfc32(maskSeed);
          for (let i = 0; i < dirt.mask.length; i++) {
            dirt.mask[i] = nextFloat(rng) < 0.2 ? GRIME_GUTTER_BIT | 90 : 1 + nextInt(rng, 127);
          }
          const before = dirt.mask.slice();
          const fx = Math.sin(heading);
          const fy = -Math.cos(heading);
          const pose = createVehicleState(SWEEPER, x0, y0, heading);
          const stepM = speedMps * DT_S;
          for (let k = 0; k < ticks; k++) {
            pose.xM = x0 + fx * stepM * k;
            pose.yM = y0 + fy * stepM * k;
            stepDirt(dirt, pose, true);
          }
          const travelM = stepM * (ticks - 1);
          for (let i = 0; i < dirt.mask.length; i++) {
            const was = before[i] as number;
            if ((was & GRIME_GUTTER_BIT) !== 0) {
              if (dirt.mask[i] !== was) return false; // no kerb anywhere: gutter grime stays
              continue;
            }
            const dx = ((i % maskW) + 0.5) * GRIME_CELL_M - x0;
            const dy = (Math.floor(i / maskW) + 0.5) * GRIME_CELL_M - y0;
            const lateral = dx * Math.cos(heading) + dy * Math.sin(heading);
            const along = dx * fx + dy * fy;
            const inBand =
              lateral >= FP.minXM + EDGE_EPS_M &&
              lateral <= FP.maxXM - EDGE_EPS_M &&
              along >= FP.minYM + EDGE_EPS_M &&
              along <= travelM + FP.maxYM - EDGE_EPS_M;
            if (inBand && dirt.mask[i] !== 0) return false;
          }
          return true;
        },
      ),
      { seed: 60_001, numRuns: 300 },
    );
  });
});

describe('the dirty rectangle and counters (TECHNICAL_DESIGN §10.3)', () => {
  it('is the bounding box of every cell changed that tick, and the counters match', () => {
    const tiles = 12; // 24 m square, 96 × 96 cells
    const poseArb = fc.record({
      x: fc.double({ min: -3, max: 27, noNaN: true }),
      y: fc.double({ min: -3, max: 27, noNaN: true }),
      heading: fc.double({ min: -7, max: 7, noNaN: true }),
      collecting: fc.boolean(),
    });
    assertProperty(
      fc.property(
        fc.integer({ min: 0, max: 0xffffffff }),
        fc.array(poseArb, { minLength: 1, maxLength: 40 }),
        (seed, poses) => {
          const rng = sfc32(seed);
          const level = createBlankLevel('rect', tiles, tiles);
          // Random raised kerb edges, set on both tiles beside each edge as the compiler does.
          for (let t = 0; t < tiles * tiles; t++) {
            const x = t % tiles;
            const y = Math.floor(t / tiles);
            if (y > 0 && nextFloat(rng) < 0.25) {
              level.layers.collide[t] = (level.layers.collide[t] as number) | COLLIDE.KERB_EDGE_N;
              level.layers.collide[t - tiles] =
                (level.layers.collide[t - tiles] as number) | COLLIDE.KERB_EDGE_S;
            }
            if (x > 0 && nextFloat(rng) < 0.25) {
              level.layers.collide[t] = (level.layers.collide[t] as number) | COLLIDE.KERB_EDGE_W;
              level.layers.collide[t - 1] = (level.layers.collide[t - 1] as number) | COLLIDE.KERB_EDGE_E;
            }
          }
          const dirt = createDirt(level, DEFAULT_TUNING);
          for (let i = 0; i < dirt.mask.length; i++) {
            const r = nextFloat(rng);
            dirt.mask[i] =
              r < 0.2 ? 0 : r < 0.5 ? GRIME_GUTTER_BIT | (1 + nextInt(rng, 127)) : 1 + nextInt(rng, 127);
          }
          const pose = createVehicleState(SWEEPER, 0.5, 0.5, 0.5);
          let total = 0;
          let totalGutter = 0;
          for (const p of poses) {
            const before = dirt.mask.slice();
            pose.xM = p.x;
            pose.yM = p.y;
            pose.headingRad = p.heading;
            stepDirt(dirt, pose, p.collecting);
            let minX = dirt.maskW;
            let minY = dirt.maskH;
            let maxX = -1;
            let maxY = -1;
            let changed = 0;
            let changedGutter = 0;
            for (let i = 0; i < before.length; i++) {
              if (before[i] === dirt.mask[i]) continue;
              if (dirt.mask[i] !== 0) return false; // the erase only ever clears
              changed++;
              if (((before[i] as number) & GRIME_GUTTER_BIT) !== 0) changedGutter++;
              const x = i % dirt.maskW;
              const y = Math.floor(i / dirt.maskW);
              if (x < dirt.dirtyMinX || x > dirt.dirtyMaxX || y < dirt.dirtyMinY || y > dirt.dirtyMaxY)
                return false;
              minX = Math.min(minX, x);
              maxX = Math.max(maxX, x);
              minY = Math.min(minY, y);
              maxY = Math.max(maxY, y);
            }
            if (hasDirtyRect(dirt) !== changed > 0) return false;
            if (changed > 0) {
              expect([dirt.dirtyMinX, dirt.dirtyMinY, dirt.dirtyMaxX, dirt.dirtyMaxY]).toEqual([
                minX,
                minY,
                maxX,
                maxY,
              ]);
            }
            if (!p.collecting && (changed > 0 || dirt.kerbContact)) return false;
            if (changedGutter > 0 && !dirt.kerbContact) return false;
            total += changed;
            totalGutter += changedGutter;
            if (dirt.tickCleanedCells !== changed || dirt.tickCleanedGutterCells !== changedGutter)
              return false;
            if (dirt.cleanedCells !== total || dirt.cleanedGutterCells !== totalGutter) return false;
          }
          return true;
        },
      ),
      { seed: 60_002, numRuns: 200 },
    );
  });

  it('exercises gutter clearing (the kerb layouts are not vacuous)', () => {
    const level = createBlankLevel('rect', 4, 4);
    level.layers.collide[1 * 4 + 1] = COLLIDE.KERB_EDGE_N;
    level.layers.collide[0 * 4 + 1] = COLLIDE.KERB_EDGE_S;
    const dirt = createDirt(level, DEFAULT_TUNING);
    dirt.mask.fill(GRIME_GUTTER_BIT | 50);
    // Heading east along y = 2 m with the right brush centre 0.1 m north of the kerb edge (x 2..4 m).
    stepDirt(dirt, createVehicleState(SWEEPER, 1.5, TILE_M - 0.1 - 0.85, Math.PI / 2), true);
    expect(dirt.kerbContact).toBe(true);
    expect(dirt.tickCleanedGutterCells).toBeGreaterThan(0);
  });
});
