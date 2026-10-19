// The browser composition root (TECHNICAL_DESIGN §3.1, SSP-043): wires the renderer, the input, the scene
// stack, the event bus and the fixed 60 Hz loop. main.ts parses the URL, builds a Game, pushes the first scene
// and installs the test hooks; everything that runs per tick or per frame goes through here.
//
// Per tick (loop.ts): input.sampleForTick() → scenes.fixedUpdate(input) → scenes.drainEvents(events).
// Per frame: the camera rig moves by the frame's render time (render state only: the sim never reads the
// camera, §7.4), every scene poses its content (bottom first), then the renderer draws the frame once.
//
// Input (SSP-044): the Game builds the keyboard (listening on the window) and the standard gamepad, merges them
// in src/input/actions.ts, polls once per frame (beginFrame) and samples one quantised InputFrame per tick.
// Gamepad rumble follows EV.Impact on the bus: src/input may not import the bus, so the wiring lives here.
// Scenes read the frame's pause/map/dev-panel edges from `game.actions.sceneActions`. `options.input`
// replaces the whole source (then `actions` is null).
//
// Camera: until ShiftScene follows Bessie (SSP-046) the camera stands over the origin and pans north at
// `drive.speedMps` (the dev panel's slider; 0 otherwise). Test mode pins speed 0 and turns the speed-zoom
// spring off, so test frames never depend on timing; `__ssp.setCamera` pins it for good (pinCamera).

import { Group } from 'three';
import { TEST_RENDER_STEP_S } from '../debug/testHooks.ts';
import { Actions } from '../input/actions.ts';
import { browserPadSource, GamepadDevice } from '../input/gamepad.ts';
import { KeyboardDevice } from '../input/keyboard.ts';
import { pinCameraRig, updateCameraRig } from '../render/camera.ts';
import { Renderer } from '../render/Renderer.ts';
import { type AtlasName, loadAtlas, type SpriteAtlas } from '../render/spriteAtlas.ts';
import { attachUpscaler } from '../render/upscale.ts';
import { DT_S } from '../sim/constants.ts';
import { EV } from '../sim/eventQueue.ts';
import type { InputFrame } from '../sim/inputFrame.ts';
import { EventBus } from './events.ts';
import { createLoop, type Loop } from './loop.ts';
import { SceneManager } from './SceneManager.ts';

/** What scenes get from the Game: the renderer (camera rig, night switch) and the world-pass root. */
export type SceneContext = {
  readonly renderer: Renderer;
  /** World-pass root: a scene adds its content here in enter() and removes it in exit(). */
  readonly root: Group;
  /** Loads one sprite atlas (spriteAtlas.ts loadAtlas). */
  loadAtlas(name: AtlasName): Promise<SpriteAtlas>;
  /**
   * Pins the camera at (x, y) sim metres and height h metres, springs off for good (Game.pinCamera). Test
   * scenes with a fixed view use it (`level_preview`, SSP-045); `__ssp.setCamera` can still move it after.
   */
  pinCamera(x: number, y: number, h: number): void;
};

/** One InputFrame per tick, edges latched (src/input/actions.ts, SSP-044). */
export type TickInputSource = {
  /** Once per display frame, before its ticks (device polling). Optional. */
  beginFrame?(): void;
  sampleForTick(): Readonly<InputFrame>;
};

/**
 * The camera drive until M1's follow camera (SSP-046): pan speed, the speed-zoom spring switch and night.
 * The dev panel edits it in place outside test mode.
 */
export type DriveSettings = {
  speedMps: number;
  zoomEnabled: boolean;
  night: boolean;
};

export type GameOptions = {
  /** `?test=1`: fixed 1/60 s frames, speed-zoom spring off, frames held until ready (see main.ts). */
  readonly testMode: boolean;
  /** Start with stepping frozen (test mode holds the loop until `ready`). */
  readonly frozen: boolean;
  /** Night on at boot (`night=1`, SSP-021). */
  readonly night: boolean;
  /** Per-frame timing observer (test mode's `__ssp.perf()`), or null. */
  readonly onFrameTimed: ((nowMs: number, workMs: number) => void) | null;
  /** The input source; defaults to the keyboard and gamepad merged by src/input/actions.ts. */
  readonly input?: TickInputSource;
};

/** Owns the renderer, scene stack, event bus and loop for the page's lifetime. */
export class Game {
  readonly renderer: Renderer;
  readonly scenes: SceneManager;
  readonly events: EventBus;
  readonly loop: Loop;
  readonly drive: DriveSettings;
  /** The keyboard + gamepad merge, or null when `options.input` replaced it. */
  readonly actions: Actions | null;
  readonly sceneContext: SceneContext;
  private readonly root: Group;
  private readonly input: TickInputSource;
  private cameraPinned = false;
  private focusZ = 0;

  constructor(canvas: HTMLCanvasElement, options: GameOptions) {
    this.root = new Group();
    this.root.name = 'sceneRoot';
    this.renderer = new Renderer(canvas, this.root);
    attachUpscaler(canvas, (layout) => this.renderer.resize(layout));
    this.scenes = new SceneManager();
    this.events = new EventBus();
    if (options.input === undefined) {
      const keyboard = new KeyboardDevice(DT_S);
      keyboard.attach(window);
      const gamepad = new GamepadDevice(browserPadSource(navigator));
      this.events.on(EV.Impact, (event) => gamepad.rumbleImpact(event.speedMps));
      this.actions = new Actions([keyboard, gamepad]);
      this.input = this.actions;
    } else {
      this.actions = null;
      this.input = options.input;
    }
    this.drive = {
      speedMps: 0,
      zoomEnabled: options.testMode ? false : this.renderer.rig.zoomEnabled,
      night: options.night,
    };
    this.sceneContext = {
      renderer: this.renderer,
      root: this.root,
      loadAtlas: (name) => loadAtlas(name),
      pinCamera: (x, y, h) => this.pinCamera(x, y, h),
    };
    const scenes = this.scenes;
    const events = this.events;
    const input = this.input;
    this.loop = createLoop(
      {
        beginFrame: () => input.beginFrame?.(),
        sampleForTick: () => input.sampleForTick(),
        fixedUpdate: (frame) => scenes.fixedUpdate(frame),
        drainEvents: () => scenes.drainEvents(events),
        render: (alpha, frameS) => this.renderFrame(alpha, frameS),
      },
      {
        fixedFrameS: options.testMode ? TEST_RENDER_STEP_S : null,
        frozen: options.frozen,
        onFrameTimed: options.onFrameTimed,
      },
    );
  }

  /** Starts the loop and resets its accumulator whenever the tab becomes visible again. */
  start(): void {
    document.addEventListener('visibilitychange', () => {
      this.loop.handleVisibilityChange(document.hidden);
    });
    this.loop.start();
  }

  /** True once pinCamera() ran: the camera no longer moves by itself. */
  get isCameraPinned(): boolean {
    return this.cameraPinned;
  }

  /** Pins the camera at (x, y) sim metres and height h metres, springs off for good (`__ssp.setCamera`). */
  pinCamera(x: number, y: number, h: number): void {
    pinCameraRig(this.renderer.rig, x, y, h);
    this.cameraPinned = true;
  }

  /** One display frame: move the camera by `frameS` of render time, pose every scene, draw. */
  private renderFrame(alpha: number, frameS: number): void {
    const renderer = this.renderer;
    if (!this.cameraPinned) {
      this.focusZ -= this.drive.speedMps * frameS;
      renderer.rig.zoomEnabled = this.drive.zoomEnabled;
      updateCameraRig(renderer.rig, 0, this.focusZ, this.drive.speedMps, frameS);
    }
    renderer.night = this.drive.night;
    this.scenes.render(alpha);
    renderer.render();
  }
}
