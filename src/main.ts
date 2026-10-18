// Entry point. M0: the renderer (world MRT pass, palette pass, upscale blit) on a plain requestAnimationFrame
// loop with no sim (the fixed 60 Hz loop in src/app/loop.ts arrives in M1).

import { Group, type Object3D } from 'three';
import { installTestHooks, readTestParams, TEST_RENDER_STEP_S } from './debug/testHooks.ts';
import { pinCameraRig, updateCameraRig } from './render/camera.ts';
import { Renderer } from './render/Renderer.ts';
import { createSpikeActors, type SpikeActors } from './render/spikeActors.ts';
import { createSpikeCity } from './render/spikeCity.ts';
import { type AtlasName, loadAtlas, type SpriteAtlas } from './render/spriteAtlas.ts';
import { createTestWorld } from './render/testWorld.ts';
import { attachUpscaler } from './render/upscale.ts';
import { LeanQuadrantsScene } from './scenes/LeanQuadrantsScene.ts';
import { ScaleSheetScene } from './scenes/ScaleSheetScene.ts';

const canvas = document.querySelector<HTMLCanvasElement>('#game');
if (canvas === null) {
  throw new Error('Street Sweeper Pro: #game canvas missing from index.html');
}

// Build stamp for bug reports (TECHNICAL_DESIGN §20.2); the title screen shows it from M4.
canvas.dataset.sspVersion = __SSP_VERSION__;
canvas.dataset.sspCommit = __SSP_COMMIT__;
console.info(`Street Sweeper Pro v${__SSP_VERSION__} (${__SSP_COMMIT__})`);

const search = window.location.search;
const params = new URLSearchParams(search);
/** `?test=1` parameters (src/debug/testHooks.ts), or null outside test mode. */
const testParams = readTestParams(search);
const testMode = testParams !== null;

/** Loads one sprite atlas (spriteAtlas.ts loadAtlas). */
type AtlasLoader = (name: AtlasName) => Promise<SpriteAtlas>;

/**
 * What the loop draws: world-pass content, plus sprites that need atlases (null for none): `attachSprites`
 * loads the atlases it needs through `load` and attaches them. A minimal stand-in for the M1 SceneManager
 * (SSP-043): nothing here outlives the page.
 */
type BootScene = {
  readonly world: Object3D;
  readonly attachSprites: ((load: AtlasLoader) => Promise<void>) | null;
  update(frameCount: number, camYSimM: number): void;
  /** Night on or off: the scene shows or hides its light pools (the renderer owns the night remap). */
  setNight(on: boolean): void;
};

/**
 * Scenes `?test=1&scene=<id>` can boot. `scale_1440` is lean_quadrants viewed in a 2560×1440 page (SSP-022);
 * `scale_sheet` is the D-07 scale-sheet scene (SSP-024).
 */
const TEST_SCENES = ['lean_quadrants', 'scale_1440', 'scale_sheet'] as const;

function leanQuadrants(): BootScene {
  const scene = new LeanQuadrantsScene();
  return {
    world: scene.world,
    attachSprites: async (load) => {
      const [actors, items] = await Promise.all([load('actors'), load('items')]);
      scene.attachSprites(actors, items);
    },
    update: (frameCount, camYSimM) => scene.update(frameCount, camYSimM),
    setNight: (on) => scene.setNight(on),
  };
}

function scaleSheet(): BootScene {
  const scene = new ScaleSheetScene();
  return {
    world: scene.world,
    attachSprites: async (load) => {
      const [actors, items] = await Promise.all([load('actors'), load('items')]);
      scene.attachSprites(actors, items);
    },
    update: (frameCount, camYSimM) => scene.update(frameCount, camYSimM),
    setNight: () => {},
  };
}

/** The SSP-017 spike city, with the SSP-018 spike actors unless `withActors` is false. */
function spikeCity(withActors: boolean): BootScene {
  const world = createSpikeCity();
  let actors: SpikeActors | null = null;
  return {
    world,
    attachSprites: withActors
      ? async (load) => {
          actors = createSpikeActors(await load('actors'));
          world.add(actors.group);
        }
      : null,
    update: (frameCount, camYSimM) => actors?.update(frameCount, camYSimM),
    setNight: () => {},
  };
}

function staticWorld(world: Object3D): BootScene {
  return { world, attachSprites: null, update: () => {}, setNight: () => {} };
}

// Scene choice. With `?test=1&scene=<id>` a minimal switch boots the named scene; an unknown ID throws. Without
// a scene, the world pass is the SSP-017 spike city plus the SSP-018 spike actors (Bessie cycling her 32
// headings, her brush, the pedestrian, their drop shadows). Dev builds can pick another world with `?world=`:
// `palette_test` is the SSP-016 palette test world (tools/spikes/swiftShaderPalettePass.ts) and `empty` draws
// nothing, the baseline for draw-call deltas (tools/spikes/spikeCityFrame.ts); `?actors=0` leaves the actors
// out of the city (tools/spikes/spriteBatchFrame.ts). Release builds without a test scene always get the city
// with its actors, and the dev alternatives are tree-shaken away.
function createBootScene(): BootScene {
  const sceneId = testParams?.scene ?? null;
  if (sceneId !== null) {
    switch (sceneId) {
      case 'lean_quadrants':
      case 'scale_1440':
        return leanQuadrants();
      case 'scale_sheet':
        return scaleSheet();
      default:
        throw new Error(`?test=1: unknown scene '${sceneId}' (known: ${TEST_SCENES.join(', ')})`);
    }
  }
  if (import.meta.env.DEV) {
    const choice = params.get('world');
    if (choice === 'palette_test') return staticWorld(createTestWorld());
    if (choice === 'empty') return staticWorld(new Group());
    return spikeCity(params.get('actors') !== '0');
  }
  return spikeCity(true);
}

const scene = createBootScene();
const renderer = new Renderer(canvas, scene.world);
attachUpscaler(canvas, (layout) => renderer.resize(layout));

/**
 * Stand-in for Bessie's speed until M1: driven by the dev panel slider, 0 in release builds. Test mode pins
 * speed 0 and turns the speed-zoom spring off, so test frames never depend on timing. `night` starts from the
 * `night=1` test parameter (SSP-021); the dev panel toggles it outside test mode.
 */
const drive = {
  speedMps: 0,
  zoomEnabled: testMode ? false : renderer.rig.zoomEnabled,
  night: testParams?.night ?? false,
};

/**
 * Render-frame counter driving the actors (heading cycle, brush spin): one step per rendered frame, never
 * wall-clock time, so a held counter gives a deterministic frame. `freeze=1` holds it; `__ssp.step(n)` advances
 * it. Dev builds outside test mode can pin the drawn frame with `?actorFrame=N`.
 */
let renderFrame = 0;
const frozen = testParams?.freeze ?? false;
const pinnedFrame =
  import.meta.env.DEV && !testMode ? Number.parseInt(params.get('actorFrame') ?? '', 10) : Number.NaN;
/** Set by `__ssp.setCamera`: the loop no longer moves the camera. */
let cameraPinned = false;
let focusZ = 0;

/** Moves the camera by `dtS` seconds of render time (pans north at the slider speed until M1). */
function updateCamera(dtS: number): void {
  if (cameraPinned) return;
  focusZ -= drive.speedMps * dtS;
  renderer.rig.zoomEnabled = drive.zoomEnabled;
  updateCameraRig(renderer.rig, 0, focusZ, drive.speedMps, dtS);
}

/** Draws one complete frame from the current counter and camera. */
function draw(): void {
  renderer.night = drive.night;
  scene.setNight(drive.night);
  scene.update(Number.isNaN(pinnedFrame) ? renderFrame : pinnedFrame, renderer.rig.snappedZ);
  renderer.render();
}

const testHooks = installTestHooks(window, search, {
  tick: () => renderFrame,
  advance: (n) => {
    for (let i = 0; i < n; i++) {
      updateCamera(TEST_RENDER_STEP_S);
      renderFrame++;
    }
  },
  render: draw,
  readFrame: () => renderer.readFrame(),
  pinCamera: (x, y, h) => {
    pinCameraRig(renderer.rig, x, y, h);
    cameraPinned = true;
  },
  camera: () => {
    const rig = renderer.rig;
    return { x: rig.focusX, y: rig.focusZ, h: rig.height.value, pinned: cameraPinned };
  },
  drawCalls: () => renderer.drawCalls,
});

// The sprite atlases load asynchronously; the world draws alone until they arrive. A bad atlas (a non-palette
// pixel, a stale FRAME table) rejects here and is reported loudly rather than drawn (and test mode never
// reports ready). In test mode, once assets are in: advance `tick=<n>` ticks, render, then report ready.
const attachSprites = scene.attachSprites;
const assetsLoaded: Promise<void> =
  attachSprites === null ? Promise.resolve() : attachSprites((name) => loadAtlas(name));
assetsLoaded.then(
  () => {
    if (testHooks === null) return;
    testHooks.api.step(testHooks.params.tick);
    testHooks.markReady();
  },
  (error: unknown) => {
    console.error('Street Sweeper Pro: a sprite atlas failed to load', error);
  },
);

if (import.meta.env.DEV && !testMode) {
  void import('./debug/devPanel.ts').then(({ mountDevPanel }) => {
    mountDevPanel(drive, () => {
      const rig = renderer.rig;
      return [
        `H ${rig.height.value.toFixed(2)} m  W ${rig.internalWidth}  scale ${renderer.upscale}x`,
        `cam ${rig.snappedX.toFixed(4)}, ${rig.snappedZ.toFixed(4)} m  frac ${rig.fractionX.toFixed(3)}, ${rig.fractionY.toFixed(3)} px`,
        `draw calls ${renderer.drawCalls} (world + palette + blit)  night ${renderer.night ? 'on' : 'off'}`,
        `actor frame ${Number.isNaN(pinnedFrame) ? renderFrame : pinnedFrame}${scene.attachSprites === null ? ' (no actors)' : ''}`,
      ].join('\n');
    });
  });
}

/** Clamp for long gaps (background tab): springs are exact for any dt, but the pan should not jump. */
const MAX_FRAME_DT_S = 0.1;
let lastMs = -1;
/** Test mode: the previous rAF timestamp once ready, for `__ssp.perf()` frame times (-1 before the first). */
let lastReadyRafMs = -1;

function frame(nowMs: number): void {
  // Test mode only: CPU time of this callback for `__ssp.perf()` (SSP-023). Never read outside test mode.
  const workStartMs = testHooks === null ? 0 : performance.now();
  // Test mode: a fixed 1/60 s render step, and none at all when frozen (the loop renders but never steps).
  let dtS: number;
  if (testMode) {
    dtS = frozen ? 0 : TEST_RENDER_STEP_S;
  } else {
    dtS = lastMs < 0 ? 0 : Math.min(MAX_FRAME_DT_S, (nowMs - lastMs) / 1000);
    lastMs = nowMs;
  }
  updateCamera(dtS);
  draw();
  // In test mode the counter also holds until ready, so the frame at `ready` never depends on load time.
  if (!frozen && (testHooks === null || testHooks.api.ready)) renderFrame++;
  // Frame timings are observations only: they never feed back into what is drawn.
  if (testHooks?.api.ready === true) {
    if (lastReadyRafMs >= 0) testHooks.recordFrame(nowMs - lastReadyRafMs, performance.now() - workStartMs);
    lastReadyRafMs = nowMs;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
