// Frame-time statistics for tests/e2e/perf.spec.ts (TECHNICAL_DESIGN §17, D-08). Pure, so Vitest covers it
// (tests/unit/frameStats.test.ts) and the Playwright spec only does browser work.

/**
 * The p-th percentile (0 < p ≤ 100) by the nearest-rank method: the smallest sample such that at least p% of
 * the samples are ≤ it, i.e. `sorted[ceil(p / 100 × n) − 1]`. Always one of the samples (no interpolation), so
 * "p99 ≤ budget" means exactly "at least 99% of frames took ≤ budget". Throws on an empty input.
 */
export function percentileNearestRank(values: readonly number[], p: number): number {
  if (values.length === 0) throw new RangeError('percentileNearestRank: no samples');
  if (!(p > 0 && p <= 100)) throw new RangeError(`percentileNearestRank: p must be in (0, 100], got ${p}`);
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[rank - 1] as number;
}

/** Summary of one sampling window, in the samples' unit (ms). */
export type FrameStats = {
  readonly samples: number;
  readonly mean: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
  readonly max: number;
};

/** Mean, nearest-rank p50/p95/p99 and max of a non-empty sample set. */
export function frameStats(values: readonly number[]): FrameStats {
  if (values.length === 0) throw new RangeError('frameStats: no samples');
  let sum = 0;
  let max = Number.NEGATIVE_INFINITY;
  for (const v of values) {
    sum += v;
    if (v > max) max = v;
  }
  return {
    samples: values.length,
    mean: sum / values.length,
    p50: percentileNearestRank(values, 50),
    p95: percentileNearestRank(values, 95),
    p99: percentileNearestRank(values, 99),
    max,
  };
}

/** Rounds every field to 0.01 ms for logs and annotations. */
export function roundStats(stats: FrameStats): FrameStats {
  const r = (v: number): number => Math.round(v * 100) / 100;
  return {
    samples: stats.samples,
    mean: r(stats.mean),
    p50: r(stats.p50),
    p95: r(stats.p95),
    p99: r(stats.p99),
    max: r(stats.max),
  };
}
