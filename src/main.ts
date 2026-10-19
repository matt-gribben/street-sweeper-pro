// Entry point (SSP-043): parse the URL, build the Game (renderer, scene stack, event bus, fixed 60 Hz loop in
// src/app/loop.ts), push the first scene, install the `?test=1` hooks and start the loop. The default scene is
// the drive-only ShiftScene on Puddle Lane (SSP-046) until the Boot/Title flow (SSP-284, M2).

import { Game } from './app/Game.ts';
import type { Scene, SceneParams } from './app/SceneManager.ts';
import { installTestHooks, readTestParams } from './debug/testHooks.ts';
import { HudSampleScene } from './scenes/HudSampleScene.ts';
import { LevelPreviewScene } from './scenes/LevelPreviewScene.ts';
import { PanelSampleScene } from './scenes/PanelSampleScene.ts';
import { DEFAULT_DISTRICT, ShiftScene } from './scenes/ShiftScene.ts';
import {
  createDevWorldScene,
  createSpikeCityScene,
  createSpikeTestScene,
  isSpikeTestScene,
  SPIKE_TEST_SCENES,
  SpikeScene,
} from './scenes/SpikeScene.ts';
import { TextSampleScene } from './scenes/TextSampleScene.ts';
import { DISTRICT_ID_PATTERN } from './sim/replay.ts';

/** `?test=1&scene=` IDs besides districts and the spike test scenes: the SSP-045 compiled-level preview. */
const LEVEL_PREVIEW_SCENE = 'level_preview';

/** `?test=1&scene=text_sample`: the SSP-069 bitmap-text and UI-pass test scene. */
const TEXT_SAMPLE_SCENE = 'text_sample';

/** `?test=1&scene=panel_sample`: the SSP-285 9-slice panel and button-state test scene. */
const PANEL_SAMPLE_SCENE = 'panel_sample';

/** `?test=1&scene=hud_sample`: the SSP-070 HUD layout test scene. */
const HUD_SAMPLE_SCENE = 'hud_sample';

/** `?test=1&scene=spike_city`: the M0 spike city with its actors (the default world before SSP-046). */
const SPIKE_CITY_SCENE = 'spike_city';

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

/** Test mode: the previous rAF timestamp once ready, for `__ssp.perf()` frame times (-1 before the first). */
let lastReadyRafMs = -1;

// Test mode holds the loop frozen until `ready` (so the first ready frame never depends on load time), then
// applies `freeze=1`. The frame timings are observations only: they never feed back into what is drawn.
const game = new Game(canvas, {
  testMode,
  testSprings: testParams?.springs ?? false,
  frozen: testMode,
  night: testParams?.night ?? false,
  onFrameTimed: testMode
    ? (nowMs, workMs) => {
        if (testHooks?.api.ready !== true) return;
        if (lastReadyRafMs >= 0) testHooks.recordFrame(nowMs - lastReadyRafMs, workMs);
        lastReadyRafMs = nowMs;
      }
    : null,
});

// Scene choice. `?test=1&scene=<id>` boots a district shift (`district.puddle_lane`: ShiftScene on that compiled
// level), `level_preview` (compiled Puddle Lane from a pinned camera, SSP-045), `text_sample` (bitmap text over a
// shadowed street, SSP-069), `panel_sample` (9-slice panels and button states, SSP-285), `hud_sample` (the HUD at its widest, SSP-070),
// `spike_city` or a spike test scene;
// an unknown ID throws. Without a scene every build boots the drive-only ShiftScene on Puddle Lane (SSP-046,
// ROADMAP §1 principle 5), seeded with `seed` (0 when absent). Dev builds keep the M0 spike city for the spike
// scripts: `?world=spike_city`, `?world=palette_test` (the SSP-016 palette test world for
// tools/spikes/swiftShaderPalettePass.ts), `?world=empty` (the draw-call baseline for tools/spikes/spikeCityFrame.ts),
// `?actors=0` (the city without its actors, tools/spikes/spriteBatchFrame.ts) and, outside test mode,
// `?actorFrame=N` (pin the drawn actor frame); release builds tree-shake those away.
const seed = testParams?.seed ?? 0;

function shiftScene(district: string): { scene: Scene; params: SceneParams } {
  // Dev builds record the shift's input log for the dev panel's Save replay (SSP-038, SSP-048).
  const scene = new ShiftScene(game.sceneContext, { recordInputs: import.meta.env.DEV });
  return { scene, params: { seed, district } };
}

function createFirstScene(): { scene: Scene; params: SceneParams } {
  const sceneId = testParams?.scene ?? null;
  if (sceneId !== null) {
    if (DISTRICT_ID_PATTERN.test(sceneId)) return shiftScene(sceneId);
    if (sceneId === LEVEL_PREVIEW_SCENE)
      return { scene: new LevelPreviewScene(game.sceneContext), params: { seed } };
    if (sceneId === TEXT_SAMPLE_SCENE)
      return { scene: new TextSampleScene(game.sceneContext), params: { seed } };
    if (sceneId === PANEL_SAMPLE_SCENE)
      return { scene: new PanelSampleScene(game.sceneContext), params: { seed } };
    if (sceneId === HUD_SAMPLE_SCENE)
      return { scene: new HudSampleScene(game.sceneContext), params: { seed } };
    if (sceneId === SPIKE_CITY_SCENE) {
      return { scene: createSpikeCityScene(game.sceneContext, true, null), params: { seed } };
    }
    if (!isSpikeTestScene(sceneId)) {
      const known = [
        'district.<name>',
        SPIKE_CITY_SCENE,
        ...SPIKE_TEST_SCENES,
        LEVEL_PREVIEW_SCENE,
        TEXT_SAMPLE_SCENE,
        PANEL_SAMPLE_SCENE,
        HUD_SAMPLE_SCENE,
      ].join(', ');
      throw new Error(`?test=1: unknown scene '${sceneId}' (known: ${known})`);
    }
    return { scene: createSpikeTestScene(sceneId, game.sceneContext), params: { seed } };
  }
  if (import.meta.env.DEV) {
    const choice = params.get('world');
    if (choice === 'palette_test' || choice === 'empty') {
      return { scene: createDevWorldScene(game.sceneContext, choice), params: { seed } };
    }
    if (choice === SPIKE_CITY_SCENE || params.has('actors') || params.has('actorFrame')) {
      // Test mode never pins the actor frame: test frames follow the tick count.
      const pinned = testMode ? Number.NaN : Number.parseInt(params.get('actorFrame') ?? '', 10);
      const scene = createSpikeCityScene(
        game.sceneContext,
        params.get('actors') !== '0',
        Number.isNaN(pinned) ? null : pinned,
      );
      return { scene, params: { seed } };
    }
  }
  return shiftScene(DEFAULT_DISTRICT);
}

const { scene, params: sceneParams } = createFirstScene();

const testHooks = installTestHooks(window, search, {
  tick: () => game.loop.ticks,
  snapshot: () => (scene instanceof ShiftScene ? scene.snapshot() : null),
  advance: (n) => game.loop.runTicks(n),
  render: () => game.loop.renderNow(),
  readFrame: () => game.renderer.readFrame(),
  pinCamera: (x, y, h) => game.pinCamera(x, y, h),
  camera: () => {
    const rig = game.renderer.rig;
    return {
      x: rig.focusX,
      y: rig.focusZ,
      h: rig.height.value,
      leadX: rig.leadX.value,
      leadY: rig.leadZ.value,
      pinned: game.isCameraPinned,
    };
  },
  drawCalls: () => game.renderer.drawCalls,
  renders: () => game.renderer.renderCount,
});

// The loop renders from the first frame; the scene's world draws alone while its atlases load. A bad atlas
// rejects here and is reported loudly rather than drawn (and test mode never reports ready). In test mode, once
// the scene is in: advance `tick=<n>` ticks, render, report ready, then apply `freeze`.
game.start();
game.scenes.push(scene, sceneParams).then(
  () => {
    if (testHooks === null) return;
    testHooks.api.step(testHooks.params.tick);
    testHooks.markReady();
    game.loop.setFrozen(testHooks.params.freeze);
  },
  (error: unknown) => {
    console.error('Street Sweeper Pro: a sprite atlas or level failed to load', error);
  },
);

// The F1 dev panel (SSP-048): dev builds only, never in test mode. The dynamic import sits behind
// `import.meta.env.DEV`, so release builds drop the module (and its marker string) entirely.
if (import.meta.env.DEV && !testMode) {
  void import('./debug/devPanel.ts').then(({ mountDevPanel }) => {
    const panel = mountDevPanel({
      drive: game.drive,
      shift: scene instanceof ShiftScene ? scene : null,
      status: () => {
        const renderer = game.renderer;
        const rig = renderer.rig;
        const lines = [
          `H ${rig.height.value.toFixed(2)} m  W ${rig.internalWidth}  scale ${renderer.upscale}x`,
          `cam ${rig.snappedX.toFixed(4)}, ${rig.snappedZ.toFixed(4)} m  frac ${rig.fractionX.toFixed(3)}, ${rig.fractionY.toFixed(3)} px`,
          `draw calls ${renderer.drawCalls} (world + palette + blit)  night ${renderer.night ? 'on' : 'off'}`,
        ];
        if (scene instanceof SpikeScene) {
          lines.push(
            `actor frame ${scene.drawnFrame}${scene.hasSprites ? '' : ' (no actors)'}  ticks ${game.loop.ticks}`,
          );
        } else if (!(scene instanceof ShiftScene)) {
          lines.push(`scene ${scene.id}  ticks ${game.loop.ticks}`);
        }
        return lines.join('\n');
      },
    });
    game.afterFrame = () => panel.frame(game.actions?.sceneActions ?? 0);
  });
}
