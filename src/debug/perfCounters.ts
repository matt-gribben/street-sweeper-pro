// Frame-timing counters behind `__ssp.perf()` (TECHNICAL_DESIGN §17, §18.5; SSP-023). Test mode only: main.ts
// creates them through installTestHooks(), so release builds without `?test=1` never allocate or record.
//
// Two series per frame, both in milliseconds:
//   frameMs  the requestAnimationFrame timestamp delta to the previous frame: the frame time the `gpu` perf
//            project's p99 budget (D-08) is asserted against;
//   workMs   the CPU time spent inside the frame callback (camera, scene update, render submission). WebGL is
//            asynchronous, so this excludes GPU execution; it is evidence for the headroom, not a budget.
// and one per tick (SSP-106), in milliseconds too:
//   stepMs   the CPU time of each loop tick's fixedUpdate (src/app/loop.ts onTickTimed): in a shift, world.step
//            plus the ShiftScene's per-tick bookkeeping. perf.spec.ts's `ci` project asserts the sim step budget
//            (TECHNICAL_DESIGN §17) on it. `performance.now()` is coarsened in the page (100 µs in Chromium without
//            cross-origin isolation), so each sample is a multiple of that: a p99 is an upper bound to within it.
// Storage is three preallocated Float64Arrays: recording never allocates. When one is full, further samples are
// counted in `overflow` (frames) or `stepOverflow` (ticks) and dropped, so a spec can tell a truncated window from a
// complete one.

/** Samples kept per series: over two minutes at 60 Hz, one at 120 Hz. */
export const PERF_SAMPLE_CAPACITY = 8192;

/** Recorded frame timings, as plain arrays (JSON-safe, so they cross `page.evaluate`). */
export type PerfSamples = {
  /** rAF timestamp deltas in ms, oldest first. */
  readonly frameMs: number[];
  /** Frame-callback CPU time in ms, index-aligned with `frameMs`. */
  readonly workMs: number[];
  /** Samples dropped because the buffers were full. */
  readonly overflow: number;
  /** Per-tick fixedUpdate CPU time in ms, oldest first (one per tick, not per frame; SSP-106). */
  readonly stepMs: number[];
  /** Tick samples dropped because the step buffer was full. */
  readonly stepOverflow: number;
};

/** Fixed-capacity, allocation-free recorder of per-frame timings. */
export type PerfCounters = {
  /** Records one frame; drops it (counting `overflow`) once `capacity` samples are held. */
  record(frameMs: number, workMs: number): void;
  /** Records one tick's step time; drops it (counting `stepOverflow`) once `capacity` are held. */
  recordStep(stepMs: number): void;
  /** Forgets every sample (frames and ticks) and both overflow counts. */
  reset(): void;
  /** Copies out the samples recorded since the last reset. */
  samples(): PerfSamples;
  /** Frame samples currently held. */
  readonly count: number;
  /** Tick samples currently held. */
  readonly stepCount: number;
  readonly capacity: number;
};

/** Creates a recorder holding up to `capacity` frames (a positive integer). */
export function createPerfCounters(capacity: number = PERF_SAMPLE_CAPACITY): PerfCounters {
  if (!Number.isSafeInteger(capacity) || capacity <= 0) {
    throw new RangeError(`createPerfCounters: capacity must be a positive integer, got ${capacity}`);
  }
  const frameMs = new Float64Array(capacity);
  const workMs = new Float64Array(capacity);
  const stepMs = new Float64Array(capacity);
  let count = 0;
  let overflow = 0;
  let stepCount = 0;
  let stepOverflow = 0;
  return {
    record(frame: number, work: number): void {
      if (count >= capacity) {
        overflow++;
        return;
      }
      frameMs[count] = frame;
      workMs[count] = work;
      count++;
    },
    recordStep(step: number): void {
      if (stepCount >= capacity) {
        stepOverflow++;
        return;
      }
      stepMs[stepCount] = step;
      stepCount++;
    },
    reset(): void {
      count = 0;
      overflow = 0;
      stepCount = 0;
      stepOverflow = 0;
    },
    samples(): PerfSamples {
      return {
        frameMs: Array.from(frameMs.subarray(0, count)),
        workMs: Array.from(workMs.subarray(0, count)),
        overflow,
        stepMs: Array.from(stepMs.subarray(0, stepCount)),
        stepOverflow,
      };
    },
    get count(): number {
      return count;
    },
    get stepCount(): number {
      return stepCount;
    },
    capacity,
  };
}
