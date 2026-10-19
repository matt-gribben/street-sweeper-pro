// Keyboard device (TECHNICAL_DESIGN §13.2, SSP-044). Bindings use KeyboardEvent.code, so they follow key
// positions, not layouts (W/A/S/D sit in the same place on AZERTY), and an M7 remap will store codes.
//
// - Throttle and brake are digital: full (1) while any bound key is down.
// - Steering ramps: the steer value moves towards its target (−1, 0 or 1) by tickS / STEER_RAMP_S per tick,
//   so full lock takes 80 ms (5 ticks at 60 Hz: 26, 53, 79, 106, 127) and a tap never snaps the wheel. The
//   ramp runs per sim tick, not per frame, so it is the same on every display. Release and reversal ramp at
//   the same rate. A and D together cancel to 0.
// - Rising edges latch until Actions takes them (a tap between two ticks still counts once). Key repeat never
//   makes a new edge, and two keys bound to one action (W and ↑) make one edge between them.
// - preventDefault is called for bound keys only, so browser shortcuts on other keys keep working. A keydown
//   with Ctrl, Cmd or Alt held is left to the browser entirely (Ctrl+W, Cmd+R); key-ups always count, so a key
//   never sticks.
// - Losing focus (window blur) releases every key: the browser sends no key-ups to a window it has left.

import { ACTION, type InputDevice } from './actions.ts';

/** Time for digital steering to go from centre to full lock, in seconds. */
export const STEER_RAMP_S = 0.08;

/** Driving controls a key can be bound to, as bits above the ACTION bits. */
export const DRIVE = {
  THROTTLE: 1 << 16,
  BRAKE: 1 << 17,
  STEER_LEFT: 1 << 18,
  STEER_RIGHT: 1 << 19,
} as const;

/**
 * Default bindings (TECHNICAL_DESIGN §13.1, GDD §6.1): KeyboardEvent.code → one DRIVE or ACTION bit. Remapping
 * is M7 (SSP-236).
 */
export const KEY_BINDINGS: ReadonlyMap<string, number> = new Map<string, number>([
  ['KeyW', DRIVE.THROTTLE],
  ['ArrowUp', DRIVE.THROTTLE],
  ['KeyS', DRIVE.BRAKE],
  ['ArrowDown', DRIVE.BRAKE],
  ['KeyA', DRIVE.STEER_LEFT],
  ['ArrowLeft', DRIVE.STEER_LEFT],
  ['KeyD', DRIVE.STEER_RIGHT],
  ['ArrowRight', DRIVE.STEER_RIGHT],
  ['Space', ACTION.BRUSH],
  ['ShiftLeft', ACTION.SPRAY],
  ['KeyH', ACTION.HORN],
  ['KeyE', ACTION.INTERACT],
  ['Tab', ACTION.MAP],
  ['Escape', ACTION.PAUSE],
  ['KeyP', ACTION.PAUSE],
  ['F1', ACTION.DEV_PANEL],
]);

/** The parts of a KeyboardEvent the device reads (unit tests pass plain objects). */
export type KeyEventLike = {
  readonly code: string;
  readonly repeat: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  preventDefault(): void;
};

/** Where the keyboard listens: the window in the browser. */
export type KeyEventTarget = {
  addEventListener(type: 'keydown' | 'keyup', listener: (event: KeyboardEvent) => void): void;
  addEventListener(type: 'blur', listener: () => void): void;
  removeEventListener(type: 'keydown' | 'keyup', listener: (event: KeyboardEvent) => void): void;
  removeEventListener(type: 'blur', listener: () => void): void;
};

const ALL_ACTIONS =
  ACTION.BRUSH | ACTION.SPRAY | ACTION.HORN | ACTION.INTERACT | ACTION.MAP | ACTION.PAUSE | ACTION.DEV_PANEL;

/** The keyboard as an InputDevice. */
export class KeyboardDevice implements InputDevice {
  private readonly rampPerTick: number;
  /** Codes of bound keys currently down. */
  private readonly down = new Set<string>();
  /** DRIVE | ACTION bits of the keys in `down`. */
  private mask = 0;
  private edges = 0;
  private steerValue = 0;

  /** `tickS` is the sim tick length (DT_S): the steer ramp advances once per tick. */
  constructor(tickS: number) {
    if (!(tickS > 0)) throw new RangeError(`KeyboardDevice: tickS must be positive, got ${tickS}`);
    this.rampPerTick = tickS / STEER_RAMP_S;
  }

  get throttle(): number {
    return this.mask & DRIVE.THROTTLE ? 1 : 0;
  }

  get brake(): number {
    return this.mask & DRIVE.BRAKE ? 1 : 0;
  }

  get steer(): number {
    return this.steerValue;
  }

  get held(): number {
    return this.mask & ALL_ACTIONS;
  }

  /** Listens on `target` (the window); returns a function that stops listening. */
  attach(target: KeyEventTarget): () => void {
    const onDown = (event: KeyboardEvent): void => this.handleKeyDown(event);
    const onUp = (event: KeyboardEvent): void => this.handleKeyUp(event);
    const onBlur = (): void => this.releaseAll();
    target.addEventListener('keydown', onDown);
    target.addEventListener('keyup', onUp);
    target.addEventListener('blur', onBlur);
    return () => {
      target.removeEventListener('keydown', onDown);
      target.removeEventListener('keyup', onUp);
      target.removeEventListener('blur', onBlur);
    };
  }

  handleKeyDown(event: KeyEventLike): void {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const bit = KEY_BINDINGS.get(event.code);
    if (bit === undefined) return;
    event.preventDefault();
    if (this.down.has(event.code)) return; // key repeat, or a keydown we already saw
    this.down.add(event.code);
    const before = this.mask;
    this.mask = before | bit;
    this.edges |= this.mask & ~before & ALL_ACTIONS;
  }

  handleKeyUp(event: KeyEventLike): void {
    if (!KEY_BINDINGS.has(event.code)) return;
    event.preventDefault();
    if (!this.down.delete(event.code)) return;
    this.recomputeMask();
  }

  /** Releases every key (focus lost). Latched edges are kept: those presses happened. */
  releaseAll(): void {
    this.down.clear();
    this.mask = 0;
  }

  beginFrame(): void {}

  /** Advances the steer ramp one tick towards the held direction. */
  beginTick(): void {
    const left = this.mask & DRIVE.STEER_LEFT ? 1 : 0;
    const right = this.mask & DRIVE.STEER_RIGHT ? 1 : 0;
    const target = right - left;
    const delta = target - this.steerValue;
    const step = this.rampPerTick;
    if (delta > step) this.steerValue += step;
    else if (delta < -step) this.steerValue -= step;
    else this.steerValue = target;
  }

  takeEdges(mask: number): number {
    const taken = this.edges & mask;
    this.edges &= ~mask;
    return taken;
  }

  private recomputeMask(): void {
    let mask = 0;
    for (const code of this.down) mask |= KEY_BINDINGS.get(code) ?? 0;
    this.mask = mask;
  }
}
