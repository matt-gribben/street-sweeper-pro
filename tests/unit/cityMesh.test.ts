// SSP-017, SSP-045: the city mesh. The box merge, wall emission (only toward lower or open cells, split by
// neighbour height and facade style), lit/dark facade selection by face normal, world-metre UVs, roof variants and
// parapet edges, the combined vertex format, all on the pure geometry builders (no WebGL), plus a projection check
// with the real camera that a block in the top half of the screen shows its south face and one on the left its
// east face (ART_BIBLE §4.2).
import { Mesh, Texture, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { createCameraRig } from '../../src/render/camera.ts';
import {
  type AtlasRect,
  CELL_M,
  type CityGeometryData,
  CityGeometryWriter,
  type CityGrid,
  type CityStyles,
  type CityWall,
  cellHash,
  cellVariant,
  createCityMesh,
  dominantIndex,
  emitWalls,
  FacadeVariant,
  Face,
  facadeVariant,
  faceNormal,
  GRIME_NONE,
  GRIME_SLOT_COUNT,
  grimeCode,
  grimePatternSlot,
  grimeRank,
  grimeTexelIndex,
  grimeTexelShows,
  mergeBoxes,
  ROOF_PARAPET_NW,
  RoofEdge,
  roofEdges,
  roofParapetSe,
  STOREY_M,
  SurfaceKind,
  TRANSPARENT_TEXEL,
  VariantSalt,
  validateCityGrid,
  writeBuildings,
} from '../../src/render/cityMesh.ts';
import { KERBSIDE32, paletteIndex } from '../../src/render/palettePass.ts';
import { buildPlaceholderCityData, parseCityGrid } from '../../src/render/placeholderCity.ts';
import { SPIKE_CITY_ORIGIN_M, SPIKE_CITY_ROWS } from '../../src/render/spikeCity.ts';
import { rtWidthPx } from '../../src/render/upscale.ts';

/**
 * A building grid from strings: `rows` holds storeys (`.` open, `1`–`8`), `walls` optionally a facade style digit
 * per cell (default 1). Every building cell uses roof style 1. NW corner at the origin.
 */
function cityGrid(rows: readonly string[], walls?: readonly string[]): CityGrid {
  const cols = rows[0]?.length ?? 0;
  const n = cols * rows.length;
  const storeys = new Uint8Array(n);
  const wall = new Uint8Array(n);
  const roof = new Uint8Array(n);
  rows.forEach((line, r) => {
    for (let c = 0; c < cols; c++) {
      const ch = line[c] ?? '.';
      const i = r * cols + c;
      if (ch === '.') continue;
      storeys[i] = Number(ch);
      wall[i] = Number(walls?.[r]?.[c] ?? '1');
      roof[i] = 1;
    }
  });
  return { cols, rows: rows.length, originXM: 0, originYM: 0, storeys, wall, roof };
}

const rect = (x: number, y: number, w: number, h: number): AtlasRect => ({ x, y, w, h });

/** Two facade styles (distinct rects per variant) and one roof style with two variants. */
const STYLES: CityStyles = {
  facades: [
    undefined,
    { lit: rect(0, 0, 64, 80), base: rect(64, 0, 64, 80), dark: rect(128, 0, 64, 80) },
    { lit: rect(0, 100, 32, 80), base: rect(32, 100, 32, 80), dark: rect(64, 100, 32, 80) },
  ],
  roofs: [undefined, { variants: [rect(200, 0, 32, 32), rect(240, 0, 32, 32)], parapetSe: 1 }],
};

function buildingData(grid: CityGrid, styles: CityStyles = STYLES): CityGeometryData {
  const writer = new CityGeometryWriter();
  writeBuildings(grid, styles, writer);
  return writer.build();
}

/** Walls lying on the vertical line x = `xM` / the horizontal line y = `yM`. */
const wallsOnX = (walls: readonly CityWall[], xM: number): CityWall[] =>
  walls.filter((w) => w.x0M === xM && w.x1M === xM);
const wallsOnY = (walls: readonly CityWall[], yM: number): CityWall[] =>
  walls.filter((w) => w.y0M === yM && w.y1M === yM);

function vertex(data: CityGeometryData, i: number): Vector3 {
  return new Vector3(data.positions[i * 3], data.positions[i * 3 + 1], data.positions[i * 3 + 2]);
}

/** The three vertex indices of triangle `t`. */
function triangle(data: CityGeometryData, t: number): [number, number, number] {
  return [data.indices[t * 3] ?? -1, data.indices[t * 3 + 1] ?? -1, data.indices[t * 3 + 2] ?? -1];
}

/** Geometric normal of triangle `t` from its winding. */
function triangleNormal(data: CityGeometryData, t: number): Vector3 {
  const [a, b, c] = triangle(data, t).map((i) => vertex(data, i)) as [Vector3, Vector3, Vector3];
  return b.sub(a).cross(c.sub(a)).normalize();
}

/** The value of a per-vertex float attribute with `size` components, component `k`, at vertex `i`. */
const attr = (array: Float32Array, size: number, i: number, k = 0): number =>
  array[i * size + k] ?? Number.NaN;

describe('mergeBoxes', () => {
  it('merges equal-storey cells into one box per rectangle', () => {
    const boxes = mergeBoxes(cityGrid(['.....', '.333.', '.333.', '.....']));
    expect(boxes).toEqual([{ x0M: 2, y0M: 2, x1M: 8, y1M: 6, storeys: 3, heightM: 7.5 }]);
  });

  it('keeps different heights apart and covers every building cell exactly once', () => {
    const g = cityGrid(['3311', '1111', '66.6']);
    const boxes = mergeBoxes(g);
    const covered = new Uint8Array(g.cols * g.rows);
    for (const b of boxes) {
      expect(b.heightM).toBe(b.storeys * STOREY_M);
      for (let y = b.y0M; y < b.y1M; y += CELL_M) {
        for (let x = b.x0M; x < b.x1M; x += CELL_M) {
          const i = (y / CELL_M) * g.cols + x / CELL_M;
          expect(g.storeys[i]).toBe(b.storeys);
          covered[i] = (covered[i] ?? 0) + 1;
        }
      }
    }
    g.storeys.forEach((s, i) => {
      expect(covered[i]).toBe(s > 0 ? 1 : 0);
    });
  });

  it('does not split boxes by facade style (walls split instead)', () => {
    expect(mergeBoxes(cityGrid(['22'], ['12']))).toHaveLength(1);
  });
});

describe('wall emission', () => {
  it('two adjacent 2-storey cells and a 3-storey cell: only walls facing lower or open cells (acceptance)', () => {
    const g = cityGrid(['223']);
    const walls = emitWalls(g);
    // The 2-storey pair is one box: N, S and W walls toward open cells, none toward the taller 3-storey cell.
    // The 3-storey cell: N, S and E toward open cells, and W toward the lower pair from 5 m up.
    expect(walls).toHaveLength(7);
    expect(wallsOnX(walls, 4)).toEqual([
      { face: Face.W, x0M: 4, y0M: 0, x1M: 4, y1M: 2, bottomM: 5, topM: 7.5, style: 1 },
    ]);
    expect(walls.filter((w) => w.face === Face.E && w.topM === 5)).toEqual([]);
    expect(wallsOnY(walls, 0).map((w) => [w.face, w.x0M, w.x1M, w.topM])).toEqual([
      [Face.N, 0, 4, 5],
      [Face.N, 4, 6, 7.5],
    ]);

    // Geometry: 7 wall quads and 3 roof quads, 4 vertices and 2 triangles each, nothing else.
    const data = buildingData(g);
    expect(data.quadCount).toBe(10);
    expect(data.vertexCount).toBe(40);
    expect(data.indices.length).toBe(60);
    expect([...data.kinds].filter((k) => k === SurfaceKind.Wall)).toHaveLength(7);
    expect([...data.kinds].filter((k) => k === SurfaceKind.Roof)).toHaveLength(3);
    expect([...data.faces].filter((f) => f === Face.E)).toHaveLength(1);
    expect([...data.faces].filter((f) => f === Face.W)).toHaveLength(2);
  });

  it('emits no wall between equal-height neighbours, even across separate boxes', () => {
    // Greedy merge splits this L into a 2-cell top box and a 1-cell bottom box; their shared edge has no wall.
    const g = cityGrid(['33', '3.']);
    expect(mergeBoxes(g)).toHaveLength(2);
    const walls = emitWalls(g);
    expect(wallsOnX(walls, 2).filter((w) => w.y0M < 2)).toEqual([]); // inside the top box
    expect(wallsOnY(walls, 2).filter((w) => w.x0M < 2)).toEqual([]); // top box / bottom box seam
    for (const w of walls) expect(w.bottomM).toBe(0);
  });

  it('emits walls toward open cells from the ground and toward lower cells from their height', () => {
    const walls = emitWalls(cityGrid(['.31.']));
    expect(wallsOnX(walls, 4)).toEqual([
      { face: Face.E, x0M: 4, y0M: 0, x1M: 4, y1M: 2, bottomM: 2.5, topM: 7.5, style: 1 },
    ]);
    expect(wallsOnX(walls, 2)).toEqual([
      { face: Face.W, x0M: 2, y0M: 0, x1M: 2, y1M: 2, bottomM: 0, topM: 7.5, style: 1 },
    ]);
    expect(wallsOnX(walls, 6)).toEqual([
      { face: Face.E, x0M: 6, y0M: 0, x1M: 6, y1M: 2, bottomM: 0, topM: 2.5, style: 1 },
    ]);
    // Never a wall facing a taller neighbour: the 1-storey cell has no west wall.
    expect(walls.filter((w) => w.face === Face.W && w.topM === 2.5)).toEqual([]);
  });

  it('treats cells outside the grid as open', () => {
    const walls = emitWalls(cityGrid(['6']));
    expect(walls.map((w) => w.face).sort()).toEqual([Face.N, Face.E, Face.S, Face.W].sort());
    for (const w of walls) expect([w.bottomM, w.topM]).toEqual([0, 15]);
  });

  it('merges a wall run along an edge and splits it where the neighbour height changes', () => {
    const walls = emitWalls(cityGrid(['3333', '11..']));
    expect(wallsOnY(walls, 0)).toEqual([
      { face: Face.N, x0M: 0, y0M: 0, x1M: 8, y1M: 0, bottomM: 0, topM: 7.5, style: 1 },
    ]);
    expect(wallsOnY(walls, 2).filter((w) => w.face === Face.S)).toEqual([
      { face: Face.S, x0M: 0, y0M: 2, x1M: 4, y1M: 2, bottomM: 2.5, topM: 7.5, style: 1 },
      { face: Face.S, x0M: 4, y0M: 2, x1M: 8, y1M: 2, bottomM: 0, topM: 7.5, style: 1 },
    ]);
  });

  it('splits a wall run where the facade style of the cells behind it changes', () => {
    const walls = emitWalls(cityGrid(['222'], ['112']));
    expect(wallsOnY(walls, 0).map((w) => [w.x0M, w.x1M, w.style])).toEqual([
      [0, 4, 1],
      [4, 6, 2],
    ]);
    // The east wall belongs to the style-2 cell, the west wall to a style-1 cell.
    expect(walls.find((w) => w.face === Face.E)?.style).toBe(2);
    expect(walls.find((w) => w.face === Face.W)?.style).toBe(1);
  });

  it('rejects a building cell without a wall or roof style', () => {
    const g = cityGrid(['2']);
    expect(() => validateCityGrid({ ...g, wall: new Uint8Array(1) })).toThrow(/no wall or roof style/);
    expect(() => buildingData(g, { facades: [undefined], roofs: STYLES.roofs })).toThrow(/no facade style/);
  });
});

describe('facade variants and geometry', () => {
  it('maps N/W to lit, E/S to dark and roofs to base', () => {
    expect(facadeVariant(Face.N)).toBe(FacadeVariant.Lit);
    expect(facadeVariant(Face.W)).toBe(FacadeVariant.Lit);
    expect(facadeVariant(Face.E)).toBe(FacadeVariant.Dark);
    expect(facadeVariant(Face.S)).toBe(FacadeVariant.Dark);
    expect(facadeVariant(Face.Up)).toBe(FacadeVariant.Base);
  });

  it('gives every wall the lit/dark bay of its own style and winds every triangle outward', () => {
    const g = cityGrid(['......', '.3362.', '.1111.', '......'], ['......', '.1112.', '.2222.', '......']);
    const data = buildingData(g);
    const walls = emitWalls(g);
    const seen = new Set<number>();
    for (let q = 0; q < data.quadCount; q++) {
      const face = data.faces[q] as Face;
      seen.add(face);
      const [nx, ny, nz] = faceNormal(face);
      for (const t of [q * 2, q * 2 + 1]) {
        expect(triangleNormal(data, t).distanceTo(new Vector3(nx, ny, nz))).toBeLessThan(1e-6);
      }
      const v = q * 4;
      const rx = attr(data.rects, 4, v);
      if (data.kinds[q] === SurfaceKind.Wall) {
        const wall = walls[q];
        expect(wall?.face).toBe(face);
        const style = STYLES.facades[wall?.style ?? 0];
        const lit = face === Face.N || face === Face.W;
        expect(rx).toBe(lit ? style?.lit.x : style?.dark.x);
        expect(attr(data.rects, 4, v, 1)).toBe(lit ? style?.lit.y : style?.dark.y);
        expect(attr(data.info, 4, v, 3)).toBe(0); // no grime on walls
      } else {
        expect(data.kinds[q]).toBe(SurfaceKind.Roof);
        expect([200, 240]).toContain(rx);
        expect(attr(data.info, 4, v, 3)).toBe(0); // no grime on roofs
      }
    }
    expect([...seen].sort()).toEqual([Face.N, Face.E, Face.S, Face.W, Face.Up]);
  });

  it('uses world-metre UVs: a 2 m × 1-storey wall spans exactly one facade module', () => {
    const data = buildingData(cityGrid(['1']));
    for (let q = 0; q < data.quadCount; q++) {
      if (data.kinds[q] !== SurfaceKind.Wall) continue;
      const us = [0, 1, 2, 3].map((k) => attr(data.uvs, 2, q * 4 + k, 0));
      const vs = [0, 1, 2, 3].map((k) => attr(data.uvs, 2, q * 4 + k, 1));
      expect(Math.max(...us) - Math.min(...us)).toBeCloseTo(CELL_M, 6);
      expect(Math.max(...vs) - Math.min(...vs)).toBeCloseTo(STOREY_M, 6);
      // Module edges land on the 2 m grid, so modules tile across cells; v is height above the ground.
      for (const u of us) expect(Math.abs(u % CELL_M)).toBeCloseTo(0, 6);
      expect(Math.min(...vs)).toBe(0);
    }
  });

  it('runs u left to right as seen from outside on every face', () => {
    const data = buildingData(cityGrid(['2']));
    for (let q = 0; q < data.quadCount; q++) {
      if (data.kinds[q] !== SurfaceKind.Wall) continue;
      // Corners 0 → 1 run along the bottom edge in the writer's order; seen from outside, u must grow toward
      // the viewer's right, which is up × outward normal = (nz, 0, −nx).
      const p0 = vertex(data, q * 4);
      const p1 = vertex(data, q * 4 + 1);
      const du = attr(data.uvs, 2, q * 4 + 1) - attr(data.uvs, 2, q * 4);
      const [nx, , nz] = faceNormal(data.faces[q] as Face);
      const right = new Vector3(nz, 0, -nx);
      expect(Math.sign(du)).toBe(Math.sign(p1.clone().sub(p0).dot(right)));
    }
  });
});

describe('roofs', () => {
  it('flags only the edges that drop to a lower or open neighbour, never seams between merged boxes', () => {
    const g = cityGrid(['3311', '1111']);
    expect(mergeBoxes(g).filter((b) => b.storeys === 1)).toHaveLength(2);
    const { N, E, S, W } = RoofEdge;
    expect(roofEdges(g, 0, 0)).toBe(N | S | W);
    expect(roofEdges(g, 1, 0)).toBe(N | E | S);
    expect(roofEdges(g, 2, 0)).toBe(N); // west neighbour is taller, south is equal
    expect(roofEdges(g, 3, 0)).toBe(N | E);
    expect(roofEdges(g, 1, 1)).toBe(S); // seam with (2, 1) and the taller cell above: no line
    expect(roofEdges(g, 2, 1)).toBe(S);
    expect(roofEdges(g, 0, 1)).toBe(S | W);
  });

  it('gives each roof quad its height, cell corner, edge bits, hashed variant and SE parapet', () => {
    const g = cityGrid(['.6', '33']);
    const data = buildingData(g);
    let roofs = 0;
    for (let q = 0; q < data.quadCount; q++) {
      if (data.kinds[q] !== SurfaceKind.Roof) continue;
      roofs++;
      const centre = new Vector3();
      for (let k = 0; k < 4; k++) centre.addScaledVector(vertex(data, q * 4 + k), 1 / 4);
      const col = Math.floor(centre.x / CELL_M);
      const row = Math.floor(centre.z / CELL_M);
      expect(centre.y).toBe((g.storeys[row * g.cols + col] ?? 0) * STOREY_M);
      const variant = cellVariant(col, row, 2, VariantSalt.Roof);
      for (let k = 0; k < 4; k++) {
        const v = q * 4 + k;
        const p = vertex(data, v);
        expect([attr(data.uvs, 2, v, 0), attr(data.uvs, 2, v, 1)]).toEqual([p.x, p.z]);
        expect([attr(data.cells, 2, v, 0), attr(data.cells, 2, v, 1)]).toEqual([col * CELL_M, row * CELL_M]);
        expect(attr(data.info, 4, v, 0)).toBe(SurfaceKind.Roof);
        expect(attr(data.info, 4, v, 1)).toBe(roofEdges(g, col, row));
        expect(attr(data.info, 4, v, 2)).toBe(1);
        expect(attr(data.rects, 4, v, 0)).toBe(STYLES.roofs[1]?.variants[variant]?.x);
      }
    }
    expect(roofs).toBe(3); // one per building cell
  });

  it('takes the SE parapet from the roof frame: the shadow step of its dominant index', () => {
    // A 2×2 "atlas" of index 2 with one 3: dominant 2, and slate 02's dark step is 01 (ART_BIBLE §9.3).
    const indices = new Uint8Array([2, 2, 255, 3, 2, 255]);
    expect(dominantIndex(indices, 3, rect(0, 0, 2, 2))).toBe(2);
    expect(roofParapetSe(2)).toBe(1);
    expect(roofParapetSe(5)).toBe(KERBSIDE32.shadow[5]);
    expect(() => dominantIndex(indices, 3, rect(2, 0, 1, 2))).toThrow(/no opaque texel/);
    expect(paletteIndex(ROOF_PARAPET_NW)).toBe(6);
  });
});

describe('cell variant hash', () => {
  it('is deterministic, salted and uses every variant over a district', () => {
    expect(cellHash(5, 7, 0)).toBe(cellHash(5, 7, 0));
    expect(cellHash(5, 7, 0)).not.toBe(cellHash(5, 7, 1));
    expect(cellHash(5, 7, 0)).not.toBe(cellHash(7, 5, 0));
    const counts = [0, 0, 0, 0];
    for (let y = 0; y < 48; y++) {
      for (let x = 0; x < 64; x++) {
        const v = cellVariant(x, y, 4, VariantSalt.Ground);
        counts[v] = (counts[v] ?? 0) + 1;
      }
    }
    // 3072 cells over 4 variants: each within 15% of an even share.
    for (const c of counts) expect(Math.abs(c - 768)).toBeLessThan(768 * 0.15);
    expect(() => cellVariant(0, 0, 0, 0)).toThrow();
  });
});

describe('vertex format and mesh', () => {
  it('carries a grime code on ground and markings only (SSP-066)', () => {
    const writer = new CityGeometryWriter();
    const code = grimeCode(5, 9);
    writer.groundQuad(0, 0, 2, 2, SurfaceKind.Ground, rect(0, 0, 32, 32), code);
    writer.groundQuad(0, 0, 2, 2, SurfaceKind.Overlay, rect(32, 0, 32, 32), code);
    writer.skirt(0, 0, 2, 2, 10, rect(0, 0, 32, 32));
    expect(() => writer.groundQuad(0, 0, 2, 2, SurfaceKind.Skirt, rect(0, 0, 32, 32), code)).toThrow(
      /only ground and marking quads/,
    );
    const data = writer.build();
    expect([...data.kinds]).toEqual([
      SurfaceKind.Ground,
      SurfaceKind.Overlay,
      SurfaceKind.Skirt,
      SurfaceKind.Skirt,
      SurfaceKind.Skirt,
      SurfaceKind.Skirt,
    ]);
    const grime = [0, 1, 2, 3, 4, 5].map((q) => attr(data.info, 4, q * 4, 3));
    expect(grime).toEqual([code, code, GRIME_NONE, GRIME_NONE, GRIME_NONE, GRIME_NONE]);
    // The default is no grime (the M0 placeholder city).
    const plain = new CityGeometryWriter();
    plain.groundQuad(0, 0, 2, 2, SurfaceKind.Ground, rect(0, 0, 32, 32));
    expect(attr(plain.build().info, 4, 0, 3)).toBe(GRIME_NONE);
    // Ground quads face up and clamp to their own cell.
    expect([attr(data.cells, 2, 0, 0), attr(data.cells, 2, 0, 1)]).toEqual([0, 0]);
    for (let t = 0; t < data.indices.length / 3; t++) {
      expect(triangleNormal(data, t).distanceTo(new Vector3(0, 1, 0))).toBeLessThan(1e-6);
    }
  });

  it('is a single indexed mesh with one material and frustum culling off (one draw call)', () => {
    const data = buildPlaceholderCityData(parseCityGrid(SPIKE_CITY_ROWS, ...SPIKE_CITY_ORIGIN_M));
    const mesh = createCityMesh(data, new Texture());
    expect(mesh).toBeInstanceOf(Mesh);
    expect(mesh.name).toBe('cityMesh');
    expect(mesh.children).toHaveLength(0);
    expect(mesh.frustumCulled).toBe(false);
    expect(Array.isArray(mesh.material)).toBe(false);
    expect(mesh.geometry.index?.count).toBe(data.indices.length);
    expect(Object.keys(mesh.geometry.attributes).sort()).toEqual([
      'aCellM',
      'aInfo',
      'aRect',
      'aUvM',
      'position',
    ]);
  });
});

describe('grime encoding and the CPU mirror of the shader step (SSP-066)', () => {
  it('packs a surface slot and a gutter slot, and picks the gutter slot by mask bit 7', () => {
    for (let surface = 0; surface < GRIME_SLOT_COUNT; surface++) {
      for (let gutter = 0; gutter < GRIME_SLOT_COUNT; gutter++) {
        const code = grimeCode(surface, gutter);
        expect(code).toBeGreaterThan(GRIME_NONE);
        expect(grimePatternSlot(code, 100)).toBe(surface);
        expect(grimePatternSlot(code, 128 | 100)).toBe(gutter);
      }
    }
    expect(() => grimeCode(GRIME_SLOT_COUNT, 0)).toThrow();
    expect(() => grimeCode(0, -1)).toThrow();
    expect(() => grimeCode(0.5, 0)).toThrow();
  });

  it('ranks texels 0..127 roughly evenly and statelessly', () => {
    const counts = new Array<number>(8).fill(0);
    for (let y = 0; y < 128; y++) {
      for (let x = 0; x < 128; x++) {
        const r = grimeRank(x, y);
        expect(r).toBeGreaterThanOrEqual(0);
        expect(r).toBeLessThan(128);
        expect(grimeRank(x, y)).toBe(r);
        counts[r >> 4] = (counts[r >> 4] ?? 0) + 1;
      }
    }
    for (const c of counts) expect(Math.abs(c - 2048)).toBeLessThan(2048 * 0.1);
  });

  it('shows every pattern texel at full intensity, about 3/4 at the laid minimum and none when clean', () => {
    let full = 0;
    let min = 0;
    let gutterMin = 0;
    let clean = 0;
    const n = 64 * 64;
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        const r = grimeRank(x, y);
        if (grimeTexelShows(127, r)) full++;
        if (grimeTexelShows(64, r)) min++;
        if (grimeTexelShows(128 | 64, r)) gutterMin++;
        if (grimeTexelShows(0, r) || grimeTexelShows(128, r)) clean++;
      }
    }
    expect(full).toBe(n);
    expect(min / n).toBeGreaterThan(0.7);
    expect(min / n).toBeLessThan(0.82);
    expect(gutterMin).toBe(min); // bit 7 picks the pattern, not the strength
    expect(clean).toBe(0);
  });

  it('draws the pattern index where it shows and the clean index elsewhere or where it is transparent', () => {
    expect(grimeTexelIndex(2, 127, 3, 4, 8)).toBe(8);
    expect(grimeTexelIndex(2, 127, 3, 4, TRANSPARENT_TEXEL)).toBe(2);
    expect(grimeTexelIndex(2, 0, 3, 4, 8)).toBe(2);
  });
});

describe('building lean in the spike layout (camera over the origin, W = 480)', () => {
  const rig = createCameraRig(480);
  const width = rtWidthPx(480);
  const data = buildPlaceholderCityData(parseCityGrid(SPIKE_CITY_ROWS, ...SPIKE_CITY_ORIGIN_M));

  /** Screen-space signed area of triangle t (render-target pixels, y down); > 0 means front-facing (CCW). */
  function screenTriangle(t: number): { area: number; cx: number; cy: number } {
    const pts = triangle(data, t).map((i) => {
      const p = vertex(data, i).project(rig.camera);
      return { x: ((p.x + 1) / 2) * width, y: ((1 - p.y) / 2) * 272 };
    });
    const [a, b, c] = pts as [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }];
    // y is down on screen, so counter-clockwise on screen has a negative cross product here.
    const area = -((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / 2;
    return { area, cx: (a.x + b.x + c.x) / 3, cy: (a.y + b.y + c.y) / 3 };
  }

  function visibleWallFaces(predicate: (cx: number, cy: number) => boolean): Set<Face> {
    const faces = new Set<Face>();
    for (let t = 0; t < data.indices.length / 3; t++) {
      const face = data.faces[Math.floor(t / 2)] as Face;
      if (face === Face.Up) continue;
      const { area, cx, cy } = screenTriangle(t);
      if (area > 0.5 && predicate(cx, cy)) faces.add(face);
    }
    return faces;
  }

  it('shows south faces in the top half and never north faces there', () => {
    const top = visibleWallFaces((_x, y) => y < 136 - 8);
    expect(top.has(Face.S)).toBe(true);
    expect(top.has(Face.N)).toBe(false);
  });

  it('shows east faces on the left and never west faces there', () => {
    const left = visibleWallFaces((x) => x < width / 2 - 8);
    expect(left.has(Face.E)).toBe(true);
    expect(left.has(Face.W)).toBe(false);
  });

  it('shows north faces in the bottom half and west faces on the right', () => {
    expect(visibleWallFaces((_x, y) => y > 136 + 8).has(Face.N)).toBe(true);
    expect(visibleWallFaces((x) => x > width / 2 + 8).has(Face.W)).toBe(true);
  });
});
