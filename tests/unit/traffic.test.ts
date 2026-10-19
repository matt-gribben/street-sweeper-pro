// Traffic (src/sim/traffic.ts, SSP-089; TECHNICAL_DESIGN §11.4, ENTITY_CATALOG §8.2–§8.3, LEVEL_DESIGN §9.5):
// lane following and car following behind a stationary Bessie, the Queue/Honk/RoadRage block timer (car honks
// at 180, 360 and 540 ticks, one Road Rage complaint at tick 601 of a block, one per block), car honks kept
// out of the horn-spam window and the NPC stimuli, bus dwell at every stop of the route, zebra stop lines,
// the kerb gap hook, spawning and despawning off world.viewRect, and determinism. Worlds are compiled towns
// (tests/support/trafficTown.ts) run through the full World.step.
import { describe, expect, it, vi } from 'vitest';
import { Offence } from '../../src/sim/complaints.ts';
import { VEHICLE_IDS } from '../../src/sim/entities.ts';
import { EV } from '../../src/sim/eventQueue.ts';
import { createInputFrame } from '../../src/sim/inputFrame.ts';
import { type Level, NAV_FLAG } from '../../src/sim/map.ts';
import { absorbTick, createStateHasher, stateHash } from '../../src/sim/replay.ts';
import {
  cornersOverlap,
  cornersTouchViewRect,
  TrafficState,
  trafficCrossingClear,
} from '../../src/sim/traffic.ts';
import { DEFAULT_TUNING, type Tuning } from '../../src/sim/tuning.ts';
import {
  addVehicle,
  Blocker,
  VEHICLE_CAPACITY,
  VEHICLE_CORNER_DOUBLES,
  VEHICLE_FLAG,
  type VehicleStore,
} from '../../src/sim/vehicleStore.ts';
import { createWorld, Phase, type World } from '../../src/sim/world.ts';
import { endlessShiftTuning } from '../support/endlessShift.ts';
import { CROSSROADS, compileTrafficTown, ONE_WAY_STREET, type TownTraffic } from '../support/trafficTown.ts';

// Every swap-remove of a vehicle goes through this hook, so the despawn test sees each body as it leaves.
const removals = vi.hoisted(() => ({
  check: null as null | ((store: VehicleStore, i: number) => void),
}));
vi.mock('../../src/sim/vehicleStore.ts', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/sim/vehicleStore.ts')>();
  return {
    ...mod,
    removeVehicle: (store: VehicleStore, i: number): void => {
      removals.check?.(store, i);
      mod.removeVehicle(store, i);
    },
  };
});

const ONE_CAR: TownTraffic = { densityPerKm: 5, mix: { 'veh.hatchback': 1 } };
const BESSIE = DEFAULT_TUNING.vehicle.sweeper.body;

const levels = new Map<string, Level>();
function town(rows: readonly string[], traffic: TownTraffic): Level {
  const key = `${rows.join('/')}|${JSON.stringify(traffic)}`;
  let level = levels.get(key);
  if (level === undefined) {
    level = compileTrafficTown(rows, traffic);
    levels.set(key, level);
  }
  return level;
}

function makeWorld(
  rows: readonly string[],
  traffic: TownTraffic,
  seed = 1,
  tuning: Tuning = endlessShiftTuning(),
): World {
  return createWorld(town(rows, traffic), seed, tuning);
}

/** Put Bessie at rest at (x, y) facing `headingRad` (no kerb crossing: the previous pose moves too). */
function placeBessie(w: World, x: number, y: number, headingRad = Math.PI / 2): void {
  const v = w.vehicle;
  v.xM = x;
  v.yM = y;
  v.prevXM = x;
  v.prevYM = y;
  v.headingRad = headingRad;
  v.prevHeadingRad = headingRad;
  v.vLongMps = 0;
  v.vLatMps = 0;
  v.yawRateRadPerS = 0;
}

const idle = createInputFrame();

/** Events of `type` in the tick just run. */
function eventsOf(w: World, type: number): number[] {
  const out: number[] = [];
  for (let k = 0; k < w.events.count; k++) if (w.events.type[k] === type) out.push(k);
  return out;
}

/** The index of the live vehicle with spawn serial `uid`, or −1. */
function indexOfUid(w: World, uid: number): number {
  for (let i = 0; i < w.vehicles.count; i++) if (w.vehicles.uid[i] === uid) return i;
  return -1;
}

/** Bessie's rear bumper minus vehicle i's front bumper, along the eastbound lane (metres). */
function gapToBessie(w: World, i: number): number {
  return (
    w.vehicle.xM - BESSIE.lengthM / 2 - ((w.vehicles.x[i] as number) + (w.vehicles.halfLength[i] as number))
  );
}

type BlockRun = {
  world: World;
  /** World tick of block tick 1 (the first tick Bessie held the car). */
  t0: number;
  horns: { tick: number; honk: number; entity: number }[];
  rage: number[];
  /** Horn-side counters seen after every tick. */
  maxStimuli: number;
  hornEvents: number;
  minGap: number;
  overlapped: boolean;
};

/**
 * One car on the one-way street meets Bessie standing in its lane at (61, 7); run until the block has lasted
 * `blockTicks` ticks. Every tick checks the gap, the overlap, the car horns, the Road Rage complaints and the
 * horn-side state.
 */
function runBlock(blockTicks: number): BlockRun {
  const world = makeWorld(ONE_WAY_STREET, ONE_CAR);
  const run: BlockRun = {
    world,
    t0: -1,
    horns: [],
    rage: [],
    maxStimuli: 0,
    hornEvents: 0,
    minGap: Number.POSITIVE_INFINITY,
    overlapped: false,
  };
  for (let guard = 0; guard < 20_000; guard++) {
    const tick = world.tick;
    world.step(idle);
    observe(run, tick);
    if (run.t0 >= 0 && tick - run.t0 + 1 >= blockTicks) return run;
  }
  throw new Error('runBlock: the car never reached Bessie');
}

function observe(run: BlockRun, tick: number): void {
  const w = run.world;
  const store = w.vehicles;
  for (let i = 0; i < store.count; i++) {
    run.minGap = Math.min(run.minGap, gapToBessie(w, i));
    if (cornersOverlap(store.corners, i * VEHICLE_CORNER_DOUBLES, w.traffic.bessieCorners, 0))
      run.overlapped = true;
    if (run.t0 < 0 && store.blockTicks[i] === 1) run.t0 = tick;
  }
  for (const k of eventsOf(w, EV.CarHorn)) {
    run.horns.push({ tick, honk: w.events.c[k] as number, entity: w.events.entity[k] as number });
  }
  for (const k of eventsOf(w, EV.Complaint)) if (w.events.c[k] === Offence.RoadRage) run.rage.push(tick);
  run.hornEvents += eventsOf(w, EV.Horn).length;
  run.maxStimuli = Math.max(run.maxStimuli, w.npcAi.stimuli.count);
}

describe('traffic: lane following and car following (SSP-089)', () => {
  it('a car approaching a stationary Bessie in its lane stops with gap ≥ 2.5 m and never overlaps her', () => {
    const run = runBlock(120);
    const w = run.world;
    expect(w.vehicles.count).toBe(1);
    expect(w.vehicles.speed[0]).toBe(0);
    // It came all the way along the lane (spawned off the map at the west portal) at the lane's speed.
    expect(w.vehicles.uid[0]).toBe(0);
    expect(w.vehicles.y[0]).toBeCloseTo(7, 9);
    expect(run.minGap).toBeGreaterThanOrEqual(DEFAULT_TUNING.streetLife.traffic.followGapM);
    expect(gapToBessie(w, 0)).toBeLessThan(DEFAULT_TUNING.streetLife.traffic.followGapM + 0.05);
    expect(run.overlapped).toBe(false);
    expect(w.vehicles.blocker[0]).toBe(Blocker.Bessie);
    expect(w.vehicles.state[0]).toBe(TrafficState.Queue);
  });

  it('follows another vehicle the same way: a queue of two, only its head keeps the block timer', () => {
    const world = makeWorld(ONE_WAY_STREET, { densityPerKm: 10, mix: { 'veh.saloon': 1 } });
    expect(world.traffic.movingTarget).toBe(2);
    let minFollowGap = Number.POSITIVE_INFINITY;
    for (let t = 0; t < 1500; t++) {
      world.step(idle);
      const s = world.vehicles;
      if (s.count === 2) {
        const [head, tail] = (s.x[0] as number) > (s.x[1] as number) ? [0, 1] : [1, 0];
        const gap =
          (s.x[head] as number) -
          (s.halfLength[head] as number) -
          ((s.x[tail] as number) + (s.halfLength[tail] as number));
        minFollowGap = Math.min(minFollowGap, gap);
        expect(cornersOverlap(s.corners, 0, s.corners, VEHICLE_CORNER_DOUBLES)).toBe(false);
      }
    }
    const s = world.vehicles;
    expect(s.count).toBe(2);
    const [head, tail] = (s.x[0] as number) > (s.x[1] as number) ? [0, 1] : [1, 0];
    expect(minFollowGap).toBeGreaterThanOrEqual(DEFAULT_TUNING.streetLife.traffic.followGapM);
    expect(s.blocker[head]).toBe(Blocker.Bessie);
    expect(s.blocker[tail]).toBe(Blocker.Vehicle);
    expect(s.state[tail]).toBe(TrafficState.Queue);
    expect(s.blockTicks[tail]).toBe(0);
    expect(s.blockTicks[head]).toBeGreaterThan(600);
    expect(world.complaints.count).toBe(1);
  });
});

describe('traffic: honk and Road Rage (ENTITY_CATALOG §8.3, AUDIO_DESIGN §5.5)', () => {
  it('honks at block ticks 180, 360 and 540 and files exactly 1 Road Rage complaint at tick 601', () => {
    const run = runBlock(601);
    expect(run.t0).toBeGreaterThan(0);
    expect(run.horns.map((h) => h.tick - run.t0 + 1)).toEqual([180, 360, 540]);
    expect(run.horns.map((h) => h.honk)).toEqual([1, 2, 3]);
    expect(run.horns.every((h) => h.entity === 0)).toBe(true);
    expect(run.rage.map((t) => t - run.t0 + 1)).toEqual([601]);
    expect(run.world.complaints.count).toBe(1);
    expect(run.world.traffic.roadRageOffences).toBe(1);
    expect(run.world.vehicles.state[0]).toBe(TrafficState.RoadRage);
  });

  it('is in Queue before 3 s of the block, Honk from 3 s and RoadRage after 10 s', () => {
    const states: number[] = [];
    const world = makeWorld(ONE_WAY_STREET, ONE_CAR);
    let t0 = -1;
    for (let t = 0; t < 4000 && (t0 < 0 || t - t0 < 700); t++) {
      world.step(idle);
      if (world.vehicles.count > 0) {
        if (t0 < 0 && world.vehicles.blockTicks[0] === 1) t0 = t;
        if (t0 >= 0) states[t - t0 + 1] = world.vehicles.state[0] as number;
      }
    }
    expect(states[179]).toBe(TrafficState.Queue);
    expect(states[180]).toBe(TrafficState.Honk);
    expect(states[600]).toBe(TrafficState.Honk);
    expect(states[601]).toBe(TrafficState.RoadRage);
  });

  it('staying blocked to 1,200 ticks adds no second complaint; clearing and re-blocking for > 600 ticks adds another', () => {
    const run = runBlock(1200);
    const w = run.world;
    expect(run.rage).toHaveLength(1);
    expect(run.horns).toHaveLength(3);
    expect(w.complaints.count).toBe(1);
    // Clear the path: Bessie pulls onto the pavement and the car drives on.
    placeBessie(w, 61, 11);
    for (let t = 0; t < 120; t++) {
      const tick = w.tick;
      w.step(idle);
      observe(run, tick);
    }
    expect(w.vehicles.blockTicks[0]).toBe(0);
    expect(w.vehicles.state[0]).toBe(TrafficState.Cruise);
    expect(w.vehicles.speed[0]).toBeGreaterThan(1);
    // Block it again, 12 m ahead of its front bumper: a new block, a new timer and a second complaint.
    placeBessie(
      w,
      (w.vehicles.x[0] as number) + (w.vehicles.halfLength[0] as number) + 12 + BESSIE.lengthM / 2,
      7,
    );
    let t1 = -1;
    for (let t = 0; t < 2000 && (t1 < 0 || w.tick - t1 < 601); t++) {
      const tick = w.tick;
      w.step(idle);
      observe(run, tick);
      if (t1 < 0 && w.vehicles.blockTicks[0] === 1) t1 = tick;
    }
    expect(t1).toBeGreaterThan(0);
    expect(run.rage).toHaveLength(2);
    expect((run.rage[1] as number) - t1 + 1).toBe(601);
    expect(run.horns.slice(3).map((h) => h.tick - t1 + 1)).toEqual([180, 360, 540]);
    expect(w.complaints.count).toBe(2);
    expect(run.overlapped).toBe(false);
  });

  it("car honks never change the player's horn-spam count and never reach the NPCs as a Horn", () => {
    const run = runBlock(1200);
    const c = run.world.complaints;
    expect(run.horns).toHaveLength(3);
    expect(c.honks).toBe(0);
    expect(c.honkCount).toBe(0);
    expect(c.noiseOffences).toBe(0);
    expect(run.hornEvents).toBe(0);
    expect(run.maxStimuli).toBe(0);
    expect(run.world.npcAi.stimuli.delivered).toBe(0);
  });
});

describe('traffic: buses (ENTITY_CATALOG §8.2, LEVEL_DESIGN §9.5)', () => {
  it('a bus stops 300 ticks at each bus stop on its route', () => {
    const world = makeWorld(ONE_WAY_STREET, {
      densityPerKm: 0,
      mix: { 'veh.hatchback': 1 },
      busRoute: ['1', '2'],
      busEveryS: 45,
    });
    placeBessie(world, 61, 11);
    expect(world.traffic.busRouteLen).toBeGreaterThan(50);
    const dwellTicks = new Map<number, number>();
    const frontAt = new Map<number, number>();
    let spawnTick = -1;
    let gone = -1;
    for (let t = 0; t < 5000 && gone < 0; t++) {
      world.step(idle);
      const i = indexOfUid(world, 0);
      if (i < 0) {
        if (spawnTick >= 0) gone = t;
        continue;
      }
      if (spawnTick < 0) spawnTick = t;
      const s = world.vehicles;
      expect((s.flags[i] as number) & VEHICLE_FLAG.BUS_ROUTE).toBe(VEHICLE_FLAG.BUS_ROUTE);
      if (s.state[i] === TrafficState.Dwell && s.x[i] === s.prevX[i]) {
        const stop = s.servedStop[i] as number;
        dwellTicks.set(stop, (dwellTicks.get(stop) ?? 0) + 1);
        frontAt.set(stop, (s.x[i] as number) + (s.halfLength[i] as number));
      }
    }
    // The first bus is due at firstBusS (20 s) and enters at once (Bessie is far from the west portal).
    expect(spawnTick).toBe(Math.round(DEFAULT_TUNING.streetLife.traffic.firstBusS * 60));
    expect(gone).toBeGreaterThan(spawnTick);
    expect([...dwellTicks.values()]).toEqual([300, 300]);
    // Its front stands on each stop's last lane node: x = 27 m (columns 10–13) and 87 m (columns 40–43).
    expect([...frontAt.values()].map((x) => Math.round(x * 1e6) / 1e6)).toEqual([27, 87]);
    expect(world.traffic.busesSpawned).toBe(1);
  });
});

describe('traffic: zebras and the kerb gap check (TECHNICAL_DESIGN §11.4, §11.1)', () => {
  it('cars stop at the line of an occupied zebra and proceed once it is clear', () => {
    const world = makeWorld(ONE_WAY_STREET, ONE_CAR);
    placeBessie(world, 100, 11);
    let occupied = true;
    world.phaseTrace = (phase) => {
      // Phase 7 recounted the zebra; hold it occupied for phase 8 as a pedestrian on it would.
      if (phase === Phase.Traffic && occupied) world.zebras.occupancy[0] = 1;
    };
    const line = 49; // the from node of the zebra's lane edge (49 → 51 m); the stripes are 50–52 m.
    let stoppedTicks = 0;
    for (let t = 0; t < 1200; t++) {
      world.step(idle);
      expect(world.vehicles.count).toBe(1);
      const front = (world.vehicles.x[0] as number) + (world.vehicles.halfLength[0] as number);
      expect(front).toBeLessThanOrEqual(line + 1e-9);
      if (world.vehicles.speed[0] === 0) stoppedTicks++;
    }
    expect(stoppedTicks).toBeGreaterThan(600);
    expect(world.vehicles.blocker[0]).toBe(Blocker.Crossing);
    expect(world.vehicles.state[0]).toBe(TrafficState.Queue);
    expect(world.vehicles.blockTicks[0]).toBe(0); // a zebra is not Bessie: no honks, no Road Rage
    const front = (world.vehicles.x[0] as number) + (world.vehicles.halfLength[0] as number);
    expect(front).toBeGreaterThan(line - 0.01);
    occupied = false;
    for (let t = 0; t < 300; t++) world.step(idle);
    expect(world.vehicles.count).toBe(1);
    expect(world.vehicles.x[0] as number).toBeGreaterThan(60);
    expect(world.vehicles.state[0]).toBe(TrafficState.Cruise);
    expect(world.traffic.carHorns).toBe(0);
    expect(world.complaints.count).toBe(0);
  });

  it('the kerb gap hook holds a pedestrian while a vehicle is on or coming to the crossing', () => {
    const world = makeWorld(ONE_WAY_STREET, ONE_CAR);
    placeBessie(world, 100, 11);
    const nav = world.level.nav;
    const crossing = (flag: number): number => {
      for (let e = 0; e < nav.edgeCount; e++) if ((nav.edgeFlags[e] as number) & flag) return e;
      throw new Error('no crossing');
    };
    const zebra = crossing(NAV_FLAG.ZEBRA);
    const dropped = crossing(NAV_FLAG.DROPPED_KERB);
    expect(world.npcAi.steering.crossingClear).toBe(trafficCrossingClear);
    // No vehicles yet: clear.
    expect(trafficCrossingClear(world, 0, zebra)).toBe(true);
    const seen = { zebraHeld: 0, zebraClear: 0, droppedHeld: 0, onZebra: 0 };
    for (let t = 0; t < 2400; t++) {
      world.step(idle);
      if (world.vehicles.count === 0) continue;
      const s = world.vehicles;
      const v = s.speed[0] as number;
      const front = (s.x[0] as number) + (s.halfLength[0] as number);
      const rear = (s.x[0] as number) - (s.halfLength[0] as number);
      // The zebra's corridor spans x 50–52 m (±1 m about the crossing line x = 51 m).
      const zebraD = 50 - front;
      const zClear = trafficCrossingClear(world, 0, zebra);
      if (rear < 52 && front > 50) {
        expect(zClear).toBe(false);
        seen.onZebra++;
      } else if (zebraD > 0 && v > 0) {
        expect(zClear).toBe(zebraD >= (v * v) / 6 + v);
      }
      if (zebraD > 0 && zClear) seen.zebraClear++;
      if (zebraD > 0 && !zClear) seen.zebraHeld++;
      const droppedD = 70 - front;
      const dClear = trafficCrossingClear(world, 0, dropped);
      if (droppedD > 0 && droppedD < v * 3 + 2.5) {
        expect(dClear).toBe(false);
        seen.droppedHeld++;
      }
      if (front < 0 || rear > 72) expect(dClear).toBe(true);
    }
    expect(seen.onZebra).toBeGreaterThan(10);
    expect(seen.zebraHeld).toBeGreaterThan(10);
    expect(seen.zebraClear).toBeGreaterThan(10);
    expect(seen.droppedHeld).toBeGreaterThan(10);
  });

  it('a standing vehicle never holds a zebra, but holds a dropped-kerb crossing it stands at', () => {
    const nav = town(ONE_WAY_STREET, ONE_CAR).nav;
    let zebra = -1;
    let dropped = -1;
    for (let e = 0; e < nav.edgeCount; e++) {
      if ((nav.edgeFlags[e] as number) & NAV_FLAG.ZEBRA) zebra = e;
      if ((nav.edgeFlags[e] as number) & NAV_FLAG.DROPPED_KERB) dropped = e;
    }
    // Held at the occupied zebra's line, 1 m short of its stripes, the standing car leaves the zebra clear.
    const atZebra = makeWorld(ONE_WAY_STREET, ONE_CAR);
    placeBessie(atZebra, 100, 11);
    atZebra.phaseTrace = (phase) => {
      if (phase === Phase.Traffic) atZebra.zebras.occupancy[0] = 1;
    };
    for (let t = 0; t < 1200; t++) atZebra.step(idle);
    expect(atZebra.vehicles.speed[0]).toBe(0);
    expect(trafficCrossingClear(atZebra, 0, zebra)).toBe(true);
    // Queued behind Bessie with its front 0.5 m short of the dropped kerb's corridor (x 69–71 m): held.
    const atKerb = makeWorld(ONE_WAY_STREET, ONE_CAR);
    placeBessie(atKerb, 69 - 0.5 + DEFAULT_TUNING.streetLife.traffic.followGapM + BESSIE.lengthM / 2, 7);
    for (let t = 0; t < 1200; t++) atKerb.step(idle);
    const s = atKerb.vehicles;
    expect(s.speed[0]).toBe(0);
    expect((s.x[0] as number) + (s.halfLength[0] as number)).toBeCloseTo(68.5, 3);
    expect(trafficCrossingClear(atKerb, 0, dropped)).toBe(false);
    expect(trafficCrossingClear(atKerb, 0, zebra)).toBe(true); // it is past the zebra
  });
});

describe('traffic: spawning and despawning (LEVEL_DESIGN §9.5, TECHNICAL_DESIGN §7.4)', () => {
  it('no vehicle spawns or despawns while its OBB intersects viewRect; vehicles never overlap', {
    timeout: 30_000,
  }, () => {
    const traffic: TownTraffic = {
      densityPerKm: 40,
      mix: { 'veh.hatchback': 2, 'veh.saloon': 1, 'veh.van_white': 1 },
    };
    const world = makeWorld(CROSSROADS, traffic, 7);
    expect(world.traffic.movingTarget).toBe(14);
    // Bessie hops between spots on and off the roads, near the middle and near each map edge, so the view rect
    // covers the portals for part of the run and none of them for the rest.
    const spots: readonly [number, number][] = [
      [61, 31],
      [40, 11],
      [6, 26],
      [40, 52],
      [74, 26],
      [26, 26],
      [12, 36],
      [55, 36],
    ];
    let despawns = 0;
    let offRectDespawns = 0;
    removals.check = (store, i) => {
      despawns++;
      if (!cornersTouchViewRect(store.corners, i * VEHICLE_CORNER_DOUBLES, world.viewRect)) offRectDespawns++;
    };
    try {
      const known = new Set<number>();
      let spawns = 0;
      let onRectSpawns = 0;
      let overlaps = 0;
      let maxMoving = 0;
      for (let t = 0; t < 7200; t++) {
        if (t % 400 === 0) {
          const [x, y] = spots[(t / 400) % spots.length] as [number, number];
          placeBessie(world, x, y, 0);
        }
        world.step(idle);
        const s = world.vehicles;
        maxMoving = Math.max(maxMoving, s.count - s.parkedCount);
        expect(s.count - s.parkedCount).toBeLessThanOrEqual(VEHICLE_CAPACITY - s.parkedCount);
        expect(s.count).toBeLessThanOrEqual(world.traffic.movingTarget);
        const live = new Set<number>();
        for (let i = 0; i < s.count; i++) {
          const uid = s.uid[i] as number;
          live.add(uid);
          if (!known.has(uid)) {
            spawns++;
            if (cornersTouchViewRect(s.corners, i * VEHICLE_CORNER_DOUBLES, world.viewRect)) onRectSpawns++;
          }
          for (let j = i + 1; j < s.count; j++) {
            if (
              cornersOverlap(s.corners, i * VEHICLE_CORNER_DOUBLES, s.corners, j * VEHICLE_CORNER_DOUBLES)
            ) {
              overlaps++;
            }
          }
        }
        known.clear();
        for (const uid of live) known.add(uid);
      }
      console.log(`traffic soak: ${spawns} spawns, ${despawns} despawns, at most ${maxMoving} moving`);
      expect(onRectSpawns).toBe(0);
      expect(despawns).toBe(offRectDespawns);
      expect(overlaps).toBe(0);
      expect(spawns).toBeGreaterThan(40);
      expect(despawns).toBeGreaterThan(30);
      expect(maxMoving).toBe(14);
      expect(world.vehicles.vehiclesAdded).toBe(spawns);
    } finally {
      removals.check = null;
    }
  });

  it('never spawns past the moving budget, 30 − parked', () => {
    // SSP-090 parks the cars; until then stand 20 parked ones far off the map, out of everyone's way.
    const world = makeWorld(CROSSROADS, { densityPerKm: 40, mix: { 'veh.hatchback': 1 } }, 3);
    const s = world.vehicles as VehicleStore;
    for (let k = 0; k < 20; k++) {
      const i = addVehicle(s, VEHICLE_IDS.indexOf('veh.hatchback_parked'), VEHICLE_FLAG.PARKED);
      s.x[i] = -200 - 10 * k;
      s.y[i] = -200;
    }
    expect(s.parkedCount).toBe(20);
    expect(world.traffic.movingTarget).toBe(14);
    let max = 0;
    for (let t = 0; t < 3000; t++) {
      world.step(idle);
      const moving = s.count - s.parkedCount;
      max = Math.max(max, moving);
      expect(moving).toBeLessThanOrEqual(VEHICLE_CAPACITY - s.parkedCount);
      expect(s.parkedCount).toBe(20);
    }
    expect(max).toBe(VEHICLE_CAPACITY - 20);
  });

  it('a level without a traffic spec has no traffic', () => {
    const world = makeWorld(ONE_WAY_STREET, ONE_CAR);
    expect(world.traffic.active).toBe(true);
    const level = { ...town(ONE_WAY_STREET, ONE_CAR), traffic: null };
    const none = createWorld(level, 1, DEFAULT_TUNING);
    expect(none.traffic.active).toBe(false);
    for (let t = 0; t < 300; t++) none.step(idle);
    expect(none.vehicles.count).toBe(0);
  });
});

describe('traffic: junction boxes', () => {
  it('keeps traffic flowing through a busy crossroads: no gridlock, no starved turn, no overlaps', {
    timeout: 30_000,
  }, () => {
    const world = makeWorld(
      CROSSROADS,
      // Cars and vans: a 7.25 m bus turning through a 3-tile junction sweeps the queues on the next arm (see
      // TECHNICAL_DESIGN §11.4: buses run on main roads).
      { densityPerKm: 40, mix: { 'veh.hatchback': 2, 'veh.saloon': 1, 'veh.van_white': 1 } },
      5,
    );
    // Bessie parks on a pavement corner block, out of everyone's way.
    placeBessie(world, 10, 10);
    const stillSince = new Map<number, number>();
    let worstStillTicks = 0;
    let sharedBoxTicks = 0;
    let overlaps = 0;
    const ticks = 12_000;
    for (let t = 0; t < ticks; t++) {
      world.step(idle);
      const s = world.vehicles;
      for (let i = 0; i < s.count; i++) {
        const uid = s.uid[i] as number;
        if ((s.speed[i] as number) > 0.01) stillSince.delete(uid);
        else if (!stillSince.has(uid)) stillSince.set(uid, t);
        worstStillTicks = Math.max(worstStillTicks, t - (stillSince.get(uid) ?? t));
        for (let j = i + 1; j < s.count; j++) {
          if (cornersOverlap(s.corners, i * VEHICLE_CORNER_DOUBLES, s.corners, j * VEHICLE_CORNER_DOUBLES))
            overlaps++;
        }
      }
      let holders = 0;
      for (let k = 0; k < world.traffic.boxHolder.length; k++)
        if ((world.traffic.boxHolder[k] as number) >= 0) holders++;
      if (holders > 1) sharedBoxTicks++;
    }
    const through = world.vehicles.vehiclesRemoved;
    console.log(
      `crossroads flow: ${through} vehicles through in ${ticks / 60} s, longest standstill ${worstStillTicks} ticks, ` +
        `box shared on ${sharedBoxTicks} ticks`,
    );
    expect(overlaps).toBe(0);
    expect(world.traffic.boxCount).toBe(1);
    expect(through).toBeGreaterThan(60);
    // Non-conflicting movements share the box (opposing straight-on and left turns).
    expect(sharedBoxTicks).toBeGreaterThan(1000);
    // Nobody waits a minute: the claim lets a turn across a busy stream through.
    expect(worstStillTicks).toBeLessThan(3600);
  });
});

describe('traffic: determinism (TECHNICAL_DESIGN §7.4)', () => {
  it('the same seed gives the same traffic, and the traffic stream is its own', () => {
    const hashOf = (seed: number): number => {
      const world = makeWorld(
        CROSSROADS,
        { densityPerKm: 40, mix: { 'veh.hatchback': 1, 'veh.bus': 1 } },
        seed,
      );
      const hasher = createStateHasher(seed);
      for (let t = 0; t < 2400; t++) {
        world.step(idle);
        absorbTick(hasher, world);
      }
      return stateHash(hasher);
    };
    expect(hashOf(11)).toBe(hashOf(11));
    expect(hashOf(11)).not.toBe(hashOf(12));
  });
});
