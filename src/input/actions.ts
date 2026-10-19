// Device merge (TECHNICAL_DESIGN §13.1, SSP-044): keyboard, gamepad and (M8) touch report what the player is
// doing, and Actions turns that into exactly one quantised InputFrame per sim tick. The loop calls
//
//   beginFrame()     once per rendered frame, before that frame's ticks: the gamepad polls here, and the
//                    frame's scene-layer actions (pause, map, dev panel) are collected;
//   sampleForTick()  once per tick: per-tick device state advances (the keyboard's steer ramp), the analogue
//                    values are quantised and the latched sim edges are delivered.
//
// Quantisation (the rule replays depend on): an analogue value v in −1..1 (or 0..1) becomes
//   sign(v) · Math.round(min(1, |v|) · max + QUANTISE_EPS)
// with max = 255 for throttle and brake and 127 for steer. Rounding the magnitude makes halves round away from
// zero, so left and right mirror exactly (plain Math.round sends −63.5 to −63 but 63.5 to 64). QUANTISE_EPS
// absorbs binary representation error: (0.575 − 0.15) / 0.85 · 127 is 63.49999999999999 in doubles, and the
// documented example (stick 0.575 → steer 64) must hold. The epsilon is a millionth of one step, so it only
// decides values that are a half to within float error.
//
// Edge latching: a device latches every rising edge (a key going down, a pad button newly pressed) until it is
// taken. sampleForTick() takes the sim edges (BRUSH, HORN), so a press and release between two ticks still
// reaches exactly one tick, and when several ticks run in one frame only the first sees the edge.
//
// Scene-layer actions (PAUSE, MAP, DEV_PANEL) never enter the sim frame: pausing and the map overlay are not
// part of a replay. beginFrame() moves their edges into `sceneActions`, which holds them for that one frame (the
// dev panel reads F1 there, once per drawn frame). Since SSP-287 they are also latched until a scene takes them
// with takeSceneEdges(mask), once per tick from its fixedUpdate (ShiftScene and PauseOverlay take PAUSE), so a
// press is never lost to a frame that ran no tick and `__ssp.step(n)` delivers it on its first tick, exactly as
// the menu edges below.
//
// Menu actions (MENU_UP, MENU_DOWN, MENU_SELECT, MENU_BACK; SSP-071) never enter the sim frame either. They share
// keys and buttons with driving (Space is BRUSH and MENU_SELECT, W/↑ THROTTLE and MENU_UP), so a device reports
// both bits and each consumer takes its own. A menu scene (ShiftIntroScene, TallyScene) takes them once per tick
// from its fixedUpdate with takeMenuEdges(): they stay latched in the device until taken, so a menu press is
// never lost to a frame that ran no tick, and step(n) in test mode sees it on its first tick. Nothing takes them
// while a shift runs, so a menu scene discards what is latched when it enters (takeMenuEdges() and drop it).
//
// SSP-286 adds what a menu needs beyond the edges (MenuInputSource): `menuHeld` (the MENU_UP / MENU_DOWN bits held
// now, for hold-repeat in menuInput.ts), the pointer queue (pointer.ts: mouse presses and releases on the canvas,
// in client pixels, taken per tick by menu scenes) and `activeDevice`, the kind of device the player used last
// ('keyboard' covers the keyboard and the mouse). Every device and the pointer are ActivitySources: each reports
// whether it was used since it was last asked, and Actions switches the active device on the first such report
// from another kind. Prompts read it to pick their glyphs (src/ui/glyphs.ts). None of this touches the InputFrame.
//
// src/input may import only the InputFrame module from src/sim (TECHNICAL_DESIGN §2.1,
// tests/unit/inputImports.test.ts). The composition root (src/app/Game.ts) builds the devices, passes the tick
// length and wires gamepad rumble to the event bus.
//
// Allocation: sampleForTick() rewrites one preallocated frame and creates nothing. The returned frame is reused
// on the next call: the World copies it in phase 1 and the replay recorder copies it from there.

import {
  BRAKE_MAX,
  BUTTON,
  createInputFrame,
  type InputFrame,
  PRESSED,
  STEER_MAX,
  THROTTLE_MAX,
} from '../sim/inputFrame.ts';

/**
 * Digital actions a device can report, as bits. BRUSH and HORN reach the sim as rising edges, SPRAY and
 * INTERACT as held buttons; MAP, PAUSE and DEV_PANEL are scene-layer only and never reach the sim, nor do the
 * MENU_* bits (menu navigation, taken per tick by menu scenes through takeMenuEdges).
 */
export const ACTION = {
  BRUSH: 1 << 0,
  SPRAY: 1 << 1,
  HORN: 1 << 2,
  INTERACT: 1 << 3,
  MAP: 1 << 4,
  PAUSE: 1 << 5,
  DEV_PANEL: 1 << 6,
  MENU_UP: 1 << 7,
  MENU_DOWN: 1 << 8,
  MENU_SELECT: 1 << 9,
  MENU_BACK: 1 << 10,
} as const;
export type Action = (typeof ACTION)[keyof typeof ACTION];

/** Actions the sim sees as rising edges (InputFrame.pressed). */
export const SIM_EDGE_ACTIONS = ACTION.BRUSH | ACTION.HORN;

/** Actions the sim sees while held (InputFrame.buttons). */
export const SIM_HELD_ACTIONS = ACTION.SPRAY | ACTION.INTERACT;

/** Actions consumed by the scene layer: never in the sim frame (§13.1). */
export const SCENE_ACTIONS = ACTION.MAP | ACTION.PAUSE | ACTION.DEV_PANEL;

/** Menu navigation actions (SSP-071): taken per tick by menu scenes, never in the sim frame. */
export const MENU_ACTIONS = ACTION.MENU_UP | ACTION.MENU_DOWN | ACTION.MENU_SELECT | ACTION.MENU_BACK;

/** Every ACTION bit. */
export const ALL_ACTIONS = SIM_EDGE_ACTIONS | SIM_HELD_ACTIONS | SCENE_ACTIONS | MENU_ACTIONS;

/** The kind of device the player used last (SSP-286): the keyboard and the mouse count as one. M8 adds 'touch'. */
export type InputDeviceKind = 'keyboard' | 'gamepad';

/** The device kind a Game starts with, before any input. */
export const DEFAULT_INPUT_DEVICE: InputDeviceKind = 'keyboard';

/** The directions a held menu input repeats (menuInput.ts). */
export const MENU_REPEAT_ACTIONS = ACTION.MENU_UP | ACTION.MENU_DOWN;

/** Something whose use switches the active device: every InputDevice, and the pointer (pointer.ts). */
export type ActivitySource = {
  readonly kind: InputDeviceKind;
  /**
   * True when the player used the device since the last call (a bound key or a pad button newly down, a stick or
   * trigger leaving rest, a press on the canvas); clears it.
   */
  takeActivity(): boolean;
};

/** One mouse (or pen) press or release on the canvas, in client (CSS) pixels: what pointer.ts queues. */
export type PointerSample = {
  /** POINTER_PHASE value. */
  phase: PointerPhase;
  clientX: number;
  clientY: number;
};

/** The pointer phases a menu reads. Down focuses and arms an item; Up over the armed item selects it. */
export const POINTER_PHASE = { Down: 1, Up: 2, Cancel: 3 } as const;
export type PointerPhase = (typeof POINTER_PHASE)[keyof typeof POINTER_PHASE];

/** Where Actions reads the pointer queue (pointer.ts PointerDevice). */
export type PointerSource = ActivitySource & {
  /** Moves the oldest queued sample into `out` and returns true, or returns false when the queue is empty. */
  take(out: PointerSample): boolean;
};

/**
 * Where menu scenes read their input (Actions implements it; tests pass a fake). None of it reaches the sim.
 */
export type MenuInputSource = {
  /** The rising edges of the MENU_ACTIONS bits latched since the last call. Taking clears them. */
  takeMenuEdges(): number;
  /** The MENU_REPEAT_ACTIONS bits held right now on any device (hold-repeat, menuInput.ts). */
  readonly menuHeld: number;
  /** The kind of device the player used last (glyphs follow it). */
  readonly activeDevice: InputDeviceKind;
  /** Moves the oldest pointer sample not yet taken into `out`; false when there is none. */
  takePointer(out: PointerSample): boolean;
  /**
   * The rising edges of the SCENE_ACTIONS bits in `mask` latched since they were last taken (SSP-287: PAUSE, taken
   * per tick by ShiftScene and PauseOverlay). Taking clears them; other bits stay latched.
   */
  takeSceneEdges(mask: number): number;
};

/** A menu source that never reports anything (a Game whose input is not the keyboard and gamepad). */
export const NO_MENU_INPUT: MenuInputSource = Object.freeze({
  takeMenuEdges: () => 0,
  menuHeld: 0,
  activeDevice: DEFAULT_INPUT_DEVICE,
  takePointer: () => false,
  takeSceneEdges: () => 0,
});

/** See the quantisation rule at the top of this file. */
export const QUANTISE_EPS = 1e-6;

/**
 * One input device as Actions sees it. Analogue values are unquantised (Actions quantises them all in one
 * place). Devices must never throw: a lost device reads as neutral (§21.4).
 */
export type InputDevice = ActivitySource & {
  /** Once per rendered frame, before the frame's ticks (the gamepad polls here). */
  beginFrame(): void;
  /** Once per tick, before the values are read (the keyboard advances its steer ramp here). */
  beginTick(): void;
  /** Throttle, 0..1. */
  readonly throttle: number;
  /** Brake, 0..1. */
  readonly brake: number;
  /** Steering, −1..1; negative is left. */
  readonly steer: number;
  /** ACTION bits held right now. */
  readonly held: number;
  /** Returns the latched rising edges among the ACTION bits in `mask` and clears them. */
  takeEdges(mask: number): number;
};

/**
 * Quantises an analogue value to an integer in −max..max (see the rule at the top of this file). NaN and
 * ±Infinity of the wrong kind never escape: NaN gives 0, and magnitudes above 1 clamp to max.
 */
export function quantiseAxis(value: number, max: number): number {
  if (Number.isNaN(value) || value === 0) return 0;
  const magnitude = Math.round(Math.min(1, Math.abs(value)) * max + QUANTISE_EPS);
  if (magnitude === 0) return 0;
  return value < 0 ? -magnitude : magnitude;
}

/** Quantises a 0..1 value (trigger, digital pedal) to an integer in 0..max; negatives give 0. */
export function quantiseUnit(value: number, max: number): number {
  return value > 0 ? quantiseAxis(value, max) : 0;
}

/** Merges devices into one InputFrame per tick. One per Game. */
export class Actions implements MenuInputSource {
  private readonly devices: readonly InputDevice[];
  private readonly pointer: PointerSource | null;
  private readonly frame: InputFrame = createInputFrame();
  private sceneEdges = 0;
  /** SCENE_ACTIONS edges collected by beginFrame() and not yet taken by takeSceneEdges(). */
  private sceneLatched = 0;
  private active: InputDeviceKind = DEFAULT_INPUT_DEVICE;

  /** `pointer` is the canvas pointer queue for menus (pointer.ts), or null (no mouse menus). */
  constructor(devices: readonly InputDevice[], pointer: PointerSource | null = null) {
    this.devices = devices;
    this.pointer = pointer;
  }

  /**
   * The kind of device the player used last: it switches on the first input from a device of another kind (a key,
   * a click, a pad button or a stick leaving rest). 'keyboard' until any input.
   */
  get activeDevice(): InputDeviceKind {
    this.noteActivity();
    return this.active;
  }

  /** MENU_UP / MENU_DOWN bits held right now on any device (for menu hold-repeat). */
  get menuHeld(): number {
    const devices = this.devices;
    let held = 0;
    for (let i = 0; i < devices.length; i += 1) held |= devices[i]?.held ?? 0;
    return held & MENU_REPEAT_ACTIONS;
  }

  /** The oldest queued pointer sample (pointer.ts), moved into `out`; false when there is none. */
  takePointer(out: PointerSample): boolean {
    const pointer = this.pointer;
    if (pointer === null) return false;
    this.noteActivity();
    return pointer.take(out);
  }

  /**
   * Scene-layer action edges (ACTION.MAP | PAUSE | DEV_PANEL bits) that arrived before this frame. They hold
   * for the whole frame, whatever its tick count, and are replaced at the next beginFrame().
   */
  get sceneActions(): number {
    return this.sceneEdges;
  }

  /** Once per rendered frame, before its ticks: polls devices and collects the frame's scene-layer edges. */
  beginFrame(): void {
    const devices = this.devices;
    let edges = 0;
    for (let i = 0; i < devices.length; i += 1) {
      const device = devices[i];
      if (device === undefined) continue;
      device.beginFrame();
      edges |= device.takeEdges(SCENE_ACTIONS);
    }
    this.sceneEdges = edges;
    this.sceneLatched |= edges;
    this.noteActivity();
  }

  /**
   * The scene-layer edges (SCENE_ACTIONS bits in `mask`) latched since they were last taken: those beginFrame()
   * collected plus any a device latched since (a tick run outside a frame, `__ssp.step(n)`). Taking clears them.
   */
  takeSceneEdges(mask: number): number {
    const wanted = mask & SCENE_ACTIONS;
    const devices = this.devices;
    let edges = this.sceneLatched & wanted;
    for (let i = 0; i < devices.length; i += 1) edges |= devices[i]?.takeEdges(wanted) ?? 0;
    this.sceneLatched &= ~wanted;
    return edges;
  }

  /** Switches the active device to the kind of any source used since the last check (later sources win a tie). */
  private noteActivity(): void {
    const devices = this.devices;
    for (let i = 0; i < devices.length; i += 1) {
      const device = devices[i];
      if (device?.takeActivity() === true) this.active = device.kind;
    }
    const pointer = this.pointer;
    if (pointer?.takeActivity() === true) this.active = pointer.kind;
  }

  /**
   * The menu edges (MENU_ACTIONS bits) every device latched since the last call, OR-ed; taking clears them. A
   * menu scene calls it once per tick from fixedUpdate (and once on enter, to drop presses made before it showed).
   */
  takeMenuEdges(): number {
    const devices = this.devices;
    let edges = 0;
    for (let i = 0; i < devices.length; i += 1) edges |= devices[i]?.takeEdges(MENU_ACTIONS) ?? 0;
    return edges;
  }

  /**
   * The InputFrame for the next tick. Throttle and brake take the strongest device; steer takes the device
   * with the largest quantised deflection (ties go to the earlier device); held buttons and edges are OR-ed.
   * The returned object is reused by the next call.
   */
  sampleForTick(): Readonly<InputFrame> {
    const devices = this.devices;
    let throttle = 0;
    let brake = 0;
    let steer = 0;
    let held = 0;
    let edges = 0;
    for (let i = 0; i < devices.length; i += 1) {
      const device = devices[i];
      if (device === undefined) continue;
      device.beginTick();
      const t = quantiseUnit(device.throttle, THROTTLE_MAX);
      if (t > throttle) throttle = t;
      const b = quantiseUnit(device.brake, BRAKE_MAX);
      if (b > brake) brake = b;
      const s = quantiseAxis(device.steer, STEER_MAX);
      if (Math.abs(s) > Math.abs(steer)) steer = s;
      held |= device.held;
      edges |= device.takeEdges(SIM_EDGE_ACTIONS);
    }
    const frame = this.frame;
    frame.throttle = throttle;
    frame.brake = brake;
    frame.steer = steer;
    frame.buttons = (held & ACTION.SPRAY ? BUTTON.SPRAY : 0) | (held & ACTION.INTERACT ? BUTTON.INTERACT : 0);
    frame.pressed = (edges & ACTION.BRUSH ? PRESSED.BRUSH : 0) | (edges & ACTION.HORN ? PRESSED.HORN : 0);
    return frame;
  }
}
