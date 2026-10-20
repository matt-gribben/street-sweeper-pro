// Replay invariants and the replay heap check (TECHNICAL_DESIGN §17, §18.3, SSP-038). Used by the replay runner
// (tests/replay/replay.test.ts) and its unit tests.
//
// - createInvariantMonitor: a ReplayTickObserver that counts events by type and tracks Bessie's lowest HP and
//   deepest solid overlap, the shift's end and every dump over the whole run; invariantFailures turns those
//   into readable failures.
// - measureReplayHeap: the §17 zero-allocation check on a replay. A "stepper" plays the replay back to back on
//   a row of fresh Worlds (absolute tick k runs replay tick k mod ticks on World ⌊k / ticks⌋), absorbing every
//   tick into the state hash, so every tick follows the replay's real trajectory and runs exactly the code a
//   replay run executes. In the 'start' window measureHeapDelta's 600 warm-up ticks are replay ticks 0–599 and
//   its 3,600 measured ticks are the rest of a 3,600-tick replay plus the start of the next, so each tick of a
//   standard replay runs once inside the window. A longer replay (the M2 replays, SSP-072) is also measured in
//   its 'end' window, its last 4,200 ticks (the stepper first plays the run up to there, outside the
//   measurement), so the knock-off, the shift's end and a late dump are inside a measured window too. Both
//   windows share one pre-warm of at least REPLAY_HEAP_PREWARM_PLAYS plays.
// - measureReplayHeapInChild: runs measureReplayHeap in a fresh `node --expose-gc` process
//   (replayHeapProcess.ts), which is how the runner calls it: JIT state from earlier tests cannot leak in.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { countEvents, EV, type EventType, ShiftEndReason } from '../../src/sim/eventQueue.ts';
import { DumpSite } from '../../src/sim/hopper.ts';
import { createInputFrame } from '../../src/sim/inputFrame.ts';
import type { Level } from '../../src/sim/map.ts';
import {
  absorbTick,
  createStateHasher,
  EVENT_NAMES,
  type InputLog,
  type ReplayInvariants,
  type ReplayTickObserver,
  readInput,
  type StateHasher,
} from '../../src/sim/replay.ts';
import { finalShiftScore, finalShiftStars, isShiftEnded } from '../../src/sim/shift.ts';
import type { Tuning } from '../../src/sim/tuning.ts';
import { createWorld, type World } from '../../src/sim/world.ts';
import { HEAP_MEASURED_TICKS, HEAP_WARMUP_TICKS, type HeapDelta, measureHeapDelta } from './heapDelta.ts';
import { solidOverlapM } from './solidOverlap.ts';

const EVENT_TYPE_COUNT = Math.max(...Object.values(EV)) + 1;

/** What a replay run measured for its invariants. */
export type InvariantMonitor = {
  /** Call after every tick (pass as runReplay's observer). */
  readonly observe: ReplayTickObserver;
  /** Events seen over the run, indexed by EV id. */
  readonly eventCounts: Float64Array;
  /** Ticks observed. */
  ticks: number;
  /** Lowest vehicle HP at the end of any tick. */
  minHp: number;
  /** Deepest overlap (m) of Bessie's body with a solid rect or the map boundary at the end of any tick. */
  maxSolidOverlapM: number;
  /** The tick (1-based count) where maxSolidOverlapM was seen, or 0. */
  maxSolidOverlapTick: number;
  /** The score and the litter collected at the end of the last observed tick (SSP-065). */
  finalScore: number;
  finalLitterCollected: number;
  /** EV.ShiftEnd events seen, and the reason and tick (1-based count) of the first, or 0 (SSP-072). */
  shiftEnds: number;
  shiftEndReason: number;
  shiftEndTick: number;
  /** LU dumped (hopper.luDumpedTotal) at the end of the last observed tick (SSP-072). */
  finalLuDumped: number;
  /**
   * At the end of the last observed tick (SSP-107): whether the shift has ended, the tally's score
   * (finalShiftScore of the score) and stars (finalShiftStars of tidy.ts's would-be stars).
   */
  finalShiftEnded: boolean;
  finalTallyScore: number;
  finalTallyStars: number;
  /** EV.DumpEnd events with c = 1 (the drain ran to the end) (SSP-072). */
  dumpsCompleted: number;
  /** One line per completed dump that left LU in the hopper or, at a depot bay, the tank short (SSP-072). */
  readonly dumpProblems: string[];
};

export function createInvariantMonitor(level: Level, tuning: Tuning): InvariantMonitor {
  const body = tuning.vehicle.sweeper.body;
  const box = { xM: 0, yM: 0, headingRad: 0, widthM: body.widthM, lengthM: body.lengthM };
  const monitor: InvariantMonitor = {
    observe: (world: World) => {
      monitor.ticks += 1;
      for (let type = 1; type < EVENT_TYPE_COUNT; type++) {
        monitor.eventCounts[type] =
          (monitor.eventCounts[type] ?? 0) + countEvents(world.events, type as EventType);
      }
      const v = world.vehicle;
      if (v.hp < monitor.minHp) monitor.minHp = v.hp;
      monitor.finalScore = world.scoring.score;
      monitor.finalLitterCollected = world.litter.litterCollected;
      monitor.finalLuDumped = world.hopper.luDumpedTotal;
      monitor.finalShiftEnded = isShiftEnded(world.shift);
      monitor.finalTallyScore = finalShiftScore(world.shift, world.scoring.score);
      monitor.finalTallyStars = finalShiftStars(world.shift, world.tidy.stars);
      const events = world.events;
      for (let i = 0; i < events.count; i++) {
        const type = events.type[i];
        if (type === EV.ShiftEnd) {
          if (monitor.shiftEnds === 0) {
            monitor.shiftEndReason = events.a[i] as number;
            monitor.shiftEndTick = world.tick;
          }
          monitor.shiftEnds += 1;
        } else if (type === EV.DumpEnd && events.c[i] === 1) {
          monitor.dumpsCompleted += 1;
          const depot = events.a[i] === DumpSite.Depot;
          const tank = world.water.tuning.tankUnits;
          if (v.hopperLU !== 0 || (depot && v.water !== tank)) {
            monitor.dumpProblems.push(
              `the ${depot ? 'depot' : 'skip'} dump completed at tick ${world.tick} left ${v.hopperLU} LU in the ` +
                `hopper${depot ? ` and the tank at ${v.water} of ${tank}` : ''}`,
            );
          }
        }
      }
      box.xM = v.xM;
      box.yM = v.yM;
      box.headingRad = v.headingRad;
      const overlap = solidOverlapM(level, box);
      if (overlap > monitor.maxSolidOverlapM) {
        monitor.maxSolidOverlapM = overlap;
        monitor.maxSolidOverlapTick = world.tick;
      }
    },
    eventCounts: new Float64Array(EVENT_TYPE_COUNT),
    ticks: 0,
    minHp: Number.POSITIVE_INFINITY,
    maxSolidOverlapM: 0,
    maxSolidOverlapTick: 0,
    finalScore: 0,
    finalLitterCollected: 0,
    shiftEnds: 0,
    shiftEndReason: 0,
    shiftEndTick: 0,
    finalLuDumped: 0,
    finalShiftEnded: false,
    finalTallyScore: 0,
    finalTallyStars: 0,
    dumpsCompleted: 0,
    dumpProblems: [],
  };
  return monitor;
}

/** Event counts by EV name, for logs and failure messages. */
export function eventCountsByName(monitor: InvariantMonitor): { [name: string]: number } {
  const out: { [name: string]: number } = {};
  for (const name of EVENT_NAMES) out[name] = monitor.eventCounts[EV[name]] ?? 0;
  return out;
}

/**
 * Every invariant the run broke, as readable lines; empty when all hold. minScore and minLitterCollected are
 * the score and the litter collected at the end of the replay (SSP-065).
 */
export function invariantFailures(invariants: ReplayInvariants, monitor: InvariantMonitor): string[] {
  const failures: string[] = [];
  if (invariants.minScore !== undefined && !(monitor.finalScore >= invariants.minScore)) {
    failures.push(
      `minScore: the replay ended on ${monitor.finalScore} points, expected at least ${invariants.minScore}`,
    );
  }
  if (
    invariants.minLitterCollected !== undefined &&
    !(monitor.finalLitterCollected >= invariants.minLitterCollected)
  ) {
    failures.push(
      `minLitterCollected: ${monitor.finalLitterCollected} item(s) collected over the replay, expected at least ` +
        `${invariants.minLitterCollected}`,
    );
  }
  if (invariants.hpMin !== undefined && !(monitor.minHp >= invariants.hpMin)) {
    failures.push(`hpMin: HP fell to ${monitor.minHp}, below ${invariants.hpMin}`);
  }
  if (invariants.maxSolidOverlapM !== undefined && monitor.maxSolidOverlapM > invariants.maxSolidOverlapM) {
    failures.push(
      `maxSolidOverlapM: Bessie overlapped solid geometry by ${monitor.maxSolidOverlapM.toFixed(4)} m at tick ` +
        `${monitor.maxSolidOverlapTick} (limit ${invariants.maxSolidOverlapM} m)`,
    );
  }
  if (invariants.shiftEnded !== undefined) {
    const want = invariants.shiftEnded;
    if (monitor.shiftEnds === 0) {
      failures.push(`shiftEnded: the shift never ended (no ShiftEnd event), expected ${want}`);
    } else if (monitor.shiftEnds > 1) {
      failures.push(`shiftEnded: ${monitor.shiftEnds} ShiftEnd events, expected exactly one (${want})`);
    } else if (monitor.shiftEndReason !== ShiftEndReason[want]) {
      failures.push(
        `shiftEnded: the shift ended at tick ${monitor.shiftEndTick} with ${shiftEndReasonName(monitor.shiftEndReason)}, ` +
          `expected ${want}`,
      );
    }
  }
  if (invariants.minLuDumped !== undefined && !(monitor.finalLuDumped >= invariants.minLuDumped)) {
    failures.push(
      `minLuDumped: ${monitor.finalLuDumped} LU dumped over the replay, expected at least ${invariants.minLuDumped}`,
    );
  }
  if (invariants.minDumpsCompleted !== undefined && monitor.dumpsCompleted < invariants.minDumpsCompleted) {
    failures.push(
      `minDumpsCompleted: ${monitor.dumpsCompleted} dump(s) completed over the replay, expected at least ` +
        `${invariants.minDumpsCompleted}`,
    );
  }
  if (invariants.emptyAfterDump === true) {
    for (const problem of monitor.dumpProblems) failures.push(`emptyAfterDump: ${problem}`);
  }
  if (invariants.shiftEndTick !== undefined) {
    const want = invariants.shiftEndTick;
    if (monitor.shiftEnds === 0) {
      failures.push(`shiftEndTick: the shift never ended (no ShiftEnd event), expected it at tick ${want}`);
    } else if (monitor.shiftEndTick !== want) {
      failures.push(`shiftEndTick: the shift ended at tick ${monitor.shiftEndTick}, expected tick ${want}`);
    }
  }
  if (invariants.tallyScoreKeep !== undefined) {
    const keep = invariants.tallyScoreKeep;
    const want = Math.floor(keep * monitor.finalScore);
    if (!monitor.finalShiftEnded) {
      failures.push('tallyScoreKeep: the shift has not ended, so there is no tally score');
    } else if (monitor.finalTallyScore !== want) {
      failures.push(
        `tallyScoreKeep: the tally shows ${monitor.finalTallyScore} of a ${monitor.finalScore} score, expected ` +
          `floor(${keep} × ${monitor.finalScore}) = ${want}`,
      );
    }
  }
  if (invariants.tallyStars !== undefined) {
    if (!monitor.finalShiftEnded) {
      failures.push('tallyStars: the shift has not ended, so there are no tally stars');
    } else if (monitor.finalTallyStars !== invariants.tallyStars) {
      failures.push(
        `tallyStars: the tally awards ${monitor.finalTallyStars} star(s), expected ${invariants.tallyStars}`,
      );
    }
  }
  const minEvents = invariants.minEvents ?? {};
  for (const name of EVENT_NAMES) {
    const min = minEvents[name];
    if (min === undefined) continue;
    const seen = monitor.eventCounts[EV[name]] ?? 0;
    if (seen < min)
      failures.push(`minEvents.${name}: ${seen} event(s) over the replay, expected at least ${min}`);
  }
  return failures;
}

function shiftEndReasonName(reason: number): string {
  for (const [name, value] of Object.entries(ShiftEndReason)) if (value === reason) return name;
  return `reason ${reason}`;
}

/**
 * Ticks of replay playback before the measured window, so V8 has optimised the whole tick (§17, SSP-035).
 * 150,000 since SSP-065: with the M2 phases in the tick, the rarely run paths (the brush only collects on part
 * of a route, static contacts near lamp posts) were still tiering up after 30,000 ticks, and
 * m1_drive_puddle_lane read 37 KB pre-final-GC; after 90,000 ticks 25 KB, and from 120,000 on 12.5–12.8 KB.
 */
export const REPLAY_HEAP_PREWARM_TICKS = 150_000;

/**
 * At least this many whole plays of the replay before the measured windows (SSP-072). A rare path (a litter
 * pickup, a dump) runs a few times per play and V8 tiers a function up by its own call count, so a long
 * replay, or one that collects little, gets too few runs of it in REPLAY_HEAP_PREWARM_TICKS and compiles it
 * inside the window: the 14,600-tick m2_full_shift_puddle_lane read 42 KB pre-final-GC after 150,000 ticks (10
 * plays), 11.6 KB after 300,000 and 3.7 KB after 438,000 (30 plays); m2_dump_cycle_puddle_lane (7,200 ticks,
 * 17 pickups a play) read 24–28 KB after 150,000–216,000 ticks, with collectLitter, removeLitter and
 * addComboPickup reaching Maglev for the first time inside the window (--trace-opt; a sampling heap profile of
 * the same window shows no allocation in World.step), 15 KB after 432,000 (60 plays) and 8.7 KB after 900,000.
 * 150,000 ticks are 41 plays of a 3,600-tick replay; 60 plays are 216,000.
 */
export const REPLAY_HEAP_PREWARM_PLAYS = 60;

/** The pre-warm for a replay of `ticks` ticks: REPLAY_HEAP_PREWARM_TICKS, or REPLAY_HEAP_PREWARM_PLAYS plays. */
export function replayHeapPrewarmTicks(ticks: number): number {
  return Math.max(REPLAY_HEAP_PREWARM_TICKS, REPLAY_HEAP_PREWARM_PLAYS * ticks);
}

/** Ticks in one measured window: measureHeapDelta's warm-up plus its measured ticks (4,200). */
export const REPLAY_HEAP_WINDOW_TICKS = HEAP_WARMUP_TICKS + HEAP_MEASURED_TICKS;

/**
 * Which part of the replay a measured window covers: 'start' from replay tick 0, 'end' its last
 * REPLAY_HEAP_WINDOW_TICKS ticks.
 */
export type ReplayHeapWindow = 'start' | 'end';

/** The windows a replay of `ticks` ticks is measured over: 'start', plus 'end' when it is longer than one. */
export function replayHeapWindows(ticks: number): ReplayHeapWindow[] {
  return ticks > REPLAY_HEAP_WINDOW_TICKS ? ['start', 'end'] : ['start'];
}

/** The replay tick a window's first (warm-up) tick runs. */
export function replayHeapWindowStartTick(ticks: number, window: ReplayHeapWindow): number {
  return window === 'start' ? 0 : Math.max(0, ticks - REPLAY_HEAP_WINDOW_TICKS);
}

type ReplayStepper = (tick: number) => void;

/**
 * Run `step` for ticks from..to−1. The pre-warm and every pass's run-up to its window go through this one loop,
 * so it is optimised long before a window: a run-up loop first used after the pre-warm (the end window's)
 * put 13–16 KB retained and ~25 KB pre-final-GC into the next measurement.
 */
function playTicks(step: ReplayStepper, from: number, to: number): void {
  for (let tick = from; tick < to; tick++) step(tick);
}

/**
 * A step function that plays `log` back to back on fresh Worlds: absolute tick k runs replay tick
 * (k + offset) mod ticks on World ⌊(k + offset) / ticks⌋, for k from −offset to totalTicks − offset − 1 (the
 * caller runs the negative ticks first, to bring the first World to replay tick `offset`). Branch-free,
 * so its type feedback is complete after the pre-warm and nothing is re-optimised inside the measured window
 * (a branch that first runs there, e.g. "switch to the measured World at tick 600", deoptimised the step on its
 * first use and put ~60 KB of compilation into the window). Every stepper comes from this one closure literal,
 * so they share their feedback.
 */
function createReplayStepper(
  level: Level,
  tuning: Tuning,
  seed: number,
  log: InputLog,
  ticks: number,
  totalTicks: number,
  offset: number,
): ReplayStepper {
  const runs = Math.ceil(totalTicks / ticks);
  const worlds: World[] = [];
  const hashers: StateHasher[] = [];
  for (let i = 0; i < runs; i++) {
    const world = createWorld(level, seed, tuning);
    worlds.push(world);
    hashers.push(createStateHasher(world.seed));
  }
  const frame = createInputFrame();
  return (tick) => {
    const k = tick + offset;
    const run = (k / ticks) | 0;
    const world = worlds[run] as World;
    readInput(log, k - run * ticks, frame);
    world.step(frame);
    absorbTick(hashers[run] as StateHasher, world);
  };
}

/** One measured window and its heap deltas. */
export type ReplayHeapResult = { readonly window: ReplayHeapWindow; readonly delta: HeapDelta };

/**
 * The §17 heap-delta check on a replay (see the file comment): one pre-warm, then each window in turn.
 * Returns both deltas per window; the caller asserts them with assertHeapDeltaWithinThresholds.
 */
export function measureReplayHeap(
  level: Level,
  tuning: Tuning,
  seed: number,
  log: InputLog,
  ticks: number,
  prewarmTicks: number = replayHeapPrewarmTicks(ticks),
  windows: readonly ReplayHeapWindow[] = replayHeapWindows(ticks),
): ReplayHeapResult[] {
  // Every World (pre-warm and every measured pass) is created before the first tick. Creating one after the
  // pre-warm hands createWorld a VehicleState whose map the run has since generalised (Smi → double fields), so
  // World.vehicle's field type changes and every optimised function that reads it is deoptimised; the tick then
  // re-tiers through Maglev inside the measured window, which allocates (SSP-036 integration: ~120 KB
  // pre-final-GC once phase 3 made the tick big enough that TurboFan did not come back in time).
  const prewarm = createReplayStepper(level, tuning, seed, log, ticks, prewarmTicks, 0);
  const plan = windows.map((window) => {
    const offset = replayHeapWindowStartTick(ticks, window);
    const total = offset + REPLAY_HEAP_WINDOW_TICKS;
    const passes = [0, 1, 2].map(() => createReplayStepper(level, tuning, seed, log, ticks, total, offset));
    return { window, offset, passes };
  });
  playTicks(prewarm, 0, prewarmTicks);
  // Three passes of each measurement; only the last counts. The first measureHeapDelta call in a process reads
  // one-off noise from V8 compiling the harness itself inside the window (measured under Vitest: ~100 KB
  // pre-final-GC for a no-op step), and with two windows the harness was still tiering up through the third
  // and fourth calls: the second window read 12–16 KB retained and 17–25 KB pre-final-GC with two passes, and
  // 32 B / 0.3–3.2 KB with three (SSP-072). Each pass first plays its World up to the window, unmeasured.
  const results: ReplayHeapResult[] = [];
  for (const { window, offset, passes } of plan) {
    let delta: HeapDelta | null = null;
    for (const step of passes) {
      playTicks(step, -offset, 0);
      delta = measureHeapDelta(step, { warmupTicks: HEAP_WARMUP_TICKS, ticks: HEAP_MEASURED_TICKS });
    }
    results.push({ window, delta: delta as HeapDelta });
  }
  return results;
}

const HEAP_PROCESS_SCRIPT = fileURLToPath(new URL('./replayHeapProcess.ts', import.meta.url));

/** Which replay the child process measures: a committed file and its level, or the built-in synthetic one. */
export type ReplayHeapTarget =
  | { readonly kind: 'file'; readonly replayPath: string; readonly levelPath: string }
  | { readonly kind: 'synthetic' };

function isHeapDelta(value: unknown): value is HeapDelta {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return ['warmupTicks', 'ticks', 'retainedBytes', 'preGcBytes'].every((k) => typeof v[k] === 'number');
}

function isReplayHeapResults(value: unknown): value is ReplayHeapResult[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((r: unknown) => {
      if (typeof r !== 'object' || r === null) return false;
      const v = r as Record<string, unknown>;
      return (v.window === 'start' || v.window === 'end') && isHeapDelta(v.delta);
    })
  );
}

/**
 * measureReplayHeap in a fresh `node --expose-gc` process (replayHeapProcess.ts), over every window of the
 * replay. Throws with the child's stderr if it fails. The parent's own --expose-gc (vitest.config.ts
 * GC_EXPOSED) is not needed for this path.
 */
export function measureReplayHeapInChild(target: ReplayHeapTarget): ReplayHeapResult[] {
  const args =
    target.kind === 'synthetic'
      ? ['--synthetic']
      : ['--replay', target.replayPath, '--level', target.levelPath];
  const child = spawnSync(process.execPath, ['--expose-gc', HEAP_PROCESS_SCRIPT, ...args], {
    encoding: 'utf8',
    timeout: 120_000,
  });
  if (child.error !== undefined) throw child.error;
  if (child.status !== 0) {
    throw new Error(`replay heap process exited with ${child.status ?? child.signal}:\n${child.stderr}`);
  }
  const parsed: unknown = JSON.parse(child.stdout.trim().split('\n').at(-1) ?? '');
  if (!isReplayHeapResults(parsed))
    throw new Error(`replay heap process printed no heap results: ${child.stdout}`);
  return parsed;
}
