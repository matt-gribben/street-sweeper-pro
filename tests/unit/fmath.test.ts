// fmath v1 forwards to Math.* (TECHNICAL_DESIGN §7.4): results must be bit-identical to the engine's own,
// so swapping the implementation later is the only thing that can change a replay hash through this file.
import { describe, expect, it } from 'vitest';
import * as fmath from '../../src/sim/fmath.ts';

const SAMPLES = [0, -0, 1e-9, 0.5, 1, -1, Math.PI / 3, -2.75, 10, 123.456, -1e6, Number.NaN, Infinity];

describe('fmath v1 forwards to Math', () => {
  it('exports exactly the §7.4 functions plus tan', () => {
    expect(Object.keys(fmath).sort()).toEqual(['atan2', 'cos', 'exp', 'hypot', 'sin', 'sqrt', 'tan']);
  });

  it.each([
    ['sin', fmath.sin, Math.sin],
    ['cos', fmath.cos, Math.cos],
    ['tan', fmath.tan, Math.tan],
    ['exp', fmath.exp, Math.exp],
    ['sqrt', fmath.sqrt, Math.sqrt],
  ] as const)('%s matches Math bit for bit', (_name, mine, ref) => {
    for (const x of SAMPLES) expect(Object.is(mine(x), ref(x))).toBe(true);
  });

  it.each([
    ['atan2', fmath.atan2, Math.atan2],
    ['hypot', fmath.hypot, Math.hypot],
  ] as const)('%s matches Math bit for bit, in the same argument order', (_name, mine, ref) => {
    for (const a of SAMPLES) {
      for (const b of SAMPLES) expect(Object.is(mine(a, b), ref(a, b))).toBe(true);
    }
  });

  it('keeps atan2 in (y, x) order', () => {
    expect(fmath.atan2(1, 0)).toBeCloseTo(Math.PI / 2, 15);
    expect(fmath.atan2(0, -1)).toBeCloseTo(Math.PI, 15);
  });
});
