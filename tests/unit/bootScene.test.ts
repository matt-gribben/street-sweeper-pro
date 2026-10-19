// SSP-284: BootScene and the shared asset registry, without WebGL. The routing function picks the scene boot hands
// off to (the shift flow's intro card by default, `?test=1&scene=<id>` for a test scene, the dev worlds in dev
// builds); the registry loads every atlas and font the generated table names, each file exactly once, and builds
// the palette LUT exactly once; BootScene joins the stack only after the load, installs the registry and is then
// replaced by the routed scene; a missing or off-palette atlas rejects the boot naming the atlas, with nothing left
// on the stack and nothing handed off.
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  type Assets,
  ATLAS_NAMES,
  createAssets,
  FONT_NAMES,
  loadAssets,
} from '../../src/app/assetRegistry.ts';
import { SCENE_IDS, type Scene, SceneManager } from '../../src/app/SceneManager.ts';
import { FRAME } from '../../src/gen/assets.ts';
import { createPaletteTables, KERBSIDE32, lutBuildCount } from '../../src/render/palettePass.ts';
import type { RgbaImage } from '../../src/render/spriteAtlas.ts';
import {
  BootScene,
  bootRoute,
  type DevBootQuery,
  SHIFT_INTRO_SCENE,
  SHIFT_SCENE,
  TEST_SCENES,
} from '../../src/scenes/BootScene.ts';
import { DEFAULT_DISTRICT } from '../../src/scenes/ShiftScene.ts';
import { SPIKE_TEST_SCENES } from '../../src/scenes/SpikeScene.ts';
import { checkoutSources } from '../support/checkoutAssets.ts';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** Every file the registry must fetch, as URLs under vitest's base `/`, sorted. */
const BOOT_URLS = [
  '/assets/atlas/actors.json',
  '/assets/atlas/actors.png',
  '/assets/atlas/items.json',
  '/assets/atlas/items.png',
  '/assets/atlas/ui.json',
  '/assets/atlas/ui.png',
  '/assets/atlas/world.json',
  '/assets/atlas/world.png',
  '/assets/fonts/kerbside5x7.json',
];

const NO_DEV: DevBootQuery = { world: null, actors: null, actorFrame: null };

/** A scene that does nothing, for the hand-off. */
function fakeScene(id: Scene['id']): Scene & { entered: number } {
  return {
    id,
    blocksUpdateBelow: false,
    simEvents: null,
    entered: 0,
    async enter() {
      this.entered += 1;
    },
    exit() {},
    fixedUpdate() {},
    render() {},
  };
}

describe('bootRoute', () => {
  it("hands off to the shift flow's intro card for Puddle Lane by default, in every build", () => {
    const intro = { kind: 'flow', district: DEFAULT_DISTRICT, atIntro: true };
    expect(bootRoute(null, null, false)).toEqual(intro);
    expect(bootRoute(null, null, true)).toEqual(intro);
    expect(bootRoute(null, NO_DEV, false)).toEqual(intro);
    expect(bootRoute(SHIFT_INTRO_SCENE, null, true)).toEqual(intro);
  });

  it('routes ?test=1&scene=<id> to that scene after the boot', () => {
    expect(bootRoute('district.puddle_lane', null, true)).toEqual({
      kind: 'flow',
      district: 'district.puddle_lane',
      atIntro: false,
    });
    expect(bootRoute('district.kebab_mile', null, true)).toEqual({
      kind: 'flow',
      district: 'district.kebab_mile',
      atIntro: false,
    });
    expect(bootRoute(SHIFT_SCENE, null, true)).toEqual({
      kind: 'flow',
      district: DEFAULT_DISTRICT,
      atIntro: false,
    });
    for (const id of [...TEST_SCENES, ...SPIKE_TEST_SCENES]) {
      expect(bootRoute(id, null, true)).toEqual({ kind: 'scene', scene: id });
      expect(SCENE_IDS).toContain(id);
    }
    // `scene` wins over the dev worlds.
    expect(bootRoute('level_preview', { world: 'empty', actors: '0', actorFrame: '3' }, true)).toEqual({
      kind: 'scene',
      scene: 'level_preview',
    });
  });

  it('throws on an unknown scene, and on the tally (it needs a finished shift)', () => {
    expect(() => bootRoute('zoo_typo', null, true)).toThrow(/unknown scene 'zoo_typo'.*shift_intro/);
    expect(() => bootRoute('tally', null, true)).toThrow(/unknown scene 'tally'/);
    expect(() => bootRoute('boot', null, true)).toThrow(/unknown scene 'boot'/);
  });

  it('keeps the dev worlds and the M0 spike city for dev builds only', () => {
    expect(bootRoute(null, { ...NO_DEV, world: 'palette_test' }, false)).toEqual({
      kind: 'dev_world',
      world: 'palette_test',
    });
    expect(bootRoute(null, { ...NO_DEV, world: 'empty' }, true)).toEqual({
      kind: 'dev_world',
      world: 'empty',
    });
    expect(bootRoute(null, { ...NO_DEV, world: 'spike_city' }, false)).toEqual({
      kind: 'dev_spike_city',
      actors: true,
      actorFrame: null,
    });
    expect(bootRoute(null, { ...NO_DEV, actors: '0' }, false)).toEqual({
      kind: 'dev_spike_city',
      actors: false,
      actorFrame: null,
    });
    expect(bootRoute(null, { ...NO_DEV, actorFrame: '12' }, false)).toEqual({
      kind: 'dev_spike_city',
      actors: true,
      actorFrame: 12,
    });
    // Test mode never pins the actor frame; an unparsable frame is no pin.
    expect(bootRoute(null, { ...NO_DEV, actorFrame: '12' }, true)).toMatchObject({ actorFrame: null });
    expect(bootRoute(null, { ...NO_DEV, actorFrame: 'x' }, false)).toMatchObject({ actorFrame: null });
    // An unknown ?world= falls through to the flow.
    expect(bootRoute(null, { ...NO_DEV, world: 'moon' }, false)).toMatchObject({ kind: 'flow' });
  });
});

describe('asset registry lists', () => {
  it('derives the atlases and fonts from the generated table, so new ones need no code change', () => {
    const atlases = [...new Set(Object.values(FRAME).map((frame) => frame.atlas))].sort();
    expect(ATLAS_NAMES).toEqual(atlases);
    expect(ATLAS_NAMES).toEqual(['actors', 'items', 'ui', 'world']);
    expect(FONT_NAMES).toEqual(['kerbside5x7']);
    // …and they are exactly the committed outputs.
    const onDisk = readdirSync(`${REPO_ROOT}public/assets/atlas`).filter((f) => f.endsWith('.png'));
    expect(onDisk.map((f) => f.slice(0, -4)).sort()).toEqual([...ATLAS_NAMES]);
    const fonts = readdirSync(`${REPO_ROOT}public/assets/fonts`).filter((f) => f.endsWith('.json'));
    expect(fonts.map((f) => f.slice(0, -5)).sort()).toEqual([...FONT_NAMES]);
  });
});

describe('BootScene', () => {
  // Runs first in this file: the page-load LUT count starts at zero here.
  it('loads every atlas and font exactly once and the LUT exactly once, installs them, then hands off', async () => {
    expect(lutBuildCount()).toBe(0);
    const requests: string[] = [];
    const scenes = new SceneManager();
    const history: string[] = [];
    scenes.onEntered = (scene) => history.push(scene.id);
    const installed: Assets[] = [];
    const next = fakeScene('shift_intro');
    const handOffs: Assets[] = [];
    const boot = new BootScene({
      load: () => loadAssets(checkoutSources(requests)),
      install: (assets) => {
        // The registry is installed before BootScene joins the stack and before anything is handed off.
        expect(scenes.size).toBe(0);
        installed.push(assets);
      },
      handOff: async (assets) => {
        handOffs.push(assets);
        expect(scenes.ids()).toEqual(['boot']);
        await scenes.replace(next, { seed: 3 });
      },
    });
    expect(boot.status).toBe('idle');
    const run = boot.run(scenes, { seed: 3 });
    expect(boot.status).toBe('loading');
    expect(next.entered).toBe(0);
    await run;
    expect(boot.status).toBe('loaded');
    expect(boot.error).toBeNull();
    expect(history).toEqual(['boot', 'shift_intro']);
    expect(scenes.ids()).toEqual(['shift_intro']);
    expect(next.entered).toBe(1);
    expect(installed).toHaveLength(1);
    expect(handOffs).toEqual(installed);
    // Each file once, nothing else.
    expect([...requests].sort()).toEqual(BOOT_URLS);
    expect(lutBuildCount()).toBe(1);

    const assets = installed[0];
    if (assets === undefined) throw new Error('nothing installed');
    expect(boot.assets).toBe(assets);
    expect([...assets.atlases.keys()]).toEqual([...ATLAS_NAMES]);
    expect([...assets.fonts.keys()]).toEqual([...FONT_NAMES]);
    expect(assets.atlas('ui').name).toBe('ui');
    expect(assets.font('kerbside5x7').metrics.atlas).toBe('ui');
    expect(assets.palette.palette).toBe(KERBSIDE32);
    expect(assets.palette.lut).toHaveLength(64 ** 3);
    expect(assets.palette.lutTexture.image.width).toBe(64);
    expect(assets.palette.remapTexture.image.width).toBe(32);
    expect(Object.isFrozen(assets)).toBe(true);
    await expect(boot.run(scenes, { seed: 3 })).rejects.toThrow(/already run/);

    // A second registry on the same page reuses the cached LUT: still one build.
    await loadAssets(checkoutSources());
    expect(lutBuildCount()).toBe(1);
  });

  it('fails with an error naming the atlas when one is missing (404): nothing joins, nothing is handed off', async () => {
    const sources = checkoutSources();
    const atlas = sources.atlas;
    if (atlas === undefined) throw new Error('no atlas source');
    const scenes = new SceneManager();
    let installs = 0;
    let handOffs = 0;
    const boot = new BootScene({
      load: () =>
        loadAssets({
          ...sources,
          atlas: {
            fetchJson: (url) => atlas.fetchJson(url),
            fetchImage: async (url) => {
              if (url.endsWith('/ui.png')) throw new Error(`atlas fetch ${url}: HTTP 404`);
              return atlas.fetchImage(url);
            },
          },
        }),
      install: () => {
        installs += 1;
      },
      handOff: async () => {
        handOffs += 1;
      },
    });
    await expect(boot.run(scenes, { seed: 0 })).rejects.toThrow(
      "asset registry: atlas 'ui' failed to load: atlas fetch /assets/atlas/ui.png: HTTP 404",
    );
    expect(boot.status).toBe('failed');
    expect(boot.error).toBeInstanceOf(Error);
    expect(scenes.size).toBe(0);
    expect(scenes.busy).toBe(false);
    expect(installs).toBe(0);
    expect(handOffs).toBe(0);
  });

  it('fails naming the atlas and the pixel when an atlas holds an off-palette colour', async () => {
    const sources = checkoutSources();
    const atlas = sources.atlas;
    if (atlas === undefined) throw new Error('no atlas source');
    const offPalette = async (url: string): Promise<RgbaImage> => {
      const image = await atlas.fetchImage(url);
      if (!url.endsWith('/items.png')) return image;
      const data = new Uint8Array(image.data);
      data.set([1, 2, 3, 255], 0); // pixel (0, 0): not a Kerbside-32 colour
      return { width: image.width, height: image.height, data };
    };
    const load = loadAssets({
      ...sources,
      atlas: { fetchJson: (url) => atlas.fetchJson(url), fetchImage: offPalette },
    });
    await expect(load).rejects.toThrow(
      /atlas 'items' failed to load: atlas 'items': pixel \(0, 0\) colour 010203/,
    );
  });

  it('fails naming the font when its metrics do not load', async () => {
    const load = loadAssets({
      ...checkoutSources(),
      fontJson: async () => {
        throw new Error('font fetch /assets/fonts/kerbside5x7.json: HTTP 404');
      },
    });
    await expect(load).rejects.toThrow(/font 'kerbside5x7' failed to load: font fetch .*HTTP 404/);
  });

  it('reports a hand-off that fails (the routed scene did not enter) as a failed boot', async () => {
    const scenes = new SceneManager();
    const assets = await loadAssets(checkoutSources());
    const boot = new BootScene({
      load: async () => assets,
      install: () => {},
      handOff: async () => {
        throw new Error('level failed');
      },
    });
    await expect(boot.run(scenes, { seed: 0 })).rejects.toThrow('level failed');
    expect(boot.status).toBe('failed');
    expect(scenes.ids()).toEqual(['boot']);
  });
});

describe('createAssets', () => {
  it('refuses a registry missing an atlas or a font, or a font whose atlas is absent; lookups throw for unknowns', async () => {
    const full = await loadAssets(checkoutSources());
    const tables = createPaletteTables();
    const noUi = new Map(full.atlases);
    noUi.delete('ui');
    expect(() => createAssets(noUi, full.fonts, tables)).toThrow("atlas 'ui' was not loaded");
    expect(() => createAssets(full.atlases, new Map(), tables)).toThrow("font 'kerbside5x7' was not loaded");
    const font = full.font('kerbside5x7');
    const stray = Object.create(font, {
      metrics: { value: { ...font.metrics, atlas: 'fonts' } },
    }) as typeof font;
    expect(() => createAssets(full.atlases, new Map([['kerbside5x7', stray]]), tables)).toThrow(
      "font 'kerbside5x7' draws from atlas 'fonts', which is not loaded",
    );
    // The registry copies its maps: changing the source maps later changes nothing.
    const atlases = new Map(full.atlases);
    const copy = createAssets(atlases, full.fonts, tables);
    atlases.clear();
    expect(copy.atlas('world')).toBe(full.atlas('world'));
    expect(() => copy.atlas('nope' as never)).toThrow("no atlas 'nope'");
    expect(() => copy.font('nope' as never)).toThrow("no font 'nope'");
  });

  it('reads the JSON it validates from the committed outputs', () => {
    // Guard against the test fixture drifting from the committed atlas JSON shape.
    const json: unknown = JSON.parse(readFileSync(`${REPO_ROOT}public/assets/atlas/ui.json`, 'utf8'));
    expect(json).toMatchObject({ frames: expect.any(Object), swaps: expect.any(Object) });
  });
});
