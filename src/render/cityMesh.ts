// City mesh (TECHNICAL_DESIGN §12.4, ART_BIBLE §4.2, §9.3, §9.4). Since SSP-045 this is the one city renderer for
// both compiled levels (levelCity.ts, sampling the `world` atlas through FRAME) and the M0 test grids
// (placeholderCity.ts, sampling a code-defined placeholder atlas). Everything a district draws on the ground
// plane and above it goes into ONE indexed BufferGeometry with one ShaderMaterial, so the city (ground + walls +
// roofs) is one draw call with `frustumCulled = false` (§12.7).
//
// Buildings, from a cell grid of 2 m cells with per-cell storeys and wall/roof style values:
//   - adjacent building cells with equal storeys merge into boxes (greedy rectangles, row-major);
//   - only walls facing lower or open cells are emitted, from the neighbour's height up to the box top; walls
//     toward equal or taller neighbours are never built, and backface culling hides the rest (a straight-down
//     camera sees a wall exactly when it is on the wall's outward side). A wall run along a box edge splits
//     where the neighbour's height or the owning cell's facade style changes;
//   - UVs are world metres, so 32×40 px facade modules tile at 2 m × 1 storey (2.5 m). A wall's facade frame
//     is one bay (ASSET_PIPELINE §10.9): `u` wraps across the frame width, the ground storey (0–2.5 m) samples
//     the bottom 40 rows and every storey above it the top 40 rows;
//   - facade variant by face normal: N and W walls `lit`, E and S walls `dark` (`base` is the authored values);
//   - roofs are one quad per building cell, sampling its roof style's variant (a deterministic hash of the cell,
//     never the sim RNG) and carrying the edges that drop to a lower or open neighbour, so the 1 px parapet line
//     follows the real roof outline, never the seams between merged boxes. The NW parapet is 06 kerb; the SE
//     parapet is the roof's dark step, `shadow[i]` of the roof frame's dominant index (slate 02 → 01).
// Sim XY maps to render XZ (x east, sim y south = render +z) and buildings extrude along +Y.
//
// Vertex format (per vertex; 4 vertices and 6 indices per quad):
//   position (vec3, metres), aUvM (vec2, world metres: ground/roofs (x, z), walls (along-wall, height)),
//   aRect (vec4, atlas rect x, y, w, h in pixels, from FRAME), aCellM (vec2, the cell's NW corner, which ground
//   and roof texels are clamped to), aInfo (vec4: SurfaceKind, roof edge bits, SE parapet index, grime code).
// The grime code (SSP-066, {@link grimeCode}) is 0 where grime never shows (walls, roofs, the skirt, grass,
// aprons and every quad of the M0 placeholder city); on a route cell's ground and marking quads it names the
// cell's two grime pattern slots: its surface pattern (asphalt or slab, hash-picked variant) and its gutter
// pattern variant.
//
// Grime (TECHNICAL_DESIGN §10.3, §12.4; ART_BIBLE §9.2): where the code is non-zero the fragment shader reads
// the grime mask (an R8 texture, one texel per 4 px grime cell, groundLayer.ts GroundGrime) at the fragment's
// world texel. A cell with intensity 0 is clean; otherwise the cell's pattern (the gutter pattern when bit 7
// is set, else the surface pattern) is sampled at the same texel of the tile, and an opaque pattern texel
// replaces the clean one when the texel's stable rank passes the intensity ({@link grimeTexelShows}). Cells
// are 4×4 texels aligned to the tile, so the clean edge is stepped in 4 px blocks, as ART_BIBLE §9.2 wants.
// grimeTexelIndex() is the CPU mirror of the shader's grime step.
//
// The fragment shader reads a Kerbside-32 index from the R8 atlas texture (255 = transparent, discarded: the
// marking overlays) and looks the colour up in the palette texture, so nothing here spells a colour. Texel
// lookups add 1/256 texel before flooring: magnified roofs and walls put texel edges exactly on pixel centres at
// some camera positions, and the two triangles of a quad would otherwise round that pixel row differently.
import { BufferAttribute, BufferGeometry, GLSL3, Mesh, ShaderMaterial, Texture, Vector2 } from 'three';
import { GRIME_CELL_M, PX_PER_M, TILE_M } from '../sim/constants.ts';
import { GRIME_GUTTER_BIT, GRIME_INTENSITY_MASK } from '../sim/dirt.ts';
import {
  createPaletteTexture,
  KERBSIDE32,
  type Kerbside32,
  PALETTE_SIZE,
  paletteIndex,
} from './palettePass.ts';
import { DEPTH_LAYER_GLSL, DepthLayer, WORLD_OUTPUTS_GLSL } from './worldMaterial.ts';

/** Map cell size: 2 m (one 32 px tile). */
export const CELL_M = TILE_M;

/** Stylised storey height: 2.5 m = 40 px of facade (ART_BIBLE §3.1). */
export const STOREY_M = 2.5;

/** One storey of facade in texels (a module's height). */
export const STOREY_PX = STOREY_M * PX_PER_M;

/** Ground tile and roof tile size in texels (16 px/m, aligned to the 2 m grid). */
export const TILE_PX = CELL_M * PX_PER_M;

/** Ground beyond the grid: a skirt this far out on every side, so a panning camera never sees void. */
export const GROUND_SKIRT_M = 512;

/** Atlas value of a fully transparent texel (spriteAtlas.ts TRANSPARENT_INDEX): the shader discards it. */
export const TRANSPARENT_TEXEL = 255;

/** A grime cell's edge in texels: 4 px (0.25 m, TECHNICAL_DESIGN §10.3). */
export const GRIME_CELL_PX = GRIME_CELL_M * PX_PER_M;

/** Outward direction of a surface. Walls are N/E/S/W; roofs and ground face Up. */
export const Face = { N: 0, E: 1, S: 2, W: 3, Up: 4 } as const;
export type Face = (typeof Face)[keyof typeof Face];

/** A wall's outward direction. */
export type WallFace = Exclude<Face, typeof Face.Up>;

/** Facade ramp variant (ART_BIBLE §6.2, §9.4). */
export const FacadeVariant = { Lit: 0, Base: 1, Dark: 2 } as const;
export type FacadeVariant = (typeof FacadeVariant)[keyof typeof FacadeVariant];

/**
 * How the shader samples a quad's frame:
 * - Ground: a ground tile clamped to its own cell (opaque);
 * - Overlay: a marking tile over a ground cell, clamped likewise; transparent texels are discarded and the quad
 *   sits a hair in front of the ground (sort bias 0.5 within depth layer 0);
 * - Wall: a facade bay, wrapped by world metres (§12.4);
 * - Roof: a roof tile clamped to its cell, plus the parapet line on its flagged edges;
 * - Skirt: a ground tile repeated by world metres (the ground beyond the map).
 */
export const SurfaceKind = { Ground: 0, Overlay: 1, Wall: 2, Roof: 3, Skirt: 4 } as const;
export type SurfaceKind = (typeof SurfaceKind)[keyof typeof SurfaceKind];

/** Roof edge bits: set when the neighbour across that edge is lower or open, so the edge gets a parapet line. */
export const RoofEdge = { N: 1, E: 2, S: 4, W: 8 } as const;
export type RoofEdge = (typeof RoofEdge)[keyof typeof RoofEdge];

/** Palette name of the parapet line on a roof's NW edges (ART_BIBLE §9.3: "06 or the roof's lit step"). */
export const ROOF_PARAPET_NW = 'kerb';

/** A frame's rectangle in its atlas, in pixels (x, y top-left, y down). */
export type AtlasRect = {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
};

/** A building cell grid: row-major, row 0 is the north edge, column 0 the west edge. */
export type CityGrid = {
  readonly cols: number;
  readonly rows: number;
  /** Sim position of the grid's NW corner, in metres. */
  readonly originXM: number;
  readonly originYM: number;
  /** Storeys per cell; 0 means open (no building). */
  readonly storeys: Uint8Array;
  /** Facade style value per building cell (an index into {@link CityStyles.facades}); 0 on open cells. */
  readonly wall: Uint8Array;
  /** Roof style value per building cell (an index into {@link CityStyles.roofs}); 0 on open cells. */
  readonly roof: Uint8Array;
};

/** One facade set: the bay frame for each face variant (N/W `lit`, E/S `dark`). */
export type FacadeStyle = {
  readonly lit: AtlasRect;
  readonly base: AtlasRect;
  readonly dark: AtlasRect;
};

/** One roof style: its tile variants (picked per cell by hash) and its SE parapet colour index. */
export type RoofStyle = {
  readonly variants: readonly AtlasRect[];
  /** Palette index of the parapet line on SE edges: the roof's dark step. */
  readonly parapetSe: number;
};

/** Styles a {@link CityGrid}'s wall and roof values name; entry 0 is unused (STYLE_NONE). */
export type CityStyles = {
  readonly facades: readonly (FacadeStyle | undefined)[];
  readonly roofs: readonly (RoofStyle | undefined)[];
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
  readonly face: WallFace;
  /** Wall segment endpoints on the ground plane (sim metres), west→east or north→south. */
  readonly x0M: number;
  readonly y0M: number;
  readonly x1M: number;
  readonly y1M: number;
  /** Bottom edge: the neighbour's height (0 for an open cell). */
  readonly bottomM: number;
  readonly topM: number;
  /** Facade style value of the building cells behind the wall. */
  readonly style: number;
};

/** Storeys at (col, row); 0 outside the grid (open). */
export function storeysAt(grid: CityGrid, col: number, row: number): number {
  if (col < 0 || row < 0 || col >= grid.cols || row >= grid.rows) return 0;
  return grid.storeys[row * grid.cols + col] ?? 0;
}

/** Checks a grid's layer lengths and that every building cell names a wall and a roof style. */
export function validateCityGrid(grid: CityGrid): void {
  const n = grid.cols * grid.rows;
  if (!Number.isInteger(grid.cols) || !Number.isInteger(grid.rows) || grid.cols <= 0 || grid.rows <= 0) {
    throw new Error(`city grid must be at least 1×1 cells, got ${grid.cols}×${grid.rows}`);
  }
  if (grid.storeys.length !== n || grid.wall.length !== n || grid.roof.length !== n) {
    throw new Error(`city grid layers must hold ${n} cells`);
  }
  for (let i = 0; i < n; i++) {
    if ((grid.storeys[i] ?? 0) > 0 && ((grid.wall[i] ?? 0) === 0 || (grid.roof[i] ?? 0) === 0)) {
      throw new Error(
        `city grid cell (${i % grid.cols}, ${Math.floor(i / grid.cols)}) has no wall or roof style`,
      );
    }
  }
}

/**
 * Merges building cells with equal storeys into boxes: greedy, row-major. Each box grows east as far as the
 * run of equal, unclaimed cells goes, then south while every cell of the next row's span matches. Styles do
 * not split boxes: walls split by style, roofs are per cell and shadows only need the massing.
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
 * neighbour height and the same facade style merge into one wall from that height up to the box top.
 */
function boxWalls(grid: CityGrid, box: CityBox, out: CityWall[]): void {
  const c0 = Math.round((box.x0M - grid.originXM) / CELL_M);
  const r0 = Math.round((box.y0M - grid.originYM) / CELL_M);
  const c1 = Math.round((box.x1M - grid.originXM) / CELL_M);
  const r1 = Math.round((box.y1M - grid.originYM) / CELL_M);
  const s = box.storeys;
  // [face, horizontal edge?, neighbour line (cell index outside the box), owner line (inside), span]
  const edges = [
    [Face.N, true, r0 - 1, r0, c0, c1],
    [Face.S, true, r1, r1 - 1, c0, c1],
    [Face.W, false, c0 - 1, c0, r0, r1],
    [Face.E, false, c1, c1 - 1, r0, r1],
  ] as const;
  for (const [face, horizontal, outside, inside, start, end] of edges) {
    let runStart = start;
    let runNeighbour = -1;
    let runStyle = -1;
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
        style: runStyle,
      });
    };
    for (let k = start; k < end; k++) {
      const n = horizontal ? storeysAt(grid, k, outside) : storeysAt(grid, outside, k);
      const ownerIndex = horizontal ? inside * grid.cols + k : k * grid.cols + inside;
      const style = grid.wall[ownerIndex] ?? 0;
      if (n !== runNeighbour || style !== runStyle) {
        flush(k);
        runStart = k;
        runNeighbour = n;
        runStyle = style;
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

/** The bay frame of `style` a wall facing `face` samples. */
export function facadeRect(style: FacadeStyle, face: WallFace): AtlasRect {
  const variant = facadeVariant(face);
  if (variant === FacadeVariant.Lit) return style.lit;
  return variant === FacadeVariant.Dark ? style.dark : style.base;
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

// Integer hash multipliers (decimal: src/render keeps hex-looking literals out, tests/unit/noHexColours.test.ts).
const HASH_X = 374761393;
const HASH_Y = 668265263;
const HASH_SALT = 1274126177;
const HASH_MIX_1 = 2246822519;
const HASH_MIX_2 = 3266489917;

/**
 * A deterministic 32-bit hash of a cell (x, y) and a salt: the per-cell variant choice for ground tiles and
 * roofs (SSP-045). Render-only and stateless, so it never touches the sim RNG and a cell always draws the same
 * variant.
 */
export function cellHash(x: number, y: number, salt: number): number {
  let h = Math.imul(x, HASH_X) ^ Math.imul(y, HASH_Y) ^ Math.imul(salt + 1, HASH_SALT);
  h = Math.imul(h ^ (h >>> 15), HASH_MIX_1);
  h = Math.imul(h ^ (h >>> 13), HASH_MIX_2);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Variant index in 0..count−1 for cell (x, y): {@link cellHash} modulo the variant count. */
export function cellVariant(x: number, y: number, count: number, salt: number): number {
  if (!Number.isInteger(count) || count < 1) throw new Error(`cellVariant: ${count} variants`);
  return cellHash(x, y, salt) % count;
}

/**
 * Hash salts, so the variants of the same cell are independent: ground and roof tiles (SSP-045), the grime
 * pattern variant of a tile (`Grime`) and the per-texel grime rank (`GrimeRank`, SSP-066). `Stain` picks a stain
 * decal's variant from its position in 1/16 m texels (itemsBatch.ts, SSP-067). `Hazard` picks a hazard decal's
 * variant from its tile and `Actor` an NPC's animation phase from its handle and the render seed (SSP-103).
 */
export const VariantSalt = {
  Ground: 0,
  Roof: 1,
  Grime: 2,
  GrimeRank: 3,
  Stain: 4,
  Hazard: 5,
  Actor: 6,
} as const;
export type VariantSalt = (typeof VariantSalt)[keyof typeof VariantSalt];

// ---------------------------------------------------------------------------------------------------------
// Grime (SSP-066). The shader's grime step and its CPU mirror share these numbers.

/** Grime pattern families: the three overlay assets of ART_BIBLE §9.2, in slot order. */
export const GrimeFamily = { Asphalt: 0, Slab: 1, Gutter: 2 } as const;
export type GrimeFamily = (typeof GrimeFamily)[keyof typeof GrimeFamily];

/** Pattern slots per family: family f's variant v is slot f × 4 + v (a family may have at most 4 variants). */
export const GRIME_FAMILY_SLOTS = 4;

/** Slots in the shader's pattern rect table (`uGrimeRects`): 3 families × 4. */
export const GRIME_SLOT_COUNT = 3 * GRIME_FAMILY_SLOTS;

/** Packing radix of a grime code: code = 1 + surfaceSlot + GRIME_CODE_RADIX × gutterSlot. */
const GRIME_CODE_RADIX = 16;

/** A grime rank is 0..127: the low 7 bits of the texel hash. */
const GRIME_RANK_MASK = 127;

/**
 * Ranks below this plus half the intensity show: at intensity 126–127 every opaque pattern texel shows, at
 * GRIME_INTENSITY_MIN (64) about 76% of them, at 1 about half.
 */
const GRIME_RANK_BASE = 65;

/** The grime code of a quad with no grime (walls, roofs, the skirt, grass, aprons, the placeholder city). */
export const GRIME_NONE = 0;

/** The per-vertex grime code (aInfo.w) of a ground or marking quad: its surface and gutter pattern slots. */
export function grimeCode(surfaceSlot: number, gutterSlot: number): number {
  for (const slot of [surfaceSlot, gutterSlot]) {
    if (!Number.isInteger(slot) || slot < 0 || slot >= GRIME_SLOT_COUNT)
      throw new Error(`grimeCode: slot ${slot} outside 0..${GRIME_SLOT_COUNT - 1}`);
  }
  return 1 + surfaceSlot + GRIME_CODE_RADIX * gutterSlot;
}

/** The pattern slot a dirty cell of mask value `maskValue` samples under grime code `code` (> 0). */
export function grimePatternSlot(code: number, maskValue: number): number {
  const packed = code - 1;
  return (maskValue & GRIME_GUTTER_BIT) !== 0
    ? Math.floor(packed / GRIME_CODE_RADIX)
    : packed % GRIME_CODE_RADIX;
}

/** The stable rank 0..127 of world texel (x, y) (whole texels from the map's NW corner). */
export function grimeRank(texelX: number, texelY: number): number {
  return cellHash(texelX, texelY, VariantSalt.GrimeRank) & GRIME_RANK_MASK;
}

/** True when a texel of rank `rank` in a cell of mask value `maskValue` shows its pattern texel. */
export function grimeTexelShows(maskValue: number, rank: number): boolean {
  const intensity = maskValue & GRIME_INTENSITY_MASK;
  return intensity > 0 && rank < GRIME_RANK_BASE + (intensity >> 1);
}

/**
 * CPU mirror of the shader's grime step for one texel: the clean index `clean` (ground or marking), the
 * cell's mask value, the texel's world position and the pattern index under it (`TRANSPARENT_TEXEL` = none).
 * Returns the index drawn.
 */
export function grimeTexelIndex(
  clean: number,
  maskValue: number,
  texelX: number,
  texelY: number,
  patternIndex: number,
): number {
  if (patternIndex === TRANSPARENT_TEXEL) return clean;
  return grimeTexelShows(maskValue, grimeRank(texelX, texelY)) ? patternIndex : clean;
}

/**
 * What the city material needs to draw grime: the R8 mask texture (one texel per grime cell, row 0 north), its
 * size in cells and the pattern rect table (GRIME_SLOT_COUNT × (x, y, w, h), atlas pixels).
 */
export type CityGrime = {
  readonly texture: Texture;
  readonly widthCells: number;
  readonly heightCells: number;
  readonly rects: Int32Array;
};

/**
 * The most common index inside `rect` of an index atlas (`width` pixels wide), ignoring transparent texels; ties
 * go to the lower index. A roof's dominant index is its base colour.
 */
export function dominantIndex(indices: Uint8Array, width: number, rect: AtlasRect): number {
  const counts = new Uint32Array(PALETTE_SIZE);
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      const index = indices[y * width + x] ?? TRANSPARENT_TEXEL;
      if (index < PALETTE_SIZE) counts[index] = (counts[index] ?? 0) + 1;
    }
  }
  let best = -1;
  let bestCount = 0;
  counts.forEach((count, index) => {
    if (count > bestCount) {
      best = index;
      bestCount = count;
    }
  });
  if (best < 0) throw new Error(`frame at (${rect.x}, ${rect.y}) has no opaque texel`);
  return best;
}

/** The SE parapet index of a roof whose base colour is `dominant`: its dark step, `shadow[dominant]`. */
export function roofParapetSe(dominant: number, palette: Kerbside32 = KERBSIDE32): number {
  const index = palette.shadow[dominant];
  if (index === undefined) throw new Error(`roofParapetSe: index ${dominant} is not a palette index`);
  return index;
}

/** A quad corner: render position (x, y, z) and world-metre UV (u, v). */
export type QuadCorner = readonly [x: number, y: number, z: number, u: number, v: number];

/** Geometry buffers before upload, plus per-quad faces and kinds for tests. Indexed: 4 vertices per quad. */
export type CityGeometryData = {
  readonly quadCount: number;
  readonly vertexCount: number;
  /** Render-space positions (x, y, z), metres. */
  readonly positions: Float32Array;
  /** World-metre UVs. */
  readonly uvs: Float32Array;
  /** Atlas rect (x, y, w, h) per vertex. */
  readonly rects: Float32Array;
  /** NW corner (x, z) of the quad's cell in metres (ground, overlays, roofs), (0, 0) elsewhere. */
  readonly cells: Float32Array;
  /** (SurfaceKind, roof edge bits, SE parapet index, grime code) per vertex. */
  readonly info: Float32Array;
  /** Triangle indices, 6 per quad, wound counter-clockwise as seen from outside. */
  readonly indices: Uint32Array;
  /** Outward face per quad (not uploaded). */
  readonly faces: Uint8Array;
  /** SurfaceKind per quad (not uploaded). */
  readonly kinds: Uint8Array;
};

/** Growable vertex writer for the city geometry: ground chunks, markings, the skirt, walls and roofs. */
export class CityGeometryWriter {
  private readonly positions: number[] = [];
  private readonly uvs: number[] = [];
  private readonly rects: number[] = [];
  private readonly cells: number[] = [];
  private readonly info: number[] = [];
  private readonly indices: number[] = [];
  private readonly faces: number[] = [];
  private readonly kinds: number[] = [];

  /** Quads written so far. */
  get quadCount(): number {
    return this.faces.length;
  }

  /**
   * One quad as two triangles sharing the corner 0 → corner 2 diagonal. `corners` go round the quad's
   * perimeter; the triangle order is flipped if needed so the winding faces `face` (counter-clockwise seen from
   * outside, which backface culling keeps).
   */
  quad(
    corners: readonly [QuadCorner, QuadCorner, QuadCorner, QuadCorner],
    face: Face,
    kind: SurfaceKind,
    rect: AtlasRect,
    cellXM = 0,
    cellZM = 0,
    edges = 0,
    parapetSe = 0,
    grime: number = GRIME_NONE,
  ): void {
    if (grime !== GRIME_NONE && kind !== SurfaceKind.Ground && kind !== SurfaceKind.Overlay)
      throw new Error('city: only ground and marking quads carry grime');
    const [a, b, c] = corners;
    const n = faceNormal(face);
    const e1x = b[0] - a[0];
    const e1y = b[1] - a[1];
    const e1z = b[2] - a[2];
    const e2x = c[0] - a[0];
    const e2y = c[1] - a[1];
    const e2z = c[2] - a[2];
    const dot =
      (e1y * e2z - e1z * e2y) * n[0] + (e1z * e2x - e1x * e2z) * n[1] + (e1x * e2y - e1y * e2x) * n[2];
    const base = this.positions.length / 3;
    if (dot > 0) this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    else this.indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
    for (const v of corners) {
      this.positions.push(v[0], v[1], v[2]);
      this.uvs.push(v[3], v[4]);
      this.rects.push(rect.x, rect.y, rect.w, rect.h);
      this.cells.push(cellXM, cellZM);
      this.info.push(kind, edges, parapetSe, grime);
    }
    this.faces.push(face);
    this.kinds.push(kind);
  }

  /**
   * A ground-plane rectangle at y = 0 in sim metres, UVs in world metres, clamped to the cell at (x0, y0).
   * `grime` is the cell's grime code ({@link grimeCode}; GRIME_NONE, the default, draws no grime).
   */
  groundQuad(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    kind: SurfaceKind,
    rect: AtlasRect,
    grime: number = GRIME_NONE,
  ): void {
    this.quad(
      [
        [x0, 0, y0, x0, y0],
        [x1, 0, y0, x1, y0],
        [x1, 0, y1, x1, y1],
        [x0, 0, y1, x0, y1],
      ],
      Face.Up,
      kind,
      rect,
      x0,
      y0,
      0,
      0,
      grime,
    );
  }

  /** Four skirt quads of `rect` around the rectangle (x0, y0)–(x1, y1), `skirtM` wide. */
  skirt(x0: number, y0: number, x1: number, y1: number, skirtM: number, rect: AtlasRect): void {
    if (skirtM <= 0) return;
    this.groundQuad(x0 - skirtM, y0 - skirtM, x1 + skirtM, y0, SurfaceKind.Skirt, rect);
    this.groundQuad(x0 - skirtM, y1, x1 + skirtM, y1 + skirtM, SurfaceKind.Skirt, rect);
    this.groundQuad(x0 - skirtM, y0, x0, y1, SurfaceKind.Skirt, rect);
    this.groundQuad(x1, y0, x1 + skirtM, y1, SurfaceKind.Skirt, rect);
  }

  build(): CityGeometryData {
    return {
      quadCount: this.faces.length,
      vertexCount: this.positions.length / 3,
      positions: new Float32Array(this.positions),
      uvs: new Float32Array(this.uvs),
      rects: new Float32Array(this.rects),
      cells: new Float32Array(this.cells),
      info: new Float32Array(this.info),
      indices: new Uint32Array(this.indices),
      faces: new Uint8Array(this.faces),
      kinds: new Uint8Array(this.kinds),
    };
  }
}

/**
 * Wall corners with world-metre UVs. `u` runs left to right as seen from outside, so modules are never
 * mirrored: S walls +x, N walls −x, E walls −z, W walls +z. `v` is height above the ground.
 */
function wallCorners(wall: CityWall): [QuadCorner, QuadCorner, QuadCorner, QuadCorner] {
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

function facadeStyleOf(styles: CityStyles, value: number): FacadeStyle {
  const style = styles.facades[value];
  if (style === undefined) throw new Error(`city: no facade style for wall value ${value}`);
  return style;
}

function roofStyleOf(styles: CityStyles, value: number): RoofStyle {
  const style = styles.roofs[value];
  if (style === undefined || style.variants.length === 0) {
    throw new Error(`city: no roof style for roof value ${value}`);
  }
  return style;
}

/**
 * Writes the buildings of `grid`: every emitted wall (lit/dark bay by face), then one roof quad per building
 * cell at its height (hash-picked variant, parapet edge bits). Returns the merged boxes (for the shadows).
 */
export function writeBuildings(grid: CityGrid, styles: CityStyles, writer: CityGeometryWriter): CityBox[] {
  validateCityGrid(grid);
  const boxes = mergeBoxes(grid);
  for (const wall of emitWalls(grid, boxes)) {
    const rect = facadeRect(facadeStyleOf(styles, wall.style), wall.face);
    writer.quad(wallCorners(wall), wall.face, SurfaceKind.Wall, rect);
  }
  const { cols, rows, originXM: ox, originYM: oy } = grid;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const s = storeysAt(grid, c, r);
      if (s === 0) continue;
      const style = roofStyleOf(styles, grid.roof[r * cols + c] ?? 0);
      const rect = style.variants[cellVariant(c, r, style.variants.length, VariantSalt.Roof)];
      if (rect === undefined) throw new Error('city: roof variant out of range');
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
        SurfaceKind.Roof,
        rect,
        x0,
        z0,
        roofEdges(grid, c, r),
        style.parapetSe,
      );
    }
  }
  return boxes;
}

// ---------------------------------------------------------------------------------------------------------
// Material and mesh.

const CITY_VERTEX = /* glsl */ `
${DEPTH_LAYER_GLSL}
in vec2 aUvM;
in vec4 aRect;
in vec2 aCellM;
in vec4 aInfo;
out vec2 vUvM;
flat out ivec4 vRect;
flat out vec2 vCellM;
flat out ivec4 vInfo;
void main() {
  vUvM = aUvM;
  vRect = ivec4(aRect + 0.5);
  vCellM = aCellM;
  vInfo = ivec4(aInfo + 0.5);
  // Everything is depth layer 0: ground and markings lie at y = 0 (markings a hair in front, sort bias 0.5),
  // walls and roofs keep their real heights.
  float sortBias = vInfo.x == ${SurfaceKind.Overlay} ? 0.5 : 0.0;
  gl_Position = applyDepthLayer(projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0),
    ${DepthLayer.Ground}.0, sortBias);
}
`;

const CITY_FRAGMENT = /* glsl */ `
precision highp float;
precision highp int;
uniform highp sampler2D uAtlas;
uniform highp sampler2D uPalette;
uniform int uParapetNw;
// Grime (SSP-066): the mask (R8, one texel per 4 px cell, row 0 north), its size in cells (0 × 0: no grime)
// and the pattern rects by slot.
uniform highp sampler2D uGrime;
uniform ivec2 uGrimeSize;
uniform ivec4 uGrimeRects[${GRIME_SLOT_COUNT}];
in vec2 vUvM;
flat in ivec4 vRect;
flat in vec2 vCellM;
flat in ivec4 vInfo;
${WORLD_OUTPUTS_GLSL}
const float TEXEL_BIAS = 1.0 / 256.0;
const float STOREY_PX = ${STOREY_PX}.0;
// cellHash() of cityMesh.ts in unsigned 32-bit arithmetic (Math.imul wraps the same way).
uint cellHash(uint x, uint y, uint salt) {
  uint h = (x * ${HASH_X}u) ^ (y * ${HASH_Y}u) ^ ((salt + 1u) * ${HASH_SALT}u);
  h = (h ^ (h >> 15u)) * ${HASH_MIX_1}u;
  h = (h ^ (h >> 13u)) * ${HASH_MIX_2}u;
  return h ^ (h >> 16u);
}
void main() {
  int kind = vInfo.x;
  vec2 size = vec2(vRect.zw);
  ivec2 t;
  if (kind == ${SurfaceKind.Wall}) {
    // A bay frame: u wraps across its width; the ground storey samples the bottom 40 rows, every storey above
    // it the top 40 rows (v is height above the ground; module row 0 is the top of the storey).
    vec2 px = floor(vUvM * ${PX_PER_M}.0 + TEXEL_BIAS);
    int k = int(mod(px.y, STOREY_PX));
    int row = px.y < STOREY_PX ? vRect.w - 1 - k : ${STOREY_PX - 1} - k;
    t = ivec2(int(mod(px.x, size.x)), row);
  } else if (kind == ${SurfaceKind.Skirt}) {
    t = ivec2(mod(floor(vUvM * ${PX_PER_M}.0 + TEXEL_BIAS), size));
  } else {
    // Ground, markings and roofs: the texel within the quad's own cell, clamped. A pixel on the seam between two
    // cells can be covered by either quad, with UVs a hair beyond that quad's edge, and must not read as the
    // neighbouring frame's first texel.
    t = clamp(ivec2(floor((vUvM - vCellM) * ${PX_PER_M}.0 + TEXEL_BIAS)), ivec2(0), vRect.zw - 1);
  }
  int idx = int(texelFetch(uAtlas, vRect.xy + t, 0).r * 255.0 + 0.5);
  if (idx == ${TRANSPARENT_TEXEL}) discard;
  if (kind == ${SurfaceKind.Roof}) {
    // 1 roof texel parapet line on the cell edges that drop to a lower neighbour: NW edges light, SE edges the
    // roof's dark step (ART_BIBLE §9.3).
    int edges = vInfo.y;
    if (((edges & ${RoofEdge.N}) != 0 && t.y == 0) || ((edges & ${RoofEdge.W}) != 0 && t.x == 0)) {
      idx = uParapetNw;
    } else if (((edges & ${RoofEdge.S}) != 0 && t.y == vRect.w - 1) ||
        ((edges & ${RoofEdge.E}) != 0 && t.x == vRect.z - 1)) {
      idx = vInfo.z;
    }
  }
  int grime = vInfo.w;
  if (grime > 0) {
    // The fragment's world texel (cell corners are whole metres) and its 4 px grime cell (grimeTexelIndex).
    ivec2 texel = ivec2(floor(vCellM * ${PX_PER_M}.0 + 0.5)) + t;
    ivec2 cell = texel / ${GRIME_CELL_PX};
    if (all(greaterThanEqual(texel, ivec2(0))) && all(lessThan(cell, uGrimeSize))) {
      int m = int(texelFetch(uGrime, cell, 0).r * 255.0 + 0.5);
      int intensity = m & ${GRIME_INTENSITY_MASK};
      if (intensity > 0) {
        int packed = grime - 1;
        int slot = (m & ${GRIME_GUTTER_BIT}) != 0 ? packed / ${GRIME_CODE_RADIX} : packed % ${GRIME_CODE_RADIX};
        ivec4 pattern = uGrimeRects[slot];
        int g = int(texelFetch(uAtlas, pattern.xy + t, 0).r * 255.0 + 0.5);
        int rank = int(cellHash(uint(texel.x), uint(texel.y), ${VariantSalt.GrimeRank}u) & ${GRIME_RANK_MASK}u);
        if (g != ${TRANSPARENT_TEXEL} && rank < ${GRIME_RANK_BASE} + (intensity >> 1)) idx = g;
      }
    }
  }
  outColour = vec4(texelFetch(uPalette, ivec2(idx, 0), 0).rgb, 1.0);
  outMask = vec4(0.0);
}
`;

/** Uploads {@link CityGeometryData} into an indexed BufferGeometry with the attributes the city material reads. */
export function createCityGeometry(data: CityGeometryData): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(data.positions, 3));
  geometry.setAttribute('aUvM', new BufferAttribute(data.uvs, 2));
  geometry.setAttribute('aRect', new BufferAttribute(data.rects, 4));
  geometry.setAttribute('aCellM', new BufferAttribute(data.cells, 2));
  geometry.setAttribute('aInfo', new BufferAttribute(data.info, 4));
  geometry.setIndex(new BufferAttribute(data.indices, 1));
  return geometry;
}

/**
 * The city material: an R8 index atlas (`texelFetch(x, y)` is atlas pixel (x, y), y down; 255 = transparent)
 * looked up in the palette texture, with the grime overlay when `grime` is given (SSP-066; null draws none).
 * One instance per city; it owns its palette texture, not the atlas or the grime texture.
 */
export function createCityMaterial(
  atlas: Texture,
  palette: Kerbside32 = KERBSIDE32,
  grime: CityGrime | null = null,
): ShaderMaterial {
  if (grime !== null && grime.rects.length !== GRIME_SLOT_COUNT * 4) {
    throw new Error(`city: the grime rect table must hold ${GRIME_SLOT_COUNT} rects`);
  }
  return new ShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: CITY_VERTEX,
    fragmentShader: CITY_FRAGMENT,
    uniforms: {
      uAtlas: { value: atlas },
      uPalette: { value: createPaletteTexture(palette) },
      uParapetNw: { value: paletteIndex(ROOF_PARAPET_NW, palette) },
      uGrime: { value: grime?.texture ?? null },
      uGrimeSize: { value: new Vector2(grime?.widthCells ?? 0, grime?.heightCells ?? 0) },
      uGrimeRects: { value: grime?.rects ?? new Int32Array(GRIME_SLOT_COUNT * 4) },
    },
  });
}

/** The city as one mesh, one draw call: ground + markings + walls + roofs, frustum culling off. */
export function createCityMesh(
  data: CityGeometryData,
  atlas: Texture,
  palette: Kerbside32 = KERBSIDE32,
  grime: CityGrime | null = null,
): Mesh {
  const mesh = new Mesh(createCityGeometry(data), createCityMaterial(atlas, palette, grime));
  mesh.name = 'cityMesh';
  mesh.frustumCulled = false;
  return mesh;
}

/** Releases a city mesh's geometry, material and palette texture (not the shared atlas texture). */
export function disposeCityMesh(mesh: Mesh): void {
  mesh.geometry.dispose();
  const material = mesh.material;
  if (material instanceof ShaderMaterial) {
    const palette: unknown = material.uniforms.uPalette?.value;
    if (palette instanceof Texture) palette.dispose();
    material.dispose();
  }
}
