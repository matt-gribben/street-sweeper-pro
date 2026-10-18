// Shared zero-allocation heap-delta helper (TECHNICAL_DESIGN §17, SSP-292).
//
// Implements the §17 procedure: warm up, force a full GC, run N ticks, read the heap (garbage still
// resident), force a full GC again, read the heap. Two numbers come back:
//   - retainedBytes: heap after the final GC minus heap after the first GC. Catches anything a tick keeps
//     alive (pushes into a growing array, caches, listeners).
//   - preGcBytes: heap just BEFORE the final GC minus heap after the first GC. Catches per-tick transient
//     garbage, which the final GC would otherwise sweep away before retainedBytes is read.
// Callers compare both against HEAP_RETAINED_THRESHOLD_BYTES and HEAP_PRE_GC_THRESHOLD_BYTES with
// assertHeapDeltaWithinThresholds().
//
// The measured window is fully synchronous, so nothing else in the worker (Vitest RPC, timers, logging) can
// allocate inside it. Needs `node --expose-gc`: the Vitest unit project passes it through `execArgv`
// (vitest.config.ts, GC_EXPOSED); anything else must start Node with the flag. Without it every entry point
// throws; it never skips.

/** Ticks run before the first forced GC, so lazy compilation and inline caches settle (§17). */
export const HEAP_WARMUP_TICKS = 600;

/** Ticks inside the measured window: one minute of sim at 60 Hz, the replay length (§17, §18.3). */
export const HEAP_MEASURED_TICKS = 3600;

/**
 * Maximum retained heap growth over the measured window: 32 KiB. Set by SSP-292 from measurements on the dev
 * Mac (distributions in TECHNICAL_DESIGN §17): the allocation-free tick retains at most ~15 KB (usually
 * under 1 KB; the worst case is V8 compiling code inside the window), one retained `{ x, y }` per tick retains ~287 KB over 3,600 ticks.
 */
export const HEAP_RETAINED_THRESHOLD_BYTES = 32_768;

/**
 * Maximum heap growth just before the final GC (garbage still resident): 32 KiB. Set by SSP-292 (TECHNICAL_DESIGN
 * §17): the allocation-free tick stays at ~3.4 KB (at most ~19 KB when the harness itself is re-optimised),
 * one transient `{ x, y }` per tick leaves ~265 KB of garbage, and even the smallest per-tick allocation (one
 * 16-byte boxed number) leaves ~58 KB.
 */
export const HEAP_PRE_GC_THRESHOLD_BYTES = 32_768;

/** One simulation tick under test. It receives the absolute tick index (warm-up ticks included). */
export type HeapStep = (tick: number) => void;

export type HeapDeltaOptions = {
  readonly warmupTicks?: number;
  readonly ticks?: number;
};

export type HeapDelta = {
  readonly warmupTicks: number;
  readonly ticks: number;
  /** Heap used after the final GC minus heap used after the first GC. */
  readonly retainedBytes: number;
  /** Heap used just before the final GC minus heap used after the first GC. */
  readonly preGcBytes: number;
};

export const GC_UNAVAILABLE_MESSAGE =
  'globalThis.gc is unavailable: the heap-delta check needs `node --expose-gc` ' +
  '(Vitest: run it in the unit project, whose execArgv passes the flag; see vitest.config.ts GC_EXPOSED)';

/** Returns `globalThis.gc`, or throws GC_UNAVAILABLE_MESSAGE. Never returns a no-op. */
export function requireGc(): NodeJS.GCFunction {
  const gc = globalThis.gc;
  if (typeof gc !== 'function') throw new Error(GC_UNAVAILABLE_MESSAGE);
  return gc;
}

function heapUsedBytes(): number {
  return process.memoryUsage().heapUsed;
}

function checkTickCount(name: string, value: number): number {
  if (!Number.isInteger(value) || value < 0)
    throw new Error(`heapDelta: ${name} must be a non-negative integer`);
  return value;
}

/** Runs the §17 procedure over `step` and returns both heap deltas in bytes. */
export function measureHeapDelta(step: HeapStep, options: HeapDeltaOptions = {}): HeapDelta {
  const gc = requireGc();
  const warmupTicks = checkTickCount('warmupTicks', options.warmupTicks ?? HEAP_WARMUP_TICKS);
  const ticks = checkTickCount('ticks', options.ticks ?? HEAP_MEASURED_TICKS);
  const endTick = warmupTicks + ticks;

  let tick = 0;
  for (; tick < warmupTicks; tick++) step(tick);
  gc();
  const baseline = heapUsedBytes();
  for (; tick < endTick; tick++) step(tick);
  const beforeFinalGc = heapUsedBytes();
  gc();
  const afterFinalGc = heapUsedBytes();

  return {
    warmupTicks,
    ticks,
    retainedBytes: afterFinalGc - baseline,
    preGcBytes: beforeFinalGc - baseline,
  };
}

export type HeapThresholds = {
  readonly retainedBytes: number;
  readonly preGcBytes: number;
};

export const HEAP_THRESHOLDS: HeapThresholds = {
  retainedBytes: HEAP_RETAINED_THRESHOLD_BYTES,
  preGcBytes: HEAP_PRE_GC_THRESHOLD_BYTES,
};

/** The §17 verdict: null when both deltas are within their thresholds, else a human-readable failure. */
export function heapDeltaFailure(
  delta: HeapDelta,
  thresholds: HeapThresholds = HEAP_THRESHOLDS,
): string | null {
  const failures: string[] = [];
  if (delta.retainedBytes > thresholds.retainedBytes) {
    failures.push(`retained heap grew ${delta.retainedBytes} B (threshold ${thresholds.retainedBytes} B)`);
  }
  if (delta.preGcBytes > thresholds.preGcBytes) {
    failures.push(`pre-final-GC heap grew ${delta.preGcBytes} B (threshold ${thresholds.preGcBytes} B)`);
  }
  if (failures.length === 0) return null;
  return `heap check failed over ${delta.ticks} ticks after a ${delta.warmupTicks}-tick warm-up: ${failures.join('; ')}`;
}

/** Throws heapDeltaFailure()'s message when either delta exceeds its threshold. */
export function assertHeapDeltaWithinThresholds(
  delta: HeapDelta,
  thresholds: HeapThresholds = HEAP_THRESHOLDS,
): void {
  const failure = heapDeltaFailure(delta, thresholds);
  if (failure !== null) throw new Error(failure);
}
