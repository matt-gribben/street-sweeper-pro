// Keyboard device (SSP-044, TECHNICAL_DESIGN §13.2): code-based bindings, the 80 ms digital steer ramp,
// selective preventDefault, edge latching and stuck-key protection. Driven through Actions so the numbers are
// the quantised ones the sim sees.
import { describe, expect, it } from 'vitest';
import { Actions } from '../../src/input/actions.ts';
import { KEY_BINDINGS, KeyboardDevice, type KeyEventTarget, STEER_RAMP_S } from '../../src/input/keyboard.ts';
import { DT_S } from '../../src/sim/constants.ts';
import { BUTTON, PRESSED, STEER_MAX, THROTTLE_MAX } from '../../src/sim/inputFrame.ts';
import { keyEvent } from '../support/fakeInput.ts';

function rig(): { keyboard: KeyboardDevice; actions: Actions } {
  const keyboard = new KeyboardDevice(DT_S);
  return { keyboard, actions: new Actions([keyboard]) };
}

function down(keyboard: KeyboardDevice, code: string): void {
  keyboard.handleKeyDown(keyEvent(code));
}

function up(keyboard: KeyboardDevice, code: string): void {
  keyboard.handleKeyUp(keyEvent(code));
}

/** Steer values of the next `n` ticks. */
function steerTicks(actions: Actions, n: number): number[] {
  const values: number[] = [];
  for (let i = 0; i < n; i += 1) values.push(actions.sampleForTick().steer);
  return values;
}

describe('bindings', () => {
  it('binds exactly the §13.1 keyboard column, by KeyboardEvent.code', () => {
    expect([...KEY_BINDINGS.keys()].sort()).toEqual(
      [
        'KeyW',
        'ArrowUp',
        'KeyS',
        'ArrowDown',
        'KeyA',
        'ArrowLeft',
        'KeyD',
        'ArrowRight',
        'Space',
        'ShiftLeft',
        'KeyH',
        'KeyE',
        'Tab',
        'Escape',
        'KeyP',
        'F1',
      ].sort(),
    );
  });

  it('W and ↑ give full throttle, S and ↓ full brake, as integers', () => {
    for (const code of ['KeyW', 'ArrowUp']) {
      const { keyboard, actions } = rig();
      down(keyboard, code);
      const frame = actions.sampleForTick();
      expect(frame.throttle).toBe(THROTTLE_MAX);
      expect(frame.brake).toBe(0);
    }
    for (const code of ['KeyS', 'ArrowDown']) {
      const { keyboard, actions } = rig();
      down(keyboard, code);
      const frame = actions.sampleForTick();
      expect(frame.brake).toBe(255);
      expect(frame.throttle).toBe(0);
    }
  });

  it('Left Shift holds SPRAY and E holds INTERACT; Right Shift is not bound', () => {
    const { keyboard, actions } = rig();
    down(keyboard, 'ShiftRight');
    expect(actions.sampleForTick().buttons).toBe(0);
    down(keyboard, 'ShiftLeft');
    down(keyboard, 'KeyE');
    expect(actions.sampleForTick().buttons).toBe(BUTTON.SPRAY | BUTTON.INTERACT);
    expect(actions.sampleForTick().buttons).toBe(BUTTON.SPRAY | BUTTON.INTERACT);
    up(keyboard, 'ShiftLeft');
    expect(actions.sampleForTick().buttons).toBe(BUTTON.INTERACT);
  });

  it('two keys on one action: releasing one keeps the action held, and they make one edge', () => {
    const { keyboard, actions } = rig();
    down(keyboard, 'KeyW');
    down(keyboard, 'ArrowUp');
    up(keyboard, 'KeyW');
    expect(actions.sampleForTick().throttle).toBe(THROTTLE_MAX);
    up(keyboard, 'ArrowUp');
    expect(actions.sampleForTick().throttle).toBe(0);
  });
});

describe('steering ramp', () => {
  it('holding D moves steer from 0 to 127 over 80 ms (± one tick), never jumping straight to 127', () => {
    const { keyboard, actions } = rig();
    expect(actions.sampleForTick().steer).toBe(0);
    down(keyboard, 'KeyD');
    const values = steerTicks(actions, 8);
    expect(values).toEqual([26, 53, 79, 106, 127, 127, 127, 127]);
    const firstFull = values.indexOf(STEER_MAX) + 1; // ticks held when it first reads 127
    const rampTicks = STEER_RAMP_S / DT_S; // 4.8
    expect(Math.abs(firstFull - rampTicks)).toBeLessThanOrEqual(1);
    expect(firstFull * DT_S * 1000).toBeGreaterThanOrEqual(80 - 1000 / 60);
    expect(firstFull * DT_S * 1000).toBeLessThanOrEqual(80 + 1000 / 60);
    // Monotonic, and no step bigger than the ramp rate allows.
    for (let i = 1; i < values.length; i += 1) {
      expect((values[i] ?? 0) - (values[i - 1] ?? 0)).toBeGreaterThanOrEqual(0);
      expect((values[i] ?? 0) - (values[i - 1] ?? 0)).toBeLessThanOrEqual(27);
    }
  });

  it('A and ← steer left with the mirror-image ramp', () => {
    for (const code of ['KeyA', 'ArrowLeft']) {
      const { keyboard, actions } = rig();
      down(keyboard, code);
      expect(steerTicks(actions, 6)).toEqual([-26, -53, -79, -106, -127, -127]);
    }
  });

  it('→ steers right like D', () => {
    const { keyboard, actions } = rig();
    down(keyboard, 'ArrowRight');
    expect(steerTicks(actions, 5)).toEqual([26, 53, 79, 106, 127]);
  });

  it('ramps back to centre on release, at the same rate', () => {
    const { keyboard, actions } = rig();
    down(keyboard, 'KeyD');
    steerTicks(actions, 6);
    up(keyboard, 'KeyD');
    expect(steerTicks(actions, 6)).toEqual([101, 74, 48, 21, 0, 0]);
  });

  it('A and D together cancel to centre', () => {
    const { keyboard, actions } = rig();
    down(keyboard, 'KeyA');
    down(keyboard, 'KeyD');
    expect(steerTicks(actions, 3)).toEqual([0, 0, 0]);
  });

  it('advances per tick, not per event or frame: no ticks, no movement', () => {
    const { keyboard, actions } = rig();
    down(keyboard, 'KeyD');
    actions.beginFrame();
    actions.beginFrame();
    expect(actions.sampleForTick().steer).toBe(26);
  });

  it('rejects a non-positive tick length', () => {
    expect(() => new KeyboardDevice(0)).toThrow(RangeError);
  });
});

describe('preventDefault', () => {
  it('is called for every bound key, on keydown and keyup', () => {
    const keyboard = new KeyboardDevice(DT_S);
    for (const code of KEY_BINDINGS.keys()) {
      const downEvent = keyEvent(code);
      const upEvent = keyEvent(code);
      keyboard.handleKeyDown(downEvent);
      keyboard.handleKeyUp(upEvent);
      expect(downEvent.prevented, `${code} keydown`).toBe(1);
      expect(upEvent.prevented, `${code} keyup`).toBe(1);
    }
  });

  it.each(['KeyQ', 'Enter', 'ShiftRight', 'F5', 'Digit1', 'Backspace'])(
    'is never called for the unbound key %s',
    (code) => {
      const keyboard = new KeyboardDevice(DT_S);
      const downEvent = keyEvent(code);
      const upEvent = keyEvent(code);
      keyboard.handleKeyDown(downEvent);
      keyboard.handleKeyUp(upEvent);
      expect(downEvent.prevented).toBe(0);
      expect(upEvent.prevented).toBe(0);
    },
  );

  it('leaves Ctrl/Cmd/Alt chords to the browser, even on bound keys', () => {
    const { keyboard, actions } = rig();
    for (const modifier of ['ctrlKey', 'metaKey', 'altKey'] as const) {
      const event = keyEvent('KeyW', { [modifier]: true });
      keyboard.handleKeyDown(event);
      expect(event.prevented).toBe(0);
    }
    expect(actions.sampleForTick().throttle).toBe(0);
  });
});

describe('edges', () => {
  it('Space pressed and released between two ticks gives BRUSH on exactly one tick', () => {
    const { keyboard, actions } = rig();
    expect(actions.sampleForTick().pressed).toBe(0);
    down(keyboard, 'Space');
    up(keyboard, 'Space');
    const pressed = [0, 1, 2, 3].map(() => actions.sampleForTick().pressed);
    expect(pressed).toEqual([PRESSED.BRUSH, 0, 0, 0]);
  });

  it('holding Space gives one edge; key repeat never makes another', () => {
    const { keyboard, actions } = rig();
    down(keyboard, 'Space');
    const first = actions.sampleForTick().pressed;
    keyboard.handleKeyDown(keyEvent('Space', { repeat: true }));
    keyboard.handleKeyDown(keyEvent('Space', { repeat: true }));
    expect(first).toBe(PRESSED.BRUSH);
    expect(actions.sampleForTick().pressed).toBe(0);
    up(keyboard, 'Space');
    down(keyboard, 'Space');
    expect(actions.sampleForTick().pressed).toBe(PRESSED.BRUSH);
  });

  it('H gives a HORN edge', () => {
    const { keyboard, actions } = rig();
    down(keyboard, 'KeyH');
    expect(actions.sampleForTick().pressed).toBe(PRESSED.HORN);
  });
});

describe('focus and listeners', () => {
  it('blur releases every held key but keeps edges already latched', () => {
    const { keyboard, actions } = rig();
    down(keyboard, 'KeyW');
    down(keyboard, 'Space');
    keyboard.releaseAll();
    const frame = actions.sampleForTick();
    expect(frame.throttle).toBe(0);
    expect(frame.pressed).toBe(PRESSED.BRUSH);
    // The key-up the browser never sent arrives late: harmless.
    up(keyboard, 'KeyW');
    expect(actions.sampleForTick().throttle).toBe(0);
  });

  it('attach() listens for keydown, keyup and blur; the returned function stops listening', () => {
    const listeners = new Map<string, (event: KeyboardEvent) => void>();
    const target = {
      addEventListener: (type: string, listener: (event: KeyboardEvent) => void) => {
        listeners.set(type, listener);
      },
      removeEventListener: (type: string, listener: unknown) => {
        if (listeners.get(type) === listener) listeners.delete(type);
      },
    } as KeyEventTarget;
    const { keyboard, actions } = rig();
    const detach = keyboard.attach(target);
    expect([...listeners.keys()].sort()).toEqual(['blur', 'keydown', 'keyup']);
    listeners.get('keydown')?.(keyEvent('KeyW') as unknown as KeyboardEvent);
    expect(actions.sampleForTick().throttle).toBe(THROTTLE_MAX);
    listeners.get('blur')?.(keyEvent('') as unknown as KeyboardEvent);
    expect(actions.sampleForTick().throttle).toBe(0);
    detach();
    expect(listeners.size).toBe(0);
  });
});
