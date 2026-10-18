// The InputFrame: everything the sim reads from the player in one tick (TECHNICAL_DESIGN §13.1). It lives
// in src/sim because src/input may import only this type from the sim (§2.1). Devices quantise analogue
// values to integers at the boundary, so a replay records exactly what the sim saw.

/** One tick of player input. All fields are integers. */
export type InputFrame = {
  /** Throttle, 0..THROTTLE_MAX (quantised analogue). */
  throttle: number;
  /** Brake, 0..BRAKE_MAX; reverse when held at standstill. */
  brake: number;
  /** Steering, −STEER_MAX..STEER_MAX; negative is left. */
  steer: number;
  /** Bitfield of held actions (BUTTON). */
  buttons: number;
  /** Bitfield of rising edges since the last tick (PRESSED). An edge reaches only the first tick of a frame. */
  pressed: number;
};

/** Full throttle. */
export const THROTTLE_MAX = 255;

/** Full brake. */
export const BRAKE_MAX = 255;

/** Full steering lock either way. */
export const STEER_MAX = 127;

/** Bits of `InputFrame.buttons`: actions that count while held. */
export const BUTTON = {
  SPRAY: 1 << 0,
  INTERACT: 1 << 1,
} as const;
export type Button = (typeof BUTTON)[keyof typeof BUTTON];

/**
 * Bits of `InputFrame.pressed`: rising edges. MAP and PAUSE are consumed by the scene layer and never
 * reach a running sim (pausing is not part of a replay, §13.1).
 */
export const PRESSED = {
  BRUSH: 1 << 0,
  HORN: 1 << 1,
  MAP: 1 << 2,
  PAUSE: 1 << 3,
} as const;
export type Pressed = (typeof PRESSED)[keyof typeof PRESSED];

/** A new neutral frame: no throttle, brake or steer, nothing held or pressed. */
export function createInputFrame(): InputFrame {
  return { throttle: 0, brake: 0, steer: 0, buttons: 0, pressed: 0 };
}
