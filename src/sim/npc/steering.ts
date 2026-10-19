// The NPC steering core (TECHNICAL_DESIGN §11.1, SSP-081): what every pedestrian and animal shares. Behaviours
// (npc/behaviours/*.ts) compose it in their tick; nothing here decides *what* an NPC wants, only how it gets
// there. Units are metres, seconds and radians; heading 0 = north, forward = (sin h, −cos h), clockwise.
//
// Per tick, a behaviour that walks an NPC does (walkNpc is the usual composite):
//   1. beginSteer: clear the desired velocity (the `des` scratch).
//   2. Add desires: steerFollowPath (seek/arrive along its nav path, with the zebra rule), steerSeek, steerArrive,
//      steerFlee (a point in typed arrays), steerAvoidProps (the props ahead), steerSeparate (the other NPCs,
//      through the store's spatial hash), steerSidestep (Bessie's predicted path, 1.5 s ahead).
//   3. moveNpc: turn and accelerate towards the desired velocity (tuning.json → streetLife.npcSteering limits),
//      then move under the constraints below and re-bucket the NPC in the spatial hash.
//
// Constraints (moveNpc). A candidate position is resolved, in order, against the other NPCs (no two circles
// overlap after a move: the mover steps out), the props' collision footprints (tuning.json → propFootprints;
// the same shapes Bessie hits) and the blocked tiles (solid with no nav node: buildings, walls, water; the map
// edge counts too), and is then accepted only if
//   - its centre is on a tile it may stand on: any unblocked tile for a jaywalker (Behaviour.jaywalks); for
//     everyone else a nav-graph tile (pavement, cobbles, alley) or, while it is on a crossing edge
//     (crossEdge), a tile of that crossing's straight corridor. So a non-jaywalker's centre is on a road tile
//     only while it traverses a crossing edge;
//   - it overlaps no prop by more than PROP_SLOP_M.
// A candidate that fails falls back, in order, to a step along the prop's surface (when a prop stopped it
// head-on), the step's x part, its y part, and staying put. Either rule is waived while the NPC's current
// position already breaks it (a pigeon landed on the road, an NPC spawned on a lamp post), so it can walk out.
//
// Paths. findNavPath is A* over the compiled pavement nav graph (map.ts NavGraph) with integer edge costs in
// millimetres and an admissible, consistent heuristic (⌊0.999 × straight-line mm⌋), so it returns a shortest
// path; ties pop the lower f, then the lower node index, and a node's parent is only replaced by a strictly
// cheaper one, so the node sequence is a pure function of the graph and the two nodes. A behaviour may forbid
// edges by NAV_FLAG (Behaviour.navAvoid, SSP-085: the old man crosses only at zebras), which every plan and
// re-plan of its NPCs then skips; the heuristic stays admissible, so the path is the shortest allowed one.
// Buffers (g, parent, visit stamps, a binary heap of 2·edges + 1 entries) are allocated once per shift. An NPC
// holds up to NPC_PATH_NODES nodes of its path at a time (store.ts `path`), its cursor `pathAt` and
// `targetNode` = path[pathAt]; reaching the segment's last node before the goal plans the next segment from
// there.
//
// Crossings (LEVEL_DESIGN §7.2, §7.5). A path edge with a NAV_FLAG_CROSSING flag (site.zebra,
// site.school_crossing, a dropped kerb) is the only way a non-jaywalker crosses a road: it walks to the kerb
// node, waits there (NavState.KerbWait) for at least kerbLookS and until the gap check says clear
// (Steering.crossingClear, a hook: until traffic exists it is crossingAlwaysClear; SSP-089 installs the
// approaching-vehicle query), then crosses (NavState.Crossing) to the far node. Jaywalkers take a crossing edge
// without stopping and may leave the graph anywhere. world.zebras counts, after phase 7's behaviours, the NPCs
// whose centre is on each zebra (updateZebraOccupancy): a zebra is OCCUPIED while its count is above 0, which
// traffic (SSP-089) and the running-an-occupied-zebra penalty (SSP-085) read. A cat riding Bessie's roof
// (NPC_FLAG.ON_ROOF, SSP-087) is off the ground: it counts on no zebra and separation and the constraints skip it.
//
// Hot path: everything except createZebras, createSteering and setSteeringTuning allocates nothing, and no
// double crosses a call: positions and vectors go through typed arrays (the `v` scratch and the store's
// columns), as in the rest of the sim (TECHNICAL_DESIGN §17, trap 1).
import { queryStatic, ShapeKind, ShapeSource, type StaticGrid } from '../collision/grid.ts';
import { type Aabb, createAabb, createObb, type Obb } from '../collision/obb.ts';
import {
  type Circle,
  type Contact,
  createCircle,
  createContact,
  obbVsCircleShape,
} from '../collision/sat.ts';
import { DEG_TO_RAD, DT_S, SIM_HZ, TILE_M } from '../constants.ts';
import type { Entities } from '../entities.ts';
import { atan2, cos, sin, sqrt } from '../fmath.ts';
import { COLLIDE, Ground, type Level, NAV_FLAG, NAV_FLAG_CROSSING, type NavGraph } from '../map.ts';
import type { Tuning } from '../tuning.ts';
import type { World } from '../world.ts';
import type { Behaviour } from './behaviour.ts';
import { largestNpcRadiusM } from './footprint.ts';
import { PERCEPTION_PATH_S } from './perception.ts';
import { NPC_FLAG, NPC_PATH_NODES, queryNpcs, updateNpcCell } from './store.ts';

/** Where an NPC is on its path (store `navState`). Hashed: append, never renumber. */
export const NavState = {
  /** No path requested. */
  Idle: 0,
  /** Following its path. */
  Walking: 1,
  /** At the kerb node of a crossing edge, looking (kerbLookS) and waiting for the gap check. */
  KerbWait: 2,
  /** On a crossing edge (store `crossEdge`), heading for its far node. */
  Crossing: 3,
  /** At its goal node, holding there. */
  Arrived: 4,
  /** The last path request (or re-plan) found no path. */
  NoPath: 5,
} as const;
export type NavState = (typeof NavState)[keyof typeof NavState];

/** Bits of Steering.tileFlags. */
export const STEER_TILE = {
  /** Road ground (two-way or one-way, road features included). */
  ROAD: 1,
  /** Solid in the collide layer with no nav node (a footway is SOLID for Bessie but walkable, so not blocked). */
  BLOCKED: 2,
} as const;

/** How deep an accepted position may overlap a prop footprint, metres. */
export const PROP_SLOP_M = 1e-4;
/** An NPC never gets closer to a nav node it must stand clear of than this, beyond touching the prop, metres. */
const PROP_ARRIVE_MARGIN_M = 0.05;
/** Weight of the separation desire at contact (it falls linearly to 0 at the separation range). */
const SEPARATION_WEIGHT = 1.5;
/** Weight of the keep-right bias when another NPC is ahead inside the separation range. */
const PASSING_WEIGHT = 0.5;
/** Weight of the sidestep desire (it overrides walking along a path). */
const SIDESTEP_WEIGHT = 2;
/** Prop avoidance looks this many seconds of walking ahead… */
const AVOID_LOOK_S = 1;
/** …but at least this far, metres. */
const AVOID_MIN_LOOK_M = 1;
/** The largest prop bounding radius the avoidance query reaches for, metres (a 2 m stall's half diagonal). */
const AVOID_MAX_PROP_M = 1.3;
/** How far to each side avoidance probes the tiles for a prop dead ahead, metres. */
const AVOID_PROBE_M = 0.75;
/** Weight of the prop-avoidance desire, dead ahead and close. */
const AVOID_WEIGHT = 1;
/** Bessie slower than this has no predicted path to sidestep, m/s. */
const SIDESTEP_MIN_SPEED_MPS = 0.05;
/** A move making less than this share of its step's progress tries the prop-surface step. */
const POOR_PROGRESS = 0.3;
/** Golden angle, radians: spreads the fallback push directions of NPCs standing exactly on top of each other. */
const GOLDEN_ANGLE_RAD = 2.399963229728653;
/** The A* heuristic's scale, per mille of the straight-line distance (keeps it below the rounded edge costs). */
const HEURISTIC_PER_MILLE = 999;

/**
 * The kerb gap check (TECHNICAL_DESIGN §11.1): may NPC `i`, waiting at the kerb node of crossing nav edge
 * `edge`, step out now? Called once per waiting tick after kerbLookS. Must not allocate.
 */
export type CrossingGapCheck = (w: World, i: number, edge: number) => boolean;

/** The default gap check until traffic exists (SSP-089 replaces it with the approaching-vehicle query). */
export const crossingAlwaysClear: CrossingGapCheck = () => true;

/** Per-zebra occupancy (world.zebras): every site.zebra of the level, in `level.sites` order. */
export type Zebras = {
  readonly count: number;
  /** The zebra's index in level.sites. */
  readonly siteIndex: Int32Array;
  /** Its rect in metres, max exclusive. */
  readonly minX: Float64Array;
  readonly minY: Float64Array;
  readonly maxX: Float64Array;
  readonly maxY: Float64Array;
  /** NPCs whose centre is on the zebra after this tick's phase 7: OCCUPIED while above 0. */
  readonly occupancy: Int32Array;
  /**
   * The occupied-zebra offence (zebraOffence.ts, SSP-085): 1 while Bessie's body OBB overlaps the zebra, from
   * the tick she entered it to the last tick before she has fully left it (one entry episode).
   */
  readonly bessieOn: Uint8Array;
  /** Occupied-zebra offences this shift. */
  offences: number;
  /** Scratch for the offence check: Bessie's OBB, a zebra rect, the SAT contact. */
  readonly obb: Obb;
  readonly rect: Aabb;
  readonly contact: Contact;
};

/** What render, traffic's readers outside the sim and tests may see: the same object, read-only. */
export type ZebrasView = {
  readonly count: number;
  readonly siteIndex: Int32Array;
  readonly minX: Float64Array;
  readonly minY: Float64Array;
  readonly maxX: Float64Array;
  readonly maxY: Float64Array;
  readonly occupancy: Int32Array;
  readonly bessieOn: Uint8Array;
  readonly offences: number;
};

/** The zebras of `level` with no occupancy and Bessie on none of them. Setup only. */
export function createZebras(level: Level): Zebras {
  const idx: number[] = [];
  level.sites.forEach((s, k) => {
    if (s.id === 'site.zebra') idx.push(k);
  });
  const rectM = (c: 0 | 1 | 2 | 3): Float64Array =>
    Float64Array.from(idx, (k) => (level.sites[k]?.rect[c] ?? 0) * TILE_M);
  return {
    count: idx.length,
    siteIndex: Int32Array.from(idx),
    minX: rectM(0),
    minY: rectM(1),
    maxX: rectM(2),
    maxY: rectM(3),
    occupancy: new Int32Array(idx.length),
    bessieOn: new Uint8Array(idx.length),
    offences: 0,
    obb: createObb(),
    rect: createAabb(),
    contact: createContact(),
  };
}

// Indices into Steering.v, the per-call scratch.
const DES_X = 0;
const DES_Y = 1;
const STEP_X = 2;
const STEP_Y = 3;
/** The candidate being resolved. */
const CX = 4;
const CY = 5;
/** The last prop contact normal (out of the prop) of a resolve, and 1 when there was one. */
const NX = 6;
const NY = 7;
const HIT = 8;
/** The accepted-so-far candidate. */
const AX = 9;
const AY = 10;
/** In and out of the out-of-line maths helpers (scratchLength, fallbackDirection). */
const LX = 11;
const LY = 12;
const LEN = 13;
const OUT_X = 14;
const OUT_Y = 15;
const SCRATCH_DOUBLES = 16;

// The out-of-line maths helpers. TurboFan does not inline a call site that runs on a small share of a
// function's calls (an overlap, a sidestep, a head-on prop), and a call that is not inlined boxes its double
// argument and result (TECHNICAL_DESIGN §17, trap 1; brush.ts pullLength is the same pattern). These take
// only the scratch array and integers, and inside them the fmath call always runs, so it is inlined there.

/** v[LEN] = |(v[LX], v[LY])|. */
function scratchLength(v: Float64Array): void {
  const x = v[LX] as number;
  const y = v[LY] as number;
  v[LEN] = sqrt(x * x + y * y);
}

/** (v[OUT_X], v[OUT_Y]) = the unit push direction of handle slot `slot` when two centres coincide. */
function fallbackDirection(v: Float64Array, slot: number): void {
  const a = slot * GOLDEN_ANGLE_RAD;
  v[OUT_X] = sin(a);
  v[OUT_Y] = -cos(a);
}

/** Steering's state for a shift: graph tables, the search buffers, per-call scratch. Create with createSteering. */
export type Steering = {
  readonly widthTiles: number;
  readonly heightTiles: number;
  /** The nav node on each tile (row-major), −1 for a tile without one. */
  readonly tileNode: Int32Array;
  /** STEER_TILE bits per tile. */
  readonly tileFlags: Uint8Array;
  /** Each nav edge's cost, integer millimetres (its length, rounded). */
  readonly edgeCostMm: Int32Array;
  /** The world.zebras index a ZEBRA edge crosses, −1 for every other edge. */
  readonly edgeZebra: Int16Array;
  /** Each crossing edge's corridor in tiles, inclusive (both end tiles and the road between); 0 for others. */
  readonly corridorX0: Int16Array;
  readonly corridorY0: Int16Array;
  readonly corridorX1: Int16Array;
  readonly corridorY1: Int16Array;
  /** How close a node counts as reached, metres: arriveRadiusM, or more where a prop stands on the node. */
  readonly nodeArriveM: Float64Array;
  /** The largest NPC radius (the neighbour query reach; footprint.ts, the mum's pushchair since SSP-085), metres. */
  maxRadiusM: number;
  /** The human radius the prop-adjusted arrive radii are computed for, and the plain arrive radius, metres. */
  humanRadiusM: number;
  arriveRadiusM: number;
  /** Each static shape's bounding radius about its centre, metres (props only; prop avoidance reads it). */
  readonly propBoundM: Float64Array;
  /** A* buffers. */
  readonly g: Int32Array;
  readonly parent: Int32Array;
  readonly seen: Uint32Array;
  readonly done: Uint32Array;
  searchStamp: number;
  readonly heapNode: Int32Array;
  readonly heapKey: Int32Array;
  heapSize: number;
  /** A found path, goal first (findNavPath reverses it into the caller's buffer). */
  readonly chain: Int32Array;
  /** Searches run this shift (tests and the dev panel). */
  searches: number;
  /** The kerb gap check; crossingAlwaysClear until traffic installs its query. */
  crossingClear: CrossingGapCheck;
  /** Per-call doubles (DES_X … AY). */
  readonly v: Float64Array;
  /** Neighbour query results (store capacity). */
  readonly neighbours: Int32Array;
  readonly box: Aabb;
  readonly circle: Circle;
  readonly contact: Contact;
};

const TWO_PI = 2 * Math.PI;

/**
 * Steering for a shift on `level`: the tile tables, the edge costs, zebras and corridors, the per-node arrive
 * radii (props from `grid`), and the search buffers. `capacity` is the NPC store's; `entities` gives the NPC
 * footprints (footprint.ts). Setup only.
 */
export function createSteering(
  level: Level,
  grid: StaticGrid,
  zebras: Zebras,
  tuning: Tuning,
  capacity: number,
  entities: Entities,
): Steering {
  const [w, h] = level.size;
  const nav = level.nav;
  const tiles = w * h;
  const tileNode = new Int32Array(tiles).fill(-1);
  for (let n = 0; n < nav.nodeCount; n += 1) {
    const tx = Math.floor((nav.nodeX[n] as number) / TILE_M);
    const ty = Math.floor((nav.nodeY[n] as number) / TILE_M);
    if (tx >= 0 && ty >= 0 && tx < w && ty < h) tileNode[ty * w + tx] = n;
  }
  const tileFlags = new Uint8Array(tiles);
  for (let t = 0; t < tiles; t += 1) {
    const ground = level.layers.ground[t] as number;
    let f = 0;
    if (ground >= Ground.Road && ground <= Ground.RoadOneWayS) f |= STEER_TILE.ROAD;
    if (((level.layers.collide[t] as number) & COLLIDE.SOLID) !== 0 && (tileNode[t] as number) < 0)
      f |= STEER_TILE.BLOCKED;
    tileFlags[t] = f;
  }
  const edges = nav.edgeCount;
  const edgeCostMm = new Int32Array(edges);
  const edgeZebra = new Int16Array(edges).fill(-1);
  const corridorX0 = new Int16Array(edges);
  const corridorY0 = new Int16Array(edges);
  const corridorX1 = new Int16Array(edges);
  const corridorY1 = new Int16Array(edges);
  for (let e = 0; e < edges; e += 1) {
    const a = nav.edgeFrom[e] as number;
    const b = nav.edgeTo[e] as number;
    const dx = (nav.nodeX[b] as number) - (nav.nodeX[a] as number);
    const dy = (nav.nodeY[b] as number) - (nav.nodeY[a] as number);
    edgeCostMm[e] = Math.max(1, Math.round(sqrt(dx * dx + dy * dy) * 1000));
    const flags = nav.edgeFlags[e] as number;
    if ((flags & NAV_FLAG_CROSSING) === 0) continue;
    const ax = Math.floor((nav.nodeX[a] as number) / TILE_M);
    const ay = Math.floor((nav.nodeY[a] as number) / TILE_M);
    const bx = Math.floor((nav.nodeX[b] as number) / TILE_M);
    const by = Math.floor((nav.nodeY[b] as number) / TILE_M);
    corridorX0[e] = Math.min(ax, bx);
    corridorY0[e] = Math.min(ay, by);
    corridorX1[e] = Math.max(ax, bx);
    corridorY1[e] = Math.max(ay, by);
    if ((flags & NAV_FLAG.ZEBRA) === 0) continue;
    // The first road tile past the `from` end lies on the zebra the edge crosses.
    const mx = (ax + Math.sign(bx - ax) + 0.5) * TILE_M;
    const my = (ay + Math.sign(by - ay) + 0.5) * TILE_M;
    for (let z = 0; z < zebras.count; z += 1) {
      if (
        mx >= (zebras.minX[z] as number) &&
        mx < (zebras.maxX[z] as number) &&
        my >= (zebras.minY[z] as number) &&
        my < (zebras.maxY[z] as number)
      ) {
        edgeZebra[e] = z;
        break;
      }
    }
  }
  const heap = 2 * edges + 1;
  const v = new Float64Array(SCRATCH_DOUBLES);
  const st: Steering = {
    widthTiles: w,
    heightTiles: h,
    tileNode,
    tileFlags,
    edgeCostMm,
    edgeZebra,
    corridorX0,
    corridorY0,
    corridorX1,
    corridorY1,
    nodeArriveM: new Float64Array(nav.nodeCount),
    maxRadiusM: 0.5,
    humanRadiusM: 0.5,
    arriveRadiusM: 0.5,
    propBoundM: Float64Array.from({ length: grid.shapeCount }, (_, s) => {
      if (grid.source[s] !== ShapeSource.Prop) return 0;
      if (grid.kind[s] === ShapeKind.Circle) return (grid.circles[s] as Circle).radiusM;
      const b = grid.boxes[s] as Obb;
      return sqrt(b.halfWidthM * b.halfWidthM + b.halfLengthM * b.halfLengthM);
    }),
    g: new Int32Array(nav.nodeCount),
    parent: new Int32Array(nav.nodeCount),
    seen: new Uint32Array(nav.nodeCount),
    done: new Uint32Array(nav.nodeCount),
    searchStamp: 0,
    heapNode: new Int32Array(heap),
    heapKey: new Int32Array(heap),
    heapSize: 0,
    chain: new Int32Array(Math.max(1, nav.nodeCount)),
    searches: 0,
    crossingClear: crossingAlwaysClear,
    v,
    neighbours: new Int32Array(capacity),
    box: createAabb(),
    circle: createCircle(),
    contact: createContact(),
  };
  setSteeringTuning(st, level, grid, tuning, entities);
  return st;
}

/**
 * Re-read the tuning (setWorldTuning): the neighbour reach from the NPC footprints (footprint.ts) and each
 * node's arrive radius, arriveRadiusM, or, where a prop's footprint keeps a human-sized circle off the node,
 * the distance from the node to the footprint's far side plus the radius and a margin, so standing against the
 * prop counts as reached (steerFollowPath widens that by the difference for a wider NPC). Setup only.
 */
export function setSteeringTuning(
  st: Steering,
  level: Level,
  grid: StaticGrid,
  tuning: Tuning,
  entities: Entities,
): void {
  const r = tuning.streetLife.npcRadius;
  st.maxRadiusM = largestNpcRadiusM(tuning, entities);
  st.humanRadiusM = r.humanM;
  const arrive = tuning.streetLife.npcSteering.arriveRadiusM;
  st.arriveRadiusM = arrive;
  const nav = level.nav;
  st.nodeArriveM.fill(arrive);
  const human = r.humanM;
  for (let s = 0; s < grid.shapeCount; s += 1) {
    if (grid.source[s] !== ShapeSource.Prop) continue;
    const b = grid.bounds[s] as Aabb;
    const tx0 = Math.max(0, Math.floor((b.minX - human) / TILE_M));
    const ty0 = Math.max(0, Math.floor((b.minY - human) / TILE_M));
    const tx1 = Math.min(st.widthTiles - 1, Math.floor((b.maxX + human) / TILE_M));
    const ty1 = Math.min(st.heightTiles - 1, Math.floor((b.maxY + human) / TILE_M));
    for (let ty = ty0; ty <= ty1; ty += 1) {
      for (let tx = tx0; tx <= tx1; tx += 1) {
        const n = st.tileNode[ty * st.widthTiles + tx] as number;
        if (n < 0) continue;
        const nx = nav.nodeX[n] as number;
        const ny = nav.nodeY[n] as number;
        let far = -1;
        if (grid.kind[s] === ShapeKind.Circle) {
          const c = grid.circles[s] as Circle;
          const d = sqrt((nx - c.x) * (nx - c.x) + (ny - c.y) * (ny - c.y));
          if (d < c.radiusM + human) far = d + c.radiusM;
        } else {
          st.circle.x = nx;
          st.circle.y = ny;
          st.circle.radiusM = human;
          if (obbVsCircleShape(grid.boxes[s] as Obb, st.circle, st.contact)) {
            // The farthest point of the box from the node is one of its AABB corners or nearer.
            const fx = Math.max(Math.abs(b.minX - nx), Math.abs(b.maxX - nx));
            const fy = Math.max(Math.abs(b.minY - ny), Math.abs(b.maxY - ny));
            far = sqrt(fx * fx + fy * fy);
          }
        }
        if (far < 0) continue;
        const need = far + human + PROP_ARRIVE_MARGIN_M;
        if (need > (st.nodeArriveM[n] as number)) st.nodeArriveM[n] = need;
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------------------------------------

function heuristic(nav: NavGraph, n: number, goal: number): number {
  const dx = (nav.nodeX[n] as number) - (nav.nodeX[goal] as number);
  const dy = (nav.nodeY[n] as number) - (nav.nodeY[goal] as number);
  return Math.floor(sqrt(dx * dx + dy * dy) * HEURISTIC_PER_MILLE);
}

/** Heap order: lower key first, then lower node index. */
function heapLess(st: Steering, a: number, b: number): boolean {
  const ka = st.heapKey[a] as number;
  const kb = st.heapKey[b] as number;
  if (ka !== kb) return ka < kb;
  return (st.heapNode[a] as number) < (st.heapNode[b] as number);
}

function heapSwap(st: Steering, a: number, b: number): void {
  const n = st.heapNode[a] as number;
  const k = st.heapKey[a] as number;
  st.heapNode[a] = st.heapNode[b] as number;
  st.heapKey[a] = st.heapKey[b] as number;
  st.heapNode[b] = n;
  st.heapKey[b] = k;
}

function heapPush(st: Steering, node: number, key: number): void {
  let i = st.heapSize;
  st.heapSize = i + 1;
  st.heapNode[i] = node;
  st.heapKey[i] = key;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (!heapLess(st, i, p)) break;
    heapSwap(st, i, p);
    i = p;
  }
}

/** Pop the heap's first node (the heap must not be empty). */
function heapPop(st: Steering): number {
  const top = st.heapNode[0] as number;
  const last = st.heapSize - 1;
  st.heapSize = last;
  if (last > 0) {
    st.heapNode[0] = st.heapNode[last] as number;
    st.heapKey[0] = st.heapKey[last] as number;
    let i = 0;
    for (;;) {
      const l = 2 * i + 1;
      if (l >= last) break;
      const r = l + 1;
      const c = r < last && heapLess(st, r, l) ? r : l;
      if (!heapLess(st, c, i)) break;
      heapSwap(st, i, c);
      i = c;
    }
  }
  return top;
}

/**
 * The shortest path on `nav` from node `from` to node `to` (A*, see the file comment) that takes no edge with
 * any of the NAV_FLAG bits in `avoid` (0, the default, avoids nothing; the old man avoids every crossing but
 * the zebra, Behaviour.navAvoid). Writes its first min(length, maxNodes) nodes, `from` first, into
 * out[outStart …] and returns the path's full length in nodes (1 when from = to), or −1 when `to` cannot be
 * reached (out is left as it was). Deterministic and allocation-free.
 */
export function findNavPath(
  st: Steering,
  nav: NavGraph,
  from: number,
  to: number,
  out: Int32Array,
  outStart: number,
  maxNodes: number,
  avoid = 0,
): number {
  if (!(from >= 0 && from < nav.nodeCount && to >= 0 && to < nav.nodeCount)) return -1;
  st.searches += 1;
  let stamp = (st.searchStamp + 1) >>> 0;
  if (stamp === 0) {
    st.seen.fill(0);
    st.done.fill(0);
    stamp = 1;
  }
  st.searchStamp = stamp;
  const g = st.g;
  const parent = st.parent;
  const seen = st.seen;
  const done = st.done;
  const adjStart = nav.adjStart;
  const adjNode = nav.adjNode;
  const adjEdge = nav.adjEdge;
  const edgeFlags = nav.edgeFlags;
  const cost = st.edgeCostMm;
  st.heapSize = 0;
  g[from] = 0;
  parent[from] = -1;
  seen[from] = stamp;
  heapPush(st, from, heuristic(nav, from, to));
  while (st.heapSize > 0) {
    const u = heapPop(st);
    if (done[u] === stamp) continue;
    done[u] = stamp;
    if (u === to) break;
    const gu = g[u] as number;
    const end = adjStart[u + 1] as number;
    for (let k = adjStart[u] as number; k < end; k += 1) {
      const m = adjNode[k] as number;
      if (done[m] === stamp) continue;
      const e = adjEdge[k] as number;
      if (((edgeFlags[e] as number) & avoid) !== 0) continue;
      const gm = gu + (cost[e] as number);
      if (seen[m] === stamp && gm >= (g[m] as number)) continue;
      seen[m] = stamp;
      g[m] = gm;
      parent[m] = u;
      heapPush(st, m, gm + heuristic(nav, m, to));
    }
  }
  if (done[to] !== stamp) return -1;
  let len = 0;
  for (let n = to; n >= 0; n = parent[n] as number) {
    st.chain[len] = n;
    len += 1;
  }
  const keep = len < maxNodes ? len : maxNodes;
  for (let k = 0; k < keep; k += 1) out[outStart + k] = st.chain[len - 1 - k] as number;
  return len;
}

/** The nav edge joining nodes `a` and `b`, or −1. */
export function navEdgeBetween(nav: NavGraph, a: number, b: number): number {
  const end = nav.adjStart[a + 1] as number;
  for (let k = nav.adjStart[a] as number; k < end; k += 1) {
    if ((nav.adjNode[k] as number) === b) return nav.adjEdge[k] as number;
  }
  return -1;
}

/** The nav node to plan NPC `i`'s path from: its crossing's nearer end, else its tile's node, else the nearest. */
function startNode(w: World, i: number): number {
  const npc = w.npc;
  const st = w.npcAi.steering;
  const nav = w.level.nav;
  const x = npc.x[i] as number;
  const y = npc.y[i] as number;
  const cross = npc.crossEdge[i] as number;
  if (cross >= 0) {
    // On a crossing: plan from its nearer end, still crossing until it gets there.
    const a = nav.edgeFrom[cross] as number;
    const b = nav.edgeTo[cross] as number;
    const da = ((nav.nodeX[a] as number) - x) ** 2 + ((nav.nodeY[a] as number) - y) ** 2;
    const db = ((nav.nodeX[b] as number) - x) ** 2 + ((nav.nodeY[b] as number) - y) ** 2;
    return db < da ? b : a;
  }
  const tx = Math.floor(x / TILE_M);
  const ty = Math.floor(y / TILE_M);
  if (tx >= 0 && ty >= 0 && tx < st.widthTiles && ty < st.heightTiles) {
    const n = st.tileNode[ty * st.widthTiles + tx] as number;
    if (n >= 0) return n;
  }
  // Off the graph (a jaywalker on the road, an NPC placed off it): the nearest node, ties to the lower index.
  let best = -1;
  let bestD2 = Number.POSITIVE_INFINITY;
  for (let n = 0; n < nav.nodeCount; n += 1) {
    const dx = (nav.nodeX[n] as number) - x;
    const dy = (nav.nodeY[n] as number) - y;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) {
      bestD2 = d2;
      best = n;
    }
  }
  return best;
}

/** The NAV_FLAG bits of the edges NPC `i`'s behaviour never plans over (Behaviour.navAvoid; 0 for most). */
function navAvoidOf(w: World, i: number): number {
  return (w.npcAi.behaviours[w.npc.kind[i] as number] as Behaviour).navAvoid ?? 0;
}

/**
 * Give NPC `i` a path to nav node `goal` from the node nearest it (on a crossing, the crossing's nearer end).
 * Returns false (NavState.NoPath, no path held) when there is none. Its state becomes Walking (or stays
 * Crossing while it is still on a crossing). Allocation-free.
 */
export function requestNavPath(w: World, i: number, goal: number): boolean {
  const npc = w.npc;
  const st = w.npcAi.steering;
  const nav = w.level.nav;
  // Waiting at a kerb is not being on the crossing.
  if (npc.navState[i] === NavState.KerbWait) npc.crossEdge[i] = -1;
  const from = startNode(w, i);
  const base = i * NPC_PATH_NODES;
  const avoid = navAvoidOf(w, i);
  const len = from < 0 ? -1 : findNavPath(st, nav, from, goal, npc.path, base, NPC_PATH_NODES, avoid);
  const prev = npc.navState[i] as number;
  npc.goalNode[i] = goal;
  if (len < 0) {
    npc.pathLen[i] = 0;
    npc.pathAt[i] = 0;
    setNavState(w, i, NavState.NoPath, prev);
    return false;
  }
  npc.pathLen[i] = len < NPC_PATH_NODES ? len : NPC_PATH_NODES;
  npc.pathAt[i] = 0;
  npc.targetNode[i] = npc.path[base] as number;
  setNavState(w, i, (npc.crossEdge[i] as number) >= 0 ? NavState.Crossing : NavState.Walking, prev);
  return true;
}

/**
 * Drop NPC `i`'s path. An NPC already on a crossing keeps it (its corridor stays open to it) until a new path
 * takes it to one of the crossing's ends.
 */
export function clearNavPath(w: World, i: number): void {
  const npc = w.npc;
  if (npc.navState[i] === NavState.KerbWait) npc.crossEdge[i] = -1;
  npc.pathLen[i] = 0;
  npc.pathAt[i] = 0;
  npc.goalNode[i] = -1;
  setNavState(w, i, NavState.Idle, npc.navState[i] as number);
}

function setNavState(w: World, i: number, state: number, prev: number): void {
  const npc = w.npc;
  npc.navState[i] = state;
  if (state !== prev) npc.navTicks[i] = 0;
}

// ---------------------------------------------------------------------------------------------------------
// Desires
// ---------------------------------------------------------------------------------------------------------

/** Start a steering tick: clear the desired velocity. */
export function beginSteer(w: World): void {
  const v = w.npcAi.steering.v;
  v[DES_X] = 0;
  v[DES_Y] = 0;
}

/** The desired velocity so far, m/s, as [x, y] in its first two entries (read-only for callers). */
export function desiredVelocity(w: World): Float64Array {
  return w.npcAi.steering.v;
}

/** Add `scale` × walkMps towards (or, negative, away from) (tx, ty), held in st.v[AX], st.v[AY]. */
function addToward(w: World, i: number, arrive: boolean, sign: number): void {
  const npc = w.npc;
  const v = w.npcAi.steering.v;
  const dx = (v[AX] as number) - (npc.x[i] as number);
  const dy = (v[AY] as number) - (npc.y[i] as number);
  const d = sqrt(dx * dx + dy * dy);
  if (!(d > 1e-6)) return;
  let speed = npc.walkMps[i] as number;
  if (arrive) {
    const slow = w.tuning.streetLife.npcSteering.slowRadiusM;
    if (d < slow) speed *= d / slow;
  }
  v[DES_X] = (v[DES_X] as number) + ((sign * dx) / d) * speed;
  v[DES_Y] = (v[DES_Y] as number) + ((sign * dy) / d) * speed;
}

/** Seek (xs[j], ys[j]) at full walking speed. */
export function steerSeek(w: World, i: number, xs: Float64Array, ys: Float64Array, j: number): void {
  const v = w.npcAi.steering.v;
  v[AX] = xs[j] as number;
  v[AY] = ys[j] as number;
  addToward(w, i, false, 1);
}

/** Arrive at (xs[j], ys[j]): seek, slowing linearly inside slowRadiusM to rest on the point. */
export function steerArrive(w: World, i: number, xs: Float64Array, ys: Float64Array, j: number): void {
  const v = w.npcAi.steering.v;
  v[AX] = xs[j] as number;
  v[AY] = ys[j] as number;
  addToward(w, i, true, 1);
}

/** Flee (xs[j], ys[j]) at full walking speed. */
export function steerFlee(w: World, i: number, xs: Float64Array, ys: Float64Array, j: number): void {
  const v = w.npcAi.steering.v;
  v[AX] = xs[j] as number;
  v[AY] = ys[j] as number;
  addToward(w, i, false, -1);
}

/**
 * Separation (TECHNICAL_DESIGN §11.1): steer away from every NPC whose circle is within separationGapM of
 * touching NPC `i`'s (found through the spatial hash), up to SEPARATION_WEIGHT × walkMps at contact, plus a
 * keep-right bias for one ahead, so two NPCs meeting head-on pass instead of pushing.
 */
export function steerSeparate(w: World, i: number): void {
  const npc = w.npc;
  const st = w.npcAi.steering;
  const v = st.v;
  const gap = w.tuning.streetLife.npcSteering.separationGapM;
  const x = npc.x[i] as number;
  const y = npc.y[i] as number;
  const r = npc.radius[i] as number;
  const reach = r + st.maxRadiusM + gap;
  const box = st.box;
  box.minX = x - reach;
  box.minY = y - reach;
  box.maxX = x + reach;
  box.maxY = y + reach;
  const n = queryNpcs(npc, box, st.neighbours);
  const walk = npc.walkMps[i] as number;
  const h = npc.heading[i] as number;
  const fx = sin(h);
  const fy = -cos(h);
  for (let k = 0; k < n; k += 1) {
    const j = st.neighbours[k] as number;
    // A cat on Bessie's roof (ON_ROOF, SSP-087) is up off the ground: nobody steers round it.
    if (j === i || ((npc.flags[j] as number) & NPC_FLAG.ON_ROOF) !== 0) continue;
    const range = r + (npc.radius[j] as number) + gap;
    let dx = x - (npc.x[j] as number);
    let dy = y - (npc.y[j] as number);
    const d2 = dx * dx + dy * dy;
    if (d2 >= range * range) continue;
    v[LX] = dx;
    v[LY] = dy;
    scratchLength(v);
    let d = v[LEN] as number;
    if (d < 1e-9) {
      fallbackDirection(v, npc.handleSlot[i] as number);
      dx = v[OUT_X] as number;
      dy = v[OUT_Y] as number;
      d = 1;
    }
    const push = (1 - d / range) * walk;
    v[DES_X] = (v[DES_X] as number) + (dx / d) * push * SEPARATION_WEIGHT;
    v[DES_Y] = (v[DES_Y] as number) + (dy / d) * push * SEPARATION_WEIGHT;
    // Ahead (within 60° of its heading): bear right, (−fy, fx) = (cos h, sin h), so two meeting head-on pass.
    if (-(dx * fx + dy * fy) > 0.5 * d) {
      v[DES_X] = (v[DES_X] as number) - fy * push * PASSING_WEIGHT;
      v[DES_Y] = (v[DES_Y] as number) + fx * push * PASSING_WEIGHT;
    }
  }
}

/**
 * Sidestep Bessie's predicted path (TECHNICAL_DESIGN §11.1): the segment from her body centre along her ground
 * velocity for PERCEPTION_PATH_S (1.5 s). When NPC `i` is ahead of her and within her half width + its radius
 * + sidestepClearM of the segment, add a lateral desire (SIDESTEP_WEIGHT × walkMps, perpendicular to her
 * path, away from it; dead on the line, towards the side it may stand on, else her left). Returns whether it
 * sidestepped. Behaviours gate it (who yields, at what range); see ENTITY_CATALOG §3.4.
 */
export function steerSidestep(w: World, i: number): boolean {
  const npc = w.npc;
  const st = w.npcAi.steering;
  const v = st.v;
  const bv = w.vehicle;
  const hb = bv.headingRad;
  const s = sin(hb);
  const c = cos(hb);
  const vx = s * bv.vLongMps + c * bv.vLatMps;
  const vy = -c * bv.vLongMps + s * bv.vLatMps;
  const speed2 = vx * vx + vy * vy;
  if (speed2 < SIDESTEP_MIN_SPEED_MPS * SIDESTEP_MIN_SPEED_MPS) return false;
  const sx = vx * PERCEPTION_PATH_S;
  const sy = vy * PERCEPTION_PATH_S;
  const len2 = sx * sx + sy * sy;
  const px = (npc.x[i] as number) - bv.xM;
  const py = (npc.y[i] as number) - bv.yM;
  const along = px * sx + py * sy;
  if (!(along > 0)) return false; // behind her or level with her centre: not in her path
  let t = along / len2;
  if (t > 1) t = 1;
  const gx = px - t * sx;
  const gy = py - t * sy;
  const clear =
    w.tuning.vehicle.sweeper.body.widthM / 2 +
    (npc.radius[i] as number) +
    w.tuning.streetLife.npcSteering.sidestepClearM;
  if (gx * gx + gy * gy >= clear * clear) return false;
  v[LX] = sx;
  v[LY] = sy;
  scratchLength(v);
  const len = v[LEN] as number;
  // Her left, perpendicular to the path (y points south, so the left of (sx, sy) is (sy, −sx)).
  const lx = sy / len;
  const ly = -sx / len;
  const lateral = gx * lx + gy * ly;
  let side = lateral > 0 ? 1 : -1;
  if (Math.abs(lateral) < 1e-3) {
    v[CX] = (npc.x[i] as number) + lx * TILE_M * 0.5;
    v[CY] = (npc.y[i] as number) + ly * TILE_M * 0.5;
    const leftOk = tileAllowed(w, i);
    v[CX] = (npc.x[i] as number) - lx * TILE_M * 0.5;
    v[CY] = (npc.y[i] as number) - ly * TILE_M * 0.5;
    const rightOk = tileAllowed(w, i);
    side = !leftOk && rightOk ? -1 : 1;
  }
  const push = (npc.walkMps[i] as number) * SIDESTEP_WEIGHT * side;
  v[DES_X] = (v[DES_X] as number) + lx * push;
  v[DES_Y] = (v[DES_Y] as number) + ly * push;
  return true;
}

/**
 * Walk round the props ahead (LEVEL_DESIGN §7.2: props stand on walkable tiles and steering walks round them).
 * Looking AVOID_LOOK_S of walking ahead along the desired velocity (at least AVOID_MIN_LOOK_M), take the
 * nearest prop whose reach (its footprint's bounding circle plus NPC `i`'s radius) the line passes through, and
 * add a lateral desire away from its centre, up to AVOID_WEIGHT × walkMps when dead ahead and close; dead
 * ahead, towards the side the NPC may stand on, else its right. moveNpc's collision does the rest.
 */
export function steerAvoidProps(w: World, i: number): void {
  const npc = w.npc;
  const st = w.npcAi.steering;
  const grid = w.staticGrid;
  const v = st.v;
  const dx = v[DES_X] as number;
  const dy = v[DES_Y] as number;
  const m = sqrt(dx * dx + dy * dy);
  if (!(m > 1e-6)) return;
  const ux = dx / m;
  const uy = dy / m;
  const walk = npc.walkMps[i] as number;
  const r = npc.radius[i] as number;
  const px = npc.x[i] as number;
  const py = npc.y[i] as number;
  const lookAhead = walk * AVOID_LOOK_S;
  const look = lookAhead > AVOID_MIN_LOOK_M ? lookAhead : AVOID_MIN_LOOK_M;
  const reachMax = look + r + AVOID_MAX_PROP_M;
  const box = st.box;
  box.minX = px - reachMax;
  box.minY = py - reachMax;
  box.maxX = px + reachMax;
  box.maxY = py + reachMax;
  const n = queryStatic(grid, box);
  let bestAlong = Number.POSITIVE_INFINITY;
  let bestLat = 0;
  let bestReach = 0;
  for (let k = 0; k < n; k += 1) {
    const s = grid.candidates[k] as number;
    if (grid.source[s] !== ShapeSource.Prop) continue;
    let cx: number;
    let cy: number;
    let radius: number;
    if (grid.kind[s] === ShapeKind.Circle) {
      const c = grid.circles[s] as Circle;
      cx = c.x;
      cy = c.y;
      radius = c.radiusM;
    } else {
      const b = grid.boxes[s] as Obb;
      cx = b.cx;
      cy = b.cy;
      radius = st.propBoundM[s] as number;
    }
    const reach = radius + r;
    const rx = cx - px;
    const ry = cy - py;
    const along = rx * ux + ry * uy;
    if (!(along > 0) || along > look + reach) continue;
    // Signed offset of the prop to the NPC's right of its line: right of (ux, uy) is (−uy, ux).
    const lat = -rx * uy + ry * ux;
    if (Math.abs(lat) >= reach) continue;
    if (along < bestAlong) {
      bestAlong = along;
      bestLat = lat;
      bestReach = reach;
    }
  }
  if (!Number.isFinite(bestAlong)) return;
  // The side to bear to: away from the prop (+1 = right), or, dead ahead, the side it may stand on.
  let side = bestLat > 0 ? -1 : 1;
  if (Math.abs(bestLat) < 1e-3) {
    v[CX] = px - uy * AVOID_PROBE_M;
    v[CY] = py + ux * AVOID_PROBE_M;
    const rightOk = tileAllowed(w, i);
    v[CX] = px + uy * AVOID_PROBE_M;
    v[CY] = py - ux * AVOID_PROBE_M;
    const leftOk = tileAllowed(w, i);
    side = !rightOk && leftOk ? -1 : 1;
  }
  const near = 1 - bestAlong / (look + bestReach);
  const push = walk * AVOID_WEIGHT * (1 - Math.abs(bestLat) / bestReach) * (near > 0.25 ? near : 0.25) * side;
  v[DES_X] = (v[DES_X] as number) - uy * push;
  v[DES_Y] = (v[DES_Y] as number) + ux * push;
}

/**
 * Follow NPC `i`'s nav path (requestNavPath): advance the cursor past every node it has reached (within the
 * node's arrive radius, or passed on the way to the next one), wait at the kerb before a crossing edge (see the
 * file comment), plan the next segment at a segment's end, and add the desire: seek the target node, or arrive
 * at it when it is the goal or the kerb. Returns the NavState. Without a path it adds nothing.
 */
export function steerFollowPath(w: World, i: number): number {
  const npc = w.npc;
  const st = w.npcAi.steering;
  const nav = w.level.nav;
  const prev = npc.navState[i] as number;
  let len = npc.pathLen[i] as number;
  if (len === 0) {
    npc.navTicks[i] = (npc.navTicks[i] as number) + 1;
    return prev;
  }
  const base = i * NPC_PATH_NODES;
  const goal = npc.goalNode[i] as number;
  const behaviour = w.npcAi.behaviours[npc.kind[i] as number] as Behaviour;
  const jaywalks = behaviour.jaywalks;
  const avoid = behaviour.navAvoid ?? 0;
  // An NPC wider than a human (the mum's pushchair) stands further off a node a prop stands on.
  const wider = (npc.radius[i] as number) - st.humanRadiusM;
  const x = npc.x[i] as number;
  const y = npc.y[i] as number;
  let at = npc.pathAt[i] as number;
  let state = prev;
  let hold = false;
  if (state === NavState.KerbWait) {
    const lookTicks = Math.round(w.tuning.streetLife.npcSteering.kerbLookS * SIM_HZ);
    if ((npc.navTicks[i] as number) + 1 >= lookTicks && st.crossingClear(w, i, npc.crossEdge[i] as number)) {
      state = NavState.Crossing;
      at += 1;
    } else {
      hold = true;
    }
  }
  for (let guard = 0; !hold && guard <= NPC_PATH_NODES + 1; guard += 1) {
    const target = npc.path[base + at] as number;
    const tx = nav.nodeX[target] as number;
    const ty = nav.nodeY[target] as number;
    const d2 = (tx - x) * (tx - x) + (ty - y) * (ty - y);
    let arrive = st.nodeArriveM[target] as number;
    if (wider > 0 && arrive > st.arriveRadiusM) arrive += wider;
    let reached = d2 <= arrive * arrive;
    if (!reached && state === NavState.Walking && at + 1 < len) {
      // Passed it on the way to the next node (not a crossing: the kerb node is always reached).
      const next = npc.path[base + at + 1] as number;
      const e = navEdgeBetween(nav, target, next);
      if (e >= 0 && ((nav.edgeFlags[e] as number) & NAV_FLAG_CROSSING) === 0) {
        const nx = nav.nodeX[next] as number;
        const ny = nav.nodeY[next] as number;
        reached = (nx - x) * (nx - x) + (ny - y) * (ny - y) < (nx - tx) * (nx - tx) + (ny - ty) * (ny - ty);
      }
    }
    if (!reached) break;
    if (state === NavState.Crossing) {
      // Off the crossing only once its centre is back on a nav tile: a node's arrive radius can reach onto the
      // road where a prop stands on it.
      const ntx = Math.floor(x / TILE_M);
      const nty = Math.floor(y / TILE_M);
      if (!(ntx >= 0 && nty >= 0 && ntx < st.widthTiles && nty < st.heightTiles)) break;
      if ((st.tileNode[nty * st.widthTiles + ntx] as number) < 0) break;
      npc.crossEdge[i] = -1;
      state = NavState.Walking;
    }
    if (at + 1 >= len) {
      if (target === goal) {
        state = NavState.Arrived;
        hold = true;
        break;
      }
      // The segment's last node: plan the next segment from it (its first node is this one).
      const full = findNavPath(st, nav, target, goal, npc.path, base, NPC_PATH_NODES, avoid);
      if (full < 0) {
        len = 0;
        state = NavState.NoPath;
        break;
      }
      len = full < NPC_PATH_NODES ? full : NPC_PATH_NODES;
      at = 0;
      continue;
    }
    const next = npc.path[base + at + 1] as number;
    const e = navEdgeBetween(nav, target, next);
    if (e >= 0 && ((nav.edgeFlags[e] as number) & NAV_FLAG_CROSSING) !== 0) {
      npc.crossEdge[i] = e;
      if (!jaywalks) {
        state = NavState.KerbWait;
        hold = true;
        break;
      }
      state = NavState.Crossing;
    } else if (state !== NavState.Crossing) {
      state = NavState.Walking;
    }
    at += 1;
  }
  npc.pathLen[i] = len;
  npc.pathAt[i] = at;
  if (state !== prev) npc.navTicks[i] = 0;
  else npc.navTicks[i] = (npc.navTicks[i] as number) + 1;
  npc.navState[i] = state;
  if (len === 0) return state;
  const target = npc.path[base + at] as number;
  npc.targetNode[i] = target;
  const v = st.v;
  v[AX] = nav.nodeX[target] as number;
  v[AY] = nav.nodeY[target] as number;
  addToward(w, i, hold || (at + 1 >= len && target === goal), 1);
  return state;
}

// ---------------------------------------------------------------------------------------------------------
// Moving
// ---------------------------------------------------------------------------------------------------------

/** Whether NPC `i` may have its centre on the tile under (v[CX], v[CY]) (the file comment's tile rule). */
function tileAllowed(w: World, i: number): boolean {
  const st = w.npcAi.steering;
  const v = st.v;
  const tx = Math.floor((v[CX] as number) / TILE_M);
  const ty = Math.floor((v[CY] as number) / TILE_M);
  if (tx < 0 || ty < 0 || tx >= st.widthTiles || ty >= st.heightTiles) return false;
  const t = ty * st.widthTiles + tx;
  if (((st.tileFlags[t] as number) & STEER_TILE.BLOCKED) !== 0) return false;
  const npc = w.npc;
  if ((w.npcAi.behaviours[npc.kind[i] as number] as Behaviour).jaywalks) return true;
  if ((st.tileNode[t] as number) >= 0) return true;
  const e = npc.crossEdge[i] as number;
  return (
    e >= 0 &&
    npc.navState[i] !== NavState.KerbWait &&
    tx >= (st.corridorX0[e] as number) &&
    tx <= (st.corridorX1[e] as number) &&
    ty >= (st.corridorY0[e] as number) &&
    ty <= (st.corridorY1[e] as number)
  );
}

/** Whether a circle of NPC `i`'s radius at (v[CX], v[CY]) overlaps a prop footprint deeper than PROP_SLOP_M. */
function propOverlaps(w: World, i: number): boolean {
  const st = w.npcAi.steering;
  const grid = w.staticGrid;
  const v = st.v;
  const cx = v[CX] as number;
  const cy = v[CY] as number;
  const r = w.npc.radius[i] as number;
  const box = st.box;
  box.minX = cx - r;
  box.minY = cy - r;
  box.maxX = cx + r;
  box.maxY = cy + r;
  const n = queryStatic(grid, box);
  for (let k = 0; k < n; k += 1) {
    const s = grid.candidates[k] as number;
    if (grid.source[s] !== ShapeSource.Prop) continue;
    if (grid.kind[s] === ShapeKind.Circle) {
      const c = grid.circles[s] as Circle;
      const reach = r + c.radiusM - PROP_SLOP_M;
      const dx = cx - c.x;
      const dy = cy - c.y;
      if (dx * dx + dy * dy < reach * reach) return true;
    } else {
      const circle = st.circle;
      circle.x = cx;
      circle.y = cy;
      circle.radiusM = r;
      if (obbVsCircleShape(grid.boxes[s] as Obb, circle, st.contact) && st.contact.depthM > PROP_SLOP_M)
        return true;
    }
  }
  return false;
}

/** Whether the tile at (tx, ty) blocks NPCs (blocked or off the map). */
function blockedTile(st: Steering, tx: number, ty: number): boolean {
  if (tx < 0 || ty < 0 || tx >= st.widthTiles || ty >= st.heightTiles) return true;
  return ((st.tileFlags[ty * st.widthTiles + tx] as number) & STEER_TILE.BLOCKED) !== 0;
}

/**
 * Push NPC `i`'s circle at (v[CX], v[CY]) out of the tile corner on grid lines (gx, gy) (integers: the corner
 * is at (gx, gy) × TILE_M), next to a blocked diagonal tile.
 */
function pushFromCorner(w: World, i: number, gx: number, gy: number): void {
  const v = w.npcAi.steering.v;
  const r = w.npc.radius[i] as number;
  const px = gx * TILE_M;
  const py = gy * TILE_M;
  const dx = (v[CX] as number) - px;
  const dy = (v[CY] as number) - py;
  const d2 = dx * dx + dy * dy;
  if (d2 >= r * r) return;
  v[LX] = dx;
  v[LY] = dy;
  scratchLength(v);
  const d = v[LEN] as number;
  if (d < 1e-9) return;
  v[CX] = px + (dx / d) * r;
  v[CY] = py + (dy / d) * r;
}

/**
 * Resolve the candidate (v[CX], v[CY]) for NPC `i`: step out of the other NPCs, then the props (recording the
 * last prop normal in v[NX], v[NY] and v[HIT]), then the blocked tiles beside its tile.
 */
function resolveCandidate(w: World, i: number): void {
  const npc = w.npc;
  const st = w.npcAi.steering;
  const grid = w.staticGrid;
  const v = st.v;
  const r = npc.radius[i] as number;
  let cx = v[CX] as number;
  let cy = v[CY] as number;
  const box = st.box;
  // 1. Other NPCs.
  const reach = r + st.maxRadiusM;
  box.minX = cx - reach;
  box.minY = cy - reach;
  box.maxX = cx + reach;
  box.maxY = cy + reach;
  const n = queryNpcs(npc, box, st.neighbours);
  for (let k = 0; k < n; k += 1) {
    const j = st.neighbours[k] as number;
    if (j === i || ((npc.flags[j] as number) & NPC_FLAG.ON_ROOF) !== 0) continue;
    const min = r + (npc.radius[j] as number);
    let dx = cx - (npc.x[j] as number);
    let dy = cy - (npc.y[j] as number);
    const d2 = dx * dx + dy * dy;
    if (d2 >= min * min) continue;
    v[LX] = dx;
    v[LY] = dy;
    scratchLength(v);
    let d = v[LEN] as number;
    if (d < 1e-9) {
      fallbackDirection(v, npc.handleSlot[i] as number);
      dx = v[OUT_X] as number;
      dy = v[OUT_Y] as number;
      d = 1;
    }
    cx += (dx / d) * (min - d);
    cy += (dy / d) * (min - d);
  }
  // 2. Props.
  v[HIT] = 0;
  box.minX = cx - r;
  box.minY = cy - r;
  box.maxX = cx + r;
  box.maxY = cy + r;
  const m = queryStatic(grid, box);
  for (let k = 0; k < m; k += 1) {
    const s = grid.candidates[k] as number;
    if (grid.source[s] !== ShapeSource.Prop) continue;
    if (grid.kind[s] === ShapeKind.Circle) {
      const c = grid.circles[s] as Circle;
      const min = r + c.radiusM;
      let dx = cx - c.x;
      let dy = cy - c.y;
      const d2 = dx * dx + dy * dy;
      if (d2 >= min * min) continue;
      v[LX] = dx;
      v[LY] = dy;
      scratchLength(v);
      let d = v[LEN] as number;
      if (d < 1e-9) {
        fallbackDirection(v, npc.handleSlot[i] as number);
        dx = v[OUT_X] as number;
        dy = v[OUT_Y] as number;
        d = 1;
      }
      v[NX] = dx / d;
      v[NY] = dy / d;
      v[HIT] = 1;
      cx = c.x + (dx / d) * min;
      cy = c.y + (dy / d) * min;
    } else {
      const circle = st.circle;
      circle.x = cx;
      circle.y = cy;
      circle.radiusM = r;
      const contact = st.contact;
      if (!obbVsCircleShape(grid.boxes[s] as Obb, circle, contact)) continue;
      // The normal points from the circle towards the box: the circle leaves along its negative.
      v[NX] = -contact.normalX;
      v[NY] = -contact.normalY;
      v[HIT] = 1;
      cx -= contact.normalX * contact.depthM;
      cy -= contact.normalY * contact.depthM;
    }
  }
  // 3. Blocked tiles beside its tile (the map edge included): faces, then corners.
  const tx = Math.floor(cx / TILE_M);
  const ty = Math.floor(cy / TILE_M);
  const x0 = tx * TILE_M;
  const y0 = ty * TILE_M;
  const x1 = x0 + TILE_M;
  const y1 = y0 + TILE_M;
  const west = blockedTile(st, tx - 1, ty);
  const east = blockedTile(st, tx + 1, ty);
  const north = blockedTile(st, tx, ty - 1);
  const south = blockedTile(st, tx, ty + 1);
  if (west && cx < x0 + r) cx = x0 + r;
  if (east && cx > x1 - r) cx = x1 - r;
  if (north && cy < y0 + r) cy = y0 + r;
  if (south && cy > y1 - r) cy = y1 - r;
  v[CX] = cx;
  v[CY] = cy;
  if (!west && !north && blockedTile(st, tx - 1, ty - 1)) pushFromCorner(w, i, tx, ty);
  if (!east && !north && blockedTile(st, tx + 1, ty - 1)) pushFromCorner(w, i, tx + 1, ty);
  if (!west && !south && blockedTile(st, tx - 1, ty + 1)) pushFromCorner(w, i, tx, ty + 1);
  if (!east && !south && blockedTile(st, tx + 1, ty + 1)) pushFromCorner(w, i, tx + 1, ty + 1);
}

/**
 * Resolve the candidate p + (dx, dy) (v[STEP_X], v[STEP_Y] scaled by the caller into v[CX], v[CY]) and say
 * whether it may be taken (the file comment's rules; `tileWaived` / `propWaived` when the current position
 * already breaks the rule).
 */
function tryCandidate(w: World, i: number, tileWaived: boolean, propWaived: boolean): boolean {
  resolveCandidate(w, i);
  if (!tileWaived && !tileAllowed(w, i)) return false;
  const st = w.npcAi.steering;
  const v = st.v;
  const tx = Math.floor((v[CX] as number) / TILE_M);
  const ty = Math.floor((v[CY] as number) / TILE_M);
  if (blockedTile(st, tx, ty)) return false;
  if (!propWaived && propOverlaps(w, i)) return false;
  return true;
}

/**
 * Move NPC `i` one tick towards the desired velocity: turn its heading towards it by at most
 * turnRateDegPerS·dt, bring its speed towards the desired speed (capped at walkMps, and scaled by how well it
 * faces the direction) by at most accelMps2·dt, then step along its heading under the constraints of the file
 * comment, and update the spatial hash. Its speed is capped by the distance it actually moved.
 */
export function moveNpc(w: World, i: number): void {
  const npc = w.npc;
  const st = w.npcAi.steering;
  const v = st.v;
  const tun = w.tuning.streetLife.npcSteering;
  let dx = v[DES_X] as number;
  let dy = v[DES_Y] as number;
  const walk = npc.walkMps[i] as number;
  let m = sqrt(dx * dx + dy * dy);
  if (m > walk) {
    const k = walk / m;
    dx *= k;
    dy *= k;
    m = walk;
  }
  // Angles are wrapped inline (a helper taking a double would box it when not inlined, §17 trap 1): the
  // heading into (−π, π] first, after which every difference needs at most one turn added or taken away.
  let h = npc.heading[i] as number;
  while (h > Math.PI) h -= TWO_PI;
  while (h <= -Math.PI) h += TWO_PI;
  // atan2 and cos run on every call, desire or none, so they are never a cold call site.
  const want = atan2(dx, -dy);
  let diff = want - h;
  if (diff > Math.PI) diff -= TWO_PI;
  else if (diff <= -Math.PI) diff += TWO_PI;
  const maxTurn = tun.turnRateDegPerS * DEG_TO_RAD * DT_S;
  if (diff > maxTurn) diff = maxTurn;
  else if (diff < -maxTurn) diff = -maxTurn;
  if (m > 1e-6) h += diff;
  if (h > Math.PI) h -= TWO_PI;
  else if (h <= -Math.PI) h += TWO_PI;
  let rest = want - h;
  if (rest > Math.PI) rest -= TWO_PI;
  else if (rest <= -Math.PI) rest += TWO_PI;
  const facing = cos(rest);
  const target = m > 1e-6 && facing > 0 ? m * facing : 0;
  let speed = npc.speed[i] as number;
  const dv = tun.accelMps2 * DT_S;
  if (speed < target) speed = speed + dv < target ? speed + dv : target;
  else if (speed > target) speed = speed - dv > target ? speed - dv : target;
  npc.heading[i] = h;
  const x = npc.x[i] as number;
  const y = npc.y[i] as number;
  const sx = sin(h) * speed * DT_S;
  const sy = -cos(h) * speed * DT_S;
  v[STEP_X] = sx;
  v[STEP_Y] = sy;
  // Which rules the current position already breaks (waived so it can walk out).
  v[CX] = x;
  v[CY] = y;
  const tileWaived = !tileAllowed(w, i);
  const propWaived = propOverlaps(w, i);
  // A: the full step.
  v[CX] = x + sx;
  v[CY] = y + sy;
  let ok = tryCandidate(w, i, tileWaived, propWaived);
  let ax = v[CX] as number;
  let ay = v[CY] as number;
  const step2 = sx * sx + sy * sy;
  const progress = step2 > 0 ? ((ax - x) * sx + (ay - y) * sy) / step2 : 1;
  if (!(ok && progress >= POOR_PROGRESS)) {
    let accepted = false;
    // B: a prop stopped it: step along the prop's surface, on the side that keeps some progress.
    if ((v[HIT] as number) === 1 && step2 > 0) {
      const nx = v[NX] as number;
      const ny = v[NY] as number;
      let tx = -ny;
      let ty = nx;
      const dot = tx * sx + ty * sy;
      if (dot < 0 || (dot === 0 && ((npc.handleSlot[i] as number) & 1) === 1)) {
        tx = -tx;
        ty = -ty;
      }
      v[LX] = sx;
      v[LY] = sy;
      scratchLength(v);
      const len = v[LEN] as number;
      v[CX] = x + tx * len;
      v[CY] = y + ty * len;
      if (tryCandidate(w, i, tileWaived, propWaived)) {
        ax = v[CX] as number;
        ay = v[CY] as number;
        accepted = true;
      }
    }
    if (!accepted && !ok) {
      // C, D: the step's x part, then its y part; else stay.
      v[CX] = x + sx;
      v[CY] = y;
      ok = tryCandidate(w, i, tileWaived, propWaived);
      if (!ok) {
        v[CX] = x;
        v[CY] = y + sy;
        ok = tryCandidate(w, i, tileWaived, propWaived);
      }
      ax = ok ? (v[CX] as number) : x;
      ay = ok ? (v[CY] as number) : y;
    }
  }
  const mx = ax - x;
  const my = ay - y;
  const moved = sqrt(mx * mx + my * my) / DT_S;
  npc.speed[i] = moved < speed ? moved : speed;
  npc.x[i] = ax;
  npc.y[i] = ay;
  updateNpcCell(npc, i);
}

/**
 * The usual walking tick: follow the path, walk round the props ahead, keep apart from the other NPCs,
 * sidestep Bessie's predicted path when `sidestep`, and move. Returns the NavState.
 */
export function walkNpc(w: World, i: number, sidestep: boolean): number {
  beginSteer(w);
  const state = steerFollowPath(w, i);
  steerAvoidProps(w, i);
  steerSeparate(w, i);
  if (sidestep) steerSidestep(w, i);
  moveNpc(w, i);
  return state;
}

/** Phase 7, after the behaviours: count the NPCs whose centre is on each zebra (world.zebras.occupancy), ON_ROOF cats aside. */
export function updateZebraOccupancy(w: World): void {
  const z = w.zebras;
  const occ = z.occupancy;
  occ.fill(0);
  if (z.count === 0) return;
  const npc = w.npc;
  for (let i = 0; i < npc.count; i += 1) {
    // A cat riding Bessie's roof (ON_ROOF, SSP-087) is not on the zebra she drives over.
    if (((npc.flags[i] as number) & NPC_FLAG.ON_ROOF) !== 0) continue;
    const x = npc.x[i] as number;
    const y = npc.y[i] as number;
    for (let k = 0; k < z.count; k += 1) {
      if (
        x >= (z.minX[k] as number) &&
        x < (z.maxX[k] as number) &&
        y >= (z.minY[k] as number) &&
        y < (z.maxY[k] as number)
      ) {
        occ[k] = (occ[k] as number) + 1;
        break;
      }
    }
  }
}
