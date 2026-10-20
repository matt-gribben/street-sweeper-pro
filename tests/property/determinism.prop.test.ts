// Replay determinism (SSP-107; ROADMAP M3 exit check, TECHNICAL_DESIGN §18.2, §18.3; CLAUDE.md hard rule 12).
//
// For any seed and any random input log, replaying the same log yields the same state hash. Each case draws a
// district (Puddle Lane or the High Street, the two compiled M3 districts with all their street life), a uint32
// seed, a length of 600–1,200 ticks and a log of random InputFrame runs (throttle, brake, steer, held SPRAY and
// INTERACT, BRUSH and HORN edges), then steps two fresh Worlds in lockstep, one tick each in turn: World A on
// the log as generated, World B on the log after the replay file's round trip (encodeInputs → decodeInputs, the
// bytes a committed replay stores). Both are hashed after every tick exactly as runReplay hashes a replay
// (createStateHasher + absorbTick), and the 600-tick checkpoint and the final hash must match. Stepping in
// lockstep, rather than one run after the other, also catches state the two Worlds share by accident (a
// module-level scratch one World writes and the other reads).
//
// At least 100 cases per run (the issue's floor), on a fixed fast-check seed so CI is deterministic; a failure
// prints the seed and path to replay it (tests/support/fcCheck.ts). A second test proves the property is not
// vacuous: changing the seed or one input frame changes the hash.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { BUTTON, createInputFrame, type InputFrame, PRESSED } from '../../src/sim/inputFrame.ts';
import { decodeLevel, type Level } from '../../src/sim/map.ts';
import {
  absorbTick,
  appendInput,
  CHECKPOINT_INTERVAL_TICKS,
  createInputLog,
  createStateHasher,
  decodeInputs,
  encodeInputs,
  hashHex,
  type InputLog,
  readInput,
  stateHash,
} from '../../src/sim/replay.ts';
import { DEFAULT_TUNING } from '../../src/sim/tuning.ts';
import { createWorld } from '../../src/sim/world.ts';
import { assertProperty } from '../support/fcCheck.ts';

const LEVELS_DIR = fileURLToPath(new URL('../../public/assets/levels/', import.meta.url));
const DISTRICTS = ['puddle_lane', 'high_street'] as const;
type District = (typeof DISTRICTS)[number];
const LEVELS: { readonly [d in District]: Level } = {
  puddle_lane: decodeLevel(readFileSync(`${LEVELS_DIR}puddle_lane.json`, 'utf8')),
  high_street: decodeLevel(readFileSync(`${LEVELS_DIR}high_street.json`, 'utf8')),
};

/** The issue's floor: at least 100 cases per CI run. */
const NUM_RUNS = 100;
const MIN_TICKS = 600;
const MAX_TICKS = 1200;

/** One run of identical frames: `pressed` only on its first tick (an edge), the rest held for `ticks`. */
type InputRun = {
  readonly ticks: number;
  readonly throttle: number;
  readonly brake: number;
  readonly steer: number;
  readonly buttons: number;
  readonly pressed: number;
};

/**
 * Runs biased toward driving: half the runs brake not at all, so Bessie gets going and meets kerbs, walls,
 * litter, people and traffic; the rest brake (and, held at a standstill, engage reverse). SPRAY and INTERACT
 * may be held; BRUSH and HORN pressed (MAP and PAUSE never reach the sim, §13.1).
 */
const inputRun: fc.Arbitrary<InputRun> = fc.record({
  ticks: fc.integer({ min: 1, max: 120 }),
  throttle: fc.oneof(fc.constant(0), fc.constant(255), fc.integer({ min: 0, max: 255 })),
  brake: fc.oneof(fc.constant(0), fc.integer({ min: 0, max: 255 })),
  steer: fc.oneof(fc.constant(0), fc.integer({ min: -127, max: 127 })),
  buttons: fc.constantFrom(0, 0, BUTTON.SPRAY, BUTTON.INTERACT, BUTTON.SPRAY | BUTTON.INTERACT),
  pressed: fc.constantFrom(0, 0, PRESSED.BRUSH, PRESSED.HORN, PRESSED.BRUSH | PRESSED.HORN),
});

type Case = {
  readonly district: District;
  readonly seed: number;
  readonly ticks: number;
  readonly runs: readonly InputRun[];
};

const caseArb: fc.Arbitrary<Case> = fc.record({
  district: fc.constantFrom(...DISTRICTS),
  seed: fc.integer({ min: 0, max: 0xffffffff }),
  ticks: fc.integer({ min: MIN_TICKS, max: MAX_TICKS }),
  runs: fc.array(inputRun, { minLength: 1, maxLength: 40 }),
});

/** The input log of `ticks` ticks the runs describe; once they run out, neutral frames. */
function buildLog(runs: readonly InputRun[], ticks: number): InputLog {
  const log = createInputLog(ticks);
  const frame = createInputFrame();
  let t = 0;
  for (const run of runs) {
    for (let k = 0; k < run.ticks && t < ticks; k++, t++) {
      frame.throttle = run.throttle;
      frame.brake = run.brake;
      frame.steer = run.steer;
      frame.buttons = run.buttons;
      frame.pressed = k === 0 ? run.pressed : 0;
      appendInput(log, t, frame);
    }
  }
  const neutral = createInputFrame();
  for (; t < ticks; t++) appendInput(log, t, neutral);
  return log;
}

type LockstepHashes = { readonly a: string[]; readonly b: string[] };

/**
 * Two fresh Worlds on (level, seed), stepped alternately, A on `logA` and B on `logB`, each hashed after every
 * tick as runReplay does; the hashes at every checkpoint interval and at the end.
 */
function runLockstep(
  level: Level,
  seed: number,
  logA: InputLog,
  logB: InputLog,
  ticks: number,
): LockstepHashes {
  const worldA = createWorld(level, seed, DEFAULT_TUNING);
  const worldB = createWorld(level, seed, DEFAULT_TUNING);
  const hasherA = createStateHasher(worldA.seed);
  const hasherB = createStateHasher(worldB.seed);
  const frameA: InputFrame = createInputFrame();
  const frameB: InputFrame = createInputFrame();
  const a: string[] = [];
  const b: string[] = [];
  for (let t = 0; t < ticks; t++) {
    readInput(logA, t, frameA);
    worldA.step(frameA);
    absorbTick(hasherA, worldA);
    readInput(logB, t, frameB);
    worldB.step(frameB);
    absorbTick(hasherB, worldB);
    if ((t + 1) % CHECKPOINT_INTERVAL_TICKS === 0 || t + 1 === ticks) {
      a.push(hashHex(stateHash(hasherA)));
      b.push(hashHex(stateHash(hasherB)));
    }
  }
  return { a, b };
}

describe('replay determinism (SSP-107, TECHNICAL_DESIGN §18.2)', () => {
  it(`replaying the same input log on the same seed yields the same 600-tick and final state hashes (${NUM_RUNS} cases)`, () => {
    let ticksRun = 0;
    const districtsSeen = new Set<District>();
    assertProperty(
      fc.property(caseArb, ({ district, seed, ticks, runs }) => {
        const level = LEVELS[district];
        const log = buildLog(runs, ticks);
        // World B replays the bytes a replay file would store.
        const reloaded = decodeInputs(encodeInputs(log), ticks);
        const { a, b } = runLockstep(level, seed, log, reloaded, ticks);
        ticksRun += ticks;
        districtsSeen.add(district);
        // The 600-tick checkpoint (every case is at least 600 ticks long) and the final hash.
        expect(a[0], `checkpoint 600, ${district} seed ${seed}`).toBe(b[0]);
        expect(a[a.length - 1], `final hash at tick ${ticks}, ${district} seed ${seed}`).toBe(
          b[b.length - 1],
        );
        // Every checkpoint in between too.
        expect(a).toEqual(b);
      }),
      { seed: 107, numRuns: NUM_RUNS },
    );
    expect(ticksRun).toBeGreaterThanOrEqual(NUM_RUNS * MIN_TICKS);
    expect([...districtsSeen].sort()).toEqual([...DISTRICTS].sort());
  }, 120_000);

  it('is not vacuous: another seed, or one changed input frame, changes the hash', () => {
    const level = LEVELS.puddle_lane;
    const runs: InputRun[] = [
      { ticks: 1, throttle: 0, brake: 0, steer: 0, buttons: 0, pressed: PRESSED.BRUSH },
      { ticks: 300, throttle: 255, brake: 0, steer: 0, buttons: 0, pressed: 0 },
      { ticks: 299, throttle: 120, brake: 0, steer: 40, buttons: BUTTON.SPRAY, pressed: PRESSED.HORN },
    ];
    const log = buildLog(runs, MIN_TICKS);
    const same = runLockstep(level, 1001, log, log, MIN_TICKS);
    expect(same.a).toEqual(same.b);
    const otherSeed = runLockstep(level, 1002, log, log, MIN_TICKS);
    expect(otherSeed.a[0]).not.toBe(same.a[0]);
    const changed = buildLog(runs, MIN_TICKS);
    changed.steer[450] = (changed.steer[450] as number) + 1;
    const oneFrame = runLockstep(level, 1001, log, changed, MIN_TICKS);
    expect(oneFrame.a[0]).toBe(same.a[0]);
    expect(oneFrame.b[0]).not.toBe(oneFrame.a[0]);
  });
});
