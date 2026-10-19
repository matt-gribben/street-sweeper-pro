// A compiled level's city (TECHNICAL_DESIGN §12.4, §12.7; SSP-045): the ground layer (groundLayer.ts), every
// building's walls and roofs (cityMesh.ts) and the building shadows (shadows.ts), built once per district.
//
//   - Ground, markings, walls and roofs are ONE BufferGeometry with one material sampling the `world` atlas:
//     one draw call (render order 0), frustum culling off.
//   - The building shadows are one mask-only mesh (render order 1, after the city so roofs and walls are in the
//     depth buffer): one convex polygon per merged box, projected SE by 0.84 × height (M0's shadows.ts).
//   - Styles come from the compiled header: wall value n names `wallIds[n − 1]` (a `facade.*` set with
//     `lit`/`base`/`dark` bay frames) and roof value n names `roofIds[n − 1]` (a `roof.*` tile family whose
//     `v` variants are picked per cell). A missing frame throws at build time.
//
// Render-only: reads the decoded Level and the loaded atlas and never writes either. Built once on district
// load; nothing here runs per frame.
import { Group, type Mesh } from 'three';
import type { FrameId } from '../gen/assets.ts';
import type { Level } from '../sim/map.ts';
import {
  type CityBox,
  type CityGeometryData,
  CityGeometryWriter,
  type CityGrid,
  type CityStyles,
  createCityMesh,
  disposeCityMesh,
  dominantIndex,
  type FacadeStyle,
  GROUND_SKIRT_M,
  type RoofStyle,
  roofParapetSe,
  writeBuildings,
} from './cityMesh.ts';
import { cellGroundFrames, type GroundChunk, groundFrameTables, writeGroundLayer } from './groundLayer.ts';
import { KERBSIDE32, type Kerbside32 } from './palettePass.ts';
import { createBuildingShadows } from './shadows.ts';
import type { SpriteAtlas } from './spriteAtlas.ts';
import { frameRect, worldFrame, worldFrameVariants } from './worldFrames.ts';

/** An index atlas as cityMesh needs it on the CPU: palette indices, rows top to bottom. */
export type IndexAtlas = {
  readonly indices: Uint8Array;
  readonly width: number;
};

/** The level's building grid: the compiled storeys, wall and roof layers, NW corner at the sim origin. */
export function levelCityGrid(level: Level): CityGrid {
  const [cols, rows] = level.size;
  const { storeys, wall, roof } = level.layers;
  return { cols, rows, originXM: 0, originYM: 0, storeys, wall, roof };
}

/** A facade set's three bay frames (`<id>:lit|base|dark:-:0`). */
export function facadeFrames(id: string): readonly [lit: FrameId, base: FrameId, dark: FrameId] {
  return [worldFrame(id, 'lit', 0), worldFrame(id, 'base', 0), worldFrame(id, 'dark', 0)];
}

/** The facade style of a facade set id. */
export function facadeStyle(id: string): FacadeStyle {
  const [lit, base, dark] = facadeFrames(id);
  return { lit: frameRect(lit), base: frameRect(base), dark: frameRect(dark) };
}

/** The roof style of a roof id: its `v` variants, and its SE parapet from variant 0's dominant index. */
export function roofStyle(id: string, atlas: IndexAtlas, palette: Kerbside32 = KERBSIDE32): RoofStyle {
  const variants = worldFrameVariants(id, 'v').map(frameRect);
  const first = variants[0];
  if (first === undefined) throw new Error(`roof ${id} has no variants`);
  return { variants, parapetSe: roofParapetSe(dominantIndex(atlas.indices, atlas.width, first), palette) };
}

/** Styles for every wall and roof value the level's header names (entry n is value n; entry 0 is unused). */
export function levelCityStyles(
  level: Level,
  atlas: IndexAtlas,
  palette: Kerbside32 = KERBSIDE32,
): CityStyles {
  return {
    facades: [undefined, ...level.wallIds.map(facadeStyle)],
    roofs: [undefined, ...level.roofIds.map((id) => roofStyle(id, atlas, palette))],
  };
}

/**
 * Every frame the level's city draws, sorted: ground, kerb, site and marking tiles of every cell, every facade
 * set's bays and every roof variant. Throws, naming the frame, if the generated table lacks one.
 */
export function levelCityFrames(level: Level): FrameId[] {
  const frames = new Set<FrameId>();
  const tables = groundFrameTables(level);
  const [w, h] = level.size;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const { base, overlays } = cellGroundFrames(level, tables, x, y);
      if (base !== null) frames.add(base);
      for (const overlay of overlays) frames.add(overlay);
    }
  }
  for (const id of level.wallIds) for (const frame of facadeFrames(id)) frames.add(frame);
  for (const id of level.roofIds) for (const frame of worldFrameVariants(id, 'v')) frames.add(frame);
  return [...frames].sort();
}

/** The city geometry of a level (ground chunks, skirt, walls, roofs), its merged boxes and its ground chunks. */
export type LevelCityData = {
  readonly geometry: CityGeometryData;
  readonly boxes: readonly CityBox[];
  readonly chunks: readonly GroundChunk[];
};

/** Builds the level's city geometry. Pure: no WebGL. */
export function buildLevelCityData(
  level: Level,
  atlas: IndexAtlas,
  skirtM: number = GROUND_SKIRT_M,
  palette: Kerbside32 = KERBSIDE32,
): LevelCityData {
  const writer = new CityGeometryWriter();
  const chunks = writeGroundLayer(level, writer, skirtM);
  const boxes = writeBuildings(levelCityGrid(level), levelCityStyles(level, atlas, palette), writer);
  return { geometry: writer.build(), boxes, chunks };
}

/** A level's city in the world pass: the city mesh (one draw) and the building shadows (one draw). */
export type LevelCity = {
  readonly group: Group;
  readonly city: Mesh;
  readonly shadows: Mesh;
  /** Releases the meshes' GPU resources (not the shared atlas texture). */
  dispose(): void;
};

/** Builds a level's city meshes from the loaded `world` atlas. */
export function createLevelCity(
  level: Level,
  world: SpriteAtlas,
  palette: Kerbside32 = KERBSIDE32,
): LevelCity {
  if (world.name !== 'world') throw new Error(`createLevelCity needs the world atlas, got '${world.name}'`);
  const data = buildLevelCityData(level, world, GROUND_SKIRT_M, palette);
  const city = createCityMesh(data.geometry, world.texture, palette);
  city.renderOrder = 0;
  const shadows = createBuildingShadows(data.boxes);
  // Shadows must follow the city so roofs and walls are already in the depth buffer.
  shadows.renderOrder = 1;
  const group = new Group();
  group.name = 'levelCity';
  group.add(city, shadows);
  return {
    group,
    city,
    shadows,
    dispose(): void {
      group.remove(city, shadows);
      disposeCityMesh(city);
      shadows.geometry.dispose();
      const material = shadows.material;
      if (!Array.isArray(material)) material.dispose();
    },
  };
}
