// CPU reference of the compiled ground as the city shader draws it (SSP-045 tiles and markings, SSP-066 grime), for
// specs that compare a W×270 `readFrame()` against what each 2 m ground tile must show. Shared by
// tests/visual/camera_follow.spec.ts (1 texel = 1 px with grime on the ground) and tests/e2e/grimeReveal.spec.ts.
//
// A ground texel is its base tile's atlas pixel, with each marking overlay's opaque pixels on top (the "clean"
// texel); where its 4 px grime cell is dirty, the cell's pattern (gutter pattern when mask bit 7 is set, else the
// surface pattern of the cell's grime code) replaces it at opaque pattern texels whose rank passes the intensity
// (cityMesh.ts grimeTexelShows, the CPU mirror of the shader). The atlas pixels are Kerbside-32 colours and the
// day palette pass maps each to itself, so the reference is in final frame colours, away from shadows.
//
// The initial grime of a shift is f(level, seed): createDirt + initGrime here give the mask the page's World lays
// for `?seed=<n>`. Cleaning only ever zeroes cells, so after a drive every grime cell must show either its initial
// grime or the clean ground: `compareGroundTiles` checks each cell block against both.
//
// The items batch (SSP-067) draws litter, stains, hydrants, the skip and the depot-bay markings over the ground;
// `itemsCover` gives the rects they can cover at shift start for `seed`; compareGroundTiles skips the grime cells
// under them (`skipCells`) rather than whole tiles.
import { readFileSync } from 'node:fs';
import { FRAME, type FrameId } from '../../src/gen/assets.ts';
import {
  CELL_M,
  type CityBox,
  type CityGrid,
  GRIME_CELL_PX,
  GRIME_NONE,
  grimePatternSlot,
  grimeRank,
  grimeTexelShows,
  mergeBoxes,
} from '../../src/render/cityMesh.ts';
import {
  cellGrimeCode,
  cellGroundFrames,
  type GroundFrameTables,
  groundFrameTables,
} from '../../src/render/groundLayer.ts';
import { levelItemMarkers, litterFrame, pickupFrame, stainFrame } from '../../src/render/itemsBatch.ts';
import { buildShadowPolygons } from '../../src/render/shadows.ts';
import type { RgbaImage } from '../../src/render/spriteAtlas.ts';
import { INTERNAL_HEIGHT_PX } from '../../src/render/upscale.ts';
import { GRIME_CELL_M, PX_PER_M } from '../../src/sim/constants.ts';
import { createDirt, initGrime } from '../../src/sim/dirt.ts';
import { decodeLevel, type Level } from '../../src/sim/map.ts';
import { DEFAULT_TUNING } from '../../src/sim/tuning.ts';
import { createWorld } from '../../src/sim/world.ts';
import { decodePng } from './png.ts';
import type { RgbaFrame } from './visualGolden.ts';

/** One 2 m tile in texels. */
export const TILE_PX = CELL_M * PX_PER_M;

/** Grime cells along a tile edge. */
const CELLS_PER_TILE = TILE_PX / GRIME_CELL_PX;

export type Rect = { x0: number; y0: number; x1: number; y1: number };

export const overlaps = (a: Rect, b: Rect): boolean =>
  a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/** Compiled Puddle Lane and the committed `world` atlas. */
export function loadPuddleLane(): { level: Level; atlas: RgbaImage } {
  const level = decodeLevel(
    JSON.parse(readFileSync(new URL('../../public/assets/levels/puddle_lane.json', import.meta.url), 'utf8')),
  );
  const atlas = decodePng(readFileSync(new URL('../../public/assets/atlas/world.png', import.meta.url)));
  return { level, atlas };
}

/** The grime mask the World lays at shift start for `seed` (dirt.ts initGrime). */
export function initialGrimeMask(level: Level, seed: number): { mask: Uint8Array; maskW: number } {
  const dirt = createDirt(level, DEFAULT_TUNING);
  initGrime(dirt, level, seed >>> 0);
  return { mask: Uint8Array.from(dirt.mask), maskW: dirt.maskW };
}

/**
 * What a box can cover on screen, in sim metres: its footprint plus its roof projected through the camera at
 * (camX, camY, H) (a point at height h and offset d from the axis lands at d·H/(H − h)), widened by a texel.
 */
export function buildingCover(box: CityBox, camX: number, camY: number, heightM: number): Rect {
  const k = heightM / (heightM - box.heightM);
  const xs = [box.x0M, box.x1M, camX + (box.x0M - camX) * k, camX + (box.x1M - camX) * k];
  const ys = [box.y0M, box.y1M, camY + (box.y0M - camY) * k, camY + (box.y1M - camY) * k];
  const m = 1 / PX_PER_M;
  return {
    x0: Math.min(...xs) - m,
    y0: Math.min(...ys) - m,
    x1: Math.max(...xs) + m,
    y1: Math.max(...ys) + m,
  };
}

/** Axis-aligned bounds of a shadow outline [x0, y0, x1, y1, ...], widened by a texel. */
export function outlineBounds(outline: readonly number[]): Rect {
  const xs = outline.filter((_, i) => i % 2 === 0);
  const ys = outline.filter((_, i) => i % 2 === 1);
  const m = 1 / PX_PER_M;
  return {
    x0: Math.min(...xs) - m,
    y0: Math.min(...ys) - m,
    x1: Math.max(...xs) + m,
    y1: Math.max(...ys) + m,
  };
}

/** Rects of the level that are not plain ground in a frame from camera (camX, camY, H): buildings and their shadows. */
export function cityCover(level: Level, camX: number, camY: number, heightM: number): Rect[] {
  const [cols, rows] = level.size;
  const grid: CityGrid = {
    cols,
    rows,
    originXM: 0,
    originYM: 0,
    storeys: level.layers.storeys,
    wall: level.layers.wall,
    roof: level.layers.roof,
  };
  const boxes = mergeBoxes(grid);
  return [
    ...boxes.map((box) => buildingCover(box, camX, camY, heightM)),
    ...buildShadowPolygons(boxes).map((p) => outlineBounds(p.outline)),
  ];
}

/** The rect a sprite frame centred on (xM, yM) can cover in any quarter turn, widened by a texel. */
function frameCover(frame: FrameId, xM: number, yM: number): Rect {
  const f = FRAME[frame];
  const half = Math.max(f.w, f.h) / 2 / PX_PER_M + 1 / PX_PER_M;
  return { x0: xM - half, y0: yM - half, x1: xM + half, y1: yM + half };
}

/**
 * Rects the items batch draws over the ground at shift start for `seed` (SSP-067, itemsBatch.ts): every litter
 * item and stain the World lays, its power-up pickups (SSP-096, either bob frame) and the level's hydrants, skip
 * and depot-bay markings.
 */
export function itemsCover(level: Level, seed: number): Rect[] {
  const world = createWorld(level, seed >>> 0, DEFAULT_TUNING);
  const rects = levelItemMarkers(level).map((m) => frameCover(m.frame, m.xM, m.yM));
  const { litter, stains, pickups } = world;
  for (let i = 0; i < litter.count; i++) {
    const xM = litter.x[i] ?? 0;
    const yM = litter.y[i] ?? 0;
    rects.push(frameCover(litterFrame(litter.kind[i] ?? 0, litter.rot[i] ?? 0, 0, 0), xM, yM));
  }
  for (let i = 0; i < stains.count; i++) {
    const xM = stains.x[i] ?? 0;
    const yM = stains.y[i] ?? 0;
    rects.push(frameCover(stainFrame(stains.kind[i] ?? 0, xM, yM), xM, yM));
  }
  for (let i = 0; i < pickups.count; i++) {
    const xM = pickups.x[i] ?? 0;
    const yM = pickups.y[i] ?? 0;
    rects.push(frameCover(pickupFrame(pickups.kind[i] ?? 0, 0), xM, yM));
  }
  return rects;
}

function copyPixel(atlas: RgbaImage, ax: number, ay: number, out: Uint8Array, at: number): boolean {
  const src = (ay * atlas.width + ax) * 4;
  if ((atlas.data[src + 3] ?? 0) === 0) return false;
  for (let c = 0; c < 4; c++) out[at + c] = atlas.data[src + c] ?? 0;
  return true;
}

/** The 32×32 clean tile a cell shows: its base frame with each overlay's opaque pixels on top (RGBA). */
export function cleanTile(atlas: RgbaImage, base: FrameId, overlays: readonly FrameId[]): Uint8Array {
  const out = new Uint8Array(TILE_PX * TILE_PX * 4);
  for (const id of [base, ...overlays]) {
    const f = FRAME[id];
    if (f.w !== TILE_PX || f.h !== TILE_PX) throw new Error(`${id} is not a full tile`);
    for (let y = 0; y < TILE_PX; y++) {
      for (let x = 0; x < TILE_PX; x++) copyPixel(atlas, f.x + x, f.y + y, out, (y * TILE_PX + x) * 4);
    }
  }
  return out;
}

/**
 * The 32×32 tile cell (cx, cy) shows under grime mask `mask` (RGBA): the clean tile with each dirty grime cell's
 * pattern over it, as the shader draws it.
 */
export function groundTile(
  level: Level,
  tables: GroundFrameTables,
  atlas: RgbaImage,
  cx: number,
  cy: number,
  mask: Uint8Array,
  maskW: number,
): Uint8Array | null {
  const { base, overlays } = cellGroundFrames(level, tables, cx, cy);
  if (base === null) return null;
  const out = cleanTile(atlas, base, overlays);
  const code = cellGrimeCode(level, tables, cx, cy);
  if (code === GRIME_NONE) return out;
  for (let y = 0; y < TILE_PX; y++) {
    for (let x = 0; x < TILE_PX; x++) {
      const tx = cx * TILE_PX + x;
      const ty = cy * TILE_PX + y;
      const m = mask[Math.floor(ty / GRIME_CELL_PX) * maskW + Math.floor(tx / GRIME_CELL_PX)] ?? 0;
      if (!grimeTexelShows(m, grimeRank(tx, ty))) continue;
      const slot = grimePatternSlot(code, m);
      const r = tables.grime.rects;
      copyPixel(atlas, (r[slot * 4] ?? 0) + x, (r[slot * 4 + 1] ?? 0) + y, out, (y * TILE_PX + x) * 4);
    }
  }
  return out;
}

/** How a frame's ground compares with the reference: per tile and per grime cell. */
export type GroundComparison = {
  /** Tiles wholly on screen, unblocked and with ground, that were compared, and which they were. */
  readonly checkedTiles: number;
  readonly tiles: readonly (readonly [number, number])[];
  /** Grime cells compared, and those whose initial mask value is non-zero (grimy at shift start). */
  readonly checkedCells: number;
  readonly grimyCells: number;
  /** Grimy cells the frame shows clean, as [tx, ty] world grime-cell coordinates. */
  readonly cleanCells: readonly (readonly [number, number])[];
  /** Cells matching neither allowed state (or, with `requireInitial`, not the initial grime). */
  readonly mismatches: readonly string[];
};

/**
 * Compares every 2 m ground tile wholly inside `frame` (camera at (camX, camY) on the 1/16 m grid) and clear of
 * `blocked` against the reference: each 4 px grime cell must show its initial grime (from `initial`) or, unless
 * `requireInitial`, the clean ground. Grime cells overlapping `skipCells` (sprites drawn over the ground, such as
 * itemsCover) are not compared; their tile still is.
 */
export function compareGroundTiles(
  frame: RgbaFrame,
  level: Level,
  atlas: RgbaImage,
  camX: number,
  camY: number,
  blocked: readonly Rect[],
  initial: { mask: Uint8Array; maskW: number },
  requireInitial: boolean,
  skipCells: readonly Rect[] = [],
): GroundComparison {
  const tables = groundFrameTables(level);
  const [cols, rows] = level.size;
  const clean = new Uint8Array(initial.mask.length);
  let checkedTiles = 0;
  const tiles: [number, number][] = [];
  let checkedCells = 0;
  let grimyCells = 0;
  const cleanCells: [number, number][] = [];
  const mismatches: string[] = [];
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const left = frame.width / 2 + (cx * CELL_M - camX) * PX_PER_M;
      const top = INTERNAL_HEIGHT_PX / 2 + (cy * CELL_M - camY) * PX_PER_M;
      if (left < 0 || top < 0 || left + TILE_PX > frame.width || top + TILE_PX > frame.height) continue;
      if (!Number.isInteger(left) || !Number.isInteger(top))
        throw new Error('tile edges must land on whole pixels');
      const cell: Rect = { x0: cx * CELL_M, y0: cy * CELL_M, x1: (cx + 1) * CELL_M, y1: (cy + 1) * CELL_M };
      if (blocked.some((r) => overlaps(cell, r))) continue;
      const dirty = groundTile(level, tables, atlas, cx, cy, initial.mask, initial.maskW);
      const plain = groundTile(level, tables, atlas, cx, cy, clean, initial.maskW);
      if (dirty === null || plain === null) continue;
      checkedTiles++;
      tiles.push([cx, cy]);
      for (let gy = 0; gy < CELLS_PER_TILE; gy++) {
        for (let gx = 0; gx < CELLS_PER_TILE; gx++) {
          let dirtyWrong = 0;
          let cleanWrong = 0;
          for (let y = gy * GRIME_CELL_PX; y < (gy + 1) * GRIME_CELL_PX; y++) {
            for (let x = gx * GRIME_CELL_PX; x < (gx + 1) * GRIME_CELL_PX; x++) {
              const got = ((top + y) * frame.width + left + x) * 4;
              const exp = (y * TILE_PX + x) * 4;
              for (let c = 0; c < 4; c++) {
                const v = frame.data[got + c];
                if (v !== dirty[exp + c]) dirtyWrong++;
                if (v !== plain[exp + c]) cleanWrong++;
              }
            }
          }
          const wx = cx * CELLS_PER_TILE + gx;
          const wy = cy * CELLS_PER_TILE + gy;
          const cellRect: Rect = {
            x0: wx * GRIME_CELL_M,
            y0: wy * GRIME_CELL_M,
            x1: (wx + 1) * GRIME_CELL_M,
            y1: (wy + 1) * GRIME_CELL_M,
          };
          if (skipCells.some((rect) => overlaps(cellRect, rect))) continue;
          const grimy = (initial.mask[wy * initial.maskW + wx] ?? 0) !== 0;
          checkedCells++;
          if (grimy) grimyCells++;
          if (dirtyWrong === 0) continue;
          if (!requireInitial && cleanWrong === 0) {
            if (grimy) cleanCells.push([wx, wy]);
            continue;
          }
          mismatches.push(
            `grime cell (${wx}, ${wy}) in tile (${cx}, ${cy}) at px (${left + gx * 4}, ${top + gy * 4}): ` +
              `${dirtyWrong} bytes differ from its grime, ${cleanWrong} from clean`,
          );
        }
      }
    }
  }
  return { checkedTiles, tiles, checkedCells, grimyCells, cleanCells, mismatches };
}
