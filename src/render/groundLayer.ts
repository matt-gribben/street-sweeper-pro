// Ground layer of a compiled level (TECHNICAL_DESIGN §12.4, ART_BIBLE §9.1 "As built", SSP-045). Every open cell
// becomes one ground quad at y = 0 sampling a `world` atlas tile through its FRAME rect, plus one overlay quad per
// road marking. The quads are written in 16×16-tile chunks (the unit of build caching and of CPU-side bounds),
// chunk by chunk into the shared city writer, so the ground ends up in the same single BufferGeometry and draw
// call as the walls and roofs (cityMesh.ts, levelCity.ts).
//
// Which frame a cell draws:
//   - building cells draw no ground: the roof and the visible walls always cover a footprint seen from above;
//   - `haz.speed_bump` and zebra sites draw their tile across the merged site rect: `v:0` when the rect is at
//     least as wide as it is deep (a north–south road), `v:1` otherwise; `site.school_crossing` falls back to
//     `tile.zebra` until its zig-zags (M4). Other sites (bus stop, depot bay, skip) draw the cell's ground;
//   - a kerb blob index 0..46 draws `tile.kerb:blob:-:n` (the tile carries its pavement interior);
//   - otherwise the ground id's tile family (GROUND_TILE_ASSET), variant chosen by a deterministic hash of the
//     cell (cityMesh.ts cellVariant; the sim RNG is never used, so a cell always draws the same variant).
// Markings (TECHNICAL_DESIGN §15.2 MARKING, the SSP-034 representation) are transparent overlay tiles stacked over
// the ground: CENTRE_NS / CENTRE_E_EDGE on even rows and CENTRE_EW / CENTRE_S_EDGE on even columns (the
// one-on, one-off dash: a 32 px dash, a 32 px gap), DOUBLE_YELLOW and PARKING_BAY once per KERB_EDGE side of the
// cell's `collide` value.
//
// Beyond the map the ground continues as an asphalt skirt (`tile.asphalt:v:-:0` repeated) so a camera at the map
// edge never shows the clear colour. The camera is not clamped to the map (SSP-047): its focus stays within the
// 3.0 m look-ahead of Bessie, who stays in the map, and the skirt reaches far past the widest view.
//
// Render-only: reads the decoded Level and never writes it.
import type { FrameId } from '../gen/assets.ts';
import { AUTOTILE_NONE, COLLIDE, GROUND_COUNT, Ground, type Level, MARKING } from '../sim/map.ts';
import {
  CELL_M,
  type CityGeometryWriter,
  cellVariant,
  GROUND_SKIRT_M,
  SurfaceKind,
  VariantSalt,
} from './cityMesh.ts';
import { frameRect, worldFrame, worldFrameVariants } from './worldFrames.ts';

/** Edge of a ground chunk in tiles (TECHNICAL_DESIGN §12.4). */
export const GROUND_CHUNK_TILES = 16;

/**
 * Ground id → tile family (ART_BIBLE §9.1 "Ground → tile"). Cobbles → setts and yard → apron are the M1
 * fallbacks until their M4 tiles exist; void, water and sand have no M1 tile (null) and fail the build if an
 * open cell uses them.
 */
export const GROUND_TILE_ASSET: readonly (string | null)[] = [
  null, // Void
  'tile.asphalt', // Road
  'tile.asphalt', // RoadOneWayE
  'tile.asphalt', // RoadOneWayW
  'tile.asphalt', // RoadOneWayN
  'tile.asphalt', // RoadOneWayS
  'tile.pavement', // Pavement
  'tile.setts', // Cobbles (fallback until SSP-121)
  'tile.setts', // Alley
  'tile.grass', // Grass
  'tile.apron', // Yard (fallback until SSP-121)
  'tile.apron', // Apron
  null, // Water
  null, // Sand
];

/** The kerb blob tile family: autotile index n is frame `tile.kerb:blob:-:n` (SSP-040). */
export const KERB_ASSET = 'tile.kerb';

/** The marking overlay families (transparent except for their lines). */
export const MARKING_ASSET = {
  lane: 'tile.lane_marking',
  doubleYellow: 'tile.double_yellow',
  parkingBay: 'tile.parking_bay',
} as const;

/** Sites drawn as ground tiles, with the tile family they draw. Other sites draw the cell's ground. */
export const SITE_TILE_ASSET: Readonly<Record<string, string>> = {
  'haz.speed_bump': 'haz.speed_bump',
  'site.zebra': 'tile.zebra',
  'site.school_crossing': 'tile.zebra',
};

/** `tile.lane_marking` variants by centre-line bit (ART_BIBLE §9.1). */
const LANE_VARIANT = [
  [MARKING.CENTRE_NS, 0],
  [MARKING.CENTRE_EW, 1],
  [MARKING.CENTRE_E_EDGE, 2],
  [MARKING.CENTRE_S_EDGE, 3],
] as const;

/** Kerb sides in the variant order of the double-yellow and parking-bay tiles: v0 N, v1 E, v2 S, v3 W. */
const KERB_SIDES = [
  COLLIDE.KERB_EDGE_N,
  COLLIDE.KERB_EDGE_E,
  COLLIDE.KERB_EDGE_S,
  COLLIDE.KERB_EDGE_W,
] as const;

/** The base frame and overlay frames of one cell (base null under a building). */
export type CellGroundFrames = {
  readonly base: FrameId | null;
  readonly overlays: readonly FrameId[];
};

/** A written chunk: its tile range, its metre bounds and the quads it wrote into the city writer. */
export type GroundChunk = {
  readonly cx: number;
  readonly cy: number;
  readonly x0M: number;
  readonly y0M: number;
  readonly x1M: number;
  readonly y1M: number;
  readonly firstQuad: number;
  readonly quadCount: number;
};

/** Per-level frame tables, resolved once before the chunks are written. */
export type GroundFrameTables = {
  /** Variant frames per ground id (empty when the ground has no tile). */
  readonly ground: readonly (readonly FrameId[])[];
  /** Per cell: the site frame drawn there, or null. */
  readonly sites: readonly (FrameId | null)[];
};

/** Variant of a speed bump or zebra drawn over `rect`: 0 when at least as wide as deep (a north–south road). */
export function siteVariant(rect: readonly [number, number, number, number]): 0 | 1 {
  const [x0, y0, x1, y1] = rect;
  return x1 - x0 >= y1 - y0 ? 0 : 1;
}

/** Resolves the level's ground and site frames; throws on a frame the atlas lacks. */
export function groundFrameTables(level: Level): GroundFrameTables {
  const ground: FrameId[][] = [];
  for (let id = 0; id < GROUND_COUNT; id++) {
    const asset = GROUND_TILE_ASSET[id] ?? null;
    ground.push(asset === null ? [] : worldFrameVariants(asset, 'v'));
  }
  const [w, h] = level.size;
  const sites: (FrameId | null)[] = new Array<FrameId | null>(w * h).fill(null);
  for (const site of level.sites) {
    const asset = SITE_TILE_ASSET[site.id];
    if (asset === undefined) continue;
    const frame = worldFrame(asset, 'v', siteVariant(site.rect));
    const [x0, y0, x1, y1] = site.rect;
    for (let y = Math.max(0, y0); y < Math.min(h, y1); y++) {
      for (let x = Math.max(0, x0); x < Math.min(w, x1); x++) sites[y * w + x] = frame;
    }
  }
  return { ground, sites };
}

/** The frames cell (x, y) draws: its ground (or site or kerb) tile and its marking overlays. */
export function cellGroundFrames(
  level: Level,
  tables: GroundFrameTables,
  x: number,
  y: number,
): CellGroundFrames {
  const [w] = level.size;
  const i = y * w + x;
  const layers = level.layers;
  if ((layers.storeys[i] ?? 0) > 0) return { base: null, overlays: [] };
  let base = tables.sites[i] ?? null;
  const autotile = layers.autotile[i] ?? AUTOTILE_NONE;
  if (base === null && autotile !== AUTOTILE_NONE) base = worldFrame(KERB_ASSET, 'blob', autotile);
  if (base === null) {
    const groundId = layers.ground[i] ?? Ground.Void;
    const variants = tables.ground[groundId] ?? [];
    if (variants.length === 0)
      throw new Error(`ground id ${groundId} at tile (${x}, ${y}) has no tile frame`);
    base = variants[cellVariant(x, y, variants.length, VariantSalt.Ground)] ?? null;
    if (base === null) throw new Error('ground variant out of range');
  }

  const overlays: FrameId[] = [];
  const markings = layers.markings[i] ?? 0;
  const collide = layers.collide[i] ?? 0;
  for (const [bit, variant] of LANE_VARIANT) {
    if ((markings & bit) === 0) continue;
    // Lines running north–south dash on even rows, lines running east–west on even columns.
    const alongY = bit === MARKING.CENTRE_NS || bit === MARKING.CENTRE_E_EDGE;
    if ((alongY ? y : x) % 2 === 0) overlays.push(worldFrame(MARKING_ASSET.lane, 'v', variant));
  }
  for (const [bit, asset] of [
    [MARKING.DOUBLE_YELLOW, MARKING_ASSET.doubleYellow],
    [MARKING.PARKING_BAY, MARKING_ASSET.parkingBay],
  ] as const) {
    if ((markings & bit) === 0) continue;
    KERB_SIDES.forEach((side, variant) => {
      if ((collide & side) !== 0) overlays.push(worldFrame(asset, 'v', variant));
    });
  }
  return { base, overlays };
}

/** Writes the ground of chunk (cx, cy) into `writer`: per cell, its ground quad and then its overlays. */
export function writeGroundChunk(
  level: Level,
  tables: GroundFrameTables,
  cx: number,
  cy: number,
  writer: CityGeometryWriter,
): GroundChunk {
  const [w, h] = level.size;
  const tx0 = cx * GROUND_CHUNK_TILES;
  const ty0 = cy * GROUND_CHUNK_TILES;
  const tx1 = Math.min(w, tx0 + GROUND_CHUNK_TILES);
  const ty1 = Math.min(h, ty0 + GROUND_CHUNK_TILES);
  const firstQuad = writer.quadCount;
  for (let y = ty0; y < ty1; y++) {
    for (let x = tx0; x < tx1; x++) {
      const { base, overlays } = cellGroundFrames(level, tables, x, y);
      if (base === null) continue;
      const x0 = x * CELL_M;
      const y0 = y * CELL_M;
      writer.groundQuad(x0, y0, x0 + CELL_M, y0 + CELL_M, SurfaceKind.Ground, frameRect(base));
      for (const overlay of overlays) {
        writer.groundQuad(x0, y0, x0 + CELL_M, y0 + CELL_M, SurfaceKind.Overlay, frameRect(overlay));
      }
    }
  }
  return {
    cx,
    cy,
    x0M: tx0 * CELL_M,
    y0M: ty0 * CELL_M,
    x1M: tx1 * CELL_M,
    y1M: ty1 * CELL_M,
    firstQuad,
    quadCount: writer.quadCount - firstQuad,
  };
}

/**
 * Writes the whole ground layer: every chunk, row-major, then the asphalt skirt around the map. Returns the
 * chunks (the skirt belongs to none).
 */
export function writeGroundLayer(
  level: Level,
  writer: CityGeometryWriter,
  skirtM: number = GROUND_SKIRT_M,
): GroundChunk[] {
  const tables = groundFrameTables(level);
  const [w, h] = level.size;
  const chunks: GroundChunk[] = [];
  for (let cy = 0; cy * GROUND_CHUNK_TILES < h; cy++) {
    for (let cx = 0; cx * GROUND_CHUNK_TILES < w; cx++)
      chunks.push(writeGroundChunk(level, tables, cx, cy, writer));
  }
  const skirt = tables.ground[Ground.Road]?.[0];
  if (skirt === undefined) throw new Error('no road tile for the ground skirt');
  writer.skirt(0, 0, w * CELL_M, h * CELL_M, skirtM, frameRect(skirt));
  return chunks;
}
