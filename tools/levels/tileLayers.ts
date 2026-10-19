// The derived per-tile layers of a compiled level (SSP-034): the kerb blob `autotile` index, the `collide`
// bits and the road `markings` (LEVEL_DESIGN §7.1–§7.3, TECHNICAL_DESIGN §9.1 and §15.1 steps 2–3).
// Pure: no fs. Runs once per compile, so it may allocate.
//
// Rules (as built, SSP-034; LEVEL_DESIGN §7.2 and §10.2 mirror them):
// - A **road cell** is a drivable cell of road ground (two-way or one-way, including the `z k b p =` road
//   features). A **raised-kerb cell** is a drivable pavement, cobbles or grass cell that is not a dropped
//   kerb `d`. Alley setts, yards and aprons meet the road flush (no kerb).
// - SOLID is every cell Bessie may not drive on: buildings, `w e r`, water, sand, void and 1-tile footways.
// - KERB_EDGE_<dir> marks an orthogonal road ↔ raised-kerb edge, on both cells (each for its own side).
// - `autotile` is set on raised-kerb cells with a road cell among their 8 neighbours: the blob index of the
//   neighbour mask (kerbBlob.ts; bit set = not road, outside the map counts as not road). Everything else,
//   including dropped kerbs, is AUTOTILE_NONE.
// - `markings`: see MARKING in src/sim/map.ts; centre lines go on two-way road cells whose carriageway is 3–6
//   tiles wide across and longer than it is wide along (so junction boxes and plazas get none).
import { AUTOTILE_NONE, COLLIDE, Ground, MARKING } from '../../src/sim/map.ts';
import type { ResolvedMap } from './compile-level.ts';
import { BLOB_DIRS, BLOB_OFFSETS, type KerbBlob } from './kerbBlob.ts';

/** True for the road grounds (two-way and one-way). */
export function isRoadGround(ground: number): boolean {
  return ground >= Ground.Road && ground <= Ground.RoadOneWayS;
}

/** Grounds that stand behind a raised kerb where they meet a road (unless the cell is a dropped kerb `d`). */
export const RAISED_KERB_GROUNDS: readonly number[] = [Ground.Pavement, Ground.Cobbles, Ground.Grass];

/** Narrowest and widest two-way carriageway (in tiles) that gets a painted centre line (LEVEL_DESIGN §7.1). */
export const CENTRE_LINE_MIN_TILES = 3;
export const CENTRE_LINE_MAX_TILES = 6;

/** Orthogonal sides: offset, this cell's KERB_EDGE bit, and the neighbour's facing bit. */
const SIDES: readonly [dx: number, dy: number, own: number, facing: number][] = [
  [0, -1, COLLIDE.KERB_EDGE_N, COLLIDE.KERB_EDGE_S],
  [1, 0, COLLIDE.KERB_EDGE_E, COLLIDE.KERB_EDGE_W],
  [0, 1, COLLIDE.KERB_EDGE_S, COLLIDE.KERB_EDGE_N],
  [-1, 0, COLLIDE.KERB_EDGE_W, COLLIDE.KERB_EDGE_E],
];

const KERB_EDGES = COLLIDE.KERB_EDGE_N | COLLIDE.KERB_EDGE_E | COLLIDE.KERB_EDGE_S | COLLIDE.KERB_EDGE_W;

/** A drivable road cell. */
export function isRoadCell(map: ResolvedMap, i: number): boolean {
  return map.drivable[i] === 1 && isRoadGround(map.ground[i] ?? 0);
}

/** A drivable pavement, cobbles or grass cell that is not a dropped kerb. */
export function isRaisedKerbCell(map: ResolvedMap, i: number): boolean {
  return (
    map.drivable[i] === 1 &&
    RAISED_KERB_GROUNDS.includes(map.ground[i] ?? 0) &&
    map.defs[i]?.mark !== 'dropped_kerb'
  );
}

/** The raw 8-neighbour mask of a cell: a direction's bit is set when that neighbour is not a road cell. */
export function rawKerbMask(map: ResolvedMap, x: number, y: number, blob: KerbBlob): number {
  let raw = 0;
  for (const d of BLOB_DIRS) {
    const [dx, dy] = BLOB_OFFSETS[d];
    const nx = x + dx;
    const ny = y + dy;
    const inside = nx >= 0 && ny >= 0 && nx < map.w && ny < map.h;
    if (!inside || !isRoadCell(map, ny * map.w + nx)) raw |= blob.bits[d];
  }
  return raw;
}

export type TileLayers = { autotile: Uint8Array; collide: Uint8Array; markings: Uint8Array };

/** Compute the autotile, collide and markings layers of a resolved map. */
export function computeTileLayers(map: ResolvedMap, blob: KerbBlob): TileLayers {
  const { w, h } = map;
  const n = w * h;
  const autotile = new Uint8Array(n).fill(AUTOTILE_NONE);
  const collide = new Uint8Array(n);
  const markings = new Uint8Array(n);

  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = y * w + x;
      if (map.drivable[i] !== 1) {
        collide[i] = COLLIDE.SOLID;
        continue;
      }
      if (isRoadCell(map, i)) {
        for (const [dx, dy, own, facing] of SIDES) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const j = ny * w + nx;
          if (!isRaisedKerbCell(map, j)) continue;
          collide[i] = (collide[i] ?? 0) | own;
          collide[j] = (collide[j] ?? 0) | facing;
        }
      } else if (isRaisedKerbCell(map, i)) {
        const raw = rawKerbMask(map, x, y, blob);
        if (raw !== 255) autotile[i] = blob.indexOfRaw[raw] ?? AUTOTILE_NONE;
      }
    }
  }

  // Road runs across each cell: start and length of the maximal run of road cells in its row and column.
  const rowStart = new Int32Array(n);
  const rowLen = new Int32Array(n);
  const colStart = new Int32Array(n);
  const colLen = new Int32Array(n);
  for (let y = 0; y < h; y += 1) {
    let x = 0;
    while (x < w) {
      if (!isRoadCell(map, y * w + x)) {
        x += 1;
        continue;
      }
      let x1 = x;
      while (x1 < w && isRoadCell(map, y * w + x1)) x1 += 1;
      for (let cx = x; cx < x1; cx += 1) {
        rowStart[y * w + cx] = x;
        rowLen[y * w + cx] = x1 - x;
      }
      x = x1;
    }
  }
  for (let x = 0; x < w; x += 1) {
    let y = 0;
    while (y < h) {
      if (!isRoadCell(map, y * w + x)) {
        y += 1;
        continue;
      }
      let y1 = y;
      while (y1 < h && isRoadCell(map, y1 * w + x)) y1 += 1;
      for (let cy = y; cy < y1; cy += 1) {
        colStart[cy * w + x] = y;
        colLen[cy * w + x] = y1 - y;
      }
      y = y1;
    }
  }

  const centreWidth = (len: number): boolean => len >= CENTRE_LINE_MIN_TILES && len <= CENTRE_LINE_MAX_TILES;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = y * w + x;
      if (!isRoadCell(map, i)) continue;
      const def = map.defs[i] ?? null;
      if (def?.mark === 'parking_bay') {
        markings[i] = MARKING.PARKING_BAY;
        continue;
      }
      // Sites (zebra, school crossing, bus stop) and speed bumps draw their own markings.
      if (def !== null && (def.site !== undefined || def.haz !== undefined || def.mark !== undefined))
        continue;
      let bits = 0;
      if (((collide[i] ?? 0) & KERB_EDGES) !== 0) bits |= MARKING.DOUBLE_YELLOW;
      if (map.ground[i] === Ground.Road) {
        const across = colLen[i] ?? 0;
        const along = rowLen[i] ?? 0;
        if (centreWidth(across) && along > across) {
          // An east–west carriageway `across` tiles tall.
          const offset = y - (colStart[i] ?? 0);
          if (across % 2 === 1 && offset === (across - 1) / 2) bits |= MARKING.CENTRE_EW;
          else if (across % 2 === 0 && offset === across / 2 - 1) bits |= MARKING.CENTRE_S_EDGE;
        } else if (centreWidth(along) && across > along) {
          // A north–south carriageway `along` tiles wide.
          const offset = x - (rowStart[i] ?? 0);
          if (along % 2 === 1 && offset === (along - 1) / 2) bits |= MARKING.CENTRE_NS;
          else if (along % 2 === 0 && offset === along / 2 - 1) bits |= MARKING.CENTRE_E_EDGE;
        }
      }
      markings[i] = bits;
    }
  }
  return { autotile, collide, markings };
}
