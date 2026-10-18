import { describe, expect, it } from 'vitest';
import pkg from '../../package.json' with { type: 'json' };
import {
  DT_S,
  GRIME_CELL_M,
  MAX_STEPS_PER_FRAME,
  PX_PER_M,
  SHIFT_S,
  SHIFT_TICKS,
  SIM_HZ,
  TILE_M,
} from '../../src/sim/constants.ts';

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

  it('converts at 16 internal pixels per metre', () => {
    expect(PX_PER_M).toBe(16);
  });

  it('uses 2 m map tiles (32 px) and 0.25 m grime cells (4 px)', () => {
    expect(TILE_M).toBe(2);
    expect(TILE_M * PX_PER_M).toBe(32);
    expect(GRIME_CELL_M).toBe(0.25);
    expect(GRIME_CELL_M * PX_PER_M).toBe(4);
  });

  it('runs a 240 s shift as an integer 14,400 ticks', () => {
    expect(SHIFT_S).toBe(240);
    expect(SHIFT_TICKS).toBe(14_400);
    expect(Number.isInteger(SHIFT_TICKS)).toBe(true);
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
