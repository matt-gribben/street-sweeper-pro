// Transcendental maths for the sim (TECHNICAL_DESIGN §2 and §7.4). ECMAScript does not require Math.sin,
// Math.exp, Math.atan2 and friends to give bit-identical results across engines, so every sim call goes
// through this file and nowhere else: tests/unit/simPurity.test.ts fails if another src/sim file calls
// Math.sin/cos/tan/atan2/exp/sqrt/hypot. Version 1 forwards to Math.* because Node (CI) and Chromium (dev)
// are both V8. Different V8 versions are not bit-identical either: Math.sin in Chromium 156 and Node 24.21.0
// differ in the last bit for some arguments (SSP-073, TECHNICAL_DESIGN §18.6), which the replay hash's 1e-4
// quantisation absorbs (every committed checkpoint matches in both). If cross-engine replays are ever needed,
// this one file swaps to fixed polynomial approximations. `tan` is the one addition to the §7.4 list: the
// vehicle yaw step uses tan(δ) (§8.2).

/** Sine of `xRad`. */
export function sin(xRad: number): number {
  return Math.sin(xRad);
}

/** Cosine of `xRad`. */
export function cos(xRad: number): number {
  return Math.cos(xRad);
}

/**
 * Writes cos(pose.headingRad) to out[0] and sin(pose.headingRad) to out[1]: the same values as cos and sin. It
 * takes the pose and an array, not the angle, so no double crosses the call boundary: V8 boxes a double argument
 * or return value of a call it does not inline, so in a large function that TurboFan compiles without inlining
 * its cos/sin calls, each of them allocates (SSP-107 found stepDirt allocating 64 B per collecting tick that way
 * on the m3_towed replay). Allocation-free whether inlined or not.
 */
export function headingCosSin(pose: { readonly headingRad: number }, out: Float64Array): void {
  const h = pose.headingRad;
  out[0] = Math.cos(h);
  out[1] = Math.sin(h);
}

/** Tangent of `xRad`. */
export function tan(xRad: number): number {
  return Math.tan(xRad);
}

/** Angle in radians of the vector (x, y), in (−π, π]. Argument order matches Math.atan2. */
export function atan2(y: number, x: number): number {
  return Math.atan2(y, x);
}

/** e raised to `x`. */
export function exp(x: number): number {
  return Math.exp(x);
}

/** Square root of `x`. */
export function sqrt(x: number): number {
  return Math.sqrt(x);
}

/** Length of the vector (x, y). Two-argument only, so calls never allocate a rest array. */
export function hypot(x: number, y: number): number {
  return Math.hypot(x, y);
}
