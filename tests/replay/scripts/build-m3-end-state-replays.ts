// Scripted input generator for the M3 end-state replays (SSP-107, TECHNICAL_DESIGN §18.3, GDD §11.3, ROADMAP M3):
//   tests/replay/replays/m3_sacked.json  sweep the first stretch of Mangle Street, stop, and lean on the horn:
//     20 quick honks are 5 Noise complaints (the re-arm rule, complaints.ts), and the 5th is SACKED!;
//   tests/replay/replays/m3_towed.json   sweep the same stretch, raise the brush, then ram the terrace at the
//     top of Mangle Street again and again (4 HP per m/s above 2 m/s, collision/resolveStatic.ts) until Bessie's
//     Dignity reaches 0 HP: TOWED!, which keeps floor(0.5 × score) and no stars.
//
// Like the M2 generator (build-m2-replays.ts) each route is a readable list of steps that the shared closed-loop
// driver (tools/replays/routeDriver.ts) turns into integer InputFrames, tick by tick; only those inputs are
// recorded, and recordReplay stamps the checkpoint hashes. SSP-107 added the driver's `wait` (neutral frames for
// a number of ticks, to space out the horn presses) and `ram` (full throttle at a point inside a wall until an
// EV.Impact) steps. An agent cannot press the dev panel's Save replay, so this script is how they are recorded.
//
// Each replay ends at its end state (TECHNICAL_DESIGN §18.3, "End-state replays"): the route is driven for up to
// DRIVE_TICKS ticks, and the log is cut after the tick on which EV.ShiftEnd fired, so `ticks` is that tick count
// and the final checkpoint is the hash of the state the tally shows. The invariants assert the end reason, the
// end tick, the tally's score rule (SACKED shows the score as it stood; TOWED keeps half, floored) and 0 stars.
//
// Because the driver is closed-loop, a deliberate sim change can make this script produce different inputs.
// The committed replay files are the truth: `npm run test:replay -- --update` re-records their hashes for the
// committed inputs (ROADMAP §5.3). Re-run this script only to change a route, or when a sim change stops the
// committed inputs from meeting their invariants (the end tick moves, or the shift no longer ends); say which in
// the commit.
//
// Run: node tests/replay/scripts/build-m3-end-state-replays.ts [--check]
//   (no flag)  write both replay files and print each route's summary (steps, tick ranges, events, totals)
//   --check    regenerate in memory and exit 1 if a committed file differs (inputs, hashes or invariants)
// Exit status: 0 ok, 1 check failed or a route missed its goal (nothing is written then), 2 usage.
// Running it twice writes byte-identical files: no wall clock, no Math.random, Node built-ins and src/sim/**
// (through the driver) only, on plain Node 24 type stripping.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { EV, ShiftEndReason } from '../../../src/sim/eventQueue.ts';
import { createInputFrame, PRESSED } from '../../../src/sim/inputFrame.ts';
import { decodeLevel, type Level } from '../../../src/sim/map.ts';
import {
  appendInput,
  createInputLog,
  type InputLog,
  type ReplayFile,
  type ReplayInvariants,
  readInput,
  recordReplay,
  runReplay,
  type ShiftEndReasonName,
  serialiseReplay,
} from '../../../src/sim/replay.ts';
import { finalShiftScore, finalShiftStars } from '../../../src/sim/shift.ts';
import { DEFAULT_TUNING } from '../../../src/sim/tuning.ts';
import { driveRoute, formatReports, type Point, type Step } from '../../../tools/replays/routeDriver.ts';

const DISTRICT = 'district.puddle_lane';
/** Puddle Lane's campaign seed (assets-src/levels/puddle_lane.level.json), as in the M1 and M2 replays. */
const SEED = 1001;
const LEVEL_PATH = fileURLToPath(new URL('../../../public/assets/levels/puddle_lane.json', import.meta.url));
const REPLAYS_DIR = fileURLToPath(new URL('../replays/', import.meta.url));

/** The most ticks a route is driven for; the replay is cut at its EV.ShiftEnd, well before this. */
const DRIVE_TICKS = 7_200;

// ---------------------------------------------------------------------------------------------------------
// Puddle Lane geometry (LEVEL_DESIGN §5.1; sim metres, 2 m tiles, y grows south)
// ---------------------------------------------------------------------------------------------------------

/** Mangle Street's centre line (x 2–4). Bessie starts on it at `@` (3, 44), (7, 89), facing north to the gate. */
const MANGLE_X = 7;
/** Mangle Street's west kerb lane: 2.0 m left of the centre line, 1.0 m from the kerb (as in the M2 replays). */
const WEST_KERB_LANE_X = MANGLE_X - 2;
/** Under the 4.0 m/s at which every litter item is picked up (GDD §8.3, no fling), as in the M2 replays. */
const SWEEP_MPS = 3.8;

/**
 * Both routes open the same way: brush down in the depot (the throttle on tick 0 starts the timer), out of the
 * gate and north up Mangle Street in the west kerb lane, along the dense gutter grime of its first 30 m
 * (LEVEL_DESIGN §5.1), so the shift has a score to keep (or halve), and stop there.
 */
const SWEEP_MANGLE_STREET: readonly Step[] = [
  { kind: 'press', label: 'brush down in the depot', pressed: PRESSED.BRUSH },
  {
    kind: 'drive',
    label: 'out of the gate, into the west kerb lane',
    path: [
      [MANGLE_X, 80],
      [WEST_KERB_LANE_X, 74],
    ],
    speedMps: SWEEP_MPS,
    exitMps: SWEEP_MPS,
  },
  {
    kind: 'drive',
    label: 'Mangle Street north, sweeping the west gutter',
    path: [[WEST_KERB_LANE_X, 64]],
    speedMps: SWEEP_MPS,
    exitMps: 0,
  },
  { kind: 'stop', label: 'stop in the kerb lane' },
];

// ---------------------------------------------------------------------------------------------------------
// SACKED
// ---------------------------------------------------------------------------------------------------------

/** Honks: more than 3 in 5 s is a Noise complaint, which clears the window, so 20 are 5 complaints. */
const SACKED_HONKS = 20;
/** Ticks from one horn press to the next (well inside the 300-tick window). */
const HONK_GAP_TICKS = 10;

const SACKED_ROUTE: readonly Step[] = [
  ...SWEEP_MANGLE_STREET,
  ...Array.from({ length: SACKED_HONKS }, (_, i): Step[] => [
    { kind: 'press', label: `horn ${i + 1}`, pressed: PRESSED.HORN },
    { kind: 'wait', label: `wait after horn ${i + 1}`, ticks: HONK_GAP_TICKS },
  ]).flat(),
];

// ---------------------------------------------------------------------------------------------------------
// TOWED
// ---------------------------------------------------------------------------------------------------------

/**
 * The rams happen in the depot yard (LEVEL_DESIGN §5.1: walled, `[0, 38, 14, 10]`), which has no traffic lane
 * and no pedestrians, so nothing but the wall is hit. Bessie runs east along this line, between the shed (`P`,
 * its south face at y 84) and the lamp post in the yard's south-east corner (col 12, row 46, y 92–94)...
 */
const RAM_LINE_Y = 87.5;
/** ...into the yard's east wall (`w`, col 13, x 26–28): the target is inside it. */
const RAM_TARGET: Point = [30, RAM_LINE_Y];
/** ...and backs off west along it toward this point, for this long (about 17 m at reverse's 2.5 m/s). */
const BACK_OFF_AIM: Point = [0, RAM_LINE_Y];
const BACK_OFF_TICKS = 440;
/** Ram attempts; the shift ends TOWED before the last. */
const RAMS = 7;

const TOWED_ROUTE: readonly Step[] = [
  ...SWEEP_MANGLE_STREET,
  // Back down Mangle Street into the depot, brush still down, until her tail touches the yard's south wall.
  { kind: 'reverse', label: 'back into the depot', steer: 0, maxTicks: 1400, aim: [6, 96] },
  { kind: 'press', label: 'brush up', pressed: PRESSED.BRUSH },
  {
    kind: 'drive',
    label: 'turn east below the shed',
    path: [
      [8, 89],
      [11, RAM_LINE_Y],
      [14, RAM_LINE_Y],
    ],
    speedMps: 3,
    exitMps: 3,
  },
  ...Array.from({ length: RAMS }, (_, i): Step[] => [
    { kind: 'ram', label: `ram ${i + 1}`, target: RAM_TARGET, speedMps: 11, maxTicks: 600 },
    { kind: 'wait', label: `settle after ram ${i + 1}`, ticks: 30 },
    { kind: 'reverse', label: `back off ${i + 1}`, steer: 0, maxTicks: BACK_OFF_TICKS, aim: BACK_OFF_AIM },
  ]).flat(),
];

// ---------------------------------------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------------------------------------

type Spec = {
  readonly name: string;
  readonly route: readonly Step[];
  readonly reason: ShiftEndReasonName;
  /** The invariants other than the end state's own (shiftEnded, shiftEndTick, tallyScoreKeep, tallyStars). */
  readonly invariants: ReplayInvariants;
  /** The tally keeps this share of the score (GDD §11.3): 1 after SACKED, 0.5 after TOWED. */
  readonly scoreKeep: number;
};

/** The first `ticks` frames of `log` as a log of exactly that length. */
function truncateLog(log: InputLog, ticks: number): InputLog {
  const out = createInputLog(ticks);
  const frame = createInputFrame();
  for (let t = 0; t < ticks; t++) {
    readInput(log, t, frame);
    appendInput(out, t, frame);
  }
  return out;
}

function build(level: Level, spec: Spec): { file: ReplayFile; problems: string[] } {
  const drive = driveRoute(level, DEFAULT_TUNING, SEED, spec.route, DRIVE_TICKS, { yieldToStreet: true });
  const w = drive.world;
  const problems: string[] = [];
  const endTick = w.shift.endTick;
  if (w.shift.endReason !== ShiftEndReason[spec.reason]) {
    problems.push(
      `the shift did not end ${spec.reason} within ${DRIVE_TICKS} ticks (reason ${w.shift.endReason})`,
    );
  }
  // The shift ends at the end of tick endTick (0-based), the (endTick + 1)th step: cut the log there.
  const ticks = endTick >= 0 ? endTick + 1 : DRIVE_TICKS;
  const log = truncateLog(drive.log, Math.min(ticks, DRIVE_TICKS));
  const score = w.scoring.score;
  const tallyScore = finalShiftScore(w.shift, score);
  const tallyStars = finalShiftStars(w.shift, w.tidy.stars);
  if (tallyScore !== Math.floor(spec.scoreKeep * score))
    problems.push(`tally score ${tallyScore}, expected floor(${spec.scoreKeep} × ${score})`);
  if (tallyStars !== 0) problems.push(`tally stars ${tallyStars}, expected 0`);
  if (score <= 0) problems.push(`score ${score}: nothing to keep or halve`);
  const invariants: ReplayInvariants = {
    ...spec.invariants,
    shiftEnded: spec.reason,
    shiftEndTick: ticks,
    tallyScoreKeep: spec.scoreKeep,
    tallyStars: 0,
  };
  const file = recordReplay(level, DEFAULT_TUNING, DISTRICT, SEED, log, invariants);
  // The cut log replays to the same end: the same final state as the driven run.
  const rerun = runReplay(level, DEFAULT_TUNING, SEED, log, log.length).world;
  if (rerun.shift.endReason !== w.shift.endReason || rerun.shift.endTick !== endTick)
    problems.push('the cut log does not reach the same end');

  const totals: number[] = [];
  for (const r of drive.reports)
    for (let i = 0; i < r.events.length; i++) totals[i] = (totals[i] ?? 0) + (r.events[i] ?? 0);
  const events = Object.entries(EV)
    .filter(([, id]) => (totals[id] ?? 0) > 0)
    .map(([n, id]) => `${n} ${totals[id]}`)
    .join(', ');
  process.stdout.write(formatReports(drive.reports, ['LitterCollected', 'Horn']));
  process.stdout.write(
    `${spec.name}: ${file.ticks} ticks, ended ${spec.reason} at tick ${endTick} (step ${ticks}), final hash ` +
      `${file.checkpoints[String(file.ticks)]}\n` +
      `  events: ${events}\n` +
      `  score ${score} (items ${w.scoring.itemPts}, grime ${w.scoring.grimePts}, bonus ${w.scoring.bonusPts}, ` +
      `penalty ${w.scoring.penaltyPts}), tally score ${tallyScore}, stars ${w.tidy.stars} → tally ${tallyStars}; ` +
      `litter collected ${w.litter.litterCollected}; HP ${w.vehicle.hp.toFixed(2)}; complaints ` +
      `${w.complaints.count}; honks ${w.complaints.honks}\n` +
      `  top speed brush down ${drive.maxBrushDownMps.toFixed(3)} m/s, brush up ${drive.maxBrushUpMps.toFixed(3)} m/s\n`,
  );
  return { file, problems };
}

/**
 * Set from the recorded runs (SSP-107), the end states exact, the rest with headroom.
 * - m3_sacked: 677 ticks. Swept 891 points (grime 791, bonus 100) up Mangle Street's west gutter,
 *   stopped at tick 486, then 20 honks 10 ticks apart from tick 486: a Noise complaint on every 4th, the 5th on
 *   tick 676, SACKED there. The tally shows 891 and no stars; HP 100, no impact, nothing hit.
 * - m3_towed: 4,577 ticks. Swept 993 points (grime 843, bonus 150) up the same gutter and, reversing with the
 *   brush still down, back into the depot (her tail touches the yard's south wall at 2.5 m/s: 2 HP), then 5 rams
 *   into the yard's east wall at 6.9–7.4 m/s (19.6–21.8 HP each); the 5th takes HP to 0 on tick 4,576: TOWED.
 *   The tally keeps floor(0.5 × 993) = 496 (an odd score, so the floor matters) and no stars; no complaint,
 *   no pedestrian or vehicle touched, no solid overlap. hpMin is not asserted (the point is reaching 0).
 */
const SPECS: readonly Spec[] = [
  {
    name: 'm3_sacked',
    route: SACKED_ROUTE,
    reason: 'Sacked',
    scoreKeep: 1,
    invariants: { minScore: 500, hpMin: 90, maxSolidOverlapM: 0.001, minEvents: { Complaint: 5, Horn: 20 } },
  },
  {
    name: 'm3_towed',
    route: TOWED_ROUTE,
    reason: 'Towed',
    scoreKeep: 0.5,
    invariants: { minScore: 500, maxSolidOverlapM: 0.001, minEvents: { Impact: 5 } },
  },
];

function main(args: readonly string[]): number {
  const unknown = args.filter((a) => a !== '--check');
  if (unknown.length > 0) {
    process.stderr.write('usage: node tests/replay/scripts/build-m3-end-state-replays.ts [--check]\n');
    return 2;
  }
  const check = args.includes('--check');
  const level = decodeLevel(readFileSync(LEVEL_PATH, 'utf8'));
  let status = 0;
  const out: { path: string; text: string }[] = [];
  for (const spec of SPECS) {
    const { file, problems } = build(level, spec);
    for (const p of problems) process.stderr.write(`${spec.name}: route goal missed: ${p}\n`);
    if (problems.length > 0) {
      status = 1;
      continue;
    }
    out.push({ path: `${REPLAYS_DIR}${spec.name}.json`, text: serialiseReplay(file) });
  }
  if (status !== 0) return status;
  for (const { path, text } of out) {
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
        process.stderr.write(`check: the committed ${path} differs from what this script generates\n`);
        status = 1;
      } else {
        process.stdout.write(`check: the committed ${path} matches the generator\n`);
      }
    } else {
      writeFileSync(path, text);
      process.stdout.write(`wrote ${path}\n`);
    }
  }
  return status;
}

process.exitCode = main(process.argv.slice(2));
