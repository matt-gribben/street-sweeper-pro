// The M0 test-scene city (SSP-017, SSP-021; moved here from cityMesh.ts in SSP-045). The spike scenes
// (lean_quadrants / scale_1440, scale_sheet and the default spike city) describe their blocks as small ASCII cell
// grids and draw them through the shared city renderer (cityMesh.ts) with this code-defined placeholder atlas
// instead of the `world` atlas, so their visual goldens and the M0 spike decisions made on them stay valid while
// compiled levels render real tiles and facades (levelCity.ts).
//
// Textures are built from Kerbside-32 indices (CLAUDE.md hard rule 3: no colour value is spelled here): a brick
// module with a stone string course and one bold window per storey, a slate roof (the parapet line comes from
// cityMesh: 06 kerb on the NW edges, the roof's dark step 01 tar on the SE edges), and flat 02 asphalt / 05 slab
// ground, plus flat 06 kerb and 22 grass swatches (SSP-021: the shadow and night tuning needs building and drop
// shadows over every ground tile type). This is deliberately not a facade system.
import { DataTexture, type Mesh, RedFormat, UnsignedByteType } from 'three';
import {
  type AtlasRect,
  CELL_M,
  type CityGeometryData,
  CityGeometryWriter,
  type CityGrid,
  type CityStyles,
  createCityMesh,
  dominantIndex,
  FacadeVariant,
  GROUND_SKIRT_M,
  roofParapetSe,
  STOREY_PX,
  SurfaceKind,
  TILE_PX,
  writeBuildings,
} from './cityMesh.ts';
import { KERBSIDE32, type Kerbside32, nearestDataTexture, paletteIndex } from './palettePass.ts';

/** Facade module size in texels: 2 m wide × 1 storey. */
export const FACADE_MODULE_W_PX = TILE_PX;
export const FACADE_MODULE_H_PX = STOREY_PX;

/** Ground type of a cell without a building (placeholder ground, M0). */
export const GroundType = { Asphalt: 0, Slab: 1, Kerb: 2, Grass: 3 } as const;
export type GroundType = (typeof GroundType)[keyof typeof GroundType];

/** A placeholder cell grid: buildings (every building cell names style 1) plus a ground type per cell. */
export type PlaceholderGrid = CityGrid & {
  /** Ground type per cell (ignored under buildings). */
  readonly ground: Uint8Array;
};

/** Columns of the placeholder atlas, each TILE_PX wide. */
export const PlaceholderTile = {
  FacadeLit: 0,
  FacadeBase: 1,
  FacadeDark: 2,
  RoofSlate: 3,
  GroundAsphalt: 4,
  GroundSlab: 5,
  GroundKerb: 6,
  GroundGrass: 7,
} as const;
export type PlaceholderTile = (typeof PlaceholderTile)[keyof typeof PlaceholderTile];

const ATLAS_TILE_COUNT = 8;
export const PLACEHOLDER_ATLAS_WIDTH_PX = ATLAS_TILE_COUNT * TILE_PX;
/** Two storeys: a facade bay is one module wide and holds the module in both its upper and ground storey. */
export const PLACEHOLDER_ATLAS_HEIGHT_PX = 2 * FACADE_MODULE_H_PX;

/** The frame rect of a placeholder atlas column: facades are a 32×80 bay, roof and ground tiles 32×32. */
export function placeholderRect(tile: PlaceholderTile): AtlasRect {
  const facade = tile <= PlaceholderTile.FacadeDark;
  return { x: tile * TILE_PX, y: 0, w: TILE_PX, h: facade ? PLACEHOLDER_ATLAS_HEIGHT_PX : TILE_PX };
}

/**
 * ASCII cell codes for {@link parseCityGrid}: `.` asphalt, `:` slab pavement, `k` kerb stone, `,` grass (as in
 * LEVEL_DESIGN maps), `1`–`8` a building of that many storeys.
 */
export const CITY_CELL_ASPHALT = '.';
export const CITY_CELL_SLAB = ':';
export const CITY_CELL_KERB = 'k';
export const CITY_CELL_GRASS = ',';
const MAX_STOREYS = 8;

/** Parses an ASCII cell grid (one character per 2 m cell, row 0 north) placed with its NW corner at the origin. */
export function parseCityGrid(lines: readonly string[], originXM: number, originYM: number): PlaceholderGrid {
  const rows = lines.length;
  const cols = lines[0]?.length ?? 0;
  if (rows === 0 || cols === 0) throw new Error('city grid must have at least one cell');
  const storeys = new Uint8Array(cols * rows);
  const ground = new Uint8Array(cols * rows);
  lines.forEach((line, r) => {
    if (line.length !== cols)
      throw new Error(`city grid row ${r} has ${line.length} cells, expected ${cols}`);
    for (let c = 0; c < cols; c++) {
      const ch = line[c] ?? '';
      const i = r * cols + c;
      if (ch === CITY_CELL_ASPHALT) {
        ground[i] = GroundType.Asphalt;
      } else if (ch === CITY_CELL_SLAB) {
        ground[i] = GroundType.Slab;
      } else if (ch === CITY_CELL_KERB) {
        ground[i] = GroundType.Kerb;
      } else if (ch === CITY_CELL_GRASS) {
        ground[i] = GroundType.Grass;
      } else if (ch >= '1' && ch <= String(MAX_STOREYS)) {
        storeys[i] = Number(ch);
        ground[i] = GroundType.Slab;
      } else {
        throw new Error(`city grid row ${r} col ${c}: unknown cell '${ch}'`);
      }
    }
  });
  // Every building cell uses the one placeholder facade and roof (style value 1).
  const style = storeys.map((s) => (s > 0 ? 1 : 0));
  return { cols, rows, originXM, originYM, storeys, ground, wall: style, roof: style.slice() };
}

/** Placeholder atlas column of an open cell's ground type. */
export function groundTile(type: number): PlaceholderTile {
  switch (type) {
    case GroundType.Slab:
      return PlaceholderTile.GroundSlab;
    case GroundType.Kerb:
      return PlaceholderTile.GroundKerb;
    case GroundType.Grass:
      return PlaceholderTile.GroundGrass;
    default:
      return PlaceholderTile.GroundAsphalt;
  }
}

// ---------------------------------------------------------------------------------------------------------
// Placeholder textures, as palette indices. Rows are numbered from the top of the tile (row 0 = top of the
// storey for facades, the north edge for roofs and ground).

/** Ramp steps [lit, base, dark] of each placeholder facade element, by Kerbside-32 name. */
export const FACADE_ELEMENT_RAMPS = {
  brick: ['terracotta', 'brick', 'brick_dk'],
  stone: ['kerb', 'slab', 'slab_dk'],
  frame: ['chalk', 'kerb', 'slab'],
  glass: ['navy', 'navy', 'navy'],
} as const;
type FacadeElement = keyof typeof FACADE_ELEMENT_RAMPS;

/** Slate roof (ART_BIBLE §9.5): 02 base with a 03 course line every 4 px. */
export const ROOF_COLOURS = { base: 'asphalt', course: 'asphalt_lt' } as const;
const ROOF_COURSE_SPACING_PX = 4;

/** Flat placeholder ground. */
export const GROUND_COLOURS = { asphalt: 'asphalt', slab: 'slab', kerb: 'kerb', grass: 'grass' } as const;

// Module layout (32×40): a 2 px string course at the floor line of every storey, and one bold window per module
// (ART_BIBLE §9.4: glass block ≥ 8×12 px, light frame, 1 px sill) so storeys read through foreshortening.
const STRING_COURSE_ROWS: readonly [number, number] = [38, 39];
const WINDOW_FRAME = { c0: 10, c1: 21, r0: 8, r1: 29 } as const;
const WINDOW_SILL = { c0: 9, c1: 22, row: 30 } as const;

function facadeElementAt(col: number, row: number): FacadeElement {
  if (row >= STRING_COURSE_ROWS[0] && row <= STRING_COURSE_ROWS[1]) return 'stone';
  if (row === WINDOW_SILL.row && col >= WINDOW_SILL.c0 && col <= WINDOW_SILL.c1) return 'stone';
  const f = WINDOW_FRAME;
  if (col >= f.c0 && col <= f.c1 && row >= f.r0 && row <= f.r1) {
    return col === f.c0 || col === f.c1 || row === f.r0 || row === f.r1 ? 'frame' : 'glass';
  }
  return 'brick';
}

/** One facade module (32×40, row-major from the top) in the given variant, as palette indices. */
export function facadeModuleIndices(variant: FacadeVariant, palette: Kerbside32 = KERBSIDE32): Uint8Array {
  const out = new Uint8Array(FACADE_MODULE_W_PX * FACADE_MODULE_H_PX);
  for (let row = 0; row < FACADE_MODULE_H_PX; row++) {
    for (let col = 0; col < FACADE_MODULE_W_PX; col++) {
      const name = FACADE_ELEMENT_RAMPS[facadeElementAt(col, row)][variant];
      out[row * FACADE_MODULE_W_PX + col] = paletteIndex(name, palette);
    }
  }
  return out;
}

/** The slate roof tile (32×32, row-major from the north edge), as palette indices; parapets are drawn per cell. */
export function roofTileIndices(palette: Kerbside32 = KERBSIDE32): Uint8Array {
  const out = new Uint8Array(TILE_PX * TILE_PX);
  const base = paletteIndex(ROOF_COLOURS.base, palette);
  const course = paletteIndex(ROOF_COLOURS.course, palette);
  for (let row = 0; row < TILE_PX; row++) {
    out.fill(
      row % ROOF_COURSE_SPACING_PX === ROOF_COURSE_SPACING_PX - 1 ? course : base,
      row * TILE_PX,
      (row + 1) * TILE_PX,
    );
  }
  return out;
}

/**
 * The whole placeholder atlas as palette indices, PLACEHOLDER_ATLAS_WIDTH_PX × PLACEHOLDER_ATLAS_HEIGHT_PX, row
 * 0 at the top. Facade columns repeat their module in both storeys of the bay; square tiles occupy rows 0..31 of
 * their column and the rows below repeat the tile (never sampled).
 */
export function buildPlaceholderAtlasIndices(palette: Kerbside32 = KERBSIDE32): Uint8Array {
  const width = PLACEHOLDER_ATLAS_WIDTH_PX;
  const atlas = new Uint8Array(width * PLACEHOLDER_ATLAS_HEIGHT_PX);
  const put = (tile: PlaceholderTile, src: Uint8Array, srcHeight: number): void => {
    for (let row = 0; row < PLACEHOLDER_ATLAS_HEIGHT_PX; row++) {
      const srcRow = row % srcHeight;
      atlas.set(src.subarray(srcRow * TILE_PX, (srcRow + 1) * TILE_PX), row * width + tile * TILE_PX);
    }
  };
  const flat = (name: string): Uint8Array =>
    new Uint8Array(TILE_PX * TILE_PX).fill(paletteIndex(name, palette));
  put(PlaceholderTile.FacadeLit, facadeModuleIndices(FacadeVariant.Lit, palette), FACADE_MODULE_H_PX);
  put(PlaceholderTile.FacadeBase, facadeModuleIndices(FacadeVariant.Base, palette), FACADE_MODULE_H_PX);
  put(PlaceholderTile.FacadeDark, facadeModuleIndices(FacadeVariant.Dark, palette), FACADE_MODULE_H_PX);
  put(PlaceholderTile.RoofSlate, roofTileIndices(palette), TILE_PX);
  put(PlaceholderTile.GroundAsphalt, flat(GROUND_COLOURS.asphalt), TILE_PX);
  put(PlaceholderTile.GroundSlab, flat(GROUND_COLOURS.slab), TILE_PX);
  put(PlaceholderTile.GroundKerb, flat(GROUND_COLOURS.kerb), TILE_PX);
  put(PlaceholderTile.GroundGrass, flat(GROUND_COLOURS.grass), TILE_PX);
  return atlas;
}

/** The placeholder styles: style value 1 is the brick facade bay and the slate roof. */
export function placeholderStyles(palette: Kerbside32 = KERBSIDE32): CityStyles {
  const roof = placeholderRect(PlaceholderTile.RoofSlate);
  const dominant = dominantIndex(buildPlaceholderAtlasIndices(palette), PLACEHOLDER_ATLAS_WIDTH_PX, roof);
  return {
    facades: [
      undefined,
      {
        lit: placeholderRect(PlaceholderTile.FacadeLit),
        base: placeholderRect(PlaceholderTile.FacadeBase),
        dark: placeholderRect(PlaceholderTile.FacadeDark),
      },
    ],
    roofs: [undefined, { variants: [roof], parapetSe: roofParapetSe(dominant, palette) }],
  };
}

/**
 * Builds the placeholder city's geometry: one ground quad per open cell (building footprints get none: the
 * roof and visible walls always cover a footprint seen from above), an asphalt skirt, then walls and roofs.
 * Pure: no WebGL.
 */
export function buildPlaceholderCityData(
  grid: PlaceholderGrid,
  skirtM: number = GROUND_SKIRT_M,
  palette: Kerbside32 = KERBSIDE32,
): CityGeometryData {
  const writer = new CityGeometryWriter();
  const { cols, rows, originXM: ox, originYM: oy } = grid;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if ((grid.storeys[i] ?? 0) > 0) continue;
      const x0 = ox + c * CELL_M;
      const y0 = oy + r * CELL_M;
      const rect = placeholderRect(groundTile(grid.ground[i] ?? GroundType.Asphalt));
      writer.groundQuad(x0, y0, x0 + CELL_M, y0 + CELL_M, SurfaceKind.Ground, rect);
    }
  }
  writer.skirt(
    ox,
    oy,
    ox + cols * CELL_M,
    oy + rows * CELL_M,
    skirtM,
    placeholderRect(PlaceholderTile.GroundAsphalt),
  );
  writeBuildings(grid, placeholderStyles(palette), writer);
  return writer.build();
}

/** Uploads the placeholder atlas as an R8 index texture (texel (x, y) is atlas pixel (x, y), y down). */
export function createPlaceholderAtlasTexture(palette: Kerbside32 = KERBSIDE32): DataTexture {
  return nearestDataTexture(
    new DataTexture(
      buildPlaceholderAtlasIndices(palette),
      PLACEHOLDER_ATLAS_WIDTH_PX,
      PLACEHOLDER_ATLAS_HEIGHT_PX,
      RedFormat,
      UnsignedByteType,
    ),
  );
}

/** The placeholder city as one mesh, one draw call (cityMesh.ts): ground + walls + roofs. */
export function createPlaceholderCityMesh(grid: PlaceholderGrid, palette: Kerbside32 = KERBSIDE32): Mesh {
  return createCityMesh(
    buildPlaceholderCityData(grid, GROUND_SKIRT_M, palette),
    createPlaceholderAtlasTexture(palette),
    palette,
  );
}
