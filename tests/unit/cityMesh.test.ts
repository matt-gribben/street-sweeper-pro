// SSP-017: the spike city mesh. Wall-emission rules, facade variant selection, metre UVs and the placeholder
// atlas, all on the pure geometry builders (no WebGL), plus a projection check with the real camera that a
// block in the top half of the screen shows its south face and one on the left its east face (ART_BIBLE §4.2).
import { Mesh, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { createCameraRig } from '../../src/render/camera.ts';
import {
  ATLAS_HEIGHT_PX,
  ATLAS_WIDTH_PX,
  AtlasTile,
  buildCityAtlasIndices,
  buildCityGeometryData,
  CELL_M,
  type CityGeometryData,
  type CityGrid,
  type CityWall,
  createCityMesh,
  emitWalls,
  FACADE_ELEMENT_RAMPS,
  FACADE_MODULE_H_PX,
  FACADE_MODULE_W_PX,
  FacadeVariant,
  Face,
  facadeModuleIndices,
  facadeVariant,
  faceNormal,
  GROUND_COLOURS,
  GroundType,
  groundTile,
  mergeBoxes,
  parseCityGrid,
  ROOF_COLOURS,
  RoofEdge,
  roofEdges,
  roofTileIndices,
  STOREY_M,
  TILE_PX,
  wallTile,
} from '../../src/render/cityMesh.ts';
import { paletteIndex } from '../../src/render/palettePass.ts';
import { SPIKE_CITY_ORIGIN_M, SPIKE_CITY_ROWS } from '../../src/render/spikeCity.ts';
import { rtWidthPx } from '../../src/render/upscale.ts';

const grid = (rows: readonly string[]): CityGrid => parseCityGrid(rows, 0, 0);

/** Walls lying on the vertical line x = `xM` between y0 and y1. */
const wallsOnX = (walls: readonly CityWall[], xM: number): CityWall[] =>
  walls.filter((w) => w.x0M === xM && w.x1M === xM);
const wallsOnY = (walls: readonly CityWall[], yM: number): CityWall[] =>
  walls.filter((w) => w.y0M === yM && w.y1M === yM);

function vertex(data: CityGeometryData, i: number): Vector3 {
  return new Vector3(data.positions[i * 3], data.positions[i * 3 + 1], data.positions[i * 3 + 2]);
}

/** Geometric normal of triangle `t` (vertices 3t..3t+2) from its winding. */
function triangleNormal(data: CityGeometryData, t: number): Vector3 {
  const a = vertex(data, t * 3);
  const b = vertex(data, t * 3 + 1);
  const c = vertex(data, t * 3 + 2);
  return b.sub(a).cross(c.sub(a)).normalize();
}

describe('parseCityGrid', () => {
  it('reads storeys and ground types, row 0 north', () => {
    const g = parseCityGrid(['.:3', '6..'], -4, 2);
    expect([g.cols, g.rows, g.originXM, g.originYM]).toEqual([3, 2, -4, 2]);
    expect(Array.from(g.storeys)).toEqual([0, 0, 3, 6, 0, 0]);
    expect(Array.from(g.ground)).toEqual([
      GroundType.Asphalt,
      GroundType.Slab,
      GroundType.Slab,
      GroundType.Slab,
      GroundType.Asphalt,
      GroundType.Asphalt,
    ]);
  });

  it('reads the kerb and grass swatch cells (SSP-021) and maps every ground type to its own flat tile', () => {
    const g = parseCityGrid(['.:k,'], 0, 0);
    expect(Array.from(g.ground)).toEqual([
      GroundType.Asphalt,
      GroundType.Slab,
      GroundType.Kerb,
      GroundType.Grass,
    ]);
    const data = buildCityGeometryData(g, 0);
    // One ground quad per cell (the types differ), in order, each on its type's tile.
    expect(data.vertexCount).toBe(24);
    expect([0, 6, 12, 18].map((v) => data.tiles[v])).toEqual([
      AtlasTile.GroundAsphalt,
      AtlasTile.GroundSlab,
      AtlasTile.GroundKerb,
      AtlasTile.GroundGrass,
    ]);
    expect([0, 6, 12, 18].map((v) => groundTile(g.ground[v / 6] ?? -1))).toEqual([
      AtlasTile.GroundAsphalt,
      AtlasTile.GroundSlab,
      AtlasTile.GroundKerb,
      AtlasTile.GroundGrass,
    ]);
    const atlas = buildCityAtlasIndices();
    const tileIndex = (tile: AtlasTile): number => atlas[tile * TILE_PX] ?? -1;
    expect(tileIndex(AtlasTile.GroundKerb)).toBe(paletteIndex('kerb'));
    expect(tileIndex(AtlasTile.GroundGrass)).toBe(paletteIndex('grass'));
    expect(ATLAS_WIDTH_PX).toBe(8 * TILE_PX);
  });

  it('rejects ragged rows and unknown cells', () => {
    expect(() => grid(['..', '.'])).toThrow(/expected 2/);
    expect(() => grid(['.x'])).toThrow(/unknown cell/);
    expect(() => grid(['9'])).toThrow(/unknown cell/);
    expect(() => grid([])).toThrow();
  });
});

describe('mergeBoxes', () => {
  it('merges equal-storey cells into one box per rectangle', () => {
    const boxes = mergeBoxes(grid(['.....', '.333.', '.333.', '.....']));
    expect(boxes).toEqual([{ x0M: 2, y0M: 2, x1M: 8, y1M: 6, storeys: 3, heightM: 7.5 }]);
  });

  it('keeps different heights apart and covers every building cell exactly once', () => {
    const g = grid(['3311', '1111', '66.6']);
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
});

describe('wall emission', () => {
  it('emits no wall between equal-height neighbours, even across separate boxes', () => {
    // Greedy merge splits this L into a 2-cell top box and a 1-cell bottom box; their shared edge has no wall.
    const g = grid(['33', '3.']);
    expect(mergeBoxes(g)).toHaveLength(2);
    const walls = emitWalls(g);
    expect(wallsOnX(walls, 2).filter((w) => w.y0M < 2)).toEqual([]); // inside the top box
    expect(wallsOnY(walls, 2).filter((w) => w.x0M < 2)).toEqual([]); // top box / bottom box seam
    for (const w of walls) expect(w.bottomM).toBe(0);
  });

  it('emits walls toward open cells from the ground and toward lower cells from their height', () => {
    const walls = emitWalls(grid(['.31.']));
    const east3 = wallsOnX(walls, 4);
    // Between the 3- and the 1-storey cell: only the taller cell's wall, from 2.5 m up, facing east.
    expect(east3).toEqual([{ face: Face.E, x0M: 4, y0M: 0, x1M: 4, y1M: 2, bottomM: 2.5, topM: 7.5 }]);
    expect(wallsOnX(walls, 2)).toEqual([
      { face: Face.W, x0M: 2, y0M: 0, x1M: 2, y1M: 2, bottomM: 0, topM: 7.5 },
    ]);
    expect(wallsOnX(walls, 6)).toEqual([
      { face: Face.E, x0M: 6, y0M: 0, x1M: 6, y1M: 2, bottomM: 0, topM: 2.5 },
    ]);
    // Never a wall facing a taller neighbour: the 1-storey cell has no west wall.
    expect(walls.filter((w) => w.face === Face.W && w.topM === 2.5)).toEqual([]);
  });

  it('treats cells outside the grid as open', () => {
    const walls = emitWalls(grid(['6']));
    expect(walls.map((w) => w.face).sort()).toEqual([Face.N, Face.E, Face.S, Face.W].sort());
    for (const w of walls) expect([w.bottomM, w.topM]).toEqual([0, 15]);
  });

  it('merges a wall run along an edge and splits it where the neighbour height changes', () => {
    const walls = emitWalls(grid(['3333', '11..']));
    expect(wallsOnY(walls, 0)).toEqual([
      { face: Face.N, x0M: 0, y0M: 0, x1M: 8, y1M: 0, bottomM: 0, topM: 7.5 },
    ]);
    const south = wallsOnY(walls, 2).filter((w) => w.face === Face.S);
    expect(south).toEqual([
      { face: Face.S, x0M: 0, y0M: 2, x1M: 4, y1M: 2, bottomM: 2.5, topM: 7.5 },
      { face: Face.S, x0M: 4, y0M: 2, x1M: 8, y1M: 2, bottomM: 0, topM: 7.5 },
    ]);
  });
});

describe('facade variants and geometry', () => {
  it('maps N/W to lit, E/S to dark and roofs to base', () => {
    expect(facadeVariant(Face.N)).toBe(FacadeVariant.Lit);
    expect(facadeVariant(Face.W)).toBe(FacadeVariant.Lit);
    expect(facadeVariant(Face.E)).toBe(FacadeVariant.Dark);
    expect(facadeVariant(Face.S)).toBe(FacadeVariant.Dark);
    expect(facadeVariant(Face.Up)).toBe(FacadeVariant.Base);
    expect([wallTile(Face.N), wallTile(Face.W), wallTile(Face.E), wallTile(Face.S)]).toEqual([
      AtlasTile.FacadeLit,
      AtlasTile.FacadeLit,
      AtlasTile.FacadeDark,
      AtlasTile.FacadeDark,
    ]);
  });

  it('gives every wall vertex the lit/dark tile of its face and winds every triangle outward', () => {
    const data = buildCityGeometryData(grid(['......', '.3361.', '.1111.', '......']));
    expect(data.vertexCount % 6).toBe(0);
    const seen = new Set<number>();
    for (let t = 0; t < data.vertexCount / 3; t++) {
      const face = data.faces[t * 3] as Face;
      const tile = data.tiles[t * 3];
      seen.add(face);
      const [nx, ny, nz] = faceNormal(face);
      const n = triangleNormal(data, t);
      expect(n.distanceTo(new Vector3(nx, ny, nz))).toBeLessThan(1e-6);
      if (face === Face.N || face === Face.W) expect(tile).toBe(AtlasTile.FacadeLit);
      else if (face === Face.E || face === Face.S) expect(tile).toBe(AtlasTile.FacadeDark);
      else if (vertex(data, t * 3).y > 0) expect(tile).toBe(AtlasTile.RoofSlate);
      else expect([AtlasTile.GroundAsphalt, AtlasTile.GroundSlab]).toContain(tile);
    }
    expect([...seen].sort()).toEqual([Face.N, Face.E, Face.S, Face.W, Face.Up]);
  });

  it('uses world-metre UVs: a 2 m × 1-storey wall spans exactly one facade module', () => {
    const data = buildCityGeometryData(grid(['1']), 0);
    for (let t = 0; t < data.vertexCount / 3; t++) {
      if (data.faces[t * 3] === Face.Up) continue;
      const us = [0, 1, 2].map((k) => data.uvs[(t * 3 + k) * 2] ?? Number.NaN);
      const vs = [0, 1, 2].map((k) => data.uvs[(t * 3 + k) * 2 + 1] ?? Number.NaN);
      expect(Math.max(...us) - Math.min(...us)).toBeCloseTo(CELL_M, 6);
      expect(Math.max(...vs) - Math.min(...vs)).toBeCloseTo(STOREY_M, 6);
      // Module edges land on the 2 m grid, so modules tile across cells.
      for (const u of us) expect(Math.abs(u % CELL_M)).toBeCloseTo(0, 6);
    }
    expect(FACADE_MODULE_W_PX).toBe(32);
    expect(FACADE_MODULE_H_PX).toBe(40);
  });

  it('puts ground on open cells only and roofs at the box height', () => {
    const g = grid(['.:', '6.']);
    const data = buildCityGeometryData(g, 0);
    let groundArea = 0;
    let roofArea = 0;
    for (let t = 0; t < data.vertexCount / 3; t++) {
      if (data.faces[t * 3] !== Face.Up) continue;
      const a = vertex(data, t * 3);
      const b = vertex(data, t * 3 + 1);
      const c = vertex(data, t * 3 + 2);
      const area = b.clone().sub(a).cross(c.clone().sub(a)).length() / 2;
      if (a.y === 0) groundArea += area;
      else {
        expect(a.y).toBe(15);
        roofArea += area;
      }
    }
    expect(groundArea).toBeCloseTo(3 * CELL_M * CELL_M, 6);
    expect(roofArea).toBeCloseTo(CELL_M * CELL_M, 6);
  });
});

describe('roof parapet edges', () => {
  it('flags only the edges that drop to a lower or open neighbour, never seams between merged boxes', () => {
    // The 1-storey L is two greedy boxes; the cells either side of their seam carry no flag on it.
    const g = grid(['3311', '1111']);
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

  it('gives each roof quad its cell flags, cell corner and world-metre UVs; walls and ground get 0', () => {
    const g = grid(['.6', '33']);
    const data = buildCityGeometryData(g, 0);
    let roofQuads = 0;
    for (let q = 0; q < data.vertexCount / 6; q++) {
      const first = q * 6;
      if (data.tiles[first] !== AtlasTile.RoofSlate) {
        for (let k = 0; k < 6; k++) {
          expect(data.roofEdges[first + k]).toBe(0);
          expect([data.roofCells[(first + k) * 2], data.roofCells[(first + k) * 2 + 1]]).toEqual([0, 0]);
        }
        continue;
      }
      roofQuads++;
      const centre = new Vector3();
      for (let k = 0; k < 6; k++) {
        const v = vertex(data, first + k);
        expect([data.uvs[(first + k) * 2], data.uvs[(first + k) * 2 + 1]]).toEqual([v.x, v.z]);
        centre.addScaledVector(v, 1 / 6);
      }
      const col = Math.floor(centre.x / CELL_M);
      const row = Math.floor(centre.z / CELL_M);
      for (let k = 0; k < 6; k++) {
        expect(data.roofEdges[first + k]).toBe(roofEdges(g, col, row));
        // The cell's NW corner, which the shader clamps the roof texel against.
        expect([data.roofCells[(first + k) * 2], data.roofCells[(first + k) * 2 + 1]]).toEqual([
          col * CELL_M,
          row * CELL_M,
        ]);
      }
    }
    expect(roofQuads).toBe(3); // one per building cell
    expect(roofEdges(g, 1, 0)).toBe(RoofEdge.N | RoofEdge.E | RoofEdge.S | RoofEdge.W);
    expect(roofEdges(g, 1, 1)).toBe(RoofEdge.E | RoofEdge.S);
  });
});

describe('placeholder atlas', () => {
  it('builds facades, roof and ground only from the declared palette indices', () => {
    const atlas = buildCityAtlasIndices();
    expect(atlas.length).toBe(ATLAS_WIDTH_PX * ATLAS_HEIGHT_PX);
    const allowed = new Set(
      [
        ...Object.values(FACADE_ELEMENT_RAMPS).flat(),
        ...Object.values(ROOF_COLOURS),
        ...Object.values(GROUND_COLOURS),
      ].map((name) => paletteIndex(name)),
    );
    for (const index of atlas) expect(allowed.has(index)).toBe(true);
  });

  it('shades the module lit/base/dark as brick 11/10/09', () => {
    const corner = (variant: FacadeVariant): number => facadeModuleIndices(variant)[0] ?? -1;
    expect(corner(FacadeVariant.Lit)).toBe(11);
    expect(corner(FacadeVariant.Base)).toBe(10);
    expect(corner(FacadeVariant.Dark)).toBe(9);
    // Glass is the only element shared by all variants; everything else steps along its ramp.
    const lit = facadeModuleIndices(FacadeVariant.Lit);
    const dark = facadeModuleIndices(FacadeVariant.Dark);
    let differing = 0;
    lit.forEach((l, i) => {
      if (l !== dark[i]) differing++;
    });
    expect(differing).toBeGreaterThan((lit.length * 3) / 4);
  });

  it('uses a slate roof of 02 with 03 courses every 4 px', () => {
    const roof = roofTileIndices();
    expect(roof.length).toBe(TILE_PX * TILE_PX);
    for (let row = 0; row < TILE_PX; row++) {
      expect(roof[row * TILE_PX]).toBe(row % 4 === 3 ? 3 : 2);
    }
    expect(paletteIndex(ROOF_COLOURS.parapetNw)).toBe(6);
    expect(paletteIndex(ROOF_COLOURS.parapetSe)).toBe(1);
  });
});

describe('createCityMesh', () => {
  it('is a single mesh with one geometry and frustum culling off (one draw call)', () => {
    const mesh = createCityMesh(parseCityGrid(SPIKE_CITY_ROWS, ...SPIKE_CITY_ORIGIN_M));
    expect(mesh).toBeInstanceOf(Mesh);
    expect(mesh.children).toHaveLength(0);
    expect(mesh.frustumCulled).toBe(false);
    expect(Array.isArray(mesh.material)).toBe(false);
    expect(mesh.geometry.index).toBeNull();
    expect(Object.keys(mesh.geometry.attributes).sort()).toEqual([
      'aRoofCellM',
      'aRoofEdges',
      'aTile',
      'aUvM',
      'position',
    ]);
  });
});

describe('building lean in the spike layout (camera over the origin, W = 480)', () => {
  const rig = createCameraRig(480);
  const width = rtWidthPx(480);
  const data = buildCityGeometryData(parseCityGrid(SPIKE_CITY_ROWS, ...SPIKE_CITY_ORIGIN_M));

  /** Screen-space signed area of triangle t (render-target pixels, y down); > 0 means front-facing (CCW). */
  function screenTriangle(t: number): { area: number; cx: number; cy: number } {
    const pts = [0, 1, 2].map((k) => {
      const p = vertex(data, t * 3 + k).project(rig.camera);
      return { x: ((p.x + 1) / 2) * width, y: ((1 - p.y) / 2) * 272 };
    });
    const [a, b, c] = pts as [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }];
    // y is down on screen, so counter-clockwise on screen has a negative cross product here.
    const area = -((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / 2;
    return { area, cx: (a.x + b.x + c.x) / 3, cy: (a.y + b.y + c.y) / 3 };
  }

  function visibleWallFaces(predicate: (cx: number, cy: number) => boolean): Set<Face> {
    const faces = new Set<Face>();
    for (let t = 0; t < data.vertexCount / 3; t++) {
      const face = data.faces[t * 3] as Face;
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
