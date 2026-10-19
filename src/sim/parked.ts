// Parked cars (TECHNICAL_DESIGN §9.1, §9.4, §11.4; ENTITY_CATALOG §8.2; LEVEL_DESIGN §9.5; SSP-090): the
// car slots cut from the compiled parking bays, the shift-start placement, the roof perches cats sit on and the
// dent rule of Bessie's contacts with them.
//
// Bays. The compiled `lanes.bays` are runs of `p` cells beside one lane, each with that lane's heading; a run
// of n cells holds floor(n / 2) **bays** of 2 tiles (4 m), one car each (parkingBays.ts: the longest parked
// car of the game, the 3.88 m ice cream van of M6, fits). A car stands in the middle of its bay, across the
// middle of the bay row, facing the lane's heading. The compiler counts the same bays (spawns.traffic.
// parkedBays, countBaySlots) and writes parked = ⌈parkedBays × parkedFill⌉ (spawnSpecs.ts), so the level's
// vehicle peak is exactly what this file places. The lanes beside bays in the carriageway swing clear of them
// (tools/levels/laneGraph.ts laneAcross), so moving traffic passes parked cars without following them.
//
// Placement (placeParkedCars, at shift start, before any moving vehicle exists). On the `traffic` stream: the
// `parked` bays are drawn without replacement (a partial Fisher–Yates over the bay list in compiled order, one
// draw per car, none when one bay is left), then, in ascending bay order, each car's kind by parkedMix weight
// (traffic.ts's mix draw) and, for a hatchback or saloon, its paint swap slot (nextInt(PAINT_SLOTS), ART_BIBLE
// §8.2). The cars go into the vehicle store as VEHICLE_FLAG.PARKED at indices 0..parked−1 (so moving + parked
// never exceeds the store's 30), and their OBBs into the static grid (collision/grid.ts ShapeSource.Parked),
// which is why createWorld places them before it builds the grid.
//
// Roof perches (for npc.cat, SSP-087). Every parked car's roof is one perch, at its body centre; `roofPerch`
// holds the NPC handle of the cat on it (ROOF_PERCH_FREE when empty). claimRoofPerch / releaseRoofPerch are the
// occupancy API; the perch never moves, because parked cars never do.
//
// Dents (applyVehicleContacts, phase 3 after the resolver). Bessie resolves against a parked car as against
// any static shape (restitution 0.2), but its impact costs no impact damage: an approaching contact faster
// than collision.damageThresholdMps (2 m/s, the "crash" threshold of ENTITY_CATALOG §3.2) **dents** the car,
// once per contact episode: the flat entities.json rules.dentHp (5 HP, replacing the impact damage, §17 Q4; not
// scaled by upg.bumper, whose −40% is on impact damage) inside the resolver, EV.Dent there, and here the
// penalty fact (Offence.Dent, rules.dentPts −100, no complaint; phase 9 takes the points and resets the chain).
// An episode runs from the first touch until the car has gone streetLife.traffic.dentRearmS (0.5 s) untouched,
// as a knockable's does (bodies.ts), so a bounce and a second ram straight after it are one dent.
//
// Hot path: applyVehicleContacts and the perch functions allocate nothing and take no doubles; the rest is
// setup.
import type { ParkedBox } from './collision/grid.ts';
import type { StaticResolver } from './collision/resolveStatic.ts';
import { Offence } from './complaints.ts';
import { VEHICLE_IDS } from './entities.ts';
import type { Level } from './map.ts';
import { type BaySlot, cutBaySlots } from './parkingBays.ts';
import { pushPenalty } from './penalties.ts';
import { nextInt, type Sfc32 } from './rng.ts';
import { MIX_STEPS } from './traffic.ts';
import {
  addVehicle,
  PAINT_SLOTS,
  ROOF_PERCH_FREE,
  rebuildVehicleGrid,
  TOUCH_CLEAR_MAX,
  updateVehicleCorners,
  VEHICLE_FLAG,
  type VehicleStore,
} from './vehicleStore.ts';
import type { World } from './world.ts';

/** A level's parked cars as placed: where each stands, for tests and tools (no pose beyond the store's). */
export type ParkedPlacement = {
  /** The bays, in the order cutBaySlots lists them. */
  readonly slots: readonly BaySlot[];
  /** The bay each placed car stands in (index into `slots`), ascending; car k is vehicle-store index k. */
  readonly filled: readonly number[];
  /** The static OBBs createStaticGrid registers (vehicle-store order). */
  readonly boxes: readonly ParkedBox[];
};

/**
 * Place the level's parked cars into the empty `store` (see the header): spawns.traffic.parked cars of
 * parkedMix in that many bays drawn on `rng` (the `traffic` stream), each with its paint slot, flagged PARKED,
 * corners and spatial lookup refreshed. Returns the placement, whose `boxes` go to createStaticGrid. A level
 * with no traffic spec, or `parked` 0, places none and draws nothing. Throws when the store already holds a
 * vehicle, when `parked` exceeds the bays or the store's capacity, or when the mix names no parked kind.
 * Setup only (allocates).
 */
export function placeParkedCars(store: VehicleStore, level: Level, rng: Sfc32): ParkedPlacement {
  const where = `placeParkedCars(${level.id})`;
  if (store.count !== 0) throw new Error(`${where}: the vehicle store must be empty (got ${store.count})`);
  const slots = cutBaySlots(level.lanes.bays);
  const spec = level.traffic;
  const want = spec === null ? 0 : spec.parked;
  if (want === 0) return { slots, filled: [], boxes: [] };
  if (want > slots.length) {
    throw new Error(`${where}: traffic.parked ${want} exceeds the ${slots.length} bays cut from lanes.bays`);
  }
  if (want > store.capacity) {
    throw new Error(`${where}: traffic.parked ${want} exceeds the vehicle store's ${store.capacity}`);
  }
  const mix = (spec?.parkedMix ?? []).map((m) => {
    const kind = (VEHICLE_IDS as readonly string[]).indexOf(m.id);
    if (kind < 0) throw new Error(`${where}: ${m.id} is not a vehicle kind of entities.json`);
    return { kind, weight: m.weight };
  });
  let total = 0;
  for (const m of mix) total += m.weight;
  if (mix.length === 0 || !(total > 0)) throw new Error(`${where}: traffic.parkedMix has no weight`);
  // The bays: a partial Fisher–Yates over the bay list (one draw per car while more than one bay is left).
  const order = Array.from(slots, (_, k) => k);
  for (let k = 0; k < want; k += 1) {
    const left = order.length - k;
    const pick = left > 1 ? k + nextInt(rng, left) : k;
    const tmp = order[k] as number;
    order[k] = order[pick] as number;
    order[pick] = tmp;
  }
  const filled = order.slice(0, want).sort((a, b) => a - b);
  const boxes: ParkedBox[] = [];
  for (const slotIndex of filled) {
    const slot = slots[slotIndex] as BaySlot;
    // The kind by parkedMix weight, drawn exactly as traffic.ts draws a moving vehicle's kind.
    let r = ((nextInt(rng, MIX_STEPS) + 0.5) / MIX_STEPS) * total;
    let kind = (mix[mix.length - 1] as { kind: number }).kind;
    for (const m of mix) {
      r -= m.weight;
      if (r < 0) {
        kind = m.kind;
        break;
      }
    }
    const i = addVehicle(store, kind, VEHICLE_FLAG.PARKED);
    if ((store.kindPainted[kind] as number) === 1) store.paint[i] = nextInt(rng, PAINT_SLOTS);
    store.x[i] = slot.x;
    store.y[i] = slot.y;
    store.heading[i] = slot.heading;
    store.prevX[i] = slot.x;
    store.prevY[i] = slot.y;
    store.prevHeading[i] = slot.heading;
    updateVehicleCorners(store, i);
    boxes.push({
      x: slot.x,
      y: slot.y,
      heading: slot.heading,
      halfWidthM: store.halfWidth[i] as number,
      halfLengthM: store.halfLength[i] as number,
      vehicle: i,
    });
  }
  rebuildVehicleGrid(store);
  return { slots, filled, boxes };
}

// ---------------------------------------------------------------------------------------------------------
// Roof perches (npc.cat, SSP-087)
// ---------------------------------------------------------------------------------------------------------

/** The roof perches: one per parked car, vehicle-store indices 0..roofPerchCount − 1. */
export function roofPerchCount(store: VehicleStore): number {
  return store.parkedCount;
}

/** True when vehicle `i` is a parked car (its roof is a perch). Its perch is at (store.x[i], store.y[i]). */
export function isRoofPerch(store: VehicleStore, i: number): boolean {
  return i >= 0 && i < store.count && ((store.flags[i] as number) & VEHICLE_FLAG.PARKED) !== 0;
}

/** True when parked car `i`'s roof has no cat on it. */
export function isRoofPerchFree(store: VehicleStore, i: number): boolean {
  return isRoofPerch(store, i) && store.roofPerch[i] === ROOF_PERCH_FREE;
}

/**
 * Put the cat with NPC handle `npcHandle` (≥ 0) on parked car `i`'s roof: true when it was free (or already
 * that cat's), false when it is not a perch or another cat holds it. Allocation-free.
 */
export function claimRoofPerch(store: VehicleStore, i: number, npcHandle: number): boolean {
  if (!isRoofPerch(store, i) || npcHandle < 0) return false;
  const holder = store.roofPerch[i] as number;
  if (holder !== ROOF_PERCH_FREE && holder !== npcHandle) return false;
  store.roofPerch[i] = npcHandle;
  return true;
}

/** Free parked car `i`'s roof if the cat with `npcHandle` holds it. Allocation-free. */
export function releaseRoofPerch(store: VehicleStore, i: number, npcHandle: number): void {
  if (isRoofPerch(store, i) && store.roofPerch[i] === npcHandle) store.roofPerch[i] = ROOF_PERCH_FREE;
}

// ---------------------------------------------------------------------------------------------------------
// Contact episodes and dents (phase 3)
// ---------------------------------------------------------------------------------------------------------

/** True when vehicle `i` is in the resolver's touched list of this tick. */
function touchedThisTick(r: StaticResolver, i: number): boolean {
  for (let k = 0; k < r.touchedCount; k += 1) if (r.touched[k] === i) return true;
  return false;
}

/**
 * After resolveStatic (phase 3): every parked car's contact episode (touchClear, and the re-arm of `dented`
 * once it has gone dentRearmS untouched), then each dent the resolver made this tick: the car's `dented` and
 * `dents`, world.traffic.dents and the penalty fact at the contact point. Allocation-free.
 */
export function applyVehicleContacts(world: World): void {
  const store = world.vehicles;
  const r = world.staticResolver;
  const rearm = world.traffic.dentRearmTicks;
  for (let i = 0; i < store.count; i += 1) {
    if (touchedThisTick(r, i)) {
      store.touchClear[i] = 0;
      continue;
    }
    const clear = store.touchClear[i] as number;
    const next = clear < TOUCH_CLEAR_MAX ? clear + 1 : clear;
    store.touchClear[i] = next;
    if (next >= rearm) store.dented[i] = 0;
  }
  for (let k = 0; k < r.dentCount; k += 1) {
    const i = r.dentVehicle[k] as number;
    store.dented[i] = 1;
    store.dents[i] = (store.dents[i] as number) + 1;
    world.traffic.dents += 1;
    const p = pushPenalty(
      world.penalties,
      Offence.Dent,
      store.kindDentPts[store.kind[i] as number] as number,
      0,
    );
    world.penalties.x[p] = r.dentX[k] as number;
    world.penalties.y[p] = r.dentY[k] as number;
  }
}
