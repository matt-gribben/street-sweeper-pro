// Entry point (SSP-043): parse the URL, build the Game (renderer, scene stack, event bus, fixed 60 Hz loop in
// src/app/loop.ts), start the first scene, install the `?test=1` hooks and start the loop. Since SSP-071 every
// build boots the shift flow (src/app/shiftFlow.ts) at the intro card for Puddle Lane: intro → shift → tally →
// Try Again, so `npm run dev` always runs a complete 240 s shift (ROADMAP §1 principle 5). BootScene (SSP-284)
// goes in front of it.

import { Game } from './app/Game.ts';
import type { Scene, SceneParams } from './app/SceneManager.ts';
import { ShiftFlow } from './app/shiftFlow.ts';
import { installTestHooks, readTestParams } from './debug/testHooks.ts';
import { NO_MENU_INPUT } from './input/actions.ts';
import { HudSampleScene } from './scenes/HudSampleScene.ts';
import { LevelPreviewScene } from './scenes/LevelPreviewScene.ts';
import { PanelSampleScene } from './scenes/PanelSampleScene.ts';
import { ShiftIntroScene } from './scenes/ShiftIntroScene.ts';
import { DEFAULT_DISTRICT, ShiftScene } from './scenes/ShiftScene.ts';
import {
  createDevWorldScene,
  createSpikeCityScene,
  createSpikeTestScene,
  isSpikeTestScene,
  SPIKE_TEST_SCENES,
  SpikeScene,
} from './scenes/SpikeScene.ts';
import { TallyScene } from './scenes/TallyScene.ts';
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

/** `?test=1&scene=shift_intro`: the shift flow from its intro card (also the default without `scene`, SSP-071). */
const SHIFT_INTRO_SCENE = 'shift_intro';

/** `?test=1&scene=shift`: the shift flow straight into a Puddle Lane shift, the intro card skipped. */
const SHIFT_SCENE = 'shift';

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

// Scene choice. Without `scene`, every build boots the shift flow at the intro card for Puddle Lane (SSP-071),
// seeded with `seed` (0 when absent). `?test=1&scene=<id>` boots `shift_intro` (the same); `shift` or
// `district.<name>` (the flow straight into that district's shift, the intro card skipped; it still ends on the
// tally); `level_preview` (compiled Puddle Lane from a pinned camera, SSP-045), `text_sample` (bitmap text over a
// shadowed street, SSP-069), `panel_sample` (9-slice panels and button states, SSP-285), `hud_sample` (the HUD at
// its widest, SSP-070), `spike_city` or a spike test scene. An unknown ID throws; so does `tally`, which needs a
// finished shift (boot the flow and step to the end). Dev builds keep the M0 spike city for the spike scripts:
// `?world=spike_city`, `?world=palette_test` (the SSP-016 palette test world for
// tools/spikes/swiftShaderPalettePass.ts), `?world=empty` (the draw-call baseline for tools/spikes/spikeCityFrame.ts),
// `?actors=0` (the city without its actors, tools/spikes/spriteBatchFrame.ts) and, outside test mode,
// `?actorFrame=N` (pin the drawn actor frame); release builds tree-shake those away.
const seed = testParams?.seed ?? 0;

/** What boots: one scene pushed on its own, or the shift flow from its intro card or straight into a shift. */
type FirstScene =
  | { readonly kind: 'scene'; readonly scene: Scene; readonly params: SceneParams }
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
  return { kind: 'scene', scene, params: { seed } };
}

function createFirstScene(): FirstScene {
  const sceneId = testParams?.scene ?? null;
  if (sceneId !== null) {
    if (DISTRICT_ID_PATTERN.test(sceneId)) return shiftFlow(sceneId, false);
    if (sceneId === SHIFT_SCENE) return shiftFlow(DEFAULT_DISTRICT, false);
    if (sceneId === SHIFT_INTRO_SCENE) return shiftFlow(DEFAULT_DISTRICT, true);
    if (sceneId === LEVEL_PREVIEW_SCENE) return single(new LevelPreviewScene(game.sceneContext));
    if (sceneId === TEXT_SAMPLE_SCENE) return single(new TextSampleScene(game.sceneContext));
    if (sceneId === PANEL_SAMPLE_SCENE) return single(new PanelSampleScene(game.sceneContext));
    if (sceneId === HUD_SAMPLE_SCENE) return single(new HudSampleScene(game.sceneContext));
    if (sceneId === SPIKE_CITY_SCENE) return single(createSpikeCityScene(game.sceneContext, true, null));
    if (!isSpikeTestScene(sceneId)) {
      const known = [
        SHIFT_INTRO_SCENE,
        SHIFT_SCENE,
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
    return single(createSpikeTestScene(sceneId, game.sceneContext));
  }
  if (import.meta.env.DEV) {
    const choice = params.get('world');
    if (choice === 'palette_test' || choice === 'empty') {
      return single(createDevWorldScene(game.sceneContext, choice));
    }
    if (choice === SPIKE_CITY_SCENE || params.has('actors') || params.has('actorFrame')) {
      // Test mode never pins the actor frame: test frames follow the tick count.
      const pinned = testMode ? Number.NaN : Number.parseInt(params.get('actorFrame') ?? '', 10);
      return single(
        createSpikeCityScene(
          game.sceneContext,
          params.get('actors') !== '0',
          Number.isNaN(pinned) ? null : pinned,
        ),
      );
    }
  }
  return shiftFlow(DEFAULT_DISTRICT, true);
}

const first = createFirstScene();
const flow = first.kind === 'flow' ? first.flow : null;

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
});

// The loop renders from the first frame; the scene's world draws alone while its atlases load. A bad atlas
// rejects here and is reported loudly rather than drawn (and test mode never reports ready). In test mode, once
// the scene is in: advance `tick=<n>` ticks, render, report ready, then apply `freeze`.
game.start();
const started =
  first.kind === 'scene'
    ? game.scenes.push(first.scene, first.params)
    : first.atIntro
      ? first.flow.startAtIntro()
      : first.flow.startAtShift();
started.then(
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
