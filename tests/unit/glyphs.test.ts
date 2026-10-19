// SSP-286: the input glyph lookup (src/ui/glyphs.ts) built from the SSP-044 default bindings
// (src/app/glyphBindings.ts), and the active-device signal it follows (src/input/actions.ts activeDevice).
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_GLYPHS, glyphBindingsFrom } from '../../src/app/glyphBindings.ts';
import { Actions, DEFAULT_INPUT_DEVICE, NO_MENU_INPUT, POINTER_PHASE } from '../../src/input/actions.ts';
import { GamepadDevice, PAD_BUTTON, PAD_BUTTON_ACTIONS } from '../../src/input/gamepad.ts';
import { KEY_BINDINGS, KeyboardDevice } from '../../src/input/keyboard.ts';
import { PointerDevice } from '../../src/input/pointer.ts';
import { DT_S } from '../../src/sim/constants.ts';
import {
  buildGlyphTable,
  GLYPH_ACTIONS,
  glyphLabel,
  keyLabel,
  PAD_LEFT_STICK,
  padLabel,
  UNBOUND_GLYPH,
} from '../../src/ui/glyphs.ts';
import { fakePad, keyEvent, padSource, setButton, setTrigger } from '../support/fakeInput.ts';
import { compileTerm, findBlockedTerms, loadDenylist } from './ipHygieneScan.ts';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

describe('glyph lookup', () => {
  it("returns 'Space' for brush with the keyboard active and 'A' with the gamepad active", () => {
    expect(glyphLabel(DEFAULT_GLYPHS, 'brush', 'keyboard')).toBe('Space');
    expect(glyphLabel(DEFAULT_GLYPHS, 'brush', 'gamepad')).toBe('A');
  });

  it('labels every default binding as the issue and GDD §6.1 name them', () => {
    expect(DEFAULT_GLYPHS.keyboard).toEqual({
      throttle: 'W',
      brake: 'S',
      steer: 'A/D',
      brush: 'Space',
      spray: 'Left Shift',
      horn: 'H',
      interact: 'E',
      map: 'Tab',
      pause: 'Esc',
      menuSelect: 'Space',
      menuBack: 'Esc',
    });
    expect(DEFAULT_GLYPHS.gamepad).toEqual({
      throttle: 'RT',
      brake: 'LT',
      steer: 'Left Stick',
      brush: 'A',
      spray: 'X',
      horn: 'B',
      interact: 'Y',
      map: 'View',
      pause: 'Start',
      menuSelect: 'A',
      menuBack: 'B',
    });
  });

  it('is built from the binding tables: a remapped table changes the labels', () => {
    const remapped = new Map(KEY_BINDINGS);
    remapped.delete('Space');
    remapped.set('KeyJ', KEY_BINDINGS.get('Space') ?? 0);
    const pad = PAD_BUTTON_ACTIONS.map(([i, bits]) =>
      i === PAD_BUTTON.SOUTH ? ([PAD_BUTTON.NORTH, bits] as const) : ([i, bits] as const),
    ).filter(([i, bits]) => !(i === PAD_BUTTON.NORTH && bits === PAD_BUTTON_ACTIONS[3]?.[1]));
    const table = buildGlyphTable(glyphBindingsFrom(remapped, pad));
    expect(table.keyboard.brush).toBe('J');
    expect(table.keyboard.menuSelect).toBe('Enter'); // Enter is the next code carrying MENU_SELECT
    expect(table.gamepad.brush).toBe('Y');
    expect(table.gamepad.interact).toBe(UNBOUND_GLYPH);
  });

  it('labels keys and standard-mapping controls without codes or brand names', () => {
    expect(['KeyW', 'Digit3', 'ArrowUp', 'ShiftLeft', 'Escape', 'NumpadEnter', 'F1'].map(keyLabel)).toEqual([
      'W',
      '3',
      '↑',
      'Left Shift',
      'Esc',
      'Enter',
      'F1',
    ]);
    expect([0, 1, 2, 3, 6, 7, 8, 9, 12, PAD_LEFT_STICK, 40].map(padLabel)).toEqual([
      'A',
      'B',
      'X',
      'Y',
      'LT',
      'RT',
      'View',
      'Start',
      'D-pad Up',
      'Left Stick',
      'Button 40',
    ]);
    const every = GLYPH_ACTIONS.flatMap((a) => [DEFAULT_GLYPHS.keyboard[a], DEFAULT_GLYPHS.gamepad[a]]);
    const terms = loadDenylist(REPO_ROOT).map(compileTerm);
    expect(findBlockedTerms(every.join('\n'), terms)).toEqual([]);
  });
});

describe('active device', () => {
  function rig() {
    const keyboard = new KeyboardDevice(DT_S);
    const pad = fakePad();
    const pads = padSource(null);
    const pointer = new PointerDevice();
    const actions = new Actions([keyboard, new GamepadDevice(pads.source)], pointer);
    actions.beginFrame();
    return { keyboard, pad, pads, pointer, actions };
  }
  const label = (actions: Actions): string => glyphLabel(DEFAULT_GLYPHS, 'brush', actions.activeDevice);

  it('starts on the keyboard and switches on the first input from the other device', () => {
    const { keyboard, pad, pads, actions } = rig();
    expect(actions.activeDevice).toBe(DEFAULT_INPUT_DEVICE);
    expect(label(actions)).toBe('Space');
    // The pad appears with A held (browsers reveal a pad on its first press): that press switches.
    pads.slots = [pad];
    setButton(pad, PAD_BUTTON.SOUTH, true);
    actions.beginFrame();
    expect(actions.activeDevice).toBe('gamepad');
    expect(label(actions)).toBe('A');
    // One key press switches back.
    keyboard.handleKeyDown(keyEvent('KeyH'));
    expect(actions.activeDevice).toBe('keyboard');
    // Holding A switches nothing; a new press does.
    actions.beginFrame();
    expect(actions.activeDevice).toBe('keyboard');
    setButton(pad, PAD_BUTTON.SOUTH, false);
    actions.beginFrame();
    setButton(pad, PAD_BUTTON.DPAD_DOWN, true);
    actions.beginFrame();
    expect(actions.activeDevice).toBe('gamepad');
  });

  it('a trigger, the steering stick or the menu stick leaving rest selects the pad; a click the keyboard', () => {
    const { pad, pads, pointer, actions } = rig();
    pads.slots = [pad];
    actions.beginFrame(); // baseline, nothing held
    expect(actions.activeDevice).toBe('keyboard');
    setTrigger(pad, PAD_BUTTON.RIGHT_TRIGGER, 0.6);
    actions.beginFrame();
    expect(actions.activeDevice).toBe('gamepad');
    pointer.handle(POINTER_PHASE.Down, { clientX: 1, clientY: 1, button: 0, isPrimary: true });
    expect(actions.activeDevice).toBe('keyboard');
    pad.axes[0] = 0.8;
    actions.beginFrame();
    expect(actions.activeDevice).toBe('gamepad');
    pointer.handle(POINTER_PHASE.Down, { clientX: 1, clientY: 1, button: 0, isPrimary: true });
    expect(actions.activeDevice).toBe('keyboard');
    pad.axes[1] = -0.9;
    actions.beginFrame();
    expect(actions.activeDevice).toBe('gamepad');
  });

  it('noise inside the deadzones and unbound keys do not switch', () => {
    const { keyboard, pad, pads, actions } = rig();
    pads.slots = [pad];
    actions.beginFrame();
    keyboard.handleKeyDown(keyEvent('KeyH'));
    expect(actions.activeDevice).toBe('keyboard');
    setTrigger(pad, PAD_BUTTON.LEFT_TRIGGER, 0.1);
    pad.axes[0] = 0.1;
    pad.axes[1] = 0.3;
    actions.beginFrame();
    expect(actions.activeDevice).toBe('keyboard');
    setButton(pad, PAD_BUTTON.SOUTH, true);
    actions.beginFrame();
    expect(actions.activeDevice).toBe('gamepad');
    keyboard.handleKeyDown(keyEvent('KeyQ')); // not bound
    expect(actions.activeDevice).toBe('gamepad');
  });

  it('NO_MENU_INPUT reports the keyboard and no pointer samples', () => {
    expect(NO_MENU_INPUT.activeDevice).toBe('keyboard');
    expect(NO_MENU_INPUT.menuHeld).toBe(0);
    expect(NO_MENU_INPUT.takePointer({ phase: POINTER_PHASE.Up, clientX: 0, clientY: 0 })).toBe(false);
  });
});
