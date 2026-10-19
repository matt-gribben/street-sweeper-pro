// The shift (TECHNICAL_DESIGN §5.1, §5.2 phase 10, §10.5; GDD §5.3, §8.7, §11.3; LEVEL_DESIGN §4.1; SSP-062,
// SSP-079): the 240 s integer-tick timer and its rollout start, the depot-bay and skip dump FSM, the knock-off,
// the fail states and the end-of-shift event the scenes turn into the tally. Since SSP-088 also the level's
// event runner for the market and the market close (LEVEL_DESIGN §4.3; the section at the end of the file).
//
// Phases (ShiftPhase). Rollout → Running → KnockOff → Ended; Rollout or Running → Ended directly on SACKED or
// TOWED.
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
//     same tick. Once knocked off, the reason is settled: a 5th complaint or HP reaching 0 during the roll no
//     longer means SACKED or TOWED (decided in SSP-079, GDD §11.3).
//   - Ended: EV.ShiftEnd has fired (once per shift); endReason and endTick say why and when. The sim is frozen
//     from the next tick on: world.ts stepWorld runs no phase once the shift has Ended (SSP-079), so the state
//     the tally shows is the state the shift ended in, however often step() is called after it.
//   - The fail states (GDD §11.3, SSP-079), checked first in Rollout and Running, against the state phases 2–9
//     left this tick:
//       SACKED: the complaints meter (complaints.ts) has reached its cap, tuning.json complaints.meter.sackedAt
//         (5), which phase 9 filed this tick or earlier;
//       TOWED: Bessie's HP is ≤ 0 (phase 2 hazards, phase 3 impacts).
//     Either ends the shift at once (a dump in progress is cut short). Precedence (decided in SSP-079, GDD §11.3):
//     on a tick that does both, SACKED wins, as the meter is the shift's rule and the HP the vehicle's.
//   The tally's figures (GDD §11.3, decided in SSP-079): finalShiftScore is the score, except TOWED keeps
//   floor(endStates.towedScoreKeep × score) (0.5: half, rounded down to an integer; computed in integer ppm, so
//   no float product can land a hair under a whole number); finalShiftStars is the would-be stars after TIME UP
//   and 0 after SACKED or TOWED. SACKED keeps the score shown (nothing is banked: £ is M6).
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
import { LITTER_IDS } from './entities.ts';
import { EV, type EventQueue, emitEvent, ShiftEndReason } from './eventQueue.ts';
import { cos, sin } from './fmath.ts';
import type { SpillTable } from './hazards.ts';
import { cancelHopperDrain, DumpSite, type Hopper, startHopperDrain, stepHopperDrain } from './hopper.ts';
import { BRAKE_MAX, BUTTON, type InputFrame, PRESSED } from './inputFrame.ts';
import { addLitterAt, LITTER_ROTATIONS, type LitterField } from './litter.ts';
import { COLLIDE, type JsonValue, type Level } from './map.ts';
import { nextFloat, nextInt, type Sfc32 } from './rng.ts';
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

/** towedScoreKeep is held in parts per million, so the TOWED score is integer arithmetic (see the header). */
const KEEP_PPM = 1_000_000;

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

/** What SACKED reads of the complaints meter (complaints.ts Complaints): the count and its cap. */
export type ShiftComplaints = { readonly count: number; readonly max: number };

/** One shift. Create with createShift; only the sim writes it. */
export type Shift = {
  /** Bessie: speed and pose for the site tests, hp for TOWED. */
  readonly vehicle: VehicleState;
  /** The complaints meter, for SACKED (complaints.ts; phase 9 writes it). */
  readonly complaints: ShiftComplaints;
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
  /** endStates.towedScoreKeep in ppm (500,000): the share of the score TOWED keeps. */
  towedScoreKeepPpm: number;

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
  // What availableDumpSite reads (the same tests stepDump runs), read-only (SSP-070's dump prompt).
  readonly vehicle: Readonly<VehicleState>;
  readonly tank: { readonly vehicle: Readonly<VehicleState>; readonly tuning: WaterTuning };
  readonly dumpNeedsRelease: boolean;
  readonly depotHoldTicks: number;
  readonly depotMaxSpeedMps: number;
  readonly skipHoldTicks: number;
  readonly skipMaxSpeedMps: number;
  readonly skipReachM: number;
  readonly halfWidthM: number;
  readonly halfLengthM: number;
  readonly towedScoreKeepPpm: number;
  readonly rightX: number;
  readonly rightY: number;
  readonly forwardX: number;
  readonly forwardY: number;
  readonly siteMinX: ArrayLike<number>;
  readonly siteMinY: ArrayLike<number>;
  readonly siteMaxX: ArrayLike<number>;
  readonly siteMaxY: ArrayLike<number>;
};

/** Seconds × SIM_HZ as whole ticks (tuning.ts has already checked that they are whole). */
function ticksOf(seconds: number): number {
  return Math.round(seconds * SIM_HZ);
}

/**
 * A new shift on `level` for Bessie (`vehicle`, `hopper`, `tank`), watching `complaints` for SACKED, in Rollout
 * with the full timer. Dump sites are the level's site.depot_bay and site.skip entries, in level order. Setup
 * only: allocates.
 */
export function createShift(
  level: Level,
  vehicle: VehicleState,
  hopper: Hopper,
  tank: ShiftTank,
  complaints: ShiftComplaints,
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
    complaints,
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
    towedScoreKeepPpm: 0,
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
  shift.towedScoreKeepPpm = Math.round(tuning.endStates.towedScoreKeep * KEEP_PPM);
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

/** True once EV.ShiftEnd has fired: the World is frozen (world.ts stepWorld runs no phase). */
export function isShiftEnded(shift: ShiftView): boolean {
  return shift.phase === ShiftPhase.Ended;
}

/** True when the shift ended in a fail state, SACKED or TOWED (GDD §11.3): Try Again is the tally's focus. */
export function isShiftFailed(shift: ShiftView): boolean {
  return shift.endReason === ShiftEndReason.Sacked || shift.endReason === ShiftEndReason.Towed;
}

/**
 * The score the tally shows for a shift whose scoring.ts score is `score` (an integer): after TOWED,
 * floor(towedScoreKeep × score) (half, rounded down, in integer ppm; GDD §11.3); otherwise `score` itself, the
 * running score while the shift runs. Pure.
 */
export function finalShiftScore(shift: ShiftView, score: number): number {
  if (shift.endReason !== ShiftEndReason.Towed) return score;
  return Math.floor((score * shift.towedScoreKeepPpm) / KEEP_PPM);
}

/**
 * The stars the tally awards for a shift whose would-be stars (tidy.ts, from Tidy %) are `stars`: none after
 * SACKED or TOWED (GDD §11.3), `stars` otherwise. Pure.
 */
export function finalShiftStars(shift: ShiftView, stars: number): number {
  return isShiftFailed(shift) ? 0 : stars;
}

/** True while the timer counts down. */
export function isShiftTimerRunning(shift: ShiftView): boolean {
  return shift.phase === ShiftPhase.Running;
}

/**
 * The dump site a hold of INTERACT dumps at (an index into the shift's site arrays), or −1 (SSP-070: the HUD's
 * dump prompt and hold ring read it, never the sim). While Holding it is the held site; while Draining, or once
 * the timer has run out, −1 (no hold can start); otherwise the site an INTERACT press would start a hold at on
 * the next tick if nothing moved: the first site in level order where Bessie is stopped (speed below the site's
 * maxSpeedMps) with something to dump, by the very tests stepDump runs. It ignores whether INTERACT is held or
 * still needs releasing after a drain. Reads the axes stepDump wrote last tick (Bessie's heading has not changed
 * since: phase 10 runs last). Read-only and allocation-free.
 */
export function availableDumpSite(shift: ShiftView): number {
  if (shift.phase === ShiftPhase.KnockOff || shift.phase === ShiftPhase.Ended) return -1;
  if (shift.dumpState === DumpState.Draining) return -1;
  if (shift.dumpState === DumpState.Holding) return shift.dumpSite;
  return findDumpSite(shift);
}

/** Hold ticks a dump at site `s` needs (dumping.*.holdS × 60: 60 at both kinds). */
export function dumpHoldTicksAt(shift: ShiftView, s: number): number {
  return shift.siteKind[s] === DumpSite.Depot ? shift.depotHoldTicks : shift.skipHoldTicks;
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
 * Phase 10: SACKED, TOWED, the timer start, the dump FSM, the countdown and the knock-off, in that order (see
 * the header). Reads this tick's (gated) input, the complaints meter after phase 9 and Bessie after phases 2–9.
 * Allocation-free.
 */
export function stepShift(shift: Shift, input: Readonly<InputFrame>, events: EventQueue): void {
  const tick = shift.ticksRun;
  shift.ticksRun = tick + 1;
  if (shift.phase === ShiftPhase.Ended) return;

  if (shift.phase !== ShiftPhase.KnockOff) {
    // SACKED before TOWED on a tick that does both (the precedence rule, GDD §11.3).
    const failed =
      shift.complaints.count >= shift.complaints.max
        ? ShiftEndReason.Sacked
        : shift.vehicle.hp <= 0
          ? ShiftEndReason.Towed
          : 0;
    if (failed !== 0) {
      stopDump(shift, events);
      endShift(shift, failed, tick, events);
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

/** Cut a dump short (knock-off, SACKED, TOWED): a drain ends with DumpEnd (cut short), a hold just stops. */
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
function findDumpSite(shift: ShiftView): number {
  for (let s = 0; s < shift.siteCount; s += 1) {
    if (isStoppedAtSite(shift, s) && hasSomethingToDump(shift, s)) return s;
  }
  return -1;
}

/** LU in the hopper, or (at a depot bay) a tank below full. */
function hasSomethingToDump(shift: ShiftView, s: number): boolean {
  const v = shift.vehicle;
  if (v.hopperLU > 0) return true;
  return shift.siteKind[s] === DumpSite.Depot && v.water < shift.tank.tuning.tankUnits;
}

/** At site `s` with speed below its maxSpeedMps. */
function isStoppedAtSite(shift: ShiftView, s: number): boolean {
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
function isAtSite(shift: ShiftView, s: number): boolean {
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

// ---------------------------------------------------------------------------------------------------------
// Level events: the market and the market close (LEVEL_DESIGN §4.3, §4.5, §7.6; SSP-088)
// ---------------------------------------------------------------------------------------------------------
//
// The event runner of LEVEL_DESIGN §4.3 for the two Tuesday events, on the fixed tick in phase 10 right after
// stepShift (stepShiftEvents), keyed to elapsed timer seconds (shiftElapsedTicks: 0 through the rollout, then
// one more per timer tick), drawing on the `events` stream (world.eventsRng; LEVEL_DESIGN §9.1 rule 7). The other
// event types belong to their own issues (the dawn, tutorial beats and population waves of M3's level work; the
// rest are M6's).
//
// Pitches. A pitch is one `m` map tile, the prop.market_stall on it (its footprint, tuning.json propFootprints,
// is 2.0 × 1.5 m inside the 2 m tile), plus the tile in front for its trader (§7.6). "In front" is the side of
// the stall facing the most open floor: of the four neighbours, in the order south, north, east, west, the one
// with the most free tiles in a straight line out from the stall, counting up to PITCH_FRONT_LOOK_TILES (3, the
// §7.6 aisle; a free tile is on the map, not SOLID and holds no prop); the first wins a tie. The trader stands
// on that tile's centre, facing out along it, so a stall with its back to a wall or to another row faces its
// aisle. A stall with no free neighbour is an authoring error: createShiftEvents throws. The market's pitches
// are its `pitches` param (level.json: an array of [col, row] tiles, each an `m`), default every stall in
// level.props order; a market_close with no market event piles at every stall.
//
// market: the stalls open at its `at` (at shift start without one: the §4.5 "cont."), and the spawner
// (spawner.ts) then adds one npc.market_trader per pitch, origin Market, `group` = the pitch, whatever the view
// (the stalls opening, like a named NPC's arrival); ambient spawns keep room for the traders still to come.
// The §4.3 "litter and shopper bias around pitches": the litter bias is the level's litter hotspots
// (`near: "prop.market_stall"`, ×3, §9.1 rule 3), compiled with the map; no shopper bias is built (left to the
// High Street's authoring, SSP-105; owner to review). One market event per level.
//
// market_close: from each of its `at` (one or more elapsed seconds), a litter pile builds round every pitch:
// `itemsPerPitch` (default MARKET_CLOSE_DEFAULT_ITEMS) items per pitch over `buildS` (default
// MARKET_CLOSE_DEFAULT_BUILD_S) seconds, in rounds of one item per pitch (pitch order): round r of N lands on
// elapsed tick start + floor(r × buildS × 60 / N), so the first round on the close's own tick and the last
// before buildS is up (all at once for buildS 0). Each item takes five draws: its kind by weight over `table`
// (a level.json litter id → weight table; default the district's small-litter table, hazards.ts
// createSpillTable, as for the other dynamic drops), one of the pitch's pile tiles (nextInt), its x and y inside
// the tile (inset PILE_INSET_M from the edges), and its rotation. A pitch's pile tiles are the free tiles within
// PILE_REACH_TILES (Chebyshev) of its stall that are no pitch's trader tile, row-major (its trader's tile alone
// when there are none). Items go through litter.ts addLitterAt, so they count toward litter spawned (the Tidy %
// denominator and their frontage's zone) and respect the 2,000 cap (a full field takes nothing; the draws are
// made all the same). Closes run one at a time, in `at` order (level order on a tie): one due while another
// builds starts when that one ends. The traders stay at their pitches. Free Sweep, which skips one-off events
// (§4.3), does not exist yet.
//
// Hot path: stepShiftEvents allocates nothing and passes no doubles across calls (addLitterAt takes a scratch
// array). createShiftEvents is setup only.

/** A market close's default build time, seconds (LEVEL_DESIGN §4.5, Tuesday: about 40 items over 20 s). */
export const MARKET_CLOSE_DEFAULT_BUILD_S = 20;
/**
 * A market close's default items per pitch: 3, so the High Street's 12 pitches build 36, "about 40" (LEVEL_DESIGN
 * §4.5; chosen in SSP-088, TBD (M3 tuning), owner to review). A level sets itemsPerPitch itself.
 */
export const MARKET_CLOSE_DEFAULT_ITEMS = 3;
/** Pile tiles lie within this many tiles (Chebyshev) of their stall's tile. */
export const PILE_REACH_TILES = 2;
/** Pile items keep this far inside their tile's edges, metres. */
export const PILE_INSET_M = 0.25;
/** The open floor counted out from a stall when picking its front, tiles (LEVEL_DESIGN §7.6's 3-tile aisle). */
export const PITCH_FRONT_LOOK_TILES = 3;

/** The four sides of a stall, in the order tried: south, north, east, west (tile steps and the heading out). */
const SIDE_DX = [0, 0, 1, -1] as const;
const SIDE_DY = [1, -1, 0, 0] as const;
const SIDE_HEADING = [Math.PI, 0, Math.PI / 2, (3 * Math.PI) / 2] as const;

/** The level's market and market closes, compiled for the shift. Create with createShiftEvents. */
export type ShiftEvents = {
  /** False when the level has neither event: stepShiftEvents does nothing (and the replay hash skips it). */
  readonly active: boolean;
  /** True when the level has a `market` event. */
  readonly hasMarket: boolean;
  /** Elapsed ticks the market opens at (0: at shift start). */
  readonly marketOpenTicks: number;
  /** The stalls are open: the spawner mans the pitches. */
  marketOpen: boolean;
  /** Pitches, in market `pitches` order (default level.props order). */
  readonly pitchCount: number;
  /** The pitch's stall: its tile and centre, metres. */
  readonly pitchCol: Int32Array;
  readonly pitchRow: Int32Array;
  readonly pitchX: Float64Array;
  readonly pitchY: Float64Array;
  /** Where its trader stands (the front tile's centre, metres) and faces (radians, 0 = north, clockwise). */
  readonly traderX: Float64Array;
  readonly traderY: Float64Array;
  readonly traderHeading: Float64Array;
  /** 1 once the spawner has added the pitch's trader. */
  readonly pitchManned: Uint8Array;
  /** The market's pitches still without their trader (the spawner holds store room for them). */
  tradersPending: number;
  /** Each pitch's pile tiles (row · width + col): pileTile[pileStart[p] .. pileStart[p + 1]). */
  readonly pileStart: Int32Array;
  readonly pileTile: Int32Array;
  /** Map width in tiles. */
  readonly widthTiles: number;
  /** Market closes (one per `at` of every market_close), in start order. */
  readonly closeCount: number;
  readonly closeAtTicks: Int32Array;
  readonly closeBuildTicks: Int32Array;
  readonly closeItems: Int32Array;
  /** Each close's kind table, tableKind/tableWeight[tableStart[c] .. tableStart[c + 1]), weights summing to closeTotal[c]. */
  readonly tableStart: Int32Array;
  readonly tableKind: Uint8Array;
  readonly tableWeight: Float64Array;
  readonly closeTotal: Float64Array;
  /** The next close to start, the one building (−1 for none), its start (elapsed ticks) and its rounds done. */
  closeNext: number;
  closeActive: number;
  closeStartTick: number;
  closeRound: number;
  /** Close items placed and refused (the field was full) this shift. */
  itemsSpawned: number;
  itemsRefused: number;
  /** addLitterAt's position scratch. */
  readonly at: Float64Array;
};

/** The parts of the World stepShiftEvents works on (world.ts World satisfies it). */
export type ShiftEventsWorld = {
  readonly shiftEvents: ShiftEvents;
  readonly shift: ShiftView;
  readonly litter: LitterField;
  readonly eventsRng: Sfc32;
};

/** What render, audio and UI may see. */
export type ShiftEventsView = {
  readonly active: boolean;
  readonly hasMarket: boolean;
  readonly marketOpen: boolean;
  readonly pitchCount: number;
  readonly pitchX: ArrayLike<number>;
  readonly pitchY: ArrayLike<number>;
  readonly traderX: ArrayLike<number>;
  readonly traderY: ArrayLike<number>;
  readonly traderHeading: ArrayLike<number>;
  readonly closeCount: number;
  readonly closeActive: number;
  readonly itemsSpawned: number;
};

/** A non-negative number param, or `fallback` when absent. Throws otherwise. */
function eventNumber(value: JsonValue | undefined, fallback: number, where: string): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
    throw new Error(`${where} must be a non-negative number, got ${JSON.stringify(value)}`);
  return value;
}

/**
 * The market and market closes of `level` (see the section comment), with the close tables from `spill` (the
 * district's small-litter table, hazards.ts) unless a close names its own `table`. Throws on a malformed event
 * or a pitch with no stall or no free tile in front. Setup only.
 */
export function createShiftEvents(level: Level, spill: SpillTable): ShiftEvents {
  const where = `createShiftEvents(${level.id})`;
  const [w, h] = level.size;
  const markets = level.schedules.filter((e) => e.type === 'market');
  const closes = level.schedules.filter((e) => e.type === 'market_close');
  if (markets.length > 1)
    throw new Error(`${where}: a level has at most one market event, got ${markets.length}`);
  const market = markets[0];
  const propTile = new Uint8Array(w * h);
  const stalls: number[] = [];
  level.props.forEach((p, k) => {
    const c = Math.floor(p.x / TILE_M);
    const r = Math.floor(p.y / TILE_M);
    if (c < 0 || r < 0 || c >= w || r >= h) return;
    propTile[r * w + c] = 1;
    if (p.id === 'prop.market_stall') stalls.push(k);
  });
  const free = (c: number, r: number): boolean =>
    c >= 0 &&
    r >= 0 &&
    c < w &&
    r < h &&
    ((level.layers.collide[r * w + c] as number) & COLLIDE.SOLID) === 0 &&
    propTile[r * w + c] === 0;
  // The pitches: the market's `pitches` tiles, or every stall.
  let pitchProps = stalls;
  const pitchesParam = market?.params.pitches;
  if (pitchesParam !== undefined) {
    if (!Array.isArray(pitchesParam) || pitchesParam.length === 0)
      throw new Error(`${where}: market pitches must be a non-empty array of [col, row] stall tiles`);
    pitchProps = pitchesParam.map((t, k) => {
      const tile = Array.isArray(t) && t.length === 2 ? t : null;
      const prop =
        tile === null
          ? undefined
          : stalls.find((s) => {
              const p = level.props[s];
              return (
                p !== undefined &&
                Math.floor(p.x / TILE_M) === tile[0] &&
                Math.floor(p.y / TILE_M) === tile[1]
              );
            });
      if (prop === undefined)
        throw new Error(
          `${where}: market pitches[${k}] ${JSON.stringify(t)} is not the tile of a prop.market_stall`,
        );
      return prop;
    });
    if (new Set(pitchProps).size !== pitchProps.length)
      throw new Error(`${where}: market pitches repeat a stall`);
  }
  const n = market === undefined && closes.length === 0 ? 0 : pitchProps.length;
  const pitchCol = new Int32Array(n);
  const pitchRow = new Int32Array(n);
  const pitchX = new Float64Array(n);
  const pitchY = new Float64Array(n);
  const traderX = new Float64Array(n);
  const traderY = new Float64Array(n);
  const traderHeading = new Float64Array(n);
  const traderTile = new Set<number>();
  for (let p = 0; p < n; p += 1) {
    const prop = level.props[pitchProps[p] as number];
    if (prop === undefined) continue;
    const c = Math.floor(prop.x / TILE_M);
    const r = Math.floor(prop.y / TILE_M);
    pitchCol[p] = c;
    pitchRow[p] = r;
    pitchX[p] = prop.x;
    pitchY[p] = prop.y;
    let side = -1;
    let bestOpen = 0;
    for (let s = 0; s < 4; s += 1) {
      const sx = SIDE_DX[s] as number;
      const sy = SIDE_DY[s] as number;
      let open = 0;
      while (open < PITCH_FRONT_LOOK_TILES && free(c + sx * (open + 1), r + sy * (open + 1))) open += 1;
      if (open > bestOpen) {
        bestOpen = open;
        side = s;
      }
    }
    if (side < 0)
      throw new Error(`${where}: the market stall at tile (${c}, ${r}) has no free tile in front`);
    const fc = c + (SIDE_DX[side] as number);
    const fr = r + (SIDE_DY[side] as number);
    traderX[p] = (fc + 0.5) * TILE_M;
    traderY[p] = (fr + 0.5) * TILE_M;
    traderHeading[p] = SIDE_HEADING[side] as number;
    traderTile.add(fr * w + fc);
  }
  // Pile tiles.
  const pileStart = new Int32Array(n + 1);
  const piles: number[] = [];
  for (let p = 0; p < n; p += 1) {
    const c = pitchCol[p] as number;
    const r = pitchRow[p] as number;
    const before = piles.length;
    for (let rr = r - PILE_REACH_TILES; rr <= r + PILE_REACH_TILES; rr += 1) {
      for (let cc = c - PILE_REACH_TILES; cc <= c + PILE_REACH_TILES; cc += 1) {
        if (free(cc, rr) && !traderTile.has(rr * w + cc)) piles.push(rr * w + cc);
      }
    }
    if (piles.length === before) {
      piles.push(
        Math.floor((traderY[p] as number) / TILE_M) * w + Math.floor((traderX[p] as number) / TILE_M),
      );
    }
    pileStart[p + 1] = piles.length;
  }
  // The market's opening.
  const openAt = market?.atS[0];
  const openTicks = openAt === undefined ? 0 : Math.round(openAt * SIM_HZ);
  // The closes, one per `at`, in start order.
  type Close = {
    at: number;
    order: number;
    build: number;
    items: number;
    kinds: number[];
    weights: number[];
  };
  const list: Close[] = [];
  closes.forEach((e, k) => {
    const label = `${where}: market_close ${k}`;
    if (e.atS.length === 0) throw new Error(`${label} needs an at (elapsed seconds)`);
    const buildS = eventNumber(e.params.buildS, MARKET_CLOSE_DEFAULT_BUILD_S, `${label} buildS`);
    const items = eventNumber(e.params.itemsPerPitch, MARKET_CLOSE_DEFAULT_ITEMS, `${label} itemsPerPitch`);
    if (!Number.isInteger(items)) throw new Error(`${label} itemsPerPitch must be an integer, got ${items}`);
    const kinds: number[] = [];
    const weights: number[] = [];
    const table = e.params.table;
    if (table === undefined) {
      for (let t = 0; t < spill.count; t += 1) {
        kinds.push(spill.kind[t] as number);
        weights.push(spill.weight[t] as number);
      }
    } else {
      if (table === null || typeof table !== 'object' || Array.isArray(table))
        throw new Error(`${label} table must be an object of litter id → weight`);
      for (const id of Object.keys(table).sort()) {
        const kind = (LITTER_IDS as readonly string[]).indexOf(id);
        const weight = table[id];
        if (kind < 0) throw new Error(`${label} table: ${id} is not a litter id`);
        if (typeof weight !== 'number' || !(weight > 0))
          throw new Error(`${label} table: ${id} weight must be a positive number`);
        kinds.push(kind);
        weights.push(weight);
      }
      if (kinds.length === 0) throw new Error(`${label} table is empty`);
    }
    const build = Math.round(buildS * SIM_HZ);
    for (const at of e.atS)
      list.push({ at: Math.round(at * SIM_HZ), order: list.length, build, items, kinds, weights });
  });
  list.sort((a, b) => a.at - b.at || a.order - b.order);
  const tableStart = new Int32Array(list.length + 1);
  list.forEach((c, k) => {
    tableStart[k + 1] = (tableStart[k] as number) + c.kinds.length;
  });
  return {
    active: market !== undefined || list.length > 0,
    hasMarket: market !== undefined,
    marketOpenTicks: openTicks,
    marketOpen: market !== undefined && openTicks === 0,
    pitchCount: n,
    pitchCol,
    pitchRow,
    pitchX,
    pitchY,
    traderX,
    traderY,
    traderHeading,
    pitchManned: new Uint8Array(n),
    tradersPending: market !== undefined ? n : 0,
    pileStart,
    pileTile: Int32Array.from(piles),
    widthTiles: w,
    closeCount: list.length,
    closeAtTicks: Int32Array.from(list, (c) => c.at),
    closeBuildTicks: Int32Array.from(list, (c) => c.build),
    closeItems: Int32Array.from(list, (c) => c.items),
    tableStart,
    tableKind: Uint8Array.from(list.flatMap((c) => c.kinds)),
    tableWeight: Float64Array.from(list.flatMap((c) => c.weights)),
    closeTotal: Float64Array.from(list, (c) => c.weights.reduce((a, b) => a + b, 0)),
    closeNext: 0,
    closeActive: -1,
    closeStartTick: 0,
    closeRound: 0,
    itemsSpawned: 0,
    itemsRefused: 0,
    at: new Float64Array(2),
  };
}

/** The read-only view of `ev`. No copy: it is the same object. */
export function viewShiftEvents(ev: ShiftEvents): ShiftEventsView {
  return ev;
}

/**
 * Phase 10, after stepShift: open the market when its time comes, start the next market close when it is due,
 * and place the rounds of the building pile that are due (see the section comment). Nothing once the shift has
 * ended. Allocation-free.
 */
export function stepShiftEvents(w: ShiftEventsWorld): void {
  const ev = w.shiftEvents;
  if (!ev.active || w.shift.phase === ShiftPhase.Ended) return;
  const elapsed = shiftElapsedTicks(w.shift);
  if (ev.hasMarket && !ev.marketOpen && elapsed >= ev.marketOpenTicks) ev.marketOpen = true;
  if (
    ev.closeActive < 0 &&
    ev.closeNext < ev.closeCount &&
    elapsed >= (ev.closeAtTicks[ev.closeNext] as number)
  ) {
    ev.closeActive = ev.closeNext;
    ev.closeNext += 1;
    ev.closeStartTick = elapsed;
    ev.closeRound = 0;
  }
  const c = ev.closeActive;
  if (c < 0) return;
  const rounds = ev.closeItems[c] as number;
  const build = ev.closeBuildTicks[c] as number;
  while (
    ev.closeRound < rounds &&
    elapsed - ev.closeStartTick >= Math.floor((ev.closeRound * build) / rounds)
  ) {
    for (let p = 0; p < ev.pitchCount; p += 1) pileItem(w, c, p);
    ev.closeRound += 1;
  }
  if (ev.closeRound >= rounds) ev.closeActive = -1;
}

/** One item of close `c`'s pile at pitch `p`: kind, tile, x, y and rotation from the `events` stream. */
function pileItem(w: ShiftEventsWorld, c: number, p: number): void {
  const ev = w.shiftEvents;
  const rng = w.eventsRng;
  const t0 = ev.tableStart[c] as number;
  const t1 = ev.tableStart[c + 1] as number;
  let r = nextFloat(rng) * (ev.closeTotal[c] as number);
  let kind = ev.tableKind[t0] as number;
  for (let t = t0; t < t1; t += 1) {
    kind = ev.tableKind[t] as number;
    r -= ev.tableWeight[t] as number;
    if (r < 0) break;
  }
  const s0 = ev.pileStart[p] as number;
  const tile = ev.pileTile[s0 + nextInt(rng, (ev.pileStart[p + 1] as number) - s0)] as number;
  const col = tile % ev.widthTiles;
  const row = (tile - col) / ev.widthTiles;
  const span = TILE_M - 2 * PILE_INSET_M;
  ev.at[0] = col * TILE_M + PILE_INSET_M + nextFloat(rng) * span;
  ev.at[1] = row * TILE_M + PILE_INSET_M + nextFloat(rng) * span;
  const rot = nextInt(rng, LITTER_ROTATIONS);
  if (addLitterAt(w.litter, kind, ev.at, rot) < 0) ev.itemsRefused += 1;
  else ev.itemsSpawned += 1;
}
