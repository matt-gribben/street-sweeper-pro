// Scripted input generator for the M1 replay tests/replay/replays/m1_drive_puddle_lane.json (SSP-049,
// TECHNICAL_DESIGN §18.3). It drives Bessie round Puddle Lane with a small closed-loop route driver and records
// what it pressed, tick by tick, as the replay's input log; recordReplay then runs that log headlessly and
// stamps the checkpoint hashes.
//
// The route (ROUTE below) is a readable list of steps: drive a polyline at a speed, press a button, stop,
// reverse until Bessie touches something. Each tick the driver reads the World's state (pose and speed only)
// and picks integer throttle, brake and steer values: pure pursuit for steering, a braking-distance speed
// plan for throttle and brake. The driver is shared with the M2 generators (tools/replays/routeDriver.ts,
// SSP-072). Only the inputs are recorded, so the replay is exactly `f(seed, district, inputs)` like a
// recording from the dev panel; the driver itself never reaches the runner.
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
import { EV } from '../../src/sim/eventQueue.ts';
import { PRESSED, STEER_MAX } from '../../src/sim/inputFrame.ts';
import { decodeLevel } from '../../src/sim/map.ts';
import { REPLAY_TICKS, type ReplayInvariants, recordReplay, serialiseReplay } from '../../src/sim/replay.ts';
import { DEFAULT_TUNING } from '../../src/sim/tuning.ts';
import { driveRoute, formatReports, type Step, tile } from './routeDriver.ts';

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

/** Speed for the corners: slow enough that the turn fits inside the junction. */
const CORNER_MPS = 3.2;
/** Asking for more than either top speed: the sim caps it at 6.0 m/s brush down, 11.0 m/s brush up. */
const FLAT_OUT_MPS = 12;

/**
 * The route: the north loop of Puddle Lane's figure-of-eight, entered from the depot up Mangle Street.
 * Depot (3, 44) → Mangle Street north (transit) → Soapsud Terrace east (brush down, 6.0 m/s cap), a stop and a
 * reverse onto the south pavement until the tail touches the terrace wall (REV beeper, kerb jolts, impact) and off
 * again → Gutter Row north (sweeping) → Puddle Lane east (brush up, 11.0 m/s) → Drain Close south → Soapsud
 * Terrace west → Mangle Street south toward the depot. Since SSP-104 the street is populated and the driver gives
 * way (driveRoute's yieldToStreet), so the 3,600 ticks end at the turn into Puddle Lane; the reverse moved from
 * Soapsud Terrace west to east to stay inside them. The brush goes down before the reverse, as it did before, so
 * the sweeping code runs for about 2,700 of the ticks: lowered only from tick 3,108, it was cold enough in the
 * heap check's window to run unoptimised and read 78 KB pre-final-GC (TECHNICAL_DESIGN §17 trap (b)).
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
  // The reverse to the wall comes first (SSP-104): on the populated street the drive gives way at junctions,
  // and the manoeuvre must land inside the 3,600 ticks.
  {
    kind: 'drive',
    label: 'Soapsud Terrace east to the terrace, sweeping',
    path: [tile(17, 22)],
    speedMps: FLAT_OUT_MPS,
    exitMps: 0,
  },
  { kind: 'stop', label: 'stop outside the terrace' },
  { kind: 'reverse', label: 'reverse onto the south pavement to the wall', steer: STEER_MAX, maxTicks: 600 },
  {
    kind: 'drive',
    label: 'pull off the pavement',
    path: [tile(19, 22)],
    speedMps: CORNER_MPS + 1,
    exitMps: CORNER_MPS + 1,
  },
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
    label: 'Soapsud Terrace west to Mangle Street, transit, over the Gutter Row crossing',
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
// Main
// ---------------------------------------------------------------------------------------------------------

function main(args: readonly string[]): number {
  const unknown = args.filter((a) => a !== '--check');
  if (unknown.length > 0) {
    process.stderr.write(`usage: node tools/replays/record-m1-drive-puddle-lane.ts [--check]\n`);
    return 2;
  }
  const check = args.includes('--check');
  const level = decodeLevel(readFileSync(LEVEL_PATH, 'utf8'));
  const drive = driveRoute(level, DEFAULT_TUNING, SEED, ROUTE, REPLAY_TICKS, { yieldToStreet: true });
  const file = recordReplay(level, DEFAULT_TUNING, DISTRICT, SEED, drive.log, INVARIANTS);
  const text = serialiseReplay(file);

  // The M1 summary: only the driving events (M2's litter, grime and combo events are left out).
  const shown = ['Impact', 'KerbJolt', 'ReverseBeeper'];
  const skip = Object.keys(EV).filter((name) => !shown.includes(name));
  process.stdout.write(formatReports(drive.reports, skip));
  let impact = 0;
  let kerbJolt = 0;
  let reverseBeeper = 0;
  for (const r of drive.reports) {
    impact += r.events[EV.Impact] ?? 0;
    kerbJolt += r.events[EV.KerbJolt] ?? 0;
    reverseBeeper += r.events[EV.ReverseBeeper] ?? 0;
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
