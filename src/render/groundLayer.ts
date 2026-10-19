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
// Grime (SSP-066, TECHNICAL_DESIGN §10.3, §12.4, ART_BIBLE §9.2). Every ground and marking quad of a cell carries
// the cell's grime code (cityMesh.ts grimeCode): which pattern its dirty grime cells draw. Roads (one-way roads,
// speed bumps and zebras over them included) draw `tile.grime_asphalt`; pavements, kerb blobs (their interior is
// pavement), cobbles and alleys (setts) draw `tile.grime_slab`; a cell with the gutter bit draws
// `tile.grime_gutter` whatever its surface. Grass, yards, aprons and anything off route draw none (code 0), so
// they never show grime even if a mask had some. The pattern variant is the stateless cell hash
// (`VariantSalt.Grime`) modulo the family's frame count.
//
// GroundGrime owns the grime mask texture: an R8 DataTexture of (tilesW·8)×(tilesH·8) texels whose data IS the
// sim's mask array (read, never written), NearestFilter, no mipmaps. The first render uploads it whole
// (needsUpdate once, at creation). After that, accumulate() merges each tick's dirty rectangle (dirt.ts) into a
// pending union, and upload(), once per rendered frame, sends exactly that union with one texSubImage2D through
// WebGLRenderer.copyTextureToTexture: its CPU path reads from a DataTexture that has never been bound (the
// `source` wrapper of the same array), sets UNPACK_ROW_LENGTH / SKIP_PIXELS / SKIP_ROWS and uploads the
// sub-rectangle. (Texture.addUpdateRange cannot express it: three 0.186.1 uploads ranges as one-row strips,
// assumes 4 bytes per texel and allocates a range object per call.) Nothing per frame sets needsUpdate or
// creates a three.js object.
//
// Beyond the map the ground continues as an asphalt skirt (`tile.asphalt:v:-:0` repeated) so a camera at the map
// edge never shows the clear colour. The camera is not clamped to the map (SSP-047): its focus stays within the
// 3.0 m look-ahead of Bessie, who stays in the map, and the skirt reaches far past the widest view.
//
// Render-only: reads the decoded Level and the sim's grime mask and never writes either.
import { Box2, DataTexture, RedFormat, type Texture, UnsignedByteType, Vector2 } from 'three';
import type { FrameId } from '../gen/assets.ts';
import type { DirtView } from '../sim/dirt.ts';
import { AUTOTILE_NONE, COLLIDE, GROUND_COUNT, Ground, type Level, MARKING } from '../sim/map.ts';
import {
  CELL_M,
  type CityGeometryWriter,
  type CityGrime,
  cellVariant,
  GRIME_FAMILY_SLOTS,
  GRIME_NONE,
  GRIME_SLOT_COUNT,
  GROUND_SKIRT_M,
  GrimeFamily,
  grimeCode,
  SurfaceKind,
  VariantSalt,
} from './cityMesh.ts';
import { nearestDataTexture } from './palettePass.ts';
import { frameRect, worldFrame, worldFrameVariants } from './worldFrames.ts';

/** Edge of a ground chunk in tiles (TECHNICAL_DESIGN §12.4). */
export const GROUND_CHUNK_TILES = 16;

/**
 * Ground id → tile family (ART_BIBLE §9.1 "Ground → tile"). Cobbles have their own placeholder tile since
 * SSP-101; yard → apron is the M1 fallback until its M4 tile exists (SSP-121); void, water and sand have no M1 tile (null) and fail the build if an
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
  'tile.cobbles', // Cobbles (SSP-101 placeholder)
  'tile.setts', // Alley
  'tile.grass', // Grass
  'tile.apron', // Yard (fallback until SSP-121)
  'tile.apron', // Apron
  null, // Water
  null, // Sand
];

/** The grime overlay pattern assets by family (ART_BIBLE §9.2, SSP-052). */
export const GRIME_ASSET: Readonly<Record<GrimeFamily, string>> = {
  [GrimeFamily.Asphalt]: 'tile.grime_asphalt',
  [GrimeFamily.Slab]: 'tile.grime_slab',
  [GrimeFamily.Gutter]: 'tile.grime_gutter',
};

/**
 * Ground id → the grime pattern family its non-gutter cells draw (SSP-066), or null for no grime. Kerb blob
 * cells are pavement, so they draw slab.
 */
export const GROUND_GRIME_FAMILY: readonly (GrimeFamily | null)[] = [
  null, // Void
  GrimeFamily.Asphalt, // Road
  GrimeFamily.Asphalt, // RoadOneWayE
  GrimeFamily.Asphalt, // RoadOneWayW
  GrimeFamily.Asphalt, // RoadOneWayN
  GrimeFamily.Asphalt, // RoadOneWayS
  GrimeFamily.Slab, // Pavement
  GrimeFamily.Slab, // Cobbles
  GrimeFamily.Slab, // Alley (setts)
  null, // Grass
  null, // Yard
  null, // Apron
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

/** The grime pattern frames: per family its variants (at most GRIME_FAMILY_SLOTS), and the shader's rect table. */
export type GrimePatterns = {
  /** Variant frames per GrimeFamily. */
  readonly frames: readonly (readonly FrameId[])[];
  /** GRIME_SLOT_COUNT × (x, y, w, h): slot f × 4 + v is family f's variant v (unused slots repeat variant 0). */
  readonly rects: Int32Array;
};

/** Per-level frame tables, resolved once before the chunks are written. */
export type GroundFrameTables = {
  /** Variant frames per ground id (empty when the ground has no tile). */
  readonly ground: readonly (readonly FrameId[])[];
  /** Per cell: the site frame drawn there, or null. */
  readonly sites: readonly (FrameId | null)[];
  /** The grime pattern frames and rect table (SSP-066). */
  readonly grime: GrimePatterns;
};

/** Resolves the grime pattern frames of the `world` atlas; throws on a missing frame or too many variants. */
export function grimePatterns(): GrimePatterns {
  const frames: FrameId[][] = [];
  const rects = new Int32Array(GRIME_SLOT_COUNT * 4);
  for (const family of [GrimeFamily.Asphalt, GrimeFamily.Slab, GrimeFamily.Gutter]) {
    const variants = worldFrameVariants(GRIME_ASSET[family], 'v');
    if (variants.length > GRIME_FAMILY_SLOTS) {
      throw new Error(
        `${GRIME_ASSET[family]} has ${variants.length} variants; the shader takes ${GRIME_FAMILY_SLOTS}`,
      );
    }
    frames.push(variants);
    for (let v = 0; v < GRIME_FAMILY_SLOTS; v++) {
      const frame = variants[v] ?? variants[0];
      if (frame === undefined) throw new Error(`${GRIME_ASSET[family]} has no variants`);
      const r = frameRect(frame);
      rects.set([r.x, r.y, r.w, r.h], (family * GRIME_FAMILY_SLOTS + v) * 4);
    }
  }
  return { frames, rects };
}

/** The pattern slot of family `family`'s variant for cell (x, y): the cell hash modulo the variant count. */
export function grimeSlot(patterns: GrimePatterns, family: GrimeFamily, x: number, y: number): number {
  const count = patterns.frames[family]?.length ?? 0;
  return family * GRIME_FAMILY_SLOTS + cellVariant(x, y, count, VariantSalt.Grime);
}

/** The grime code of cell (x, y)'s ground and marking quads (GRIME_NONE where grime never shows). */
export function cellGrimeCode(level: Level, tables: GroundFrameTables, x: number, y: number): number {
  const [w, h] = level.size;
  if (x < 0 || y < 0 || x >= w || y >= h) return GRIME_NONE;
  const i = y * w + x;
  if ((level.layers.storeys[i] ?? 0) > 0) return GRIME_NONE;
  const family = GROUND_GRIME_FAMILY[level.layers.ground[i] ?? Ground.Void] ?? null;
  if (family === null) return GRIME_NONE;
  return grimeCode(grimeSlot(tables.grime, family, x, y), grimeSlot(tables.grime, GrimeFamily.Gutter, x, y));
}

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
  return { ground, sites, grime: grimePatterns() };
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
      const grime = cellGrimeCode(level, tables, x, y);
      const x0 = x * CELL_M;
      const y0 = y * CELL_M;
      writer.groundQuad(x0, y0, x0 + CELL_M, y0 + CELL_M, SurfaceKind.Ground, frameRect(base), grime);
      for (const overlay of overlays) {
        writer.groundQuad(x0, y0, x0 + CELL_M, y0 + CELL_M, SurfaceKind.Overlay, frameRect(overlay), grime);
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

// ---------------------------------------------------------------------------------------------------------
// The grime mask texture and its incremental upload (SSP-066).

/** A rectangle of grime cells, inclusive; empty when maxX < minX. Mutated in place, never reallocated. */
export type DirtyRect = { minX: number; minY: number; maxX: number; maxY: number };

/** An empty dirty rectangle. */
export function createDirtyRect(): DirtyRect {
  return { minX: 0, minY: 0, maxX: -1, maxY: -1 };
}

/** True when `rect` covers no cell. */
export function isDirtyRectEmpty(rect: Readonly<DirtyRect>): boolean {
  return rect.maxX < rect.minX || rect.maxY < rect.minY;
}

/** Empties `rect`. */
export function clearDirtyRect(rect: DirtyRect): void {
  rect.minX = 0;
  rect.minY = 0;
  rect.maxX = -1;
  rect.maxY = -1;
}

/**
 * Grows `rect` to the union (bounding box) of itself and the inclusive cell rectangle minX..maxX × minY..maxY.
 * An empty input (max < min, as dirt.ts reports a tick that changed nothing) leaves `rect` unchanged.
 */
export function mergeDirtyRect(
  rect: DirtyRect,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): void {
  if (maxX < minX || maxY < minY) return;
  if (isDirtyRectEmpty(rect)) {
    rect.minX = minX;
    rect.minY = minY;
    rect.maxX = maxX;
    rect.maxY = maxY;
    return;
  }
  if (minX < rect.minX) rect.minX = minX;
  if (minY < rect.minY) rect.minY = minY;
  if (maxX > rect.maxX) rect.maxX = maxX;
  if (maxY > rect.maxY) rect.maxY = maxY;
}

/**
 * The part of WebGLRenderer that GroundGrime.upload uses (structural, so unit tests can record the calls):
 * `copyTextureToTexture(src, dst, srcRegion, dstPosition)` with a never-bound DataTexture as `src` uploads
 * srcRegion of its data (min inclusive, max exclusive) into `dst` at dstPosition with one texSubImage2D.
 */
export type TextureRegionUploader = {
  copyTextureToTexture(src: Texture, dst: Texture, srcRegion: Box2 | null, dstPosition: Vector2 | null): void;
};

/** The grime mask on the GPU: the texture the city material samples, kept in step with the sim's mask. */
export class GroundGrime {
  /** The R8 mask texture bound to the city material (uGrime). Its data is the sim's mask array. */
  readonly texture: DataTexture;
  /** A wrapper of the same array that is never bound: copyTextureToTexture's CPU source for sub-rect uploads. */
  readonly source: DataTexture;
  readonly widthCells: number;
  readonly heightCells: number;
  /** The union of the dirty rectangles of the ticks since the last upload. */
  readonly pending: DirtyRect = createDirtyRect();
  /** Sub-rectangle uploads so far, and the bytes (grime cells) the last upload() sent. */
  uploads = 0;
  lastUploadBytes = 0;
  private readonly region = new Box2();
  private readonly origin = new Vector2();

  constructor(dirt: DirtView) {
    const { maskW, maskH } = dirt;
    const mask = dirt.mask;
    if (!(mask instanceof Uint8Array) || mask.length !== maskW * maskH) {
      throw new Error(`GroundGrime: the mask must be a ${maskW}×${maskH} Uint8Array`);
    }
    this.widthCells = maskW;
    this.heightCells = maskH;
    // The whole mask goes up on the first render (needsUpdate, set once here by nearestDataTexture).
    this.texture = nearestDataTexture(new DataTexture(mask, maskW, maskH, RedFormat, UnsignedByteType));
    this.texture.name = 'grimeMask';
    this.source = new DataTexture(mask, maskW, maskH, RedFormat, UnsignedByteType);
    this.source.name = 'grimeMaskSource';
  }

  /** The city material's grime binding: this texture, its size and the pattern rects. */
  binding(patterns: GrimePatterns): CityGrime {
    return {
      texture: this.texture,
      widthCells: this.widthCells,
      heightCells: this.heightCells,
      rects: patterns.rects,
    };
  }

  /** After every tick: merge that tick's dirty rectangle (dirt.ts) into the pending union. */
  accumulate(dirt: DirtView): void {
    mergeDirtyRect(this.pending, dirt.dirtyMinX, dirt.dirtyMinY, dirt.dirtyMaxX, dirt.dirtyMaxY);
  }

  /**
   * Once per rendered frame, before the frame draws: upload the pending union (one texSubImage2D) and empty it.
   * Returns the bytes uploaded (0 when no tick changed the mask).
   */
  upload(renderer: TextureRegionUploader): number {
    const p = this.pending;
    const minX = Math.max(0, p.minX);
    const minY = Math.max(0, p.minY);
    const maxX = Math.min(this.widthCells - 1, p.maxX);
    const maxY = Math.min(this.heightCells - 1, p.maxY);
    clearDirtyRect(p);
    this.lastUploadBytes = 0;
    if (maxX < minX || maxY < minY) return 0;
    this.region.min.set(minX, minY);
    this.region.max.set(maxX + 1, maxY + 1);
    this.origin.set(minX, minY);
    renderer.copyTextureToTexture(this.source, this.texture, this.region, this.origin);
    this.uploads += 1;
    this.lastUploadBytes = (maxX - minX + 1) * (maxY - minY + 1);
    return this.lastUploadBytes;
  }

  /** Releases the GPU texture (the mask array belongs to the sim). */
  dispose(): void {
    this.texture.dispose();
    this.source.dispose();
  }
}
