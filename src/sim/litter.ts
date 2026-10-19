// The LitterField (TECHNICAL_DESIGN §10.2, §7.1; SSP-057): every litter item on the street, as a fixed-capacity
// struct-of-arrays store with an incrementally maintained 4 m spatial hash, kinematic fling arcs, the wind
// drift hook and the shift-start spawner that samples the compiled weight field (LEVEL_DESIGN §9.1).
//
// Store. Item i lives in slot i of every array, 0 <= i < count. Removal is swap-remove with the last live slot,
// so indices are dense and change only on a removal. Sim state is Float64Array (§7.1); prevX/prevY are copied
// from x/y by beginLitterTick at the start of the tick, for render interpolation.
//
// Spatial hash. The level is covered by 4 m cells (one more cell where the map edge is not a multiple of 4 m);
// a position outside the map falls in the nearest edge cell, so every item is always in exactly one cell.
// Each cell holds an intrusive doubly linked list (cellHead / cellNext / cellPrev, Int32Array), so insert,
// unlink and swap-remove are O(1) and nothing allocates. An item re-buckets only when it crosses a cell
// boundary (updateLitterCell); moving inside its cell leaves the lists untouched. Every list order follows from
// the sequence of operations alone (no unordered collection is ever iterated), so queries are deterministic.
//
// Moving items. Code that writes x[i] / y[i] (the brush's bulldozer, M3 bodies) must call updateLitterCell
// afterwards. stepLitter moves items itself:
//   - FLUNG: a kinematic arc from (arcX0, arcY0) to (arcX1, arcY1) over arcDur ticks at constant speed (flat:
//     items stay on the ground plane, §12.5). The item is uncollectable until it lands. On landing, a kind
//     with a `flung` rule (litter.glass_bottle → haz.broken_glass) is handed to `onFlungLand`; the hazard
//     store arrives in M3 (SSP-094), so until a hook is attached the item simply lands as litter.
//   - PINNED: not moved here (the brush pushes bulldozed items itself).
//   - otherwise: x += vx·dt. A drifting item (driftTicks > 0) keeps its velocity until the drift ends; any
//     other velocity is a one-tick push (the brush's sweep-in and suction set it every tick they act) and is
//     cleared after it is applied, so litter never slides on by itself.
//
// Counters. litterSpawned counts every item ever added this shift (initial and dynamic) and litterCollected
// every item the brush collected; together they are Tidy %'s litter share (TECHNICAL_DESIGN §10.3). Render,
// audio and UI read them through LitterFieldView. Every item also carries `spawnTile`, the map tile it was added
// on (−1 off the map), which never changes as it moves: a frontage counts an item by where it spawned, wherever
// it is collected (GDD §9.3, decided in SSP-064). When tidy.ts has attached a ZoneTally (attachLitterZones),
// addLitter and collectLitter bump the spawned / collected counters of the frontage zones holding that tile.
//
// Hot path: stepLitter, beginLitterTick, queryLitter, updateLitterCell, flingLitter, collectLitter and
// removeLitter allocate nothing (§17): no `new`, literals, closures or map/filter. They take objects and small
// integers rather than metre doubles where a call might not be inlined. createLitterField, createLitterKinds
// and spawnInitialLitter run at shift start and may allocate.

import type { Aabb } from './collision/obb.ts';
import { DT_S, SIM_HZ, TILE_M } from './constants.ts';
import type { Vec2 } from './coords.ts';
import { type Entities, type HazardId, LITTER_IDS, type LitterId } from './entities.ts';
import { cos, sin, sqrt } from './fmath.ts';
import { type Level, LITTER_CELL_M, LITTER_CELLS_PER_TILE } from './map.ts';
import { createStream, NEXT_INT_MAX, nextFloat, nextInt, nextRange, nextU32, type Sfc32 } from './rng.ts';
import type { SweepingTuning } from './tuning.ts';
import { tallyLitterCollected, tallyLitterSpawned, type ZoneTally } from './zoneTally.ts';

/** Litter store capacity (TECHNICAL_DESIGN §7.1, §17). */
export const LITTER_CAPACITY = 2000;

/** Edge of one spatial-hash cell in metres (TECHNICAL_DESIGN §10.2). */
export const LITTER_HASH_CELL_M = 4;

/** At most this many items spawn on one tile at shift start (LEVEL_DESIGN §9.1 rule 4). */
export const LITTER_MAX_PER_TILE = 6;

/** Code-generated rotations of every litter sprite: rot 0..3 draws h00, h08, h16, h24 (LEVEL_DESIGN §9.1). */
export const LITTER_ROTATIONS = 4;

/** Per-item flag bits (`flags`, Uint8). Hashed into replays from SSP-065: append, never renumber. */
export const LitterFlag = {
  /** On a fling arc: moved by stepLitter, uncollectable until it lands. */
  Flung: 1,
  /** Inside the suction zone this tick (drives the wobble animation). Set and cleared by the brush. */
  InSuction: 2,
  /** Bulldozed: held ahead of the bumper by the brush at a full hopper; stepLitter leaves it alone. */
  Pinned: 4,
  /**
   * In a brush contact episode that has already had its fling roll (SSP-059): set on the item's first touch of
   * the brush zone, cleared when it leaves the zone (or the brush stops), and by a fling.
   */
  BrushContact: 8,
} as const;
export type LitterFlag = (typeof LitterFlag)[keyof typeof LitterFlag];

/**
 * Called when a flung item of a kind with a `flung` rule lands (litter.glass_bottle → haz.broken_glass). The
 * item is at its landing point. Return true if the hook removed item `index` (removeLitter, which swap-removes
 * it), false if it left it in place. It must not remove any other item. Attached once at shift start (M3,
 * SSP-094); never a closure created per tick.
 */
export type FlungLandHook = (field: LitterField, index: number, hazard: HazardId) => boolean;

/** Per-kind behaviour tables, indexed by `kind` (the LITTER_IDS index). Built once from entities.json. */
export type LitterKinds = {
  /** Drift speed in m/s while a gust drifts the item; 0 for kinds that do not drift. */
  readonly driftSpeedMps: Float64Array;
  /** Drift length in ticks (durationS × 60, rounded); 0 for kinds that do not drift. */
  readonly driftTicks: Int32Array;
  /** The hazard a flung item of this kind becomes where it lands, or null. */
  readonly flungHazard: readonly (HazardId | null)[];
  /** Litter units the item fills the hopper by when collected (entities.json `lu`; the brush reads it). */
  readonly lu: Float64Array;
};

/** A pose that flings litter: Bessie's VehicleState satisfies it (body centre in metres, heading in radians). */
export type FlingSource = { readonly xM: number; readonly yM: number; readonly headingRad: number };

/** The mutable litter store. Create with createLitterField; only the sim writes it. */
export type LitterField = {
  /** Slots in every array (LITTER_CAPACITY in the game). */
  readonly capacity: number;
  /** Live items, 0..capacity; items are slots 0..count−1. */
  count: number;
  /** Items added this shift: shift-start spawn plus dynamic litter (Tidy % denominator). */
  litterSpawned: number;
  /** Items collected by the brush this shift (Tidy % numerator). */
  litterCollected: number;
  /** Position, metres. */
  readonly x: Float64Array;
  readonly y: Float64Array;
  /** Position at the start of the tick (beginLitterTick), for render interpolation. */
  readonly prevX: Float64Array;
  readonly prevY: Float64Array;
  /** Velocity, m/s: a one-tick push, or a drift while driftTicks > 0, or the arc velocity while FLUNG. */
  readonly vx: Float64Array;
  readonly vy: Float64Array;
  /** Index into LITTER_IDS. */
  readonly kind: Uint8Array;
  /** LitterFlag bits. */
  readonly flags: Uint8Array;
  /** Ticks the fling arc has run (integer-valued), 0..arcDur. */
  readonly arcT: Float64Array;
  /** Length of the fling arc in ticks (integer-valued, >= 1). */
  readonly arcDur: Float64Array;
  /** Fling arc start and landing point, metres. */
  readonly arcX0: Float64Array;
  readonly arcY0: Float64Array;
  readonly arcX1: Float64Array;
  readonly arcY1: Float64Array;
  /** Drift ticks remaining; 0 when not drifting. */
  readonly driftTicks: Int32Array;
  /** Sprite rotation 0..3 (h00, h08, h16, h24). */
  readonly rot: Uint8Array;
  /** The map tile (row · tilesW + col) the item was added on, or −1 off the map. Fixed for its life. */
  readonly spawnTile: Int32Array;
  /** Map size in tiles (for spawnTile). */
  readonly tilesW: number;
  readonly tilesH: number;
  /** The frontage zones whose litter counters addLitter and collectLitter bump (tidy.ts, SSP-064), or null. */
  zones: ZoneTally | null;
  /** Spatial-hash columns and rows (4 m cells over the level). */
  readonly hashCols: number;
  readonly hashRows: number;
  /** First item of each cell's list, or −1. */
  readonly cellHead: Int32Array;
  /** Next / previous item in the same cell's list, or −1. */
  readonly cellNext: Int32Array;
  readonly cellPrev: Int32Array;
  /** The cell each item is listed in. */
  readonly cellOf: Int32Array;
  /** Cells visited by the last queryLitter call (for tests and the dev panel). */
  lastQueryCells: number;
  readonly kinds: LitterKinds;
  /** Fling distances and arc length (tuning.json → sweeping.fling). Replace between ticks only. */
  flingTuning: SweepingTuning['fling'];
  /** Flung-landing hook (glass → broken glass, M3). Null until attached. */
  onFlungLand: FlungLandHook | null;
  /** Spawn scratch: the box for the spacing query, and the query output. */
  readonly scratchBox: Aabb;
  readonly scratchHits: Int32Array;
};

/** What render, audio and UI may see: the same object, typed read-only. */
export type LitterFieldView = {
  readonly capacity: number;
  readonly count: number;
  readonly litterSpawned: number;
  readonly litterCollected: number;
  readonly x: Float64Array;
  readonly y: Float64Array;
  readonly prevX: Float64Array;
  readonly prevY: Float64Array;
  readonly vx: Float64Array;
  readonly vy: Float64Array;
  readonly kind: Uint8Array;
  readonly flags: Uint8Array;
  readonly arcT: Float64Array;
  readonly arcDur: Float64Array;
  readonly driftTicks: Int32Array;
  readonly rot: Uint8Array;
  readonly spawnTile: Int32Array;
  readonly hashCols: number;
  readonly hashRows: number;
  readonly cellHead: Int32Array;
  readonly cellNext: Int32Array;
  readonly cellOf: Int32Array;
};

/** The read-only view of `field`. No copy: it is the same object. */
export function viewLitterField(field: LitterField): LitterFieldView {
  return field;
}

// ---------------------------------------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------------------------------------

/** Build the per-kind tables from validated entity data. Setup only. */
export function createLitterKinds(entities: Entities): LitterKinds {
  const n = LITTER_IDS.length;
  const driftSpeedMps = new Float64Array(n);
  const driftTicks = new Int32Array(n);
  const flungHazard: (HazardId | null)[] = [];
  const lu = new Float64Array(n);
  for (let k = 0; k < n; k += 1) {
    const id = LITTER_IDS[k] as LitterId;
    lu[k] = entities.litter[id].lu;
    const rules = entities.litter[id].rules;
    if (rules.drift !== undefined) {
      driftSpeedMps[k] = rules.drift.speedMps;
      driftTicks[k] = Math.max(1, Math.round(rules.drift.durationS * SIM_HZ));
    }
    flungHazard.push(rules.flung === undefined ? null : rules.flung.hazard);
  }
  return { driftSpeedMps, driftTicks, flungHazard, lu };
}

/**
 * An empty litter store for `level` (its size sets the spatial hash), with the fling numbers from
 * `tuning.sweeping.fling` and the kind tables from `entities`. Allocated once per shift (§7.1).
 */
export function createLitterField(
  level: Level,
  tuning: { readonly sweeping: SweepingTuning },
  entities: Entities,
  capacity: number = LITTER_CAPACITY,
): LitterField {
  if (!Number.isInteger(capacity) || capacity < 1) {
    throw new Error(`createLitterField: capacity must be a positive integer, got ${capacity}`);
  }
  const hashCols = Math.max(1, Math.ceil((level.size[0] * TILE_M) / LITTER_HASH_CELL_M));
  const hashRows = Math.max(1, Math.ceil((level.size[1] * TILE_M) / LITTER_HASH_CELL_M));
  const f64 = (): Float64Array => new Float64Array(capacity);
  return {
    capacity,
    count: 0,
    litterSpawned: 0,
    litterCollected: 0,
    x: f64(),
    y: f64(),
    prevX: f64(),
    prevY: f64(),
    vx: f64(),
    vy: f64(),
    kind: new Uint8Array(capacity),
    flags: new Uint8Array(capacity),
    arcT: f64(),
    arcDur: f64(),
    arcX0: f64(),
    arcY0: f64(),
    arcX1: f64(),
    arcY1: f64(),
    driftTicks: new Int32Array(capacity),
    rot: new Uint8Array(capacity),
    spawnTile: new Int32Array(capacity).fill(-1),
    tilesW: level.size[0],
    tilesH: level.size[1],
    zones: null,
    hashCols,
    hashRows,
    cellHead: new Int32Array(hashCols * hashRows).fill(-1),
    cellNext: new Int32Array(capacity).fill(-1),
    cellPrev: new Int32Array(capacity).fill(-1),
    cellOf: new Int32Array(capacity).fill(-1),
    lastQueryCells: 0,
    kinds: createLitterKinds(entities),
    flingTuning: tuning.sweeping.fling,
    onFlungLand: null,
    // Fractional values first so the fields start as doubles (TECHNICAL_DESIGN §17, deprecated maps).
    scratchBox: { minX: 0.5, minY: 0.5, maxX: 0.5, maxY: 0.5 },
    scratchHits: new Int32Array(capacity),
  };
}

/** Empty the store and zero both counters (a new shift on the same field). Not per tick. */
export function clearLitterField(field: LitterField): void {
  field.count = 0;
  field.litterSpawned = 0;
  field.litterCollected = 0;
  field.cellHead.fill(-1);
  field.cellNext.fill(-1);
  field.cellPrev.fill(-1);
  field.cellOf.fill(-1);
  field.spawnTile.fill(-1);
}

/**
 * Attach the frontage zone tally (tidy.ts initTidy, SSP-064): from now on addLitter and collectLitter bump the
 * litterSpawned / litterCollected counters of every zone holding the item's spawnTile. Null detaches. Throws
 * when the map sizes differ.
 */
export function attachLitterZones(field: LitterField, zones: ZoneTally | null): void {
  if (zones !== null && (zones.tilesW !== field.tilesW || zones.tilesH !== field.tilesH)) {
    throw new Error('attachLitterZones: the zone tally does not match the LitterField map size');
  }
  field.zones = zones;
}

// ---------------------------------------------------------------------------------------------------------
// Spatial hash
// ---------------------------------------------------------------------------------------------------------

/** Hash column of a world x (metres), clamped to the grid. */
function hashCol(field: LitterField, xM: number): number {
  const c = Math.floor(xM / LITTER_HASH_CELL_M);
  if (!(c > 0)) return 0; // also catches NaN
  return c >= field.hashCols ? field.hashCols - 1 : c;
}

/** Hash row of a world y (metres), clamped to the grid. */
function hashRow(field: LitterField, yM: number): number {
  const r = Math.floor(yM / LITTER_HASH_CELL_M);
  if (!(r > 0)) return 0;
  return r >= field.hashRows ? field.hashRows - 1 : r;
}

/** The hash cell item `i` belongs in at its current position. */
export function litterCellIndex(field: LitterField, i: number): number {
  return hashRow(field, field.y[i] as number) * field.hashCols + hashCol(field, field.x[i] as number);
}

function linkCell(field: LitterField, i: number, cell: number): void {
  const head = field.cellHead[cell] as number;
  field.cellPrev[i] = -1;
  field.cellNext[i] = head;
  if (head >= 0) field.cellPrev[head] = i;
  field.cellHead[cell] = i;
  field.cellOf[i] = cell;
}

function unlinkCell(field: LitterField, i: number): void {
  const p = field.cellPrev[i] as number;
  const n = field.cellNext[i] as number;
  if (p >= 0) field.cellNext[p] = n;
  else field.cellHead[field.cellOf[i] as number] = n;
  if (n >= 0) field.cellPrev[n] = p;
  field.cellPrev[i] = -1;
  field.cellNext[i] = -1;
}

/**
 * Re-bucket item `i` after its x/y changed: if it is still in the same 4 m cell nothing changes (and false is
 * returned); if it crossed a cell boundary it moves to the head of its new cell's list (true).
 */
export function updateLitterCell(field: LitterField, i: number): boolean {
  const cell = litterCellIndex(field, i);
  if (cell === field.cellOf[i]) return false;
  unlinkCell(field, i);
  linkCell(field, i, cell);
  return true;
}

/**
 * Write into `out` the indices of every item whose position lies inside `box` (edges inclusive), visiting only
 * the hash cells the box overlaps, and return how many were written. The order is deterministic: cells in
 * row-major order, then each cell's list order. `out` must hold at least `field.count` entries (a buffer of
 * `capacity`, made once, always does). An empty or NaN box finds nothing.
 */
export function queryLitter(field: LitterField, box: Readonly<Aabb>, out: Int32Array): number {
  field.lastQueryCells = 0;
  const minX = box.minX;
  const minY = box.minY;
  const maxX = box.maxX;
  const maxY = box.maxY;
  if (!(minX <= maxX && minY <= maxY)) return 0;
  const c0 = hashCol(field, minX);
  const c1 = hashCol(field, maxX);
  const r0 = hashRow(field, minY);
  const r1 = hashRow(field, maxY);
  const xs = field.x;
  const ys = field.y;
  let n = 0;
  for (let r = r0; r <= r1; r += 1) {
    for (let c = c0; c <= c1; c += 1) {
      field.lastQueryCells += 1;
      let i = field.cellHead[r * field.hashCols + c] as number;
      while (i >= 0) {
        const x = xs[i] as number;
        const y = ys[i] as number;
        if (x >= minX && x <= maxX && y >= minY && y <= maxY) {
          if (n >= out.length) throw new Error(`queryLitter: out holds ${out.length} entries, need more`);
          out[n] = i;
          n += 1;
        }
        i = field.cellNext[i] as number;
      }
    }
  }
  return n;
}

/**
 * The world-space AABB of a rectangle given in vehicle-local coordinates (`local`: +x right, +y forward,
 * metres, origin at the body centre) for a sweeper at `pose`: the brush query box (TECHNICAL_DESIGN §10.2).
 * Writes `out` and returns it. Calls sin and cos once each.
 */
export function localRectToWorldAabb(pose: FlingSource, local: Readonly<Aabb>, out: Aabb): Aabb {
  const s = sin(pose.headingRad);
  const c = cos(pose.headingRad);
  // world = pos + right·lx + forward·ly, right = (c, s), forward = (s, −c) (src/sim/coords.ts).
  // x = px + c·lx + s·ly is monotone in lx and ly separately, so its extremes are at the rect's corners.
  const ax = c * local.minX;
  const bx = c * local.maxX;
  const cx = s * local.minY;
  const dx = s * local.maxY;
  const ay = s * local.minX;
  const by = s * local.maxX;
  const cy = -c * local.minY;
  const dy = -c * local.maxY;
  out.minX = pose.xM + (ax < bx ? ax : bx) + (cx < dx ? cx : dx);
  out.maxX = pose.xM + (ax < bx ? bx : ax) + (cx < dx ? dx : cx);
  out.minY = pose.yM + (ay < by ? ay : by) + (cy < dy ? cy : dy);
  out.maxY = pose.yM + (ay < by ? by : ay) + (cy < dy ? dy : cy);
  return out;
}

// ---------------------------------------------------------------------------------------------------------
// Add and remove
// ---------------------------------------------------------------------------------------------------------

/**
 * Add an item of `kind` (LITTER_IDS index) at (xM, yM) with sprite rotation `rot` (0..3), at rest. Counts
 * toward litterSpawned. Returns its index, or −1 (and changes nothing) when the store is full: the live total
 * is capped at the capacity (LEVEL_DESIGN §9.1 rule 7). Shift-start spawning and dynamic litter (NPC drops,
 * bursts, spills) both use it.
 */
export function addLitter(field: LitterField, kind: number, xM: number, yM: number, rot: number): number {
  if (!(kind >= 0 && kind < LITTER_IDS.length && (kind | 0) === kind)) {
    throw new Error(`addLitter: kind must be a LITTER_IDS index, got ${kind}`);
  }
  if (!(rot >= 0 && rot < LITTER_ROTATIONS && (rot | 0) === rot)) {
    throw new Error(`addLitter: rot must be 0..3, got ${rot}`);
  }
  if (!(Number.isFinite(xM) && Number.isFinite(yM))) {
    throw new Error(`addLitter: position must be finite, got (${xM}, ${yM})`);
  }
  if (field.count >= field.capacity) return -1;
  const i = field.count;
  field.count = i + 1;
  field.x[i] = xM;
  field.y[i] = yM;
  field.prevX[i] = xM;
  field.prevY[i] = yM;
  field.vx[i] = 0;
  field.vy[i] = 0;
  field.kind[i] = kind;
  field.flags[i] = 0;
  field.arcT[i] = 0;
  field.arcDur[i] = 0;
  field.arcX0[i] = xM;
  field.arcY0[i] = yM;
  field.arcX1[i] = xM;
  field.arcY1[i] = yM;
  field.driftTicks[i] = 0;
  field.rot[i] = rot;
  const col = Math.floor(xM / TILE_M);
  const row = Math.floor(yM / TILE_M);
  const tile =
    col >= 0 && row >= 0 && col < field.tilesW && row < field.tilesH ? row * field.tilesW + col : -1;
  field.spawnTile[i] = tile;
  linkCell(field, i, litterCellIndex(field, i));
  field.litterSpawned += 1;
  if (field.zones !== null) tallyLitterSpawned(field.zones, tile);
  return i;
}

/** Copy every per-item field of slot `from` into slot `to` (not the hash links). */
function copySlot(field: LitterField, from: number, to: number): void {
  field.x[to] = field.x[from] as number;
  field.y[to] = field.y[from] as number;
  field.prevX[to] = field.prevX[from] as number;
  field.prevY[to] = field.prevY[from] as number;
  field.vx[to] = field.vx[from] as number;
  field.vy[to] = field.vy[from] as number;
  field.kind[to] = field.kind[from] as number;
  field.flags[to] = field.flags[from] as number;
  field.arcT[to] = field.arcT[from] as number;
  field.arcDur[to] = field.arcDur[from] as number;
  field.arcX0[to] = field.arcX0[from] as number;
  field.arcY0[to] = field.arcY0[from] as number;
  field.arcX1[to] = field.arcX1[from] as number;
  field.arcY1[to] = field.arcY1[from] as number;
  field.driftTicks[to] = field.driftTicks[from] as number;
  field.rot[to] = field.rot[from] as number;
  field.spawnTile[to] = field.spawnTile[from] as number;
}

/**
 * Remove item `i` without touching the counters (a seagull or Spotless Sid taking it is M6's rule; a flung
 * glass bottle turning into a hazard is M3's). Swap-remove: the last live item moves into slot `i` and takes
 * over its predecessor's place in its cell list, so the hash stays consistent and its order is kept.
 */
export function removeLitter(field: LitterField, i: number): void {
  const last = field.count - 1;
  if (!(i >= 0 && i <= last))
    throw new Error(`removeLitter: index ${i} is not a live item (count ${field.count})`);
  unlinkCell(field, i);
  if (i !== last) {
    copySlot(field, last, i);
    const cell = field.cellOf[last] as number;
    const p = field.cellPrev[last] as number;
    const n = field.cellNext[last] as number;
    field.cellPrev[i] = p;
    field.cellNext[i] = n;
    field.cellOf[i] = cell;
    if (p >= 0) field.cellNext[p] = i;
    else field.cellHead[cell] = i;
    if (n >= 0) field.cellPrev[n] = i;
  }
  field.cellPrev[last] = -1;
  field.cellNext[last] = -1;
  field.cellOf[last] = -1;
  field.spawnTile[last] = -1;
  field.count = last;
}

/** True when item `i` can be collected: it is not in the air on a fling arc. */
export function isLitterCollectable(field: LitterField, i: number): boolean {
  return ((field.flags[i] as number) & LitterFlag.Flung) === 0;
}

/**
 * Collect item `i` (the brush inlet, SSP-059): count it in litterCollected and swap-remove it. A flung item is
 * uncollectable until it lands: then nothing changes and false is returned.
 */
export function collectLitter(field: LitterField, i: number): boolean {
  if (!isLitterCollectable(field, i)) return false;
  const tile = field.spawnTile[i] as number;
  removeLitter(field, i);
  field.litterCollected += 1;
  if (field.zones !== null) tallyLitterCollected(field.zones, tile);
  return true;
}

// ---------------------------------------------------------------------------------------------------------
// Fling and drift
// ---------------------------------------------------------------------------------------------------------

/**
 * Fling item `i` away from the sweeper at `source` (TECHNICAL_DESIGN §10.2): a kinematic arc sideways, to the
 * sweeper's right when the item's vehicle-local x is >= 0 and to its left when it is negative, over a distance
 * drawn from `rng` (the brush stream, one draw) in [minDistanceM, maxDistanceM), lasting arcDurationS rounded to
 * whole ticks. The item is FLUNG (uncollectable) until stepLitter lands it; IN_SUCTION, PINNED, BRUSH_CONTACT
 * (the fling ends the brush contact episode) and any drift are cleared. An item already in the air is left
 * alone and false is returned (no draw is made).
 */
export function flingLitter(field: LitterField, i: number, source: FlingSource, rng: Sfc32): boolean {
  const flags = field.flags[i] as number;
  if ((flags & LitterFlag.Flung) !== 0) return false;
  const tuning = field.flingTuning;
  const c = cos(source.headingRad);
  const s = sin(source.headingRad);
  const x = field.x[i] as number;
  const y = field.y[i] as number;
  const localX = (x - source.xM) * c + (y - source.yM) * s;
  const side = localX < 0 ? -1 : 1;
  const distanceM = nextRange(rng, tuning.minDistanceM, tuning.maxDistanceM);
  const ticks = Math.max(1, Math.round(tuning.arcDurationS * SIM_HZ));
  const dx = c * side * distanceM;
  const dy = s * side * distanceM;
  field.arcX0[i] = x;
  field.arcY0[i] = y;
  field.arcX1[i] = x + dx;
  field.arcY1[i] = y + dy;
  field.arcT[i] = 0;
  field.arcDur[i] = ticks;
  field.vx[i] = dx / (ticks * DT_S);
  field.vy[i] = dy / (ticks * DT_S);
  field.driftTicks[i] = 0;
  field.flags[i] = LitterFlag.Flung;
  return true;
}

/**
 * The wind drift hook (TECHNICAL_DESIGN §10.2; caller: haz.wind_gust, M6): every item whose kind drifts
 * (entities.json → rules.drift: litter.newspaper and litter.crisp_packet at 1.5 m/s for 4 s) and that is not
 * flung or pinned moves along `dir` (normalised here) at its kind's speed for its kind's duration, starting
 * on the next stepLitter. A zero `dir` does nothing. Returns how many items started drifting.
 */
export function startLitterDrift(field: LitterField, dir: Readonly<Vec2>): number {
  const len = sqrt(dir.x * dir.x + dir.y * dir.y);
  if (!(len > 0)) return 0;
  const ux = dir.x / len;
  const uy = dir.y / len;
  const kinds = field.kinds;
  let started = 0;
  for (let i = 0; i < field.count; i += 1) {
    const k = field.kind[i] as number;
    const ticks = kinds.driftTicks[k] as number;
    if (ticks === 0) continue;
    if (((field.flags[i] as number) & (LitterFlag.Flung | LitterFlag.Pinned)) !== 0) continue;
    const speed = kinds.driftSpeedMps[k] as number;
    field.vx[i] = ux * speed;
    field.vy[i] = uy * speed;
    field.driftTicks[i] = ticks;
    started += 1;
  }
  return started;
}

// ---------------------------------------------------------------------------------------------------------
// Per tick
// ---------------------------------------------------------------------------------------------------------

/**
 * Copy x/y into prevX/prevY (render interpolation). Call at the start of the tick, before anything moves
 * litter. Copies whole arrays with TypedArray.set (no subarray views, so nothing allocates).
 */
export function beginLitterTick(field: LitterField): void {
  field.prevX.set(field.x);
  field.prevY.set(field.y);
}

/**
 * Advance every item one tick, in index order: fling arcs (landing at the end of their last tick, with the
 * `flung` hook), drift and one-tick pushes (see the header). Re-buckets items that cross a cell boundary.
 */
export function stepLitter(field: LitterField): void {
  const xs = field.x;
  const ys = field.y;
  const vxs = field.vx;
  const vys = field.vy;
  let i = 0;
  while (i < field.count) {
    const flags = field.flags[i] as number;
    if ((flags & LitterFlag.Flung) !== 0) {
      const t = (field.arcT[i] as number) + 1;
      const dur = field.arcDur[i] as number;
      if (t >= dur) {
        field.arcT[i] = dur;
        xs[i] = field.arcX1[i] as number;
        ys[i] = field.arcY1[i] as number;
        vxs[i] = 0;
        vys[i] = 0;
        field.flags[i] = flags & ~LitterFlag.Flung;
        updateLitterCell(field, i);
        const hazard = field.kinds.flungHazard[field.kind[i] as number] ?? null;
        const hook = field.onFlungLand;
        // When the hook removed item i, slot i now holds the next unstepped item: step it without advancing.
        if (hazard !== null && hook?.(field, i, hazard) === true) continue;
      } else {
        field.arcT[i] = t;
        const u = t / dur;
        const x0 = field.arcX0[i] as number;
        const y0 = field.arcY0[i] as number;
        xs[i] = x0 + ((field.arcX1[i] as number) - x0) * u;
        ys[i] = y0 + ((field.arcY1[i] as number) - y0) * u;
        updateLitterCell(field, i);
      }
    } else if ((flags & LitterFlag.Pinned) === 0) {
      const vx = vxs[i] as number;
      const vy = vys[i] as number;
      if (vx !== 0 || vy !== 0) {
        xs[i] = (xs[i] as number) + vx * DT_S;
        ys[i] = (ys[i] as number) + vy * DT_S;
        updateLitterCell(field, i);
        const drift = field.driftTicks[i] as number;
        if (drift > 1) {
          field.driftTicks[i] = drift - 1;
        } else {
          field.driftTicks[i] = 0;
          vxs[i] = 0;
          vys[i] = 0;
        }
      }
    }
    i += 1;
  }
}

// ---------------------------------------------------------------------------------------------------------
// Shift-start spawn (LEVEL_DESIGN §9.1 rules 4–6)
// ---------------------------------------------------------------------------------------------------------

/** 2^26 and 2^53, for the 53-bit uniform draw. */
const TWO_26 = 67108864;
const TWO_53 = 9007199254740992;

/** A uniform double in [0, 1) with 53 random bits, from two uint32 draws (high 27 bits, then 26). */
function nextFloat53(rng: Sfc32): number {
  const hi = nextU32(rng) >>> 5;
  const lo = nextU32(rng) >>> 6;
  return (hi * TWO_26 + lo) / TWO_53;
}

/** Add `delta` to entry `index` (0-based) of the Fenwick tree `tree` (1-based, length n + 1). */
function fenwickAdd(tree: Float64Array, index: number, delta: number): void {
  const n = tree.length - 1;
  for (let j = index + 1; j <= n; j += j & -j) tree[j] = (tree[j] as number) + delta;
}

/** The 0-based index whose cumulative weight range contains `target` (0 <= target < total). */
function fenwickFind(tree: Float64Array, highBit: number, target: number): number {
  const n = tree.length - 1;
  let pos = 0;
  let rem = target;
  for (let step = highBit; step > 0; step >>>= 1) {
    const next = pos + step;
    if (next <= n && (tree[next] as number) <= rem) {
      pos = next;
      rem -= tree[next] as number;
    }
  }
  return pos;
}

/** True when an item already in the store lies closer than `spacingM` to (xM, yM). */
function tooClose(field: LitterField, xM: number, yM: number, spacingM: number): boolean {
  const box = field.scratchBox;
  box.minX = xM - spacingM;
  box.minY = yM - spacingM;
  box.maxX = xM + spacingM;
  box.maxY = yM + spacingM;
  const hits = field.scratchHits;
  const n = queryLitter(field, box, hits);
  const limit = spacingM * spacingM;
  for (let h = 0; h < n; h += 1) {
    const j = hits[h] as number;
    const dx = (field.x[j] as number) - xM;
    const dy = (field.y[j] as number) - yM;
    if (dx * dx + dy * dy < limit) return true;
  }
  return false;
}

/**
 * Shift start (LEVEL_DESIGN §9.1, SSP-057): empty the store, then place `level.litter.initial` items by
 * weighted sampling without replacement over the compiled 0.5 m sub-cell weights, on the `litter` stream
 * `sfc32(seed ^ hash32('litter'))`. Returns the number placed (litterSpawned). A level with no litter spec
 * places nothing.
 *
 * Each attempt, in this order of draws:
 *   1. a sub-cell, with probability proportional to its weight among the sub-cells still in play: a 53-bit
 *      uniform (two u32) scaled to the integer total weight, located by a Fenwick tree over the weights in
 *      row-major sub-cell order. The sub-cell leaves play whatever happens next (without replacement);
 *   2. the position inside it: x then y jitter, one u32 each, in [0, 0.5) m;
 *   3. if no item lies closer than `minSpacingM`, the type: one nextInt over the summed `litter.table` weights
 *      of the entries whose `requires` bits the sub-cell's `places` bits all include (leaf piles near trees,
 *      bin bags near kerbs, dog mess on pavements; rule 5), then the rotation: nextInt(4) (rule 6).
 * A rejected attempt (too close) draws no type or rotation. When a tile reaches LITTER_MAX_PER_TILE (6)
 * items, the rest of its sub-cells leave play. Sampling stops when `initial` items are placed or no weight is
 * left (an over-full level then gets fewer; compile-level.ts keeps `initial` far below the capacity).
 */
export function spawnInitialLitter(field: LitterField, level: Level, seed: number): number {
  clearLitterField(field);
  const spec = level.litter;
  if (spec === null) return 0;
  const w = level.size[0];
  const cellsW = w * LITTER_CELLS_PER_TILE;
  const n = spec.weights.length;
  const target = Math.min(spec.initial, field.capacity);

  // Type table, as LITTER_IDS indices.
  const tableN = spec.table.length;
  const tableKind = new Uint8Array(tableN);
  const tableWeight = new Float64Array(tableN);
  const tableRequires = new Uint8Array(tableN);
  for (let t = 0; t < tableN; t += 1) {
    const entry = spec.table[t];
    if (entry === undefined) continue;
    const kind = (LITTER_IDS as readonly string[]).indexOf(entry.id);
    if (kind < 0) throw new Error(`spawnInitialLitter: litter.table id ${entry.id} is not a litter id`);
    tableKind[t] = kind;
    tableWeight[t] = entry.weight;
    tableRequires[t] = entry.requires;
  }

  // Fenwick tree over the sub-cell weights (integers: every sum is exact in a double).
  const weight = new Float64Array(n);
  const tree = new Float64Array(n + 1);
  let total = 0;
  for (let k = 0; k < n; k += 1) {
    const v = spec.weights[k] as number;
    weight[k] = v;
    total += v;
    tree[k + 1] = (tree[k + 1] as number) + v;
    const parent = k + 1 + ((k + 1) & -(k + 1));
    if (parent <= n) tree[parent] = (tree[parent] as number) + (tree[k + 1] as number);
  }
  let highBit = 1;
  while (highBit * 2 <= n) highBit *= 2;

  const perTile = new Uint8Array(level.size[0] * level.size[1]);
  const rng = createStream(seed, 'litter');
  const spacingM = spec.minSpacingM;

  const take = (k: number): void => {
    const v = weight[k] as number;
    if (v === 0) return;
    weight[k] = 0;
    total -= v;
    fenwickAdd(tree, k, -v);
  };

  let placed = 0;
  while (placed < target && total > 0) {
    let r = Math.floor(nextFloat53(rng) * total);
    if (r >= total) r = total - 1;
    const k = fenwickFind(tree, highBit, r);
    take(k);
    const cx = k % cellsW;
    const cy = (k - cx) / cellsW;
    const xM = (cx + nextFloat(rng)) * LITTER_CELL_M;
    const yM = (cy + nextFloat(rng)) * LITTER_CELL_M;
    const tx = Math.floor(cx / LITTER_CELLS_PER_TILE);
    const ty = Math.floor(cy / LITTER_CELLS_PER_TILE);
    const tile = ty * w + tx;
    if ((perTile[tile] as number) >= LITTER_MAX_PER_TILE) continue;
    if (tooClose(field, xM, yM, spacingM)) continue;

    const places = spec.places[k] as number;
    let sum = 0;
    for (let t = 0; t < tableN; t += 1) {
      const req = tableRequires[t] as number;
      if ((places & req) === req) sum += tableWeight[t] as number;
    }
    if (sum === 0) continue;
    if (sum > NEXT_INT_MAX)
      throw new Error(`spawnInitialLitter: litter.table weights sum to ${sum}, too large`);
    let pick = nextInt(rng, sum);
    let kind = -1;
    for (let t = 0; t < tableN; t += 1) {
      const req = tableRequires[t] as number;
      if ((places & req) !== req) continue;
      const tw = tableWeight[t] as number;
      if (pick < tw) {
        kind = tableKind[t] as number;
        break;
      }
      pick -= tw;
    }
    const rot = nextInt(rng, LITTER_ROTATIONS);
    if (addLitter(field, kind, xM, yM, rot) < 0) break;
    placed += 1;

    const count = (perTile[tile] as number) + 1;
    perTile[tile] = count;
    if (count >= LITTER_MAX_PER_TILE) {
      for (let sy = 0; sy < LITTER_CELLS_PER_TILE; sy += 1) {
        for (let sx = 0; sx < LITTER_CELLS_PER_TILE; sx += 1) {
          take((ty * LITTER_CELLS_PER_TILE + sy) * cellsW + tx * LITTER_CELLS_PER_TILE + sx);
        }
      }
    }
  }
  return placed;
}
