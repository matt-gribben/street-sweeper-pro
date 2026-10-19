// Deterministic replays (TECHNICAL_DESIGN §18.3, §7.4, SSP-038): the input log, its run-length encoding, the
// replay file, and the quantised FNV-1a state hash.
//
// A run is f(seed, district, input log) (CLAUDE.md hard rule 12). This module records the log (the World's
// phase-1 hook appends each tick's InputFrame to a preallocated InputLog), serialises it as base64 RLE, and
// hashes the sim's state after every tick so a replay can be checked against committed checkpoint hashes in
// Node (`npm run test:replay`, tests/replay/replay.test.ts).
//
// Hash: one FNV-1a 32-bit stream per run. It starts with a header (the format version and the seed), then
// after every tick absorbs that tick's canonical byte stream (absorbTick, field order documented there):
// the tick counter, the World's InputFrame copy, every VehicleState field and the tick's event queue. Floats
// are quantised as Math.round(v * 1e4) and written as little-endian Int32 (ToInt32 wraps out-of-range
// values and maps NaN to 0, deterministically); integers and flags are written as Int32. The checkpoint at
// tick T is the stream's value after tick T, as 8 lowercase hex characters. Because the stream is chained,
// a divergence on one tick changes every later checkpoint, even if the state reconverges afterwards.
//
// Hot path: appendInput (via the recorder) and absorbTick allocate nothing and pass no doubles across calls
// (TECHNICAL_DESIGN §17, V8 trap 1). Encoding, decoding, parsing and runReplay's setup are load-time code
// and allocate freely.

import { decodeBase64, encodeBase64 } from './base64.ts';
import { SHIFT_TICKS } from './constants.ts';
import { EV } from './eventQueue.ts';
import { BRAKE_MAX, createInputFrame, type InputFrame, STEER_MAX, THROTTLE_MAX } from './inputFrame.ts';
import type { Level } from './map.ts';
import { FNV1A32_OFFSET, FNV1A32_PRIME } from './rng.ts';
import type { Tuning } from './tuning.ts';
import { createWorld, type World } from './world.ts';

/** `format` of a replay file. */
export const REPLAY_FORMAT = 'ssp.replay';

/** `version` of a replay file. Bump it (and keep a decoder for the old one) if the layout or hash changes. */
export const REPLAY_VERSION = 1;

/** Ticks between checkpoint hashes (§18.3): one every 10 s of sim. */
export const CHECKPOINT_INTERVAL_TICKS = 600;

/** The standard replay length: one minute of sim at 60 Hz (§18.3). */
export const REPLAY_TICKS = 3600;

/** Longest replay the format accepts: ten full shifts. Guards decoders against absurd allocations. */
export const MAX_REPLAY_TICKS = SHIFT_TICKS * 10;

/** Float quantisation for the hash: v is hashed as Math.round(v * HASH_QUANTUM) (1e-4 resolution, §7.4). */
export const HASH_QUANTUM = 1e4;

/** District ids (CLAUDE.md §5.4). The runner loads `public/assets/levels/<name>.json` for `district.<name>`. */
export const DISTRICT_ID_PATTERN = /^district\.[a-z0-9_]+$/;

/** A checkpoint hash: 8 lowercase hex characters. */
export const HASH_HEX_PATTERN = /^[0-9a-f]{8}$/;

/**
 * Module-local copies of the FNV-1a constants for the hot path. Vitest's module transform turns every use of
 * an imported binding into a getter call on the exporting module (heap sampling showed those getters on the
 * hash's stack); a local const is read directly in every environment, so absorbTick never depends on V8
 * inlining them.
 */
const FNV_OFFSET = FNV1A32_OFFSET | 0;
const FNV_PRIME = FNV1A32_PRIME;

/** Largest `buttons` / `pressed` value the log accepts (a non-negative Int32 bitfield). */
const MAX_BITFIELD = 0x7fffffff;

// ---------------------------------------------------------------------------------------------------------
// Input log
// ---------------------------------------------------------------------------------------------------------

/**
 * A preallocated log of InputFrames, one per tick from tick 0, struct-of-arrays. `length` frames are valid.
 * Every value is range-checked when appended, so a log can always be encoded.
 */
export type InputLog = {
  readonly capacity: number;
  length: number;
  readonly throttle: Int32Array;
  readonly brake: Int32Array;
  readonly steer: Int32Array;
  readonly buttons: Int32Array;
  readonly pressed: Int32Array;
};

/** A new empty log with room for `capacityTicks` frames (default: one full shift). Allocate once per shift. */
export function createInputLog(capacityTicks: number = SHIFT_TICKS): InputLog {
  if (!Number.isInteger(capacityTicks) || capacityTicks < 0 || capacityTicks > MAX_REPLAY_TICKS) {
    throw new Error(
      `replay: log capacity must be an integer in 0..${MAX_REPLAY_TICKS}, got ${capacityTicks}`,
    );
  }
  return {
    capacity: capacityTicks,
    length: 0,
    throttle: new Int32Array(capacityTicks),
    brake: new Int32Array(capacityTicks),
    steer: new Int32Array(capacityTicks),
    buttons: new Int32Array(capacityTicks),
    pressed: new Int32Array(capacityTicks),
  };
}

/** Empty the log for a new shift without reallocating. */
export function clearInputLog(log: InputLog): void {
  log.length = 0;
}

function throwBadInput(field: string, value: number, range: string, tick: number): never {
  throw new Error(`replay: tick ${tick} InputFrame.${field} = ${value} is not an integer in ${range}`);
}

function inRange(value: number, lo: number, hi: number): boolean {
  // Integers only: (value | 0) === value rejects fractions, NaN and anything outside Int32.
  return (value | 0) === value && value >= lo && value <= hi;
}

/**
 * Append the frame for `tick`. Ticks must arrive in order from 0 (tick === log.length). Throws on a gap, a
 * full log or a value outside the InputFrame contract (§13.1); allocates nothing otherwise.
 */
export function appendInput(log: InputLog, tick: number, input: Readonly<InputFrame>): void {
  const i = log.length;
  if (tick !== i) {
    throw new Error(
      `replay: input log expected tick ${i} but got tick ${tick} (attach the log at shift start)`,
    );
  }
  if (i >= log.capacity) {
    throw new Error(`replay: input log is full (${log.capacity} ticks); create it with a larger capacity`);
  }
  const { throttle, brake, steer, buttons, pressed } = input;
  if (!inRange(throttle, 0, THROTTLE_MAX)) throwBadInput('throttle', throttle, `0..${THROTTLE_MAX}`, tick);
  if (!inRange(brake, 0, BRAKE_MAX)) throwBadInput('brake', brake, `0..${BRAKE_MAX}`, tick);
  if (!inRange(steer, -STEER_MAX, STEER_MAX))
    throwBadInput('steer', steer, `−${STEER_MAX}..${STEER_MAX}`, tick);
  if (!inRange(buttons, 0, MAX_BITFIELD)) throwBadInput('buttons', buttons, `0..${MAX_BITFIELD}`, tick);
  if (!inRange(pressed, 0, MAX_BITFIELD)) throwBadInput('pressed', pressed, `0..${MAX_BITFIELD}`, tick);
  log.throttle[i] = throttle;
  log.brake[i] = brake;
  log.steer[i] = steer;
  log.buttons[i] = buttons;
  log.pressed[i] = pressed;
  log.length = i + 1;
}

/** Copy frame `tick` of the log into `out`. Allocation-free; `tick` must be below log.length. */
export function readInput(log: InputLog, tick: number, out: InputFrame): void {
  out.throttle = log.throttle[tick] as number;
  out.brake = log.brake[tick] as number;
  out.steer = log.steer[tick] as number;
  out.buttons = log.buttons[tick] as number;
  out.pressed = log.pressed[tick] as number;
}

/**
 * Attach `log` to the World's phase-1 hook (dev builds record every shift this way, §18.3). The log must be
 * empty and the World at tick 0. The recorder closure is created here, once, never per tick.
 */
export function attachInputLog(world: World, log: InputLog): void {
  if (world.tick !== 0 || log.length !== 0) {
    throw new Error(
      `replay: attach the input log at shift start (world tick ${world.tick}, log length ${log.length})`,
    );
  }
  world.recordInput = (tick, input) => {
    appendInput(log, tick, input);
  };
}

/** True when frames a and b of two logs (or one) are identical. */
function sameFrame(a: InputLog, i: number, b: InputLog, j: number): boolean {
  return (
    a.throttle[i] === b.throttle[j] &&
    a.brake[i] === b.brake[j] &&
    a.steer[i] === b.steer[j] &&
    a.buttons[i] === b.buttons[j] &&
    a.pressed[i] === b.pressed[j]
  );
}

/** True when the two logs hold the same frames. */
export function inputLogsEqual(a: InputLog, b: InputLog): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (!sameFrame(a, i, b, i)) return false;
  return true;
}

// ---------------------------------------------------------------------------------------------------------
// RLE + base64
// ---------------------------------------------------------------------------------------------------------
//
// The log is stored as its changes. Before tick 0 the input is neutral (all zero). Each entry says "from
// tickDelta ticks after the previous entry (the first entry: from tick tickDelta), the input is this frame
// until the next entry or the end of the replay". Entries are only written where the frame differs from the
// previous tick's, so tickDelta is ≥ 1 for every entry but the first, which may be 0. Bytes per entry:
//
//   tickDelta  unsigned LEB128 varint
//   throttle   uint8   (0..255)
//   brake      uint8   (0..255)
//   steer      int8    (−127..127, two's complement)
//   buttons    unsigned LEB128 varint
//   pressed    unsigned LEB128 varint
//
// The byte stream is base64 (RFC 4648, padded; base64.ts). A log of only neutral frames encodes as "".

function pushVarint(out: number[], value: number): void {
  let v = value >>> 0;
  while (v >= 0x80) {
    out.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  out.push(v);
}

/** RLE-encode the log's frames and return the bytes. */
export function encodeInputBytes(log: InputLog): Uint8Array {
  const out: number[] = [];
  let lastTick = 0;
  for (let t = 0; t < log.length; t += 1) {
    const changed =
      t === 0
        ? log.throttle[0] !== 0 ||
          log.brake[0] !== 0 ||
          log.steer[0] !== 0 ||
          log.buttons[0] !== 0 ||
          log.pressed[0] !== 0
        : !sameFrame(log, t, log, t - 1);
    if (!changed) continue;
    pushVarint(out, t - lastTick);
    lastTick = t;
    out.push(log.throttle[t] as number, log.brake[t] as number, (log.steer[t] as number) & 0xff);
    pushVarint(out, log.buttons[t] as number);
    pushVarint(out, log.pressed[t] as number);
  }
  return Uint8Array.from(out);
}

/** The `inputs` string of a replay file: base64 of encodeInputBytes. */
export function encodeInputs(log: InputLog): string {
  return encodeBase64(encodeInputBytes(log));
}

type ByteReader = { readonly bytes: Uint8Array; offset: number };

function readByte(r: ByteReader, what: string): number {
  if (r.offset >= r.bytes.length) {
    throw new Error(`replay: inputs end in the middle of an entry (reading ${what} at byte ${r.offset})`);
  }
  const b = r.bytes[r.offset] as number;
  r.offset += 1;
  return b;
}

function readVarint(r: ByteReader, what: string): number {
  let value = 0;
  for (let shift = 0; shift < 35; shift += 7) {
    const b = readByte(r, what);
    value += (b & 0x7f) * 2 ** shift;
    if ((b & 0x80) === 0) {
      if (value > MAX_BITFIELD) throw new Error(`replay: ${what} ${value} at byte ${r.offset} is too large`);
      return value;
    }
  }
  throw new Error(`replay: ${what} varint at byte ${r.offset} is longer than 5 bytes`);
}

/**
 * Decode RLE bytes into a log of exactly `ticks` frames. Strict: every entry must change the frame, ticks must
 * stay in range, every value must satisfy the InputFrame contract, and no bytes may trail.
 */
export function decodeInputBytes(bytes: Uint8Array, ticks: number): InputLog {
  const log = createInputLog(ticks);
  const r: ByteReader = { bytes, offset: 0 };
  // The frame in force before the next entry; starts neutral.
  let throttle = 0;
  let brake = 0;
  let steer = 0;
  let buttons = 0;
  let pressed = 0;
  let tick = 0;
  let first = true;
  const fill = (until: number): void => {
    for (let t = log.length; t < until; t += 1) {
      log.throttle[t] = throttle;
      log.brake[t] = brake;
      log.steer[t] = steer;
      log.buttons[t] = buttons;
      log.pressed[t] = pressed;
    }
    log.length = until;
  };
  while (r.offset < bytes.length) {
    const entryAt = r.offset;
    const delta = readVarint(r, 'tickDelta');
    if (!first && delta === 0) throw new Error(`replay: entry at byte ${entryAt} has tickDelta 0`);
    const at = tick + delta;
    if (at >= ticks) {
      throw new Error(
        `replay: entry at byte ${entryAt} starts at tick ${at}, past the replay's ${ticks} ticks`,
      );
    }
    const nThrottle = readByte(r, 'throttle');
    const nBrake = readByte(r, 'brake');
    const rawSteer = readByte(r, 'steer');
    const nSteer = rawSteer >= 128 ? rawSteer - 256 : rawSteer;
    if (nSteer < -STEER_MAX) throw new Error(`replay: entry at byte ${entryAt} has steer ${nSteer}`);
    const nButtons = readVarint(r, 'buttons');
    const nPressed = readVarint(r, 'pressed');
    const same =
      nThrottle === throttle &&
      nBrake === brake &&
      nSteer === steer &&
      nButtons === buttons &&
      nPressed === pressed;
    if (same) throw new Error(`replay: entry at byte ${entryAt} (tick ${at}) does not change the input`);
    fill(at);
    throttle = nThrottle;
    brake = nBrake;
    steer = nSteer;
    buttons = nButtons;
    pressed = nPressed;
    tick = at;
    first = false;
  }
  fill(ticks);
  return log;
}

/** Decode a replay file's `inputs` string into a log of exactly `ticks` frames. */
export function decodeInputs(text: string, ticks: number): InputLog {
  return decodeInputBytes(decodeBase64(text), ticks);
}

// ---------------------------------------------------------------------------------------------------------
// State hash
// ---------------------------------------------------------------------------------------------------------

/** The running FNV-1a hash of one run. state[0] holds it as an Int32 (so it never boxes). */
export type StateHasher = { readonly state: Int32Array };

/** Math.round(v * 1e4) as an Int32: the quantum a float is hashed as. For tests and tools. */
export function quantise(v: number): number {
  return Math.round(v * HASH_QUANTUM) | 0;
}

/** FNV-1a over the 4 little-endian bytes of the Int32 `v`, continuing from `h`. Ints in, Int32 out. */
function fnvInt32(h: number, v: number): number {
  let x = Math.imul(h ^ (v & 0xff), FNV_PRIME);
  x = Math.imul(x ^ ((v >>> 8) & 0xff), FNV_PRIME);
  x = Math.imul(x ^ ((v >>> 16) & 0xff), FNV_PRIME);
  return Math.imul(x ^ (v >>> 24), FNV_PRIME);
}

/** FNV-1a 32-bit of the given bytes, as uint32. For the known-answer tests of the hash primitive. */
export function fnv1a32Bytes(bytes: ArrayLike<number>): number {
  let h = FNV_OFFSET;
  for (let i = 0; i < bytes.length; i += 1) h = Math.imul(h ^ ((bytes[i] as number) & 0xff), FNV_PRIME);
  return h >>> 0;
}

/** FNV-1a 32-bit of the Int32 values, each as 4 little-endian bytes, as uint32. For tests and tools. */
export function fnv1a32Int32s(values: ArrayLike<number>): number {
  let h = FNV_OFFSET;
  for (let i = 0; i < values.length; i += 1) h = fnvInt32(h, (values[i] as number) | 0);
  return h >>> 0;
}

/** A hasher for a run with `seed`, already holding the header (REPLAY_VERSION, seed). */
export function createStateHasher(seed: number): StateHasher {
  const hasher: StateHasher = { state: new Int32Array(1) };
  resetStateHasher(hasher, seed);
  return hasher;
}

/** Restart `hasher` for a new run with `seed`. */
export function resetStateHasher(hasher: StateHasher, seed: number): void {
  let h = FNV_OFFSET;
  h = fnvInt32(h, REPLAY_VERSION);
  h = fnvInt32(h, seed | 0);
  hasher.state[0] = h;
}

/**
 * Absorb the World's state after a tick into the running hash. Canonical order (TECHNICAL_DESIGN §18.3);
 * F = quantised float (Math.round(v * 1e4)), I = integer, B = boolean as 0/1, all little-endian Int32:
 *
 *   I tick (ticks completed)
 *   I input.throttle, input.brake, input.steer, input.buttons, input.pressed
 *   F vehicle.xM, yM, headingRad, prevXM, prevYM, prevHeadingRad, vLongMps, vLatMps, steerRad, yawRateRadPerS
 *   I vehicle.gear   B vehicle.brushDown
 *   F vehicle.brushPos, rpm, hp, hopperLU, water, massKg
 *   I vehicle.reverseHoldTicks   B vehicle.reverseEngaged
 *   I events.count, then per event in emission order: I type, I entity, F a, F b, F c
 *
 * world.surface is not hashed: phase 2 resamples it from the pose every tick. Every new store field joins
 * this list, appended, in the commit that adds it (M2 adds the litter store, the grime mask and the shift
 * counters); that commit re-records the replay hashes. Allocation-free: floats are quantised in place and
 * only Int32 values cross the fnvInt32 call boundary.
 */
export function absorbTick(hasher: StateHasher, world: World): void {
  const v = world.vehicle;
  const input = world.input;
  const q = HASH_QUANTUM;
  let h = hasher.state[0] as number;
  h = fnvInt32(h, world.tick | 0);
  h = fnvInt32(h, input.throttle | 0);
  h = fnvInt32(h, input.brake | 0);
  h = fnvInt32(h, input.steer | 0);
  h = fnvInt32(h, input.buttons | 0);
  h = fnvInt32(h, input.pressed | 0);
  h = fnvInt32(h, Math.round(v.xM * q) | 0);
  h = fnvInt32(h, Math.round(v.yM * q) | 0);
  h = fnvInt32(h, Math.round(v.headingRad * q) | 0);
  h = fnvInt32(h, Math.round(v.prevXM * q) | 0);
  h = fnvInt32(h, Math.round(v.prevYM * q) | 0);
  h = fnvInt32(h, Math.round(v.prevHeadingRad * q) | 0);
  h = fnvInt32(h, Math.round(v.vLongMps * q) | 0);
  h = fnvInt32(h, Math.round(v.vLatMps * q) | 0);
  h = fnvInt32(h, Math.round(v.steerRad * q) | 0);
  h = fnvInt32(h, Math.round(v.yawRateRadPerS * q) | 0);
  h = fnvInt32(h, v.gear | 0);
  h = fnvInt32(h, v.brushDown ? 1 : 0);
  h = fnvInt32(h, Math.round(v.brushPos * q) | 0);
  h = fnvInt32(h, Math.round(v.rpm * q) | 0);
  h = fnvInt32(h, Math.round(v.hp * q) | 0);
  h = fnvInt32(h, Math.round(v.hopperLU * q) | 0);
  h = fnvInt32(h, Math.round(v.water * q) | 0);
  h = fnvInt32(h, Math.round(v.massKg * q) | 0);
  h = fnvInt32(h, v.reverseHoldTicks | 0);
  h = fnvInt32(h, v.reverseEngaged ? 1 : 0);
  const events = world.events;
  const n = events.count;
  h = fnvInt32(h, n | 0);
  for (let i = 0; i < n; i += 1) {
    h = fnvInt32(h, (events.type[i] as number) | 0);
    h = fnvInt32(h, (events.entity[i] as number) | 0);
    h = fnvInt32(h, Math.round((events.a[i] as number) * q) | 0);
    h = fnvInt32(h, Math.round((events.b[i] as number) * q) | 0);
    h = fnvInt32(h, Math.round((events.c[i] as number) * q) | 0);
  }
  hasher.state[0] = h;
}

/** The hasher's current value as a uint32. */
export function stateHash(hasher: StateHasher): number {
  return (hasher.state[0] as number) >>> 0;
}

/** A uint32 hash as 8 lowercase hex characters. */
export function hashHex(hash: number): string {
  return (hash >>> 0).toString(16).padStart(8, '0');
}

// ---------------------------------------------------------------------------------------------------------
// Running a replay
// ---------------------------------------------------------------------------------------------------------

/** The ticks a replay of `ticks` ticks checkpoints at: every 600th tick, plus the final tick. */
export function checkpointTicks(ticks: number): number[] {
  const out: number[] = [];
  for (let t = CHECKPOINT_INTERVAL_TICKS; t < ticks; t += CHECKPOINT_INTERVAL_TICKS) out.push(t);
  if (ticks > 0) out.push(ticks);
  return out;
}

/** Called after each tick of runReplay (after the hash absorbed it), e.g. to count events or check invariants. */
export type ReplayTickObserver = (world: World) => void;

/** What runReplay returns. */
export type ReplayRun = {
  readonly world: World;
  /** Checkpoint ticks (checkpointTicks(ticks)) and their hashes as 8-hex strings, in tick order. */
  readonly checkpoints: { readonly [tick: string]: string };
  /** The final checkpoint's hash. */
  readonly finalHash: string;
};

/**
 * Run `log` for `ticks` ticks on a fresh World(level, seed, tuning) and return the checkpoint hashes. Node is
 * the canonical environment (ROADMAP R-09); the same build gives the same hashes in Chromium.
 */
export function runReplay(
  level: Level,
  tuning: Tuning,
  seed: number,
  log: InputLog,
  ticks: number,
  observe: ReplayTickObserver | null = null,
): ReplayRun {
  if (!Number.isInteger(ticks) || ticks < 1)
    throw new Error(`replay: ticks must be a positive integer, got ${ticks}`);
  if (log.length < ticks) throw new Error(`replay: log holds ${log.length} ticks, ${ticks} requested`);
  const world = createWorld(level, seed, tuning);
  const hasher = createStateHasher(world.seed);
  const at = checkpointTicks(ticks);
  const hashes = new Uint32Array(at.length);
  const frame = createInputFrame();
  let next = 0;
  for (let t = 0; t < ticks; t += 1) {
    readInput(log, t, frame);
    world.step(frame);
    absorbTick(hasher, world);
    if (observe !== null) observe(world);
    if (world.tick === at[next]) {
      hashes[next] = stateHash(hasher);
      next += 1;
    }
  }
  const checkpoints: { [tick: string]: string } = {};
  for (let i = 0; i < at.length; i += 1) checkpoints[String(at[i])] = hashHex(hashes[i] as number);
  return { world, checkpoints, finalHash: hashHex(hashes[at.length - 1] ?? 0) };
}

/**
 * Compare recorded checkpoints with a run's. Null when they match; otherwise a message naming the first
 * diverging checkpoint (where to start looking for the determinism bug, ROADMAP §5.3) and every later one.
 */
export function compareCheckpoints(
  expected: { readonly [tick: string]: string },
  actual: { readonly [tick: string]: string },
  ticks: number,
): string | null {
  const at = checkpointTicks(ticks);
  const diverged: string[] = [];
  let first = -1;
  for (let i = 0; i < at.length; i += 1) {
    const key = String(at[i]);
    const want = expected[key];
    const got = actual[key];
    if (want === got) continue;
    if (first < 0) first = i;
    diverged.push(`${key}: expected ${want ?? '(none)'}, got ${got ?? '(none)'}`);
  }
  if (first < 0) return null;
  const firstTick = at[first] as number;
  const sinceTick = first === 0 ? 0 : (at[first - 1] as number);
  return (
    `first diverging checkpoint at tick ${firstTick} (the runs diverged in ticks ${sinceTick + 1}..${firstTick}); ` +
    `${diverged.length} of ${at.length} checkpoints differ: ${diverged.join('; ')}`
  );
}

// ---------------------------------------------------------------------------------------------------------
// Replay file
// ---------------------------------------------------------------------------------------------------------

/** Event names usable in `invariants.minEvents`: the keys of EV. */
export type EventName = keyof typeof EV;

export const EVENT_NAMES = Object.keys(EV) as EventName[];

/**
 * Replay invariants (§18.3). All optional; the runner checks each one present over the whole replay.
 * - minScore, minLitterCollected: need scoring and litter (M2). The M1 runner refuses them (fails loudly).
 * - hpMin: Bessie's HP at the end of every tick is ≥ hpMin.
 * - maxSolidOverlapM: Bessie's body OBB never penetrates a merged solid rect, or the map boundary, deeper
 *   than this many metres at the end of any tick (0.001 is the M1 value: resolution leaves a hairline).
 * - minEvents: per EV name, at least this many events over the whole replay.
 */
export type ReplayInvariants = {
  minScore?: number;
  minLitterCollected?: number;
  hpMin?: number;
  maxSolidOverlapM?: number;
  minEvents?: { [name in EventName]?: number };
};

/** A replay file (tests/replay/replays/<name>.json). */
export type ReplayFile = {
  format: typeof REPLAY_FORMAT;
  version: typeof REPLAY_VERSION;
  district: string;
  seed: number;
  ticks: number;
  /** base64 RLE of the input log (encodeInputs). */
  inputs: string;
  /** Checkpoint tick → 8-hex hash: every checkpointTicks(ticks) entry, or empty when not yet recorded. */
  checkpoints: { [tick: string]: string };
  invariants: ReplayInvariants;
};

const FILE_KEYS = ['format', 'version', 'district', 'seed', 'ticks', 'inputs', 'checkpoints', 'invariants'];
const INVARIANT_KEYS = ['minScore', 'minLitterCollected', 'hpMin', 'maxSolidOverlapM', 'minEvents'];

function failFile(path: string, message: string): never {
  throw new Error(`replay: ${path} ${message}`);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(
  value: unknown,
  path: string,
  allowed: readonly string[],
  required: readonly string[],
): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) failFile(path, 'must be an object');
  for (const key of required) if (!Object.hasOwn(value, key)) failFile(`${path}.${key}`, 'is missing');
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) failFile(path, `has unknown key ${JSON.stringify(key)}`);
  }
  return value;
}

function finiteNumber(value: unknown, path: string, min: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min) {
    failFile(path, `must be a finite number ≥ ${min}, got ${JSON.stringify(value)}`);
  }
  return value;
}

function nonNegativeInt(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    failFile(path, `must be a non-negative integer, got ${JSON.stringify(value)}`);
  }
  return value;
}

function parseInvariants(value: unknown): ReplayInvariants {
  const raw = exactKeys(value, 'invariants', INVARIANT_KEYS, []);
  const out: ReplayInvariants = {};
  if (raw.minScore !== undefined) out.minScore = finiteNumber(raw.minScore, 'invariants.minScore', 0);
  if (raw.minLitterCollected !== undefined)
    out.minLitterCollected = nonNegativeInt(raw.minLitterCollected, 'invariants.minLitterCollected');
  if (raw.hpMin !== undefined) out.hpMin = finiteNumber(raw.hpMin, 'invariants.hpMin', 0);
  if (raw.maxSolidOverlapM !== undefined)
    out.maxSolidOverlapM = finiteNumber(raw.maxSolidOverlapM, 'invariants.maxSolidOverlapM', 0);
  if (raw.minEvents !== undefined) {
    const events = exactKeys(raw.minEvents, 'invariants.minEvents', EVENT_NAMES, []);
    const minEvents: { [name in EventName]?: number } = {};
    for (const name of EVENT_NAMES) {
      if (events[name] !== undefined)
        minEvents[name] = nonNegativeInt(events[name], `invariants.minEvents.${name}`);
    }
    out.minEvents = minEvents;
  }
  return out;
}

/** A parsed replay file and its decoded input log. */
export type LoadedReplay = { readonly file: ReplayFile; readonly log: InputLog };

/**
 * Validate a replay file (the JSON text or its parsed value) and decode its inputs. Throws a descriptive
 * error on the first problem: wrong format or version, an unknown key, a malformed district id, seed or
 * tick count, undecodable inputs, or checkpoints that are neither empty nor exactly checkpointTicks(ticks).
 */
export function loadReplay(input: unknown): LoadedReplay {
  let parsed: unknown = input;
  if (typeof input === 'string') {
    try {
      parsed = JSON.parse(input);
    } catch (error) {
      throw new Error(`replay: not valid JSON (${String(error)})`);
    }
  }
  const raw = exactKeys(parsed, '(root)', FILE_KEYS, FILE_KEYS);
  if (raw.format !== REPLAY_FORMAT) failFile('format', `must be ${JSON.stringify(REPLAY_FORMAT)}`);
  if (raw.version !== REPLAY_VERSION)
    failFile('version', `must be ${REPLAY_VERSION}, got ${String(raw.version)}`);
  const district = raw.district;
  if (typeof district !== 'string' || !DISTRICT_ID_PATTERN.test(district)) {
    failFile('district', `must match ${DISTRICT_ID_PATTERN}, got ${JSON.stringify(district)}`);
  }
  const seed = raw.seed;
  if (typeof seed !== 'number' || !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    failFile('seed', `must be a uint32, got ${JSON.stringify(seed)}`);
  }
  const ticks = raw.ticks;
  if (typeof ticks !== 'number' || !Number.isInteger(ticks) || ticks < 1 || ticks > MAX_REPLAY_TICKS) {
    failFile('ticks', `must be an integer in 1..${MAX_REPLAY_TICKS}, got ${JSON.stringify(ticks)}`);
  }
  if (typeof raw.inputs !== 'string') failFile('inputs', 'must be a base64 string');
  const log = decodeInputs(raw.inputs, ticks);
  const rawCheckpoints = raw.checkpoints;
  if (!isRecord(rawCheckpoints)) failFile('checkpoints', 'must be an object');
  const checkpoints: { [tick: string]: string } = {};
  if (Object.keys(rawCheckpoints).length > 0) {
    const keys = checkpointTicks(ticks).map(String);
    const cps = exactKeys(rawCheckpoints, 'checkpoints', keys, keys);
    for (const key of keys) {
      const hash = cps[key];
      if (typeof hash !== 'string' || !HASH_HEX_PATTERN.test(hash)) {
        failFile(`checkpoints.${key}`, `must be 8 lowercase hex characters, got ${JSON.stringify(hash)}`);
      }
      checkpoints[key] = hash;
    }
  }
  const file: ReplayFile = {
    format: REPLAY_FORMAT,
    version: REPLAY_VERSION,
    district,
    seed,
    ticks,
    inputs: raw.inputs,
    checkpoints,
    invariants: parseInvariants(raw.invariants),
  };
  return { file, log };
}

/** True when the file carries recorded checkpoint hashes. */
export function hasCheckpoints(file: ReplayFile): boolean {
  return Object.keys(file.checkpoints).length > 0;
}

/** The replay file as JSON text: fixed key order, 2-space indent, trailing newline. */
export function serialiseReplay(file: ReplayFile): string {
  const checkpoints: { [tick: string]: string } = {};
  for (const tick of checkpointTicks(file.ticks)) {
    const hash = file.checkpoints[String(tick)];
    if (hash !== undefined) checkpoints[String(tick)] = hash;
  }
  const invariants: { [key: string]: unknown } = {};
  for (const key of INVARIANT_KEYS) {
    const value = file.invariants[key as keyof ReplayInvariants];
    if (value === undefined) continue;
    if (key === 'minEvents' && typeof value === 'object') {
      // Canonical order: EV order, whatever order the caller built the object in.
      const minEvents: { [name: string]: number } = {};
      for (const name of EVENT_NAMES) {
        const count = value[name];
        if (count !== undefined) minEvents[name] = count;
      }
      invariants[key] = minEvents;
    } else {
      invariants[key] = value;
    }
  }
  const ordered = {
    format: file.format,
    version: file.version,
    district: file.district,
    seed: file.seed,
    ticks: file.ticks,
    inputs: file.inputs,
    checkpoints,
    invariants,
  };
  return `${JSON.stringify(ordered, null, 2)}\n`;
}

/**
 * Build a complete replay file from a recorded log: runs it headlessly on (level, tuning, seed) and records
 * the checkpoint hashes. The dev panel's Save replay (SSP-048) and scripted generators (SSP-049) use this.
 */
export function recordReplay(
  level: Level,
  tuning: Tuning,
  district: string,
  seed: number,
  log: InputLog,
  invariants: ReplayInvariants = {},
): ReplayFile {
  if (!DISTRICT_ID_PATTERN.test(district)) failFile('district', `must match ${DISTRICT_ID_PATTERN}`);
  const ticks = log.length;
  const run = runReplay(level, tuning, seed, log, ticks);
  return {
    format: REPLAY_FORMAT,
    version: REPLAY_VERSION,
    district,
    seed: seed >>> 0,
    ticks,
    inputs: encodeInputs(log),
    checkpoints: { ...run.checkpoints },
    invariants,
  };
}
