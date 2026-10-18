// InputFrame shape and bit constants (TECHNICAL_DESIGN §13.1).
import { describe, expect, it } from 'vitest';
import {
  BRAKE_MAX,
  BUTTON,
  createInputFrame,
  type InputFrame,
  PRESSED,
  STEER_MAX,
  THROTTLE_MAX,
} from '../../src/sim/inputFrame.ts';

function bitsOf(flags: Record<string, number>): number[] {
  return Object.values(flags);
}

describe('InputFrame', () => {
  it('creates a neutral frame with exactly the five integer fields of §13.1', () => {
    const frame: InputFrame = createInputFrame();
    expect(frame).toEqual({ throttle: 0, brake: 0, steer: 0, buttons: 0, pressed: 0 });
    expect(Object.keys(frame).sort()).toEqual(['brake', 'buttons', 'pressed', 'steer', 'throttle']);
    expect(createInputFrame()).not.toBe(frame);
  });

  it('quantises analogue input to 0..255 throttle and brake and −127..127 steer', () => {
    expect(THROTTLE_MAX).toBe(255);
    expect(BRAKE_MAX).toBe(255);
    expect(STEER_MAX).toBe(127);
  });

  it('defines the held buttons SPRAY and INTERACT', () => {
    expect(Object.keys(BUTTON)).toEqual(['SPRAY', 'INTERACT']);
  });

  it('defines the rising edges BRUSH, HORN, MAP and PAUSE', () => {
    expect(Object.keys(PRESSED)).toEqual(['BRUSH', 'HORN', 'MAP', 'PAUSE']);
  });

  it.each([
    ['BUTTON', BUTTON],
    ['PRESSED', PRESSED],
  ] as const)('gives every %s flag its own single bit', (_name, flags) => {
    const bits = bitsOf(flags);
    let union = 0;
    for (const bit of bits) {
      expect(Number.isInteger(bit) && bit > 0 && (bit & (bit - 1)) === 0).toBe(true);
      expect(union & bit).toBe(0);
      union |= bit;
    }
  });

  it('combines and tests flags as a bitfield', () => {
    const frame = createInputFrame();
    frame.buttons = BUTTON.SPRAY | BUTTON.INTERACT;
    frame.pressed = PRESSED.HORN;
    expect(frame.buttons & BUTTON.SPRAY).not.toBe(0);
    expect(frame.buttons & BUTTON.INTERACT).not.toBe(0);
    expect(frame.pressed & PRESSED.HORN).not.toBe(0);
    expect(frame.pressed & PRESSED.BRUSH).toBe(0);
  });
});
