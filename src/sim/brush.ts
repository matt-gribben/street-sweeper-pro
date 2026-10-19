// Bessie's brush (GDD §8.1–§8.3, TECHNICAL_DESIGN §8.3, §10.1, §10.2; SSP-059): the raise/lower and RPM state
// machine, and what the brush does to the LitterField while it collects: the gutter sweep-in, the suction pull,
// the fling roll, inlet collection and, at a full hopper, bulldozing.
//
// Two entry points, at two places in the tick (TECHNICAL_DESIGN §5.2):
//   - stepBrushState, phase 2, before stepVehicle: consumes the BRUSH pressed edge, advances the lower/raise and
//     spin timers and writes VehicleState.brushDown / brushPos / rpm. `brushDown` is the top-speed flag: it is
//     true from the tick lowering starts until the brush is fully raised again, so the 6.0 m/s brush-down cap
//     applies through Lowering, SpinningUp, Collecting, Bulldozing and Raising (GDD §8.2).
//   - stepBrushLitter, phase 5, after beginLitterTick and before stepLitter (wired by SSP-065): gutter,
//     suction, fling, inlet and bulldozer against the LitterField. It sets one-tick pushes that stepLitter then
//     applies, so an item moves on the tick the brush acts on it.
//
// States (GDD §8.2): Raised → Lowering (Space) → SpinningUp (after raiseLowerS, 30 ticks) → Collecting (once
// rpm ≥ collectMinRpm; spin-up to full takes spinUpS, 36 ticks) ⇄ Bulldozing (while the hopper is full);
// Space from Lowering, SpinningUp, Collecting or Bulldozing → Raising → Raised (after raiseLowerS). Space
// during Raising lowers again (and during Lowering raises again) from where the brush is, so a reversal takes
// as long as the travel already made. brushPos counts whole ticks (posTicks / lowerTicks), so it is exactly 0
// or 1 at the ends. RPM rises only while the brush is fully lowered and spins down otherwise, over spinDownS
// from full (tuning; 0 means it drops to 0 the moment Raising starts, SSP-059's decision).
//
// Geometry, vehicle-local (+x right, +y forward, metres, origin at the body centre; tuning.json → sweeping):
//   gutter circles  r 0.45 at (±0.85, +1.75): push toward x = 0 at sweepInMps and backward at sweepBackMps
//   suction rect    x ∈ [−1.3, 1.3], y ∈ [+1.6, +2.8]: pull toward the inlet centre at pullMps × rpm × suctionMult
//   throat          x ∈ [−1.3, 1.3], y ∈ [inlet front edge +1.4, +1.6): pulled like the suction rect (SSP-059),
//                   so an item the suction drew out of the rect's back edge with Bessie stopped still reaches
//                   the inlet instead of stalling 0.2 m short of it
//   inlet           1.0 × 0.4 m centred at (0, +1.2): an item whose centre is inside is collected
// The brush zone is the union of all four. While collecting, every item in it is IN_SUCTION if it is in the
// suction rect or the throat (the wobble animation).
//
// Fling roll (GDD §8.3, TECHNICAL_DESIGN §10.2): the first tick an item is in the brush zone in a contact
// episode it rolls p = clamp((v − t0) / (flingCertainMps − cleanPickupMaxMps), 0, 1) with v = |vLong| and
// t0 = cleanPickupMaxMps (4.0), or flingThresholdMps when set (pwr.super_suction: 6.0, M3). One nextFloat on
// the `brush` stream decides when 0 < p < 1; p = 0 never flings and p = 1 always does, with no draw. A fling
// calls flingLitter (one more draw, the distance) and emits EV.Fling. The episode (LitterFlag.BrushContact)
// ends when the item is outside the brush zone at the start of a brush step, when the brush stops collecting,
// or when it is flung (a landed item that is in the zone again rolls again).
//
// Collection: an inlet item is collected unless the hopper is full: EV.LitterCollected (entity = its index,
// x, y, kind), then addToHopper with the kind's LU (which may emit EV.HopperFull and turns the state to
// Bulldozing at once, so the rest of this tick's inlet items are bulldozed), then collectLitter (counts
// litterCollected and swap-removes it).
//
// Bulldozer (TECHNICAL_DESIGN §10.2): while the hopper is full, an item in the inlet mouth (x within the
// inlet's width, y from the inlet's back edge up to the pin line) becomes PINNED and is held on the pin line,
// pinAheadM ahead of the front bumper (body.lengthM / 2), at its own x clamped to the inlet's width: it is
// pushed along as Bessie drives. stepLitter leaves pinned items alone. No LU is added. When the hopper is no
// longer full (a dump) pinned items are released into the suction and collected; when the brush stops they
// are released where they are.
//
// Determinism: items are visited in queryLitter's order (deterministic), RNG draws happen only in that order,
// and the timers are integer tick counts. Hot path: both step functions allocate nothing; the query box and
// the hit list are preallocated on the Brush (§17).

import type { Aabb } from './collision/obb.ts';
import { DT_S, SIM_HZ } from './constants.ts';
import { EV, type EventQueue, emitEvent } from './eventQueue.ts';
import { cos, sin, sqrt } from './fmath.ts';
import { addToHopper, type Hopper } from './hopper.ts';
import { type InputFrame, PRESSED } from './inputFrame.ts';
import {
  collectLitter,
  flingLitter,
  LITTER_CAPACITY,
  type LitterField,
  LitterFlag,
  localRectToWorldAabb,
  queryLitter,
  updateLitterCell,
} from './litter.ts';
import { createStream, nextFloat, type Sfc32 } from './rng.ts';
import type { Tuning } from './tuning.ts';
import type { VehicleState } from './vehicle.ts';

/** Brush states (GDD §8.2). Hashed into replays from SSP-065: append, never renumber. */
export const BrushState = {
  Raised: 0,
  Lowering: 1,
  SpinningUp: 2,
  Collecting: 3,
  Bulldozing: 4,
  Raising: 5,
} as const;
export type BrushState = (typeof BrushState)[keyof typeof BrushState];

/**
 * The brush query box is the brush zone's bounding box grown by this much on every side, in metres, so an item
 * that was in the zone last tick is still found (and has its flags cleared) after it leaves. One tick moves an
 * item relative to Bessie by well under 0.5 m (17.2 m/s × DT is 0.29 m); a fling clears the flags itself.
 */
export const BRUSH_QUERY_MARGIN_M = 1;

/** Item flags the brush owns: cleared when an item leaves the brush zone or the brush stops collecting. */
const BRUSH_FLAGS = LitterFlag.InSuction | LitterFlag.Pinned | LitterFlag.BrushContact;

/** The brush of one sweeper. Create with createBrush; only the sim writes it. */
export type Brush = {
  state: BrushState;
  /** Ticks of lowering travel made, 0..lowerTicks (integer): brushPos = posTicks / lowerTicks. */
  posTicks: number;
  /** Spin, in spin-up ticks, 0..spinUpTicks (fractional only while spinning down): rpm = rpmTicks / spinUpTicks. */
  rpmTicks: number;
  /** The tuning it runs on (vehicle.sweeper.brush, vehicle.sweeper.body, sweeping). Replaced by setWorldTuning. */
  tuning: Tuning;
  /** Suction multiplier (upg.suction +25% / +50%, pwr.super_suction ×2). Default 1. */
  suctionMult: number;
  /** Fling threshold t0 override in m/s (pwr.super_suction: 6.0, M3), or null for brush.cleanPickupMaxMps. */
  flingThresholdMps: number | null;
  /** The `brush` stream, sfc32(seed ^ hash32('brush')): fling rolls and fling distances. */
  readonly rng: Sfc32;
  /** True when the last brush step left brush flags on some item (so a stopped brush still clears them). */
  anyFlagged: boolean;
  /** Query scratch: the zone box in vehicle-local and world space, and the hit list (one entry per item). */
  readonly localBox: Aabb;
  readonly worldBox: Aabb;
  readonly hits: Int32Array;
  /** True when this tick's brush step found the brush collecting (isBrushCollecting); set by stepBrushLitter. */
  collecting: boolean;
  /**
   * The tuning the copied numbers below (and `localBox`) were taken from, or null before the first brush step.
   * stepBrushLitter re-reads them whenever `tuning` is a different object (setWorldTuning replaces it).
   */
  constsFor: Tuning | null;
  /**
   * The tuning numbers stepBrushLitter reads, copied as plain doubles on the Brush (as dirt.ts does), so the
   * per-tick loads are monomorphic double fields rather than loads from tuning objects, whose mixed integer
   * and fractional values leave their fields tagged (stores derived from them boxed every tick; SSP-065).
   */
  cGutterX: number;
  cGutterY: number;
  cGutterR2: number;
  cSweepIn: number;
  cSweepBack: number;
  cSuctionMinX: number;
  cSuctionMaxX: number;
  cSuctionMaxY: number;
  cInletX: number;
  cInletY: number;
  cInletMinX: number;
  cInletMaxX: number;
  cInletMinY: number;
  cInletMaxY: number;
  cPinY: number;
  cPullMps: number;
  cCollectMinRpm: number;
  cCleanPickupMaxMps: number;
  cFlingRampMps: number;
  /** Pull scratch: the item's offset to the inlet centre and its length (pullLength). */
  pullTx: number;
  pullTy: number;
  pullDist: number;
};

/** What render, audio and UI may see: the same object, typed read-only. */
export type BrushView = {
  readonly state: BrushState;
  readonly posTicks: number;
  readonly rpmTicks: number;
  readonly suctionMult: number;
  readonly flingThresholdMps: number | null;
};

/**
 * A raised, still brush on `tuning`, with its RNG on the `brush` stream of `seed`. `capacity` must be at least
 * the LitterField's (LITTER_CAPACITY in the game): it sizes the hit list. Allocated once per shift.
 */
export function createBrush(tuning: Tuning, seed: number, capacity: number = LITTER_CAPACITY): Brush {
  if (!Number.isInteger(capacity) || capacity < 1) {
    throw new Error(`createBrush: capacity must be a positive integer, got ${capacity}`);
  }
  const brush: Brush = {
    state: BrushState.Raised,
    posTicks: 0,
    // Fractional first so the field starts as a double: it is fractional while spinning down (§17).
    rpmTicks: 0.5,
    tuning,
    suctionMult: 1,
    flingThresholdMps: null,
    rng: createStream(seed >>> 0, 'brush'),
    anyFlagged: false,
    // Fractional values first so the fields start as doubles (TECHNICAL_DESIGN §17, deprecated maps).
    localBox: { minX: 0.5, minY: 0.5, maxX: 0.5, maxY: 0.5 },
    worldBox: { minX: 0.5, minY: 0.5, maxX: 0.5, maxY: 0.5 },
    hits: new Int32Array(capacity),
    collecting: false,
    constsFor: null,
    cGutterX: 0.5,
    cGutterY: 0.5,
    cGutterR2: 0.5,
    cSweepIn: 0.5,
    cSweepBack: 0.5,
    cSuctionMinX: 0.5,
    cSuctionMaxX: 0.5,
    cSuctionMaxY: 0.5,
    cInletX: 0.5,
    cInletY: 0.5,
    cInletMinX: 0.5,
    cInletMaxX: 0.5,
    cInletMinY: 0.5,
    cInletMaxY: 0.5,
    cPinY: 0.5,
    cPullMps: 0.5,
    cCollectMinRpm: 0.5,
    cCleanPickupMaxMps: 0.5,
    cFlingRampMps: 0.5,
    pullTx: 0.5,
    pullTy: 0.5,
    pullDist: 0.5,
  };
  brush.rpmTicks = 0;
  return brush;
}

/** The read-only view of `brush`. No copy: it is the same object. */
export function viewBrush(brush: Brush): BrushView {
  return brush;
}

/** Ticks a full lower or raise takes: raiseLowerS × 60, rounded, at least 1 (0.5 s → 30). */
export function brushLowerTicks(tuning: Tuning): number {
  return Math.max(1, Math.round(tuning.vehicle.sweeper.brush.raiseLowerS * SIM_HZ));
}

/** Ticks a full spin-up takes: spinUpS × 60, rounded, at least 1 (0.6 s → 36). */
export function brushSpinUpTicks(tuning: Tuning): number {
  return Math.max(1, Math.round(tuning.vehicle.sweeper.brush.spinUpS * SIM_HZ));
}

/** Ticks a full spin-down takes: spinDownS × 60, rounded; 0 means RPM drops to 0 at once. */
export function brushSpinDownTicks(tuning: Tuning): number {
  return Math.round(tuning.vehicle.sweeper.brush.spinDownS * SIM_HZ);
}

/**
 * True when the brush collects litter (and erases grime, SSP-060): it is Collecting or Bulldozing, fully
 * lowered (brushPos == 1) and spinning at rpm ≥ collectMinRpm (TECHNICAL_DESIGN §8.3).
 */
export function isBrushCollecting(
  brush: BrushView,
  vehicle: Readonly<VehicleState>,
  tuning: Tuning,
): boolean {
  const s = brush.state;
  return (
    (s === BrushState.Collecting || s === BrushState.Bulldozing) &&
    vehicle.brushPos === 1 &&
    vehicle.rpm >= tuning.vehicle.sweeper.brush.collectMinRpm
  );
}

/**
 * The fling probability for an item touched at Bessie's speed `speedMps` (GDD §8.3): 0 up to the threshold t0
 * (brush.cleanPickupMaxMps, or the brush's flingThresholdMps override), rising linearly over the ramp width
 * (flingCertainMps − cleanPickupMaxMps, 2.0 m/s) to 1. `speedMps` is |vLong|.
 */
export function flingProbability(brush: BrushView, tuning: Tuning, speedMps: number): number {
  const b = tuning.vehicle.sweeper.brush;
  const t0 = brush.flingThresholdMps ?? b.cleanPickupMaxMps;
  const p = (speedMps - t0) / (b.flingCertainMps - b.cleanPickupMaxMps);
  return p > 0 ? (p < 1 ? p : 1) : 0;
}

// ---------------------------------------------------------------------------------------------------------
// Phase 2: the state machine
// ---------------------------------------------------------------------------------------------------------

/**
 * Phase 2, before stepVehicle: apply this tick's BRUSH pressed edge, advance the lower/raise and spin timers,
 * move between Collecting and Bulldozing with the hopper's full flag, and write vehicle.brushDown (the top-speed
 * flag: any state but Raised), vehicle.brushPos and vehicle.rpm. Allocation-free.
 */
export function stepBrushState(
  brush: Brush,
  vehicle: VehicleState,
  input: Readonly<InputFrame>,
  hopperFull: boolean,
): void {
  const tuning = brush.tuning;
  const lowerTicks = brushLowerTicks(tuning);
  const spinUpTicks = brushSpinUpTicks(tuning);
  const spinDownTicks = brushSpinDownTicks(tuning);
  // A tuning change between ticks can shorten either timer.
  if (brush.posTicks > lowerTicks) brush.posTicks = lowerTicks;
  if (brush.rpmTicks > spinUpTicks) brush.rpmTicks = spinUpTicks;

  let s = brush.state;
  if ((input.pressed & PRESSED.BRUSH) !== 0) {
    s = s === BrushState.Raised || s === BrushState.Raising ? BrushState.Lowering : BrushState.Raising;
  }

  let spinning = false;
  if (s === BrushState.Lowering) {
    brush.posTicks += 1;
    if (brush.posTicks >= lowerTicks) {
      brush.posTicks = lowerTicks;
      s = BrushState.SpinningUp;
    }
  } else if (s === BrushState.Raising) {
    brush.posTicks -= 1;
    if (brush.posTicks <= 0) {
      brush.posTicks = 0;
      s = BrushState.Raised;
    }
  } else if (s !== BrushState.Raised) {
    // SpinningUp, Collecting, Bulldozing: fully lowered, spinning up toward full.
    spinning = true;
    brush.rpmTicks = brush.rpmTicks + 1 < spinUpTicks ? brush.rpmTicks + 1 : spinUpTicks;
  }
  if (!spinning) {
    if (spinDownTicks === 0 || s === BrushState.Raised) {
      brush.rpmTicks = 0;
    } else {
      const next = brush.rpmTicks - spinUpTicks / spinDownTicks;
      brush.rpmTicks = next > 0 ? next : 0;
    }
  }

  const rpm = brush.rpmTicks / spinUpTicks;
  if (s === BrushState.SpinningUp && rpm >= tuning.vehicle.sweeper.brush.collectMinRpm) {
    s = hopperFull ? BrushState.Bulldozing : BrushState.Collecting;
  } else if (s === BrushState.Collecting && hopperFull) {
    s = BrushState.Bulldozing;
  } else if (s === BrushState.Bulldozing && !hopperFull) {
    s = BrushState.Collecting;
  }

  brush.state = s;
  vehicle.brushDown = s !== BrushState.Raised;
  vehicle.brushPos = brush.posTicks / lowerTicks;
  vehicle.rpm = rpm;
}

// ---------------------------------------------------------------------------------------------------------
// Phase 5: brush vs litter
// ---------------------------------------------------------------------------------------------------------

/**
 * Write the brush zone's vehicle-local bounding box, grown by BRUSH_QUERY_MARGIN_M, into `out`: the union of
 * the gutter circles, the suction rect (with the throat) and the inlet.
 */
function brushZoneBox(tuning: Tuning, out: Aabb): void {
  const sw = tuning.sweeping;
  const g = sw.gutterBrush;
  const su = sw.suction;
  const inl = sw.inlet;
  const m = BRUSH_QUERY_MARGIN_M;
  const inletMinX = inl.centreXM - inl.widthM / 2;
  const inletMaxX = inl.centreXM + inl.widthM / 2;
  const inletMinY = inl.centreYM - inl.depthM / 2;
  let minX = su.minXM < -(g.centreXM + g.radiusM) ? su.minXM : -(g.centreXM + g.radiusM);
  if (inletMinX < minX) minX = inletMinX;
  let maxX = su.maxXM > g.centreXM + g.radiusM ? su.maxXM : g.centreXM + g.radiusM;
  if (inletMaxX > maxX) maxX = inletMaxX;
  let minY = g.centreYM - g.radiusM < inletMinY ? g.centreYM - g.radiusM : inletMinY;
  if (su.minYM < minY) minY = su.minYM;
  const maxY = su.maxYM > g.centreYM + g.radiusM ? su.maxYM : g.centreYM + g.radiusM;
  out.minX = minX - m;
  out.maxX = maxX + m;
  out.minY = minY - m;
  out.maxY = maxY + m;
}

/** brush.pullDist = |(pullTx, pullTy)|. Takes only the Brush, so no double crosses the call. */
function pullLength(brush: Brush): void {
  const tx = brush.pullTx;
  const ty = brush.pullTy;
  brush.pullDist = sqrt(tx * tx + ty * ty);
}

/** Copy the numbers stepBrushLitter reads from `brush.tuning` onto the Brush (see Brush.constsFor). */
function applyBrushConsts(brush: Brush): void {
  const tuning = brush.tuning;
  const sw = tuning.sweeping;
  const g = sw.gutterBrush;
  const su = sw.suction;
  const inl = sw.inlet;
  const bt = tuning.vehicle.sweeper.brush;
  brush.cGutterX = g.centreXM;
  brush.cGutterY = g.centreYM;
  brush.cGutterR2 = g.radiusM * g.radiusM;
  brush.cSweepIn = g.sweepInMps;
  brush.cSweepBack = g.sweepBackMps;
  brush.cSuctionMinX = su.minXM;
  brush.cSuctionMaxX = su.maxXM;
  brush.cSuctionMaxY = su.maxYM;
  brush.cInletX = inl.centreXM;
  brush.cInletY = inl.centreYM;
  brush.cInletMinX = inl.centreXM - inl.widthM / 2;
  brush.cInletMaxX = inl.centreXM + inl.widthM / 2;
  brush.cInletMinY = inl.centreYM - inl.depthM / 2;
  brush.cInletMaxY = inl.centreYM + inl.depthM / 2;
  brush.cPinY = tuning.vehicle.sweeper.body.lengthM / 2 + sw.bulldozer.pinAheadM;
  brush.cPullMps = su.pullMps;
  brush.cCollectMinRpm = bt.collectMinRpm;
  brush.cCleanPickupMaxMps = bt.cleanPickupMaxMps;
  brush.cFlingRampMps = bt.flingCertainMps - bt.cleanPickupMaxMps;
  brushZoneBox(tuning, brush.localBox);
  brush.constsFor = tuning;
}

/**
 * Phase 5 (see the header): run the brush against `field` for one tick. When the brush is not collecting it
 * only clears the brush flags it left on items. Emits EV.Fling and EV.LitterCollected (and, through
 * addToHopper, EV.HopperFull) into `events`, which must be open. Allocation-free.
 */
export function stepBrushLitter(
  brush: Brush,
  field: LitterField,
  vehicle: Readonly<VehicleState>,
  hopper: Hopper,
  events: EventQueue,
): void {
  if (brush.constsFor !== brush.tuning) applyBrushConsts(brush);
  // isBrushCollecting, on the copied collectMinRpm.
  const st = brush.state;
  const active =
    (st === BrushState.Collecting || st === BrushState.Bulldozing) &&
    vehicle.brushPos === 1 &&
    vehicle.rpm >= brush.cCollectMinRpm;
  brush.collecting = active;
  if (!active && !brush.anyFlagged) return;

  const gcx = brush.cGutterX;
  const gcy = brush.cGutterY;
  const r2 = brush.cGutterR2;
  const sweepIn = brush.cSweepIn;
  const sweepBack = brush.cSweepBack;
  const suMinX = brush.cSuctionMinX;
  const suMaxX = brush.cSuctionMaxX;
  const suMaxY = brush.cSuctionMaxY;
  const icx = brush.cInletX;
  const icy = brush.cInletY;
  const inletMinX = brush.cInletMinX;
  const inletMaxX = brush.cInletMaxX;
  const inletMinY = brush.cInletMinY;
  const inletMaxY = brush.cInletMaxY;
  const pinY = brush.cPinY;
  const pull = brush.cPullMps * vehicle.rpm * brush.suctionMult;
  // flingProbability(brush, tuning, |vLong|), written out inline: a call that V8 does not inline boxes its
  // double argument and result (16 B each, every collecting tick; found by the World heap check, SSP-065).
  const t0 = brush.flingThresholdMps ?? brush.cCleanPickupMaxMps;
  const speed = vehicle.vLongMps < 0 ? -vehicle.vLongMps : vehicle.vLongMps;
  const ramp = (speed - t0) / brush.cFlingRampMps;
  const p = ramp > 0 ? (ramp < 1 ? ramp : 1) : 0;

  localRectToWorldAabb(vehicle, brush.localBox, brush.worldBox);
  const hits = brush.hits;
  const n = queryLitter(field, brush.worldBox, hits);

  // forward = (s, −c), right = (c, s) (src/sim/coords.ts); local = (d·right, d·forward).
  const c = cos(vehicle.headingRad);
  const s = sin(vehicle.headingRad);
  const px = vehicle.xM;
  const py = vehicle.yM;
  const xs = field.x;
  const ys = field.y;
  let flagged = false;

  for (let h = 0; h < n; h += 1) {
    const i = hits[h] as number;
    let flags = field.flags[i] as number;
    if ((flags & LitterFlag.Flung) !== 0) continue;
    const x = xs[i] as number;
    const y = ys[i] as number;
    const dx = x - px;
    const dy = y - py;
    const lx = dx * c + dy * s;
    const ly = dx * s - dy * c;

    const dlx = lx - gcx;
    const drx = lx + gcx;
    const dgy = ly - gcy;
    const inRightCircle = dlx * dlx + dgy * dgy <= r2;
    const inLeftCircle = drx * drx + dgy * dgy <= r2;
    const inPull = lx >= suMinX && lx <= suMaxX && ly >= inletMaxY && ly <= suMaxY;
    const inInlet = lx >= inletMinX && lx <= inletMaxX && ly >= inletMinY && ly <= inletMaxY;

    if (!active || !(inRightCircle || inLeftCircle || inPull || inInlet)) {
      if ((flags & BRUSH_FLAGS) !== 0) field.flags[i] = flags & ~BRUSH_FLAGS;
      continue;
    }

    // The fling roll, once per contact episode.
    if ((flags & LitterFlag.BrushContact) === 0) {
      flags |= LitterFlag.BrushContact;
      field.flags[i] = flags;
      if (p >= 1 || (p > 0 && nextFloat(brush.rng) < p)) {
        const kind = field.kind[i] as number;
        flingLitter(field, i, vehicle, brush.rng);
        const e = emitEvent(events, EV.Fling, i);
        events.a[e] = x;
        events.b[e] = y;
        events.c[e] = kind;
        continue;
      }
    }

    if (hopper.full) {
      // Bulldozer: pin items in the inlet mouth on the pin line ahead of the bumper.
      const inMouth = lx >= inletMinX && lx <= inletMaxX && ly >= inletMinY && ly <= pinY;
      if ((flags & LitterFlag.Pinned) !== 0 || inMouth) {
        const plx = lx < inletMinX ? inletMinX : lx > inletMaxX ? inletMaxX : lx;
        xs[i] = px + c * plx + s * pinY;
        ys[i] = py + s * plx - c * pinY;
        field.vx[i] = 0;
        field.vy[i] = 0;
        field.driftTicks[i] = 0;
        field.flags[i] = (flags | LitterFlag.Pinned) & ~LitterFlag.InSuction;
        updateLitterCell(field, i);
        flagged = true;
        continue;
      }
    } else if ((flags & LitterFlag.Pinned) !== 0) {
      flags &= ~LitterFlag.Pinned;
      field.flags[i] = flags;
    }

    if (inInlet && !hopper.full) {
      const kind = field.kind[i] as number;
      const e = emitEvent(events, EV.LitterCollected, i);
      events.a[e] = x;
      events.b[e] = y;
      events.c[e] = kind;
      addToHopper(hopper, field.kinds.lu[kind] as number, events);
      if (hopper.full) brush.state = BrushState.Bulldozing;
      const last = field.count - 1;
      collectLitter(field, i);
      // Swap-remove moved the last item into slot i: point any later hit on it at its new index.
      if (i !== last) {
        for (let k = h + 1; k < n; k += 1) if (hits[k] === last) hits[k] = i;
      }
      continue;
    }

    // Gutter sweep-in and suction pull, as a one-tick push in vehicle-local axes.
    let pvx = 0;
    let pvy = 0;
    if (inRightCircle) {
      pvx -= sweepIn;
      pvy -= sweepBack;
    }
    if (inLeftCircle) {
      pvx += sweepIn;
      pvy -= sweepBack;
    }
    if (inPull) {
      const tx = icx - lx;
      const ty = icy - ly;
      // The length goes through scratch fields: this branch is too rare a call site for V8 to inline sqrt
      // here, and a call that is not inlined boxes its double argument and result (SSP-065 World heap check).
      brush.pullTx = tx;
      brush.pullTy = ty;
      pullLength(brush);
      const dist = brush.pullDist;
      if (dist > 0) {
        // Never past the inlet centre in one tick.
        const speed = pull * DT_S < dist ? pull : dist / DT_S;
        pvx += (tx / dist) * speed;
        pvy += (ty / dist) * speed;
      }
      flags |= LitterFlag.InSuction;
    } else {
      flags &= ~LitterFlag.InSuction;
    }
    field.flags[i] = flags;
    field.vx[i] = c * pvx + s * pvy;
    field.vy[i] = s * pvx - c * pvy;
    field.driftTicks[i] = 0;
    flagged = true;
  }
  brush.anyFlagged = flagged;
}
