// fmath v1 forwards to Math.* (TECHNICAL_DESIGN §7.4): results must be bit-identical to the engine's own,
// so swapping the implementation later is the only thing that can change a replay hash through this file.
import { describe, expect, it } from 'vitest';
import * as fmath from '../../src/sim/fmath.ts';

const SAMPLES = [0, -0, 1e-9, 0.5, 1, -1, Math.PI / 3, -2.75, 10, 123.456, -1e6, Number.NaN, Infinity];

describe('fmath v1 forwards to Math', () => {
  it('exports exactly the §7.4 functions plus tan, headingCosSin (SSP-107) and sqrtAt (SSP-106)', () => {
    expect(Object.keys(fmath).sort()).toEqual([
      'atan2',
      'cos',
      'exp',
      'headingCosSin',
      'hypot',
      'sin',
      'sqrt',
      'sqrtAt',
      'tan',
    ]);
  });

  it('sqrtAt replaces one slot with its square root, bit for bit the same as sqrt, and leaves the rest', () => {
    const buf = new Float64Array(SAMPLES.length + 1);
    for (let i = 0; i < SAMPLES.length; i++) {
      buf.set(SAMPLES);
      buf[SAMPLES.length] = 7;
      fmath.sqrtAt(buf, i);
      for (let j = 0; j < SAMPLES.length; j++) {
        const want = j === i ? Math.sqrt(SAMPLES[j] as number) : (SAMPLES[j] as number);
        expect(Object.is(buf[j], want)).toBe(true);
      }
      expect(buf[SAMPLES.length]).toBe(7);
    }
  });

  it('headingCosSin writes cos and sin of the heading, bit for bit the same as cos and sin', () => {
    const out = new Float64Array(2);
    for (const headingRad of SAMPLES) {
      fmath.headingCosSin({ headingRad }, out);
      expect(Object.is(out[0], Math.cos(headingRad))).toBe(true);
      expect(Object.is(out[1], Math.sin(headingRad))).toBe(true);
    }
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
