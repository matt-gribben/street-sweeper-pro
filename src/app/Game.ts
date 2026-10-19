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
// Scenes read the frame's pause/map/dev-panel edges from `game.actions.sceneActions` (the dev panel reads F1 from
// its `afterFrame` hook). `options.input`
// replaces the whole source (then `actions` is null).
//
// Camera: a scene that follows something (ShiftScene follows Bessie, SSP-046) calls `followCamera` from its
// render(), with the interpolated pose and velocity, every frame; the rig then moves by that frame's render time
// (look-ahead and speed zoom, SSP-047). Until a scene does, the camera stands over the origin and pans north at
// `drive.speedMps` (the dev panel's slider; 0 otherwise), which is what the M0 spike scenes see. Test mode turns
// the look-ahead and speed-zoom springs off, so test frames never depend on timing, unless `springs=1` asks for
// the live camera (its fixed 1/60 s frames keep it deterministic); `__ssp.setCamera` pins it for good
// (pinCamera), and a pinned camera ignores followCamera. releaseCamera puts the springs back at rest.

import { Group } from 'three';
import { TEST_RENDER_STEP_S } from '../debug/testHooks.ts';
import { Actions } from '../input/actions.ts';
import { browserPadSource, GamepadDevice } from '../input/gamepad.ts';
import { KeyboardDevice } from '../input/keyboard.ts';
import { pinCameraRig, resetCameraSprings, updateCameraRig } from '../render/camera.ts';
import { Renderer } from '../render/Renderer.ts';
import { type AtlasName, loadAtlas, type SpriteAtlas } from '../render/spriteAtlas.ts';
import { attachUpscaler } from '../render/upscale.ts';
import { DT_S } from '../sim/constants.ts';
import { EV } from '../sim/eventQueue.ts';
import type { InputFrame } from '../sim/inputFrame.ts';
import { EventBus } from './events.ts';
import { createLoop, type Loop } from './loop.ts';
import { SceneManager } from './SceneManager.ts';

/** What scenes get from the Game: the renderer (camera rig, night switch), the world-pass and UI-pass roots. */
export type SceneContext = {
  readonly renderer: Renderer;
  /** World-pass root: a scene adds its content here in enter() and removes it in exit(). */
  readonly root: Group;
  /**
   * UI-pass root (TECHNICAL_DESIGN §12.3 pass 2, SSP-069): orthographic, internal pixels, y down. A scene adds its
   * UiSpriteBatch meshes here in enter() and removes them in exit(); they draw over the world, never shadowed or
   * darkened at night.
   */
  readonly ui: Group;
  /** Loads one sprite atlas (spriteAtlas.ts loadAtlas). */
  loadAtlas(name: AtlasName): Promise<SpriteAtlas>;
  /**
   * Pins the camera at (x, y) sim metres and height h metres, springs off for good (Game.pinCamera). Test
   * scenes with a fixed view use it (`level_preview`, SSP-045); `__ssp.setCamera` can still move it after.
   */
  pinCamera(x: number, y: number, h: number): void;
  /**
   * Points the follow camera at its subject (x, y) sim metres moving at (vx, vy) m/s (look-ahead leads along that
   * velocity), its speed-zoom target taken from `speedMps` (Bessie's vLong) (Game.followCamera). From the first
   * call the Game stops its own pan; call it from render() every frame, or once from enter() to place the camera
   * before the first frame. Ignored while the camera is pinned.
   */
  followCamera(xM: number, yM: number, vxMps: number, vyMps: number, speedMps: number): void;
  /** Hands the camera back to the Game's own pan, springs at rest (a following scene calls it from exit()). */
  releaseCamera(): void;
};

/** One InputFrame per tick, edges latched (src/input/actions.ts, SSP-044). */
export type TickInputSource = {
  /** Once per display frame, before its ticks (device polling). Optional. */
  beginFrame?(): void;
  sampleForTick(): Readonly<InputFrame>;
};

/**
 * Camera and night settings: the Game's own camera pan speed (used only while no scene follows anything, i.e.
 * the M0 spike scenes; ShiftScene follows Bessie, SSP-046), the speed-zoom and look-ahead switches (also applied
 * to the follow camera) and night. The dev panel edits it in place outside test mode.
 */
export type DriveSettings = {
  speedMps: number;
  zoomEnabled: boolean;
  lookAheadEnabled: boolean;
  night: boolean;
};

export type GameOptions = {
  /** `?test=1`: fixed 1/60 s frames, look-ahead and speed-zoom springs off, frames held until ready (main.ts). */
  readonly testMode: boolean;
  /** `?test=1&springs=1`: keep the look-ahead and speed-zoom springs on in test mode. Ignored outside it. */
  readonly testSprings?: boolean;
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
  /**
   * Called once per display frame after the frame is drawn, or null. The dev panel (SSP-048, dev builds only)
   * sets it to read the frame's scene-layer F1 edge and refresh its readouts; it only observes.
   */
  afterFrame: (() => void) | null = null;
  private readonly root: Group;
  private readonly uiRoot: Group;
  private readonly input: TickInputSource;
  private cameraPinned = false;
  /** True while a scene drives the camera through followCamera. */
  private cameraFollowed = false;
  private focusZ = 0;
  /** Render time of the frame being drawn, for followCamera; 0 outside renderFrame (enter() placement). */
  private frameRenderS = 0;

  constructor(canvas: HTMLCanvasElement, options: GameOptions) {
    this.root = new Group();
    this.root.name = 'sceneRoot';
    this.renderer = new Renderer(canvas, this.root);
    this.uiRoot = new Group();
    this.uiRoot.name = 'uiRoot';
    this.renderer.ui.add(this.uiRoot);
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
    const springsOff = options.testMode && options.testSprings !== true;
    this.drive = {
      speedMps: 0,
      zoomEnabled: springsOff ? false : this.renderer.rig.zoomEnabled,
      lookAheadEnabled: springsOff ? false : this.renderer.rig.lookAheadEnabled,
      night: options.night,
    };
    this.sceneContext = {
      renderer: this.renderer,
      root: this.root,
      ui: this.uiRoot,
      loadAtlas: (name) => loadAtlas(name),
      pinCamera: (x, y, h) => this.pinCamera(x, y, h),
      followCamera: (x, y, vx, vy, speedMps) => this.followCamera(x, y, vx, vy, speedMps),
      releaseCamera: () => {
        this.cameraFollowed = false;
        resetCameraSprings(this.renderer.rig);
      },
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

  /** True while a scene drives the camera (followCamera since the last releaseCamera). */
  get isCameraFollowed(): boolean {
    return this.cameraFollowed;
  }

  /**
   * The follow camera (SceneContext.followCamera): subject (x, y) sim metres moving at (vx, vy) m/s, speed-zoom
   * target from `speedMps`, springs stepped by the current frame's render time (0 when called outside a frame,
   * e.g. from enter()). The rig leads the subject along its velocity, snaps to the 1/16 m texel grid and keeps the
   * sub-pixel remainder for the blit (camera.ts).
   */
  followCamera(xM: number, yM: number, vxMps: number, vyMps: number, speedMps: number): void {
    this.cameraFollowed = true;
    if (this.cameraPinned) return;
    const rig = this.renderer.rig;
    rig.zoomEnabled = this.drive.zoomEnabled;
    rig.lookAheadEnabled = this.drive.lookAheadEnabled;
    updateCameraRig(rig, xM, yM, vxMps, vyMps, speedMps, this.frameRenderS);
  }

  /**
   * One display frame: move the camera by `frameS` of render time (the Game's own pan, unless a scene follows
   * something, in which case the scene moves it from its render()), pose every scene, draw.
   */
  private renderFrame(alpha: number, frameS: number): void {
    const renderer = this.renderer;
    if (!this.cameraPinned && !this.cameraFollowed) {
      // The pan is the M0 spike scenes' stand-in subject: it moves north (−y) at the slider's speed.
      const speedMps = this.drive.speedMps;
      this.focusZ -= speedMps * frameS;
      renderer.rig.zoomEnabled = this.drive.zoomEnabled;
      renderer.rig.lookAheadEnabled = this.drive.lookAheadEnabled;
      updateCameraRig(renderer.rig, 0, this.focusZ, 0, -speedMps, speedMps, frameS);
    }
    renderer.night = this.drive.night;
    this.frameRenderS = frameS;
    this.scenes.render(alpha);
    this.frameRenderS = 0;
    renderer.render();
    this.afterFrame?.();
  }
}
