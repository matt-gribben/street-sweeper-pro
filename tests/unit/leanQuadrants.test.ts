// lean_quadrants (SSP-019): the 1/3/6-storey trio in every screen quadrant, fully on screen at W = 480 with
// the camera over the origin, plus Bessie and the pedestrian placed clear of every wall and roof, the SSP-020
// sprite-stack lamp posts beside the blocks, the SSP-021 ground swatches and night light pools, and the scene's
// actors driven only by the render-frame counter.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { type InstancedMesh, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { createCameraRig, roofMagnification, SWEEP_HEIGHT_M } from '../../src/render/camera.ts';
import { CELL_M, type CityBox, mergeBoxes } from '../../src/render/cityMesh.ts';
import { HEADING_COUNT } from '../../src/render/headings.ts';
import { lightPoolAnchorPx } from '../../src/render/lightPools.ts';
import { GroundType, parseCityGrid } from '../../src/render/placeholderCity.ts';
import { buildShadowPolygons } from '../../src/render/shadows.ts';
import { FRAMES_PER_HEADING } from '../../src/render/spikeActors.ts';
import { type AtlasName, loadAtlas, type RgbaImage, type SpriteAtlas } from '../../src/render/spriteAtlas.ts';
import { LAMP_POST_STACK } from '../../src/render/spriteStack.ts';
import { INTERNAL_HEIGHT_PX } from '../../src/render/upscale.ts';
import {
  LEAN_QUADRANTS,
  LEAN_QUADRANTS_ORIGIN_M,
  LEAN_QUADRANTS_ROWS,
  LeanQuadrantsScene,
  leanQuadrantHeading,
} from '../../src/scenes/LeanQuadrantsScene.ts';
import { decodePng } from '../support/png.ts';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const W = 480;
/** Bessie's body reaches 1.85 m from her centre at any heading (half-diagonal of 28 × 52 px). */
const BESSIE_BODY_REACH_M = Math.hypot(14, 26) / 16;
/** The brush discs reach 2.4 m ahead of her centre. */
const BRUSH_REACH_M = 2.4;
/** The pedestrian figure: up to 18 px wide (±0.56 m) and 22 px tall above the feet (1.375 m). */
const FIGURE_HALF_WIDTH_M = 9 / 16;
const FIGURE_HEIGHT_M = 22 / 16;

const grid = parseCityGrid(LEAN_QUADRANTS_ROWS, LEAN_QUADRANTS_ORIGIN_M[0], LEAN_QUADRANTS_ORIGIN_M[1]);
const boxes = mergeBoxes(grid);
const rig = createCameraRig(W);

/** Internal-pixel position of a world point (sim x, height, sim y), camera over the origin at H = 31.5 m. */
function projectPx(xM: number, heightM: number, yM: number): { x: number; y: number } {
  const p = new Vector3(xM, heightM, yM).project(rig.camera);
  return { x: ((p.x + 1) / 2) * (W + 2) - 1, y: ((1 - p.y) / 2) * (INTERNAL_HEIGHT_PX + 2) - 1 };
}

type Rect = { x0: number; y0: number; x1: number; y1: number };

/** A box's roof as seen from the camera, in ground metres (its footprint magnified about the screen centre). */
function roofRectM(box: CityBox): Rect {
  const m = roofMagnification(SWEEP_HEIGHT_M, box.heightM);
  return { x0: box.x0M * m, y0: box.y0M * m, x1: box.x1M * m, y1: box.y1M * m };
}

/** What a box covers on screen, in ground metres: footprint, walls and roof together. */
function coverRectM(box: CityBox): Rect {
  const roof = roofRectM(box);
  return {
    x0: Math.min(box.x0M, roof.x0),
    y0: Math.min(box.y0M, roof.y0),
    x1: Math.max(box.x1M, roof.x1),
    y1: Math.max(box.y1M, roof.y1),
  };
}

function distanceToRect(x: number, y: number, r: Rect): number {
  const dx = Math.max(r.x0 - x, 0, x - r.x1);
  const dy = Math.max(r.y0 - y, 0, y - r.y1);
  return Math.hypot(dx, dy);
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}

/** Screen quadrant of a sim point: `n`/`s` from the sign of y, `e`/`w` from the sign of x. */
function quadrantOf(xM: number, yM: number): string {
  return `${yM < 0 ? 'n' : 's'}${xM < 0 ? 'w' : 'e'}`;
}

/** Half the widest opaque slice of the lamp post (the 15 px crossbar), rounded up to 0.5 m. */
const LAMP_SLICE_HALF_M = 0.5;

async function loadSprites(name: AtlasName): Promise<SpriteAtlas> {
  return loadAtlas(name, {
    fetchJson: async (url: string): Promise<unknown> =>
      JSON.parse(readFileSync(`${REPO_ROOT}public${url}`, 'utf8')),
    fetchImage: async (url: string): Promise<RgbaImage> =>
      decodePng(readFileSync(`${REPO_ROOT}public${url}`)),
  });
}

describe('lean_quadrants layout', () => {
  it('is a 17 x 9 cell grid centred on the origin, its blocks mirror-symmetric about both screen axes', () => {
    expect(grid.cols).toBe(17);
    expect(grid.rows).toBe(9);
    expect(LEAN_QUADRANTS_ORIGIN_M).toEqual([-17, -9]);
    // Buildings (and which cells are open) mirror exactly; only the ground swatches differ by quadrant.
    const blocks = LEAN_QUADRANTS_ROWS.map((row) => row.replace(/[^1-8]/g, '.'));
    expect([...blocks].reverse()).toEqual(blocks);
    for (const row of blocks) expect([...row].reverse().join('')).toBe(row);
    // The east half (north-east and south-east) is the SSP-019 layout, itself mirrored north-south.
    const east = LEAN_QUADRANTS_ROWS.map((row) => row.slice(8));
    expect([...east].reverse()).toEqual(east);
  });

  it('lays shadow-test ground swatches (SSP-021): 02/05 in the east, 06 kerb north-west, 22 grass south-west', () => {
    const typesIn = (q: string): number[] => {
      const out = new Set<number>();
      for (let r = 0; r < grid.rows; r++)
        for (let c = 0; c < grid.cols; c++) {
          const i = r * grid.cols + c;
          if ((grid.storeys[i] ?? 0) > 0) continue;
          const x = grid.originXM + (c + 0.5) * CELL_M;
          const y = grid.originYM + (r + 0.5) * CELL_M;
          if (x !== 1 && y !== 0 && x !== -1 && quadrantOf(x, y) === q) out.add(grid.ground[i] ?? -1);
        }
      return [...out].sort();
    };
    expect(typesIn('ne')).toEqual([GroundType.Asphalt, GroundType.Slab]);
    expect(typesIn('se')).toEqual([GroundType.Asphalt, GroundType.Slab]);
    expect(typesIn('nw')).toEqual([GroundType.Asphalt, GroundType.Kerb]);
    expect(typesIn('sw')).toEqual([GroundType.Asphalt, GroundType.Grass]);
    // Each pedestrian stands (and casts its drop shadow) on its quadrant's pavement swatch.
    const under = (x: number, y: number): number => {
      const c = Math.floor((x - grid.originXM) / CELL_M);
      const r = Math.floor((y - grid.originYM) / CELL_M);
      return grid.ground[r * grid.cols + c] ?? -1;
    };
    const pavement = { ne: GroundType.Slab, se: GroundType.Slab, nw: GroundType.Kerb, sw: GroundType.Grass };
    for (const q of LEAN_QUADRANTS) expect(under(...q.pedestrianM)).toBe(pavement[q.name]);
  });

  it('casts building shadows over open ground of every swatch type on screen', () => {
    const polygons = buildShadowPolygons(boxes);
    const inside = (outline: readonly number[], x: number, y: number): boolean => {
      // Convex, counter-clockwise on screen (north up): every edge has the point on its left (y grows south).
      const n = outline.length / 2;
      for (let k = 0; k < n; k++) {
        const ax = outline[2 * k] ?? 0;
        const ay = outline[2 * k + 1] ?? 0;
        const bx = outline[2 * ((k + 1) % n)] ?? 0;
        const by = outline[2 * ((k + 1) % n) + 1] ?? 0;
        if ((bx - ax) * (y - ay) - (by - ay) * (x - ax) > 0) return false;
      }
      return true;
    };
    const halfHeightM = SWEEP_HEIGHT_M * Math.tan((15 * Math.PI) / 180);
    const halfWidthM = (halfHeightM * W) / INTERNAL_HEIGHT_PX;
    const shaded = new Map<number, number>();
    for (let r = 0; r < grid.rows; r++)
      for (let c = 0; c < grid.cols; c++) {
        const i = r * grid.cols + c;
        if ((grid.storeys[i] ?? 0) > 0) continue;
        for (let sy = 0.125; sy < CELL_M; sy += 0.25)
          for (let sx = 0.125; sx < CELL_M; sx += 0.25) {
            const x = grid.originXM + c * CELL_M + sx;
            const y = grid.originYM + r * CELL_M + sy;
            if (Math.abs(x) > halfWidthM || Math.abs(y) > halfHeightM) continue;
            if (boxes.some((b) => distanceToRect(x, y, coverRectM(b)) === 0)) continue;
            if (polygons.some((p) => inside(p.outline, x, y))) {
              const g = grid.ground[i] ?? -1;
              shaded.set(g, (shaded.get(g) ?? 0) + 1);
            }
          }
      }
    // At least 2 m² (32 samples of 0.25 × 0.25 m, about 500 px) of shaded open ground per type.
    for (const type of Object.values(GroundType)) expect(shaded.get(type) ?? 0).toBeGreaterThan(32);
  });

  it('holds one 1-, one 3- and one 6-storey block in each of the four quadrants', () => {
    const byQuadrant = new Map<string, number[]>();
    for (const box of boxes) {
      const q = quadrantOf((box.x0M + box.x1M) / 2, (box.y0M + box.y1M) / 2);
      // No footprint straddles a screen axis.
      expect(quadrantOf(box.x0M + 1e-6, box.y0M + 1e-6)).toBe(q);
      expect(quadrantOf(box.x1M - 1e-6, box.y1M - 1e-6)).toBe(q);
      byQuadrant.set(
        q,
        [...(byQuadrant.get(q) ?? []), box.storeys].sort((a, b) => a - b),
      );
    }
    expect(Object.fromEntries(byQuadrant)).toEqual({
      ne: [1, 3, 6],
      nw: [1, 3, 6],
      se: [1, 3, 6],
      sw: [1, 3, 6],
    });
  });

  it('keeps every base and roof corner inside the frame and in its own screen quadrant', () => {
    for (const box of boxes) {
      const q = quadrantOf((box.x0M + box.x1M) / 2, (box.y0M + box.y1M) / 2);
      for (const heightM of [0, box.heightM]) {
        for (const [x, y] of [
          [box.x0M, box.y0M],
          [box.x1M, box.y0M],
          [box.x0M, box.y1M],
          [box.x1M, box.y1M],
        ] as const) {
          const p = projectPx(x, heightM, y);
          expect(p.x).toBeGreaterThanOrEqual(0);
          expect(p.x).toBeLessThanOrEqual(W);
          expect(p.y).toBeGreaterThanOrEqual(0);
          expect(p.y).toBeLessThanOrEqual(INTERNAL_HEIGHT_PX);
          expect(`${p.y < INTERNAL_HEIGHT_PX / 2 ? 'n' : 's'}${p.x < W / 2 ? 'w' : 'e'}`).toBe(q);
        }
      }
    }
  });

  it('never overlaps two blocks on screen', () => {
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        if (a === undefined || b === undefined) continue;
        expect(overlaps(coverRectM(a), coverRectM(b))).toBe(false);
      }
    }
  });
});

describe('lean_quadrants actors', () => {
  it('puts one Bessie and one pedestrian in each quadrant, ordered north to south', () => {
    expect(LEAN_QUADRANTS.map((q) => q.name).sort()).toEqual(['ne', 'nw', 'se', 'sw']);
    for (const q of LEAN_QUADRANTS) {
      expect(quadrantOf(...q.bessieM)).toBe(q.name);
      expect(quadrantOf(...q.pedestrianM)).toBe(q.name);
    }
    const ys = LEAN_QUADRANTS.map((q) => q.pedestrianM[1]);
    expect([...ys].sort((a, b) => a - b)).toEqual(ys);
  });

  it('keeps Bessie clear of every wall and roof at all 32 headings, brush discs on screen', () => {
    const halfHeightM = SWEEP_HEIGHT_M * Math.tan((15 * Math.PI) / 180);
    const halfWidthM = (halfHeightM * W) / INTERNAL_HEIGHT_PX;
    for (const q of LEAN_QUADRANTS) {
      const [x, y] = q.bessieM;
      for (const box of boxes)
        expect(distanceToRect(x, y, coverRectM(box))).toBeGreaterThan(BESSIE_BODY_REACH_M);
      expect(Math.abs(x) + BRUSH_REACH_M).toBeLessThan(halfWidthM);
      expect(Math.abs(y) + BRUSH_REACH_M).toBeLessThan(halfHeightM);
    }
  });

  it('keeps the whole pedestrian figure clear of walls, roofs and the brush discs', () => {
    for (const q of LEAN_QUADRANTS) {
      const [x, y] = q.pedestrianM;
      const figure: Rect = {
        x0: x - FIGURE_HALF_WIDTH_M,
        x1: x + FIGURE_HALF_WIDTH_M,
        y0: y - FIGURE_HEIGHT_M,
        y1: y,
      };
      for (const box of boxes) expect(overlaps(figure, coverRectM(box))).toBe(false);
      const [bx, by] = q.bessieM;
      expect(distanceToRect(bx, by, figure)).toBeGreaterThan(BRUSH_REACH_M);
    }
  });

  it('faces each pedestrian toward the screen centre', () => {
    for (const q of LEAN_QUADRANTS) {
      const facing = q.name.replace('n', 'S').replace('s', 'N').replace('e', 'W').replace('w', 'E');
      expect(q.pedestrianFrame).toBe(`npc.old_woman:idle:${facing.toLowerCase()}:0`);
    }
  });

  it('starts the four Bessies on four different headings and cycles them with the frame counter', () => {
    expect(LEAN_QUADRANTS.map((q) => leanQuadrantHeading(q, 0)).sort((a, b) => a - b)).toEqual([
      0, 8, 16, 24,
    ]);
    for (const q of LEAN_QUADRANTS) {
      expect(leanQuadrantHeading(q, FRAMES_PER_HEADING)).toBe((q.headingOffset + 1) % HEADING_COUNT);
      expect(leanQuadrantHeading(q, HEADING_COUNT * FRAMES_PER_HEADING)).toBe(q.headingOffset);
    }
  });
});

describe('lean_quadrants lamp posts (SSP-020)', () => {
  const halfHeightM = SWEEP_HEIGHT_M * Math.tan((15 * Math.PI) / 180);
  const halfWidthM = (halfHeightM * W) / INTERNAL_HEIGHT_PX;

  /** Where slice k shows on screen, in ground metres: its pivot magnified about the screen centre. */
  const sliceM = (x: number, y: number, heightM: number): [number, number] => {
    const m = roofMagnification(SWEEP_HEIGHT_M, heightM);
    return [x * m, y * m];
  };

  it('stands one lamp post in each quadrant, mirrored like the rest of the scene', () => {
    for (const q of LEAN_QUADRANTS) {
      expect(quadrantOf(...q.lampPostM)).toBe(q.name);
      expect(q.lampPostM.map(Math.abs)).toEqual([4, 6.5]);
    }
  });

  it('keeps every slice on screen, in its own quadrant and clear of every block, Bessie and the pedestrian', () => {
    for (const q of LEAN_QUADRANTS) {
      const [x, y] = q.lampPostM;
      const [bx, by] = q.bessieM;
      const [px, py] = q.pedestrianM;
      const figure: Rect = {
        x0: px - FIGURE_HALF_WIDTH_M,
        x1: px + FIGURE_HALF_WIDTH_M,
        y0: py - FIGURE_HEIGHT_M,
        y1: py,
      };
      for (const slice of LAMP_POST_STACK.slices) {
        const [sx, sy] = sliceM(x, y, slice.heightM);
        const half = LAMP_SLICE_HALF_M * roofMagnification(SWEEP_HEIGHT_M, slice.heightM);
        const rect: Rect = { x0: sx - half, x1: sx + half, y0: sy - half, y1: sy + half };
        expect(quadrantOf(rect.x0, rect.y0)).toBe(q.name);
        expect(quadrantOf(rect.x1, rect.y1)).toBe(q.name);
        expect(Math.max(Math.abs(rect.x0), Math.abs(rect.x1))).toBeLessThan(halfWidthM);
        expect(Math.max(Math.abs(rect.y0), Math.abs(rect.y1))).toBeLessThan(halfHeightM);
        for (const box of boxes) expect(overlaps(rect, coverRectM(box))).toBe(false);
        expect(distanceToRect(bx, by, rect)).toBeGreaterThan(BRUSH_REACH_M);
        expect(overlaps(rect, figure)).toBe(false);
      }
    }
  });
});

describe('LeanQuadrantsScene', () => {
  it('builds the city mesh and building shadows, then 12 actors, 16 lamp slices and 16 drop shadows per frame', async () => {
    const scene = new LeanQuadrantsScene();
    expect(scene.world.children.map((c) => c.renderOrder)).toEqual([0, 1, 5]);
    scene.update(0, 0); // before the atlases: draws nothing and does not throw
    scene.attachSprites(await loadSprites('actors'), await loadSprites('items'));
    scene.update(0, 0);
    const meshes: InstancedMesh[] = [];
    scene.world.traverse((o) => {
      if ('isInstancedMesh' in o && o.isInstancedMesh === true) meshes.push(o as InstancedMesh);
    });
    const sprites = meshes.find((m) => m.name === 'sprites:actors');
    const items = meshes.find((m) => m.name === 'sprites:items');
    const shadows = meshes.find((m) => m.name === 'dropShadows');
    expect(sprites?.count).toBe(12);
    expect(items?.count).toBe(16);
    // Bessie's body and the pedestrian, plus the plinth and lantern of each lamp post.
    expect(shadows?.count).toBe(16);
    expect(shadows?.renderOrder).toBe(2);
    expect(sprites?.renderOrder).toBe(3);
    expect(items?.renderOrder).toBe(4);
    // The batches are the world pass's only instanced draws: 3 of the frame's 7 calls.
    expect(meshes).toHaveLength(3);
  });

  it('is a pure function of the frame counter', async () => {
    const scene = new LeanQuadrantsScene();
    scene.attachSprites(await loadSprites('actors'), await loadSprites('items'));
    const rects = (): number[] => {
      let out: number[] = [];
      scene.world.traverse((o) => {
        if (o.name === 'sprites:actors') {
          const a = (o as InstancedMesh).geometry.getAttribute('frameRect');
          out = Array.from({ length: 12 * 4 }, (_, i) => a.getComponent(Math.floor(i / 4), i % 4));
        }
      });
      return out;
    };
    scene.update(123, 0);
    const first = rects();
    scene.update(999, 0);
    expect(rects()).not.toEqual(first);
    scene.update(123, 0);
    expect(rects()).toEqual(first);
  });

  it('hangs one light pool under each lamp post, drawn last and only at night (SSP-021)', () => {
    const scene = new LeanQuadrantsScene();
    const pools = scene.lightPools;
    expect(scene.world.children).toContain(pools);
    expect(pools.renderOrder).toBe(5);
    expect(pools.visible).toBe(false);
    scene.setNight(true);
    expect(pools.visible).toBe(true);
    scene.setNight(false);
    expect(pools.visible).toBe(false);
    const anchors = pools.geometry.getAttribute('aAnchorPx');
    expect(anchors.count).toBe(LEAN_QUADRANTS.length * 6);
    LEAN_QUADRANTS.forEach((q, i) => {
      expect([anchors.getX(i * 6), anchors.getY(i * 6)]).toEqual([
        lightPoolAnchorPx(q.lampPostM[0]),
        lightPoolAnchorPx(q.lampPostM[1]),
      ]);
    });
  });

  it('refuses a second set of atlases', async () => {
    const scene = new LeanQuadrantsScene();
    const actors = await loadSprites('actors');
    const items = await loadSprites('items');
    scene.attachSprites(actors, items);
    expect(() => scene.attachSprites(actors, items)).toThrow(/already attached/);
  });
});
