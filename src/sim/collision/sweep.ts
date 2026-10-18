// Sub-stepping rule for moving bodies against static geometry (TECHNICAL_DESIGN §9.2 step 2).
// When a body's per-tick displacement exceeds 0.5 tile (1.0 m), the move is split into `ceil(d / 1.0)` equal
// sub-steps and each intermediate pose is collision-tested, so nothing can jump over a thin obstacle.
// Bessie tops out at about 17.2 m/s ≈ 0.29 m/tick, so she always takes one step; the rule is a safety net.
// The knockables' extra rule (sub-step past half the smallest extent, §9.3) arrives with bodies.ts in M3 and
// reuses subStepCount with a smaller `maxStepM`.
// Allocation-free: poses are written into a caller-supplied object.
import { TILE_M } from '../constants.ts';

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
  if (step >= count) {
    out.x = x1;
    out.y = y1;
    out.headingRad = heading1Rad;
    return out;
  }
  const t = step / count;
  let dh = heading1Rad - heading0Rad;
  dh -= TWO_PI * Math.round(dh / TWO_PI);
  out.x = x0 + (x1 - x0) * t;
  out.y = y0 + (y1 - y0) * t;
  out.headingRad = heading0Rad + dh * t;
  return out;
}
