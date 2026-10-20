// BootScene (TECHNICAL_DESIGN §6.2, §6.3, SSP-284): the root scene. It loads the shared asset registry once per
// page (src/app/assetRegistry.ts: every atlas with its load-time palette check, every font's metrics and the
// palette pass's LUT, remap and palette tables), installs it in the Game (SceneContext.assets, and the palette
// tables into the renderer's palette pass) and then hands off to the first scene `bootRoute` chose: the shift
// flow's intro card by default (TitleScene from M4, SSP-157), or, with `?test=1&scene=<id>`, that scene (the
// dotted BOOT → ZOO edge of §6.2). Later scenes take their atlases, fonts and tables from the registry and load
// none themselves.
//
//   run(scenes)   pushes the BootScene (its enter() is the load) and, once it is on the stack, calls handOff,
//                 which replaces it with the routed scene. The promise resolves when that scene has joined the
//                 stack (main.ts then reports `__ssp.ready`), and rejects if the boot or the hand-off failed.
//   enter()       loads the registry and installs it. A failed load (an HTTP error, an off-palette pixel, a stale
//                 FRAME table, bad metrics) rejects with an error naming the asset; the scene never joins the
//                 stack, `status` turns 'failed' and `error` holds it (main.ts logs it and `__ssp.boot()` shows it).
//
// It draws nothing: until the registry is in, the renderer clears the canvas to palette index 00 (Renderer.render).
// Later extensions: audio codec selection and SFX decoding (SSP-174, M5) and loading the save (SSP-186, M6) join
// this same scene's parallel load. A loading progress bar is out of scope.
import type { Assets } from '../app/assetRegistry.ts';
import type { Scene, SceneManager, SceneParams } from '../app/SceneManager.ts';
import type { InputFrame } from '../sim/inputFrame.ts';
import { DISTRICT_ID_PATTERN } from '../sim/replay.ts';
import { DEFAULT_DISTRICT } from './ShiftScene.ts';
import { isSpikeTestScene, SPIKE_TEST_SCENES, type SpikeTestSceneId } from './SpikeScene.ts';

/**
 * `?test=1&scene=` IDs of the single test scenes BootScene can hand off to (besides the shift flow's). `zoo` (SSP-298)
 * is the asset zoo: test-only, never the target of a menu or a scene transition. `fx_puddle` (SSP-102) is a Puddle
 * Lane shift with one puddle placed on Mangle Street, for the splash fx (src/scenes/FxPuddleScene.ts). `stress`
 * (SSP-106) is the NPC budget's stress fixture: High Street with every store at capacity and its director
 * (src/scenes/StressScene.ts, src/debug/stress.ts), for perf.spec.ts.
 */
export const TEST_SCENES = [
  'level_preview',
  'text_sample',
  'panel_sample',
  'hud_sample',
  'spike_city',
  'zoo',
  'fx_puddle',
  'stress',
] as const;
export type TestSceneId = (typeof TEST_SCENES)[number];

/** `?test=1&scene=shift_intro`: the shift flow from its intro card (also the default without `scene`). */
export const SHIFT_INTRO_SCENE = 'shift_intro';

/** `?test=1&scene=shift`: the shift flow straight into a Puddle Lane shift, the intro card skipped. */
export const SHIFT_SCENE = 'shift';

/** Where boot hands off to. */
export type BootRoute =
  /** The shift flow for `district`: at the intro card, or straight into a shift (the intro skipped). */
  | { readonly kind: 'flow'; readonly district: string; readonly atIntro: boolean }
  /** One test scene, pushed on its own (`?test=1&scene=<id>`). */
  | { readonly kind: 'scene'; readonly scene: TestSceneId | SpikeTestSceneId }
  /** Dev builds: `?world=palette_test|empty`, a static spike world. */
  | { readonly kind: 'dev_world'; readonly world: 'palette_test' | 'empty' }
  /** Dev builds: `?world=spike_city`, `?actors=…`, `?actorFrame=N`: the M0 spike city. */
  | { readonly kind: 'dev_spike_city'; readonly actors: boolean; readonly actorFrame: number | null };

/** The dev-build URL parameters (`?world=`, `?actors=`, `?actorFrame=`), each null when absent. */
export type DevBootQuery = {
  readonly world: string | null;
  readonly actors: string | null;
  readonly actorFrame: string | null;
};

function isTestScene(id: string): id is TestSceneId {
  return (TEST_SCENES as readonly string[]).includes(id);
}

/**
 * Picks the scene boot hands off to. `testScene` is `?test=1&scene=<id>` (null outside test mode or without it);
 * `dev` holds the dev-build parameters (null in release builds, which have no dev worlds); `testMode` is `?test=1`.
 *
 * - `district.<name>` → the flow straight into that district's shift; `shift` → the same for Puddle Lane;
 *   `shift_intro` → the flow at the intro card; a test scene or spike test scene → that scene. Any other ID throws
 *   (so does `tally`, which needs a finished shift: boot the flow and step to the end).
 * - Without `scene`, dev builds keep the M0 spike city for the spike scripts: `?world=palette_test|empty`, and
 *   `?world=spike_city`, `?actors=` or `?actorFrame=N` (the pinned actor frame only outside test mode).
 * - Otherwise: the shift flow at the intro card for Puddle Lane (TitleScene from M4, SSP-157).
 */
export function bootRoute(testScene: string | null, dev: DevBootQuery | null, testMode: boolean): BootRoute {
  if (testScene !== null) {
    if (DISTRICT_ID_PATTERN.test(testScene)) return { kind: 'flow', district: testScene, atIntro: false };
    if (testScene === SHIFT_SCENE) return { kind: 'flow', district: DEFAULT_DISTRICT, atIntro: false };
    if (testScene === SHIFT_INTRO_SCENE) return { kind: 'flow', district: DEFAULT_DISTRICT, atIntro: true };
    if (isTestScene(testScene) || isSpikeTestScene(testScene)) return { kind: 'scene', scene: testScene };
    const known = [SHIFT_INTRO_SCENE, SHIFT_SCENE, 'district.<name>', ...TEST_SCENES, ...SPIKE_TEST_SCENES];
    throw new Error(`?test=1: unknown scene '${testScene}' (known: ${known.join(', ')})`);
  }
  if (dev !== null) {
    if (dev.world === 'palette_test' || dev.world === 'empty') return { kind: 'dev_world', world: dev.world };
    if (dev.world === 'spike_city' || dev.actors !== null || dev.actorFrame !== null) {
      // Test mode never pins the actor frame: test frames follow the tick count.
      const pinned = testMode ? Number.NaN : Number.parseInt(dev.actorFrame ?? '', 10);
      return {
        kind: 'dev_spike_city',
        actors: dev.actors !== '0',
        actorFrame: Number.isNaN(pinned) ? null : pinned,
      };
    }
  }
  return { kind: 'flow', district: DEFAULT_DISTRICT, atIntro: true };
}

/** Where the boot is. */
export type BootStatus = 'idle' | 'loading' | 'loaded' | 'failed';

export type BootSceneOptions = {
  /** Loads the registry (main.ts: loadAssets from the browser; tests inject file readers). */
  readonly load: () => Promise<Assets>;
  /** Makes the registry the Game's (SceneContext.assets) and installs the palette tables in the renderer. */
  readonly install: (assets: Assets) => void;
  /** Replaces the BootScene with the routed scene; resolves once that scene has joined the stack. */
  readonly handOff: (assets: Assets) => Promise<void>;
};

/** The root scene: loads the asset registry once, then hands off. */
export class BootScene implements Scene {
  readonly id = 'boot';
  readonly blocksUpdateBelow = false;
  readonly simEvents = null;
  private readonly options: BootSceneOptions;
  private loaded: Assets | null = null;
  private state: BootStatus = 'idle';
  private failure: unknown = null;

  constructor(options: BootSceneOptions) {
    this.options = options;
  }

  /** Where the boot is: idle before run(), loading, loaded (the registry is installed) or failed. */
  get status(): BootStatus {
    return this.state;
  }

  /** The error that failed the boot (or the hand-off), or null. */
  get error(): unknown {
    return this.failure;
  }

  /** The registry once loaded (null before). */
  get assets(): Assets | null {
    return this.loaded;
  }

  /** Pushes this scene (the load), then hands off to the routed scene. Call once. */
  async run(scenes: SceneManager, params: SceneParams): Promise<void> {
    if (this.state !== 'idle') throw new Error('BootScene.run: the boot has already run');
    await scenes.push(this, params);
    const assets = this.loaded;
    if (assets === null) throw new Error('BootScene.run: entered without loading the registry');
    try {
      await this.options.handOff(assets);
    } catch (error: unknown) {
      this.state = 'failed';
      this.failure = error;
      throw error;
    }
  }

  async enter(_params: SceneParams): Promise<void> {
    this.state = 'loading';
    try {
      const assets = await this.options.load();
      this.options.install(assets);
      this.loaded = assets;
      this.state = 'loaded';
    } catch (error: unknown) {
      this.state = 'failed';
      this.failure = error;
      throw error;
    }
  }

  /** Nothing to release: the registry outlives the BootScene (the page owns it). */
  exit(): void {}

  fixedUpdate(_input: Readonly<InputFrame>): void {}

  render(_alpha: number): void {}
}
