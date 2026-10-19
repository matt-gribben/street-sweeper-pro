// SSP-298: the test-only ZooScene, driven without WebGL. It is reachable only through `?test=1&scene=zoo` (no menu
// or scene transition targets it: a scan of every src file), test mode keeps audio off (nothing in src makes a
// sound before M5), its ground bands sit exactly under the layout's 160 px bands, and its batches pose every cell's
// frame with the frame's top-left on the cell's, cycling with the tick, the unknown-asset error on the console.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Group, type InstancedMesh } from 'three';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Assets } from '../../src/app/assetRegistry.ts';
import { EventBus } from '../../src/app/events.ts';
import type { SceneContext } from '../../src/app/Game.ts';
import { SCENE_IDS } from '../../src/app/SceneManager.ts';
import { FRAME, type FrameId } from '../../src/gen/assets.ts';
import { SWEEP_HEIGHT_M } from '../../src/render/camera.ts';
import { CELL_M } from '../../src/render/cityMesh.ts';
import { GroundType, parseCityGrid } from '../../src/render/placeholderCity.ts';
import type { Renderer } from '../../src/render/Renderer.ts';
import { INSTANCE_STRIDE } from '../../src/render/spriteBatch.ts';
import { bootRoute, type DevBootQuery, TEST_SCENES } from '../../src/scenes/BootScene.ts';
import {
  ZOO_GROUND_ORIGIN_M,
  ZOO_GROUND_ROWS,
  ZOO_SPRITE_LAYER,
  ZooScene,
  zooPageXM,
  zooPageYM,
} from '../../src/scenes/ZooScene.ts';
import { ZOO_BAND_W_PX, ZOO_PAGE_H_PX, ZOO_PAGE_W_PX, zooCellFrame } from '../../src/scenes/zooLayout.ts';
import { checkoutAssets } from '../support/checkoutAssets.ts';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** Every TypeScript file under src/, repo-relative with forward slashes. */
function sourceFiles(dir = join(REPO_ROOT, 'src')): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(path));
    else if (entry.name.endsWith('.ts')) out.push(relative(REPO_ROOT, path).split(sep).join('/'));
  }
  return out.sort();
}

/** Source text with comments blanked out (string literals kept), so a doc comment never counts. */
function code(file: string): string {
  return readFileSync(join(REPO_ROOT, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

const ZOO_LITERAL = /['"`]zoo['"`]/g;

describe('zoo reachability', () => {
  it("names 'zoo' only in the scene list, the test-scene list, the scene itself and main.ts's test-scene switch", () => {
    const users: Record<string, number> = {};
    for (const file of sourceFiles()) {
      const literals = code(file).match(ZOO_LITERAL)?.length ?? 0;
      const refs = code(file).match(/\bZooScene\b/g)?.length ?? 0;
      if (literals + refs > 0) users[file] = literals;
    }
    expect(Object.keys(users).sort()).toEqual([
      'src/app/SceneManager.ts',
      'src/main.ts',
      'src/scenes/BootScene.ts',
      'src/scenes/ZooScene.ts',
    ]);
    // So no menu (src/ui/menus.ts, the tally and intro card), no ShiftFlow transition and no other scene targets it.
    expect(users['src/app/SceneManager.ts']).toBe(1);
    expect(users['src/scenes/BootScene.ts']).toBe(1);
  });

  it('constructs the scene in exactly one place: the `?test=1&scene=<id>` switch in main.ts', () => {
    const main = code('src/main.ts');
    const constructions = main.match(/new ZooScene\(/g) ?? [];
    expect(constructions).toHaveLength(1);
    const start = main.indexOf('function testScene(');
    const end = main.indexOf('\nfunction ', start + 1);
    expect(start).toBeGreaterThan(0);
    const at = main.indexOf('new ZooScene(');
    expect(at).toBeGreaterThan(start);
    expect(at).toBeLessThan(end);
    // testScene() is reached only from the 'scene' boot route.
    expect(main.match(/testScene\(route\.scene\)/g)).toHaveLength(1);
  });

  it('is routed only by ?test=1&scene=zoo, never by default or by a dev world', () => {
    expect(SCENE_IDS).toContain('zoo');
    expect(TEST_SCENES).toContain('zoo');
    expect(bootRoute('zoo', null, true)).toEqual({ kind: 'scene', scene: 'zoo' });
    const devs: (DevBootQuery | null)[] = [
      null,
      { world: null, actors: null, actorFrame: null },
      { world: 'zoo', actors: null, actorFrame: null },
      { world: 'spike_city', actors: '0', actorFrame: '3' },
    ];
    for (const dev of devs)
      for (const testMode of [false, true]) {
        const route = bootRoute(null, dev, testMode);
        expect(JSON.stringify(route)).not.toContain('zoo');
      }
  });

  it('keeps audio off in test mode: nothing in src makes a sound before M5', () => {
    const audio = /\b(AudioContext|webkitAudioContext|OfflineAudioContext|HTMLAudioElement)\b|new Audio\(/;
    expect(sourceFiles().filter((file) => audio.test(code(file)))).toEqual([]);
  });
});

describe('zoo ground', () => {
  it('lays 02 asphalt, 05 slab and 22 grass exactly under the layout bands, past the widest frame', () => {
    const grid = parseCityGrid(ZOO_GROUND_ROWS, ZOO_GROUND_ORIGIN_M[0], ZOO_GROUND_ORIGIN_M[1]);
    expect(grid.storeys.every((s) => s === 0)).toBe(true);
    const groundAt = (xM: number, yM: number): number => {
      const col = Math.floor((xM - grid.originXM) / CELL_M);
      const row = Math.floor((yM - grid.originYM) / CELL_M);
      return grid.ground[row * grid.cols + col] ?? -1;
    };
    const bands = [GroundType.Asphalt, GroundType.Slab, GroundType.Grass];
    for (let py = 0; py < ZOO_PAGE_H_PX; py += 7)
      for (let px = 0; px < ZOO_PAGE_W_PX; px++) {
        const expected = bands[Math.floor(px / ZOO_BAND_W_PX)];
        expect(groundAt(zooPageXM(px + 0.5), zooPageYM(py + 0.5))).toBe(expected);
      }
    // W = 640 sees ±20 m: the asphalt and grass run on to both edges, and the grid covers all 270 rows.
    expect(groundAt(-19.9, 0)).toBe(GroundType.Asphalt);
    expect(groundAt(19.9, 0)).toBe(GroundType.Grass);
    expect(grid.originYM).toBeLessThanOrEqual(zooPageYM(0));
    expect(grid.originYM + grid.rows * CELL_M).toBeGreaterThanOrEqual(zooPageYM(ZOO_PAGE_H_PX));
  });
});

describe('ZooScene', () => {
  let assets: Assets;
  beforeAll(async () => {
    assets = await checkoutAssets();
  });

  function context() {
    const pins: [number, number, number][] = [];
    const ctx: SceneContext = {
      renderer: { rig: { snappedZ: 0 } } as unknown as Renderer,
      root: new Group(),
      ui: new Group(),
      events: new EventBus(),
      assets,
      pinCamera: (x, y, h) => {
        pins.push([x, y, h]);
      },
      followCamera: () => {
        throw new Error('the zoo never follows');
      },
      releaseCamera: () => {},
      clientToInternal: () => false,
      onHidden: () => () => {},
    };
    return { ctx, pins };
  }

  function meshes(root: Group): Map<string, InstancedMesh> {
    const out = new Map<string, InstancedMesh>();
    root.traverse((o) => {
      if ('isInstancedMesh' in o && o.isInstancedMesh === true) out.set(o.name, o as InstancedMesh);
    });
    return out;
  }

  /** The (x, z) offset of every instance in a batch, rounded to 1/16 m texels. */
  function offsets(mesh: InstancedMesh | undefined): string[] {
    if (mesh === undefined) return [];
    const attr = mesh.geometry.getAttribute('offset');
    const out: string[] = [];
    for (let i = 0; i < mesh.count; i++) out.push(`${attr.getX(i) * 16},${attr.getZ(i) * 16}`);
    return out.sort();
  }

  it('is the zoo scene: pins the camera over the origin at the sweep height and draws ground, shadows, actors, items', async () => {
    const { ctx, pins } = context();
    const scene = new ZooScene(ctx, { page: 0, asset: null });
    expect(scene.id).toBe('zoo');
    await scene.enter({ seed: 1 });
    expect(pins).toEqual([[0, 0, SWEEP_HEIGHT_M]]);
    const layout = scene.layout;
    if (layout === null) throw new Error('no layout');
    expect(layout.errors).toEqual([]);
    scene.render(0);
    const m = meshes(ctx.root);
    expect([...m.keys()].sort()).toEqual(['dropShadows', 'sprites:actors', 'sprites:items']);
    const actorCells = layout.cells.filter((c) => c.atlas === 'actors');
    const itemCells = layout.cells.filter((c) => c.atlas === 'items');
    expect(m.get('sprites:actors')?.count).toBe(actorCells.length);
    expect(m.get('sprites:items')?.count).toBe(itemCells.length);
    expect(m.get('dropShadows')?.count).toBe(layout.cells.filter((c) => c.castsShadow).length);
    expect([m.get('dropShadows')?.renderOrder, m.get('sprites:actors')?.renderOrder]).toEqual([2, 3]);
    // Each sprite's pivot stands where the frame's top-left lands on its cell's top-left, in whole texels.
    const pivot = (cell: (typeof layout.cells)[number]): string => {
      const f = FRAME[cell.frame];
      return `${zooPageXM(cell.x + f.px) * 16},${zooPageYM(cell.y + f.py) * 16}`;
    };
    expect(offsets(m.get('sprites:actors'))).toEqual(actorCells.map(pivot).sort());
    expect(offsets(m.get('sprites:items'))).toEqual(itemCells.map(pivot).sort());
    const layer = m.get('sprites:items')?.geometry.getAttribute('layer');
    expect(layer?.getX(0)).toBe(ZOO_SPRITE_LAYER);
    scene.exit();
    expect(ctx.root.children).toEqual([]);
  });

  it('animates with the tick at 10 fps: the brush overlay steps one spin frame every 6 ticks', async () => {
    const { ctx } = context();
    const scene = new ZooScene(ctx, { page: 0, asset: 'veh.sweeper_brush' });
    await scene.enter({ seed: 1 });
    const layout = scene.layout;
    if (layout === null) throw new Error('no layout');
    expect(layout.view).toBe('asset');
    const actors = meshes(ctx.root).get('sprites:actors');
    if (actors === undefined) throw new Error('no actors batch');
    const rectX = (): number[] => {
      const data = actors.geometry.getAttribute('frameRect');
      return Array.from({ length: actors.count }, (_, i) => data.getX(i) * 4096 + data.getY(i));
    };
    const expected = (tick: number): number[] =>
      layout.cells.map((c) => FRAME[zooCellFrame(c, tick)].x * 4096 + FRAME[zooCellFrame(c, tick)].y);
    scene.render(0);
    expect(rectX()).toEqual(expected(0));
    for (let t = 0; t < 6; t++) scene.fixedUpdate({} as never);
    expect(scene.tick).toBe(6);
    scene.render(0);
    expect(rectX()).toEqual(expected(6));
    expect(rectX()).not.toEqual(expected(0));
    // No items in this view: no items batch, and no shadow for the brush (the scale Bessie still casts one).
    expect(meshes(ctx.root).has('sprites:items')).toBe(false);
    expect(meshes(ctx.root).get('dropShadows')?.count).toBe(1);
    expect(INSTANCE_STRIDE).toBe(16);
    scene.exit();
  });

  it('logs an unknown asset with console.error, naming it, and shows the default view', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { ctx } = context();
      const scene = new ZooScene(ctx, { page: 0, asset: 'npc.nobody' });
      await scene.enter({ seed: 1 });
      expect(errors).toHaveBeenCalledTimes(1);
      expect(String(errors.mock.calls[0]?.[0])).toContain("'npc.nobody'");
      expect(scene.layout?.view).toBe('default');
      const frames = new Set(scene.layout?.cells.map((c) => c.frame));
      expect(frames.has('npc.old_woman:idle:s:0' satisfies FrameId)).toBe(true);
      scene.exit();
    } finally {
      errors.mockRestore();
    }
  });
});
