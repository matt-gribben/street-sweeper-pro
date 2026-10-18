// City mesh, M0 spike version (TECHNICAL_DESIGN §12.4, ART_BIBLE §3.1, §4.2, §9.3). A cell grid of 2 m cells
// becomes ONE BufferGeometry (ground + walls + roofs, one draw call, frustumCulled = false):
//   - building cells with equal storeys merge into boxes (greedy rectangles, row-major);
//   - only walls facing lower or open cells are emitted, from the neighbour's height up to the box top; walls
//     toward equal or taller neighbours are never built, and backface culling hides the rest (a straight-down
//     camera sees a wall exactly when it is on the wall's outward side);
//   - UVs are world metres, so the 32×40 px facade module tiles at 2 m × 1 storey (2.5 m) and roofs and ground
//     align to the 32 px tile grid;
//   - roofs are one quad per building cell carrying which of its edges drop to a lower or open neighbour, so the
//     1 px parapet line follows the real roof outline (never the seams between merged boxes);
//   - facade variant by face normal: N and W walls `_lit`, E and S walls `_dark`, roofs `_base`.
// Sim XY maps to render XZ (x east, sim y south = render +z) and buildings extrude along +Y.
//
// Textures are code-defined placeholders built from Kerbside-32 indices (CLAUDE.md hard rule 3: no colour value
// is spelled here): a brick module with a stone string course and one bold window per storey, a slate roof with
// a 1 px parapet line (06 kerb on the NW edges, the roof's dark step 01 tar on the SE edges), and flat 02
// asphalt / 05 slab ground. Real facades are M4, procedural facades and ground tiles M1: this is deliberately
// not a facade system. The full cell merge from compiled levels replaces this file's input in SSP-045.
import {
  BufferAttribute,
  BufferGeometry,
  DataTexture,
  GLSL3,
  Mesh,
  NearestFilter,
  RGBAFormat,
  ShaderMaterial,
  UnsignedByteType,
} from 'three';
import { PX_PER_M } from '../sim/constants.ts';
import { KERBSIDE32, type Kerbside32, paletteIndex } from './palettePass.ts';
import { DEPTH_LAYER_GLSL, DepthLayer, paletteColourVector, WORLD_OUTPUTS_GLSL } from './worldMaterial.ts';

/** Map cell size: 2 m (one 32 px tile). */
export const CELL_M = 2;

/** Stylised storey height: 2.5 m = 40 px of facade (ART_BIBLE §3.1). */
export const STOREY_M = 2.5;

/** Facade module size in texels: 2 m wide × 1 storey. */
export const FACADE_MODULE_W_PX = CELL_M * PX_PER_M;
export const FACADE_MODULE_H_PX = STOREY_M * PX_PER_M;

/** Roof and ground tile size in texels (16 px/m, aligned to the 2 m grid). */
export const TILE_PX = CELL_M * PX_PER_M;

/** Ground beyond the grid: an asphalt skirt this far out on every side, so a panning camera never sees void. */
export const GROUND_SKIRT_M = 512;

/** Ground type of a cell without a building (placeholder ground, M0). */
export const GroundType = { Asphalt: 0, Slab: 1 } as const;
export type GroundType = (typeof GroundType)[keyof typeof GroundType];

/** Outward direction of a surface. Walls are N/E/S/W; roofs and ground face Up. */
export const Face = { N: 0, E: 1, S: 2, W: 3, Up: 4 } as const;
export type Face = (typeof Face)[keyof typeof Face];

/** Facade ramp variant (ART_BIBLE §6.2, §9.4). */
export const FacadeVariant = { Lit: 0, Base: 1, Dark: 2 } as const;
export type FacadeVariant = (typeof FacadeVariant)[keyof typeof FacadeVariant];

/** Tiles of the placeholder atlas, each TILE_PX wide and FACADE_MODULE_H_PX tall (square tiles use the top rows). */
export const AtlasTile = {
  FacadeLit: 0,
  FacadeBase: 1,
  FacadeDark: 2,
  RoofSlate: 3,
  GroundAsphalt: 4,
  GroundSlab: 5,
} as const;
export type AtlasTile = (typeof AtlasTile)[keyof typeof AtlasTile];

const ATLAS_TILE_COUNT = 6;
export const ATLAS_WIDTH_PX = ATLAS_TILE_COUNT * TILE_PX;
export const ATLAS_HEIGHT_PX = FACADE_MODULE_H_PX;

/** A cell grid: row-major, row 0 is the north edge, column 0 the west edge. */
export type CityGrid = {
  readonly cols: number;
  readonly rows: number;
  /** Sim position of the grid's NW corner, in metres. */
  readonly originXM: number;
  readonly originYM: number;
  /** Storeys per cell; 0 means open (no building). */
  readonly storeys: Uint8Array;
  /** Ground type per cell (ignored under buildings). */
  readonly ground: Uint8Array;
};

/** A merged box of equal-storey building cells, in sim metres (x0 < x1 west to east, y0 < y1 north to south). */
export type CityBox = {
  readonly x0M: number;
  readonly y0M: number;
  readonly x1M: number;
  readonly y1M: number;
  readonly storeys: number;
  readonly heightM: number;
};

/** One emitted wall: a vertical quad on a box edge, `face` its outward direction. */
export type CityWall = {
  readonly face: Exclude<Face, typeof Face.Up>;
  /** Wall segment endpoints on the ground plane (sim metres), west→east or north→south. */
  readonly x0M: number;
  readonly y0M: number;
  readonly x1M: number;
  readonly y1M: number;
  /** Bottom edge: the neighbour's height (0 for an open cell). */
  readonly bottomM: number;
  readonly topM: number;
};

/** Roof edge bits: set when the neighbour across that edge is lower or open, so the edge gets a parapet line. */
export const RoofEdge = { N: 1, E: 2, S: 4, W: 8 } as const;
export type RoofEdge = (typeof RoofEdge)[keyof typeof RoofEdge];

/** Geometry buffers before upload, plus per-vertex faces for tests. Non-indexed: 6 vertices per quad. */
export type CityGeometryData = {
  readonly vertexCount: number;
  /** Render-space positions (x, y, z), metres. */
  readonly positions: Float32Array;
  /** World-metre UVs: walls (along-wall, height), roofs and ground (x, z). */
  readonly uvs: Float32Array;
  /** Atlas tile per vertex. */
  readonly tiles: Float32Array;
  /** {@link RoofEdge} bits of the roof cell for roof vertices (parapet lines), 0 elsewhere. */
  readonly roofEdges: Float32Array;
  /** NW corner (x, z) of the roof cell in metres for roof vertices, (0, 0) elsewhere. */
  readonly roofCells: Float32Array;
  /** Outward face per vertex (not uploaded). */
  readonly faces: Uint8Array;
};

/** ASCII cell codes for {@link parseCityGrid}: `.` asphalt, `:` slab pavement, `1`–`8` a building of that many storeys. */
export const CITY_CELL_ASPHALT = '.';
export const CITY_CELL_SLAB = ':';
const MAX_STOREYS = 8;

/** Parses an ASCII cell grid (one character per 2 m cell, row 0 north) placed with its NW corner at the origin. */
export function parseCityGrid(lines: readonly string[], originXM: number, originYM: number): CityGrid {
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
      } else if (ch >= '1' && ch <= String(MAX_STOREYS)) {
        storeys[i] = Number(ch);
        ground[i] = GroundType.Slab;
      } else {
        throw new Error(`city grid row ${r} col ${c}: unknown cell '${ch}'`);
      }
    }
  });
  return { cols, rows, originXM, originYM, storeys, ground };
}

/** Storeys at (col, row); 0 outside the grid (open). */
export function storeysAt(grid: CityGrid, col: number, row: number): number {
  if (col < 0 || row < 0 || col >= grid.cols || row >= grid.rows) return 0;
  return grid.storeys[row * grid.cols + col] ?? 0;
}

/**
 * Merges building cells with equal storeys into boxes: greedy, row-major. Each box grows east as far as the
 * run of equal, unclaimed cells goes, then south while every cell of the next row's span matches.
 */
export function mergeBoxes(grid: CityGrid): CityBox[] {
  const claimed = new Uint8Array(grid.cols * grid.rows);
  const boxes: CityBox[] = [];
  const free = (c: number, r: number, s: number): boolean =>
    storeysAt(grid, c, r) === s && claimed[r * grid.cols + c] === 0;
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      const s = storeysAt(grid, c, r);
      if (s === 0 || claimed[r * grid.cols + c] !== 0) continue;
      let w = 1;
      while (c + w < grid.cols && free(c + w, r, s)) w++;
      let h = 1;
      for (; r + h < grid.rows; h++) {
        let rowFree = true;
        for (let k = 0; k < w && rowFree; k++) rowFree = free(c + k, r + h, s);
        if (!rowFree) break;
      }
      for (let rr = r; rr < r + h; rr++) claimed.fill(1, rr * grid.cols + c, rr * grid.cols + c + w);
      boxes.push({
        x0M: grid.originXM + c * CELL_M,
        y0M: grid.originYM + r * CELL_M,
        x1M: grid.originXM + (c + w) * CELL_M,
        y1M: grid.originYM + (r + h) * CELL_M,
        storeys: s,
        heightM: s * STOREY_M,
      });
    }
  }
  return boxes;
}

/**
 * Walls of one box: along each edge, consecutive cells whose outside neighbour is lower (or open) with the same
 * neighbour height merge into one wall from that height up to the box top.
 */
function boxWalls(grid: CityGrid, box: CityBox, out: CityWall[]): void {
  const c0 = Math.round((box.x0M - grid.originXM) / CELL_M);
  const r0 = Math.round((box.y0M - grid.originYM) / CELL_M);
  const c1 = Math.round((box.x1M - grid.originXM) / CELL_M);
  const r1 = Math.round((box.y1M - grid.originYM) / CELL_M);
  const s = box.storeys;
  // [face, horizontal edge?, fixed coordinate (cell index of the neighbour line), span start, span end]
  const edges = [
    [Face.N, true, r0 - 1, c0, c1],
    [Face.S, true, r1, c0, c1],
    [Face.W, false, c0 - 1, r0, r1],
    [Face.E, false, c1, r0, r1],
  ] as const;
  for (const [face, horizontal, fixed, start, end] of edges) {
    let runStart = start;
    let runNeighbour = -1;
    const flush = (runEnd: number): void => {
      if (runNeighbour < 0 || runNeighbour >= s) return;
      const a = runStart * CELL_M;
      const b = runEnd * CELL_M;
      // The wall line is the box edge: N at y0, S at y1, W at x0, E at x1.
      const lineX = face === Face.W ? box.x0M : box.x1M;
      const lineY = face === Face.N ? box.y0M : box.y1M;
      out.push({
        face,
        x0M: horizontal ? grid.originXM + a : lineX,
        y0M: horizontal ? lineY : grid.originYM + a,
        x1M: horizontal ? grid.originXM + b : lineX,
        y1M: horizontal ? lineY : grid.originYM + b,
        bottomM: runNeighbour * STOREY_M,
        topM: box.heightM,
      });
    };
    for (let k = start; k < end; k++) {
      const n = horizontal ? storeysAt(grid, k, fixed) : storeysAt(grid, fixed, k);
      if (n !== runNeighbour) {
        flush(k);
        runStart = k;
        runNeighbour = n;
      }
    }
    flush(end);
  }
}

/** Every wall of the merged city: only walls facing lower or open cells. */
export function emitWalls(grid: CityGrid, boxes: readonly CityBox[] = mergeBoxes(grid)): CityWall[] {
  const walls: CityWall[] = [];
  for (const box of boxes) boxWalls(grid, box, walls);
  return walls;
}

/** {@link RoofEdge} bits of the building cell at (col, row): the edges whose neighbour has fewer storeys. */
export function roofEdges(grid: CityGrid, col: number, row: number): number {
  const s = storeysAt(grid, col, row);
  if (s === 0) return 0;
  let bits = 0;
  if (storeysAt(grid, col, row - 1) < s) bits |= RoofEdge.N;
  if (storeysAt(grid, col + 1, row) < s) bits |= RoofEdge.E;
  if (storeysAt(grid, col, row + 1) < s) bits |= RoofEdge.S;
  if (storeysAt(grid, col - 1, row) < s) bits |= RoofEdge.W;
  return bits;
}

/** Facade variant for a surface facing `face`: N/W lit, E/S dark, roofs (Up) base. */
export function facadeVariant(face: Face): FacadeVariant {
  switch (face) {
    case Face.N:
    case Face.W:
      return FacadeVariant.Lit;
    case Face.E:
    case Face.S:
      return FacadeVariant.Dark;
    default:
      return FacadeVariant.Base;
  }
}

/** Atlas tile of a wall facing `face`. */
export function wallTile(face: Exclude<Face, typeof Face.Up>): AtlasTile {
  const variant = facadeVariant(face);
  if (variant === FacadeVariant.Lit) return AtlasTile.FacadeLit;
  return variant === FacadeVariant.Dark ? AtlasTile.FacadeDark : AtlasTile.FacadeBase;
}

/** Render-space outward unit normal (x, y, z) of a face. */
export function faceNormal(face: Face): readonly [number, number, number] {
  switch (face) {
    case Face.N:
      return [0, 0, -1];
    case Face.E:
      return [1, 0, 0];
    case Face.S:
      return [0, 0, 1];
    case Face.W:
      return [-1, 0, 0];
    default:
      return [0, 1, 0];
  }
}

type Vertex = readonly [x: number, y: number, z: number, u: number, v: number];

/** Growable vertex writer for the city geometry. */
class CityGeometryWriter {
  private positions: number[] = [];
  private uvs: number[] = [];
  private tiles: number[] = [];
  private roofEdges: number[] = [];
  private roofCells: number[] = [];
  private faces: number[] = [];

  /**
   * One quad as two triangles. `corners` go round the quad's perimeter; the triangle order is flipped if
   * needed so the winding faces `face` (counter-clockwise seen from outside, which backface culling keeps).
   */
  quad(
    corners: readonly [Vertex, Vertex, Vertex, Vertex],
    face: Face,
    tile: AtlasTile,
    roofEdges = 0,
    roofCellXM = 0,
    roofCellZM = 0,
  ): void {
    const [a, b, c] = corners;
    const n = faceNormal(face);
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]] as const;
    const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]] as const;
    const cross = [
      e1[1] * e2[2] - e1[2] * e2[1],
      e1[2] * e2[0] - e1[0] * e2[2],
      e1[0] * e2[1] - e1[1] * e2[0],
    ];
    const dot = (cross[0] ?? 0) * n[0] + (cross[1] ?? 0) * n[1] + (cross[2] ?? 0) * n[2];
    const order = dot > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
    for (const k of order) {
      const v = corners[k as 0 | 1 | 2 | 3];
      this.positions.push(v[0], v[1], v[2]);
      this.uvs.push(v[3], v[4]);
      this.tiles.push(tile);
      this.roofEdges.push(roofEdges);
      this.roofCells.push(roofCellXM, roofCellZM);
      this.faces.push(face);
    }
  }

  /** A ground rectangle at y = 0, sim metres; UVs are world metres. */
  groundRect(x0: number, y0: number, x1: number, y1: number, tile: AtlasTile): void {
    this.quad(
      [
        [x0, 0, y0, x0, y0],
        [x1, 0, y0, x1, y0],
        [x1, 0, y1, x1, y1],
        [x0, 0, y1, x0, y1],
      ],
      Face.Up,
      tile,
    );
  }

  build(): CityGeometryData {
    return {
      vertexCount: this.faces.length,
      positions: new Float32Array(this.positions),
      uvs: new Float32Array(this.uvs),
      tiles: new Float32Array(this.tiles),
      roofEdges: new Float32Array(this.roofEdges),
      roofCells: new Float32Array(this.roofCells),
      faces: new Uint8Array(this.faces),
    };
  }
}

/**
 * Wall corners with world-metre UVs. `u` runs left to right as seen from outside, so modules are never
 * mirrored: S walls +x, N walls −x, E walls −z, W walls +z. `v` is height above the ground.
 */
function wallCorners(wall: CityWall): [Vertex, Vertex, Vertex, Vertex] {
  const { x0M, y0M, x1M, y1M, bottomM, topM } = wall;
  const u = (x: number, z: number): number => {
    switch (wall.face) {
      case Face.S:
        return x;
      case Face.N:
        return -x;
      case Face.E:
        return -z;
      default:
        return z;
    }
  };
  return [
    [x0M, bottomM, y0M, u(x0M, y0M), bottomM],
    [x1M, bottomM, y1M, u(x1M, y1M), bottomM],
    [x1M, topM, y1M, u(x1M, y1M), topM],
    [x0M, topM, y0M, u(x0M, y0M), topM],
  ];
}

/** Builds the city's geometry buffers: ground (grid plus skirt), walls and roofs. Pure: no WebGL. */
export function buildCityGeometryData(grid: CityGrid, skirtM: number = GROUND_SKIRT_M): CityGeometryData {
  const writer = new CityGeometryWriter();
  const { cols, rows, originXM: ox, originYM: oy } = grid;

  // Ground: per row, runs of open cells with the same ground type. Building footprints get no ground: the box's
  // roof and visible walls always cover its footprint as seen from above.
  for (let r = 0; r < rows; r++) {
    let c = 0;
    while (c < cols) {
      const i = r * cols + c;
      if ((grid.storeys[i] ?? 0) > 0) {
        c++;
        continue;
      }
      const type = grid.ground[i] ?? GroundType.Asphalt;
      let end = c + 1;
      while (
        end < cols &&
        (grid.storeys[r * cols + end] ?? 0) === 0 &&
        grid.ground[r * cols + end] === type
      ) {
        end++;
      }
      const tile = type === GroundType.Slab ? AtlasTile.GroundSlab : AtlasTile.GroundAsphalt;
      writer.groundRect(ox + c * CELL_M, oy + r * CELL_M, ox + end * CELL_M, oy + (r + 1) * CELL_M, tile);
      c = end;
    }
  }
  if (skirtM > 0) {
    const x0 = ox;
    const y0 = oy;
    const x1 = ox + cols * CELL_M;
    const y1 = oy + rows * CELL_M;
    writer.groundRect(x0 - skirtM, y0 - skirtM, x1 + skirtM, y0, AtlasTile.GroundAsphalt);
    writer.groundRect(x0 - skirtM, y1, x1 + skirtM, y1 + skirtM, AtlasTile.GroundAsphalt);
    writer.groundRect(x0 - skirtM, y0, x0, y1, AtlasTile.GroundAsphalt);
    writer.groundRect(x1, y0, x1 + skirtM, y1, AtlasTile.GroundAsphalt);
  }

  for (const wall of emitWalls(grid)) writer.quad(wallCorners(wall), wall.face, wallTile(wall.face));
  // Roofs: one quad per building cell at its height, flagged with the edges that drop to a lower neighbour.
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const s = storeysAt(grid, c, r);
      if (s === 0) continue;
      const h = s * STOREY_M;
      const x0 = ox + c * CELL_M;
      const z0 = oy + r * CELL_M;
      const x1 = x0 + CELL_M;
      const z1 = z0 + CELL_M;
      writer.quad(
        [
          [x0, h, z0, x0, z0],
          [x1, h, z0, x1, z0],
          [x1, h, z1, x1, z1],
          [x0, h, z1, x0, z1],
        ],
        Face.Up,
        AtlasTile.RoofSlate,
        roofEdges(grid, c, r),
        x0,
        z0,
      );
    }
  }
  return writer.build();
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

/** Slate roof (ART_BIBLE §9.5): 02 base with a 03 course line every 4 px; parapet 06 NW, the dark step 01 SE. */
export const ROOF_COLOURS = {
  base: 'asphalt',
  course: 'asphalt_lt',
  parapetNw: 'kerb',
  parapetSe: 'tar',
} as const;
const ROOF_COURSE_SPACING_PX = 4;

/** Flat placeholder ground (procedural tiles are M1). */
export const GROUND_COLOURS = { asphalt: 'asphalt', slab: 'slab' } as const;

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

/** The slate roof tile (32×32, row-major from the north edge), as palette indices; parapets are drawn per box. */
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
 * The whole placeholder atlas as palette indices, ATLAS_WIDTH_PX × ATLAS_HEIGHT_PX, row 0 at the top. Square
 * tiles occupy rows 0..31 of their column; the rows below repeat the tile's first rows (never sampled).
 */
export function buildCityAtlasIndices(palette: Kerbside32 = KERBSIDE32): Uint8Array {
  const atlas = new Uint8Array(ATLAS_WIDTH_PX * ATLAS_HEIGHT_PX);
  const put = (tile: AtlasTile, src: Uint8Array, srcHeight: number): void => {
    for (let row = 0; row < ATLAS_HEIGHT_PX; row++) {
      const srcRow = row % srcHeight;
      atlas.set(
        src.subarray(srcRow * TILE_PX, (srcRow + 1) * TILE_PX),
        row * ATLAS_WIDTH_PX + tile * TILE_PX,
      );
    }
  };
  put(AtlasTile.FacadeLit, facadeModuleIndices(FacadeVariant.Lit, palette), FACADE_MODULE_H_PX);
  put(AtlasTile.FacadeBase, facadeModuleIndices(FacadeVariant.Base, palette), FACADE_MODULE_H_PX);
  put(AtlasTile.FacadeDark, facadeModuleIndices(FacadeVariant.Dark, palette), FACADE_MODULE_H_PX);
  put(AtlasTile.RoofSlate, roofTileIndices(palette), TILE_PX);
  put(
    AtlasTile.GroundAsphalt,
    new Uint8Array(TILE_PX * TILE_PX).fill(paletteIndex(GROUND_COLOURS.asphalt, palette)),
    TILE_PX,
  );
  put(
    AtlasTile.GroundSlab,
    new Uint8Array(TILE_PX * TILE_PX).fill(paletteIndex(GROUND_COLOURS.slab, palette)),
    TILE_PX,
  );
  return atlas;
}

/** Uploads the placeholder atlas as RGBA8 palette colours. Texel (x, row) holds atlas row `row` from the top. */
export function createCityAtlasTexture(palette: Kerbside32 = KERBSIDE32): DataTexture {
  const indices = buildCityAtlasIndices(palette);
  const rgba = new Uint8Array(indices.length * 4);
  indices.forEach((index, i) => {
    rgba[i * 4] = palette.rgb[index * 3] ?? 0;
    rgba[i * 4 + 1] = palette.rgb[index * 3 + 1] ?? 0;
    rgba[i * 4 + 2] = palette.rgb[index * 3 + 2] ?? 0;
    rgba[i * 4 + 3] = 255;
  });
  const texture = new DataTexture(rgba, ATLAS_WIDTH_PX, ATLAS_HEIGHT_PX, RGBAFormat, UnsignedByteType);
  texture.minFilter = NearestFilter;
  texture.magFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

// ---------------------------------------------------------------------------------------------------------
// Material and mesh.

const CITY_VERTEX = /* glsl */ `
${DEPTH_LAYER_GLSL}
in vec2 aUvM;
in float aTile;
in float aRoofEdges;
in vec2 aRoofCellM;
out vec2 vUvM;
flat out int vTile;
flat out int vRoofEdges;
flat out vec2 vRoofCellM;
void main() {
  vUvM = aUvM;
  vTile = int(aTile + 0.5);
  vRoofEdges = int(aRoofEdges + 0.5);
  vRoofCellM = aRoofCellM;
  // Ground is layer 0 (no offset); walls and roofs keep their real heights.
  gl_Position = applyDepthLayer(projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0),
    ${DepthLayer.Ground}.0, 0.0);
}
`;

const CITY_FRAGMENT = /* glsl */ `
precision highp float;
precision highp int;
uniform highp sampler2D uAtlas;
uniform vec3 uParapetNw;
uniform vec3 uParapetSe;
in vec2 vUvM;
flat in int vTile;
flat in int vRoofEdges;
flat in vec2 vRoofCellM;
${WORLD_OUTPUTS_GLSL}
// Texel lookups add 1/256 texel before flooring. Magnified roofs and walls put texel edges exactly on pixel
// centres at some camera positions (at H = 31.5 m a 3-storey roof is 21 px/m, so every 16th texel edge lands on
// a centre with the camera at the origin); the two triangles of a quad then interpolate UVs a few ulps apart and
// round that pixel row differently, leaving a 1 px step in a course line. The bias settles the tie the same way
// for every triangle and moves no texel by a visible amount.
const float TEXEL_BIAS = 1.0 / 256.0;
void main() {
  vec2 px = floor(vUvM * ${PX_PER_M}.0 + TEXEL_BIAS);
  int col = int(mod(px.x, ${TILE_PX}.0));
  int row;
  if (vTile <= ${AtlasTile.FacadeDark}) {
    // Walls: v is height above the ground; module row 0 is the top of the storey.
    row = ${FACADE_MODULE_H_PX - 1} - int(mod(px.y, ${FACADE_MODULE_H_PX}.0));
  } else if (vTile == ${AtlasTile.RoofSlate}) {
    // Roof texel within its own cell, clamped: a pixel on the seam between two roof cells can be covered by
    // either quad, with UVs a hair beyond that quad's edge, and must not read as the neighbour's first texel.
    ivec2 t = clamp(ivec2(floor((vUvM - vRoofCellM) * ${PX_PER_M}.0 + TEXEL_BIAS)), ivec2(0), ivec2(${TILE_PX - 1}));
    col = t.x;
    row = t.y;
  } else {
    row = int(mod(px.y, ${TILE_PX}.0));
  }
  vec3 colour = texelFetch(uAtlas, ivec2(vTile * ${TILE_PX} + col, row), 0).rgb;
  if (vTile == ${AtlasTile.RoofSlate}) {
    // 1 roof texel parapet line on the cell edges that drop to a lower neighbour: NW edges light, SE edges the
    // roof's dark step (ART_BIBLE §9.3).
    if (((vRoofEdges & ${RoofEdge.N}) != 0 && row == 0) || ((vRoofEdges & ${RoofEdge.W}) != 0 && col == 0)) {
      colour = uParapetNw;
    } else if (((vRoofEdges & ${RoofEdge.S}) != 0 && row == ${TILE_PX - 1}) ||
        ((vRoofEdges & ${RoofEdge.E}) != 0 && col == ${TILE_PX - 1})) {
      colour = uParapetSe;
    }
  }
  outColour = vec4(colour, 1.0);
  outMask = vec4(0.0);
}
`;

/** Uploads {@link CityGeometryData} into a BufferGeometry with the attributes the city material reads. */
export function createCityGeometry(data: CityGeometryData): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(data.positions, 3));
  geometry.setAttribute('aUvM', new BufferAttribute(data.uvs, 2));
  geometry.setAttribute('aTile', new BufferAttribute(data.tiles, 1));
  geometry.setAttribute('aRoofEdges', new BufferAttribute(data.roofEdges, 1));
  geometry.setAttribute('aRoofCellM', new BufferAttribute(data.roofCells, 2));
  return geometry;
}

/** The city as one mesh, one draw call: ground + walls + roofs, frustum culling off. */
export function createCityMesh(grid: CityGrid, palette: Kerbside32 = KERBSIDE32): Mesh {
  const material = new ShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: CITY_VERTEX,
    fragmentShader: CITY_FRAGMENT,
    uniforms: {
      uAtlas: { value: createCityAtlasTexture(palette) },
      uParapetNw: { value: paletteColourVector(paletteIndex(ROOF_COLOURS.parapetNw, palette), palette) },
      uParapetSe: { value: paletteColourVector(paletteIndex(ROOF_COLOURS.parapetSe, palette), palette) },
    },
  });
  const mesh = new Mesh(createCityGeometry(buildCityGeometryData(grid)), material);
  mesh.name = 'cityMesh';
  mesh.frustumCulled = false;
  return mesh;
}
