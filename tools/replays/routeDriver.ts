// The closed-loop route driver shared by the scripted replay generators (TECHNICAL_DESIGN §18.3): the M1
// drive (tools/replays/record-m1-drive-puddle-lane.ts, SSP-049) and the M2 full-shift and dump-cycle replays
// (tests/replay/scripts/build-m2-replays.ts, SSP-072). An agent cannot play by hand, so a generator describes
// a route as a readable list of steps and this driver turns it into integer InputFrames, tick by tick.
//
// Each tick the driver reads the World's state (pose, speed, gear, this tick's events, whether the shift still
// takes input) and picks throttle, brake, steer and buttons: pure pursuit for steering, a braking-distance
// speed plan for throttle and brake. Only the inputs are recorded (attachInputLog), so the replay is exactly
// `f(seed, district, inputs)` like a recording from the dev panel; the driver itself never reaches the runner.
//
// Runs on plain Node 24 type stripping (no tsx): erasable syntax only, explicit `.ts` imports, Node built-ins
// and src/sim/** only. Deterministic: no wall clock, no Math.random; trig goes through src/sim/fmath.ts.
import { countEvents, EV, type EventQueue } from '../../src/sim/eventQueue.ts';
import { atan2, cos, hypot, sin, sqrt } from '../../src/sim/fmath.ts';
import {
  BRAKE_MAX,
  BUTTON,
  createInputFrame,
  type InputFrame,
  STEER_MAX,
  THROTTLE_MAX,
} from '../../src/sim/inputFrame.ts';
import type { Level } from '../../src/sim/map.ts';
import { attachInputLog, createInputLog, EVENT_NAMES, type InputLog } from '../../src/sim/replay.ts';
import { shiftIgnoresInput } from '../../src/sim/shift.ts';
import type { Tuning } from '../../src/sim/tuning.ts';
import { Gear } from '../../src/sim/vehicle.ts';
import { createWorld, type World } from '../../src/sim/world.ts';

// ---------------------------------------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------------------------------------

export type Point = readonly [xM: number, yM: number];

/**
 * One route step.
 * - drive: follow `path` (sim metres, from wherever Bessie is) at up to `speedMps`, arriving at its last point
 *   at `exitMps` or less, holding `buttons` (BUTTON bits, default none) throughout; done when Bessie reaches or
 *   passes the last point.
 * - press: put these PRESSED bits on the next tick's frame (merged into whatever the next step drives).
 * - stop: brake (no throttle, wheels straight) until Bessie stands still.
 * - reverse: hold the brake with `steer` (−127..127) until REV engages, keep reversing, and finish once an
 *   EV.Impact has been seen and Bessie has stopped against it, or after `maxTicks`.
 * - dump: hold INTERACT (wheels straight, braking down to 0.2 m/s and then rolling, so the brake held at a
 *   standstill never engages REV) until EV.DumpEnd fires, or after `maxTicks`. The shift's dump FSM does the
 *   rest: the hold starts once Bessie is stopped at a site (shift.ts).
 */
export type Step =
  | {
      readonly kind: 'drive';
      readonly label: string;
      readonly path: readonly Point[];
      readonly speedMps: number;
      readonly exitMps: number;
      readonly buttons?: number;
    }
  | { readonly kind: 'press'; readonly label: string; readonly pressed: number }
  | { readonly kind: 'stop'; readonly label: string }
  | { readonly kind: 'reverse'; readonly label: string; readonly steer: number; readonly maxTicks: number }
  | { readonly kind: 'dump'; readonly label: string; readonly maxTicks: number };

/** Tile centre in sim metres (2 m tiles). */
export function tile(col: number, row: number): Point {
  return [col * 2 + 1, row * 2 + 1];
}

// ---------------------------------------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------------------------------------

/** Planning deceleration for the speed plan (the brake gives 6.0 m/s²; keep a margin). */
const PLAN_DECEL_MPS2 = 3.5;
/** Done with a drive step within this distance of its last point (or once past it). */
const ARRIVE_M = 1.0;
/** The dump step brakes down to this speed and then lets drag finish the stop (below reverse.engageBelowMps). */
const DUMP_BRAKE_UNTIL_MPS = 0.2;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Throttle/brake for a target speed (forward). Integers in the InputFrame ranges. */
function speedControl(vMps: number, targetMps: number, frame: InputFrame): void {
  const err = targetMps - vMps;
  frame.throttle = err > 0 ? Math.round(clamp(err / 0.5, 0, 1) * THROTTLE_MAX) : 0;
  frame.brake = err < -0.3 ? Math.round(clamp((-err - 0.3) / 1.5, 0.15, 1) * BRAKE_MAX) : 0;
}

/** Pure-pursuit steer input toward (tx, ty) from the rear axle; integer −STEER_MAX..STEER_MAX. */
function pursuitSteer(world: World, tx: number, ty: number): number {
  const v = world.vehicle;
  const sweeper = world.tuning.vehicle.sweeper;
  const fx = sin(v.headingRad);
  const fy = -cos(v.headingRad);
  const rx = cos(v.headingRad);
  const ry = sin(v.headingRad);
  const ax = v.xM + fx * sweeper.body.rearAxleOffsetM;
  const ay = v.yM + fy * sweeper.body.rearAxleOffsetM;
  const dx = tx - ax;
  const dy = ty - ay;
  const ld = Math.max(hypot(dx, dy), 0.5);
  const alpha = atan2(dx * rx + dy * ry, dx * fx + dy * fy);
  const deltaRad = atan2(2 * sweeper.body.wheelbaseM * sin(alpha), ld);
  const lock = sweeper.steering.maxSteerRad / (1 + Math.abs(v.vLongMps) / sweeper.steering.steerFalloffMps);
  return Math.round(clamp(deltaRad / lock, -1, 1) * STEER_MAX);
}

type Segment = { ax: number; ay: number; bx: number; by: number; lenM: number };

/** The step's polyline as segments, starting from where Bessie is when the step begins. */
function segmentsFrom(x0: number, y0: number, path: readonly Point[]): Segment[] {
  const out: Segment[] = [];
  let ax = x0;
  let ay = y0;
  for (const [bx, by] of path) {
    out.push({ ax, ay, bx, by, lenM: hypot(bx - ax, by - ay) });
    ax = bx;
    ay = by;
  }
  return out;
}

/** Arc position (m from the polyline start) of the projection of (x, y), searching from segment `from`. */
function project(segs: readonly Segment[], from: number, x: number, y: number): { seg: number; sM: number } {
  let best = { seg: from, sM: 0, d2: Number.POSITIVE_INFINITY };
  let base = 0;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i] as Segment;
    if (i >= from) {
      const ux = (s.bx - s.ax) / Math.max(s.lenM, 1e-9);
      const uy = (s.by - s.ay) / Math.max(s.lenM, 1e-9);
      const t = clamp((x - s.ax) * ux + (y - s.ay) * uy, 0, s.lenM);
      const px = s.ax + ux * t;
      const py = s.ay + uy * t;
      const d2 = (x - px) * (x - px) + (y - py) * (y - py);
      if (d2 < best.d2) best = { seg: i, sM: base + t, d2 };
    }
    base += s.lenM;
  }
  return { seg: best.seg, sM: best.sM };
}

/** The point `sM` metres along the polyline (clamped to its ends). */
function pointAt(segs: readonly Segment[], sM: number): Point {
  let rest = sM;
  for (const s of segs) {
    if (rest <= s.lenM) {
      const t = s.lenM > 0 ? rest / s.lenM : 0;
      return [s.ax + (s.bx - s.ax) * t, s.ay + (s.by - s.ay) * t];
    }
    rest -= s.lenM;
  }
  const last = segs[segs.length - 1] as Segment;
  return [last.bx, last.by];
}

const EVENT_TYPE_COUNT = Math.max(...Object.values(EV)) + 1;

/** What happened during one step. */
export type StepReport = {
  label: string;
  startTick: number;
  endTick: number;
  /** Events seen during the step, indexed by EV id. */
  readonly events: number[];
  maxSpeedMps: number;
};

function newReport(label: string, tick: number): StepReport {
  return {
    label,
    startTick: tick,
    endTick: tick,
    events: new Array(EVENT_TYPE_COUNT).fill(0),
    maxSpeedMps: 0,
  };
}

function addEvents(report: StepReport, events: EventQueue): void {
  for (let i = 0; i < events.count; i++) {
    const type = events.type[i] as number;
    report.events[type] = (report.events[type] ?? 0) + 1;
  }
}

/** The step's events as "Name n" pairs, in EV order (empty when nothing happened). */
export function describeEvents(events: readonly number[], skip: readonly string[] = []): string {
  const parts: string[] = [];
  for (const name of EVENT_NAMES) {
    if (skip.includes(name)) continue;
    const n = events[EV[name]] ?? 0;
    if (n > 0) parts.push(`${name} ${n}`);
  }
  return parts.join(', ');
}

export type DriveResult = {
  log: InputLog;
  reports: StepReport[];
  /** The World after the last tick (for the generator's summary; the replay runner builds its own). */
  world: World;
  /** Top forward speed seen with the brush down and with it up. */
  maxBrushDownMps: number;
  maxBrushUpMps: number;
};

/**
 * Drive `route` for `ticks` ticks on a fresh World(level, seed, tuning) and return the recorded log plus a
 * per-step report. Once the shift stops taking input (the knock-off, shift.ts) the driver sends neutral frames
 * and the rest of the route is reported as not reached; if the route runs out first, Bessie coasts to a stop.
 */
export function driveRoute(
  level: Level,
  tuning: Tuning,
  seed: number,
  route: readonly Step[],
  ticks: number,
): DriveResult {
  const world = createWorld(level, seed, tuning);
  const log = createInputLog(ticks);
  attachInputLog(world, log);
  const frame = createInputFrame();
  const reports: StepReport[] = [];
  let maxBrushDownMps = 0;
  let maxBrushUpMps = 0;
  let pendingPressed = 0;

  let stepIndex = 0;
  let segs: Segment[] | null = null;
  let segFrom = 0;
  let impactSeen = false;
  let report: StepReport | null = null;

  const finishStep = (): void => {
    if (report !== null) {
      report.endTick = world.tick;
      reports.push(report);
    }
    report = null;
    segs = null;
    segFrom = 0;
    impactSeen = false;
    stepIndex += 1;
  };

  while (world.tick < ticks) {
    const v = world.vehicle;
    const knockedOff = shiftIgnoresInput(world.shift);
    // Resolve instant steps (press) and completed steps before choosing this tick's frame.
    let step = knockedOff ? undefined : route[stepIndex];
    while (step !== undefined && step.kind === 'press') {
      pendingPressed |= step.pressed;
      reports.push(newReport(step.label, world.tick));
      stepIndex += 1;
      step = route[stepIndex];
    }
    if (report === null && step !== undefined) {
      report = newReport(step.label, world.tick);
    }

    frame.throttle = 0;
    frame.brake = 0;
    frame.steer = 0;
    frame.buttons = 0;
    frame.pressed = knockedOff ? 0 : pendingPressed;
    if (!knockedOff) pendingPressed = 0;

    let done = false;
    if (knockedOff) {
      // The shift ignores input now (gateShiftInput brakes Bessie to rest): record neutral frames.
    } else if (step === undefined) {
      // Route finished early: coast to a stop and hold still (brake would engage REV, so just roll).
      frame.brake = v.vLongMps > 0.3 ? 80 : 0;
    } else if (step.kind === 'drive') {
      if (segs === null) segs = segmentsFrom(v.xM, v.yM, step.path);
      const sweeper = world.tuning.vehicle.sweeper;
      const ax = v.xM + sin(v.headingRad) * sweeper.body.rearAxleOffsetM;
      const ay = v.yM - cos(v.headingRad) * sweeper.body.rearAxleOffsetM;
      const p = project(segs, segFrom, ax, ay);
      segFrom = p.seg;
      let total = 0;
      for (const s of segs) total += s.lenM;
      const remainingM = total - p.sM;
      const end = step.path[step.path.length - 1] as Point;
      // Done once the rear axle's projection or the body centre is within ARRIVE_M of the end.
      if (remainingM < ARRIVE_M || hypot(end[0] - v.xM, end[1] - v.yM) < ARRIVE_M) {
        done = true;
      }
      const lookM = 2.5 + 0.5 * Math.abs(v.vLongMps);
      const [tx, ty] = pointAt(segs, p.sM + lookM);
      // Past the end of the polyline, keep aiming straight on along its last segment.
      const last = segs[segs.length - 1] as Segment;
      const over = p.sM + lookM - total;
      const ux = (last.bx - last.ax) / Math.max(last.lenM, 1e-9);
      const uy = (last.by - last.ay) / Math.max(last.lenM, 1e-9);
      const aimX = over > 0 ? tx + ux * over : tx;
      const aimY = over > 0 ? ty + uy * over : ty;
      frame.steer = pursuitSteer(world, aimX, aimY);
      frame.buttons = step.buttons ?? 0;
      const target = Math.min(
        step.speedMps,
        sqrt(step.exitMps * step.exitMps + 2 * PLAN_DECEL_MPS2 * Math.max(remainingM, 0)),
      );
      if (v.gear === Gear.Rev) {
        // Throttle at a standstill returns to FWD; while still rolling back, throttle brakes.
        frame.throttle = THROTTLE_MAX;
      } else {
        speedControl(v.vLongMps, target, frame);
      }
    } else if (step.kind === 'stop') {
      frame.brake = BRAKE_MAX;
      if (Math.abs(v.vLongMps) < 0.05) done = true;
    } else if (step.kind === 'reverse') {
      frame.steer = v.gear === Gear.Rev ? step.steer : 0;
      frame.brake = BRAKE_MAX;
      if (report !== null && world.tick - report.startTick >= step.maxTicks) done = true;
    } else if (step.kind === 'dump') {
      frame.buttons = BUTTON.INTERACT;
      frame.brake = Math.abs(v.vLongMps) > DUMP_BRAKE_UNTIL_MPS ? BRAKE_MAX : 0;
      if (report !== null && world.tick - report.startTick >= step.maxTicks) done = true;
    }

    world.step(frame);

    const impacts = countEvents(world.events, EV.Impact);
    if (report !== null) {
      const r: StepReport = report;
      addEvents(r, world.events);
      r.maxSpeedMps = Math.max(r.maxSpeedMps, Math.abs(world.vehicle.vLongMps));
    }
    if (impacts > 0) impactSeen = true;
    if (step !== undefined && step.kind === 'reverse' && impactSeen) done = true;
    if (step !== undefined && step.kind === 'dump' && countEvents(world.events, EV.DumpEnd) > 0) done = true;
    if (world.vehicle.brushDown) maxBrushDownMps = Math.max(maxBrushDownMps, world.vehicle.vLongMps);
    else maxBrushUpMps = Math.max(maxBrushUpMps, world.vehicle.vLongMps);
    if (done) finishStep();
  }
  if (report !== null) {
    (report as StepReport).endTick = world.tick;
    reports.push(report);
  }
  for (let i = stepIndex + 1; i < route.length; i++) {
    const s = route[i] as Step;
    reports.push(newReport(`${s.label} (not reached)`, ticks));
  }
  return { log, reports, world, maxBrushDownMps, maxBrushUpMps };
}

/** One line per step: tick range, label, top speed and the events seen (minus `skipEvents`). */
export function formatReports(reports: readonly StepReport[], skipEvents: readonly string[] = []): string {
  let out = '';
  for (const r of reports) {
    const events = describeEvents(r.events, skipEvents);
    out +=
      `${String(r.startTick).padStart(5)}–${String(r.endTick).padEnd(5)} ${r.label}` +
      `${r.maxSpeedMps > 0 ? ` (max ${r.maxSpeedMps.toFixed(2)} m/s)` : ''}${events ? ` [${events}]` : ''}\n`;
  }
  return out;
}
