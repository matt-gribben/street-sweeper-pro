// Scripted input generator for the M1 replay tests/replay/replays/m1_drive_puddle_lane.json (SSP-049,
// TECHNICAL_DESIGN §18.3). It drives Bessie round Puddle Lane with a small closed-loop route driver and records
// what it pressed, tick by tick, as the replay's input log; recordReplay then runs that log headlessly and
// stamps the checkpoint hashes.
//
// The route (ROUTE below) is a readable list of steps: drive a polyline at a speed, press a button, stop,
// reverse until Bessie touches something. Each tick the driver reads the World's state (pose and speed only)
// and picks integer throttle, brake and steer values: pure pursuit for steering, a braking-distance speed
// plan for throttle and brake. Only the inputs are recorded, so the replay is exactly `f(seed, district,
// inputs)` like a recording from the dev panel; the driver itself never reaches the runner.
//
// Because the driver is closed-loop, a deliberate sim change can make this script produce different inputs.
// That is fine: the committed replay file is the truth, and `npm run test:replay -- --update` re-records its
// hashes for the committed inputs (ROADMAP §5.3). Re-run this script only to change the route, or when a sim
// change stops the committed inputs from meeting the replay's invariants; say which in the commit.
//
// Run: node tools/replays/record-m1-drive-puddle-lane.ts [--check]
//   (no flag)  write the replay file and print the route summary (steps, tick ranges, events, speeds)
//   --check    regenerate in memory and exit 1 if the committed file differs (inputs, hashes or invariants)
// Exit status: 0 ok, 1 check failed, 2 usage. The invariants are checked by `npm run test:replay`.
//
// Runs on plain Node 24 type stripping (no tsx): erasable syntax only, explicit `.ts` imports, Node built-ins
// and src/sim/** only. Deterministic: no wall clock, no Math.random; maths goes through src/sim/fmath.ts.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { countEvents, EV } from '../../src/sim/eventQueue.ts';
import { atan2, cos, hypot, sin, sqrt } from '../../src/sim/fmath.ts';
import {
  BRAKE_MAX,
  createInputFrame,
  type InputFrame,
  PRESSED,
  STEER_MAX,
  THROTTLE_MAX,
} from '../../src/sim/inputFrame.ts';
import { decodeLevel } from '../../src/sim/map.ts';
import {
  attachInputLog,
  createInputLog,
  type InputLog,
  REPLAY_TICKS,
  type ReplayInvariants,
  recordReplay,
  serialiseReplay,
} from '../../src/sim/replay.ts';
import { DEFAULT_TUNING } from '../../src/sim/tuning.ts';
import { Gear } from '../../src/sim/vehicle.ts';
import { createWorld, type World } from '../../src/sim/world.ts';

const DISTRICT = 'district.puddle_lane';
/** Puddle Lane's campaign seed (assets-src/levels/puddle_lane.level.json). M1 draws no random numbers yet; the
 * seed still enters the hash header, and M2+ systems will draw from it. */
const SEED = 1001;
const LEVEL_PATH = fileURLToPath(new URL('../../public/assets/levels/puddle_lane.json', import.meta.url));
const REPLAY_PATH = fileURLToPath(
  new URL('../../tests/replay/replays/m1_drive_puddle_lane.json', import.meta.url),
);

/** The invariants committed with the replay (TECHNICAL_DESIGN §18.3; the M1 keys from SSP-038). */
const INVARIANTS: ReplayInvariants = {
  hpMin: 90,
  maxSolidOverlapM: 0.001,
  minEvents: { Impact: 1, KerbJolt: 1, ReverseBeeper: 1 },
};

// ---------------------------------------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------------------------------------

type Point = readonly [xM: number, yM: number];

/**
 * One route step.
 * - drive: follow `path` (sim metres, from wherever Bessie is) at up to `speedMps`, arriving at its last point
 *   at `exitMps` or less; done when Bessie reaches or passes the last point.
 * - press: put these PRESSED bits on the next tick's frame (merged into whatever the next step drives).
 * - stop: brake (no throttle, wheels straight) until Bessie stands still.
 * - reverse: hold the brake with `steer` (−127..127) until REV engages, keep reversing, and finish once an
 *   EV.Impact has been seen and Bessie has stopped against it, or after `maxTicks`.
 */
type Step =
  | {
      readonly kind: 'drive';
      readonly label: string;
      readonly path: readonly Point[];
      readonly speedMps: number;
      readonly exitMps: number;
    }
  | { readonly kind: 'press'; readonly label: string; readonly pressed: number }
  | { readonly kind: 'stop'; readonly label: string }
  | { readonly kind: 'reverse'; readonly label: string; readonly steer: number; readonly maxTicks: number };

/** Tile centre in sim metres (2 m tiles). */
function tile(col: number, row: number): Point {
  return [col * 2 + 1, row * 2 + 1];
}

/** Speed for the corners: slow enough that the turn fits inside the junction. */
const CORNER_MPS = 3.2;
/** Asking for more than either top speed: the sim caps it at 6.0 m/s brush down, 11.0 m/s brush up. */
const FLAT_OUT_MPS = 12;

/**
 * The route: the north loop of Puddle Lane's figure-of-eight, entered from the depot up Mangle Street.
 * Depot (3, 44) → Mangle Street north (transit) → Soapsud Terrace east (brush down, 6.0 m/s cap) → Gutter Row
 * north (sweeping) → Puddle Lane east (brush up, 11.0 m/s) → Drain Close south → Soapsud Terrace west, then a
 * reverse onto the south pavement until the tail touches the terrace wall (REV beeper, kerb jolts, impact) and
 * off again, west to Mangle Street and into its turn south toward the depot as the 3,600 ticks run out.
 * Streets (LEVEL_DESIGN §8.5): Mangle Street x 2–4, Soapsud Terrace rows 21–23, Gutter Row x 22–24, Puddle
 * Lane rows 4–6, Drain Close x 50–52.
 */
const ROUTE: readonly Step[] = [
  { kind: 'press', label: 'toot leaving the depot', pressed: PRESSED.HORN },
  {
    kind: 'drive',
    label: 'Mangle Street north, transit',
    path: [tile(3, 40), tile(3, 24)],
    speedMps: FLAT_OUT_MPS,
    exitMps: CORNER_MPS,
  },
  {
    kind: 'drive',
    label: 'turn east into Soapsud Terrace',
    path: [tile(3, 22), tile(7, 22)],
    speedMps: CORNER_MPS + 1,
    exitMps: CORNER_MPS + 1,
  },
  { kind: 'press', label: 'brush down', pressed: PRESSED.BRUSH },
  {
    kind: 'drive',
    label: 'Soapsud Terrace east, sweeping',
    path: [tile(20, 22)],
    speedMps: FLAT_OUT_MPS,
    exitMps: CORNER_MPS,
  },
  {
    kind: 'drive',
    label: 'turn north into Gutter Row',
    path: [tile(23, 22), tile(23, 18)],
    speedMps: CORNER_MPS + 1,
    exitMps: CORNER_MPS + 1,
  },
  {
    kind: 'drive',
    label: 'Gutter Row north, sweeping',
    path: [tile(23, 7)],
    speedMps: FLAT_OUT_MPS,
    exitMps: CORNER_MPS,
  },
  {
    kind: 'drive',
    label: 'turn east into Puddle Lane',
    path: [tile(23, 5), tile(27, 5)],
    speedMps: CORNER_MPS + 1,
    exitMps: CORNER_MPS + 1,
  },
  { kind: 'press', label: 'brush up', pressed: PRESSED.BRUSH },
  {
    kind: 'drive',
    label: 'Puddle Lane east, transit',
    path: [tile(49, 5)],
    speedMps: FLAT_OUT_MPS,
    exitMps: CORNER_MPS,
  },
  {
    kind: 'drive',
    label: 'turn south into Drain Close',
    path: [tile(51, 5), tile(51, 9)],
    speedMps: CORNER_MPS + 1,
    exitMps: CORNER_MPS + 1,
  },
  {
    kind: 'drive',
    label: 'Drain Close south, transit',
    path: [tile(51, 20)],
    speedMps: FLAT_OUT_MPS,
    exitMps: CORNER_MPS,
  },
  {
    kind: 'drive',
    label: 'turn west into Soapsud Terrace',
    path: [tile(51, 22), tile(47, 22)],
    speedMps: CORNER_MPS + 1,
    exitMps: CORNER_MPS + 1,
  },
  {
    kind: 'drive',
    label: 'Soapsud Terrace west, transit, over the Gutter Row crossing',
    path: [tile(15, 22)],
    speedMps: FLAT_OUT_MPS,
    exitMps: 0,
  },
  { kind: 'stop', label: 'stop outside the terrace' },
  { kind: 'reverse', label: 'reverse onto the south pavement to the wall', steer: -STEER_MAX, maxTicks: 600 },
  {
    kind: 'drive',
    label: 'pull off the pavement',
    path: [tile(13, 22)],
    speedMps: CORNER_MPS + 1,
    exitMps: CORNER_MPS + 1,
  },
  {
    kind: 'drive',
    label: 'Soapsud Terrace west to Mangle Street, transit',
    path: [tile(6, 22)],
    speedMps: FLAT_OUT_MPS,
    exitMps: CORNER_MPS,
  },
  {
    kind: 'drive',
    label: 'turn south into Mangle Street, back toward the depot',
    path: [tile(3, 22), tile(3, 40)],
    speedMps: CORNER_MPS + 1,
    exitMps: 0,
  },
];

// ---------------------------------------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------------------------------------

/** Planning deceleration for the speed plan (the brake gives 6.0 m/s²; keep a margin). */
const PLAN_DECEL_MPS2 = 3.5;
/** Done with a drive step within this distance of its last point (or once past it). */
const ARRIVE_M = 1.0;

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

type StepReport = {
  label: string;
  startTick: number;
  endTick: number;
  impact: number;
  kerbJolt: number;
  reverseBeeper: number;
  maxSpeedMps: number;
};

function newReport(label: string, tick: number): StepReport {
  return { label, startTick: tick, endTick: tick, impact: 0, kerbJolt: 0, reverseBeeper: 0, maxSpeedMps: 0 };
}

type DriveResult = {
  log: InputLog;
  reports: StepReport[];
  /** Top forward speed seen with the brush down and with it up. */
  maxBrushDownMps: number;
  maxBrushUpMps: number;
};

/** Drive ROUTE for `ticks` ticks on a fresh World and return the recorded log plus a per-step report. */
function driveRoute(ticks: number): DriveResult {
  const level = decodeLevel(readFileSync(LEVEL_PATH, 'utf8'));
  const world = createWorld(level, SEED, DEFAULT_TUNING);
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
    // Resolve instant steps (press) and completed steps before choosing this tick's frame.
    let step = ROUTE[stepIndex];
    while (step !== undefined && step.kind === 'press') {
      pendingPressed |= step.pressed;
      reports.push(newReport(step.label, world.tick));
      stepIndex += 1;
      step = ROUTE[stepIndex];
    }
    if (report === null && step !== undefined) {
      report = newReport(step.label, world.tick);
    }

    frame.throttle = 0;
    frame.brake = 0;
    frame.steer = 0;
    frame.buttons = 0;
    frame.pressed = pendingPressed;
    pendingPressed = 0;

    let done = false;
    if (step === undefined) {
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
    }

    world.step(frame);

    const impacts = countEvents(world.events, EV.Impact);
    if (report !== null) {
      const r: StepReport = report;
      r.impact += impacts;
      r.kerbJolt += countEvents(world.events, EV.KerbJolt);
      r.reverseBeeper += countEvents(world.events, EV.ReverseBeeper);
      r.maxSpeedMps = Math.max(r.maxSpeedMps, Math.abs(world.vehicle.vLongMps));
    }
    if (impacts > 0) impactSeen = true;
    if (step !== undefined && step.kind === 'reverse' && impactSeen) done = true;
    if (world.vehicle.brushDown) maxBrushDownMps = Math.max(maxBrushDownMps, world.vehicle.vLongMps);
    else maxBrushUpMps = Math.max(maxBrushUpMps, world.vehicle.vLongMps);
    if (done) finishStep();
  }
  if (report !== null) {
    (report as StepReport).endTick = world.tick;
    reports.push(report);
  }
  for (let i = stepIndex + 1; i < ROUTE.length; i++) {
    const s = ROUTE[i] as Step;
    reports.push(newReport(`${s.label} (not reached)`, ticks));
  }
  return { log, reports, maxBrushDownMps, maxBrushUpMps };
}

// ---------------------------------------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------------------------------------

function main(args: readonly string[]): number {
  const unknown = args.filter((a) => a !== '--check');
  if (unknown.length > 0) {
    process.stderr.write(`usage: node tools/replays/record-m1-drive-puddle-lane.ts [--check]\n`);
    return 2;
  }
  const check = args.includes('--check');
  const drive = driveRoute(REPLAY_TICKS);
  const level = decodeLevel(readFileSync(LEVEL_PATH, 'utf8'));
  const file = recordReplay(level, DEFAULT_TUNING, DISTRICT, SEED, drive.log, INVARIANTS);
  const text = serialiseReplay(file);

  for (const r of drive.reports) {
    const events = [
      r.impact > 0 ? `Impact ${r.impact}` : '',
      r.kerbJolt > 0 ? `KerbJolt ${r.kerbJolt}` : '',
      r.reverseBeeper > 0 ? `ReverseBeeper ${r.reverseBeeper}` : '',
    ]
      .filter((s) => s !== '')
      .join(', ');
    process.stdout.write(
      `${String(r.startTick).padStart(4)}–${String(r.endTick).padEnd(4)} ${r.label}` +
        `${r.maxSpeedMps > 0 ? ` (max ${r.maxSpeedMps.toFixed(2)} m/s)` : ''}${events ? ` [${events}]` : ''}\n`,
    );
  }
  let impact = 0;
  let kerbJolt = 0;
  let reverseBeeper = 0;
  for (const r of drive.reports) {
    impact += r.impact;
    kerbJolt += r.kerbJolt;
    reverseBeeper += r.reverseBeeper;
  }
  process.stdout.write(
    `events: Impact ${impact}, KerbJolt ${kerbJolt}, ReverseBeeper ${reverseBeeper}; top speed brush down ` +
      `${drive.maxBrushDownMps.toFixed(3)} m/s, brush up ${drive.maxBrushUpMps.toFixed(3)} m/s; ` +
      `final hash ${file.checkpoints[String(file.ticks)]}\n`,
  );

  if (check) {
    let committed = '';
    try {
      committed = readFileSync(REPLAY_PATH, 'utf8');
    } catch {
      process.stderr.write(`check: ${REPLAY_PATH} is missing\n`);
      return 1;
    }
    if (committed !== text) {
      process.stderr.write('check: the committed replay differs from what this script generates\n');
      return 1;
    }
    process.stdout.write('check: the committed replay matches the generator\n');
    return 0;
  }
  writeFileSync(REPLAY_PATH, text);
  process.stdout.write(`wrote ${REPLAY_PATH}\n`);
  return 0;
}

process.exitCode = main(process.argv.slice(2));
