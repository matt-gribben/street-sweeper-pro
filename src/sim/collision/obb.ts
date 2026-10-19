// Oriented bounding boxes for static collision (TECHNICAL_DESIGN §9.2, coordinate conventions §4).
// An OBB is a centre, a heading and two half extents in the vehicle-local frame: local +x is the box's right
// axis `(cos θ, sin θ)` and local +y its forward axis `(sin θ, −cos θ)`, with heading 0 = north, clockwise.
// Bessie's body is 1.75 × 3.25 m (half extents 0.875 × 1.625), centred on the body centre.
// Allocation-free: the only allocating functions are the create* constructors, called once at setup. Every
// other function writes into a caller-supplied object and returns it. Trig goes through fmath (§7.4).
import type { Vec2 } from '../coords.ts';
import { cos, sin } from '../fmath.ts';

/** A mutable oriented box in sim space (metres). Rebuild it with setObb whenever the pose changes. */
export type Obb = {
  /** Centre, metres. */
  cx: number;
  cy: number;
  /** Heading θ in radians (0 = north, clockwise), kept for reference; the axes below are what SAT reads. */
  headingRad: number;
  /** Half extent along the local +x (right) axis, metres. */
  halfWidthM: number;
  /** Half extent along the local +y (forward) axis, metres. */
  halfLengthM: number;
  /** Unit right axis, local +x: `(cos θ, sin θ)`. */
  rightX: number;
  rightY: number;
  /** Unit forward axis, local +y: `(sin θ, −cos θ)`. */
  forwardX: number;
  forwardY: number;
};

/** A mutable axis-aligned box in sim space (metres): min is the NW corner, max the SE corner. */
export type Aabb = { minX: number; minY: number; maxX: number; maxY: number };

/** Number of entries in an OBB corner buffer: 4 corners × (x, y). */
export const OBB_CORNER_COUNT = 4;

/** Allocate a zeroed OBB. Setup only, never per tick. */
export function createObb(): Obb {
  return {
    cx: 0,
    cy: 0,
    headingRad: 0,
    halfWidthM: 0,
    halfLengthM: 0,
    rightX: 1,
    rightY: 0,
    forwardX: 0,
    forwardY: -1,
  };
}

/** Allocate a zeroed AABB. Setup only, never per tick. */
export function createAabb(): Aabb {
  return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
}

/**
 * Build an OBB in place from its centre, heading and half extents (half width along local +x, half length
 * along local +y). Calls sin and cos once each and returns `out`.
 */
export function setObb(
  out: Obb,
  cx: number,
  cy: number,
  headingRad: number,
  halfWidthM: number,
  halfLengthM: number,
): Obb {
  const s = sin(headingRad);
  const c = cos(headingRad);
  out.cx = cx;
  out.cy = cy;
  out.headingRad = headingRad;
  out.halfWidthM = halfWidthM;
  out.halfLengthM = halfLengthM;
  out.rightX = c;
  out.rightY = s;
  out.forwardX = s;
  out.forwardY = -c;
  return out;
}

/**
 * Recompute the unit axes from `obb.headingRad` after the caller has written the heading (and centre and half
 * extents) directly. The per-tick form of setObb: it takes no number arguments, so it never boxes a double
 * when V8 does not inline it (SSP-036; see eventQueue.ts). Returns `obb`.
 */
export function refreshObbAxes(obb: Obb): Obb {
  const s = sin(obb.headingRad);
  const c = cos(obb.headingRad);
  obb.rightX = c;
  obb.rightY = s;
  obb.forwardX = s;
  obb.forwardY = -c;
  return obb;
}

/** Write the OBB's unit right axis (local +x) into `out` and return it. */
export function obbRightAxis(obb: Obb, out: Vec2): Vec2 {
  out.x = obb.rightX;
  out.y = obb.rightY;
  return out;
}

/** Write the OBB's unit forward axis (local +y) into `out` and return it. */
export function obbForwardAxis(obb: Obb, out: Vec2): Vec2 {
  out.x = obb.forwardX;
  out.y = obb.forwardY;
  return out;
}

/**
 * Write the 4 corners into `out` as `[x0, y0, x1, y1, x2, y2, x3, y3]` and return it. The order is fixed:
 * front-right, back-right, back-left, front-left (clockwise on screen, because +y is south). `out` needs at
 * least 2 × OBB_CORNER_COUNT entries.
 */
export function obbCorners(obb: Obb, out: Float64Array): Float64Array {
  const rx = obb.rightX * obb.halfWidthM;
  const ry = obb.rightY * obb.halfWidthM;
  const fx = obb.forwardX * obb.halfLengthM;
  const fy = obb.forwardY * obb.halfLengthM;
  out[0] = obb.cx + rx + fx;
  out[1] = obb.cy + ry + fy;
  out[2] = obb.cx + rx - fx;
  out[3] = obb.cy + ry - fy;
  out[4] = obb.cx - rx - fx;
  out[5] = obb.cy - ry - fy;
  out[6] = obb.cx - rx + fx;
  out[7] = obb.cy - ry + fy;
  return out;
}

/** Half extent of the OBB's projection onto the world x axis, metres. */
export function obbExtentX(obb: Obb): number {
  return Math.abs(obb.rightX) * obb.halfWidthM + Math.abs(obb.forwardX) * obb.halfLengthM;
}

/** Half extent of the OBB's projection onto the world y axis, metres. */
export function obbExtentY(obb: Obb): number {
  return Math.abs(obb.rightY) * obb.halfWidthM + Math.abs(obb.forwardY) * obb.halfLengthM;
}

/** Write the tightest axis-aligned box around the OBB into `out` and return it (the grid query box, §9.2). */
export function obbAabb(obb: Obb, out: Aabb): Aabb {
  // obbExtentX/Y written out: a helper's double return is boxed when V8 does not inline it (SSP-036).
  const ex = Math.abs(obb.rightX) * obb.halfWidthM + Math.abs(obb.forwardX) * obb.halfLengthM;
  const ey = Math.abs(obb.rightY) * obb.halfWidthM + Math.abs(obb.forwardY) * obb.halfLengthM;
  out.minX = obb.cx - ex;
  out.minY = obb.cy - ey;
  out.maxX = obb.cx + ex;
  out.maxY = obb.cy + ey;
  return out;
}
