// Separating-axis tests for static collision (TECHNICAL_DESIGN §9.2 step 4). OBB vs axis-aligned rect uses the
// 2 world axes plus the OBB's 2 axes; OBB vs circle uses the closest-point axis; OBB vs OBB (box-shaped prop
// footprints, SSP-036) uses both boxes' axes. All keep the axis of minimum penetration and report it as a
// minimum translation vector (MTV). obbVsRectMasked (SSP-036) additionally skips axes that come from an
// internal edge of the merged solids, so sliding along a flush terrace front never snags on a ghost edge.
//
// MTV sign convention (fixed here, relied on by the resolver in SSP-036):
//   - `normalX/normalY` is a unit vector pointing FROM the obstacle TOWARD the OBB, so it pushes the OBB out.
//   - Translating the OBB centre by `normal × depthM` leaves the shapes exactly touching (zero penetration,
//     up to float rounding). The obstacle is static and never moves.
//   - For velocity response, the approach speed into the obstacle is `vn = −(v · normal)` when positive.
//   - Touching is NOT overlapping: an axis with zero or negative penetration separates the shapes, so a
//     resolved pose re-tests as clear.
// Ties are broken by a fixed axis order, so results are deterministic: rects test world x, world y, OBB right,
// OBB forward (a later axis wins only if strictly shallower); a projected centre offset of exactly 0 picks the
// positive axis direction. Circles whose centre lies inside the box push out through the shallower face,
// right/left face first on a tie.
//
// Allocation-free: results go into a caller-supplied Contact (createContact() is setup-only). The only
// transcendental is fmath.sqrt in the circle test.
import { sqrt } from '../fmath.ts';
import type { Aabb, Obb } from './obb.ts';

/** Result of one SAT test. When `overlap` is false the normal and depth are zero. */
export type Contact = {
  overlap: boolean;
  /** Unit MTV direction, from the obstacle toward the OBB (see the sign convention above). */
  normalX: number;
  normalY: number;
  /** Penetration depth along the normal, metres. Strictly positive when `overlap` is true. */
  depthM: number;
};

/** Allocate a cleared Contact. Setup only, never per tick. */
export function createContact(): Contact {
  return { overlap: false, normalX: 0, normalY: 0, depthM: 0 };
}

function clearContact(out: Contact): boolean {
  out.overlap = false;
  out.normalX = 0;
  out.normalY = 0;
  out.depthM = 0;
  return false;
}

// Overlapping results are written field by field at each return rather than through a setContact(out, nx, ny,
// depth) helper: its three double arguments are boxed whenever V8 does not inline it, which it stops doing once
// a level mixes rects, circles and boxes in one optimised tick (SSP-036 heap-delta finding).

/**
 * OBB vs axis-aligned rect `[minX, maxX] × [minY, maxY]` (metres). Returns whether they overlap and writes the
 * MTV that pushes the OBB out of the rect into `out`.
 */
export function obbVsRect(
  obb: Obb,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  out: Contact,
): boolean {
  const rect = rectScratch;
  rect.minX = minX;
  rect.minY = minY;
  rect.maxX = maxX;
  rect.maxY = maxY;
  return obbVsRectMasked(obb, rect, RECT_OPEN_ALL, out);
}

/** obbVsRect's rect, so it hands obbVsRectMasked an object instead of four number arguments. */
const rectScratch: Aabb = { minX: 0, minY: 0, maxX: 0, maxY: 0 };

/**
 * Which features of a rect may supply the MTV (TECHNICAL_DESIGN §9.1, SSP-036): a bit per face (the face an
 * axis-aligned normal leaves through) and per corner (the rect vertex an oblique OBB-axis normal comes from).
 * A face is closed when solid continues on its far side, and a corner when it is not a convex corner of the
 * solid union. Those features are internal edges of merged rects: a normal from one is a "ghost" that would
 * snag Bessie on a flush terrace front. `collision/grid.ts` computes the mask from its solid-cell grid.
 */
export const RECT_OPEN = {
  FACE_W: 1 << 0,
  FACE_E: 1 << 1,
  FACE_N: 1 << 2,
  FACE_S: 1 << 3,
  CORNER_NW: 1 << 4,
  CORNER_NE: 1 << 5,
  CORNER_SW: 1 << 6,
  CORNER_SE: 1 << 7,
} as const;

/** Every face and corner open: plain SAT. */
export const RECT_OPEN_ALL = 0xff;

/**
 * Below this, a normal's component counts as zero when picking the rect feature it comes from, so an OBB
 * axis that is axis-aligned up to trig rounding (cos(π/2) ≈ 6e-17) reads as a face, not a corner.
 */
const FEATURE_AXIS_EPS = 1e-9;

/**
 * True when the rect feature an MTV comes from is open in `open` (RECT_OPEN bits). The MTV is given by the
 * signs of its components, `sx`, `sy` ∈ {−1, 0, 1} (0 within FEATURE_AXIS_EPS), so only small integers cross
 * the call: a double argument is boxed whenever V8 does not inline a call (see eventQueue.ts).
 */
function rectFeatureOpen(sx: number, sy: number, open: number): boolean {
  if (open === RECT_OPEN_ALL) return true;
  let bit: number;
  if (sy === 0) bit = sx < 0 ? RECT_OPEN.FACE_W : RECT_OPEN.FACE_E;
  else if (sx === 0) bit = sy < 0 ? RECT_OPEN.FACE_N : RECT_OPEN.FACE_S;
  else if (sx < 0) bit = sy < 0 ? RECT_OPEN.CORNER_NW : RECT_OPEN.CORNER_SW;
  else bit = sy < 0 ? RECT_OPEN.CORNER_NE : RECT_OPEN.CORNER_SE;
  return (open & bit) !== 0;
}

/**
 * obbVsRect with a feature mask (RECT_OPEN bits). Overlap is decided exactly as in obbVsRect: any separating
 * axis clears the contact. The MTV is the shallowest axis whose rect feature is open, in the same fixed axis
 * order; if every overlapping axis is closed (only possible deep inside a solid), it falls back to the
 * unmasked minimum so the OBB is still pushed out. With RECT_OPEN_ALL it is obbVsRect. The rect is read from
 * `rect` (metres).
 */
export function obbVsRectMasked(obb: Obb, rect: Readonly<Aabb>, open: number, out: Contact): boolean {
  const minX = rect.minX;
  const minY = rect.minY;
  const maxX = rect.maxX;
  const maxY = rect.maxY;
  const E = FEATURE_AXIS_EPS;
  const rectHalfX = (maxX - minX) * 0.5;
  const rectHalfY = (maxY - minY) * 0.5;
  // Offset from the rect centre to the OBB centre: its sign on each axis orients the normal toward the OBB.
  const dx = obb.cx - (minX + rectHalfX);
  const dy = obb.cy - (minY + rectHalfY);
  // Best axis overall (depth/nx/ny) and best open axis (oDepth/oNx/oNy; oDepth < 0 = none yet).
  let oDepth = -1;
  let oNx = 0;
  let oNy = 0;

  // Axis 1: world x.
  // The OBB's projected half extents on the world axes (obbExtentX/Y, written out: see the note above).
  const hw = obb.halfWidthM;
  const hl = obb.halfLengthM;
  let depth = Math.abs(obb.rightX) * hw + Math.abs(obb.forwardX) * hl + rectHalfX - Math.abs(dx);
  if (depth <= 0) return clearContact(out);
  let nx = dx < 0 ? -1 : 1;
  let ny = 0;
  if (rectFeatureOpen(dx < 0 ? -1 : 1, 0, open)) {
    oDepth = depth;
    oNx = nx;
    oNy = ny;
  }

  // Axis 2: world y.
  let pen = Math.abs(obb.rightY) * hw + Math.abs(obb.forwardY) * hl + rectHalfY - Math.abs(dy);
  if (pen <= 0) return clearContact(out);
  let cx = 0;
  let cy = dy < 0 ? -1 : 1;
  if (pen < depth) {
    depth = pen;
    nx = cx;
    ny = cy;
  }
  if (
    (oDepth < 0 || pen < oDepth) &&
    rectFeatureOpen(cx < -E ? -1 : cx > E ? 1 : 0, cy < -E ? -1 : cy > E ? 1 : 0, open)
  ) {
    oDepth = pen;
    oNx = cx;
    oNy = cy;
  }

  // Axis 3: OBB right (local +x). The OBB's own projection radius on it is its half width.
  const rx = obb.rightX;
  const ry = obb.rightY;
  let d = dx * rx + dy * ry;
  pen = obb.halfWidthM + rectHalfX * Math.abs(rx) + rectHalfY * Math.abs(ry) - Math.abs(d);
  if (pen <= 0) return clearContact(out);
  cx = d < 0 ? -rx : rx;
  cy = d < 0 ? -ry : ry;
  if (pen < depth) {
    depth = pen;
    nx = cx;
    ny = cy;
  }
  if (
    (oDepth < 0 || pen < oDepth) &&
    rectFeatureOpen(cx < -E ? -1 : cx > E ? 1 : 0, cy < -E ? -1 : cy > E ? 1 : 0, open)
  ) {
    oDepth = pen;
    oNx = cx;
    oNy = cy;
  }

  // Axis 4: OBB forward (local +y). The OBB's own projection radius on it is its half length.
  const fx = obb.forwardX;
  const fy = obb.forwardY;
  d = dx * fx + dy * fy;
  pen = obb.halfLengthM + rectHalfX * Math.abs(fx) + rectHalfY * Math.abs(fy) - Math.abs(d);
  if (pen <= 0) return clearContact(out);
  cx = d < 0 ? -fx : fx;
  cy = d < 0 ? -fy : fy;
  if (pen < depth) {
    depth = pen;
    nx = cx;
    ny = cy;
  }
  if (
    (oDepth < 0 || pen < oDepth) &&
    rectFeatureOpen(cx < -E ? -1 : cx > E ? 1 : 0, cy < -E ? -1 : cy > E ? 1 : 0, open)
  ) {
    oDepth = pen;
    oNx = cx;
    oNy = cy;
  }

  out.overlap = true;
  if (oDepth > 0) {
    out.normalX = oNx;
    out.normalY = oNy;
    out.depthM = oDepth;
  } else {
    out.normalX = nx;
    out.normalY = ny;
    out.depthM = depth;
  }
  return true;
}

/**
 * OBB `obb` vs a second, static OBB `other` (a box-shaped prop footprint). Tests the obstacle's 2 axes, then
 * the moving OBB's 2 axes, keeping the shallowest (a later axis wins only if strictly shallower; a projected
 * centre offset of exactly 0 picks the positive axis direction). The MTV pushes `obb` out of `other`, with
 * the same sign convention as the rect test.
 */
export function obbVsObb(obb: Obb, other: Obb, out: Contact): boolean {
  const dx = obb.cx - other.cx;
  const dy = obb.cy - other.cy;
  const arx = obb.rightX;
  const ary = obb.rightY;
  const afx = obb.forwardX;
  const afy = obb.forwardY;
  const brx = other.rightX;
  const bry = other.rightY;
  const bfx = other.forwardX;
  const bfy = other.forwardY;
  const ahw = obb.halfWidthM;
  const ahl = obb.halfLengthM;
  const bhw = other.halfWidthM;
  const bhl = other.halfLengthM;

  // Axis 1: obstacle right.
  let d = dx * brx + dy * bry;
  let depth =
    bhw + ahw * Math.abs(arx * brx + ary * bry) + ahl * Math.abs(afx * brx + afy * bry) - Math.abs(d);
  if (depth <= 0) return clearContact(out);
  let nx = d < 0 ? -brx : brx;
  let ny = d < 0 ? -bry : bry;

  // Axis 2: obstacle forward.
  d = dx * bfx + dy * bfy;
  let pen = bhl + ahw * Math.abs(arx * bfx + ary * bfy) + ahl * Math.abs(afx * bfx + afy * bfy) - Math.abs(d);
  if (pen <= 0) return clearContact(out);
  if (pen < depth) {
    depth = pen;
    nx = d < 0 ? -bfx : bfx;
    ny = d < 0 ? -bfy : bfy;
  }

  // Axis 3: moving OBB right.
  d = dx * arx + dy * ary;
  pen = ahw + bhw * Math.abs(brx * arx + bry * ary) + bhl * Math.abs(bfx * arx + bfy * ary) - Math.abs(d);
  if (pen <= 0) return clearContact(out);
  if (pen < depth) {
    depth = pen;
    nx = d < 0 ? -arx : arx;
    ny = d < 0 ? -ary : ary;
  }

  // Axis 4: moving OBB forward.
  d = dx * afx + dy * afy;
  pen = ahl + bhw * Math.abs(brx * afx + bry * afy) + bhl * Math.abs(bfx * afx + bfy * afy) - Math.abs(d);
  if (pen <= 0) return clearContact(out);
  if (pen < depth) {
    depth = pen;
    nx = d < 0 ? -afx : afx;
    ny = d < 0 ? -afy : afy;
  }

  out.overlap = true;
  out.normalX = nx;
  out.normalY = ny;
  out.depthM = depth;
  return true;
}

/**
 * OBB vs circle centred on `(px, py)` with radius `radiusM` (metres). Uses the closest point on the box to the
 * circle centre, which covers face and corner regions alike. Returns whether they overlap and writes the MTV
 * that pushes the OBB out of the circle into `out`.
 */
export function obbVsCircle(obb: Obb, px: number, py: number, radiusM: number, out: Contact): boolean {
  const c = circleScratch;
  c.x = px;
  c.y = py;
  c.radiusM = radiusM;
  return obbVsCircleShape(obb, c, out);
}

/** A circle in sim space: centre and radius, metres. */
export type Circle = { x: number; y: number; radiusM: number };

/** obbVsCircle's circle, so it hands obbVsCircleShape an object instead of three number arguments. */
const circleScratch: Circle = { x: 0, y: 0, radiusM: 0 };

/**
 * obbVsCircle with the circle in an object (SSP-036): the per-tick form, which passes no number arguments, so
 * it never boxes a double when V8 does not inline the call (see eventQueue.ts).
 */
export function obbVsCircleShape(obb: Obb, circle: Readonly<Circle>, out: Contact): boolean {
  const px = circle.x;
  const py = circle.y;
  const radiusM = circle.radiusM;
  const rx = obb.rightX;
  const ry = obb.rightY;
  const fx = obb.forwardX;
  const fy = obb.forwardY;
  const hw = obb.halfWidthM;
  const hl = obb.halfLengthM;

  // Circle centre in box-local coordinates (local +x right, local +y forward).
  const wx = px - obb.cx;
  const wy = py - obb.cy;
  const lx = wx * rx + wy * ry;
  const ly = wx * fx + wy * fy;

  // Closest point on (or in) the box.
  const qx = lx < -hw ? -hw : lx > hw ? hw : lx;
  const qy = ly < -hl ? -hl : ly > hl ? hl : ly;

  // Offset from the circle centre to the closest point. It is zero when the centre is inside the box.
  // sqrt of the squared length rather than hypot: in V8, Math.hypot boxes its result on every call even in
  // optimised code, and this test runs per candidate per tick. The squares only underflow for offsets below
  // 1e-154 m, which take the inside branch, where the depth differs from the exact one by that offset.
  const vx = qx - lx;
  const vy = qy - ly;
  const distSq = vx * vx + vy * vy;
  let nlx: number;
  let nly: number;
  let depth: number;
  if (distSq > 0) {
    // Centre outside the box: the closest-point axis runs from the circle centre to the closest point.
    const dist = sqrt(distSq);
    if (dist >= radiusM) return clearContact(out);
    nlx = vx / dist;
    nly = vy / dist;
    depth = radiusM - dist;
  } else {
    // Centre inside (or on the boundary of) the box: leave through the shallower face, away from the centre.
    const penX = hw - Math.abs(lx) + radiusM;
    const penY = hl - Math.abs(ly) + radiusM;
    if (penX <= penY) {
      nlx = lx < 0 ? 1 : -1;
      nly = 0;
      depth = penX;
    } else {
      nlx = 0;
      nly = ly < 0 ? 1 : -1;
      depth = penY;
    }
    // Only a zero-radius circle sitting exactly on the boundary gets here: touching, not overlapping.
    if (depth <= 0) return clearContact(out);
  }

  // Back to world space through the box axes.
  out.overlap = true;
  out.normalX = nlx * rx + nly * fx;
  out.normalY = nlx * ry + nly * fy;
  out.depthM = depth;
  return true;
}
