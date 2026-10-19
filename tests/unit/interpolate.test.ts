// SSP-046: render interpolation (TECHNICAL_DESIGN §5.1). The drawn pose is lerped between the previous and the
// current tick's pose by alpha, the heading along the shorter arc, including across the ±π seam.
import { describe, expect, it } from 'vitest';
import { headingIndex } from '../../src/render/headings.ts';
import {
  bodyVelocity,
  createPose,
  createVelocity,
  interpolatePose,
  lerp,
  lerpAngleRad,
  type PosePair,
  wrapAngleRad,
} from '../../src/render/interpolate.ts';
import { assertHeapDeltaWithinThresholds, measureHeapDelta } from '../support/heapDelta.ts';

const PI = Math.PI;

function pair(from: [number, number, number], to: [number, number, number]): PosePair {
  return {
    prevXM: from[0],
    prevYM: from[1],
    prevHeadingRad: from[2],
    xM: to[0],
    yM: to[1],
    headingRad: to[2],
  };
}

describe('wrapAngleRad', () => {
  it.each([
    [0, 0],
    [PI / 2, PI / 2],
    [-PI / 2, -PI / 2],
    [PI, -PI],
    [-PI, -PI],
    [3 * PI, -PI],
    [2 * PI + 0.25, 0.25],
    [-2 * PI - 0.25, -0.25],
  ])('wraps %s into [−π, π) as %s', (input, expected) => {
    expect(wrapAngleRad(input)).toBeCloseTo(expected, 12);
  });
});

describe('lerp and lerpAngleRad', () => {
  it('lerps linearly: alpha 0 is the start, 1 the end', () => {
    expect(lerp(2, 6, 0)).toBe(2);
    expect(lerp(2, 6, 1)).toBe(6);
    expect(lerp(2, 6, 0.25)).toBe(3);
  });

  it('takes the shorter arc within a half-turn', () => {
    expect(lerpAngleRad(0, PI / 2, 0.5)).toBeCloseTo(PI / 4, 12);
    expect(lerpAngleRad(PI / 2, 0, 0.5)).toBeCloseTo(PI / 4, 12);
  });

  it('turns through the ±π seam instead of the long way round', () => {
    // 0.1 rad either side of south: the short way is 0.2 rad clockwise through π, not 6.08 rad back.
    const from = PI - 0.1;
    const to = -PI + 0.1;
    expect(lerpAngleRad(from, to, 0)).toBeCloseTo(from, 12);
    expect(lerpAngleRad(from, to, 0.5)).toBeCloseTo(PI, 12);
    expect(lerpAngleRad(from, to, 1)).toBeCloseTo(PI + 0.1, 12);
    expect(wrapAngleRad(lerpAngleRad(from, to, 1))).toBeCloseTo(to, 12);
    // And anticlockwise back through the seam.
    expect(lerpAngleRad(to, from, 0.5)).toBeCloseTo(-PI, 12);
    // Southward either way, so the drawn frame stays h16 across the seam.
    expect(headingIndex(lerpAngleRad(from, to, 0.25))).toBe(16);
    expect(headingIndex(lerpAngleRad(from, to, 0.75))).toBe(16);
  });

  it('handles unwrapped headings many turns out (the sim never wraps θ)', () => {
    const from = 10 * PI + 0.1;
    const to = 10 * PI - 0.1;
    expect(lerpAngleRad(from, to, 0.5)).toBeCloseTo(10 * PI, 9);
  });
});

describe('interpolatePose', () => {
  it('lerps x, y and heading by alpha between the previous and the current pose', () => {
    const out = createPose();
    const p = pair([7, 89, 0], [7.5, 88, 0.2]);
    interpolatePose(p, 0, out);
    expect(out).toEqual({ xM: 7, yM: 89, headingRad: 0 });
    interpolatePose(p, 1, out);
    expect(out).toEqual({ xM: 7.5, yM: 88, headingRad: 0.2 });
    interpolatePose(p, 0.5, out);
    expect(out.xM).toBeCloseTo(7.25, 12);
    expect(out.yM).toBeCloseTo(88.5, 12);
    expect(out.headingRad).toBeCloseTo(0.1, 12);
  });

  it('wraps the heading at ±π', () => {
    const out = createPose();
    interpolatePose(pair([0, 0, -PI + 0.05], [1, 0, PI - 0.05]), 0.5, out);
    expect(out.xM).toBe(0.5);
    expect(wrapAngleRad(out.headingRad)).toBeCloseTo(-PI, 12);
  });

  it('matches lerp and lerpAngleRad exactly (its maths is written out inline)', () => {
    const out = createPose();
    for (let i = 0; i < 400; i++) {
      const from = -20 + i * 0.1013;
      const to = from + Math.sin(i) * 3.5;
      const alpha = (i % 11) / 10;
      interpolatePose(pair([i, -i, from], [i * 1.5, 2 - i, to]), alpha, out);
      expect(out.xM).toBe(lerp(i, i * 1.5, alpha));
      expect(out.yM).toBe(lerp(-i, 2 - i, alpha));
      expect(out.headingRad).toBe(lerpAngleRad(from, to, alpha));
    }
  });

  it('clamps alpha to [0, 1], never extrapolating', () => {
    const out = createPose();
    const p = pair([0, 0, 0], [1, 2, 0.5]);
    interpolatePose(p, -0.5, out);
    expect(out).toEqual({ xM: 0, yM: 0, headingRad: 0 });
    interpolatePose(p, 1.5, out);
    expect(out).toEqual({ xM: 1, yM: 2, headingRad: 0.5 });
  });

  it('allocates nothing', () => {
    const out = createPose();
    const p = { prevXM: 0, prevYM: 0, prevHeadingRad: 3, xM: 1, yM: 1, headingRad: -3 };
    // A fresh float passed as alpha would be boxed at the call boundary by V8 itself (see spriteBatch.test.ts),
    // so alpha is a constant and the pair moves instead; the results are still new doubles every call.
    const delta = measureHeapDelta(
      (tick) => {
        p.xM = tick & 7;
        interpolatePose(p, 0.375, out);
      },
      { warmupTicks: 20_000 },
    );
    assertHeapDeltaWithinThresholds(delta);
  });
});

describe('bodyVelocity (the camera look-ahead direction, SSP-047)', () => {
  it.each([
    ['north', 0, 0, -1],
    ['east', PI / 2, 1, 0],
    ['south', PI, 0, 1],
    ['west', -PI / 2, -1, 0],
  ])('heading %s, driving forward, moves that way in sim axes (+x east, +y south)', (_label, h, x, y) => {
    const out = createVelocity();
    bodyVelocity(h, 5, 0, out);
    expect(out.xMps).toBeCloseTo(5 * x, 12);
    expect(out.yMps).toBeCloseTo(5 * y, 12);
  });

  it('adds vLat to the right of the heading and reverses with a negative vLong', () => {
    const out = createVelocity();
    bodyVelocity(0, 0, 2, out); // facing north, sliding right = east
    expect(out.xMps).toBeCloseTo(2, 12);
    expect(out.yMps).toBeCloseTo(0, 12);
    bodyVelocity(0, -2.5, 0, out); // reversing while facing north = moving south
    expect(out.xMps).toBeCloseTo(0, 12);
    expect(out.yMps).toBeCloseTo(2.5, 12);
    bodyVelocity(PI / 4, 3, 1, out);
    expect(Math.hypot(out.xMps, out.yMps)).toBeCloseTo(Math.hypot(3, 1), 12);
  });
});
