// The special M3 traffic kinds (src/sim/traffic.ts and parked.ts, SSP-091; ENTITY_CATALOG §8.2, §3.2,
// LEVEL_DESIGN §9.5, TECHNICAL_DESIGN §11.4): the taxi's abrupt fare stops, the white van parked half on the
// pavement (only beside a 2-tile pavement), the bicycle filtering past a queue without touching it, the
// mobility scooter on the pavement nav graph at 1.5 m/s, and both as actor hits (closing speed ≥ 1.0 m/s:
// scooter −500 and 2 complaints, bicycle −250 and 1; slower is a free bump). Worlds are compiled towns
// (tests/support/trafficTown.ts) run through the full World.step.
import { describe, expect, it } from 'vitest';
import { DT_S } from '../../src/sim/constants.ts';
import { NPC_IDS, VEHICLE_IDS } from '../../src/sim/entities.ts';
import { EV } from '../../src/sim/eventQueue.ts';
import { createInputFrame } from '../../src/sim/inputFrame.ts';
import { Ground, LANE_FLAG, type Level } from '../../src/sim/map.ts';
import { addNpcAt, NpcOrigin } from '../../src/sim/npc/store.ts';
import { HALF_ON_PAVEMENT_SHIFT_M } from '../../src/sim/parkingBays.ts';
import { cornersOverlap, PAVEMENT_GAP_M, spawnLaneVehicle, TrafficState } from '../../src/sim/traffic.ts';
import { DEFAULT_ENTITIES, DEFAULT_TUNING, type Tuning } from '../../src/sim/tuning.ts';
import { Blocker, VEHICLE_CORNER_DOUBLES, VEHICLE_FLAG } from '../../src/sim/vehicleStore.ts';
import { createWorld, type World } from '../../src/sim/world.ts';
import { endlessShiftTuning } from '../support/endlessShift.ts';
import {
  compileTrafficTown,
  HALF_ON_STREET,
  LONG_STREET,
  ONE_WAY_STREET,
  PARKING_STREET,
  type TownTraffic,
} from '../support/trafficTown.ts';

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

function makeWorld(rows: readonly string[], traffic: TownTraffic, seed = 1, tuning?: Tuning): World {
  return createWorld(town(rows, traffic), seed, tuning ?? endlessShiftTuning());
}

/** Put Bessie at (x, y) facing `headingRad`, moving at `vLongMps` (no kerb crossing: the previous pose moves too). */
function placeBessie(w: World, x: number, y: number, headingRad = Math.PI / 2, vLongMps = 0): void {
  const v = w.vehicle;
  v.xM = x;
  v.yM = y;
  v.prevXM = x;
  v.prevYM = y;
  v.headingRad = headingRad;
  v.prevHeadingRad = headingRad;
  v.vLongMps = vLongMps;
  v.vLatMps = 0;
  v.yawRateRadPerS = 0;
}

const idle = createInputFrame();
const kindOf = (id: string): number => (VEHICLE_IDS as readonly string[]).indexOf(id);
const TAXI = kindOf('veh.taxi');
const BICYCLE = kindOf('veh.bicycle');
const SCOOTER = kindOf('veh.mobility_scooter');
const VAN_PARKED = kindOf('veh.van_white_parked');
const FOLLOW_DECEL = DEFAULT_TUNING.streetLife.traffic.followDecelMps2;
const taxiRules = DEFAULT_ENTITIES.vehicles['veh.taxi'].rules;
const bikeRules = DEFAULT_ENTITIES.vehicles['veh.bicycle'].rules;

function overlapping(w: World, i: number, j: number): boolean {
  return cornersOverlap(
    w.vehicles.corners,
    i * VEHICLE_CORNER_DOUBLES,
    w.vehicles.corners,
    j * VEHICLE_CORNER_DOUBLES,
  );
}

function firstPortal(w: World, westToEast: boolean): number {
  const lanes = w.level.lanes;
  for (let e = 0; e < lanes.edgeCount; e++) {
    if (((lanes.edgeFlags[e] as number) & LANE_FLAG.PORTAL_IN) === 0) continue;
    const from = lanes.edgeFrom[e] as number;
    if (westToEast ? (lanes.nodeX[from] as number) === 0 : (lanes.nodeX[from] as number) > 0) return e;
  }
  throw new Error('no portal');
}

describe('veh.taxi: abrupt fare stops (SSP-091)', () => {
  it('makes at least one fare stop in a seeded 3,600-tick run, braking harder than car following', () => {
    const w = makeWorld(ONE_WAY_STREET, { densityPerKm: 5, mix: { 'veh.taxi': 1 } }, 7);
    // Bessie parked on the north pavement, out of the lane.
    placeBessie(w, 61, 3);
    const s = w.vehicles;
    let maxDecel = 0;
    let stops = 0;
    let dwellTicks = 0;
    let resumed = false;
    const prev = new Map<number, { v: number; state: number }>();
    for (let t = 0; t < 3600; t++) {
      w.step(idle);
      for (let i = 0; i < s.count; i++) {
        if (s.kind[i] !== TAXI) continue;
        const uid = s.uid[i] as number;
        const p = prev.get(uid);
        const v = s.speed[i] as number;
        const state = s.state[i] as number;
        if (state === TrafficState.FareStop) {
          // Standing at the fare stop, it is held by its own stop.
          if (v === 0) expect(s.blocker[i]).toBe(Blocker.FareStop);
          if (p !== undefined && p.state !== TrafficState.FareStop) stops++;
          if (p !== undefined) maxDecel = Math.max(maxDecel, (p.v - v) / DT_S);
          if (v === 0) dwellTicks++;
        } else if (p?.state === TrafficState.FareStop) {
          resumed = true;
        }
        prev.set(uid, { v, state });
      }
    }
    expect(stops).toBeGreaterThanOrEqual(1);
    expect(w.traffic.fareStops).toBeGreaterThanOrEqual(stops);
    expect(maxDecel).toBeGreaterThan(FOLLOW_DECEL);
    expect(maxDecel).toBeCloseTo(taxiRules.fareStopDecelMps2, 6);
    // It stands for the fare (3 s) and drives on.
    expect(dwellTicks).toBeGreaterThanOrEqual(Math.round(taxiRules.fareStopDwellS * 60));
    expect(resumed).toBe(true);
  });

  it('never makes a fare stop on a zebra, a bus stop or a portal edge', () => {
    const w = makeWorld(ONE_WAY_STREET, { densityPerKm: 5, mix: { 'veh.taxi': 1 } }, 3);
    placeBessie(w, 61, 3);
    const s = w.vehicles;
    const lanes = w.level.lanes;
    const banned = LANE_FLAG.ZEBRA | LANE_FLAG.BUS_STOP | LANE_FLAG.PORTAL_IN | LANE_FLAG.PORTAL_OUT;
    let checked = 0;
    for (let t = 0; t < 7200; t++) {
      w.step(idle);
      for (let i = 0; i < s.count; i++) {
        if (s.state[i] !== TrafficState.FareStop || s.stateTicks[i] !== 1) continue;
        const n = s.planLen[i] as number;
        for (let k = 0; k < Math.min(n, 3); k++) {
          const e = s.plan[i * 32 + k] as number;
          const fromX = lanes.nodeX[lanes.edgeFrom[e] as number] as number;
          // Every edge from its rear to where it stops is plain.
          if (fromX <= (s.x[i] as number) + (s.halfLength[i] as number) + 7)
            expect((lanes.edgeFlags[e] as number) & banned).toBe(0);
        }
        checked++;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(2);
  });
});

describe('veh.van_white_parked: half on the pavement (SSP-091)', () => {
  const traffic: TownTraffic = {
    densityPerKm: 0,
    mix: {},
    parkedFill: 1,
    parkedMix: { 'veh.van_white_parked': 1, 'veh.hatchback_parked': 1 },
  };

  function groundAt(level: Level, x: number, y: number): number {
    return level.layers.ground[Math.floor(y / 2) * level.size[0] + Math.floor(x / 2)] as number;
  }

  it('parks a white van beside the 2-tile pavement with its OBB over both road and pavement', () => {
    let vans = 0;
    for (const seed of [1, 2, 3, 4]) {
      const w = makeWorld(HALF_ON_STREET, traffic, seed);
      const s = w.vehicles;
      expect(s.parkedCount).toBe(10);
      for (let i = 0; i < s.count; i++) {
        if (s.kind[i] !== VAN_PARKED) continue;
        vans++;
        expect((s.flags[i] as number) & VEHICLE_FLAG.HALF_ON_PAVEMENT).toBe(VEHICLE_FLAG.HALF_ON_PAVEMENT);
        // The north bay row is row 3 (y 6–8); the kerb line is y = 6, the pavement rows 1–2 above it.
        const c = s.corners.subarray(i * VEHICLE_CORNER_DOUBLES, (i + 1) * VEHICLE_CORNER_DOUBLES);
        const ys = [c[1], c[3], c[5], c[7]] as number[];
        const minY = Math.min(...ys);
        const maxY = Math.max(...ys);
        expect(minY).toBeLessThan(6);
        expect(maxY).toBeGreaterThan(6);
        expect(groundAt(w.level, s.x[i] as number, minY + 0.01)).toBe(Ground.Pavement);
        expect(groundAt(w.level, s.x[i] as number, maxY - 0.01)).toBe(Ground.Road);
        // Its centre is on the kerb line: half a tile out of the middle of the bay row.
        expect(s.y[i]).toBeCloseTo(7 - HALF_ON_PAVEMENT_SHIFT_M, 9);
        // Its static OBB (what Bessie hits) is where it stands.
        const shape = Array.from({ length: w.staticGrid.shapeCount }, (_, k) => k).find(
          (k) => w.staticGrid.vehicleIndex[k] === i,
        );
        expect(shape).toBeDefined();
        expect(w.staticGrid.boxes[shape as number]?.cy).toBeCloseTo(s.y[i] as number, 9);
      }
    }
    expect(vans).toBeGreaterThan(0);
  });

  it('never parks a white van beside a 1-tile pavement (the south bays, and every bay of the parking street)', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const w = makeWorld(HALF_ON_STREET, traffic, seed);
      const s = w.vehicles;
      for (let i = 0; i < s.count; i++) {
        if (s.kind[i] === VAN_PARKED) expect(s.y[i]).toBeLessThan(8);
        // The south bay row (row 5) holds hatchbacks only, in the middle of the row, flat on the road.
        if ((s.y[i] as number) > 8) {
          expect(s.kind[i]).toBe(kindOf('veh.hatchback_parked'));
          expect(s.y[i]).toBeCloseTo(11, 9);
          expect((s.flags[i] as number) & VEHICLE_FLAG.HALF_ON_PAVEMENT).toBe(0);
        }
      }
      const p = makeWorld(PARKING_STREET, traffic, seed).vehicles;
      for (let i = 0; i < p.count; i++) expect(p.kind[i]).not.toBe(VAN_PARKED);
    }
  });

  it('leaves a bay empty where no kind but the van could park, and only parks vans beside the 2-tile pavement', () => {
    const w = makeWorld(HALF_ON_STREET, { ...traffic, parkedMix: { 'veh.van_white_parked': 1 } }, 1);
    const s = w.vehicles;
    expect(w.level.traffic?.parked).toBe(10);
    expect(s.parkedCount).toBe(5);
    for (let i = 0; i < s.count; i++) {
      expect(s.kind[i]).toBe(VAN_PARKED);
      expect(s.y[i]).toBeCloseTo(6, 9);
    }
  });
});

describe('veh.bicycle: filtering between the lanes (SSP-091)', () => {
  it('overtakes a car queued behind Bessie by filtering, never overlapping it, then rejoins its lane', () => {
    const w = makeWorld(LONG_STREET, { densityPerKm: 1, mix: { 'veh.hatchback': 1 } }, 1);
    const s = w.vehicles;
    // Bessie stands in the eastbound lane (the north one, y = 5.5 on this 3-tile road).
    const laneY = w.level.lanes.nodeY[w.level.lanes.edgeTo[firstPortal(w, true)] as number] as number;
    placeBessie(w, 91, laneY);
    let car = -1;
    for (let t = 0; t < 3000 && car < 0; t++) {
      w.step(idle);
      for (let i = 0; i < s.count; i++) {
        if (s.blocker[i] === Blocker.Bessie && s.speed[i] === 0 && (s.y[i] as number) === laneY) car = i;
      }
    }
    expect(car).toBeGreaterThanOrEqual(0);
    const carUid = s.uid[car] as number;
    const bikeAt = spawnLaneVehicle(w, BICYCLE, firstPortal(w, true));
    expect(bikeAt).toBeGreaterThanOrEqual(0);
    const bikeUid = s.uid[bikeAt] as number;
    const find = (uid: number): number => {
      for (let i = 0; i < s.count; i++) if (s.uid[i] === uid) return i;
      return -1;
    };
    let maxLateral = 0;
    let overtook = false;
    let passedBessie = false;
    let rejoined = false;
    for (let t = 0; t < 1500; t++) {
      w.step(idle);
      const b = find(bikeUid);
      const c = find(carUid);
      if (b < 0) break;
      expect(c).toBeGreaterThanOrEqual(0);
      expect(overlapping(w, b, c)).toBe(false);
      expect(cornersOverlap(s.corners, b * VEHICLE_CORNER_DOUBLES, w.traffic.bessieCorners, 0)).toBe(false);
      maxLateral = Math.max(maxLateral, s.lateral[b] as number);
      const bikeRear = (s.x[b] as number) - (s.halfLength[b] as number);
      if (bikeRear > (s.x[c] as number) + (s.halfLength[c] as number) && s.speed[c] === 0) overtook = true;
      if (bikeRear > w.vehicle.xM + DEFAULT_TUNING.vehicle.sweeper.body.lengthM / 2) passedBessie = true;
      if (passedBessie && s.lateral[b] === 0) rejoined = true;
    }
    expect(maxLateral).toBeCloseTo(bikeRules.filterOffsetM, 9);
    expect(overtook).toBe(true);
    expect(passedBessie).toBe(true);
    expect(rejoined).toBe(true);
  });

  it('rides at its own speed, faster than the residential limit', () => {
    const w = makeWorld(LONG_STREET, { densityPerKm: 0, mix: {} }, 1);
    placeBessie(w, 91, 3);
    const i = spawnLaneVehicle(w, BICYCLE, firstPortal(w, true));
    for (let t = 0; t < 120; t++) w.step(idle);
    expect(w.vehicles.speed[i]).toBe(DEFAULT_ENTITIES.vehicles['veh.bicycle'].speedMps);
    expect(DEFAULT_ENTITIES.vehicles['veh.bicycle'].speedMps).toBeGreaterThan(
      DEFAULT_TUNING.streetLife.laneSpeed.residentialMps,
    );
  });
});

describe('veh.mobility_scooter: on the pavement nav graph (SSP-091)', () => {
  const traffic: TownTraffic = { densityPerKm: 0, mix: {}, pavement: { 'veh.mobility_scooter': 1 } };

  /** True when the tile under (x, y) holds a nav node. */
  function onNavTile(level: Level, x: number, y: number): boolean {
    const tx = Math.floor(x / 2);
    const ty = Math.floor(y / 2);
    for (let n = 0; n < level.nav.nodeCount; n++) {
      if (
        Math.floor((level.nav.nodeX[n] as number) / 2) === tx &&
        Math.floor((level.nav.nodeY[n] as number) / 2) === ty
      )
        return true;
    }
    return false;
  }

  it('stays on nav-graph tiles at no more than 1.5 m/s, counted in the vehicle store', () => {
    const w = makeWorld(PARKING_STREET, traffic, 5);
    const s = w.vehicles;
    let seen = 0;
    let travelled = 0;
    for (let t = 0; t < 3600; t++) {
      w.step(idle);
      for (let i = 0; i < s.count; i++) {
        if (s.kind[i] !== SCOOTER) continue;
        seen++;
        expect((s.flags[i] as number) & VEHICLE_FLAG.PAVEMENT).toBe(VEHICLE_FLAG.PAVEMENT);
        expect(s.speed[i]).toBeLessThanOrEqual(1.5);
        expect(onNavTile(w.level, s.x[i] as number, s.y[i] as number)).toBe(true);
        travelled += Math.hypot(
          (s.x[i] as number) - (s.prevX[i] as number),
          (s.y[i] as number) - (s.prevY[i] as number),
        );
      }
    }
    expect(seen).toBeGreaterThan(3000);
    expect(travelled).toBeGreaterThan(1.4 * 50);
  });

  function hitRun(kind: 'scooter' | 'bicycle', speed: number): World {
    const w =
      kind === 'scooter'
        ? makeWorld(PARKING_STREET, traffic, 5)
        : makeWorld(LONG_STREET, { densityPerKm: 0, mix: {} }, 1);
    placeBessie(w, kind === 'scooter' ? 61 : 150, 9);
    const s = w.vehicles;
    let i = -1;
    if (kind === 'bicycle') {
      i = spawnLaneVehicle(w, BICYCLE, firstPortal(w, true));
      for (let t = 0; t < 60 * 4; t++) w.step(idle);
    } else {
      w.step(idle);
      i = 0;
    }
    expect(s.kind[i]).toBe(kind === 'scooter' ? SCOOTER : BICYCLE);
    // Bessie nose-on to its road-side flank, 5 cm off it, driving straight at it.
    const h = s.heading[i] as number;
    const side = (7 - (s.y[i] as number)) * Math.sin(h) >= 0 ? 1 : -1;
    const rx = Math.cos(h) * side;
    const ry = Math.sin(h) * side;
    const off = (s.halfWidth[i] as number) + DEFAULT_TUNING.vehicle.sweeper.body.lengthM / 2 + 0.05;
    placeBessie(
      w,
      (s.x[i] as number) + rx * off,
      (s.y[i] as number) + ry * off,
      h - (side * Math.PI) / 2,
      speed,
    );
    return w;
  }

  it('hitting a mobility scooter at 1.0 m/s or more costs −500 and 2 complaints; the rider falls and gets up', () => {
    const w = hitRun('scooter', 2);
    const s = w.vehicles;
    let hits = 0;
    let fallen = 0;
    for (let t = 0; t < 30; t++) {
      w.step(idle);
      for (let k = 0; k < w.events.count; k++) if (w.events.type[k] === EV.VehicleHit) hits++;
      if (s.state[0] === TrafficState.Fallen) fallen++;
    }
    expect(hits).toBe(1);
    expect(fallen).toBeGreaterThan(0);
    expect(w.traffic.actorHits).toBe(1);
    expect(w.scoring.penaltyPts).toBe(-500);
    expect(w.complaints.count).toBe(2);
    // Bessie drives through it: an actor is hit, not collided with.
    expect(w.vehicle.hp).toBe(DEFAULT_TUNING.vehicle.sweeper.health.maxHp);
  });

  it('hitting a bicycle at 1.0 m/s or more costs −250 and 1 complaint', () => {
    const w = hitRun('bicycle', 2);
    for (let t = 0; t < 30; t++) w.step(idle);
    expect(w.traffic.actorHits).toBe(1);
    expect(w.scoring.penaltyPts).toBe(-250);
    expect(w.complaints.count).toBe(1);
  });

  it('a touch below 1.0 m/s closing speed is a bump: no penalty', () => {
    const w = hitRun('scooter', 0.5);
    for (let t = 0; t < 30; t++) w.step(idle);
    expect(w.traffic.actorHits).toBe(0);
    expect(w.traffic.actorBumps).toBeGreaterThanOrEqual(1);
    expect(w.scoring.penaltyPts).toBe(0);
    expect(w.complaints.count).toBe(0);
  });

  it('stops 0.3 m short of a pedestrian standing in its way, then turns round after 3 s held', () => {
    const w = makeWorld(PARKING_STREET, traffic, 5);
    w.step(idle);
    const s = w.vehicles;
    expect(s.kind[0]).toBe(SCOOTER);
    const h0 = s.heading[0] as number;
    const fx = Math.sin(h0);
    const fy = -Math.cos(h0);
    const r = DEFAULT_TUNING.streetLife.npcRadius.humanM;
    const ahead = (s.halfLength[0] as number) + 0.8 + r;
    const trader = (NPC_IDS as readonly string[]).indexOf('npc.market_trader');
    const n = addNpcAt(
      w.npc,
      trader,
      NpcOrigin.Named,
      (s.x[0] as number) + fx * ahead,
      (s.y[0] as number) + fy * ahead,
    );
    // As the spawner adds one: its kind's radius.
    w.npc.radius[n] = w.npcAi.spawner.radiusByKind[trader] as number;
    expect(w.npc.radius[n]).toBe(r);
    const npcX = w.npc.x[0] as number;
    const npcY = w.npc.y[0] as number;
    let heldTicks = 0;
    let stoppedTicks = 0;
    let turned = -1;
    for (let t = 0; t < 400 && turned < 0; t++) {
      w.step(idle);
      // Its front never gets within PAVEMENT_GAP_M of the pedestrian's circle.
      const front =
        Math.hypot(npcX - (s.x[0] as number), npcY - (s.y[0] as number)) - (s.halfLength[0] as number) - r;
      expect(front).toBeGreaterThanOrEqual(PAVEMENT_GAP_M - 1e-6);
      if (s.blocker[0] === Blocker.Pedestrian) heldTicks++;
      if (s.blocker[0] === Blocker.Pedestrian && s.speed[0] === 0) stoppedTicks++;
      if (Math.abs(Math.abs((s.heading[0] as number) - h0) - Math.PI) < 1e-9) turned = t;
    }
    expect(stoppedTicks).toBeGreaterThan(0);
    expect(turned).toBeGreaterThan(0);
    // Held (below blockedBelowMps) for turnRoundS, then turned round on that tick.
    expect(heldTicks).toBe(
      Math.round(DEFAULT_ENTITIES.vehicles['veh.mobility_scooter'].rules.turnRoundS * 60),
    );
  });
});
