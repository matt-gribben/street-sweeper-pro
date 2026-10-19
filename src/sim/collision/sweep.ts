// Sub-stepping rule for moving bodies against static geometry (TECHNICAL_DESIGN §9.2 step 2).
// When a body's per-tick displacement exceeds 0.5 tile (1.0 m), the move is split into `ceil(d / 1.0)` equal
// sub-steps and each intermediate pose is collision-tested, so nothing can jump over a thin obstacle.
// Bessie tops out at about 17.2 m/s ≈ 0.29 m/tick, so against tiles alone she always takes one step.
// Thin props tighten the step (SSP-037): the static grid's `subStepMaxM` is the smaller of 1.0 m and half the
// smallest extent of any static shape (a 0.3 m bollard: 0.15 m), so Bessie can never move far enough in one
// step for a bollard's centre to end up inside her OBB, where the MTV would leave through a side face and
// let her pass straight through it. The knockables' extra rule (sub-step past half their own smallest extent,
// §9.3) arrives with bodies.ts in M3 and reuses subStepCount with a smaller `maxStepM`.
// Allocation-free: poses are written into a caller-supplied object.
import { TILE_M } from '../constants.ts';
import { sqrt } from '../fmath.ts';

/** Largest displacement taken in one collision step: 0.5 tile = 1.0 m (§9.2). */
export const SUBSTEP_MAX_M = TILE_M / 2;

const TWO_PI = 2 * Math.PI;

/** A mutable body pose in sim space: position in metres, heading in radians (0 = north, clockwise). */
export type Pose = { x: number; y: number; headingRad: number };

/** Allocate a zeroed pose. Setup only, never per tick. */
export function createPose(): Pose {
  return { x: 0, y: 0, headingRad: 0 };
}

/**
 * Number of collision sub-steps for a displacement of `displacementM` metres: 1 when `d ≤ maxStepM`, else
 * `ceil(d / maxStepM)`. A non-finite or non-positive displacement returns 1, so a corrupt pose can never
 * spin the step loop forever (the resolver still tests the end pose).
 */
export function subStepCount(displacementM: number, maxStepM: number = SUBSTEP_MAX_M): number {
  if (!(displacementM > maxStepM) || displacementM === Infinity) return 1;
  return Math.ceil(displacementM / maxStepM);
}

/**
 * Write the pose after sub-step `step` of `count` (1-based: step 1 is the first intermediate pose, step
 * `count` is the end pose) for a move from pose 0 to pose 1, and return `out`. Position is interpolated
 * linearly; heading turns along the shorter arc (a half turn exactly goes anticlockwise). The last step
 * returns pose 1 exactly, with no float drift. Inputs are plain numbers, so `out` may be the object the start
 * pose was read from.
 */
export function subStepPose(
  x0: number,
  y0: number,
  heading0Rad: number,
  x1: number,
  y1: number,
  heading1Rad: number,
  step: number,
  count: number,
  out: Pose,
): Pose {
  const s = scratchSweep;
  s.x0 = x0;
  s.y0 = y0;
  s.heading0Rad = heading0Rad;
  s.x1 = x1;
  s.y1 = y1;
  s.heading1Rad = heading1Rad;
  return sweepPose(s, step, count, out);
}

/**
 * A move from pose 0 to pose 1, for the per-tick forms sweepStepCount and sweepPose (SSP-036). They take the
 * poses in this object instead of as number arguments, so a call V8 does not inline never boxes a double
 * (see eventQueue.ts); subStepCount and subStepPose are the same rules for tests and cold paths.
 */
export type Sweep = {
  x0: number;
  y0: number;
  heading0Rad: number;
  x1: number;
  y1: number;
  heading1Rad: number;
  /** Largest displacement per sub-step, metres (SUBSTEP_MAX_M unless the static grid needs less). */
  maxStepM: number;
};

/** Allocate a zeroed sweep with the 1.0 m step. Setup only, never per tick. */
export function createSweep(): Sweep {
  return { x0: 0, y0: 0, heading0Rad: 0, x1: 0, y1: 0, heading1Rad: 0, maxStepM: SUBSTEP_MAX_M };
}

const scratchSweep = createSweep();

/** subStepCount for the sweep's displacement with the sweep's own step (`maxStepM`). */
export function sweepStepCount(sweep: Sweep): number {
  const dx = sweep.x1 - sweep.x0;
  const dy = sweep.y1 - sweep.y0;
  const d = sqrt(dx * dx + dy * dy);
  const maxStepM = sweep.maxStepM;
  if (!(d > maxStepM) || d === Infinity) return 1;
  return Math.ceil(d / maxStepM);
}

/** subStepPose for `sweep`: the pose after sub-step `step` of `count`, written into `out`. */
export function sweepPose(sweep: Sweep, step: number, count: number, out: Pose): Pose {
  if (step >= count) {
    out.x = sweep.x1;
    out.y = sweep.y1;
    out.headingRad = sweep.heading1Rad;
    return out;
  }
  const t = step / count;
  let dh = sweep.heading1Rad - sweep.heading0Rad;
  dh -= TWO_PI * Math.round(dh / TWO_PI);
  out.x = sweep.x0 + (sweep.x1 - sweep.x0) * t;
  out.y = sweep.y0 + (sweep.y1 - sweep.y0) * t;
  out.headingRad = sweep.heading0Rad + dh * t;
  return out;
}
