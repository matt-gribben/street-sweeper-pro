// Parked cars and Bessie vs vehicles (SSP-090; TECHNICAL_DESIGN §9.1, §9.4, §11.4; ENTITY_CATALOG §3.2, §8.2,
// §17 Q3–Q4; LEVEL_DESIGN §9.5): the bays cut from the compiled `p` runs, the seeded shift-start placement with
// its paint slots and static OBBs, the 30-vehicle budget, the roof perch API, the lanes swinging clear of the
// bays, the dent rule (−100 and a flat 5 HP once per contact episode, chain reset) against the impact rule for
// moving traffic (16 HP at 6 m/s, no points or complaints), and the phase-8 stop that keeps a vehicle from
// driving into Bessie. Worlds are compiled towns (tests/support/trafficTown.ts) run through the full World.step.
import { describe, expect, it } from 'vitest';
import tuningJson from '../../src/data/tuning.json' with { type: 'json' };
import { ShapeSource } from '../../src/sim/collision/grid.ts';
import { Offence } from '../../src/sim/complaints.ts';
import { VEHICLE_IDS } from '../../src/sim/entities.ts';
import { EV } from '../../src/sim/eventQueue.ts';
import { createInputFrame, type InputFrame, THROTTLE_MAX } from '../../src/sim/inputFrame.ts';
import type { Level } from '../../src/sim/map.ts';
import {
  claimRoofPerch,
  isRoofPerch,
  isRoofPerchFree,
  releaseRoofPerch,
  roofPerchCount,
} from '../../src/sim/parked.ts';
import { BAY_SLOT_M, baySlotCount, countBaySlots, cutBaySlots } from '../../src/sim/parkingBays.ts';
import { cornersOverlap, TrafficState } from '../../src/sim/traffic.ts';
import { loadTuning, type Tuning } from '../../src/sim/tuning.ts';
import {
  addVehicle,
  Blocker,
  PAINT_SLOTS,
  ROOF_PERCH_FREE,
  rebuildVehicleGrid,
  updateVehicleCorners,
  VEHICLE_CAPACITY,
  VEHICLE_CORNER_DOUBLES,
  VEHICLE_FLAG,
} from '../../src/sim/vehicleStore.ts';
import { createWorld, type World } from '../../src/sim/world.ts';
import { CROSSROADS, compileTrafficTown, PARKING_STREET, type TownTraffic } from '../support/trafficTown.ts';

/** The committed tuning with Bessie's drag zeroed and an endless shift: a speed set on her is what she hits at. */
function tuningWith(edit?: (raw: typeof tuningJson) => void): Tuning {
  const raw = structuredClone(tuningJson);
  raw.vehicle.sweeper.drag.rollingMps2 = 0;
  raw.vehicle.sweeper.drag.quadraticPerM = 0;
  raw.shift.durationS = 100_000;
  edit?.(raw);
  return loadTuning(raw);
}
const NO_DRAG = tuningWith();

const BESSIE = NO_DRAG.vehicle.sweeper.body;
const HL = BESSIE.lengthM / 2;
const NORTH = 0;
const EAST = Math.PI / 2;
const SOUTH = Math.PI;
const WEST = (3 * Math.PI) / 2;
const ALL_PARKED = {
  'veh.hatchback_parked': 1,
  'veh.saloon_parked': 1,
  'veh.van_white_parked': 1,
  'veh.taxi_parked': 1,
};
const PARKED_60: TownTraffic = {
  densityPerKm: 5,
  mix: { 'veh.hatchback': 1 },
  parkedFill: 0.6,
  parkedMix: ALL_PARKED,
};
const PARKED_ALL: TownTraffic = { ...PARKED_60, parkedFill: 1 };
const NO_PARKED: TownTraffic = { densityPerKm: 1, mix: { 'veh.hatchback': 1 } };

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

/** Put Bessie at (x, y) facing `headingRad`, rolling forward at `vLongMps` (no kerb crossing: prev moves too). */
function placeBessie(w: World, x: number, y: number, headingRad: number, vLongMps = 0): void {
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
  v.steerRad = 0;
}

const idle = createInputFrame();
const floor: InputFrame = (() => {
  const f = createInputFrame();
  f.throttle = THROTTLE_MAX;
  return f;
})();

/** Event indices of `type` in the tick just run. */
function eventsOf(w: World, type: number): number[] {
  const out: number[] = [];
  for (let k = 0; k < w.events.count; k++) if (w.events.type[k] === type) out.push(k);
  return out;
}

/** The parked car's pose and kind, for comparing placements. */
function placement(w: World): string[] {
  const s = w.vehicles;
  const out: string[] = [];
  for (let i = 0; i < s.parkedCount; i++) {
    out.push(`${VEHICLE_IDS[s.kind[i] as number]}@${s.x[i]},${s.y[i]},${s.heading[i]} paint ${s.paint[i]}`);
  }
  return out;
}

describe('bays (src/sim/parkingBays.ts)', () => {
  it('cuts each run of p cells into 2-tile bays, centred in the run, across the middle of the bay row', () => {
    expect(BAY_SLOT_M).toBe(4);
    const across = { rect: [10, 4, 15, 5] as [number, number, number, number], heading: WEST };
    const down = { rect: [18, 3, 19, 9] as [number, number, number, number], heading: NORTH };
    const one = { rect: [3, 3, 4, 4] as [number, number, number, number], heading: EAST };
    expect([baySlotCount(across), baySlotCount(down), baySlotCount(one)]).toEqual([2, 3, 0]);
    expect(countBaySlots([across, down, one])).toBe(5);
    // 5 cells (20–30 m) hold 2 bays with 1 m free at each end: centres 23 and 27 m, on the row's centre line.
    expect(cutBaySlots([across, down, one])).toEqual([
      { run: 0, x: 23, y: 9, heading: WEST },
      { run: 0, x: 27, y: 9, heading: WEST },
      { run: 1, x: 37, y: 8, heading: NORTH },
      { run: 1, x: 37, y: 12, heading: NORTH },
      { run: 1, x: 37, y: 16, heading: NORTH },
    ]);
  });
});

describe('parked car placement at shift start', () => {
  it('with parkedFill 0.6 over 10 bays fills exactly 6, identically across reruns with the same seed', () => {
    const level = town(PARKING_STREET, PARKED_60);
    const t = level.traffic;
    if (t === null) throw new Error('no traffic spec');
    expect(t.parkedBays).toBe(10);
    expect(t.parked).toBe(6);
    const slots = cutBaySlots(level.lanes.bays);
    expect(slots).toHaveLength(10);
    const a = createWorld(level, 1234, NO_DRAG);
    const s = a.vehicles;
    expect(s.count).toBe(6);
    expect(s.parkedCount).toBe(6);
    const used = new Set<number>();
    for (let i = 0; i < 6; i++) {
      expect((s.flags[i] as number) & VEHICLE_FLAG.PARKED).toBe(VEHICLE_FLAG.PARKED);
      const id = VEHICLE_IDS[s.kind[i] as number] as string;
      expect(Object.keys(ALL_PARKED)).toContain(id);
      // In a bay of its own, facing the bay's lane heading (west), inside the bay row (y 8–10 m).
      const k = slots.findIndex((b) => b.x === s.x[i] && b.y === s.y[i]);
      expect(k, `car ${i}`).toBeGreaterThanOrEqual(0);
      expect(used.has(k)).toBe(false);
      used.add(k);
      expect(s.heading[i]).toBe(WEST);
      expect((s.y[i] as number) - (s.halfWidth[i] as number)).toBeGreaterThan(8);
      expect((s.y[i] as number) + (s.halfWidth[i] as number)).toBeLessThan(10);
      // Its whole length inside its 4 m bay (centred on the bay).
      expect(s.halfLength[i] as number).toBeLessThan(BAY_SLOT_M / 2);
      // A seeded paint slot for the hatchback and saloon, slot 0 for the rest.
      const painted = id === 'veh.hatchback_parked' || id === 'veh.saloon_parked';
      expect(s.paint[i]).toBeLessThan(painted ? PAINT_SLOTS : 1);
      expect(s.prevX[i]).toBe(s.x[i]);
      expect(s.speed[i]).toBe(0);
    }
    // The same seed places the same cars, kinds and paint; other seeds place others.
    const again = createWorld(level, 1234, NO_DRAG);
    expect(placement(again)).toEqual(placement(a));
    const others = new Set(
      [7, 8, 9, 10, 11].map((seed) => placement(createWorld(level, seed, NO_DRAG)).join('|')),
    );
    expect(others.size).toBeGreaterThan(1);
    // Painted cars do get other slots than 0 across seeds.
    const paints = new Set<number>();
    for (let seed = 1; seed <= 20; seed++) {
      const w = createWorld(level, seed, NO_DRAG);
      for (let i = 0; i < w.vehicles.parkedCount; i++) {
        if (w.vehicles.kindPainted[w.vehicles.kind[i] as number] === 1)
          paints.add(w.vehicles.paint[i] as number);
      }
    }
    expect(paints.size).toBeGreaterThan(3);
  });

  it('registers every parked car as a static OBB of the grid, named by its vehicle index', () => {
    const w = createWorld(town(PARKING_STREET, PARKED_60), 5, NO_DRAG);
    const g = w.staticGrid;
    const cars: number[] = [];
    for (let s = 0; s < g.shapeCount; s++) {
      if (g.source[s] !== ShapeSource.Parked) {
        expect(g.vehicleIndex[s]).toBe(-1);
        continue;
      }
      const i = g.vehicleIndex[s] as number;
      cars.push(i);
      const box = g.boxes[s] as { cx: number; cy: number; halfWidthM: number; halfLengthM: number };
      expect([box.cx, box.cy, box.halfWidthM, box.halfLengthM]).toEqual([
        w.vehicles.x[i],
        w.vehicles.y[i],
        w.vehicles.halfWidth[i],
        w.vehicles.halfLength[i],
      ]);
    }
    expect(cars).toEqual([0, 1, 2, 3, 4, 5]);
    // Parked cars are fat: they never lower the sub-step (SSP-037's thin-prop rule).
    expect(g.subStepMaxM).toBe(
      createWorld(town(PARKING_STREET, NO_PARKED), 5, NO_DRAG).staticGrid.subStepMaxM,
    );
  });

  it('keeps moving + parked within 30 and lets moving traffic flow past the parked cars', () => {
    const level = structuredClone(town(PARKING_STREET, PARKED_ALL));
    if (level.traffic === null) throw new Error('no traffic spec');
    // Ask for far more moving vehicles than the store holds: the runtime budget must hold them to 30 − parked.
    level.traffic.moving = 60;
    const w = createWorld(level, 3, NO_DRAG);
    placeBessie(w, 64, 3, EAST); // on the north pavement, out of the traffic's way
    const s = w.vehicles;
    expect(s.parkedCount).toBe(10);
    let peak = 0;
    const problems: string[] = [];
    for (let t = 0; t < 3600; t++) {
      w.step(idle);
      if (s.count > VEHICLE_CAPACITY || s.parkedCount !== 10) problems.push(`tick ${t}: ${s.count} vehicles`);
      if (s.count > peak) peak = s.count;
      for (let i = s.parkedCount; i < s.count; i++) {
        // No moving body ever enters a parked car's (the lanes swing clear of the bays)...
        for (let j = 0; j < s.parkedCount; j++) {
          if (cornersOverlap(s.corners, i * VEHICLE_CORNER_DOUBLES, s.corners, j * VEHICLE_CORNER_DOUBLES)) {
            problems.push(`tick ${t}: vehicle ${i} enters parked car ${j}`);
          }
        }
        // ...and nothing is ever held by a parked car.
        if (
          s.blocker[i] === Blocker.Vehicle &&
          ((s.flags[s.blockerIndex[i] as number] as number) & VEHICLE_FLAG.PARKED) !== 0
        ) {
          problems.push(`tick ${t}: vehicle ${i} held by parked car ${s.blockerIndex[i]}`);
        }
      }
    }
    expect(problems.slice(0, 5)).toEqual([]);
    // 30 − 10 parked = 20 moving at most.
    expect(peak).toBe(VEHICLE_CAPACITY);
    // Traffic drove the whole street both ways past the bays and left.
    expect(s.vehiclesRemoved).toBeGreaterThan(20);
  }, 60_000);

  it('places nothing and draws nothing without parked cars, and refuses more cars than bays', () => {
    const level = town(PARKING_STREET, NO_PARKED);
    const w = createWorld(level, 9, NO_DRAG);
    expect(w.vehicles.count).toBe(0);
    expect(w.vehicles.parkedCount).toBe(0);
    const fresh = createWorld(level, 9, NO_DRAG);
    expect(w.traffic.rng).toEqual(fresh.traffic.rng);
    const bad = structuredClone(town(PARKING_STREET, PARKED_60));
    if (bad.traffic === null) throw new Error('no traffic spec');
    bad.traffic.parked = 11;
    expect(() => createWorld(bad, 1, NO_DRAG)).toThrow(/traffic\.parked 11 exceeds the 10 bays/);
  });
});

describe('the lanes swing clear of the bays (tools/levels/laneGraph.ts)', () => {
  it('puts both lanes of a 3-tile road in the 2 tiles beside a bay run, tapering over 3 tiles', () => {
    const level = town(PARKING_STREET, NO_PARKED);
    const lanes = level.lanes;
    /** The lane nodes' y at tile column `col` (its centre x), north lane first. */
    const ysAt = (col: number): number[] => {
      const out: number[] = [];
      for (let n = 0; n < lanes.nodeCount; n++) {
        if (lanes.nodeX[n] === (col + 0.5) * 2) out.push(lanes.nodeY[n] as number);
      }
      return out.sort((a, b) => a - b);
    };
    // Far from the bays: a quarter of the 6 m road in from each kerb (y 5.5 and 8.5).
    expect(ysAt(30)).toEqual([5.5, 8.5]);
    // Beside the bays (columns 10–19) and one tile beyond: within rows 2–3, 1 m in from each side (5 and 7).
    for (const col of [9, 10, 15, 19, 20]) expect(ysAt(col)).toEqual([5, 7]);
    // Then two thirds and one third of the shift (westbound 1.5 m, eastbound 0.5 m), then nominal.
    const close = (got: number[], want: number[]): void => {
      expect(got).toHaveLength(want.length);
      got.forEach((y, k) => {
        expect(y).toBeCloseTo(want[k] as number, 12);
      });
    };
    close(ysAt(21), [5.5 - 0.5 * (2 / 3), 8.5 - 1.5 * (2 / 3)]);
    close(ysAt(22), [5.5 - 0.5 / 3, 8.5 - 1.5 / 3]);
    close(ysAt(23), [5.5, 8.5]);
    close(ysAt(8), [5.5 - 0.5 * (2 / 3), 8.5 - 1.5 * (2 / 3)]);
    // A road with no bays is as SSP-076 built it.
    const plain = town(CROSSROADS, NO_PARKED);
    const ys = new Set<number>();
    for (let n = 0; n < plain.lanes.nodeCount; n++) {
      if ((plain.lanes.nodeX[n] as number) < 30) ys.add(plain.lanes.nodeY[n] as number);
    }
    expect([...ys].filter((y) => y > 26 && y < 36).sort()).toEqual([29.5, 32.5]);
  });
});

describe('roof perches (npc.cat, SSP-087)', () => {
  it('has one perch per parked car at its body centre, with a claim and release API', () => {
    const w = createWorld(town(PARKING_STREET, PARKED_60), 2, NO_DRAG);
    const s = w.vehicles;
    expect(roofPerchCount(s)).toBe(6);
    for (let i = 0; i < 6; i++) {
      expect(isRoofPerch(s, i)).toBe(true);
      expect(isRoofPerchFree(s, i)).toBe(true);
      expect(s.roofPerch[i]).toBe(ROOF_PERCH_FREE);
    }
    expect(isRoofPerch(s, 6)).toBe(false);
    expect(claimRoofPerch(s, 2, 77)).toBe(true);
    expect(claimRoofPerch(s, 2, 77)).toBe(true);
    expect(claimRoofPerch(s, 2, 78)).toBe(false);
    expect(isRoofPerchFree(s, 2)).toBe(false);
    expect(s.roofPerch[2]).toBe(77);
    releaseRoofPerch(s, 2, 78);
    expect(s.roofPerch[2]).toBe(77);
    releaseRoofPerch(s, 2, 77);
    expect(isRoofPerchFree(s, 2)).toBe(true);
    expect(claimRoofPerch(s, 6, 1)).toBe(false);
    expect(claimRoofPerch(s, 1, -1)).toBe(false);
    // A perch survives the moving traffic coming and going (parked cars keep their indices).
    claimRoofPerch(s, 5, 9);
    for (let t = 0; t < 1200; t++) w.step(idle);
    expect(s.roofPerch[5]).toBe(9);
    expect(isRoofPerch(s, 5)).toBe(true);
  });
});

/** The parking street with one hatchback parked at index 0 in the bay centred on x = 26 m (y 9 m). */
function dentWorld(tuning: Tuning = NO_DRAG): { w: World; car: number; northFaceY: number } {
  const level = structuredClone(town(PARKING_STREET, PARKED_60));
  if (level.traffic === null) throw new Error('no traffic spec');
  level.traffic.parked = 1;
  level.traffic.parkedMix = [{ id: 'veh.hatchback_parked', weight: 1 }];
  level.traffic.moving = 0;
  for (let seed = 1; seed < 200; seed++) {
    const w = createWorld(level, seed, tuning);
    if (w.vehicles.x[0] === 26) {
      return { w, car: 0, northFaceY: 9 - (w.vehicles.halfWidth[0] as number) };
    }
  }
  throw new Error('no seed puts the car in the 26 m bay');
}

/** Bessie heading south with her front `gapM` north of the car's north face at x = 26, rolling at `speed`. */
function aimAtCar(w: World, northFaceY: number, speed: number, gapM = 0.05): void {
  placeBessie(w, 26, northFaceY - HL - gapM, SOUTH, speed);
}

describe('denting a parked car (−100 and a flat 5 HP, once per contact episode)', () => {
  it('a hit at 6 m/s costs −100 and exactly 5 HP (not 16), resets the chain and emits EV.Dent', () => {
    const { w, car, northFaceY } = dentWorld();
    w.scoring.combo.chain = 7;
    w.scoring.combo.timerTicks = 100;
    const hp0 = w.vehicle.hp;
    const score0 = w.scoring.score;
    aimAtCar(w, northFaceY, 6);
    w.step(idle);
    expect(w.vehicle.hp).toBe(hp0 - 5);
    expect(w.scoring.score).toBe(score0 - 100);
    expect(w.scoring.combo.chain).toBe(0);
    expect(w.complaints.count).toBe(0);
    const dents = eventsOf(w, EV.Dent);
    expect(dents).toHaveLength(1);
    const e = dents[0] as number;
    expect(w.events.entity[e]).toBe(car);
    expect(w.events.c[e]).toBeCloseTo(6, 9);
    expect(w.events.b[e]).toBeCloseTo(northFaceY, 9);
    expect(eventsOf(w, EV.Impact)).toHaveLength(0);
    expect(eventsOf(w, EV.Complaint)).toHaveLength(0);
    expect(w.vehicles.dents[car]).toBe(1);
    expect(w.vehicles.dented[car]).toBe(1);
    expect(w.traffic.dents).toBe(1);
    // Restitution 0.2 off a static car: she comes off it at 1.2 m/s.
    expect(w.vehicle.vLongMps).toBeCloseTo(-1.2, 9);
  });

  it('dents once per contact episode and re-arms after dentRearmS clear of the car', () => {
    const { w, car, northFaceY } = dentWorld();
    const hp0 = w.vehicle.hp;
    aimAtCar(w, northFaceY, 6);
    w.step(idle);
    expect(w.vehicle.hp).toBe(hp0 - 5);
    // She bounces off at 1.2 m/s; rammed again at 6 m/s 10 ticks later, within the episode: an EV.Impact and
    // nothing else (the flat 5 HP replaced the impact damage for the whole episode).
    for (let t = 0; t < 10; t++) w.step(idle);
    expect(w.vehicles.touchClear[car]).toBe(10);
    aimAtCar(w, northFaceY, 6);
    w.step(idle);
    expect(eventsOf(w, EV.Dent)).toHaveLength(0);
    const impacts = eventsOf(w, EV.Impact);
    expect(impacts).toHaveLength(1);
    expect(w.events.c[impacts[0] as number]).toBeCloseTo(6, 9);
    expect(w.vehicle.hp).toBe(hp0 - 5);
    expect(w.scoring.score).toBe(-100);
    expect(w.vehicles.dents[car]).toBe(1);
    // Pressed against it from rest with the throttle down: contact every tick, still one dent.
    placeBessie(w, 26, northFaceY - HL - 1e-4, SOUTH);
    for (let t = 0; t < 40; t++) {
      w.step(floor);
      expect(w.vehicles.touchClear[car], `tick ${t}`).toBeLessThanOrEqual(1);
    }
    expect(w.vehicles.dents[car]).toBe(1);
    expect(w.vehicle.hp).toBe(hp0 - 5);
    // Clear of it for dentRearmS (0.5 s = 30 ticks): the next hit is a new episode and a new dent.
    const rearm = Math.round(NO_DRAG.streetLife.traffic.dentRearmS * 60);
    expect(rearm).toBe(30);
    placeBessie(w, 26, northFaceY - HL - 2, SOUTH);
    for (let t = 0; t < rearm - 1; t++) w.step(idle);
    expect(w.vehicles.dented[car]).toBe(1);
    w.step(idle);
    expect(w.vehicles.dented[car]).toBe(0);
    aimAtCar(w, northFaceY, 6);
    w.step(idle);
    expect(eventsOf(w, EV.Dent)).toHaveLength(1);
    expect(w.vehicle.hp).toBe(hp0 - 10);
    expect(w.scoring.score).toBe(-200);
    expect(w.vehicles.dents[car]).toBe(2);
  });

  it('records the dent through the penalty API: Offence.Dent, −100, no complaint, at the contact point', () => {
    const { w, northFaceY } = dentWorld();
    const seen: number[][] = [];
    w.phaseTrace = (phase, view) => {
      if (phase !== 9) return;
      const log = w.penalties;
      for (let k = 0; k < log.count; k++) {
        seen.push([
          log.reason[k] as number,
          log.pts[k] as number,
          log.complaints[k] as number,
          log.x[k] as number,
          log.y[k] as number,
        ]);
      }
      void view;
    };
    aimAtCar(w, northFaceY, 6);
    w.step(idle);
    expect(seen).toHaveLength(1);
    const [reason, pts, complaints, x, y] = seen[0] as number[];
    expect([reason, pts, complaints]).toEqual([Offence.Dent, -100, 0]);
    expect(x).toBeCloseTo(26, 9);
    expect(y).toBeCloseTo(northFaceY, 9);
  });

  it('a nudge at or below 2 m/s is a bump: EV.Impact, no dent, no HP, no points', () => {
    const { w, car, northFaceY } = dentWorld();
    aimAtCar(w, northFaceY, 1.5, 0.01);
    w.step(idle);
    expect(eventsOf(w, EV.Dent)).toHaveLength(0);
    expect(eventsOf(w, EV.Impact)).toHaveLength(1);
    expect(w.vehicle.hp).toBe(NO_DRAG.vehicle.sweeper.health.maxHp);
    expect(w.scoring.score).toBe(0);
    expect(w.vehicles.dents[car]).toBe(0);
  });

  it('the flat 5 HP is not impact damage: upg.bumper (damageMult 0.6) leaves it at 5', () => {
    const { w, northFaceY } = dentWorld();
    w.vehicleParams.damageMult = 0.6;
    aimAtCar(w, northFaceY, 11);
    w.step(idle);
    expect(w.vehicle.hp).toBe(NO_DRAG.vehicle.sweeper.health.maxHp - 5);
    expect(w.scoring.score).toBe(-100);
  });

  it('a dent can tow Bessie: HP 0 hands off to the TOWED end state', () => {
    const { w, northFaceY } = dentWorld();
    w.vehicle.hp = 4;
    aimAtCar(w, northFaceY, 6);
    w.step(idle);
    expect(w.vehicle.hp).toBe(0);
    expect(w.shift.endReason).toBe(1); // ShiftEndReason.Towed
  });
});

/** The parking street, no parked cars, and one hatchback set on the eastbound lane centred at x = 56 m. */
function trafficWorld(): { w: World; car: number; rearX: number } {
  const level = town(PARKING_STREET, NO_PARKED);
  const w = createWorld(level, 4, NO_DRAG);
  const lanes = level.lanes;
  let edge = -1;
  for (let e = 0; e < lanes.edgeCount; e++) {
    const a = lanes.edgeFrom[e] as number;
    const b = lanes.edgeTo[e] as number;
    if (lanes.nodeX[a] === 55 && lanes.nodeX[b] === 57 && lanes.nodeY[a] === 5.5) edge = e;
  }
  if (edge < 0) throw new Error('no eastbound edge 55 → 57 m');
  const s = w.vehicles;
  const car = addVehicle(s, VEHICLE_IDS.indexOf('veh.hatchback'), 0);
  s.plan[car * 32] = edge;
  s.planLen[car] = 1;
  s.along[car] = 1;
  s.x[car] = 56;
  s.y[car] = 5.5;
  s.heading[car] = EAST;
  s.prevX[car] = 56;
  s.prevY[car] = 5.5;
  s.prevHeading[car] = EAST;
  updateVehicleCorners(s, car);
  rebuildVehicleGrid(s);
  return { w, car, rearX: 56 - (s.halfLength[car] as number) };
}

describe('Bessie vs moving traffic (HP only, ENTITY_CATALOG §17 Q3)', () => {
  it('a hit at 6 m/s costs 16 HP and no points or complaints, with EV.Impact', () => {
    const { w, rearX } = trafficWorld();
    w.scoring.combo.chain = 4;
    w.scoring.combo.timerTicks = 100;
    placeBessie(w, rearX - HL - 0.05, 5.5, EAST, 6);
    w.step(idle);
    expect(w.vehicle.hp).toBeCloseTo(NO_DRAG.vehicle.sweeper.health.maxHp - 16, 9);
    expect(w.scoring.score).toBe(0);
    expect(w.scoring.combo.chain).toBe(4);
    expect(w.complaints.count).toBe(0);
    expect(w.penalties.applied).toBe(0);
    expect(eventsOf(w, EV.Dent)).toHaveLength(0);
    const impacts = eventsOf(w, EV.Impact);
    expect(impacts).toHaveLength(1);
    expect(w.events.c[impacts[0] as number]).toBeCloseTo(6, 9);
    expect(w.events.a[impacts[0] as number]).toBeCloseTo(rearX, 9);
    // She resolved against it as against a wall: out of it, bounced back at 1.2 m/s.
    expect(w.vehicle.xM + HL).toBeLessThanOrEqual(rearX + 1e-9);
    expect(w.vehicle.vLongMps).toBeCloseTo(-1.2, 9);
  });

  it('the upg.bumper multiplier applies to traffic impacts (×0.6: 9.6 HP at 6 m/s)', () => {
    const { w, rearX } = trafficWorld();
    w.vehicleParams.damageMult = 0.6;
    placeBessie(w, rearX - HL - 0.05, 5.5, EAST, 6);
    w.step(idle);
    expect(w.vehicle.hp).toBeCloseTo(NO_DRAG.vehicle.sweeper.health.maxHp - 9.6, 9);
  });
});

describe('traffic is kinematic and stops: no vehicle drives into Bessie (TECHNICAL_DESIGN §9.4)', () => {
  // Bessie left at the junction's south-west corner (seed 11; the first pose starts against the corner terrace,
  // which phase 3 pushes her out of onto the kerb): turning traffic would swing its corners into her where car
  // following, which looks along the lane ahead of a vehicle's centre, does not see her.
  const PINNING_POSES = [
    [33, 37, (3 * Math.PI) / 4],
    [36.5, 34, Math.PI / 4],
  ] as const;

  it('holds a vehicle still, blocked by Bessie, rather than move it into her body', () => {
    const level = town(CROSSROADS, { densityPerKm: 25, mix: { 'veh.hatchback': 1, 'veh.van_white': 1 } });
    const body = new Float64Array(8);
    for (const [x, y, h] of PINNING_POSES) {
      const w = createWorld(level, 11, NO_DRAG);
      placeBessie(w, x, y, h);
      let heldByBessie = 0;
      for (let t = 0; t < 700; t++) {
        w.step(idle);
        const v = w.vehicle;
        const fx = Math.sin(v.headingRad) * HL;
        const fy = -Math.cos(v.headingRad) * HL;
        const rx = Math.cos(v.headingRad) * (BESSIE.widthM / 2);
        const ry = Math.sin(v.headingRad) * (BESSIE.widthM / 2);
        body.set([
          v.xM + rx + fx,
          v.yM + ry + fy,
          v.xM + rx - fx,
          v.yM + ry - fy,
          v.xM - rx - fx,
          v.yM - ry - fy,
          v.xM - rx + fx,
          v.yM - ry + fy,
        ]);
        const s = w.vehicles;
        for (let i = 0; i < s.count; i++) {
          // Touching is allowed; a real overlap (the vehicle shrunk by 1 mm still meets her) is not.
          expect(overlapsShrunk(s.corners, i * 8, body), `pose ${x},${y} tick ${t} vehicle ${i}`).toBe(false);
          if (s.blocker[i] === Blocker.Bessie && s.gapM[i] === 0) heldByBessie += 1;
        }
      }
      expect(w.traffic.contactStops, `pose ${x},${y}`).toBeGreaterThan(0);
      expect(heldByBessie, `pose ${x},${y}`).toBeGreaterThan(0);
    }
  });

  it('a vehicle pinned by Bessie honks after 3 s like one she blocks ahead', () => {
    const level = town(CROSSROADS, { densityPerKm: 25, mix: { 'veh.hatchback': 1, 'veh.van_white': 1 } });
    const [x, y, h] = PINNING_POSES[0];
    const w = createWorld(level, 11, NO_DRAG);
    placeBessie(w, x, y, h);
    let honked = false;
    for (let t = 0; t < 700 && !honked; t++) {
      w.step(idle);
      for (let i = 0; i < w.vehicles.count; i++) {
        if (w.vehicles.gapM[i] === 0 && w.vehicles.state[i] === TrafficState.Honk) honked = true;
      }
    }
    expect(honked).toBe(true);
    expect(w.traffic.carHorns).toBeGreaterThan(0);
  });
});

/** True when the boxes overlap by more than 1 mm: box a (corners at aOff) shrunk by 1 mm about its centre. */
function overlapsShrunk(a: Float64Array, aOff: number, b: Float64Array): boolean {
  const cx = ((a[aOff] as number) + (a[aOff + 4] as number)) / 2;
  const cy = ((a[aOff + 1] as number) + (a[aOff + 5] as number)) / 2;
  const shrunk = new Float64Array(8);
  for (let c = 0; c < 4; c++) {
    const dx = (a[aOff + 2 * c] as number) - cx;
    const dy = (a[aOff + 2 * c + 1] as number) - cy;
    const len = Math.hypot(dx, dy);
    const k = len > 0.002 ? (len - 0.001) / len : 0;
    shrunk[2 * c] = cx + dx * k;
    shrunk[2 * c + 1] = cy + dy * k;
  }
  return cornersOverlap(shrunk, 0, b, 0);
}
