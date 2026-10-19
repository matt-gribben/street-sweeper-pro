// The penalty log (GDD §11, TECHNICAL_DESIGN §5.2 and §10.6; SSP-078): the one penalty API every offence uses.
// A system that catches an offence during phases 2–8 (an NPC hit, a splash, a Lead Tangle, the brush-up dog-mess
// splat in phase 5) appends a penalty fact here; phase 9 consumes every fact of the tick, in order
// (complaints.ts applyPenalties): the points come off the score, the combo chain resets to 0, the complaints are
// added to the meter (one EV.Complaint each) and the police-witness hook is asked for an extra one. Horn spam
// (complaints.ts stepHornSpam) appends its Noise fact at the start of phase 9, before they are consumed.
//
//     const i = pushPenalty(world.penalties, Offence.Hit, -250, 1);
//     world.penalties.x[i] = xM;   // where it happened, sim metres (EV.Complaint carries it; the police
//     world.penalties.y[i] = yM;   // witness rule, M6, measures from it)
//
// A fact is (reason, pts, complaints, x, y): `reason` is an Offence code (complaints.ts), `pts` an integer of 0
// or below (GDD §11.2: −10 to −500, 0 for the complaint-only offences), `complaints` an integer of 0 or more.
// Every fact counts as a penalty for the chain, whatever its points: a complaint-only offence (horn spam, Road
// Rage) resets the chain too (GDD §10.2 "any penalty resets the chain", decided in SSP-078).
//
// Hot path: pushPenalty takes and returns only small integers and the caller writes the position into the
// returned slot, like emitEvent (eventQueue.ts): V8 boxes the double arguments of a call it does not inline.
// The log is preallocated (PENALTIES_PER_TICK facts) and emptied by phase 9 every tick, so it is always empty
// between ticks. More than PENALTIES_PER_TICK facts in one tick is a programmer error and throws.
import type { Offence } from './complaints.ts';
import type { PenaltyHook } from './stains.ts';

/** Penalty facts one tick may record. A tick holds a handful at most (every hit has a 1.5 s ignore window). */
export const PENALTIES_PER_TICK = 64;

/** This tick's penalty facts, struct of arrays. Only the sim writes it. */
export type PenaltyLog = {
  /** Facts recorded this tick, 0..PENALTIES_PER_TICK; 0 between ticks. */
  count: number;
  /** Offence code (complaints.ts Offence). */
  readonly reason: Uint8Array;
  /** Points, 0 or below. */
  readonly pts: Int32Array;
  /** Complaints, 0 or more. */
  readonly complaints: Uint8Array;
  /** Where the offence happened, sim metres. */
  readonly x: Float64Array;
  readonly y: Float64Array;
  /** Facts applied this shift (all ticks): a counter for tests and the replay hash. */
  applied: number;
};

/** What render, audio and UI may see: the same object, typed read-only. */
export type PenaltyLogView = {
  readonly count: number;
  readonly applied: number;
};

/** An empty log with room for PENALTIES_PER_TICK facts. Allocate once per World. */
export function createPenaltyLog(): PenaltyLog {
  return {
    count: 0,
    reason: new Uint8Array(PENALTIES_PER_TICK),
    pts: new Int32Array(PENALTIES_PER_TICK),
    complaints: new Uint8Array(PENALTIES_PER_TICK),
    x: new Float64Array(PENALTIES_PER_TICK),
    y: new Float64Array(PENALTIES_PER_TICK),
    applied: 0,
  };
}

function throwBadFact(reason: number, pts: number, complaints: number): never {
  throw new Error(
    `pushPenalty: a penalty is an Offence code with integer pts of 0 or below and 0..255 complaints, got ` +
      `reason ${reason}, pts ${pts}, complaints ${complaints}`,
  );
}

function throwOverflow(log: PenaltyLog): never {
  throw new Error(
    `pushPenalty: penalty ${log.count + 1} in one tick, but the log holds ${PENALTIES_PER_TICK}; a system is ` +
      'recording penalties in a loop',
  );
}

/**
 * Record a penalty fact for phase 9 and return its slot; its x and y start at 0 and the caller writes the
 * offence's position into `log.x[i]` and `log.y[i]`. Throws on a malformed fact or a full log. Allocation-free.
 */
export function pushPenalty(log: PenaltyLog, reason: Offence, pts: number, complaints: number): number {
  if (
    !(reason >= 1 && reason <= 255 && (reason | 0) === reason) ||
    !((pts | 0) === pts && pts <= 0) ||
    !(complaints >= 0 && complaints <= 255 && (complaints | 0) === complaints)
  ) {
    throwBadFact(reason, pts, complaints);
  }
  const i = log.count;
  if (i >= PENALTIES_PER_TICK) throwOverflow(log);
  log.reason[i] = reason;
  log.pts[i] = pts;
  log.complaints[i] = complaints;
  log.x[i] = 0;
  log.y[i] = 0;
  log.count = i + 1;
  return i;
}

/**
 * A stain-store penalty hook (stains.ts PenaltyHook: pts at x, y) that records a points-only fact for `reason`:
 * the brush-up dog-mess splat (Offence.Splat, −20) since SSP-078. Made once at shift start, never per tick; the
 * hook is called a few times per shift, so its double arguments may box there.
 */
export function createPenaltyHook(log: PenaltyLog, reason: Offence): PenaltyHook {
  return (pts: number, xM: number, yM: number): void => {
    const i = pushPenalty(log, reason, pts, 0);
    log.x[i] = xM;
    log.y[i] = yM;
  };
}
