// The score (GDD §9.1, §10, §11.1; TECHNICAL_DESIGN §5.2 phase 9; SSP-063): item and stain points × the combo
// multiplier, grime points, the Kerb Hugger bonus, the bonus API (Clean Sweep, SSP-064; M3's style bonuses)
// and the penalty API (addPenalty: the points side of SSP-078's penalty pipeline, complaints.ts applyPenalties).
//
//     score = Σ (item points × combo multiplier) + grime points + style bonuses − penalties     (GDD §10.1)
//
// Phase 9 (stepScoring) consumes this tick's facts, never render state: the EventQueue (phases 1–8 have
// emitted into it; phase 9 reads the events already there) and dirt.ts's per-tick counters. In order:
//   1. The chain timer (combo.ts stepComboTimer), frozen while a dump drains (`draining`: shift.ts
//      isShiftDraining, GDD §20 Q4).
//   2. Pickups, in emission order. EV.LitterCollected scores the kind's entities.json `pts` and EV.StainCleaned
//      its event `c` (the stain's `pts`), each × the multiplier after that pickup's chain increment (GDD §10.4).
//      Interleaved with them, each EV.Caught (a litterbug caught by a honk in phase 7, SSP-084) and each
//      EV.PigeonScatter (Bessie through a scattering flock in phase 7, SSP-088) awards its event `c` (+100, +25)
//      through the bonus API: a style bonus, so not multiplied and no chain change.
//      Every pickup counts for the chain, including the 0-point ones (litter.spilled_shopping, stain.splat).
//      Stain cleans take the multiplier and extend the chain (ENTITY_CATALOG §17 Q5, resolved in SSP-063).
//   3. Grime: (tickCleanedCells − tickCleanedGutterCells) × grimeCellPts (1) + tickCleanedGutterCells ×
//      gutterGrimeCellPts (2) (GDD §9.1). Grime neither builds nor breaks the chain.
//   4. Kerb Hugger (GDD §10.3): `kerbContactTicks` counts consecutive ticks with dirt.kerbContact and resets to
//      0 on a tick without it; every kerbHuggerEveryS × 60 (180) ticks of it award kerbHuggerPts (+50) through
//      the bonus API (at 180, 360, ... continuous ticks; 179 award nothing).
//   5. Penalties recorded this tick (addPenalty, or the stain store's onPenalty hook in phase 5): their points
//      are added (they are negative) and the chain resets to 0, after the tick's pickups, so a tick with any
//      penalty always ends with chain 0 and ×1 (GDD §10.2 "any penalty resets the chain").
// Style bonuses (awardBonus: Kerb Hugger here, Clean Sweep from SSP-064, Caught! from SSP-084, Pigeon Scatter
// from SSP-088, near miss and the rest in M3) are added as they are awarded, are never multiplied and never touch the chain (GDD §10.3, §20 Q3,
// resolved in SSP-063).
//
// Points are integers throughout (entities.json and tuning.json hold integer points; the multiplier is an
// integer), so the score is exact. It is not clamped: penalties can take it below 0 (no rule says otherwise).
//
// Hot path: stepScoring, awardBonus and addPenalty allocate nothing and keep every count a small integer
// (TECHNICAL_DESIGN §17). The penalty hook is one closure made at createScoring, never per tick; the stain
// store calls it a few times per shift at most.

import {
  addComboPickup,
  type Combo,
  type ComboView,
  createCombo,
  resetCombo,
  setComboTuning,
  stepComboTimer,
} from './combo.ts';
import { SIM_HZ } from './constants.ts';
import { type Entities, LITTER_IDS, type LitterId } from './entities.ts';
import { EV, type EventQueue } from './eventQueue.ts';
import type { PenaltyHook } from './stains.ts';
import type { Tuning } from './tuning.ts';

/** The dirt.ts per-tick facts scoring reads; a DirtView satisfies it. */
export type ScoringDirt = {
  readonly tickCleanedCells: number;
  readonly tickCleanedGutterCells: number;
  readonly kerbContact: boolean;
};

/** The shift's score and its parts. Create with createScoring; only the sim writes it. */
export type Scoring = {
  /** The combo chain this score multiplies by. */
  readonly combo: Combo;
  /** Points per litter kind (entities.json `pts`), by LITTER_IDS index. */
  readonly litterPts: Int32Array;
  /** The score: the sum of the five parts below. */
  score: number;
  /** Σ litter pts × multiplier. */
  itemPts: number;
  /** Σ stain pts × multiplier. */
  stainPts: number;
  /** Grime cells × 1, gutter cells × 2. */
  grimePts: number;
  /** Style bonuses (Kerb Hugger, Clean Sweep, ...), never multiplied. */
  bonusPts: number;
  /** Penalties, 0 or below. */
  penaltyPts: number;
  /** Consecutive ticks of Kerb Hugger contact, up to this tick (0 on a tick without contact). */
  kerbContactTicks: number;
  /** Kerb Hugger bonuses awarded this shift. */
  kerbHuggerAwards: number;
  /** Penalties recorded since the last stepScoring: how many and their summed points (≤ 0). */
  pendingPenalties: number;
  pendingPenaltyPts: number;
  /** tuning.json scoring, copied so the per-tick reads are monomorphic integer fields. */
  grimeCellPts: number;
  gutterGrimeCellPts: number;
  kerbHuggerPts: number;
  /** kerbHuggerEveryS × 60 (180). */
  kerbHuggerTicks: number;
  /** The stain store's penalty hook (stains.onPenalty = scoring.penaltyHook at shift start). */
  readonly penaltyHook: PenaltyHook;
};

/** What render, audio and UI may see: the same object, typed read-only. */
export type ScoringView = {
  readonly combo: ComboView;
  readonly score: number;
  readonly itemPts: number;
  readonly stainPts: number;
  readonly grimePts: number;
  readonly bonusPts: number;
  readonly penaltyPts: number;
  readonly kerbContactTicks: number;
  readonly kerbHuggerAwards: number;
};

function applyTuning(scoring: Scoring, tuning: Tuning): void {
  const s = tuning.scoring;
  const every = Math.round(s.kerbHuggerEveryS * SIM_HZ) | 0;
  if (!(every >= 1)) {
    throw new Error(`scoring: scoring.kerbHuggerEveryS must be at least one tick, got ${s.kerbHuggerEveryS}`);
  }
  scoring.grimeCellPts = s.grimeCellPts;
  scoring.gutterGrimeCellPts = s.gutterGrimeCellPts;
  scoring.kerbHuggerPts = s.kerbHuggerPts;
  scoring.kerbHuggerTicks = every;
}

/** Points per litter kind from validated entity data, by LITTER_IDS index. Setup only. */
export function createLitterPts(entities: Entities): Int32Array {
  const pts = new Int32Array(LITTER_IDS.length);
  for (let k = 0; k < LITTER_IDS.length; k += 1) pts[k] = entities.litter[LITTER_IDS[k] as LitterId].pts;
  return pts;
}

/** A zero score with a fresh combo, on `tuning` and `entities`. Allocated once per shift. */
export function createScoring(tuning: Tuning, entities: Entities): Scoring {
  const scoring: Scoring = {
    combo: createCombo(tuning),
    litterPts: createLitterPts(entities),
    score: 0,
    itemPts: 0,
    stainPts: 0,
    grimePts: 0,
    bonusPts: 0,
    penaltyPts: 0,
    kerbContactTicks: 0,
    kerbHuggerAwards: 0,
    pendingPenalties: 0,
    pendingPenaltyPts: 0,
    grimeCellPts: 0,
    gutterGrimeCellPts: 0,
    kerbHuggerPts: 0,
    kerbHuggerTicks: 0,
    penaltyHook: (pts: number) => addPenalty(scoring, pts),
  };
  applyTuning(scoring, tuning);
  return scoring;
}

/** The read-only view of `scoring`. No copy: it is the same object. */
export function viewScoring(scoring: Scoring): ScoringView {
  return scoring;
}

/** Hand scoring (and its combo) a new tuning between ticks (the dev panel). Running totals are kept. */
export function setScoringTuning(scoring: Scoring, tuning: Tuning): void {
  applyTuning(scoring, tuning);
  setComboTuning(scoring.combo, tuning);
}

/**
 * The bonus API (GDD §10.3): add a style bonus of `pts` (a positive integer) to the score now. Never
 * multiplied, never touches the chain. Kerb Hugger uses it; SSP-064 awards Clean Sweep (+100) through it.
 */
export function awardBonus(scoring: Scoring, pts: number): void {
  if (!(Number.isInteger(pts) && pts > 0)) {
    throw new Error(`awardBonus: a bonus must be a positive integer, got ${pts}`);
  }
  scoring.bonusPts += pts;
  scoring.score += pts;
}

/**
 * The penalty API (GDD §10.2, §11.1): record a penalty of `pts` (an integer, 0 or below) this tick. Phase 9
 * applies it after the tick's pickups: the points come off the score and the chain resets to 0. In the World
 * only the penalty pipeline calls it (complaints.ts applyPenalties, phase 9, SSP-078): offences record penalty
 * facts in world.penalties (the splat included, since SSP-078) instead. `scoring.penaltyHook` is the same API as a
 * stain-store hook, for tests of the store and scoring alone.
 */
export function addPenalty(scoring: Scoring, pts: number): void {
  if (!(Number.isInteger(pts) && pts <= 0)) {
    throw new Error(`addPenalty: a penalty must be an integer of 0 or below, got ${pts}`);
  }
  scoring.pendingPenalties += 1;
  scoring.pendingPenaltyPts += pts;
}

/**
 * Tick phase 9 (see the header): the chain timer (frozen while `draining`), this tick's pickups from `events`,
 * grime and Kerb Hugger from `dirt`, then the tick's penalties. May emit EV.ComboTier into `events`.
 * Allocation-free.
 */
export function stepScoring(
  scoring: Scoring,
  events: EventQueue,
  dirt: ScoringDirt,
  draining: boolean,
): void {
  const combo = scoring.combo;
  stepComboTimer(combo, draining, events);

  // Pickups. Only the events emitted before phase 9: the EV.ComboTier events this loop appends are not facts
  // for it.
  const n = events.count;
  const type = events.type;
  const litterPts = scoring.litterPts;
  for (let i = 0; i < n; i += 1) {
    const t = type[i] as number;
    if (t === EV.LitterCollected) {
      const pts = litterPts[(events.c[i] as number) | 0] as number;
      const mul = addComboPickup(combo, events);
      scoring.itemPts += pts * mul;
      scoring.score += pts * mul;
    } else if (t === EV.StainCleaned) {
      const pts = (events.c[i] as number) | 0;
      const mul = addComboPickup(combo, events);
      scoring.stainPts += pts * mul;
      scoring.score += pts * mul;
    } else if (t === EV.Caught || t === EV.PigeonScatter) {
      awardBonus(scoring, (events.c[i] as number) | 0);
    }
  }

  // Grime.
  const cells = dirt.tickCleanedCells;
  if (cells > 0) {
    const gutter = dirt.tickCleanedGutterCells;
    const pts = (cells - gutter) * scoring.grimeCellPts + gutter * scoring.gutterGrimeCellPts;
    scoring.grimePts += pts;
    scoring.score += pts;
  }

  // Kerb Hugger.
  if (dirt.kerbContact) {
    const ticks = scoring.kerbContactTicks + 1;
    scoring.kerbContactTicks = ticks;
    if (ticks % scoring.kerbHuggerTicks === 0) {
      scoring.kerbHuggerAwards += 1;
      awardBonus(scoring, scoring.kerbHuggerPts);
    }
  } else {
    scoring.kerbContactTicks = 0;
  }

  // Penalties.
  if (scoring.pendingPenalties > 0) {
    const pts = scoring.pendingPenaltyPts;
    scoring.penaltyPts += pts;
    scoring.score += pts;
    scoring.pendingPenalties = 0;
    scoring.pendingPenaltyPts = 0;
    resetCombo(combo, events);
  }
}
