// Scripted input generator for the M3 High Street smoke replay (SSP-105, TECHNICAL_DESIGN §18.3,
// LEVEL_DESIGN §5.2 and §12): tests/replay/replays/m3_high_street.json, 3,600 ticks on seed 1, so
// `npm run test:replay` covers district.high_street with its whole M3 street life (the market traders, the
// pigeon flocks, shoppers, businessmen, litterbugs, Doris and the old man, moving and parked traffic and the
// scheduled bus) running around Bessie.
//
// Like the M2 generator (build-m2-replays.ts) the route is a readable list of steps that the shared closed-loop
// driver (tools/replays/routeDriver.ts) turns into integer InputFrames, tick by tick; only those inputs are
// recorded, and recordReplay stamps the checkpoint hashes. Bessie leaves the depot with the brush down, sweeps
// the rollout street (Station Road's north arm, eastbound with the one-way flow, in the kerb lane on her left
// along its dense gutter grime), turns south down the east leg with the flow, then right onto the High Street,
// westbound in the south kerb lane past the market square and over the east zebra. The replay ends somewhere
// along the High Street; the rest of the route is never reached.
//
// Because the driver is closed-loop, a deliberate sim change can make this script produce different inputs.
// The committed replay file is the truth: `npm run test:replay -- --update` re-records its hashes for the
// committed inputs (ROADMAP §5.3). Re-run this script only to change the route, or when a sim change stops the
// committed inputs from meeting their invariants; say which in the commit.
//
// Run: node tests/replay/scripts/build-m3-high-street-replay.ts [--check]
//   (no flag)  write the replay file and print the route summary (steps, tick ranges, events, totals)
//   --check    regenerate in memory and exit 1 if the committed file differs (inputs, hashes or invariants)
// Exit status: 0 ok, 1 check failed or the route missed its goal (nothing is written then), 2 usage.
// Running it twice writes byte-identical files: no wall clock, no Math.random, Node built-ins and src/sim/**
// (through the driver) only, on plain Node 24 type stripping.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { EV } from '../../../src/sim/eventQueue.ts';
import { cos, sin } from '../../../src/sim/fmath.ts';
import { PRESSED } from '../../../src/sim/inputFrame.ts';
import { decodeLevel } from '../../../src/sim/map.ts';
import { type ReplayInvariants, recordReplay, serialiseReplay } from '../../../src/sim/replay.ts';
import { DEFAULT_TUNING } from '../../../src/sim/tuning.ts';
import { driveRoute, formatReports, type Point, type Step } from '../../../tools/replays/routeDriver.ts';

const DISTRICT = 'district.high_street';
/** The issue's smoke seed (SSP-105), not the campaign seed 2001: the street life is seeded either way. */
const SEED = 1;
const TICKS = 3_600;
const LEVEL_PATH = fileURLToPath(new URL('../../../public/assets/levels/high_street.json', import.meta.url));
const OUT_PATH = fileURLToPath(new URL('../replays/m3_high_street.json', import.meta.url));

// ---------------------------------------------------------------------------------------------------------
// High Street geometry (LEVEL_DESIGN §5.2 as built; sim metres, 2 m tiles, y grows south)
// ---------------------------------------------------------------------------------------------------------

/** Bessie's start: `@` at (41, 6), facing south toward the depot gate on row 8. */
const DEPOT_START: Point = [83, 13];
/** Centre lines: Station Road's north arm (rows 9–11), the east and west legs (x 67–69, 10–12), the High Street. */
const NORTH_ARM_Y = 21;
const EAST_LEG_X = 137;
const WEST_LEG_X = 23;
const HIGH_STREET_Y = 56; // rows 26–29

/**
 * Kerb lane: this far left of a street's centre line, 1.0 m from the kerb: 2.0 m on Station Road's 3-tile
 * arms and legs, 3.0 m on the 4-tile High Street.
 */
const STATION_ROAD_KERB_LANE_M = 2.0;
const HIGH_STREET_KERB_LANE_M = 3.0;
/** Under the 4.0 m/s at which every litter item is picked up (GDD §8.3, no fling), as in the M2 replays. */
const SWEEP_MPS = 3.8;
/** Quarter circles between centre lines, as in the M2 replays (Bessie's tightest radius at 2.2 m/s is 4.8 m). */
const CORNER_RADIUS_M = 5.5;
const CORNER_MPS = 2.2;
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

/** The corner at `j` from heading `dirIn` to `dirOut`: a quarter circle between the two centre lines. */
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

/** One street of the route: to this junction centre (or end point), in the kerb lane `kerbLaneM` to the left. */
type Leg = { readonly to: Point; readonly name: string; readonly kerbLaneM: number };

/**
 * Sweep from `start` along `legs`: each leg is one drive step (centre line → kerb lane → centre line before the
 * next corner), each junction between two legs one corner step, and the last leg ends in its kerb lane.
 */
function sweepRoute(start: Point, legs: readonly Leg[]): Step[] {
  const steps: Step[] = [];
  let a = start;
  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i] as Leg;
    const b = leg.to;
    const dir = unit(a, b);
    const next = legs[i + 1];
    const laneFromM = (i > 0 ? CORNER_RADIUS_M : 0) + (leg.kerbLaneM > 0 ? LANE_RAMP_M : 0);
    const path: Point[] = [leftOf(along(a, dir, laneFromM), dir, leg.kerbLaneM)];
    if (next !== undefined) {
      path.push(leftOf(along(b, dir, -(CORNER_RADIUS_M + LANE_RAMP_M)), dir, leg.kerbLaneM));
      path.push(along(b, dir, -CORNER_RADIUS_M));
    } else {
      path.push(leftOf(b, dir, leg.kerbLaneM));
    }
    steps.push({
      kind: 'drive',
      label: leg.name,
      path,
      speedMps: SWEEP_MPS,
      exitMps: next !== undefined ? CORNER_MPS : SWEEP_MPS,
    });
    if (next !== undefined) {
      steps.push({
        kind: 'drive',
        label: `corner into ${next.name}`,
        path: cornerArc(b, dir, unit(b, next.to)),
        speedMps: CORNER_MPS,
        exitMps: CORNER_MPS,
      });
    }
    a = b;
  }
  return steps;
}

/**
 * Out of the depot gate, east along Station Road's north arm (the rollout street, with the flow), south down
 * the east leg (with the flow), right onto the High Street westbound, then (beyond the replay's 60 s) north up
 * the west leg with the flow and back east along the north arm toward the depot.
 */
const ROUTE: readonly Step[] = [
  { kind: 'press', label: 'brush down in the depot', pressed: PRESSED.BRUSH },
  ...sweepRoute(DEPOT_START, [
    { to: [83, NORTH_ARM_Y], name: 'out of the depot gate', kerbLaneM: 0 },
    {
      to: [EAST_LEG_X, NORTH_ARM_Y],
      name: 'Station Road north arm east',
      kerbLaneM: STATION_ROAD_KERB_LANE_M,
    },
    {
      to: [EAST_LEG_X, HIGH_STREET_Y],
      name: 'Station Road east leg south',
      kerbLaneM: STATION_ROAD_KERB_LANE_M,
    },
    { to: [WEST_LEG_X, HIGH_STREET_Y], name: 'High Street west', kerbLaneM: HIGH_STREET_KERB_LANE_M },
    {
      to: [WEST_LEG_X, NORTH_ARM_Y],
      name: 'Station Road west leg north',
      kerbLaneM: STATION_ROAD_KERB_LANE_M,
    },
    { to: [80, NORTH_ARM_Y], name: 'Station Road north arm east again', kerbLaneM: STATION_ROAD_KERB_LANE_M },
  ]),
];

/**
 * Set from the recorded run with headroom (SSP-105): it scored 3,191 (2,081 of it grime), collected 23 items,
 * never lost HP, never touched a solid, drew no complaint and reached the west end of the High Street by tick
 * 3,586, with 55 NPCs and 24 vehicles (moving and parked) out on the street at the end.
 */
const INVARIANTS: ReplayInvariants = {
  minScore: 2000,
  minLitterCollected: 15,
  hpMin: 90,
  maxSolidOverlapM: 0.001,
};

function main(args: readonly string[]): number {
  const unknown = args.filter((a) => a !== '--check');
  if (unknown.length > 0) {
    process.stderr.write('usage: node tests/replay/scripts/build-m3-high-street-replay.ts [--check]\n');
    return 2;
  }
  const check = args.includes('--check');
  const level = decodeLevel(readFileSync(LEVEL_PATH, 'utf8'));
  const drive = driveRoute(level, DEFAULT_TUNING, SEED, ROUTE, TICKS);
  const file = recordReplay(level, DEFAULT_TUNING, DISTRICT, SEED, drive.log, INVARIANTS);
  const w = drive.world;
  const totals: number[] = [];
  for (const r of drive.reports)
    for (let i = 0; i < r.events.length; i++) totals[i] = (totals[i] ?? 0) + (r.events[i] ?? 0);
  const events = Object.entries(EV)
    .filter(([, id]) => (totals[id] ?? 0) > 0)
    .map(([n, id]) => `${n} ${totals[id]}`)
    .join(', ');
  process.stdout.write(formatReports(drive.reports, ['LitterCollected', 'ComboTier']));
  process.stdout.write(
    `m3_high_street: ${file.ticks} ticks, final hash ${file.checkpoints[String(file.ticks)]}\n` +
      `  events: ${events}\n` +
      `  score ${w.scoring.score} (items ${w.scoring.itemPts}, grime ${w.scoring.grimePts}, bonus ` +
      `${w.scoring.bonusPts}, penalty ${w.scoring.penaltyPts}); litter collected ${w.litter.litterCollected} of ` +
      `${w.litter.litterSpawned}; grime cleaned ${w.dirt.cleanedCells}; HP ${w.vehicle.hp.toFixed(2)}; ` +
      `complaints ${w.complaints.count}; NPCs ${w.npc.count}; vehicles ${w.vehicles.count}\n` +
      `  top speed brush down ${drive.maxBrushDownMps.toFixed(3)} m/s\n`,
  );
  const problems: string[] = [];
  if (drive.maxBrushDownMps > 4.0)
    problems.push(`swept at ${drive.maxBrushDownMps.toFixed(3)} m/s, over 4.0 m/s`);
  const highStreet = drive.reports.find((r) => r.label === 'High Street west');
  if (highStreet === undefined || highStreet.startTick >= TICKS)
    problems.push('never reached the High Street');
  for (const p of problems) process.stderr.write(`m3_high_street: route goal missed: ${p}\n`);
  if (problems.length > 0) return 1;
  const text = serialiseReplay(file);
  if (check) {
    let committed = '';
    try {
      committed = readFileSync(OUT_PATH, 'utf8');
    } catch {
      process.stderr.write(`check: ${OUT_PATH} is missing\n`);
      return 1;
    }
    if (committed !== text) {
      process.stderr.write(
        'check: the committed m3_high_street.json differs from what this script generates\n',
      );
      return 1;
    }
    process.stdout.write('check: the committed m3_high_street.json matches the generator\n');
    return 0;
  }
  writeFileSync(OUT_PATH, text);
  process.stdout.write(`wrote ${OUT_PATH}\n`);
  return 0;
}

process.exitCode = main(process.argv.slice(2));
