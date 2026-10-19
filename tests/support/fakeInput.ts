// Fake KeyboardEvents and Gamepads for the input tests (SSP-044). Plain objects shaped like the DOM types the
// devices read (KeyEventLike, PadLike), so the tests run on Node without a DOM.
import type { PadButtonLike, PadLike, PadSource, RumbleActuatorLike } from '../../src/input/gamepad.ts';
import type { KeyEventLike } from '../../src/input/keyboard.ts';

/** A fake KeyboardEvent that records preventDefault calls. */
export type FakeKeyEvent = KeyEventLike & { prevented: number };

export function keyEvent(
  code: string,
  options: { repeat?: boolean; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean } = {},
): FakeKeyEvent {
  const event: FakeKeyEvent = {
    code,
    repeat: options.repeat ?? false,
    ctrlKey: options.ctrlKey ?? false,
    metaKey: options.metaKey ?? false,
    altKey: options.altKey ?? false,
    prevented: 0,
    preventDefault(): void {
      event.prevented += 1;
    },
  };
  return event;
}

/** A mutable fake standard gamepad: 17 buttons, 4 axes, all at rest. */
export type FakePad = {
  index: number;
  connected: boolean;
  mapping: string;
  buttons: { pressed: boolean; value: number }[];
  axes: number[];
  vibrationActuator?: RumbleActuatorLike | null;
};

export function fakePad(index = 0, mapping = 'standard'): FakePad {
  return {
    index,
    connected: true,
    mapping,
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
    axes: [0, 0, 0, 0],
  };
}

/** Presses (or releases) a digital button. */
export function setButton(pad: FakePad, index: number, pressed: boolean): void {
  const button = pad.buttons[index];
  if (button === undefined) throw new Error(`fake pad has no button ${index}`);
  button.pressed = pressed;
  button.value = pressed ? 1 : 0;
}

/** Sets a trigger's analogue value (pressed above 0, as browsers report it). */
export function setTrigger(pad: FakePad, index: number, value: number): void {
  const button = pad.buttons[index];
  if (button === undefined) throw new Error(`fake pad has no button ${index}`);
  button.value = value;
  button.pressed = value > 0;
}

/** A pad source whose slots the test edits: `slots` is what getGamepads() returns. */
export function padSource(...pads: (PadLike | null)[]): { slots: (PadLike | null)[]; source: PadSource } {
  const holder: { slots: (PadLike | null)[]; source: PadSource } = {
    slots: pads,
    source: () => holder.slots,
  };
  return holder;
}

/** A pad whose button and axis getters throw: one that disconnected while it was being read. */
export function vanishingPad(index = 0): PadLike {
  return {
    index,
    connected: true,
    mapping: 'standard',
    get buttons(): ArrayLike<PadButtonLike> {
      throw new Error('gamepad disconnected');
    },
    get axes(): ArrayLike<number> {
      throw new Error('gamepad disconnected');
    },
  };
}
