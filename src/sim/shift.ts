// The shift (TECHNICAL_DESIGN §5.1, §5.2 phase 10, §10.5; GDD §5.3, §8.7; LEVEL_DESIGN §4.1; SSP-062): the
// 240 s integer-tick timer and its rollout start, the depot-bay and skip dump FSM, the knock-off and the
// end-of-shift event the scenes turn into the tally.
//
// Phases (ShiftPhase). Rollout → Running → KnockOff → Ended; Rollout or Running → Ended directly on TOWED.
//   - Rollout: the shift starts with Bessie stationary at `@`. The timer starts on the first tick whose input
//     has throttle > 0, or on tick rolloutTicks (180: tuning.json shift.rolloutS × 60) if no throttle came
//     first, whichever is earlier (LEVEL_DESIGN §4.1, §13 Q3, decided in SSP-062). The start tick is the
//     timer's first tick: at the end of it ticksRemaining is 14,399, and it reaches 0 at the end of the
//     14,400th timer tick (start + 14,399). With `firstPlay` (the first play of Puddle Lane, GDD §16.1; M6's
//     SSP-186 computes it from the save, nothing sets it in M2) only the first BRUSH press edge starts it:
//     neither throttle nor the rollout fallback does.
//   - Running: ticksRemaining counts down by one per tick (an integer, never a float, §5.1).
//   - KnockOff ("KNOCK-OFF TIME!", GDD §5.3): from the tick after ticksRemaining reaches 0, the driver's input
//     is ignored (gateShiftInput, phase 1) and Bessie rolls to a stop under the knock-off brake. A dump in
//     progress is cut short. On the first tick that ends with Bessie at rest (speed below REST_SPEED_MPS) the
//     shift ends with EV.ShiftEnd (TIME_UP); if she is already at rest when the timer reaches 0, that is the
//     same tick. Once knocked off, the reason is settled: HP reaching 0 during the roll no longer means TOWED.
//   - Ended: EV.ShiftEnd has fired (once per shift); endReason and endTick say why and when. The World keeps
//     stepping (the scene moves to the tally) with the input still gated, so nothing more happens.
//   - TOWED (the M1 stub of SSP-036, now on this path): in Rollout or Running, the first tick that ends with
//     HP ≤ 0 ends the shift at once with reason TOWED. Its 50% score and no-stars rules are M3 (SSP-079).
//   Undumped LU at the end pay nothing (GDD §20 Q10, decided in SSP-062): the tipping-fee base is
//   hopper.luDumpedDepot, which a drain cut short by the knock-off counts only up to its last tick.
//
// Knock-off brake (decided in SSP-062): a pure coast on the M1 drag numbers takes 15–19 s from brush-down or
// transit top speed, so the gated input holds tuning.json shift.knockOffBrake (0.5: half brake, 3 m/s²) while
// |vLong| ≥ reverse.engageBelowMps (0.2 m/s), and nothing below it, where drag finishes the stop. In REV the
// throttle is the brake. The brake is released before Bessie is slow enough to engage reverse, so the gate can
// never back her up. From 11 m/s she stops in 3.4 s (15 m), from 6 m/s in 2.3 s (5 m), from 1 m/s in 0.8 s.
//
// Dumping (GDD §8.7, TECHNICAL_DESIGN §10.5): DumpState Idle → Holding → Draining → Idle, on INTERACT held
// (BUTTON.INTERACT: E / pad Y). Sites are the compiled level's `sites` with id site.depot_bay or site.skip.
//   - At a site (decided in SSP-062): a depot bay when Bessie's body centre is inside the bay's rectangle
//     (edges inclusive); a skip when her body OBB overlaps the skip's rectangle grown by dumping.skip.reachM
//     (2 m, one tile) on every side (an exact SAT test of the OBB against that box).
//   - Stopped at a site: at it, with speed sqrt(vLong² + vLat²) below the site's maxSpeedMps (0.5 m/s).
//   - Something to dump: LU in the hopper; at a depot bay a tank below full also counts (the bay refills it).
//   - Idle → Holding: INTERACT held, stopped at a site with something to dump (the first such site in level
//     order). That tick is hold tick 1.
//   - Holding: each tick with INTERACT held and Bessie still stopped at the site adds a hold tick. Releasing
//     INTERACT, leaving the site or reaching maxSpeedMps cancels back to Idle (no event).
//   - Holding → Draining: on the tick the hold reaches holdS × 60 ticks (60), the drain starts
//     (hopper.startHopperDrain over drainS × 60 ticks: 120 at a depot bay, 180 at a skip), a depot bay refills
//     the water to full (water.refillWater), and EV.DumpStart fires. The drain runs from the next tick, one
//     stepHopperDrain per tick, so a full hopper is empty 1.0 s + the drain time after the first hold tick.
//     INTERACT need not stay held.
//   - Draining → Idle: when the drain completes, or on the first tick Bessie is no longer at the site (for a
//     bay, her centre has left it; speed does not matter while draining), which cancels the rest. LU already
//     drained stay gone and stay counted as dumped (hopper.cancelHopperDrain); a depot bay's refill stands.
//     EV.DumpEnd fires either way. A new dump needs INTERACT released and pressed again, so holding the key
//     never chains dumps.
//   isShiftDraining is true from the DumpStart tick to the DumpEnd tick: combo.ts (SSP-063) freezes the chain
//   timer while it holds (GDD §20 Q4, decided in SSP-062).
//
// Hot path: stepShift and gateShiftInput allocate nothing and pass no doubles across calls (V8 boxes a double
// argument or return value of a call it does not inline; TECHNICAL_DESIGN §17). Bessie's axes are computed on
// every Rollout/Running tick, so the trig calls stay hot. createShift and setShiftTuning run at shift start and
// between ticks.

import { SIM_HZ, TILE_M } from './constants.ts';
import { EV, type EventQueue, emitEvent, ShiftEndReason } from './eventQueue.ts';
import { cos, sin } from './fmath.ts';
import { cancelHopperDrain, DumpSite, type Hopper, startHopperDrain, stepHopperDrain } from './hopper.ts';
import { BRAKE_MAX, BUTTON, type InputFrame, PRESSED } from './inputFrame.ts';
import type { Level } from './map.ts';
import type { Tuning, WaterTuning } from './tuning.ts';
import { Gear, type VehicleState } from './vehicle.ts';
import { refillWater } from './water.ts';

/** The compiled-level site id of a depot bay. */
export const DEPOT_BAY_SITE_ID = 'site.depot_bay';

/** The compiled-level site id of a skip. */
export const SKIP_SITE_ID = 'site.skip';

/**
 * Bessie is at rest for the knock-off when her speed is below this (m/s): the replay hash's 1e-4 resolution.
 * vLong reaches exactly 0 (drag never flips its sign), but lateral slip decays exponentially and never does.
 */
export const REST_SPEED_MPS = 1e-4;

/** Where the shift is (see the header). */
export const ShiftPhase = { Rollout: 0, Running: 1, KnockOff: 2, Ended: 3 } as const;
export type ShiftPhase = (typeof ShiftPhase)[keyof typeof ShiftPhase];

/** The dump FSM (GDD §8.7, TECHNICAL_DESIGN §10.5). */
export const DumpState = { Idle: 0, Holding: 1, Draining: 2 } as const;
export type DumpState = (typeof DumpState)[keyof typeof DumpState];

/** Shift start parameters. */
export type ShiftOptions = {
  /**
   * The first play of Puddle Lane (GDD §16.1): the timer waits for the first BRUSH press instead of throttle or
   * the rollout. Default false; nothing sets it until SSP-186 (M6) computes it from the save.
   */
  readonly firstPlay?: boolean;
};

/** The tank a depot bay refills: Bessie's water and the water tuning (its tankUnits is "full"). */
export type ShiftTank = { readonly vehicle: VehicleState; tuning: WaterTuning };

/** One shift. Create with createShift; only the sim writes it. */
export type Shift = {
  /** Bessie: speed and pose for the site tests, hp for TOWED. */
  readonly vehicle: VehicleState;
  /** Bessie's hopper, which the dump drains. */
  readonly hopper: Hopper;
  /** The tank a depot bay refills. */
  readonly tank: ShiftTank;
  /** The first-play timer rule (ShiftOptions.firstPlay). */
  readonly firstPlay: boolean;
  phase: ShiftPhase;
  /** stepShift calls so far: the index of the next tick it runs (World.tick in a World). */
  ticksRun: number;
  /** The tick the timer started on (its first timer tick), or −1 during the rollout. */
  timerStartTick: number;
  /** Timer ticks left: durationTicks until the timer starts, then down by one per tick to 0. */
  ticksRemaining: number;
  /** The tick ticksRemaining reached 0, or −1. */
  knockOffTick: number;
  /** Why the shift ended, or 0 while it runs. */
  endReason: ShiftEndReason | 0;
  /** The tick EV.ShiftEnd fired, or −1. */
  endTick: number;

  dumpState: DumpState;
  /** The dump site (index into the site arrays below) being held or drained, or −1. */
  dumpSite: number;
  /** Hold ticks so far while Holding, 1..holdTicks; 0 otherwise. */
  holdTicks: number;
  /** hopper.luDumpedTotal when the current drain started (DumpEnd reports the difference). */
  drainLuDumpedAtStart: number;
  /** INTERACT must be released before the next dump can start (set when a drain ends). */
  dumpNeedsRelease: boolean;
  /** Drains that ran to completion this shift. */
  dumpsCompleted: number;

  // Tuning, copied as plain numbers by setShiftTuning so the per-tick loads stay monomorphic.
  /** Timer length in ticks (shift.durationS × 60). */
  durationTicks: number;
  /** Rollout fallback in ticks (shift.rolloutS × 60). */
  rolloutTicks: number;
  /** The knock-off brake as an InputFrame value, round(shift.knockOffBrake × BRAKE_MAX). */
  knockOffBrakeInput: number;
  /** reverse.engageBelowMps: the gate releases the brake below it. */
  releaseBelowMps: number;
  depotHoldTicks: number;
  depotDrainTicks: number;
  depotMaxSpeedMps: number;
  skipHoldTicks: number;
  skipDrainTicks: number;
  skipMaxSpeedMps: number;
  skipReachM: number;
  /** Half of Bessie's body width and length (vehicle.sweeper.body), m. */
  halfWidthM: number;
  halfLengthM: number;

  /** Bessie's right and forward unit axes at the last Rollout/Running stepShift. */
  rightX: number;
  rightY: number;
  forwardX: number;
  forwardY: number;

  /** Dump sites in level order. */
  readonly siteCount: number;
  /** DumpSite per site. */
  readonly siteKind: Uint8Array;
  /** The site's index in level.sites (the DumpStart/DumpEnd `entity`). */
  readonly siteLevelIndex: Int32Array;
  /** The site's rectangle in metres (tile rect × TILE_M; max exclusive in tiles, inclusive here). */
  readonly siteMinX: Float64Array;
  readonly siteMinY: Float64Array;
  readonly siteMaxX: Float64Array;
  readonly siteMaxY: Float64Array;
};

/** What render, audio and UI may see. */
export type ShiftView = {
  readonly firstPlay: boolean;
  readonly phase: ShiftPhase;
  readonly ticksRun: number;
  readonly timerStartTick: number;
  readonly ticksRemaining: number;
  readonly knockOffTick: number;
  readonly endReason: ShiftEndReason | 0;
  readonly endTick: number;
  readonly dumpState: DumpState;
  readonly dumpSite: number;
  readonly holdTicks: number;
  readonly dumpsCompleted: number;
  readonly durationTicks: number;
  readonly rolloutTicks: number;
  readonly siteCount: number;
  readonly siteKind: ArrayLike<number>;
  readonly siteLevelIndex: ArrayLike<number>;
};

/** Seconds × SIM_HZ as whole ticks (tuning.ts has already checked that they are whole). */
function ticksOf(seconds: number): number {
  return Math.round(seconds * SIM_HZ);
}

/**
 * A new shift on `level` for Bessie (`vehicle`, `hopper`, `tank`), in Rollout with the full timer. Dump sites
 * are the level's site.depot_bay and site.skip entries, in level order. Setup only: allocates.
 */
export function createShift(
  level: Level,
  vehicle: VehicleState,
  hopper: Hopper,
  tank: ShiftTank,
  tuning: Tuning,
  options: ShiftOptions = {},
): Shift {
  let n = 0;
  for (const s of level.sites) if (s.id === DEPOT_BAY_SITE_ID || s.id === SKIP_SITE_ID) n += 1;
  const siteKind = new Uint8Array(n);
  const siteLevelIndex = new Int32Array(n);
  const siteMinX = new Float64Array(n);
  const siteMinY = new Float64Array(n);
  const siteMaxX = new Float64Array(n);
  const siteMaxY = new Float64Array(n);
  let k = 0;
  for (let i = 0; i < level.sites.length; i += 1) {
    const s = level.sites[i];
    if (s === undefined) continue;
    const kind = s.id === DEPOT_BAY_SITE_ID ? DumpSite.Depot : s.id === SKIP_SITE_ID ? DumpSite.Skip : 0;
    if (kind === 0) continue;
    const [x0, y0, x1, y1] = s.rect;
    siteKind[k] = kind;
    siteLevelIndex[k] = i;
    siteMinX[k] = x0 * TILE_M;
    siteMinY[k] = y0 * TILE_M;
    siteMaxX[k] = x1 * TILE_M;
    siteMaxY[k] = y1 * TILE_M;
    k += 1;
  }
  const shift: Shift = {
    vehicle,
    hopper,
    tank,
    firstPlay: options.firstPlay === true,
    phase: ShiftPhase.Rollout,
    ticksRun: 0,
    timerStartTick: -1,
    ticksRemaining: 0,
    knockOffTick: -1,
    endReason: 0,
    endTick: -1,
    dumpState: DumpState.Idle,
    dumpSite: -1,
    holdTicks: 0,
    // Fractional values first so the double fields start as doubles (TECHNICAL_DESIGN §17, deprecated maps).
    drainLuDumpedAtStart: 0.5,
    dumpNeedsRelease: false,
    dumpsCompleted: 0,
    durationTicks: 0,
    rolloutTicks: 0,
    knockOffBrakeInput: 0,
    releaseBelowMps: 0.5,
    depotHoldTicks: 0,
    depotDrainTicks: 0,
    depotMaxSpeedMps: 0.5,
    skipHoldTicks: 0,
    skipDrainTicks: 0,
    skipMaxSpeedMps: 0.5,
    skipReachM: 0.5,
    halfWidthM: 0.5,
    halfLengthM: 0.5,
    rightX: 0.5,
    rightY: 0.5,
    forwardX: 0.5,
    forwardY: 0.5,
    siteCount: n,
    siteKind,
    siteLevelIndex,
    siteMinX,
    siteMinY,
    siteMaxX,
    siteMaxY,
  };
  shift.drainLuDumpedAtStart = 0;
  setShiftTuning(shift, tuning);
  shift.ticksRemaining = shift.durationTicks;
  return shift;
}

/** The read-only view of `shift`. No copy: it is the same object. */
export function viewShift(shift: Shift): ShiftView {
  return shift;
}

/**
 * Hand the shift a new tuning between ticks (setWorldTuning, the dev panel). Before the timer starts the timer
 * is reset to the new duration; once it runs, ticksRemaining carries on. A hold or drain in progress keeps its
 * own length (the drain's lives on the hopper); new hold lengths apply from the next tick.
 */
export function setShiftTuning(shift: Shift, tuning: Tuning): void {
  const d = tuning.dumping;
  const sweeper = tuning.vehicle.sweeper;
  shift.tank.tuning = tuning.water;
  shift.durationTicks = ticksOf(tuning.shift.durationS);
  shift.rolloutTicks = ticksOf(tuning.shift.rolloutS);
  shift.knockOffBrakeInput = Math.round(tuning.shift.knockOffBrake * BRAKE_MAX);
  shift.releaseBelowMps = sweeper.reverse.engageBelowMps;
  shift.depotHoldTicks = ticksOf(d.depotBay.holdS);
  shift.depotDrainTicks = ticksOf(d.depotBay.drainS);
  shift.depotMaxSpeedMps = d.depotBay.maxSpeedMps;
  shift.skipHoldTicks = ticksOf(d.skip.holdS);
  shift.skipDrainTicks = ticksOf(d.skip.drainS);
  shift.skipMaxSpeedMps = d.skip.maxSpeedMps;
  shift.skipReachM = d.skip.reachM;
  shift.halfWidthM = sweeper.body.widthM / 2;
  shift.halfLengthM = sweeper.body.lengthM / 2;
  if (shift.phase === ShiftPhase.Rollout) shift.ticksRemaining = shift.durationTicks;
}

/** True while a dump drain runs (DumpStart to DumpEnd): combo.ts freezes the chain timer (GDD §20 Q4). */
export function isShiftDraining(shift: ShiftView): boolean {
  return shift.dumpState === DumpState.Draining;
}

/** True once the timer has run out or the shift has ended: phase 1 replaces the driver's input. */
export function shiftIgnoresInput(shift: ShiftView): boolean {
  return shift.phase === ShiftPhase.KnockOff || shift.phase === ShiftPhase.Ended;
}

/** True while the timer counts down. */
export function isShiftTimerRunning(shift: ShiftView): boolean {
  return shift.phase === ShiftPhase.Running;
}

/**
 * Timer ticks elapsed since the timer started (0 during the rollout): the event clock of LEVEL_DESIGN §4.1,
 * where 0 is timer start.
 */
export function shiftElapsedTicks(shift: ShiftView): number {
  return shift.timerStartTick < 0 ? 0 : shift.durationTicks - shift.ticksRemaining;
}

/**
 * Phase 1, after the input is copied and recorded: once the shift is over (KnockOff or Ended) replace the
 * driver's input with the knock-off brake (see the header). The recorder has already logged what the player
 * pressed, so a replay still reproduces. Allocation-free.
 */
export function gateShiftInput(shift: Shift, input: InputFrame): void {
  if (shift.phase !== ShiftPhase.KnockOff && shift.phase !== ShiftPhase.Ended) return;
  const v = shift.vehicle;
  const moving = (v.vLongMps < 0 ? -v.vLongMps : v.vLongMps) >= shift.releaseBelowMps;
  const brake = moving ? shift.knockOffBrakeInput : 0;
  // In FWD the brake slows Bessie; in REV the throttle does (vehicle.ts step 4).
  input.throttle = v.gear === Gear.Rev ? brake : 0;
  input.brake = v.gear === Gear.Rev ? 0 : brake;
  input.steer = 0;
  input.buttons = 0;
  input.pressed = 0;
}

/**
 * Phase 10: TOWED, the timer start, the dump FSM, the countdown and the knock-off, in that order (see the
 * header). Reads this tick's (gated) input and Bessie after phases 2–9. Allocation-free.
 */
export function stepShift(shift: Shift, input: Readonly<InputFrame>, events: EventQueue): void {
  const tick = shift.ticksRun;
  shift.ticksRun = tick + 1;
  if (shift.phase === ShiftPhase.Ended) return;

  if (shift.phase !== ShiftPhase.KnockOff) {
    if (shift.vehicle.hp <= 0) {
      stopDump(shift, events);
      endShift(shift, ShiftEndReason.Towed, tick, events);
      return;
    }
    if (shift.phase === ShiftPhase.Rollout && timerStartsOn(shift, input, tick)) {
      shift.phase = ShiftPhase.Running;
      shift.timerStartTick = tick;
    }
    stepDump(shift, input, events);
    if (shift.phase === ShiftPhase.Running) {
      shift.ticksRemaining -= 1;
      if (shift.ticksRemaining <= 0) {
        shift.ticksRemaining = 0;
        shift.phase = ShiftPhase.KnockOff;
        shift.knockOffTick = tick;
        stopDump(shift, events);
      }
    }
  }

  if (shift.phase === ShiftPhase.KnockOff) {
    const v = shift.vehicle;
    if (v.vLongMps * v.vLongMps + v.vLatMps * v.vLatMps < REST_SPEED_MPS * REST_SPEED_MPS) {
      endShift(shift, ShiftEndReason.TimeUp, tick, events);
    }
  }
}

/** The rollout start rule (see the header). */
function timerStartsOn(shift: Shift, input: Readonly<InputFrame>, tick: number): boolean {
  if (shift.firstPlay) return (input.pressed & PRESSED.BRUSH) !== 0;
  return input.throttle > 0 || tick >= shift.rolloutTicks;
}

function endShift(shift: Shift, reason: ShiftEndReason, tick: number, events: EventQueue): void {
  shift.phase = ShiftPhase.Ended;
  shift.endReason = reason;
  shift.endTick = tick;
  const e = emitEvent(events, EV.ShiftEnd, -1);
  events.a[e] = reason;
}

/** The dump FSM's tick (see the header). */
function stepDump(shift: Shift, input: Readonly<InputFrame>, events: EventQueue): void {
  writeAxes(shift);
  const held = (input.buttons & BUTTON.INTERACT) !== 0;
  if (!held) shift.dumpNeedsRelease = false;

  if (shift.dumpState === DumpState.Draining) {
    const s = shift.dumpSite;
    if (!isAtSite(shift, s)) {
      cancelHopperDrain(shift.hopper);
      endDump(shift, false, events);
    } else if (stepHopperDrain(shift.hopper)) {
      shift.dumpsCompleted += 1;
      endDump(shift, true, events);
    }
    return;
  }

  let s = shift.dumpSite;
  if (shift.dumpState === DumpState.Holding) {
    if (!held || !isStoppedAtSite(shift, s) || !hasSomethingToDump(shift, s)) {
      shift.dumpState = DumpState.Idle;
      shift.dumpSite = -1;
      shift.holdTicks = 0;
      return;
    }
    shift.holdTicks += 1;
  } else {
    if (!held || shift.dumpNeedsRelease) return;
    s = findDumpSite(shift);
    if (s < 0) return;
    shift.dumpState = DumpState.Holding;
    shift.dumpSite = s;
    shift.holdTicks = 1;
  }
  const depot = shift.siteKind[s] === DumpSite.Depot;
  if (shift.holdTicks >= (depot ? shift.depotHoldTicks : shift.skipHoldTicks)) startDump(shift, s, events);
}

/** Holding → Draining at site `s`: start the hopper drain, refill a depot bay's water, emit EV.DumpStart. */
function startDump(shift: Shift, s: number, events: EventQueue): void {
  const kind = shift.siteKind[s] === DumpSite.Depot ? DumpSite.Depot : DumpSite.Skip;
  const drainTicks = kind === DumpSite.Depot ? shift.depotDrainTicks : shift.skipDrainTicks;
  const hopper = shift.hopper;
  const e = emitEvent(events, EV.DumpStart, shift.siteLevelIndex[s] as number);
  events.a[e] = kind;
  events.b[e] = shift.vehicle.hopperLU;
  events.c[e] = drainTicks;
  shift.drainLuDumpedAtStart = hopper.luDumpedTotal;
  startHopperDrain(hopper, kind, drainTicks);
  if (kind === DumpSite.Depot) refillWater(shift.tank);
  shift.dumpState = DumpState.Draining;
  shift.holdTicks = 0;
}

/** Draining → Idle: emit EV.DumpEnd (completed or cut short) and require INTERACT to be released. */
function endDump(shift: Shift, completed: boolean, events: EventQueue): void {
  const s = shift.dumpSite;
  const e = emitEvent(events, EV.DumpEnd, shift.siteLevelIndex[s] as number);
  events.a[e] = shift.siteKind[s] as number;
  events.b[e] = shift.hopper.luDumpedTotal - shift.drainLuDumpedAtStart;
  events.c[e] = completed ? 1 : 0;
  shift.dumpState = DumpState.Idle;
  shift.dumpSite = -1;
  shift.holdTicks = 0;
  shift.dumpNeedsRelease = true;
}

/** Cut a dump short (knock-off, TOWED): a drain ends with DumpEnd (cut short), a hold just stops. */
function stopDump(shift: Shift, events: EventQueue): void {
  if (shift.dumpState === DumpState.Draining) {
    cancelHopperDrain(shift.hopper);
    endDump(shift, false, events);
  } else if (shift.dumpState === DumpState.Holding) {
    shift.dumpState = DumpState.Idle;
    shift.dumpSite = -1;
    shift.holdTicks = 0;
  }
}

/** The first site in level order where Bessie is stopped with something to dump, or −1. */
function findDumpSite(shift: Shift): number {
  for (let s = 0; s < shift.siteCount; s += 1) {
    if (isStoppedAtSite(shift, s) && hasSomethingToDump(shift, s)) return s;
  }
  return -1;
}

/** LU in the hopper, or (at a depot bay) a tank below full. */
function hasSomethingToDump(shift: Shift, s: number): boolean {
  const v = shift.vehicle;
  if (v.hopperLU > 0) return true;
  return shift.siteKind[s] === DumpSite.Depot && v.water < shift.tank.tuning.tankUnits;
}

/** At site `s` with speed below its maxSpeedMps. */
function isStoppedAtSite(shift: Shift, s: number): boolean {
  const v = shift.vehicle;
  const max = shift.siteKind[s] === DumpSite.Depot ? shift.depotMaxSpeedMps : shift.skipMaxSpeedMps;
  if (!(v.vLongMps * v.vLongMps + v.vLatMps * v.vLatMps < max * max)) return false;
  return isAtSite(shift, s);
}

/**
 * At site `s` (see the header): a depot bay contains Bessie's body centre; a skip's rectangle grown by
 * skipReachM overlaps her body OBB (separating-axis test on the box's two axes and the OBB's two axes, touching
 * counts). Uses the axes stepDump wrote this tick.
 */
function isAtSite(shift: Shift, s: number): boolean {
  const v = shift.vehicle;
  const x = v.xM;
  const y = v.yM;
  let minX = shift.siteMinX[s] as number;
  let minY = shift.siteMinY[s] as number;
  let maxX = shift.siteMaxX[s] as number;
  let maxY = shift.siteMaxY[s] as number;
  if (shift.siteKind[s] === DumpSite.Depot) return x >= minX && x <= maxX && y >= minY && y <= maxY;
  const reach = shift.skipReachM;
  minX -= reach;
  minY -= reach;
  maxX += reach;
  maxY += reach;
  const bx = (maxX - minX) / 2;
  const by = (maxY - minY) / 2;
  const dx = x - (minX + maxX) / 2;
  const dy = y - (minY + maxY) / 2;
  const hw = shift.halfWidthM;
  const hl = shift.halfLengthM;
  const rx = shift.rightX;
  const ry = shift.rightY;
  const fx = shift.forwardX;
  const fy = shift.forwardY;
  const arx = rx < 0 ? -rx : rx;
  const ary = ry < 0 ? -ry : ry;
  const afx = fx < 0 ? -fx : fx;
  const afy = fy < 0 ? -fy : fy;
  const adx = dx < 0 ? -dx : dx;
  const ady = dy < 0 ? -dy : dy;
  if (adx > bx + hw * arx + hl * afx) return false;
  if (ady > by + hw * ary + hl * afy) return false;
  const dr = dx * rx + dy * ry;
  if ((dr < 0 ? -dr : dr) > hw + bx * arx + by * ary) return false;
  const df = dx * fx + dy * fy;
  return (df < 0 ? -df : df) <= hl + bx * afx + by * afy;
}

/** Bessie's right and forward unit axes for her current heading (src/sim/coords.ts). */
function writeAxes(shift: Shift): void {
  const h = shift.vehicle.headingRad;
  const c = cos(h);
  const sn = sin(h);
  // right = (c, s), forward = (s, −c).
  shift.rightX = c;
  shift.rightY = sn;
  shift.forwardX = sn;
  shift.forwardY = -c;
}
