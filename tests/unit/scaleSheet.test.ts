// scale_sheet (SSP-024, ROADMAP D-07): Bessie's body, a 24×24 human and a 16×16 litter item side by side at 1:1
// on asphalt and on a 05/06 pavement checkerboard, all on screen at W = 480 and the size-sheet dimensions intact.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { InstancedMesh } from 'three';
import { describe, expect, it } from 'vitest';
import { FRAME, type FrameId } from '../../src/gen/assets.ts';
import { groundPxPerMetre, SWEEP_HEIGHT_M } from '../../src/render/camera.ts';
import { CELL_M } from '../../src/render/cityMesh.ts';
import { GroundType, parseCityGrid } from '../../src/render/placeholderCity.ts';
import {
  type AtlasName,
  indexAtlasPixels,
  loadAtlas,
  type RgbaImage,
  type SpriteAtlas,
  TRANSPARENT_INDEX,
} from '../../src/render/spriteAtlas.ts';
import { INTERNAL_HEIGHT_PX } from '../../src/render/upscale.ts';
import {
  SCALE_SHEET_BESSIE_FRAME,
  SCALE_SHEET_HUMAN_FRAME,
  SCALE_SHEET_LITTER_FRAME,
  SCALE_SHEET_ORIGIN_M,
  SCALE_SHEET_ROWS,
  SCALE_SHEET_ROWS_OF_ACTORS,
  ScaleSheetScene,
} from '../../src/scenes/ScaleSheetScene.ts';
import { decodePng } from '../support/png.ts';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const grid = parseCityGrid(SCALE_SHEET_ROWS, SCALE_SHEET_ORIGIN_M[0], SCALE_SHEET_ORIGIN_M[1]);
/** Visible half-extents at W = 480, H = 31.5 m, in metres. */
const HALF_W_M = 480 / 2 / groundPxPerMetre(SWEEP_HEIGHT_M);
const HALF_H_M = INTERNAL_HEIGHT_PX / 2 / groundPxPerMetre(SWEEP_HEIGHT_M);

function readPng(path: string): RgbaImage {
  return decodePng(readFileSync(`${REPO_ROOT}${path}`));
}

async function loadSprites(name: AtlasName): Promise<SpriteAtlas> {
  return loadAtlas(name, {
    fetchJson: async (url: string): Promise<unknown> =>
      JSON.parse(readFileSync(`${REPO_ROOT}public${url}`, 'utf8')),
    fetchImage: async (url: string): Promise<RgbaImage> => readPng(`public${url}`),
  });
}

/** Opaque bounding box of a frame in its atlas: [width, height]. */
function opaqueSize(frame: FrameId): [number, number] {
  const f = FRAME[frame];
  const image = readPng(`public/assets/atlas/${f.atlas}.png`);
  const indices = indexAtlasPixels(f.atlas, image);
  let x0: number = f.w;
  let y0: number = f.h;
  let x1 = -1;
  let y1 = -1;
  for (let ty = 0; ty < f.h; ty++)
    for (let tx = 0; tx < f.w; tx++) {
      if (indices[(f.y + ty) * image.width + f.x + tx] === TRANSPARENT_INDEX) continue;
      x0 = Math.min(x0, tx);
      y0 = Math.min(y0, ty);
      x1 = Math.max(x1, tx);
      y1 = Math.max(y1, ty);
    }
  return [x1 - x0 + 1, y1 - y0 + 1];
}

/** Ground type under a sim point. */
function groundAt(xM: number, yM: number): number {
  const col = Math.floor((xM - SCALE_SHEET_ORIGIN_M[0]) / CELL_M);
  const row = Math.floor((yM - SCALE_SHEET_ORIGIN_M[1]) / CELL_M);
  return grid.ground[row * grid.cols + col] ?? -1;
}

describe('scale_sheet layout', () => {
  it('is a 17 × 9 cell grid centred on the origin: asphalt west of x = 1 m, a 05/06 checkerboard east of it', () => {
    expect(grid.cols).toBe(17);
    expect(grid.rows).toBe(9);
    for (let row = 0; row < grid.rows; row++)
      for (let col = 0; col < grid.cols; col++) {
        const ground = grid.ground[row * grid.cols + col];
        if (col < 9) expect(ground).toBe(GroundType.Asphalt);
        else expect(ground).toBe((col + row) % 2 === 0 ? GroundType.Slab : GroundType.Kerb);
      }
    expect(grid.storeys.every((s) => s === 0)).toBe(true);
  });

  it('puts one trio on asphalt and one on pavement, every pivot on its surface (slab cells on the pavement)', () => {
    expect(SCALE_SHEET_ROWS_OF_ACTORS.map((r) => r.surface)).toEqual(['asphalt', 'pavement']);
    for (const row of SCALE_SHEET_ROWS_OF_ACTORS) {
      for (const [x, y] of [row.bessieM, row.humanM, row.litterM]) {
        expect(groundAt(x, y)).toBe(row.surface === 'asphalt' ? GroundType.Asphalt : GroundType.Slab);
      }
    }
  });

  it('keeps every sprite inside the frame and clear of the others', () => {
    const rects = SCALE_SHEET_ROWS_OF_ACTORS.flatMap((row) =>
      (
        [
          [SCALE_SHEET_BESSIE_FRAME, row.bessieM],
          [SCALE_SHEET_HUMAN_FRAME, row.humanM],
          [SCALE_SHEET_LITTER_FRAME, row.litterM],
        ] as const
      ).map(([id, [x, y]]) => {
        const f = FRAME[id];
        return { x0: x - f.px / 16, x1: x + (f.w - f.px) / 16, y0: y - f.py / 16, y1: y + (f.h - f.py) / 16 };
      }),
    );
    for (const r of rects) {
      expect(r.x0).toBeGreaterThan(-HALF_W_M);
      expect(r.x1).toBeLessThan(HALF_W_M);
      expect(r.y0).toBeGreaterThan(-HALF_H_M);
      expect(r.y1).toBeLessThan(HALF_H_M);
    }
    for (let i = 0; i < rects.length; i++)
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i];
        const b = rects[j];
        if (a === undefined || b === undefined) continue;
        expect(a.x1 <= b.x0 || b.x1 <= a.x0 || a.y1 <= b.y0 || b.y1 <= a.y0).toBe(true);
      }
  });

  it('shows the size sheet: Bessie 28 × 52 body, a human ≤ 18 × 22 in 24 × 24, litter 8–14 px in 16 × 16', () => {
    const bessie = opaqueSize(SCALE_SHEET_BESSIE_FRAME);
    expect([bessie[0] - 2, bessie[1] - 2]).toEqual([28, 52]); // the forge adds a 1 px outline
    expect([FRAME[SCALE_SHEET_HUMAN_FRAME].w, FRAME[SCALE_SHEET_HUMAN_FRAME].h]).toEqual([24, 24]);
    const human = opaqueSize(SCALE_SHEET_HUMAN_FRAME);
    expect(human[0]).toBeLessThanOrEqual(18);
    expect(human[1]).toBeLessThanOrEqual(22);
    expect([FRAME[SCALE_SHEET_LITTER_FRAME].w, FRAME[SCALE_SHEET_LITTER_FRAME].h]).toEqual([16, 16]);
    const litter = opaqueSize(SCALE_SHEET_LITTER_FRAME);
    expect(Math.max(...litter)).toBeLessThanOrEqual(14);
    expect(Math.max(...litter)).toBeGreaterThanOrEqual(8);
  });
});

describe('ScaleSheetScene', () => {
  it('builds the ground, then 4 actors, 2 litter items and 4 drop shadows per frame', async () => {
    const scene = new ScaleSheetScene();
    expect(scene.world.children.map((c) => c.renderOrder)).toEqual([0]);
    scene.update(0, 0); // before the atlases: draws nothing and does not throw
    const actors = await loadSprites('actors');
    const itemsAtlas = await loadSprites('items');
    scene.attachSprites(actors, itemsAtlas);
    scene.update(0, 0);
    const meshes: InstancedMesh[] = [];
    scene.world.traverse((o) => {
      if ('isInstancedMesh' in o && o.isInstancedMesh === true) meshes.push(o as InstancedMesh);
    });
    const sprites = meshes.find((m) => m.name === 'sprites:actors');
    const items = meshes.find((m) => m.name === 'sprites:items');
    const shadows = meshes.find((m) => m.name === 'dropShadows');
    expect(sprites?.count).toBe(4);
    expect(items?.count).toBe(2);
    expect(shadows?.count).toBe(4);
    expect([shadows?.renderOrder, sprites?.renderOrder, items?.renderOrder]).toEqual([2, 3, 4]);
    expect(() => scene.attachSprites(actors, itemsAtlas)).toThrow();
  });
});
