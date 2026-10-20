// The scene stack (TECHNICAL_DESIGN §6.1, SSP-043). The top scene receives the player's input; scenes below it
// keep rendering (so PauseOverlay draws over a frozen ShiftScene, SSP-287). Below the top, scenes keep updating
// with a neutral InputFrame until one scene's `blocksUpdateBelow` is true: everything under it neither updates
// nor emits events.
//
// Transitions are async because enter() loads assets. While a transition runs, the stack as it was keeps
// updating and rendering (no blank frames); the new scene joins the stack only once enter() resolves, and a
// second transition requested meanwhile is a programmer error (it throws). replace() enters the new scene
// before the old one exits; replaceAll() (SSP-287) does the same for the whole stack (a PauseOverlay and the
// ShiftScene under it leave together on Restart Shift or Retire). A scene whose enter() rejects never joins the stack and must release whatever it
// loaded before rejecting.
//
// Events: after each tick the loop calls drainEvents(bus), which drains the sim EventQueue of every scene that
// updated in that tick (top first). A scene that did not update is never drained, so its last sealed tick is
// not dispatched twice (the bus also refuses a tick it already drained).

import type { ReadonlyEventQueue } from '../sim/eventQueue.ts';
import { createInputFrame, type InputFrame } from '../sim/inputFrame.ts';
import type { EventBus } from './events.ts';

/**
 * Every scene ID (§6.2 scene flow, plus the test scenes of §18.5). The first block is the game's flow; the
 * spike scenes are the M0 test scenes `?test=1&scene=<id>` boots (`spike_city`, the default world before SSP-046,
 * is still reachable as `?test=1&scene=spike_city` and the dev-only `?world=spike_city`), and `level_preview` is
 * the SSP-045 test scene that draws compiled Puddle Lane from a pinned camera; `text_sample` is the SSP-069 bitmap-text
 * and UI-pass test scene, and `panel_sample` the SSP-285 9-slice panel and button-state test scene. `shift` is the drive-only
 * ShiftScene (SSP-046), the default boot scene from M1, which `?test=1&scene=district.<name>` also boots. `fx_puddle`
 * (SSP-102) boots a ShiftScene on Puddle Lane with one placed puddle; once in, that scene reports the ID `shift`.
 * `stress` (SSP-106) boots the NPC budget's stress fixture, a ShiftScene on High Street with every store at
 * capacity; it too reports `shift` once in.
 */
export const SCENE_IDS = [
  'boot',
  'title',
  'week_map',
  'workshop',
  'shift_intro',
  'shift',
  'skip_run',
  'tally',
  'pause',
  'settings',
  'credits',
  'zoo',
  'spike_city',
  'lean_quadrants',
  'scale_1440',
  'scale_sheet',
  'level_preview',
  'text_sample',
  'panel_sample',
  'hud_sample',
  'fx_puddle',
  'stress',
] as const;
export type SceneId = (typeof SCENE_IDS)[number];

/** What a scene is entered with. Scenes without a sim ignore both fields. */
export type SceneParams = {
  /** The run seed, uint32 (`?test=1&seed=<n>`, or the shift's seed). */
  readonly seed: number;
  /**
   * The district a ShiftScene loads (`district.<name>`, e.g. `district.puddle_lane`, SSP-046). ShiftScene
   * refuses to enter without one; other scenes ignore it.
   */
  readonly district?: string;
};

/** The scene contract (§6.1). Scenes are classes: they own GPU resources and audio nodes. */
export interface Scene {
  readonly id: SceneId;
  /** Async asset loads happen here. The scene joins the stack when this resolves. */
  enter(params: SceneParams): Promise<void>;
  /** Releases GPU resources and audio nodes. Called once, when the scene leaves the stack. */
  exit(): void;
  /** One 60 Hz tick. The top scene gets the player's input; scenes below get a neutral frame. */
  fixedUpdate(input: Readonly<InputFrame>): void;
  /** One display frame; `alpha` in [0, 1] interpolates between the last two ticks. */
  render(alpha: number): void;
  /** True for overlays that freeze the scenes below (PauseOverlay). */
  readonly blocksUpdateBelow: boolean;
  /**
   * The sim EventQueue this scene's fixedUpdate seals (ShiftScene: its World's `events`), drained into the
   * event bus after every tick in which the scene updated; null for scenes without a sim.
   */
  readonly simEvents: ReadonlyEventQueue | null;
}

/** The neutral frame scenes under the top one receive: nothing held, pressed or steered. Never written. */
const NEUTRAL_INPUT: Readonly<InputFrame> = Object.freeze(createInputFrame());

/** Holds the scene stack and fans the loop's ticks and frames out to it. */
export class SceneManager {
  private readonly stack: Scene[] = [];
  /**
   * The scenes the last fixedUpdate updated, top first: the first `updatedCount` slots of a scratch array
   * reused every tick (setting `length = 0` would drop its backing store and reallocate on the next push).
   */
  private readonly updated: (Scene | null)[] = [];
  private updatedCount = 0;
  private transitioning = false;
  /**
   * Called with each scene as it joins the stack (after its enter() resolved, before the old top exits on a
   * replace), or null. main.ts records the IDs for `__ssp.sceneHistory()` in test mode (SSP-071); it only observes.
   */
  onEntered: ((scene: Scene) => void) | null = null;

  /** The top scene, or null when the stack is empty. */
  get top(): Scene | null {
    return this.stack[this.stack.length - 1] ?? null;
  }

  /** Number of scenes on the stack. */
  get size(): number {
    return this.stack.length;
  }

  /** True while a push or replace is waiting for enter(). */
  get busy(): boolean {
    return this.transitioning;
  }

  /** The stack's scene IDs, bottom first. */
  ids(): SceneId[] {
    return this.stack.map((scene) => scene.id);
  }

  /** Enters `scene` and puts it on top. */
  async push(scene: Scene, params: SceneParams): Promise<void> {
    this.beginTransition('push', scene);
    try {
      await scene.enter(params);
      this.stack.push(scene);
      this.onEntered?.(scene);
    } finally {
      this.transitioning = false;
    }
  }

  /** Enters `scene`, then exits the top scene and puts `scene` in its place (a plain push on an empty stack). */
  async replace(scene: Scene, params: SceneParams): Promise<void> {
    this.beginTransition('replace', scene);
    try {
      await scene.enter(params);
      const old = this.stack.pop();
      this.stack.push(scene);
      this.onEntered?.(scene);
      old?.exit();
    } finally {
      this.transitioning = false;
    }
  }

  /**
   * Enters `scene`, then exits every scene on the stack, top first, and leaves `scene` alone on it (SSP-287: Restart
   * Shift and Retire leave a PauseOverlay over its ShiftScene). The old stack keeps updating and rendering until
   * `scene` has entered, exactly as for replace(), which this equals on a stack of one.
   */
  async replaceAll(scene: Scene, params: SceneParams): Promise<void> {
    this.beginTransition('replaceAll', scene);
    try {
      await scene.enter(params);
      const old = this.stack.splice(0, this.stack.length);
      this.stack.push(scene);
      this.onEntered?.(scene);
      for (let i = old.length - 1; i >= 0; i -= 1) old[i]?.exit();
    } finally {
      this.transitioning = false;
    }
  }

  /** Exits and removes the top scene and returns it. Throws on an empty stack or during a transition. */
  pop(): Scene {
    if (this.transitioning) throw new Error('SceneManager.pop: a transition is in progress');
    const scene = this.stack.pop();
    if (scene === undefined) throw new Error('SceneManager.pop: the scene stack is empty');
    scene.exit();
    return scene;
  }

  /**
   * One tick: the top scene gets `input`, the scenes below get a neutral frame, down to and including the first
   * scene that blocks updates below it.
   */
  fixedUpdate(input: Readonly<InputFrame>): void {
    const updated = this.updated;
    // Collect first, then update: a scene may pop itself during its update without skipping another.
    let count = 0;
    for (let i = this.stack.length - 1; i >= 0; i -= 1) {
      const scene = this.stack[i];
      if (scene === undefined) continue;
      updated[count] = scene;
      count += 1;
      if (scene.blocksUpdateBelow) break;
    }
    // Clear the stale tail so the scratch never keeps an exited scene alive.
    for (let i = count; i < this.updatedCount; i += 1) updated[i] = null;
    this.updatedCount = count;
    for (let i = 0; i < count; i += 1) updated[i]?.fixedUpdate(i === 0 ? input : NEUTRAL_INPUT);
  }

  /** Drains the sim events of every scene the last fixedUpdate updated into `bus`, top first. */
  drainEvents(bus: EventBus): void {
    const updated = this.updated;
    for (let i = 0; i < this.updatedCount; i += 1) {
      const events = updated[i]?.simEvents ?? null;
      if (events !== null) bus.drain(events);
    }
  }

  /** One display frame: every scene renders, bottom first, so overlays draw over the scenes below. */
  render(alpha: number): void {
    const stack = this.stack;
    for (let i = 0; i < stack.length; i += 1) stack[i]?.render(alpha);
  }

  private beginTransition(kind: string, scene: Scene): void {
    if (this.transitioning) {
      throw new Error(`SceneManager.${kind}(${scene.id}): another transition is still in progress`);
    }
    if (this.stack.includes(scene)) {
      throw new Error(`SceneManager.${kind}(${scene.id}): the scene is already on the stack`);
    }
    this.transitioning = true;
  }
}
