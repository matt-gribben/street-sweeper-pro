// SimSnapshot (TECHNICAL_DESIGN §18.5, SSP-046): the JSON-safe summary of a World that `window.__ssp.state()`
// returns in a shift scene, so Playwright specs and scripted checks can read the sim across `page.evaluate`.
//
// JSON-safe means `JSON.parse(JSON.stringify(s))` deep-equals `s`: plain objects and arrays of finite numbers,
// booleans and strings only (no typed arrays, no undefined, no NaN or ±Infinity, and no −0, which JSON writes
// as 0). snapshotWorld folds −0
// into 0 and throws on a non-finite value, which would be a sim bug rather than something to paper over.
//
// Fields by milestone (each issue extends this type and §18.5 together):
//   M1 (SSP-046)  tick, bessie { x, y, heading, speed }, hp;
//   M2 (SSP-065)  score, tidy, stars, hopper { lu, capacityLu, full }, water { units, capacity },
//                 combo { chain, multiplier, timerTicks, bestChain }, litter { spawned, collected },
//                 grime { initial, cleaned }, frontages [{ id, clean, cleanSwept }];
//   M3 (SSP-080)  npcs [{ id, origin, x, y, heading, state, stateTicks }];
//   M3 (SSP-078)  complaints.
//
// Load-time / test-time code: it allocates a fresh object per call and is never called per tick.
import { NPC_IDS } from './entities.ts';
import type { WorldView } from './world.ts';

/** Bessie's part of a SimSnapshot: body centre and heading straight from the sim (not interpolated). */
export type SimBessieSnapshot = {
  /** Body centre, sim metres east of the map's NW corner. */
  readonly x: number;
  /** Body centre, sim metres south of the map's NW corner. */
  readonly y: number;
  /** Heading in radians, 0 = north, clockwise; not wrapped (the sim never wraps it, §8.1). */
  readonly heading: number;
  /** Longitudinal speed vLong in m/s: along the heading, negative while reversing. */
  readonly speed: number;
};

/** Bessie's hopper (hopper.ts): litter units in it, its capacity, and the bulldozer state. */
export type SimHopperSnapshot = {
  readonly lu: number;
  readonly capacityLu: number;
  /** lu has reached capacityLu: the brush bulldozes instead of collecting. */
  readonly full: boolean;
};

/** Bessie's water tank (water.ts): units in it and its capacity. */
export type SimWaterSnapshot = { readonly units: number; readonly capacity: number };

/** The combo chain (combo.ts). */
export type SimComboSnapshot = {
  /** Pickups in the current chain (0 when there is none). */
  readonly chain: number;
  /** The multiplier the next pickup scores at, 1..5. */
  readonly multiplier: number;
  /** Ticks before the chain expires (0 without a chain); the HUD bar is timerTicks / 120. */
  readonly timerTicks: number;
  /** The shift's longest chain. */
  readonly bestChain: number;
};

/** One frontage's clean % (tidy.ts), in compiled `frontages` order. */
export type SimFrontageSnapshot = {
  readonly id: string;
  /** 0..1. */
  readonly clean: number;
  /** The frontage has awarded its Clean Sweep this shift. */
  readonly cleanSwept: boolean;
};

/** Where an NPC came from (npc/store.ts NpcOrigin), by name. */
export const NPC_ORIGIN_NAMES = ['ambient', 'named', 'perch', 'flock', 'companion'] as const;
export type NpcOriginName = (typeof NPC_ORIGIN_NAMES)[number];

/** One live NPC (npc/store.ts), in store index order. */
export type SimNpcSnapshot = {
  /** Its entities.json id (a dog walker's dog carries the walker's id, with origin `companion`). */
  readonly id: string;
  readonly origin: NpcOriginName;
  /** Position, sim metres (+x east, +y south). */
  readonly x: number;
  readonly y: number;
  /** Heading in radians, 0 = north, clockwise. */
  readonly heading: number;
  /** Behaviour state id (the kind's behaviour module's states). */
  readonly state: number;
  /** Ticks spent in that state, this tick included. */
  readonly stateTicks: number;
};

/** What `__ssp.state()` reports about the sim: M1 fields, then the M2 sweeping state (SSP-065). */
export type SimSnapshot = {
  /** Ticks completed since shift start (World.tick). */
  readonly tick: number;
  readonly bessie: SimBessieSnapshot;
  /** Bessie's Dignity, 0..health.maxHp. */
  readonly hp: number;
  /** The shift's score (scoring.ts): items, stains and grime with the combo, bonuses and penalties. */
  readonly score: number;
  /** Tidy %, 0..1 (tidy.ts). */
  readonly tidy: number;
  /** Would-be stars for the current Tidy %, 0..3. */
  readonly stars: number;
  readonly hopper: SimHopperSnapshot;
  readonly water: SimWaterSnapshot;
  readonly combo: SimComboSnapshot;
  /** Litter added this shift (shift-start spawn plus dynamic litter) and collected by the brush. */
  readonly litter: { readonly spawned: number; readonly collected: number };
  /** Grime cells laid at shift start and cleaned since. */
  readonly grime: { readonly initial: number; readonly cleaned: number };
  readonly frontages: readonly SimFrontageSnapshot[];
  /** Every live NPC, in store index order (SSP-080). */
  readonly npcs: readonly SimNpcSnapshot[];
};

/** `value` as a JSON-safe number: −0 becomes 0; NaN and ±Infinity throw, naming `field`. */
function jsonNumber(value: number, field: string): number {
  if (!Number.isFinite(value)) throw new Error(`SimSnapshot: ${field} is ${value}, not a finite number`);
  return value + 0;
}

/** A JSON-safe snapshot of `world` as it stands after its last tick. */
export function snapshotWorld(world: WorldView): SimSnapshot {
  const v = world.vehicle;
  const combo = world.scoring.combo;
  const tidy = world.tidy;
  const frontages: SimFrontageSnapshot[] = [];
  for (let z = 0; z < tidy.frontageCount; z += 1) {
    frontages.push({
      id: tidy.frontageIds[z] as string,
      clean: jsonNumber(tidy.frontageClean[z] as number, `frontages[${z}].clean`),
      cleanSwept: tidy.cleanSwept[z] === 1,
    });
  }
  const npc = world.npc;
  const npcs: SimNpcSnapshot[] = [];
  for (let i = 0; i < npc.count; i += 1) {
    const id = NPC_IDS[npc.kind[i] as number];
    const origin = NPC_ORIGIN_NAMES[npc.origin[i] as number];
    if (id === undefined || origin === undefined)
      throw new Error(`SimSnapshot: npcs[${i}] has a bad kind or origin`);
    npcs.push({
      id,
      origin,
      x: jsonNumber(npc.x[i] as number, `npcs[${i}].x`),
      y: jsonNumber(npc.y[i] as number, `npcs[${i}].y`),
      heading: jsonNumber(npc.heading[i] as number, `npcs[${i}].heading`),
      state: npc.state[i] as number,
      stateTicks: npc.stateTicks[i] as number,
    });
  }
  return {
    tick: jsonNumber(world.tick, 'tick'),
    bessie: {
      x: jsonNumber(v.xM, 'bessie.x'),
      y: jsonNumber(v.yM, 'bessie.y'),
      heading: jsonNumber(v.headingRad, 'bessie.heading'),
      speed: jsonNumber(v.vLongMps, 'bessie.speed'),
    },
    hp: jsonNumber(v.hp, 'hp'),
    score: jsonNumber(world.scoring.score, 'score'),
    tidy: jsonNumber(tidy.tidy, 'tidy'),
    stars: jsonNumber(tidy.stars, 'stars'),
    hopper: {
      lu: jsonNumber(v.hopperLU, 'hopper.lu'),
      capacityLu: jsonNumber(world.hopper.params.hopperCapacityLU, 'hopper.capacityLu'),
      full: world.hopper.full,
    },
    water: {
      units: jsonNumber(v.water, 'water.units'),
      capacity: jsonNumber(world.water.tuning.tankUnits, 'water.capacity'),
    },
    combo: {
      chain: jsonNumber(combo.chain, 'combo.chain'),
      multiplier: jsonNumber(combo.multiplier, 'combo.multiplier'),
      timerTicks: jsonNumber(combo.timerTicks, 'combo.timerTicks'),
      bestChain: jsonNumber(combo.bestChain, 'combo.bestChain'),
    },
    litter: {
      spawned: jsonNumber(world.litter.litterSpawned, 'litter.spawned'),
      collected: jsonNumber(world.litter.litterCollected, 'litter.collected'),
    },
    grime: {
      initial: jsonNumber(world.dirt.initialCells, 'grime.initial'),
      cleaned: jsonNumber(world.dirt.cleanedCells, 'grime.cleaned'),
    },
    frontages,
    npcs,
  };
}
