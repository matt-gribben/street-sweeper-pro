// The vehicle store (TECHNICAL_DESIGN §7.1, §11.4; SSP-089): a fixed-capacity struct-of-arrays of every traffic
// vehicle, moving and parked, allocated once at shift start with capacity VEHICLE_CAPACITY (30, §17; LEVEL_DESIGN
// §9.5's budget: moving + parked ≤ 30). Live vehicles occupy indices 0..count−1; removal is swap-remove with the
// last live vehicle. Bessie is not in it (world.vehicle is hers). traffic.ts moves the moving ones (phase 8);
// parked.ts (SSP-090) adds the parked ones at shift start, before any moving vehicle (VEHICLE_FLAG.PARKED,
// counted in `parkedCount`). Parked cars are never removed, and a removal only ever moves the last live vehicle
// (a moving one), so the parked cars keep indices 0..parkedCount−1 all shift: the static grid (collision/grid.ts)
// names them by index.
//
// Parked-car columns (SSP-090): `paint` (the seeded paint swap slot of a hatchback or saloon, 0 otherwise),
// the dent contact episode (`touchClear`, `dented`, `dents`) and the cat perched on the roof (`roofPerch`).
//
// Identity. An index is only good until the next removal; `uid` is a spawn serial (the store's `vehiclesAdded`
// when the vehicle was added), unique for the shift, for the few links that must survive one (a junction box's
// holder, traffic.ts).
//
// Pose. (x, y) is the body centre in metres, `heading` radians (0 = north, clockwise, forward = (sin h, −cos h)),
// and the body is the OBB of entities.json `body` (widthM × lengthM, centred). `corners` caches the OBB's four
// corners per vehicle (obbCorners order: front-right, back-right, back-left, front-left); updateVehicleCorners
// refreshes them after a move.
//
// Spatial lookup. The level (plus a margin of VEHICLE_GRID_MARGIN_CELLS cells round it, for vehicles entering and
// leaving over the map edge) is covered by VEHICLE_CELL_M cells; rebuildVehicleGrid buckets every vehicle by its
// centre, and queryVehicles lists the vehicles whose AABB may overlap a box (the cells it overlaps, grown by the
// largest vehicle's half diagonal), in a deterministic order (cells row-major, then ascending index). traffic.ts
// rebuilds it at the end of phase 8, so collision (SSP-090) and render culling (SSP-103) read this tick's
// buckets.
//
// Hot path: everything except createVehicleStore allocates nothing and takes no doubles as arguments
// (TECHNICAL_DESIGN §17, trap 1): positions come in through typed arrays and an index.
import type { Aabb } from './collision/obb.ts';
import { TILE_M } from './constants.ts';
import { type Entities, VEHICLE_IDS } from './entities.ts';
import { cos, sin, sqrt } from './fmath.ts';
import type { Level } from './map.ts';

/** Vehicle store capacity (TECHNICAL_DESIGN §7.1, §17): moving and parked together. */
export const VEHICLE_CAPACITY = 30;
/** Lane edges of plan each vehicle holds at once: its current edge, then the ones it will drive next. */
export const VEHICLE_PLAN_EDGES = 32;
/** Edge of one spatial-lookup cell, metres. */
export const VEHICLE_CELL_M = 8;
/** Cells of margin round the map in the spatial lookup (vehicles drive in and out over the map edge). */
export const VEHICLE_GRID_MARGIN_CELLS = 2;
/** Doubles per vehicle in `corners`. */
export const VEHICLE_CORNER_DOUBLES = 8;
/** Paint swap slots of a hatchback or saloon (ART_BIBLE §8.2, ENTITY_CATALOG §8.1: 8 paint swaps). */
export const PAINT_SLOTS = 8;
/** The kinds whose paint varies by swap slot (ART_BIBLE §8.2): the hatchback and saloon, moving or parked. */
export const PAINTED_KINDS: readonly string[] = [
  'veh.hatchback',
  'veh.saloon',
  'veh.hatchback_parked',
  'veh.saloon_parked',
];
/** `roofPerch` of a parked car with no cat on its roof (the NPC store's NO_NPC_HANDLE). */
export const ROOF_PERCH_FREE = -1;
/** `touchClear` of a vehicle Bessie has never touched (saturates here). */
export const TOUCH_CLEAR_MAX = 0x7fffffff;

/** Per-vehicle flag bits (`flags`, Uint8). Hashed into replays: append, never renumber. */
export const VEHICLE_FLAG = {
  /** A parked car (SSP-090): static, never moved by traffic. */
  PARKED: 1,
  /** A scheduled bus following the level's bus route (traffic.ts). */
  BUS_ROUTE: 2,
  /** Past its exit portal: driving out of the map until it is off the view rect, then despawned. */
  EXITING: 4,
} as const;

/** What is holding a vehicle back (`blocker`, Uint8). Hashed: append, never renumber. */
export const Blocker = {
  /** Nothing ahead: it runs at the speed limit (or is accelerating to it). */
  None: 0,
  /** Bessie, projected onto its path. */
  Bessie: 1,
  /** Another vehicle (`blockerIndex`). */
  Vehicle: 2,
  /** An occupied zebra's (or school crossing's) stop line. */
  Crossing: 3,
  /** A junction box another vehicle holds. */
  Junction: 4,
  /** A bus's own stop at a bus stop. */
  BusStop: 5,
  /** The end of a lane with no way on (a lane graph with a dead end and no turn-around). */
  LaneEnd: 6,
} as const;
export type Blocker = (typeof Blocker)[keyof typeof Blocker];

/** All live vehicles. Create with createVehicleStore. */
export type VehicleStore = {
  readonly capacity: number;
  /** Live vehicles, at indices 0..count−1. */
  count: number;
  /** Vehicles added and removed this shift. */
  vehiclesAdded: number;
  vehiclesRemoved: number;
  /** Live vehicles with VEHICLE_FLAG.PARKED (SSP-090): the moving budget is capacity − parkedCount. */
  parkedCount: number;
  /** Spawn serial: vehiclesAdded when it was added. */
  readonly uid: Int32Array;
  /** VEHICLE_IDS index (entities.json vehicle table). */
  readonly kind: Uint8Array;
  /** TrafficState (traffic.ts). */
  readonly state: Uint8Array;
  /** Ticks in the current state, counting the current tick. */
  readonly stateTicks: Uint32Array;
  /** VEHICLE_FLAG bits. */
  readonly flags: Uint8Array;
  /** Body centre, metres, and heading, radians. */
  readonly x: Float64Array;
  readonly y: Float64Array;
  readonly heading: Float64Array;
  /** Pose at the start of this tick's phase 8, for render interpolation. */
  readonly prevX: Float64Array;
  readonly prevY: Float64Array;
  readonly prevHeading: Float64Array;
  /** Speed along its path, m/s (never negative: traffic does not reverse). */
  readonly speed: Float64Array;
  /** Half the body width and length, metres (entities.json `body`). */
  readonly halfWidth: Float64Array;
  readonly halfLength: Float64Array;
  /** The OBB corners, VEHICLE_CORNER_DOUBLES per vehicle. Derived from the pose (not hashed). */
  readonly corners: Float64Array;
  /** Lane edges ahead, VEHICLE_PLAN_EDGES per vehicle: plan[i·P] is the edge it is on. */
  readonly plan: Int32Array;
  readonly planLen: Uint8Array;
  /** How far the body centre is along plan[0] from its `from` node, metres (below 0 entering, past it exiting). */
  readonly along: Float64Array;
  /** A route-following bus: the index into the bus route of the next edge to plan; −1 for everyone else. */
  readonly routeAt: Int32Array;
  /** What held it back this tick (Blocker) and, for Blocker.Vehicle, that vehicle's index (−1 otherwise). */
  readonly blocker: Uint8Array;
  readonly blockerIndex: Int32Array;
  /** The free distance to that blocker, metres (−1 with no blocker). */
  readonly gapM: Float64Array;
  /** Ticks of the current block by Bessie (0: not blocked by her). */
  readonly blockTicks: Int32Array;
  /** Ticks since a block by Bessie last held it (the block ends after streetLife.traffic.clearAfterS). */
  readonly clearTicks: Int32Array;
  /** Car honks of the current block (1..3). */
  readonly honks: Uint8Array;
  /** 1 once the current block has filed its Road Rage complaint. */
  readonly rageFiled: Uint8Array;
  /** A bus dwelling at a stop: ticks left. */
  readonly dwellLeft: Int32Array;
  /** The lane node of the last bus stop it served (−1: none), so it does not stop there twice. */
  readonly servedStop: Int32Array;
  /** Junction boxes it holds (traffic.ts), −1 for none. */
  readonly box0: Int16Array;
  readonly box1: Int16Array;
  /** The paint swap slot, 0..PAINT_SLOTS−1 (seeded for a parked hatchback or saloon; 0 otherwise). */
  readonly paint: Uint8Array;
  /**
   * Ticks since Bessie's body last touched it (phase 3 pushed her out of it), saturating at TOUCH_CLEAR_MAX;
   * a parked car's dent contact episode ends once this reaches streetLife.traffic.dentRearmS (parked.ts).
   */
  readonly touchClear: Int32Array;
  /** 1 once the current contact episode has dented this parked car (parked.ts): it dents once per episode. */
  readonly dented: Uint8Array;
  /** Dents this shift (parked cars). */
  readonly dents: Int32Array;
  /** The NPC handle of the cat perched on a parked car's roof, or ROOF_PERCH_FREE (parked.ts). */
  readonly roofPerch: Int32Array;
  /** Half width and half length by VEHICLE_IDS index. */
  readonly kindHalfWidth: Float64Array;
  readonly kindHalfLength: Float64Array;
  /** By VEHICLE_IDS index: 1 for a kind with paint swaps (PAINTED_KINDS). */
  readonly kindPainted: Uint8Array;
  /**
   * By VEHICLE_IDS index, a parked kind's dent rules (entities.json rules.dentPts, rules.dentHp; ENTITY_CATALOG
   * §8.2): the points (≤ 0) and the flat HP a dent costs. 0 for every other kind.
   */
  readonly kindDentPts: Int32Array;
  readonly kindDentHp: Float64Array;
  /** The largest half diagonal of any kind, metres (the query margin). */
  readonly maxHalfDiagonalM: number;
  /** Spatial lookup: grid size in cells, its origin (metres) and the bucket lists. */
  readonly gridW: number;
  readonly gridH: number;
  readonly gridOriginX: number;
  readonly gridOriginY: number;
  readonly cellHead: Int32Array;
  readonly cellNext: Int32Array;
};

/** What render, audio and UI may see: the same object, typed read-only. */
export type VehicleStoreView = {
  readonly capacity: number;
  readonly count: number;
  readonly vehiclesAdded: number;
  readonly vehiclesRemoved: number;
  readonly parkedCount: number;
  readonly uid: Int32Array;
  readonly kind: Uint8Array;
  readonly state: Uint8Array;
  readonly stateTicks: Uint32Array;
  readonly flags: Uint8Array;
  readonly x: Float64Array;
  readonly y: Float64Array;
  readonly heading: Float64Array;
  readonly prevX: Float64Array;
  readonly prevY: Float64Array;
  readonly prevHeading: Float64Array;
  readonly speed: Float64Array;
  readonly halfWidth: Float64Array;
  readonly halfLength: Float64Array;
  readonly corners: Float64Array;
  readonly blocker: Uint8Array;
  readonly blockTicks: Int32Array;
  readonly dwellLeft: Int32Array;
  readonly paint: Uint8Array;
  readonly dented: Uint8Array;
  readonly dents: Int32Array;
  readonly roofPerch: Int32Array;
};

/** An empty store for `level` with room for `capacity` vehicles; body sizes from `entities`. Setup only. */
export function createVehicleStore(
  level: Level,
  entities: Entities,
  capacity: number = VEHICLE_CAPACITY,
): VehicleStore {
  if (!(Number.isInteger(capacity) && capacity >= 1 && capacity <= 255)) {
    throw new Error(`createVehicleStore: capacity must be an integer 1..255, got ${capacity}`);
  }
  const kindHalfWidth = Float64Array.from(VEHICLE_IDS, (id) => entities.vehicles[id].body.widthM / 2);
  const kindHalfLength = Float64Array.from(VEHICLE_IDS, (id) => entities.vehicles[id].body.lengthM / 2);
  const kindPainted = Uint8Array.from(VEHICLE_IDS, (id) => (PAINTED_KINDS.includes(id) ? 1 : 0));
  const dentRule = (id: string, key: 'dentPts' | 'dentHp'): number => {
    const rules: Readonly<Record<string, number>> =
      entities.vehicles[id as (typeof VEHICLE_IDS)[number]].rules;
    return Object.hasOwn(rules, key) ? (rules[key] as number) : 0;
  };
  const kindDentPts = Int32Array.from(VEHICLE_IDS, (id) => dentRule(id, 'dentPts'));
  const kindDentHp = Float64Array.from(VEHICLE_IDS, (id) => dentRule(id, 'dentHp'));
  let maxHalfDiagonalM = 0;
  for (let k = 0; k < VEHICLE_IDS.length; k += 1) {
    const w = kindHalfWidth[k] as number;
    const l = kindHalfLength[k] as number;
    maxHalfDiagonalM = Math.max(maxHalfDiagonalM, sqrt(w * w + l * l));
  }
  const margin = VEHICLE_GRID_MARGIN_CELLS;
  const gridW = Math.ceil((level.size[0] * TILE_M) / VEHICLE_CELL_M) + 2 * margin;
  const gridH = Math.ceil((level.size[1] * TILE_M) / VEHICLE_CELL_M) + 2 * margin;
  const f64 = (): Float64Array => new Float64Array(capacity);
  const store: VehicleStore = {
    capacity,
    count: 0,
    vehiclesAdded: 0,
    vehiclesRemoved: 0,
    parkedCount: 0,
    uid: new Int32Array(capacity),
    kind: new Uint8Array(capacity),
    state: new Uint8Array(capacity),
    stateTicks: new Uint32Array(capacity),
    flags: new Uint8Array(capacity),
    x: f64(),
    y: f64(),
    heading: f64(),
    prevX: f64(),
    prevY: f64(),
    prevHeading: f64(),
    speed: f64(),
    halfWidth: f64(),
    halfLength: f64(),
    corners: new Float64Array(capacity * VEHICLE_CORNER_DOUBLES),
    plan: new Int32Array(capacity * VEHICLE_PLAN_EDGES),
    planLen: new Uint8Array(capacity),
    along: f64(),
    routeAt: new Int32Array(capacity),
    blocker: new Uint8Array(capacity),
    blockerIndex: new Int32Array(capacity),
    gapM: f64(),
    blockTicks: new Int32Array(capacity),
    clearTicks: new Int32Array(capacity),
    honks: new Uint8Array(capacity),
    rageFiled: new Uint8Array(capacity),
    dwellLeft: new Int32Array(capacity),
    servedStop: new Int32Array(capacity),
    box0: new Int16Array(capacity),
    box1: new Int16Array(capacity),
    paint: new Uint8Array(capacity),
    touchClear: new Int32Array(capacity).fill(TOUCH_CLEAR_MAX),
    dented: new Uint8Array(capacity),
    dents: new Int32Array(capacity),
    roofPerch: new Int32Array(capacity).fill(ROOF_PERCH_FREE),
    kindHalfWidth,
    kindHalfLength,
    kindPainted,
    kindDentPts,
    kindDentHp,
    maxHalfDiagonalM,
    gridW,
    gridH,
    gridOriginX: -margin * VEHICLE_CELL_M,
    gridOriginY: -margin * VEHICLE_CELL_M,
    cellHead: new Int32Array(gridW * gridH).fill(-1),
    cellNext: new Int32Array(capacity).fill(-1),
  };
  return store;
}

/** The read-only view of `store`. No copy: it is the same object. */
export function viewVehicleStore(store: VehicleStore): VehicleStoreView {
  return store;
}

/**
 * Add a vehicle of `kind` (a VEHICLE_IDS index) with `flags` at index `count` and return it; the caller sets its
 * pose and plan (and calls updateVehicleCorners). Throws when the store is full. Allocation-free.
 */
export function addVehicle(store: VehicleStore, kind: number, flags: number): number {
  const i = store.count;
  if (i >= store.capacity) {
    throw new Error(
      `addVehicle: the vehicle store is full (${store.capacity}); traffic.ts checks the budget`,
    );
  }
  store.count = i + 1;
  store.uid[i] = store.vehiclesAdded;
  store.vehiclesAdded += 1;
  store.kind[i] = kind;
  store.state[i] = 0;
  store.stateTicks[i] = 0;
  store.flags[i] = flags;
  if ((flags & VEHICLE_FLAG.PARKED) !== 0) store.parkedCount += 1;
  store.x[i] = 0;
  store.y[i] = 0;
  store.heading[i] = 0;
  store.prevX[i] = 0;
  store.prevY[i] = 0;
  store.prevHeading[i] = 0;
  store.speed[i] = 0;
  store.halfWidth[i] = store.kindHalfWidth[kind] as number;
  store.halfLength[i] = store.kindHalfLength[kind] as number;
  store.planLen[i] = 0;
  store.along[i] = 0;
  store.routeAt[i] = -1;
  store.blocker[i] = Blocker.None;
  store.blockerIndex[i] = -1;
  store.gapM[i] = -1;
  store.blockTicks[i] = 0;
  store.clearTicks[i] = 0;
  store.honks[i] = 0;
  store.rageFiled[i] = 0;
  store.dwellLeft[i] = 0;
  store.servedStop[i] = -1;
  store.box0[i] = -1;
  store.box1[i] = -1;
  store.paint[i] = 0;
  store.touchClear[i] = TOUCH_CLEAR_MAX;
  store.dented[i] = 0;
  store.dents[i] = 0;
  store.roofPerch[i] = ROOF_PERCH_FREE;
  store.cellNext[i] = -1;
  return i;
}

/** Copy every column of vehicle `from` into slot `to`. */
function moveSlot(store: VehicleStore, from: number, to: number): void {
  store.uid[to] = store.uid[from] as number;
  store.kind[to] = store.kind[from] as number;
  store.state[to] = store.state[from] as number;
  store.stateTicks[to] = store.stateTicks[from] as number;
  store.flags[to] = store.flags[from] as number;
  store.x[to] = store.x[from] as number;
  store.y[to] = store.y[from] as number;
  store.heading[to] = store.heading[from] as number;
  store.prevX[to] = store.prevX[from] as number;
  store.prevY[to] = store.prevY[from] as number;
  store.prevHeading[to] = store.prevHeading[from] as number;
  store.speed[to] = store.speed[from] as number;
  store.halfWidth[to] = store.halfWidth[from] as number;
  store.halfLength[to] = store.halfLength[from] as number;
  store.corners.copyWithin(
    to * VEHICLE_CORNER_DOUBLES,
    from * VEHICLE_CORNER_DOUBLES,
    (from + 1) * VEHICLE_CORNER_DOUBLES,
  );
  store.plan.copyWithin(to * VEHICLE_PLAN_EDGES, from * VEHICLE_PLAN_EDGES, (from + 1) * VEHICLE_PLAN_EDGES);
  store.planLen[to] = store.planLen[from] as number;
  store.along[to] = store.along[from] as number;
  store.routeAt[to] = store.routeAt[from] as number;
  store.blocker[to] = store.blocker[from] as number;
  store.blockerIndex[to] = store.blockerIndex[from] as number;
  store.gapM[to] = store.gapM[from] as number;
  store.blockTicks[to] = store.blockTicks[from] as number;
  store.clearTicks[to] = store.clearTicks[from] as number;
  store.honks[to] = store.honks[from] as number;
  store.rageFiled[to] = store.rageFiled[from] as number;
  store.dwellLeft[to] = store.dwellLeft[from] as number;
  store.servedStop[to] = store.servedStop[from] as number;
  store.box0[to] = store.box0[from] as number;
  store.box1[to] = store.box1[from] as number;
  store.paint[to] = store.paint[from] as number;
  store.touchClear[to] = store.touchClear[from] as number;
  store.dented[to] = store.dented[from] as number;
  store.dents[to] = store.dents[from] as number;
  store.roofPerch[to] = store.roofPerch[from] as number;
}

/**
 * Swap-remove vehicle `i`: the last live vehicle moves into its slot. The caller releases anything it held
 * first (traffic.ts frees its junction boxes). blockerIndex values naming a moved vehicle go stale until the next
 * tick recomputes them. Allocation-free.
 */
export function removeVehicle(store: VehicleStore, i: number): void {
  const last = store.count - 1;
  if (i < 0 || i > last)
    throw new Error(`removeVehicle: index ${i} is not a live vehicle (count ${store.count})`);
  if (((store.flags[i] as number) & VEHICLE_FLAG.PARKED) !== 0) store.parkedCount -= 1;
  if (i !== last) moveSlot(store, last, i);
  store.count = last;
  store.vehiclesRemoved += 1;
}

/** Refresh vehicle i's OBB corners from its pose (x, y, heading, half extents). Allocation-free. */
export function updateVehicleCorners(store: VehicleStore, i: number): void {
  const h = store.heading[i] as number;
  const s = sin(h);
  const c = cos(h);
  const hw = store.halfWidth[i] as number;
  const hl = store.halfLength[i] as number;
  const cx = store.x[i] as number;
  const cy = store.y[i] as number;
  // right = (cos h, sin h), forward = (sin h, −cos h); obbCorners order.
  const rx = c * hw;
  const ry = s * hw;
  const fx = s * hl;
  const fy = -c * hl;
  const o = i * VEHICLE_CORNER_DOUBLES;
  const k = store.corners;
  k[o] = cx + rx + fx;
  k[o + 1] = cy + ry + fy;
  k[o + 2] = cx + rx - fx;
  k[o + 3] = cy + ry - fy;
  k[o + 4] = cx - rx - fx;
  k[o + 5] = cy - ry - fy;
  k[o + 6] = cx - rx + fx;
  k[o + 7] = cy - ry + fy;
}

/** The lookup cell of vehicle i's centre (clamped to the grid). */
function cellOf(store: VehicleStore, i: number): number {
  let cx = Math.floor(((store.x[i] as number) - store.gridOriginX) / VEHICLE_CELL_M);
  let cy = Math.floor(((store.y[i] as number) - store.gridOriginY) / VEHICLE_CELL_M);
  if (cx < 0) cx = 0;
  else if (cx >= store.gridW) cx = store.gridW - 1;
  if (cy < 0) cy = 0;
  else if (cy >= store.gridH) cy = store.gridH - 1;
  return cy * store.gridW + cx;
}

/** Re-bucket every live vehicle by its centre. Each cell's list ascends by index. Allocation-free. */
export function rebuildVehicleGrid(store: VehicleStore): void {
  store.cellHead.fill(-1);
  for (let i = store.count - 1; i >= 0; i -= 1) {
    const c = cellOf(store, i);
    store.cellNext[i] = store.cellHead[c] as number;
    store.cellHead[c] = i;
  }
}

/**
 * Write into `out` the indices of the vehicles whose centre lies in a cell that the box, grown by the largest
 * half diagonal, overlaps (every vehicle whose OBB can touch the box, and a few more), cells row-major then
 * ascending index; returns how many (at most out.length). Reads the buckets of the last rebuildVehicleGrid.
 * Allocation-free.
 */
export function queryVehicles(store: VehicleStore, box: Readonly<Aabb>, out: Int32Array): number {
  const m = store.maxHalfDiagonalM;
  let c0 = Math.floor((box.minX - m - store.gridOriginX) / VEHICLE_CELL_M);
  let c1 = Math.floor((box.maxX + m - store.gridOriginX) / VEHICLE_CELL_M);
  let r0 = Math.floor((box.minY - m - store.gridOriginY) / VEHICLE_CELL_M);
  let r1 = Math.floor((box.maxY + m - store.gridOriginY) / VEHICLE_CELL_M);
  if (c0 < 0) c0 = 0;
  if (r0 < 0) r0 = 0;
  if (c1 >= store.gridW) c1 = store.gridW - 1;
  if (r1 >= store.gridH) r1 = store.gridH - 1;
  let n = 0;
  for (let r = r0; r <= r1; r += 1) {
    for (let c = c0; c <= c1; c += 1) {
      for (let i = store.cellHead[r * store.gridW + c] as number; i >= 0; i = store.cellNext[i] as number) {
        if (n >= out.length) return n;
        out[n] = i;
        n += 1;
      }
    }
  }
  return n;
}
