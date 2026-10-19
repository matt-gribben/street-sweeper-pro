// Knockable impulse bodies, tick phase 4 (TECHNICAL_DESIGN §9.3, ENTITY_CATALOG §9.1; SSP-092): the wheelie
// bins, traffic cones, A-boards, shopping trolleys and recycling boxes Bessie sends sliding and spinning.
//
// Store. Body i lives in slot i of every array, 0 <= i < count (capacity 128, §7.1). Bodies are spawned at
// shift start from the compiled level's `knockables` (spawnKnockables) and never removed in M3. Each is an OBB
// (ENTITY_CATALOG §9: "the opaque bounding box of the lowest slice, as an OBB"; until M4 measures the slices
// the sizes are the provisional tuning.json → knockables.bodies) with a pose (x, y, heading), a linear
// velocity (vx, vy) and an angular velocity (omega, rad/s, the heading's rate: clockwise on screen). Mass comes
// from entities.json `massKg`; the moment of inertia is a uniform box's, m (w² + l²) / 12.
//
// Phase 4, in this order every tick (stepBodies):
//   1. Start of tick: prevX/prevY/prevHeading for render interpolation; this tick's pushes zeroed.
//   2. Body vs body, once per pair (i < j, at least one of them moving), at the poses the tick starts from:
//      the overlap is split between the two by inverse mass into each one's push, and an approaching contact
//      exchanges an impulse with restitution knockables.contact.bodyRestitution. One pass, no iteration and no
//      resting-contact solver: "bodies do not stack" (§9.3). An overlap left over is resolved next tick.
//   3. For each body, in index order:
//      a. Bessie (her pose after phase 3): an overlap pushes the body out along the SAT normal (into its push)
//         and, when approaching, applies an impulse off Bessie as an infinite-mass mover, so the body leaves
//         with (1 + bessieRestitution) × her normal speed at the contact point (her yaw included). Bessie's
//         velocity, pose and HP never change: knockables never slow or damage her.
//      b. The move: push + v·dt and omega·dt, sub-stepped against the static grid (the same merged solids, map
//         boundary and static props Bessie meets) when it exceeds the kind's step: half its smallest extent
//         (0.2 m for the 0.4 m cone), or the grid's thin-prop step (0.15 m with a bollard) when that is less
//         (§9.3's supplementary sub-step rule). At each step the deepest static contact is pushed out, up to
//         4 times, and an approaching one reflects the contact point's normal speed with staticRestitution
//         (with the angular term, so a corner strike spins it). A step that still overlaps after 4 pushes (a
//         pocket it cannot fit) is undone and the body stops there, so a body never ends a tick in a solid.
//      c. Ground friction: the speed falls by the kind's frictionMps2 · dt and the spin by
//         knockables.spin.frictionRadPerS2 · dt, each to exactly 0, where the body sleeps.
//
// Contact episodes and knocks. A body is in an episode with Bessie (BodyFlag.Contact) from the first tick she
// overlaps it until it has been clear of her for knockables.contact.rearmS (0.5 s, rearmTicks). Each episode
// emits one EV.Knock (entity = body index, a/b = the contact point, c = its KNOCKABLE_IDS index; the sound is
// the kind's entities.json `sfx.knock`). The FIRST episode of a body's shift is its knock (BodyFlag.Knocked):
//   - its penalty: when entities.json `knock.pts` < 0 (bin −50, A-board −25, recycling box −25) a penalty fact
//     (Offence.Knock, pts, 0 complaints) at the body's centre goes into the penalty log, so phase 9 takes the
//     points off and resets the combo chain. Free props (cone, trolley: pts 0) record nothing and never touch
//     the chain.
//   - its spill: `knock.spills` items (bin 4, recycling box 2) of the district's small-litter table (the
//     hazard store's spill table, hazards.ts createSpillTable) added to the LitterField through addLitter, so
//     they count in litterSpawned and are worth their normal points. Each item draws, on the World's `events`
//     stream (LEVEL_DESIGN §9.1 rule 7): its kind (nextInt over the weights), how far it lands along the hit
//     normal away from Bessie (spill.nearM + [0, spill.depthM)), across (±spill.halfWidthM) and its rotation
//     (nextInt(4)). An item whose point falls on a solid tile (or off the map) lands at the body's centre
//     instead. A full LitterField drops the rest.
//   Later episodes (second hits) only emit EV.Knock: they cost nothing and spill nothing (decided in SSP-092,
//   ENTITY_CATALOG §9.1). Only Bessie knocks a body: a body shoved by another body just slides.
//
// Moving a body from outside phase 4 (tests, tools, a later scripted event): write x/y/heading, then call
// updateBodyBounds, which refreshes the cached AABB the broad phases read (like litter.ts updateLitterCell).
//
// Hot path: stepBodies allocates nothing (tests/unit/bodiesAlloc.test.ts: 128 bodies knocked, spilling and
// colliding). Scratch lives on the store, and the scalars the hot loops read live in typed arrays (`f`,
// `params`, `bessieBox`), not object fields: measured in SSP-092, V8 boxed double reads of object fields in
// these loops. The helpers take the store, other objects and small integers and return booleans, so no double
// crosses a call (a double argument or return value is boxed when V8 does not inline the call; see
// eventQueue.ts); spills land through litter.ts addLitterAt for the same reason. createBodyStore, addBody,
// spawnKnockables and setBodiesTuning run at setup and may allocate.

import { isSolidCell, queryStatic, ShapeKind, type StaticGrid, staticContact } from './collision/grid.ts';
import {
  type Aabb,
  createAabb,
  createObb,
  type Obb,
  obbAabb,
  obbCorners,
  refreshObbAxes,
} from './collision/obb.ts';
import { type Circle, type Contact, createContact, obbVsObb } from './collision/sat.ts';
import { Offence } from './complaints.ts';
import { DT_S, SIM_HZ, TILE_M } from './constants.ts';
import { type Entities, KNOCKABLE_IDS } from './entities.ts';
import { EV, type EventQueue, emitEvent } from './eventQueue.ts';
import { sqrt } from './fmath.ts';
import type { SpillTable } from './hazards.ts';
import { addLitterAt, LITTER_ROTATIONS, type LitterField } from './litter.ts';
import type { Level } from './map.ts';
import { type PenaltyLog, pushPenalty } from './penalties.ts';
import { nextFloat, nextInt, type Sfc32 } from './rng.ts';
import type { KnockablesTuning, SweeperTuning, Tuning } from './tuning.ts';
import type { VehicleState } from './vehicle.ts';

// Slots of BodyStore.f (scalar scratch).
const F_NX = 0;
const F_NY = 1;
const F_DEPTH = 2;
const F_PX = 3;
const F_PY = 4;
const F_BESSIE_VX = 5;
const F_BESSIE_VY = 6;
const F_BESSIE_YAW = 7;
const F_OTHER_VX = 8;
const F_OTHER_VY = 9;
const F_RESTITUTION = 10;
const F_COUNT = 11;

// Slots of BodyStore.params (the knockables tuning, copied as doubles by createBodyStore and setBodiesTuning).
const P_BESSIE_RESTITUTION = 0;
const P_STATIC_RESTITUTION = 1;
const P_BODY_RESTITUTION = 2;
const P_SPIN_FRICTION = 3;
const P_SPILL_NEAR = 4;
const P_SPILL_DEPTH = 5;
const P_SPILL_HALF_WIDTH = 6;
const P_COUNT = 7;

/** Knockable store capacity (TECHNICAL_DESIGN §7.1). */
export const BODY_CAPACITY = 128;

/** Static pushes per sub-step (as Bessie's, §9.2 step 5). */
export const BODY_RESOLVE_ITERATIONS = 4;

/** Extra push beyond the MTV depth, as collision/resolveStatic.ts RESOLVE_SLOP_M (see there). */
const SLOP_M = 1e-10;

/** Tolerance for "a corner lies inside the other box" in the contact-point estimate. */
const INSIDE_EPS_M = 1e-9;

/**
 * Safety caps on a body's speed and spin (not tuning: no impact in the game comes near them; a body is
 * rarely faster than (1 + bessieRestitution) × 17.2 m/s). They bound the sub-step count if a body is
 * ever squeezed between Bessie and a wall for many ticks.
 */
export const BODY_MAX_SPEED_MPS = 40;
export const BODY_MAX_SPIN_RAD_PER_S = 40;

/** Per-body flag bits (`flags`, Uint8). Hashed into replays: append, never renumber. */
export const BodyFlag = {
  /** Bessie has knocked it this shift: its penalty and spill are spent. */
  Knocked: 1,
  /** In a contact episode with Bessie (until it has been clear of her for contact.rearmS). */
  Contact: 2,
} as const;
export type BodyFlag = (typeof BodyFlag)[keyof typeof BodyFlag];

/** Per-kind tables, indexed by KNOCKABLE_IDS index. Built from entities.json and tuning.json. */
export type BodyKinds = {
  readonly massKg: Float64Array;
  readonly invMass: Float64Array;
  /** 1 / (m (w² + l²) / 12). */
  readonly invInertia: Float64Array;
  readonly halfWidthM: Float64Array;
  readonly halfLengthM: Float64Array;
  /** Half the diagonal: how far a corner is from the centre. */
  readonly halfDiagM: Float64Array;
  readonly frictionMps2: Float64Array;
  /** The largest step a move takes between static tests (the sub-step rule in the header). */
  readonly stepM: Float64Array;
  /** entities.json knock.pts (0 or below) and knock.spills. */
  readonly pts: Int32Array;
  readonly spills: Uint8Array;
};

/** The mutable knockable store. Create with createBodyStore; only the sim writes it. */
export type BodyStore = {
  readonly capacity: number;
  /** Live bodies, 0..capacity. */
  count: number;
  /** Index into KNOCKABLE_IDS. */
  readonly kind: Uint8Array;
  /** BodyFlag bits. */
  readonly flags: Uint8Array;
  /** Ticks Bessie must stay clear before a new episode can start; reset while she touches it. */
  readonly rearmTicks: Int32Array;
  /** Centre (m) and heading (rad, 0 = north, clockwise). */
  readonly x: Float64Array;
  readonly y: Float64Array;
  readonly heading: Float64Array;
  /** Pose at the start of the tick, for render interpolation. */
  readonly prevX: Float64Array;
  readonly prevY: Float64Array;
  readonly prevHeading: Float64Array;
  /** Linear velocity (m/s) and spin (rad/s, the heading's rate). */
  readonly vx: Float64Array;
  readonly vy: Float64Array;
  readonly omega: Float64Array;
  /** This tick's positional corrections (body-body splits and Bessie's push), swept in step b. 0 between ticks. */
  readonly pushX: Float64Array;
  readonly pushY: Float64Array;
  /** Each body's AABB at its current pose (the pair and Bessie broad phase). */
  readonly minX: Float64Array;
  readonly minY: Float64Array;
  readonly maxX: Float64Array;
  readonly maxY: Float64Array;
  readonly kinds: BodyKinds;
  /** Contact, spin and spill rules (tuning.json → knockables). Replace through setBodiesTuning. */
  tuning: KnockablesTuning;
  /** The same rules as doubles, indexed by the P_* constants (read per contact; see `f`). */
  readonly params: Float64Array;
  /** contact.rearmS in ticks (at least 1). */
  rearmTicksMax: number;
  /** The grid's thin-prop step (StaticGrid.subStepMaxM), kept for setBodiesTuning. */
  readonly gridStepM: number;
  /** The district's small-litter table spills draw from (the hazard store's). */
  readonly spill: SpillTable;
  /** The stream spills draw on: the World's `events` stream. */
  readonly rng: Sfc32;
  /** EV.Knock events this shift (contact episodes). */
  knocks: number;
  /** Bodies knocked (first episodes) this shift. */
  bodiesKnocked: number;
  /** Litter items spilled this shift. */
  itemsSpilled: number;
  /** Points of the penalty facts recorded this shift (0 or below). */
  penaltyPts: number;
  // Scratch (never read across ticks).
  readonly obb: Obb;
  readonly other: Obb;
  readonly bessie: Obb;
  readonly aabb: Aabb;
  readonly bessieAabb: Aabb;
  /** Bessie's AABB as [minX, minY, maxX, maxY], for the per-body broad phase. */
  readonly bessieBox: Float64Array;
  readonly contact: Contact;
  readonly cornersA: Float64Array;
  readonly cornersB: Float64Array;
  /** A spilled item's landing point [x, y]. */
  readonly spillAt: Float64Array;
  /** The deepest static shape of the current push, or −1. */
  bestShape: number;
  /**
   * Scalar scratch, indexed by the F_* constants: the contact normal (toward the body), depth and point,
   * Bessie's world velocity and yaw rate this tick, the other side's velocity at the contact point and the
   * current contact's restitution. A typed array, not object fields: V8 boxed the double reads of object
   * fields in phase 4's hot loops (measured by tests/unit/bodiesAlloc.test.ts).
   */
  readonly f: Float64Array;
};

/** What render, audio and UI may see: the same object, typed read-only. */
export type BodyStoreView = {
  readonly capacity: number;
  readonly count: number;
  readonly kind: ArrayLike<number>;
  readonly flags: ArrayLike<number>;
  readonly x: ArrayLike<number>;
  readonly y: ArrayLike<number>;
  readonly heading: ArrayLike<number>;
  readonly prevX: ArrayLike<number>;
  readonly prevY: ArrayLike<number>;
  readonly prevHeading: ArrayLike<number>;
  readonly vx: ArrayLike<number>;
  readonly vy: ArrayLike<number>;
  readonly omega: ArrayLike<number>;
  readonly knocks: number;
  readonly bodiesKnocked: number;
  readonly itemsSpilled: number;
  readonly penaltyPts: number;
};

/** The KNOCKABLE_IDS index of `id`, or −1 when it is not a knockable prop. */
export function knockableKindIndex(id: string): number {
  return (KNOCKABLE_IDS as readonly string[]).indexOf(id);
}

/** Fill `kinds` from entities.json (mass, penalty, spills) and the knockables tuning (size, friction). */
function fillKinds(kinds: BodyKinds, entities: Entities, t: KnockablesTuning, gridStepM: number): void {
  for (let k = 0; k < KNOCKABLE_IDS.length; k += 1) {
    const id = KNOCKABLE_IDS[k] as (typeof KNOCKABLE_IDS)[number];
    const e = entities.knockables[id];
    const b = t.bodies[id];
    const m = e.massKg;
    kinds.massKg[k] = m;
    kinds.invMass[k] = 1 / m;
    kinds.invInertia[k] = 12 / (m * (b.widthM * b.widthM + b.lengthM * b.lengthM));
    const hw = b.widthM / 2;
    const hl = b.lengthM / 2;
    kinds.halfWidthM[k] = hw;
    kinds.halfLengthM[k] = hl;
    kinds.halfDiagM[k] = sqrt(hw * hw + hl * hl);
    kinds.frictionMps2[k] = b.frictionMps2;
    const half = hw < hl ? hw : hl;
    kinds.stepM[k] = half < gridStepM ? half : gridStepM;
    kinds.pts[k] = e.knock.pts;
    kinds.spills[k] = e.knock.spills;
  }
}

function createKinds(): BodyKinds {
  const n = KNOCKABLE_IDS.length;
  return {
    massKg: new Float64Array(n),
    invMass: new Float64Array(n),
    invInertia: new Float64Array(n),
    halfWidthM: new Float64Array(n),
    halfLengthM: new Float64Array(n),
    halfDiagM: new Float64Array(n),
    frictionMps2: new Float64Array(n),
    stepM: new Float64Array(n),
    pts: new Int32Array(n),
    spills: new Uint8Array(n),
  };
}

function fillParams(params: Float64Array, t: KnockablesTuning): void {
  params[P_BESSIE_RESTITUTION] = t.contact.bessieRestitution;
  params[P_STATIC_RESTITUTION] = t.contact.staticRestitution;
  params[P_BODY_RESTITUTION] = t.contact.bodyRestitution;
  params[P_SPIN_FRICTION] = t.spin.frictionRadPerS2;
  params[P_SPILL_NEAR] = t.spill.nearM;
  params[P_SPILL_DEPTH] = t.spill.depthM;
  params[P_SPILL_HALF_WIDTH] = t.spill.halfWidthM;
}

function rearmTicksOf(t: KnockablesTuning): number {
  const n = Math.round(t.contact.rearmS * SIM_HZ);
  return n < 1 ? 1 : n;
}

/**
 * An empty knockable store: kind tables from `entities` and `tuning.knockables`, sub-steps capped by `grid`'s
 * thin-prop step, spills drawn from `spill` on `rng` (the World's `events` stream). Allocated once per shift.
 */
export function createBodyStore(
  entities: Entities,
  tuning: Tuning,
  grid: StaticGrid,
  spill: SpillTable,
  rng: Sfc32,
  capacity: number = BODY_CAPACITY,
): BodyStore {
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 0xffff) {
    throw new Error(`createBodyStore: capacity must be an integer 1..65535, got ${capacity}`);
  }
  const kinds = createKinds();
  fillKinds(kinds, entities, tuning.knockables, grid.subStepMaxM);
  const store: BodyStore = {
    capacity,
    count: 0,
    kind: new Uint8Array(capacity),
    flags: new Uint8Array(capacity),
    rearmTicks: new Int32Array(capacity),
    x: new Float64Array(capacity),
    y: new Float64Array(capacity),
    heading: new Float64Array(capacity),
    prevX: new Float64Array(capacity),
    prevY: new Float64Array(capacity),
    prevHeading: new Float64Array(capacity),
    vx: new Float64Array(capacity),
    vy: new Float64Array(capacity),
    omega: new Float64Array(capacity),
    pushX: new Float64Array(capacity),
    pushY: new Float64Array(capacity),
    minX: new Float64Array(capacity),
    minY: new Float64Array(capacity),
    maxX: new Float64Array(capacity),
    maxY: new Float64Array(capacity),
    kinds,
    tuning: tuning.knockables,
    params: new Float64Array(P_COUNT),
    rearmTicksMax: rearmTicksOf(tuning.knockables),
    gridStepM: grid.subStepMaxM,
    spill,
    rng,
    knocks: 0,
    bodiesKnocked: 0,
    itemsSpilled: 0,
    penaltyPts: 0,
    obb: createObb(),
    other: createObb(),
    bessie: createObb(),
    aabb: createAabb(),
    bessieAabb: createAabb(),
    bessieBox: new Float64Array(4),
    contact: createContact(),
    cornersA: new Float64Array(8),
    cornersB: new Float64Array(8),
    spillAt: new Float64Array(2),
    bestShape: -1,
    f: new Float64Array(F_COUNT),
  };
  fillParams(store.params, tuning.knockables);
  return store;
}

/** The read-only view of `store` for render, audio and UI. No copy: it is the same object. */
export function viewBodyStore(store: BodyStore): BodyStoreView {
  return store;
}

/**
 * Hand the store a new tuning between ticks (setWorldTuning, the dev panel): the kind tables are refilled in
 * place from `tuning.knockables` (sizes, friction) and `entities` (mass, penalty, spills). Not per tick.
 */
export function setBodiesTuning(store: BodyStore, tuning: Tuning, entities: Entities): void {
  store.tuning = tuning.knockables;
  fillParams(store.params, tuning.knockables);
  store.rearmTicksMax = rearmTicksOf(tuning.knockables);
  fillKinds(store.kinds, entities, tuning.knockables, store.gridStepM);
  for (let i = 0; i < store.count; i += 1) updateBodyBounds(store, i);
}

/**
 * Add a body of `kind` (KNOCKABLE_IDS index) at rest at (xM, yM) with `headingRad`, unknocked. Returns its
 * index. Throws when the store is full (a level-authoring error: §7.1 caps knockables at 128) or on a bad
 * kind or position. Setup and tests only: it takes doubles.
 */
export function addBody(store: BodyStore, kind: number, xM: number, yM: number, headingRad: number): number {
  if (!(kind >= 0 && kind < KNOCKABLE_IDS.length && (kind | 0) === kind)) {
    throw new Error(`addBody: kind must be a KNOCKABLE_IDS index, got ${kind}`);
  }
  if (!(Number.isFinite(xM) && Number.isFinite(yM) && Number.isFinite(headingRad))) {
    throw new Error(`addBody: pose must be finite, got (${xM}, ${yM}, ${headingRad})`);
  }
  if (store.count >= store.capacity) {
    throw new Error(
      `addBody: knockable ${store.count + 1} exceeds the store's capacity of ${store.capacity} ` +
        '(TECHNICAL_DESIGN §7.1: 128 knockables per level)',
    );
  }
  const i = store.count;
  store.count = i + 1;
  store.kind[i] = kind;
  store.flags[i] = 0;
  store.rearmTicks[i] = 0;
  store.x[i] = xM;
  store.y[i] = yM;
  store.heading[i] = headingRad;
  store.prevX[i] = xM;
  store.prevY[i] = yM;
  store.prevHeading[i] = headingRad;
  store.vx[i] = 0;
  store.vy[i] = 0;
  store.omega[i] = 0;
  store.pushX[i] = 0;
  store.pushY[i] = 0;
  updateBodyBounds(store, i);
  return i;
}

/** Spawn passes allowed to clear a placed body out of the static world before it counts as stuck. */
const SPAWN_SETTLE_PUSHES = 16;

/**
 * Spawn the level's knockables (`level.knockables`, in file order, heading 0) and push each one clear of the
 * static world it was placed against (a bin authored against a lamp post's footprint). Throws on an id that is
 * not a knockable prop, on more than the store's capacity, or on a placement no push can clear. Setup only.
 */
export function spawnKnockables(store: BodyStore, level: Level, grid: StaticGrid): number {
  const list = level.knockables;
  if (list === null) return 0;
  for (let n = 0; n < list.length; n += 1) {
    const spec = list[n] as { id: string; x: number; y: number };
    const kind = knockableKindIndex(spec.id);
    if (kind < 0) {
      throw new Error(`spawnKnockables: knockables[${n}] ${spec.id} is not a knockable prop (KNOCKABLE_IDS)`);
    }
    const i = addBody(store, kind, spec.x, spec.y, 0);
    let pushes = 0;
    setBodyObb(store, i, store.obb);
    while (findDeepestStatic(store, grid)) {
      if (pushes >= SPAWN_SETTLE_PUSHES) {
        throw new Error(
          `spawnKnockables: knockables[${n}] ${spec.id} at (${spec.x}, ${spec.y}) is stuck inside the static ` +
            'world (a building, wall or static prop)',
        );
      }
      store.obb.cx += (store.f[F_NX] as number) * ((store.f[F_DEPTH] as number) + SLOP_M);
      store.obb.cy += (store.f[F_NY] as number) * ((store.f[F_DEPTH] as number) + SLOP_M);
      pushes += 1;
    }
    store.x[i] = store.obb.cx;
    store.y[i] = store.obb.cy;
    store.prevX[i] = store.obb.cx;
    store.prevY[i] = store.obb.cy;
    updateBodyBounds(store, i);
  }
  return list.length;
}

// ---------------------------------------------------------------------------------------------------------
// Geometry helpers (objects and small integers in, booleans out)
// ---------------------------------------------------------------------------------------------------------

/** Write body i's OBB at its current pose into `out`. */
function setBodyObb(store: BodyStore, i: number, out: Obb): void {
  const k = store.kind[i] as number;
  out.cx = store.x[i] as number;
  out.cy = store.y[i] as number;
  out.headingRad = store.heading[i] as number;
  out.halfWidthM = store.kinds.halfWidthM[k] as number;
  out.halfLengthM = store.kinds.halfLengthM[k] as number;
  refreshObbAxes(out);
}

/**
 * Recompute body i's cached AABB (the broad phase's) from its pose. Code that writes a body's x, y or heading
 * outside stepBodies (tests, tools; later, a scripted event) must call it afterwards, like litter.ts
 * updateLitterCell. Allocation-free.
 */
export function updateBodyBounds(store: BodyStore, i: number): void {
  const obb = store.obb;
  setBodyObb(store, i, obb);
  const box = obbAabb(obb, store.aabb);
  store.minX[i] = box.minX;
  store.minY[i] = box.minY;
  store.maxX[i] = box.maxX;
  store.maxY[i] = box.maxY;
}

/** True when corner c (0..3) of `corners` lies inside `o` (edges inclusive, within INSIDE_EPS_M). */
function cornerInside(o: Obb, corners: Float64Array, c: number): boolean {
  const dx = (corners[2 * c] as number) - o.cx;
  const dy = (corners[2 * c + 1] as number) - o.cy;
  const lx = dx * o.rightX + dy * o.rightY;
  const ly = dx * o.forwardX + dy * o.forwardY;
  return (
    (lx < 0 ? -lx : lx) <= o.halfWidthM + INSIDE_EPS_M && (ly < 0 ? -ly : ly) <= o.halfLengthM + INSIDE_EPS_M
  );
}

/**
 * The contact point of overlapping boxes `a` (the body) and `b`, for the current normal (store.f[F_NX] as number)/ny (from b
 * toward a), into (store.f[F_PX] as number)/py: the mean of every corner of either box that lies inside the other (a corner
 * into a face, two corners for a face on a face, the middle of the overlap for offset boxes). If no corner is
 * inside (two boxes crossing like a plus sign), the middle of a's face toward b.
 */
function boxContactPoint(store: BodyStore, a: Obb, b: Obb): void {
  const ca = obbCorners(a, store.cornersA);
  const cb = obbCorners(b, store.cornersB);
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let c = 0; c < 4; c += 1) {
    if (cornerInside(b, ca, c)) {
      sx += ca[2 * c] as number;
      sy += ca[2 * c + 1] as number;
      n += 1;
    }
    if (cornerInside(a, cb, c)) {
      sx += cb[2 * c] as number;
      sy += cb[2 * c + 1] as number;
      n += 1;
    }
  }
  if (n > 0) {
    store.f[F_PX] = sx / n;
    store.f[F_PY] = sy / n;
    return;
  }
  const nx = store.f[F_NX] as number;
  const ny = store.f[F_NY] as number;
  const r = nx * a.rightX + ny * a.rightY;
  const f = nx * a.forwardX + ny * a.forwardY;
  const ext = (r < 0 ? -r : r) * a.halfWidthM + (f < 0 ? -f : f) * a.halfLengthM;
  store.f[F_PX] = a.cx - nx * ext;
  store.f[F_PY] = a.cy - ny * ext;
}

/**
 * The deepest static contact of store.obb (its AABB into store.aabb): normal, depth and shape into the store.
 * Ties go to the lower shape index. False when it overlaps nothing.
 */
function findDeepestStatic(store: BodyStore, grid: StaticGrid): boolean {
  obbAabb(store.obb, store.aabb);
  const n = queryStatic(grid, store.aabb);
  const candidates = grid.candidates;
  const c = store.contact;
  store.bestShape = -1;
  store.f[F_DEPTH] = 0;
  for (let k = 0; k < n; k += 1) {
    const s = candidates[k] as number;
    if (!staticContact(grid, s, store.obb, store.aabb, c)) continue;
    if (
      c.depthM > (store.f[F_DEPTH] as number) ||
      (c.depthM === (store.f[F_DEPTH] as number) && s < store.bestShape)
    ) {
      store.bestShape = s;
      store.f[F_DEPTH] = c.depthM;
      store.f[F_NX] = c.normalX;
      store.f[F_NY] = c.normalY;
    }
  }
  return store.bestShape >= 0;
}

/** The contact point of store.obb against static shape `s` (store.obb still overlapping it). */
function staticContactPoint(store: BodyStore, grid: StaticGrid, s: number): void {
  const kind = grid.kind[s];
  if (kind === ShapeKind.Circle) {
    const circle = grid.circles[s] as Readonly<Circle>;
    store.f[F_PX] = circle.x + (store.f[F_NX] as number) * circle.radiusM;
    store.f[F_PY] = circle.y + (store.f[F_NY] as number) * circle.radiusM;
    return;
  }
  if (kind === ShapeKind.Box) {
    boxContactPoint(store, store.obb, grid.boxes[s] as Obb);
    return;
  }
  const b = grid.bounds[s] as Readonly<Aabb>;
  const o = store.other;
  o.cx = (b.minX + b.maxX) * 0.5;
  o.cy = (b.minY + b.maxY) * 0.5;
  o.headingRad = 0;
  o.halfWidthM = (b.maxX - b.minX) * 0.5;
  o.halfLengthM = (b.maxY - b.minY) * 0.5;
  o.rightX = 1;
  o.rightY = 0;
  o.forwardX = 0;
  o.forwardY = -1;
  boxContactPoint(store, store.obb, o);
}

// ---------------------------------------------------------------------------------------------------------
// Impulses
// ---------------------------------------------------------------------------------------------------------

/**
 * Apply the contact impulse to body i at (store.f[F_PX] as number)/py along (store.f[F_NX] as number)/ny (pointing from the other side toward
 * i), with (store.f[F_RESTITUTION] as number). The other side is body j, or, for j = −1, an immovable mover whose velocity at
 * the contact point is (store.f[F_OTHER_VX] as number)/otherVy (Bessie, or 0 for the static world). Only an approaching contact
 * (relative normal speed < 0) takes an impulse. Returns whether one was applied.
 */
function applyImpulse(store: BodyStore, i: number, j: number): boolean {
  const kinds = store.kinds;
  const nx = store.f[F_NX] as number;
  const ny = store.f[F_NY] as number;
  const px = store.f[F_PX] as number;
  const py = store.f[F_PY] as number;
  const ki = store.kind[i] as number;
  const rix = px - (store.x[i] as number);
  const riy = py - (store.y[i] as number);
  const wi = store.omega[i] as number;
  const vax = (store.vx[i] as number) - wi * riy;
  const vay = (store.vy[i] as number) + wi * rix;
  let vbx = store.f[F_OTHER_VX] as number;
  let vby = store.f[F_OTHER_VY] as number;
  let rjx = 0;
  let rjy = 0;
  let kj = 0;
  if (j >= 0) {
    kj = store.kind[j] as number;
    rjx = px - (store.x[j] as number);
    rjy = py - (store.y[j] as number);
    const wj = store.omega[j] as number;
    vbx = (store.vx[j] as number) - wj * rjy;
    vby = (store.vy[j] as number) + wj * rjx;
  }
  const vn = (vax - vbx) * nx + (vay - vby) * ny;
  if (!(vn < 0)) return false;
  const imA = kinds.invMass[ki] as number;
  const iiA = kinds.invInertia[ki] as number;
  const rnA = rix * ny - riy * nx;
  let k = imA + rnA * rnA * iiA;
  let imB = 0;
  let iiB = 0;
  let rnB = 0;
  if (j >= 0) {
    imB = kinds.invMass[kj] as number;
    iiB = kinds.invInertia[kj] as number;
    rnB = rjx * ny - rjy * nx;
    k += imB + rnB * rnB * iiB;
  }
  const jn = (-(1 + (store.f[F_RESTITUTION] as number)) * vn) / k;
  store.vx[i] = (store.vx[i] as number) + jn * nx * imA;
  store.vy[i] = (store.vy[i] as number) + jn * ny * imA;
  store.omega[i] = wi + rnA * jn * iiA;
  if (j >= 0) {
    store.vx[j] = (store.vx[j] as number) - jn * nx * imB;
    store.vy[j] = (store.vy[j] as number) - jn * ny * imB;
    store.omega[j] = (store.omega[j] as number) - rnB * jn * iiB;
  }
  return true;
}

// ---------------------------------------------------------------------------------------------------------
// Phase 4
// ---------------------------------------------------------------------------------------------------------

/** True when body i moves this tick (velocity, spin or a push). */
function isAwake(store: BodyStore, i: number): boolean {
  return (
    (store.vx[i] as number) !== 0 ||
    (store.vy[i] as number) !== 0 ||
    (store.omega[i] as number) !== 0 ||
    (store.pushX[i] as number) !== 0 ||
    (store.pushY[i] as number) !== 0
  );
}

/** True when the cached AABBs of bodies i and j overlap with positive area. */
function aabbsOverlap(store: BodyStore, i: number, j: number): boolean {
  return (
    (store.minX[i] as number) < (store.maxX[j] as number) &&
    (store.minX[j] as number) < (store.maxX[i] as number) &&
    (store.minY[i] as number) < (store.maxY[j] as number) &&
    (store.minY[j] as number) < (store.maxY[i] as number)
  );
}

/** Step 2 (see the header): body vs body, once per pair with a mover, at the tick's start poses. */
function resolvePairs(store: BodyStore): void {
  const n = store.count;
  const kinds = store.kinds;
  store.f[F_RESTITUTION] = store.params[P_BODY_RESTITUTION] as number;
  for (let i = 0; i < n; i += 1) {
    const awakeI = isAwake(store, i);
    for (let j = i + 1; j < n; j += 1) {
      if (!awakeI && !isAwake(store, j)) continue;
      if (!aabbsOverlap(store, i, j)) continue;
      setBodyObb(store, i, store.obb);
      setBodyObb(store, j, store.other);
      if (!obbVsObb(store.obb, store.other, store.contact)) continue;
      const c = store.contact;
      store.f[F_NX] = c.normalX;
      store.f[F_NY] = c.normalY;
      store.f[F_DEPTH] = c.depthM;
      boxContactPoint(store, store.obb, store.other);
      const imI = kinds.invMass[store.kind[i] as number] as number;
      const imJ = kinds.invMass[store.kind[j] as number] as number;
      const share = imI / (imI + imJ);
      const d = c.depthM + SLOP_M;
      store.pushX[i] = (store.pushX[i] as number) + c.normalX * d * share;
      store.pushY[i] = (store.pushY[i] as number) + c.normalY * d * share;
      store.pushX[j] = (store.pushX[j] as number) - c.normalX * d * (1 - share);
      store.pushY[j] = (store.pushY[j] as number) - c.normalY * d * (1 - share);
      applyImpulse(store, i, j);
    }
  }
}

/**
 * Spill body i's knock.spills items (see the header) in the hit frame (store.f[F_NX] as number)/ny (away from Bessie), from its
 * centre. Returns how many were added.
 */
function spillBodyLitter(store: BodyStore, i: number, litter: LitterField, grid: StaticGrid): number {
  const count = store.kinds.spills[store.kind[i] as number] as number;
  const table = store.spill;
  const rng = store.rng;
  const params = store.params;
  const near = params[P_SPILL_NEAR] as number;
  const depth = params[P_SPILL_DEPTH] as number;
  const halfWidth = params[P_SPILL_HALF_WIDTH] as number;
  const cx = store.x[i] as number;
  const cy = store.y[i] as number;
  const nx = store.f[F_NX] as number;
  const ny = store.f[F_NY] as number;
  let added = 0;
  for (let s = 0; s < count; s += 1) {
    let pick = nextInt(rng, table.total);
    let t = 0;
    for (; t < table.count - 1; t += 1) {
      const w = table.weight[t] as number;
      if (pick < w) break;
      pick -= w;
    }
    const along = near + nextFloat(rng) * depth;
    const across = (nextFloat(rng) * 2 - 1) * halfWidth;
    const rot = nextInt(rng, LITTER_ROTATIONS);
    // Across is the normal turned a quarter: (−ny, nx). The point goes through a typed array, so no double
    // crosses addLitterAt.
    const at = store.spillAt;
    at[0] = cx + nx * along - ny * across;
    at[1] = cy + ny * along + nx * across;
    if (isSolidCell(grid, Math.floor((at[0] as number) / TILE_M), Math.floor((at[1] as number) / TILE_M))) {
      at[0] = cx;
      at[1] = cy;
    }
    if (addLitterAt(litter, table.kind[t] as number, at, rot) < 0) break;
    added += 1;
  }
  store.itemsSpilled += added;
  return added;
}

/** True when body i's cached AABB overlaps Bessie's this tick (the broad phase of step 3a). */
function nearBessie(store: BodyStore, i: number): boolean {
  const ba = store.bessieBox;
  return (
    (store.minX[i] as number) < (ba[2] as number) &&
    (ba[0] as number) < (store.maxX[i] as number) &&
    (store.minY[i] as number) < (ba[3] as number) &&
    (ba[1] as number) < (store.maxY[i] as number)
  );
}

/**
 * Step 3a: Bessie vs body i at its current pose (its AABB overlaps hers: nearBessie). Returns whether they overlap. On an overlap the body's push
 * takes the MTV, an approaching contact its impulse, and a new episode its EV.Knock (and on its first, its
 * penalty fact and spill).
 */
function contactBessie(
  store: BodyStore,
  i: number,
  grid: StaticGrid,
  litter: LitterField,
  penalties: PenaltyLog,
  events: EventQueue,
): boolean {
  setBodyObb(store, i, store.obb);
  const b = store.bessie;
  if (!obbVsObb(store.obb, b, store.contact)) return false;
  const c = store.contact;
  store.f[F_NX] = c.normalX;
  store.f[F_NY] = c.normalY;
  store.f[F_DEPTH] = c.depthM;
  boxContactPoint(store, store.obb, b);
  const d = c.depthM + SLOP_M;
  store.pushX[i] = (store.pushX[i] as number) + c.normalX * d;
  store.pushY[i] = (store.pushY[i] as number) + c.normalY * d;
  // Bessie's velocity at the contact point: v + ω × r.
  const yaw = store.f[F_BESSIE_YAW] as number;
  store.f[F_OTHER_VX] = (store.f[F_BESSIE_VX] as number) - yaw * ((store.f[F_PY] as number) - b.cy);
  store.f[F_OTHER_VY] = (store.f[F_BESSIE_VY] as number) + yaw * ((store.f[F_PX] as number) - b.cx);
  store.f[F_RESTITUTION] = store.params[P_BESSIE_RESTITUTION] as number;
  applyImpulse(store, i, -1);

  store.rearmTicks[i] = store.rearmTicksMax;
  const flags = store.flags[i] as number;
  if ((flags & BodyFlag.Contact) !== 0) return true;
  // A new episode.
  store.flags[i] = flags | BodyFlag.Contact | BodyFlag.Knocked;
  const k = store.kind[i] as number;
  const e = emitEvent(events, EV.Knock, i);
  events.a[e] = store.f[F_PX] as number;
  events.b[e] = store.f[F_PY] as number;
  events.c[e] = k;
  store.knocks += 1;
  if ((flags & BodyFlag.Knocked) !== 0) return true;
  // The first: the knock itself.
  store.bodiesKnocked += 1;
  const pts = store.kinds.pts[k] as number;
  if (pts < 0) {
    const f = pushPenalty(penalties, Offence.Knock, pts, 0);
    penalties.x[f] = store.x[i] as number;
    penalties.y[f] = store.y[i] as number;
    store.penaltyPts += pts;
  }
  if ((store.kinds.spills[k] as number) > 0) spillBodyLitter(store, i, litter, grid);
  return true;
}

/** Clamp body i's speed and spin to the safety caps. */
function clampBody(store: BodyStore, i: number): void {
  const vx = store.vx[i] as number;
  const vy = store.vy[i] as number;
  const s2 = vx * vx + vy * vy;
  if (s2 > BODY_MAX_SPEED_MPS * BODY_MAX_SPEED_MPS) {
    const f = BODY_MAX_SPEED_MPS / sqrt(s2);
    store.vx[i] = vx * f;
    store.vy[i] = vy * f;
  }
  const w = store.omega[i] as number;
  if (w > BODY_MAX_SPIN_RAD_PER_S) store.omega[i] = BODY_MAX_SPIN_RAD_PER_S;
  else if (w < -BODY_MAX_SPIN_RAD_PER_S) store.omega[i] = -BODY_MAX_SPIN_RAD_PER_S;
}

/**
 * Step 3b: sweep body i's move (push + v·dt, omega·dt) against the static grid in sub-steps (see the header),
 * then write the end pose. Allocation-free.
 */
function moveBody(store: BodyStore, i: number, grid: StaticGrid): void {
  const k = store.kind[i] as number;
  const pushX = store.pushX[i] as number;
  const pushY = store.pushY[i] as number;
  const vx0 = store.vx[i] as number;
  const vy0 = store.vy[i] as number;
  const w0 = store.omega[i] as number;
  const dx = vx0 * DT_S + pushX;
  const dy = vy0 * DT_S + pushY;
  const dRot = w0 * DT_S;
  const reach = sqrt(dx * dx + dy * dy) + (dRot < 0 ? -dRot : dRot) * (store.kinds.halfDiagM[k] as number);
  store.pushX[i] = 0;
  store.pushY[i] = 0;
  if (!(reach > 0)) return;
  let steps = Math.ceil(reach / (store.kinds.stepM[k] as number));
  if (steps < 1) steps = 1;
  const inv = 1 / steps;
  const obb = store.obb;
  setBodyObb(store, i, obb);
  store.f[F_RESTITUTION] = store.params[P_STATIC_RESTITUTION] as number;
  store.f[F_OTHER_VX] = 0;
  store.f[F_OTHER_VY] = 0;
  for (let step = 0; step < steps; step += 1) {
    const sx = obb.cx;
    const sy = obb.cy;
    const sh = obb.headingRad;
    // The velocity part follows this step's velocity (a bounce turns the rest of the move); the push is fixed.
    obb.cx = sx + ((store.vx[i] as number) * DT_S + pushX) * inv;
    obb.cy = sy + ((store.vy[i] as number) * DT_S + pushY) * inv;
    obb.headingRad = sh + (store.omega[i] as number) * DT_S * inv;
    refreshObbAxes(obb);
    let iter = 0;
    for (; iter < BODY_RESOLVE_ITERATIONS; iter += 1) {
      if (!findDeepestStatic(store, grid)) break;
      staticContactPoint(store, grid, store.bestShape);
      obb.cx += (store.f[F_NX] as number) * ((store.f[F_DEPTH] as number) + SLOP_M);
      obb.cy += (store.f[F_NY] as number) * ((store.f[F_DEPTH] as number) + SLOP_M);
      // The impulse reads the body's centre from the store: give it this step's.
      store.x[i] = obb.cx;
      store.y[i] = obb.cy;
      applyImpulse(store, i, -1);
    }
    if (iter === BODY_RESOLVE_ITERATIONS && findDeepestStatic(store, grid)) {
      // Wedged: undo this step and stop here (the start of the step was clear).
      obb.cx = sx;
      obb.cy = sy;
      obb.headingRad = sh;
      store.vx[i] = 0;
      store.vy[i] = 0;
      store.omega[i] = 0;
      break;
    }
  }
  let h = obb.headingRad;
  if (h > Math.PI) h -= 2 * Math.PI;
  else if (h <= -Math.PI) h += 2 * Math.PI;
  store.x[i] = obb.cx;
  store.y[i] = obb.cy;
  store.heading[i] = h;
  updateBodyBounds(store, i);
}

/** Step 3c: ground friction on body i's slide and spin, each to exactly 0. */
function frictionBody(store: BodyStore, i: number): void {
  const vx = store.vx[i] as number;
  const vy = store.vy[i] as number;
  if (vx !== 0 || vy !== 0) {
    const s = sqrt(vx * vx + vy * vy);
    const dec = (store.kinds.frictionMps2[store.kind[i] as number] as number) * DT_S;
    if (s <= dec) {
      store.vx[i] = 0;
      store.vy[i] = 0;
    } else {
      const f = (s - dec) / s;
      store.vx[i] = vx * f;
      store.vy[i] = vy * f;
    }
  }
  const w = store.omega[i] as number;
  if (w !== 0) {
    const dec = (store.params[P_SPIN_FRICTION] as number) * DT_S;
    if (w > dec) store.omega[i] = w - dec;
    else if (w < -dec) store.omega[i] = w + dec;
    else store.omega[i] = 0;
  }
}

/** Bessie's OBB, AABB, velocity and yaw rate for this tick, from her pose after phase 3. */
function setBessie(store: BodyStore, vehicle: Readonly<VehicleState>, sweeper: SweeperTuning): void {
  const b = store.bessie;
  b.cx = vehicle.xM;
  b.cy = vehicle.yM;
  b.headingRad = vehicle.headingRad;
  b.halfWidthM = sweeper.body.widthM * 0.5;
  b.halfLengthM = sweeper.body.lengthM * 0.5;
  refreshObbAxes(b);
  const ba = obbAabb(b, store.bessieAabb);
  const box = store.bessieBox;
  box[0] = ba.minX;
  box[1] = ba.minY;
  box[2] = ba.maxX;
  box[3] = ba.maxY;
  // World velocity = forward·vLong + right·vLat (§4).
  store.f[F_BESSIE_VX] = b.forwardX * vehicle.vLongMps + b.rightX * vehicle.vLatMps;
  store.f[F_BESSIE_VY] = b.forwardY * vehicle.vLongMps + b.rightY * vehicle.vLatMps;
  store.f[F_BESSIE_YAW] = vehicle.yawRateRadPerS;
}

/**
 * Phase 4 (see the header): body vs body, then per body Bessie, the swept move against `grid` and friction.
 * Spills go into `litter`, penalty facts into `penalties`, EV.Knock into `events`. Reads Bessie; never writes
 * her. Allocation-free (spills aside, see the header).
 */
export function stepBodies(
  store: BodyStore,
  grid: StaticGrid,
  vehicle: Readonly<VehicleState>,
  sweeper: SweeperTuning,
  litter: LitterField,
  penalties: PenaltyLog,
  events: EventQueue,
): void {
  const n = store.count;
  if (n === 0) return;
  for (let i = 0; i < n; i += 1) {
    store.prevX[i] = store.x[i] as number;
    store.prevY[i] = store.y[i] as number;
    store.prevHeading[i] = store.heading[i] as number;
    store.pushX[i] = 0;
    store.pushY[i] = 0;
  }
  resolvePairs(store);
  setBessie(store, vehicle, sweeper);
  for (let i = 0; i < n; i += 1) {
    if (!(nearBessie(store, i) && contactBessie(store, i, grid, litter, penalties, events))) {
      const r = store.rearmTicks[i] as number;
      if (r > 0) {
        store.rearmTicks[i] = r - 1;
        if (r === 1) store.flags[i] = (store.flags[i] as number) & ~BodyFlag.Contact;
      }
    }
    if (!isAwake(store, i)) continue;
    clampBody(store, i);
    moveBody(store, i, grid);
    frictionBody(store, i);
  }
}
