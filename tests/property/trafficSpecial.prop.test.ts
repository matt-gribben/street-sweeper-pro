// Property tests for the special traffic kinds (SSP-091; TECHNICAL_DESIGN §11.4, §18.2). Over random runs of
// the long two-way street and the one-way street (tests/support/trafficTown.ts) with taxis, bicycles and cars in
// the lanes and mobility scooters on the pavements, and Bessie dropped every few seconds at a random clear spot
// (standing in a lane, so queues build and the bicycles filter past them, or on a pavement in the scooters' way):
//   1. no two vehicles' bodies ever overlap, and no vehicle ever ends a tick overlapping Bessie, who never drives;
//   2. a bicycle's offset stays within 0..filterOffsetM, and its body stays on the road;
//   3. a taxi in a fare stop brakes at least at fareStopDecelMps2 until it stands still;
//   4. a mobility scooter stays on nav-graph tiles at no more than its 1.5 m/s.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DT_S, TILE_M } from '../../src/sim/constants.ts';
import { VEHICLE_IDS } from '../../src/sim/entities.ts';
import { createInputFrame } from '../../src/sim/inputFrame.ts';
import { Ground, type Level } from '../../src/sim/map.ts';
import { cornersOverlap, TrafficState } from '../../src/sim/traffic.ts';
import { DEFAULT_ENTITIES, DEFAULT_TUNING } from '../../src/sim/tuning.ts';
import { VEHICLE_CORNER_DOUBLES, VEHICLE_FLAG } from '../../src/sim/vehicleStore.ts';
import { createWorld, type World } from '../../src/sim/world.ts';
import { endlessShiftTuning } from '../support/endlessShift.ts';
import { assertProperty } from '../support/fcCheck.ts';
import { compileTrafficTown, LONG_STREET, ONE_WAY_STREET } from '../support/trafficTown.ts';

const RUNS = 40;
const TICKS = 1500;
const SEED = 0x55_09_1b;
const TEST_TIMEOUT_MS = 240_000;

const TOWNS: readonly Level[] = [
  compileTrafficTown(LONG_STREET, {
    densityPerKm: 25,
    mix: { 'veh.hatchback': 2, 'veh.taxi': 2, 'veh.bicycle': 3, 'veh.van_white': 1 },
    pavement: { 'veh.mobility_scooter': 2 },
  }),
  compileTrafficTown(ONE_WAY_STREET, {
    densityPerKm: 30,
    mix: { 'veh.saloon': 1, 'veh.taxi': 2, 'veh.bicycle': 3 },
    pavement: { 'veh.mobility_scooter': 2 },
  }),
];
/** Lane y positions (metres) per town, where Bessie may stand. */
const LANE_Y: readonly (readonly number[])[] = [[5.5, 8.5], [7]];

const BICYCLE = (VEHICLE_IDS as readonly string[]).indexOf('veh.bicycle');
const TAXI = (VEHICLE_IDS as readonly string[]).indexOf('veh.taxi');
const SCOOTER = (VEHICLE_IDS as readonly string[]).indexOf('veh.mobility_scooter');
const FARE_DECEL = DEFAULT_ENTITIES.vehicles['veh.taxi'].rules.fareStopDecelMps2;
const FILTER_OFF = DEFAULT_ENTITIES.vehicles['veh.bicycle'].rules.filterOffsetM;
const SWEEPER = DEFAULT_TUNING.vehicle.sweeper.body;
const SCOOTER_MPS = DEFAULT_ENTITIES.vehicles['veh.mobility_scooter'].speedMps ?? 0;

/** A double uniform on [min, max) (in steps of (max − min) / 2^20), unbiased. */
function uniform(min: number, max: number): fc.Arbitrary<number> {
  const steps = 1 << 20;
  return fc.noBias(fc.integer({ min: 0, max: steps - 1 })).map((k) => min + ((max - min) * k) / steps);
}

type Drop = { x: number; lane: number; onPavement: boolean; facing: number };
type Scenario = { town: number; seed: number; every: number; drops: Drop[] };

const scenarioArb: fc.Arbitrary<Scenario> = fc.record({
  town: fc.integer({ min: 0, max: TOWNS.length - 1 }),
  seed: fc.integer({ min: 1, max: 0x7fff_ffff }),
  every: fc.integer({ min: 120, max: 480 }),
  drops: fc.array(
    fc.record({
      x: uniform(12, 108),
      lane: fc.integer({ min: 0, max: 1 }),
      onPavement: fc.boolean(),
      facing: fc.integer({ min: 0, max: 1 }),
    }),
    { minLength: 12, maxLength: 12 },
  ),
});

function groundAt(level: Level, x: number, y: number): number {
  const tx = Math.floor(x / TILE_M);
  const ty = Math.floor(y / TILE_M);
  if (tx < 0 || ty < 0 || tx >= level.size[0] || ty >= level.size[1]) return Ground.Road; // entering, leaving
  return level.layers.ground[ty * level.size[0] + tx] as number;
}

function navTiles(level: Level): Set<number> {
  const tiles = new Set<number>();
  for (let n = 0; n < level.nav.nodeCount; n++) {
    const tx = Math.floor((level.nav.nodeX[n] as number) / TILE_M);
    const ty = Math.floor((level.nav.nodeY[n] as number) / TILE_M);
    tiles.add(ty * level.size[0] + tx);
  }
  return tiles;
}

/** Put Bessie at rest at (x, y) facing east or west (no kerb crossing: the previous pose moves too). */
function putBessie(w: World, x: number, y: number, heading: number): void {
  const v = w.vehicle;
  v.xM = x;
  v.yM = y;
  v.prevXM = x;
  v.prevYM = y;
  v.headingRad = heading;
  v.prevHeadingRad = heading;
  v.vLongMps = 0;
  v.vLatMps = 0;
  v.yawRateRadPerS = 0;
}

/** Bessie's body corners at (x, y, heading) (obbCorners order) into `out`. */
function bessieCorners(x: number, y: number, heading: number, out: Float64Array): void {
  const body = { w: SWEEPER.widthM / 2, l: SWEEPER.lengthM / 2 };
  const s = Math.sin(heading);
  const c = Math.cos(heading);
  const rx = c * body.w;
  const ry = s * body.w;
  const fx = s * body.l;
  const fy = -c * body.l;
  out.set([
    x + rx + fx,
    y + ry + fy,
    x + rx - fx,
    y + ry - fy,
    x - rx - fx,
    y - ry - fy,
    x - rx + fx,
    y - ry + fy,
  ]);
}

describe('special traffic kinds (SSP-091)', () => {
  it(
    `${RUNS} runs × ${TICKS} ticks: no overlaps, bicycles on the road within their offset, taxis brake within their rule, scooters on the nav graph`,
    () => {
      const cov = { filtering: 0, fareStops: 0, scooterTicks: 0, drops: 0 };
      assertProperty(
        fc.property(scenarioArb, (sc) => {
          const level = TOWNS[sc.town] as Level;
          const nav = navTiles(level);
          const w = createWorld(level, sc.seed, endlessShiftTuning());
          const input = createInputFrame();
          const s = w.vehicles;
          const probe = new Float64Array(VEHICLE_CORNER_DOUBLES);
          const lanes = LANE_Y[sc.town] as readonly number[];
          // Bessie starts on the north pavement.
          putBessie(w, 60, 3, Math.PI / 2);
          const prevSpeed = new Map<number, number>();
          for (let tick = 0; tick < TICKS; tick++) {
            if (tick % sc.every === 0) {
              const d = sc.drops[(tick / sc.every) % sc.drops.length] as Drop;
              const y = d.onPavement ? 3 : (lanes[d.lane % lanes.length] as number);
              const h = d.facing === 0 ? Math.PI / 2 : -Math.PI / 2;
              bessieCorners(d.x, y, h, probe);
              let clear = true;
              for (let j = 0; j < s.count; j++) {
                if (cornersOverlap(probe, 0, s.corners, j * VEHICLE_CORNER_DOUBLES)) clear = false;
              }
              if (clear) {
                putBessie(w, d.x, y, h);
                cov.drops += 1;
              }
            }
            w.step(input);
            const bessie = w.traffic.bessieCorners;
            for (let i = 0; i < s.count; i++) {
              const oi = i * VEHICLE_CORNER_DOUBLES;
              for (let j = i + 1; j < s.count; j++) {
                if (cornersOverlap(s.corners, oi, s.corners, j * VEHICLE_CORNER_DOUBLES)) {
                  throw new Error(
                    `tick ${tick}: vehicles ${i} (kind ${s.kind[i]}) and ${j} (kind ${s.kind[j]}) overlap`,
                  );
                }
              }
              const kind = s.kind[i] as number;
              const x = s.x[i] as number;
              const y = s.y[i] as number;
              const uid = s.uid[i] as number;
              const v = s.speed[i] as number;
              if (kind !== SCOOTER && cornersOverlap(s.corners, oi, bessie, 0)) {
                throw new Error(`tick ${tick}: vehicle ${i} (kind ${kind}) overlaps Bessie`);
              }
              if (kind === BICYCLE) {
                const lat = s.lateral[i] as number;
                expect(lat).toBeGreaterThanOrEqual(0);
                expect(lat).toBeLessThanOrEqual(FILTER_OFF);
                if (lat > 0) cov.filtering += 1;
                for (let c = 0; c < 4; c++) {
                  const g = groundAt(
                    level,
                    s.corners[oi + 2 * c] as number,
                    s.corners[oi + 2 * c + 1] as number,
                  );
                  if (g < Ground.Road || g > Ground.RoadOneWayS) {
                    throw new Error(`tick ${tick}: bicycle ${i} corner ${c} off the road (ground ${g})`);
                  }
                }
              }
              if (kind === TAXI) {
                const p = prevSpeed.get(uid);
                // In a fare stop it brakes at least at fareStopDecelMps2 (harder only behind something) until it stands.
                if (p !== undefined && s.state[i] === TrafficState.FareStop) {
                  expect(p - v).toBeGreaterThanOrEqual(Math.min(p, FARE_DECEL * DT_S) - 1e-9);
                }
                if (s.state[i] === TrafficState.FareStop && s.stateTicks[i] === 1) cov.fareStops += 1;
              }
              if (kind === SCOOTER) {
                cov.scooterTicks += 1;
                expect((s.flags[i] as number) & VEHICLE_FLAG.PAVEMENT).toBe(VEHICLE_FLAG.PAVEMENT);
                expect(v).toBeLessThanOrEqual(SCOOTER_MPS);
                const tile = Math.floor(y / TILE_M) * level.size[0] + Math.floor(x / TILE_M);
                if (!nav.has(tile))
                  throw new Error(`tick ${tick}: scooter ${i} off the nav graph at ${x}, ${y}`);
              }
              prevSpeed.set(uid, v);
            }
          }
        }),
        { seed: SEED, numRuns: RUNS },
      );
      expect(cov.filtering).toBeGreaterThan(500);
      expect(cov.fareStops).toBeGreaterThan(5);
      expect(cov.scooterTicks).toBeGreaterThan(RUNS * TICKS);
      expect(cov.drops).toBeGreaterThan(RUNS);
    },
    TEST_TIMEOUT_MS,
  );
});
