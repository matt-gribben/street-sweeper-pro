// SSP-017 / SSP-021 / SSP-045: the M0 placeholder city the spike scenes draw through the shared city renderer:
// the ASCII grid parser, the ground quads per open cell and the code-defined placeholder atlas (indices only,
// from declared Kerbside-32 names).
import { describe, expect, it } from 'vitest';
import { FacadeVariant, SurfaceKind } from '../../src/render/cityMesh.ts';
import { paletteIndex } from '../../src/render/palettePass.ts';
import {
  buildPlaceholderAtlasIndices,
  buildPlaceholderCityData,
  FACADE_ELEMENT_RAMPS,
  FACADE_MODULE_H_PX,
  FACADE_MODULE_W_PX,
  facadeModuleIndices,
  GROUND_COLOURS,
  GroundType,
  groundTile,
  PLACEHOLDER_ATLAS_HEIGHT_PX,
  PLACEHOLDER_ATLAS_WIDTH_PX,
  PlaceholderTile,
  parseCityGrid,
  placeholderRect,
  placeholderStyles,
  ROOF_COLOURS,
  roofTileIndices,
} from '../../src/render/placeholderCity.ts';

describe('parseCityGrid', () => {
  it('reads storeys and ground types, row 0 north, and names style 1 on every building cell', () => {
    const g = parseCityGrid(['.:3', '6..'], -4, 2);
    expect([g.cols, g.rows, g.originXM, g.originYM]).toEqual([3, 2, -4, 2]);
    expect(Array.from(g.storeys)).toEqual([0, 0, 3, 6, 0, 0]);
    expect(Array.from(g.wall)).toEqual([0, 0, 1, 1, 0, 0]);
    expect(Array.from(g.roof)).toEqual([0, 0, 1, 1, 0, 0]);
    expect(Array.from(g.ground)).toEqual([
      GroundType.Asphalt,
      GroundType.Slab,
      GroundType.Slab,
      GroundType.Slab,
      GroundType.Asphalt,
      GroundType.Asphalt,
    ]);
  });

  it('rejects ragged rows and unknown cells', () => {
    expect(() => parseCityGrid(['..', '.'], 0, 0)).toThrow(/expected 2/);
    expect(() => parseCityGrid(['.x'], 0, 0)).toThrow(/unknown cell/);
    expect(() => parseCityGrid(['9'], 0, 0)).toThrow(/unknown cell/);
    expect(() => parseCityGrid([], 0, 0)).toThrow();
  });
});

describe('placeholder geometry', () => {
  it('draws one ground quad per open cell on its type tile, then the skirt, walls and roofs', () => {
    const g = parseCityGrid(['.:k,', '..6.'], 0, 0);
    const data = buildPlaceholderCityData(g, 0);
    const ground = [...data.kinds].map((k, q) => [k, q] as const).filter(([k]) => k === SurfaceKind.Ground);
    expect(ground).toHaveLength(7); // 8 cells minus one building cell
    expect(ground.slice(0, 4).map(([, q]) => data.rects[q * 16])).toEqual(
      [
        PlaceholderTile.GroundAsphalt,
        PlaceholderTile.GroundSlab,
        PlaceholderTile.GroundKerb,
        PlaceholderTile.GroundGrass,
      ].map((t) => placeholderRect(t).x),
    );
    expect([0, 1, 2, 3].map(groundTile)).toEqual([
      PlaceholderTile.GroundAsphalt,
      PlaceholderTile.GroundSlab,
      PlaceholderTile.GroundKerb,
      PlaceholderTile.GroundGrass,
    ]);
    expect([...data.kinds].filter((k) => k === SurfaceKind.Roof)).toHaveLength(1);
    expect([...data.kinds].filter((k) => k === SurfaceKind.Wall)).toHaveLength(4);
    expect([...data.kinds].filter((k) => k === SurfaceKind.Skirt)).toHaveLength(0);
    expect([...buildPlaceholderCityData(g).kinds].filter((k) => k === SurfaceKind.Skirt)).toHaveLength(4);
  });

  it('uses a one-module bay for the facade and the slate roof with the 01 SE parapet', () => {
    const styles = placeholderStyles();
    expect(styles.facades[1]?.lit).toEqual({ x: 0, y: 0, w: 32, h: 80 });
    expect(styles.facades[1]?.dark).toEqual({ x: 64, y: 0, w: 32, h: 80 });
    expect(styles.roofs[1]?.variants).toEqual([{ x: 96, y: 0, w: 32, h: 32 }]);
    expect(styles.roofs[1]?.parapetSe).toBe(paletteIndex('tar'));
  });
});

describe('placeholder atlas', () => {
  it('builds facades, roof and ground only from the declared palette indices', () => {
    const atlas = buildPlaceholderAtlasIndices();
    expect(atlas.length).toBe(PLACEHOLDER_ATLAS_WIDTH_PX * PLACEHOLDER_ATLAS_HEIGHT_PX);
    const allowed = new Set(
      [
        ...Object.values(FACADE_ELEMENT_RAMPS).flat(),
        ...Object.values(ROOF_COLOURS),
        ...Object.values(GROUND_COLOURS),
      ].map((name) => paletteIndex(name)),
    );
    for (const index of atlas) expect(allowed.has(index)).toBe(true);
  });

  it('repeats the module in both storeys of the facade bay', () => {
    const atlas = buildPlaceholderAtlasIndices();
    const lit = facadeModuleIndices(FacadeVariant.Lit);
    for (let row = 0; row < 2 * FACADE_MODULE_H_PX; row++) {
      const src = row % FACADE_MODULE_H_PX;
      expect(
        Array.from(atlas.subarray(row * PLACEHOLDER_ATLAS_WIDTH_PX, row * PLACEHOLDER_ATLAS_WIDTH_PX + 32)),
      ).toEqual(Array.from(lit.subarray(src * FACADE_MODULE_W_PX, (src + 1) * FACADE_MODULE_W_PX)));
    }
    expect(atlas[PlaceholderTile.GroundKerb * 32]).toBe(paletteIndex('kerb'));
    expect(atlas[PlaceholderTile.GroundGrass * 32]).toBe(paletteIndex('grass'));
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
    expect(roof.length).toBe(32 * 32);
    for (let row = 0; row < 32; row++) {
      expect(roof[row * 32]).toBe(row % 4 === 3 ? 3 : 2);
    }
  });
});
