// SSP-045: compiled Puddle Lane through the level renderer, without WebGL. Every autotile index, ground type, site,
// marking, roof and facade id the committed level uses resolves to a `world` frame of the generated FRAME table
// (and a missing one fails the build), the whole city (ground + markings + walls + roofs) is one geometry well
// under the 250k-vertex single-draw limit (TECHNICAL_DESIGN §12.4), and walls and roofs sample the frames of
// their own cell's styles. SSP-066: every cell the grime mask can lay grime on draws grime (its quads carry a
// grime code), no grass, apron or building cell does, and createLevelCity binds a GroundGrime only in a shift.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Group, Mesh } from 'three';
import { describe, expect, it } from 'vitest';
import { FRAME, type FrameId } from '../../src/gen/assets.ts';
import {
  CELL_M,
  emitWalls,
  Face,
  GRIME_NONE,
  GRIME_SLOT_COUNT,
  mergeBoxes,
  STOREY_M,
  SurfaceKind,
} from '../../src/render/cityMesh.ts';
import {
  cellGrimeCode,
  GROUND_CHUNK_TILES,
  GROUND_TILE_ASSET,
  groundFrameTables,
} from '../../src/render/groundLayer.ts';
import {
  buildLevelCityData,
  createLevelCity,
  facadeStyle,
  levelCityFrames,
  levelCityGrid,
  roofStyle,
} from '../../src/render/levelCity.ts';
import { paletteIndex } from '../../src/render/palettePass.ts';
import { type AtlasSource, loadAtlas, type RgbaImage } from '../../src/render/spriteAtlas.ts';
import { frameRect, isFrameId } from '../../src/render/worldFrames.ts';
import { createDirt, initGrime, viewDirt } from '../../src/sim/dirt.ts';
import { AUTOTILE_NONE, decodeLevel, Ground, type Level } from '../../src/sim/map.ts';
import { DEFAULT_TUNING } from '../../src/sim/tuning.ts';
import { decodePng } from '../support/png.ts';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const LEVEL_TEXT = readFileSync(`${REPO_ROOT}public/assets/levels/puddle_lane.json`, 'utf8');
const WORLD_PNG = readFileSync(`${REPO_ROOT}public/assets/atlas/world.png`);
const WORLD_JSON: unknown = JSON.parse(readFileSync(`${REPO_ROOT}public/assets/atlas/world.json`, 'utf8'));

const worldSource: AtlasSource = {
  fetchJson: async (): Promise<unknown> => structuredClone(WORLD_JSON),
  fetchImage: async (): Promise<RgbaImage> => decodePng(WORLD_PNG),
};

const level = (): Level => decodeLevel(LEVEL_TEXT);
const WORLD = await loadAtlas('world', worldSource);
const PUDDLE_LANE = level();
const [W, H] = PUDDLE_LANE.size;

/** Distinct values of a layer, ascending. */
const distinct = (values: Uint8Array): number[] => [...new Set(values)].sort((a, b) => a - b);

describe('compiled Puddle Lane resolves every frame it draws', () => {
  const frames = new Set<string>(levelCityFrames(PUDDLE_LANE));

  it('lists only world-atlas frames of the generated table', () => {
    expect(frames.size).toBeGreaterThan(0);
    for (const id of frames) {
      expect(isFrameId(id), id).toBe(true);
      if (isFrameId(id)) expect(FRAME[id].atlas).toBe('world');
    }
  });

  it('covers every autotile index, ground type, roof id and facade id in the level', () => {
    const autotiles = distinct(PUDDLE_LANE.layers.autotile).filter((n) => n !== AUTOTILE_NONE);
    expect(autotiles.length).toBeGreaterThan(5);
    for (const n of autotiles) expect(frames.has(`tile.kerb:blob:-:${n}`), `kerb blob ${n}`).toBe(true);

    const openGrounds = new Set<number>();
    PUDDLE_LANE.layers.ground.forEach((g, i) => {
      if ((PUDDLE_LANE.layers.storeys[i] ?? 0) === 0) openGrounds.add(g);
    });
    expect(openGrounds.has(Ground.Void)).toBe(false);
    for (const g of openGrounds) {
      const asset = GROUND_TILE_ASSET[g];
      expect(asset, `ground ${g}`).toBeTruthy();
      expect(
        [...frames].some((f) => f.startsWith(`${asset}:v:-:`)),
        `ground ${g} → ${asset}`,
      ).toBe(true);
    }

    expect(PUDDLE_LANE.roofIds.length).toBeGreaterThan(0);
    for (const id of PUDDLE_LANE.roofIds) expect(frames.has(`${id}:v:-:0`), id).toBe(true);
    expect(PUDDLE_LANE.wallIds.length).toBeGreaterThan(0);
    for (const id of PUDDLE_LANE.wallIds) {
      for (const state of ['lit', 'base', 'dark'])
        expect(frames.has(`${id}:${state}:-:0`), `${id} ${state}`).toBe(true);
    }
    // The level's sites and markings draw too.
    for (const id of [
      'haz.speed_bump:v:-:0',
      'haz.speed_bump:v:-:1',
      'tile.zebra:v:-:0',
      'tile.zebra:v:-:1',
    ]) {
      expect(frames.has(id), id).toBe(true);
    }
    for (const asset of ['tile.lane_marking', 'tile.double_yellow', 'tile.parking_bay']) {
      expect(
        [...frames].some((f) => f.startsWith(asset)),
        asset,
      ).toBe(true);
    }
  });

  it('fails on a missing frame instead of drawing nothing', () => {
    const badFacade = level();
    badFacade.wallIds[0] = 'facade.not_drawn_yet';
    expect(() => levelCityFrames(badFacade)).toThrow('missing frame facade.not_drawn_yet:lit:-:0');
    const badRoof = level();
    badRoof.roofIds[0] = 'roof.not_drawn_yet';
    expect(() => levelCityFrames(badRoof)).toThrow('missing frame roof.not_drawn_yet:v:-:0');
    expect(() => buildLevelCityData(badRoof, WORLD)).toThrow(/missing frame/);
    const water = level();
    const open = water.layers.storeys.indexOf(0);
    water.layers.ground[open] = Ground.Water;
    water.layers.autotile[open] = AUTOTILE_NONE;
    expect(() => levelCityFrames(water)).toThrow(/has no tile frame/);
  });
});

describe('buildLevelCityData on compiled Puddle Lane', () => {
  const { geometry: data, boxes, chunks } = buildLevelCityData(PUDDLE_LANE, WORLD);
  const grid = levelCityGrid(PUDDLE_LANE);
  const buildingCells = PUDDLE_LANE.layers.storeys.filter((s) => s > 0).length;
  const count = (kind: SurfaceKind): number => [...data.kinds].filter((k) => k === kind).length;

  it('is one geometry well inside the single-draw budget', () => {
    expect(data.vertexCount).toBe(data.quadCount * 4);
    expect(data.indices.length).toBe(data.quadCount * 6);
    expect(data.vertexCount).toBeLessThan(250_000);
  });

  it('writes 16×16 ground chunks, one ground quad per open cell, one roof per building cell', () => {
    expect(chunks).toHaveLength(Math.ceil(W / GROUND_CHUNK_TILES) * Math.ceil(H / GROUND_CHUNK_TILES));
    expect(count(SurfaceKind.Ground)).toBe(W * H - buildingCells);
    expect(count(SurfaceKind.Roof)).toBe(buildingCells);
    expect(count(SurfaceKind.Skirt)).toBe(4);
    expect(count(SurfaceKind.Overlay)).toBeGreaterThan(100);
    expect(count(SurfaceKind.Wall)).toBe(emitWalls(grid).length);
    expect(boxes).toEqual(mergeBoxes(grid));
  });

  it('samples each wall from its own cell facade, lit on N/W faces and dark on E/S faces', () => {
    const walls = emitWalls(grid);
    let q = 0;
    let wallIndex = 0;
    for (; q < data.quadCount; q++) if (data.kinds[q] === SurfaceKind.Wall) break;
    const faces = new Set<number>();
    for (; q < data.quadCount && data.kinds[q] === SurfaceKind.Wall; q++, wallIndex++) {
      const wall = walls[wallIndex];
      if (wall === undefined) throw new Error('more wall quads than walls');
      const id = PUDDLE_LANE.wallIds[wall.style - 1] ?? '';
      const style = facadeStyle(id);
      const expected = wall.face === Face.N || wall.face === Face.W ? style.lit : style.dark;
      const v = q * 4;
      expect(Array.from(data.rects.subarray(v * 4, v * 4 + 4))).toEqual([
        expected.x,
        expected.y,
        expected.w,
        expected.h,
      ]);
      expect(expected.h).toBe(2 * STOREY_M * 16); // a two-storey bay (ASSET_PIPELINE §10.9)
      faces.add(wall.face);
    }
    expect(wallIndex).toBe(walls.length);
    expect([...faces].sort()).toEqual([Face.N, Face.E, Face.S, Face.W]);
  });

  it('samples each roof from a variant of its own roof id, with the dark-step SE parapet', () => {
    for (let q = 0; q < data.quadCount; q++) {
      if (data.kinds[q] !== SurfaceKind.Roof) continue;
      const v = q * 4;
      const col = Math.round((data.cells[v * 2] ?? -1) / CELL_M);
      const row = Math.round((data.cells[v * 2 + 1] ?? -1) / CELL_M);
      const roofId = PUDDLE_LANE.roofIds[(PUDDLE_LANE.layers.roof[row * W + col] ?? 0) - 1] ?? '';
      const style = roofStyle(roofId, WORLD);
      const x = data.rects[v * 4];
      expect(
        style.variants.some((r) => r.x === x && r.y === data.rects[v * 4 + 1]),
        roofId,
      ).toBe(true);
      expect(data.info[v * 4 + 2]).toBe(style.parapetSe);
    }
    // Slate's base is 02 asphalt, so its SE parapet is 01 tar, as in the M0 placeholder.
    expect(roofStyle('roof.slate', WORLD).parapetSe).toBe(paletteIndex('tar'));
  });

  it('frames match the FRAME rects of the atlas the city samples', () => {
    const roofVariant: FrameId = 'roof.felt:v:-:2';
    expect(roofStyle('roof.felt', WORLD).variants[2]).toEqual(frameRect(roofVariant));
  });
});

describe('createLevelCity', () => {
  it('builds the city (one draw) and the building shadows (one draw), then disposes them', () => {
    const city = createLevelCity(PUDDLE_LANE, WORLD);
    expect(city.group).toBeInstanceOf(Group);
    expect(city.group.children).toEqual([city.city, city.shadows]);
    for (const mesh of [city.city, city.shadows]) {
      expect(mesh).toBeInstanceOf(Mesh);
      expect(mesh.frustumCulled).toBe(false);
      expect(Array.isArray(mesh.material)).toBe(false);
    }
    expect([city.city.renderOrder, city.shadows.renderOrder]).toEqual([0, 1]);
    expect(city.city.name).toBe('cityMesh');
    expect(city.shadows.name).toBe('buildingShadows');
    city.dispose();
    expect(city.group.children).toEqual([]);
  });

  it('binds the sim grime mask to the city material in a shift, and none without one (SSP-066)', () => {
    const dirt = createDirt(PUDDLE_LANE, DEFAULT_TUNING);
    initGrime(dirt, PUDDLE_LANE, 1);
    const city = createLevelCity(PUDDLE_LANE, WORLD, undefined, viewDirt(dirt));
    const grime = city.grime;
    if (grime === null) throw new Error('no GroundGrime');
    expect([grime.widthCells, grime.heightCells]).toEqual([W * 8, H * 8]);
    // The texture reads the sim's own array: no copy, so it can never drift from the mask.
    expect(grime.texture.image.data).toBe(dirt.mask);
    expect(grime.source.image.data).toBe(dirt.mask);
    const material = city.city.material;
    if (Array.isArray(material) || !('uniforms' in material)) throw new Error('no ShaderMaterial');
    const uniforms = material.uniforms as Record<string, { value: unknown }>;
    expect(uniforms.uGrime?.value).toBe(grime.texture);
    expect(uniforms.uGrimeSize?.value).toMatchObject({ x: W * 8, y: H * 8 });
    expect(uniforms.uGrimeRects?.value).toBeInstanceOf(Int32Array);
    expect(uniforms.uGrimeRects?.value).toHaveLength(GRIME_SLOT_COUNT * 4);
    city.dispose();

    const plain = createLevelCity(PUDDLE_LANE, WORLD);
    expect(plain.grime).toBeNull();
    const plainMaterial = plain.city.material;
    if (Array.isArray(plainMaterial) || !('uniforms' in plainMaterial)) throw new Error('no ShaderMaterial');
    const plainUniforms = plainMaterial.uniforms as Record<string, { value: unknown }>;
    expect(plainUniforms.uGrime?.value).toBeNull();
    expect(plainUniforms.uGrimeSize?.value).toMatchObject({ x: 0, y: 0 });
    plain.dispose();

    const small = createDirt(decodeLevel(LEVEL_TEXT), DEFAULT_TUNING);
    const wrong = { ...viewDirt(small), maskW: 8 };
    expect(() => createLevelCity(PUDDLE_LANE, WORLD, undefined, wrong)).toThrow(/does not fit/);
  });

  it('rejects any atlas but world', async () => {
    const items = await loadAtlas('items', {
      fetchJson: async () => JSON.parse(readFileSync(`${REPO_ROOT}public/assets/atlas/items.json`, 'utf8')),
      fetchImage: async () => decodePng(readFileSync(`${REPO_ROOT}public/assets/atlas/items.png`)),
    });
    expect(() => createLevelCity(PUDDLE_LANE, items)).toThrow(/world atlas/);
  });
});

describe('grime on compiled Puddle Lane (SSP-066)', () => {
  const tables = groundFrameTables(PUDDLE_LANE);

  it('draws grime on every tile the mask can be grimy on, for five seeds', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const dirt = createDirt(PUDDLE_LANE, DEFAULT_TUNING);
      initGrime(dirt, PUDDLE_LANE, seed);
      let laid = 0;
      for (let i = 0; i < dirt.mask.length; i++) {
        if ((dirt.mask[i] ?? 0) === 0) continue;
        laid++;
        const tx = Math.floor((i % dirt.maskW) / 8);
        const ty = Math.floor(Math.floor(i / dirt.maskW) / 8);
        expect(cellGrimeCode(PUDDLE_LANE, tables, tx, ty), `tile (${tx}, ${ty})`).not.toBe(GRIME_NONE);
      }
      expect(laid).toBe(9000);
    }
  });

  it('never draws grime on grass, yards, aprons, buildings, walls, roofs or the skirt', () => {
    const data = buildLevelCityData(PUDDLE_LANE, WORLD).geometry;
    for (let q = 0; q < data.quadCount; q++) {
      const code = data.info[q * 16 + 3];
      const kind = data.kinds[q];
      if (kind !== SurfaceKind.Ground && kind !== SurfaceKind.Overlay) {
        expect(code).toBe(GRIME_NONE);
        continue;
      }
      const tx = Math.round((data.cells[q * 8] ?? 0) / CELL_M);
      const ty = Math.round((data.cells[q * 8 + 1] ?? 0) / CELL_M);
      const ground = PUDDLE_LANE.layers.ground[ty * W + tx];
      if (ground === Ground.Grass || ground === Ground.Yard || ground === Ground.Apron)
        expect(code).toBe(GRIME_NONE);
      else expect(code).toBe(cellGrimeCode(PUDDLE_LANE, tables, tx, ty));
    }
  });
});
