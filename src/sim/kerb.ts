// Kerb crossing detection (TECHNICAL_DESIGN §8.2 step 9, §9.1, SSP-035). An axle midpoint crosses a raised
// kerb when its segment for this tick (previous pose → integrated pose) passes a tile edge that carries a
// KERB_EDGE bit in the collide layer. Dropped kerbs carry no bit, so they are never reported.
//
// The segment is walked through the 2 m tile grid with a grid traversal (Amanatides–Woo DDA), so a segment
// that crosses two edges in one tick (cutting a tile corner) reports both, in the order it crosses them.
// Determinism rules:
// - A point exactly on a tile edge belongs to the tile floor(x / TILE_M), as everywhere else in the sim
//   (coords.ts tileOf). The number of edges crossed is therefore exactly |Δcol| + |Δrow|, and the walk takes
//   exactly that many steps, so float rounding can never make it loop or overshoot.
// - When the segment passes exactly through a tile corner (equal parametric distance to the next column and
//   row edge), the column edge (x) is crossed first.
// An edge is a kerb when either cell beside it carries the bit for that side (the compiler sets both).
//
// Allocation-free: the segment is read from, and the crossings written into, a KerbCrossings scratch object
// created once per World. The endpoints travel in that object rather than as arguments because V8 boxes every
// double argument of a call it does not inline (16 B each), which the World's heap-delta test catches.
import { TILE_M } from './constants.ts';
import { COLLIDE } from './map.ts';

/**
 * Most kerb crossings one axle segment may report. A tick moves an axle at most ~0.3 m (17.2 m/s top speed,
 * TECHNICAL_DESIGN §9.5), so real segments cross at most two edges; anything near this cap is a teleport bug.
 */
export const KERB_CROSSINGS_MAX = 8;

/**
 * Scratch for findKerbCrossings: the caller writes the segment (x0M, y0M) → (x1M, y1M) in sim metres; the
 * call writes the crossings, of which the first `count` are valid, in crossing order.
 */
export type KerbCrossings = {
  x0M: number;
  y0M: number;
  x1M: number;
  y1M: number;
  count: number;
  /** Crossing points on the segment, sim metres. */
  readonly xM: Float64Array;
  readonly yM: Float64Array;
};

/** A new, empty crossing buffer. Allocate once, outside the tick. */
export function createKerbCrossings(): KerbCrossings {
  return {
    x0M: 0,
    y0M: 0,
    x1M: 0,
    y1M: 0,
    count: 0,
    xM: new Float64Array(KERB_CROSSINGS_MAX),
    yM: new Float64Array(KERB_CROSSINGS_MAX),
  };
}

/** Collide bits of cell (col, row); 0 outside the map. */
function collideAt(collide: Uint8Array, w: number, h: number, col: number, row: number): number {
  if (col < 0 || row < 0 || col >= w || row >= h) return 0;
  // In range by the check above.
  return collide[row * w + col] as number;
}

function throwTooMany(): never {
  throw new Error(
    `kerb: an axle segment crossed more than ${KERB_CROSSINGS_MAX} kerb edges in one tick; ` +
      'the vehicle moved implausibly far (teleport or integration bug)',
  );
}

/**
 * Find every KERB_EDGE tile edge the segment (out.x0M, out.y0M) → (out.x1M, out.y1M) crosses, in crossing
 * order, and write the crossing points into `out` (its count is reset first). `collide` is the level's w × h
 * collide layer. Returns the number of crossings.
 */
export function findKerbCrossings(collide: Uint8Array, w: number, h: number, out: KerbCrossings): number {
  out.count = 0;
  const x0 = out.x0M;
  const y0 = out.y0M;
  const x1 = out.x1M;
  const y1 = out.y1M;
  let col = Math.floor(x0 / TILE_M);
  let row = Math.floor(y0 / TILE_M);
  const endCol = Math.floor(x1 / TILE_M);
  const endRow = Math.floor(y1 / TILE_M);
  let stepsX = Math.abs(endCol - col);
  let stepsY = Math.abs(endRow - row);
  if (stepsX + stepsY === 0) return 0;

  const dx = x1 - x0;
  const dy = y1 - y0;
  const stepCol = endCol > col ? 1 : -1;
  const stepRow = endRow > row ? 1 : -1;
  // Parametric distance (0..1 along the segment) to the next column / row edge, and between edges.
  let tMaxX = stepsX === 0 ? Number.POSITIVE_INFINITY : ((stepCol > 0 ? col + 1 : col) * TILE_M - x0) / dx;
  let tMaxY = stepsY === 0 ? Number.POSITIVE_INFINITY : ((stepRow > 0 ? row + 1 : row) * TILE_M - y0) / dy;
  const tDeltaX = stepsX === 0 ? 0 : TILE_M / Math.abs(dx);
  const tDeltaY = stepsY === 0 ? 0 : TILE_M / Math.abs(dy);

  while (stepsX + stepsY > 0) {
    // Step x when y is done, or when the column edge comes first (ties go to x).
    const alongX = stepsY === 0 || (stepsX > 0 && tMaxX <= tMaxY);
    let t: number;
    let kerb: boolean;
    if (alongX) {
      t = tMaxX;
      const next = col + stepCol;
      const here = collideAt(collide, w, h, col, row);
      const there = collideAt(collide, w, h, next, row);
      kerb =
        stepCol > 0
          ? (here & COLLIDE.KERB_EDGE_E) !== 0 || (there & COLLIDE.KERB_EDGE_W) !== 0
          : (here & COLLIDE.KERB_EDGE_W) !== 0 || (there & COLLIDE.KERB_EDGE_E) !== 0;
      col = next;
      tMaxX += tDeltaX;
      stepsX -= 1;
    } else {
      t = tMaxY;
      const next = row + stepRow;
      const here = collideAt(collide, w, h, col, row);
      const there = collideAt(collide, w, h, col, next);
      kerb =
        stepRow > 0
          ? (here & COLLIDE.KERB_EDGE_S) !== 0 || (there & COLLIDE.KERB_EDGE_N) !== 0
          : (here & COLLIDE.KERB_EDGE_N) !== 0 || (there & COLLIDE.KERB_EDGE_S) !== 0;
      row = next;
      tMaxY += tDeltaY;
      stepsY -= 1;
    }
    if (kerb) {
      // Written inline rather than through a helper taking the point as doubles (V8 boxes those).
      const i = out.count;
      if (i >= KERB_CROSSINGS_MAX) throwTooMany();
      const tc = t < 0 ? 0 : t > 1 ? 1 : t;
      out.xM[i] = x0 + dx * tc;
      out.yM[i] = y0 + dy * tc;
      out.count = i + 1;
    }
  }
  return out.count;
}
