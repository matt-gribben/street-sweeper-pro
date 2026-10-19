// Replay format, input log and quantised state hash (src/sim/replay.ts; TECHNICAL_DESIGN §18.3, SSP-038), plus
// the runner's invariant geometry (tests/support/solidOverlap.ts, replayCheck.ts).
import { describe, expect, it } from 'vitest';
import { encodeBase64 } from '../../src/sim/base64.ts';
import { EV, pushEvent } from '../../src/sim/eventQueue.ts';
import { BRAKE_MAX, createInputFrame, PRESSED, STEER_MAX, THROTTLE_MAX } from '../../src/sim/inputFrame.ts';
import { createBlankLevel } from '../../src/sim/map.ts';
import {
  absorbTick,
  appendInput,
  attachInputLog,
  CHECKPOINT_INTERVAL_TICKS,
  checkpointTicks,
  clearInputLog,
  compareCheckpoints,
  createInputLog,
  createStateHasher,
  decodeInputBytes,
  decodeInputs,
  encodeInputBytes,
  encodeInputs,
  fnv1a32Bytes,
  fnv1a32Int32s,
  hashHex,
  type InputLog,
  inputLogsEqual,
  loadReplay,
  quantise,
  REPLAY_TICKS,
  type ReplayFile,
  readInput,
  recordReplay,
  runReplay,
  serialiseReplay,
  stateHash,
} from '../../src/sim/replay.ts';
import { nextInt, sfc32 } from '../../src/sim/rng.ts';
import { DEFAULT_TUNING } from '../../src/sim/tuning.ts';
import type { VehicleState } from '../../src/sim/vehicle.ts';
import { createWorld, type World } from '../../src/sim/world.ts';
import { syntheticInputLog, syntheticLevel } from '../replay/synthetic.ts';
import { createInvariantMonitor, invariantFailures } from '../support/replayCheck.ts';
import { obbBoundaryPenetrationM, obbRectPenetrationM, solidOverlapM } from '../support/solidOverlap.ts';

/**
 * A random 3,600-tick log: piecewise-constant controls held 1–90 ticks (so single-tick changes occur), the
 * full value ranges, one-tick pressed edges, and occasional large bitfields to exercise multi-byte varints.
 */
function randomLog(seed: number, ticks: number): InputLog {
  const rng = sfc32(seed);
  const log = createInputLog(ticks);
  const frame = createInputFrame();
  let hold = 0;
  for (let t = 0; t < ticks; t++) {
    if (hold === 0) {
      frame.throttle = nextInt(rng, THROTTLE_MAX + 1);
      frame.brake = nextInt(rng, 4) === 0 ? BRAKE_MAX : nextInt(rng, BRAKE_MAX + 1);
      frame.steer = nextInt(rng, 2 * STEER_MAX + 1) - STEER_MAX;
      frame.buttons = nextInt(rng, 20) === 0 ? 0x7fffffff - nextInt(rng, 1000) : nextInt(rng, 4);
      hold = 1 + nextInt(rng, 90);
    }
    frame.pressed = nextInt(rng, 25) === 0 ? 1 + nextInt(rng, 15) : 0;
    appendInput(log, t, frame);
    hold -= 1;
  }
  return log;
}

function logOf(frames: readonly (readonly [number, number, number, number, number])[]): InputLog {
  const log = createInputLog(frames.length);
  frames.forEach(([throttle, brake, steer, buttons, pressed], t) => {
    appendInput(log, t, { throttle, brake, steer, buttons, pressed });
  });
  return log;
}

describe('input log', () => {
  it('appends frames in tick order and reads them back', () => {
    const log = createInputLog(3);
    appendInput(log, 0, { throttle: 1, brake: 2, steer: -3, buttons: 4, pressed: 5 });
    appendInput(log, 1, { throttle: 255, brake: 255, steer: 127, buttons: 0, pressed: 0 });
    const out = createInputFrame();
    readInput(log, 0, out);
    expect(out).toEqual({ throttle: 1, brake: 2, steer: -3, buttons: 4, pressed: 5 });
    readInput(log, 1, out);
    expect(out).toEqual({ throttle: 255, brake: 255, steer: 127, buttons: 0, pressed: 0 });
    expect(log.length).toBe(2);
    clearInputLog(log);
    expect(log.length).toBe(0);
  });

  it('rejects a gap, a full log and values outside the InputFrame contract', () => {
    const ok = { throttle: 0, brake: 0, steer: 0, buttons: 0, pressed: 0 };
    const log = createInputLog(1);
    expect(() => appendInput(log, 1, ok)).toThrow(/expected tick 0 but got tick 1/);
    appendInput(log, 0, ok);
    expect(() => appendInput(log, 1, ok)).toThrow(/input log is full/);
    const fresh = (): InputLog => createInputLog(1);
    expect(() => appendInput(fresh(), 0, { ...ok, throttle: 256 })).toThrow(/throttle = 256/);
    expect(() => appendInput(fresh(), 0, { ...ok, brake: -1 })).toThrow(/brake = -1/);
    expect(() => appendInput(fresh(), 0, { ...ok, steer: -128 })).toThrow(/steer = -128/);
    expect(() => appendInput(fresh(), 0, { ...ok, steer: 0.5 })).toThrow(/steer = 0.5/);
    expect(() => appendInput(fresh(), 0, { ...ok, buttons: -1 })).toThrow(/buttons/);
    expect(() => appendInput(fresh(), 0, { ...ok, pressed: Number.NaN })).toThrow(/pressed/);
    expect(() => createInputLog(-1)).toThrow(/capacity/);
  });

  it("records exactly what the World's phase 1 saw through attachInputLog", () => {
    const level = syntheticLevel();
    const world = createWorld(level, 1, DEFAULT_TUNING);
    const recorded = createInputLog(REPLAY_TICKS);
    attachInputLog(world, recorded);
    const script = syntheticInputLog();
    const frame = createInputFrame();
    for (let t = 0; t < REPLAY_TICKS; t++) {
      readInput(script, t, frame);
      world.step(frame);
    }
    expect(recorded.length).toBe(REPLAY_TICKS);
    expect(inputLogsEqual(recorded, script)).toBe(true);
    expect(() => attachInputLog(world, createInputLog(1))).toThrow(/at shift start/);
  });
});

describe('RLE + base64 encoding', () => {
  it('reproduces a random 3,600-tick input log exactly (encode → decode → encode)', () => {
    for (const seed of [1, 2, 0xdecade]) {
      const log = randomLog(seed, REPLAY_TICKS);
      const text = encodeInputs(log);
      const decoded = decodeInputs(text, REPLAY_TICKS);
      expect(decoded.length).toBe(REPLAY_TICKS);
      expect(inputLogsEqual(decoded, log)).toBe(true);
      expect(Array.from(decoded.steer)).toEqual(Array.from(log.steer));
      expect(encodeInputs(decoded)).toBe(text);
    }
  });

  it('stores only changes: a neutral log is empty, a held frame is one entry', () => {
    expect(encodeInputs(createInputLogOfNeutral(600))).toBe('');
    expect(inputLogsEqual(decodeInputs('', 600), createInputLogOfNeutral(600))).toBe(true);
    const held = logOf([
      [0, 0, 0, 0, 0],
      [200, 0, -5, 1, 0],
      [200, 0, -5, 1, 0],
      [200, 0, -5, 1, PRESSED.BRUSH],
      [200, 0, -5, 1, 0],
    ]);
    // [tickDelta, throttle, brake, steer (int8), buttons, pressed] per change.
    expect(Array.from(encodeInputBytes(held))).toEqual([
      1, 200, 0, 251, 1, 0, 2, 200, 0, 251, 1, 1, 1, 200, 0, 251, 1, 0,
    ]);
    expect(inputLogsEqual(decodeInputBytes(encodeInputBytes(held), 5), held)).toBe(true);
    // A change on tick 0 has tickDelta 0.
    expect(Array.from(encodeInputBytes(logOf([[1, 0, 0, 0, 0]])))).toEqual([0, 1, 0, 0, 0, 0]);
  });

  it('is strict when decoding', () => {
    const bytes = (b: number[]): string => encodeBase64(Uint8Array.from(b));
    expect(() => decodeInputs(bytes([0, 1, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0]), 10)).toThrow(/tickDelta 0/);
    expect(() => decodeInputs(bytes([10, 1, 0, 0, 0, 0]), 10)).toThrow(/past the replay's 10 ticks/);
    expect(() => decodeInputs(bytes([0, 1, 0]), 10)).toThrow(/middle of an entry/);
    expect(() => decodeInputs(bytes([3, 0, 0, 0, 0, 0]), 10)).toThrow(/does not change the input/);
    expect(() => decodeInputs(bytes([0, 0, 0, 128, 0, 0]), 10)).toThrow(/steer -128/);
    expect(() => decodeInputs(bytes([0, 0, 0, 0, 0xff, 0xff, 0xff, 0xff, 0xff, 0x01, 0]), 10)).toThrow(
      /varint/,
    );
    expect(() => decodeInputs('@@@@', 10)).toThrow(/base64/);
  });
});

function createInputLogOfNeutral(ticks: number): InputLog {
  const log = createInputLog(ticks);
  const frame = createInputFrame();
  for (let t = 0; t < ticks; t++) appendInput(log, t, frame);
  return log;
}

describe('quantisation (1e-4)', () => {
  it('puts 1.00004 and 1.00006 in different quanta, 1.00004 and 1.000041 in the same', () => {
    expect(quantise(1.00004)).not.toBe(quantise(1.00006));
    expect(quantise(1.00004)).toBe(quantise(1.000041));
    expect(quantise(1.00004)).toBe(10000);
    expect(quantise(1.00006)).toBe(10001);
  });

  it('writes Math.round(v * 1e4) as an Int32: −0 and NaN hash as 0, Int32 wrap beyond ±214,748 m', () => {
    expect(Object.is(quantise(-0.00001), 0)).toBe(true);
    expect(quantise(Number.NaN)).toBe(0);
    expect(quantise(-1.00004)).toBe(-10000);
    expect(quantise(-1.00006)).toBe(-10001);
    expect(quantise(-12.3456)).toBe(-123456);
    expect(quantise(214748.3648)).toBe(-2147483648);
  });
});

describe('state hash', () => {
  it('is FNV-1a 32-bit (known answers) over little-endian Int32s, printed as 8 lowercase hex chars', () => {
    const ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));
    expect(fnv1a32Bytes([])).toBe(0x811c9dc5);
    expect(fnv1a32Bytes(ascii('a'))).toBe(0xe40c292c);
    expect(fnv1a32Bytes(ascii('foobar'))).toBe(0xbf9cf968);
    expect(fnv1a32Int32s([0x64636261])).toBe(fnv1a32Bytes(ascii('abcd')));
    expect(fnv1a32Int32s([-1])).toBe(fnv1a32Bytes([255, 255, 255, 255]));
    expect(hashHex(0x0000beef)).toBe('0000beef');
    expect(hashHex(0xffffffff)).toBe('ffffffff');
  });

  function handSetWorld(): World {
    const level = createBlankLevel('test.hash', 4, 4);
    level.player = { x: 3.25, y: 4.5, heading: 0.75 };
    const world = createWorld(level, 1234, DEFAULT_TUNING);
    world.tick = 7;
    Object.assign(world.input, { throttle: 200, brake: 0, steer: -40, buttons: 1, pressed: 2 });
    world.vehicle.vLongMps = 4.56789;
    world.vehicle.steerRad = -0.123;
    world.events.sealed = false;
    pushEvent(world.events, EV.KerbJolt, -1, 3.5, 4.25, 4.56789);
    return world;
  }

  function hashOf(world: World): number {
    const hasher = createStateHasher(world.seed);
    absorbTick(hasher, world);
    return stateHash(hasher);
  }

  it('keeps its canonical byte layout (golden value for a hand-set World)', () => {
    // Changing the field order, the quantum or the header changes this value: that is a replay format change
    // (bump REPLAY_VERSION and re-record every replay).
    expect(hashHex(hashOf(handSetWorld()))).toBe(GOLDEN_HAND_SET_HASH);
  });

  it('covers every VehicleState field, the input, the tick and the events', () => {
    const base = hashOf(handSetWorld());
    const vehicleKeys = Object.keys(handSetWorld().vehicle) as (keyof VehicleState)[];
    expect(vehicleKeys.length).toBe(20);
    for (const key of vehicleKeys) {
      const world = handSetWorld();
      const v = world.vehicle as Record<keyof VehicleState, number | boolean>;
      const value = v[key];
      // Integer fields move by 1, floats by 10 quanta.
      const integer = key === 'gear' || key === 'reverseHoldTicks';
      v[key] = typeof value === 'boolean' ? !value : (value as number) + (integer ? 1 : 0.001);
      expect(hashOf(world), `vehicle.${key}`).not.toBe(base);
    }
    for (const key of ['throttle', 'brake', 'steer', 'buttons', 'pressed'] as const) {
      const world = handSetWorld();
      world.input[key] += 1;
      expect(hashOf(world), `input.${key}`).not.toBe(base);
    }
    const ticked = handSetWorld();
    ticked.tick += 1;
    expect(hashOf(ticked)).not.toBe(base);
    const moreEvents = handSetWorld();
    pushEvent(moreEvents.events, EV.ReverseBeeper, -1, 0, 0, 0);
    expect(hashOf(moreEvents)).not.toBe(base);
    const movedEvent = handSetWorld();
    movedEvent.events.c[0] = 4.5;
    expect(hashOf(movedEvent)).not.toBe(base);
    const otherSeed = handSetWorld();
    const hasher = createStateHasher(1235);
    absorbTick(hasher, otherSeed);
    expect(stateHash(hasher)).not.toBe(base);
  });

  it('ignores differences below the 1e-4 quantum', () => {
    const base = hashOf(handSetWorld());
    const world = handSetWorld();
    world.vehicle.vLongMps += 1e-6; // 4.56789 → 4.567891: same quantum (45679)
    world.events.a[0] = 3.50001;
    expect(hashOf(world)).toBe(base);
  });

  it('is stable: the same replay gives the same checkpoints in one process', () => {
    const level = syntheticLevel();
    const log = syntheticInputLog();
    const a = runReplay(level, DEFAULT_TUNING, 42, log, REPLAY_TICKS);
    const b = runReplay(level, DEFAULT_TUNING, 42, log, REPLAY_TICKS);
    expect(a.checkpoints).toEqual(b.checkpoints);
    expect(Object.keys(a.checkpoints)).toEqual(['600', '1200', '1800', '2400', '3000', '3600']);
    expect(a.finalHash).toBe(a.checkpoints['3600']);
    expect(new Set(Object.values(a.checkpoints)).size).toBe(6);
  });

  it('changes every checkpoint from the tick where one input changes, and none before', () => {
    const level = syntheticLevel();
    const base = runReplay(level, DEFAULT_TUNING, 42, syntheticInputLog(), REPLAY_TICKS).checkpoints;
    for (const [tick, field, delta] of [
      [1000, 'steer', 1],
      [2399, 'throttle', -1],
      [0, 'pressed', PRESSED.HORN], // no effect on the vehicle in M1: the hashed input still diverges
    ] as const) {
      const log = syntheticInputLog();
      log[field][tick] = (log[field][tick] as number) + delta;
      const changed = runReplay(level, DEFAULT_TUNING, 42, log, REPLAY_TICKS).checkpoints;
      for (const cp of checkpointTicks(REPLAY_TICKS)) {
        const key = String(cp);
        if (cp <= tick) expect(changed[key], `${field}@${tick} cp ${key}`).toBe(base[key]);
        else expect(changed[key], `${field}@${tick} cp ${key}`).not.toBe(base[key]);
      }
    }
  });
});

/** Pinned by 'keeps its canonical byte layout'. */
const GOLDEN_HAND_SET_HASH = 'c80faedc';

describe('checkpoints', () => {
  it('fall every 600 ticks plus the final tick', () => {
    expect(CHECKPOINT_INTERVAL_TICKS).toBe(600);
    expect(checkpointTicks(3600)).toEqual([600, 1200, 1800, 2400, 3000, 3600]);
    expect(checkpointTicks(1000)).toEqual([600, 1000]);
    expect(checkpointTicks(600)).toEqual([600]);
    expect(checkpointTicks(5)).toEqual([5]);
  });

  it('compare to null when equal and name the first divergence otherwise', () => {
    const a = { '600': 'aaaaaaaa', '1200': 'bbbbbbbb', '1800': 'cccccccc' };
    expect(compareCheckpoints(a, { ...a }, 1800)).toBeNull();
    const msg = compareCheckpoints(a, { ...a, '1200': '12345678', '1800': '87654321' }, 1800);
    expect(msg).toBe(
      'first diverging checkpoint at tick 1200 (the runs diverged in ticks 601..1200); 2 of 3 checkpoints differ: ' +
        '1200: expected bbbbbbbb, got 12345678; 1800: expected cccccccc, got 87654321',
    );
    expect(compareCheckpoints(a, { ...a, '600': '00000000' }, 1800)).toMatch(/ticks 1\.\.600/);
    expect(compareCheckpoints({}, a, 1800)).toMatch(/600: expected \(none\), got aaaaaaaa/);
  });
});

describe('replay file', () => {
  const level = syntheticLevel();
  const file = recordReplay(level, DEFAULT_TUNING, 'district.synthetic_town', 99, syntheticInputLog(), {
    hpMin: 100,
    maxSolidOverlapM: 0.001,
    minEvents: { KerbJolt: 1, ReverseBeeper: 1, Impact: 0 },
  });

  it('records a complete file and serialises it with a fixed key order', () => {
    expect(file.format).toBe('ssp.replay');
    expect(file.version).toBe(1);
    expect(file.ticks).toBe(3600);
    expect(Object.keys(file.checkpoints)).toEqual(['600', '1200', '1800', '2400', '3000', '3600']);
    const text = serialiseReplay(file);
    expect(text.endsWith('}\n')).toBe(true);
    expect(Object.keys(JSON.parse(text))).toEqual([
      'format',
      'version',
      'district',
      'seed',
      'ticks',
      'inputs',
      'checkpoints',
      'invariants',
    ]);
    const loaded = loadReplay(text);
    expect(loaded.file).toEqual(file);
    expect(serialiseReplay(loaded.file)).toBe(text);
    expect(inputLogsEqual(loaded.log, syntheticInputLog())).toBe(true);
  });

  it('accepts a file whose checkpoints are not recorded yet', () => {
    const loaded = loadReplay({ ...file, checkpoints: {} });
    expect(loaded.file.checkpoints).toEqual({});
  });

  it('rejects malformed files with a message naming the problem', () => {
    const bad = (patch: Partial<Record<keyof ReplayFile | 'extra', unknown>>): (() => void) => {
      return () => loadReplay({ ...file, ...patch });
    };
    expect(() => loadReplay('{')).toThrow(/not valid JSON/);
    expect(bad({ format: 'ssp.level' })).toThrow(/format must be "ssp.replay"/);
    expect(bad({ version: 2 })).toThrow(/version must be 1/);
    expect(bad({ extra: 1 })).toThrow(/unknown key "extra"/);
    expect(bad({ district: 'puddle_lane' })).toThrow(/district must match/);
    expect(bad({ seed: -1 })).toThrow(/seed must be a uint32/);
    expect(bad({ ticks: 0 })).toThrow(/ticks must be an integer/);
    expect(bad({ inputs: 3 })).toThrow(/inputs must be a base64 string/);
    expect(bad({ checkpoints: { '600': 'aaaaaaaa' } })).toThrow(/checkpoints\.1200 is missing/);
    expect(bad({ checkpoints: { ...file.checkpoints, '601': 'aaaaaaaa' } })).toThrow(/unknown key "601"/);
    expect(bad({ checkpoints: { ...file.checkpoints, '600': 'AAAAAAAA' } })).toThrow(/8 lowercase hex/);
    expect(bad({ invariants: { hpMax: 1 } })).toThrow(/unknown key "hpMax"/);
    expect(bad({ invariants: { minEvents: { Honk: 1 } } })).toThrow(/unknown key "Honk"/);
    expect(bad({ invariants: { minEvents: { Impact: 0.5 } } })).toThrow(
      /minEvents.Impact must be a non-negative integer/,
    );
    expect(bad({ invariants: { maxSolidOverlapM: -1 } })).toThrow(/maxSolidOverlapM must be a finite number/);
  });

  it('parses every documented invariant key', () => {
    const loaded = loadReplay({
      ...file,
      invariants: {
        minScore: 1,
        minLitterCollected: 20,
        hpMin: 50,
        maxSolidOverlapM: 0.001,
        minEvents: { Impact: 1, KerbJolt: 1, ReverseBeeper: 1, ShiftEnd: 0 },
      },
    });
    expect(loaded.file.invariants.minEvents).toEqual({
      Impact: 1,
      KerbJolt: 1,
      ReverseBeeper: 1,
      ShiftEnd: 0,
    });
  });
});

describe('replay invariants', () => {
  const body = { widthM: 1.75, lengthM: 3.25 };

  it('measures OBB penetration into a rect along the minimum axis (SAT)', () => {
    // Facing north (length along y), centre 0.5 m inside the rect's west edge: overlap 0.5 + 0.875.
    expect(obbRectPenetrationM({ ...body, xM: 10.5, yM: 5, headingRad: 0 }, 10, 0, 20, 10)).toBeCloseTo(
      1.375,
      12,
    );
    // Clear of it.
    expect(obbRectPenetrationM({ ...body, xM: 9, yM: 5, headingRad: 0 }, 10, 0, 20, 10)).toBe(0);
    // Facing east (length along x): the half-length now reaches 1.625 m.
    expect(
      obbRectPenetrationM({ ...body, xM: 8.5, yM: 5, headingRad: Math.PI / 2 }, 10, 0, 20, 10),
    ).toBeCloseTo(0.125, 12);
    // Nose-first into the rect's corner at 45°: the forward axis separates least (1.625 − √2 m), while the
    // OBB's own AABB would overlap 0.77 m.
    expect(
      obbRectPenetrationM({ ...body, xM: 9, yM: 11, headingRad: Math.PI / 4 }, 10, 0, 20, 10),
    ).toBeCloseTo(1.625 - Math.SQRT2, 12);
  });

  it('measures how far the OBB reaches outside the map', () => {
    expect(obbBoundaryPenetrationM({ ...body, xM: 5, yM: 5, headingRad: 0 }, 96, 96)).toBe(0);
    expect(obbBoundaryPenetrationM({ ...body, xM: 0.5, yM: 5, headingRad: 0 }, 96, 96)).toBeCloseTo(
      0.375,
      12,
    );
    expect(obbBoundaryPenetrationM({ ...body, xM: 50, yM: 95, headingRad: 0 }, 96, 96)).toBeCloseTo(
      0.625,
      12,
    );
    const level = syntheticLevel();
    expect(solidOverlapM(level, { ...body, xM: 8.5, yM: 6, headingRad: 0 })).toBeCloseTo(0.375, 12);
    expect(solidOverlapM(level, { ...body, xM: 48, yM: 48, headingRad: 1 })).toBe(0);
  });

  it('turns a run into invariant failures', () => {
    const level = syntheticLevel();
    const monitor = createInvariantMonitor(level, DEFAULT_TUNING);
    runReplay(level, DEFAULT_TUNING, 1, syntheticInputLog(), REPLAY_TICKS, monitor.observe);
    expect(monitor.ticks).toBe(REPLAY_TICKS);
    expect(monitor.minHp).toBe(100);
    expect(monitor.maxSolidOverlapM).toBe(0);
    expect(monitor.eventCounts[EV.KerbJolt]).toBeGreaterThan(10);
    expect(monitor.eventCounts[EV.ReverseBeeper]).toBeGreaterThan(1);
    expect(
      invariantFailures({ hpMin: 100, maxSolidOverlapM: 0.001, minEvents: { KerbJolt: 1 } }, monitor),
    ).toEqual([]);
    expect(invariantFailures({ hpMin: 101, minEvents: { Impact: 1, ShiftEnd: 0 } }, monitor)).toEqual([
      'hpMin: HP fell to 100, below 101',
      'minEvents.Impact: 0 event(s) over the replay, expected at least 1',
    ]);
    monitor.maxSolidOverlapM = 0.25;
    monitor.maxSolidOverlapTick = 77;
    expect(invariantFailures({ maxSolidOverlapM: 0.001 }, monitor)).toEqual([
      'maxSolidOverlapM: Bessie overlapped solid geometry by 0.2500 m at tick 77 (limit 0.001 m)',
    ]);
  });
});
