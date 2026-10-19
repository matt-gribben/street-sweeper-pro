// Input glyphs (GDD §6.1, §16.1, §16.3; SSP-286): the label a prompt shows for an action on the active input device.
// 'Press Space to start' on the keyboard, 'Press A to start' on the pad; Pam's radio keycaps (SSP-289) and the
// Pause Controls page (SSP-287) read the same lookup.
//
// A pure lookup over a GlyphBindings value: per action, the KeyboardEvent.code(s) and the standard-mapping
// control(s) bound to it, in display order. src/app/glyphBindings.ts builds the default from the SSP-044 binding
// tables (src/ui may not import src/input, TECHNICAL_DESIGN §2.1); SSP-236 builds it from the remapped bindings
// instead, and SSP-262 adds touch. Labels are plain Kerbside 5×7 text:
//
//   keyboard   a letter or digit key is its character ('KeyW' → 'W'), the arrows are ↑ ↓ ← →, and the rest are
//              written out: 'Space', 'Left Shift', 'Esc', 'Enter', 'Tab'. Two codes (steer) join with '/': 'A/D'.
//   gamepad    standard-mapping names (GDD §6.1): 'A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View', 'Start',
//              'D-pad Up' ..., and 'Left Stick'. Never a controller brand's name or logo.
//
// The device kind is the string union src/input/actions.ts calls InputDeviceKind ('keyboard' covers the mouse).

/** The device a label is for (src/input/actions.ts InputDeviceKind). */
export type GlyphDevice = 'keyboard' | 'gamepad';

/** Actions a prompt can name, in GDD §6.1 order, plus menu select and back. Pam's bark tokens use these names. */
export const GLYPH_ACTIONS = [
  'throttle',
  'brake',
  'steer',
  'brush',
  'spray',
  'horn',
  'interact',
  'map',
  'pause',
  'menuSelect',
  'menuBack',
] as const;
export type GlyphAction = (typeof GLYPH_ACTIONS)[number];

/** The standard-mapping control id of the left stick (not a button index; buttons are 0..16). */
export const PAD_LEFT_STICK = 100;

/** What one action is bound to, in display order. Either list may be empty (nothing bound: the label is '?'). */
export type GlyphBinding = {
  /** KeyboardEvent.code values. */
  readonly keys: readonly string[];
  /** Standard-mapping button indices, or PAD_LEFT_STICK. */
  readonly pad: readonly number[];
};

/** Every glyph action's binding. */
export type GlyphBindings = { readonly [A in GlyphAction]: GlyphBinding };

/** The labels per device, built once from a GlyphBindings (buildGlyphTable). */
export type GlyphTable = { readonly [D in GlyphDevice]: { readonly [A in GlyphAction]: string } };

/** Label of an unbound action. */
export const UNBOUND_GLYPH = '?';

/** Keys whose label is not derived from the code's shape. */
const KEY_LABELS: ReadonlyMap<string, string> = new Map([
  ['Space', 'Space'],
  ['ShiftLeft', 'Left Shift'],
  ['ShiftRight', 'Right Shift'],
  ['ControlLeft', 'Left Ctrl'],
  ['ControlRight', 'Right Ctrl'],
  ['AltLeft', 'Left Alt'],
  ['AltRight', 'Right Alt'],
  ['Escape', 'Esc'],
  ['Enter', 'Enter'],
  ['NumpadEnter', 'Enter'],
  ['Backspace', 'Backspace'],
  ['Tab', 'Tab'],
  ['ArrowUp', '↑'],
  ['ArrowDown', '↓'],
  ['ArrowLeft', '←'],
  ['ArrowRight', '→'],
]);

/** Standard-mapping button names by index (W3C Gamepad 'standard' layout), as GDD §6.1 writes them. */
const PAD_LABELS: readonly string[] = [
  'A',
  'B',
  'X',
  'Y',
  'LB',
  'RB',
  'LT',
  'RT',
  'View',
  'Start',
  'L3',
  'R3',
  'D-pad Up',
  'D-pad Down',
  'D-pad Left',
  'D-pad Right',
  'Home',
];

/** The label of one keyboard key, by KeyboardEvent.code ('KeyW' → 'W', 'ShiftLeft' → 'Left Shift'). */
export function keyLabel(code: string): string {
  const named = KEY_LABELS.get(code);
  if (named !== undefined) return named;
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^Numpad[0-9]$/.test(code)) return `Num ${code.slice(6)}`;
  return code; // F1..F12 and anything else read as their code
}

/** The label of one standard-mapping control (a button index or PAD_LEFT_STICK). */
export function padLabel(control: number): string {
  if (control === PAD_LEFT_STICK) return 'Left Stick';
  return PAD_LABELS[control] ?? `Button ${control}`;
}

function joinLabels(labels: readonly string[]): string {
  return labels.length === 0 ? UNBOUND_GLYPH : labels.join('/');
}

/** Every action's label on both devices, for `bindings`. */
export function buildGlyphTable(bindings: GlyphBindings): GlyphTable {
  const keyboard: Partial<Record<GlyphAction, string>> = {};
  const gamepad: Partial<Record<GlyphAction, string>> = {};
  for (const action of GLYPH_ACTIONS) {
    const binding = bindings[action];
    keyboard[action] = joinLabels(binding.keys.map(keyLabel));
    gamepad[action] = joinLabels(binding.pad.map(padLabel));
  }
  return Object.freeze({
    keyboard: Object.freeze(keyboard as Record<GlyphAction, string>),
    gamepad: Object.freeze(gamepad as Record<GlyphAction, string>),
  });
}

/** The label a prompt shows for `action` with `device` active ('Space' for brush on the keyboard, 'A' on the pad). */
export function glyphLabel(table: GlyphTable, action: GlyphAction, device: GlyphDevice): string {
  return table[device][action];
}
