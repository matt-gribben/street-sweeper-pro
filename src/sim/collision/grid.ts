// The static collision world (TECHNICAL_DESIGN §9.1, SSP-036): every shape Bessie can hit that never moves,
// bucketed per 2 m tile so phase 3 tests only the shapes near her.
//
// Shapes, in this fixed order (the shape index is the deterministic tie-break everywhere):
//   1. Rect (source Solid):    the level's merged solid rects (`level.solids`, tiles → metres), in file order.
//   2. Rect (source Boundary): the map edge as four 4-tile-thick strips outside the map, N, S, W, E. The N and
//      S strips span the corners, so Bessie can never leave the map, even diagonally.
//   3. Circle / Box (source Prop): one per `level.props` entry, in file order, with the provisional footprint
//      from tuning.json → propFootprints (a circle, or a box turned by the prop's `rot`).
//
// Buckets cover the map plus a one-tile ring (where the boundary strips meet the map), as a CSR list: the
// shapes of extended cell c are cellItems[cellStart[c] .. cellStart[c + 1]). A shape is registered in every
// cell its AABB overlaps. queryStatic gathers each shape once (a per-query stamp dedupes shapes spanning
// several cells) into the preallocated `candidates` list.
//
// Ghost edges. Merging (map.ts mergeSolids) removes most internal edges, but a terrace whose houses differ in
// depth still merges into several rects with flush fronts. A plain SAT minimum against one of them can pick
// the internal side face where it meets its neighbour and snag Bessie sliding along the front. The grid keeps
// a solid-cell raster (cells outside the map count as solid) and rectOpenMask closes those features for
// obbVsRectMasked: a face is closed when every cell beyond it, across the rows (or columns) of the rect that
// Bessie's AABB overlaps, is solid; a corner is closed unless both cells beside it, outside the rect, are
// empty (TECHNICAL_DESIGN §9.1).
//
// createStaticGrid allocates (once per shift). queryStatic, rectOpenMask and staticContact allocate nothing
// and take no double arguments (a double argument is boxed when V8 does not inline a call; see eventQueue.ts).
import { TILE_M } from '../constants.ts';
import type { Level, LevelProp } from '../map.ts';
import type { PropFootprint, PropFootprints } from '../tuning.ts';
import { type Aabb, createAabb, createObb, type Obb, obbAabb, setObb } from './obb.ts';
import { type Circle, type Contact, obbVsCircleShape, obbVsObb, obbVsRectMasked, RECT_OPEN } from './sat.ts';

/** Shape kinds. */
export const ShapeKind = { Rect: 0, Circle: 1, Box: 2 } as const;
export type ShapeKind = (typeof ShapeKind)[keyof typeof ShapeKind];

/** Where a shape came from. */
export const ShapeSource = { Solid: 0, Boundary: 1, Prop: 2 } as const;
export type ShapeSource = (typeof ShapeSource)[keyof typeof ShapeSource];

/** Thickness of each map-boundary strip, in tiles (8 m: far more than Bessie can travel in a tick). */
export const BOUNDARY_TILES = 4;

/** The static world, indexed by shape. Everything is sized once by createStaticGrid. */
export type StaticGrid = {
  /** Map size in tiles. */
  readonly widthTiles: number;
  readonly heightTiles: number;
  readonly shapeCount: number;
  readonly kind: Uint8Array;
  readonly source: Uint8Array;
  /** Each shape's AABB in metres (for a rect, the rect itself). */
  readonly bounds: readonly Readonly<Aabb>[];
  /** Rects only: the rect in tiles, [x0, x1) × [y0, y1) (boundary strips reach outside the map). */
  readonly tileX0: Int32Array;
  readonly tileY0: Int32Array;
  readonly tileX1: Int32Array;
  readonly tileY1: Int32Array;
  /** Circles only: centre and radius (other shapes hold an unused zero circle). */
  readonly circles: readonly Readonly<Circle>[];
  /** Boxes only: the footprint OBB (other shapes hold an unused zero box). */
  readonly boxes: readonly Obb[];
  /** Props only: the index into level.props; −1 for rects. */
  readonly propIndex: Int32Array;
  /** Solid-cell raster over the map plus a one-tile ring (ring cells are solid): (w + 2) × (h + 2). */
  readonly solidCells: Uint8Array;
  /** CSR buckets over the same extended cells: cellStart has (w + 2)·(h + 2) + 1 entries. */
  readonly cellStart: Int32Array;
  readonly cellItems: Int32Array;
  /** Shapes gathered by the last queryStatic, `candidateCount` of them from index 0. */
  readonly candidates: Int32Array;
  candidateCount: number;
  /** Per-shape stamp of the last query that gathered it, and the current stamp. */
  readonly stamp: Uint32Array;
  stampValue: number;
  /** Scratch for cellRange: [c0, r0, c1, r1]. */
  readonly range: Int32Array;
};

/** Extended-grid cell index of map cell (col, row); valid for col ∈ [−1, w], row ∈ [−1, h]. */
function cellIndex(widthTiles: number, col: number, row: number): number {
  return (row + 1) * (widthTiles + 2) + (col + 1);
}

/** True when map cell (col, row) is solid. Cells outside the map are solid (the boundary). */
export function isSolidCell(grid: StaticGrid, col: number, row: number): boolean {
  if (col < 0 || row < 0 || col >= grid.widthTiles || row >= grid.heightTiles) return true;
  return grid.solidCells[cellIndex(grid.widthTiles, col, row)] === 1;
}

/**
 * The extended-grid cells `box` (metres, finite) overlaps, clamped to [−1, w] × [−1, h], written into
 * `grid.range` as int32s [c0, r0, c1, r1] (inclusive). Takes the box as an object so no double crosses the call.
 */
function cellRange(grid: StaticGrid, box: Readonly<Aabb>): Int32Array {
  const w = grid.widthTiles;
  const h = grid.heightTiles;
  const range = grid.range;
  let v = Math.floor(box.minX / TILE_M);
  range[0] = v < -1 ? -1 : v > w ? w : v;
  v = Math.floor(box.minY / TILE_M);
  range[1] = v < -1 ? -1 : v > h ? h : v;
  v = Math.floor(box.maxX / TILE_M);
  range[2] = v < -1 ? -1 : v > w ? w : v;
  v = Math.floor(box.maxY / TILE_M);
  range[3] = v < -1 ? -1 : v > h ? h : v;
  return range;
}

/** Shape description gathered before the arrays are sized. */
type ShapeSpec =
  | { kind: 0; source: 0 | 1; x0: number; y0: number; x1: number; y1: number }
  | { kind: 1 | 2; prop: number; p: LevelProp; footprint: PropFootprint };

function footprintOf(footprints: PropFootprints, prop: LevelProp, index: number): PropFootprint {
  const shapes: Readonly<Record<string, PropFootprint | undefined>> = footprints.shapes;
  const fp = Object.hasOwn(shapes, prop.id) ? shapes[prop.id] : undefined;
  if (fp === undefined) {
    throw new Error(
      `createStaticGrid: level prop ${index} (${prop.id}) has no footprint in tuning.json propFootprints.shapes`,
    );
  }
  return fp;
}

/**
 * Build the static world for `level`: merged solids, the map boundary and the props with their footprints.
 * Setup only (allocates). Throws if a prop has no footprint or a non-finite position or rot.
 */
export function createStaticGrid(level: Level, footprints: PropFootprints): StaticGrid {
  const [w, h] = level.size;
  const specs: ShapeSpec[] = [];
  for (const [x0, y0, x1, y1] of level.solids) specs.push({ kind: 0, source: 0, x0, y0, x1, y1 });
  const b = BOUNDARY_TILES;
  specs.push({ kind: 0, source: 1, x0: -b, y0: -b, x1: w + b, y1: 0 });
  specs.push({ kind: 0, source: 1, x0: -b, y0: h, x1: w + b, y1: h + b });
  specs.push({ kind: 0, source: 1, x0: -b, y0: 0, x1: 0, y1: h });
  specs.push({ kind: 0, source: 1, x0: w, y0: 0, x1: w + b, y1: h });
  level.props.forEach((p, i) => {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.rot)) {
      throw new Error(`createStaticGrid: level prop ${i} (${p.id}) has a non-finite position or rot`);
    }
    const footprint = footprintOf(footprints, p, i);
    specs.push({ kind: footprint.shape === 'circle' ? 1 : 2, prop: i, p, footprint });
  });

  const n = specs.length;
  const cells = (w + 2) * (h + 2);
  const kind = new Uint8Array(n);
  const source = new Uint8Array(n);
  const bounds = specs.map(() => createAabb());
  const tileX0 = new Int32Array(n);
  const tileY0 = new Int32Array(n);
  const tileX1 = new Int32Array(n);
  const tileY1 = new Int32Array(n);
  const circles: Circle[] = specs.map(() => ({ x: 0, y: 0, radiusM: 0 }));
  const boxes = specs.map(() => createObb());
  const propIndex = new Int32Array(n).fill(-1);
  // The solid raster: the map interior starts empty; ring cells stay solid.
  const solidCells = new Uint8Array(cells).fill(1);
  for (let row = 0; row < h; row += 1) {
    for (let col = 0; col < w; col += 1) solidCells[cellIndex(w, col, row)] = 0;
  }

  specs.forEach((spec, i) => {
    kind[i] = spec.kind;
    const box = bounds[i] as Aabb;
    if (spec.kind === ShapeKind.Rect) {
      source[i] = spec.source;
      tileX0[i] = spec.x0;
      tileY0[i] = spec.y0;
      tileX1[i] = spec.x1;
      tileY1[i] = spec.y1;
      box.minX = spec.x0 * TILE_M;
      box.minY = spec.y0 * TILE_M;
      box.maxX = spec.x1 * TILE_M;
      box.maxY = spec.y1 * TILE_M;
      if (spec.source === ShapeSource.Solid) {
        for (let row = Math.max(0, spec.y0); row < Math.min(h, spec.y1); row += 1) {
          for (let col = Math.max(0, spec.x0); col < Math.min(w, spec.x1); col += 1) {
            solidCells[cellIndex(w, col, row)] = 1;
          }
        }
      }
      return;
    }
    source[i] = ShapeSource.Prop;
    propIndex[i] = spec.prop;
    const { p, footprint: fp } = spec;
    if (fp.shape === 'circle') {
      const c = circles[i] as Circle;
      c.x = p.x;
      c.y = p.y;
      c.radiusM = fp.radiusM;
      box.minX = p.x - fp.radiusM;
      box.minY = p.y - fp.radiusM;
      box.maxX = p.x + fp.radiusM;
      box.maxY = p.y + fp.radiusM;
    } else {
      obbAabb(setObb(boxes[i] as Obb, p.x, p.y, p.rot, fp.widthM / 2, fp.lengthM / 2), box);
    }
  });

  const grid: StaticGrid = {
    widthTiles: w,
    heightTiles: h,
    shapeCount: n,
    kind,
    source,
    bounds,
    tileX0,
    tileY0,
    tileX1,
    tileY1,
    circles,
    boxes,
    propIndex,
    solidCells,
    cellStart: new Int32Array(cells + 1),
    cellItems: new Int32Array(0),
    candidates: new Int32Array(n),
    candidateCount: 0,
    stamp: new Uint32Array(n),
    stampValue: 0,
    range: new Int32Array(4),
  };

  // Buckets: count per cell, prefix-sum into cellStart, then fill in shape order.
  const visitCells = (i: number, visit: (c: number) => void): void => {
    const [c0 = 0, r0 = 0, c1 = 0, r1 = 0] = cellRange(grid, bounds[i] as Aabb);
    for (let row = r0; row <= r1; row += 1) {
      for (let col = c0; col <= c1; col += 1) visit(cellIndex(w, col, row));
    }
  };
  const counts = new Int32Array(cells);
  for (let i = 0; i < n; i += 1) {
    visitCells(i, (c) => {
      counts[c] = (counts[c] as number) + 1;
    });
  }
  let total = 0;
  for (let c = 0; c < cells; c += 1) {
    grid.cellStart[c] = total;
    total += counts[c] as number;
  }
  grid.cellStart[cells] = total;
  const cellItems = new Int32Array(total);
  const next = grid.cellStart.slice(0, cells);
  for (let i = 0; i < n; i += 1) {
    visitCells(i, (c) => {
      const at = next[c] as number;
      cellItems[at] = i;
      next[c] = at + 1;
    });
  }
  return { ...grid, cellItems };
}

/**
 * Gather every shape registered in the cells `aabb` overlaps (clamped to the map plus its ring) into
 * `grid.candidates`, each once, in cell order. Returns the count, also kept in `grid.candidateCount`.
 * A non-finite or inverted box gathers nothing. Allocation-free.
 */
export function queryStatic(grid: StaticGrid, aabb: Readonly<Aabb>): number {
  grid.candidateCount = 0;
  const minX = aabb.minX;
  const minY = aabb.minY;
  const maxX = aabb.maxX;
  const maxY = aabb.maxY;
  if (!(minX <= maxX && minY <= maxY) || !Number.isFinite(minX + minY + maxX + maxY)) return 0;
  let stamp = (grid.stampValue + 1) >>> 0;
  if (stamp === 0) {
    grid.stamp.fill(0);
    stamp = 1;
  }
  grid.stampValue = stamp;
  const w = grid.widthTiles;
  const range = cellRange(grid, aabb);
  const c0 = range[0] as number;
  const r0 = range[1] as number;
  const c1 = range[2] as number;
  const r1 = range[3] as number;
  const start = grid.cellStart;
  const items = grid.cellItems;
  const seen = grid.stamp;
  const out = grid.candidates;
  let count = 0;
  for (let row = r0; row <= r1; row += 1) {
    for (let col = c0; col <= c1; col += 1) {
      const c = cellIndex(w, col, row);
      const end = start[c + 1] as number;
      for (let k = start[c] as number; k < end; k += 1) {
        const s = items[k] as number;
        if (seen[s] === stamp) continue;
        seen[s] = stamp;
        out[count] = s;
        count += 1;
      }
    }
  }
  grid.candidateCount = count;
  return count;
}

/**
 * Which features of rect shape `s` may supply an MTV for an OBB whose AABB is `aabb` (RECT_OPEN bits): the
 * ghost-edge mask described in the header. Only the rows (or columns) of the rect that the AABB overlaps are
 * examined for a face, so a face counts as internal exactly where the neighbouring solid sits against it.
 */
export function rectOpenMask(grid: StaticGrid, s: number, aabb: Readonly<Aabb>): number {
  const x0 = grid.tileX0[s] as number;
  const y0 = grid.tileY0[s] as number;
  const x1 = grid.tileX1[s] as number;
  const y1 = grid.tileY1[s] as number;
  // Rows and columns of the rect under the AABB.
  const range = cellRange(grid, aabb);
  let c0 = range[0] as number;
  let r0 = range[1] as number;
  let c1 = range[2] as number;
  let r1 = range[3] as number;
  if (r0 < y0) r0 = y0;
  if (r1 > y1 - 1) r1 = y1 - 1;
  if (c0 < x0) c0 = x0;
  if (c1 > x1 - 1) c1 = x1 - 1;

  let open = 0;
  // A face is open if any cell beyond it, alongside the overlapped span, is empty. An empty span (the AABB
  // misses the rect on that axis, so there is no overlap to resolve) leaves the face open.
  if (faceOpenVertical(grid, x0 - 1, r0, r1)) open |= RECT_OPEN.FACE_W;
  if (faceOpenVertical(grid, x1, r0, r1)) open |= RECT_OPEN.FACE_E;
  if (faceOpenHorizontal(grid, y0 - 1, c0, c1)) open |= RECT_OPEN.FACE_N;
  if (faceOpenHorizontal(grid, y1, c0, c1)) open |= RECT_OPEN.FACE_S;
  // A corner is convex (open) when both cells beside the rect's corner cell, outside the rect, are empty.
  if (!isSolidCell(grid, x0 - 1, y0) && !isSolidCell(grid, x0, y0 - 1)) open |= RECT_OPEN.CORNER_NW;
  if (!isSolidCell(grid, x1, y0) && !isSolidCell(grid, x1 - 1, y0 - 1)) open |= RECT_OPEN.CORNER_NE;
  if (!isSolidCell(grid, x0 - 1, y1 - 1) && !isSolidCell(grid, x0, y1)) open |= RECT_OPEN.CORNER_SW;
  if (!isSolidCell(grid, x1, y1 - 1) && !isSolidCell(grid, x1 - 1, y1)) open |= RECT_OPEN.CORNER_SE;
  return open;
}

function faceOpenVertical(grid: StaticGrid, col: number, r0: number, r1: number): boolean {
  if (r0 > r1) return true;
  for (let row = r0; row <= r1; row += 1) if (!isSolidCell(grid, col, row)) return true;
  return false;
}

function faceOpenHorizontal(grid: StaticGrid, row: number, c0: number, c1: number): boolean {
  if (c0 > c1) return true;
  for (let col = c0; col <= c1; col += 1) if (!isSolidCell(grid, col, row)) return true;
  return false;
}

/**
 * SAT of `obb` (whose AABB is `aabb`) against shape `s`, writing the MTV into `out` (normal from the shape
 * toward the OBB, sat.ts convention). Rects use the ghost-edge mask; circles and boxes are plain SAT.
 * Allocation-free.
 */
export function staticContact(
  grid: StaticGrid,
  s: number,
  obb: Obb,
  aabb: Readonly<Aabb>,
  out: Contact,
): boolean {
  const kind = grid.kind[s];
  if (kind === ShapeKind.Rect) {
    return obbVsRectMasked(obb, grid.bounds[s] as Aabb, rectOpenMask(grid, s, aabb), out);
  }
  if (kind === ShapeKind.Circle) return obbVsCircleShape(obb, grid.circles[s] as Circle, out);
  return obbVsObb(obb, grid.boxes[s] as Obb, out);
}
