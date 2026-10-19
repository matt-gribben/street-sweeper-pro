// The default glyph bindings (SSP-286): src/ui/glyphs.ts's GlyphBindings derived from the SSP-044 binding tables
// (src/input/keyboard.ts KEY_BINDINGS, src/input/gamepad.ts PAD_BUTTON_ACTIONS), so a prompt names exactly the key
// or button the game reads. It lives in the composition root because src/ui may not import src/input
// (TECHNICAL_DESIGN §2.1).
//
// Each glyph action is a list of parts, each part naming one key (the first KEY_BINDINGS code, in table order,
// carrying its bit) and one pad control (the first PAD_BUTTON_ACTIONS button carrying its bit, or the analogue
// control the pad reads for it). Steer has two parts (left, right): 'A/D'. The triggers and the steering stick
// are read as values, not buttons, so their controls are named here.

import { ACTION } from '../input/actions.ts';
import { PAD_BUTTON, PAD_BUTTON_ACTIONS } from '../input/gamepad.ts';
import { DRIVE, KEY_BINDINGS } from '../input/keyboard.ts';
import {
  buildGlyphTable,
  GLYPH_ACTIONS,
  type GlyphAction,
  type GlyphBindings,
  type GlyphTable,
  PAD_LEFT_STICK,
} from '../ui/glyphs.ts';

/** One part of a glyph action: the keyboard bit to look up, and the pad bit to look up or a fixed control. */
type Part = { readonly key: number; readonly pad: { readonly bit: number } | { readonly control: number } };

const bit = (b: number): { readonly bit: number } => ({ bit: b });
const control = (c: number): { readonly control: number } => ({ control: c });

/** Every glyph action as parts, in display order. */
const GLYPH_PARTS: { readonly [A in GlyphAction]: readonly Part[] } = {
  throttle: [{ key: DRIVE.THROTTLE, pad: control(PAD_BUTTON.RIGHT_TRIGGER) }],
  brake: [{ key: DRIVE.BRAKE, pad: control(PAD_BUTTON.LEFT_TRIGGER) }],
  steer: [
    { key: DRIVE.STEER_LEFT, pad: control(PAD_LEFT_STICK) },
    { key: DRIVE.STEER_RIGHT, pad: control(PAD_LEFT_STICK) },
  ],
  brush: [{ key: ACTION.BRUSH, pad: bit(ACTION.BRUSH) }],
  spray: [{ key: ACTION.SPRAY, pad: bit(ACTION.SPRAY) }],
  horn: [{ key: ACTION.HORN, pad: bit(ACTION.HORN) }],
  interact: [{ key: ACTION.INTERACT, pad: bit(ACTION.INTERACT) }],
  map: [{ key: ACTION.MAP, pad: bit(ACTION.MAP) }],
  pause: [{ key: ACTION.PAUSE, pad: bit(ACTION.PAUSE) }],
  menuSelect: [{ key: ACTION.MENU_SELECT, pad: bit(ACTION.MENU_SELECT) }],
  menuBack: [{ key: ACTION.MENU_BACK, pad: bit(ACTION.MENU_BACK) }],
};

function firstKey(keyBindings: ReadonlyMap<string, number>, wanted: number): string | null {
  for (const [code, bits] of keyBindings) if ((bits & wanted) !== 0) return code;
  return null;
}

function firstButton(padBindings: readonly (readonly [number, number])[], wanted: number): number | null {
  for (const [index, bits] of padBindings) if ((bits & wanted) !== 0) return index;
  return null;
}

/** GlyphBindings for a keyboard and a pad binding table (the defaults, or SSP-236's remapped ones). */
export function glyphBindingsFrom(
  keyBindings: ReadonlyMap<string, number>,
  padBindings: readonly (readonly [index: number, actions: number])[],
): GlyphBindings {
  const out: Partial<Record<GlyphAction, { keys: string[]; pad: number[] }>> = {};
  for (const action of GLYPH_ACTIONS) {
    const keys: string[] = [];
    const pad: number[] = [];
    for (const part of GLYPH_PARTS[action]) {
      const code = firstKey(keyBindings, part.key);
      if (code !== null) keys.push(code);
      const button = 'bit' in part.pad ? firstButton(padBindings, part.pad.bit) : part.pad.control;
      if (button !== null && !pad.includes(button)) pad.push(button);
    }
    out[action] = { keys, pad };
  }
  return out as GlyphBindings;
}

/** The default bindings' glyph table (until SSP-236's remapping). */
export const DEFAULT_GLYPHS: GlyphTable = buildGlyphTable(
  glyphBindingsFrom(KEY_BINDINGS, PAD_BUTTON_ACTIONS),
);
