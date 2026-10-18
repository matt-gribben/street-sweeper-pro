// Frame-timing counters behind `__ssp.perf()` (SSP-023; TECHNICAL_DESIGN §17, §18.5).
import { describe, expect, it } from 'vitest';
import { createPerfCounters, PERF_SAMPLE_CAPACITY } from '../../src/debug/perfCounters.ts';

describe('createPerfCounters', () => {
  it('starts empty with the default capacity', () => {
    const counters = createPerfCounters();
    expect(counters.capacity).toBe(PERF_SAMPLE_CAPACITY);
    expect(counters.count).toBe(0);
    expect(counters.samples()).toEqual({ frameMs: [], workMs: [], overflow: 0 });
  });

  it('holds a 30 s window at 120 Hz with room to spare', () => {
    expect(PERF_SAMPLE_CAPACITY).toBeGreaterThanOrEqual(2 * 30 * 120);
  });

  it('returns samples oldest first, index-aligned', () => {
    const counters = createPerfCounters(4);
    counters.record(8.3, 0.1);
    counters.record(16.7, 0.25);
    expect(counters.count).toBe(2);
    expect(counters.samples()).toEqual({ frameMs: [8.3, 16.7], workMs: [0.1, 0.25], overflow: 0 });
  });

  it('drops and counts samples beyond capacity instead of overwriting', () => {
    const counters = createPerfCounters(2);
    counters.record(1, 0);
    counters.record(2, 0);
    counters.record(3, 0);
    counters.record(4, 0);
    expect(counters.samples()).toEqual({ frameMs: [1, 2], workMs: [0, 0], overflow: 2 });
  });

  it('reset() forgets samples and overflow', () => {
    const counters = createPerfCounters(1);
    counters.record(1, 0);
    counters.record(2, 0);
    counters.reset();
    expect(counters.count).toBe(0);
    expect(counters.samples()).toEqual({ frameMs: [], workMs: [], overflow: 0 });
    counters.record(5, 1);
    expect(counters.samples().frameMs).toEqual([5]);
  });

  it('samples() copies: later records do not change an earlier snapshot', () => {
    const counters = createPerfCounters(4);
    counters.record(1, 0);
    const snapshot = counters.samples();
    counters.record(2, 0);
    expect(snapshot.frameMs).toEqual([1]);
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
  });

  it.each([0, -1, 1.5, Number.NaN])('rejects capacity %s', (capacity) => {
    expect(() => createPerfCounters(capacity)).toThrow(RangeError);
  });
});
