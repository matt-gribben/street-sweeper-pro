// The replay runner (TECHNICAL_DESIGN §18.3, SSP-038). Run with `npm run test:replay`.
//
// For every tests/replay/replays/*.json it loads the replay (src/sim/replay.ts loadReplay), loads its district's
// compiled level from public/assets/levels/<name>.json (district.<name>) through decodeLevel, runs the input
// log for the replay's ticks on a World with the default tuning, and asserts every checkpoint hash (the last
// one is the final-state hash), the invariants, and the §17 zero-allocation heap check. A built-in synthetic
// replay (tests/replay/synthetic.ts, hand-built level) always runs too, so the project never has zero tests.
//
// `npm run test:replay -- --update` re-records the checkpoint hashes of the committed files (vitest.config.ts
// REPLAY_UPDATE, read here with inject). Only then does the runner write files. Re-recording is for deliberate
// sim changes, explained in the commit; an unexplained hash change is a determinism bug (ROADMAP §5.3).
//
// Node is the canonical replay environment (ROADMAP R-09). The project runs in the forks pool with
// --expose-gc (vitest.config.ts GC_EXPOSED); each heap check itself runs in a fresh `node --expose-gc` child
// (tests/support/replayHeapProcess.ts) so JIT state from the other tests in this file cannot leak into it.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, inject, it } from 'vitest';
import { decodeLevel, type Level } from '../../src/sim/map.ts';
import {
  compareCheckpoints,
  hasCheckpoints,
  inputLogsEqual,
  type LoadedReplay,
  loadReplay,
  type ReplayFile,
  recordReplay,
  runReplay,
  serialiseReplay,
} from '../../src/sim/replay.ts';
import { DEFAULT_TUNING } from '../../src/sim/tuning.ts';
import { assertHeapDeltaWithinThresholds } from '../support/heapDelta.ts';
import {
  createInvariantMonitor,
  eventCountsByName,
  invariantFailures,
  measureReplayHeapInChild,
} from '../support/replayCheck.ts';
import { SYNTHETIC_DISTRICT, SYNTHETIC_SEED, syntheticInputLog, syntheticLevel } from './synthetic.ts';

const UPDATE = inject('replayUpdate');
const REPLAYS_DIR = fileURLToPath(new URL('./replays/', import.meta.url));
const LEVELS_DIR = fileURLToPath(new URL('../../public/assets/levels/', import.meta.url));

/** The heap check starts a Node process and runs ~38,000 ticks plus four forced GCs; allow for a slow CI runner. */
const HEAP_TEST_TIMEOUT_MS = 60_000;

function listReplayFiles(): string[] {
  if (!existsSync(REPLAYS_DIR)) return [];
  return readdirSync(REPLAYS_DIR)
    .filter((name) => name.endsWith('.json'))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** public/assets/levels/<name>.json for district.<name>. */
function levelPathForDistrict(district: string): string {
  return join(LEVELS_DIR, `${district.slice('district.'.length)}.json`);
}

function loadDistrictLevel(district: string): Level {
  const path = levelPathForDistrict(district);
  if (!existsSync(path)) throw new Error(`no compiled level for ${district} at ${path} (run npm run levels)`);
  return decodeLevel(readFileSync(path, 'utf8'));
}

type CheckResult = {
  /** Hash and invariant failures, as readable lines. Empty when the replay passes. */
  readonly failures: string[];
  /** The checkpoints this run produced. */
  readonly checkpoints: ReplayFile['checkpoints'];
  readonly summary: string;
};

/** Run a loaded replay on `level` with the default tuning; compare hashes (unless updating) and invariants. */
function checkReplay(name: string, replay: LoadedReplay, level: Level, update: boolean): CheckResult {
  const { file, log } = replay;
  const monitor = createInvariantMonitor(level, DEFAULT_TUNING);
  const run = runReplay(level, DEFAULT_TUNING, file.seed, log, file.ticks, monitor.observe);
  const failures: string[] = [];
  if (!update) {
    if (!hasCheckpoints(file)) {
      failures.push(
        `${name}: no checkpoint hashes recorded; record them with npm run test:replay -- --update`,
      );
    } else {
      const mismatch = compareCheckpoints(file.checkpoints, run.checkpoints, file.ticks);
      if (mismatch !== null) failures.push(`${name}: hash mismatch, ${mismatch}`);
    }
  }
  for (const failure of invariantFailures(file.invariants, monitor)) failures.push(`${name}: ${failure}`);
  const summary =
    `${name}: ${file.ticks} ticks, final ${run.finalHash}, events ${JSON.stringify(eventCountsByName(monitor))}, ` +
    `min HP ${monitor.minHp}, max solid overlap ${monitor.maxSolidOverlapM.toFixed(4)} m`;
  return { failures, checkpoints: run.checkpoints, summary };
}

const replayFiles = listReplayFiles();

describe('replay corpus', () => {
  it('has a tests/replay/replays directory and reports its replay count and mode', () => {
    expect(existsSync(REPLAYS_DIR), `missing ${REPLAYS_DIR}`).toBe(true);
    expect(statSync(REPLAYS_DIR).isDirectory()).toBe(true);
    expect(typeof UPDATE).toBe('boolean');
    console.log(
      `replays: ${replayFiles.length} file(s) in tests/replay/replays/; ` +
        (UPDATE ? 'UPDATE mode: checkpoint hashes will be re-recorded' : 'check mode (no files are written)'),
    );
  });

  for (const name of replayFiles) {
    describe(name, () => {
      const path = join(REPLAYS_DIR, name);
      const load = (): { replay: LoadedReplay; level: Level } => {
        const replay = loadReplay(readFileSync(path, 'utf8'));
        return { replay, level: loadDistrictLevel(replay.file.district) };
      };

      it('reproduces its checkpoint hashes and holds its invariants', () => {
        const { replay, level } = load();
        const result = checkReplay(name, replay, level, UPDATE);
        console.log(result.summary);
        if (UPDATE) {
          const updated: ReplayFile = { ...replay.file, checkpoints: { ...result.checkpoints } };
          const before = serialiseReplay(replay.file);
          const after = serialiseReplay(updated);
          if (after !== before) {
            writeFileSync(path, after);
            console.log(`${name}: checkpoint hashes re-recorded (explain the sim change in the commit)`);
          } else {
            console.log(`${name}: checkpoint hashes unchanged`);
          }
        }
        expect(result.failures, result.failures.join('\n')).toEqual([]);
      });

      it('allocates nothing per tick (TECHNICAL_DESIGN §17 heap-delta check)', {
        timeout: HEAP_TEST_TIMEOUT_MS,
      }, () => {
        const { replay } = load();
        const delta = measureReplayHeapInChild({
          kind: 'file',
          replayPath: path,
          levelPath: levelPathForDistrict(replay.file.district),
        });
        console.log(`${name}: heap retained ${delta.retainedBytes} B, pre-final-GC ${delta.preGcBytes} B`);
        assertHeapDeltaWithinThresholds(delta);
      });
    });
  }
});

describe('synthetic replay (built in, hand-built level)', () => {
  const level = syntheticLevel();
  const invariants = {
    hpMin: 100,
    maxSolidOverlapM: 0.001,
    minEvents: { KerbJolt: 1, ReverseBeeper: 1 },
  };
  const recorded = recordReplay(
    level,
    DEFAULT_TUNING,
    SYNTHETIC_DISTRICT,
    SYNTHETIC_SEED,
    syntheticInputLog(),
    invariants,
  );
  const reload = (file: ReplayFile): LoadedReplay => loadReplay(serialiseReplay(file));

  it('survives serialise → load with the same inputs, checkpoints and invariants', () => {
    const loaded = reload(recorded);
    expect(loaded.file).toEqual(recorded);
    expect(inputLogsEqual(loaded.log, syntheticInputLog())).toBe(true);
    expect(Object.keys(loaded.file.checkpoints)).toEqual(['600', '1200', '1800', '2400', '3000', '3600']);
  });

  it('passes the runner: hashes reproduce, invariants hold', () => {
    const result = checkReplay('synthetic', reload(recorded), level, false);
    console.log(result.summary);
    expect(result.failures, result.failures.join('\n')).toEqual([]);
  });

  it('gives identical checkpoint and final hashes when run twice in one process', () => {
    const { file, log } = reload(recorded);
    const a = runReplay(level, DEFAULT_TUNING, file.seed, log, file.ticks);
    const b = runReplay(level, DEFAULT_TUNING, file.seed, log, file.ticks);
    expect(a.checkpoints).toEqual(b.checkpoints);
    expect(a.finalHash).toBe(b.finalHash);
    expect(a.finalHash).toBe(file.checkpoints['3600']);
  });

  it('fails on a hash mismatch and names the first diverging checkpoint', () => {
    const tampered: ReplayFile = {
      ...recorded,
      checkpoints: { ...recorded.checkpoints, '1800': '00000000', '3000': 'ffffffff' },
    };
    const result = checkReplay('tampered', reload(tampered), level, false);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toMatch(/^tampered: hash mismatch, first diverging checkpoint at tick 1800 /);
    expect(result.failures[0]).toContain('ticks 1201..1800');
    expect(result.failures[0]).toContain('2 of 6 checkpoints differ');
  });

  it('fails when one input byte of the log changes, from that tick on', () => {
    const log = syntheticInputLog();
    log.steer[2000] = (log.steer[2000] as number) + 1;
    const altered = recordReplay(level, DEFAULT_TUNING, SYNTHETIC_DISTRICT, SYNTHETIC_SEED, log, invariants);
    const withOldHashes: ReplayFile = { ...altered, checkpoints: recorded.checkpoints };
    const result = checkReplay('altered', reload(withOldHashes), level, false);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toContain('first diverging checkpoint at tick 2400');
    expect(result.failures[0]).toContain('3 of 6 checkpoints differ');
  });

  it('fails an invariant the run breaks, and refuses the M2-only keys', () => {
    const strict: ReplayFile = {
      ...recorded,
      invariants: { minEvents: { Impact: 1 }, minScore: 1, minLitterCollected: 20 },
    };
    const result = checkReplay('strict', reload(strict), level, false);
    expect(result.failures).toEqual([
      'strict: invariant minScore is not supported until scoring exists (M2, SSP-065)',
      'strict: invariant minLitterCollected is not supported until litter exists (M2, SSP-065)',
      'strict: minEvents.Impact: 0 event(s) over the replay, expected at least 1',
    ]);
  });

  it('allocates nothing per tick (TECHNICAL_DESIGN §17 heap-delta check)', {
    timeout: HEAP_TEST_TIMEOUT_MS,
  }, () => {
    const delta = measureReplayHeapInChild({ kind: 'synthetic' });
    console.log(`synthetic: heap retained ${delta.retainedBytes} B, pre-final-GC ${delta.preGcBytes} B`);
    assertHeapDeltaWithinThresholds(delta);
  });
});
