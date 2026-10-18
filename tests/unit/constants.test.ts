import { describe, expect, it } from 'vitest';
import pkg from '../../package.json' with { type: 'json' };
import { DT_S, MAX_STEPS_PER_FRAME, SIM_HZ } from '../../src/sim/constants.ts';

describe('sim constants', () => {
  it('runs the sim at a fixed 60 Hz', () => {
    expect(SIM_HZ).toBe(60);
  });

  it('derives the tick duration from the sim rate', () => {
    expect(DT_S).toBe(1 / 60);
    expect(DT_S * SIM_HZ).toBeCloseTo(1, 15);
  });

  it('caps the sim at 5 steps per rendered frame', () => {
    expect(MAX_STEPS_PER_FRAME).toBe(5);
  });
});

describe('build constants', () => {
  it('injects the package.json version', () => {
    expect(__SSP_VERSION__).toBe(pkg.version);
  });

  it('injects a short git SHA or the documented fallback', () => {
    expect(__SSP_COMMIT__).toMatch(/^(?:[0-9a-f]{4,40}|unknown)$/);
  });
});
