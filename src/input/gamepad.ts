// Gamepad device (TECHNICAL_DESIGN §13.2, SSP-044). Polled once per rendered frame (Actions.beginFrame) via
// navigator.getGamepads(); the first connected pad with `mapping === 'standard'` wins.
//
// Standard mapping (W3C Gamepad, "standard" layout): buttons[0] A/south → BRUSH, [1] B/east → HORN,
// [2] X/west → SPRAY, [3] Y/north → INTERACT, [6] LT → brake (value 0..1), [7] RT → throttle (value 0..1),
// [8] View/Back → MAP, [9] Start/Menu → PAUSE; axes[0] left stick X → steer, through a 0.15 deadzone rescaled
// to full range outside it: s = sign(x) · max(0, |x| − 0.15) / 0.85. Actions quantises (0.575 → 0.5 → 64).
//
// Edges: a button newly pressed since the previous poll latches until Actions takes it. A press and release
// that both fall between two polls is invisible to a polled API; at 60 fps that is a press shorter than 17 ms.
// The first poll of a newly (re)connected pad only sets the baseline, so a button held through a reconnect
// never fires a phantom edge.
//
// Robustness (§21.4: recover from player-environment problems, never throw): getGamepads() can throw (a
// permissions policy), return nulls, or hand back a pad that disconnected mid-read with short button and axis
// arrays. Any of these reads as a neutral pad; latched edges from earlier polls are kept.
//
// Rumble (AUDIO_DESIGN §12.5): rumbleImpact(speedMps) plays `dual-rumble` on the active pad where the browser
// supports it. src/input may not import the event bus, so src/app/Game.ts subscribes it to EV.Impact. The
// Rumble setting and the Reduce loud sounds gate arrive with settings in M7 (SSP-241); until then
// `rumbleEnabled` is the switch.

import { ACTION, type InputDevice } from './actions.ts';

/** Left stick X deadzone (GDD §6.1). */
export const STICK_DEADZONE = 0.15;

/** Standard-mapping button indices. */
export const PAD_BUTTON = {
  SOUTH: 0,
  EAST: 1,
  WEST: 2,
  NORTH: 3,
  LEFT_TRIGGER: 6,
  RIGHT_TRIGGER: 7,
  BACK: 8,
  START: 9,
} as const;

/** Digital button → ACTION bit (TECHNICAL_DESIGN §13.1). */
const BUTTON_ACTIONS: readonly (readonly [index: number, action: number])[] = [
  [PAD_BUTTON.SOUTH, ACTION.BRUSH],
  [PAD_BUTTON.EAST, ACTION.HORN],
  [PAD_BUTTON.WEST, ACTION.SPRAY],
  [PAD_BUTTON.NORTH, ACTION.INTERACT],
  [PAD_BUTTON.BACK, ACTION.MAP],
  [PAD_BUTTON.START, ACTION.PAUSE],
];

/** Impact rumble thresholds and cues (AUDIO_DESIGN §12.5, split as sfx.bump_wall / sfx.crash in §5). */
export const IMPACT_RUMBLE = {
  /** Below this normal impact speed nothing plays (sfx.bump_wall starts at 0.5 m/s). */
  minSpeedMps: 0.5,
  /** Above this it is a crash (sfx.crash: normal impact speed above 3 m/s). */
  crashSpeedMps: 3,
  bumpStrongMin: 0.3,
  bumpStrongMax: 0.6,
  bumpWeak: 0.2,
  bumpDurationMs: 90,
  crashStrong: 0.9,
  crashWeak: 0.6,
  crashDurationMs: 220,
} as const;

/** One dual-rumble effect, in the Gamepad Haptics parameter shape. */
export type RumbleEffect = {
  readonly startDelay: number;
  readonly duration: number;
  readonly strongMagnitude: number;
  readonly weakMagnitude: number;
};

/** The parts of GamepadButton the device reads. */
export type PadButtonLike = { readonly pressed: boolean; readonly value: number };

/** The parts of GamepadHapticActuator the device uses. */
export type RumbleActuatorLike = {
  playEffect(type: 'dual-rumble', params: RumbleEffect): unknown;
};

/** The parts of Gamepad the device reads (unit tests pass plain objects). */
export type PadLike = {
  readonly index: number;
  readonly connected: boolean;
  readonly mapping: string;
  readonly buttons: ArrayLike<PadButtonLike | undefined>;
  readonly axes: ArrayLike<number>;
  readonly vibrationActuator?: RumbleActuatorLike | null;
};

/** navigator.getGamepads(), or a fake. May throw or return nulls; the device copes. */
export type PadSource = () => ArrayLike<PadLike | null> | null | undefined;

/** The browser's pad source; empty where the Gamepad API is missing. */
export function browserPadSource(nav: Navigator): PadSource {
  if (typeof nav.getGamepads !== 'function') return () => null;
  return () => nav.getGamepads();
}

/** Left stick deadzone rescale: 0 inside ±deadzone, then linear to ±1 at full deflection. NaN gives 0. */
export function applyDeadzone(x: number, deadzone: number = STICK_DEADZONE): number {
  if (Number.isNaN(x)) return 0;
  const magnitude = Math.min(1, Math.max(0, Math.abs(x) - deadzone) / (1 - deadzone));
  if (magnitude === 0) return 0;
  return x < 0 ? -magnitude : magnitude;
}

/** The rumble for an EV.Impact of normal speed `speedMps`, or null below the bump threshold. */
export function impactRumble(speedMps: number): RumbleEffect | null {
  const r = IMPACT_RUMBLE;
  if (!(speedMps >= r.minSpeedMps)) return null;
  if (speedMps > r.crashSpeedMps) {
    return {
      startDelay: 0,
      duration: r.crashDurationMs,
      strongMagnitude: r.crashStrong,
      weakMagnitude: r.crashWeak,
    };
  }
  const t = (speedMps - r.minSpeedMps) / (r.crashSpeedMps - r.minSpeedMps);
  return {
    startDelay: 0,
    duration: r.bumpDurationMs,
    strongMagnitude: r.bumpStrongMin + (r.bumpStrongMax - r.bumpStrongMin) * t,
    weakMagnitude: r.bumpWeak,
  };
}

/** The pad that wins: the first connected one with the standard mapping, or null. Never throws. */
export function pickPad(source: PadSource): PadLike | null {
  try {
    const pads = source();
    if (pads === null || pads === undefined) return null;
    for (let i = 0; i < pads.length; i += 1) {
      const pad = pads[i];
      if (pad?.connected && pad.mapping === 'standard') return pad;
    }
  } catch {
    // A permissions policy can make getGamepads() throw: no pad.
  }
  return null;
}

function buttonValue(pad: PadLike, index: number): number {
  const value = pad.buttons[index]?.value ?? 0;
  if (!(value > 0)) return 0;
  return value > 1 ? 1 : value;
}

/** The standard gamepad as an InputDevice. */
export class GamepadDevice implements InputDevice {
  /** False turns rumble off (the M7 Rumble setting will drive it). */
  rumbleEnabled = true;
  private readonly source: PadSource;
  private throttleValue = 0;
  private brakeValue = 0;
  private steerValue = 0;
  private mask = 0;
  private edges = 0;
  /** Index of the pad read last poll, or −1 when none was. */
  private padIndex = -1;

  constructor(source: PadSource) {
    this.source = source;
  }

  get throttle(): number {
    return this.throttleValue;
  }

  get brake(): number {
    return this.brakeValue;
  }

  get steer(): number {
    return this.steerValue;
  }

  get held(): number {
    return this.mask;
  }

  /** True when last poll found a standard pad. */
  get connected(): boolean {
    return this.padIndex >= 0;
  }

  /** Polls the pad (once per rendered frame). */
  beginFrame(): void {
    const pad = pickPad(this.source);
    if (pad === null) {
      this.neutral();
      return;
    }
    try {
      this.read(pad);
    } catch {
      // The pad went away mid-read (a getter threw): neutral until it is back.
      this.neutral();
    }
  }

  beginTick(): void {}

  takeEdges(mask: number): number {
    const taken = this.edges & mask;
    this.edges &= ~mask;
    return taken;
  }

  /** Plays the impact rumble on the active pad where supported. Never throws, never waits. */
  rumbleImpact(speedMps: number): void {
    if (!this.rumbleEnabled) return;
    const effect = impactRumble(speedMps);
    if (effect === null) return;
    const pad = pickPad(this.source);
    if (pad === null) return;
    try {
      const actuator = pad.vibrationActuator;
      if (actuator === null || actuator === undefined || typeof actuator.playEffect !== 'function') return;
      const result = actuator.playEffect('dual-rumble', effect);
      // The promise rejects when the pad cannot rumble or disconnects; that is not an error for the game.
      if (result instanceof Promise) result.catch(() => {});
    } catch {
      // Rumble is a nicety: a pad that refuses it is ignored.
    }
  }

  private read(pad: PadLike): void {
    const throttle = buttonValue(pad, PAD_BUTTON.RIGHT_TRIGGER);
    const brake = buttonValue(pad, PAD_BUTTON.LEFT_TRIGGER);
    const steer = applyDeadzone(pad.axes[0] ?? 0);
    let mask = 0;
    for (let i = 0; i < BUTTON_ACTIONS.length; i += 1) {
      const entry = BUTTON_ACTIONS[i];
      if (entry !== undefined && pad.buttons[entry[0]]?.pressed === true) mask |= entry[1];
    }
    const fresh = pad.index !== this.padIndex;
    // Commit only after every read succeeded, so a throw mid-read leaves no half-updated state.
    this.throttleValue = throttle;
    this.brakeValue = brake;
    this.steerValue = steer;
    if (!fresh) this.edges |= mask & ~this.mask;
    this.mask = mask;
    this.padIndex = pad.index;
  }

  private neutral(): void {
    this.throttleValue = 0;
    this.brakeValue = 0;
    this.steerValue = 0;
    this.mask = 0;
    this.padIndex = -1;
  }
}
