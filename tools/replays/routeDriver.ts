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
import { Ground, type Level } from '../../src/sim/map.ts';
import {
  appendInput,
  attachInputLog,
  createInputLog,
  EVENT_NAMES,
  type InputLog,
} from '../../src/sim/replay.ts';
import { isShiftEnded, shiftIgnoresInput } from '../../src/sim/shift.ts';
import type { Tuning } from '../../src/sim/tuning.ts';
import { Gear } from '../../src/sim/vehicle.ts';
import { Blocker, VEHICLE_FLAG, VEHICLE_PLAN_EDGES } from '../../src/sim/vehicleStore.ts';
import { createWorld, type World } from '../../src/sim/world.ts';

// ---------------------------------------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------------------------------------

export type Point = readonly [xM: number, yM: number];

/**
 * One route step.
 * - drive: follow `path` (sim metres, from wherever Bessie is) at up to `speedMps`, arriving at its last point
 *   at `exitMps` or less, holding `buttons` (BUTTON bits, default none) throughout; done when Bessie reaches or
 *   passes the last point. `predictWindow` is for DriveOptions.yieldToStreet.
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
      /**
       * DriveOptions.yieldToStreet: the stretch of `path`, from point index [0] to point index [1], where
       * Bessie keeps to a lane of her own and may stop to wait for a vehicle about to cross her path ahead (a
       * kerb lane before a turn). Before it and once her front is past its end she is committed (turning,
       * crossing, or moving out to the centre line) and only stops for what is in her way now. Without it she
       * may wait anywhere.
       */
      readonly predictWindow?: readonly [from: number, to: number];
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
  /** Ticks the driver gave way to street life (DriveOptions.yieldToStreet). */
  yieldTicks: number;
};

function newReport(label: string, tick: number): StepReport {
  return {
    label,
    startTick: tick,
    endTick: tick,
    events: new Array(EVENT_TYPE_COUNT).fill(0),
    maxSpeedMps: 0,
    yieldTicks: 0,
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

/**
 * Driver options. `yieldToStreet` (SSP-104, for routes on a populated level): on a drive step Bessie gives way
 * like a careful player (streetBlocked). Off by default, so a route planned for an empty street drives exactly as
 * before.
 */
export type DriveOptions = { readonly yieldToStreet?: boolean };

/** How far along the route past the end of this drive step (the drive steps after it) the street-life checks look, metres. */
const LOOK_ROUTE_M = 60;
/** Street-life look-ahead beyond the braking distance, metres. */
const YIELD_MARGIN_M = 1.5;
/** Clearance kept round Bessie's half width along the look-ahead, metres. */
const YIELD_CLEARANCE_M = 0.1;
/** The clearance she keeps from a vehicle that is waiting for her, metres (she squeezes past it). */
const SQUEEZE_CLEARANCE_M = 0.02;
/** Look-ahead sample spacing along the path, metres. */
/** Her own front is checked this far beyond her stopping distance, in steps of BODY_SAMPLE_M, metres. */
const BODY_MARGIN_M = 0.3;
const BODY_SAMPLE_M = 0.1;
const YIELD_SAMPLE_M = 0.5;
/** How far ahead of her front she looks for a vehicle that will cross her path, metres. */
const CONFLICT_AHEAD_M = 20;
/**
 * How far ahead along its plan a vehicle is followed: this many seconds at the speed limit of the edge it is on
 * (or its speed, if faster). About the time she takes from a kerb lane through a turn (20 m at 2.2–3.8 m/s).
 */
const CONFLICT_HORIZON_S = 8;
/** Only a vehicle at least this fast can drive into her path unannounced, m/s. */
const CONFLICT_MOVING_MPS = 0.5;
/** Two centre lines closer than this mean two bodies that would touch (her 0.875 m + a car's 0.9 m + 0.125 m). */
const CONFLICT_GAP_M = 1.9;
/** Sample spacing along a vehicle's plan, metres. */
const CONFLICT_SAMPLE_M = 1;

/** Squared distance from (px, py) to vehicle `i`'s OBB; 0 inside. */
function vehicleDist2(world: World, i: number, px: number, py: number): number {
  const vs = world.vehicles;
  const h = vs.heading[i] as number;
  const fx = sin(h);
  const fy = -cos(h);
  const dx = px - (vs.x[i] as number);
  const dy = py - (vs.y[i] as number);
  let along = dx * fx + dy * fy;
  let across = dx * -fy + dy * fx;
  const hl = vs.halfLength[i] as number;
  const hw = vs.halfWidth[i] as number;
  along = Math.abs(along) > hl ? Math.abs(along) - hl : 0;
  across = Math.abs(across) > hw ? Math.abs(across) - hw : 0;
  return along * along + across * across;
}

/**
 * The point `atM` along `segs`, carried straight on past its end, moved `biasM` to the left of the path (right
 * when negative; the driver's sideways squeeze past a vehicle that waits for her).
 */
function pathPoint(segs: readonly Segment[], totalM: number, atM: number, biasM = 0): Point {
  let [px, py] = pointAt(segs, atM);
  const last = segs[segs.length - 1] as Segment;
  if (atM > totalM) {
    const k = (atM - totalM) / Math.max(last.lenM, 1e-9);
    px += (last.bx - last.ax) * k;
    py += (last.by - last.ay) * k;
  }
  if (biasM === 0) return [px, py];
  // The segment under atM gives the path's direction there.
  let seg = last;
  let rest = atM;
  for (const sg of segs) {
    if (rest <= sg.lenM) {
      seg = sg;
      break;
    }
    rest -= sg.lenM;
  }
  const ux = (seg.bx - seg.ax) / Math.max(seg.lenM, 1e-9);
  const uy = (seg.by - seg.ay) / Math.max(seg.lenM, 1e-9);
  // Left of the travel direction (screen axes, y down): (uy, −ux).
  return [px + uy * biasM, py - ux * biasM];
}

/** True when vehicle `i` drives roughly Bessie's way (it follows her, or she follows it: not a crossing path). */
function sameWay(world: World, i: number): boolean {
  const d = (world.vehicles.heading[i] as number) - world.vehicle.headingRad;
  return cos(d) > 0.5;
}

/**
 * True when Bessie's body lies across a lane of other traffic (a lane node within a car's reach of it whose lane
 * runs another way than she does): the start of a turn or a crossing, where she must not stop to wait for a car
 * that is about to come through, because it would stop for her.
 */
function acrossOtherLane(world: World): boolean {
  const v = world.vehicle;
  const lanes = world.level.lanes;
  const fx = sin(v.headingRad);
  const fy = -cos(v.headingRad);
  const half = world.tuning.vehicle.sweeper.body.lengthM / 2;
  const reach = CONFLICT_GAP_M - 0.2;
  for (let n = 0; n < lanes.nodeCount; n++) {
    const nx = lanes.nodeX[n] as number;
    const ny = lanes.nodeY[n] as number;
    const dx = nx - v.xM;
    const dy = ny - v.yM;
    let along = dx * fx + dy * fy;
    along = Math.abs(along) > half ? Math.abs(along) - half : 0;
    const across = dx * -fy + dy * fx;
    if (along * along + across * across > reach * reach) continue;
    for (let e = lanes.outStart[n] as number; e < (lanes.outStart[n + 1] as number); e++) {
      const to = lanes.edgeTo[e] as number;
      const ex = (lanes.nodeX[to] as number) - nx;
      const ey = (lanes.nodeY[to] as number) - ny;
      const len = Math.hypot(ex, ey);
      if (len > 1e-6 && (ex * fx + ey * fy) / len < 0.5) return true;
    }
  }
  return false;
}

/**
 * True when a moving vehicle that does not drive her way will, within CONFLICT_HORIZON_S along its lane plan,
 * pass within CONFLICT_GAP_M of her path in the next CONFLICT_AHEAD_M: a car about to come through the junction
 * she is heading for, or the oncoming lane she must cross to turn right. She waits for it where she is.
 */
function conflictAhead(world: World, segs: readonly Segment[], totalM: number, frontAtM: number): boolean {
  const vs = world.vehicles;
  const lanes = world.level.lanes;
  const mine: Point[] = [];
  for (
    let d = frontAtM - world.tuning.vehicle.sweeper.body.lengthM;
    d <= frontAtM + CONFLICT_AHEAD_M;
    d += 1
  ) {
    mine.push(pathPoint(segs, totalM, d));
  }
  const near = (x: number, y: number): boolean => {
    for (const [px, py] of mine) {
      if ((px - x) * (px - x) + (py - y) * (py - y) < CONFLICT_GAP_M * CONFLICT_GAP_M) return true;
    }
    return false;
  };
  for (let i = 0; i < vs.count; i++) {
    if (((vs.flags[i] as number) & VEHICLE_FLAG.PARKED) !== 0 || sameWay(world, i)) continue;
    // A standing vehicle waits for something (her, a junction, a zebra): when it moves off it brakes for her like
    // for anyone in its way, so only one under way can drive into her path. (The immediate check still keeps her
    // off a standing one.)
    if ((vs.speed[i] as number) < CONFLICT_MOVING_MPS) continue;
    const n = vs.planLen[i] as number;
    if (n === 0) continue;
    const limit = lanes.edgeSpeedMps[vs.plan[i * VEHICLE_PLAN_EDGES] as number] as number;
    let budget = Math.max(vs.speed[i] as number, limit) * CONFLICT_HORIZON_S;
    if (near(vs.x[i] as number, vs.y[i] as number)) return true;
    let skip = Math.max(vs.along[i] as number, 0);
    for (let k = 0; k < n && budget > 0; k++) {
      const e = vs.plan[i * VEHICLE_PLAN_EDGES + k] as number;
      const a = lanes.edgeFrom[e] as number;
      const b = lanes.edgeTo[e] as number;
      const ax = lanes.nodeX[a] as number;
      const ay = lanes.nodeY[a] as number;
      const ex = (lanes.nodeX[b] as number) - ax;
      const ey = (lanes.nodeY[b] as number) - ay;
      const len = Math.hypot(ex, ey);
      for (let t = skip; t <= len && budget > 0; t += CONFLICT_SAMPLE_M) {
        if (near(ax + (ex * t) / len, ay + (ey * t) / len)) return true;
        budget -= CONFLICT_SAMPLE_M;
      }
      skip = 0;
    }
  }
  return false;
}

/**
 * streetBlocked's answers: the way is clear; something is in her way now; a vehicle is about to cross it; a
 * standing vehicle that waits for her (Blocker.Bessie) is in her way, on her left (WAITING_LEFT) or right.
 */
const CLEAR = 0;
const BLOCKED_NOW = 1;
const BLOCKED_AHEAD = 2;
const WAITING_LEFT = 3;
const WAITING_RIGHT = 4;
/**
 * The sideways squeeze: when a vehicle that waits for her is in her way (it stands in her path because she
 * stands in its path, so neither can go), she moves her path up to SQUEEZE_MAX_M away from it, SQUEEZE_STEP_M a
 * tick, and creeps past at SQUEEZE_MPS once that path is clear; back on her own path once it is clear too.
 */
const SQUEEZE_MAX_M = 1.2;
const SQUEEZE_STEP_M = 0.02;
const SQUEEZE_RETURN_M = 0.01;
const SQUEEZE_MPS = 1.0;

/** WAITING_RIGHT or WAITING_LEFT: which side of Bessie vehicle `i` stands (her right is (cos h, sin h)). */
function waitingSide(world: World, i: number): number {
  const v = world.vehicle;
  const vs = world.vehicles;
  const side =
    ((vs.x[i] as number) - v.xM) * cos(v.headingRad) + ((vs.y[i] as number) - v.yM) * sin(v.headingRad);
  return side > 0 ? WAITING_RIGHT : WAITING_LEFT;
}

/**
 * Whether Bessie should give way now on the drive step along `segs` (rear axle at arc position `sM`):
 *   - a moving vehicle, a person or animal on the road, or an occupied zebra in her way within her braking
 *     distance plus YIELD_MARGIN_M (parked cars are not: a route steers round their bays; nor people on the
 *     pavement);
 *   - while she is still in a lane of her own (acrossOtherLane false), a vehicle about to cross her path ahead
 *     (conflictAhead), so she never starts a turn or a crossing into the path of a car that would then stop for
 *     her and leave the two of them waiting for each other;
 *   - a vehicle stopped because she holds it up is giving way to her: she goes first, squeezing past with
 *     SQUEEZE_CLEARANCE_M, or the two of them would wait for each other.
 * `predict` false leaves out conflictAhead; `biasM` moves the path sideways (pathPoint). Returns CLEAR,
 * BLOCKED_NOW, BLOCKED_AHEAD, WAITING_LEFT or WAITING_RIGHT.
 */
function streetBlocked(
  world: World,
  segs: readonly Segment[],
  sM: number,
  predict: boolean,
  biasM: number,
): number {
  const v = world.vehicle;
  const body = world.tuning.vehicle.sweeper.body;
  const frontM = body.lengthM / 2 - body.rearAxleOffsetM;
  const speed = Math.max(v.vLongMps, 0);
  const reachM = (speed * speed) / (2 * PLAN_DECEL_MPS2) + YIELD_MARGIN_M;
  const r = body.widthM / 2 + YIELD_CLEARANCE_M;
  const r0 = body.widthM / 2 + SQUEEZE_CLEARANCE_M;
  const level = world.level;
  const w = level.size[0];
  const h = level.size[1];
  const zebras = world.zebras;
  const vs = world.vehicles;
  let total = 0;
  for (const s of segs) total += s.lenM;
  const across = acrossOtherLane(world);
  // Her body as it is, not as the path says it should be (she lags the path coming out of a swing or a turn):
  // her front corners and the middle of her front, carried a stopping distance along her heading.
  const fx = sin(v.headingRad);
  const fy = -cos(v.headingRad);
  const rx = cos(v.headingRad);
  const ry = sin(v.headingRad);
  const half = body.widthM / 2;
  const bodyReachM = (speed * speed) / (2 * PLAN_DECEL_MPS2) + BODY_MARGIN_M;
  for (let d = 0; d <= bodyReachM; d += BODY_SAMPLE_M) {
    for (let c = -1; c <= 1; c++) {
      const px = v.xM + fx * (body.lengthM / 2 + d) + rx * half * c;
      const py = v.yM + fy * (body.lengthM / 2 + d) + ry * half * c;
      for (let i = 0; i < vs.count; i++) {
        const parked = ((vs.flags[i] as number) & VEHICLE_FLAG.PARKED) !== 0;
        const waiting = !parked && vs.blocker[i] === Blocker.Bessie && (vs.speed[i] as number) < 0.1;
        const k = waiting || parked ? SQUEEZE_CLEARANCE_M : YIELD_CLEARANCE_M;
        if (vehicleDist2(world, i, px, py) > k * k) continue;
        if (!waiting) return BLOCKED_NOW;
        return waitingSide(world, i);
      }
    }
  }
  for (let d = frontM; d <= frontM + reachM; d += YIELD_SAMPLE_M) {
    const [px, py] = pathPoint(segs, total, sM + d, biasM);
    for (let i = 0; i < vs.count; i++) {
      // A parked car is off her path (a route steers round the bays), but not off a squeezed one.
      const parked = ((vs.flags[i] as number) & VEHICLE_FLAG.PARKED) !== 0;
      if (parked && biasM === 0) continue;
      // A vehicle stopped because she holds it up is giving way to her: she squeezes past it if her body
      // clears it at all, or the two would wait for each other.
      const waiting = !parked && vs.blocker[i] === Blocker.Bessie && (vs.speed[i] as number) < 0.1;
      const rv = waiting || parked ? r0 : r;
      if (vehicleDist2(world, i, px, py) > rv * rv) continue;
      if (!waiting) return BLOCKED_NOW;
      return waitingSide(world, i);
    }
    for (let i = 0; i < world.npc.count; i++) {
      const nx = world.npc.x[i] as number;
      const ny = world.npc.y[i] as number;
      const tx = Math.floor(nx / 2);
      const ty = Math.floor(ny / 2);
      if (tx < 0 || ty < 0 || tx >= w || ty >= h) continue;
      const g = level.layers.ground[ty * w + tx] as number;
      if (g < Ground.Road || g > Ground.RoadOneWayS) continue;
      const rr = r + (world.npc.radius[i] as number);
      if ((nx - px) * (nx - px) + (ny - py) * (ny - py) <= rr * rr) return BLOCKED_NOW;
    }
    for (let z = 0; z < zebras.count; z++) {
      if ((zebras.occupancy[z] as number) === 0 || (zebras.bessieOn[z] as number) !== 0) continue;
      const cx = clamp(px, zebras.minX[z] as number, zebras.maxX[z] as number);
      const cy = clamp(py, zebras.minY[z] as number, zebras.maxY[z] as number);
      if ((cx - px) * (cx - px) + (cy - py) * (cy - py) <= r * r) return BLOCKED_NOW;
    }
  }
  return predict && !across && conflictAhead(world, segs, total, sM + frontM) ? BLOCKED_AHEAD : CLEAR;
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
  options: DriveOptions = {},
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
  // yieldToStreet: how far her path is squeezed sideways (SQUEEZE_MAX_M), and the drive step's predictWindow as
  // arc positions along its segments.
  let squeezeM = 0;
  let aheadSegs: Segment[] = [];
  let predictFromM = Number.NEGATIVE_INFINITY;
  let predictToM = Number.POSITIVE_INFINITY;

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

  // Counted by step() calls, not world.tick: once the shift has ended the World is frozen and its tick stops.
  for (let t = 0; t < ticks; t += 1) {
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
      if (segs === null) {
        segs = segmentsFrom(v.xM, v.yM, step.path);
        // yieldToStreet looks along the route beyond this step: the paths of the drive steps that follow it.
        aheadSegs = segs.slice();
        let aheadM = 0;
        for (let k = stepIndex + 1; k < route.length && aheadM < LOOK_ROUTE_M; k++) {
          const next = route[k] as Step;
          if (next.kind === 'press') continue;
          if (next.kind !== 'drive') break;
          const tail = aheadSegs[aheadSegs.length - 1] as Segment;
          for (const sg of segmentsFrom(tail.bx, tail.by, next.path)) {
            aheadSegs.push(sg);
            aheadM += sg.lenM;
          }
        }
        predictFromM = Number.NEGATIVE_INFINITY;
        predictToM = Number.POSITIVE_INFINITY;
        if (step.predictWindow !== undefined) {
          // Arc position of path point k: segment 0 runs from Bessie to path[0]. A window naming no point of
          // the path (a committed step, [-1, -1]) is empty.
          predictFromM = Number.POSITIVE_INFINITY;
          predictToM = Number.NEGATIVE_INFINITY;
          let arc = 0;
          for (let k = 0; k < segs.length; k++) {
            arc += (segs[k] as Segment).lenM;
            if (k === step.predictWindow[0]) predictFromM = arc;
            if (k === step.predictWindow[1]) predictToM = arc;
          }
        }
      }
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
      // Past the end of the polyline, keep aiming straight on along its last segment (and squeezed sideways
      // while she edges past a vehicle that waits for her).
      const [aimX, aimY] = pathPoint(segs, total, p.sM + lookM, squeezeM);
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
        const sweeper = world.tuning.vehicle.sweeper;
        const frontAtM = p.sM + sweeper.body.lengthM / 2 - sweeper.body.rearAxleOffsetM;
        const predict = p.sM >= predictFromM && frontAtM <= predictToM;
        let blocked =
          options.yieldToStreet === true ? streetBlocked(world, aheadSegs, p.sM, predict, squeezeM) : CLEAR;
        if (blocked === WAITING_LEFT || blocked === WAITING_RIGHT) {
          // Squeeze away from it (to the right of a vehicle on her left), then try that path this tick.
          const away = blocked === WAITING_RIGHT ? SQUEEZE_STEP_M : -SQUEEZE_STEP_M;
          squeezeM = clamp(squeezeM + away, -SQUEEZE_MAX_M, SQUEEZE_MAX_M);
          blocked = streetBlocked(world, aheadSegs, p.sM, predict, squeezeM);
          if (blocked === WAITING_LEFT || blocked === WAITING_RIGHT) blocked = BLOCKED_NOW;
        } else if (blocked === CLEAR && squeezeM !== 0) {
          // Back towards her own path once that is clear too.
          const back =
            squeezeM > 0
              ? Math.max(squeezeM - SQUEEZE_RETURN_M, 0)
              : Math.min(squeezeM + SQUEEZE_RETURN_M, 0);
          if (streetBlocked(world, aheadSegs, p.sM, predict, back) === CLEAR) squeezeM = back;
        }
        if (blocked !== CLEAR) {
          // Give way: brake towards a stop (speedControl brakes only above 0.3 m/s, so a standstill never
          // holds the brake long enough to engage REV) and wait until the way ahead is clear.
          speedControl(v.vLongMps, 0, frame);
          if (report !== null) report.yieldTicks += 1;
        } else {
          speedControl(v.vLongMps, squeezeM !== 0 ? Math.min(target, SQUEEZE_MPS) : target, frame);
        }
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

    // A frozen World runs no phase 1, so its recorder logs nothing: log the (neutral) frame here, so the log
    // still holds one frame per tick of the replay.
    if (isShiftEnded(world.shift)) appendInput(log, log.length, frame);
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
      `${r.maxSpeedMps > 0 ? ` (max ${r.maxSpeedMps.toFixed(2)} m/s)` : ''}` +
      `${r.yieldTicks > 0 ? ` gave way ${r.yieldTicks} ticks` : ''}${events ? ` [${events}]` : ''}\n`;
  }
  return out;
}
