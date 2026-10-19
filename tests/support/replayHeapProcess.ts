// Child-process entry point for the replay heap check (TECHNICAL_DESIGN §17, SSP-038). Run by
// measureReplayHeapInChild (replayCheck.ts) as `node --expose-gc tests/support/replayHeapProcess.ts <args>`, on
// Node's type stripping (no Vitest transform), and prints the HeapDelta as one JSON line on stdout.
//
// Why a fresh process per replay: V8's optimisation state is per process. A test worker that has already run
// other levels and replays carries polymorphic feedback and deoptimisation history into the measured window;
// measured in one Vitest worker, a hand-built level checked after a decoded one ran partly unoptimised and
// "allocated" 5 MB over 3,600 ticks. A fresh process measures only the replay's own tick.
//
//   --replay <replay.json> --level <compiled level.json>   a replay file and its district's compiled level
//   --synthetic                                            the built-in synthetic replay (tests/replay/synthetic.ts)
import { readFileSync } from 'node:fs';
import { decodeLevel, type Level } from '../../src/sim/map.ts';
import { type InputLog, loadReplay, REPLAY_TICKS } from '../../src/sim/replay.ts';
import { DEFAULT_TUNING } from '../../src/sim/tuning.ts';
import { SYNTHETIC_SEED, syntheticInputLog, syntheticLevel } from '../replay/synthetic.ts';
import { measureReplayHeap } from './replayCheck.ts';

function argAfter(args: readonly string[], flag: string): string {
  const i = args.indexOf(flag);
  const value = i >= 0 ? args[i + 1] : undefined;
  if (value === undefined) throw new Error(`replayHeapProcess: missing ${flag} <path>`);
  return value;
}

const args = process.argv.slice(2);
let level: Level;
let seed: number;
let log: InputLog;
let ticks: number;
if (args.includes('--synthetic')) {
  level = syntheticLevel();
  seed = SYNTHETIC_SEED;
  log = syntheticInputLog();
  ticks = REPLAY_TICKS;
} else {
  const replay = loadReplay(readFileSync(argAfter(args, '--replay'), 'utf8'));
  level = decodeLevel(readFileSync(argAfter(args, '--level'), 'utf8'));
  seed = replay.file.seed;
  log = replay.log;
  ticks = replay.file.ticks;
}
const delta = measureReplayHeap(level, DEFAULT_TUNING, seed, log, ticks);
process.stdout.write(`${JSON.stringify(delta)}\n`);
