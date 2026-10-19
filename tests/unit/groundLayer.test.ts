// SSP-045: the ground layer of a compiled level on small fixtures (pure, no WebGL): ground id → tile family with a
// hashed variant, kerb blob frames, site tiles, marking overlays (dash phase, kerb sides), no ground under
// buildings, 16×16-tile chunking into the shared city writer, and the skirt.
import { describe, expect, it } from 'vitest';
import { FRAME, type FrameId } from '../../src/gen/assets.ts';
import {
  CELL_M,
  CityGeometryWriter,
  cellVariant,
  SurfaceKind,
  VariantSalt,
} from '../../src/render/cityMesh.ts';
import {
  cellGroundFrames,
  GROUND_CHUNK_TILES,
  GROUND_TILE_ASSET,
  groundFrameTables,
  siteVariant,
  writeGroundLayer,
} from '../../src/render/groundLayer.ts';
import { frameRect } from '../../src/render/worldFrames.ts';
import { AUTOTILE_NONE, COLLIDE, createBlankLevel, Ground, type Level, MARKING } from '../../src/sim/map.ts';

/** A w×h level of plain road. */
function roadLevel(w: number, h: number): Level {
  const level = createBlankLevel('district.ground_fixture', w, h);
  level.layers.ground.fill(Ground.Road);
  return level;
}

function framesAt(level: Level, x: number, y: number) {
  return cellGroundFrames(level, groundFrameTables(level), x, y);
}

const set = (
  level: Level,
  layer: 'ground' | 'autotile' | 'markings' | 'collide' | 'storeys',
  x: number,
  y: number,
  v: number,
): void => {
  level.layers[layer][y * level.size[0] + x] = v;
};

describe('ground id → tile', () => {
  it('maps every drivable ground to its family (ART_BIBLE §9.1) and picks the hashed variant', () => {
    const expected: Record<number, string> = {
      [Ground.Road]: 'tile.asphalt',
      [Ground.RoadOneWayE]: 'tile.asphalt',
      [Ground.RoadOneWayW]: 'tile.asphalt',
      [Ground.RoadOneWayN]: 'tile.asphalt',
      [Ground.RoadOneWayS]: 'tile.asphalt',
      [Ground.Pavement]: 'tile.pavement',
      [Ground.Cobbles]: 'tile.setts',
      [Ground.Alley]: 'tile.setts',
      [Ground.Grass]: 'tile.grass',
      [Ground.Yard]: 'tile.apron',
      [Ground.Apron]: 'tile.apron',
    };
    for (const [id, asset] of Object.entries(expected)) {
      expect(GROUND_TILE_ASSET[Number(id)]).toBe(asset);
      const level = roadLevel(8, 8);
      level.layers.ground.fill(Number(id));
      const variants = Object.keys(FRAME).filter((f) => f.startsWith(`${asset}:v:-:`)).length;
      for (const [x, y] of [
        [0, 0],
        [3, 5],
        [7, 7],
      ] as const) {
        const { base, overlays } = framesAt(level, x, y);
        expect(base).toBe(`${asset}:v:-:${cellVariant(x, y, variants, VariantSalt.Ground)}`);
        expect(overlays).toEqual([]);
      }
    }
  });

  it('fails loudly on an open cell whose ground has no M1 tile (void, water, sand)', () => {
    for (const id of [Ground.Void, Ground.Water, Ground.Sand]) {
      const level = roadLevel(2, 2);
      set(level, 'ground', 1, 1, id);
      expect(() => framesAt(level, 1, 1)).toThrow(/has no tile frame/);
    }
  });

  it('draws no ground under a building', () => {
    const level = roadLevel(2, 2);
    set(level, 'storeys', 0, 0, 2);
    set(level, 'ground', 0, 0, Ground.Void);
    expect(framesAt(level, 0, 0)).toEqual({ base: null, overlays: [] });
  });

  it('draws kerb blob n as tile.kerb:blob:-:n over the cell ground', () => {
    const level = roadLevel(2, 1);
    set(level, 'ground', 0, 0, Ground.Pavement);
    set(level, 'autotile', 0, 0, 12);
    expect(framesAt(level, 0, 0).base).toBe('tile.kerb:blob:-:12');
    expect(level.layers.autotile[1]).toBe(AUTOTILE_NONE);
    expect(framesAt(level, 1, 0).base?.startsWith('tile.asphalt:v:-:')).toBe(true);
  });
});

describe('sites', () => {
  it('draws speed bumps and zebras across the merged rect: v0 for a north–south road, v1 for east–west', () => {
    expect(siteVariant([0, 4, 3, 5])).toBe(0); // 3 wide, 1 deep: across a north–south road
    expect(siteVariant([8, 4, 9, 7])).toBe(1); // 1 wide, 3 deep: across an east–west road
    expect(siteVariant([0, 0, 2, 2])).toBe(0); // a square goes to v0
    const level = roadLevel(6, 6);
    level.sites = [
      { id: 'haz.speed_bump', rect: [0, 0, 3, 1] },
      { id: 'site.zebra', rect: [5, 0, 6, 3] },
      { id: 'site.school_crossing', rect: [0, 4, 2, 5] },
      { id: 'site.skip', rect: [4, 5, 5, 6] },
    ];
    for (let x = 0; x < 3; x++) expect(framesAt(level, x, 0).base).toBe('haz.speed_bump:v:-:0');
    for (let y = 0; y < 3; y++) expect(framesAt(level, 5, y).base).toBe('tile.zebra:v:-:1');
    expect(framesAt(level, 1, 4).base).toBe('tile.zebra:v:-:0');
    expect(framesAt(level, 4, 5).base?.startsWith('tile.asphalt:v:-:')).toBe(true);
  });
});

describe('marking overlays', () => {
  it('dashes centre lines one tile on, one off along the line', () => {
    const level = roadLevel(4, 4);
    for (let y = 0; y < 4; y++) set(level, 'markings', 1, y, MARKING.CENTRE_NS);
    for (let x = 0; x < 4; x++) set(level, 'markings', x, 3, MARKING.CENTRE_EW);
    expect([0, 1, 2].map((y) => framesAt(level, 1, y).overlays)).toEqual([
      ['tile.lane_marking:v:-:0'],
      [],
      ['tile.lane_marking:v:-:0'],
    ]);
    expect([0, 1, 2, 3].map((x) => framesAt(level, x, 3).overlays)).toEqual([
      ['tile.lane_marking:v:-:1'],
      [],
      ['tile.lane_marking:v:-:1'],
      [],
    ]);
    const edges = roadLevel(2, 2);
    set(edges, 'markings', 0, 0, MARKING.CENTRE_E_EDGE);
    set(edges, 'markings', 0, 1, MARKING.CENTRE_E_EDGE);
    set(edges, 'markings', 1, 0, MARKING.CENTRE_S_EDGE);
    expect(framesAt(edges, 0, 0).overlays).toEqual(['tile.lane_marking:v:-:2']);
    expect(framesAt(edges, 0, 1).overlays).toEqual([]);
    expect(framesAt(edges, 1, 0).overlays).toEqual([]); // odd column
  });

  it('draws double yellows and bay lines once per kerb side, in N/E/S/W variant order', () => {
    const level = roadLevel(2, 1);
    set(level, 'markings', 0, 0, MARKING.DOUBLE_YELLOW);
    set(level, 'collide', 0, 0, COLLIDE.KERB_EDGE_N | COLLIDE.KERB_EDGE_W);
    set(level, 'markings', 1, 0, MARKING.PARKING_BAY);
    set(level, 'collide', 1, 0, COLLIDE.KERB_EDGE_S);
    expect(framesAt(level, 0, 0).overlays).toEqual(['tile.double_yellow:v:-:0', 'tile.double_yellow:v:-:3']);
    expect(framesAt(level, 1, 0).overlays).toEqual(['tile.parking_bay:v:-:2']);
  });
});

describe('writeGroundLayer', () => {
  it('writes 16×16-tile chunks row-major, each cell a ground quad followed by its overlays, then the skirt', () => {
    const level = roadLevel(40, 20);
    set(level, 'storeys', 20, 3, 1);
    set(level, 'markings', 2, 2, MARKING.CENTRE_NS | MARKING.DOUBLE_YELLOW);
    set(level, 'collide', 2, 2, COLLIDE.KERB_EDGE_E);
    const writer = new CityGeometryWriter();
    const chunks = writeGroundLayer(level, writer, 100);
    const data = writer.build();

    expect(GROUND_CHUNK_TILES).toBe(16);
    expect(chunks.map((c) => [c.cx, c.cy])).toEqual([
      [0, 0],
      [1, 0],
      [2, 0],
      [0, 1],
      [1, 1],
      [2, 1],
    ]);
    expect(chunks[2]).toMatchObject({ x0M: 64, y0M: 0, x1M: 80, y1M: 32 });
    expect(chunks[5]).toMatchObject({ x0M: 64, y0M: 32, x1M: 80, y1M: 40 });
    // Chunks are contiguous: each starts where the previous ended.
    chunks.forEach((c, i) => {
      expect(c.firstQuad).toBe(
        i === 0 ? 0 : (chunks[i - 1]?.firstQuad ?? 0) + (chunks[i - 1]?.quadCount ?? 0),
      );
    });
    const cells = 40 * 20 - 1; // minus the building cell
    const overlays = 2;
    expect(chunks.reduce((sum, c) => sum + c.quadCount, 0)).toBe(cells + overlays);
    expect(chunks[1]?.quadCount).toBe(16 * 16 - 1); // the building cell is in chunk (1, 0)
    expect(data.quadCount).toBe(cells + overlays + 4);
    expect([...data.kinds.slice(-4)]).toEqual(Array(4).fill(SurfaceKind.Skirt));

    // Every quad samples the FRAME rect of what its cell draws, at y = 0, clamped to its own cell.
    const tables = groundFrameTables(level);
    let q = 0;
    for (const chunk of chunks) {
      for (let y = chunk.y0M / CELL_M; y < chunk.y1M / CELL_M; y++) {
        for (let x = chunk.x0M / CELL_M; x < chunk.x1M / CELL_M; x++) {
          const { base, overlays: ov } = cellGroundFrames(level, tables, x, y);
          if (base === null) continue;
          const frames: FrameId[] = [base, ...ov];
          frames.forEach((frame, k) => {
            const r = frameRect(frame);
            const v = q * 4;
            expect(data.kinds[q]).toBe(k === 0 ? SurfaceKind.Ground : SurfaceKind.Overlay);
            expect(Array.from(data.rects.subarray(v * 4, v * 4 + 4))).toEqual([r.x, r.y, r.w, r.h]);
            expect(Array.from(data.cells.subarray(v * 2, v * 2 + 2))).toEqual([x * CELL_M, y * CELL_M]);
            for (let c = 0; c < 4; c++) expect(data.positions[(v + c) * 3 + 1]).toBe(0);
            q++;
          });
        }
      }
    }
    expect(q).toBe(cells + overlays);
  });
});
