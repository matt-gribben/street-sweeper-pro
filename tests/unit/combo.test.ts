// The combo chain (src/sim/combo.ts, SSP-063; GDD §10.2, §20 Q4): the ×1..×5 tiers at chain 10/25/50/100,
// the multiplier read after the increment, the 120-tick chain timer and its exact expiry tick, the dump-drain
// freeze, the penalty reset, the pwr.flask_of_tea timer-multiplier hook, EV.ComboTier on every multiplier
// change, the tuning hand-over and zero allocation per tick.
import { describe, expect, it } from 'vitest';
import tuningJson from '../../src/data/tuning.json' with { type: 'json' };
import {
  addComboPickup,
  type Combo,
  comboMultiplierFor,
  comboTimerFraction,
  createCombo,
  resetCombo,
  setComboTimerMultiplier,
  setComboTuning,
  stepComboTimer,
  viewCombo,
} from '../../src/sim/combo.ts';
import {
  countEvents,
  createEventQueue,
  EV,
  type EventQueue,
  resetEvents,
  sealEvents,
} from '../../src/sim/eventQueue.ts';
import { DEFAULT_TUNING, loadTuning } from '../../src/sim/tuning.ts';
import { assertHeapDeltaWithinThresholds, measureHeapDelta } from '../support/heapDelta.ts';

/** Ticks run before the heap check's own warm-up (see the zero-allocation test). */
const PREWARM_TICKS = 30_000;

/** The ComboTier events of the queue's current tick, as [multiplier, previous, chain]. */
function tierEvents(q: EventQueue): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < q.count; i++) {
    if (q.type[i] === EV.ComboTier) {
      expect(q.entity[i]).toBe(-1);
      out.push([q.a[i] as number, q.b[i] as number, q.c[i] as number]);
    }
  }
  return out;
}

/** A combo with its own event queue and tick counter. One `tick` = phase 9's combo work for one sim tick. */
type Rig = { combo: Combo; q: EventQueue; t: number; tiers: number[][] };

function rig(): Rig {
  return { combo: createCombo(DEFAULT_TUNING), q: createEventQueue(), t: 0, tiers: [] };
}

/** One tick: the timer step (frozen or not), then `pickups` pickups. Returns the last pickup's multiplier. */
function tick(r: Rig, pickups = 0, frozen = false): number {
  resetEvents(r.q, r.t);
  stepComboTimer(r.combo, frozen, r.q);
  let mul = 0;
  for (let i = 0; i < pickups; i++) mul = addComboPickup(r.combo, r.q);
  r.tiers.push(...tierEvents(r.q));
  sealEvents(r.q);
  r.t += 1;
  return mul;
}

describe('tiers (GDD §10.2)', () => {
  it('maps chain lengths to ×1..×5 at 10/25/50/100', () => {
    const c = createCombo(DEFAULT_TUNING);
    const cases: [number, number][] = [
      [0, 1],
      [1, 1],
      [9, 1],
      [10, 2],
      [24, 2],
      [25, 3],
      [49, 3],
      [50, 4],
      [99, 4],
      [100, 5],
      [1000, 5],
    ];
    for (const [chain, mul] of cases) expect(comboMultiplierFor(c, chain)).toBe(mul);
  });

  it('scores each pickup at the multiplier after its own increment and emits EV.ComboTier at 10/25/50/100', () => {
    const r = rig();
    const muls: number[] = [];
    for (let n = 1; n <= 120; n++) muls.push(tick(r, 1));
    for (let n = 1; n <= 120; n++) {
      const expected = n >= 100 ? 5 : n >= 50 ? 4 : n >= 25 ? 3 : n >= 10 ? 2 : 1;
      expect(muls[n - 1], `chain ${n}`).toBe(expected);
    }
    expect(r.combo.chain).toBe(120);
    expect(r.combo.multiplier).toBe(5);
    expect(r.combo.bestChain).toBe(120);
    expect(r.tiers).toEqual([
      [2, 1, 10],
      [3, 2, 25],
      [4, 3, 50],
      [5, 4, 100],
    ]);
  });

  it('emits one event at the pickup that crosses a threshold when several land in one tick', () => {
    const r = rig();
    tick(r, 8);
    expect(r.tiers).toEqual([]);
    expect(tick(r, 5)).toBe(2);
    expect(r.combo.chain).toBe(13);
    expect(r.tiers).toEqual([[2, 1, 10]]);
  });
});

describe('chain timer', () => {
  it('refreshes to 120 ticks (2.0 s) and expires exactly 120 ticks after the last pickup', () => {
    const r = rig();
    for (let i = 0; i < 12; i++) tick(r, 1); // chain 12, ×2
    const last = r.t - 1;
    expect(r.combo.timerTicks).toBe(120);
    expect(comboTimerFraction(viewCombo(r.combo))).toBe(1);
    for (let i = 1; i <= 119; i++) {
      tick(r);
      expect(r.combo.chain, `tick last + ${i}`).toBe(12);
      expect(r.combo.multiplier).toBe(2);
      expect(r.combo.timerTicks).toBe(120 - i);
    }
    // Ticks last+1 .. last+119 kept the chain alive; the timer is down to 1.
    expect(r.combo.timerTicks).toBe(1);
    expect(r.combo.chain).toBe(12);
    tick(r); // tick last + 120
    expect(r.t - 1).toBe(last + 120);
    expect(r.combo.chain).toBe(0);
    expect(r.combo.multiplier).toBe(1);
    expect(r.combo.timerTicks).toBe(0);
    expect(comboTimerFraction(r.combo)).toBe(0);
    expect(r.tiers.at(-1)).toEqual([1, 2, 0]);
    expect(r.combo.bestChain).toBe(12);
  });

  it('is extended by a pickup 119 ticks later but not by one 120 ticks later', () => {
    const late = rig();
    tick(late, 1);
    for (let i = 0; i < 118; i++) tick(late);
    tick(late, 1); // 119 ticks after the first pickup
    expect(late.combo.chain).toBe(2);

    const tooLate = rig();
    tick(tooLate, 1);
    for (let i = 0; i < 119; i++) tick(tooLate);
    tick(tooLate, 1); // 120 ticks after: the chain expired first, this starts a new one
    expect(tooLate.combo.chain).toBe(1);
  });

  it('does not count down while frozen (a dump draining, GDD §20 Q4)', () => {
    const r = rig();
    for (let i = 0; i < 10; i++) tick(r, 1);
    for (let i = 0; i < 50; i++) tick(r);
    expect(r.combo.timerTicks).toBe(70);
    for (let i = 0; i < 600; i++) tick(r, 0, true);
    expect(r.combo.timerTicks).toBe(70);
    expect(r.combo.chain).toBe(10);
    // A pickup while frozen still counts and refreshes.
    tick(r, 1, true);
    expect(r.combo.chain).toBe(11);
    expect(r.combo.timerTicks).toBe(120);
    for (let i = 0; i < 119; i++) tick(r);
    expect(r.combo.chain).toBe(11);
    tick(r);
    expect(r.combo.chain).toBe(0);
  });

  it('does nothing with no chain', () => {
    const r = rig();
    for (let i = 0; i < 300; i++) tick(r);
    expect([r.combo.chain, r.combo.multiplier, r.combo.timerTicks]).toEqual([0, 1, 0]);
    expect(r.tiers).toEqual([]);
  });

  it('doubles the refresh to 240 ticks with the timer-multiplier hook (pwr.flask_of_tea, M3)', () => {
    const r = rig();
    setComboTimerMultiplier(r.combo, 2);
    tick(r, 1);
    expect(r.combo.timerTicks).toBe(240);
    expect(r.combo.refreshTicks).toBe(240);
    for (let i = 0; i < 239; i++) tick(r);
    expect(r.combo.chain).toBe(1);
    expect(comboTimerFraction(r.combo)).toBeCloseTo(1 / 240, 12);
    tick(r);
    expect(r.combo.chain).toBe(0);

    // Back to ×1: refreshes are 120 again; the running timer is not rescaled.
    tick(r, 1);
    setComboTimerMultiplier(r.combo, 1);
    expect(r.combo.timerTicks).toBe(240);
    tick(r, 1);
    expect(r.combo.timerTicks).toBe(120);
    expect(() => setComboTimerMultiplier(r.combo, 0)).toThrow(/positive/);
    expect(() => setComboTimerMultiplier(r.combo, Number.NaN)).toThrow(/positive/);
  });
});

describe('penalty reset', () => {
  it('sets the chain to 0 and the multiplier to ×1, emitting the drop', () => {
    const r = rig();
    tick(r, 30);
    expect(r.combo.multiplier).toBe(3);
    resetEvents(r.q, r.t);
    resetCombo(r.combo, r.q);
    expect([r.combo.chain, r.combo.multiplier, r.combo.timerTicks]).toEqual([0, 1, 0]);
    expect(tierEvents(r.q)).toEqual([[1, 3, 0]]);
    expect(r.combo.bestChain).toBe(30);
  });

  it('emits nothing when the multiplier was already ×1', () => {
    const r = rig();
    tick(r, 5);
    resetEvents(r.q, r.t);
    resetCombo(r.combo, r.q);
    expect(r.combo.chain).toBe(0);
    expect(countEvents(r.q, EV.ComboTier)).toBe(0);
  });
});

describe('tuning', () => {
  it('reads chainS and the tiers from the tuning it is given', () => {
    const raw = structuredClone(tuningJson);
    raw.combo.chainS = 1.5;
    raw.combo.tiers = [
      { minChain: 3, multiplier: 2 },
      { minChain: 6, multiplier: 7 },
    ];
    const c = createCombo(loadTuning(raw));
    expect(c.refreshTicks).toBe(90);
    expect([2, 3, 5, 6, 99].map((n) => comboMultiplierFor(c, n))).toEqual([1, 2, 2, 7, 7]);

    // Handing it back the committed tuning keeps the chain and re-derives the multiplier, without an event.
    const q = createEventQueue();
    resetEvents(q, 0);
    for (let i = 0; i < 6; i++) addComboPickup(c, q);
    expect(c.multiplier).toBe(7);
    setComboTuning(c, DEFAULT_TUNING);
    expect(c.chain).toBe(6);
    expect(c.multiplier).toBe(1);
    expect(c.refreshTicks).toBe(120);
  });
});

describe('zero allocation per tick (TECHNICAL_DESIGN §17)', () => {
  it('runs the timer, pickups, tier changes, expiries and resets without allocating', () => {
    const c = createCombo(DEFAULT_TUNING);
    const q = createEventQueue();
    // Bursts of pickups every 2 ticks for 240 ticks in 480, so chains reach ×5 and then expire; a freeze and a
    // penalty reset now and then.
    const step = (t: number): void => {
      resetEvents(q, t);
      stepComboTimer(c, t % 700 < 60, q);
      if (t % 480 < 240 && t % 2 === 0) addComboPickup(c, q);
      if (t % 997 === 0) resetCombo(c, q);
      sealEvents(q);
    };
    // Pre-warm through the same harness call, discarding the reading, so every path, the step closure and the
    // helper's loops have tiered up before the measured window (TECHNICAL_DESIGN §17: the World test pre-warms
    // too); without it the window measures V8 compiling the rarer paths, not the tick.
    let base = 0;
    const measured = (t: number): void => step(base + t);
    measureHeapDelta(measured, { warmupTicks: PREWARM_TICKS });
    base = 2 * PREWARM_TICKS;
    const delta = measureHeapDelta(measured);
    assertHeapDeltaWithinThresholds(delta);
    expect(c.bestChain).toBeGreaterThan(100);
  });
});
