// mergeSolids properties (TECHNICAL_DESIGN §9.1, §18.2; SSP-032). On random collide grids up to 32×32 the
// merged rectangles cover exactly the SOLID cells, with no overlap and no gaps, and the output is a pure
// function of the grid. Fixed seed so a failure always reproduces.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { COLLIDE, COLLIDE_ALL_BITS, mergeSolids, type TileRect } from '../../src/sim/map.ts';

const SEED = 0x55_03_2a;
const RUNS = 1000;

type Grid = { w: number; h: number; collide: Uint8Array };

/**
 * A w × h collide grid (1..32 each way). A per-grid threshold sets the SOLID density anywhere from empty to
 * full, and the KERB_EDGE bits are random noise that mergeSolids must ignore.
 */
const gridArb: fc.Arbitrary<Grid> = fc
  .record({
    w: fc.integer({ min: 1, max: 32 }),
    h: fc.integer({ min: 1, max: 32 }),
    threshold: fc.integer({ min: 0, max: 256 }),
  })
  .chain(({ w, h, threshold }) =>
    fc.uint8Array({ minLength: w * h, maxLength: w * h }).map((bytes) => {
      const collide = new Uint8Array(w * h);
      for (let i = 0; i < collide.length; i += 1) {
        const b = bytes[i] ?? 0;
        collide[i] = (b & COLLIDE_ALL_BITS & ~COLLIDE.SOLID) | (b < threshold ? COLLIDE.SOLID : 0);
      }
      return { w, h, collide };
    }),
  );

/** Per-cell cover counts; also asserts every rect is non-empty and inside the grid. */
function coverCounts({ w, h }: Grid, rects: TileRect[]): Uint8Array {
  const counts = new Uint8Array(w * h);
  for (const [x0, y0, x1, y1] of rects) {
    expect(Number.isInteger(x0) && Number.isInteger(y0) && Number.isInteger(x1) && Number.isInteger(y1)).toBe(
      true,
    );
    expect(x0).toBeGreaterThanOrEqual(0);
    expect(y0).toBeGreaterThanOrEqual(0);
    expect(x1).toBeLessThanOrEqual(w);
    expect(y1).toBeLessThanOrEqual(h);
    expect(x1).toBeGreaterThan(x0);
    expect(y1).toBeGreaterThan(y0);
    for (let y = y0; y < y1; y += 1)
      for (let x = x0; x < x1; x += 1) counts[y * w + x] = (counts[y * w + x] ?? 0) + 1;
  }
  return counts;
}

describe('mergeSolids properties', () => {
  it(`covers exactly the SOLID cells with no overlap and no gaps (${RUNS} grids, fixed seed)`, () => {
    fc.assert(
      fc.property(gridArb, (grid) => {
        const rects = mergeSolids(grid.collide, grid.w, grid.h);
        const counts = coverCounts(grid, rects);
        for (let i = 0; i < counts.length; i += 1) {
          const solid = ((grid.collide[i] ?? 0) & COLLIDE.SOLID) !== 0;
          // Exact cover: a SOLID cell is covered exactly once, any other cell never.
          expect(counts[i]).toBe(solid ? 1 : 0);
        }
      }),
      { seed: SEED, numRuns: RUNS },
    );
  });

  it('is identical across two runs on the same grid and does not modify the grid', () => {
    fc.assert(
      fc.property(gridArb, (grid) => {
        const before = grid.collide.slice();
        const first = mergeSolids(grid.collide, grid.w, grid.h);
        const second = mergeSolids(grid.collide, grid.w, grid.h);
        expect(second).toEqual(first);
        expect(grid.collide).toEqual(before);
      }),
      { seed: SEED + 1, numRuns: RUNS },
    );
  });

  it('emits rects in row-major order of their top-left corner, each grown as far right as it can go', () => {
    fc.assert(
      fc.property(gridArb, (grid) => {
        const { w, collide } = grid;
        const rects = mergeSolids(collide, w, grid.h);
        const solidAt = (x: number, y: number): boolean => ((collide[y * w + x] ?? 0) & COLLIDE.SOLID) !== 0;
        // Cells claimed by rects that start earlier in scan order (the greedy can only extend into the rest).
        const claimed = new Uint8Array(collide.length);
        for (let k = 0; k < rects.length; k += 1) {
          const [x0, y0, x1, y1] = rects[k] ?? [0, 0, 0, 0];
          const prev = rects[k - 1];
          if (prev !== undefined) expect(prev[1] * w + prev[0]).toBeLessThan(y0 * w + x0);
          // Maximal to the right on its first row: the next cell is the edge, empty or already claimed.
          expect(x1 === w || !solidAt(x1, y0) || claimed[y0 * w + x1] === 1).toBe(true);
          for (let y = y0; y < y1; y += 1) claimed.fill(1, y * w + x0, y * w + x1);
        }
        // A merge never needs more rects than SOLID cells.
        expect(rects.length).toBeLessThanOrEqual(collide.reduce((n, v) => n + (v & COLLIDE.SOLID), 0));
      }),
      { seed: SEED + 2, numRuns: RUNS },
    );
  });
});
