// SSP-071: the menu input mapping. The intro card and the tally read GDD §6.1's menu navigation from the keyboard
// and the standard gamepad through Actions.takeMenuEdges() (src/input/actions.ts), one tick at a time; menu
// actions never reach the sim InputFrame (TECHNICAL_DESIGN §13.1).
import { describe, expect, it } from 'vitest';
import { ACTION, Actions, MENU_ACTIONS, NO_MENU_INPUT } from '../../src/input/actions.ts';
import { GamepadDevice, PAD_BUTTON } from '../../src/input/gamepad.ts';
import { KeyboardDevice } from '../../src/input/keyboard.ts';
import { DT_S } from '../../src/sim/constants.ts';
import { createInputFrame, PRESSED } from '../../src/sim/inputFrame.ts';
import { fakePad, keyEvent, padSource, setButton } from '../support/fakeInput.ts';

function rig() {
  const keyboard = new KeyboardDevice(DT_S);
  const pad = fakePad();
  const pads = padSource(pad);
  const actions = new Actions([keyboard, new GamepadDevice(pads.source)]);
  actions.beginFrame(); // the pad's first poll sets its edge baseline
  return { keyboard, pad, actions };
}

function tap(keyboard: KeyboardDevice, code: string): void {
  keyboard.handleKeyDown(keyEvent(code));
  keyboard.handleKeyUp(keyEvent(code));
}

describe('menu input: keyboard', () => {
  it.each([
    ['Space', ACTION.MENU_SELECT],
    ['Enter', ACTION.MENU_SELECT],
    ['NumpadEnter', ACTION.MENU_SELECT],
    ['KeyW', ACTION.MENU_UP],
    ['ArrowUp', ACTION.MENU_UP],
    ['KeyS', ACTION.MENU_DOWN],
    ['ArrowDown', ACTION.MENU_DOWN],
    ['Escape', ACTION.MENU_BACK],
    ['Backspace', ACTION.MENU_BACK],
  ])('%s gives one %i menu edge', (code, action) => {
    const { keyboard, actions } = rig();
    tap(keyboard, code);
    expect(actions.takeMenuEdges()).toBe(action);
    expect(actions.takeMenuEdges()).toBe(0);
  });

  it.each(['KeyA', 'KeyD', 'ArrowLeft', 'ArrowRight', 'KeyE', 'KeyH', 'ShiftLeft', 'Tab', 'KeyP', 'F1'])(
    '%s gives no menu edge',
    (code) => {
      const { keyboard, actions } = rig();
      tap(keyboard, code);
      expect(actions.takeMenuEdges()).toBe(0);
    },
  );

  it('keeps a press latched across frames that ran no tick, and key repeat adds no edge', () => {
    const { keyboard, actions } = rig();
    keyboard.handleKeyDown(keyEvent('Enter'));
    actions.beginFrame();
    actions.beginFrame();
    keyboard.handleKeyDown(keyEvent('Enter', { repeat: true }));
    expect(actions.takeMenuEdges()).toBe(ACTION.MENU_SELECT);
    keyboard.handleKeyDown(keyEvent('Enter', { repeat: true }));
    expect(actions.takeMenuEdges()).toBe(0);
  });
});

describe('menu input: standard gamepad', () => {
  it.each([
    ['A (south)', PAD_BUTTON.SOUTH, ACTION.MENU_SELECT],
    ['Start', PAD_BUTTON.START, ACTION.MENU_SELECT],
    ['B (east)', PAD_BUTTON.EAST, ACTION.MENU_BACK],
    ['D-pad up', PAD_BUTTON.DPAD_UP, ACTION.MENU_UP],
    ['D-pad down', PAD_BUTTON.DPAD_DOWN, ACTION.MENU_DOWN],
  ])('%s gives one menu edge per press', (_name, button, action) => {
    const { pad, actions } = rig();
    setButton(pad, button, true);
    actions.beginFrame();
    actions.beginFrame(); // still held: no new edge
    expect(actions.takeMenuEdges()).toBe(action);
    expect(actions.takeMenuEdges()).toBe(0);
    setButton(pad, button, false);
    actions.beginFrame();
    setButton(pad, button, true);
    actions.beginFrame();
    expect(actions.takeMenuEdges()).toBe(action);
  });

  it('X, Y, the triggers and View give no menu edge', () => {
    const { pad, actions } = rig();
    for (const button of [PAD_BUTTON.WEST, PAD_BUTTON.NORTH, PAD_BUTTON.BACK]) setButton(pad, button, true);
    setButton(pad, PAD_BUTTON.RIGHT_TRIGGER, true);
    setButton(pad, PAD_BUTTON.LEFT_TRIGGER, true);
    actions.beginFrame();
    expect(actions.takeMenuEdges()).toBe(0);
  });
});

describe('menu input never reaches the sim', () => {
  it('Enter, Backspace and the D-pad leave the InputFrame neutral', () => {
    const { keyboard, pad, actions } = rig();
    tap(keyboard, 'Enter');
    tap(keyboard, 'Backspace');
    setButton(pad, PAD_BUTTON.DPAD_UP, true);
    actions.beginFrame();
    expect(actions.sampleForTick()).toEqual(createInputFrame());
    expect(actions.takeMenuEdges()).toBe(ACTION.MENU_SELECT | ACTION.MENU_BACK | ACTION.MENU_UP);
  });

  it('Space is the brush edge for the sim and a select edge for the menu, each taken on its own', () => {
    const { keyboard, actions } = rig();
    tap(keyboard, 'Space');
    const frame = actions.sampleForTick();
    expect(frame.pressed).toBe(PRESSED.BRUSH);
    expect(frame.buttons).toBe(0);
    expect(actions.takeMenuEdges()).toBe(ACTION.MENU_SELECT);
    expect(actions.sampleForTick().pressed).toBe(0);
  });

  it('the scene-layer edges (pause, map, dev panel) carry no menu bits', () => {
    const { keyboard, actions } = rig();
    tap(keyboard, 'Escape');
    actions.beginFrame();
    expect(actions.sceneActions).toBe(ACTION.PAUSE);
    expect(actions.sceneActions & MENU_ACTIONS).toBe(0);
    expect(actions.takeMenuEdges()).toBe(ACTION.MENU_BACK);
  });

  it('NO_MENU_INPUT never reports anything', () => {
    expect(NO_MENU_INPUT.takeMenuEdges()).toBe(0);
  });
});
