// The shift (src/sim/shift.ts, SSP-062; GDD §5.3, §8.7, TECHNICAL_DESIGN §5.1, §10.5, LEVEL_DESIGN §4.1): the
// rollout start rule (first throttle or tick 180; the firstPlay BRUSH branch), the 14,400-tick countdown, the
// knock-off (input ignored, Bessie rolls to a stop, EV.ShiftEnd TIME_UP on the first tick she is at rest),
// TOWED through the same path, and the depot-bay and skip dump FSM to the tick: hold 60, drain 120 / 180,
// depot water refill, cancels, leaving mid-drain, the site geometry, and zero allocation per tick.
import { describe, expect, it } from 'vitest';
import tuningJson from '../../src/data/tuning.json' with { type: 'json' };
import { SHIFT_TICKS, SIM_HZ } from '../../src/sim/constants.ts';
import { countEvents, EV, type EventType, ShiftEndReason } from '../../src/sim/eventQueue.ts';
import { DumpSite } from '../../src/sim/hopper.ts';
import {
  BRAKE_MAX,
  BUTTON,
  createInputFrame,
  type InputFrame,
  PRESSED,
  STEER_MAX,
  THROTTLE_MAX,
} from '../../src/sim/inputFrame.ts';
import { createBlankLevel, Ground, type Level } from '../../src/sim/map.ts';
import {
  DumpState,
  isShiftDraining,
  isShiftTimerRunning,
  REST_SPEED_MPS,
  ShiftPhase,
  shiftElapsedTicks,
  shiftIgnoresInput,
} from '../../src/sim/shift.ts';
import { DEFAULT_TUNING, loadTuning, type Tuning } from '../../src/sim/tuning.ts';
import { Gear } from '../../src/sim/vehicle.ts';
import { createWorld, setWorldTuning, type World } from '../../src/sim/world.ts';
import { endlessShiftTuning } from '../support/endlessShift.ts';
import { assertHeapDeltaWithinThresholds, measureHeapDelta } from '../support/heapDelta.ts';

const sweeper = DEFAULT_TUNING.vehicle.sweeper;
const TANK = DEFAULT_TUNING.water.tankUnits;
const ROLLOUT_TICKS = 180;
const HOLD_TICKS = 60;
const DEPOT_DRAIN_TICKS = 120;
const SKIP_DRAIN_TICKS = 180;
const KNOCK_OFF_BRAKE = Math.round(0.5 * BRAKE_MAX);

/** The site list of dumpLevel: index 0 is not a dump site, so `entity` (the level.sites index) is tested. */
const BUMP = 0;
const BAY = 1;
const SKIP = 2;
/** The depot bay [5, 5, 7, 8] in metres: x 10..14, y 10..16, centre (12, 13). */
const BAY_CENTRE = { x: 12, y: 13 };
/** The skip [20, 10, 22, 11] in metres: x 40..44, y 20..22. */
const SKIP_RECT = { minX: 40, minY: 20, maxX: 44, maxY: 22 };
const EAST = Math.PI / 2;
const HALF_W = sweeper.body.widthM / 2;
const HALF_L = sweeper.body.lengthM / 2;

/** A 40 × 40 tile asphalt level with a speed bump, a depot bay and a skip, Bessie at `player`. */
function dumpLevel(player: { x: number; y: number; heading: number } = { x: 60, y: 60, heading: 0 }): Level {
  const level = createBlankLevel('test.shift', 40, 40);
  level.layers.ground.fill(Ground.Road);
  level.player = player;
  level.sites.push(
    { id: 'haz.speed_bump', rect: [1, 1, 2, 2] },
    { id: 'site.depot_bay', rect: [5, 5, 7, 8] },
    { id: 'site.skip', rect: [20, 10, 22, 11] },
  );
  return level;
}

/** Bessie parked beside the skip, parallel to it (facing east), `gapM` south of its south edge. */
function besideSkip(gapM: number): { x: number; y: number; heading: number } {
  return { x: 42, y: SKIP_RECT.maxY + gapM + HALF_W, heading: EAST };
}

function frame(fields: Partial<InputFrame> = {}): InputFrame {
  return { ...createInputFrame(), ...fields };
}

const NEUTRAL = frame();
const HOLD = frame({ buttons: BUTTON.INTERACT });
const FULL_THROTTLE = frame({ throttle: THROTTLE_MAX });

/** One recorded event: [type, entity, a, b, c]. */
type Ev = [type: number, entity: number, a: number, b: number, c: number];

/** The events of `type` in this tick's queue. */
function eventsOf(world: World, type: EventType): Ev[] {
  const out: Ev[] = [];
  const q = world.events;
  for (let i = 0; i < q.count; i += 1) {
    if (q.type[i] === type) {
      out.push([type, q.entity[i] as number, q.a[i] as number, q.b[i] as number, q.c[i] as number]);
    }
  }
  return out;
}

/** Step `world` `n` times under `input`. */
function run(world: World, input: Readonly<InputFrame>, n: number): void {
  for (let i = 0; i < n; i += 1) world.step(input);
}

function speedOf(world: World): number {
  const v = world.vehicle;
  return Math.sqrt(v.vLongMps * v.vLongMps + v.vLatMps * v.vLatMps);
}

/** A tuning.json copy edited by `edit`. */
function tuningWith(edit: (raw: typeof tuningJson) => void): Tuning {
  const raw = structuredClone(tuningJson);
  edit(raw);
  return loadTuning(raw);
}

describe('tuning (tuning.json → shift, dumping)', () => {
  it('gives the GDD §8.7 and LEVEL_DESIGN §4.1 numbers as whole ticks', () => {
    const world = createWorld(dumpLevel(), 1, DEFAULT_TUNING);
    const s = world.shift;
    expect(s.durationTicks).toBe(14_400);
    expect(s.durationTicks).toBe(SHIFT_TICKS);
    expect(s.rolloutTicks).toBe(ROLLOUT_TICKS);
    expect([s.depotHoldTicks, s.depotDrainTicks, s.skipHoldTicks, s.skipDrainTicks]).toEqual([
      HOLD_TICKS,
      DEPOT_DRAIN_TICKS,
      HOLD_TICKS,
      SKIP_DRAIN_TICKS,
    ]);
    expect([s.depotMaxSpeedMps, s.skipMaxSpeedMps, s.skipReachM]).toEqual([0.5, 0.5, 2]);
    expect(s.knockOffBrakeInput).toBe(KNOCK_OFF_BRAKE);
  });

  it('rejects hold and drain times that are not whole 60 Hz ticks', () => {
    expect(() => tuningWith((raw) => (raw.dumping.depotBay.holdS = 1.001))).toThrow(
      'tuning: dumping.depotBay.holdS must be a whole number of 60 Hz ticks',
    );
    expect(() => tuningWith((raw) => (raw.dumping.skip.drainS = 2.995))).toThrow(
      'tuning: dumping.skip.drainS must be a whole number of 60 Hz ticks',
    );
    expect(() => tuningWith((raw) => (raw.shift.knockOffBrake = 0))).toThrow('shift.knockOffBrake');
  });

  it('keeps only depot bays and skips as dump sites, in level order, with their level.sites index', () => {
    const world = createWorld(dumpLevel(), 1, DEFAULT_TUNING);
    const s = world.shift;
    expect(s.siteCount).toBe(2);
    expect([...s.siteKind]).toEqual([DumpSite.Depot, DumpSite.Skip]);
    expect([...s.siteLevelIndex]).toEqual([BAY, SKIP]);
    expect([s.siteMinX[0], s.siteMinY[0], s.siteMaxX[0], s.siteMaxY[0]]).toEqual([10, 10, 14, 16]);
    expect([s.siteMinX[1], s.siteMinY[1], s.siteMaxX[1], s.siteMaxY[1]]).toEqual([40, 20, 44, 22]);
    expect(BUMP).toBe(0);
  });
});

describe('timer start (LEVEL_DESIGN §4.1, §13 Q3)', () => {
  it('with no input, starts on tick 180 (after a 3.0 s rollout)', () => {
    const world = createWorld(dumpLevel(), 1, DEFAULT_TUNING);
    expect(world.shift.phase).toBe(ShiftPhase.Rollout);
    run(world, NEUTRAL, ROLLOUT_TICKS); // ticks 0..179
    expect(world.shift.phase).toBe(ShiftPhase.Rollout);
    expect(world.shift.timerStartTick).toBe(-1);
    expect(world.shift.ticksRemaining).toBe(14_400);
    expect(shiftElapsedTicks(world.shift)).toBe(0);
    world.step(NEUTRAL); // tick 180
    expect(world.shift.phase).toBe(ShiftPhase.Running);
    expect(isShiftTimerRunning(world.shift)).toBe(true);
    expect(world.shift.timerStartTick).toBe(ROLLOUT_TICKS);
    // The start tick is the timer's first tick.
    expect(world.shift.ticksRemaining).toBe(14_399);
    expect(shiftElapsedTicks(world.shift)).toBe(1);
  });

  it.each([0, 1, 57, 179])('starts on the first tick with throttle > 0 (tick %i)', (t) => {
    const world = createWorld(dumpLevel(), 1, DEFAULT_TUNING);
    // Brake, steer, INTERACT and BRUSH do not start it.
    const other = frame({
      brake: BRAKE_MAX,
      steer: STEER_MAX,
      buttons: BUTTON.INTERACT,
      pressed: PRESSED.BRUSH,
    });
    run(world, other, t);
    expect(world.shift.phase).toBe(ShiftPhase.Rollout);
    world.step(frame({ throttle: 1 }));
    expect(world.shift.phase).toBe(ShiftPhase.Running);
    expect(world.shift.timerStartTick).toBe(t);
    expect(world.shift.ticksRemaining).toBe(14_399);
  });

  it('with firstPlay, only the first BRUSH press starts it: not throttle, not the rollout fallback', () => {
    const world = createWorld(dumpLevel(), 1, DEFAULT_TUNING, { firstPlay: true });
    expect(world.shift.firstPlay).toBe(true);
    run(world, FULL_THROTTLE, 400);
    run(world, NEUTRAL, 100); // ticks 400..499
    expect(world.shift.phase).toBe(ShiftPhase.Rollout);
    expect(world.shift.ticksRemaining).toBe(14_400);
    world.step(frame({ pressed: PRESSED.BRUSH })); // tick 500
    expect(world.shift.phase).toBe(ShiftPhase.Running);
    expect(world.shift.timerStartTick).toBe(500);
    expect(world.shift.ticksRemaining).toBe(14_399);
  });

  it('defaults firstPlay to false', () => {
    expect(createWorld(dumpLevel(), 1, DEFAULT_TUNING).shift.firstPlay).toBe(false);
    expect(createWorld(dumpLevel(), 1, DEFAULT_TUNING, {}).shift.firstPlay).toBe(false);
  });

  it('a tuning change before the start resets the timer to the new length; after it, the count carries on', () => {
    const world = createWorld(dumpLevel(), 1, DEFAULT_TUNING);
    setWorldTuning(
      world,
      tuningWith((raw) => (raw.shift.durationS = 300)),
    );
    expect(world.shift.ticksRemaining).toBe(18_000);
    run(world, FULL_THROTTLE, 10);
    expect(world.shift.ticksRemaining).toBe(17_990);
    setWorldTuning(world, DEFAULT_TUNING);
    expect(world.shift.ticksRemaining).toBe(17_990);
  });
});

describe('countdown and knock-off (GDD §5.3, TECHNICAL_DESIGN §5.1)', () => {
  it('ticksRemaining reaches 0 exactly 14,400 ticks after the start; at rest, ShiftEnd TIME_UP fires that tick', () => {
    const world = createWorld(dumpLevel(), 1, DEFAULT_TUNING);
    world.step(FULL_THROTTLE); // tick 0: the timer starts
    world.step(frame({ brake: BRAKE_MAX })); // tick 1
    // Stop dead so the knock-off finds Bessie at rest.
    world.vehicle.vLongMps = 0;
    world.vehicle.vLatMps = 0;
    let shiftEnds = 0;
    for (let t = 2; t < SHIFT_TICKS - 1; t += 1) {
      world.step(NEUTRAL);
      shiftEnds += countEvents(world.events, EV.ShiftEnd);
      expect(world.shift.ticksRemaining).toBe(SHIFT_TICKS - 1 - t);
    }
    expect(shiftEnds).toBe(0);
    expect(world.shift.ticksRemaining).toBe(1);
    expect(world.shift.phase).toBe(ShiftPhase.Running);
    world.step(NEUTRAL); // tick 14,399: the 14,400th timer tick
    expect(world.shift.ticksRemaining).toBe(0);
    expect(world.shift.knockOffTick).toBe(SHIFT_TICKS - 1);
    expect(shiftElapsedTicks(world.shift)).toBe(SHIFT_TICKS);
    expect(eventsOf(world, EV.ShiftEnd)).toEqual([[EV.ShiftEnd, -1, ShiftEndReason.TimeUp, 0, 0]]);
    expect(world.shift.phase).toBe(ShiftPhase.Ended);
    expect(world.shift.endReason).toBe(ShiftEndReason.TimeUp);
    expect(world.shift.endTick).toBe(SHIFT_TICKS - 1);
    // Never again, and the timer stays at 0.
    for (let i = 0; i < 600; i += 1) {
      world.step(FULL_THROTTLE);
      expect(countEvents(world.events, EV.ShiftEnd)).toBe(0);
    }
    expect(world.shift.ticksRemaining).toBe(0);
  });

  /** A World driven at speed into the knock-off: the timer starts on tick 0 and Bessie is set to `vLongMps`. */
  function knockOffAtSpeed(vLongMps: number, gear: Gear = Gear.Fwd, vLatMps = 0): World {
    const world = createWorld(dumpLevel({ x: 40, y: 70, heading: EAST }), 1, DEFAULT_TUNING);
    world.step(frame({ throttle: 1 }));
    run(world, NEUTRAL, SHIFT_TICKS - 2);
    expect(world.shift.ticksRemaining).toBe(1);
    world.vehicle.gear = gear;
    world.vehicle.vLongMps = vLongMps;
    world.vehicle.vLatMps = vLatMps;
    world.step(NEUTRAL); // tick 14,399: knock-off while moving
    expect(world.shift.ticksRemaining).toBe(0);
    expect(world.shift.phase).toBe(ShiftPhase.KnockOff);
    expect(shiftIgnoresInput(world.shift)).toBe(true);
    expect(countEvents(world.events, EV.ShiftEnd)).toBe(0);
    return world;
  }

  /** Step under the player's full input until ShiftEnd; return the ticks taken and check the rules each tick. */
  function rollToRest(world: World): number {
    const mash = frame({
      throttle: THROTTLE_MAX,
      steer: STEER_MAX,
      buttons: BUTTON.INTERACT | BUTTON.SPRAY,
      pressed: PRESSED.BRUSH | PRESSED.HORN,
    });
    const brushDown = world.vehicle.brushDown;
    for (let n = 1; n <= 20 * SIM_HZ; n += 1) {
      const atRestBefore = speedOf(world) < REST_SPEED_MPS;
      world.step(mash);
      // The driver is ignored: no throttle (in FWD), steer, buttons or presses reach the sim.
      expect(world.input.steer).toBe(0);
      expect(world.input.buttons).toBe(0);
      expect(world.input.pressed).toBe(0);
      expect(world.vehicle.brushDown).toBe(brushDown);
      expect(countEvents(world.events, EV.ReverseBeeper)).toBe(0);
      expect(atRestBefore).toBe(false);
      const ended = countEvents(world.events, EV.ShiftEnd);
      if (speedOf(world) < REST_SPEED_MPS) {
        // The first tick at rest is the ShiftEnd tick.
        expect(eventsOf(world, EV.ShiftEnd)).toEqual([[EV.ShiftEnd, -1, ShiftEndReason.TimeUp, 0, 0]]);
        expect(world.shift.endTick).toBe(world.tick - 1);
        return n;
      }
      expect(ended).toBe(0);
    }
    throw new Error('Bessie never came to rest');
  }

  it.each([
    [11, 'transit top speed', 3.5],
    [6, 'brush-down top speed', 2.5],
    [0.3, 'creeping', 1],
  ])(
    'from %d m/s (%s) Bessie rolls to rest within %d s, ignoring the driver, then ShiftEnd TIME_UP',
    (v, _, maxS) => {
      const world = knockOffAtSpeed(v);
      // While she is moving above reverse.engageBelowMps the gate holds the knock-off brake.
      world.step(FULL_THROTTLE);
      expect(world.input.throttle).toBe(0);
      expect(world.input.brake).toBe(v >= sweeper.reverse.engageBelowMps ? KNOCK_OFF_BRAKE : 0);
      const ticks = rollToRest(world) + 1;
      expect(ticks).toBeLessThanOrEqual(maxS * SIM_HZ);
      expect(world.vehicle.gear).toBe(Gear.Fwd);
      // After the end she stays put under any input, and the gate leaves nothing on.
      const { xM, yM } = world.vehicle;
      run(world, FULL_THROTTLE, 600);
      expect(world.input).toEqual(NEUTRAL);
      expect(world.vehicle.xM).toBe(xM);
      expect(world.vehicle.yM).toBe(yM);
    },
  );

  it('in REV the gate brakes with the throttle and never shifts gear', () => {
    const world = knockOffAtSpeed(-2.5, Gear.Rev);
    world.step(NEUTRAL);
    expect(world.input.throttle).toBe(KNOCK_OFF_BRAKE);
    expect(world.input.brake).toBe(0);
    rollToRest(world);
    expect(world.vehicle.gear).toBe(Gear.Rev);
  });

  it('waits for lateral slip to die away too: at rest means speed below REST_SPEED_MPS', () => {
    const world = knockOffAtSpeed(0, Gear.Fwd, 1);
    rollToRest(world);
    expect(speedOf(world)).toBeLessThan(REST_SPEED_MPS);
  });

  it('HP reaching 0 during the roll does not turn TIME_UP into TOWED', () => {
    const world = knockOffAtSpeed(6);
    world.vehicle.hp = 0;
    rollToRest(world);
    expect(world.shift.endReason).toBe(ShiftEndReason.TimeUp);
  });
});

describe('TOWED (HP 0) through the same path', () => {
  it.each([
    ['in the rollout', 10],
    ['while the timer runs', 5000],
  ])('%s: ends the shift with ShiftEnd TOWED on the first tick that ends with HP 0', (_, ticks) => {
    const world = createWorld(dumpLevel(), 1, DEFAULT_TUNING);
    run(world, NEUTRAL, ticks);
    world.vehicle.hp = 0;
    world.step(NEUTRAL);
    expect(eventsOf(world, EV.ShiftEnd)).toEqual([[EV.ShiftEnd, -1, ShiftEndReason.Towed, 0, 0]]);
    expect(world.shift.phase).toBe(ShiftPhase.Ended);
    expect(world.shift.endReason).toBe(ShiftEndReason.Towed);
    const remaining = world.shift.ticksRemaining;
    run(world, FULL_THROTTLE, 120);
    expect(world.input.throttle).toBe(0);
    expect(world.shift.ticksRemaining).toBe(remaining);
    expect(world.vehicle.vLongMps).toBe(0);
  });

  it('cuts a drain short (DumpEnd, not completed) on the TOWED tick', () => {
    const world = createWorld(dumpLevel({ ...BAY_CENTRE, heading: 0 }), 1, DEFAULT_TUNING);
    world.vehicle.hopperLU = 60;
    run(world, HOLD, HOLD_TICKS + 30);
    expect(isShiftDraining(world.shift)).toBe(true);
    world.vehicle.hp = 0;
    world.step(HOLD);
    expect(eventsOf(world, EV.DumpEnd)).toEqual([[EV.DumpEnd, BAY, DumpSite.Depot, 15, 0]]);
    expect(eventsOf(world, EV.ShiftEnd)).toHaveLength(1);
    expect(world.vehicle.hopperLU).toBe(45);
    expect(world.hopper.luDumpedDepot).toBe(15);
    expect(isShiftDraining(world.shift)).toBe(false);
  });
});

describe('depot bay dump (GDD §8.7)', () => {
  it('stopped in a bay, 60 ticks of INTERACT start a 120-tick drain that empties the hopper and refills water', () => {
    const world = createWorld(dumpLevel({ ...BAY_CENTRE, heading: 0 }), 1, DEFAULT_TUNING);
    world.vehicle.hopperLU = 80;
    world.vehicle.water = 10;
    for (let t = 1; t < HOLD_TICKS; t += 1) {
      world.step(HOLD);
      expect(world.shift.dumpState).toBe(DumpState.Holding);
      expect(world.shift.holdTicks).toBe(t);
      expect(world.shift.dumpSite).toBe(0);
      expect(countEvents(world.events, EV.DumpStart)).toBe(0);
    }
    expect(world.vehicle.water).toBe(10);
    world.step(NEUTRAL); // hold tick 60 (INTERACT released here: it would cancel)
    expect(world.shift.dumpState).toBe(DumpState.Idle);

    // Again, held the whole time.
    const w2 = createWorld(dumpLevel({ ...BAY_CENTRE, heading: 0 }), 1, DEFAULT_TUNING);
    w2.vehicle.hopperLU = 80;
    w2.vehicle.water = 10;
    run(w2, HOLD, HOLD_TICKS - 1);
    w2.step(HOLD); // hold tick 60: the drain starts
    expect(eventsOf(w2, EV.DumpStart)).toEqual([[EV.DumpStart, BAY, DumpSite.Depot, 80, DEPOT_DRAIN_TICKS]]);
    expect(w2.shift.dumpState).toBe(DumpState.Draining);
    expect(isShiftDraining(w2.shift)).toBe(true);
    expect(w2.vehicle.hopperLU).toBe(80); // the drain runs from the next tick
    expect(w2.vehicle.water).toBe(TANK); // refilled to full as the drain starts

    // The key may be released: the drain runs on. LU fall linearly and hit 0 on drain tick 120, not before.
    let last = 80;
    for (let k = 1; k < DEPOT_DRAIN_TICKS; k += 1) {
      w2.step(NEUTRAL);
      expect(w2.vehicle.hopperLU).toBeLessThan(last);
      expect(w2.vehicle.hopperLU).toBeGreaterThan(0);
      expect(w2.vehicle.hopperLU).toBeCloseTo(80 * (1 - k / DEPOT_DRAIN_TICKS), 2);
      expect(isShiftDraining(w2.shift)).toBe(true);
      expect(countEvents(w2.events, EV.DumpEnd)).toBe(0);
      last = w2.vehicle.hopperLU;
    }
    w2.step(NEUTRAL); // drain tick 120: 180 ticks (3.0 s) after the first hold tick
    expect(w2.vehicle.hopperLU).toBe(0);
    expect(eventsOf(w2, EV.DumpEnd)).toEqual([[EV.DumpEnd, BAY, DumpSite.Depot, 80, 1]]);
    expect(isShiftDraining(w2.shift)).toBe(false);
    expect(w2.shift.dumpState).toBe(DumpState.Idle);
    expect(w2.shift.dumpsCompleted).toBe(1);
    expect(w2.hopper.luDumpedDepot).toBe(80); // the M6 tipping-fee base (£1 per 5 LU)
    expect(w2.hopper.luDumpedTotal).toBe(80);
    expect(w2.vehicle.water).toBe(TANK);
  });

  it('a bay with an empty hopper still refills a tank below full; with a full tank there is nothing to dump', () => {
    const world = createWorld(dumpLevel({ ...BAY_CENTRE, heading: 0 }), 1, DEFAULT_TUNING);
    world.vehicle.water = 40;
    run(world, HOLD, HOLD_TICKS);
    expect(eventsOf(world, EV.DumpStart)).toEqual([
      [EV.DumpStart, BAY, DumpSite.Depot, 0, DEPOT_DRAIN_TICKS],
    ]);
    expect(world.vehicle.water).toBe(TANK);

    const full = createWorld(dumpLevel({ ...BAY_CENTRE, heading: 0 }), 1, DEFAULT_TUNING);
    full.vehicle.water = TANK;
    run(full, HOLD, 300);
    expect(full.shift.dumpState).toBe(DumpState.Idle);
    expect(full.shift.holdTicks).toBe(0);
  });

  it('moving at 0.5 m/s or more during Holding cancels; below it the hold carries on', () => {
    const world = createWorld(dumpLevel({ ...BAY_CENTRE, heading: 0 }), 1, DEFAULT_TUNING);
    world.vehicle.hopperLU = 30;
    run(world, HOLD, 30);
    world.vehicle.vLongMps = 0.49; // drag only slows it: still stopped
    world.step(HOLD);
    expect(world.shift.dumpState).toBe(DumpState.Holding);
    expect(world.shift.holdTicks).toBe(31);
    world.vehicle.vLongMps = 0.6; // still about 0.59 m/s after drag
    world.step(HOLD);
    expect(speedOf(world)).toBeGreaterThan(0.5);
    expect(world.shift.dumpState).toBe(DumpState.Idle);
    expect(world.shift.holdTicks).toBe(0);
    // Once stopped again (INTERACT still held) a new hold starts from 1, and never chains from the old one.
    world.vehicle.vLongMps = 0;
    world.step(HOLD);
    expect(world.shift.dumpState).toBe(DumpState.Holding);
    expect(world.shift.holdTicks).toBe(1);
  });

  it('driving with the key held never holds; releasing INTERACT cancels a hold', () => {
    const world = createWorld(dumpLevel({ x: BAY_CENTRE.x, y: 15.5, heading: 0 }), 1, DEFAULT_TUNING);
    world.vehicle.hopperLU = 30;
    world.vehicle.vLongMps = 1;
    run(world, frame({ buttons: BUTTON.INTERACT, throttle: 40 }), 30);
    expect(world.shift.dumpState).toBe(DumpState.Idle);

    const w2 = createWorld(dumpLevel({ ...BAY_CENTRE, heading: 0 }), 1, DEFAULT_TUNING);
    w2.vehicle.hopperLU = 30;
    run(w2, HOLD, 59);
    w2.step(NEUTRAL);
    expect(w2.shift.dumpState).toBe(DumpState.Idle);
    run(w2, HOLD, 59);
    expect(w2.shift.holdTicks).toBe(59);
    expect(w2.vehicle.hopperLU).toBe(30);
  });

  it('leaving the bay mid-drain stops it: drained LU stay gone, the rest stay in the hopper', () => {
    // 1 m inside the bay's north edge, facing north.
    const world = createWorld(dumpLevel({ x: BAY_CENTRE.x, y: 11, heading: 0 }), 1, DEFAULT_TUNING);
    world.vehicle.hopperLU = 60;
    run(world, HOLD, HOLD_TICKS + 40); // 40 drain ticks: 20 LU gone
    expect(world.vehicle.hopperLU).toBe(40);
    // Drive north out of the bay. Moving inside the bay does not cancel the drain.
    let fastInside = 0;
    let ended: Ev[] = [];
    for (let i = 0; i < 120 && ended.length === 0; i += 1) {
      world.step(FULL_THROTTLE);
      ended = eventsOf(world, EV.DumpEnd);
      if (ended.length === 0 && speedOf(world) > 0.5) fastInside += 1;
    }
    expect(fastInside).toBeGreaterThan(0);
    expect(world.vehicle.yM).toBeLessThan(10); // centre north of the bay's y = 10 edge
    expect(world.vehicle.prevYM).toBeGreaterThanOrEqual(10);
    const left = world.vehicle.hopperLU;
    expect(ended).toEqual([[EV.DumpEnd, BAY, DumpSite.Depot, 60 - left, 0]]);
    expect(left).toBeGreaterThan(0);
    expect(left).toBeLessThan(40);
    expect(world.hopper.luDumpedDepot).toBe(60 - left);
    expect(isShiftDraining(world.shift)).toBe(false);
    expect(world.shift.dumpsCompleted).toBe(0);
    expect(world.vehicle.water).toBe(TANK); // the refill stands
    run(world, NEUTRAL, 300);
    expect(world.vehicle.hopperLU).toBe(left);
  });

  it('after a drain, holding the key does not start another dump: release and hold again', () => {
    const world = createWorld(dumpLevel({ ...BAY_CENTRE, heading: 0 }), 1, DEFAULT_TUNING);
    world.vehicle.hopperLU = 20;
    run(world, HOLD, HOLD_TICKS + DEPOT_DRAIN_TICKS);
    expect(world.shift.dumpsCompleted).toBe(1);
    world.vehicle.hopperLU = 5; // as if collected meanwhile
    run(world, HOLD, 200);
    expect(world.shift.dumpState).toBe(DumpState.Idle);
    world.step(NEUTRAL);
    run(world, HOLD, HOLD_TICKS);
    expect(world.shift.dumpState).toBe(DumpState.Draining);
  });

  it('inside means the body centre is in the bay rectangle, edges included', () => {
    const holdsAt = (x: number, y: number, heading = 0): boolean => {
      const world = createWorld(dumpLevel({ x, y, heading }), 1, DEFAULT_TUNING);
      world.vehicle.hopperLU = 10;
      world.step(HOLD);
      return world.shift.dumpState === DumpState.Holding;
    };
    expect(holdsAt(12, 13)).toBe(true);
    expect(holdsAt(10, 10)).toBe(true);
    expect(holdsAt(14, 16)).toBe(true);
    expect(holdsAt(14, 13, EAST)).toBe(true); // most of the body outside, centre on the edge
    expect(holdsAt(14.01, 13)).toBe(false);
    expect(holdsAt(12, 9.99)).toBe(false);
    expect(holdsAt(12, 16.01, Math.PI)).toBe(false);
  });
});

describe('skip dump (GDD §8.7)', () => {
  it('stopped adjacent, 60 ticks of INTERACT then a 180-tick drain; water unchanged, no tipping-fee LU', () => {
    const world = createWorld(dumpLevel(besideSkip(1)), 1, DEFAULT_TUNING);
    world.vehicle.hopperLU = 50;
    world.vehicle.water = 30;
    run(world, HOLD, HOLD_TICKS - 1);
    expect(world.shift.dumpState).toBe(DumpState.Holding);
    world.step(HOLD);
    expect(eventsOf(world, EV.DumpStart)).toEqual([
      [EV.DumpStart, SKIP, DumpSite.Skip, 50, SKIP_DRAIN_TICKS],
    ]);
    for (let k = 1; k < SKIP_DRAIN_TICKS; k += 1) {
      world.step(NEUTRAL);
      expect(world.vehicle.hopperLU).toBeGreaterThan(0);
      expect(isShiftDraining(world.shift)).toBe(true);
    }
    world.step(NEUTRAL);
    expect(world.vehicle.hopperLU).toBe(0);
    expect(eventsOf(world, EV.DumpEnd)).toEqual([[EV.DumpEnd, SKIP, DumpSite.Skip, 50, 1]]);
    expect(world.vehicle.water).toBe(30);
    expect(world.hopper.luDumpedTotal).toBe(50);
    expect(world.hopper.luDumpedDepot).toBe(0);
  });

  it('an empty hopper has nothing to dump at a skip, even with the tank low', () => {
    const world = createWorld(dumpLevel(besideSkip(1)), 1, DEFAULT_TUNING);
    world.vehicle.water = 5;
    run(world, HOLD, 200);
    expect(world.shift.dumpState).toBe(DumpState.Idle);
    expect(world.vehicle.water).toBe(5);
  });

  it('adjacent means the body OBB within 2 m (one tile) of the skip rectangle', () => {
    const holdsAt = (pose: { x: number; y: number; heading: number }): boolean => {
      const world = createWorld(dumpLevel(pose), 1, DEFAULT_TUNING);
      world.vehicle.hopperLU = 10;
      world.step(HOLD);
      return world.shift.dumpState === DumpState.Holding;
    };
    expect(holdsAt(besideSkip(0.1))).toBe(true);
    expect(holdsAt(besideSkip(1.99))).toBe(true);
    expect(holdsAt(besideSkip(2.01))).toBe(false);
    // Nose-on from the east, facing west: the front bumper within 2 m of the east edge.
    expect(holdsAt({ x: SKIP_RECT.maxX + 1.99 + HALF_L, y: 21, heading: -EAST })).toBe(true);
    expect(holdsAt({ x: SKIP_RECT.maxX + 2.01 + HALF_L, y: 21, heading: -EAST })).toBe(false);
    // Off the north-west corner, turned 45° so her right side faces the corner of the grown box (2 m out on
    // both axes: the grown box has square corners). She reaches it when that corner is within hw of her centre
    // along her right axis.
    const c = { x: SKIP_RECT.minX - 2, y: SKIP_RECT.minY - 2 };
    const diag = (d: number) => ({
      x: c.x - d * Math.SQRT1_2,
      y: c.y - d * Math.SQRT1_2,
      heading: Math.PI / 4,
    });
    expect(holdsAt(diag(HALF_W - 0.01))).toBe(true);
    expect(holdsAt(diag(HALF_W + 0.01))).toBe(false);
    // Her axis-aligned bounding box overlaps the grown box there by 0.3 m on both axes, but the body does not:
    // only the separating-axis test on her own axes rejects it.
    const e = (HALF_W + HALF_L) * Math.SQRT1_2; // the rotated body's AABB half extent
    expect(holdsAt({ x: c.x - e + 0.3, y: c.y - e + 0.3, heading: Math.PI / 4 })).toBe(false);
  });

  it('driving away from the skip mid-drain stops the drain', () => {
    const world = createWorld(dumpLevel(besideSkip(1)), 1, DEFAULT_TUNING);
    world.vehicle.hopperLU = 90;
    run(world, HOLD, HOLD_TICKS + 60); // 60 of 180 drain ticks: 30 LU gone
    expect(world.vehicle.hopperLU).toBe(60);
    world.vehicle.yM += 3; // pushed clear (as if driven off)
    world.step(NEUTRAL);
    expect(eventsOf(world, EV.DumpEnd)).toEqual([[EV.DumpEnd, SKIP, DumpSite.Skip, 30, 0]]);
    expect(world.vehicle.hopperLU).toBe(60);
  });
});

describe('time up and dumping (GDD §5.3, §20 Q10)', () => {
  it('the knock-off cuts a drain short; LU still in the hopper are not dumped (no tipping fee)', () => {
    const world = createWorld(dumpLevel({ ...BAY_CENTRE, heading: 0 }), 1, DEFAULT_TUNING);
    run(world, NEUTRAL, ROLLOUT_TICKS); // the timer starts on tick 180
    run(world, NEUTRAL, SHIFT_TICKS - (HOLD_TICKS + 30)); // leaves 90 timer ticks
    world.vehicle.hopperLU = 100;
    run(world, HOLD, HOLD_TICKS + 29); // 29 drain ticks
    expect(world.shift.ticksRemaining).toBe(1);
    expect(isShiftDraining(world.shift)).toBe(true);
    world.step(HOLD); // drain tick 30 runs, then the timer hits 0
    expect(world.shift.ticksRemaining).toBe(0);
    expect(eventsOf(world, EV.DumpEnd)).toEqual([[EV.DumpEnd, BAY, DumpSite.Depot, 25, 0]]);
    expect(eventsOf(world, EV.ShiftEnd)).toEqual([[EV.ShiftEnd, -1, ShiftEndReason.TimeUp, 0, 0]]);
    // DumpEnd is emitted before ShiftEnd.
    expect(world.events.type[0]).toBe(EV.DumpEnd);
    expect(world.vehicle.hopperLU).toBe(75);
    expect(world.hopper.luDumpedDepot).toBe(25);
    run(world, HOLD, 300);
    expect(world.vehicle.hopperLU).toBe(75);
    expect(world.shift.dumpState).toBe(DumpState.Idle);
  });
});

describe('determinism and allocation', () => {
  it('two Worlds with the same inputs agree on every shift field and event', () => {
    const make = (): World => {
      const world = createWorld(dumpLevel({ ...BAY_CENTRE, heading: 0 }), 3, DEFAULT_TUNING);
      world.vehicle.hopperLU = 70;
      return world;
    };
    const a = make();
    const b = make();
    for (let t = 0; t < 1200; t += 1) {
      const input = t < 200 ? HOLD : t < 260 ? FULL_THROTTLE : frame({ steer: 40, throttle: 100 });
      a.step(input);
      b.step(input);
      expect(eventsOf(a, EV.DumpEnd)).toEqual(eventsOf(b, EV.DumpEnd));
    }
    const { vehicle: _va, hopper: _ha, tank: _ta, ...sa } = a.shift;
    const { vehicle: _vb, hopper: _hb, tank: _tb, ...sb } = b.shift;
    expect(sa).toEqual(sb);
    expect(a.vehicle).toEqual(b.vehicle);
  });

  it('stepWorld allocates nothing per tick while holding, draining, cancelling and ended (§17 heap-delta check)', () => {
    // Endless shifts so the dump cycles run for the whole window; a third World is knocked off and stays Ended.
    const endless = endlessShiftTuning();
    const bay = createWorld(dumpLevel({ ...BAY_CENTRE, heading: 0 }), 7, endless);
    const skip = createWorld(dumpLevel(besideSkip(1)), 7, endless);
    const ended = createWorld(
      dumpLevel(),
      7,
      tuningWith((raw) => (raw.shift.durationS = 4)),
    );
    const cycle = 400;
    const step = (tick: number): void => {
      const phase = tick % cycle;
      if (phase === 0) {
        bay.vehicle.hopperLU = 64.5;
        bay.vehicle.water = 20.25;
        skip.vehicle.hopperLU = 33.75;
      }
      // 0..199 hold (60) and drain (120 / 180 ticks), 200 release, 201..260 a hold cancelled at 230 by speed,
      // then idle.
      const input = phase < 200 ? HOLD : phase === 200 ? NEUTRAL : phase < 261 ? HOLD : NEUTRAL;
      if (phase === 230) {
        bay.vehicle.vLongMps = 0.75;
        skip.vehicle.vLongMps = 0.75;
      }
      if (phase === 240) {
        bay.vehicle.vLongMps = 0;
        bay.vehicle.xM = BAY_CENTRE.x;
        bay.vehicle.yM = BAY_CENTRE.y;
        skip.vehicle.vLongMps = 0;
        const p = besideSkip(1);
        skip.vehicle.xM = p.x;
        skip.vehicle.yM = p.y;
      }
      bay.step(input);
      skip.step(input);
      ended.step(FULL_THROTTLE);
    };
    // Pre-warm until V8 has optimised the whole tick (see the note in tests/unit/world.test.ts).
    for (let tick = 0; tick < 30_000; tick += 1) step(tick);
    let starts = 0;
    let ends = 0;
    for (let tick = 30_000; tick < 30_000 + 4 * cycle; tick += 1) {
      step(tick);
      starts += countEvents(bay.events, EV.DumpStart) + countEvents(skip.events, EV.DumpStart);
      ends += countEvents(bay.events, EV.DumpEnd) + countEvents(skip.events, EV.DumpEnd);
    }
    expect(starts).toBe(8);
    expect(ends).toBe(8);
    expect(ended.shift.phase).toBe(ShiftPhase.Ended);
    const delta = measureHeapDelta((t) => step(40_000 + t));
    assertHeapDeltaWithinThresholds(delta);
  });
});
