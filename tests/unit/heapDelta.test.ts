// Zero-allocation heap-delta check (TECHNICAL_DESIGN §17, SSP-292).
//
// Runs under `node --expose-gc` through the unit project's execArgv (vitest.config.ts GC_EXPOSED). Without the
// flag every measuring test throws GC_UNAVAILABLE_MESSAGE; nothing is skipped.
//
// The synthetic ticks (tests/support/syntheticTicks.ts) stand in for the M0-less sim: an allocation-free tick
// over stores at the §17 capacities, plus a transient and a retained variant that each allocate one `{ x, y }`
// per tick. Each variant is measured HEAP_RUNS times; the clean tick must pass every run and both bad variants
// must fail every run. The per-variant distributions are logged so the output records them.
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertHeapDeltaWithinThresholds,
  GC_UNAVAILABLE_MESSAGE,
  HEAP_MEASURED_TICKS,
  HEAP_PRE_GC_THRESHOLD_BYTES,
  HEAP_RETAINED_THRESHOLD_BYTES,
  HEAP_WARMUP_TICKS,
  type HeapDelta,
  heapDeltaFailure,
  measureHeapDelta,
  requireGc,
} from '../support/heapDelta.ts';
import {
  createSyntheticTick,
  createSyntheticWorld,
  resetSyntheticSinks,
  retainedSinkLength,
  SYNTHETIC_CAPACITY,
  SyntheticVariant,
  stepSyntheticWorld,
  transientSinkValue,
} from '../support/syntheticTicks.ts';

/** Measurements per variant (SSP-292 threshold rule: at least 20). */
const HEAP_RUNS = 20;

/**
 * Wall-clock budget per 20-run test. One test takes ~2.5 s on the dev Mac; the default 5 s would be tight on a
 * 2-core CI runner with other test files running in parallel. (The measuring loop is synchronous, so a timeout
 * can only report, never interrupt.)
 */
const HEAP_TEST_TIMEOUT_MS = 60_000;

type Distribution = { readonly min: number; readonly median: number; readonly max: number };

function distribution(values: readonly number[]): Distribution {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const median =
    sorted.length % 2 === 1 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
  return { min: sorted[0] ?? 0, median, max: sorted[sorted.length - 1] ?? 0 };
}

function measureRuns(variant: SyntheticVariant): HeapDelta[] {
  const deltas: HeapDelta[] = [];
  for (let run = 0; run < HEAP_RUNS; run++) {
    deltas.push(measureHeapDelta(createSyntheticTick(variant)));
    resetSyntheticSinks();
  }
  const retained = distribution(deltas.map((d) => d.retainedBytes));
  const preGc = distribution(deltas.map((d) => d.preGcBytes));
  console.log(
    `heapDelta ${variant} x${HEAP_RUNS} (bytes, min/median/max): ` +
      `retained ${retained.min}/${retained.median}/${retained.max}, ` +
      `pre-final-GC ${preGc.min}/${preGc.median}/${preGc.max}`,
  );
  return deltas;
}

afterEach(() => {
  resetSyntheticSinks();
});

describe('heap-delta harness', () => {
  it('runs with globalThis.gc exposed by --expose-gc', () => {
    expect(process.execArgv, 'the unit project must start workers with --expose-gc').toContain('--expose-gc');
    expect(typeof globalThis.gc, GC_UNAVAILABLE_MESSAGE).toBe('function');
    console.log(`heapDelta: globalThis.gc available (execArgv ${process.execArgv.join(' ')})`);
  });

  it('fails loudly, never silently, when gc is unavailable', () => {
    const saved = globalThis.gc;
    globalThis.gc = undefined;
    try {
      expect(() => requireGc()).toThrow(GC_UNAVAILABLE_MESSAGE);
      expect(() => measureHeapDelta(() => {})).toThrow('globalThis.gc is unavailable');
    } finally {
      globalThis.gc = saved;
    }
  });

  it('follows the §17 procedure: 600 warm-up ticks, then 3,600 measured ticks, tick indices continuous', () => {
    expect(HEAP_WARMUP_TICKS).toBe(600);
    expect(HEAP_MEASURED_TICKS).toBe(3600);
    let calls = 0;
    let lastTick = -1;
    let continuous = true;
    const delta = measureHeapDelta((tick) => {
      if (tick !== lastTick + 1) continuous = false;
      lastTick = tick;
      calls++;
    });
    expect(calls).toBe(HEAP_WARMUP_TICKS + HEAP_MEASURED_TICKS);
    expect(lastTick).toBe(HEAP_WARMUP_TICKS + HEAP_MEASURED_TICKS - 1);
    expect(continuous).toBe(true);
    expect(delta.warmupTicks).toBe(HEAP_WARMUP_TICKS);
    expect(delta.ticks).toBe(HEAP_MEASURED_TICKS);
  });

  it('honours custom tick counts and rejects invalid ones', () => {
    let calls = 0;
    const delta = measureHeapDelta(() => calls++, { warmupTicks: 10, ticks: 20 });
    expect(calls).toBe(30);
    expect(delta).toMatchObject({ warmupTicks: 10, ticks: 20 });
    expect(() => measureHeapDelta(() => {}, { ticks: -1 })).toThrow('non-negative integer');
    expect(() => measureHeapDelta(() => {}, { warmupTicks: 1.5 })).toThrow('non-negative integer');
  });

  it('reports a failure for either delta above its threshold, and none at the threshold', () => {
    const at: HeapDelta = {
      warmupTicks: 600,
      ticks: 3600,
      retainedBytes: HEAP_RETAINED_THRESHOLD_BYTES,
      preGcBytes: HEAP_PRE_GC_THRESHOLD_BYTES,
    };
    expect(heapDeltaFailure(at)).toBeNull();
    expect(() => assertHeapDeltaWithinThresholds(at)).not.toThrow();
    const retainedOver = { ...at, retainedBytes: HEAP_RETAINED_THRESHOLD_BYTES + 1 };
    expect(heapDeltaFailure(retainedOver)).toMatch(/retained heap grew/);
    expect(heapDeltaFailure(retainedOver)).not.toMatch(/pre-final-GC/);
    const preGcOver = { ...at, preGcBytes: HEAP_PRE_GC_THRESHOLD_BYTES + 1 };
    expect(heapDeltaFailure(preGcOver)).toMatch(/pre-final-GC heap grew/);
    expect(() => assertHeapDeltaWithinThresholds(preGcOver)).toThrow(/heap check failed over 3600 ticks/);
  });
});

describe('synthetic ticks', () => {
  it('sizes the stores to the §17 capacities and moves every body', () => {
    expect(SYNTHETIC_CAPACITY).toEqual({ litter: 2000, npcs: 80, vehicles: 30 });
    const world = createSyntheticWorld();
    expect(world.litter.x.length).toBe(2000);
    expect(world.npcs.vy.length).toBe(80);
    expect(world.vehicles.vx.length).toBe(30);
    const before = Float64Array.from(world.vehicles.x);
    stepSyntheticWorld(world);
    expect(world.vehicles.x).not.toEqual(before);
    for (const v of world.litter.x) expect(v >= 0 && v <= 256).toBe(true);
  });

  it('makes the bad variants allocate exactly as described', () => {
    createSyntheticTick(SyntheticVariant.Transient)(0);
    expect(transientSinkValue()).toMatchObject({ x: expect.any(Number), y: expect.any(Number) });
    const retained = createSyntheticTick(SyntheticVariant.Retained);
    for (let t = 0; t < 5; t++) retained(t);
    expect(retainedSinkLength()).toBe(5);
    resetSyntheticSinks();
    expect(transientSinkValue()).toBeNull();
    expect(retainedSinkLength()).toBe(0);
  });
});

describe(`zero-allocation threshold (TECHNICAL_DESIGN §17), ${HEAP_RUNS} runs per variant`, {
  timeout: HEAP_TEST_TIMEOUT_MS,
}, () => {
  it(`passes the allocation-free tick in ${HEAP_RUNS} of ${HEAP_RUNS} runs`, () => {
    const failures = measureRuns(SyntheticVariant.Clean)
      .map((delta) => heapDeltaFailure(delta))
      .filter((f) => f !== null);
    expect(failures).toEqual([]);
  });

  it(`fails the transient variant (one { x, y } per tick, dropped) in ${HEAP_RUNS} of ${HEAP_RUNS} runs`, () => {
    const deltas = measureRuns(SyntheticVariant.Transient);
    for (const delta of deltas) {
      expect(heapDeltaFailure(delta), JSON.stringify(delta)).toMatch(/pre-final-GC heap grew/);
      // The spike's open question, answered: the final GC sweeps the transient garbage, so the retained delta
      // alone cannot tell this variant from the clean tick. The pre-final-GC threshold is what catches it.
      expect(delta.retainedBytes, JSON.stringify(delta)).toBeLessThanOrEqual(HEAP_RETAINED_THRESHOLD_BYTES);
    }
  });

  it(`fails the retained variant (one { x, y } per tick, kept) in ${HEAP_RUNS} of ${HEAP_RUNS} runs`, () => {
    const deltas = measureRuns(SyntheticVariant.Retained);
    for (const delta of deltas) {
      expect(heapDeltaFailure(delta), JSON.stringify(delta)).toMatch(/retained heap grew/);
    }
  });
});
