// The hazard store (ENTITY_CATALOG §10, TECHNICAL_DESIGN §7.1 and §8.2 steps 7 and 10, LEVEL_DESIGN §9.3;
// SSP-093): every `haz.*` ground effect on the street, as a fixed-capacity struct-of-arrays store, the
// shift-start spawner, the per-tile grip override that surface.ts reads, the jolts and the hard stop Bessie
// gets for driving into one, and the leaf-pile brush-up hook that leaves wet leaves behind.
//
// Store. Hazard i lives in slot i of every array, 0 <= i < count (capacity 64, §7.1); removal is swap-remove.
// Every hazard covers a rectangle of whole 2 m tiles, its footprint (`col0`/`row0` inclusive, `col1`/`row1`
// exclusive): one tile (the 32 × 32 px ground decal, ENTITY_CATALOG §10: "exact shape unspecified, use the
// tile") for everything level.json places or the spawner draws, and the site rectangle for a map-placed speed
// bump (`=` compiles to `haz.speed_bump` sites, LEVEL_DESIGN §7.8, §10.2). Two per-tile layers are kept in
// step with the store: `tileHazard` (the first hazard in store order covering the tile, or −1) and
// `surfaceOverride` (the Surface id a grip hazard switches the tile to, or NO_SURFACE).
//
// Grip (TECHNICAL_DESIGN §8.2 step 7). surface.ts's sampleSurface reads `surfaceOverride` before the tile's
// compiled surface, per wheel: haz.puddle → Surface.Puddle (lateralGripPerS.wet, 4.0), haz.oil_slick →
// Surface.Oil (1.2), haz.wet_leaves → Surface.WetLeaves (3.0). The grip numbers stay in tuning.json, read
// through the World's surface table, so upg.tyres (×1.15, M6) reaches hazards through the same tuning modifier
// that scales asphalt.
//
// Contacts (TECHNICAL_DESIGN §8.2 step 10). Bessie is "on" a hazard while the rectangle spanned by her four
// wheel contact points (±wheelTrackM / 2 across, rearAxleOffsetM..frontAxleOffsetM along; tuning body block)
// overlaps its footprint with positive area. A crossing episode runs from the first tick she is on it to the
// first tick she is not (HazardFlag.Contact), so a hazard acts once per episode however long she sits on it,
// and the rear wheels following the front ones through a pothole are the same episode. Effects on the tick an
// episode starts, judged at the pose and speed stepVehicle and the kerb step left (phase 2):
//   - jolt (haz.pothole, haz.speed_bump): only when |vLong| > the kind's minSpeedMps (speed bump 6.0 m/s; a
//     pothole has none and always jolts). HP −hpLoss (pothole 2, speed bump 0), never below 0; then spillLu
//     litter units leave the hopper as small litter items behind her (below); then EV.HazardJolt.
//   - hard stop (haz.open_manhole): HP −hpLoss (10), never below 0; vLong = vLat = 0; EV.HazardStop.
//   - grip and drain hazards do nothing on entry (broken glass's HP drain is SSP-094).
// Hazards are visited in store order, so two episodes starting on one tick resolve deterministically.
//
// LU spills (ENTITY_CATALOG §10). A spill of S LU takes min(S, hopperLU) out of the hopper as whole small
// litter items, added to the LitterField through addLitter (so they count toward litterSpawned, Tidy %'s
// denominator). The items come from the district's small-litter table: the level's `litter.table` entries
// whose kind is at most SPILL_MAX_ITEM_LU and has no brush-up rule (no banana skins or dog mess out of the
// hopper), by their weights; a level without one spills litter.crisp_packet. Each item draws, on the World's
// `events` stream (LEVEL_DESIGN §9.1 rule 7: dynamic litter uses the events stream): its kind (nextInt over the
// weights; a kind too big for the LU still to spill is replaced by the biggest table kind that fits), how far
// behind the rear bumper it lands (SPILL_GAP_M + [0, SPILL_DEPTH_M)), its offset across (±SPILL_HALF_WIDTH_M)
// and its rotation (nextInt(4)). It stops when what is left is smaller than every table kind or the
// LitterField is full; exactly the LU of the items added leaves the hopper (spillFromHopper), so LU is
// conserved and hopperLU never goes below 0. With the 0.5 and 1 LU small items, a 2 or 3 LU spill from a
// hopper holding at least that much moves exactly 2 or 3 LU.
//
// Wet leaves (ENTITY_CATALOG §4.2). stepBrushUpLeaves (phase 5): while the brush is Raised, a litter item whose
// kind has a `brushUp: { effect: 'hazard' }` rule (litter.leaf_pile → haz.wet_leaves) and whose centre is inside
// Bessie's body OBB is driven through: it is removed (removeLitter, so it stays in litterSpawned and can never
// be collected, like a splatted dog mess) and the rule's hazard is added on the pile's tile, unless a hazard
// already covers that tile or the store is full (the pile is still removed).
//
// Oil (LEVEL_DESIGN §9.3). Every haz.oil_slick the spawner places gets the stain whose rules name it as
// `pairedHazard` (stain.oil) at its tile centre, when a stain store is given, so spraying the slick scores the
// stain's +30 once. The slick itself stays (SSP-093's reading; owner to review at the M6 Wednesday playtest).
//
// Hot path: stepHazardContacts, stepBrushUpLeaves, addHazard and hazardSurfaceAtTile allocate nothing except
// the boxed doubles addLitter's arguments may cost on the rare tick a spill happens. Setup (createHazardStore,
// spawnHazards) may allocate.

import { BrushState, type BrushView } from './brush.ts';
import { TILE_M } from './constants.ts';
import {
  type Entities,
  HAZARD_ENTITY_IDS,
  type HazardEntityId,
  type HazardGripSurface,
  LITTER_IDS,
  type LitterId,
  STAIN_IDS,
  type StainId,
} from './entities.ts';
import { EV, type EventQueue, emitEvent } from './eventQueue.ts';
import { cos, sin } from './fmath.ts';
import { type Hopper, spillFromHopper } from './hopper.ts';
import {
  addLitter,
  LITTER_CAPACITY,
  LITTER_ROTATIONS,
  type LitterField,
  LitterFlag,
  localRectToWorldAabb,
  queryLitter,
  removeLitter,
} from './litter.ts';
import { hazardRuleBit, type Level, Surface } from './map.ts';
import { createStream, nextFloat, nextInt, type Sfc32 } from './rng.ts';
import { addStain, type StainStore } from './stains.ts';
import { NO_SURFACE } from './surface.ts';
import type { SweeperTuning } from './tuning.ts';
import type { VehicleState } from './vehicle.ts';

/** Hazard store capacity (TECHNICAL_DESIGN §7.1). */
export const HAZARD_CAPACITY = 64;

/** Per-hazard flag bits (`flags`, Uint8). Hashed into replays: append, never renumber. */
export const HazardFlag = {
  /** Bessie's wheel rectangle overlaps the footprint: a crossing episode is running. */
  Contact: 1,
} as const;
export type HazardFlag = (typeof HazardFlag)[keyof typeof HazardFlag];

/** What a hazard does (entities.json `effect`), as a small integer. */
export const HazardEffectCode = { Grip: 0, Jolt: 1, Drain: 2, HardStop: 3 } as const;
export type HazardEffectCode = (typeof HazardEffectCode)[keyof typeof HazardEffectCode];

/** Small litter: a spilled item is at most this many LU (crisp packets, cans, butts…; not bin bags). */
export const SPILL_MAX_ITEM_LU = 1;
/** Spilled items land at least this far behind the rear bumper, metres. */
export const SPILL_GAP_M = 0.3;
/** …and up to this much further back, metres. */
export const SPILL_DEPTH_M = 1.0;
/** …within this distance either side of Bessie's centre line, metres (about half her wheel track). */
export const SPILL_HALF_WIDTH_M = 0.8;
/** The small-litter table of a level that has none of its own. */
export const SPILL_FALLBACK_LITTER: LitterId = 'litter.crisp_packet';

/** The grip surface key (entities.json `surface`) → the Surface id the tile switches to. */
const GRIP_SURFACE: { readonly [K in HazardGripSurface]: Surface } = {
  wet: Surface.Puddle,
  oil: Surface.Oil,
  wetLeaves: Surface.WetLeaves,
};

const EFFECT_CODE = {
  grip: HazardEffectCode.Grip,
  jolt: HazardEffectCode.Jolt,
  drain: HazardEffectCode.Drain,
  hardStop: HazardEffectCode.HardStop,
} as const;

/** Per-kind tables, indexed by `kind` (the HAZARD_ENTITY_IDS index). Built once from entities.json. */
export type HazardKinds = {
  /** HazardEffectCode of each kind. */
  readonly effect: Uint8Array;
  /** The Surface a grip hazard switches its tiles to, or NO_SURFACE. */
  readonly surface: Uint8Array;
  /** HP lost on entering (rules.hpLoss), 0 when the kind has none. */
  readonly hpLoss: Float64Array;
  /** LU spilled by a jolt (rules.spillLu), 0 when the kind has none. */
  readonly spillLu: Float64Array;
  /** A jolt acts only above this |vLong| (rules.minSpeedMps); −1 when it always acts. */
  readonly minSpeedMps: Float64Array;
  /** The stain placed with the hazard (the stain whose rules.pairedHazard names it), or −1. */
  readonly pairedStain: Int16Array;
  /** By LITTER_IDS index: the hazard kind a brush-up rule turns the item into, or −1. */
  readonly brushUpHazard: Int16Array;
  /** By LITTER_IDS index: the item's LU (entities.json `lu`). */
  readonly litterLu: Float64Array;
  /** By LITTER_IDS index: 1 when the kind has any brush-up rule (spin-out, stain or hazard), else 0. */
  readonly litterBrushUp: Uint8Array;
};

/** The small-litter table spills draw from (built at shift start from the level's litter table). */
export type SpillTable = {
  count: number;
  /** LITTER_IDS index per entry. */
  readonly kind: Uint8Array;
  /** Integer weight per entry. */
  readonly weight: Float64Array;
  /** LU per entry. */
  readonly lu: Float64Array;
  /** Sum of the weights. */
  total: number;
  /** The smallest entry LU (a spill stops when less than this is left to spill). */
  minLu: number;
};

/** The mutable hazard store. Create with createHazardStore; only the sim writes it. */
export type HazardStore = {
  /** Slots in every array (HAZARD_CAPACITY in the game). */
  readonly capacity: number;
  /** Live hazards, 0..capacity; hazards are slots 0..count−1. */
  count: number;
  /** Hazards added this shift (spawned and created, e.g. wet leaves). */
  hazardsSpawned: number;
  /** Index into HAZARD_ENTITY_IDS. */
  readonly kind: Uint8Array;
  /** Footprint in tiles: columns col0..col1−1, rows row0..row1−1. */
  readonly col0: Int32Array;
  readonly row0: Int32Array;
  readonly col1: Int32Array;
  readonly row1: Int32Array;
  /** Footprint centre, metres (for render and events). */
  readonly x: Float64Array;
  readonly y: Float64Array;
  /** HazardFlag bits. */
  readonly flags: Uint8Array;
  /** Level size in tiles. */
  readonly w: number;
  readonly h: number;
  /** Per tile (row-major): the first hazard in store order whose footprint covers it, or −1. */
  readonly tileHazard: Int16Array;
  /** Per tile: the Surface a grip hazard switches it to, or NO_SURFACE. */
  readonly surfaceOverride: Uint8Array;
  readonly kinds: HazardKinds;
  /** The small-litter table spills draw from. */
  readonly spill: SpillTable;
  /** The stream spills draw on: the World's `events` stream (LEVEL_DESIGN §9.1 rule 7). */
  readonly rng: Sfc32;
  /** LU the last spill moved out of the hopper (written by spillHopperLitter). */
  lastSpillLu: number;
  /** Contact scratch: Bessie's wheel rectangle (centre, axes, half extents) and its AABB. */
  readonly quad: WheelQuad;
  /** Brush-up scratch: Bessie's body in vehicle-local and world space, and the litter hit list. */
  readonly bodyBox: { minX: number; minY: number; maxX: number; maxY: number };
  readonly worldBox: { minX: number; minY: number; maxX: number; maxY: number };
  readonly hits: Int32Array;
  /** The sweeper tuning `bodyBox` was built from (null before the first brush-up step). */
  bodyBoxFor: SweeperTuning | null;
  /** cos and sin of Bessie's heading at the last brush-up step (writeBodyAxes). */
  axisC: number;
  axisS: number;
};

/** What render, audio and UI may see: the same object, typed read-only. */
export type HazardStoreView = {
  readonly capacity: number;
  readonly w: number;
  readonly h: number;
  readonly count: number;
  readonly hazardsSpawned: number;
  readonly kind: Uint8Array;
  readonly col0: Int32Array;
  readonly row0: Int32Array;
  readonly col1: Int32Array;
  readonly row1: Int32Array;
  readonly x: Float64Array;
  readonly y: Float64Array;
  readonly flags: Uint8Array;
  readonly tileHazard: Int16Array;
  readonly surfaceOverride: Uint8Array;
};

/** The rectangle Bessie's wheel contact points span, in world space, with its AABB. */
type WheelQuad = {
  /** Centre of the rectangle, metres. */
  cx: number;
  cy: number;
  /** Unit right (rx, ry) and forward (fx, fy) axes. */
  rx: number;
  ry: number;
  fx: number;
  fy: number;
  /** Half extents across (right) and along (forward), metres. */
  halfW: number;
  halfL: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

/** The read-only view of `store`. No copy: it is the same object. */
export function viewHazardStore(store: HazardStore): HazardStoreView {
  return store;
}

/** The HAZARD_ENTITY_IDS index of `id`. Setup and tests. */
export function hazardKindIndex(id: HazardEntityId): number {
  return HAZARD_ENTITY_IDS.indexOf(id);
}

// ---------------------------------------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------------------------------------

/** Build the per-kind tables from validated entity data. Setup only. */
export function createHazardKinds(entities: Entities): HazardKinds {
  const n = HAZARD_ENTITY_IDS.length;
  const effect = new Uint8Array(n);
  const surface = new Uint8Array(n).fill(NO_SURFACE);
  const hpLoss = new Float64Array(n);
  const spillLu = new Float64Array(n);
  const minSpeedMps = new Float64Array(n).fill(-1);
  const pairedStain = new Int16Array(n).fill(-1);
  for (let k = 0; k < n; k += 1) {
    const e = entities.hazards[HAZARD_ENTITY_IDS[k] as HazardEntityId];
    effect[k] = EFFECT_CODE[e.effect];
    if (e.surface !== null) surface[k] = GRIP_SURFACE[e.surface];
    const rules: Readonly<Record<string, number>> = e.rules;
    hpLoss[k] = rules.hpLoss ?? 0;
    spillLu[k] = rules.spillLu ?? 0;
    minSpeedMps[k] = rules.minSpeedMps ?? -1;
  }
  for (let s = 0; s < STAIN_IDS.length; s += 1) {
    const paired = entities.stains[STAIN_IDS[s] as StainId].rules.pairedHazard;
    if (paired === undefined) continue;
    const k = (HAZARD_ENTITY_IDS as readonly string[]).indexOf(paired);
    if (k >= 0) pairedStain[k] = s;
  }
  const brushUpHazard = new Int16Array(LITTER_IDS.length).fill(-1);
  const litterLu = new Float64Array(LITTER_IDS.length);
  const litterBrushUp = new Uint8Array(LITTER_IDS.length);
  for (let k = 0; k < LITTER_IDS.length; k += 1) {
    const litter = entities.litter[LITTER_IDS[k] as LitterId];
    litterLu[k] = litter.lu;
    const rule = litter.rules.brushUp;
    if (rule !== undefined) litterBrushUp[k] = 1;
    if (rule === undefined || rule.effect !== 'hazard') continue;
    const hz = (HAZARD_ENTITY_IDS as readonly string[]).indexOf(rule.hazard);
    if (hz < 0)
      throw new Error(`createHazardKinds: ${LITTER_IDS[k]} brushUp names ${rule.hazard}, which has no entry`);
    brushUpHazard[k] = hz;
  }
  return {
    effect,
    surface,
    hpLoss,
    spillLu,
    minSpeedMps,
    pairedStain,
    brushUpHazard,
    litterLu,
    litterBrushUp,
  };
}

/**
 * An empty hazard store for `level` (its size sets the tile layers), with the kind tables from `entities`, the
 * level's small-litter spill table, and `rng` (the World's `events` stream) for spills. `litterCapacity` sizes
 * the brush-up hit list and must be at least the LitterField's. Allocated once per shift (§7.1).
 */
export function createHazardStore(
  level: Level,
  entities: Entities,
  rng: Sfc32,
  capacity: number = HAZARD_CAPACITY,
  litterCapacity: number = LITTER_CAPACITY,
): HazardStore {
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 0x7fff) {
    throw new Error(`createHazardStore: capacity must be an integer 1..32767, got ${capacity}`);
  }
  const [w, h] = level.size;
  const kinds = createHazardKinds(entities);
  return {
    capacity,
    count: 0,
    hazardsSpawned: 0,
    kind: new Uint8Array(capacity),
    col0: new Int32Array(capacity),
    row0: new Int32Array(capacity),
    col1: new Int32Array(capacity),
    row1: new Int32Array(capacity),
    x: new Float64Array(capacity),
    y: new Float64Array(capacity),
    flags: new Uint8Array(capacity),
    w,
    h,
    tileHazard: new Int16Array(w * h).fill(-1),
    surfaceOverride: new Uint8Array(w * h).fill(NO_SURFACE),
    kinds,
    spill: createSpillTable(level, kinds),
    rng,
    lastSpillLu: 0,
    // Fractional values first so the fields start as doubles (TECHNICAL_DESIGN §17, deprecated maps).
    quad: {
      cx: 0.5,
      cy: 0.5,
      rx: 0.5,
      ry: 0.5,
      fx: 0.5,
      fy: 0.5,
      halfW: 0.5,
      halfL: 0.5,
      minX: 0.5,
      minY: 0.5,
      maxX: 0.5,
      maxY: 0.5,
    },
    bodyBox: { minX: 0.5, minY: 0.5, maxX: 0.5, maxY: 0.5 },
    worldBox: { minX: 0.5, minY: 0.5, maxX: 0.5, maxY: 0.5 },
    hits: new Int32Array(litterCapacity),
    bodyBoxFor: null,
    axisC: 0.5,
    axisS: 0.5,
  };
}

/**
 * The district's small-litter table (see the header): the level's litter table entries of at most
 * SPILL_MAX_ITEM_LU with no brush-up rule, or SPILL_FALLBACK_LITTER alone. Setup only.
 */
export function createSpillTable(level: Level, kinds: HazardKinds): SpillTable {
  const entries: { kind: number; weight: number }[] = [];
  for (const entry of level.litter?.table ?? []) {
    const k = (LITTER_IDS as readonly string[]).indexOf(entry.id);
    if (k < 0) throw new Error(`createSpillTable: litter.table id ${entry.id} is not a litter id`);
    if (!(entry.weight > 0)) continue;
    if ((kinds.litterLu[k] as number) > SPILL_MAX_ITEM_LU) continue;
    if ((kinds.litterBrushUp[k] as number) === 1) continue;
    entries.push({ kind: k, weight: entry.weight });
  }
  if (entries.length === 0) entries.push({ kind: LITTER_IDS.indexOf(SPILL_FALLBACK_LITTER), weight: 1 });
  const n = entries.length;
  const table: SpillTable = {
    count: n,
    kind: new Uint8Array(n),
    weight: new Float64Array(n),
    lu: new Float64Array(n),
    total: 0,
    minLu: Number.POSITIVE_INFINITY,
  };
  for (let t = 0; t < n; t += 1) {
    const e = entries[t] as { kind: number; weight: number };
    table.kind[t] = e.kind;
    table.weight[t] = e.weight;
    const lu = kinds.litterLu[e.kind] as number;
    table.lu[t] = lu;
    table.total += e.weight;
    if (lu < table.minLu) table.minLu = lu;
  }
  return table;
}

// ---------------------------------------------------------------------------------------------------------
// Add and remove
// ---------------------------------------------------------------------------------------------------------

/** Empty the store, its tile layers and the counter (a new shift on the same store). Not per tick. */
export function clearHazards(store: HazardStore): void {
  store.count = 0;
  store.hazardsSpawned = 0;
  store.tileHazard.fill(-1);
  store.surfaceOverride.fill(NO_SURFACE);
}

/** Point the tiles of hazard i's footprint that no earlier hazard covers at it. */
function claimTiles(store: HazardStore, i: number): void {
  const w = store.w;
  const surface = store.kinds.surface[store.kind[i] as number] as number;
  const c1 = store.col1[i] as number;
  const r1 = store.row1[i] as number;
  for (let r = store.row0[i] as number; r < r1; r += 1) {
    for (let c = store.col0[i] as number; c < c1; c += 1) {
      const t = r * w + c;
      if ((store.tileHazard[t] as number) >= 0) continue;
      store.tileHazard[t] = i;
      store.surfaceOverride[t] = surface;
    }
  }
}

/**
 * Add a hazard of `kind` (HAZARD_ENTITY_IDS index) covering tiles col0..col1−1 × row0..row1−1 (clipped to the
 * map; integers). Counts toward hazardsSpawned. Tiles an earlier hazard already covers keep it in the tile
 * layers. Returns its index, or −1 (changing nothing) when the store is full or the clipped footprint is
 * empty. Takes only small integers, so it never boxes (wet leaves are created mid-tick).
 */
export function addHazard(
  store: HazardStore,
  kind: number,
  col0: number,
  row0: number,
  col1: number,
  row1: number,
): number {
  if (!(kind >= 0 && kind < HAZARD_ENTITY_IDS.length && (kind | 0) === kind)) {
    throw new Error(`addHazard: kind must be a HAZARD_ENTITY_IDS index, got ${kind}`);
  }
  if ((col0 | 0) !== col0 || (row0 | 0) !== row0 || (col1 | 0) !== col1 || (row1 | 0) !== row1) {
    throw new Error(`addHazard: footprint must be whole tiles, got [${col0}, ${row0}, ${col1}, ${row1}]`);
  }
  const c0 = col0 < 0 ? 0 : col0;
  const r0 = row0 < 0 ? 0 : row0;
  const c1 = col1 > store.w ? store.w : col1;
  const r1 = row1 > store.h ? store.h : row1;
  if (c1 <= c0 || r1 <= r0) return -1;
  if (store.count >= store.capacity) return -1;
  const i = store.count;
  store.count = i + 1;
  store.kind[i] = kind;
  store.col0[i] = c0;
  store.row0[i] = r0;
  store.col1[i] = c1;
  store.row1[i] = r1;
  store.x[i] = ((c0 + c1) * TILE_M) / 2;
  store.y[i] = ((r0 + r1) * TILE_M) / 2;
  store.flags[i] = 0;
  claimTiles(store, i);
  store.hazardsSpawned += 1;
  return i;
}

/**
 * Remove hazard `i` without touching the counter (SSP-094 sweeps broken glass). Swap-remove: the last live
 * hazard moves into slot `i`. The tile layers are rebuilt over both footprints from the store, in store
 * order, so they stay "first hazard covering the tile". Allocation-free.
 */
export function removeHazard(store: HazardStore, i: number): void {
  const last = store.count - 1;
  if (!(i >= 0 && i <= last))
    throw new Error(`removeHazard: index ${i} is not a live hazard (count ${store.count})`);
  const ac0 = store.col0[i] as number;
  const ar0 = store.row0[i] as number;
  const ac1 = store.col1[i] as number;
  const ar1 = store.row1[i] as number;
  const bc0 = store.col0[last] as number;
  const br0 = store.row0[last] as number;
  const bc1 = store.col1[last] as number;
  const br1 = store.row1[last] as number;
  if (i !== last) {
    store.kind[i] = store.kind[last] as number;
    store.col0[i] = bc0;
    store.row0[i] = br0;
    store.col1[i] = bc1;
    store.row1[i] = br1;
    store.x[i] = store.x[last] as number;
    store.y[i] = store.y[last] as number;
    store.flags[i] = store.flags[last] as number;
  }
  store.count = last;
  resetTiles(store, ac0, ar0, ac1, ar1);
  resetTiles(store, bc0, br0, bc1, br1);
  for (let j = 0; j < store.count; j += 1) {
    if (overlapsTiles(store, j, ac0, ar0, ac1, ar1) || overlapsTiles(store, j, bc0, br0, bc1, br1))
      claimTiles(store, j);
  }
}

function resetTiles(store: HazardStore, c0: number, r0: number, c1: number, r1: number): void {
  for (let r = r0; r < r1; r += 1) {
    for (let c = c0; c < c1; c += 1) {
      store.tileHazard[r * store.w + c] = -1;
      store.surfaceOverride[r * store.w + c] = NO_SURFACE;
    }
  }
}

function overlapsTiles(
  store: HazardStore,
  j: number,
  c0: number,
  r0: number,
  c1: number,
  r1: number,
): boolean {
  return (
    (store.col0[j] as number) < c1 &&
    (store.col1[j] as number) > c0 &&
    (store.row0[j] as number) < r1 &&
    (store.row1[j] as number) > r0
  );
}

/** The hazard covering tile (col, row), or −1 (also outside the map). Integers only. */
export function hazardAtTile(store: HazardStoreView, col: number, row: number): number {
  if (col < 0 || row < 0 || col >= store.w || row >= store.h) return -1;
  return store.tileHazard[row * store.w + col] as number;
}

/** The Surface a grip hazard gives tile (col, row), or NO_SURFACE (also outside the map). Integers only. */
export function hazardSurfaceAtTile(store: HazardStoreView, col: number, row: number): number {
  if (col < 0 || row < 0 || col >= store.w || row >= store.h) return NO_SURFACE;
  return store.surfaceOverride[row * store.w + col] as number;
}

// ---------------------------------------------------------------------------------------------------------
// Shift-start spawn (LEVEL_DESIGN §9.3)
// ---------------------------------------------------------------------------------------------------------

/**
 * Shift start (SSP-093): empty the store, then place, in this order,
 *   1. one haz.speed_bump per `haz.speed_bump` site of the level (the `=` tiles; its footprint is the site
 *      rectangle), in `sites` order;
 *   2. every `hazards.place` entry, on the tile containing its point, in order;
 *   3. every `hazards.random` request, in order: `count` distinct tiles drawn uniformly, on the `hazards`
 *      stream sfc32(seed ^ hash32('hazards')), from the tiles whose candidate bit for its rule is set (the
 *      compiler has already removed the §9.3 exclusions: within 3 tiles of @, zebras and school crossings,
 *      depot bays and skips, a hydrant and the tiles round it, bays, props, speed bumps and undrivable tiles)
 *      and that no hazard placed so far covers. The draw is a partial Fisher–Yates shuffle of the candidate
 *      list in row-major order, one nextInt per hazard placed. A request with fewer free candidates than
 *      `count` places what it can (the compiler's L073 makes too few candidates a level error).
 * Every placed haz.oil_slick also adds its paired stain (stain.oil) at its tile centre to `stains`, when one
 * is given. Throws when the level needs more than the store's capacity (a level-authoring error, §7.1).
 * Returns the number of hazards placed. Setup only: it allocates.
 */
export function spawnHazards(
  store: HazardStore,
  level: Level,
  seed: number,
  stains: StainStore | null = null,
): number {
  clearHazards(store);
  const place = (kind: number, c0: number, r0: number, c1: number, r1: number): void => {
    if (store.count >= store.capacity) {
      throw new Error(
        `spawnHazards: ${level.id} needs more than ${store.capacity} hazards (TECHNICAL_DESIGN §7.1)`,
      );
    }
    const i = addHazard(store, kind, c0, r0, c1, r1);
    if (i < 0) return;
    const stain = store.kinds.pairedStain[kind] as number;
    if (stain >= 0 && stains !== null) addStain(stains, stain, store.x[i] as number, store.y[i] as number);
  };

  const bump = hazardKindIndex('haz.speed_bump');
  for (const site of level.sites) {
    if (site.id !== 'haz.speed_bump') continue;
    place(bump, site.rect[0], site.rect[1], site.rect[2], site.rect[3]);
  }

  const spec = level.hazards;
  if (spec === null) return store.count;
  for (const p of spec.place) {
    const kind = (HAZARD_ENTITY_IDS as readonly string[]).indexOf(p.id);
    if (kind < 0) throw new Error(`spawnHazards: hazards.place id ${p.id} has no hazard entry`);
    const col = Math.floor(p.x / TILE_M);
    const row = Math.floor(p.y / TILE_M);
    place(kind, col, row, col + 1, row + 1);
  }

  const rng = createStream(seed >>> 0, 'hazards');
  const w = level.size[0];
  const candidates = new Int32Array(spec.candidates.length);
  for (const r of spec.random) {
    const kind = (HAZARD_ENTITY_IDS as readonly string[]).indexOf(r.id);
    if (kind < 0) throw new Error(`spawnHazards: hazards.random id ${r.id} has no hazard entry`);
    const bit = hazardRuleBit(r.rule);
    let n = 0;
    for (let t = 0; t < spec.candidates.length; t += 1) {
      if (((spec.candidates[t] as number) & bit) === 0) continue;
      if ((store.tileHazard[t] as number) >= 0) continue;
      candidates[n] = t;
      n += 1;
    }
    const take = r.count < n ? r.count : n;
    for (let j = 0; j < take; j += 1) {
      const pick = j + nextInt(rng, n - j);
      const t = candidates[pick] as number;
      candidates[pick] = candidates[j] as number;
      candidates[j] = t;
      const col = t % w;
      const row = (t - col) / w;
      place(kind, col, row, col + 1, row + 1);
    }
  }
  return store.count;
}

// ---------------------------------------------------------------------------------------------------------
// Contacts: jolts, spills and the hard stop (TECHNICAL_DESIGN §8.2 step 10)
// ---------------------------------------------------------------------------------------------------------

/** Fill `store.quad` with Bessie's wheel rectangle at her current pose. */
function updateWheelQuad(store: HazardStore, v: Readonly<VehicleState>, sweeper: SweeperTuning): void {
  const q = store.quad;
  const body = sweeper.body;
  const s = sin(v.headingRad);
  const c = cos(v.headingRad);
  // forward = (sin θ, −cos θ), right = (cos θ, sin θ) (TECHNICAL_DESIGN §4).
  q.fx = s;
  q.fy = -c;
  q.rx = c;
  q.ry = s;
  q.halfW = body.wheelTrackM / 2;
  q.halfL = (body.frontAxleOffsetM - body.rearAxleOffsetM) / 2;
  const mid = (body.frontAxleOffsetM + body.rearAxleOffsetM) / 2;
  q.cx = v.xM + s * mid;
  q.cy = v.yM - c * mid;
  const ex = Math.abs(c) * q.halfW + Math.abs(s) * q.halfL;
  const ey = Math.abs(s) * q.halfW + Math.abs(c) * q.halfL;
  q.minX = q.cx - ex;
  q.maxX = q.cx + ex;
  q.minY = q.cy - ey;
  q.maxY = q.cy + ey;
}

/**
 * True when the wheel rectangle in `store.quad` overlaps hazard i's footprint with positive area (SAT over
 * the two world axes, then the rectangle's own two axes; touching edges do not count).
 */
function quadOverlapsHazard(store: HazardStore, i: number): boolean {
  const q = store.quad;
  const minX = (store.col0[i] as number) * TILE_M;
  const maxX = (store.col1[i] as number) * TILE_M;
  const minY = (store.row0[i] as number) * TILE_M;
  const maxY = (store.row1[i] as number) * TILE_M;
  if (!(q.maxX > minX && q.minX < maxX && q.maxY > minY && q.minY < maxY)) return false;
  // Project the footprint's centre offset and half extents onto each of the rectangle's axes.
  const hx = (maxX - minX) / 2;
  const hy = (maxY - minY) / 2;
  const dx = (minX + maxX) / 2 - q.cx;
  const dy = (minY + maxY) / 2 - q.cy;
  const onRight = dx * q.rx + dy * q.ry;
  const reachRight = hx * Math.abs(q.rx) + hy * Math.abs(q.ry);
  if (!(Math.abs(onRight) < q.halfW + reachRight)) return false;
  const onForward = dx * q.fx + dy * q.fy;
  const reachForward = hx * Math.abs(q.fx) + hy * Math.abs(q.fy);
  return Math.abs(onForward) < q.halfL + reachForward;
}

/**
 * Phase 2, §8.2 step 10, after the kerb crossings: update every hazard's crossing episode against Bessie's
 * integrated pose and apply the effects of the episodes that start this tick (see the header): jolts (HP,
 * LU spill behind her, EV.HazardJolt) and the open manhole's hard stop (HP, vLong = vLat = 0,
 * EV.HazardStop). Returns how many episodes started. Allocation-free except a spill's addLitter arguments.
 */
export function stepHazardContacts(
  store: HazardStore,
  vehicle: VehicleState,
  sweeper: SweeperTuning,
  hopper: Hopper,
  litter: LitterField,
  events: EventQueue,
): number {
  if (store.count === 0) return 0;
  updateWheelQuad(store, vehicle, sweeper);
  const kinds = store.kinds;
  let started = 0;
  for (let i = 0; i < store.count; i += 1) {
    const flags = store.flags[i] as number;
    if (!quadOverlapsHazard(store, i)) {
      if ((flags & HazardFlag.Contact) !== 0) store.flags[i] = flags & ~HazardFlag.Contact;
      continue;
    }
    if ((flags & HazardFlag.Contact) !== 0) continue;
    store.flags[i] = flags | HazardFlag.Contact;
    started += 1;
    const kind = store.kind[i] as number;
    const effect = kinds.effect[kind] as number;
    if (effect === HazardEffectCode.Jolt) {
      if (!(Math.abs(vehicle.vLongMps) > (kinds.minSpeedMps[kind] as number))) continue;
      loseHp(vehicle, kinds.hpLoss[kind] as number);
      spillHopperLitter(store, hopper, litter, vehicle, sweeper, kinds.spillLu[kind] as number);
      const e = emitEvent(events, EV.HazardJolt, i);
      events.a[e] = vehicle.xM;
      events.b[e] = vehicle.yM;
      events.c[e] = store.lastSpillLu;
    } else if (effect === HazardEffectCode.HardStop) {
      const e = emitEvent(events, EV.HazardStop, i);
      events.a[e] = vehicle.xM;
      events.b[e] = vehicle.yM;
      events.c[e] = Math.abs(vehicle.vLongMps);
      loseHp(vehicle, kinds.hpLoss[kind] as number);
      vehicle.vLongMps = 0;
      vehicle.vLatMps = 0;
    }
  }
  return started;
}

/** HP −= loss, never below 0. */
function loseHp(vehicle: VehicleState, loss: number): void {
  if (!(loss > 0)) return;
  const hp = vehicle.hp - loss;
  vehicle.hp = hp > 0 ? hp : 0;
}

/**
 * Spill up to `lu` litter units out of the hopper as small litter items behind Bessie (see the header) and
 * write the LU actually moved into `store.lastSpillLu`. Returns the number of items added.
 */
export function spillHopperLitter(
  store: HazardStore,
  hopper: Hopper,
  litter: LitterField,
  vehicle: Readonly<VehicleState>,
  sweeper: SweeperTuning,
  lu: number,
): number {
  store.lastSpillLu = 0;
  const held = vehicle.hopperLU;
  const budget = lu < held ? lu : held;
  const table = store.spill;
  if (!(budget >= table.minLu)) return 0;
  const rng = store.rng;
  const s = sin(vehicle.headingRad);
  const c = cos(vehicle.headingRad);
  const rearM = sweeper.body.lengthM / 2;
  let left = budget;
  let items = 0;
  while (left >= table.minLu) {
    let pick = nextInt(rng, table.total);
    let t = 0;
    for (; t < table.count - 1; t += 1) {
      const wgt = table.weight[t] as number;
      if (pick < wgt) break;
      pick -= wgt;
    }
    if ((table.lu[t] as number) > left) {
      // The biggest kind that still fits (first in table order on a tie); minLu <= left, so one does.
      let best = 0;
      let bestLu = -1;
      for (let u = 0; u < table.count; u += 1) {
        const ul = table.lu[u] as number;
        if (ul <= left && ul > bestLu) {
          best = u;
          bestLu = ul;
        }
      }
      t = best;
    }
    const back = rearM + SPILL_GAP_M + nextFloat(rng) * SPILL_DEPTH_M;
    const side = (nextFloat(rng) * 2 - 1) * SPILL_HALF_WIDTH_M;
    const rot = nextInt(rng, LITTER_ROTATIONS);
    // position = centre − forward·back + right·side, forward = (s, −c), right = (c, s).
    const x = vehicle.xM - s * back + c * side;
    const y = vehicle.yM + c * back + s * side;
    if (addLitter(litter, table.kind[t] as number, x, y, rot) < 0) break;
    left -= table.lu[t] as number;
    items += 1;
  }
  const moved = budget - left;
  if (moved > 0) spillFromHopper(hopper, moved);
  store.lastSpillLu = moved;
  return items;
}

// ---------------------------------------------------------------------------------------------------------
// Phase 5: leaf piles driven through brush-up leave wet leaves (ENTITY_CATALOG §4.2)
// ---------------------------------------------------------------------------------------------------------

/** store.axisC / axisS = cos / sin of Bessie's heading. Objects in, nothing out: no double crosses the call. */
function writeBodyAxes(store: HazardStore, vehicle: Readonly<VehicleState>): void {
  const h = vehicle.headingRad;
  store.axisC = cos(h);
  store.axisS = sin(h);
}

/**
 * Phase 5, after beginLitterTick and before stepLitter. Does nothing unless `brush` is Raised. Then every
 * litter item of a kind with a brush-up hazard rule whose centre is inside Bessie's body OBB (edges inclusive)
 * is removed and its hazard is added on its tile when no hazard covers that tile (see the header). Flung items
 * are in the air and are never driven through. Returns how many hazards were created. Allocation-free.
 */
export function stepBrushUpLeaves(
  store: HazardStore,
  field: LitterField,
  brush: BrushView,
  vehicle: Readonly<VehicleState>,
  sweeper: SweeperTuning,
): number {
  if (brush.state !== BrushState.Raised || field.count === 0) return 0;
  const box = store.bodyBox;
  // As stains.ts's stepBrushUpSplats: the body box is rebuilt only when the tuning changes and the axes come
  // through scratch fields, because per-tick stores from tuning loads and non-inlined cos/sin calls boxed
  // doubles (SSP-065 World heap check).
  if (store.bodyBoxFor !== sweeper) {
    const hw = sweeper.body.widthM / 2;
    const hl = sweeper.body.lengthM / 2;
    box.minX = -hw;
    box.maxX = hw;
    box.minY = -hl;
    box.maxY = hl;
    store.bodyBoxFor = sweeper;
  }
  const hw = box.maxX;
  const hl = box.maxY;
  writeBodyAxes(store, vehicle);
  localRectToWorldAabb(vehicle, box, store.worldBox);
  const hits = store.hits;
  const n = queryLitter(field, store.worldBox, hits);
  if (n === 0) return 0;

  const kinds = store.kinds;
  const c = store.axisC;
  const s = store.axisS;
  const px = vehicle.xM;
  const py = vehicle.yM;
  let created = 0;
  for (let h = 0; h < n; h += 1) {
    const i = hits[h] as number;
    const hazard = kinds.brushUpHazard[field.kind[i] as number] as number;
    if (hazard < 0) continue;
    if (((field.flags[i] as number) & LitterFlag.Flung) !== 0) continue;
    const x = field.x[i] as number;
    const y = field.y[i] as number;
    const dx = x - px;
    const dy = y - py;
    // local = (d·right, d·forward), right = (c, s), forward = (s, −c) (src/sim/coords.ts).
    const lx = dx * c + dy * s;
    const ly = dx * s - dy * c;
    if (lx < -hw || lx > hw || ly < -hl || ly > hl) continue;

    const last = field.count - 1;
    removeLitter(field, i);
    // Swap-remove moved the last item into slot i: point any later hit on it at its new index.
    if (i !== last) {
      for (let k = h + 1; k < n; k += 1) if (hits[k] === last) hits[k] = i;
    }
    const col = Math.floor(x / TILE_M);
    const row = Math.floor(y / TILE_M);
    if (hazardAtTile(store, col, row) >= 0) continue;
    if (addHazard(store, hazard, col, row, col + 1, row + 1) >= 0) created += 1;
  }
  return created;
}
