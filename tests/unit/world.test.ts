// The World, its EventQueue and the fixed tick order (src/sim/world.ts, eventQueue.ts, surface.ts, kerb.ts;
// SSP-035, TECHNICAL_DESIGN §5.2, §7.1, §7.2 and §8.2 steps 7 and 9). Levels are hand-built with
// createBlankLevel; no level compiler is needed.
import { describe, expect, it } from 'vitest';
import tuningJson from '../../src/data/tuning.json' with { type: 'json' };
import { DT_S, TILE_M } from '../../src/sim/constants.ts';
import {
  countEvents,
  createEventQueue,
  EV,
  EVENTS_PER_TICK,
  pushEvent,
  resetEvents,
  sealEvents,
} from '../../src/sim/eventQueue.ts';
import {
  BRAKE_MAX,
  createInputFrame,
  type InputFrame,
  STEER_MAX,
  THROTTLE_MAX,
} from '../../src/sim/inputFrame.ts';
import { createKerbCrossings, findKerbCrossings, type KerbCrossings } from '../../src/sim/kerb.ts';
import {
  COLLIDE,
  createBlankLevel,
  Ground,
  type Level,
  Surface,
  surfaceOfGround,
} from '../../src/sim/map.ts';
import { nextInt, sfc32 } from '../../src/sim/rng.ts';
import { createSurfaceTable, sampleSurface, surfaceAt } from '../../src/sim/surface.ts';
import { DEFAULT_TUNING, loadTuning, type Tuning } from '../../src/sim/tuning.ts';
import type { VehicleState, VehicleSurface } from '../../src/sim/vehicle.ts';
import { createWorld, Phase, setWorldTuning, stepWorld, viewWorld, type World } from '../../src/sim/world.ts';
import { assertHeapDeltaWithinThresholds, measureHeapDelta } from '../support/heapDelta.ts';

const sweeper = DEFAULT_TUNING.vehicle.sweeper;
const EAST = Math.PI / 2;
const NORTH = 0;

function frame(throttle: number, brake: number, steer: number): InputFrame {
  const input = createInputFrame();
  input.throttle = throttle;
  input.brake = brake;
  input.steer = steer;
  return input;
}

const NEUTRAL = frame(0, 0, 0);

/** findKerbCrossings for the segment (x0, y0) → (x1, y1), written into the scratch first. */
function kerbCrossings(
  collide: Uint8Array,
  w: number,
  h: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  out: KerbCrossings,
): number {
  out.x0M = x0;
  out.y0M = y0;
  out.x1M = x1;
  out.y1M = y1;
  return findKerbCrossings(collide, w, h, out);
}

/** The committed tuning with both drag terms zeroed, so the kerb loss can be measured in isolation. */
function tuningWithNoDrag(): Tuning {
  const raw = structuredClone(tuningJson);
  raw.vehicle.sweeper.drag.rollingMps2 = 0;
  raw.vehicle.sweeper.drag.quadraticPerM = 0;
  return loadTuning(raw);
}

/** Set one tile's ground and its compiled surface. */
function paint(level: Level, col: number, row: number, ground: Ground): void {
  const w = level.size[0];
  level.layers.ground[row * w + col] = ground;
  level.layers.surface[row * w + col] = surfaceOfGround(ground);
}

function fill(level: Level, ground: Ground): void {
  const [w, h] = level.size;
  for (let row = 0; row < h; row++) for (let col = 0; col < w; col++) paint(level, col, row, ground);
}

/** Mark the edge between (col, row) and its east neighbour as a raised kerb, on both cells (as the compiler does). */
function kerbEast(level: Level, col: number, row: number): void {
  const w = level.size[0];
  const collide = level.layers.collide;
  collide[row * w + col] = (collide[row * w + col] ?? 0) | COLLIDE.KERB_EDGE_E;
  collide[row * w + col + 1] = (collide[row * w + col + 1] ?? 0) | COLLIDE.KERB_EDGE_W;
}

/** Mark the edge between (col, row) and its south neighbour as a raised kerb, on both cells. */
function kerbSouth(level: Level, col: number, row: number): void {
  const w = level.size[0];
  const collide = level.layers.collide;
  collide[row * w + col] = (collide[row * w + col] ?? 0) | COLLIDE.KERB_EDGE_S;
  collide[(row + 1) * w + col] = (collide[(row + 1) * w + col] ?? 0) | COLLIDE.KERB_EDGE_N;
}

/**
 * A 10 × 3 tile strip: road in columns 0–4 (x 0–10 m), pavement in columns 5–9, the road ↔ pavement edge at
 * x = 10 m. With `raised`, the edge carries KERB_EDGE bits; without, it is a dropped kerb. Bessie starts on
 * the road at (5, 3) facing east.
 */
function kerbStrip(raised: boolean): Level {
  const level = createBlankLevel('test.kerb_strip', 10, 3);
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 10; col++) paint(level, col, row, col < 5 ? Ground.Road : Ground.Pavement);
    if (raised) kerbEast(level, 4, row);
  }
  level.player = { x: 5, y: 3, heading: EAST };
  return level;
}

/** Step under NEUTRAL until a KerbJolt is emitted; returns the vLong before and after that tick. */
function driveToNextJolt(world: World, maxTicks: number): { before: number; after: number; jolts: number } {
  for (let i = 0; i < maxTicks; i++) {
    const before = world.vehicle.vLongMps;
    world.step(NEUTRAL);
    const jolts = countEvents(world.events, EV.KerbJolt);
    if (jolts > 0) return { before, after: world.vehicle.vLongMps, jolts };
    expect(world.events.count, `unexpected event on tick ${world.tick - 1}`).toBe(0);
  }
  throw new Error(`no kerb jolt within ${maxTicks} ticks`);
}

describe('createWorld', () => {
  it('spawns Bessie at the level player start with an empty, sealed queue and tick 0', () => {
    const level = kerbStrip(true);
    const world = createWorld(level, 1234, DEFAULT_TUNING);
    expect(world.tick).toBe(0);
    expect(world.seed).toBe(1234);
    expect([world.vehicle.xM, world.vehicle.yM, world.vehicle.headingRad]).toEqual([5, 3, EAST]);
    expect(world.vehicle.vLongMps).toBe(0);
    expect(world.events.count).toBe(0);
    expect(world.events.sealed).toBe(true);
    expect(world.recordInput).toBeNull();
    expect(world.phaseTrace).toBeNull();
  });

  it('normalises the seed to uint32 and rejects a non-integer seed', () => {
    const level = kerbStrip(true);
    expect(createWorld(level, -1, DEFAULT_TUNING).seed).toBe(0xffffffff);
    expect(() => createWorld(level, 1.5, DEFAULT_TUNING)).toThrow(/seed must be an integer/);
  });

  it('uses the tuning it is given, not the default', () => {
    const tuning = tuningWithNoDrag();
    const world = createWorld(kerbStrip(false), 1, tuning);
    expect(world.tuning).toBe(tuning);
    world.vehicle.vLongMps = 4;
    world.step(NEUTRAL);
    expect(world.vehicle.vLongMps).toBe(4); // no drag
  });

  it('viewWorld is the same object, typed read-only', () => {
    const world = createWorld(kerbStrip(true), 1, DEFAULT_TUNING);
    const view = viewWorld(world);
    expect(view).toBe(world);
    expect(view.vehicle).toBe(world.vehicle);
    expect(view.events).toBe(world.events);
  });
});

describe('setWorldTuning (SSP-048 live tuning)', () => {
  it('runs the next tick on the new tuning, keeping Bessie where she is', () => {
    const world = createWorld(kerbStrip(false), 1, DEFAULT_TUNING);
    world.vehicle.vLongMps = 4;
    world.step(NEUTRAL);
    expect(world.vehicle.vLongMps).toBeLessThan(4); // drag
    const x = world.vehicle.xM;
    const speed = world.vehicle.vLongMps;
    const tuning = tuningWithNoDrag();
    setWorldTuning(world, tuning);
    expect(world.tuning).toBe(tuning);
    expect(world.vehicleParams.tuning).toBe(tuning.vehicle.sweeper);
    expect(world.vehicle.xM).toBe(x);
    world.step(NEUTRAL);
    expect(world.vehicle.vLongMps).toBe(speed); // no drag from this tick on
  });

  it('refills the per-surface grip and drag table in place', () => {
    const world = createWorld(kerbStrip(false), 1, DEFAULT_TUNING);
    const table = world.surfaceTable;
    const raw = structuredClone(tuningJson);
    raw.vehicle.sweeper.lateralGripPerS.grass = 2;
    raw.vehicle.sweeper.drag.grassRollingMul = 4;
    setWorldTuning(world, loadTuning(raw));
    expect(world.surfaceTable).toBe(table);
    expect(table.gripPerSById[Surface.Grass]).toBe(2);
    expect(table.rollMultById[Surface.Grass]).toBe(4);
    expect(table.gripPerSById[Surface.Asphalt]).toBe(sweeper.lateralGripPerS.asphalt);
  });

  it('clamps HP to a lowered health.maxHp', () => {
    const world = createWorld(kerbStrip(false), 1, DEFAULT_TUNING);
    const raw = structuredClone(tuningJson);
    raw.vehicle.sweeper.health.maxHp = 60;
    setWorldTuning(world, loadTuning(raw));
    expect(world.vehicle.hp).toBe(60);
  });

  it('switched before the first tick, runs exactly like a World created with that tuning', () => {
    const tuning = tuningWithNoDrag();
    const a = createWorld(kerbStrip(true), 9, tuning);
    const b = createWorld(kerbStrip(true), 9, DEFAULT_TUNING);
    setWorldTuning(b, tuning);
    const input = frame(255, 0, 60);
    for (let i = 0; i < 120; i++) {
      a.step(input);
      b.step(input);
    }
    expect(b.vehicle).toEqual(a.vehicle);
  });

  it('refuses different prop footprints without changing anything', () => {
    const world = createWorld(kerbStrip(false), 1, DEFAULT_TUNING);
    const raw = structuredClone(tuningJson);
    raw.propFootprints.shapes['prop.tree'].radiusM = 1;
    expect(() => setWorldTuning(world, loadTuning(raw))).toThrow(/propFootprints differ/);
    expect(world.tuning).toBe(DEFAULT_TUNING);
  });
});

describe('tick order (TECHNICAL_DESIGN §5.2)', () => {
  it('runs the 11 phases in the documented order every tick, via the optional phase trace', () => {
    const world = createWorld(kerbStrip(true), 1, DEFAULT_TUNING);
    const seen: number[] = [];
    world.phaseTrace = (phase) => {
      seen.push(phase);
    };
    world.step(NEUTRAL);
    world.step(NEUTRAL);
    const order = [
      Phase.Input,
      Phase.Vehicle,
      Phase.StaticCollision,
      Phase.Bodies,
      Phase.BrushLitter,
      Phase.Dirt,
      Phase.Npc,
      Phase.Traffic,
      Phase.Scoring,
      Phase.ShiftTimer,
      Phase.EmitEvents,
    ];
    expect(order).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(seen).toEqual([...order, ...order]);
  });

  it('copies the input in phase 1, before the vehicle moves, and hands it to the recorder', () => {
    const world = createWorld(kerbStrip(true), 1, DEFAULT_TUNING);
    const recorded: [number, number, number, number][] = [];
    world.recordInput = (tick, input) => {
      recorded.push([tick, input.throttle, input.brake, input.steer]);
    };
    const xAtVehiclePhase: number[] = [];
    world.phaseTrace = (phase, view) => {
      if (phase === Phase.Vehicle) {
        expect(view.input.throttle).toBe(200);
        xAtVehiclePhase.push(view.vehicle.xM);
      }
    };
    const input = frame(200, 0, 10);
    world.step(input);
    input.throttle = 0; // the World keeps its own copy
    expect(world.input.throttle).toBe(200);
    input.throttle = 200;
    world.step(input);
    expect(recorded).toEqual([
      [0, 200, 0, 10],
      [1, 200, 0, 10],
    ]);
    expect(xAtVehiclePhase[0]).toBe(5);
    expect(world.tick).toBe(2);
  });

  it('stepWorld and world.step are the same tick', () => {
    const a = createWorld(kerbStrip(true), 9, DEFAULT_TUNING);
    const b = createWorld(kerbStrip(true), 9, DEFAULT_TUNING);
    const input = frame(THROTTLE_MAX, 0, 40);
    for (let i = 0; i < 120; i++) {
      a.step(input);
      stepWorld(b, input);
    }
    expect(a.vehicle).toEqual(b.vehicle);
    expect(a.tick).toBe(b.tick);
  });
});

describe('EventQueue (TECHNICAL_DESIGN §7.2)', () => {
  it('stores events struct-of-arrays in emission order and counts them by type', () => {
    const q = createEventQueue();
    expect(q.type).toBeInstanceOf(Uint16Array);
    expect(q.entity).toBeInstanceOf(Int32Array);
    expect(q.a).toBeInstanceOf(Float64Array);
    expect(q.type.length).toBe(EVENTS_PER_TICK);
    expect(EVENTS_PER_TICK).toBe(512);
    resetEvents(q, 7);
    pushEvent(q, EV.KerbJolt, -1, 1.5, 2.5, 3.25);
    pushEvent(q, EV.Impact, 4, 0.1, 0.2, 0.3);
    pushEvent(q, EV.KerbJolt, -1, 9, 8, 7);
    expect(q.count).toBe(3);
    expect(q.tick).toBe(7);
    expect([q.type[0], q.entity[0], q.a[0], q.b[0], q.c[0]]).toEqual([EV.KerbJolt, -1, 1.5, 2.5, 3.25]);
    expect([q.type[1], q.entity[1], q.a[1], q.b[1], q.c[1]]).toEqual([EV.Impact, 4, 0.1, 0.2, 0.3]);
    expect(countEvents(q, EV.KerbJolt)).toBe(2);
    expect(countEvents(q, EV.ReverseBeeper)).toBe(0);
  });

  it('has distinct non-zero Uint16 type ids', () => {
    const ids = Object.values(EV);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id > 0 && id <= 0xffff).toBe(true);
  });

  it('throws a descriptive error on the 513th event in one tick', () => {
    const q = createEventQueue();
    resetEvents(q, 3);
    for (let i = 0; i < EVENTS_PER_TICK; i++) pushEvent(q, EV.KerbJolt, -1, i, 0, 0);
    expect(q.count).toBe(512);
    expect(() => pushEvent(q, EV.Impact, -1, 0, 0, 0)).toThrow(
      /EventQueue overflow: tick 3 .*event 513.*512/,
    );
    expect(q.count).toBe(512);
    // A new tick has room again.
    resetEvents(q, 4);
    pushEvent(q, EV.Impact, -1, 0, 0, 0);
    expect(q.count).toBe(1);
  });

  it('refuses pushes once sealed and clears stale slots on reset', () => {
    const q = createEventQueue();
    expect(() => pushEvent(q, EV.KerbJolt, -1, 0, 0, 0)).toThrow(/sealed/);
    resetEvents(q, 0);
    pushEvent(q, EV.KerbJolt, 5, 1, 2, 3);
    sealEvents(q);
    expect(() => pushEvent(q, EV.KerbJolt, -1, 0, 0, 0)).toThrow(/after the queue was sealed for tick 0/);
    resetEvents(q, 1);
    expect(q.count).toBe(0);
    expect(q.sealed).toBe(false);
    expect([q.type[0], q.entity[0], q.a[0], q.b[0], q.c[0]]).toEqual([0, 0, 0, 0, 0]);
  });

  it('is empty at the start of every World tick and sealed after it', () => {
    const world = createWorld(kerbStrip(true), 1, DEFAULT_TUNING);
    const countsAtInput: number[] = [];
    world.phaseTrace = (phase, view) => {
      if (phase === Phase.Input) {
        countsAtInput.push(view.events.count);
        expect(view.events.sealed).toBe(false);
        expect(view.events.tick).toBe(view.tick);
      }
      // Fill the queue mid-tick so emptiness at the next tick's start is meaningful.
      if (phase === Phase.Bodies) for (let i = 0; i < 3; i++) pushEvent(world.events, EV.Impact, -1, i, 0, 0);
    };
    for (let i = 0; i < 5; i++) {
      world.step(NEUTRAL);
      expect(world.events.sealed).toBe(true);
      expect(world.events.count).toBe(3);
      expect(() => pushEvent(world.events, EV.Impact, -1, 0, 0, 0)).toThrow(/sealed/);
    }
    expect(countsAtInput).toEqual([0, 0, 0, 0, 0]);
  });

  it('a World tick that emits 513 events throws', () => {
    const world = createWorld(kerbStrip(true), 1, DEFAULT_TUNING);
    world.phaseTrace = (phase) => {
      if (phase === Phase.Npc)
        for (let i = 0; i <= EVENTS_PER_TICK; i++) pushEvent(world.events, EV.Impact, -1, 0, 0, 0);
    };
    expect(() => world.step(NEUTRAL)).toThrow(/EventQueue overflow/);
  });

  it('emits EV.ReverseBeeper once, on the tick reverse engages', () => {
    const world = createWorld(kerbStrip(true), 1, DEFAULT_TUNING);
    const brake = frame(0, BRAKE_MAX, 0);
    let beeps = 0;
    let beepTick = -1;
    for (let i = 0; i < 120; i++) {
      world.step(brake);
      const n = countEvents(world.events, EV.ReverseBeeper);
      if (n > 0) {
        beeps += n;
        beepTick = world.tick - 1;
        expect(world.vehicle.reverseEngaged).toBe(true);
        expect(world.events.a[0]).toBe(world.vehicle.xM);
        expect(world.events.b[0]).toBe(world.vehicle.yM);
        expect(world.events.entity[0]).toBe(-1);
      }
    }
    expect(beeps).toBe(1);
    expect(beepTick).toBe(14); // 0.25 s hold = 15 ticks, the 15th tick engages
  });
});

describe('surface sampling (TECHNICAL_DESIGN §8.2 step 7)', () => {
  const table = createSurfaceTable(sweeper);
  const out: VehicleSurface = { gripPerS: 0, rollMult: 0 };

  it('maps every surface id to its tuning grip and only grass to the grass drag multiplier', () => {
    const g = sweeper.lateralGripPerS;
    expect(Array.from(table.gripPerSById)).toEqual([
      g.asphalt,
      g.pavement,
      g.grass,
      g.wet,
      g.wetLeaves,
      g.oil,
    ]);
    expect(Array.from(table.rollMultById)).toEqual([1, 1, sweeper.drag.grassRollingMul, 1, 1, 1]);
  });

  it('with all four wheels on grass, k = 5.0 and rollMult = 2.5', () => {
    const level = createBlankLevel('test.grass', 6, 6);
    fill(level, Ground.Grass);
    sampleSurface(level, table, sweeper, { xM: 6, yM: 6, headingRad: 0.3 }, out);
    expect(out.gripPerS).toBe(5.0);
    expect(out.rollMult).toBe(2.5);
  });

  it('with two wheels on asphalt and two on pavement, k = 8.5', () => {
    const level = createBlankLevel('test.split', 4, 4);
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 4; col++) paint(level, col, row, col < 2 ? Ground.Road : Ground.Pavement);
    }
    // Heading north on the x = 4 m seam: left wheels at x = 3.125 (road), right wheels at x = 4.875 (pavement).
    sampleSurface(level, table, sweeper, { xM: 4, yM: 4, headingRad: NORTH }, out);
    expect(out.gripPerS).toBe(8.5);
    expect(out.rollMult).toBe(1);
    // Heading east on the same seam: front wheels on pavement, rear wheels on road.
    sampleSurface(level, table, sweeper, { xM: 4, yM: 4, headingRad: EAST }, out);
    expect(out.gripPerS).toBe(8.5);
  });

  it('averages the drag multiplier per wheel (two wheels on grass → 1.75)', () => {
    const level = createBlankLevel('test.verge', 4, 4);
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 4; col++) paint(level, col, row, col < 2 ? Ground.Road : Ground.Grass);
    }
    sampleSurface(level, table, sweeper, { xM: 4, yM: 4, headingRad: NORTH }, out);
    expect(out.gripPerS).toBe(7.0);
    expect(out.rollMult).toBe(1.75);
  });

  it('reads points outside the map as void, which takes asphalt grip', () => {
    const level = createBlankLevel('test.grass', 2, 2);
    fill(level, Ground.Grass);
    expect(surfaceAt(level, -0.01, 1)).toBe(Surface.Asphalt);
    expect(surfaceAt(level, 1, 4)).toBe(Surface.Asphalt);
    expect(surfaceAt(level, 3.99, 3.99)).toBe(Surface.Grass);
    sampleSurface(level, table, sweeper, { xM: 100, yM: 100, headingRad: 0 }, out);
    expect(out.gripPerS).toBe(sweeper.lateralGripPerS.asphalt);
    expect(out.rollMult).toBe(1);
  });

  it('the World passes the sample into stepVehicle: grass drag slows Bessie 2.5× as fast on rolling drag', () => {
    const level = createBlankLevel('test.grass', 20, 20);
    fill(level, Ground.Grass);
    level.player = { x: 20, y: 20, heading: EAST };
    const world = createWorld(level, 1, DEFAULT_TUNING);
    world.vehicle.vLongMps = 3;
    world.step(NEUTRAL);
    expect(world.surface.gripPerS).toBe(5.0);
    expect(world.surface.rollMult).toBe(2.5);
    const expected = 3 - (sweeper.drag.rollingMps2 * 2.5 + sweeper.drag.quadraticPerM * 9) * DT_S;
    expect(world.vehicle.vLongMps).toBeCloseTo(expected, 12);
  });
});

describe('kerb crossing (TECHNICAL_DESIGN §8.2 step 9)', () => {
  it('front axle at 5 m/s: vLong 3.5 ± 1e-9 with one jolt; rear axle: one more jolt, no speed change', () => {
    const world = createWorld(kerbStrip(true), 1, tuningWithNoDrag());
    world.vehicle.vLongMps = 5;
    const front = driveToNextJolt(world, 600);
    expect(front.before).toBe(5);
    expect(Math.abs(front.after - 3.5)).toBeLessThanOrEqual(1e-9);
    expect(front.jolts).toBe(1);
    expect(world.events.count).toBe(1);
    expect(world.events.a[0]).toBeCloseTo(10, 9); // crossed at the x = 10 m edge
    expect(world.events.b[0]).toBeCloseTo(3, 9);
    expect(world.events.c[0]).toBe(5);
    // Front axle (body centre + 1.2 m) is now just past the edge.
    expect(world.vehicle.xM + sweeper.body.frontAxleOffsetM).toBeGreaterThanOrEqual(10);

    const rear = driveToNextJolt(world, 600);
    expect(rear.jolts).toBe(1);
    expect(rear.after).toBe(rear.before);
    expect(Math.abs(rear.after - 3.5)).toBeLessThanOrEqual(1e-9);
    expect(world.events.a[0]).toBeCloseTo(10, 9);
    expect(world.vehicle.xM + sweeper.body.rearAxleOffsetM).toBeGreaterThanOrEqual(10);

    // No further kerbs on the pavement.
    for (let i = 0; i < 60; i++) {
      world.step(NEUTRAL);
      expect(world.events.count).toBe(0);
    }
  });

  it('with drag on, the front crossing keeps exactly 70% of the post-drag speed', () => {
    const world = createWorld(kerbStrip(true), 1, DEFAULT_TUNING);
    world.vehicle.vLongMps = 5;
    const front = driveToNextJolt(world, 600);
    const v = front.before;
    const afterDrag = v - (sweeper.drag.rollingMps2 + sweeper.drag.quadraticPerM * v * v) * DT_S;
    expect(Math.abs(front.after - afterDrag * sweeper.kerb.speedKeepMul)).toBeLessThanOrEqual(1e-9);
  });

  it('crossing a dropped kerb changes neither speed nor events', () => {
    const world = createWorld(kerbStrip(false), 1, tuningWithNoDrag());
    world.vehicle.vLongMps = 5;
    // 150 ticks = 12.5 m: both axles cross x = 10 m and the front bumper (x 19.125 m) stays short of the map
    // edge at x = 20 m, which is solid since SSP-036.
    for (let i = 0; i < 150; i++) {
      world.step(NEUTRAL);
      expect(world.events.count).toBe(0);
      expect(world.vehicle.vLongMps).toBe(5);
    }
    expect(world.vehicle.xM + sweeper.body.rearAxleOffsetM).toBeGreaterThan(10); // both axles crossed
  });

  it('reversing over a kerb: the rear axle jolts first with no loss, then the front axle loses 30%', () => {
    const level = kerbStrip(true);
    level.player = { x: 12.5, y: 3, heading: EAST }; // on the pavement, rear axle at 11.3 m
    const world = createWorld(level, 1, tuningWithNoDrag());
    world.vehicle.vLongMps = -2;
    const rear = driveToNextJolt(world, 600);
    expect(rear.after).toBe(-2);
    const front = driveToNextJolt(world, 600);
    expect(Math.abs(front.after - -1.4)).toBeLessThanOrEqual(1e-9);
  });

  it('findKerbCrossings reports both edges of a corner cut, in crossing order', () => {
    // Road at (0, 0); kerbs on its east and south edges. A segment from inside (0, 0) to (1, 1) crosses
    // the x = 2 edge first (at t = 0.25) and the y = 2 edge second (t = 0.75).
    const level = createBlankLevel('test.corner', 3, 3);
    kerbEast(level, 0, 0);
    kerbSouth(level, 1, 0);
    const out = createKerbCrossings();
    const n = kerbCrossings(level.layers.collide, 3, 3, 1.8, 1.4, 2.6, 2.2, out);
    expect(n).toBe(2);
    expect(out.xM[0]).toBeCloseTo(2, 12);
    expect(out.yM[0]).toBeCloseTo(1.6, 12);
    expect(out.xM[1]).toBeCloseTo(2.4, 12);
    expect(out.yM[1]).toBeCloseTo(2, 12);
    // Reversed segment: the same edges, in the opposite order.
    expect(kerbCrossings(level.layers.collide, 3, 3, 2.6, 2.2, 1.8, 1.4, out)).toBe(2);
    expect(out.yM[0]).toBeCloseTo(2, 12);
    expect(out.xM[1]).toBeCloseTo(2, 12);
  });

  it('findKerbCrossings breaks an exact corner tie column-first, and treats edge points as floor(x / 2)', () => {
    const level = createBlankLevel('test.corner', 3, 3);
    kerbSouth(level, 1, 0); // only the edge between (1, 0) and (1, 1) is a kerb
    const out = createKerbCrossings();
    // Diagonal exactly through the tile corner (2, 2). Column-first walks (0,0) → (1,0) → (1,1) and crosses
    // the kerb; row-first would walk (0,0) → (0,1) → (1,1) and miss it.
    expect(kerbCrossings(level.layers.collide, 3, 3, 1, 1, 3, 3, out)).toBe(1);
    expect(out.xM[0]).toBe(2);
    expect(out.yM[0]).toBe(2);
    // Ending exactly on an edge moving +x enters the next tile (floor(2 / 2) = 1): crossed.
    const strip = kerbStrip(true);
    expect(kerbCrossings(strip.layers.collide, 10, 3, 9.9, 3, 10, 3, out)).toBe(1);
    // ...and the next tick starting on it does not cross it again.
    expect(kerbCrossings(strip.layers.collide, 10, 3, 10, 3, 10.1, 3, out)).toBe(0);
    // Moving −x, landing exactly on x = 10 stays in tile 5; the following tick crosses.
    expect(kerbCrossings(strip.layers.collide, 10, 3, 10.1, 3, 10, 3, out)).toBe(0);
    expect(kerbCrossings(strip.layers.collide, 10, 3, 10, 3, 9.9, 3, out)).toBe(1);
    expect(out.xM[0]).toBe(10);
    // A zero-length segment and segments outside the map cross nothing.
    expect(kerbCrossings(strip.layers.collide, 10, 3, 5, 3, 5, 3, out)).toBe(0);
    expect(kerbCrossings(strip.layers.collide, 10, 3, -9, -9, -1, -1, out)).toBe(0);
    expect(TILE_M).toBe(2);
  });
});

/** A 48 × 48 tile town of 4-tile road strips and 2-tile kerbed pavement/grass blocks, so any drive crosses kerbs. */
function townLevel(): Level {
  const n = 48;
  const level = createBlankLevel('test.town', n, n);
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const block = col % 6 >= 4 || row % 6 >= 4;
      const grass = block && (col + row) % 12 < 2;
      paint(level, col, row, !block ? Ground.Road : grass ? Ground.Grass : Ground.Pavement);
    }
  }
  const surface = level.layers.surface;
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const here = surface[row * n + col];
      if (col + 1 < n && (here === Surface.Asphalt) !== (surface[row * n + col + 1] === Surface.Asphalt))
        kerbEast(level, col, row);
      if (row + 1 < n && (here === Surface.Asphalt) !== (surface[(row + 1) * n + col] === Surface.Asphalt))
        kerbSouth(level, col, row);
    }
  }
  level.player = { x: n, y: n, heading: 0.4 };
  return level;
}

/** A deterministic 3,600-tick input script: piecewise-constant random controls held for 20–80 ticks. */
function inputScript(seed: number, ticks: number): InputFrame[] {
  const rng = sfc32(seed);
  const frames: InputFrame[] = [];
  let current = NEUTRAL;
  let hold = 0;
  for (let t = 0; t < ticks; t++) {
    if (hold === 0) {
      const mode = nextInt(rng, 6);
      current =
        mode === 0
          ? frame(0, BRAKE_MAX, nextInt(rng, 2 * STEER_MAX + 1) - STEER_MAX) // brake, maybe reverse
          : frame(nextInt(rng, THROTTLE_MAX + 1), 0, nextInt(rng, 2 * STEER_MAX + 1) - STEER_MAX);
      hold = 20 + nextInt(rng, 61);
    }
    frames.push(current);
    hold -= 1;
  }
  return frames;
}

function runTown(frames: readonly InputFrame[]): { world: World; eventLog: number[] } {
  const world = createWorld(townLevel(), 0xc0ffee, DEFAULT_TUNING);
  const eventLog: number[] = [];
  for (const input of frames) {
    world.step(input);
    const q = world.events;
    for (let i = 0; i < q.count; i++) {
      eventLog.push(world.tick, q.type[i] ?? 0, q.entity[i] ?? 0, q.a[i] ?? 0, q.b[i] ?? 0, q.c[i] ?? 0);
    }
  }
  return { world, eventLog };
}

describe('determinism', () => {
  it('two Worlds stepped with the same 3,600-tick input sequence end in bit-identical state', () => {
    const frames = inputScript(0x5eed, 3600);
    const a = runTown(frames);
    const b = runTown(frames);
    expect(a.world.tick).toBe(3600);
    expect(b.world.tick).toBe(3600);
    for (const key of Object.keys(a.world.vehicle) as (keyof VehicleState)[]) {
      expect(Object.is(a.world.vehicle[key], b.world.vehicle[key]), key).toBe(true);
    }
    expect(Object.is(a.world.surface.gripPerS, b.world.surface.gripPerS)).toBe(true);
    expect(Object.is(a.world.surface.rollMult, b.world.surface.rollMult)).toBe(true);
    expect(a.world.input).toEqual(b.world.input);
    expect(a.eventLog.length).toBe(b.eventLog.length);
    for (let i = 0; i < a.eventLog.length; i++)
      expect(Object.is(a.eventLog[i], b.eventLog[i]), `event field ${i}`).toBe(true);
    // The run exercised the systems under test.
    const kerbJolts = a.eventLog.filter((v, i) => i % 6 === 1 && v === EV.KerbJolt).length;
    const beeps = a.eventLog.filter((v, i) => i % 6 === 1 && v === EV.ReverseBeeper).length;
    expect(kerbJolts).toBeGreaterThan(4);
    expect(beeps).toBeGreaterThan(0);
  });

  it('stepWorld allocates nothing per tick, kerb crossings included (TECHNICAL_DESIGN §17 heap-delta check)', () => {
    // A steady circle (radius about 13 m) round the middle of the town crosses raised kerbs dozens of times a
    // minute without leaving the map, so the measured window runs surface sampling, kerb detection and event
    // emission on every lap.
    const circle = frame(150, 0, 70);
    const world = createWorld(townLevel(), 7, DEFAULT_TUNING);
    // Pre-warm until V8 has installed optimised code for the whole tick. stepWorld's callees are large, so
    // TurboFan takes tens of thousands of calls to tier them all up (3,000 was not enough; see the note in
    // tests/unit/vehicle.test.ts). measureHeapDelta then adds its own 600-tick §17 warm-up.
    for (let tick = 0; tick < 30_000; tick++) stepWorld(world, circle);
    let jolts = 0;
    for (let tick = 0; tick < 3600; tick++) {
      stepWorld(world, circle);
      jolts += countEvents(world.events, EV.KerbJolt);
    }
    expect(jolts).toBeGreaterThan(20);
    const delta = measureHeapDelta(() => {
      stepWorld(world, circle);
    });
    assertHeapDeltaWithinThresholds(delta);
  });
});
