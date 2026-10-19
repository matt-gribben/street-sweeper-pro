// The stain store (GDD §8.5, TECHNICAL_DESIGN §7.1, §10.4; ENTITY_CATALOG §5; SSP-061): every `stain.*` decal
// on the street, as a fixed-capacity struct-of-arrays store, and the dog-mess brush-up rule that makes them
// (ENTITY_CATALOG §4.2, GDD §8.2).
//
// Store. Stain i lives in slot i of every array, 0 <= i < count; removal is swap-remove with the last live
// slot (TECHNICAL_DESIGN §7.1). Each stain has a position, a kind (the STAIN_IDS index) and its clean progress.
// The progress is kept as whole ticks of spray received (`cleanTicks`, integer-valued), not as accumulated
// seconds: 60 additions of 1/60 do not sum to exactly 1.0 in a double, so a seconds counter would make "gum is
// clean after 1.0 s" depend on rounding. Seconds of spray = cleanTicks × DT_S (stainCleanProgressS). A stain is
// clean on the tick its cleanTicks reaches its kind's spray time in ticks (entities.json `sprayS` × 60,
// rounded: gum and splat 60, milkshake 90, oil and chalk art 120). Progress is kept when the stain leaves the
// cone, so a stain can be cleaned in several passes. Spraying itself (the tank, the cone, which stains it
// covers) is water.ts; cleaning in the cone is water.ts's cleanStainsInCone, which calls cleanStainTick here.
//
// Stains do not move and have no spatial hash: at most 256 exist (§7.1) and the cone test is a handful of
// multiplies, so a linear scan in index order is cheaper than maintaining a hash, and trivially deterministic.
// The sprite variant (gum has 3, splat 2) is a presentation choice: the renderer derives it from the stain's
// position, so the sim holds no art data.
//
// Brush-up rule (stepBrushUpSplats, phase 5 after beginLitterTick and before stepLitter; SSP-065 wires it in):
// while the brush is Raised (BrushState.Raised only: during Lowering and Raising litter is neither collected nor
// driven over, GDD §8.2 table), a litter item whose kind has a `brushUp: { effect: 'stain' }` rule in
// entities.json (litter.dog_mess → stain.splat, −20) and whose centre is inside Bessie's body OBB (1.75 ×
// 3.25 m; edges inclusive) is "driven over" (GDD §8.2): it is removed from the LitterField (removeLitter, so
// neither litter counter changes: it stays in Tidy %'s spawned count and can never be collected), a stain of
// the rule's kind is added at its position, and the penalty hook is called with the rule's points. The hook
// is scoring's penalty API (SSP-063), which applies the points and resets the combo chain; it is attached once
// at shift start, and until it is attached the splat still happens with no score effect. Flung items are in
// the air and are never driven over. A full stain store drops the stain but not the penalty.
//
// Hot path: stepBrushUpSplats, cleanStainTick, addStain and removeStain allocate nothing (§17). The penalty
// hook is called at most a few times per shift, so passing doubles to it (which can box) is acceptable there.

import { BrushState, type BrushView } from './brush.ts';
import type { Aabb } from './collision/obb.ts';
import { DT_S, SIM_HZ } from './constants.ts';
import { type Entities, LITTER_IDS, type LitterId, STAIN_IDS, type StainId } from './entities.ts';
import { cos, sin } from './fmath.ts';
import {
  LITTER_CAPACITY,
  type LitterField,
  LitterFlag,
  localRectToWorldAabb,
  queryLitter,
  removeLitter,
} from './litter.ts';
import type { SweeperTuning } from './tuning.ts';
import type { VehicleState } from './vehicle.ts';

/** Stain store capacity (TECHNICAL_DESIGN §7.1, §17). */
export const STAIN_CAPACITY = 256;

/**
 * The scoring penalty hook (SSP-063 attaches scoring's penalty API): apply `pts` (negative) at (xM, yM) and
 * reset the combo chain. Attached once at shift start; never a closure created per tick.
 */
export type PenaltyHook = (pts: number, xM: number, yM: number) => void;

/** Per-kind tables, built once from entities.json. */
export type StainKinds = {
  /** Spray needed to clean, in ticks (sprayS × 60, rounded, at least 1), by STAIN_IDS index. */
  readonly sprayTicks: Int32Array;
  /** Points for spraying it clean (before the combo), by STAIN_IDS index. */
  readonly pts: Float64Array;
  /** The stain a litter kind becomes when driven over brush-up (by LITTER_IDS index), or −1. */
  readonly brushUpStain: Int16Array;
  /** The points that brush-up costs (negative), by LITTER_IDS index; 0 where brushUpStain is −1. */
  readonly brushUpPts: Float64Array;
};

/** The mutable stain store. Create with createStainStore; only the sim writes it. */
export type StainStore = {
  /** Slots in every array (STAIN_CAPACITY in the game). */
  readonly capacity: number;
  /** Live stains, 0..capacity; stains are slots 0..count−1. */
  count: number;
  /** Stains added this shift (authored, splats, chalk art). */
  stainsSpawned: number;
  /** Stains sprayed clean this shift. */
  stainsCleaned: number;
  /** Position, metres. */
  readonly x: Float64Array;
  readonly y: Float64Array;
  /** Index into STAIN_IDS. */
  readonly kind: Uint8Array;
  /** Ticks of spray received so far (integer-valued); seconds = cleanTicks × DT_S. */
  readonly cleanTicks: Int32Array;
  readonly kinds: StainKinds;
  /** Scoring's penalty API (SSP-063). Null until attached. */
  onPenalty: PenaltyHook | null;
  /** Brush-up scratch: Bessie's body in vehicle-local and world space, and the litter hit list. */
  readonly bodyBox: Aabb;
  readonly worldBox: Aabb;
  readonly hits: Int32Array;
};

/** What render, audio and UI may see: the same object, typed read-only. */
export type StainStoreView = {
  readonly capacity: number;
  readonly count: number;
  readonly stainsSpawned: number;
  readonly stainsCleaned: number;
  readonly x: Float64Array;
  readonly y: Float64Array;
  readonly kind: Uint8Array;
  readonly cleanTicks: Int32Array;
  readonly kinds: StainKinds;
};

/** The read-only view of `store`. No copy: it is the same object. */
export function viewStainStore(store: StainStore): StainStoreView {
  return store;
}

// ---------------------------------------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------------------------------------

/** Build the per-kind tables from validated entity data. Setup only. */
export function createStainKinds(entities: Entities): StainKinds {
  const sprayTicks = new Int32Array(STAIN_IDS.length);
  const pts = new Float64Array(STAIN_IDS.length);
  for (let k = 0; k < STAIN_IDS.length; k += 1) {
    const stain = entities.stains[STAIN_IDS[k] as StainId];
    sprayTicks[k] = Math.max(1, Math.round(stain.sprayS * SIM_HZ));
    pts[k] = stain.pts;
  }
  const brushUpStain = new Int16Array(LITTER_IDS.length).fill(-1);
  const brushUpPts = new Float64Array(LITTER_IDS.length);
  for (let k = 0; k < LITTER_IDS.length; k += 1) {
    const rule = entities.litter[LITTER_IDS[k] as LitterId].rules.brushUp;
    if (rule === undefined || rule.effect !== 'stain') continue;
    brushUpStain[k] = STAIN_IDS.indexOf(rule.stain);
    brushUpPts[k] = rule.pts;
  }
  return { sprayTicks, pts, brushUpStain, brushUpPts };
}

/**
 * An empty stain store with the kind tables from `entities`. `litterCapacity` sizes the brush-up hit list and
 * must be at least the LitterField's. Allocated once per shift (§7.1).
 */
export function createStainStore(
  entities: Entities,
  capacity: number = STAIN_CAPACITY,
  litterCapacity: number = LITTER_CAPACITY,
): StainStore {
  if (!Number.isInteger(capacity) || capacity < 1) {
    throw new Error(`createStainStore: capacity must be a positive integer, got ${capacity}`);
  }
  if (!Number.isInteger(litterCapacity) || litterCapacity < 1) {
    throw new Error(`createStainStore: litterCapacity must be a positive integer, got ${litterCapacity}`);
  }
  return {
    capacity,
    count: 0,
    stainsSpawned: 0,
    stainsCleaned: 0,
    x: new Float64Array(capacity),
    y: new Float64Array(capacity),
    kind: new Uint8Array(capacity),
    cleanTicks: new Int32Array(capacity),
    kinds: createStainKinds(entities),
    onPenalty: null,
    // Fractional values first so the fields start as doubles (TECHNICAL_DESIGN §17, deprecated maps).
    bodyBox: { minX: 0.5, minY: 0.5, maxX: 0.5, maxY: 0.5 },
    worldBox: { minX: 0.5, minY: 0.5, maxX: 0.5, maxY: 0.5 },
    hits: new Int32Array(litterCapacity),
  };
}

/** Empty the store and zero both counters (a new shift on the same store). Not per tick. */
export function clearStains(store: StainStore): void {
  store.count = 0;
  store.stainsSpawned = 0;
  store.stainsCleaned = 0;
}

// ---------------------------------------------------------------------------------------------------------
// Add, clean and remove
// ---------------------------------------------------------------------------------------------------------

/**
 * Add a stain of `kind` (STAIN_IDS index) at (xM, yM) with no spray received. Counts toward stainsSpawned.
 * Returns its index, or −1 (and changes nothing) when the store is full.
 */
export function addStain(store: StainStore, kind: number, xM: number, yM: number): number {
  if (!(kind >= 0 && kind < STAIN_IDS.length && (kind | 0) === kind)) {
    throw new Error(`addStain: kind must be a STAIN_IDS index, got ${kind}`);
  }
  if (!(Number.isFinite(xM) && Number.isFinite(yM))) {
    throw new Error(`addStain: position must be finite, got (${xM}, ${yM})`);
  }
  if (store.count >= store.capacity) return -1;
  const i = store.count;
  store.count = i + 1;
  store.x[i] = xM;
  store.y[i] = yM;
  store.kind[i] = kind;
  store.cleanTicks[i] = 0;
  store.stainsSpawned += 1;
  return i;
}

/** Remove stain `i` without touching the counters. Swap-remove: the last live stain moves into slot `i`. */
export function removeStain(store: StainStore, i: number): void {
  const last = store.count - 1;
  if (!(i >= 0 && i <= last))
    throw new Error(`removeStain: index ${i} is not a live stain (count ${store.count})`);
  if (i !== last) {
    store.x[i] = store.x[last] as number;
    store.y[i] = store.y[last] as number;
    store.kind[i] = store.kind[last] as number;
    store.cleanTicks[i] = store.cleanTicks[last] as number;
  }
  store.count = last;
}

/**
 * Give stain `i` one tick of spray. Returns true when that makes it clean (cleanTicks reaches its kind's spray
 * ticks); the caller then scores it and removes it (cleanStainsInCone in water.ts). The stain stays in place
 * here either way.
 */
export function cleanStainTick(store: StainStore, i: number): boolean {
  const ticks = (store.cleanTicks[i] as number) + 1;
  store.cleanTicks[i] = ticks;
  return ticks >= (store.kinds.sprayTicks[store.kind[i] as number] as number);
}

/** Seconds of spray stain `i` has received (cleanTicks × DT_S). */
export function stainCleanProgressS(store: StainStoreView, i: number): number {
  return (store.cleanTicks[i] as number) * DT_S;
}

/** The STAIN_IDS index of `id`. Setup and tests. */
export function stainKindIndex(id: StainId): number {
  return STAIN_IDS.indexOf(id);
}

// ---------------------------------------------------------------------------------------------------------
// Phase 5: the brush-up rule
// ---------------------------------------------------------------------------------------------------------

/**
 * Phase 5, after beginLitterTick and before stepLitter. Does nothing unless `brush` is Raised. Then every litter
 * item of a kind with a brush-up stain rule whose centre is
 * inside Bessie's body OBB is removed, becomes that stain at its position, and costs the rule's points through
 * the penalty hook (see the header). Returns how many items were splatted. Allocation-free.
 */
export function stepBrushUpSplats(
  store: StainStore,
  field: LitterField,
  brush: BrushView,
  vehicle: Readonly<VehicleState>,
  sweeper: SweeperTuning,
): number {
  if (brush.state !== BrushState.Raised) return 0;
  const hw = sweeper.body.widthM / 2;
  const hl = sweeper.body.lengthM / 2;
  const box = store.bodyBox;
  box.minX = -hw;
  box.maxX = hw;
  box.minY = -hl;
  box.maxY = hl;
  localRectToWorldAabb(vehicle, box, store.worldBox);
  const hits = store.hits;
  const n = queryLitter(field, store.worldBox, hits);
  if (n === 0) return 0;

  const kinds = store.kinds;
  const c = cos(vehicle.headingRad);
  const s = sin(vehicle.headingRad);
  const px = vehicle.xM;
  const py = vehicle.yM;
  let splats = 0;
  for (let h = 0; h < n; h += 1) {
    const i = hits[h] as number;
    const kind = field.kind[i] as number;
    const stain = kinds.brushUpStain[kind] as number;
    if (stain < 0) continue;
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
    addStain(store, stain, x, y);
    splats += 1;
    const hook = store.onPenalty;
    if (hook !== null) hook(kinds.brushUpPts[kind] as number, x, y);
  }
  return splats;
}
