// The score (src/sim/scoring.ts, SSP-063; GDD §9.1, §10, §20 Q3, ENTITY_CATALOG §17 Q5): item and stain points
// × the multiplier after each pickup's increment (the GDD §10.4 worked example), 0-point pickups that still
// count for the chain, grime 1 / gutter 2 per cell, Kerb Hugger +50 per 180 continuous ticks, bonuses and
// penalties (the −20 dog-mess splat through the stain store's hook), the dump-drain freeze, and zero
// allocation per tick.
import { describe, expect, it } from 'vitest';
import tuningJson from '../../src/data/tuning.json' with { type: 'json' };
import { createBrush } from '../../src/sim/brush.ts';
import { createDirt, viewDirt } from '../../src/sim/dirt.ts';
import { LITTER_IDS, type LitterId, STAIN_IDS, type StainId } from '../../src/sim/entities.ts';
import {
  createEventQueue,
  EV,
  type EventQueue,
  emitEvent,
  pushEvent,
  resetEvents,
  sealEvents,
} from '../../src/sim/eventQueue.ts';
import { addLitter, beginLitterTick, createLitterField, stepLitter } from '../../src/sim/litter.ts';
import { createBlankLevel } from '../../src/sim/map.ts';
import {
  addPenalty,
  awardBonus,
  createScoring,
  type Scoring,
  type ScoringDirt,
  setScoringTuning,
  stepScoring,
  viewScoring,
} from '../../src/sim/scoring.ts';
import { createStainStore, stepBrushUpSplats } from '../../src/sim/stains.ts';
import { DEFAULT_ENTITIES, DEFAULT_TUNING, loadTuning } from '../../src/sim/tuning.ts';
import { createVehicleState } from '../../src/sim/vehicle.ts';
import { assertHeapDeltaWithinThresholds, measureHeapDelta } from '../support/heapDelta.ts';

/** Ticks the zero-allocation test pre-warms with before its measured run. */
const PREWARM_TICKS = 30_000;

const lit = (id: LitterId): number => LITTER_IDS.indexOf(id);
const stainPts = (id: StainId): number => DEFAULT_ENTITIES.stains[id].pts;

/** This tick's gameplay facts, as phases 5 and 6 would leave them for phase 9. */
type Facts = {
  litter?: readonly LitterId[];
  stains?: readonly StainId[];
  cells?: number;
  gutter?: number;
  kerb?: boolean;
  draining?: boolean;
  penalties?: readonly number[];
  /** EV.Caught points, emitted in phase 7 (SSP-084). */
  caught?: readonly number[];
};

type Rig = {
  s: Scoring;
  q: EventQueue;
  dirt: { tickCleanedCells: number; tickCleanedGutterCells: number; kerbContact: boolean };
  t: number;
  /** Every EV.ComboTier so far, as [tick, multiplier, previous, chain]. */
  tiers: number[][];
  /** Every EV.PickupScored so far (SSP-288), as [tick, multiplier, x, y, points]. */
  scored: number[][];
};

function rig(): Rig {
  return {
    s: createScoring(DEFAULT_TUNING, DEFAULT_ENTITIES),
    q: createEventQueue(),
    dirt: { tickCleanedCells: 0, tickCleanedGutterCells: 0, kerbContact: false },
    t: 0,
    tiers: [],
    scored: [],
  };
}

/** One tick: the facts pushed in phase order (litter in phase 5, stains in phase 6), then phase 9. */
function tick(r: Rig, f: Facts = {}): void {
  const q = r.q;
  resetEvents(q, r.t);
  for (const id of f.litter ?? []) pushEvent(q, EV.LitterCollected, 0, 1, 2, lit(id));
  for (const id of f.stains ?? []) pushEvent(q, EV.StainCleaned, STAIN_IDS.indexOf(id), 3, 4, stainPts(id));
  for (const pts of f.caught ?? []) pushEvent(q, EV.Caught, 2, 5, 6, pts);
  for (const pts of f.penalties ?? []) addPenalty(r.s, pts);
  r.dirt.tickCleanedCells = f.cells ?? 0;
  r.dirt.tickCleanedGutterCells = f.gutter ?? 0;
  r.dirt.kerbContact = f.kerb ?? false;
  const before = q.count;
  stepScoring(r.s, q, r.dirt, f.draining ?? false);
  for (let i = before; i < q.count; i++) {
    // Phase 9 appends only tier changes and (SSP-288) one EV.PickupScored per pickup.
    if (q.type[i] === EV.PickupScored) {
      r.scored.push([r.t, q.entity[i] as number, q.a[i] as number, q.b[i] as number, q.c[i] as number]);
      continue;
    }
    expect(q.type[i]).toBe(EV.ComboTier);
    r.tiers.push([r.t, q.a[i] as number, q.b[i] as number, q.c[i] as number]);
  }
  sealEvents(q);
  r.t += 1;
}

/** Score delta of one tick. */
function delta(r: Rig, f: Facts = {}): number {
  const before = r.s.score;
  tick(r, f);
  return r.s.score - before;
}

function expectPartsSum(s: Scoring): void {
  expect(s.score).toBe(s.itemPts + s.stainPts + s.grimePts + s.bonusPts + s.penaltyPts);
}

describe('GDD §10.4 worked example', () => {
  it('scores the crisp packet 10, the drink can 30 with TIDY! at chain 10, then ×2, +50 and the chain runs out', () => {
    const r = rig();
    // A chain of 8 built from earlier pickups (0-point spilled shopping, so the score starts at 0).
    for (let i = 0; i < 8; i++) tick(r, { litter: ['litter.spilled_shopping'] });
    expect(r.s.combo.chain).toBe(8);
    expect(r.s.score).toBe(0);

    expect(delta(r, { litter: ['litter.crisp_packet'] })).toBe(10); // 10 × 1, chain 9
    expect(r.s.combo.chain).toBe(9);
    expect(r.tiers).toEqual([]);
    const canTick = r.t;
    expect(delta(r, { litter: ['litter.drink_can'] })).toBe(30); // 15 × 2, chain 10
    expect(r.s.combo.chain).toBe(10);
    expect(r.s.combo.multiplier).toBe(2);
    expect(r.tiers).toEqual([[canTick, 2, 1, 10]]); // "TIDY!"

    // Six more items in 6 s at ×2 (chain 16), with 3 s of kerb contact along the strip: +50.
    const six: LitterId[] = [
      'litter.cigarette_butts',
      'litter.crisp_packet',
      'litter.drink_can',
      'litter.glass_bottle',
      'litter.pizza_box',
      'litter.bin_bag',
    ];
    let itemDelta = 0;
    for (let k = 0; k < 360; k++) {
      const item = k % 60 === 59 ? six[(k - 59) / 60] : undefined;
      const d = delta(r, { litter: item === undefined ? [] : [item], kerb: k < 180 });
      itemDelta += d;
      if (k === 179) expect(d).toBe(50 + 15 * 2); // the Kerb Hugger tick, which also collects the drink can
    }
    expect(r.s.combo.chain).toBe(16);
    expect(r.s.kerbHuggerAwards).toBe(1);
    expect(itemDelta).toBe(2 * (5 + 10 + 15 + 20 + 25 + 50) + 50);
    expect(r.s.score).toBe(10 + 30 + 250 + 50);

    // The strip ends: the brush goes up over an empty junction and the chain timer runs out after 2.0 s.
    const lastPickup = r.t - 1;
    for (let k = 0; k < 119; k++) tick(r);
    expect(r.s.combo.multiplier).toBe(2);
    tick(r);
    expect(r.s.combo.chain).toBe(0);
    expect(r.s.combo.multiplier).toBe(1);
    expect(r.tiers.at(-1)).toEqual([lastPickup + 120, 1, 2, 0]);
    expect(r.s.combo.bestChain).toBe(16);
    expectPartsSum(r.s);
  });
});

describe('pickups', () => {
  it('scores a cleaned gum stain at ×2 as 20 and extends the chain (ENTITY_CATALOG §17 Q5)', () => {
    const r = rig();
    tick(r, { litter: Array(10).fill('litter.spilled_shopping') });
    expect(r.s.combo.multiplier).toBe(2);
    for (let k = 0; k < 100; k++) tick(r);
    expect(r.s.combo.timerTicks).toBe(20);
    expect(delta(r, { stains: ['stain.gum'] })).toBe(20);
    expect(r.s.combo.chain).toBe(11);
    expect(r.s.combo.timerTicks).toBe(120);
    expect(r.s.stainPts).toBe(20);
    expect(r.s.itemPts).toBe(0);
  });

  it('counts 0-point pickups (spilled shopping, a cleaned splat) for the chain', () => {
    const r = rig();
    expect(delta(r, { litter: ['litter.spilled_shopping'], stains: ['stain.splat'] })).toBe(0);
    expect(r.s.combo.chain).toBe(2);
  });

  it('scores every pickup of a tick in emission order at its own multiplier', () => {
    const r = rig();
    tick(r, { litter: Array(8).fill('litter.spilled_shopping') });
    // Chain 9 (×1), 10 (×2), 11 (×2): 50 + 2·50 + 2·20 (milkshake, phase 6).
    expect(delta(r, { litter: ['litter.bin_bag', 'litter.bin_bag'], stains: ['stain.milkshake'] })).toBe(190);
    expect(r.tiers).toEqual([[1, 2, 1, 10]]);
  });

  it('applies ×3, ×4 and ×5 at chains 25, 50 and 100', () => {
    const r = rig();
    tick(r, { litter: Array(24).fill('litter.spilled_shopping') });
    expect(delta(r, { litter: ['litter.crisp_packet'] })).toBe(30);
    tick(r, { litter: Array(24).fill('litter.spilled_shopping') });
    expect(delta(r, { litter: ['litter.crisp_packet'] })).toBe(40);
    tick(r, { litter: Array(49).fill('litter.spilled_shopping') });
    expect(delta(r, { stains: ['stain.oil'] })).toBe(150);
    expect(r.s.combo.chain).toBe(100);
    expect(r.tiers.map((e) => e[1])).toEqual([2, 3, 4, 5]);
  });

  it('ignores every other event type and does not read the ComboTier events it emits', () => {
    const r = rig();
    resetEvents(r.q, 0);
    pushEvent(r.q, EV.Fling, 0, 0, 0, lit('litter.bin_bag'));
    pushEvent(r.q, EV.HopperFull, -1, 0, 0, 100);
    pushEvent(r.q, EV.Impact, -1, 0, 0, 5);
    for (let i = 0; i < 10; i++) pushEvent(r.q, EV.LitterCollected, i, 0, 0, lit('litter.crisp_packet'));
    stepScoring(r.s, r.q, r.dirt, false);
    expect(r.s.combo.chain).toBe(10);
    expect(r.s.score).toBe(9 * 10 + 20);
    // 13 facts, then per pickup its EV.PickupScored (SSP-288), the 10th preceded by its EV.ComboTier.
    expect(r.q.count).toBe(24);
    for (let i = 13; i < 22; i++) expect(r.q.type[i]).toBe(EV.PickupScored);
    expect(r.q.type[22]).toBe(EV.ComboTier);
    expect(r.q.type[23]).toBe(EV.PickupScored);
  });

  it('reports each pickup as EV.PickupScored (SSP-288): its position, the multiplier it scored at and its points', () => {
    const r = rig();
    tick(r, { litter: Array(8).fill('litter.spilled_shopping') });
    expect(r.scored).toHaveLength(8);
    expect(r.scored[0]).toEqual([0, 1, 1, 2, 0]);
    r.scored.length = 0;
    // Chain 9 (×1), 10 (×2), 11 (×2): the bin bags at (1, 2), the milkshake at (3, 4).
    tick(r, { litter: ['litter.bin_bag', 'litter.bin_bag'], stains: ['stain.milkshake'] });
    expect(r.scored).toEqual([
      [1, 1, 1, 2, 50],
      [1, 2, 1, 2, 100],
      [1, 2, 3, 4, 40],
    ]);
    // The tier change comes before the pickup that caused it.
    const q = r.q;
    const types = Array.from({ length: q.count }, (_, i) => q.type[i]);
    expect(types).toEqual([
      EV.LitterCollected,
      EV.LitterCollected,
      EV.StainCleaned,
      EV.PickupScored,
      EV.ComboTier,
      EV.PickupScored,
      EV.PickupScored,
    ]);
  });
});

describe('grime (GDD §9.1)', () => {
  it('scores 1 per cell and 2 per gutter cell, without building or breaking the chain', () => {
    const r = rig();
    expect(delta(r, { cells: 10, gutter: 3 })).toBe(7 + 6);
    expect(r.s.combo.chain).toBe(0);
    tick(r, { litter: ['litter.crisp_packet'] });
    for (let k = 0; k < 60; k++) expect(delta(r, { cells: 4 })).toBe(4);
    expect(r.s.combo.chain).toBe(1);
    expect(r.s.combo.timerTicks).toBe(60); // grime did not refresh it
    for (let k = 0; k < 60; k++) tick(r, { cells: 166, gutter: 6 });
    expect(r.s.combo.chain).toBe(0);
    expect(r.s.grimePts).toBe(13 + 240 + 60 * (160 + 12));
    expectPartsSum(r.s);
  });

  it('reads a real Dirt view', () => {
    const level = createBlankLevel('scoring.dirt', 8, 8);
    const dirt: ScoringDirt = viewDirt(createDirt(level, DEFAULT_TUNING));
    const r = rig();
    resetEvents(r.q, 0);
    stepScoring(r.s, r.q, dirt, false);
    expect(r.s.score).toBe(0);
  });
});

describe('Kerb Hugger (GDD §10.3)', () => {
  it('awards +50 at 180 continuous ticks of contact and nothing at 179', () => {
    const r = rig();
    for (let k = 0; k < 179; k++) tick(r, { kerb: true });
    expect(r.s.score).toBe(0);
    expect(r.s.kerbContactTicks).toBe(179);
    expect(delta(r, { kerb: true })).toBe(50);
    expect(r.s.kerbHuggerAwards).toBe(1);
    // Every further 180 ticks of the same contact: +50 again.
    for (let k = 0; k < 179; k++) tick(r, { kerb: true });
    expect(r.s.score).toBe(50);
    expect(delta(r, { kerb: true })).toBe(50);
    expect(r.s.kerbHuggerAwards).toBe(2);
    expect(r.s.bonusPts).toBe(100);
  });

  it('restarts the count when contact breaks', () => {
    const r = rig();
    for (let k = 0; k < 179; k++) tick(r, { kerb: true });
    tick(r, { kerb: false });
    expect(r.s.kerbContactTicks).toBe(0);
    for (let k = 0; k < 179; k++) tick(r, { kerb: true });
    expect(r.s.score).toBe(0);
    expect(delta(r, { kerb: true })).toBe(50);
  });

  it('is neither multiplied nor chain-extending (GDD §20 Q3)', () => {
    const r = rig();
    // Contact tick 1 builds a ×5 chain; 0-point pickups every 60 ticks keep it alive.
    tick(r, { litter: Array(110).fill('litter.spilled_shopping'), kerb: true });
    for (let k = 2; k < 180; k++)
      tick(r, { kerb: true, litter: k % 60 === 0 ? ['litter.spilled_shopping'] : [] });
    expect(r.s.kerbContactTicks).toBe(179);
    expect(r.s.combo.multiplier).toBe(5);
    expect(r.s.score).toBe(0);
    const timer = r.s.combo.timerTicks;
    expect(delta(r, { kerb: true })).toBe(50); // not 250
    expect(r.s.combo.chain).toBe(112); // not extended
    expect(r.s.combo.timerTicks).toBe(timer - 1); // not refreshed
  });
});

describe('bonus API (GDD §10.3)', () => {
  it('adds a Clean Sweep +100 unmultiplied and leaves the chain alone', () => {
    const r = rig();
    tick(r, { litter: Array(30).fill('litter.spilled_shopping') });
    expect(r.s.combo.multiplier).toBe(3);
    const timer = r.s.combo.timerTicks;
    awardBonus(r.s, DEFAULT_TUNING.scoring.cleanSweepPts);
    expect(r.s.score).toBe(100);
    expect(r.s.bonusPts).toBe(100);
    expect([r.s.combo.chain, r.s.combo.timerTicks]).toEqual([30, timer]);
    expect(() => awardBonus(r.s, 0)).toThrow(/positive integer/);
    expect(() => awardBonus(r.s, 2.5)).toThrow(/positive integer/);
  });

  it('scores EV.Caught (SSP-084) as a +100 style bonus: unmultiplied at ×3, the chain and its timer untouched', () => {
    const r = rig();
    tick(r, { litter: Array(30).fill('litter.spilled_shopping') });
    expect(r.s.combo.multiplier).toBe(3);
    const timer = r.s.combo.timerTicks;
    // Caught! between two ticks' worth of chain: the timer counts down once, nothing refreshes it.
    expect(delta(r, { caught: [DEFAULT_ENTITIES.npcs['npc.litterbug'].rules.caughtPts] })).toBe(100);
    expect(r.s.bonusPts).toBe(100);
    expect([r.s.combo.chain, r.s.combo.multiplier, r.s.combo.timerTicks]).toEqual([30, 3, timer - 1]);
    // In the same tick as a pickup, the pickup takes the multiplier and the Caught! does not.
    expect(delta(r, { litter: ['litter.drink_can'], caught: [100] })).toBe(15 * 3 + 100);
    expect(r.s.combo.chain).toBe(31);
    expect(r.tiers).toEqual([
      [0, 2, 1, 10],
      [0, 3, 2, 25],
    ]);
    expectPartsSum(r.s);
  });
});

describe('penalty API (GDD §10.2, §11.1)', () => {
  it('resets the chain to 0 and the multiplier to ×1 and takes the points off', () => {
    const r = rig();
    tick(r, { litter: Array(30).fill('litter.spilled_shopping') });
    expect(r.s.combo.multiplier).toBe(3);
    expect(delta(r, { penalties: [-20] })).toBe(-20);
    expect([r.s.combo.chain, r.s.combo.multiplier, r.s.combo.timerTicks]).toEqual([0, 1, 0]);
    expect(r.tiers.at(-1)).toEqual([1, 1, 3, 0]);
    expect(r.s.penaltyPts).toBe(-20);
    expect(r.s.score).toBe(-20); // the score is not clamped at 0
    expectPartsSum(r.s);
    expect(() => addPenalty(r.s, 5)).toThrow(/0 or below/);
    expect(() => addPenalty(r.s, -1.5)).toThrow(/0 or below/);
  });

  it('applies after the tick’s pickups: they score at the old multiplier, and the tick ends at chain 0', () => {
    const r = rig();
    tick(r, { litter: Array(12).fill('litter.spilled_shopping') });
    expect(delta(r, { litter: ['litter.bin_bag'], penalties: [-20, -50] })).toBe(100 - 70);
    expect(r.s.combo.chain).toBe(0);
    expect(r.s.pendingPenalties).toBe(0);
    // The next tick starts a new chain at ×1.
    expect(delta(r, { litter: ['litter.bin_bag'] })).toBe(50);
  });

  it('charges the −20 dog-mess splat through the stain store’s hook', () => {
    const level = createBlankLevel('scoring.splat', 64, 64);
    const field = createLitterField(level, DEFAULT_TUNING, DEFAULT_ENTITIES);
    const stains = createStainStore(DEFAULT_ENTITIES);
    const brush = createBrush(DEFAULT_TUNING, 1); // starts Raised
    const vehicle = createVehicleState(DEFAULT_TUNING.vehicle.sweeper, 64, 64, 0);
    const r = rig();
    stains.onPenalty = r.s.penaltyHook;
    tick(r, { litter: Array(12).fill('litter.spilled_shopping') });
    expect(r.s.combo.multiplier).toBe(2);

    addLitter(field, lit('litter.dog_mess'), 64, 64, 0);
    resetEvents(r.q, r.t);
    beginLitterTick(field);
    expect(stepBrushUpSplats(stains, field, brush, vehicle, DEFAULT_TUNING.vehicle.sweeper)).toBe(1);
    stepLitter(field);
    expect(r.s.score).toBe(0); // recorded, not yet applied: phase 9 applies it
    stepScoring(r.s, r.q, r.dirt, false);
    expect(r.s.score).toBe(-20);
    expect(r.s.combo.chain).toBe(0);
    expect(r.s.combo.multiplier).toBe(1);
  });
});

describe('dump-drain freeze (GDD §20 Q4)', () => {
  it('keeps the chain while shift.isDraining holds', () => {
    const r = rig();
    tick(r, { litter: Array(10).fill('litter.spilled_shopping') });
    for (let k = 0; k < 60; k++) tick(r);
    for (let k = 0; k < 180; k++) tick(r, { draining: true });
    expect(r.s.combo.chain).toBe(10);
    expect(r.s.combo.timerTicks).toBe(60);
    for (let k = 0; k < 59; k++) tick(r);
    expect(r.s.combo.chain).toBe(10);
    tick(r);
    expect(r.s.combo.chain).toBe(0);
  });
});

describe('setup and tuning', () => {
  it('starts at zero and reads the scoring numbers from the tuning it is given', () => {
    const s = createScoring(DEFAULT_TUNING, DEFAULT_ENTITIES);
    const v = viewScoring(s);
    expect([v.score, v.combo.chain, v.combo.multiplier, v.kerbContactTicks]).toEqual([0, 0, 1, 0]);
    expect(s.litterPts[lit('litter.bin_bag')]).toBe(50);
    expect(s.kerbHuggerTicks).toBe(180);

    const raw = structuredClone(tuningJson);
    raw.scoring.grimeCellPts = 2;
    raw.scoring.gutterGrimeCellPts = 5;
    raw.scoring.kerbHuggerPts = 75;
    raw.scoring.kerbHuggerEveryS = 1;
    raw.combo.chainS = 1;
    const r = rig();
    setScoringTuning(r.s, loadTuning(raw));
    expect(delta(r, { cells: 3, gutter: 1 })).toBe(2 * 2 + 5);
    for (let k = 0; k < 59; k++) tick(r, { kerb: true });
    expect(delta(r, { kerb: true })).toBe(75);
    expect(r.s.combo.refreshTicks).toBe(60);
  });
});

describe('zero allocation per tick (TECHNICAL_DESIGN §17)', () => {
  it('runs stepScoring over pickups, stains, grime, Kerb Hugger, tier changes and penalties', () => {
    const s = createScoring(DEFAULT_TUNING, DEFAULT_ENTITIES);
    const q = createEventQueue();
    const dirt = { tickCleanedCells: 0, tickCleanedGutterCells: 0, kerbContact: false };
    const bin = lit('litter.bin_bag');
    const gum = STAIN_IDS.indexOf('stain.gum');
    const hook = s.penaltyHook;
    const step = (t: number): void => {
      resetEvents(q, t);
      if (t % 2 === 0) q.c[emitEvent(q, EV.LitterCollected, 0)] = bin;
      if (t % 7 === 0) q.c[emitEvent(q, EV.StainCleaned, gum)] = 10;
      if (t % 613 === 0) hook(-20, 1, 2);
      dirt.tickCleanedCells = t % 11;
      dirt.tickCleanedGutterCells = t % 3;
      dirt.kerbContact = t % 400 < 250;
      stepScoring(s, q, dirt, t % 900 < 120);
      sealEvents(q);
    };
    // Pre-warm through the same harness call, discarding the reading, so every path (penalties come every 613
    // ticks), the step closure and the helper's loops have tiered up before the measured window (TECHNICAL_DESIGN
    // §17); without it the window measures V8 compiling them (~100–870 KB, then ~38 KB now and then), not the tick.
    let base = 0;
    const measured = (t: number): void => step(base + t);
    measureHeapDelta(measured, { warmupTicks: PREWARM_TICKS });
    base = 2 * PREWARM_TICKS;
    const result = measureHeapDelta(measured);
    assertHeapDeltaWithinThresholds(result);
    expect(s.score).toBe(s.itemPts + s.stainPts + s.grimePts + s.bonusPts + s.penaltyPts);
  });
});
