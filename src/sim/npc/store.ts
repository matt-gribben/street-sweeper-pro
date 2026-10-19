// The NPC store (TECHNICAL_DESIGN §7.1, §11.1, SSP-080): a fixed-capacity struct-of-arrays of every live NPC
// (people, the dog walkers' dogs, cats and flock birds), allocated once at shift start with capacity
// NPC_CAPACITY (80, §17). Live NPCs occupy indices 0..count−1; removal is swap-remove with the last live NPC.
//
// Handles. An index is only good until the next removal, so links that must survive (the dog belonging to
// its walker, a stimulus aimed at one NPC) hold a generation-checked handle instead. Each live NPC owns a
// stable handle slot (`handleSlot[i]`, 0..capacity−1, which never moves when the NPC's index does); the
// handle is `(slotGen[slot] << NPC_HANDLE_SLOT_BITS) | slot`. Removing an NPC bumps its slot's generation and
// returns the slot to a free stack, so every old handle to it stops resolving (resolveNpcHandle → −1) while
// the slot is reused by a later NPC under a new generation. The free stack pops the lowest slot first at
// shift start and the most recently freed one after that, so slot reuse is deterministic.
//
// Spatial hash. The level is covered by NPC_HASH_CELL_M (4 m) cells, the litter.ts pattern: each cell holds an
// intrusive doubly linked list (cellHead / cellNext / cellPrev), so insert, unlink and swap-remove are O(1).
// Code that moves an NPC (steering, SSP-081) calls updateNpcCell afterwards; queryNpcs visits only the cells
// a box overlaps, in a deterministic order (cells row-major, then list order).
//
// Hot path: every function here except createNpcStore and addNpcAt allocates nothing and takes no doubles as
// arguments (TECHNICAL_DESIGN §17, trap 1): positions come in through typed arrays and an index.
import type { Aabb } from '../collision/obb.ts';
import { TILE_M } from '../constants.ts';
import type { Level } from '../map.ts';

/** NPC store capacity (TECHNICAL_DESIGN §7.1, §17): every NPC, flock birds and dogs included. */
export const NPC_CAPACITY = 80;
/** Bits of a handle that hold the slot; capacities above 2^bits are refused. */
export const NPC_HANDLE_SLOT_BITS = 7;
/** Generations wrap at 2^24, so a handle is a non-negative Int32. */
const NPC_GEN_MASK = 0xffffff;
/** "No NPC": a handle or link that resolves to nothing. */
export const NO_NPC_HANDLE = -1;
/** Edge of one spatial-hash cell in metres (the litter.ts cell). */
export const NPC_HASH_CELL_M = 4;
/**
 * Nav nodes of path each NPC holds at once (steering.ts, SSP-081): its path segment, path[i·NPC_PATH_NODES …].
 * A longer path is planned again from the segment's last node when the NPC reaches it.
 */
export const NPC_PATH_NODES = 32;

/**
 * Per-NPC flag bits (`flags`, Uint16). Hashed into replays: append, never renumber. Behaviours set them
 * (Fallen, the cat's RideRoof, yielding to Bessie); the renderer and the shared rules read them. SSP-082 appends
 * AWARE and HI_VIS, the two per-tick stimulus marks of the reaction model (npc/reactions.ts): phase 7 clears both
 * on every NPC before it delivers the tick's stimuli, and a behaviour that takes BeaconYield (Bessie within the
 * awareness radius) sets AWARE, one that takes HiVis (pwr.hi_vis running) sets HI_VIS. A FALLEN or ON_ROOF NPC
 * cannot be hit (actor contact skips it). SSP-084 appends DODGED, a per-approach latch (the shopper's 4 m
 * sidestep and the businessman's 2 m startle fire once per approach of Bessie, and the latch clears once she is
 * outside the trigger distance), and LEAVING: the NPC is on its way off the map (the caught litterbug slinking
 * off), and the spawner retires it on its next run with its circle off the view, whatever its origin. SSP-086
 * appends LEAD_CROSSED, on a dog walker: Bessie's body overlaps its lead this tick (behaviours/dogWalker.ts). A
 * Lead Tangle counts only on the tick it is set, so Bessie must clear the whole lead before another one counts.
 */
export const NPC_FLAG = {
  FALLEN: 1,
  ON_ROOF: 2,
  YIELDING: 4,
  AWARE: 8,
  HI_VIS: 16,
  DODGED: 32,
  LEAVING: 64,
  LEAD_CROSSED: 128,
} as const;
export type NpcFlagBit = (typeof NPC_FLAG)[keyof typeof NPC_FLAG];

/**
 * Where an NPC came from (`origin`, Uint8; LEVEL_DESIGN §9.4). Only Ambient NPCs count towards the
 * population target and its caps and are ever retired; Named NPCs persist for the shift, and so do the
 * placed Perch cats and Flock birds; a Companion is the dog on a dog walker's lead (the walker's `link`).
 * Hashed: append, never renumber.
 */
export const NpcOrigin = { Ambient: 0, Named: 1, Perch: 2, Flock: 3, Companion: 4 } as const;
export type NpcOrigin = (typeof NpcOrigin)[keyof typeof NpcOrigin];

/** All live NPCs. Create with createNpcStore. */
export type NpcStore = {
  readonly capacity: number;
  /** Live NPCs, at indices 0..count−1. */
  count: number;
  /** NPCs added and removed this shift. */
  npcsAdded: number;
  npcsRemoved: number;
  /** NPC_IDS index (entities.json npc table). A companion dog carries its walker's kind. */
  readonly kind: Uint8Array;
  /** Behaviour state id (the kind's behaviour module's `as const` states). */
  readonly state: Uint8Array;
  /** Ticks spent in the current state, counting the current tick (reset by setNpcState). */
  readonly stateTicks: Uint32Array;
  /** Position, metres. */
  readonly x: Float64Array;
  readonly y: Float64Array;
  /** Position at the start of this tick's phase 7, for render interpolation. */
  readonly prevX: Float64Array;
  readonly prevY: Float64Array;
  /** Heading, radians (0 = north, clockwise). */
  readonly heading: Float64Array;
  /** Speed along the heading, m/s. */
  readonly speed: Float64Array;
  /** Pavement nav graph node it is heading for, −1 = none. */
  readonly targetNode: Int32Array;
  /** Ramp-swap index (outfit) for the renderer. */
  readonly swap: Uint8Array;
  /** NPC_FLAG bits. */
  readonly flags: Uint16Array;
  /** Collision and visibility circle radius, metres (tuning.json → streetLife.npcRadius). */
  readonly radius: Float64Array;
  /** NpcOrigin. */
  readonly origin: Uint8Array;
  /** The spec entry it was spawned from: the named NPC's or flock's index in spawns.npc, else −1. */
  readonly group: Int16Array;
  /** A handle of the NPC it is tied to (walker ↔ dog), or NO_NPC_HANDLE. */
  readonly link: Int32Array;
  /** Perception (perception.ts): distance to Bessie's body centre, metres; −1 before the first query. */
  readonly seenDistM: Float64Array;
  /** Perception: closest distance between the NPC and Bessie's predicted path, metres; −1 before. */
  readonly pathGapM: Float64Array;
  /** Perception: seconds until Bessie reaches that closest point (0..1.5); −1 before. */
  readonly pathEtaS: Float64Array;
  /** Perception: the tick of the last query, −1 before the first. */
  readonly perceivedTick: Int32Array;
  /** Steering (steering.ts, SSP-081): the speed it steers at, m/s (its kind's entities.json speed at spawn). */
  readonly walkMps: Float64Array;
  /** Steering: the nav node its path leads to, −1 = none. */
  readonly goalNode: Int32Array;
  /** Steering: nodes in its path segment (path[i·NPC_PATH_NODES …]) and the cursor; targetNode = path[pathAt]. */
  readonly pathLen: Uint8Array;
  readonly pathAt: Uint8Array;
  /** Steering: every NPC's path segment, NPC_PATH_NODES nav nodes per index. */
  readonly path: Int32Array;
  /** Steering: the crossing nav edge it waits at or is crossing, −1 = none. */
  readonly crossEdge: Int32Array;
  /** Steering: its NavState (steering.ts) and the ticks spent in it. */
  readonly navState: Uint8Array;
  readonly navTicks: Uint32Array;
  /**
   * Reactions (npc/reactions.ts, SSP-082): ticks left in its actor-contact ignore window (0 = a touch starts a
   * new contact episode). Refilled to 90 (1.5 s) on every tick Bessie overlaps it during an episode.
   */
  readonly contactIgnore: Uint8Array;
  /** The planned length of its current state in ticks, set by its behaviour (0 = none; an idle, a startle). */
  readonly stateLimit: Uint16Array;
  /**
   * Two tick counters a kind's behaviour module owns (SSP-083), 0 at spawn; each module documents its use. Doris
   * (behaviours/oldWoman.ts): timerA = slowed-walk ticks left after a fist shake; timerB = the Glare's
   * clear-path ticks, or the Chase's ticks until her handbag can whack again. The litterbug
   * (behaviours/litterbug.ts, SSP-084): timerA = ticks to his next drop; timerB unused.
   */
  readonly timerA: Int32Array;
  readonly timerB: Int32Array;
  /**
   * Behaviours (SSP-086): the tick its kind's next timed action is due, −1 = none yet (the dog walker's dog: its
   * next litter.dog_mess).
   */
  readonly dueTick: Int32Array;
  /**
   * Behaviours (SSP-086): a named NPC's place on its spawns.npc `route`, the index of the route node it walks to
   * next; −1 before it starts the route.
   */
  readonly routeAt: Int16Array;
  /**
   * Puddle splash (npc/splash.ts, SSP-094): the serial of the puddle crossing that last splashed it, 0 = never.
   * A pedestrian is splashed at most once per crossing.
   */
  readonly splashEpisode: Int32Array;
  /**
   * Street-life rules (npc/reactions.ts stepStreetLife, SSP-095): the near-miss pass state (NearMissState) and,
   * while a pass is being tracked, the squared distance from the NPC's centre to Bessie's body box at its closest
   * so far (m²; 0 otherwise); and the ticks in a row it has spent within the dust radius of a live dust cloud
   * since its last cough (0 when out of range).
   */
  readonly nearMiss: Uint8Array;
  readonly nearMissD2: Float64Array;
  readonly dustTicks: Uint16Array;
  /** Handle slot of each live index. */
  readonly handleSlot: Int32Array;
  /** Live index of each handle slot, −1 while the slot is free. */
  readonly slotIndex: Int32Array;
  /** Generation of each handle slot, bumped when its NPC is removed. */
  readonly slotGen: Uint32Array;
  /** Free handle slots, a stack: freeSlots[freeCount − 1] is reused next. */
  readonly freeSlots: Int32Array;
  freeCount: number;
  /** Spatial-hash columns and rows (4 m cells over the level). */
  readonly hashCols: number;
  readonly hashRows: number;
  /** First NPC of each cell's list, or −1. */
  readonly cellHead: Int32Array;
  /** Next / previous NPC in the same cell's list, or −1. */
  readonly cellNext: Int32Array;
  readonly cellPrev: Int32Array;
  /** The cell each NPC is listed in. */
  readonly cellOf: Int32Array;
  /** Position scratch for addNpcAt (cold path). */
  readonly scratchX: Float64Array;
  readonly scratchY: Float64Array;
};

/** What render, audio and UI may see: the same object, typed read-only. */
export type NpcStoreView = {
  readonly capacity: number;
  readonly count: number;
  readonly npcsAdded: number;
  readonly npcsRemoved: number;
  readonly kind: Uint8Array;
  readonly state: Uint8Array;
  readonly stateTicks: Uint32Array;
  readonly x: Float64Array;
  readonly y: Float64Array;
  readonly prevX: Float64Array;
  readonly prevY: Float64Array;
  readonly heading: Float64Array;
  readonly speed: Float64Array;
  readonly targetNode: Int32Array;
  readonly swap: Uint8Array;
  readonly flags: Uint16Array;
  readonly radius: Float64Array;
  readonly origin: Uint8Array;
  readonly group: Int16Array;
  readonly link: Int32Array;
  readonly walkMps: Float64Array;
  readonly goalNode: Int32Array;
  readonly crossEdge: Int32Array;
  readonly navState: Uint8Array;
  readonly contactIgnore: Uint8Array;
  readonly stateLimit: Uint16Array;
  readonly timerA: Int32Array;
  readonly timerB: Int32Array;
  readonly dueTick: Int32Array;
  readonly routeAt: Int16Array;
  readonly splashEpisode: Int32Array;
  readonly nearMiss: Uint8Array;
  readonly nearMissD2: Float64Array;
  readonly dustTicks: Uint16Array;
  readonly handleSlot: Int32Array;
  readonly slotIndex: Int32Array;
  readonly slotGen: Uint32Array;
};

/**
 * An empty NPC store for `level` (its size sets the spatial hash). `capacity` defaults to NPC_CAPACITY and
 * may not exceed 2^NPC_HANDLE_SLOT_BITS. Setup only.
 */
export function createNpcStore(level: Level, capacity: number = NPC_CAPACITY): NpcStore {
  if (!(Number.isInteger(capacity) && capacity >= 1 && capacity <= 1 << NPC_HANDLE_SLOT_BITS)) {
    throw new Error(`createNpcStore: capacity must be 1..${1 << NPC_HANDLE_SLOT_BITS}, got ${capacity}`);
  }
  const hashCols = Math.max(1, Math.ceil((level.size[0] * TILE_M) / NPC_HASH_CELL_M));
  const hashRows = Math.max(1, Math.ceil((level.size[1] * TILE_M) / NPC_HASH_CELL_M));
  const freeSlots = new Int32Array(capacity);
  // Popped from the top: slot 0 first.
  for (let s = 0; s < capacity; s += 1) freeSlots[s] = capacity - 1 - s;
  return {
    capacity,
    count: 0,
    npcsAdded: 0,
    npcsRemoved: 0,
    kind: new Uint8Array(capacity),
    state: new Uint8Array(capacity),
    stateTicks: new Uint32Array(capacity),
    x: new Float64Array(capacity),
    y: new Float64Array(capacity),
    prevX: new Float64Array(capacity),
    prevY: new Float64Array(capacity),
    heading: new Float64Array(capacity),
    speed: new Float64Array(capacity),
    targetNode: new Int32Array(capacity).fill(-1),
    swap: new Uint8Array(capacity),
    flags: new Uint16Array(capacity),
    radius: new Float64Array(capacity),
    origin: new Uint8Array(capacity),
    group: new Int16Array(capacity).fill(-1),
    link: new Int32Array(capacity).fill(NO_NPC_HANDLE),
    seenDistM: new Float64Array(capacity).fill(-1),
    pathGapM: new Float64Array(capacity).fill(-1),
    pathEtaS: new Float64Array(capacity).fill(-1),
    perceivedTick: new Int32Array(capacity).fill(-1),
    walkMps: new Float64Array(capacity),
    goalNode: new Int32Array(capacity).fill(-1),
    pathLen: new Uint8Array(capacity),
    pathAt: new Uint8Array(capacity),
    path: new Int32Array(capacity * NPC_PATH_NODES).fill(-1),
    crossEdge: new Int32Array(capacity).fill(-1),
    navState: new Uint8Array(capacity),
    navTicks: new Uint32Array(capacity),
    contactIgnore: new Uint8Array(capacity),
    stateLimit: new Uint16Array(capacity),
    timerA: new Int32Array(capacity),
    timerB: new Int32Array(capacity),
    dueTick: new Int32Array(capacity).fill(-1),
    routeAt: new Int16Array(capacity).fill(-1),
    splashEpisode: new Int32Array(capacity),
    nearMiss: new Uint8Array(capacity),
    nearMissD2: new Float64Array(capacity),
    dustTicks: new Uint16Array(capacity),
    handleSlot: new Int32Array(capacity).fill(-1),
    slotIndex: new Int32Array(capacity).fill(-1),
    slotGen: new Uint32Array(capacity),
    freeSlots,
    freeCount: capacity,
    hashCols,
    hashRows,
    cellHead: new Int32Array(hashCols * hashRows).fill(-1),
    cellNext: new Int32Array(capacity).fill(-1),
    cellPrev: new Int32Array(capacity).fill(-1),
    cellOf: new Int32Array(capacity).fill(-1),
    scratchX: new Float64Array(1),
    scratchY: new Float64Array(1),
  };
}

/** The read-only view of `store`. No copy: it is the same object. */
export function viewNpcStore(store: NpcStore): NpcStoreView {
  return store;
}

// ---------------------------------------------------------------------------------------------------------
// Handles
// ---------------------------------------------------------------------------------------------------------

/** The handle of live NPC `i`. */
export function npcHandle(store: NpcStore, i: number): number {
  const slot = store.handleSlot[i] as number;
  return ((store.slotGen[slot] as number) << NPC_HANDLE_SLOT_BITS) | slot;
}

/**
 * The live index `handle` names, or −1 when the NPC it named has been removed (or it is NO_NPC_HANDLE). Takes the
 * read-only view too, so the renderer can follow a link (the dog walker's lead).
 */
export function resolveNpcHandle(store: NpcStoreView, handle: number): number {
  if (handle < 0) return -1;
  const slot = handle & ((1 << NPC_HANDLE_SLOT_BITS) - 1);
  if (slot >= store.capacity) return -1;
  if ((store.slotGen[slot] as number) !== handle >>> NPC_HANDLE_SLOT_BITS) return -1;
  return store.slotIndex[slot] as number;
}

// ---------------------------------------------------------------------------------------------------------
// Spatial hash
// ---------------------------------------------------------------------------------------------------------

function hashCol(store: NpcStore, xM: number): number {
  const c = Math.floor(xM / NPC_HASH_CELL_M);
  if (!(c > 0)) return 0; // also catches NaN
  return c >= store.hashCols ? store.hashCols - 1 : c;
}

function hashRow(store: NpcStore, yM: number): number {
  const r = Math.floor(yM / NPC_HASH_CELL_M);
  if (!(r > 0)) return 0;
  return r >= store.hashRows ? store.hashRows - 1 : r;
}

/** The hash cell NPC `i` belongs in at its current position (positions off the map clamp to an edge cell). */
export function npcCellIndex(store: NpcStore, i: number): number {
  return hashRow(store, store.y[i] as number) * store.hashCols + hashCol(store, store.x[i] as number);
}

function linkCell(store: NpcStore, i: number, cell: number): void {
  const head = store.cellHead[cell] as number;
  store.cellPrev[i] = -1;
  store.cellNext[i] = head;
  if (head >= 0) store.cellPrev[head] = i;
  store.cellHead[cell] = i;
  store.cellOf[i] = cell;
}

function unlinkCell(store: NpcStore, i: number): void {
  const p = store.cellPrev[i] as number;
  const n = store.cellNext[i] as number;
  if (p >= 0) store.cellNext[p] = n;
  else store.cellHead[store.cellOf[i] as number] = n;
  if (n >= 0) store.cellPrev[n] = p;
  store.cellPrev[i] = -1;
  store.cellNext[i] = -1;
  store.cellOf[i] = -1;
}

/**
 * Re-bucket NPC `i` after its x/y changed. Returns true when it crossed into another cell (it moves to the
 * head of the new cell's list), false when it stayed in its cell (nothing changes).
 */
export function updateNpcCell(store: NpcStore, i: number): boolean {
  const cell = npcCellIndex(store, i);
  if (cell === store.cellOf[i]) return false;
  unlinkCell(store, i);
  linkCell(store, i, cell);
  return true;
}

/**
 * Write into `out` the index of every NPC whose centre lies inside `box` (edges inclusive), visiting only the
 * hash cells the box overlaps, and return how many were written. Deterministic order: cells row-major, then
 * each cell's list. `out` must hold `capacity` entries. An empty or NaN box finds nothing.
 */
export function queryNpcs(store: NpcStore, box: Readonly<Aabb>, out: Int32Array): number {
  const minX = box.minX;
  const minY = box.minY;
  const maxX = box.maxX;
  const maxY = box.maxY;
  if (!(minX <= maxX && minY <= maxY)) return 0;
  const c0 = hashCol(store, minX);
  const c1 = hashCol(store, maxX);
  const r0 = hashRow(store, minY);
  const r1 = hashRow(store, maxY);
  const xs = store.x;
  const ys = store.y;
  let n = 0;
  for (let r = r0; r <= r1; r += 1) {
    for (let c = c0; c <= c1; c += 1) {
      let i = store.cellHead[r * store.hashCols + c] as number;
      while (i >= 0) {
        const x = xs[i] as number;
        const y = ys[i] as number;
        if (x >= minX && x <= maxX && y >= minY && y <= maxY) {
          if (n >= out.length) throw new Error(`queryNpcs: out holds ${out.length} entries, need more`);
          out[n] = i;
          n += 1;
        }
        i = store.cellNext[i] as number;
      }
    }
  }
  return n;
}

// ---------------------------------------------------------------------------------------------------------
// Add and remove
// ---------------------------------------------------------------------------------------------------------

/**
 * Add an NPC of `kind` (NPC_IDS index) and `origin`, spawned from spec entry `group` (−1 for none), at
 * (xs[j], ys[j]), at rest, facing north, in state 0 with no target node, flags, link, perception, path, contact
 * window, state limit, behaviour timer, due tick or route place, near-miss pass or dust timer, and radius and
 * walking speed 0 (the spawner sets the state, radius and speed). Returns its index, or −1 (changing nothing) when
 * the store is full. Takes the position through arrays so no double crosses the call.
 */
export function addNpc(
  store: NpcStore,
  kind: number,
  origin: number,
  group: number,
  xs: Float64Array,
  ys: Float64Array,
  j: number,
): number {
  if (store.count >= store.capacity) return -1;
  const i = store.count;
  store.count = i + 1;
  store.npcsAdded += 1;
  const slot = store.freeSlots[store.freeCount - 1] as number;
  store.freeCount -= 1;
  store.handleSlot[i] = slot;
  store.slotIndex[slot] = i;
  const x = xs[j] as number;
  const y = ys[j] as number;
  store.kind[i] = kind;
  store.state[i] = 0;
  store.stateTicks[i] = 0;
  store.x[i] = x;
  store.y[i] = y;
  store.prevX[i] = x;
  store.prevY[i] = y;
  store.heading[i] = 0;
  store.speed[i] = 0;
  store.targetNode[i] = -1;
  store.swap[i] = 0;
  store.flags[i] = 0;
  store.radius[i] = 0;
  store.origin[i] = origin;
  store.group[i] = group;
  store.link[i] = NO_NPC_HANDLE;
  store.seenDistM[i] = -1;
  store.pathGapM[i] = -1;
  store.pathEtaS[i] = -1;
  store.perceivedTick[i] = -1;
  store.walkMps[i] = 0;
  store.goalNode[i] = -1;
  store.pathLen[i] = 0;
  store.pathAt[i] = 0;
  store.crossEdge[i] = -1;
  store.navState[i] = 0;
  store.navTicks[i] = 0;
  store.contactIgnore[i] = 0;
  store.stateLimit[i] = 0;
  store.timerA[i] = 0;
  store.timerB[i] = 0;
  store.dueTick[i] = -1;
  store.routeAt[i] = -1;
  store.splashEpisode[i] = 0;
  store.nearMiss[i] = 0;
  store.nearMissD2[i] = 0;
  store.dustTicks[i] = 0;
  linkCell(store, i, npcCellIndex(store, i));
  return i;
}

/** addNpc at a position given as numbers. Cold path (tests, tools): its double arguments may box. */
export function addNpcAt(store: NpcStore, kind: number, origin: number, xM: number, yM: number): number {
  store.scratchX[0] = xM;
  store.scratchY[0] = yM;
  return addNpc(store, kind, origin, -1, store.scratchX, store.scratchY, 0);
}

/**
 * Remove NPC `i` by swap-remove: the last live NPC moves into index `i` (keeping its handle, whose slot now
 * points at `i`), and `i`'s handle slot is freed with its generation bumped, so every handle to the removed
 * NPC stops resolving. Links other NPCs hold to it are left as they are (they no longer resolve).
 */
export function removeNpc(store: NpcStore, i: number): void {
  if (!(i >= 0 && i < store.count))
    throw new Error(`removeNpc: index ${i} is not live (count ${store.count})`);
  const slot = store.handleSlot[i] as number;
  store.slotGen[slot] = ((store.slotGen[slot] as number) + 1) & NPC_GEN_MASK;
  store.slotIndex[slot] = -1;
  store.freeSlots[store.freeCount] = slot;
  store.freeCount += 1;
  unlinkCell(store, i);
  const last = store.count - 1;
  if (i !== last) {
    const cell = store.cellOf[last] as number;
    unlinkCell(store, last);
    store.kind[i] = store.kind[last] as number;
    store.state[i] = store.state[last] as number;
    store.stateTicks[i] = store.stateTicks[last] as number;
    store.x[i] = store.x[last] as number;
    store.y[i] = store.y[last] as number;
    store.prevX[i] = store.prevX[last] as number;
    store.prevY[i] = store.prevY[last] as number;
    store.heading[i] = store.heading[last] as number;
    store.speed[i] = store.speed[last] as number;
    store.targetNode[i] = store.targetNode[last] as number;
    store.swap[i] = store.swap[last] as number;
    store.flags[i] = store.flags[last] as number;
    store.radius[i] = store.radius[last] as number;
    store.origin[i] = store.origin[last] as number;
    store.group[i] = store.group[last] as number;
    store.link[i] = store.link[last] as number;
    store.seenDistM[i] = store.seenDistM[last] as number;
    store.pathGapM[i] = store.pathGapM[last] as number;
    store.pathEtaS[i] = store.pathEtaS[last] as number;
    store.perceivedTick[i] = store.perceivedTick[last] as number;
    store.walkMps[i] = store.walkMps[last] as number;
    store.goalNode[i] = store.goalNode[last] as number;
    store.pathLen[i] = store.pathLen[last] as number;
    store.pathAt[i] = store.pathAt[last] as number;
    store.path.copyWithin(i * NPC_PATH_NODES, last * NPC_PATH_NODES, (last + 1) * NPC_PATH_NODES);
    store.crossEdge[i] = store.crossEdge[last] as number;
    store.navState[i] = store.navState[last] as number;
    store.navTicks[i] = store.navTicks[last] as number;
    store.contactIgnore[i] = store.contactIgnore[last] as number;
    store.stateLimit[i] = store.stateLimit[last] as number;
    store.timerA[i] = store.timerA[last] as number;
    store.timerB[i] = store.timerB[last] as number;
    store.dueTick[i] = store.dueTick[last] as number;
    store.routeAt[i] = store.routeAt[last] as number;
    store.splashEpisode[i] = store.splashEpisode[last] as number;
    store.nearMiss[i] = store.nearMiss[last] as number;
    store.nearMissD2[i] = store.nearMissD2[last] as number;
    store.dustTicks[i] = store.dustTicks[last] as number;
    const movedSlot = store.handleSlot[last] as number;
    store.handleSlot[i] = movedSlot;
    store.slotIndex[movedSlot] = i;
    linkCell(store, i, cell);
  }
  store.handleSlot[last] = -1;
  store.count = last;
  store.npcsRemoved += 1;
}

/** Put NPC `i` into behaviour state `state`, restarting its state clock. */
export function setNpcState(store: NpcStore, i: number, state: number): void {
  store.state[i] = state;
  store.stateTicks[i] = 0;
}

/** Copy every live NPC's position into prevX/prevY (start of phase 7, for render interpolation). */
export function beginNpcTick(store: NpcStore): void {
  store.prevX.set(store.x);
  store.prevY.set(store.y);
}
