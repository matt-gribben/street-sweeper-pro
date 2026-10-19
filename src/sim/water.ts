// Bessie's water tank and spray (GDD §8.5, TECHNICAL_DESIGN §10.4; SSP-061): the tank drained by holding SPRAY,
// the spray cone ahead of the front bumper, hydrant refills, the depot's full refill, and spraying stains clean.
//
// Where the numbers live. The water in the tank is `VehicleState.water` (TECHNICAL_DESIGN §8.1; already in the
// replay hash); the Water holds a reference to the vehicle, so it is never copied. The capacity is
// tuning.json `water.tankUnits` (100; upg.water_tank raises it through the tuning modifiers, SSP-188). Rates are
// `sprayUnitsPerS` (6) and `hydrantRefillUnitsPerS` (25).
//
// Exactness. Water changes by a rate × DT_S each tick (0.1 and 0.41666… units), which doubles cannot hold
// exactly, so every change is rounded to a multiple of WATER_QUANTUM (1/600 unit): the per-tick amount of any
// whole number of units per second is a whole number of quanta, so the rounding never changes a rate, and the
// tank is exactly 94 after 60 ticks of spray from 100 and exactly 100 after 240 ticks at a hydrant from 0. The
// water is clamped to [0, capacity] after every change.
//
// Two entry points, at two places in the tick (TECHNICAL_DESIGN §5.2; SSP-065 wires both in):
//   - stepWater, phase 5: the hydrant refill, then the spray. Holding SPRAY (InputFrame.buttons BUTTON.SPRAY)
//     with water in the tank sprays this tick: it uses sprayUnitsPerS × DT_S (never below 0) and records the
//     cone's world pose for the cone test. With an empty tank SPRAY does nothing (`sprayHeld` is still set, for
//     the dry-pump sound, SSP-182).
//   - cleanStainsInCone, phase 6 (Dirt): every stain whose centre is in this tick's cone gets one tick of spray;
//     a stain that reaches its spray time is scored once (EV.StainCleaned) and removed.
//
// Spray cone (decided in SSP-061, tuning.json → water; GDD §8.5), vehicle-local: a triangle with its apex on
// the centre line at y = sprayConeApexYM (+1.625, the front bumper), running sprayConeLengthM (2.6 m) forward
// and widening linearly to sprayConeEndWidthM (2.6 m, the swept brush band) at its far end (y = +4.225). A
// point is in the cone when 0 ≤ along ≤ length and |across| ≤ (endWidth / 2) × along / length (edges
// inclusive), with `along` measured forward from the apex.
//
// Hydrant refill (decided in SSP-061): Bessie is "stopped adjacent" to a hydrant (`prop.hydrant`, positions from
// the compiled level's props) when her speed sqrt(vLong² + vLat²) is below hydrantMaxSpeedMps (0.5 m/s, the
// same "stopped" as the depot bay) and some hydrant's centre is within hydrantReachM (1.5 m) of her body OBB
// (1.75 × 3.25 m). Then the tank gains hydrantRefillUnitsPerS × DT_S, capped at capacity: an empty base tank
// refills in 240 ticks (4.0 s). Spraying while refilling is allowed; the refill is applied first.
//
// Depot bay: refillWater (to full) is called by shift.ts when a depot dump starts (SSP-062), and at shift
// setup (SSP-065).
//
// Hot path: stepWater and cleanStainsInCone allocate nothing (§17). Hydrants are scanned linearly (a district has
// at most 6).

import { DT_S } from './constants.ts';
import { EV, type EventQueue, emitEvent } from './eventQueue.ts';
import { cos, sin } from './fmath.ts';
import { BUTTON, type InputFrame } from './inputFrame.ts';
import type { Level } from './map.ts';
import { cleanStainTick, removeStain, type StainStore } from './stains.ts';
import type { SweeperTuning, Tuning, WaterTuning } from './tuning.ts';
import type { VehicleState } from './vehicle.ts';

/** Water amounts are rounded to multiples of this (1/600 unit): see the header. */
export const WATER_QUANTUM = 1 / 600;

/** The static prop id of a hydrant in the compiled level's props. */
export const HYDRANT_PROP_ID = 'prop.hydrant';

/** Bessie's water system. Create with createWater; only the sim writes it. */
export type Water = {
  /** Holds `water`, the units in the tank (0..capacity). */
  readonly vehicle: VehicleState;
  /** tuning.json → water (tank, rates, cone, hydrant adjacency). Change it through setWaterTuning. */
  tuning: WaterTuning;
  /** Bessie's body (vehicle.sweeper.body) for the hydrant reach test. Replaced by setWaterTuning. */
  body: SweeperTuning['body'];
  /** Hydrant centres, metres (from level.props), in level order. */
  readonly hydrantX: Float64Array;
  readonly hydrantY: Float64Array;
  /** SPRAY was held this tick (with or without water). */
  sprayHeld: boolean;
  /** Spraying this tick: SPRAY held with water in the tank. The cone fields below are valid only then. */
  spraying: boolean;
  /** The hydrant refill added water this tick. */
  refilling: boolean;
  /** This tick's cone apex, world metres. */
  coneApexX: number;
  coneApexY: number;
  /** Bessie's right and forward unit axes at the last stepWater (or isAtHydrant). */
  rightX: number;
  rightY: number;
  forwardX: number;
  forwardY: number;
};

/** What render, audio and UI may see: the same object, typed read-only all the way down. */
export type WaterView = {
  readonly vehicle: Readonly<VehicleState>;
  readonly tuning: WaterTuning;
  readonly body: SweeperTuning['body'];
  readonly hydrantX: Float64Array;
  readonly hydrantY: Float64Array;
  readonly sprayHeld: boolean;
  readonly spraying: boolean;
  readonly refilling: boolean;
  readonly coneApexX: number;
  readonly coneApexY: number;
  readonly rightX: number;
  readonly rightY: number;
  readonly forwardX: number;
  readonly forwardY: number;
};

/** Round `units` to WATER_QUANTUM and clamp it to [0, capacity]. */
function settle(units: number, capacity: number): number {
  const q = Math.round(units / WATER_QUANTUM) * WATER_QUANTUM;
  return q <= 0 ? 0 : q > capacity ? capacity : q;
}

/**
 * The water system of `vehicle` on `tuning`, with the hydrants of `level`. The tank keeps the vehicle's current
 * water (clamped to the capacity); call refillWater for the full tank a shift starts with. Setup only.
 */
export function createWater(vehicle: VehicleState, tuning: Tuning, level: Level): Water {
  let n = 0;
  for (const p of level.props) if (p.id === HYDRANT_PROP_ID) n += 1;
  const hydrantX = new Float64Array(n);
  const hydrantY = new Float64Array(n);
  let k = 0;
  for (const p of level.props) {
    if (p.id !== HYDRANT_PROP_ID) continue;
    hydrantX[k] = p.x;
    hydrantY[k] = p.y;
    k += 1;
  }
  vehicle.water = settle(vehicle.water, tuning.water.tankUnits);
  return {
    vehicle,
    tuning: tuning.water,
    body: tuning.vehicle.sweeper.body,
    hydrantX,
    hydrantY,
    sprayHeld: false,
    spraying: false,
    refilling: false,
    // Fractional values first so the fields start as doubles (TECHNICAL_DESIGN §17, deprecated maps).
    coneApexX: 0.5,
    coneApexY: 0.5,
    rightX: 0.5,
    rightY: 0.5,
    forwardX: 0.5,
    forwardY: 0.5,
  };
}

/** The read-only view of `water`. No copy: it is the same object. */
export function viewWater(water: Water): WaterView {
  return water;
}

/**
 * Hand the water system a new tuning between ticks (the dev panel, SSP-048; the upgrade modifiers, SSP-188):
 * the tank is clamped to the new capacity.
 */
export function setWaterTuning(water: Water, tuning: Tuning): void {
  water.tuning = tuning.water;
  water.body = tuning.vehicle.sweeper.body;
  water.vehicle.water = settle(water.vehicle.water, tuning.water.tankUnits);
}

/** The tank capacity in water units (water.tankUnits). */
export function waterCapacity(water: WaterView): number {
  return water.tuning.tankUnits;
}

/** The tank's fill fraction, 0..1 (the HUD water bar). */
export function waterFill(water: WaterView): number {
  return water.vehicle.water / water.tuning.tankUnits;
}

/**
 * What refillWater needs: the vehicle holding the tank and the water tuning giving its capacity. A Water is
 * one: since SSP-065 the World hands its Water to createShift as the depot's tank.
 */
export type WaterTank = { readonly vehicle: VehicleState; readonly tuning: WaterTuning };

/** Fill the tank to capacity: the depot bay on a dump (shift.ts, SSP-062) and shift setup (SSP-065). */
export function refillWater(water: WaterTank): void {
  water.vehicle.water = water.tuning.tankUnits;
}

/**
 * Add `units` to the tank at once, capped at capacity (pwr.water_can's +50, pickups.ts, SSP-096). Rounded to
 * WATER_QUANTUM like every other change. Not per tick: only on the tick a pickup is collected.
 */
export function addWater(water: WaterTank, units: number): void {
  water.vehicle.water = settle(water.vehicle.water + units, water.tuning.tankUnits);
}

/** Write Bessie's right and forward unit axes for her current heading into `water` (the only trig here). */
function writeAxes(water: Water): void {
  const h = water.vehicle.headingRad;
  const c = cos(h);
  const s = sin(h);
  // right = (c, s), forward = (s, −c) (src/sim/coords.ts).
  water.rightX = c;
  water.rightY = s;
  water.forwardX = s;
  water.forwardY = -c;
}

/**
 * The hydrant test on the axes already in `water`. It calls nothing: it runs only on the ticks Bessie is
 * stopped, so it may still be in Maglev code when they come, and there a call taking or returning a double
 * (fmath's cos and sin) boxes it (16 B each; found by the heap-delta test).
 */
function hydrantInReach(water: WaterView): boolean {
  const v = water.vehicle;
  const t = water.tuning;
  const speed2 = v.vLongMps * v.vLongMps + v.vLatMps * v.vLatMps;
  if (!(speed2 < t.hydrantMaxSpeedMps * t.hydrantMaxSpeedMps)) return false;
  const n = water.hydrantX.length;
  const hw = water.body.widthM / 2;
  const hl = water.body.lengthM / 2;
  const reach2 = t.hydrantReachM * t.hydrantReachM;
  const rx = water.rightX;
  const ry = water.rightY;
  const fx = water.forwardX;
  const fy = water.forwardY;
  for (let k = 0; k < n; k += 1) {
    const dx = (water.hydrantX[k] as number) - v.xM;
    const dy = (water.hydrantY[k] as number) - v.yM;
    const lx = dx * rx + dy * ry;
    const ly = dx * fx + dy * fy;
    const ax = lx < 0 ? -lx : lx;
    const ay = ly < 0 ? -ly : ly;
    const ex = ax > hw ? ax - hw : 0;
    const ey = ay > hl ? ay - hl : 0;
    if (ex * ex + ey * ey <= reach2) return true;
  }
  return false;
}

/**
 * True when Bessie is stopped adjacent to a hydrant at her current pose and speed: speed below
 * hydrantMaxSpeedMps and some hydrant centre within hydrantReachM of her body OBB (see the header). Refreshes
 * the axes in `water`, as stepWater does.
 */
export function isAtHydrant(water: Water): boolean {
  writeAxes(water);
  return hydrantInReach(water);
}

/**
 * Phase 5 (see the header): the hydrant refill, then the spray. Reads InputFrame.buttons (BUTTON.SPRAY) and
 * Bessie's pose and speed after phase 3. Allocation-free.
 */
export function stepWater(water: Water, input: Readonly<InputFrame>): void {
  const v = water.vehicle;
  const t = water.tuning;
  const capacity = t.tankUnits;
  writeAxes(water);

  // The quantise-and-clamp of settle() is written out inline here: a call that V8 does not inline boxes a
  // returned double (16 B), and this runs on most ticks.
  water.refilling = false;
  if (v.water < capacity && hydrantInReach(water)) {
    const w = Math.round((v.water + t.hydrantRefillUnitsPerS * DT_S) / WATER_QUANTUM) * WATER_QUANTUM;
    v.water = w > capacity ? capacity : w;
    water.refilling = true;
  }

  const held = (input.buttons & BUTTON.SPRAY) !== 0;
  water.sprayHeld = held;
  water.spraying = held && v.water > 0;
  if (!water.spraying) return;
  const w = Math.round((v.water - t.sprayUnitsPerS * DT_S) / WATER_QUANTUM) * WATER_QUANTUM;
  v.water = w <= 0 ? 0 : w > capacity ? capacity : w;
  water.coneApexX = v.xM + water.forwardX * t.sprayConeApexYM;
  water.coneApexY = v.yM + water.forwardY * t.sprayConeApexYM;
}

/**
 * True when (xM, yM) is inside this tick's spray cone (edges inclusive). Valid only while `water.spraying`;
 * false otherwise.
 */
export function isInSprayCone(water: WaterView, xM: number, yM: number): boolean {
  if (!water.spraying) return false;
  const t = water.tuning;
  const dx = xM - water.coneApexX;
  const dy = yM - water.coneApexY;
  const along = dx * water.forwardX + dy * water.forwardY;
  if (!(along >= 0 && along <= t.sprayConeLengthM)) return false;
  const across = dx * water.rightX + dy * water.rightY;
  const a = across < 0 ? -across : across;
  // |across| ≤ (endWidth / 2) × along / length, multiplied out.
  return a * t.sprayConeLengthM <= (t.sprayConeEndWidthM / 2) * along;
}

/**
 * Phase 6 (Dirt; SSP-065 calls it there): while spraying, give every stain whose centre is in the cone one tick
 * of spray, in index order. A stain that reaches its spray time emits EV.StainCleaned (entity = its kind, the
 * STAIN_IDS index; a = x, b = y; c = its points from entities.json: scoring applies them with the combo, SSP-063),
 * counts in stainsCleaned and is swap-removed (the stain moved into its slot is tested next). Returns how many
 * stains were cleaned. Allocation-free.
 */
export function cleanStainsInCone(water: WaterView, stains: StainStore, events: EventQueue): number {
  if (!water.spraying) return 0;
  // isInSprayCone, written out inline: it takes doubles, which a call V8 does not inline would box (§17).
  const len = water.tuning.sprayConeLengthM;
  const halfEnd = water.tuning.sprayConeEndWidthM / 2;
  const ax = water.coneApexX;
  const ay = water.coneApexY;
  const fx = water.forwardX;
  const fy = water.forwardY;
  const rx = water.rightX;
  const ry = water.rightY;
  let cleaned = 0;
  let i = 0;
  while (i < stains.count) {
    const x = stains.x[i] as number;
    const y = stains.y[i] as number;
    const dx = x - ax;
    const dy = y - ay;
    const along = dx * fx + dy * fy;
    const across = dx * rx + dy * ry;
    const inCone = along >= 0 && along <= len && (across < 0 ? -across : across) * len <= halfEnd * along;
    if (!inCone || !cleanStainTick(stains, i)) {
      i += 1;
      continue;
    }
    const kind = stains.kind[i] as number;
    const e = emitEvent(events, EV.StainCleaned, kind);
    events.a[e] = x;
    events.b[e] = y;
    events.c[e] = stains.kinds.pts[kind] as number;
    stains.stainsCleaned += 1;
    removeStain(stains, i);
    cleaned += 1;
  }
  return cleaned;
}
