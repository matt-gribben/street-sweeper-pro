// Bessie's hopper (src/sim/hopper.ts, SSP-058; GDD §7.4, §8.4, TECHNICAL_DESIGN §8.2 step 1, §10.5): the GDD §7.4
// fill table reproduced through the World's hopper and the vehicle hook, the overflow rule (99.5 LU + 1 LU →
// exactly 100 and full), EV.HopperFull once per fill, the HUD warning flag, the linear drain with its
// LU-dumped counters, capacity from tuning.json, and zero allocation on the per-tick paths.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import tuningJson from '../../src/data/tuning.json' with { type: 'json' };
import { DEG_TO_RAD, SIM_HZ } from '../../src/sim/constants.ts';
import {
  countEvents,
  createEventQueue,
  EV,
  type EventQueue,
  resetEvents,
  sealEvents,
} from '../../src/sim/eventQueue.ts';
import {
  addToHopper,
  cancelHopperDrain,
  createHopper,
  DumpSite,
  type Hopper,
  hopperFill,
  hopperFillFraction,
  isHopperDraining,
  isHopperFull,
  isHopperWarning,
  LU_QUANTUM,
  setHopperCapacity,
  startHopperDrain,
  stepHopperDrain,
} from '../../src/sim/hopper.ts';
import { createInputFrame, PRESSED, THROTTLE_MAX } from '../../src/sim/inputFrame.ts';
import { createBlankLevel, Ground } from '../../src/sim/map.ts';
import { DEFAULT_TUNING, loadTuning, type Tuning } from '../../src/sim/tuning.ts';
import {
  computeHandling,
  createVehicleHandling,
  createVehicleParams,
  createVehicleState,
} from '../../src/sim/vehicle.ts';
import { createWorld, Phase, setWorldTuning, stepWorld, type World } from '../../src/sim/world.ts';
import { assertHeapDeltaWithinThresholds, measureHeapDelta } from '../support/heapDelta.ts';

const REPO_ROOT = new URL('../../', import.meta.url).pathname;
const sweeper = DEFAULT_TUNING.vehicle.sweeper;
const CAPACITY = DEFAULT_TUNING.hopper.capacityLu;
/** Depot bay and skip drains in ticks (GDD §8.7: 2.0 s and 3.0 s). */
const DEPOT_DRAIN_TICKS = Math.round(DEFAULT_TUNING.dumping.depotBay.drainS * SIM_HZ);
const SKIP_DRAIN_TICKS = Math.round(DEFAULT_TUNING.dumping.skip.drainS * SIM_HZ);

/** A standalone hopper on a fresh Bessie, capacity `capacityLU`, with an open event queue. */
function newHopper(capacityLU = CAPACITY): { hopper: Hopper; events: EventQueue } {
  const vehicle = createVehicleState(sweeper, 3, 4, 0);
  const params = createVehicleParams(sweeper, capacityLU);
  const events = createEventQueue();
  resetEvents(events, 0);
  return { hopper: createHopper(vehicle, params, DEFAULT_TUNING.hopper), events };
}

/** A tuning.json copy with hopper.capacityLu replaced. */
function tuningWithCapacity(capacityLu: number): Tuning {
  const raw = structuredClone(tuningJson);
  raw.hopper.capacityLu = capacityLu;
  return loadTuning(raw);
}

/** A 24 × 24 tile asphalt World with Bessie in the middle, facing north. */
function asphaltWorld(tuning: Tuning = DEFAULT_TUNING): World {
  const level = createBlankLevel('test.hopper', 24, 24);
  level.layers.ground.fill(Ground.Road);
  level.player = { x: 24, y: 24, heading: 0 };
  return createWorld(level, 7, tuning);
}

/** Run one World tick that adds `lu` in phase 5, where the brush will (SSP-059/SSP-065). Returns the add result. */
function tickAdding(world: World, lu: number): boolean {
  let accepted = false;
  world.phaseTrace = (phase) => {
    if (phase === Phase.BrushLitter) accepted = addToHopper(world.hopper, lu, world.events);
  };
  stepWorld(world, createInputFrame());
  world.phaseTrace = null;
  return accepted;
}

describe('GDD §7.4: the hopper fill scales the handling', () => {
  // The GDD §7.4 table, parsed from the doc so the doc and the code cannot drift apart.
  const gdd = readFileSync(`${REPO_ROOT}docs/GDD.md`, 'utf8');
  const section = gdd.slice(gdd.indexOf('### 7.4 Load'), gdd.indexOf('### 7.5'));
  const rowRe = /^\| (\d+)%[^|]*\| ([\d.]+) m\/s² \| ([\d.]+) \/ ([\d.]+) m\/s \| ([\d.]+)°\/s \|$/gm;
  const rows = [...section.matchAll(rowRe)].map((m) => m.slice(1, 6).map(Number));

  it('has the 0/50/80/100% rows', () => {
    expect(rows.map((r) => r[0])).toEqual([0, 50, 80, 100]);
  });

  it.each(rows)(
    'at %s%% (filled through the World hopper) gives %s m/s², %s / %s m/s and %s°/s within 0.01',
    (pct, accel, vDown, vUp, steerDeg) => {
      const world = asphaltWorld();
      // Fill with crisp packets (1 LU) and cigarette butts (0.5 LU) in phase 5, one item per tick.
      let lu = (pct as number) * (CAPACITY / 100);
      while (lu >= 1) {
        expect(tickAdding(world, 1)).toBe(true);
        lu -= 1;
      }
      if (lu > 0) tickAdding(world, lu);
      expect(world.vehicle.hopperLU).toBe((pct as number) * (CAPACITY / 100));
      expect(hopperFill(world.hopper)).toBeCloseTo((pct as number) / 100, 12);

      const out = createVehicleHandling();
      computeHandling(world.vehicleParams, world.vehicle.hopperLU, true, out);
      expect(Math.abs(out.accelMps2 - (accel as number))).toBeLessThanOrEqual(0.01);
      expect(Math.abs(out.vTopMps - (vDown as number))).toBeLessThanOrEqual(0.01);
      expect(Math.abs(out.steerRateRadPerS / DEG_TO_RAD - (steerDeg as number))).toBeLessThanOrEqual(0.01);
      expect(out.massKg).toBeCloseTo(4200 + 1500 * ((pct as number) / 100), 9);
      computeHandling(world.vehicleParams, world.vehicle.hopperLU, false, out);
      expect(Math.abs(out.vTopMps - (vUp as number))).toBeLessThanOrEqual(0.01);
      // The step itself used the same numbers (phase 2 of the last tick saw the fill before its phase 5 add,
      // so run one more tick).
      stepWorld(world, createInputFrame());
      expect(world.vehicle.massKg).toBeCloseTo(4200 + 1500 * ((pct as number) / 100), 9);
    },
  );

  it('scales with fill fraction, not absolute LU: a 180 LU hopper at 90 LU handles like half full', () => {
    const world = asphaltWorld(tuningWithCapacity(180));
    for (let i = 0; i < 90; i++) tickAdding(world, 1);
    expect(hopperFill(world.hopper)).toBe(0.5);
    const out = createVehicleHandling();
    computeHandling(world.vehicleParams, world.vehicle.hopperLU, true, out);
    expect(out.accelMps2).toBeCloseTo(2.04, 9);
    expect(out.massKg).toBe(4950);
  });

  it('a full hopper caps brush-down speed at 5.4 m/s in a running World', () => {
    const world = asphaltWorld();
    tickAdding(world, CAPACITY);
    const lower = createInputFrame();
    lower.pressed = PRESSED.BRUSH;
    stepWorld(world, lower);
    expect(world.vehicle.brushDown).toBe(true);
    const go = createInputFrame();
    go.throttle = THROTTLE_MAX;
    let maxV = 0;
    for (let i = 0; i < 12 * SIM_HZ; i++) {
      stepWorld(world, go);
      maxV = Math.max(maxV, world.vehicle.vLongMps);
    }
    expect(maxV).toBeLessThanOrEqual(5.4 + 1e-12);
    expect(maxV).toBeGreaterThan(5.38);
    expect(world.vehicle.massKg).toBe(5700);
  });

  it('hopperFillFraction clamps to 0..1', () => {
    expect(hopperFillFraction(-1, 100)).toBe(0);
    expect(hopperFillFraction(50, 100)).toBe(0.5);
    expect(hopperFillFraction(150, 100)).toBe(1);
  });
});

describe('adding litter (GDD §8.4 overflow rule)', () => {
  it('adding a 1 LU item at 99.5 LU leaves the hopper at exactly 100 and full', () => {
    const { hopper, events } = newHopper();
    for (let i = 0; i < 199; i++) expect(addToHopper(hopper, 0.5, events)).toBe(true);
    expect(hopper.vehicle.hopperLU).toBe(99.5);
    expect(isHopperFull(hopper)).toBe(false);
    expect(countEvents(events, EV.HopperFull)).toBe(0);

    expect(addToHopper(hopper, 1, events)).toBe(true); // collected (and scored by the caller)
    expect(hopper.vehicle.hopperLU).toBe(100);
    expect(isHopperFull(hopper)).toBe(true);
    expect(countEvents(events, EV.HopperFull)).toBe(1);
  });

  it('a bin bag (8 LU) at 95 LU is collected, clamped to capacity, and fills the hopper', () => {
    const { hopper, events } = newHopper();
    for (let i = 0; i < 95; i++) addToHopper(hopper, 1, events);
    expect(addToHopper(hopper, 8, events)).toBe(true);
    expect(hopper.vehicle.hopperLU).toBe(100);
    expect(hopper.full).toBe(true);
  });

  it('reaching capacity exactly fills the hopper too', () => {
    const { hopper, events } = newHopper();
    for (let i = 0; i < 97; i++) addToHopper(hopper, 1, events);
    expect(addToHopper(hopper, 3, events)).toBe(true);
    expect([hopper.vehicle.hopperLU, hopper.full, countEvents(events, EV.HopperFull)]).toEqual([
      100,
      true,
      1,
    ]);
  });

  it('a full hopper refuses items (the brush bulldozes them) and changes nothing', () => {
    const { hopper, events } = newHopper();
    addToHopper(hopper, 100, events);
    const before = events.count;
    expect(addToHopper(hopper, 0.5, events)).toBe(false);
    expect(addToHopper(hopper, 8, events)).toBe(false);
    expect(hopper.vehicle.hopperLU).toBe(100);
    expect(events.count).toBe(before);
  });

  it('EV.HopperFull carries Bessie’s position and the capacity', () => {
    const { hopper, events } = newHopper();
    addToHopper(hopper, 120, events);
    expect(events.count).toBe(1);
    expect([events.type[0], events.entity[0], events.a[0], events.b[0], events.c[0]]).toEqual([
      EV.HopperFull,
      -1,
      3,
      4,
      100,
    ]);
  });

  it('rejects an item with no LU', () => {
    const { hopper, events } = newHopper();
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => addToHopper(hopper, bad, events)).toThrow(/LU must be a finite number > 0/);
    }
  });

  it('emits EV.HopperFull from inside a World tick and the sealed queue carries it', () => {
    const world = asphaltWorld();
    expect(tickAdding(world, 99.5)).toBe(true);
    expect(countEvents(world.events, EV.HopperFull)).toBe(0);
    expect(tickAdding(world, 1)).toBe(true);
    expect(world.events.sealed).toBe(true);
    expect(countEvents(world.events, EV.HopperFull)).toBe(1);
    expect(tickAdding(world, 1)).toBe(false);
    expect(countEvents(world.events, EV.HopperFull)).toBe(0);
  });
});

describe('EV.HopperFull fires once per fill', () => {
  it('fires on the transition to full, never while full, and again only after a dump takes it below capacity', () => {
    const { hopper, events } = newHopper();
    let fired = 0;
    const add = (lu: number): void => {
      resetEvents(events, 0);
      addToHopper(hopper, lu, events);
      fired += countEvents(events, EV.HopperFull);
    };
    for (let i = 0; i < 100; i++) add(1);
    expect(fired).toBe(1);
    for (let i = 0; i < 50; i++) add(3);
    expect(fired).toBe(1);

    // A dump: the bulldozer state clears as soon as LU drops below capacity, and the next fill fires again.
    startHopperDrain(hopper, DumpSite.Skip, SKIP_DRAIN_TICKS);
    stepHopperDrain(hopper);
    expect(hopper.vehicle.hopperLU).toBeLessThan(CAPACITY);
    expect(isHopperFull(hopper)).toBe(false);
    while (!stepHopperDrain(hopper)) {
      /* drain to the end */
    }
    expect(hopper.vehicle.hopperLU).toBe(0);
    expect(fired).toBe(1);
    for (let i = 0; i < 99; i++) add(1);
    expect(fired).toBe(1);
    add(2);
    expect(fired).toBe(2);
  });

  it('a dump cancelled part-way still clears the bulldozer state, so the next fill fires again', () => {
    const { hopper, events } = newHopper();
    addToHopper(hopper, 100, events);
    startHopperDrain(hopper, DumpSite.Depot, DEPOT_DRAIN_TICKS);
    for (let i = 0; i < 12; i++) stepHopperDrain(hopper);
    cancelHopperDrain(hopper);
    expect(hopper.vehicle.hopperLU).toBe(90);
    expect(hopper.full).toBe(false);
    resetEvents(events, 1);
    addToHopper(hopper, 10, events);
    expect(countEvents(events, EV.HopperFull)).toBe(1);
  });
});

describe('the HUD warning flag (GDD §8.4: 80%)', () => {
  it('is off below 80% and on from 80% up to and including full', () => {
    const { hopper, events } = newHopper();
    addToHopper(hopper, 79.5, events);
    expect(isHopperWarning(hopper)).toBe(false);
    addToHopper(hopper, 0.5, events);
    expect(isHopperWarning(hopper)).toBe(true);
    addToHopper(hopper, 20, events);
    expect([isHopperWarning(hopper), isHopperFull(hopper)]).toEqual([true, true]);
  });

  it('follows the fill fraction for an upgraded capacity (140 LU warns at 112 LU)', () => {
    const { hopper, events } = newHopper(140);
    addToHopper(hopper, 111.5, events);
    expect(isHopperWarning(hopper)).toBe(false);
    addToHopper(hopper, 0.5, events);
    expect(isHopperWarning(hopper)).toBe(true);
  });
});

describe('draining (dumping API for shift.ts)', () => {
  it('a depot drain removes LU linearly over 120 ticks, ends at exactly 0 and counts it as dumped at the depot', () => {
    const { hopper, events } = newHopper();
    addToHopper(hopper, 100, events);
    startHopperDrain(hopper, DumpSite.Depot, DEPOT_DRAIN_TICKS);
    expect(DEPOT_DRAIN_TICKS).toBe(120);
    expect(isHopperDraining(hopper)).toBe(true);
    for (let k = 1; k <= DEPOT_DRAIN_TICKS; k++) {
      const finished = stepHopperDrain(hopper);
      expect(finished).toBe(k === DEPOT_DRAIN_TICKS);
      expect(Math.abs(hopper.vehicle.hopperLU - 100 * (1 - k / DEPOT_DRAIN_TICKS))).toBeLessThanOrEqual(
        LU_QUANTUM,
      );
      expect(hopper.luDumpedTotal + hopper.vehicle.hopperLU).toBe(100);
    }
    expect(hopper.vehicle.hopperLU).toBe(0);
    expect(isHopperDraining(hopper)).toBe(false);
    expect([hopper.luDumpedTotal, hopper.luDumpedDepot]).toEqual([100, 100]);
    expect(stepHopperDrain(hopper)).toBe(false);
  });

  it('a skip drain takes 180 ticks and does not count towards the tipping fee', () => {
    const { hopper, events } = newHopper();
    addToHopper(hopper, 37.5, events);
    startHopperDrain(hopper, DumpSite.Skip, SKIP_DRAIN_TICKS);
    expect(SKIP_DRAIN_TICKS).toBe(180);
    let ticks = 0;
    let finished = false;
    while (!finished) {
      finished = stepHopperDrain(hopper);
      ticks += 1;
    }
    expect(ticks).toBe(180);
    expect([hopper.vehicle.hopperLU, hopper.luDumpedTotal, hopper.luDumpedDepot]).toEqual([0, 37.5, 0]);
  });

  it('accumulates dumped LU over several dumps, depot separately', () => {
    const { hopper, events } = newHopper();
    for (const [lu, site, ticks] of [
      [40, DumpSite.Depot, DEPOT_DRAIN_TICKS],
      [25.5, DumpSite.Skip, SKIP_DRAIN_TICKS],
      [100, DumpSite.Depot, DEPOT_DRAIN_TICKS],
    ] as const) {
      addToHopper(hopper, lu, events);
      startHopperDrain(hopper, site, ticks);
      while (!stepHopperDrain(hopper)) {
        /* drain */
      }
    }
    expect([hopper.luDumpedTotal, hopper.luDumpedDepot]).toEqual([165.5, 140]);
  });

  it('cancelling keeps what has drained (dumped and counted) and leaves the rest in the hopper', () => {
    const { hopper, events } = newHopper();
    addToHopper(hopper, 60, events);
    startHopperDrain(hopper, DumpSite.Depot, DEPOT_DRAIN_TICKS);
    for (let i = 0; i < 30; i++) stepHopperDrain(hopper);
    cancelHopperDrain(hopper);
    expect(isHopperDraining(hopper)).toBe(false);
    expect([hopper.vehicle.hopperLU, hopper.luDumpedTotal, hopper.luDumpedDepot]).toEqual([45, 15, 15]);
    expect(stepHopperDrain(hopper)).toBe(false);
    expect(hopper.vehicle.hopperLU).toBe(45);
  });

  it('LU collected during a drain stay in the hopper', () => {
    const { hopper, events } = newHopper();
    addToHopper(hopper, 20, events);
    startHopperDrain(hopper, DumpSite.Skip, 4);
    stepHopperDrain(hopper);
    addToHopper(hopper, 3, events);
    while (!stepHopperDrain(hopper)) {
      /* drain */
    }
    expect([hopper.vehicle.hopperLU, hopper.luDumpedTotal]).toEqual([3, 20]);
  });

  it('draining an empty hopper runs its ticks and dumps nothing', () => {
    const { hopper } = newHopper();
    startHopperDrain(hopper, DumpSite.Depot, 3);
    expect([stepHopperDrain(hopper), stepHopperDrain(hopper), stepHopperDrain(hopper)]).toEqual([
      false,
      false,
      true,
    ]);
    expect([hopper.vehicle.hopperLU, hopper.luDumpedTotal]).toEqual([0, 0]);
  });

  it('rejects a second drain, a bad tick count and an unknown site', () => {
    const { hopper } = newHopper();
    expect(() => startHopperDrain(hopper, DumpSite.Depot, 0)).toThrow(/drainTicks/);
    expect(() => startHopperDrain(hopper, DumpSite.Depot, 1.5)).toThrow(/drainTicks/);
    expect(() => startHopperDrain(hopper, 9 as DumpSite, 10)).toThrow(/unknown dump site/);
    startHopperDrain(hopper, DumpSite.Depot, 10);
    expect(() => startHopperDrain(hopper, DumpSite.Skip, 10)).toThrow(/already in progress/);
  });
});

describe('capacity (tuning.json hopper.capacityLu)', () => {
  it('the World takes its capacity and warning fraction from tuning', () => {
    const world = asphaltWorld();
    expect(world.vehicleParams.hopperCapacityLU).toBe(tuningJson.hopper.capacityLu);
    expect(world.hopper.tuning.warnFraction).toBe(tuningJson.hopper.warnFraction);
    expect(world.hopper.params).toBe(world.vehicleParams);
    expect(world.hopper.vehicle).toBe(world.vehicle);
    expect(asphaltWorld(tuningWithCapacity(140)).vehicleParams.hopperCapacityLU).toBe(140);
  });

  it('setWorldTuning applies a new capacity between ticks, clamping LU and recomputing full without an event', () => {
    const world = asphaltWorld();
    tickAdding(world, 90);
    setWorldTuning(world, tuningWithCapacity(140));
    expect([world.vehicleParams.hopperCapacityLU, world.vehicle.hopperLU, world.hopper.full]).toEqual([
      140,
      90,
      false,
    ]);
    setWorldTuning(world, tuningWithCapacity(80));
    expect([world.vehicle.hopperLU, world.hopper.full]).toEqual([80, true]);
    setWorldTuning(world, DEFAULT_TUNING);
    expect([world.vehicle.hopperLU, world.hopper.full]).toEqual([80, false]);
  });

  it('setHopperCapacity rejects a non-positive capacity', () => {
    const { hopper } = newHopper();
    expect(() => setHopperCapacity(hopper, 0)).toThrow(/capacity/);
  });
});

describe('allocation (TECHNICAL_DESIGN §17)', () => {
  it('adding, filling, draining and the World tick allocate nothing', () => {
    const world = asphaltWorld();
    const hopper = world.hopper;
    const events = createEventQueue();
    const input = createInputFrame();
    // Each step: an add while not full, a 40-tick drain started whenever it fills, a drain step and a World
    // tick, so every path runs (fills, refusals, drains, the full flag clearing) inside the window.
    const step = (tick: number): void => {
      resetEvents(events, tick);
      if (!hopper.full) addToHopper(hopper, 2.5, events);
      if (hopper.full && hopper.drainSite === 0) startHopperDrain(hopper, DumpSite.Depot, 40);
      stepHopperDrain(hopper);
      sealEvents(events);
      stepWorld(world, input);
    };
    // Pre-warm until V8 has optimised the whole tick, as tests/unit/world.test.ts does (unoptimised code
    // boxes doubles); measureHeapDelta then adds its own 600-tick §17 warm-up.
    for (let tick = 0; tick < 30_000; tick++) step(tick);
    const delta = measureHeapDelta((tick) => step(30_000 + tick));
    assertHeapDeltaWithinThresholds(delta);
    expect(hopper.luDumpedTotal).toBeGreaterThan(1000);
  });
});
