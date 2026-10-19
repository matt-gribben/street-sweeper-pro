// Phase 3: Bessie vs the static world (TECHNICAL_DESIGN §9.2, SSP-036).
//
//   1. Bessie's OBB (body.widthM × body.lengthM, 1.75 × 3.25 m) at the pose phase 2 integrated.
//   2. Sub-step the move from the tick's start pose when it exceeds grid.subStepMaxM: 1.0 m, or half the
//      thinnest prop's smallest extent (0.15 m with a bollard, SSP-037); ceil(d / step) steps (sweep.ts).
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
//   6. TOWED (HP 0 → EV.ShiftEnd once) lives in phase 10, shift.ts (SSP-062).
//
// Vehicles (SSP-090, TECHNICAL_DESIGN §9.4). Parked cars are boxes in the static grid (ShapeSource.Parked) and
// moving traffic is the vehicle store (`vehicles`, when the World passes it): each step's candidates are the
// grid's shapes, then the moving vehicles whose AABB may touch Bessie's (queryVehicles; shape index
// grid.shapeCount + vehicle index, so the static world wins a tie). Traffic is kinematic: Bessie resolves
// against a vehicle exactly as against static geometry (the same MTV, restitution and EV.Impact, from her own
// velocity only), and phase 8 stops a vehicle rather than move it into her. The responses differ by kind:
//   - moving traffic: the impact damage above, HP only (no points or complaints, ENTITY_CATALOG §17 Q3);
//   - a parked car: no impact damage. An approaching contact faster than damageThresholdMps dents the car if
//     its contact episode has not dented it yet (store.dented, parked.ts): the flat kindDentHp off HP (5, §17
//     Q4, replacing the impact damage) and EV.Dent {entity = the car, a = x, b = y, c = vn} instead of
//     EV.Impact; the dent is listed (dentVehicle/dentX/dentY) for parked.ts applyVehicleContacts, which
//     records the penalty fact. Any other approaching contact with it emits EV.Impact and costs nothing.
// Every vehicle pushed against is listed in `touched` (its contact episode, parked.ts). Both lists belong to
// the attempt: undoing an attempt empties them, like the log.
//
// Pushing out of the deepest contact first, rather than the first one found, is what makes a flush seam
// between two merged rects harmless: the wall the OBB is really pressed into goes first and leaves the
// neighbour merely touching. Ties between equally deep contacts go to the lower shape index (grid order).
//
// The pose correction is accumulated across sub-steps and added to the end pose. There is no angular response
// in M1: phase 3 never turns Bessie, except to undo phase 2's turn when it cannot be resolved (the fallback
// below resolveStatic, SSP-037). Allocation-free: all scratch lives in the StaticResolver, created once.
import { EV, type EventQueue, emitEvent } from '../eventQueue.ts';
import { cos, sin } from '../fmath.ts';
import type { VehicleParams, VehicleState } from '../vehicle.ts';
import { queryVehicles, VEHICLE_CAPACITY, VEHICLE_FLAG, type VehicleStore } from '../vehicleStore.ts';
import { queryStatic, ShapeKind, ShapeSource, type StaticGrid, staticContact } from './grid.ts';
import { type Aabb, createAabb, createObb, type Obb, obbAabb, obbCorners, refreshObbAxes } from './obb.ts';
import { type Circle, type Contact, createContact, obbVsObb } from './sat.ts';
import { createPose, createSweep, type Pose, type Sweep, sweepPose, sweepStepCount } from './sweep.ts';

/** MTV iterations per sub-step (§9.2 step 5). */
export const MAX_RESOLVE_ITERATIONS = 4;

/**
 * How a tick's resolve ended (SSP-037). Clear: the integrated move resolved (the normal case). HeadingHeld:
 * the turn could not be resolved by translation, so the heading was held at the tick's start heading.
 * Stopped: neither resolved, so Bessie stopped at the furthest clear point of her move, velocity zeroed.
 */
export const ResolveOutcome = { Clear: 0, HeadingHeld: 1, Stopped: 2 } as const;
export type ResolveOutcome = (typeof ResolveOutcome)[keyof typeof ResolveOutcome];

/** Bisection steps for ResolveOutcome.Stopped: a 0.29 m move is cut to within 0.29 m / 2^16 ≈ 4.4 µm. */
export const STOP_BISECTION_STEPS = 16;

/** Contacts the per-tick log keeps; later ones in the same tick are resolved but not logged. */
export const CONTACT_LOG_CAPACITY = 64;

/** Dents one tick can list (a handful of parked cars at most can touch Bessie at once). */
export const DENTS_PER_TICK = 8;

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
  /** How this tick's resolve ended (ResolveOutcome). */
  outcome: ResolveOutcome;
  /** State saved before an attempt, restored if the attempt is undone. */
  savedVLongMps: number;
  savedVLatMps: number;
  savedHp: number;
  savedEventCount: number;
  /** The vehicle store phase 3 resolves moving traffic from (null: static shapes only). Set per call. */
  vehicles: VehicleStore | null;
  /** Moving-vehicle candidates of the current query (queryVehicles) and the OBB and AABB of one of them. */
  readonly vehicleCandidates: Int32Array;
  readonly vehicleObb: Obb;
  readonly vehicleAabb: Aabb;
  /** Vehicles (store indices) pushed against this tick, each once. */
  readonly touched: Int32Array;
  touchedCount: number;
  /** This tick's dents: the parked car (store index) and the contact point (m). */
  readonly dentVehicle: Int32Array;
  readonly dentX: Float64Array;
  readonly dentY: Float64Array;
  dentCount: number;
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
    outcome: ResolveOutcome.Clear,
    savedVLongMps: 0,
    savedVLatMps: 0,
    savedHp: 0,
    savedEventCount: 0,
    vehicles: null,
    vehicleCandidates: new Int32Array(VEHICLE_CAPACITY),
    vehicleObb: createObb(),
    vehicleAabb: createAabb(),
    touched: new Int32Array(VEHICLE_CAPACITY),
    touchedCount: 0,
    dentVehicle: new Int32Array(DENTS_PER_TICK),
    dentX: new Float64Array(DENTS_PER_TICK),
    dentY: new Float64Array(DENTS_PER_TICK),
    dentCount: 0,
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
  const store = r.vehicles;
  if (store !== null && store.count > store.parkedCount) {
    const m = queryVehicles(store, r.aabb, r.vehicleCandidates);
    for (let k = 0; k < m; k += 1) {
      const j = r.vehicleCandidates[k] as number;
      if (((store.flags[j] as number) & VEHICLE_FLAG.PARKED) !== 0) continue; // in the static grid
      // An actor (bicycle, mobility scooter) is hit, not collided with (SSP-091, traffic.ts stepActorVehicles).
      if (store.kindActor[store.kind[j] as number] === 1) continue;
      vehicleObbOf(store, j, r.vehicleObb);
      if (!obbVsObb(r.obb, r.vehicleObb, c)) continue;
      // A vehicle's shape index follows every static shape, so ties go to the static world.
      const s = grid.shapeCount + j;
      if (c.depthM > r.bestDepth || (c.depthM === r.bestDepth && s < r.bestShape)) {
        r.bestShape = s;
        r.bestDepth = c.depthM;
        r.bestNx = c.normalX;
        r.bestNy = c.normalY;
      }
    }
  }
  return r.bestShape >= 0;
}

/** Vehicle j's body OBB (pose and half extents from the store) into `out`. */
function vehicleObbOf(store: VehicleStore, j: number, out: Obb): void {
  out.cx = store.x[j] as number;
  out.cy = store.y[j] as number;
  out.headingRad = store.heading[j] as number;
  out.halfWidthM = store.halfWidth[j] as number;
  out.halfLengthM = store.halfLength[j] as number;
  refreshObbAxes(out);
}

/** The vehicle-store index behind shape `s` (a parked box or a moving vehicle), or −1 for the static world. */
function vehicleOfShape(grid: StaticGrid, s: number): number {
  if (s >= grid.shapeCount) return s - grid.shapeCount;
  return grid.source[s] === ShapeSource.Parked ? (grid.vehicleIndex[s] as number) : -1;
}

/** List vehicle j as touched this tick (once). */
function markTouched(r: StaticResolver, j: number): void {
  for (let k = 0; k < r.touchedCount; k += 1) if (r.touched[k] === j) return;
  if (r.touchedCount < r.touched.length) {
    r.touched[r.touchedCount] = j;
    r.touchedCount += 1;
  }
}

/** True when this attempt has dented vehicle j already. */
function dentedThisTick(r: StaticResolver, j: number): boolean {
  for (let k = 0; k < r.dentCount; k += 1) if (r.dentVehicle[k] === j) return true;
  return false;
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
  let b = (s < grid.shapeCount ? grid.bounds[s] : r.vehicleAabb) as Readonly<Aabb>;
  if (s >= grid.shapeCount && r.vehicles !== null) {
    // A moving vehicle: clamp into its body's AABB.
    vehicleObbOf(r.vehicles, s - grid.shapeCount, r.vehicleObb);
    b = obbAabb(r.vehicleObb, r.vehicleAabb);
  }
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
 * Snapshot the state an attempt may change (velocity, HP, event and log counts) so a failed attempt can be
 * undone. Kept on the resolver, not in locals passed around, so no double crosses a call boundary.
 */
function saveAttempt(r: StaticResolver, v: VehicleState, events: EventQueue): void {
  r.savedVLongMps = v.vLongMps;
  r.savedVLatMps = v.vLatMps;
  r.savedHp = v.hp;
  r.savedEventCount = events.count;
}

/** Undo an attempt: restore velocity and HP, drop its events (zeroing their slots) and its log entries. */
function undoAttempt(r: StaticResolver, v: VehicleState, events: EventQueue): void {
  v.vLongMps = r.savedVLongMps;
  v.vLatMps = r.savedVLatMps;
  v.hp = r.savedHp;
  for (let i = r.savedEventCount; i < events.count; i += 1) {
    events.type[i] = 0;
    events.entity[i] = 0;
    events.a[i] = 0;
    events.b[i] = 0;
    events.c[i] = 0;
  }
  events.count = r.savedEventCount;
  r.log.count = 0;
  r.touchedCount = 0;
  r.dentCount = 0;
}

/**
 * One resolve attempt over `r.sweep` (§9.2 steps 1–5): sub-step the move, push the OBB out of the deepest
 * contact up to MAX_RESOLVE_ITERATIONS times per step, respond to approaching contacts, and write the end
 * position into v.xM/yM. The velocity frame is the sweep's end heading. Returns true when the end pose
 * overlaps nothing; false when the last step ran out of iterations with an overlap left.
 */
function resolveSweep(
  grid: StaticGrid,
  r: StaticResolver,
  v: VehicleState,
  params: VehicleParams,
  events: EventQueue,
): boolean {
  const t = params.tuning;
  const col = t.collision;
  const restitution = col.restitution;
  const log = r.log;

  // Heading frame for the velocity response (the end-of-tick heading; phase 3 never turns Bessie).
  const sweep = r.sweep;
  const fx = sin(sweep.heading1Rad);
  const fy = -cos(sweep.heading1Rad);
  const rx = -fy;
  const ry = fx;
  const steps = sweepStepCount(sweep);

  let corrX = 0;
  let corrY = 0;
  let clear = true;
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
    let iter = 0;
    for (; iter < MAX_RESOLVE_ITERATIONS; iter += 1) {
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
      const veh = vehicleOfShape(grid, r.bestShape);
      if (veh >= 0) markTouched(r, veh);
      if (vn > 0) {
        const k = (1 + restitution) * vn;
        const ox = vx + k * nx;
        const oy = vy + k * ny;
        v.vLongMps = ox * fx + oy * fy;
        v.vLatMps = ox * rx + oy * ry;
        const over = vn - col.damageThresholdMps;
        const store = r.vehicles;
        if (veh >= 0 && r.bestShape < grid.shapeCount) {
          // A parked car: no impact damage; a hard enough hit dents it once per contact episode (parked.ts).
          if (
            over > 0 &&
            store !== null &&
            store.dented[veh] === 0 &&
            r.dentCount < r.dentVehicle.length &&
            !dentedThisTick(r, veh)
          ) {
            let hp = v.hp - (store.kindDentHp[store.kind[veh] as number] as number);
            if (hp < 0) hp = 0;
            if (hp > t.health.maxHp) hp = t.health.maxHp;
            v.hp = hp;
            const d = r.dentCount;
            r.dentVehicle[d] = veh;
            r.dentX[d] = r.pointX;
            r.dentY[d] = r.pointY;
            r.dentCount = d + 1;
            const e = emitEvent(events, EV.Dent, veh);
            events.a[e] = r.pointX;
            events.b[e] = r.pointY;
            events.c[e] = vn;
          } else {
            const e = emitEvent(events, EV.Impact, -1);
            events.a[e] = r.pointX;
            events.b[e] = r.pointY;
            events.c[e] = vn;
          }
        } else {
          // impactDamage, inline (walls, props, the map edge and moving traffic).
          let hp = over > 0 ? v.hp - over * col.damageHpPerMps * params.damageMult : v.hp;
          if (hp < 0) hp = 0;
          if (hp > t.health.maxHp) hp = t.health.maxHp;
          v.hp = hp;
          const e = emitEvent(events, EV.Impact, -1);
          events.a[e] = r.pointX;
          events.b[e] = r.pointY;
          events.c[e] = vn;
        }
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
    // Only the end pose is judged: an earlier step may stay unresolved and be cleared by the next.
    if (step === steps && iter === MAX_RESOLVE_ITERATIONS) clear = !findDeepest(grid, r);
    corrX = obb.cx - pose.x;
    corrY = obb.cy - pose.y;
  }
  // The last sub-step pose is the sweep's end pose exactly, so the end position is it plus the correction.
  v.xM = sweep.x1 + corrX;
  v.yM = sweep.y1 + corrY;
  return clear;
}

/**
 * Set the resolver's OBB to Bessie at the sweep's start pose (the pose the tick started from) and return
 * whether it overlaps nothing.
 */
function startPoseClear(grid: StaticGrid, r: StaticResolver, params: VehicleParams): boolean {
  const obb = r.obb;
  obb.halfWidthM = params.tuning.body.widthM * 0.5;
  obb.halfLengthM = params.tuning.body.lengthM * 0.5;
  obb.cx = r.sweep.x0;
  obb.cy = r.sweep.y0;
  obb.headingRad = r.sweep.heading0Rad;
  refreshObbAxes(obb);
  return !findDeepest(grid, r);
}

/**
 * Resolve Bessie against `grid` for this tick (§9.2 steps 1–5): moves `v` out of every static shape (and, with
 * `vehicles`, every moving vehicle: see the header), reflects and damages on approaching contacts and emits
 * EV.Impact for each (EV.Dent for a parked car's dent). Reads the move from v.prevXM/prevYM/
 * prevHeadingRad (the tick's start pose, copied by stepVehicle) to v.xM/yM/headingRad. Allocation-free.
 *
 * MTV push-out cannot resolve every move (SSP-037's property 1 found both cases): with no angular response a
 * turn can leave Bessie in an orientation no translation frees (turning in a pocket barely wider than she
 * is), and a move into a gap narrower than her rotated width pushes her back and forth between its sides.
 * When the end pose still overlaps after the last iteration, the attempt is undone and the move is resolved
 * again with the heading held at the tick's start heading and the yaw rate zeroed (ResolveOutcome.
 * HeadingHeld). If that still overlaps and the start pose was clear, Bessie stops at the furthest point of the
 * straight move from the start pose that overlaps nothing, found by bisection, with her velocity zeroed and
 * no impact (ResolveOutcome.Stopped). Either way a tick that starts clear never ends inside a solid.
 */
export function resolveStatic(
  grid: StaticGrid,
  r: StaticResolver,
  v: VehicleState,
  params: VehicleParams,
  events: EventQueue,
  vehicles: VehicleStore | null = null,
): void {
  r.vehicles = vehicles;
  r.log.count = 0;
  r.touchedCount = 0;
  r.dentCount = 0;
  r.outcome = ResolveOutcome.Clear;
  const sweep = r.sweep;
  sweep.x0 = v.prevXM;
  sweep.y0 = v.prevYM;
  sweep.heading0Rad = v.prevHeadingRad;
  sweep.x1 = v.xM;
  sweep.y1 = v.yM;
  sweep.heading1Rad = v.headingRad;
  sweep.maxStepM = grid.subStepMaxM;
  saveAttempt(r, v, events);
  if (resolveSweep(grid, r, v, params, events)) return;

  // The turn cannot be resolved by translation: hold the start heading and try again.
  undoAttempt(r, v, events);
  r.outcome = ResolveOutcome.HeadingHeld;
  sweep.heading1Rad = sweep.heading0Rad;
  v.headingRad = v.prevHeadingRad;
  v.yawRateRadPerS = 0;
  if (resolveSweep(grid, r, v, params, events)) return;

  // Still blocked (wedged in a gap): stop at the furthest clear point of the straight move, if the start pose
  // was clear (else keep the best effort above, so a spawn overlap still works its way out).
  if (!startPoseClear(grid, r, params)) return;
  undoAttempt(r, v, events);
  r.outcome = ResolveOutcome.Stopped;
  const obb = r.obb; // at the start pose, start heading (startPoseClear)
  const dx = sweep.x1 - sweep.x0;
  const dy = sweep.y1 - sweep.y0;
  let lo = 0; // clear
  let hi = 1; // blocked
  for (let i = 0; i < STOP_BISECTION_STEPS; i += 1) {
    const mid = (lo + hi) * 0.5;
    obb.cx = sweep.x0 + dx * mid;
    obb.cy = sweep.y0 + dy * mid;
    if (findDeepest(grid, r)) hi = mid;
    else lo = mid;
  }
  v.xM = sweep.x0 + dx * lo;
  v.yM = sweep.y0 + dy * lo;
  v.vLongMps = 0;
  v.vLatMps = 0;
}
