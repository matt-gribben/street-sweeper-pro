// Council Complaints, the horn and the phase-9 penalty pipeline (GDD §11, ENTITY_CATALOG §3.3; TECHNICAL_DESIGN
// §5.2 phases 1, 7 and 9, §10.6; SSP-078).
//
// The meter. `count` is the shift's Council Complaints, 0..`max` (tuning.json complaints.meter.sackedAt, 5). It
// never decreases within a shift and is capped at `max`: a complaint filed at the cap is dropped (no event).
// Each complaint that lands emits EV.Complaint (a = x, b = y where the offence happened, c = its Offence code),
// so a two-complaint offence emits two. Reaching `max` is SACKED!, which ends the shift in phase 10 (SSP-079).
//
// Penalties (applyPenalties, phase 9, before stepScoring). Every fact in the tick's penalty log (penalties.ts),
// in the order recorded: its points go to scoring's penalty API (scoring.ts addPenalty, which stepScoring
// applies after the tick's pickups and which resets the chain), EV.Penalty reports it (SSP-288: the reason, the
// position and the points, for the world-space penalty popup), its complaints are filed, and the police-witness
// hook is asked for extra complaints at its position. The log is then empty. So a tick with any penalty fact
// ends with chain 0, and every fact's points come off the score exactly once.
//
// The horn (GDD §6.1, ENTITY_CATALOG §3.3–§3.4).
//   Phase 1 (stepHornInput): the tick whose InputFrame carries the HORN pressed edge consumes it and emits
//     EV.Horn (a = x, b = y: Bessie's body centre as the tick starts; c = the horn radius, tuning.json
//     streetLife.horn.radiusM, 8 m, or twoToneRadiusM, 12 m, with upg.two_tone_horn). Phase 7 delivers the
//     stimulus to the NPCs in range (SSP-082).
//   Phase 7 (markHornCaught): a honk that lands a litterbug's Caught! is flagged here by the litterbug behaviour
//     (npc/behaviours/litterbug.ts, SSP-084) and is then not counted toward horn spam.
//   Phase 9 (stepHornSpam, first in the phase): an unflagged honk joins the sliding window: the ring of counted
//     honk ticks keeps those of the last `windowTicks` (complaints.hornSpam.windowS × 60 = 300) ticks, this one
//     included (a honk at tick t keeps those at t − 299 .. t). More than `maxHonks` in it (3, or 5 with the
//     two-tone horn) records a Noise fact (0 pts, hornSpam.complaints = 1) at Bessie's position. Re-arm (proposed
//     in SSP-078): a Noise complaint clears the window, so the next one needs another maxHonks + 1 honks within
//     5 s: 4 quick honks are 1 complaint, 8 are 2, 20 are 5.
// The two-tone horn (upg.two_tone_horn, M6) is read through setTwoToneHorn, the modifier hook SSP-188's loadout
// calls at shift start (like combo.ts setComboTimerMultiplier): radius and threshold switch to their two-tone
// values in tuning.json.
//
// Police witness (GDD §11.2, M6): a penalty committed within complaints.policeWitness.radiusM (15 m) of a
// veh.police adds extraComplaints (+1). policeWitnessComplaints is the hook, called with the penalty's position
// for every fact; until veh.police exists (SSP-211) it adds nothing.
//
// Hot path: every function here except createComplaints, setComplaintsTuning and setTwoToneHorn allocates
// nothing: the honk ring is a preallocated Int32Array, and positions cross calls as (array, index) pairs, never
// as double arguments (which V8 boxes when it does not inline a call).

import { SIM_HZ } from './constants.ts';
import { EV, type EventQueue, emitEvent } from './eventQueue.ts';
import { type InputFrame, PRESSED } from './inputFrame.ts';
import { type PenaltyLog, pushPenalty } from './penalties.ts';
import { addPenalty, type Scoring } from './scoring.ts';
import type { Tuning } from './tuning.ts';

/**
 * Why a penalty was given: the reason code of a penalty fact and of the EV.Complaint it files (GDD §11.2). The
 * complaint-bearing offences come first; the points-only ones (Splat, Knock, Dent, Dust) can still file a
 * complaint through the police witness, which then carries PoliceWitness. Hashed into replays (through events):
 * append, never renumber; 0 is never a code.
 */
export const Offence = {
  /** Bessie hit a pedestrian, an animal or a cyclist (entities.json `hit`; SSP-082). */
  Hit: 1,
  /** Horn spam: more than 3 honks in 5 s (this file). */
  Noise: 2,
  /** Blocking traffic for over 10 s (SSP-089). */
  RoadRage: 3,
  /** Running a lollipop crossing or an occupied zebra. */
  Zebra: 4,
  /** Every 3rd puddle splash of a pedestrian (SSP-094). */
  Splash: 5,
  /** Driving through a dog walker's lead. */
  Tangle: 6,
  /** Cleaning stain.chalk_art while its kid is there. */
  ChalkArt: 7,
  /** Splashing or hitting the Inspector (M6). */
  Inspector: 8,
  /** The extra complaint of a penalty within 15 m of a veh.police (M6). */
  PoliceWitness: 9,
  /** Dog mess driven over with the brush up: stain.splat, −20 (stains.ts). */
  Splat: 10,
  /** A knockable body (bins, A-boards, recycling boxes; SSP-092). */
  Knock: 11,
  /** Denting a parked car. */
  Dent: 12,
  /** A pedestrian coughing in Bessie's dust (SSP-095). */
  Dust: 13,
} as const;
export type Offence = (typeof Offence)[keyof typeof Offence];

/** The complaints meter and the horn state. Create with createComplaints; only the sim writes it. */
export type Complaints = {
  /** Council Complaints this shift, 0..max. Never decreases. */
  count: number;
  /** The cap and the SACKED threshold (complaints.meter.sackedAt, 5). */
  max: number;
  /** upg.two_tone_horn fitted (setTwoToneHorn; false until M6). */
  twoToneHorn: boolean;
  /** The horn stimulus radius in metres: streetLife.horn.radiusM, or twoToneRadiusM with the two-tone horn. */
  hornRadiusM: number;
  /** Honks the window may hold without a complaint: hornSpam.maxHonks, or twoToneMaxHonks. */
  maxHonks: number;
  /** The window length, hornSpam.windowS × 60 ticks (300). */
  windowTicks: number;
  /** Complaints a Noise offence files (hornSpam.complaints, 1). */
  noiseComplaints: number;
  /** A HORN edge was consumed this tick (phase 1) and is not yet counted (phase 9). False between ticks. */
  hornThisTick: boolean;
  /** Phase 7 flagged this tick's honk as landing a Caught!. False between ticks. */
  hornCaught: boolean;
  /** Honks sounded this shift (EV.Horn count). */
  honks: number;
  /** Honks that landed a Caught! this shift (not counted toward horn spam). */
  honksCaught: number;
  /** Noise offences recorded this shift. */
  noiseOffences: number;
  /** The window: counted honk ticks, a ring of capacity honkTicks.length, oldest at honkHead. */
  honkTicks: Int32Array;
  honkHead: number;
  honkCount: number;
};

/** What render, audio and UI may see: the same object, typed read-only. */
export type ComplaintsView = {
  readonly count: number;
  readonly max: number;
  readonly twoToneHorn: boolean;
  readonly hornRadiusM: number;
  readonly maxHonks: number;
  readonly windowTicks: number;
  readonly honks: number;
  readonly honksCaught: number;
  readonly noiseOffences: number;
  readonly honkCount: number;
};

function ticksOf(seconds: number): number {
  return Math.round(seconds * SIM_HZ) | 0;
}

/** The newest `keep` honk ticks of the ring, oldest first, copied into a new ring of `capacity`. */
function regrowRing(c: Complaints, capacity: number): void {
  const old = c.honkTicks;
  const keep = c.honkCount < capacity - 1 ? c.honkCount : capacity - 1;
  const next = new Int32Array(capacity);
  const skip = c.honkCount - keep;
  for (let k = 0; k < keep; k += 1) next[k] = old[(c.honkHead + skip + k) % old.length] as number;
  c.honkTicks = next;
  c.honkHead = 0;
  c.honkCount = keep;
}

function applyTuning(c: Complaints, tuning: Tuning): void {
  const horn = tuning.streetLife.horn;
  const spam = tuning.complaints.hornSpam;
  const spanTicks = ticksOf(spam.windowS);
  if (!(spanTicks >= 1))
    throw new Error(`complaints: hornSpam.windowS must be at least one tick, got ${spam.windowS}`);
  c.max = tuning.complaints.meter.sackedAt;
  c.hornRadiusM = c.twoToneHorn ? horn.twoToneRadiusM : horn.radiusM;
  c.maxHonks = c.twoToneHorn ? spam.twoToneMaxHonks : spam.maxHonks;
  c.windowTicks = spanTicks;
  c.noiseComplaints = spam.complaints;
  if (c.count > c.max) c.count = c.max;
  // The window holds at most maxHonks + 1 honks before a complaint clears it.
  const capacity = (spam.twoToneMaxHonks > spam.maxHonks ? spam.twoToneMaxHonks : spam.maxHonks) + 1;
  if (capacity !== c.honkTicks.length) regrowRing(c, capacity);
  while (c.honkCount > c.maxHonks) {
    c.honkHead = (c.honkHead + 1) % c.honkTicks.length;
    c.honkCount -= 1;
  }
}

/** An empty meter and horn window on `tuning`, stock horn. Setup only: allocates. */
export function createComplaints(tuning: Tuning): Complaints {
  const c: Complaints = {
    count: 0,
    max: 0,
    twoToneHorn: false,
    // Fractional first so the field starts as a double (TECHNICAL_DESIGN §17, deprecated maps).
    hornRadiusM: 0.5,
    maxHonks: 0,
    windowTicks: 0,
    noiseComplaints: 0,
    hornThisTick: false,
    hornCaught: false,
    honks: 0,
    honksCaught: 0,
    noiseOffences: 0,
    honkTicks: new Int32Array(0),
    honkHead: 0,
    honkCount: 0,
  };
  applyTuning(c, tuning);
  return c;
}

/** The read-only view of `c`. No copy: it is the same object. */
export function viewComplaints(c: Complaints): ComplaintsView {
  return c;
}

/** Hand the meter a new tuning between ticks (the dev panel). The count (clamped to the new cap) and window stay. */
export function setComplaintsTuning(c: Complaints, tuning: Tuning): void {
  applyTuning(c, tuning);
}

/**
 * The upg.two_tone_horn modifier hook (SSP-188 calls it from the loadout at shift start): `on` switches the
 * horn radius to streetLife.horn.twoToneRadiusM (12 m) and the spam threshold to hornSpam.twoToneMaxHonks (5).
 * Not per tick.
 */
export function setTwoToneHorn(c: Complaints, tuning: Tuning, on: boolean): void {
  c.twoToneHorn = on;
  applyTuning(c, tuning);
}

/**
 * Phase 1, after the input gate: if `input` carries the HORN pressed edge, consume it: count the honk, mark it
 * for phase 9 and emit EV.Horn at Bessie's body centre (`vehicle`) with the horn radius. Allocation-free.
 */
export function stepHornInput(
  c: Complaints,
  input: Readonly<InputFrame>,
  vehicle: { readonly xM: number; readonly yM: number },
  events: EventQueue,
): void {
  c.hornThisTick = false;
  c.hornCaught = false;
  if ((input.pressed & PRESSED.HORN) === 0) return;
  c.hornThisTick = true;
  c.honks += 1;
  const e = emitEvent(events, EV.Horn, -1);
  events.a[e] = vehicle.xM;
  events.b[e] = vehicle.yM;
  events.c[e] = c.hornRadiusM;
}

/**
 * Phase 7 hook for the litterbug (ENTITY_CATALOG §6): this tick's honk landed a Caught!, so it does not count
 * toward horn spam. Returns whether there was a honk this tick to flag. Allocation-free.
 */
export function markHornCaught(c: Complaints): boolean {
  if (!c.hornThisTick) return false;
  if (!c.hornCaught) c.honksCaught += 1;
  c.hornCaught = true;
  return true;
}

/**
 * Phase 9, first: count this tick's honk (`tick` is the tick being run) unless phase 7 flagged it Caught!, and
 * record a Noise fact at Bessie's position (`vehicle`) when the window holds more than maxHonks; that clears
 * the window (the re-arm rule, see the header). Allocation-free.
 */
export function stepHornSpam(
  c: Complaints,
  penalties: PenaltyLog,
  vehicle: { readonly xM: number; readonly yM: number },
  tick: number,
): void {
  const counted = c.hornThisTick && !c.hornCaught;
  c.hornThisTick = false;
  c.hornCaught = false;
  if (!counted) return;
  const ring = c.honkTicks;
  const cap = ring.length;
  // Drop the honks that have left the window, oldest first.
  while (c.honkCount > 0 && tick - (ring[c.honkHead] as number) >= c.windowTicks) {
    c.honkHead = (c.honkHead + 1) % cap;
    c.honkCount -= 1;
  }
  if (c.honkCount >= cap) {
    // Unreachable while the ring holds maxHonks + 1 (a complaint clears it first); keep the newest regardless.
    c.honkHead = (c.honkHead + 1) % cap;
    c.honkCount -= 1;
  }
  ring[(c.honkHead + c.honkCount) % cap] = tick;
  c.honkCount += 1;
  if (c.honkCount <= c.maxHonks) return;
  c.honkHead = 0;
  c.honkCount = 0;
  c.noiseOffences += 1;
  const i = pushPenalty(penalties, Offence.Noise, 0, c.noiseComplaints);
  penalties.x[i] = vehicle.xM;
  penalties.y[i] = vehicle.yM;
}

/**
 * File `n` complaints for `reason` at (at.x[i], at.y[i]): each one that lands under the cap adds 1 to the meter
 * and emits EV.Complaint; the rest are dropped. Returns how many landed. Allocation-free.
 */
export function fileComplaints(
  c: Complaints,
  events: EventQueue,
  n: number,
  reason: Offence,
  at: { readonly x: ArrayLike<number>; readonly y: ArrayLike<number> },
  i: number,
): number {
  let landed = 0;
  for (let k = 0; k < n; k += 1) {
    if (c.count >= c.max) break;
    c.count += 1;
    landed += 1;
    const e = emitEvent(events, EV.Complaint, -1);
    events.a[e] = at.x[i] as number;
    events.b[e] = at.y[i] as number;
    events.c[e] = reason;
  }
  return landed;
}

/**
 * The police-witness hook (GDD §11.2): extra complaints for penalty fact `i` of `log`, committed at
 * (log.x[i], log.y[i]). M6 (SSP-211) counts a veh.police within complaints.policeWitness.radiusM and returns
 * policeWitness.extraComplaints; until then there are no police, so it returns 0.
 */
export function policeWitnessComplaints(_c: Complaints, _log: PenaltyLog, _i: number): number {
  return 0;
}

/**
 * EV.Penalty for penalty fact `i` (SSP-288): its Offence in `entity`, its position and its points. A presentation
 * fact for the world-space penalty popup; the points still go through scoring's penalty API.
 */
function emitPenalty(events: EventQueue, log: PenaltyLog, i: number): void {
  const e = emitEvent(events, EV.Penalty, log.reason[i] as number);
  events.a[e] = log.x[i] as number;
  events.b[e] = log.y[i] as number;
  events.c[e] = log.pts[i] as number;
}

/**
 * Phase 9, after stepHornSpam and before stepScoring: consume the tick's penalty facts in order (see the
 * header): points to scoring's penalty API (applied, with the chain reset, after the tick's pickups), complaints
 * and the police witness's extras to the meter with EV.Complaint each. Leaves the log empty. Allocation-free.
 */
export function applyPenalties(c: Complaints, log: PenaltyLog, scoring: Scoring, events: EventQueue): void {
  const n = log.count;
  for (let i = 0; i < n; i += 1) {
    addPenalty(scoring, log.pts[i] as number);
    emitPenalty(events, log, i);
    const k = log.complaints[i] as number;
    if (k > 0) fileComplaints(c, events, k, log.reason[i] as Offence, log, i);
    const extra = policeWitnessComplaints(c, log, i);
    if (extra > 0) fileComplaints(c, events, extra, Offence.PoliceWitness, log, i);
  }
  log.applied += n;
  log.count = 0;
}
