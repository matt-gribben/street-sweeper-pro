// Replay invariants and the replay heap check (TECHNICAL_DESIGN §17, §18.3, SSP-038). Used by the replay runner
// (tests/replay/replay.test.ts) and its unit tests.
//
// - createInvariantMonitor: a ReplayTickObserver that counts events by type and tracks Bessie's lowest HP and
//   deepest solid overlap over the whole run; invariantFailures turns those into readable failures.
// - measureReplayHeap: the §17 zero-allocation check on a replay. A "stepper" plays the replay back to back on
//   a row of fresh Worlds (absolute tick k runs replay tick k mod ticks on World ⌊k / ticks⌋), absorbing every
//   tick into the state hash, so every tick follows the replay's real trajectory and runs exactly the code a
//   replay run executes. measureHeapDelta's 600 warm-up ticks are replay ticks 0–599 and its 3,600 measured
//   ticks are the rest of that run plus the start of the next, so each replay tick runs once inside the window.
// - measureReplayHeapInChild: runs measureReplayHeap in a fresh `node --expose-gc` process
//   (replayHeapProcess.ts), which is how the runner calls it: JIT state from earlier tests cannot leak in.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { countEvents, EV, type EventType } from '../../src/sim/eventQueue.ts';
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

/**
 * Ticks of replay playback before the measured window, so V8 has optimised the whole tick (§17, SSP-035).
 * 150,000 since SSP-065: with the M2 phases in the tick, the rarely run paths (the brush only collects on part
 * of a route, static contacts near lamp posts) were still tiering up after 30,000 ticks, and
 * m1_drive_puddle_lane read 37 KB pre-final-GC; after 90,000 ticks 25 KB, and from 120,000 on 12.5–12.8 KB.
 */
export const REPLAY_HEAP_PREWARM_TICKS = 150_000;

type ReplayStepper = (tick: number) => void;

/**
 * A step function that plays `log` back to back on fresh Worlds for absolute ticks 0..totalTicks−1. Branch-free,
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
    const run = (tick / ticks) | 0;
    const world = worlds[run] as World;
    readInput(log, tick - run * ticks, frame);
    world.step(frame);
    absorbTick(hashers[run] as StateHasher, world);
  };
}

/**
 * The §17 heap-delta check on a replay (see the file comment). Returns both deltas; the caller asserts them
 * with assertHeapDeltaWithinThresholds.
 */
export function measureReplayHeap(
  level: Level,
  tuning: Tuning,
  seed: number,
  log: InputLog,
  ticks: number,
  prewarmTicks: number = REPLAY_HEAP_PREWARM_TICKS,
): HeapDelta {
  // Every World (pre-warm and both measured passes) is created before the first tick. Creating one after the
  // pre-warm hands createWorld a VehicleState whose map the run has since generalised (Smi → double fields), so
  // World.vehicle's field type changes and every optimised function that reads it is deoptimised; the tick then
  // re-tiers through Maglev inside the measured window, which allocates (SSP-036 integration: ~120 KB
  // pre-final-GC once phase 3 made the tick big enough that TurboFan did not come back in time).
  const windowTicks = HEAP_WARMUP_TICKS + HEAP_MEASURED_TICKS;
  const prewarm = createReplayStepper(level, tuning, seed, log, ticks, prewarmTicks);
  const passes = [0, 1].map(() => createReplayStepper(level, tuning, seed, log, ticks, windowTicks));
  for (let tick = 0; tick < prewarmTicks; tick++) prewarm(tick);
  // Two passes of the same measurement; the first is discarded. The first measureHeapDelta call in a process
  // reads one-off noise from V8 compiling the harness itself inside the window (measured under Vitest: ~100 KB
  // pre-final-GC for a no-op step).
  let delta: HeapDelta | null = null;
  for (const step of passes) {
    delta = measureHeapDelta(step, { warmupTicks: HEAP_WARMUP_TICKS, ticks: HEAP_MEASURED_TICKS });
  }
  return delta as HeapDelta;
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

/**
 * measureReplayHeap in a fresh `node --expose-gc` process (replayHeapProcess.ts). Throws with the child's stderr
 * if it fails. The parent's own --expose-gc (vitest.config.ts GC_EXPOSED) is not needed for this path.
 */
export function measureReplayHeapInChild(target: ReplayHeapTarget): HeapDelta {
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
  if (!isHeapDelta(parsed)) throw new Error(`replay heap process printed no HeapDelta: ${child.stdout}`);
  return parsed;
}
