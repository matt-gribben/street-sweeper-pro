// Tidy % and frontage properties (SSP-064; TECHNICAL_DESIGN §18.2, GDD §9.2, §9.3), over random maps, random
// (overlapping) frontage zones, random grime masks and litter, and random ticks of real stepDirt sweeps,
// collections, flings, dynamic spawns and removals:
//   - Tidy % and every frontage's clean % stay in [0, 1];
//   - neither ever decreases across a tick in which no litter is spawned (nothing in the sim adds grime);
//   - the incremental zone counters always equal a brute-force recount (grime from the mask, litter from the
//     spawn tile of every item ever added), and the global Tidy % equals the formula on the global counters;
//   - Clean Sweep is awarded exactly once to each non-empty frontage that has been spotless at the end of a
//     tick, never to any other, and scores cleanSweepPts each; the stars match the stars helper.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { TILE_M } from '../../src/sim/constants.ts';
import { createDirt, GRIME_GUTTER_BIT, stepDirt } from '../../src/sim/dirt.ts';
import {
  addLitter,
  collectLitter,
  createLitterField,
  removeLitter,
  updateLitterCell,
} from '../../src/sim/litter.ts';
import { createBlankLevel, type Frontage, GUTTER_CELLS_PER_TILE } from '../../src/sim/map.ts';
import { createScoring } from '../../src/sim/scoring.ts';
import { createTidy, initTidy, starsForTidy, stepTidy, tidyFraction } from '../../src/sim/tidy.ts';
import { DEFAULT_ENTITIES, DEFAULT_TUNING } from '../../src/sim/tuning.ts';
import { createVehicleState } from '../../src/sim/vehicle.ts';
import { assertProperty } from '../support/fcCheck.ts';

const TW = 6;
const TH = 4;
const PTS = DEFAULT_TUNING.scoring.cleanSweepPts;

const tileArb = fc.tuple(fc.integer({ min: 0, max: TW - 1 }), fc.integer({ min: 0, max: TH - 1 }));
/** A position in metres, sometimes a little off the map. */
const posArb = fc.tuple(
  fc.double({ min: -1, max: TW * TILE_M + 1, noNaN: true }),
  fc.double({ min: -1, max: TH * TILE_M + 1, noNaN: true }),
);

const opArb = fc.oneof(
  {
    weight: 4,
    arbitrary: fc.record({
      kind: fc.constant('sweep' as const),
      x: fc.double({ min: 0, max: TW * TILE_M, noNaN: true }),
      y: fc.double({ min: 0, max: TH * TILE_M, noNaN: true }),
      heading: fc.double({ min: 0, max: 2 * Math.PI, noNaN: true }),
    }),
  },
  { weight: 3, arbitrary: fc.record({ kind: fc.constant('collect' as const), pick: fc.nat() }) },
  // Sweep one whole tile clean (a 2 m-wide pass heading north) and collect the items that spawned on it, so
  // zones do become spotless and Clean Sweep is exercised.
  { weight: 3, arbitrary: fc.record({ kind: fc.constant('scrub' as const), tile: tileArb }) },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('pickTile' as const), tile: tileArb }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('move' as const), pick: fc.nat(), to: posArb }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('remove' as const), pick: fc.nat() }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('spawn' as const), at: posArb }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('spawnIn' as const), tile: tileArb }) },
);

describe('Tidy % properties (TECHNICAL_DESIGN §18.2)', () => {
  it('stays in [0, 1], never falls without spawns, matches a recount and awards Clean Sweep once', () => {
    assertProperty(
      fc.property(
        fc.array(fc.array(tileArb, { minLength: 1, maxLength: 4 }), { minLength: 0, maxLength: 6 }),
        fc.array(fc.oneof(fc.constant(0), fc.integer({ min: 0, max: 7 })), {
          minLength: TW * TH,
          maxLength: TW * TH,
        }),
        fc.integer({ min: 0, max: 0xffffffff }),
        fc.array(posArb, { maxLength: 12 }),
        fc.array(fc.array(opArb, { maxLength: 4 }), { minLength: 1, maxLength: 60 }),
        (zones, tileGrime, maskSeed, initialLitter, ticks) => {
          const level = createBlankLevel('prop', TW, TH);
          level.frontages = zones.map(
            (cells, z): Frontage => ({
              id: `fr_${z}`,
              pledge: z % 2 === 0,
              rect: [0, 0, TW, TH],
              face: 'n',
              cells: cells.map(([x, y]) => [x, y]),
            }),
          );
          const dirt = createDirt(level, DEFAULT_TUNING);
          // Each tile gets 0..7 eighths of its cells grimy. In the tiles at 7 about one cell in eight is gutter
          // grime, which no sweep here clears (there are no kerbs), so zones holding them are never spotless.
          let h = maskSeed >>> 0;
          for (let t = 0; t < TW * TH; t += 1) {
            const share = tileGrime[t] as number;
            const tx = t % TW;
            const ty = Math.floor(t / TW);
            for (let k = 0; k < 64; k += 1) {
              h = (Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) + k) >>> 0;
              if (h % 8 >= share) continue;
              const cx = tx * GUTTER_CELLS_PER_TILE + (k % 8);
              const cy = ty * GUTTER_CELLS_PER_TILE + Math.floor(k / 8);
              dirt.mask[cy * dirt.maskW + cx] =
                share === 7 && (h >>> 8) % 8 === 0 ? GRIME_GUTTER_BIT | 90 : 90;
              dirt.initialCells += 1;
            }
          }
          const initialMask = dirt.mask.slice();
          const field = createLitterField(level, DEFAULT_TUNING, DEFAULT_ENTITIES);
          // The model: every item ever added, by spawn tile, and whether it was collected.
          const spawnTiles: number[] = [];
          const collected: boolean[] = [];
          const ids: number[] = []; // live slot → model id
          const tileOf = (x: number, y: number): number => {
            const c = Math.floor(x / TILE_M);
            const r = Math.floor(y / TILE_M);
            return c >= 0 && r >= 0 && c < TW && r < TH ? r * TW + c : -1;
          };
          const spawn = (x: number, y: number): void => {
            const i = addLitter(field, 0, x, y, 0);
            if (i < 0) return;
            ids[i] = spawnTiles.length;
            spawnTiles.push(tileOf(x, y));
            collected.push(false);
          };
          /** Mirror a swap-remove of slot i in the model's slot map. */
          const swapOut = (i: number): void => {
            ids[i] = ids[field.count] as number;
          };
          for (const [x, y] of initialLitter) spawn(x, y);

          const tidy = createTidy(level, DEFAULT_TUNING);
          initTidy(tidy, dirt, field);
          const scoring = createScoring(DEFAULT_TUNING, DEFAULT_ENTITIES);
          const pose = createVehicleState(DEFAULT_TUNING.vehicle.sweeper, 0, 0, 0);
          const everSpotless = new Array<boolean>(zones.length).fill(false);
          const zoneTiles = level.frontages.map((f) => new Set(f.cells.map(([x, y]) => y * TW + x)));

          let prevTidy = tidy.tidy;
          let prevClean = [...tidy.frontageClean];
          for (const ops of ticks) {
            let spawned = false;
            for (const op of ops) {
              if (op.kind === 'sweep') {
                pose.xM = op.x;
                pose.yM = op.y;
                pose.headingRad = op.heading;
                stepDirt(dirt, pose, true);
              } else if (op.kind === 'scrub') {
                pose.headingRad = 0;
                pose.xM = op.tile[0] * TILE_M + 1;
                for (let y = op.tile[1] * TILE_M + 1.25; y <= op.tile[1] * TILE_M + 4.5; y += 0.25) {
                  pose.yM = y;
                  stepDirt(dirt, pose, true);
                }
              } else if (op.kind === 'pickTile') {
                const t = op.tile[1] * TW + op.tile[0];
                for (let i = field.count - 1; i >= 0; i -= 1) {
                  if (field.spawnTile[i] !== t) continue;
                  const id = ids[i] as number;
                  if (collectLitter(field, i)) {
                    collected[id] = true;
                    swapOut(i);
                  }
                }
              } else if (op.kind === 'spawn' || op.kind === 'spawnIn') {
                if (op.kind === 'spawn') spawn(op.at[0], op.at[1]);
                else spawn((op.tile[0] + 0.5) * TILE_M, (op.tile[1] + 0.5) * TILE_M);
                spawned = true;
              } else if (field.count > 0) {
                const i = op.pick % field.count;
                if (op.kind === 'collect') {
                  const id = ids[i] as number;
                  if (collectLitter(field, i)) {
                    collected[id] = true;
                    swapOut(i);
                  }
                } else if (op.kind === 'remove') {
                  removeLitter(field, i);
                  swapOut(i);
                } else {
                  field.x[i] = op.to[0];
                  field.y[i] = op.to[1];
                  updateLitterCell(field, i);
                }
              }
            }
            stepTidy(tidy, dirt, field, scoring);

            // Ranges and monotonicity.
            if (!(tidy.tidy >= 0 && tidy.tidy <= 1)) return false;
            if (!spawned && tidy.tidy < prevTidy) return false;
            for (let z = 0; z < zones.length; z += 1) {
              const c = tidy.frontageClean[z] as number;
              if (!(c >= 0 && c <= 1)) return false;
              if (!spawned && c < (prevClean[z] as number)) return false;
            }
            prevTidy = tidy.tidy;
            prevClean = [...tidy.frontageClean];

            // The counters against a recount.
            expect(tidy.tidy).toBe(
              tidyFraction(
                DEFAULT_TUNING.tidy,
                dirt.cleanedCells,
                dirt.initialCells,
                field.litterCollected,
                field.litterSpawned,
              ),
            );
            expect(tidy.stars).toBe(starsForTidy(tidy.tidy, DEFAULT_TUNING.stars));
            for (let z = 0; z < zones.length; z += 1) {
              const tiles = zoneTiles[z] as Set<number>;
              let gi = 0;
              let gc = 0;
              for (const t of tiles) {
                const tx = t % TW;
                const ty = Math.floor(t / TW);
                for (let cy = ty * 8; cy < ty * 8 + 8; cy += 1) {
                  for (let cx = tx * 8; cx < tx * 8 + 8; cx += 1) {
                    const i = cy * dirt.maskW + cx;
                    if (initialMask[i] !== 0) {
                      gi += 1;
                      if (dirt.mask[i] === 0) gc += 1;
                    }
                  }
                }
              }
              let ls = 0;
              let lc = 0;
              for (let id = 0; id < spawnTiles.length; id += 1) {
                if (!tiles.has(spawnTiles[id] as number)) continue;
                ls += 1;
                if (collected[id]) lc += 1;
              }
              expect([
                tidy.zones.grimeInitial[z],
                tidy.zones.grimeCleaned[z],
                tidy.zones.litterSpawned[z],
                tidy.zones.litterCollected[z],
              ]).toEqual([gi, gc, ls, lc]);
              if (gi + ls > 0 && gc === gi && lc === ls) everSpotless[z] = true;
              expect(tidy.cleanSwept[z]).toBe(everSpotless[z] ? 1 : 0);
              expect(tidy.frontageClean[z]).toBe(tidyFraction(DEFAULT_TUNING.tidy, gc, gi, lc, ls));
            }
            expect(scoring.bonusPts).toBe(tidy.cleanSweeps * PTS);
            expect(tidy.cleanSweeps).toBe(everSpotless.filter(Boolean).length);
          }
          return true;
        },
      ),
      { seed: 0x5590_0064, numRuns: 300 },
    );
  });
});
