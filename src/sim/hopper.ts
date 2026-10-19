// Bessie's hopper (GDD §8.4, TECHNICAL_DESIGN §10.5, SSP-058): litter-unit (LU) accounting, the fill fraction
// that scales her handling (GDD §7.4, TECHNICAL_DESIGN §8.2 step 1), the bulldozer state at full, the HUD warning
// flag and the drain that dumping (shift.ts, SSP-062) runs.
//
// Where the numbers live. The LU in the hopper is `VehicleState.hopperLU` (TECHNICAL_DESIGN §8.1; already in the
// replay hash) and the capacity is the vehicle hook `VehicleParams.hopperCapacityLU` (tuning.json
// `hopper.capacityLu`, raised by upg.hopper in M6). The Hopper holds references to both, so neither is copied:
// stepVehicle reads the same two numbers through hopperFillFraction. Everything else (full flag, drain, the LU
// dumped counters) lives on the Hopper.
//
// Rules:
// - Full is `hopperLU >= capacity`, kept in `full` (the bulldozer state: the brush pushes items instead of
//   collecting them, TECHNICAL_DESIGN §10.2). EV.HopperFull fires on every transition from not full to full,
//   i.e. once per fill: it can fire again only after LU has dropped below capacity (a dump, or an M3 spill).
// - Overflow (GDD §8.4): an item that would push LU past capacity is still collected (and scored by the
//   caller), LU is clamped to capacity, the excess is lost, and the hopper becomes full. With 0.5/1/2/3/8 LU
//   items a fits-only rule could strand the hopper just below capacity and never reach full.
// - Adding to a full hopper is refused (returns false, nothing changes): the brush bulldozes instead.
// - Drain: LU leave linearly over the drain ticks. Tick k of N has drained round_q(start · k / N) LU in total,
//   rounded to LU_QUANTUM (2^−10) and exactly `start` at k = N, so every LU value the drain produces is exactly
//   representable, the hopper ends at exactly 0 and the branch on `full` never depends on rounding noise.
//   Cancelling keeps what has gone (it is dumped and counted). LU added during a drain stay in the hopper.
//
// Hot path: addToHopper and stepHopperDrain allocate nothing and return booleans (a returned double can box).

import type { EventQueue } from './eventQueue.ts';
import { EV, emitEvent } from './eventQueue.ts';
import type { HopperTuning } from './tuning.ts';
import type { VehicleParams, VehicleState } from './vehicle.ts';

/** Where a dump drains to (GDD §8.7). Only the depot pays the tipping fee, so its LU are counted separately. */
export const DumpSite = { Depot: 1, Skip: 2 } as const;
export type DumpSite = (typeof DumpSite)[keyof typeof DumpSite];

/** Drain amounts are rounded to multiples of this (2^−10 LU), which doubles represent exactly. */
export const LU_QUANTUM = 1 / 1024;

/** The hopper of one sweeper. Create with createHopper; only the sim writes it. */
export type Hopper = {
  /** Holds `hopperLU`, the LU in the hopper (0..capacity). */
  readonly vehicle: VehicleState;
  /** Holds `hopperCapacityLU`, the capacity in LU. Change it only through setHopperCapacity. */
  readonly params: VehicleParams;
  /** `warnFraction` (the HUD warning). Replaced by setWorldTuning between ticks. */
  tuning: HopperTuning;
  /** The bulldozer state: hopperLU >= capacity. */
  full: boolean;
  /** LU dumped this shift, at any site. */
  luDumpedTotal: number;
  /** LU dumped this shift at a depot bay: the tipping fee base (£1 per 5 LU, GDD §12.2, M6). */
  luDumpedDepot: number;
  /** The site of the drain in progress, or 0 when not draining. */
  drainSite: DumpSite | 0;
  /** LU in the hopper when the drain started. */
  drainStartLU: number;
  /** Length of the drain in progress, ticks. */
  drainTicks: number;
  /** Drain ticks run so far, 0..drainTicks. */
  drainTicksDone: number;
  /** LU the drain schedule has removed so far (round_q(drainStartLU · drainTicksDone / drainTicks)). */
  drainScheduledLU: number;
};

/** What render, audio and UI may see: the same object, typed read-only all the way down. */
export type HopperView = {
  readonly vehicle: Readonly<VehicleState>;
  readonly params: Readonly<VehicleParams>;
  readonly tuning: HopperTuning;
  readonly full: boolean;
  readonly luDumpedTotal: number;
  readonly luDumpedDepot: number;
  readonly drainSite: DumpSite | 0;
  readonly drainStartLU: number;
  readonly drainTicks: number;
  readonly drainTicksDone: number;
  readonly drainScheduledLU: number;
};

/**
 * The hopper of `vehicle`, with its capacity in `params.hopperCapacityLU` and the warning fraction in `tuning`.
 * `full` starts from the vehicle's current LU (no event); nothing is draining and nothing has been dumped.
 */
export function createHopper(vehicle: VehicleState, params: VehicleParams, tuning: HopperTuning): Hopper {
  return {
    vehicle,
    params,
    tuning,
    full: vehicle.hopperLU >= params.hopperCapacityLU,
    luDumpedTotal: 0,
    luDumpedDepot: 0,
    drainSite: 0,
    drainStartLU: 0,
    drainTicks: 0,
    drainTicksDone: 0,
    drainScheduledLU: 0,
  };
}

/**
 * Fill fraction f = hopperLU / capacity, clamped to 0..1 (TECHNICAL_DESIGN §8.2 step 1). The handling penalties
 * scale with f, not with absolute LU (GDD §7.4). vehicle.ts's computeHandling calls this.
 */
export function hopperFillFraction(hopperLU: number, capacityLU: number): number {
  const f = hopperLU / capacityLU;
  return f < 0 ? 0 : f > 1 ? 1 : f;
}

/** The hopper's fill fraction, 0..1. */
export function hopperFill(hopper: HopperView): number {
  return hopperFillFraction(hopper.vehicle.hopperLU, hopper.params.hopperCapacityLU);
}

/** True at full: the brush bulldozes instead of collecting (GDD §8.4). */
export function isHopperFull(hopper: HopperView): boolean {
  return hopper.full;
}

/** True at or above the HUD warning fill (hopper.warnFraction, 80%), including full. The HUD reads it. */
export function isHopperWarning(hopper: HopperView): boolean {
  return hopperFill(hopper) >= hopper.tuning.warnFraction;
}

/** True while a dump drain is in progress. */
export function isHopperDraining(hopper: HopperView): boolean {
  return hopper.drainSite !== 0;
}

/**
 * Put an item of `lu` litter units (> 0) into the hopper. Returns false, changing nothing, if the hopper is
 * already full: the caller bulldozes the item instead. Otherwise the item is collected and this returns true;
 * if it reaches or passes capacity, LU is clamped to capacity (the excess is lost), the hopper becomes full and
 * EV.HopperFull is emitted (a, b = Bessie's body centre, c = capacity in LU). Call from a tick phase (the queue
 * must be open). Allocation-free.
 */
export function addToHopper(hopper: Hopper, lu: number, events: EventQueue): boolean {
  if (!(lu > 0) || lu === Number.POSITIVE_INFINITY) throwBadLu(lu);
  if (hopper.full) return false;
  const v = hopper.vehicle;
  const capacity = hopper.params.hopperCapacityLU;
  const next = v.hopperLU + lu;
  if (next < capacity) {
    v.hopperLU = next;
    return true;
  }
  v.hopperLU = capacity;
  hopper.full = true;
  const e = emitEvent(events, EV.HopperFull, -1);
  events.a[e] = v.xM;
  events.b[e] = v.yM;
  events.c[e] = capacity;
  return true;
}

/**
 * Start draining everything now in the hopper over `drainTicks` ticks (an integer ≥ 1: the site's drainS × 60,
 * 120 at a depot bay and 180 at a skip). shift.ts (SSP-062) calls it when a dump's hold completes, then
 * stepHopperDrain once per tick. Throws if a drain is already running.
 */
export function startHopperDrain(hopper: Hopper, site: DumpSite, drainTicks: number): void {
  if (site !== DumpSite.Depot && site !== DumpSite.Skip) {
    throw new Error(`hopper: unknown dump site ${site}`);
  }
  if (!Number.isInteger(drainTicks) || drainTicks < 1) {
    throw new Error(`hopper: drainTicks must be an integer >= 1, got ${drainTicks}`);
  }
  if (hopper.drainSite !== 0) throw new Error('hopper: a drain is already in progress');
  hopper.drainSite = site;
  hopper.drainStartLU = hopper.vehicle.hopperLU;
  hopper.drainTicks = drainTicks;
  hopper.drainTicksDone = 0;
  hopper.drainScheduledLU = 0;
}

/**
 * Advance the drain by one tick: remove this tick's share of the starting LU (never more than the hopper
 * holds), count it as dumped (and as dumped at the depot for a depot bay), and clear the bulldozer state once
 * LU is below capacity. Returns true on the tick the drain completes (the drain is then over), false on every
 * other tick, including when nothing is draining. Allocation-free.
 */
export function stepHopperDrain(hopper: Hopper): boolean {
  if (hopper.drainSite === 0) return false;
  const done = hopper.drainTicksDone + 1;
  const total = hopper.drainTicks;
  const start = hopper.drainStartLU;
  const scheduled = done >= total ? start : Math.round(((start * done) / total) * 1024) * LU_QUANTUM;
  let take = scheduled - hopper.drainScheduledLU;
  hopper.drainScheduledLU = scheduled;
  hopper.drainTicksDone = done;
  const v = hopper.vehicle;
  if (take > v.hopperLU) take = v.hopperLU;
  if (take > 0) {
    v.hopperLU -= take;
    hopper.luDumpedTotal += take;
    if (hopper.drainSite === DumpSite.Depot) hopper.luDumpedDepot += take;
    if (hopper.full && v.hopperLU < hopper.params.hopperCapacityLU) hopper.full = false;
  }
  if (done < total) return false;
  hopper.drainSite = 0;
  return true;
}

/**
 * Stop a drain part-way (Bessie left the bay, GDD §8.7). LU already drained stay gone and stay counted as
 * dumped; the rest stay in the hopper. Does nothing when nothing is draining.
 */
export function cancelHopperDrain(hopper: Hopper): void {
  hopper.drainSite = 0;
}

/**
 * Set the capacity (dev-panel tuning, setWorldTuning; upg.hopper at shift start, M6). Clamps LU to the new
 * capacity and recomputes `full` without emitting EV.HopperFull (this runs between ticks). Cold path.
 */
export function setHopperCapacity(hopper: Hopper, capacityLU: number): void {
  if (!(capacityLU > 0) || capacityLU === Number.POSITIVE_INFINITY) {
    throw new Error(`hopper: capacity must be a finite number > 0, got ${capacityLU}`);
  }
  hopper.params.hopperCapacityLU = capacityLU;
  const v = hopper.vehicle;
  if (v.hopperLU > capacityLU) v.hopperLU = capacityLU;
  hopper.full = v.hopperLU >= capacityLU;
}

function throwBadLu(lu: number): never {
  throw new Error(`hopper: an item's LU must be a finite number > 0, got ${lu}`);
}
