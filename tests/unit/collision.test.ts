// Collision primitives (TECHNICAL_DESIGN §9.2, SSP-031): OBB construction, SAT against axis-aligned rects and
// circles with the MTV sign convention (the normal points from the obstacle toward the OBB), and the
// sub-step rule. Fixtures use Bessie's body, 1.75 × 3.25 m (half extents 0.875 × 1.625). Hand-computed
// expectations are written out next to each fixture. The seeded sweeps at the end check every result
// against an independent corner-projection reference; fast-check property tests arrive with SSP-037.
import { describe, expect, it } from 'vitest';
import {
  type Aabb,
  createAabb,
  createObb,
  type Obb,
  obbAabb,
  obbCorners,
  obbForwardAxis,
  obbRightAxis,
  setObb,
} from '../../src/sim/collision/obb.ts';
import { type Contact, createContact, obbVsCircle, obbVsRect } from '../../src/sim/collision/sat.ts';
import { createPose, SUBSTEP_MAX_M, subStepCount, subStepPose } from '../../src/sim/collision/sweep.ts';
import type { Vec2 } from '../../src/sim/coords.ts';
import { nextRange, sfc32 } from '../../src/sim/rng.ts';
import { assertHeapDeltaWithinThresholds, measureHeapDelta } from '../support/heapDelta.ts';

const PI = Math.PI;
const S = Math.SQRT1_2; // sin 45° = cos 45°
const HW = 0.875; // Bessie half width (§9.2)
const HL = 1.625; // Bessie half length (§9.2)
const EPS = 1e-9; // acceptance tolerance for depths and residual penetration

function bessie(cx: number, cy: number, headingRad: number): Obb {
  return setObb(createObb(), cx, cy, headingRad, HW, HL);
}

type Rect = readonly [minX: number, minY: number, maxX: number, maxY: number];

function vsRect(obb: Obb, r: Rect, out: Contact = createContact()): Contact {
  obbVsRect(obb, r[0], r[1], r[2], r[3], out);
  return out;
}

function vsCircle(
  obb: Obb,
  px: number,
  py: number,
  radiusM: number,
  out: Contact = createContact(),
): Contact {
  obbVsCircle(obb, px, py, radiusM, out);
  return out;
}

function expectContact(c: Contact, nx: number, ny: number, depthM: number): void {
  expect(c.overlap).toBe(true);
  expect(Math.abs(c.depthM - depthM)).toBeLessThanOrEqual(EPS);
  expect(c.normalX).toBeCloseTo(nx, 12);
  expect(c.normalY).toBeCloseTo(ny, 12);
}

function expectClear(c: Contact): void {
  expect(c.overlap).toBe(false);
  expect(c.normalX).toBe(0);
  expect(c.normalY).toBe(0);
  expect(c.depthM).toBe(0);
}

/** Moves the OBB centre by the contact's MTV (the documented resolution step). */
function applyMtv(obb: Obb, c: Contact): void {
  setObb(
    obb,
    obb.cx + c.normalX * c.depthM,
    obb.cy + c.normalY * c.depthM,
    obb.headingRad,
    obb.halfWidthM,
    obb.halfLengthM,
  );
}

/** Penetration left after resolution: 0 when the shapes test clear. */
function residualRect(obb: Obb, r: Rect): number {
  const c = vsRect(obb, r);
  return c.overlap ? c.depthM : 0;
}

describe('OBB construction (obb.ts)', () => {
  it('heading 0 faces north: right axis (1, 0), forward axis (0, −1)', () => {
    const obb = bessie(10, 20, 0);
    const v: Vec2 = { x: 0, y: 0 };
    expect(obbRightAxis(obb, v)).toEqual({ x: 1, y: 0 });
    expect(obbForwardAxis(obb, v)).toEqual({ x: 0, y: -1 });
    expect(obb).toMatchObject({ cx: 10, cy: 20, headingRad: 0, halfWidthM: HW, halfLengthM: HL });
  });

  it('heading π/2 faces east: right axis points south, forward east', () => {
    const obb = bessie(0, 0, PI / 2);
    expect(obb.rightX).toBeCloseTo(0, 15);
    expect(obb.rightY).toBeCloseTo(1, 15);
    expect(obb.forwardX).toBeCloseTo(1, 15);
    expect(obb.forwardY).toBeCloseTo(0, 15);
  });

  it('writes corners front-right, back-right, back-left, front-left', () => {
    const corners = obbCorners(bessie(10, 20, 0), new Float64Array(8));
    expect(Array.from(corners)).toEqual([10.875, 18.375, 10.875, 21.625, 9.125, 21.625, 9.125, 18.375]);
  });

  it('rotates corners at 45°: the front-right corner is (2.5·S, −0.75·S) from the centre', () => {
    const c = obbCorners(bessie(0, 0, PI / 4), new Float64Array(8));
    const expected = [2.5 * S, -0.75 * S, -0.75 * S, 2.5 * S, -2.5 * S, 0.75 * S, 0.75 * S, -2.5 * S];
    for (let i = 0; i < 8; i++) expect(c[i]).toBeCloseTo(expected[i] ?? Number.NaN, 14);
  });

  it('writes the tight AABB: 0.875 × 1.625 at heading 0, 1.625 × 0.875 at π/2, 2.5·S square at 45°', () => {
    const box: Aabb = createAabb();
    expect(obbAabb(bessie(10, 20, 0), box)).toEqual({
      minX: 9.125,
      minY: 18.375,
      maxX: 10.875,
      maxY: 21.625,
    });
    obbAabb(bessie(0, 0, PI / 2), box);
    expect(box.maxX).toBeCloseTo(HL, 15);
    expect(box.maxY).toBeCloseTo(HW, 15);
    obbAabb(bessie(0, 0, PI / 4), box);
    expect(box.maxX).toBeCloseTo(2.5 * S, 15);
    expect(box.minY).toBeCloseTo(-2.5 * S, 15);
  });

  it('the AABB encloses every corner at any heading', () => {
    const box = createAabb();
    const corners = new Float64Array(8);
    for (let k = 0; k < 64; k++) {
      const obb = bessie(3, -2, (k * PI) / 32);
      obbAabb(obb, box);
      obbCorners(obb, corners);
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (let i = 0; i < 4; i++) {
        const x = corners[2 * i] ?? Number.NaN;
        const y = corners[2 * i + 1] ?? Number.NaN;
        expect(x).toBeGreaterThanOrEqual(box.minX - 1e-12);
        expect(y).toBeGreaterThanOrEqual(box.minY - 1e-12);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
      expect(maxX).toBeCloseTo(box.maxX, 12);
      expect(maxY).toBeCloseTo(box.maxY, 12);
    }
  });
});

describe('OBB vs axis-aligned rect (sat.ts)', () => {
  it('reports separated shapes as clear', () => {
    expectClear(vsRect(bessie(0, 0, 0), [2, -1, 3, 1]));
    expectClear(vsRect(bessie(0, 0, 0), [-1, 5, 1, 6]));
    expectClear(vsRect(bessie(0, 0, PI / 3), [10, 10, 12, 12]));
  });

  it('treats touching as clear (zero penetration is not an overlap)', () => {
    expectClear(vsRect(bessie(0, 0, 0), [0.875, -1, 2, 1])); // east face on the rect's west edge
    expectClear(vsRect(bessie(0, 0, 0), [-1, -3, 1, -1.625])); // front face on the rect's south edge
    expectClear(vsRect(bessie(0, 0, 0), [0.875, 1.625, 2, 2])); // corner to corner
  });

  it('a hair of overlap reports that hair as the depth', () => {
    expectContact(vsRect(bessie(0, 0, 0), [0.875 - 1e-6, -1, 2, 1]), -1, 0, 1e-6);
  });

  it.each([
    // [name, heading, rect, normal, depth]: OBB centred on (5, 5).
    ['wall to the east, heading 0', 0, [5.5, 0, 7, 10], [-1, 0], 0.875 - 0.5],
    ['wall to the west, heading 0', 0, [3, 0, 4.5, 10], [1, 0], 0.875 - 0.5],
    ['wall to the north, heading 0', 0, [0, 2, 10, 3.5], [0, 1], 1.625 - 1.5],
    ['wall to the south, heading 0', 0, [0, 6.5, 10, 8], [0, -1], 1.625 - 1.5],
    ['wall to the east, heading π/2 (long side across)', PI / 2, [5.5, 0, 7, 10], [-1, 0], 1.625 - 0.5],
    ['wall to the south, heading π', PI, [0, 6.5, 10, 8], [0, -1], 1.625 - 1.5],
    ['wall to the north, heading 3π/2', (3 * PI) / 2, [0, 4, 10, 4.5], [0, 1], 0.875 - 0.5],
  ] as const)('axis-aligned overlap, %s: MTV and depth to ±1e-9', (_name, heading, rect, n, depth) => {
    expectContact(vsRect(bessie(5, 5, heading), rect), n[0], n[1], depth);
  });

  it('45°, OBB corner into a long wall: a world axis is the minimum (depth 2.5·S − 1.5)', () => {
    // At 45° the front-right corner sits at x = 2.5·S ≈ 1.7678. A wall from x = 1.5 is penetrated by that
    // corner alone. On the OBB right axis the tall wall projects to ±(1·S + 10·S), so that axis is far deeper.
    const obb = bessie(0, 0, PI / 4);
    const c = vsRect(obb, [1.5, -10, 3.5, 10]);
    expectContact(c, -1, 0, 2.5 * S - 1.5);
    const corners = obbCorners(obb, new Float64Array(8));
    expect((corners[0] ?? Number.NaN) - c.depthM).toBeCloseTo(1.5, 14);
  });

  it('45°, small rect against the right face: the OBB right axis is the minimum (depth 0.875 + 0.2·S − 0.9)', () => {
    // A 0.2 m square centred 0.9 m out along the right axis u = (S, S). Its projection radius on u is
    // 0.1·S + 0.1·S, so the u overlap is 0.875 + 0.2·S − 0.9 ≈ 0.1164. World x and y give
    // 2.5·S + 0.1 − 0.9·S ≈ 1.231, and the forward axis 1.625 + 0.2·S. MTV = −u, pushing the OBB back left.
    const cx = 0.9 * S;
    const c = vsRect(bessie(0, 0, PI / 4), [cx - 0.1, cx - 0.1, cx + 0.1, cx + 0.1]);
    expectContact(c, -S, -S, 0.875 + 0.2 * S - 0.9);
  });

  it('45°, small rect off the nose: the OBB forward axis is the minimum (depth 1.625 + 0.2·S − 1.7)', () => {
    // Forward at 45° is f = (S, −S). The square sits 1.7 m out along f; MTV = −f.
    const fx = 1.7 * S;
    const fy = -1.7 * S;
    const c = vsRect(bessie(0, 0, PI / 4), [fx - 0.1, fy - 0.1, fx + 0.1, fy + 0.1]);
    expectContact(c, -S, S, 1.625 + 0.2 * S - 1.7);
  });

  it('45°: AABBs overlap but the OBB right axis separates (clear)', () => {
    // Same square 1.1 m out along u: the u overlap is 0.875 + 0.2·S − 1.1 < 0, while the world-axis
    // (AABB) overlaps stay positive. Only the OBB axis sees the gap.
    const obb = bessie(0, 0, PI / 4);
    const cx = 1.1 * S;
    const rect: Rect = [cx - 0.1, cx - 0.1, cx + 0.1, cx + 0.1];
    const box = obbAabb(obb, createAabb());
    expect(box.maxX > rect[0] && box.maxY > rect[1]).toBe(true);
    expectClear(vsRect(obb, rect));
  });

  it('a rect edge across the OBB middle (edge-on contact) resolves through the shallow side', () => {
    // A thin 10 m tall wall (x 0.5..0.7, centre 0.6) cuts through Bessie's east side at heading 0. World x
    // gives 0.875 + 0.1 − 0.6 = 0.375 toward −x; world y and the forward axis are swamped by the wall height.
    expectContact(vsRect(bessie(0, 0, 0), [0.5, -5, 0.7, 5]), -1, 0, 0.375);
  });

  it('a concentric overlap (zero offset) picks the positive world x axis deterministically', () => {
    expectContact(vsRect(bessie(0, 0, 0), [-0.5, -0.5, 0.5, 0.5]), 1, 0, 0.875 + 0.5);
  });

  it('MTV direction always points from the rect toward the OBB', () => {
    const obb = createObb();
    const c = createContact();
    for (let k = 0; k < 32; k++) {
      const heading = (k * PI) / 16;
      // Rect centred 1.2 m away in 8 compass directions around the OBB.
      for (let j = 0; j < 8; j++) {
        const a = (j * PI) / 4;
        const rx = 1.2 * Math.cos(a);
        const ry = 1.2 * Math.sin(a);
        setObb(obb, 0, 0, heading, HW, HL);
        obbVsRect(obb, rx - 0.4, ry - 0.4, rx + 0.4, ry + 0.4, c);
        if (!c.overlap) continue;
        // The normal must point away from the rect centre: (OBB centre − rect centre) · n > 0.
        expect(-rx * c.normalX + -ry * c.normalY).toBeGreaterThan(0);
      }
    }
  });

  it('applying the MTV leaves the shapes non-overlapping (≤ 1e-9 m) for the fixtures above', () => {
    const cases: readonly [number, number, number, Rect][] = [
      [5, 5, 0, [5.5, 0, 7, 10]],
      [5, 5, PI / 2, [5.5, 0, 7, 10]],
      [0, 0, PI / 4, [1.5, -10, 3.5, 10]],
      [0, 0, PI / 4, [0.9 * S - 0.1, 0.9 * S - 0.1, 0.9 * S + 0.1, 0.9 * S + 0.1]],
      [0, 0, 0, [-0.5, -0.5, 0.5, 0.5]],
      [0, 0, 0.3, [-10, -10, 10, 10]], // OBB buried inside a big rect
    ];
    for (const [x, y, h, rect] of cases) {
      const obb = bessie(x, y, h);
      const c = vsRect(obb, rect);
      expect(c.overlap).toBe(true);
      applyMtv(obb, c);
      expect(residualRect(obb, rect)).toBeLessThanOrEqual(EPS);
    }
  });
});

describe('OBB vs circle (sat.ts)', () => {
  it('reports separated and touching circles as clear', () => {
    expectClear(vsCircle(bessie(0, 0, 0), 3, 0, 0.3));
    expectClear(vsCircle(bessie(0, 0, 0), 1.125, 0, 0.25)); // exactly touching the east face
    expectClear(vsCircle(bessie(0, 0, 0), 0.875, 0, 0)); // a zero-radius point on the boundary
  });

  it('face region: a human (r 0.3) 0.125 m off the east face pushes the OBB west by 0.175', () => {
    expectContact(vsCircle(bessie(0, 0, 0), 1.0, 0, 0.3), -1, 0, 0.175);
  });

  it('face region on the nose: a cat (r 0.2) ahead pushes the OBB back (south at heading 0)', () => {
    expectContact(vsCircle(bessie(0, 0, 0), 0, -1.75, 0.2), 0, 1, 0.2 - 0.125);
  });

  it('corner region: the closest-point axis runs diagonally to the corner', () => {
    // Front-right corner at (0.875, −1.625). Circle 0.1 m out on each axis: distance 0.1·√2, so
    // depth = 0.3 − 0.1·√2 and the normal points from the circle to the corner, (−S, +S).
    const c = vsCircle(bessie(0, 0, 0), 0.975, -1.725, 0.3);
    expectContact(c, -S, S, 0.3 - 0.1 * Math.SQRT2);
  });

  it('corner region: clear when both face projections overlap but the corner distance exceeds r', () => {
    // 0.25 m out on each axis: each face axis alone overlaps by 0.05, but the corner is 0.25·√2 ≈ 0.354 away.
    expectClear(vsCircle(bessie(0, 0, 0), 1.125, -1.875, 0.3));
  });

  it('corner region at 45°: diagonal out of the front-right corner is world east', () => {
    // Front-right corner at (2.5·S, −0.75·S); its local diagonal (S, S) maps to world (1, 0).
    const c = vsCircle(bessie(0, 0, PI / 4), 2.5 * S + 0.1, -0.75 * S, 0.3);
    expectContact(c, -1, 0, 0.2);
  });

  it('centre inside the box: pushes out through the shallower face', () => {
    expectContact(vsCircle(bessie(0, 0, 0), 0.5, 0, 0.3), -1, 0, 0.875 - 0.5 + 0.3);
    expectContact(vsCircle(bessie(0, 0, 0), 0, 1.5, 0.3), 0, -1, 1.625 - 1.5 + 0.3);
    expectContact(vsCircle(bessie(0, 0, 0), 0, 0, 0.3), -1, 0, 0.875 + 0.3); // dead centre: x face first
  });

  it('applying the MTV leaves the shapes non-overlapping (≤ 1e-9 m)', () => {
    const cases: readonly [number, number, number, number][] = [
      [1.0, 0, 0.3, 0],
      [0.975, -1.725, 0.3, 0],
      [2.5 * S + 0.1, -0.75 * S, 0.3, PI / 4],
      [0.5, 0, 0.3, 0],
      [0.2, -0.4, 0.25, 1.1],
    ];
    for (const [px, py, r, h] of cases) {
      const obb = bessie(0, 0, h);
      const c = vsCircle(obb, px, py, r);
      expect(c.overlap).toBe(true);
      applyMtv(obb, c);
      const after = vsCircle(obb, px, py, r);
      expect(after.overlap ? after.depthM : 0).toBeLessThanOrEqual(EPS);
    }
  });
});

// ---- Seeded sweeps against independent references -------------------------------------------------------

/** Min-penetration depth by projecting the 4 OBB corners and 4 rect corners onto the 4 SAT axes (≤ 0: clear). */
function referenceRectDepth(obb: Obb, r: Rect): number {
  const corners = obbCorners(obb, new Float64Array(8));
  const rectCorners = [r[0], r[1], r[2], r[1], r[2], r[3], r[0], r[3]];
  const axes = [1, 0, 0, 1, obb.rightX, obb.rightY, obb.forwardX, obb.forwardY];
  let best = Infinity;
  for (let a = 0; a < 4; a++) {
    const ax = axes[2 * a] ?? Number.NaN;
    const ay = axes[2 * a + 1] ?? Number.NaN;
    let oMin = Infinity;
    let oMax = -Infinity;
    let rMin = Infinity;
    let rMax = -Infinity;
    for (let i = 0; i < 4; i++) {
      const po = (corners[2 * i] ?? Number.NaN) * ax + (corners[2 * i + 1] ?? Number.NaN) * ay;
      const pr = (rectCorners[2 * i] ?? Number.NaN) * ax + (rectCorners[2 * i + 1] ?? Number.NaN) * ay;
      oMin = Math.min(oMin, po);
      oMax = Math.max(oMax, po);
      rMin = Math.min(rMin, pr);
      rMax = Math.max(rMax, pr);
    }
    // Push needed to clear on this axis in the cheaper direction (correct when one interval contains the other).
    best = Math.min(best, oMax - rMin, rMax - oMin);
  }
  return best;
}

/** Signed penetration of a circle into the OBB polygon, from point-to-segment distances over the corners. */
function referenceCircleDepth(obb: Obb, px: number, py: number, radiusM: number): number {
  const c = obbCorners(obb, new Float64Array(8));
  let minDist = Infinity;
  let inside = true;
  for (let i = 0; i < 4; i++) {
    const ax = c[2 * i] ?? Number.NaN;
    const ay = c[2 * i + 1] ?? Number.NaN;
    const bx = c[(2 * i + 2) % 8] ?? Number.NaN;
    const by = c[(2 * i + 3) % 8] ?? Number.NaN;
    const ex = bx - ax;
    const ey = by - ay;
    const t = Math.max(0, Math.min(1, ((px - ax) * ex + (py - ay) * ey) / (ex * ex + ey * ey)));
    minDist = Math.min(minDist, Math.hypot(px - (ax + ex * t), py - (ay + ey * t)));
    // Corners run clockwise on screen (+y south), so an inside point has a non-negative cross product.
    if (ex * (py - ay) - ey * (px - ax) < 0) inside = false;
  }
  return inside ? radiusM + minDist : radiusM - minDist;
}

describe('seeded sweeps (2,000 random configurations each)', () => {
  it('OBB vs rect: depth matches the reference, MTV resolves, and the MTV is not overshooting', () => {
    const rng = sfc32(0x5ec7031);
    const obb = createObb();
    const c = createContact();
    let overlaps = 0;
    for (let n = 0; n < 2000; n++) {
      setObb(
        obb,
        nextRange(rng, -2, 2),
        nextRange(rng, -2, 2),
        nextRange(rng, -PI, PI),
        nextRange(rng, 0.1, 2),
        nextRange(rng, 0.1, 2),
      );
      const x0 = nextRange(rng, -3, 2);
      const y0 = nextRange(rng, -3, 2);
      const rect: Rect = [x0, y0, x0 + nextRange(rng, 0.1, 3), y0 + nextRange(rng, 0.1, 3)];
      const ref = referenceRectDepth(obb, rect);
      obbVsRect(obb, rect[0], rect[1], rect[2], rect[3], c);
      expect(c.overlap).toBe(ref > 0);
      if (!c.overlap) continue;
      overlaps++;
      expect(Math.abs(c.depthM - ref)).toBeLessThanOrEqual(1e-12);
      expect(Math.hypot(c.normalX, c.normalY)).toBeCloseTo(1, 14);
      const { normalX, normalY, depthM } = c;
      const cx = obb.cx;
      const cy = obb.cy;
      // Stopping 1 µm short of the MTV still overlaps: the depth is the true minimum along that axis.
      if (depthM > 1e-6) {
        setObb(
          obb,
          cx + normalX * (depthM - 1e-6),
          cy + normalY * (depthM - 1e-6),
          obb.headingRad,
          obb.halfWidthM,
          obb.halfLengthM,
        );
        expect(referenceRectDepth(obb, rect)).toBeGreaterThan(0);
      }
      setObb(
        obb,
        cx + normalX * depthM,
        cy + normalY * depthM,
        obb.headingRad,
        obb.halfWidthM,
        obb.halfLengthM,
      );
      expect(residualRect(obb, rect)).toBeLessThanOrEqual(EPS);
    }
    expect(overlaps).toBeGreaterThan(500);
  });

  it('OBB vs circle: depth matches the reference and the MTV resolves', () => {
    const rng = sfc32(0xc12c1e);
    const obb = createObb();
    const c = createContact();
    let overlaps = 0;
    let corners = 0;
    for (let n = 0; n < 2000; n++) {
      setObb(obb, 0, 0, nextRange(rng, -PI, PI), nextRange(rng, 0.1, 2), nextRange(rng, 0.1, 2));
      const px = nextRange(rng, -2.5, 2.5);
      const py = nextRange(rng, -2.5, 2.5);
      const r = nextRange(rng, 0.05, 0.8);
      const ref = referenceCircleDepth(obb, px, py, r);
      obbVsCircle(obb, px, py, r, c);
      expect(c.overlap).toBe(ref > 0);
      if (!c.overlap) continue;
      overlaps++;
      // Count corner-region contacts: the normal is along neither box axis.
      const along = Math.max(
        Math.abs(c.normalX * obb.rightX + c.normalY * obb.rightY),
        Math.abs(c.normalX * obb.forwardX + c.normalY * obb.forwardY),
      );
      if (along < 1 - 1e-9) corners++;
      expect(Math.abs(c.depthM - ref)).toBeLessThanOrEqual(1e-12);
      expect(Math.hypot(c.normalX, c.normalY)).toBeCloseTo(1, 14);
      applyMtv(obb, c);
      expect(referenceCircleDepth(obb, px, py, r)).toBeLessThanOrEqual(EPS);
    }
    expect(overlaps).toBeGreaterThan(500);
    expect(corners).toBeGreaterThan(20);
  });
});

describe('sub-step rule (sweep.ts)', () => {
  it('the threshold is 0.5 tile = 1.0 m', () => {
    expect(SUBSTEP_MAX_M).toBe(1.0);
  });

  it.each([
    [0, 1],
    [17.2 / 60, 1], // Bessie's real maximum, ≈ 0.29 m/tick
    [0.999, 1],
    [1.0, 1],
    [1.0000001, 2],
    [2.0, 2],
    [2.5, 3],
    [7.01, 8],
  ])('d = %f m → %i step(s)', (d, steps) => {
    expect(subStepCount(d)).toBe(steps);
  });

  it('matches ceil(d / 1.0) above the threshold across a fine sweep', () => {
    for (let i = 0; i <= 1000; i++) {
      const d = i * 0.0137;
      expect(subStepCount(d)).toBe(d <= 1 ? 1 : Math.ceil(d / 1.0));
    }
  });

  it('accepts a smaller step size (the M3 knockable rule reuses it)', () => {
    expect(subStepCount(0.5, 0.2)).toBe(3);
    expect(subStepCount(0.2, 0.2)).toBe(1);
  });

  it('never returns a runaway count for bad input', () => {
    expect(subStepCount(-3)).toBe(1);
    expect(subStepCount(Number.NaN)).toBe(1);
    expect(subStepCount(Infinity)).toBe(1);
  });

  it('interpolates poses linearly and lands exactly on the end pose', () => {
    const p = createPose();
    const count = subStepCount(2.5); // 3
    expect(count).toBe(3);
    subStepPose(0, 0, 0, 2.5, 0, 0.3, 1, count, p);
    expect(p.x).toBeCloseTo(2.5 / 3, 14);
    expect(p.headingRad).toBeCloseTo(0.1, 14);
    subStepPose(0, 0, 0, 2.5, 0, 0.3, 2, count, p);
    expect(p.x).toBeCloseTo(5 / 3, 14);
    subStepPose(0.1, 0.2, 0.3, 1.7, -0.9, 0.7, count, count, p);
    expect(p).toEqual({ x: 1.7, y: -0.9, headingRad: 0.7 });
  });

  it('turns the heading along the shorter arc across the 0/2π seam', () => {
    const p = createPose();
    subStepPose(0, 0, 6.1, 0, 0, 0.1, 1, 2, p); // −6.0 rad raw is +0.283 rad the short way
    const halfway = 6.1 + (2 * PI - 6.0) / 2;
    expect(p.headingRad).toBeCloseTo(halfway, 12);
    subStepPose(0, 0, 0.1, 0, 0, 6.1, 1, 2, p);
    expect(p.headingRad).toBeCloseTo(0.1 - (2 * PI - 6.0) / 2, 12);
  });

  it('sub-stepping catches a thin wall a single end-pose test would tunnel through', () => {
    // Bessie (heading east, nose at x 1.575) jumps 3.6 m in one tick past a 0.3 m wall at x 1.6..1.9, ending
    // with her tail at x 1.925. Start and end poses both test clear; the intermediate sub-steps do not.
    const wall: Rect = [1.6, -5, 1.9, 5];
    const x0 = -0.05;
    const x1 = 3.55;
    const obb = createObb();
    const pose = createPose();
    expect(vsRect(setObb(obb, x0, 0, PI / 2, HW, HL), wall).overlap).toBe(false);
    expect(vsRect(setObb(obb, x1, 0, PI / 2, HW, HL), wall).overlap).toBe(false);
    const count = subStepCount(x1 - x0);
    expect(count).toBe(4);
    let hits = 0;
    for (let step = 1; step <= count; step++) {
      subStepPose(x0, 0, PI / 2, x1, 0, PI / 2, step, count, pose);
      setObb(obb, pose.x, pose.y, pose.headingRad, HW, HL);
      if (vsRect(obb, wall).overlap) hits++;
    }
    expect(hits).toBeGreaterThan(0);
  });
});

describe('allocation-free per-call paths', () => {
  it('setObb, obbAabb, obbCorners, obbVsRect, obbVsCircle, subStepCount and subStepPose allocate nothing', () => {
    const obb = createObb();
    const box = createAabb();
    const corners = new Float64Array(8);
    const contact = createContact();
    const pose = createPose();
    const axis: Vec2 = { x: 0, y: 0 };
    let sink = 0;
    const delta = measureHeapDelta(
      (tick) => {
        const h = tick * 0.013;
        setObb(obb, (tick % 7) * 0.1, (tick % 5) * 0.1, h, HW, HL);
        obbAabb(obb, box);
        obbCorners(obb, corners);
        obbRightAxis(obb, axis);
        obbForwardAxis(obb, axis);
        if (obbVsRect(obb, 0.5, -1, 2, 1, contact)) sink = (sink + 1) | 0;
        if (obbVsCircle(obb, 0.9, -1.2, 0.3, contact)) sink = (sink + 1) | 0;
        if (obbVsCircle(obb, 0.1, 0.1, 0.2, contact)) sink = (sink + 1) | 0;
        const n = subStepCount((tick % 40) * 0.1);
        subStepPose(0, 0, h, 1, 1, h + 0.1, 1, n, pose);
        sink = (sink + (pose.x > 0.5 ? 1 : 0) + (box.maxX > 0 ? 1 : 0)) | 0;
      },
      // 60,000 warm-up calls let TurboFan take over. Under the mid tier (Maglev) a non-inlined call boxes its
      // double arguments and returns (~32 B per call), which is the tier, not the code; the shipped game spends
      // minutes in TurboFan code. The measured window is still the standard 3,600 ticks.
      { warmupTicks: 60_000 },
    );
    expect(sink).toBeGreaterThan(0);
    assertHeapDeltaWithinThresholds(delta);
  });
});
