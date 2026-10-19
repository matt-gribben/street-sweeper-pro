// Phase 3: Bessie vs the static world (TECHNICAL_DESIGN §9.2, SSP-036).
//
//   1. Bessie's OBB (body.widthM × body.lengthM, 1.75 × 3.25 m) at the pose phase 2 integrated.
//   2. Sub-step the move from the tick's start pose when it exceeds 1.0 m: ceil(d / 1.0) steps (sweep.ts).
//   3. At each step, query the grid cells under the OBB's AABB into the grid's candidate list.
//   4. SAT against every candidate (grid.ts staticContact; merged rects use the ghost-edge mask).
//   5. Push out along the DEEPEST contact's MTV, then re-query and repeat, at most 4 times per step (inside
//      corners take two). Each push that resolves an approaching contact (incoming normal speed vn > 0) is an
//      impact: the world velocity's normal part is reflected with restitution e (tuning collision.restitution,
//      0.2), the tangential part is kept, and the result is re-expressed as vLong/vLat in Bessie's heading
//      frame. Damage = damageHpPerMps × max(0, vn − damageThresholdMps) × params.damageMult (4 HP per m/s
//      above 2 m/s; upg.bumper sets damageMult 0.6 later). HP is clamped to [0, maxHp]. One EV.Impact
//      {a = x, b = y, c = vn} is emitted per impact, at the contact point.
//      A contact whose vn ≤ 0 (already separating, e.g. after a bounce) is only pushed out: no velocity change,
//      no damage, no event. That is the answer to the "scraping emits every tick" OPEN in SSP-036 (flagged).
//   6. The TOWED stub (HP 0 → EV.ShiftEnd once) lives in world.ts phase 10.
//
// Pushing out of the deepest contact first, rather than the first one found, is what makes a flush seam
// between two merged rects harmless: the wall the OBB is really pressed into goes first and leaves the
// neighbour merely touching. Ties between equally deep contacts go to the lower shape index (grid order).
//
// The pose correction is accumulated across sub-steps and added to the end pose; heading is never changed
// (no angular response in M1). Allocation-free: all scratch lives in the StaticResolver, created once.
import { EV, type EventQueue, emitEvent } from '../eventQueue.ts';
import { cos, sin } from '../fmath.ts';
import type { VehicleParams, VehicleState } from '../vehicle.ts';
import { queryStatic, ShapeKind, type StaticGrid, staticContact } from './grid.ts';
import { type Aabb, createAabb, createObb, type Obb, obbAabb, obbCorners, refreshObbAxes } from './obb.ts';
import { type Circle, type Contact, createContact } from './sat.ts';
import { createPose, createSweep, type Pose, type Sweep, sweepPose, sweepStepCount } from './sweep.ts';

/** MTV iterations per sub-step (§9.2 step 5). */
export const MAX_RESOLVE_ITERATIONS = 4;

/** Contacts the per-tick log keeps; later ones in the same tick are resolved but not logged. */
export const CONTACT_LOG_CAPACITY = 64;

/** Corner projections closer than this along the normal count as one face (the contact point averages them). */
const FACE_TIE_EPS_M = 1e-9;

/**
 * Extra push beyond the MTV depth. Moving a centre near x = 30 m by an MTV of ~1e-15 m can round to no move at
 * all, which would leave a residual "overlap" every iteration; 0.1 nm clears it at any map coordinate (the
 * double spacing at 512 m is 1.1e-13 m) and is far below every tolerance (1 mm penetration, 1e-9 m idempotence).
 */
export const RESOLVE_SLOP_M = 1e-10;

/**
 * Every push phase 3 made this tick, in order (struct-of-arrays, `count` entries from index 0). For tests,
 * the dev panel and debug draw. `vn` is the incoming normal speed (> 0 for an impact, ≤ 0 for a push only).
 */
export type ContactLog = {
  count: number;
  readonly shape: Int32Array;
  readonly normalX: Float64Array;
  readonly normalY: Float64Array;
  readonly depthM: Float64Array;
  readonly x: Float64Array;
  readonly y: Float64Array;
  readonly vnMps: Float64Array;
};

/** Read-only view of the contact log for render, UI and tests. */
export type ReadonlyContactLog = {
  readonly count: number;
  readonly shape: ArrayLike<number>;
  readonly normalX: ArrayLike<number>;
  readonly normalY: ArrayLike<number>;
  readonly depthM: ArrayLike<number>;
  readonly x: ArrayLike<number>;
  readonly y: ArrayLike<number>;
  readonly vnMps: ArrayLike<number>;
};

/** Preallocated phase-3 scratch and the per-tick contact log. */
export type StaticResolver = {
  readonly obb: Obb;
  readonly aabb: Aabb;
  readonly contact: Contact;
  readonly pose: Pose;
  readonly sweep: Sweep;
  readonly corners: Float64Array;
  readonly log: ContactLog;
  /** The deepest contact of the current iteration. */
  bestShape: number;
  bestNx: number;
  bestNy: number;
  bestDepth: number;
  /** Contact point of the current push. */
  pointX: number;
  pointY: number;
};

/** Allocate the resolver. Once per World. */
export function createStaticResolver(): StaticResolver {
  return {
    obb: createObb(),
    aabb: createAabb(),
    contact: createContact(),
    pose: createPose(),
    sweep: createSweep(),
    corners: new Float64Array(8),
    log: {
      count: 0,
      shape: new Int32Array(CONTACT_LOG_CAPACITY),
      normalX: new Float64Array(CONTACT_LOG_CAPACITY),
      normalY: new Float64Array(CONTACT_LOG_CAPACITY),
      depthM: new Float64Array(CONTACT_LOG_CAPACITY),
      x: new Float64Array(CONTACT_LOG_CAPACITY),
      y: new Float64Array(CONTACT_LOG_CAPACITY),
      vnMps: new Float64Array(CONTACT_LOG_CAPACITY),
    },
    bestShape: -1,
    bestNx: 0,
    bestNy: 0,
    bestDepth: 0,
    pointX: 0,
    pointY: 0,
  };
}

/**
 * Impact damage for an incoming normal speed (§9.2 step 5): rate × max(0, vn − threshold) × mult. The
 * reference form for tests and tools; resolveStatic writes the same expression inline, because double
 * arguments are boxed when V8 does not inline a call (see eventQueue.ts).
 */
export function impactDamage(
  vnMps: number,
  hpPerMps: number,
  thresholdMps: number,
  damageMult: number,
): number {
  const over = vnMps - thresholdMps;
  return over > 0 ? over * hpPerMps * damageMult : 0;
}

/** Find the deepest contact for the resolver's current OBB; false when nothing overlaps. */
function findDeepest(grid: StaticGrid, r: StaticResolver): boolean {
  obbAabb(r.obb, r.aabb);
  const n = queryStatic(grid, r.aabb);
  const candidates = grid.candidates;
  const c = r.contact;
  r.bestShape = -1;
  r.bestDepth = 0;
  for (let k = 0; k < n; k += 1) {
    const s = candidates[k] as number;
    if (!staticContact(grid, s, r.obb, r.aabb, c)) continue;
    if (c.depthM > r.bestDepth || (c.depthM === r.bestDepth && s < r.bestShape)) {
      r.bestShape = s;
      r.bestDepth = c.depthM;
      r.bestNx = c.normalX;
      r.bestNy = c.normalY;
    }
  }
  return r.bestShape >= 0;
}

/**
 * The contact point for the push just applied (the OBB now touches shape `s`). For a circle, the point on
 * the circle toward the OBB. Otherwise the OBB's deepest point along −normal (the midpoint of a face when two
 * corners tie), clamped into the shape's AABB so a part-overlapping bumper reports a point on the obstacle.
 */
function contactPoint(grid: StaticGrid, r: StaticResolver, s: number): void {
  const nx = r.bestNx;
  const ny = r.bestNy;
  if (grid.kind[s] === ShapeKind.Circle) {
    const circle = grid.circles[s] as Readonly<Circle>;
    r.pointX = circle.x + nx * circle.radiusM;
    r.pointY = circle.y + ny * circle.radiusM;
    return;
  }
  const k = obbCorners(r.obb, r.corners);
  let best = Number.POSITIVE_INFINITY;
  let sumX = 0;
  let sumY = 0;
  let ties = 0;
  for (let i = 0; i < 8; i += 2) {
    const px = k[i] as number;
    const py = k[i + 1] as number;
    const d = px * nx + py * ny;
    if (d < best - FACE_TIE_EPS_M) {
      best = d;
      sumX = px;
      sumY = py;
      ties = 1;
    } else if (d <= best + FACE_TIE_EPS_M) {
      sumX += px;
      sumY += py;
      ties += 1;
    }
  }
  let x = sumX / ties;
  let y = sumY / ties;
  const b = grid.bounds[s] as Readonly<Aabb>;
  const minX = b.minX;
  const maxX = b.maxX;
  const minY = b.minY;
  const maxY = b.maxY;
  x = x < minX ? minX : x > maxX ? maxX : x;
  y = y < minY ? minY : y > maxY ? maxY : y;
  r.pointX = x;
  r.pointY = y;
}

/**
 * Resolve Bessie against `grid` for this tick (§9.2 steps 1–5): moves `v` out of every static shape, reflects
 * and damages on approaching contacts and emits EV.Impact for each. Reads the move from v.prevXM/prevYM/
 * prevHeadingRad (the tick's start pose, copied by stepVehicle) to v.xM/yM/headingRad. Allocation-free.
 */
export function resolveStatic(
  grid: StaticGrid,
  r: StaticResolver,
  v: VehicleState,
  params: VehicleParams,
  events: EventQueue,
): void {
  const t = params.tuning;
  const col = t.collision;
  const restitution = col.restitution;
  const log = r.log;
  log.count = 0;

  // Heading frame for the velocity response (the end-of-tick heading; phase 3 never turns Bessie).
  const fx = sin(v.headingRad);
  const fy = -cos(v.headingRad);
  const rx = -fy;
  const ry = fx;

  // The move phase 2 made, split into ≤ 1 m sub-steps (sweep.ts).
  const sweep = r.sweep;
  sweep.x0 = v.prevXM;
  sweep.y0 = v.prevYM;
  sweep.heading0Rad = v.prevHeadingRad;
  sweep.x1 = v.xM;
  sweep.y1 = v.yM;
  sweep.heading1Rad = v.headingRad;
  const steps = sweepStepCount(sweep);

  let corrX = 0;
  let corrY = 0;
  const pose = r.pose;
  const obb = r.obb;
  obb.halfWidthM = t.body.widthM * 0.5;
  obb.halfLengthM = t.body.lengthM * 0.5;
  for (let step = 1; step <= steps; step += 1) {
    sweepPose(sweep, step, steps, pose);
    obb.cx = pose.x + corrX;
    obb.cy = pose.y + corrY;
    obb.headingRad = pose.headingRad;
    refreshObbAxes(obb);
    for (let iter = 0; iter < MAX_RESOLVE_ITERATIONS; iter += 1) {
      if (!findDeepest(grid, r)) break;
      const nx = r.bestNx;
      const ny = r.bestNy;
      const depth = r.bestDepth;
      obb.cx += nx * (depth + RESOLVE_SLOP_M);
      obb.cy += ny * (depth + RESOLVE_SLOP_M);
      contactPoint(grid, r, r.bestShape);

      // Velocity response: vn is the incoming normal speed (the normal points out of the obstacle).
      const vx = fx * v.vLongMps + rx * v.vLatMps;
      const vy = fy * v.vLongMps + ry * v.vLatMps;
      const vn = -(vx * nx + vy * ny);
      if (vn > 0) {
        const k = (1 + restitution) * vn;
        const ox = vx + k * nx;
        const oy = vy + k * ny;
        v.vLongMps = ox * fx + oy * fy;
        v.vLatMps = ox * rx + oy * ry;
        // impactDamage, inline.
        const over = vn - col.damageThresholdMps;
        let hp = over > 0 ? v.hp - over * col.damageHpPerMps * params.damageMult : v.hp;
        if (hp < 0) hp = 0;
        if (hp > t.health.maxHp) hp = t.health.maxHp;
        v.hp = hp;
        const e = emitEvent(events, EV.Impact, -1);
        events.a[e] = r.pointX;
        events.b[e] = r.pointY;
        events.c[e] = vn;
      }

      const i = log.count;
      if (i < CONTACT_LOG_CAPACITY) {
        log.shape[i] = r.bestShape;
        log.normalX[i] = nx;
        log.normalY[i] = ny;
        log.depthM[i] = depth;
        log.x[i] = r.pointX;
        log.y[i] = r.pointY;
        log.vnMps[i] = vn;
        log.count = i + 1;
      }
    }
    corrX = obb.cx - pose.x;
    corrY = obb.cy - pose.y;
  }
  // The last sub-step pose is the integrated pose exactly, so the end position is it plus the correction.
  v.xM = sweep.x1 + corrX;
  v.yM = sweep.y1 + corrY;
}
