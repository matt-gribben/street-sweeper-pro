// Frame-time statistics used by tests/e2e/perf.spec.ts (SSP-023, D-08).
import { describe, expect, it } from 'vitest';
import { frameStats, percentileNearestRank, roundStats } from '../support/frameStats.ts';

describe('percentileNearestRank', () => {
  const hundred = Array.from({ length: 100 }, (_, i) => i + 1);

  it('returns sorted[ceil(p/100 × n) − 1]', () => {
    expect(percentileNearestRank(hundred, 99)).toBe(99);
    expect(percentileNearestRank(hundred, 50)).toBe(50);
    expect(percentileNearestRank(hundred, 100)).toBe(100);
    expect(percentileNearestRank(hundred, 0.5)).toBe(1);
    expect(percentileNearestRank([10, 20, 30], 50)).toBe(20);
    expect(percentileNearestRank([10, 20, 30], 99)).toBe(30);
  });

  it('ignores input order and does not mutate the input', () => {
    const values = [5, 1, 4, 2, 3];
    expect(percentileNearestRank(values, 60)).toBe(3);
    expect(values).toEqual([5, 1, 4, 2, 3]);
  });

  it('p99 of 1,000 frames is the 990th smallest: 10 slow frames do not move it, 11 do', () => {
    const ten = [...Array<number>(990).fill(8.3), ...Array<number>(10).fill(33.3)];
    expect(percentileNearestRank(ten, 99)).toBe(8.3);
    const eleven = [...Array<number>(989).fill(8.3), ...Array<number>(11).fill(33.3)];
    expect(percentileNearestRank(eleven, 99)).toBe(33.3);
  });

  it('throws on no samples or p outside (0, 100]', () => {
    expect(() => percentileNearestRank([], 99)).toThrow(RangeError);
    expect(() => percentileNearestRank([1], 0)).toThrow(RangeError);
    expect(() => percentileNearestRank([1], 101)).toThrow(RangeError);
    expect(() => percentileNearestRank([1], Number.NaN)).toThrow(RangeError);
  });
});

describe('frameStats', () => {
  it('summarises a window', () => {
    expect(frameStats([8, 9, 10, 13])).toEqual({ samples: 4, mean: 10, p50: 9, p95: 13, p99: 13, max: 13 });
  });

  it('throws on no samples', () => {
    expect(() => frameStats([])).toThrow(RangeError);
  });

  it('roundStats rounds to 0.01 ms and keeps the sample count', () => {
    expect(roundStats({ samples: 3, mean: 8.33333, p50: 8.3, p95: 9.765, p99: 10.2449, max: 10.4 })).toEqual({
      samples: 3,
      mean: 8.33,
      p50: 8.3,
      p95: 9.77,
      p99: 10.24,
      max: 10.4,
    });
  });
});
