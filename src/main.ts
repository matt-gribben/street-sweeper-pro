// Entry point (SSP-043): parse the URL, build the Game (renderer, scene stack, event bus, fixed 60 Hz loop in
// src/app/loop.ts), start the first scene, install the `?test=1` hooks and start the loop. Since SSP-071 every
// build boots the shift flow (src/app/shiftFlow.ts) at the intro card for Puddle Lane: intro → shift → tally →
// Try Again, so `npm run dev` always runs a complete 240 s shift (ROADMAP §1 principle 5). Since SSP-284 the root
// scene is BootScene (src/scenes/BootScene.ts): it loads the shared asset registry once, then hands off.

import { loadAssets } from './app/assetRegistry.ts';
import { Game } from './app/Game.ts';
import type { Scene } from './app/SceneManager.ts';
import { ShiftFlow } from './app/shiftFlow.ts';
import { installTestHooks, readTestParams } from './debug/testHooks.ts';
import { NO_MENU_INPUT } from './input/actions.ts';
import { lutBuildCount } from './render/palettePass.ts';
import { BootScene, bootRoute, type TestSceneId } from './scenes/BootScene.ts';
import { HudSampleScene } from './scenes/HudSampleScene.ts';
import { LevelPreviewScene } from './scenes/LevelPreviewScene.ts';
import { PanelSampleScene } from './scenes/PanelSampleScene.ts';
import { ShiftIntroScene } from './scenes/ShiftIntroScene.ts';
import { ShiftScene } from './scenes/ShiftScene.ts';
import {
  createDevWorldScene,
  createSpikeCityScene,
  createSpikeTestScene,
  SpikeScene,
  type SpikeTestSceneId,
} from './scenes/SpikeScene.ts';
import { TallyScene } from './scenes/TallyScene.ts';
import { TextSampleScene } from './scenes/TextSampleScene.ts';

/** An error's message, for the console and `__ssp.boot()`. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

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
  // `__ssp.loadInputs` replays a log by the running World's tick (SSP-073): the top ShiftScene's, none otherwise.
  simTick: () => {
    const top = game.scenes.top;
    return top instanceof ShiftScene ? top.worldTick : null;
  },
});

// Scene choice (src/scenes/BootScene.ts bootRoute, SSP-284). BootScene always runs first: it loads every atlas, the
// font metrics and the palette LUT once (src/app/assetRegistry.ts), then hands off to the routed scene. Without
// `scene`, every build hands off to the shift flow at the intro card for Puddle Lane (SSP-071), seeded with `seed`
// (0 when absent). `?test=1&scene=<id>` hands off to `shift_intro` (the same); `shift` or `district.<name>` (the
// flow straight into that district's shift, the intro card skipped; it still ends on the tally); `level_preview`
// (compiled Puddle Lane from a pinned camera, SSP-045), `text_sample` (bitmap text over a shadowed street,
// SSP-069), `panel_sample` (9-slice panels and button states, SSP-285), `hud_sample` (the HUD at its widest,
// SSP-070), `spike_city` or a spike test scene. An unknown ID throws at once, before the boot; so does `tally`,
// which needs a finished shift (boot the flow and step to the end). Dev builds keep the M0 spike city for the spike
// scripts: `?world=spike_city`, `?world=palette_test` (the SSP-016 palette test world for
// tools/spikes/swiftShaderPalettePass.ts), `?world=empty` (the draw-call baseline for tools/spikes/spikeCityFrame.ts),
// `?actors=0` (the city without its actors, tools/spikes/spriteBatchFrame.ts) and, outside test mode,
// `?actorFrame=N` (pin the drawn actor frame); release builds tree-shake those away.
const seed = testParams?.seed ?? 0;

const route = bootRoute(
  testParams?.scene ?? null,
  import.meta.env.DEV
    ? { world: params.get('world'), actors: params.get('actors'), actorFrame: params.get('actorFrame') }
    : null,
  testMode,
);

/** What boot hands off to: one scene on its own, or the shift flow from its intro card or straight into a shift. */
type FirstScene =
  | { readonly kind: 'scene'; readonly scene: Scene }
  | { readonly kind: 'flow'; readonly flow: ShiftFlow; readonly atIntro: boolean };

function shiftFlow(district: string, atIntro: boolean): FirstScene {
  const context = game.sceneContext;
  const flow = new ShiftFlow({
    scenes: game.scenes,
    events: game.events,
    factory: {
      intro: (options) => new ShiftIntroScene(context, options),
      shift: (options) => new ShiftScene(context, options),
      tally: (options) => new TallyScene(context, options),
    },
    menu: game.actions ?? NO_MENU_INPUT,
    district,
    seed,
    // Dev builds record the shift's input log for the dev panel's Save replay (SSP-038, SSP-048).
    recordInputs: import.meta.env.DEV,
    onError: (error) => console.error('Street Sweeper Pro: a scene failed to load', error),
  });
  return { kind: 'flow', flow, atIntro };
}

function single(scene: Scene): FirstScene {
  return { kind: 'scene', scene };
}

/** The test scene `?test=1&scene=<id>` names (scenes read the registry only in enter(), after the boot). */
function testScene(id: TestSceneId | SpikeTestSceneId): Scene {
  const context = game.sceneContext;
  switch (id) {
    case 'level_preview':
      return new LevelPreviewScene(context);
    case 'text_sample':
      return new TextSampleScene(context);
    case 'panel_sample':
      return new PanelSampleScene(context);
    case 'hud_sample':
      return new HudSampleScene(context);
    case 'spike_city':
      return createSpikeCityScene(context, true, null);
    case 'lean_quadrants':
    case 'scale_1440':
    case 'scale_sheet':
      return createSpikeTestScene(id, context);
  }
}

function createFirstScene(): FirstScene {
  switch (route.kind) {
    case 'flow':
      return shiftFlow(route.district, route.atIntro);
    case 'scene':
      return single(testScene(route.scene));
    case 'dev_world':
      // Behind import.meta.env.DEV so release builds drop the dev worlds (bootRoute never returns this there).
      if (!import.meta.env.DEV) throw new Error('?world= is a dev-build parameter');
      return single(createDevWorldScene(game.sceneContext, route.world));
    case 'dev_spike_city':
      return single(createSpikeCityScene(game.sceneContext, route.actors, route.actorFrame));
  }
}

const first = createFirstScene();
const flow = first.kind === 'flow' ? first.flow : null;

/** BootScene's hand-off: replace it with the routed scene (the flow's first transition replaces it too). */
function handOff(): Promise<void> {
  if (first.kind === 'scene') return game.scenes.replace(first.scene, { seed });
  return first.atIntro ? first.flow.startAtIntro() : first.flow.startAtShift();
}

const boot = new BootScene({
  load: () => loadAssets(),
  install: (assets) => game.installAssets(assets),
  handOff,
});

/** IDs of the scenes that joined the stack, oldest first (test mode only, for `__ssp.sceneHistory()`). */
const sceneHistory: string[] = [];
if (testMode) game.scenes.onEntered = (entered) => sceneHistory.push(entered.id);

const testHooks = installTestHooks(window, search, {
  tick: () => game.loop.ticks,
  // The top scene's World (a shift), or the snapshot the tally shows; null in scenes without a sim.
  snapshot: () => {
    const top = game.scenes.top;
    return top instanceof ShiftScene || top instanceof TallyScene ? top.snapshot() : null;
  },
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
  sceneId: () => game.scenes.top?.id ?? null,
  sceneHistory: () => sceneHistory,
  boot: () => ({
    status: boot.status,
    error: boot.error === null ? null : errorMessage(boot.error),
    lutBuilds: lutBuildCount(),
  }),
  loadInputs: (log) => {
    const scripted = game.scriptedInput;
    if (scripted === null) throw new Error('__ssp.loadInputs: the Game has no scripted input');
    scripted.load(log);
  },
});

// The loop renders from the first frame (palette index 00 until BootScene has installed the registry). A missing
// or off-palette atlas, bad font metrics or a routed scene that fails to enter rejects here and is reported loudly,
// naming the asset (`__ssp.boot()` reports it too); test mode then never reports ready. In test mode, once the
// routed scene is in: advance `tick=<n>` ticks, render, report ready, then apply `freeze`.
game.start();
boot.run(game.scenes, { seed }).then(
  () => {
    if (testHooks === null) return;
    testHooks.api.step(testHooks.params.tick);
    testHooks.markReady();
    game.loop.setFrozen(testHooks.params.freeze);
  },
  (error: unknown) => {
    console.error(`Street Sweeper Pro: boot failed: ${errorMessage(error)}`, error);
  },
);

// The F1 dev panel (SSP-048): dev builds only, never in test mode. The dynamic import sits behind
// `import.meta.env.DEV`, so release builds drop the module (and its marker string) entirely. In the shift flow
// it edits and saves the flow's current shift (ShiftFlow.devShift), so tuning edits carry into Try Again.
if (import.meta.env.DEV && !testMode) {
  void import('./debug/devPanel.ts').then(({ mountDevPanel }) => {
    const panel = mountDevPanel({
      drive: game.drive,
      shift: flow?.devShift ?? null,
      status: () => {
        const renderer = game.renderer;
        const rig = renderer.rig;
        const lines = [
          `H ${rig.height.value.toFixed(2)} m  W ${rig.internalWidth}  scale ${renderer.upscale}x`,
          `cam ${rig.snappedX.toFixed(4)}, ${rig.snappedZ.toFixed(4)} m  frac ${rig.fractionX.toFixed(3)}, ${rig.fractionY.toFixed(3)} px`,
          `draw calls ${renderer.drawCalls} (world + palette + blit)  night ${renderer.night ? 'on' : 'off'}`,
        ];
        const top = game.scenes.top;
        if (top instanceof SpikeScene) {
          lines.push(
            `actor frame ${top.drawnFrame}${top.hasSprites ? '' : ' (no actors)'}  ticks ${game.loop.ticks}`,
          );
        } else if (top !== null && !(top instanceof ShiftScene)) {
          lines.push(`scene ${top.id}  ticks ${game.loop.ticks}`);
        }
        return lines.join('\n');
      },
    });
    game.afterFrame = () => panel.frame(game.actions?.sceneActions ?? 0);
  });
}
