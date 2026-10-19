// SSP-045: the browser level loader and the test-only level_preview scene, driven without WebGL: the scene loads
// compiled Puddle Lane and the world atlas, adds the level city (city + building shadows) to the world pass, pins
// the camera at the sweep height, and releases everything on exit. The scene never renders anything per frame.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Group } from 'three';
import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/app/events.ts';
import type { SceneContext } from '../../src/app/Game.ts';
import { levelUrl, loadLevel } from '../../src/app/levelLoader.ts';
import { SCENE_IDS } from '../../src/app/SceneManager.ts';
import { SWEEP_HEIGHT_M } from '../../src/render/camera.ts';
import type { Renderer } from '../../src/render/Renderer.ts';
import { type AtlasName, loadAtlas } from '../../src/render/spriteAtlas.ts';
import {
  LEVEL_PREVIEW_CAMERA_M,
  LEVEL_PREVIEW_DISTRICT,
  LevelPreviewScene,
} from '../../src/scenes/LevelPreviewScene.ts';
import { decodePng } from '../support/png.ts';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel: string): string => readFileSync(`${REPO_ROOT}${rel}`, 'utf8');

/** Serves `public/<url without the base>` from the checkout. */
const checkoutLevels = async (url: string): Promise<string> => read(`public/${url.replace(/^\//, '')}`);

describe('levelLoader', () => {
  it('builds the level URL under the app base and refuses names that are not snake_case', () => {
    expect(levelUrl('puddle_lane', '/')).toBe('/assets/levels/puddle_lane.json');
    expect(levelUrl('puddle_lane', '/game/')).toBe('/game/assets/levels/puddle_lane.json');
    expect(() => levelUrl('../secrets', '/')).toThrow(/snake_case/);
  });

  it('loads and decodes the committed Puddle Lane', async () => {
    const level = await loadLevel(LEVEL_PREVIEW_DISTRICT, checkoutLevels);
    expect(level.id).toBe('district.puddle_lane');
    expect(level.size).toEqual([64, 48]);
  });

  it('names the file when it fails to fetch or decode', async () => {
    await expect(loadLevel('puddle_lane', async () => '{"format":"nope"}')).rejects.toThrow(
      /level \/assets\/levels\/puddle_lane\.json: decodeLevel/,
    );
    await expect(
      loadLevel('puddle_lane', async () => {
        throw new Error('HTTP 404');
      }),
    ).rejects.toThrow('HTTP 404');
  });
});

describe('LevelPreviewScene', () => {
  function context() {
    const pins: [number, number, number][] = [];
    const loaded: AtlasName[] = [];
    const ctx: SceneContext = {
      renderer: {} as Renderer,
      root: new Group(),
      ui: new Group(),
      events: new EventBus(),
      loadAtlas: async (name) => {
        loaded.push(name);
        return loadAtlas(name, {
          fetchJson: async () => JSON.parse(read(`public/assets/atlas/${name}.json`)),
          fetchImage: async () => decodePng(readFileSync(`${REPO_ROOT}public/assets/atlas/${name}.png`)),
        });
      },
      pinCamera: (x, y, h) => {
        pins.push([x, y, h]);
      },
      followCamera: () => {
        throw new Error('level_preview never follows');
      },
      releaseCamera: () => {},
      clientToInternal: () => false,
    };
    return { ctx, pins, loaded };
  }

  it('is a known scene ID', () => {
    expect(SCENE_IDS).toContain('level_preview');
  });

  it('adds the level city to the world pass and pins the camera at the sweep height', async () => {
    const { ctx, pins, loaded } = context();
    const scene = new LevelPreviewScene(ctx, checkoutLevels);
    expect(scene.levelCity).toBeNull();
    await scene.enter({ seed: 1 });
    expect(loaded).toEqual(['world']);
    const city = scene.levelCity;
    expect(city).not.toBeNull();
    expect(ctx.root.children).toEqual([city?.group]);
    expect(city?.group.children.map((m) => m.name)).toEqual(['cityMesh', 'buildingShadows']);
    expect(pins).toEqual([[LEVEL_PREVIEW_CAMERA_M[0], LEVEL_PREVIEW_CAMERA_M[1], SWEEP_HEIGHT_M]]);
    // No sim: ticks and frames change nothing.
    scene.fixedUpdate({} as never);
    scene.render(0.5);
    expect(ctx.root.children).toHaveLength(1);
    scene.exit();
    expect(ctx.root.children).toEqual([]);
    expect(scene.levelCity).toBeNull();
  });

  it('rejects without touching the world pass when the level fails to load', async () => {
    const { ctx } = context();
    const scene = new LevelPreviewScene(ctx, async () => 'not json');
    await expect(scene.enter({ seed: 1 })).rejects.toThrow(/decodeLevel/);
    expect(ctx.root.children).toEqual([]);
  });
});
