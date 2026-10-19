// The M2 spawn layers of a compiled level (SSP-054; LEVEL_DESIGN §9.1–§9.2, TECHNICAL_DESIGN §10.3 and
// §15.1 step 5): the per-grime-cell `gutter` layer (GRIME_CELL OPEN and GUTTER bits), the per-tile zone
// `grimeDensity`, and the litter spawn field (`spawns.litter`: LITTER_PLACE bits and Uint16 weights per 0.5 m
// sub-cell). Pure: no fs. Runs once per compile, so it may allocate.
//
// Rules (as built, SSP-054; LEVEL_DESIGN §9.1–§9.2 mirror them):
// - A grime cell is OPEN on a route-area tile that is not a `site.skip` and where no solid prop's footprint
//   (tuning.json → propFootprints, at the prop's position) overlaps the cell. GUTTER marks the OPEN cells of a
//   road cell within GUTTER_BAND_CELLS (2 cells, 0.5 m, 8 px) of one of its KERB_EDGE sides.
// - grimeDensity is the highest `grime.zones` density covering a route tile, quantised to 0..255.
// - Litter sub-cells are scored base weight (by ground, LITTER_BASE_WEIGHT) × every covering hotspot's `mult`;
//   blocked sub-cells (off route, skip, under a prop) and sub-cells where no table type may go weigh 0; then
//   the gutter weights are rescaled so the road gutter holds exactly `gutterBias` of the total; finally the
//   field is scaled so the heaviest sub-cell is LITTER_WEIGHT_MAX (any non-zero weight stays ≥ 1).
// - `near` (grime zones and litter hotspots) names `prop.<id>` (each prop's position), `site.<id>` (each cell
//   of that site), `use:<building use>` (each cell of a building with that use) or an anchor name (its tile).
//   A cell is within `radius` tiles when its centre is no more than radius × 2 m from a source point centre.
import { TILE_M } from '../../src/sim/constants.ts';
import {
  COLLIDE,
  GRIME_CELL,
  Ground,
  GUTTER_CELLS_PER_TILE,
  type LevelProp,
  LITTER_CELL_M,
  LITTER_CELLS_PER_TILE,
  LITTER_PLACE,
  LITTER_WEIGHT_MAX,
  type LitterTableEntry,
} from '../../src/sim/map.ts';
import type { PropFootprint } from '../../src/sim/tuning.ts';
import type { ResolvedMap } from './compile-level.ts';
import { isRoadCell, isRoadGround } from './tileLayers.ts';

/** Width of the gutter band in grime cells on the road side of a raised kerb edge (2 × 0.25 m = 0.5 m, 8 px). */
export const GUTTER_BAND_CELLS = 2;

/** A road sub-cell within this distance of a raised kerb edge is road gutter (LEVEL_DESIGN §9.1: 1 tile). */
export const LITTER_GUTTER_M = TILE_M;

/** NEAR_KERB: within 2 tiles of a raised kerb edge (LEVEL_DESIGN §9.1 rule 5, bin bags). */
export const LITTER_NEAR_KERB_M = 2 * TILE_M;

/** NEAR_TREE: within 4 m of a `prop.tree` (LEVEL_DESIGN §9.1 rule 5, leaf piles). */
export const LITTER_NEAR_TREE_M = 4;

/** Litter base weights by placement (LEVEL_DESIGN §9.1 rule 2). Grounds not listed are never litter cells. */
export const LITTER_BASE_WEIGHT = {
  roadGutter: 3.0,
  roadCentre: 0.4,
  pavement: 1.5,
  alley: 2.0,
  precinct: 1.5,
  yard: 1.0,
} as const;

/**
 * Placement constraints by litter type (LEVEL_DESIGN §9.1 rule 5): the LITTER_PLACE bits a sub-cell must all
 * carry for the type to spawn there. Types not listed may go on any litter sub-cell. Dog mess is "pavements
 * and grass", but grass is never route area, so only pavement remains.
 */
export const LITTER_REQUIRES: { readonly [id: string]: number } = {
  'litter.leaf_pile': LITTER_PLACE.NEAR_TREE,
  'litter.bin_bag': LITTER_PLACE.NEAR_KERB,
  'litter.dog_mess': LITTER_PLACE.PAVEMENT,
};

/** A source point of a `near` reference, in metres. */
export type Point = readonly [x: number, y: number];

/** What the spawn layers need from the compile: the resolved map, its route and collide layers and props. */
export type SpawnContext = {
  map: ResolvedMap;
  /** 1 = route area (w·h). */
  route: Uint8Array;
  /** COLLIDE bits (w·h): the KERB_EDGE bits locate the kerbs. */
  collide: Uint8Array;
  /** 1 = a `site.skip` tile (w·h): nothing spawns in a skip. */
  skip: Uint8Array;
  /** Props in metres (the compiled `props`). */
  props: readonly LevelProp[];
  /** The solid footprint of a prop id, or undefined for a prop that does not block (tuning.json). */
  footprintOf: (id: string) => PropFootprint | undefined;
};

/** A grime zone with its sources resolved: a tile rect `[x, y, w, h]` or source points and a radius in tiles. */
export type ResolvedZone =
  | { rect: readonly [number, number, number, number]; density: number }
  | { points: readonly Point[]; radius: number; density: number };

/** A litter hotspot with its sources resolved. */
export type ResolvedHotspot = { points: readonly Point[]; radius: number; mult: number };

// ---------------------------------------------------------------------------------------------------------
// Shared geometry
// ---------------------------------------------------------------------------------------------------------

/**
 * Mark (set to 1) every cell of a `cellM`-sized grid (gw × gh, origin at the map's north-west corner) that a
 * solid prop footprint overlaps with positive area. Box footprints use the axis-aligned bounds of the turned
 * box (exact for the compiler's rot 0), so the test is conservative.
 */
export function markFootprints(
  ctx: SpawnContext,
  cellM: number,
  gw: number,
  gh: number,
  out: Uint8Array,
): void {
  for (const prop of ctx.props) {
    const fp = ctx.footprintOf(prop.id);
    if (fp === undefined) continue;
    let hx: number;
    let hy: number;
    if (fp.shape === 'circle') {
      hx = fp.radiusM;
      hy = fp.radiusM;
    } else {
      const c = Math.abs(Math.cos(prop.rot));
      const s = Math.abs(Math.sin(prop.rot));
      hx = (c * fp.widthM + s * fp.lengthM) / 2;
      hy = (s * fp.widthM + c * fp.lengthM) / 2;
    }
    const cx0 = Math.max(0, Math.floor((prop.x - hx) / cellM));
    const cy0 = Math.max(0, Math.floor((prop.y - hy) / cellM));
    const cx1 = Math.min(gw - 1, Math.floor((prop.x + hx) / cellM));
    const cy1 = Math.min(gh - 1, Math.floor((prop.y + hy) / cellM));
    for (let cy = cy0; cy <= cy1; cy += 1) {
      const y0 = cy * cellM;
      const y1 = y0 + cellM;
      for (let cx = cx0; cx <= cx1; cx += 1) {
        const x0 = cx * cellM;
        const x1 = x0 + cellM;
        let hit: boolean;
        if (fp.shape === 'circle') {
          const dx = prop.x < x0 ? x0 - prop.x : prop.x > x1 ? prop.x - x1 : 0;
          const dy = prop.y < y0 ? y0 - prop.y : prop.y > y1 ? prop.y - y1 : 0;
          hit = dx * dx + dy * dy < fp.radiusM * fp.radiusM;
        } else {
          hit = prop.x - hx < x1 && prop.x + hx > x0 && prop.y - hy < y1 && prop.y + hy > y0;
        }
        if (hit) out[cy * gw + cx] = 1;
      }
    }
  }
}

/**
 * 1 for every cell of a `cellM` grid (gw × gh) whose centre lies within `radiusM` of any point (inclusive).
 * Each source only visits the cells of its own bounding square.
 */
export function nearCover(
  points: readonly Point[],
  radiusM: number,
  cellM: number,
  gw: number,
  gh: number,
): Uint8Array {
  const cover = new Uint8Array(gw * gh);
  const r2 = radiusM * radiusM;
  for (const [px, py] of points) {
    const cx0 = Math.max(0, Math.floor((px - radiusM) / cellM));
    const cy0 = Math.max(0, Math.floor((py - radiusM) / cellM));
    const cx1 = Math.min(gw - 1, Math.floor((px + radiusM) / cellM));
    const cy1 = Math.min(gh - 1, Math.floor((py + radiusM) / cellM));
    for (let cy = cy0; cy <= cy1; cy += 1) {
      const dy = (cy + 0.5) * cellM - py;
      for (let cx = cx0; cx <= cx1; cx += 1) {
        const dx = (cx + 0.5) * cellM - px;
        if (dx * dx + dy * dy <= r2) cover[cy * gw + cx] = 1;
      }
    }
  }
  return cover;
}

/** Raised kerb edges as segments in metres: [x0, y0, x1, y1], from the road side's KERB_EDGE bits. */
export function kerbSegments(ctx: SpawnContext): [number, number, number, number][] {
  const { w, h } = ctx.map;
  const out: [number, number, number, number][] = [];
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = y * w + x;
      if (!isRoadCell(ctx.map, i)) continue;
      const c = ctx.collide[i] ?? 0;
      const [l, t, r, b] = [x * TILE_M, y * TILE_M, (x + 1) * TILE_M, (y + 1) * TILE_M];
      if ((c & COLLIDE.KERB_EDGE_N) !== 0) out.push([l, t, r, t]);
      if ((c & COLLIDE.KERB_EDGE_E) !== 0) out.push([r, t, r, b]);
      if ((c & COLLIDE.KERB_EDGE_S) !== 0) out.push([l, b, r, b]);
      if ((c & COLLIDE.KERB_EDGE_W) !== 0) out.push([l, t, l, b]);
    }
  }
  return out;
}

/**
 * Squared distance (m²) from each `cellM` cell centre to the nearest kerb segment, for cells within
 * `maxM` of one; Infinity elsewhere.
 */
export function kerbDistanceSq(
  segments: readonly [number, number, number, number][],
  maxM: number,
  cellM: number,
  gw: number,
  gh: number,
): Float64Array {
  const out = new Float64Array(gw * gh).fill(Number.POSITIVE_INFINITY);
  for (const [x0, y0, x1, y1] of segments) {
    const cx0 = Math.max(0, Math.floor((Math.min(x0, x1) - maxM) / cellM));
    const cy0 = Math.max(0, Math.floor((Math.min(y0, y1) - maxM) / cellM));
    const cx1 = Math.min(gw - 1, Math.floor((Math.max(x0, x1) + maxM) / cellM));
    const cy1 = Math.min(gh - 1, Math.floor((Math.max(y0, y1) + maxM) / cellM));
    for (let cy = cy0; cy <= cy1; cy += 1) {
      const py = (cy + 0.5) * cellM;
      const dy =
        py < Math.min(y0, y1) ? Math.min(y0, y1) - py : py > Math.max(y0, y1) ? py - Math.max(y0, y1) : 0;
      for (let cx = cx0; cx <= cx1; cx += 1) {
        const px = (cx + 0.5) * cellM;
        const dx =
          px < Math.min(x0, x1) ? Math.min(x0, x1) - px : px > Math.max(x0, x1) ? px - Math.max(x0, x1) : 0;
        const d2 = dx * dx + dy * dy;
        const k = cy * gw + cx;
        if (d2 < (out[k] ?? Number.POSITIVE_INFINITY)) out[k] = d2;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------
// Grime
// ---------------------------------------------------------------------------------------------------------

/** The `gutter` layer: GRIME_CELL bits per grime cell, plus the OPEN and GUTTER cell counts. */
export function computeGrimeCells(ctx: SpawnContext): { cells: Uint8Array; open: number; gutter: number } {
  const { w, h } = ctx.map;
  const n = GUTTER_CELLS_PER_TILE;
  const gw = w * n;
  const gh = h * n;
  const blocked = new Uint8Array(gw * gh);
  markFootprints(ctx, TILE_M / n, gw, gh, blocked);
  const cells = new Uint8Array(gw * gh);
  let open = 0;
  let gutter = 0;
  const band = GUTTER_BAND_CELLS;
  for (let ty = 0; ty < h; ty += 1) {
    for (let tx = 0; tx < w; tx += 1) {
      const t = ty * w + tx;
      if (ctx.route[t] !== 1 || ctx.skip[t] === 1) continue;
      const c = isRoadCell(ctx.map, t) ? (ctx.collide[t] ?? 0) : 0;
      for (let ly = 0; ly < n; ly += 1) {
        for (let lx = 0; lx < n; lx += 1) {
          const k = (ty * n + ly) * gw + tx * n + lx;
          if (blocked[k] === 1) continue;
          let bits: number = GRIME_CELL.OPEN;
          if (
            ((c & COLLIDE.KERB_EDGE_N) !== 0 && ly < band) ||
            ((c & COLLIDE.KERB_EDGE_S) !== 0 && ly >= n - band) ||
            ((c & COLLIDE.KERB_EDGE_W) !== 0 && lx < band) ||
            ((c & COLLIDE.KERB_EDGE_E) !== 0 && lx >= n - band)
          ) {
            bits |= GRIME_CELL.GUTTER;
            gutter += 1;
          }
          cells[k] = bits;
          open += 1;
        }
      }
    }
  }
  return { cells, open, gutter };
}

/** The `grimeDensity` layer: the highest covering zone density per route tile, 0..1 → 0..255. */
export function computeGrimeDensity(ctx: SpawnContext, zones: readonly ResolvedZone[]): Uint8Array {
  const { w, h } = ctx.map;
  const best = new Float64Array(w * h);
  for (const zone of zones) {
    let cover: Uint8Array;
    if ('rect' in zone) {
      cover = new Uint8Array(w * h);
      const [x, y, rw, rh] = zone.rect;
      for (let ty = Math.max(0, y); ty < Math.min(h, y + rh); ty += 1)
        for (let tx = Math.max(0, x); tx < Math.min(w, x + rw); tx += 1) cover[ty * w + tx] = 1;
    } else {
      cover = nearCover(zone.points, zone.radius * TILE_M, TILE_M, w, h);
    }
    for (let t = 0; t < w * h; t += 1) {
      if (cover[t] === 1 && zone.density > (best[t] ?? 0)) best[t] = zone.density;
    }
  }
  const out = new Uint8Array(w * h);
  for (let t = 0; t < w * h; t += 1) {
    if (ctx.route[t] === 1) out[t] = Math.round(Math.min(1, Math.max(0, best[t] ?? 0)) * 255);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------
// Litter
// ---------------------------------------------------------------------------------------------------------

/** Base weight of a litter sub-cell on a tile of `ground`, before hotspots (0 = not a litter ground). */
function baseWeight(ground: number, gutter: boolean): number {
  if (isRoadGround(ground)) return gutter ? LITTER_BASE_WEIGHT.roadGutter : LITTER_BASE_WEIGHT.roadCentre;
  switch (ground) {
    case Ground.Pavement:
      return LITTER_BASE_WEIGHT.pavement;
    case Ground.Alley:
      return LITTER_BASE_WEIGHT.alley;
    case Ground.Cobbles:
      return LITTER_BASE_WEIGHT.precinct;
    case Ground.Yard:
      return LITTER_BASE_WEIGHT.yard;
    default:
      return 0;
  }
}

export type LitterField = {
  /** LITTER_PLACE bits per sub-cell. */
  places: Uint8Array;
  /** Quantised weights per sub-cell (0..LITTER_WEIGHT_MAX). */
  weights: Uint16Array;
  /** The unquantised weights, after hotspots, constraints and the gutter rescale. */
  raw: Float64Array;
  /** Sub-cells with a non-zero weight. */
  candidates: number;
};

/**
 * The litter field for a level: places, then weights. `table` is the compiled type table (sorted, with
 * `requires`); `gutterBias` is the share of the total weight the road gutter must hold.
 */
export function computeLitterField(
  ctx: SpawnContext,
  table: readonly LitterTableEntry[],
  gutterBias: number,
  hotspots: readonly ResolvedHotspot[],
): LitterField {
  const { w, h } = ctx.map;
  const n = LITTER_CELLS_PER_TILE;
  const cellM = LITTER_CELL_M;
  const gw = w * n;
  const gh = h * n;
  const size = gw * gh;
  const blocked = new Uint8Array(size);
  markFootprints(ctx, cellM, gw, gh, blocked);
  const kerbD2 = kerbDistanceSq(kerbSegments(ctx), LITTER_NEAR_KERB_M, cellM, gw, gh);
  const trees = ctx.props.filter((p) => p.id === 'prop.tree').map((p): Point => [p.x, p.y]);
  const nearTree = nearCover(trees, LITTER_NEAR_TREE_M, cellM, gw, gh);
  const covers = hotspots.map((hs) => nearCover(hs.points, hs.radius * TILE_M, cellM, gw, gh));

  const places = new Uint8Array(size);
  const raw = new Float64Array(size);
  const gutterLimit = LITTER_GUTTER_M * LITTER_GUTTER_M;
  const kerbLimit = LITTER_NEAR_KERB_M * LITTER_NEAR_KERB_M;
  for (let cy = 0; cy < gh; cy += 1) {
    for (let cx = 0; cx < gw; cx += 1) {
      const k = cy * gw + cx;
      const t = Math.floor(cy / n) * w + Math.floor(cx / n);
      const ground = ctx.map.ground[t] ?? 0;
      const d2 = kerbD2[k] ?? Number.POSITIVE_INFINITY;
      let bits = 0;
      const gutter = isRoadGround(ground) && d2 <= gutterLimit;
      if (gutter) bits |= LITTER_PLACE.GUTTER;
      if (ground === Ground.Pavement) bits |= LITTER_PLACE.PAVEMENT;
      if (nearTree[k] === 1) bits |= LITTER_PLACE.NEAR_TREE;
      if (d2 <= kerbLimit) bits |= LITTER_PLACE.NEAR_KERB;
      places[k] = bits;
      if (ctx.route[t] !== 1 || ctx.skip[t] === 1 || blocked[k] === 1) continue;
      if (!table.some((e) => (bits & e.requires) === e.requires)) continue;
      let weight = baseWeight(ground, gutter);
      for (let j = 0; j < hotspots.length; j += 1) {
        if (covers[j]?.[k] === 1) weight *= hotspots[j]?.mult ?? 1;
      }
      raw[k] = weight;
    }
  }

  // Rescale the road gutter so it holds exactly `gutterBias` of the total weight (row-major sums).
  let gutterSum = 0;
  let otherSum = 0;
  for (let k = 0; k < size; k += 1) {
    if (((places[k] ?? 0) & LITTER_PLACE.GUTTER) !== 0) gutterSum += raw[k] ?? 0;
    else otherSum += raw[k] ?? 0;
  }
  if (gutterSum > 0 && otherSum > 0) {
    let gutterScale = 1;
    let otherScale = 1;
    if (gutterBias >= 1) otherScale = 0;
    else if (gutterBias <= 0) gutterScale = 0;
    else gutterScale = (gutterBias * otherSum) / ((1 - gutterBias) * gutterSum);
    for (let k = 0; k < size; k += 1) {
      raw[k] = (raw[k] ?? 0) * (((places[k] ?? 0) & LITTER_PLACE.GUTTER) !== 0 ? gutterScale : otherScale);
    }
  }

  let max = 0;
  for (let k = 0; k < size; k += 1) if ((raw[k] ?? 0) > max) max = raw[k] ?? 0;
  const weights = new Uint16Array(size);
  let candidates = 0;
  if (max > 0) {
    for (let k = 0; k < size; k += 1) {
      const v = raw[k] ?? 0;
      if (v <= 0) continue;
      weights[k] = Math.max(1, Math.round((v / max) * LITTER_WEIGHT_MAX));
      candidates += 1;
    }
  }
  return { places, weights, raw, candidates };
}
