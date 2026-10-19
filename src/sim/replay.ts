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
import { EV, ShiftEndReason } from './eventQueue.ts';
import { BRAKE_MAX, createInputFrame, type InputFrame, STEER_MAX, THROTTLE_MAX } from './inputFrame.ts';
import type { Level } from './map.ts';
import { NPC_PATH_NODES } from './npc/store.ts';
import { FNV1A32_OFFSET, FNV1A32_PRIME } from './rng.ts';
import { BOX_SLOTS } from './traffic.ts';
import type { Tuning } from './tuning.ts';
import { VEHICLE_PLAN_EDGES } from './vehicleStore.ts';
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

/** Words in a hasher's buffer (absorbTick). */
const HASH_WORDS = 4096;

/**
 * The running FNV-1a hash of one run. state[0] holds it as an Int32 (so it never boxes); state[1] is 1 once
 * the hasher has absorbed the whole grime mask (absorbTick), 0 before. `words` is absorbTick's buffer.
 */
export type StateHasher = { readonly state: Int32Array; readonly words: Int32Array };

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
  const hasher: StateHasher = { state: new Int32Array(2), words: new Int32Array(HASH_WORDS) };
  resetStateHasher(hasher, seed);
  return hasher;
}

/** Restart `hasher` for a new run with `seed`. */
export function resetStateHasher(hasher: StateHasher, seed: number): void {
  let h = FNV_OFFSET;
  h = fnvInt32(h, REPLAY_VERSION);
  h = fnvInt32(h, seed | 0);
  hasher.state[0] = h;
  hasher.state[1] = 0;
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
 *   I hazards.count, hazards.hazardsSpawned, then per hazard: I kind, col0, row0, col1, row1, flags (SSP-093)
 *   I litter.count, litter.litterSpawned, litter.litterCollected, then per item: F x, y; I kind, flags, rot
 *     (SSP-093), then (SSP-065) F prevX, prevY, vx, vy; I arcT, arcDur; F arcX0, arcY0, arcX1, arcY1;
 *     I driftTicks, spawnTile
 *   SSP-065 appends the rest of the M2 state:
 *   I brush.state, brush.posTicks; F brush.rpmTicks, brush.suctionMult, brush.flingThresholdMps (I −1 when
 *     null); B brush.anyFlagged; I brush.rng a, b, c, counter; I eventsRng a, b, c, counter
 *   B hopper.full; F hopper.luDumpedTotal, luDumpedDepot; I hopper.drainSite; F hopper.drainStartLU;
 *     I hopper.drainTicks, drainTicksDone; F hopper.drainScheduledLU
 *   B water.sprayHeld, spraying, refilling; F water.coneApexX, coneApexY
 *   I stains.count, stainsSpawned, stainsCleaned, then per stain: F x, y; I kind, cleanTicks
 *   I dirt.initialCells, initialGutterCells, cleanedCells, cleanedGutterCells, tickCleanedCells,
 *     tickCleanedGutterCells; B dirt.kerbContact, kerbContactLeft, kerbContactRight;
 *     I dirt.dirtyMinX, dirtyMinY, dirtyMaxX, dirtyMaxY; then the grime mask (below)
 *   I scoring.score, itemPts, stainPts, grimePts, bonusPts, penaltyPts, kerbContactTicks, kerbHuggerAwards,
 *     pendingPenalties, pendingPenaltyPts; I combo.chain, multiplier, timerTicks, bestChain, refreshTicks
 *   I tidy.tidyPpm, stars, cleanSweeps, pledgesMet, then per frontage: I frontageCleanPpm, cleanSwept,
 *     pledgeMet, and its zone counters grimeInitial, grimeCleaned, litterSpawned, litterCollected
 *   I shift.phase, ticksRun, timerStartTick, ticksRemaining, knockOffTick, endReason, endTick, dumpState,
 *     dumpSite, holdTicks; F shift.drainLuDumpedAtStart; B shift.dumpNeedsRelease; I shift.dumpsCompleted
 *   SSP-080 appends the NPC state (npc/):
 *   I npc.count, npcsAdded, npcsRemoved, freeCount, then freeSlots[0..freeCount), then slotGen of every slot;
 *     then per NPC: I kind, state, stateTicks; F x, y, prevX, prevY, heading, speed; I targetNode, swap,
 *     flags; F radius; I origin, group, link; F seenDistM, pathGapM, pathEtaS; I perceivedTick, handleSlot
 *   I npcAi.rng a, b, c, counter; I stimuli.count, stimuli.delivered, then per queued stimulus: I type,
 *     target; F x, y, radiusM
 *   I spawner.perchPending, flocksPlaced, ambientSpawned, ambientRetired, ambientCount, then namedRemaining
 *     per named NPC, flockRemaining per flock spec and perchUsed per wall perch
 *   SSP-081 appends steering: per NPC, after handleSlot, F walkMps; I goalNode, pathLen, pathAt, crossEdge,
 *     navState, navTicks, then its path segment's pathLen nodes; and after the spawner I zebras.count, then
 *     each zebra's occupancy
 *   SSP-078 appends the complaints and the penalty log:
 *   I complaints.count, max; B complaints.twoToneHorn; F complaints.hornRadiusM; I complaints.maxHonks,
 *     windowTicks, noiseComplaints; B complaints.hornThisTick, hornCaught; I complaints.honks, honksCaught,
 *     noiseOffences, honkCount, then the window's honk ticks oldest first; I penalties.count, penalties.applied
 *   SSP-092 appends the knockable bodies:
 *   I bodies.count, knocks, bodiesKnocked, itemsSpilled, penaltyPts, then per body: I kind, flags, rearmTicks;
 *     F x, y, heading, prevX, prevY, prevHeading, vx, vy, omega
 *   SSP-082 appends the reaction model (npc/reactions.ts): F reactions.awarenessRadiusM; B ledBeacon;
 *     F minClosingSpeedMps; I ignoreTicks, hiVisUntilTick, hits, bumps; then per NPC: I contactIgnore, stateLimit
 *   SSP-089 appends the traffic (vehicleStore.ts, traffic.ts):
 *   I vehicles.count, vehiclesAdded, vehiclesRemoved, parkedCount, then per vehicle: I uid, kind, state,
 *     stateTicks, flags; F x, y, heading, prevX, prevY, prevHeading, speed, halfWidth, halfLength, along;
 *     I routeAt, blocker, blockerIndex; F gapM; I blockTicks, clearTicks, honks, rageFiled, dwellLeft,
 *     servedStop, box0, box1, planLen, then its planLen plan edges
 *   I traffic.rng a, b, c, counter; I nextBusTick, busesDue, busesSpawned, carHorns, roadRageOffences, then per
 *     junction box its claim and claim edge and per slot its holder and holder edge
 *   SSP-083 appends the behaviour timers: per NPC, after stateLimit, I timerA, timerB (SSP-084's litterbug keeps
 *     his drop countdown in timerA, so it adds no field)
 *   SSP-095 appends the dust and the street-life rules: I dust.count, cloudsEmitted, waitLeft, waitRight, then
 *     per live cloud oldest first F x, y; I bornTick; I reactions.nearMisses, coughs; then per NPC: I nearMiss;
 *     F nearMissD2; I dustTicks
 *
 * The grime mask: the first tick a hasher absorbs (state[1] is 0) absorbs the whole mask, as little-endian
 * Int32 words (the mask is a whole number of words: its width is tiles × 8); every tick then absorbs the
 * bytes of that tick's dirty rectangle (row-major, each byte as an Int32), which holds every cell the tick
 * changed (dirt.ts). So the stream determines the mask after every tick, at the cost of a few hundred cells a
 * tick instead of the whole mask (196,608 bytes for Puddle Lane, 786,432 for the Civic Quarter).
 *
 * Not hashed: world.surface (phase 2 resamples it from the pose every tick) and per-tick scratch that the
 * pose determines (query boxes and hit lists, the water and shift axes, the vehicles' OBB corners and spatial
 * lookup buckets). Every new store field joins this
 * list, appended, in the commit that adds it; that commit re-records the replay hashes. Allocation-free:
 * floats are quantised in place into the hasher's Int32 word buffer, and only the hasher, the World and small
 * integers cross a call (see mixWords).
 */
export function absorbTick(hasher: StateHasher, world: World): void {
  const w = hasher.words;
  const q = HASH_QUANTUM;
  const v = world.vehicle;
  const input = world.input;
  w[0] = world.tick | 0;
  w[1] = input.throttle | 0;
  w[2] = input.brake | 0;
  w[3] = input.steer | 0;
  w[4] = input.buttons | 0;
  w[5] = input.pressed | 0;
  w[6] = Math.round(v.xM * q) | 0;
  w[7] = Math.round(v.yM * q) | 0;
  w[8] = Math.round(v.headingRad * q) | 0;
  w[9] = Math.round(v.prevXM * q) | 0;
  w[10] = Math.round(v.prevYM * q) | 0;
  w[11] = Math.round(v.prevHeadingRad * q) | 0;
  w[12] = Math.round(v.vLongMps * q) | 0;
  w[13] = Math.round(v.vLatMps * q) | 0;
  w[14] = Math.round(v.steerRad * q) | 0;
  w[15] = Math.round(v.yawRateRadPerS * q) | 0;
  w[16] = v.gear | 0;
  w[17] = v.brushDown ? 1 : 0;
  w[18] = Math.round(v.brushPos * q) | 0;
  w[19] = Math.round(v.rpm * q) | 0;
  w[20] = Math.round(v.hp * q) | 0;
  w[21] = Math.round(v.hopperLU * q) | 0;
  w[22] = Math.round(v.water * q) | 0;
  w[23] = Math.round(v.massKg * q) | 0;
  w[24] = v.reverseHoldTicks | 0;
  w[25] = v.reverseEngaged ? 1 : 0;
  mixWords(hasher, 26);
  absorbEvents(hasher, world);
  absorbHazards(hasher, world);
  absorbLitter(hasher, world);
  absorbBrushHopperWater(hasher, world);
  absorbStains(hasher, world);
  absorbDirt(hasher, world);
  absorbScoring(hasher, world);
  absorbShift(hasher, world);
  absorbNpcs(hasher, world);
  absorbComplaints(hasher, world);
  absorbBodies(hasher, world);
  absorbReactions(hasher, world);
  absorbTraffic(hasher, world);
  absorbStreetLife(hasher, world);
}

// absorbTick writes each section's Int32 words into the hasher's word buffer and mixes them in with mixWords,
// so the FNV-1a step runs in one small loop instead of hundreds of inlined call sites: a big function whose
// fnvInt32 calls V8 stopped inlining (its inlining budget is per function) passed the running hash across
// those calls, and a hash value outside the small-integer range boxed on every one (SSP-065 heap check). Only
// the hasher and the World cross these calls. Each section flushes before its buffer could overflow.

/** Mix words[0..n) into the running hash, in order. */
function mixWords(hasher: StateHasher, n: number): void {
  const w = hasher.words;
  let h = hasher.state[0] as number;
  for (let i = 0; i < n; i += 1) {
    const x = w[i] as number;
    h = Math.imul(h ^ (x & 0xff), FNV_PRIME);
    h = Math.imul(h ^ ((x >>> 8) & 0xff), FNV_PRIME);
    h = Math.imul(h ^ ((x >>> 16) & 0xff), FNV_PRIME);
    h = Math.imul(h ^ (x >>> 24), FNV_PRIME);
  }
  hasher.state[0] = h;
}

/**
 * Words a section may write after its last flush check (the longest per-entity records are an NPC's: 28 words
 * plus its path segment, up to NPC_PATH_NODES = 32 more, since SSP-081; and a vehicle's: 28 words plus its
 * plan, up to VEHICLE_PLAN_EDGES = 32 more, since SSP-089).
 */
const SECTION_SLACK = 64;
const FLUSH_AT = HASH_WORDS - SECTION_SLACK;

function absorbEvents(hasher: StateHasher, world: World): void {
  const w = hasher.words;
  const q = HASH_QUANTUM;
  const events = world.events;
  const n = events.count;
  w[0] = n | 0;
  let k = 1;
  for (let i = 0; i < n; i += 1) {
    if (k > FLUSH_AT) {
      mixWords(hasher, k);
      k = 0;
    }
    w[k] = (events.type[i] as number) | 0;
    w[k + 1] = (events.entity[i] as number) | 0;
    w[k + 2] = Math.round((events.a[i] as number) * q) | 0;
    w[k + 3] = Math.round((events.b[i] as number) * q) | 0;
    w[k + 4] = Math.round((events.c[i] as number) * q) | 0;
    k += 5;
  }
  mixWords(hasher, k);
}

function absorbHazards(hasher: StateHasher, world: World): void {
  const w = hasher.words;
  const hz = world.hazards;
  const n = hz.count;
  w[0] = n | 0;
  w[1] = hz.hazardsSpawned | 0;
  let k = 2;
  for (let i = 0; i < n; i += 1) {
    if (k > FLUSH_AT) {
      mixWords(hasher, k);
      k = 0;
    }
    w[k] = (hz.kind[i] as number) | 0;
    w[k + 1] = (hz.col0[i] as number) | 0;
    w[k + 2] = (hz.row0[i] as number) | 0;
    w[k + 3] = (hz.col1[i] as number) | 0;
    w[k + 4] = (hz.row1[i] as number) | 0;
    w[k + 5] = (hz.flags[i] as number) | 0;
    k += 6;
  }
  mixWords(hasher, k);
}

function absorbLitter(hasher: StateHasher, world: World): void {
  const w = hasher.words;
  const q = HASH_QUANTUM;
  const lf = world.litter;
  const n = lf.count;
  w[0] = n | 0;
  w[1] = lf.litterSpawned | 0;
  w[2] = lf.litterCollected | 0;
  let k = 3;
  for (let i = 0; i < n; i += 1) {
    if (k > FLUSH_AT) {
      mixWords(hasher, k);
      k = 0;
    }
    w[k] = Math.round((lf.x[i] as number) * q) | 0;
    w[k + 1] = Math.round((lf.y[i] as number) * q) | 0;
    w[k + 2] = (lf.kind[i] as number) | 0;
    w[k + 3] = (lf.flags[i] as number) | 0;
    w[k + 4] = (lf.rot[i] as number) | 0;
    w[k + 5] = Math.round((lf.prevX[i] as number) * q) | 0;
    w[k + 6] = Math.round((lf.prevY[i] as number) * q) | 0;
    w[k + 7] = Math.round((lf.vx[i] as number) * q) | 0;
    w[k + 8] = Math.round((lf.vy[i] as number) * q) | 0;
    w[k + 9] = (lf.arcT[i] as number) | 0;
    w[k + 10] = (lf.arcDur[i] as number) | 0;
    w[k + 11] = Math.round((lf.arcX0[i] as number) * q) | 0;
    w[k + 12] = Math.round((lf.arcY0[i] as number) * q) | 0;
    w[k + 13] = Math.round((lf.arcX1[i] as number) * q) | 0;
    w[k + 14] = Math.round((lf.arcY1[i] as number) * q) | 0;
    w[k + 15] = (lf.driftTicks[i] as number) | 0;
    w[k + 16] = (lf.spawnTile[i] as number) | 0;
    k += 17;
  }
  mixWords(hasher, k);
}

function absorbBrushHopperWater(hasher: StateHasher, world: World): void {
  const w = hasher.words;
  const q = HASH_QUANTUM;
  const b = world.brush;
  w[0] = b.state | 0;
  w[1] = b.posTicks | 0;
  w[2] = Math.round(b.rpmTicks * q) | 0;
  w[3] = Math.round(b.suctionMult * q) | 0;
  const t0 = b.flingThresholdMps;
  w[4] = t0 === null ? -1 : Math.round(t0 * q) | 0;
  w[5] = b.anyFlagged ? 1 : 0;
  const r = b.rng;
  w[6] = r.a | 0;
  w[7] = r.b | 0;
  w[8] = r.c | 0;
  w[9] = r.counter | 0;
  const e = world.eventsRng;
  w[10] = e.a | 0;
  w[11] = e.b | 0;
  w[12] = e.c | 0;
  w[13] = e.counter | 0;
  const hp = world.hopper;
  w[14] = hp.full ? 1 : 0;
  w[15] = Math.round(hp.luDumpedTotal * q) | 0;
  w[16] = Math.round(hp.luDumpedDepot * q) | 0;
  w[17] = hp.drainSite | 0;
  w[18] = Math.round(hp.drainStartLU * q) | 0;
  w[19] = hp.drainTicks | 0;
  w[20] = hp.drainTicksDone | 0;
  w[21] = Math.round(hp.drainScheduledLU * q) | 0;
  const wa = world.water;
  w[22] = wa.sprayHeld ? 1 : 0;
  w[23] = wa.spraying ? 1 : 0;
  w[24] = wa.refilling ? 1 : 0;
  w[25] = Math.round(wa.coneApexX * q) | 0;
  w[26] = Math.round(wa.coneApexY * q) | 0;
  mixWords(hasher, 27);
}

function absorbStains(hasher: StateHasher, world: World): void {
  const w = hasher.words;
  const q = HASH_QUANTUM;
  const st = world.stains;
  const n = st.count;
  w[0] = n | 0;
  w[1] = st.stainsSpawned | 0;
  w[2] = st.stainsCleaned | 0;
  let k = 3;
  for (let i = 0; i < n; i += 1) {
    if (k > FLUSH_AT) {
      mixWords(hasher, k);
      k = 0;
    }
    w[k] = Math.round((st.x[i] as number) * q) | 0;
    w[k + 1] = Math.round((st.y[i] as number) * q) | 0;
    w[k + 2] = (st.kind[i] as number) | 0;
    w[k + 3] = (st.cleanTicks[i] as number) | 0;
    k += 4;
  }
  mixWords(hasher, k);
}

function absorbDirt(hasher: StateHasher, world: World): void {
  const w = hasher.words;
  const d = world.dirt;
  const x0 = d.dirtyMinX | 0;
  const y0 = d.dirtyMinY | 0;
  const x1 = d.dirtyMaxX | 0;
  const y1 = d.dirtyMaxY | 0;
  w[0] = d.initialCells | 0;
  w[1] = d.initialGutterCells | 0;
  w[2] = d.cleanedCells | 0;
  w[3] = d.cleanedGutterCells | 0;
  w[4] = d.tickCleanedCells | 0;
  w[5] = d.tickCleanedGutterCells | 0;
  w[6] = d.kerbContact ? 1 : 0;
  w[7] = d.kerbContactLeft ? 1 : 0;
  w[8] = d.kerbContactRight ? 1 : 0;
  w[9] = x0;
  w[10] = y0;
  w[11] = x1;
  w[12] = y1;
  let k = 13;
  const mask = d.mask;
  if ((hasher.state[1] as number) === 0) {
    // The whole mask, once per hasher, as little-endian Int32 words (its length is a multiple of 8).
    const n = mask.length;
    for (let i = 0; i < n; i += 4) {
      if (k > FLUSH_AT) {
        mixWords(hasher, k);
        k = 0;
      }
      w[k] =
        (mask[i] as number) |
        ((mask[i + 1] as number) << 8) |
        ((mask[i + 2] as number) << 16) |
        ((mask[i + 3] as number) << 24);
      k += 1;
    }
    hasher.state[1] = 1;
  }
  // The dirty rectangle (empty when x1 < x0), each byte as a word.
  const maskW = d.maskW | 0;
  for (let y = y0; y <= y1; y += 1) {
    const row = y * maskW;
    for (let x = x0; x <= x1; x += 1) {
      if (k > FLUSH_AT) {
        mixWords(hasher, k);
        k = 0;
      }
      w[k] = (mask[row + x] as number) | 0;
      k += 1;
    }
  }
  mixWords(hasher, k);
}

function absorbScoring(hasher: StateHasher, world: World): void {
  const w = hasher.words;
  const s = world.scoring;
  const c = s.combo;
  const t = world.tidy;
  w[0] = s.score | 0;
  w[1] = s.itemPts | 0;
  w[2] = s.stainPts | 0;
  w[3] = s.grimePts | 0;
  w[4] = s.bonusPts | 0;
  w[5] = s.penaltyPts | 0;
  w[6] = s.kerbContactTicks | 0;
  w[7] = s.kerbHuggerAwards | 0;
  w[8] = s.pendingPenalties | 0;
  w[9] = s.pendingPenaltyPts | 0;
  w[10] = c.chain | 0;
  w[11] = c.multiplier | 0;
  w[12] = c.timerTicks | 0;
  w[13] = c.bestChain | 0;
  w[14] = c.refreshTicks | 0;
  w[15] = t.tidyPpm | 0;
  w[16] = t.stars | 0;
  w[17] = t.cleanSweeps | 0;
  w[18] = t.pledgesMet | 0;
  let k = 19;
  const z = t.zones;
  const n = t.frontageCount;
  for (let i = 0; i < n; i += 1) {
    if (k > FLUSH_AT) {
      mixWords(hasher, k);
      k = 0;
    }
    w[k] = (t.frontageCleanPpm[i] as number) | 0;
    w[k + 1] = (t.cleanSwept[i] as number) | 0;
    w[k + 2] = (t.pledgeMet[i] as number) | 0;
    w[k + 3] = (z.grimeInitial[i] as number) | 0;
    w[k + 4] = (z.grimeCleaned[i] as number) | 0;
    w[k + 5] = (z.litterSpawned[i] as number) | 0;
    w[k + 6] = (z.litterCollected[i] as number) | 0;
    k += 7;
  }
  mixWords(hasher, k);
}

function absorbShift(hasher: StateHasher, world: World): void {
  const w = hasher.words;
  const sh = world.shift;
  w[0] = sh.phase | 0;
  w[1] = sh.ticksRun | 0;
  w[2] = sh.timerStartTick | 0;
  w[3] = sh.ticksRemaining | 0;
  w[4] = sh.knockOffTick | 0;
  w[5] = sh.endReason | 0;
  w[6] = sh.endTick | 0;
  w[7] = sh.dumpState | 0;
  w[8] = sh.dumpSite | 0;
  w[9] = sh.holdTicks | 0;
  w[10] = Math.round(sh.drainLuDumpedAtStart * HASH_QUANTUM) | 0;
  w[11] = sh.dumpNeedsRelease ? 1 : 0;
  w[12] = sh.dumpsCompleted | 0;
  mixWords(hasher, 13);
}

function absorbNpcs(hasher: StateHasher, world: World): void {
  const w = hasher.words;
  const q = HASH_QUANTUM;
  const npc = world.npc;
  const n = npc.count;
  w[0] = n | 0;
  w[1] = npc.npcsAdded | 0;
  w[2] = npc.npcsRemoved | 0;
  w[3] = npc.freeCount | 0;
  let k = 4;
  for (let s = 0; s < npc.freeCount; s += 1) {
    w[k] = (npc.freeSlots[s] as number) | 0;
    k += 1;
  }
  for (let s = 0; s < npc.capacity; s += 1) {
    if (k > FLUSH_AT) {
      mixWords(hasher, k);
      k = 0;
    }
    w[k] = (npc.slotGen[s] as number) | 0;
    k += 1;
  }
  for (let i = 0; i < n; i += 1) {
    if (k > FLUSH_AT) {
      mixWords(hasher, k);
      k = 0;
    }
    w[k] = (npc.kind[i] as number) | 0;
    w[k + 1] = (npc.state[i] as number) | 0;
    w[k + 2] = (npc.stateTicks[i] as number) | 0;
    w[k + 3] = Math.round((npc.x[i] as number) * q) | 0;
    w[k + 4] = Math.round((npc.y[i] as number) * q) | 0;
    w[k + 5] = Math.round((npc.prevX[i] as number) * q) | 0;
    w[k + 6] = Math.round((npc.prevY[i] as number) * q) | 0;
    w[k + 7] = Math.round((npc.heading[i] as number) * q) | 0;
    w[k + 8] = Math.round((npc.speed[i] as number) * q) | 0;
    w[k + 9] = (npc.targetNode[i] as number) | 0;
    w[k + 10] = (npc.swap[i] as number) | 0;
    w[k + 11] = (npc.flags[i] as number) | 0;
    w[k + 12] = Math.round((npc.radius[i] as number) * q) | 0;
    w[k + 13] = (npc.origin[i] as number) | 0;
    w[k + 14] = (npc.group[i] as number) | 0;
    w[k + 15] = (npc.link[i] as number) | 0;
    w[k + 16] = Math.round((npc.seenDistM[i] as number) * q) | 0;
    w[k + 17] = Math.round((npc.pathGapM[i] as number) * q) | 0;
    w[k + 18] = Math.round((npc.pathEtaS[i] as number) * q) | 0;
    w[k + 19] = (npc.perceivedTick[i] as number) | 0;
    w[k + 20] = (npc.handleSlot[i] as number) | 0;
    // SSP-081: steering.
    w[k + 21] = Math.round((npc.walkMps[i] as number) * q) | 0;
    w[k + 22] = (npc.goalNode[i] as number) | 0;
    w[k + 23] = (npc.pathLen[i] as number) | 0;
    w[k + 24] = (npc.pathAt[i] as number) | 0;
    w[k + 25] = (npc.crossEdge[i] as number) | 0;
    w[k + 26] = (npc.navState[i] as number) | 0;
    w[k + 27] = (npc.navTicks[i] as number) | 0;
    k += 28;
    const len = npc.pathLen[i] as number;
    const base = i * NPC_PATH_NODES;
    for (let p = 0; p < len; p += 1) w[k + p] = (npc.path[base + p] as number) | 0;
    k += len;
  }
  mixWords(hasher, k);
  const ai = world.npcAi;
  const r = ai.rng;
  const st = ai.stimuli;
  w[0] = r.a | 0;
  w[1] = r.b | 0;
  w[2] = r.c | 0;
  w[3] = r.counter | 0;
  w[4] = st.count | 0;
  w[5] = st.delivered | 0;
  k = 6;
  for (let s = 0; s < st.count; s += 1) {
    if (k > FLUSH_AT) {
      mixWords(hasher, k);
      k = 0;
    }
    w[k] = (st.type[s] as number) | 0;
    w[k + 1] = (st.target[s] as number) | 0;
    w[k + 2] = Math.round((st.x[s] as number) * q) | 0;
    w[k + 3] = Math.round((st.y[s] as number) * q) | 0;
    w[k + 4] = Math.round((st.radiusM[s] as number) * q) | 0;
    k += 5;
  }
  mixWords(hasher, k);
  const sp = ai.spawner;
  w[0] = sp.perchPending | 0;
  w[1] = sp.flocksPlaced | 0;
  w[2] = sp.ambientSpawned | 0;
  w[3] = sp.ambientRetired | 0;
  w[4] = sp.ambientCount | 0;
  k = 5;
  for (let s = 0; s < sp.namedCount; s += 1) {
    if (k > FLUSH_AT) {
      mixWords(hasher, k);
      k = 0;
    }
    w[k] = (sp.namedRemaining[s] as number) | 0;
    k += 1;
  }
  for (let s = 0; s < sp.flockSpecCount; s += 1) {
    if (k > FLUSH_AT) {
      mixWords(hasher, k);
      k = 0;
    }
    w[k] = (sp.flockRemaining[s] as number) | 0;
    k += 1;
  }
  for (let s = 0; s < sp.perchCount; s += 1) {
    if (k > FLUSH_AT) {
      mixWords(hasher, k);
      k = 0;
    }
    w[k] = (sp.perchUsed[s] as number) | 0;
    k += 1;
  }
  // SSP-081: the zebras' occupancy.
  const z = world.zebras;
  if (k > FLUSH_AT) {
    mixWords(hasher, k);
    k = 0;
  }
  w[k] = z.count | 0;
  k += 1;
  for (let s = 0; s < z.count; s += 1) {
    if (k > FLUSH_AT) {
      mixWords(hasher, k);
      k = 0;
    }
    w[k] = (z.occupancy[s] as number) | 0;
    k += 1;
  }
  mixWords(hasher, k);
}

function absorbComplaints(hasher: StateHasher, world: World): void {
  const w = hasher.words;
  const c = world.complaints;
  const p = world.penalties;
  w[0] = c.count | 0;
  w[1] = c.max | 0;
  w[2] = c.twoToneHorn ? 1 : 0;
  w[3] = Math.round(c.hornRadiusM * HASH_QUANTUM) | 0;
  w[4] = c.maxHonks | 0;
  w[5] = c.windowTicks | 0;
  w[6] = c.noiseComplaints | 0;
  w[7] = c.hornThisTick ? 1 : 0;
  w[8] = c.hornCaught ? 1 : 0;
  w[9] = c.honks | 0;
  w[10] = c.honksCaught | 0;
  w[11] = c.noiseOffences | 0;
  w[12] = c.honkCount | 0;
  let k = 13;
  const ring = c.honkTicks;
  const n = c.honkCount;
  for (let i = 0; i < n; i += 1) {
    if (k > FLUSH_AT) {
      mixWords(hasher, k);
      k = 0;
    }
    w[k] = (ring[(c.honkHead + i) % ring.length] as number) | 0;
    k += 1;
  }
  w[k] = p.count | 0;
  w[k + 1] = p.applied | 0;
  mixWords(hasher, k + 2);
}

function absorbBodies(hasher: StateHasher, world: World): void {
  const w = hasher.words;
  const q = HASH_QUANTUM;
  const b = world.bodies;
  const n = b.count;
  w[0] = n | 0;
  w[1] = b.knocks | 0;
  w[2] = b.bodiesKnocked | 0;
  w[3] = b.itemsSpilled | 0;
  w[4] = b.penaltyPts | 0;
  let k = 5;
  for (let i = 0; i < n; i += 1) {
    if (k > FLUSH_AT) {
      mixWords(hasher, k);
      k = 0;
    }
    w[k] = (b.kind[i] as number) | 0;
    w[k + 1] = (b.flags[i] as number) | 0;
    w[k + 2] = (b.rearmTicks[i] as number) | 0;
    w[k + 3] = Math.round((b.x[i] as number) * q) | 0;
    w[k + 4] = Math.round((b.y[i] as number) * q) | 0;
    w[k + 5] = Math.round((b.heading[i] as number) * q) | 0;
    w[k + 6] = Math.round((b.prevX[i] as number) * q) | 0;
    w[k + 7] = Math.round((b.prevY[i] as number) * q) | 0;
    w[k + 8] = Math.round((b.prevHeading[i] as number) * q) | 0;
    w[k + 9] = Math.round((b.vx[i] as number) * q) | 0;
    w[k + 10] = Math.round((b.vy[i] as number) * q) | 0;
    w[k + 11] = Math.round((b.omega[i] as number) * q) | 0;
    k += 12;
  }
  mixWords(hasher, k);
}

function absorbReactions(hasher: StateHasher, world: World): void {
  const w = hasher.words;
  const npc = world.npc;
  const r = world.npcAi.reactions;
  w[0] = Math.round(r.awarenessRadiusM * HASH_QUANTUM) | 0;
  w[1] = r.ledBeacon ? 1 : 0;
  w[2] = Math.round(r.minClosingSpeedMps * HASH_QUANTUM) | 0;
  w[3] = r.ignoreTicks | 0;
  w[4] = r.hiVisUntilTick | 0;
  w[5] = r.hits | 0;
  w[6] = r.bumps | 0;
  let k = 7;
  for (let i = 0; i < npc.count; i += 1) {
    if (k > FLUSH_AT) {
      mixWords(hasher, k);
      k = 0;
    }
    w[k] = (npc.contactIgnore[i] as number) | 0;
    w[k + 1] = (npc.stateLimit[i] as number) | 0;
    w[k + 2] = (npc.timerA[i] as number) | 0;
    w[k + 3] = (npc.timerB[i] as number) | 0;
    k += 4;
  }
  mixWords(hasher, k);
}

function absorbStreetLife(hasher: StateHasher, world: World): void {
  const w = hasher.words;
  const q = HASH_QUANTUM;
  const dust = world.dust;
  const npc = world.npc;
  const r = world.npcAi.reactions;
  w[0] = dust.count | 0;
  w[1] = dust.cloudsEmitted | 0;
  w[2] = dust.waitLeft | 0;
  w[3] = dust.waitRight | 0;
  let k = 4;
  for (let c = 0; c < dust.count; c += 1) {
    if (k > FLUSH_AT) {
      mixWords(hasher, k);
      k = 0;
    }
    const slot = (dust.head + c) % dust.capacity;
    w[k] = Math.round((dust.x[slot] as number) * q) | 0;
    w[k + 1] = Math.round((dust.y[slot] as number) * q) | 0;
    w[k + 2] = (dust.bornTick[slot] as number) | 0;
    k += 3;
  }
  w[k] = r.nearMisses | 0;
  w[k + 1] = r.coughs | 0;
  k += 2;
  for (let i = 0; i < npc.count; i += 1) {
    if (k > FLUSH_AT) {
      mixWords(hasher, k);
      k = 0;
    }
    w[k] = (npc.nearMiss[i] as number) | 0;
    w[k + 1] = Math.round((npc.nearMissD2[i] as number) * q) | 0;
    w[k + 2] = (npc.dustTicks[i] as number) | 0;
    k += 3;
  }
  mixWords(hasher, k);
}

function absorbTraffic(hasher: StateHasher, world: World): void {
  const w = hasher.words;
  const q = HASH_QUANTUM;
  const s = world.vehicles;
  w[0] = s.count | 0;
  w[1] = s.vehiclesAdded | 0;
  w[2] = s.vehiclesRemoved | 0;
  w[3] = s.parkedCount | 0;
  let k = 4;
  for (let i = 0; i < s.count; i += 1) {
    if (k > FLUSH_AT) {
      mixWords(hasher, k);
      k = 0;
    }
    w[k] = (s.uid[i] as number) | 0;
    w[k + 1] = (s.kind[i] as number) | 0;
    w[k + 2] = (s.state[i] as number) | 0;
    w[k + 3] = (s.stateTicks[i] as number) | 0;
    w[k + 4] = (s.flags[i] as number) | 0;
    w[k + 5] = Math.round((s.x[i] as number) * q) | 0;
    w[k + 6] = Math.round((s.y[i] as number) * q) | 0;
    w[k + 7] = Math.round((s.heading[i] as number) * q) | 0;
    w[k + 8] = Math.round((s.prevX[i] as number) * q) | 0;
    w[k + 9] = Math.round((s.prevY[i] as number) * q) | 0;
    w[k + 10] = Math.round((s.prevHeading[i] as number) * q) | 0;
    w[k + 11] = Math.round((s.speed[i] as number) * q) | 0;
    w[k + 12] = Math.round((s.halfWidth[i] as number) * q) | 0;
    w[k + 13] = Math.round((s.halfLength[i] as number) * q) | 0;
    w[k + 14] = Math.round((s.along[i] as number) * q) | 0;
    w[k + 15] = (s.routeAt[i] as number) | 0;
    w[k + 16] = (s.blocker[i] as number) | 0;
    w[k + 17] = (s.blockerIndex[i] as number) | 0;
    w[k + 18] = Math.round((s.gapM[i] as number) * q) | 0;
    w[k + 19] = (s.blockTicks[i] as number) | 0;
    w[k + 20] = (s.clearTicks[i] as number) | 0;
    w[k + 21] = (s.honks[i] as number) | 0;
    w[k + 22] = (s.rageFiled[i] as number) | 0;
    w[k + 23] = (s.dwellLeft[i] as number) | 0;
    w[k + 24] = (s.servedStop[i] as number) | 0;
    w[k + 25] = (s.box0[i] as number) | 0;
    w[k + 26] = (s.box1[i] as number) | 0;
    const len = s.planLen[i] as number;
    w[k + 27] = len | 0;
    k += 28;
    const base = i * VEHICLE_PLAN_EDGES;
    for (let p = 0; p < len; p += 1) w[k + p] = (s.plan[base + p] as number) | 0;
    k += len;
  }
  mixWords(hasher, k);
  const t = world.traffic;
  const r = t.rng;
  w[0] = r.a | 0;
  w[1] = r.b | 0;
  w[2] = r.c | 0;
  w[3] = r.counter | 0;
  w[4] = t.nextBusTick | 0;
  w[5] = t.busesDue | 0;
  w[6] = t.busesSpawned | 0;
  w[7] = t.carHorns | 0;
  w[8] = t.roadRageOffences | 0;
  k = 9;
  for (let b = 0; b < t.boxCount; b += 1) {
    if (k > FLUSH_AT) {
      mixWords(hasher, k);
      k = 0;
    }
    w[k] = (t.boxClaim[b] as number) | 0;
    w[k + 1] = (t.boxClaimEdge[b] as number) | 0;
    k += 2;
    for (let slot = 0; slot < BOX_SLOTS; slot += 1) {
      w[k] = (t.boxHolder[b * BOX_SLOTS + slot] as number) | 0;
      w[k + 1] = (t.boxHolderEdge[b * BOX_SLOTS + slot] as number) | 0;
      k += 2;
    }
  }
  mixWords(hasher, k);
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
 * the canonical environment (ROADMAP R-09); the same build gives the same hashes in Chromium. A checkpoint is
 * keyed by the number of step() calls made, not world.tick: once the shift has ended the World is frozen and
 * world.tick stops (SSP-079), while each further step still absorbs the frozen state into the running hash.
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
    if (t + 1 === at[next]) {
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
 * - minScore, minLitterCollected: the score and the litter collected at the end of the replay (SSP-065).
 * - hpMin: Bessie's HP at the end of every tick is ≥ hpMin.
 * - maxSolidOverlapM: Bessie's body OBB never penetrates a merged solid rect, or the map boundary, deeper
 *   than this many metres at the end of any tick (0.001 is the M1 value: resolution leaves a hairline).
 * - minEvents: per EV name, at least this many events over the whole replay.
 * - shiftEnded (SSP-072): the shift ended inside the replay with this reason (a ShiftEndReason name): exactly
 *   one EV.ShiftEnd, whose reason is this one. The full-shift replay asserts 'TimeUp'; SSP-107 records the
 *   'Sacked' and 'Towed' replays (SSP-079).
 * - minLuDumped (SSP-072): LU dumped over the replay (hopper.luDumpedTotal at the end) is at least the value.
 * - minDumpsCompleted (SSP-072): at least this many dumps drained to the end (EV.DumpEnd with c = 1).
 * - emptyAfterDump (SSP-072): every completed dump leaves the hopper at exactly 0 LU and, at a depot bay, the
 *   tank full (water = water.tankUnits) at the end of its DumpEnd tick.
 */
export type ReplayInvariants = {
  minScore?: number;
  minLitterCollected?: number;
  hpMin?: number;
  maxSolidOverlapM?: number;
  minEvents?: { [name in EventName]?: number };
  shiftEnded?: ShiftEndReasonName;
  minLuDumped?: number;
  minDumpsCompleted?: number;
  emptyAfterDump?: true;
};

/** Names usable in `invariants.shiftEnded`: the keys of ShiftEndReason. */
export type ShiftEndReasonName = keyof typeof ShiftEndReason;

export const SHIFT_END_REASON_NAMES = Object.keys(ShiftEndReason) as ShiftEndReasonName[];

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
const INVARIANT_KEYS = [
  'minScore',
  'minLitterCollected',
  'hpMin',
  'maxSolidOverlapM',
  'minEvents',
  'shiftEnded',
  'minLuDumped',
  'minDumpsCompleted',
  'emptyAfterDump',
];

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
  if (raw.shiftEnded !== undefined) {
    const reason = raw.shiftEnded;
    if (typeof reason !== 'string' || !(SHIFT_END_REASON_NAMES as readonly string[]).includes(reason)) {
      failFile(
        'invariants.shiftEnded',
        `must be one of ${SHIFT_END_REASON_NAMES.map((n) => JSON.stringify(n)).join(', ')}, got ${JSON.stringify(reason)}`,
      );
    }
    out.shiftEnded = reason as ShiftEndReasonName;
  }
  if (raw.minLuDumped !== undefined)
    out.minLuDumped = finiteNumber(raw.minLuDumped, 'invariants.minLuDumped', 0);
  if (raw.minDumpsCompleted !== undefined)
    out.minDumpsCompleted = nonNegativeInt(raw.minDumpsCompleted, 'invariants.minDumpsCompleted');
  if (raw.emptyAfterDump !== undefined) {
    if (raw.emptyAfterDump !== true) failFile('invariants.emptyAfterDump', 'must be true (or left out)');
    out.emptyAfterDump = true;
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
