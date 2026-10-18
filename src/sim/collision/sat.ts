// Separating-axis tests for static collision (TECHNICAL_DESIGN §9.2 step 4). OBB vs axis-aligned rect uses the
// 2 world axes plus the OBB's 2 axes; OBB vs circle uses the closest-point axis. Both keep the axis of
// minimum penetration and report it as a minimum translation vector (MTV).
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
import { type Obb, obbExtentX, obbExtentY } from './obb.ts';

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

function setContact(out: Contact, normalX: number, normalY: number, depthM: number): boolean {
  out.overlap = true;
  out.normalX = normalX;
  out.normalY = normalY;
  out.depthM = depthM;
  return true;
}

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
  const rectHalfX = (maxX - minX) * 0.5;
  const rectHalfY = (maxY - minY) * 0.5;
  // Offset from the rect centre to the OBB centre: its sign on each axis orients the normal toward the OBB.
  const dx = obb.cx - (minX + rectHalfX);
  const dy = obb.cy - (minY + rectHalfY);

  // Axis 1: world x.
  let depth = obbExtentX(obb) + rectHalfX - Math.abs(dx);
  if (depth <= 0) return clearContact(out);
  let nx = dx < 0 ? -1 : 1;
  let ny = 0;

  // Axis 2: world y.
  let pen = obbExtentY(obb) + rectHalfY - Math.abs(dy);
  if (pen <= 0) return clearContact(out);
  if (pen < depth) {
    depth = pen;
    nx = 0;
    ny = dy < 0 ? -1 : 1;
  }

  // Axis 3: OBB right (local +x). The OBB's own projection radius on it is its half width.
  const rx = obb.rightX;
  const ry = obb.rightY;
  let d = dx * rx + dy * ry;
  pen = obb.halfWidthM + rectHalfX * Math.abs(rx) + rectHalfY * Math.abs(ry) - Math.abs(d);
  if (pen <= 0) return clearContact(out);
  if (pen < depth) {
    depth = pen;
    nx = d < 0 ? -rx : rx;
    ny = d < 0 ? -ry : ry;
  }

  // Axis 4: OBB forward (local +y). The OBB's own projection radius on it is its half length.
  const fx = obb.forwardX;
  const fy = obb.forwardY;
  d = dx * fx + dy * fy;
  pen = obb.halfLengthM + rectHalfX * Math.abs(fx) + rectHalfY * Math.abs(fy) - Math.abs(d);
  if (pen <= 0) return clearContact(out);
  if (pen < depth) {
    depth = pen;
    nx = d < 0 ? -fx : fx;
    ny = d < 0 ? -fy : fy;
  }

  return setContact(out, nx, ny, depth);
}

/**
 * OBB vs circle centred on `(px, py)` with radius `radiusM` (metres). Uses the closest point on the box to the
 * circle centre, which covers face and corner regions alike. Returns whether they overlap and writes the MTV
 * that pushes the OBB out of the circle into `out`.
 */
export function obbVsCircle(obb: Obb, px: number, py: number, radiusM: number, out: Contact): boolean {
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
  return setContact(out, nlx * rx + nly * fx, nlx * ry + nly * fy, depth);
}
