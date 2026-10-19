// Render interpolation (TECHNICAL_DESIGN §5.1, SSP-046). The sim runs at a fixed 60 Hz and keeps each entity's
// pose from the start of its last tick (prevX/prevY/prevHeading) beside the current one; a display frame draws
// the pose `alpha` of the way between them, alpha = acc / DT_S from the loop (0 = the previous tick's pose,
// 1 = the current one). Positions lerp linearly; headings take the shortest arc, so a pair either side of the
// ±π seam turns through it instead of spinning the long way round.
//
// Render-only: nothing here is read back by the sim. Allocation-free: results go into a caller-owned Pose.

/** Two π, one full turn in radians. */
const TURN_RAD = 2 * Math.PI;

/** A drawn pose: body centre in sim metres (+x east, +y south) and heading in radians (0 = north, clockwise). */
export type Pose = { xM: number; yM: number; headingRad: number };

/** A new pose at the origin facing north. Allocate once, outside the frame loop. */
export function createPose(): Pose {
  return { xM: 0, yM: 0, headingRad: 0 };
}

/** The sim fields a pose interpolates between (VehicleState has them all). */
export type PosePair = {
  readonly prevXM: number;
  readonly prevYM: number;
  readonly prevHeadingRad: number;
  readonly xM: number;
  readonly yM: number;
  readonly headingRad: number;
};

/** `angleRad` wrapped into [−π, π). Any finite angle is accepted. */
export function wrapAngleRad(angleRad: number): number {
  return angleRad - TURN_RAD * Math.floor((angleRad + Math.PI) / TURN_RAD);
}

/**
 * The angle `alpha` of the way from `fromRad` to `toRad` along the shorter arc: `from + wrap(to − from) · alpha`.
 * The result is not wrapped (it stays near `fromRad`), which the heading-frame selection accepts as it is.
 * An exact half-turn apart goes the negative (anticlockwise) way, as wrapAngleRad maps π to −π.
 */
export function lerpAngleRad(fromRad: number, toRad: number, alpha: number): number {
  return fromRad + wrapAngleRad(toRad - fromRad) * alpha;
}

/** Linear interpolation from `from` (alpha 0) to `to` (alpha 1). */
export function lerp(from: number, to: number, alpha: number): number {
  return from + (to - from) * alpha;
}

/**
 * Writes into `out` the pose `alpha` of the way from the pair's previous pose to its current one; alpha is
 * clamped to [0, 1] (the loop guarantees that range; a stray value never extrapolates).
 */
export function interpolatePose(pair: PosePair, alpha: number, out: Pose): void {
  const t = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;
  // The lerp / lerpAngleRad / wrapAngleRad maths written out, so no fresh double crosses a call boundary on the
  // per-frame path (V8 boxes one when it does not inline the callee; TECHNICAL_DESIGN §17).
  out.xM = pair.prevXM + (pair.xM - pair.prevXM) * t;
  out.yM = pair.prevYM + (pair.yM - pair.prevYM) * t;
  const from = pair.prevHeadingRad;
  const d = pair.headingRad - from;
  out.headingRad = from + (d - TURN_RAD * Math.floor((d + Math.PI) / TURN_RAD)) * t;
}
