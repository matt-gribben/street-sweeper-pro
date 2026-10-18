// Coordinate conventions (TECHNICAL_DESIGN §4 and §18.1): heading 0 is north and grows clockwise, forward is
// (sin θ, −cos θ), right is (cos θ, sin θ), vehicles use 32 frames h00..h31 and actors 8 directions.
import { describe, expect, it } from 'vitest';
import { headingIndex } from '../../src/render/headings.ts';
import {
  ACTOR_DIRS,
  actorDir,
  actorDirIndex,
  grimeCellOf,
  headingForward,
  headingRight,
  tileOf,
  VEHICLE_HEADING_COUNT,
  VEHICLE_HEADING_STEP_RAD,
  type Vec2,
  vehicleFrameIndex,
} from '../../src/sim/coords.ts';
import { assertHeapDeltaWithinThresholds, measureHeapDelta } from '../support/heapDelta.ts';

const PI = Math.PI;

function expectVec(v: Vec2, x: number, y: number): void {
  expect(v.x).toBeCloseTo(x, 12);
  expect(v.y).toBeCloseTo(y, 12);
}

describe('heading vectors', () => {
  it('heading 0 faces north: forward (0, −1), right (1, 0)', () => {
    expectVec(headingForward(0, { x: 9, y: 9 }), 0, -1);
    expectVec(headingRight(0, { x: 9, y: 9 }), 1, 0);
  });

  it.each([
    ['east', PI / 2, [1, 0], [0, 1]],
    ['south', PI, [0, 1], [-1, 0]],
    ['west', (3 * PI) / 2, [-1, 0], [0, -1]],
    ['west, as a negative heading', -PI / 2, [-1, 0], [0, -1]],
  ] as const)('heading %s: forward and right follow the compass, +x east and +y south', (_n, theta, f, r) => {
    expectVec(headingForward(theta, { x: 0, y: 0 }), f[0], f[1]);
    expectVec(headingRight(theta, { x: 0, y: 0 }), r[0], r[1]);
  });

  it('right is forward turned 90° clockwise, and both are unit vectors', () => {
    const f = { x: 0, y: 0 };
    const r = { x: 0, y: 0 };
    for (let k = -40; k <= 40; k += 1) {
      const theta = k * 0.173;
      headingForward(theta, f);
      headingRight(theta, r);
      expect(Math.hypot(f.x, f.y)).toBeCloseTo(1, 12);
      expect(f.x * r.x + f.y * r.y).toBeCloseTo(0, 12);
      // Turning clockwise by 90° in a +y-south frame: right = (−forward.y, forward.x).
      expectVec(r, -f.y, f.x);
    }
  });

  it('writes into the out object and returns it', () => {
    const out = { x: 0, y: 0 };
    expect(headingForward(1, out)).toBe(out);
    expect(headingRight(1, out)).toBe(out);
  });

  it('computes vectors without allocating', () => {
    const out = { x: 0, y: 0 };
    let sink = 0;
    const delta = measureHeapDelta(
      (tick) => {
        headingForward(tick * 0.01, out);
        sink = (sink + (out.x > 0 ? 1 : 0)) | 0;
        headingRight(tick * 0.01, out);
        sink = (sink + (out.y > 0 ? 1 : 0)) | 0;
      },
      { warmupTicks: 6000 },
    );
    expect(sink).toBeGreaterThan(0);
    assertHeapDeltaWithinThresholds(delta);
  });
});

describe('vehicle frame index (h00..h31)', () => {
  it('maps north to h00, a quarter turn clockwise to h08, south to h16 and west to h24', () => {
    expect(vehicleFrameIndex(0)).toBe(0);
    expect(vehicleFrameIndex(PI / 2)).toBe(8);
    expect(vehicleFrameIndex(PI)).toBe(16);
    expect(vehicleFrameIndex((3 * PI) / 2)).toBe(24);
  });

  it('maps a heading just west of north (−0.01 rad) to h00, not h31 or −0', () => {
    expect(Object.is(vehicleFrameIndex(-0.01), 0)).toBe(true);
    expect(Object.is(vehicleFrameIndex(-0), 0)).toBe(true);
  });

  it('steps every 11.25°, rounding to the nearest frame', () => {
    expect(VEHICLE_HEADING_COUNT).toBe(32);
    expect(VEHICLE_HEADING_STEP_RAD).toBeCloseTo((11.25 * PI) / 180, 15);
    for (let i = 0; i < 32; i += 1) {
      expect(vehicleFrameIndex(i * VEHICLE_HEADING_STEP_RAD)).toBe(i);
      expect(vehicleFrameIndex((i + 0.49) * VEHICLE_HEADING_STEP_RAD)).toBe(i);
      expect(vehicleFrameIndex((i - 0.49) * VEHICLE_HEADING_STEP_RAD)).toBe(i);
    }
    // Just under half a step west of north still rounds to h00; just over rounds to h31.
    expect(vehicleFrameIndex(-0.49 * VEHICLE_HEADING_STEP_RAD)).toBe(0);
    expect(vehicleFrameIndex(-0.51 * VEHICLE_HEADING_STEP_RAD)).toBe(31);
  });

  it('wraps any number of turns either way', () => {
    expect(vehicleFrameIndex(2 * PI)).toBe(0);
    expect(vehicleFrameIndex(2 * PI + PI / 2)).toBe(8);
    expect(vehicleFrameIndex(-PI / 2)).toBe(24);
    expect(vehicleFrameIndex(-10 * PI + PI / 2)).toBe(8);
  });

  it('agrees with the renderer headingIndex everywhere', () => {
    for (let k = -2000; k <= 2000; k += 1) {
      const theta = k * 0.01;
      expect(vehicleFrameIndex(theta)).toBe(headingIndex(theta));
    }
  });
});

describe('actor direction (8-way)', () => {
  it('lists the directions clockwise from north', () => {
    expect([...ACTOR_DIRS]).toEqual(['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']);
  });

  it.each(ACTOR_DIRS.map((dir, i) => [dir, i] as const))(
    'heading %s (%i × 45°) maps to its direction',
    (dir, i) => {
      expect(actorDirIndex((i * PI) / 4)).toBe(i);
      expect(actorDir((i * PI) / 4)).toBe(dir);
      // Up to just under half a step either side still picks the same direction.
      expect(actorDir(((i + 0.49) * PI) / 4)).toBe(dir);
      expect(actorDir(((i - 0.49) * PI) / 4)).toBe(dir);
    },
  );

  it('wraps negative and large headings', () => {
    expect(actorDir(-PI / 4)).toBe('nw');
    expect(actorDir(-PI / 2)).toBe('w');
    expect(Object.is(actorDirIndex(-0.01), 0)).toBe(true);
    expect(actorDir(2 * PI)).toBe('n');
    expect(actorDir(4 * PI + PI)).toBe('s');
  });
});

describe('tile and grime-cell coordinates', () => {
  it('uses 2 m tiles: col = floor(x / 2), row = floor(y / 2)', () => {
    expect(tileOf(0)).toBe(0);
    expect(tileOf(1.999)).toBe(0);
    expect(tileOf(2)).toBe(1);
    expect(tileOf(17.3)).toBe(8);
    expect(tileOf(-0.01)).toBe(-1);
  });

  it('uses 0.25 m grime cells: cx = floor(x / 0.25)', () => {
    expect(grimeCellOf(0)).toBe(0);
    expect(grimeCellOf(0.249)).toBe(0);
    expect(grimeCellOf(0.25)).toBe(1);
    expect(grimeCellOf(2)).toBe(8);
    expect(grimeCellOf(-0.01)).toBe(-1);
  });
});
