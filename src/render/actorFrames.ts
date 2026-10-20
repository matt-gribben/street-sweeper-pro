// State-driven frames of the street's actors (ART_BIBLE §4.5, §10.2, §10.3; ENTITY_CATALOG §6.2, §7; SSP-103): which
// frame of `npc.*` and `veh.*` a renderer draws for an NPC or a vehicle, chosen from sim state only (the NPC's
// behaviour `state`, `stateTicks`, speed and position; the vehicle's heading), never from wall-clock time.
//
// Directions.
//   Humans, cats and dogs  8 sectors, n ne e se s sw w nw (index 0..7 clockwise from north, every direction a
//                          frame of its own: the mirrored SE, E and NE are separate generated frames), nearest
//                          45° sector with ACTOR_DIR_HYSTERESIS_RAD (10°) of hysteresis: an actor keeps the
//                          sector it was drawn in until its heading is more than 22.5° + 10° from that sector's
//                          centre, so steering jitter on a sector edge never flickers the sprite.
//   Pigeons                4 sectors, n e s w, nearest 90° (no hysteresis, ART_BIBLE §4.5).
//   Vehicles               the 32 headings h00..h31 (headings.ts), nearest with VEHICLE_HEADING_HYSTERESIS_RAD (2°).
// Heading 90° (east) is dir `e` and heading h08.
//
// Poses. frameFor(rig, state, stateTicks, moving, walkFrame, phase) returns a pose code: the animation (ActorAnim)
// times POSE_FRAMES plus the frame number. `stateTicks` is the NPC store's count as phase 7 leaves it (1 on the
// tick a state is entered), so t = stateTicks − 1 ticks have passed in the state. Timings (ART_BIBLE §10.2):
//   walk     distance-driven: frame floor(d / stride) mod 4, d the actor's drawn position projected on its drawn
//            direction's axis (walkFrameAt); so a walk advances exactly once per stride travelled along that axis
//            whatever the speed, and an actor standing still never steps. Strides: 0.30 m adults, 0.18 m Doris,
//            0.15 m the old man, 0.12 m the cat, 0.35 m the dog. A walking state with the actor at rest (waiting
//            at a kerb, held by its dog) plays idle instead (`moving` false: speed below WALK_MIN_MPS).
//   idle     2 frames × IDLE_TICKS_PER_FRAME (36), offset by the actor's seeded phase (actorPhase).
//   startle  frame 0 for STARTLE_HOP_TICKS (4), then frame 1 held.
//   fall     Fallen: frames 0, 1, 2 at FALL_FRAME_TICKS (5) each, then frame 2 held; GetUp: frames 1, 0 at 5.
//   angry    2 frames alternating every ANGRY_FRAME_TICKS (9).
//   cat      sit: frame 0 for 90 ticks, frame 1 for 12 (phased); dart: 3 ticks each; leap: squash 4, stretch
//            6, land 6 ticks (then held).
//   dog      sit: 30 ticks each (phased); bark: 6 ticks each.
//   pigeon   peck: frame 0 held 12–30 ticks (12 + phase mod 19, per bird), frame 1 for 6; fly: 0-1-2 at 4.
// State → animation, per rig (the behaviour modules' state tables):
//   Pedestrian (pedestrian.ts PED; every person kind)  Walk, Cross → walk; Idle, Yield → idle; Startle → startle;
//                      Fallen, GetUp → fall; Angry → angry.
//   Doris (oldWoman.ts DORIS)  PED's, plus Glare → idle frame 0 held (ENTITY_CATALOG §6.2 "idle = glare"; ART_BIBLE
//                      §10.2 "Doris's glare holds frame 0"); FistShake → angry; SlowWalk, Chase → walk (Chase at
//                      her stride, so its cadence is faster with her speed).
//   Litterbug (litterbug.ts)   PED's, plus Slink → walk.
//   Dog (dogWalker.ts DOG; the walker's dog)  Roam → walk; Sit → sit; Bark → bark; anything else → sit.
//   Cat (cat.ts CAT)   Perch, RideRoof → sit; Dart, Bolt → dart (sit while it stands); Groom → walk out and back,
//                      sit while grooming; LeapOnRoof → leap; HopOff → leap for its 16 ticks, then dart to cover.
//   Pigeon (pigeon.ts) Peck → peck; Fly → fly.
//
// Frame IDs come from typed tables built with `as const` template literals and checked with `satisfies`, so a
// missing sprite is a compile error (CLAUDE.md §5.1). Nothing here allocates per call.
import type { FrameId } from '../gen/assets.ts';
import { type NPC_IDS, VEHICLE_IDS } from '../sim/entities.ts';
import { CAT, LEAP_SQUASH_TICKS, LEAP_STRETCH_TICKS, LEAP_TICKS } from '../sim/npc/behaviours/cat.ts';
import { DOG } from '../sim/npc/behaviours/dogWalker.ts';
import { LITTERBUG } from '../sim/npc/behaviours/litterbug.ts';
import { DORIS } from '../sim/npc/behaviours/oldWoman.ts';
import {
  ANGRY_FRAME_TICKS,
  FALL_FRAME_TICKS,
  FALL_FRAMES,
  PED,
  STARTLE_HOP_TICKS,
} from '../sim/npc/behaviours/pedestrian.ts';
import { PIGEON } from '../sim/npc/behaviours/pigeon.ts';
import { HEADING_COUNT, HEADING_IDS, HEADING_STEP_RAD } from './headings.ts';

/** The 8 actor directions in index order, clockwise from north (ART_BIBLE §4.5). */
export const ACTOR_DIRS = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'] as const;
export type ActorDir = (typeof ACTOR_DIRS)[number];

/** The 4 bird directions in index order, clockwise from north. */
export const BIRD_DIRS = ['n', 'e', 's', 'w'] as const;

/** Hysteresis of the 8-sector actor direction (ART_BIBLE §4.5, proposed there; adopted in SSP-103): 10°. */
export const ACTOR_DIR_HYSTERESIS_RAD = (10 * Math.PI) / 180;

/** Hysteresis of the 32-heading vehicle frame (ART_BIBLE §4.5, proposed there; adopted in SSP-103): 2°. */
export const VEHICLE_HEADING_HYSTERESIS_RAD = (2 * Math.PI) / 180;

/** A walking state below this speed (m/s) plays idle: the actor is standing (a kerb wait, held by its dog). */
export const WALK_MIN_MPS = 0.05;

/** Idle frames' ticks each (ART_BIBLE §10.2: 600 ms). */
export const IDLE_TICKS_PER_FRAME = 36;
/** Cat sit: frame 0 ticks, then frame 1 (the tail flick) ticks. */
export const CAT_SIT_HOLD_TICKS = 90;
export const CAT_SIT_FLICK_TICKS = 12;
/** Cat dart frames' ticks each. */
export const CAT_DART_TICKS_PER_FRAME = 3;
/** Dog sit and bark frames' ticks each. */
export const DOG_SIT_TICKS_PER_FRAME = 30;
export const DOG_BARK_TICKS_PER_FRAME = 6;
/** Pigeon peck: frame 0 is held PIGEON_PECK_HOLD_MIN_TICKS + (phase mod PIGEON_PECK_HOLD_SPAN), frame 1 6 ticks. */
export const PIGEON_PECK_HOLD_MIN_TICKS = 12;
export const PIGEON_PECK_HOLD_SPAN = 19;
export const PIGEON_PECK_TICKS = 6;
/** Pigeon fly frames' ticks each (3 frames looping). */
export const PIGEON_FLY_TICKS_PER_FRAME = 4;

/** Animations (frame states). Values index the frame tables. */
export const ActorAnim = {
  Walk: 0,
  Idle: 1,
  Startle: 2,
  Fall: 3,
  Angry: 4,
  Sit: 5,
  Dart: 6,
  Leap: 7,
  Bark: 8,
  Peck: 9,
  Fly: 10,
} as const;
export type ActorAnim = (typeof ActorAnim)[keyof typeof ActorAnim];

/** Pose code stride: a pose is anim × POSE_FRAMES + frame number. */
export const POSE_FRAMES = 16;

/** The pose code of frame `n` of `anim`. */
export function poseCode(anim: ActorAnim, n: number): number {
  return anim * POSE_FRAMES + n;
}

/** The animation of a pose code. */
export function poseAnim(code: number): ActorAnim {
  return Math.floor(code / POSE_FRAMES) as ActorAnim;
}

/** The frame number of a pose code. */
export function poseFrame(code: number): number {
  return code % POSE_FRAMES;
}

/** Which state table an NPC's `state` is read with (its behaviour module's). */
export const ActorRig = { Pedestrian: 0, Doris: 1, Litterbug: 2, Dog: 3, Cat: 4, Pigeon: 5 } as const;
export type ActorRig = (typeof ActorRig)[keyof typeof ActorRig];

/** `x` mod `n` in 0..n−1 for any integer x (n > 0). */
function mod(x: number, n: number): number {
  return ((x % n) + n) % n;
}

/** Ticks spent in the state before this one: stateTicks − 1 (0 for a fresh store entry at 0). */
function elapsed(stateTicks: number): number {
  return stateTicks > 0 ? stateTicks - 1 : 0;
}

/** Idle frame at `t` ticks into the state with the actor's `phase`. */
function idlePose(t: number, phase: number): number {
  return poseCode(ActorAnim.Idle, Math.floor((t + phase) / IDLE_TICKS_PER_FRAME) & 1);
}

/** The person kinds' pose (Pedestrian, Doris, Litterbug rigs). */
function humanPose(
  rig: ActorRig,
  state: number,
  t: number,
  moving: boolean,
  walk: number,
  phase: number,
): number {
  if (rig === ActorRig.Doris) {
    if (state === DORIS.Glare) return poseCode(ActorAnim.Idle, 0);
    if (state === DORIS.FistShake) return poseCode(ActorAnim.Angry, Math.floor(t / ANGRY_FRAME_TICKS) & 1);
    if (state === DORIS.SlowWalk || state === DORIS.Chase) {
      return moving ? poseCode(ActorAnim.Walk, walk) : idlePose(t, phase);
    }
  } else if (rig === ActorRig.Litterbug && state === LITTERBUG.Slink) {
    return moving ? poseCode(ActorAnim.Walk, walk) : idlePose(t, phase);
  }
  switch (state) {
    case PED.Walk:
    case PED.Cross:
      return moving ? poseCode(ActorAnim.Walk, walk) : idlePose(t, phase);
    case PED.Startle:
      return poseCode(ActorAnim.Startle, t < STARTLE_HOP_TICKS ? 0 : 1);
    case PED.Fallen: {
      const n = Math.floor(t / FALL_FRAME_TICKS);
      return poseCode(ActorAnim.Fall, n < FALL_FRAMES - 1 ? n : FALL_FRAMES - 1);
    }
    case PED.GetUp:
      return poseCode(ActorAnim.Fall, t < FALL_FRAME_TICKS ? 1 : 0);
    case PED.Angry:
      return poseCode(ActorAnim.Angry, Math.floor(t / ANGRY_FRAME_TICKS) & 1);
    default:
      // Idle, Yield, and any state a kind adds without a frame of its own.
      return idlePose(t, phase);
  }
}

/** The cat's sit frame at `t` ticks with its phase. */
function catSit(t: number, phase: number): number {
  return poseCode(
    ActorAnim.Sit,
    mod(t + phase, CAT_SIT_HOLD_TICKS + CAT_SIT_FLICK_TICKS) < CAT_SIT_HOLD_TICKS ? 0 : 1,
  );
}

/** The cat's leap frame at `t` ticks into a leap: squash, stretch, land (held). */
function catLeap(t: number): number {
  return poseCode(
    ActorAnim.Leap,
    t < LEAP_SQUASH_TICKS ? 0 : t < LEAP_SQUASH_TICKS + LEAP_STRETCH_TICKS ? 1 : 2,
  );
}

function catPose(state: number, t: number, moving: boolean, walk: number, phase: number): number {
  switch (state) {
    case CAT.Dart:
    case CAT.Bolt:
      return moving
        ? poseCode(ActorAnim.Dart, Math.floor(t / CAT_DART_TICKS_PER_FRAME) & 1)
        : catSit(t, phase);
    case CAT.Groom:
      return moving ? poseCode(ActorAnim.Walk, walk) : catSit(t, phase);
    case CAT.LeapOnRoof:
      return catLeap(t);
    case CAT.HopOff:
      if (t < LEAP_TICKS) return catLeap(t);
      return moving
        ? poseCode(ActorAnim.Dart, Math.floor((t - LEAP_TICKS) / CAT_DART_TICKS_PER_FRAME) & 1)
        : catSit(t, phase);
    default:
      // Perch and RideRoof sit.
      return catSit(t, phase);
  }
}

function dogPose(state: number, t: number, moving: boolean, walk: number, phase: number): number {
  if (state === DOG.Roam && moving) return poseCode(ActorAnim.Walk, walk);
  if (state === DOG.Bark) return poseCode(ActorAnim.Bark, Math.floor(t / DOG_BARK_TICKS_PER_FRAME) & 1);
  return poseCode(ActorAnim.Sit, Math.floor((t + phase) / DOG_SIT_TICKS_PER_FRAME) & 1);
}

function pigeonPose(state: number, t: number, phase: number): number {
  if (state === PIGEON.Fly) return poseCode(ActorAnim.Fly, Math.floor(t / PIGEON_FLY_TICKS_PER_FRAME) % 3);
  const hold = PIGEON_PECK_HOLD_MIN_TICKS + (phase % PIGEON_PECK_HOLD_SPAN);
  return poseCode(ActorAnim.Peck, mod(t + phase, hold + PIGEON_PECK_TICKS) < hold ? 0 : 1);
}

/**
 * The pose (poseCode) an NPC of `rig` shows in behaviour `state` after `stateTicks` (the store's count), from sim
 * state only: `moving` (its speed is at least WALK_MIN_MPS), `walkFrame` (walkFrameAt of its drawn position and
 * stride, 0..3) and `phase` (actorPhase, a non-negative integer). Allocation-free; only integers cross the call.
 */
export function frameFor(
  rig: ActorRig,
  state: number,
  stateTicks: number,
  moving = false,
  walkFrame = 0,
  phase = 0,
): number {
  const t = elapsed(stateTicks);
  switch (rig) {
    case ActorRig.Cat:
      return catPose(state, t, moving, walkFrame, phase);
    case ActorRig.Dog:
      return dogPose(state, t, moving, walkFrame, phase);
    case ActorRig.Pigeon:
      return pigeonPose(state, t, phase);
    default:
      return humanPose(rig, state, t, moving, walkFrame, phase);
  }
}

/**
 * The distance-driven walk frame 0..3 of an actor whose drawn position projects to `alongM` metres on its drawn
 * direction's axis: floor(alongM / strideM) mod 4. It changes once per stride travelled along the axis, whatever
 * the speed.
 */
export function walkFrameAt(alongM: number, strideM: number): number {
  return mod(Math.floor(alongM / strideM), 4);
}

/** Unit forward vector components of each actor direction (sin θ, −cos θ). */
const DIR_FX = Float64Array.from(ACTOR_DIRS, (_, k) => Math.sin((k * Math.PI) / 4));
const DIR_FY = Float64Array.from(ACTOR_DIRS, (_, k) => -Math.cos((k * Math.PI) / 4));

/** Position (xs[i], ys[i]) projected on direction `dir`'s forward axis, metres (the walk's distance). */
export function alongDirM(xs: Float64Array, ys: Float64Array, i: number, dir: number): number {
  return (xs[i] as number) * (DIR_FX[dir] as number) + (ys[i] as number) * (DIR_FY[dir] as number);
}

/** heads[i] wrapped into [−π, π) relative to `centreRad`, as an absolute difference (radians). */
function offFrom(heads: Float64Array, i: number, centreRad: number): number {
  const d = (heads[i] as number) - centreRad;
  const w = d - 2 * Math.PI * Math.floor((d + Math.PI) / (2 * Math.PI));
  return w < 0 ? -w : w;
}

/**
 * The 8-sector direction index (ACTOR_DIRS) of heading heads[i] (radians, 0 = north, clockwise; any finite value),
 * keeping `prev` (the index drawn last frame, or −1) while the heading is within 22.5° + ACTOR_DIR_HYSTERESIS_RAD of
 * its centre. Allocation-free; the heading stays in its typed array.
 */
export function actorDirFrom(heads: Float64Array, i: number, prev: number): number {
  const step = Math.PI / 4;
  const nearest = mod(Math.round((heads[i] as number) / step), 8) | 0;
  if (prev < 0 || prev === nearest) return nearest;
  return offFrom(heads, i, prev * step) <= step / 2 + ACTOR_DIR_HYSTERESIS_RAD ? prev : nearest;
}

/** The 4-sector bird direction index (BIRD_DIRS) of heads[i]: nearest 90°. */
export function birdDirFrom(heads: Float64Array, i: number): number {
  return mod(Math.round((heads[i] as number) / (Math.PI / 2)), 4) | 0;
}

/**
 * The vehicle heading index 0..31 of heads[i], keeping `prev` (−1 for none) while the heading is within
 * 5.625° + VEHICLE_HEADING_HYSTERESIS_RAD of its centre.
 */
export function vehicleHeadingFrom(heads: Float64Array, i: number, prev: number): number {
  const nearest = mod(Math.round((heads[i] as number) / HEADING_STEP_RAD), HEADING_COUNT) | 0;
  if (prev < 0 || prev === nearest) return nearest;
  return offFrom(heads, i, prev * HEADING_STEP_RAD) <= HEADING_STEP_RAD / 2 + VEHICLE_HEADING_HYSTERESIS_RAD
    ? prev
    : nearest;
}

const headingScratch = new Float64Array(1);

/** actorDirFrom for a heading given as a number (tests and cold paths). */
export function actorDirIndex(headingRad: number, prev = -1): number {
  headingScratch[0] = headingRad;
  return actorDirFrom(headingScratch, 0, prev);
}

/** The actor direction ID for a heading (tests and cold paths). */
export function actorDirId(headingRad: number, prev = -1): ActorDir {
  return ACTOR_DIRS[actorDirIndex(headingRad, prev)] ?? 'n';
}

/** birdDirFrom for a heading given as a number. */
export function birdDirIndex(headingRad: number): number {
  headingScratch[0] = headingRad;
  return birdDirFrom(headingScratch, 0);
}

/** vehicleHeadingFrom for a heading given as a number (tests and cold paths). */
export function vehicleHeadingIndex(headingRad: number, prev = -1): number {
  headingScratch[0] = headingRad;
  return vehicleHeadingFrom(headingScratch, 0, prev);
}

// ---------------------------------------------------------------------------------------------------------
// Frame tables
// ---------------------------------------------------------------------------------------------------------

/** The person kinds, in NPC_IDS order (every NPC kind but the cat and the pigeon). */
export const HUMAN_IDS = [
  'npc.shopper',
  'npc.old_woman',
  'npc.old_man_frame',
  'npc.dog_walker',
  'npc.litterbug',
  'npc.businessman',
  'npc.mum_pushchair',
  'npc.postie',
  'npc.market_trader',
] as const satisfies readonly (typeof NPC_IDS)[number][];

/** Frames of one animation: [dir][n]. */
export type DirFrames = readonly (readonly FrameId[])[];

const HUMAN_WALK = HUMAN_IDS.map((id) =>
  ACTOR_DIRS.map(
    (d) => [`${id}:walk:${d}:0`, `${id}:walk:${d}:1`, `${id}:walk:${d}:2`, `${id}:walk:${d}:3`] as const,
  ),
) satisfies readonly DirFrames[];
const HUMAN_IDLE = HUMAN_IDS.map((id) =>
  ACTOR_DIRS.map((d) => [`${id}:idle:${d}:0`, `${id}:idle:${d}:1`] as const),
) satisfies readonly DirFrames[];
const HUMAN_STARTLE = HUMAN_IDS.map((id) =>
  ACTOR_DIRS.map((d) => [`${id}:startle:${d}:0`, `${id}:startle:${d}:1`] as const),
) satisfies readonly DirFrames[];
const HUMAN_FALL = HUMAN_IDS.map((id) =>
  ACTOR_DIRS.map((d) => [`${id}:fall:${d}:0`, `${id}:fall:${d}:1`, `${id}:fall:${d}:2`] as const),
) satisfies readonly DirFrames[];
const HUMAN_ANGRY = HUMAN_IDS.map((id) =>
  ACTOR_DIRS.map((d) => [`${id}:angry:${d}:0`, `${id}:angry:${d}:1`] as const),
) satisfies readonly DirFrames[];

const CAT_WALK = ACTOR_DIRS.map(
  (d) =>
    [`npc.cat:walk:${d}:0`, `npc.cat:walk:${d}:1`, `npc.cat:walk:${d}:2`, `npc.cat:walk:${d}:3`] as const,
) satisfies DirFrames;
const CAT_SIT = ACTOR_DIRS.map(
  (d) => [`npc.cat:sit:${d}:0`, `npc.cat:sit:${d}:1`] as const,
) satisfies DirFrames;
const CAT_DART = ACTOR_DIRS.map(
  (d) => [`npc.cat:dart:${d}:0`, `npc.cat:dart:${d}:1`] as const,
) satisfies DirFrames;
const CAT_LEAP = ACTOR_DIRS.map(
  (d) => [`npc.cat:leap:${d}:0`, `npc.cat:leap:${d}:1`, `npc.cat:leap:${d}:2`] as const,
) satisfies DirFrames;

/** The walker's dog draws the npc.dog_loose grid (ENTITY_CATALOG §6.2, §7.1). */
const DOG_WALK = ACTOR_DIRS.map(
  (d) =>
    [
      `npc.dog_loose:walk:${d}:0`,
      `npc.dog_loose:walk:${d}:1`,
      `npc.dog_loose:walk:${d}:2`,
      `npc.dog_loose:walk:${d}:3`,
    ] as const,
) satisfies DirFrames;
const DOG_SIT = ACTOR_DIRS.map(
  (d) => [`npc.dog_loose:sit:${d}:0`, `npc.dog_loose:sit:${d}:1`] as const,
) satisfies DirFrames;
const DOG_BARK = ACTOR_DIRS.map(
  (d) => [`npc.dog_loose:bark:${d}:0`, `npc.dog_loose:bark:${d}:1`] as const,
) satisfies DirFrames;

const PIGEON_PECK = BIRD_DIRS.map(
  (d) => [`npc.pigeon:peck:${d}:0`, `npc.pigeon:peck:${d}:1`] as const,
) satisfies DirFrames;
const PIGEON_FLY = BIRD_DIRS.map(
  (d) => [`npc.pigeon:fly:${d}:0`, `npc.pigeon:fly:${d}:1`, `npc.pigeon:fly:${d}:2`] as const,
) satisfies DirFrames;

/** One drawable actor's frames by ActorAnim (null where it has no such animation), its rig and its stride. */
export type ActorSet = {
  readonly asset: string;
  readonly rig: ActorRig;
  /** Walk stride, metres per walk frame (0 for an actor that never walks). */
  readonly strideM: number;
  /** Directions: 8 (ACTOR_DIRS) or 4 (BIRD_DIRS). */
  readonly dirs: number;
  readonly anims: readonly (DirFrames | null)[];
};

/** ART_BIBLE §10.2 walk strides by person kind, metres. */
const HUMAN_STRIDE_M: Readonly<Record<(typeof HUMAN_IDS)[number], number>> = {
  'npc.shopper': 0.3,
  'npc.old_woman': 0.18,
  'npc.old_man_frame': 0.15,
  'npc.dog_walker': 0.3,
  'npc.litterbug': 0.3,
  'npc.businessman': 0.3,
  'npc.mum_pushchair': 0.3,
  'npc.postie': 0.3,
  'npc.market_trader': 0.3,
};

/** The cat's and the dog's strides (ART_BIBLE §10.2). */
export const CAT_STRIDE_M = 0.12;
export const DOG_STRIDE_M = 0.35;

function humanRig(id: (typeof HUMAN_IDS)[number]): ActorRig {
  if (id === 'npc.old_woman') return ActorRig.Doris;
  if (id === 'npc.litterbug') return ActorRig.Litterbug;
  return ActorRig.Pedestrian;
}

function anims(entries: Partial<Record<ActorAnim, DirFrames>>): (DirFrames | null)[] {
  const out: (DirFrames | null)[] = [];
  for (let a = 0; a <= ActorAnim.Fly; a += 1) out.push(entries[a as ActorAnim] ?? null);
  return out;
}

/**
 * Every drawable NPC look: ACTOR_SETS[k] for NPC_IDS index k (the nine person kinds, the cat, the pigeon), then
 * the walker's dog at DOG_SET.
 */
export const ACTOR_SETS: readonly ActorSet[] = [
  ...HUMAN_IDS.map((id, k) => ({
    asset: id,
    rig: humanRig(id),
    strideM: HUMAN_STRIDE_M[id],
    dirs: 8,
    anims: anims({
      [ActorAnim.Walk]: HUMAN_WALK[k] as DirFrames,
      [ActorAnim.Idle]: HUMAN_IDLE[k] as DirFrames,
      [ActorAnim.Startle]: HUMAN_STARTLE[k] as DirFrames,
      [ActorAnim.Fall]: HUMAN_FALL[k] as DirFrames,
      [ActorAnim.Angry]: HUMAN_ANGRY[k] as DirFrames,
    }),
  })),
  {
    asset: 'npc.cat',
    rig: ActorRig.Cat,
    strideM: CAT_STRIDE_M,
    dirs: 8,
    anims: anims({
      [ActorAnim.Walk]: CAT_WALK,
      [ActorAnim.Sit]: CAT_SIT,
      [ActorAnim.Dart]: CAT_DART,
      [ActorAnim.Leap]: CAT_LEAP,
    }),
  },
  {
    asset: 'npc.pigeon',
    rig: ActorRig.Pigeon,
    strideM: 0,
    dirs: 4,
    anims: anims({ [ActorAnim.Peck]: PIGEON_PECK, [ActorAnim.Fly]: PIGEON_FLY }),
  },
  {
    asset: 'npc.dog_loose',
    rig: ActorRig.Dog,
    strideM: DOG_STRIDE_M,
    dirs: 8,
    anims: anims({ [ActorAnim.Walk]: DOG_WALK, [ActorAnim.Sit]: DOG_SIT, [ActorAnim.Bark]: DOG_BARK }),
  },
];

/** ACTOR_SETS index of the walker's dog. */
export const DOG_SET = ACTOR_SETS.length - 1;

/** Walk strides by ACTOR_SETS index, metres (0 for a set that never walks). */
export const ACTOR_STRIDES_M = Float64Array.from(ACTOR_SETS, (set) => set.strideM);

/**
 * walkFrameAt of the position (xs[i], ys[i]) projected on direction `dir`'s axis with the stride of ACTOR_SETS
 * index `setIndex`: the walk frame 0..3 (0 for a set that never walks). Only integers cross the call.
 */
export function walkFrameOf(
  xs: Float64Array,
  ys: Float64Array,
  i: number,
  dir: number,
  setIndex: number,
): number {
  const stride = ACTOR_STRIDES_M[setIndex] as number;
  if (!(stride > 0)) return 0;
  const along = (xs[i] as number) * (DIR_FX[dir] as number) + (ys[i] as number) * (DIR_FY[dir] as number);
  return mod(Math.floor(along / stride), 4);
}

/** The frame of `set` for pose code `pose` facing direction index `dir` (throws when the set has no such frame). */
export function actorFrame(set: ActorSet, pose: number, dir: number): FrameId {
  const frame = set.anims[poseAnim(pose)]?.[dir]?.[poseFrame(pose)];
  if (frame === undefined) return rejectPose(set, pose, dir);
  return frame;
}

/** Throws for a pose a set does not draw (kept out of the per-frame path). */
function rejectPose(set: ActorSet, pose: number, dir: number): never {
  throw new Error(`${set.asset} has no frame for pose ${poseAnim(pose)}:${poseFrame(pose)} dir ${dir}`);
}

/** Every vehicle's body frame by heading: VEHICLE_FRAMES[kind][h], kind the VEHICLE_IDS index. */
export const VEHICLE_FRAMES = VEHICLE_IDS.map((id) =>
  HEADING_IDS.map((h) => `${id}:body:${h}:0` as const),
) satisfies readonly (readonly FrameId[])[];

/** The body frame of vehicle kind `kind` (VEHICLE_IDS index) at heading index 0..31. */
export function vehicleFrame(kind: number, heading: number): FrameId {
  const frame = VEHICLE_FRAMES[kind]?.[heading];
  if (frame === undefined) return rejectVehicle(kind, heading);
  return frame;
}

function rejectVehicle(kind: number, heading: number): never {
  throw new RangeError(`vehicle kind ${kind} heading ${heading} has no frame`);
}
