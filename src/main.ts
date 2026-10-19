// Entry point (SSP-043): parse the URL, build the Game (renderer, scene stack, event bus, fixed 60 Hz loop in
// src/app/loop.ts), push the first scene, install the `?test=1` hooks and start the loop. The default scene is
// the M0 spike city until the Boot/Title flow; ShiftScene arrives in SSP-046.

import { Game } from './app/Game.ts';
import { installTestHooks, readTestParams } from './debug/testHooks.ts';
import {
  createDevWorldScene,
  createSpikeCityScene,
  createSpikeTestScene,
  isSpikeTestScene,
  SPIKE_TEST_SCENES,
  type SpikeScene,
} from './scenes/SpikeScene.ts';

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

// Scene choice. `?test=1&scene=<id>` boots the named spike scene; an unknown ID throws. Without a scene the
// world is the SSP-017 spike city plus the SSP-018 spike actors. Dev builds can pick another world with `?world=`
// (`palette_test`, the SSP-016 palette test world for tools/spikes/swiftShaderPalettePass.ts; `empty`, the
// draw-call baseline for tools/spikes/spikeCityFrame.ts) and leave the actors out with `?actors=0`
// (tools/spikes/spriteBatchFrame.ts); outside test mode they can also pin the drawn frame with `?actorFrame=N`. Release builds without
// a test scene always get the city with its actors, and the dev alternatives are tree-shaken away.
function createFirstScene(): SpikeScene {
  const sceneId = testParams?.scene ?? null;
  if (sceneId !== null) {
    if (!isSpikeTestScene(sceneId)) {
      throw new Error(`?test=1: unknown scene '${sceneId}' (known: ${SPIKE_TEST_SCENES.join(', ')})`);
    }
    return createSpikeTestScene(sceneId, game.sceneContext);
  }
  if (import.meta.env.DEV) {
    const choice = params.get('world');
    if (choice === 'palette_test' || choice === 'empty')
      return createDevWorldScene(game.sceneContext, choice);
    // Test mode never pins the actor frame: test frames follow the tick count.
    const pinned = testMode ? Number.NaN : Number.parseInt(params.get('actorFrame') ?? '', 10);
    return createSpikeCityScene(
      game.sceneContext,
      params.get('actors') !== '0',
      Number.isNaN(pinned) ? null : pinned,
    );
  }
  return createSpikeCityScene(game.sceneContext, true, null);
}

const scene = createFirstScene();

const testHooks = installTestHooks(window, search, {
  tick: () => game.loop.ticks,
  advance: (n) => game.loop.runTicks(n),
  render: () => game.loop.renderNow(),
  readFrame: () => game.renderer.readFrame(),
  pinCamera: (x, y, h) => game.pinCamera(x, y, h),
  camera: () => {
    const rig = game.renderer.rig;
    return { x: rig.focusX, y: rig.focusZ, h: rig.height.value, pinned: game.isCameraPinned };
  },
  drawCalls: () => game.renderer.drawCalls,
});

// The loop renders from the first frame; the scene's world draws alone while its atlases load. A bad atlas
// rejects here and is reported loudly rather than drawn (and test mode never reports ready). In test mode, once
// the scene is in: advance `tick=<n>` ticks, render, report ready, then apply `freeze`.
game.start();
game.scenes.push(scene, { seed: testParams?.seed ?? 0 }).then(
  () => {
    if (testHooks === null) return;
    testHooks.api.step(testHooks.params.tick);
    testHooks.markReady();
    game.loop.setFrozen(testHooks.params.freeze);
  },
  (error: unknown) => {
    console.error('Street Sweeper Pro: a sprite atlas failed to load', error);
  },
);

if (import.meta.env.DEV && !testMode) {
  void import('./debug/devPanel.ts').then(({ mountDevPanel }) => {
    mountDevPanel(game.drive, () => {
      const renderer = game.renderer;
      const rig = renderer.rig;
      return [
        `H ${rig.height.value.toFixed(2)} m  W ${rig.internalWidth}  scale ${renderer.upscale}x`,
        `cam ${rig.snappedX.toFixed(4)}, ${rig.snappedZ.toFixed(4)} m  frac ${rig.fractionX.toFixed(3)}, ${rig.fractionY.toFixed(3)} px`,
        `draw calls ${renderer.drawCalls} (world + palette + blit)  night ${renderer.night ? 'on' : 'off'}`,
        `actor frame ${scene.drawnFrame}${scene.hasSprites ? '' : ' (no actors)'}  ticks ${game.loop.ticks}`,
      ].join('\n');
    });
  });
}
