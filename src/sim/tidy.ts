// Tidy %, per-frontage clean % and the Clean Sweep bonus (GDD §9.2, §9.3, §12.1; TECHNICAL_DESIGN §10.3;
// LEVEL_DESIGN §7.10; SSP-064).
//
//     Tidy % = grimeWeight (0.6) × grime cells cleaned ÷ initial grime cells
//            + litterWeight (0.4) × litter collected ÷ litter spawned                       (GDD §9.2)
//
// Both shares are over the route area only. That holds by construction: grime is laid only on OPEN cells, which
// are route tiles (LEVEL_DESIGN §9.2), and litter spawns only on route sub-cells (§9.1), dynamic litter
// included (it counts in litter spawned; litter.spilled_shopping too). The global counters are dirt.ts's
// initialCells / cleanedCells and the LitterField's litterSpawned / litterCollected; nothing rescans the mask.
//
// Frontages. Each compiled `frontages` entry (LEVEL_DESIGN §7.10) is a zone of tiles; its clean % is the same
// formula over the grime cells and litter of its zone, counted incrementally by the ZoneTally (zoneTally.ts)
// that initTidy attaches to the Dirt and the LitterField. Rules decided in SSP-064 (GDD §9.3):
//   - Litter counts for the zone(s) holding the tile it SPAWNED on, wherever it is later collected (a flung or
//     drifted item does not move its count). A tile in two zones counts for both.
//   - A share with nothing in it (no grime laid, or no litter spawned) is left out and the other share takes
//     the whole weight, so a zone with grime but no litter is clean in proportion to its grime. A zone with
//     neither is "empty": its clean % is 100%, but it is never eligible for Clean Sweep.
//   - Clean Sweep: a non-empty zone with every grime cell cleaned and every spawned item collected (exact
//     integer counts, not a rounded %) awards scoring.cleanSweepPts (+100) once per shift through scoring's
//     bonus API (never multiplied, no chain effect). Litter that later spawns in it lowers its clean % but never
//     awards it again. An item removed without being collected (a dog-mess splat, a leaf pile driven through)
//     stays in litter spawned, so that zone can no longer reach 100%.
//   - Good: clean % ≥ tidy.frontageGoodMinClean (90%), the pledge tip, Mercury green and Inspector threshold
//     (§9.3). `pledgeMet` marks the pledged frontages that are good now (the £10 tip is M6).
//
// Quantisation (CLAUDE.md hard rule 12). Every clean % is computed as an integer in parts per million
// (round(fraction × 1e6), clamped to [0, 1e6]), and stars and the good threshold compare those integers with the
// thresholds rounded the same way, so a value that is mathematically on a threshold (0.6 × 1 + 0.4 × 0.5 = 0.8)
// is on it whatever the last bit of the double is. Every step (÷, ×, +, round) is monotone, so a share that
// does not fall never makes the % fall. `tidy` and `frontageClean` are the ppm values ÷ 1e6.
//
// Stars (GDD §12.1): the would-be stars of the current Tidy %: 1★ ≥ 0.60, 2★ ≥ 0.80, 3★ ≥ 0.92 (tuning.json
// `stars`). SACKED and TOWED award no stars; that rule is shift.ts finalShiftStars (SSP-079), not here.
//
// Tick placement: stepTidy runs in phase 9 straight after stepScoring (SSP-065 wires it), when phases 5 and 6
// have moved this tick's counters. It recomputes only the frontages whose counters changed this tick.
//
// Hot path: stepTidy allocates nothing (TECHNICAL_DESIGN §17): the clean % helper takes and returns small
// integers, and doubles are only written into typed arrays and pre-shaped double fields. createTidy, initTidy
// and setTidyTuning run at shift start (or between ticks) and may allocate.

import { attachDirtZones, type Dirt } from './dirt.ts';
import { attachLitterZones, type LitterField } from './litter.ts';
import { GUTTER_CELLS_PER_TILE, type Level } from './map.ts';
import { awardBonus, type Scoring } from './scoring.ts';
import type { Tuning } from './tuning.ts';
import { clearZoneTally, createZoneTally, takeChangedZones, type ZoneTally } from './zoneTally.ts';

/** Clean % and Tidy % are integers in units of 1 / TIDY_PPM (parts per million) before they are published. */
export const TIDY_PPM = 1_000_000;

/** The Tidy % weights the clean % helper reads (tuning.json `tidy`; a Tidy satisfies it). */
export type TidyWeights = { readonly grimeWeight: number; readonly litterWeight: number };

/** The global counters stepTidy reads: a Dirt (or DirtView) satisfies it. */
export type TidyGrime = { readonly initialCells: number; readonly cleanedCells: number };

/** The global counters stepTidy reads: a LitterField (or LitterFieldView) satisfies it. */
export type TidyLitter = { readonly litterSpawned: number; readonly litterCollected: number };

/** Tidy %, the frontages' clean % and Clean Sweep state of one shift. Create with createTidy; sim-only writes. */
export type Tidy = {
  /** The per-frontage counters (shared with the Dirt and the LitterField once initTidy attaches it). */
  readonly zones: ZoneTally;
  /** Frontages, in compiled `frontages` order (zone index = frontage index). */
  readonly frontageCount: number;
  readonly frontageIds: readonly string[];
  /** 1 for a pledge frontage. */
  readonly pledge: Uint8Array;
  /** Clean % of each frontage, 0..1 (ppm ÷ 1e6); 1 for an empty zone. */
  readonly frontageClean: Float64Array;
  /** The same in parts per million (what every comparison uses). */
  readonly frontageCleanPpm: Int32Array;
  /** 1 once the frontage has awarded its Clean Sweep this shift. */
  readonly cleanSwept: Uint8Array;
  /** 1 for a pledge frontage whose clean % is good (≥ frontageGoodMinClean) now. */
  readonly pledgeMet: Uint8Array;
  /** Tidy %, 0..1 (tidyPpm ÷ 1e6). */
  tidy: number;
  tidyPpm: number;
  /** Would-be stars for the current Tidy %, 0..3. */
  stars: number;
  /** Clean Sweeps awarded this shift. */
  cleanSweeps: number;
  /** Pledge frontages that are good now. */
  pledgesMet: number;
  /** tuning.json, copied so the per-tick reads are monomorphic fields. */
  grimeWeight: number;
  litterWeight: number;
  /** Thresholds in ppm: tidy.frontageGoodMinClean and stars.star1..3MinTidy. */
  goodPpm: number;
  star1Ppm: number;
  star2Ppm: number;
  star3Ppm: number;
  cleanSweepPts: number;
};

/** What render, audio, UI and `__ssp.state()` may see: the same object, typed read-only. */
export type TidyView = {
  readonly zones: Readonly<ZoneTally>;
  readonly frontageCount: number;
  readonly frontageIds: readonly string[];
  readonly pledge: Readonly<Uint8Array>;
  readonly frontageClean: Readonly<Float64Array>;
  readonly frontageCleanPpm: Readonly<Int32Array>;
  readonly cleanSwept: Readonly<Uint8Array>;
  readonly pledgeMet: Readonly<Uint8Array>;
  readonly tidy: number;
  readonly tidyPpm: number;
  readonly stars: number;
  readonly cleanSweeps: number;
  readonly pledgesMet: number;
  /** The star thresholds in ppm (stars.star1..3MinTidy; SSP-299: the HUD's Tidy % bar ticks). */
  readonly star1Ppm: number;
  readonly star2Ppm: number;
  readonly star3Ppm: number;
};

/** A fraction in [0, 1] as clamped parts per million. */
function toPpm(fraction: number): number {
  const ppm = Math.round(fraction * TIDY_PPM);
  return ppm < 0 ? 0 : ppm > TIDY_PPM ? TIDY_PPM : ppm;
}

/**
 * The Tidy % formula (see the header) in parts per million, for `grimeCleaned` of `grimeInitial` cells and
 * `litterCollected` of `litterSpawned` items (non-negative integers): a share with a zero denominator is left
 * out and the other takes the whole weight; with neither, 1e6. Allocation-free; returns a small integer.
 */
export function tidyPpm(
  weights: TidyWeights,
  grimeCleaned: number,
  grimeInitial: number,
  litterCollected: number,
  litterSpawned: number,
): number {
  // toPpm, written out inline: this runs per tick (stepTidy, updateFrontage), and a call V8 does not inline
  // boxes its double argument (16 B; found by the World heap check, SSP-065). Only integers cross the call.
  let fraction: number;
  if (grimeInitial > 0) {
    const grime = grimeCleaned / grimeInitial;
    fraction =
      litterSpawned > 0
        ? weights.grimeWeight * grime + weights.litterWeight * (litterCollected / litterSpawned)
        : grime;
  } else if (litterSpawned > 0) {
    fraction = litterCollected / litterSpawned;
  } else {
    return TIDY_PPM;
  }
  const ppm = Math.round(fraction * TIDY_PPM);
  return ppm < 0 ? 0 : ppm > TIDY_PPM ? TIDY_PPM : ppm;
}

/** Tidy % (0..1) for the given counts: tidyPpm ÷ 1e6. */
export function tidyFraction(
  weights: TidyWeights,
  grimeCleaned: number,
  grimeInitial: number,
  litterCollected: number,
  litterSpawned: number,
): number {
  return tidyPpm(weights, grimeCleaned, grimeInitial, litterCollected, litterSpawned) / TIDY_PPM;
}

/** Stars (0..3) for a Tidy % in ppm against star thresholds in ppm. */
function starsForPpm(ppm: number, star1: number, star2: number, star3: number): number {
  return ppm >= star3 ? 3 : ppm >= star2 ? 2 : ppm >= star1 ? 1 : 0;
}

/**
 * The would-be stars (GDD §12.1) of a Tidy % `tidy` (0..1): 0, 1 at ≥ star1MinTidy (0.60), 2 at ≥ star2MinTidy
 * (0.80), 3 at ≥ star3MinTidy (0.92). Both sides are rounded to ppm first. SACKED's and TOWED's "no stars" is
 * shift.ts finalShiftStars (SSP-079), not this helper.
 */
export function starsForTidy(tidy: number, stars: Tuning['stars']): 0 | 1 | 2 | 3 {
  return starsForPpm(
    toPpm(tidy),
    toPpm(stars.star1MinTidy),
    toPpm(stars.star2MinTidy),
    toPpm(stars.star3MinTidy),
  ) as 0 | 1 | 2 | 3;
}

function applyTuning(tidy: Tidy, tuning: Tuning): void {
  tidy.grimeWeight = tuning.tidy.grimeWeight;
  tidy.litterWeight = tuning.tidy.litterWeight;
  tidy.goodPpm = toPpm(tuning.tidy.frontageGoodMinClean);
  tidy.star1Ppm = toPpm(tuning.stars.star1MinTidy);
  tidy.star2Ppm = toPpm(tuning.stars.star2MinTidy);
  tidy.star3Ppm = toPpm(tuning.stars.star3MinTidy);
  tidy.cleanSweepPts = tuning.scoring.cleanSweepPts;
}

/**
 * The Tidy for `level`'s compiled frontages on `tuning`: zero counters, nothing attached. Call initTidy at
 * shift start once the grime is laid and the initial litter spawned. Allocated once per shift.
 */
export function createTidy(level: Level, tuning: Tuning): Tidy {
  const frontages = level.frontages;
  const n = frontages.length;
  const tidy: Tidy = {
    zones: createZoneTally(
      level.size[0],
      level.size[1],
      frontages.map((f) => f.cells),
    ),
    frontageCount: n,
    frontageIds: frontages.map((f) => f.id),
    pledge: Uint8Array.from(frontages, (f) => (f.pledge ? 1 : 0)),
    frontageClean: new Float64Array(n).fill(1),
    frontageCleanPpm: new Int32Array(n).fill(TIDY_PPM),
    cleanSwept: new Uint8Array(n),
    pledgeMet: new Uint8Array(n),
    // Fractional values first so the double fields start as doubles (TECHNICAL_DESIGN §17, deprecated maps).
    tidy: 0.5,
    tidyPpm: 0,
    stars: 0,
    cleanSweeps: 0,
    pledgesMet: 0,
    grimeWeight: 0.5,
    litterWeight: 0.5,
    goodPpm: 0,
    star1Ppm: 0,
    star2Ppm: 0,
    star3Ppm: 0,
    cleanSweepPts: 0,
  };
  applyTuning(tidy, tuning);
  recomputeAll(tidy, { initialCells: 0, cleanedCells: 0 }, { litterSpawned: 0, litterCollected: 0 });
  return tidy;
}

/** The read-only view of `tidy`. No copy: it is the same object. */
export function viewTidy(tidy: Tidy): TidyView {
  return tidy;
}

/** Recompute frontage `z`'s clean % and pledge state from its counters. Allocation-free. */
function updateFrontage(tidy: Tidy, z: number): void {
  const zones = tidy.zones;
  const ppm = tidyPpm(
    tidy,
    zones.grimeCleaned[z] as number,
    zones.grimeInitial[z] as number,
    zones.litterCollected[z] as number,
    zones.litterSpawned[z] as number,
  );
  tidy.frontageCleanPpm[z] = ppm;
  tidy.frontageClean[z] = ppm / TIDY_PPM;
  const met = (tidy.pledge[z] as number) !== 0 && ppm >= tidy.goodPpm ? 1 : 0;
  if (met !== (tidy.pledgeMet[z] as number)) {
    tidy.pledgeMet[z] = met;
    tidy.pledgesMet += met === 1 ? 1 : -1;
  }
}

/** Recompute the global Tidy % and stars. Allocation-free. */
function updateGlobal(tidy: Tidy, grime: TidyGrime, litter: TidyLitter): void {
  const ppm = tidyPpm(
    tidy,
    grime.cleanedCells,
    grime.initialCells,
    litter.litterCollected,
    litter.litterSpawned,
  );
  tidy.tidyPpm = ppm;
  tidy.tidy = ppm / TIDY_PPM;
  tidy.stars = starsForPpm(ppm, tidy.star1Ppm, tidy.star2Ppm, tidy.star3Ppm);
}

function recomputeAll(tidy: Tidy, grime: TidyGrime, litter: TidyLitter): void {
  for (let z = 0; z < tidy.frontageCount; z += 1) updateFrontage(tidy, z);
  updateGlobal(tidy, grime, litter);
}

/** True when frontage `z` is non-empty and every grime cell and spawned item of its zone is cleaned up. */
export function isFrontageSpotless(tidy: TidyView, z: number): boolean {
  const zones = tidy.zones;
  const gi = zones.grimeInitial[z] as number;
  const ls = zones.litterSpawned[z] as number;
  return gi + ls > 0 && zones.grimeCleaned[z] === gi && zones.litterCollected[z] === ls;
}

/**
 * Shift start (after initGrime and spawnInitialLitter, before the first tick): zero the frontage counters,
 * count each zone's grime cells from `dirt`'s mask and its items from the live litter's spawnTile, attach the
 * tally to the Dirt and the LitterField so they keep it current, clear Clean Sweep and compute every %.
 * Throws if the field has already collected or removed litter (it must run at shift start). Allocates nothing
 * per item, but is not a per-tick call.
 */
export function initTidy(tidy: Tidy, dirt: Dirt, litter: LitterField): void {
  const zones = tidy.zones;
  if (litter.litterCollected !== 0 || litter.count !== litter.litterSpawned) {
    throw new Error('initTidy: the LitterField has collected or removed litter; call it at shift start');
  }
  if (dirt.cleanedCells !== 0) {
    throw new Error('initTidy: the Dirt has cleaned grime; call it at shift start');
  }
  clearZoneTally(zones);
  const tilesW = zones.tilesW;
  const tiles = tilesW * zones.tilesH;
  const mask = dirt.mask;
  const maskW = dirt.maskW;
  const per = GUTTER_CELLS_PER_TILE;
  for (let t = 0; t < tiles; t += 1) {
    const start = zones.tileStart[t] as number;
    const end = zones.tileStart[t + 1] as number;
    if (start === end) continue;
    const x0 = (t % tilesW) * per;
    const y0 = Math.floor(t / tilesW) * per;
    let cells = 0;
    for (let cy = y0; cy < y0 + per; cy += 1) {
      for (let cx = x0; cx < x0 + per; cx += 1) if ((mask[cy * maskW + cx] as number) !== 0) cells += 1;
    }
    for (let k = start; k < end; k += 1) {
      const z = zones.zoneList[k] as number;
      zones.grimeInitial[z] = (zones.grimeInitial[z] as number) + cells;
    }
  }
  attachDirtZones(dirt, zones);
  for (let i = 0; i < litter.count; i += 1) {
    const t = litter.spawnTile[i] as number;
    if (t < 0) continue;
    const end = zones.tileStart[t + 1] as number;
    for (let k = zones.tileStart[t] as number; k < end; k += 1) {
      const z = zones.zoneList[k] as number;
      zones.litterSpawned[z] = (zones.litterSpawned[z] as number) + 1;
    }
  }
  attachLitterZones(litter, zones);
  takeChangedZones(zones);
  tidy.cleanSwept.fill(0);
  tidy.cleanSweeps = 0;
  tidy.pledgeMet.fill(0);
  tidy.pledgesMet = 0;
  recomputeAll(tidy, dirt, litter);
}

/**
 * Tick phase 9, after stepScoring (see the header): recompute the frontages whose counters moved this tick,
 * award each one's Clean Sweep through `scoring`'s bonus API the first time it is spotless, then the global
 * Tidy % and stars from `grime` (the Dirt) and `litter` (the LitterField). Allocation-free.
 */
export function stepTidy(tidy: Tidy, grime: TidyGrime, litter: TidyLitter, scoring: Scoring): void {
  const zones = tidy.zones;
  const n = takeChangedZones(zones);
  const list = zones.changedList;
  for (let k = 0; k < n; k += 1) {
    const z = list[k] as number;
    updateFrontage(tidy, z);
    if ((tidy.cleanSwept[z] as number) === 0 && isFrontageSpotless(tidy, z)) {
      tidy.cleanSwept[z] = 1;
      tidy.cleanSweeps += 1;
      awardBonus(scoring, tidy.cleanSweepPts);
    }
  }
  updateGlobal(tidy, grime, litter);
}

/** Hand the Tidy a new tuning between ticks (the dev panel): every % is recomputed; Clean Sweeps are kept. */
export function setTidyTuning(tidy: Tidy, tuning: Tuning, grime: TidyGrime, litter: TidyLitter): void {
  applyTuning(tidy, tuning);
  recomputeAll(tidy, grime, litter);
}
