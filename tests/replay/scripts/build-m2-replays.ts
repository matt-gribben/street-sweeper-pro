// Scripted input generator for the M2 replays (SSP-072, TECHNICAL_DESIGN §18.3, ROADMAP M2):
//   tests/replay/replays/m2_full_shift_puddle_lane.json  a whole 240 s shift of kerb-side sweeping, run on
//     through the knock-off until the shift has ended (EV.ShiftEnd TIME_UP);
//   tests/replay/replays/m2_dump_cycle_puddle_lane.json  a sweeping lap that sprays some water, then drives
//     back into the depot, stops in a bay, holds INTERACT and drains the hopper (and refills the tank).
//
// Like the M1 generator (tools/replays/record-m1-drive-puddle-lane.ts) each route is a readable list of steps
// that the shared closed-loop driver (tools/replays/routeDriver.ts) turns into integer InputFrames, tick by
// tick; only those inputs are recorded, and recordReplay stamps the checkpoint hashes. The routes are built
// from Puddle Lane's junction centres: each street is swept in the kerb lane on Bessie's left (1.0 m from the
// kerb, so the left gutter brush runs within the Kerb Hugger's 0.2 m) at 3.8 m/s, under the 4.0 m/s at which
// every litter item is picked up (no fling), and each corner is a quarter circle between the two streets'
// centre lines at 2.2 m/s.
//
// Because the driver is closed-loop, a deliberate sim change can make this script produce different inputs.
// The committed replay files are the truth: `npm run test:replay -- --update` re-records their hashes for the
// committed inputs (ROADMAP §5.3). Re-run this script only to change a route, or when a sim change stops the
// committed inputs from meeting their invariants; say which in the commit.
//
// Run: node tests/replay/scripts/build-m2-replays.ts [--check]
//   (no flag)  write both replay files and print each route's summary (steps, tick ranges, events, totals)
//   --check    regenerate in memory and exit 1 if a committed file differs (inputs, hashes or invariants)
// Exit status: 0 ok, 1 check failed or a route missed its goal (nothing is written then), 2 usage.
// `npm run test:replay` checks the invariants. Running it twice writes byte-identical files: no wall clock, no
// Math.random, Node built-ins and src/sim/** (through the driver) only, on plain Node 24 type stripping.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { EV } from '../../../src/sim/eventQueue.ts';
import { cos, sin } from '../../../src/sim/fmath.ts';
import { BUTTON, PRESSED } from '../../../src/sim/inputFrame.ts';
import { decodeLevel, type Level } from '../../../src/sim/map.ts';
import {
  type ReplayFile,
  type ReplayInvariants,
  recordReplay,
  serialiseReplay,
} from '../../../src/sim/replay.ts';
import { ShiftPhase } from '../../../src/sim/shift.ts';
import { DEFAULT_TUNING } from '../../../src/sim/tuning.ts';
import {
  type DriveResult,
  driveRoute,
  formatReports,
  type Point,
  type Step,
} from '../../../tools/replays/routeDriver.ts';

const DISTRICT = 'district.puddle_lane';
/** Puddle Lane's campaign seed (assets-src/levels/puddle_lane.level.json), as in the M1 replay. */
const SEED = 1001;
const LEVEL_PATH = fileURLToPath(new URL('../../../public/assets/levels/puddle_lane.json', import.meta.url));
const REPLAYS_DIR = fileURLToPath(new URL('../replays/', import.meta.url));

// ---------------------------------------------------------------------------------------------------------
// Puddle Lane geometry (LEVEL_DESIGN §5.1; sim metres, 2 m tiles, y grows south)
// ---------------------------------------------------------------------------------------------------------

/** Street centre lines: x of the north–south streets, y of the east–west ones (3-tile streets). */
const MANGLE_X = 7; // Mangle Street, x 2–4
const GUTTER_X = 47; // Gutter Row, x 22–24
const DRAIN_X = 103; // Drain Close, x 50–52
const SOAPSUD_Y = 45; // Soapsud Terrace, rows 21–23
const PUDDLE_Y = 11; // Puddle Lane, rows 4–6
const BACK_Y = 81; // the back road joining Gutter Row and Drain Close, rows 39–41

/** Junction centres. */
const J = {
  mangleSoapsud: [MANGLE_X, SOAPSUD_Y],
  gutterSoapsud: [GUTTER_X, SOAPSUD_Y],
  drainSoapsud: [DRAIN_X, SOAPSUD_Y],
  gutterPuddle: [GUTTER_X, PUDDLE_Y],
  drainPuddle: [DRAIN_X, PUDDLE_Y],
  gutterBack: [GUTTER_X, BACK_Y],
  drainBack: [DRAIN_X, BACK_Y],
} as const satisfies Record<string, Point>;

/** Bessie's start: `@` at (3, 44), on Mangle Street's centre line, facing north toward the depot gate. */
const DEPOT_START: Point = [MANGLE_X, 89];

/** Kerb lane: this far left of a street's centre line (1.0 m from the kerb of a 3-tile street). */
const KERB_LANE_OFFSET_M = 2.0;
/** Sweeping speed: under the 4.0 m/s at which pickup is certain (GDD §8.3, no fling). */
const SWEEP_MPS = 3.8;
/**
 * Corners are quarter circles of this radius between the two streets' centre lines. Bessie's tightest
 * rear-axle radius at CORNER_MPS is 4.8 m (34° lock / (1 + 2.2/8), 2.4 m wheelbase). On the centre lines a
 * 5.5 m arc keeps her inner rear wheel 0.77 m off a left turn's inside corner, and her outer front corner
 * 1.5 m short of the far kerb where the street she leaves ends (an L or a T junction).
 */
const CORNER_RADIUS_M = 5.5;
const CORNER_MPS = 2.2;
/** Polyline points per quarter circle. */
const CORNER_POINTS = 8;
/** Move between the centre line (at a corner) and the kerb lane over this distance. */
const LANE_RAMP_M = 6;

function unit(from: Point, to: Point): Point {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const len = Math.abs(dx) + Math.abs(dy);
  return [dx / len, dy / len];
}

function along(p: Point, dir: Point, m: number): Point {
  return [p[0] + dir[0] * m, p[1] + dir[1] * m];
}

/** The point `m` to the left of `p` for heading `dir` (screen axes, y down: left of north is west). */
function leftOf(p: Point, dir: Point, m: number): Point {
  return [p[0] + dir[1] * m, p[1] - dir[0] * m];
}

/** The street from `a` to `b` (two points on one centre line) and the direction of travel, for the labels. */
function streetName(a: Point, b: Point): string {
  if (a[0] === b[0]) {
    const name = a[0] === MANGLE_X ? 'Mangle Street' : a[0] === GUTTER_X ? 'Gutter Row' : 'Drain Close';
    return `${name} ${b[1] < a[1] ? 'north' : 'south'}`;
  }
  const name = a[1] === SOAPSUD_Y ? 'Soapsud Terrace' : a[1] === PUDDLE_Y ? 'Puddle Lane' : 'the back road';
  return `${name} ${b[0] > a[0] ? 'east' : 'west'}`;
}

/**
 * The corner at junction `j` from heading `dirIn` to heading `dirOut` (axis-aligned, 90° apart): a quarter
 * circle of CORNER_RADIUS_M from the incoming centre line CORNER_RADIUS_M before `j` to the outgoing centre
 * line CORNER_RADIUS_M after it. Its centre lies CORNER_RADIUS_M along dirOut from the arc's start.
 */
function cornerArc(j: Point, dirIn: Point, dirOut: Point): Point[] {
  const r = CORNER_RADIUS_M;
  const c = along(along(j, dirIn, -r), dirOut, r);
  const out: Point[] = [];
  for (let k = 1; k <= CORNER_POINTS; k++) {
    const t = ((k / CORNER_POINTS) * Math.PI) / 2;
    const ct = cos(t);
    const st = sin(t);
    out.push([c[0] + r * (dirIn[0] * st - dirOut[0] * ct), c[1] + r * (dirIn[1] * st - dirOut[1] * ct)]);
  }
  return out;
}

/**
 * Sweep along `points`: the first is where Bessie starts (on a centre line, heading toward the second), every
 * other point but the last is a junction centre she turns at, and the route ends in the kerb lane at the last.
 * Each street is one drive step (centre line → kerb lane on her left → centre line before the next corner) and
 * each junction one corner step. `buttons(i)` gives the BUTTON bits held on street i (0-based) and its corner.
 */
function sweepRoute(
  label: string,
  route: readonly Point[],
  buttons: (street: number) => number = () => 0,
): Step[] {
  // Straight on across a junction is no corner: Bessie stays in the kerb lane (there is no kerb to hug there).
  const points = route.filter((p, i) => {
    if (i === 0 || i === route.length - 1) return true;
    const a = unit(route[i - 1] as Point, p);
    const b = unit(p, route[i + 1] as Point);
    return a[0] !== b[0] || a[1] !== b[1];
  });
  const steps: Step[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1] as Point;
    const b = points[i] as Point;
    const dir = unit(a, b);
    const cornerAfter = i < points.length - 1;
    const laneFromM = (i > 1 ? CORNER_RADIUS_M : 0) + LANE_RAMP_M;
    const path: Point[] = [leftOf(along(a, dir, laneFromM), dir, KERB_LANE_OFFSET_M)];
    if (cornerAfter) {
      path.push(leftOf(along(b, dir, -(CORNER_RADIUS_M + LANE_RAMP_M)), dir, KERB_LANE_OFFSET_M));
      path.push(along(b, dir, -CORNER_RADIUS_M));
    } else {
      path.push(leftOf(b, dir, KERB_LANE_OFFSET_M));
    }
    const held = buttons(i - 1);
    steps.push({
      kind: 'drive',
      label: `${label}: ${streetName(a, b)}`,
      path,
      speedMps: SWEEP_MPS,
      exitMps: cornerAfter ? CORNER_MPS : SWEEP_MPS,
      buttons: held,
    });
    if (cornerAfter) {
      const next = points[i + 1] as Point;
      steps.push({
        kind: 'drive',
        label: `${label}: corner into ${streetName(b, next)}`,
        path: cornerArc(b, dir, unit(b, next)),
        speedMps: CORNER_MPS,
        exitMps: CORNER_MPS,
        buttons: held,
      });
    }
  }
  return steps;
}

// ---------------------------------------------------------------------------------------------------------
// Full shift
// ---------------------------------------------------------------------------------------------------------

/**
 * The whole figure-of-eight from Gutter Row and Soapsud Terrace heading east, every street in both
 * directions, so the left-hand kerb lane passes every kerb of the eight once: the north loop anticlockwise
 * (its inner kerbs), the south loop clockwise (inner kerbs), the north loop clockwise (outer kerbs) and the
 * south loop anticlockwise (outer kerbs), back to Gutter Row and Soapsud Terrace. About 710 m.
 */
const FIGURE_OF_EIGHT: readonly Point[] = [
  J.drainSoapsud,
  J.drainPuddle,
  J.gutterPuddle,
  J.gutterSoapsud,
  J.gutterBack,
  J.drainBack,
  J.drainSoapsud,
  J.gutterSoapsud,
  J.gutterPuddle,
  J.drainPuddle,
  J.drainSoapsud,
  J.drainBack,
  J.gutterBack,
  J.gutterSoapsud,
];

/** Full-shift length: the 14,400-tick timer from tick 0, the knock-off roll to rest and a margin. */
const FULL_SHIFT_TICKS = 14_600;
/** The shift (or the dump) must be over at least this many ticks before the replay ends. */
const END_MARGIN_TICKS = 60;

/**
 * From the depot, brush down at once (the throttle on tick 0 starts the timer), north up Mangle Street in the
 * west kerb lane (the dense gutter grime of its first 30 m, LEVEL_DESIGN §5.1), east along Soapsud Terrace to
 * Gutter Row, then round the figure-of-eight twice. The shift knocks off during the second lap: from then on
 * the driver sends nothing (the knock-off brake stops Bessie) and the rest of the route is not reached.
 */
const FULL_SHIFT_ROUTE: readonly Step[] = [
  { kind: 'press', label: 'brush down in the depot', pressed: PRESSED.BRUSH },
  ...sweepRoute('shift', [
    DEPOT_START,
    J.mangleSoapsud,
    J.gutterSoapsud,
    ...FIGURE_OF_EIGHT,
    ...FIGURE_OF_EIGHT,
    J.drainSoapsud,
  ]),
];

/**
 * Set from the recorded run with headroom (SSP-072): it scored 6,316 and collected 47 items (best chain 4: the
 * initial litter is too sparse along the kerbs for the ×2 tier's 10 pickups 2 s apart, so no ComboTier is
 * asserted), never lost HP and never touched a solid, and the shift ended TIME_UP at tick 14,493.
 */
const FULL_SHIFT_INVARIANTS: ReplayInvariants = {
  minScore: 4000,
  minLitterCollected: 35,
  hpMin: 90,
  maxSolidOverlapM: 0.001,
  shiftEnded: 'TimeUp',
};

// ---------------------------------------------------------------------------------------------------------
// Dump cycle
// ---------------------------------------------------------------------------------------------------------

/** Dump-cycle length: the lap, the bay and the dump with a margin (the route summary prints the ticks used). */
const DUMP_CYCLE_TICKS = 7_200;

/**
 * From the depot, brush down, north up Mangle Street and round the north loop clockwise (Soapsud Terrace east
 * with the spray held, Gutter Row north, Puddle Lane east, Drain Close south, Soapsud Terrace west), south down
 * Mangle Street in its east kerb lane, brush up at the gate, round the apron into the east bay (site.depot_bay,
 * x 9–10, rows 42–44) and hold INTERACT until the dump ends: a 1.0 s hold, a 2.0 s drain, the tank refilled.
 */
const DUMP_CYCLE_ROUTE: readonly Step[] = [
  { kind: 'press', label: 'brush down in the depot', pressed: PRESSED.BRUSH },
  ...sweepRoute(
    'lap',
    [
      DEPOT_START,
      J.mangleSoapsud,
      J.gutterSoapsud,
      J.gutterPuddle,
      J.drainPuddle,
      J.drainSoapsud,
      J.mangleSoapsud,
      [MANGLE_X, 76],
    ],
    (street) => (street === 1 ? BUTTON.SPRAY : 0),
  ),
  { kind: 'press', label: 'brush up at the depot gate', pressed: PRESSED.BRUSH },
  {
    kind: 'drive',
    label: 'round the apron into the east bay',
    path: [
      [9, 80],
      [9, 85],
      [10.5, 89],
      [13.5, 91.5],
      [16.5, 91.5],
      [19.5, 89.5],
      [20, 87],
    ],
    speedMps: 1.5,
    exitMps: 0,
  },
  { kind: 'dump', label: 'hold INTERACT in the bay until the dump ends', maxTicks: 600 },
];

/**
 * Set from the recorded run with headroom (SSP-072): it scored 4,356, collected 17 items (16.5 LU) and sprayed
 * the tank down to 28.4 units; the depot dump drained all 16.5 LU and refilled the tank to 100.
 */
const DUMP_CYCLE_INVARIANTS: ReplayInvariants = {
  minScore: 3000,
  minLitterCollected: 12,
  hpMin: 90,
  maxSolidOverlapM: 0.001,
  minEvents: { DumpStart: 1, DumpEnd: 1 },
  minLuDumped: 10,
  minDumpsCompleted: 1,
  emptyAfterDump: true,
};

// ---------------------------------------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------------------------------------

type Build = {
  readonly name: string;
  readonly file: ReplayFile;
  readonly drive: DriveResult;
  /** The step whose end marks the replay's goal: the shift's end or the dump's. */
  readonly goal: 'shift' | 'dump';
};

function summarise(name: string, drive: DriveResult, file: ReplayFile): string {
  const w = drive.world;
  const totals: number[] = [];
  for (const r of drive.reports) {
    for (let i = 0; i < r.events.length; i++) totals[i] = (totals[i] ?? 0) + (r.events[i] ?? 0);
  }
  const events = Object.entries(EV)
    .filter(([, id]) => (totals[id] ?? 0) > 0)
    .map(([n, id]) => `${n} ${totals[id]}`)
    .join(', ');
  return (
    `${name}: ${file.ticks} ticks, final hash ${file.checkpoints[String(file.ticks)]}\n` +
    `  events: ${events}\n` +
    `  score ${w.scoring.score} (items ${w.scoring.itemPts}, grime ${w.scoring.grimePts}, bonus ` +
    `${w.scoring.bonusPts}, penalty ${w.scoring.penaltyPts}); Kerb Hugger ${w.scoring.kerbHuggerAwards}; ` +
    `best chain ${w.scoring.combo.bestChain}\n` +
    `  litter collected ${w.litter.litterCollected} of ${w.litter.litterSpawned}; grime cleaned ` +
    `${w.dirt.cleanedCells} (gutter ${w.dirt.cleanedGutterCells}); Tidy ${(w.tidy.tidyPpm / 1e4).toFixed(2)}% ` +
    `(${w.tidy.stars} stars); Clean Sweeps ${w.tidy.cleanSweeps}\n` +
    `  hopper ${w.vehicle.hopperLU.toFixed(3)} LU, dumped ${w.hopper.luDumpedTotal.toFixed(3)} LU ` +
    `(depot ${w.hopper.luDumpedDepot.toFixed(3)}), dumps completed ${w.shift.dumpsCompleted}; water ` +
    `${w.vehicle.water.toFixed(3)}; HP ${w.vehicle.hp.toFixed(2)}\n` +
    `  top speed brush down ${drive.maxBrushDownMps.toFixed(3)} m/s, brush up ${drive.maxBrushUpMps.toFixed(3)} ` +
    `m/s; shift phase ${w.shift.phase}, timer start ${w.shift.timerStartTick}, knock-off ${w.shift.knockOffTick}, ` +
    `end tick ${w.shift.endTick} (reason ${w.shift.endReason})\n`
  );
}

/** The goals the generator insists on before it writes a file (the runner checks the committed invariants). */
function routeProblems(b: Build): string[] {
  const { drive, file } = b;
  const w = drive.world;
  const latest = file.ticks - END_MARGIN_TICKS;
  const out: string[] = [];
  if (b.goal === 'shift') {
    if (w.shift.phase !== ShiftPhase.Ended) out.push('the shift has not ended');
    else if (w.shift.endTick > latest)
      out.push(`the shift ended at tick ${w.shift.endTick}, after ${latest}`);
  } else {
    const dump = drive.reports.find((r) => r.label.startsWith('hold INTERACT'));
    if (dump === undefined || (dump.events[EV.DumpEnd] ?? 0) === 0) out.push('the dump never ended');
    else if (dump.endTick > latest) out.push(`the dump ended at tick ${dump.endTick}, after ${latest}`);
    if (w.shift.dumpsCompleted < 1) out.push('no dump completed');
  }
  if (drive.maxBrushDownMps > 4.0) out.push(`swept at ${drive.maxBrushDownMps.toFixed(3)} m/s, over 4.0 m/s`);
  return out;
}

function build(
  level: Level,
  name: string,
  goal: Build['goal'],
  route: readonly Step[],
  ticks: number,
  invariants: ReplayInvariants,
): Build {
  const drive = driveRoute(level, DEFAULT_TUNING, SEED, route, ticks);
  const file = recordReplay(level, DEFAULT_TUNING, DISTRICT, SEED, drive.log, invariants);
  return { name, file, drive, goal };
}

function main(args: readonly string[]): number {
  const unknown = args.filter((a) => a !== '--check');
  if (unknown.length > 0) {
    process.stderr.write('usage: node tests/replay/scripts/build-m2-replays.ts [--check]\n');
    return 2;
  }
  const check = args.includes('--check');
  const level = decodeLevel(readFileSync(LEVEL_PATH, 'utf8'));
  const builds = [
    build(
      level,
      'm2_full_shift_puddle_lane',
      'shift',
      FULL_SHIFT_ROUTE,
      FULL_SHIFT_TICKS,
      FULL_SHIFT_INVARIANTS,
    ),
    build(
      level,
      'm2_dump_cycle_puddle_lane',
      'dump',
      DUMP_CYCLE_ROUTE,
      DUMP_CYCLE_TICKS,
      DUMP_CYCLE_INVARIANTS,
    ),
  ];
  let status = 0;
  for (const b of builds) {
    process.stdout.write(`\n${formatReports(b.drive.reports, ['LitterCollected', 'ComboTier'])}`);
    process.stdout.write(summarise(b.name, b.drive, b.file));
    const problems = routeProblems(b);
    for (const p of problems) process.stderr.write(`${b.name}: route goal missed: ${p}\n`);
    if (problems.length > 0) status = 1;
    const path = `${REPLAYS_DIR}${b.name}.json`;
    const text = serialiseReplay(b.file);
    if (check) {
      let committed = '';
      try {
        committed = readFileSync(path, 'utf8');
      } catch {
        process.stderr.write(`check: ${path} is missing\n`);
        status = 1;
        continue;
      }
      if (committed !== text) {
        process.stderr.write(`check: the committed ${b.name}.json differs from what this script generates\n`);
        status = 1;
      } else {
        process.stdout.write(`check: the committed ${b.name}.json matches the generator\n`);
      }
    } else if (problems.length === 0) {
      writeFileSync(path, text);
      process.stdout.write(`wrote ${path}\n`);
    }
  }
  return status;
}

process.exitCode = main(process.argv.slice(2));
