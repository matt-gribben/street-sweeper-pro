// The brush (SSP-059; GDD §8.1–§8.3, TECHNICAL_DESIGN §8.3, §10.1, §10.2): the geometry numbers, the state
// machine timing from a Space press (30 ticks lowering, 36 ticks spin-up, collecting from rpm ≥ 0.8), the
// brush-down top speed through the World, the gutter sweep-in and suction pull, inlet collection in one tick
// and never before the brush is down and spinning, one fling roll per contact episode, the bulldozer at a full
// hopper, the coverage of the 2.6 m swept width at clean speed, determinism and zero allocation per tick.
import { describe, expect, it } from 'vitest';
import tuningJson from '../../src/data/tuning.json' with { type: 'json' };
import {
  type Brush,
  BrushState,
  brushLowerTicks,
  brushSpinUpTicks,
  createBrush,
  flingProbability,
  isBrushCollecting,
  stepBrushLitter,
  stepBrushState,
} from '../../src/sim/brush.ts';
import { DT_S, SIM_HZ } from '../../src/sim/constants.ts';
import { LITTER_IDS, type LitterId } from '../../src/sim/entities.ts';
import { createEventQueue, EV, type EventQueue, resetEvents, sealEvents } from '../../src/sim/eventQueue.ts';
import {
  addToHopper,
  createHopper,
  DumpSite,
  type Hopper,
  startHopperDrain,
  stepHopperDrain,
} from '../../src/sim/hopper.ts';
import { createInputFrame, type InputFrame, PRESSED, THROTTLE_MAX } from '../../src/sim/inputFrame.ts';
import {
  addLitter,
  beginLitterTick,
  createLitterField,
  LITTER_CAPACITY,
  type LitterField,
  LitterFlag,
  stepLitter,
  updateLitterCell,
} from '../../src/sim/litter.ts';
import { createBlankLevel } from '../../src/sim/map.ts';
import { nextFloat, sfc32 } from '../../src/sim/rng.ts';
import { DEFAULT_ENTITIES, DEFAULT_TUNING, loadTuning, type Tuning } from '../../src/sim/tuning.ts';
import { createVehicleParams, createVehicleState, type VehicleState } from '../../src/sim/vehicle.ts';
import { createWorld, stepWorld } from '../../src/sim/world.ts';
import { assertHeapDeltaWithinThresholds, measureHeapDelta } from '../support/heapDelta.ts';

const SW = DEFAULT_TUNING.sweeping;
const BRUSH = DEFAULT_TUNING.vehicle.sweeper.brush;
const BODY = DEFAULT_TUNING.vehicle.sweeper.body;
const LEVEL = createBlankLevel('brush', 64, 64); // 128 × 128 m
const CRISP = LITTER_IDS.indexOf('litter.crisp_packet' satisfies LitterId);
const BIN_BAG = LITTER_IDS.indexOf('litter.bin_bag' satisfies LitterId);
const PIN_Y = BODY.lengthM / 2 + SW.bulldozer.pinAheadM;

/** Everything one brush needs, with Bessie parked at (64, 64) facing north (local x = world x − 64, y = 64 − world y). */
type Rig = {
  tuning: Tuning;
  brush: Brush;
  field: LitterField;
  vehicle: VehicleState;
  hopper: Hopper;
  events: EventQueue;
  input: InputFrame;
  tick: number;
  /** Every event of every tick, as [tick, type, entity, a, b, c], while `logEvents` is set. */
  log: number[][];
  logEvents: boolean;
};

function rig(seed = 1, tuning: Tuning = DEFAULT_TUNING, capacity = LITTER_CAPACITY): Rig {
  const sweeper = tuning.vehicle.sweeper;
  const vehicle = createVehicleState(sweeper, 64, 64, 0);
  const params = createVehicleParams(sweeper, tuning.hopper.capacityLu);
  return {
    tuning,
    brush: createBrush(tuning, seed, capacity),
    field: createLitterField(LEVEL, tuning, DEFAULT_ENTITIES, capacity),
    vehicle,
    hopper: createHopper(vehicle, params, tuning.hopper),
    events: createEventQueue(),
    input: createInputFrame(),
    tick: 0,
    log: [],
    logEvents: true,
  };
}

/** World position of vehicle-local (lx, ly) for Bessie's current pose. */
function toWorld(r: Rig, lx: number, ly: number): [number, number] {
  const c = Math.cos(r.vehicle.headingRad);
  const s = Math.sin(r.vehicle.headingRad);
  return [r.vehicle.xM + c * lx + s * ly, r.vehicle.yM + s * lx - c * ly];
}

/** Vehicle-local position of item i. */
function toLocal(r: Rig, i: number): [number, number] {
  const c = Math.cos(r.vehicle.headingRad);
  const s = Math.sin(r.vehicle.headingRad);
  const dx = (r.field.x[i] as number) - r.vehicle.xM;
  const dy = (r.field.y[i] as number) - r.vehicle.yM;
  return [dx * c + dy * s, dx * s - dy * c];
}

function addLocal(r: Rig, lx: number, ly: number, kind = CRISP): number {
  const [x, y] = toWorld(r, lx, ly);
  return addLitter(r.field, kind, x, y, 0);
}

/**
 * One tick in World order: phase 2 (brush state, then Bessie moves `speedMps` along her heading), then phase 5
 * (beginLitterTick → stepBrushLitter → stepLitter). `pressed` is this tick's PRESSED bits.
 */
function tick(r: Rig, speedMps = 0, pressed = 0): void {
  resetEvents(r.events, r.tick);
  r.input.pressed = pressed;
  stepBrushState(r.brush, r.vehicle, r.input, r.hopper.full);
  const v = r.vehicle;
  v.vLongMps = speedMps;
  v.xM += Math.sin(v.headingRad) * speedMps * DT_S;
  v.yM -= Math.cos(v.headingRad) * speedMps * DT_S;
  beginLitterTick(r.field);
  stepBrushLitter(r.brush, r.field, v, r.hopper, r.events);
  stepLitter(r.field);
  sealEvents(r.events);
  for (let e = 0; r.logEvents && e < r.events.count; e++) {
    r.log.push([
      r.tick,
      r.events.type[e] as number,
      r.events.entity[e] as number,
      r.events.a[e] as number,
      r.events.b[e] as number,
      r.events.c[e] as number,
    ]);
  }
  r.tick += 1;
}

/** Press Space and run until the brush is fully lowered and at full RPM (66 ticks), standing still. */
function lower(r: Rig): void {
  tick(r, 0, PRESSED.BRUSH);
  for (let t = 1; t < brushLowerTicks(r.tuning) + brushSpinUpTicks(r.tuning); t++) tick(r);
  expect(r.vehicle.brushPos).toBe(1);
  expect(r.vehicle.rpm).toBe(1);
}

function eventsOf(r: Rig, type: number): number[][] {
  return r.log.filter((e) => e[1] === type);
}

function fillHopper(r: Rig): void {
  resetEvents(r.events, r.tick);
  addToHopper(r.hopper, r.tuning.hopper.capacityLu, r.events);
  sealEvents(r.events);
  expect(r.hopper.full).toBe(true);
}

describe('brush geometry (GDD §8.1, TECHNICAL_DESIGN §10.1)', () => {
  it('has gutter circles r 0.45 m at (±0.85, +1.75), a 2.6 m swept width, suction y +1.6..+2.8 and a 1.0 × 0.4 m inlet at y +1.2', () => {
    expect(SW.gutterBrush).toMatchObject({ radiusM: 0.45, centreXM: 0.85, centreYM: 1.75 });
    expect(2 * (SW.gutterBrush.centreXM + SW.gutterBrush.radiusM)).toBeCloseTo(2.6, 12);
    expect(SW.suction).toMatchObject({ minXM: -1.3, maxXM: 1.3, minYM: 1.6, maxYM: 2.8 });
    expect(SW.suction.maxXM - SW.suction.minXM).toBeCloseTo(2.6, 12);
    expect(SW.inlet).toEqual({ centreXM: 0, centreYM: 1.2, widthM: 1.0, depthM: 0.4 });
    expect(BODY.lengthM / 2).toBe(1.625);
  });

  it('touches items inside the zone and leaves items just outside it alone', () => {
    const r = rig();
    lower(r);
    r.brush.suctionMult = 0; // isolate the gutter push
    const inside = [
      addLocal(r, 1.29, 1.75), // right gutter circle reach
      addLocal(r, -1.29, 1.75), // left gutter circle reach
      addLocal(r, 0, 2.79), // suction rect, far edge
      addLocal(r, -1.29, 2.5), // suction rect, side edge
    ];
    const outside = [
      addLocal(r, 1.32, 1.75),
      addLocal(r, -1.32, 1.75),
      addLocal(r, 0, 2.82),
      addLocal(r, 0.85, 1.28), // just behind the right circle
      addLocal(r, 0.52, 1.2), // beside the inlet
      addLocal(r, 0, 0.98), // just behind the inlet
    ];
    tick(r);
    for (const i of inside)
      expect((r.field.flags[i] as number) & LitterFlag.BrushContact).toBe(LitterFlag.BrushContact);
    for (const i of outside) expect(r.field.flags[i]).toBe(0);
    expect(r.field.count).toBe(inside.length + outside.length);
  });

  it('collects an item whose centre is inside the inlet, and not one just outside it', () => {
    for (const [lx, ly, collected] of [
      [0, 1.2, true],
      [0.49, 1.01, true],
      [-0.49, 1.39, true],
      [0.51, 1.2, false],
      [0, 0.99, false],
    ] as const) {
      const r = rig();
      lower(r);
      r.brush.suctionMult = 0;
      addLocal(r, lx, ly);
      tick(r);
      expect(r.field.count, `item at (${lx}, ${ly})`).toBe(collected ? 0 : 1);
    }
  });
});

describe('state machine timing (TECHNICAL_DESIGN §8.3, GDD §8.2)', () => {
  it('from a Space press, lowers over 30 ticks, spins up over 36 and collects from rpm ≥ 0.8', () => {
    expect(brushLowerTicks(DEFAULT_TUNING)).toBe(30);
    expect(brushSpinUpTicks(DEFAULT_TUNING)).toBe(36);
    const r = rig();
    const states: number[] = [];
    tick(r, 0, PRESSED.BRUSH);
    states.push(r.brush.state);
    expect(r.vehicle.brushDown).toBe(true);
    expect(r.vehicle.brushPos).toBeCloseTo(1 / 30, 12);
    for (let t = 2; t <= 66; t++) {
      tick(r);
      states.push(r.brush.state);
      if (t < 30) {
        expect(r.vehicle.brushPos).toBeCloseTo(t / 30, 12);
        expect(r.vehicle.rpm).toBe(0);
      }
      if (t >= 30) expect(r.vehicle.brushPos).toBe(1);
      if (t > 30) expect(r.vehicle.rpm).toBeCloseTo((t - 30) / 36, 12);
    }
    // Lowering: ticks 1–29; lowered on tick 30 (30 ticks of travel), then spin-up ticks 31–66 (36 ticks).
    expect(states.filter((s) => s === BrushState.Lowering)).toHaveLength(29);
    expect(states.indexOf(BrushState.SpinningUp)).toBe(29);
    // rpm = 29/36 ≥ 0.8 on spin-up tick 29 (tick 59 from the press): Collecting starts there.
    expect(states.indexOf(BrushState.Collecting)).toBe(58);
    expect(r.vehicle.rpm).toBe(1);
    expect(states.at(-1)).toBe(BrushState.Collecting);
  });

  it('raises over 30 ticks from any lowered state, dropping RPM to 0 when Raising starts (spinDownS 0)', () => {
    for (const ticksDown of [35, 59, 80]) {
      const r = rig();
      tick(r, 0, PRESSED.BRUSH);
      for (let t = 1; t < ticksDown; t++) tick(r);
      tick(r, 0, PRESSED.BRUSH);
      expect(r.brush.state).toBe(BrushState.Raising);
      expect(r.vehicle.rpm).toBe(0);
      expect(r.vehicle.brushDown).toBe(true);
      let n = 1;
      while (r.brush.state === BrushState.Raising) {
        tick(r);
        n += 1;
      }
      expect(n).toBe(30);
      expect(r.brush.state).toBe(BrushState.Raised);
      expect([r.vehicle.brushPos, r.vehicle.rpm, r.vehicle.brushDown]).toEqual([0, 0, false]);
    }
  });

  it('reverses mid-travel from where the brush is', () => {
    const r = rig();
    tick(r, 0, PRESSED.BRUSH);
    for (let t = 1; t < 10; t++) tick(r);
    expect(r.brush.posTicks).toBe(10);
    tick(r, 0, PRESSED.BRUSH);
    expect(r.brush.state).toBe(BrushState.Raising);
    expect(r.brush.posTicks).toBe(9);
    for (let t = 0; t < 4; t++) tick(r);
    tick(r, 0, PRESSED.BRUSH);
    expect(r.brush.state).toBe(BrushState.Lowering);
    expect(r.brush.posTicks).toBe(6);
    for (let t = 0; t < 24; t++) tick(r);
    expect(r.brush.state).toBe(BrushState.SpinningUp);
  });

  it('spins down over spinDownS when it is above 0', () => {
    const src = structuredClone(tuningJson);
    src.vehicle.sweeper.brush.spinDownS = 0.3;
    const tuning = loadTuning(src);
    const r = rig(1, tuning);
    lower(r);
    tick(r, 0, PRESSED.BRUSH);
    // 36 spin-up ticks of rpm leave over 18 ticks: 2 per tick.
    expect(r.brush.rpmTicks).toBe(34);
    for (let t = 0; t < 17; t++) tick(r);
    expect(r.vehicle.rpm).toBe(0);
  });

  it('moves between Collecting and Bulldozing with the hopper full flag', () => {
    const r = rig();
    lower(r);
    fillHopper(r);
    tick(r);
    expect(r.brush.state).toBe(BrushState.Bulldozing);
    expect(isBrushCollecting(r.brush, r.vehicle, r.tuning)).toBe(true);
    startHopperDrain(r.hopper, DumpSite.Depot, 2);
    stepHopperDrain(r.hopper);
    tick(r);
    expect(r.brush.state).toBe(BrushState.Collecting);
  });
});

describe('brush-down top speed in the World (GDD §8.2, TECHNICAL_DESIGN §8.2 step 2)', () => {
  it('caps at 6.0 m/s from the tick lowering starts until the brush is fully raised', () => {
    const level = createBlankLevel('strip', 8, 400);
    const world = createWorld({ ...level, player: { x: 8, y: 790, heading: 0 } }, 3, DEFAULT_TUNING);
    const input = createInputFrame();
    input.throttle = THROTTLE_MAX;
    for (let t = 0; t < 10 * SIM_HZ; t++) stepWorld(world, input);
    expect(world.vehicle.vLongMps).toBeGreaterThan(6);
    // Lower: the engine stops pushing on this very tick.
    input.pressed = PRESSED.BRUSH;
    const before = world.vehicle.vLongMps;
    stepWorld(world, input);
    expect(world.vehicle.brushDown).toBe(true);
    expect(world.vehicle.vLongMps).toBeLessThan(before);
    input.pressed = 0;
    for (let t = 0; t < 30 * SIM_HZ; t++) stepWorld(world, input);
    expect(world.vehicle.vLongMps).toBeLessThanOrEqual(6);
    expect(world.brush.state).toBe(BrushState.Collecting);
    // Raise: the 6.0 cap holds through the 30 ticks of Raising, then she accelerates.
    input.pressed = PRESSED.BRUSH;
    stepWorld(world, input);
    input.pressed = 0;
    for (let t = 1; t < 30; t++) {
      expect(world.brush.state).toBe(BrushState.Raising);
      expect(world.vehicle.vLongMps).toBeLessThanOrEqual(6);
      stepWorld(world, input);
    }
    expect(world.brush.state).toBe(BrushState.Raised);
    expect(world.vehicle.brushDown).toBe(false);
    stepWorld(world, input);
    expect(world.vehicle.vLongMps).toBeGreaterThan(6);
  });
});

describe('collection (GDD §8.1, ENTITY_CATALOG §3.1)', () => {
  it('collects an inlet item in one tick at rpm 1 and brushPos 1: event, LU and litterCollected', () => {
    const r = rig();
    lower(r);
    const bag = addLocal(r, 0.1, 1.15, BIN_BAG);
    const [x, y] = [r.field.x[bag] as number, r.field.y[bag] as number];
    const spawned = r.field.litterSpawned;
    tick(r);
    expect(r.field.count).toBe(0);
    expect(r.field.litterCollected).toBe(1);
    expect(r.field.litterSpawned).toBe(spawned);
    expect(r.vehicle.hopperLU).toBe(DEFAULT_ENTITIES.litter['litter.bin_bag'].lu);
    expect(eventsOf(r, EV.LitterCollected)).toEqual([[r.tick - 1, EV.LitterCollected, bag, x, y, BIN_BAG]]);
  });

  it('collects nothing while brushPos < 1 or rpm < 0.8, then collects on the first tick both hold', () => {
    const r = rig();
    const i = addLocal(r, 0, 1.2);
    tick(r, 0, PRESSED.BRUSH);
    let collectedAt = -1;
    for (let t = 2; t <= 66 && collectedAt < 0; t++) {
      if (r.field.count === 1) {
        expect(r.vehicle.brushPos < 1 || r.vehicle.rpm < BRUSH.collectMinRpm).toBe(true);
        // Not even pushed: it sits exactly where it was put.
        expect(toLocal(r, i)[0]).toBeCloseTo(0, 12);
        expect(toLocal(r, i)[1]).toBeCloseTo(1.2, 12);
      }
      tick(r);
      if (r.field.count === 0) collectedAt = t;
    }
    expect(collectedAt).toBe(59);
    expect(r.vehicle.rpm).toBeGreaterThanOrEqual(0.8);
  });

  it('collects every item crowding the inlet in one tick (swap-remove keeps the hit list right)', () => {
    const r = rig();
    lower(r);
    for (let k = 0; k < 12; k++) addLocal(r, -0.45 + (k % 6) * 0.18, 1.05 + Math.floor(k / 6) * 0.3);
    // Other items elsewhere so swap-removes move live items around.
    for (let k = 0; k < 20; k++) addLitter(r.field, CRISP, 10 + k, 10, 0);
    tick(r);
    expect(r.field.count).toBe(20);
    expect(eventsOf(r, EV.LitterCollected)).toHaveLength(12);
    expect(r.vehicle.hopperLU).toBe(12);
  });

  it('pulls suction items to the inlet at 3.0 m/s × rpm × suctionMult and sets IN_SUCTION', () => {
    const r = rig();
    lower(r);
    const i = addLocal(r, 0, 2.7);
    tick(r);
    const [lx, ly] = toLocal(r, i);
    expect(lx).toBeCloseTo(0, 12);
    expect(2.7 - ly).toBeCloseTo(SW.suction.pullMps * DT_S, 12);
    expect((r.field.flags[i] as number) & LitterFlag.InSuction).toBe(LitterFlag.InSuction);
    r.brush.suctionMult = 2;
    tick(r);
    expect(ly - toLocal(r, i)[1]).toBeCloseTo(2 * SW.suction.pullMps * DT_S, 12);
    // Standing still, it reaches the inlet through the throat and is collected.
    r.brush.suctionMult = 1;
    for (let t = 0; t < 60 && r.field.count > 0; t++) tick(r);
    expect(r.field.count).toBe(0);
  });

  it('sweeps gutter items toward x = 0 and slightly backward', () => {
    const r = rig();
    lower(r);
    r.brush.suctionMult = 0;
    // Inside the circles, behind the throat (y < +1.4): only the gutter push acts.
    const right = addLocal(r, 1.0, 1.35);
    const left = addLocal(r, -1.0, 1.35);
    tick(r);
    expect(toLocal(r, right)[0]).toBeCloseTo(1.0 - SW.gutterBrush.sweepInMps * DT_S, 12);
    expect(toLocal(r, left)[0]).toBeCloseTo(-1.0 + SW.gutterBrush.sweepInMps * DT_S, 12);
    expect(toLocal(r, right)[1]).toBeCloseTo(1.35 - SW.gutterBrush.sweepBackMps * DT_S, 12);
    // Outside the suction rect: no wobble.
    expect((r.field.flags[right] as number) & LitterFlag.InSuction).toBe(0);
  });

  it('collects every item across the 2.6 m swept width at the clean-pickup speeds', () => {
    for (const speed of [1.0, 3.0, 4.0]) {
      const r = rig(5);
      lower(r);
      const offsets: number[] = [];
      for (let k = 0; k <= 60; k++) offsets.push(-1.29 + (2.58 * k) / 60);
      for (const lx of offsets) addLocal(r, lx, 6);
      for (let t = 0; t < 4 * SIM_HZ; t++) tick(r, speed);
      expect(r.field.count, `${speed} m/s`).toBe(0);
      expect(eventsOf(r, EV.Fling), `${speed} m/s`).toHaveLength(0);
      expect(eventsOf(r, EV.LitterCollected)).toHaveLength(offsets.length);
    }
  });

  it('flings every item it touches at 6.0 m/s, emitting EV.Fling', () => {
    const r = rig(5);
    lower(r);
    for (let lx = -1.2; lx <= 1.2001; lx += 0.2) addLocal(r, lx, 6);
    const n = r.field.count;
    for (let t = 0; t < 2 * SIM_HZ; t++) tick(r, 6);
    expect(eventsOf(r, EV.Fling)).toHaveLength(n);
    expect(eventsOf(r, EV.LitterCollected)).toHaveLength(0);
    expect(r.field.count).toBe(n);
  });
});

describe('fling roll (GDD §8.3, TECHNICAL_DESIGN §10.2)', () => {
  it('p = clamp((v − 4.0) / 2.0, 0, 1), with t0 = 6.0 under the super-suction hook', () => {
    const b = createBrush(DEFAULT_TUNING, 1);
    const p = (v: number): number => flingProbability(b, DEFAULT_TUNING, v);
    expect([3, 4, 4.5, 5, 5.5, 6, 7].map(p)).toEqual([0, 0, 0.25, 0.5, 0.75, 1, 1]);
    b.flingThresholdMps = 6;
    expect([6, 7, 8].map(p)).toEqual([0, 0.5, 1]);
  });

  it('rolls each item at most once per contact episode, and again in a new episode', () => {
    const r = rig(9);
    lower(r);
    r.brush.suctionMult = 0; // items stay where they are, inside the suction rect
    r.vehicle.vLongMps = 5; // p = 0.5; Bessie does not move in this rig unless tick() is given a speed
    const items: number[] = [];
    for (let k = 0; k < 16; k++) items.push(addLocal(r, -1.1 + (k % 8) * 0.3, k < 8 ? 2.4 : 2.7));
    const drawsBefore = r.brush.rng.counter;
    const step = (): void => {
      resetEvents(r.events, r.tick);
      stepBrushLitter(r.brush, r.field, r.vehicle, r.hopper, r.events);
      stepLitter(r.field);
      sealEvents(r.events);
      for (let e = 0; e < r.events.count; e++) r.log.push([r.tick, r.events.type[e] as number]);
      r.tick += 1;
    };
    for (let t = 0; t < 120; t++) step();
    const flings = eventsOf(r, EV.Fling).length;
    expect(flings).toBeGreaterThan(0);
    expect(flings).toBeLessThan(16);
    // One roll per item, plus one distance draw per fling, over 120 ticks in the zone.
    expect(r.brush.rng.counter - drawsBefore).toBe(16 + flings);
    // A survivor that leaves the zone ends its episode; back in, it rolls once more.
    const survivor = items.findIndex(
      (_, k) => k < r.field.count && ((r.field.flags[k] as number) & LitterFlag.Flung) === 0,
    );
    expect(survivor).toBeGreaterThanOrEqual(0);
    // Just beyond the suction rect's far edge (local y +3.1): out of the zone, still near enough to be seen.
    const yIn = r.field.y[survivor] as number;
    r.field.y[survivor] = 64 - 3.1;
    updateLitterCell(r.field, survivor);
    step();
    expect((r.field.flags[survivor] as number) & LitterFlag.BrushContact).toBe(0);
    r.field.y[survivor] = yIn;
    updateLitterCell(r.field, survivor);
    const before = r.brush.rng.counter;
    step();
    expect(r.brush.rng.counter - before).toBeGreaterThanOrEqual(1);
    expect((r.field.flags[survivor] as number) & LitterFlag.BrushContact).toBe(LitterFlag.BrushContact);
  });

  it('makes no draw at p = 0 or p = 1', () => {
    for (const v of [3, 6]) {
      const r = rig(2);
      lower(r);
      r.vehicle.vLongMps = v;
      r.brush.suctionMult = 0;
      addLocal(r, 0, 2.5);
      const before = r.brush.rng.counter;
      resetEvents(r.events, 0);
      stepBrushLitter(r.brush, r.field, r.vehicle, r.hopper, r.events);
      sealEvents(r.events);
      // At 6.0 the fling itself draws the distance; the roll draws nothing.
      expect(r.brush.rng.counter - before).toBe(v === 6 ? 1 : 0);
    }
  });

  it('clears the brush flags once the brush stops collecting', () => {
    const r = rig();
    lower(r);
    r.brush.suctionMult = 0;
    const i = addLocal(r, 0, 2.5);
    tick(r);
    expect(r.field.flags[i]).toBe(LitterFlag.BrushContact | LitterFlag.InSuction);
    tick(r, 0, PRESSED.BRUSH);
    expect(r.field.flags[i]).toBe(0);
    expect(r.brush.anyFlagged).toBe(false);
  });
});

describe('bulldozer at a full hopper (TECHNICAL_DESIGN §10.2, GDD §8.4)', () => {
  it('pins inlet items ahead of the bumper and pushes them along, adding no LU', () => {
    const r = rig(4);
    lower(r);
    fillHopper(r);
    const items = [addLocal(r, 0, 5), addLocal(r, 0.3, 6), addLocal(r, -1.0, 7)];
    const lu = r.vehicle.hopperLU;
    for (let t = 0; t < 4 * SIM_HZ; t++) tick(r, 3);
    expect(r.brush.state).toBe(BrushState.Bulldozing);
    expect(r.field.count).toBe(items.length);
    expect(r.field.litterCollected).toBe(0);
    expect(r.vehicle.hopperLU).toBe(lu);
    expect(eventsOf(r, EV.LitterCollected)).toHaveLength(0);
    for (const i of items) {
      expect((r.field.flags[i] as number) & LitterFlag.Pinned).toBe(LitterFlag.Pinned);
      const [lx, ly] = toLocal(r, i);
      expect(ly).toBeCloseTo(PIN_Y, 9); // held on the pin line ahead of the bumper
      expect(Math.abs(lx)).toBeLessThanOrEqual(SW.inlet.widthM / 2 + 1e-9);
    }
    // Pushed along: still with Bessie after another 2 s of driving.
    const y0 = r.vehicle.yM;
    for (let t = 0; t < 2 * SIM_HZ; t++) tick(r, 3);
    expect(y0 - r.vehicle.yM).toBeCloseTo(6, 9);
    for (const i of items) expect(toLocal(r, i)[1]).toBeCloseTo(PIN_Y, 9);

    // After a dump the pinned items are released into the suction and collected.
    startHopperDrain(r.hopper, DumpSite.Skip, 1);
    stepHopperDrain(r.hopper);
    for (let t = 0; t < SIM_HZ; t++) tick(r);
    expect(r.brush.state).toBe(BrushState.Collecting);
    expect(r.field.count).toBe(0);
    expect(eventsOf(r, EV.LitterCollected)).toHaveLength(3);
  });

  it('bulldozes the rest of the tick once an item fills the hopper (overflow is still collected)', () => {
    const r = rig();
    lower(r);
    resetEvents(r.events, 0);
    addToHopper(r.hopper, r.tuning.hopper.capacityLu - 0.5, r.events);
    sealEvents(r.events);
    for (let k = 0; k < 3; k++) addLocal(r, -0.3 + 0.3 * k, 1.2);
    tick(r);
    // The first item (1 LU) overflows and is collected; the other two are pinned.
    expect(eventsOf(r, EV.LitterCollected)).toHaveLength(1);
    expect(eventsOf(r, EV.HopperFull)).toHaveLength(1);
    expect(r.log.map((e) => e[1])).toEqual([EV.LitterCollected, EV.HopperFull]);
    expect(r.brush.state).toBe(BrushState.Bulldozing);
    expect(r.field.count).toBe(2);
    for (let i = 0; i < 2; i++)
      expect((r.field.flags[i] as number) & LitterFlag.Pinned).toBe(LitterFlag.Pinned);
  });

  it('releases pinned items where they are when the brush is raised', () => {
    const r = rig();
    lower(r);
    fillHopper(r);
    const i = addLocal(r, 0, 1.2);
    tick(r);
    expect((r.field.flags[i] as number) & LitterFlag.Pinned).toBe(LitterFlag.Pinned);
    tick(r, 0, PRESSED.BRUSH);
    expect(r.field.flags[i]).toBe(0);
  });
});

describe('determinism (CLAUDE.md hard rule 12)', () => {
  function run(seed: number): { log: number[][]; x: number[]; y: number[]; collected: number } {
    const r = rig(seed);
    const scatter = sfc32(77);
    for (let k = 0; k < 400; k++) {
      addLitter(
        r.field,
        k % LITTER_IDS.length,
        60 + nextFloat(scatter) * 8,
        10 + nextFloat(scatter) * 50,
        k % 4,
      );
    }
    tick(r, 0, PRESSED.BRUSH);
    for (let t = 1; t < 12 * SIM_HZ; t++) {
      r.vehicle.headingRad = 0.05 * Math.sin(t / 50);
      tick(r, 3 + 2.5 * ((t >> 7) % 2), 0);
    }
    return {
      log: r.log,
      x: Array.from(r.field.x.subarray(0, r.field.count)),
      y: Array.from(r.field.y.subarray(0, r.field.count)),
      collected: r.field.litterCollected,
    };
  }

  it('gives identical collection and fling results for the same seed and inputs', () => {
    const a = run(1234);
    const b = run(1234);
    expect(a.collected).toBeGreaterThan(20);
    expect(a.log.filter((e) => e[1] === EV.Fling).length).toBeGreaterThan(5);
    expect(b).toEqual(a);
    expect(run(4321).log).not.toEqual(a.log);
  });
});

describe('zero allocation per tick (TECHNICAL_DESIGN §17)', () => {
  it('runs the brush state and litter steps over 2,000 items without growing the heap', () => {
    const r = rig(3);
    const scatter = sfc32(5);
    const refill = (): void => {
      while (r.field.count < LITTER_CAPACITY) {
        addLitter(
          r.field,
          r.field.count % LITTER_IDS.length,
          2 + nextFloat(scatter) * 124,
          2 + nextFloat(scatter) * 124,
          0,
        );
      }
    };
    refill();
    r.logEvents = false;
    r.field.onFlungLand = () => false;
    const drain = (): void => {
      if (r.hopper.full && r.hopper.drainSite === 0) startHopperDrain(r.hopper, DumpSite.Depot, 120);
      stepHopperDrain(r.hopper);
    };
    const step = (t: number): void => {
      // A lap of a 30 m circle at 3–6 m/s with the brush down, raised for 2 s every 20 s.
      r.vehicle.headingRad = (t % 1885) / 300;
      const pressed = t % 1200 === 0 || t % 1200 === 120 ? PRESSED.BRUSH : 0;
      tick(r, 3 + (t % 4), pressed);
      drain();
      if (t % 600 === 0) refill();
      if (r.vehicle.xM < 10 || r.vehicle.xM > 118 || r.vehicle.yM < 10 || r.vehicle.yM > 118) {
        r.vehicle.xM = 64;
        r.vehicle.yM = 64;
      }
    };
    for (let t = 0; t < 20_000; t++) step(t);
    const delta = measureHeapDelta((t) => step(20_000 + t));
    assertHeapDeltaWithinThresholds(delta);
  });
});
