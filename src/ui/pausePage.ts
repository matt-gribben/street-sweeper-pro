// The pause overlay's pages (GDD §15.4, §16.3; ART_BIBLE §12.3; SSP-287): what src/scenes/PauseOverlay.ts draws over
// the frozen, dimmed shift. Two pages, each a `ui.panel_dark` panel centred in the frame:
//
//   main       PAUSED (15 sweeper_yellow, outlined), then one button per visible entry of PAUSE_ENTRIES, in GDD
//              §15.4's order: Resume, Restart Shift, Settings, Controls, Retire, Finish Sweep.
//   controls   CONTROLS, the device the labels are for (05 slab), then one row per GDD §6.1 action (07 chalk name,
//              16 lemon binding, from the glyphs.ts table for the active device), then a Back button.
//
// The entry list is data: each entry carries a visibility predicate over PauseConditions, so later issues show
// their entry by making the predicate true (Settings once SettingsScene exists, SSP-235; Finish Sweep in Free Sweep,
// SSP-196). A hidden entry has no rect: menus.ts skips it for the focus and the mouse, and it is not drawn. The
// panel's height follows the visible entries; its width fits every entry's label, so it never changes when an
// entry appears.
//
// The Controls rows are GDD §6.1's player actions plus the two menu actions; the dev panel (F1, dev builds only) is
// not a player control and is left off. SSP-236 (M7) builds the glyph table from the remapped bindings instead.
//
// Pure layout over UiItems (uiItems.ts): PauseOverlay draws it, the tests rasterise it on the CPU.
import { type BitmapFont, TextAlign, TextVariant } from './bitmapText.ts';
import { type GlyphAction, type GlyphDevice, type GlyphTable, glyphLabel } from './glyphs.ts';
import { ButtonState, buttonWidthFor, PanelStyle, type UiRect } from './panels.ts';
import { textItem, type UiItem } from './uiItems.ts';

/** What the pause entries' visibility depends on. */
export type PauseConditions = {
  /** A SettingsScene exists to open (SSP-235, M7). */
  readonly settingsAvailable: boolean;
  /** The shift is a Free Sweep (SSP-196, M6): Finish Sweep ends it on the tally. */
  readonly freeSweep: boolean;
};

/** M3: no SettingsScene and no Free Sweep yet, so Settings and Finish Sweep stay hidden. */
export const M3_PAUSE_CONDITIONS: PauseConditions = Object.freeze({
  settingsAvailable: false,
  freeSweep: false,
});

/** The pause entries, in GDD §15.4 order (also each entry's item index in the main page's menu). */
export const PauseEntry = {
  Resume: 0,
  RestartShift: 1,
  Settings: 2,
  Controls: 3,
  Retire: 4,
  FinishSweep: 5,
} as const;
export type PauseEntry = (typeof PauseEntry)[keyof typeof PauseEntry];

/** One entry of the main page. */
export type PauseEntrySpec = {
  readonly entry: PauseEntry;
  readonly label: string;
  /** False hides the entry: not drawn, never focused, never hit. */
  readonly visible: (conditions: PauseConditions) => boolean;
};

const always = (): boolean => true;

/**
 * Every entry, in PauseEntry order. Retire stands in for 'Retire to Week Map': until WeekMapScene exists (SSP-191) it
 * returns to the shift intro card, as the tally's Back to Briefing does (SSP-071).
 */
export const PAUSE_ENTRIES: readonly PauseEntrySpec[] = Object.freeze([
  { entry: PauseEntry.Resume, label: 'RESUME', visible: always },
  { entry: PauseEntry.RestartShift, label: 'RESTART SHIFT', visible: always },
  { entry: PauseEntry.Settings, label: 'SETTINGS', visible: (c: PauseConditions) => c.settingsAvailable },
  { entry: PauseEntry.Controls, label: 'CONTROLS', visible: always },
  { entry: PauseEntry.Retire, label: 'RETIRE', visible: always },
  { entry: PauseEntry.FinishSweep, label: 'FINISH SWEEP', visible: (c: PauseConditions) => c.freeSweep },
]);

/** The main page's title. */
export const PAUSE_TITLE = 'PAUSED';

/** The Controls page's title and its only button. */
export const CONTROLS_TITLE = 'CONTROLS';
export const CONTROLS_BACK_LABEL = 'BACK';

/** The device line under the Controls title. */
export const CONTROLS_DEVICE_TEXT: { readonly [D in GlyphDevice]: string } = {
  keyboard: 'KEYBOARD',
  gamepad: 'GAMEPAD',
};

/** The Controls page's rows: GDD §6.1's actions in its order, then menu select and back. */
export const CONTROLS_ROWS: readonly (readonly [action: GlyphAction, label: string])[] = Object.freeze([
  ['throttle', 'THROTTLE'],
  ['brake', 'BRAKE / REVERSE'],
  ['steer', 'STEER'],
  ['brush', 'BRUSH UP / DOWN'],
  ['spray', 'WATER SPRAY'],
  ['horn', 'HORN'],
  ['interact', 'INTERACT / DUMP'],
  ['map', 'SHIFT MAP'],
  ['pause', 'PAUSE'],
  ['menuSelect', 'MENU SELECT'],
  ['menuBack', 'MENU BACK'],
]);

/** Palette indices (Kerbside-32 names). */
const SLAB = 5;
const CHALK = 7;
const SWEEPER_YELLOW = 15;
const LEMON = 16;

const PAD_X_PX = 16;
const TITLE_Y_PX = 10;
const FIRST_BUTTON_Y_PX = 28;
const BUTTON_H_PX = 17;
const BUTTON_STEP_PX = 21;
const PAD_BOTTOM_PX = 10;
const DEVICE_Y_PX = 22;
const FIRST_ROW_Y_PX = 36;
const ROW_STEP_PX = 10;
const ROW_GAP_PX = 24;
const CONTROLS_BUTTON_GAP_PX = 6;

/** The entries `conditions` show, in order. */
export function visiblePauseEntries(conditions: PauseConditions): PauseEntrySpec[] {
  return PAUSE_ENTRIES.filter((spec) => spec.visible(conditions));
}

/** The width every main-page button takes: the widest label's (hidden entries included, so it never changes). */
function pauseButtonWidth(font: BitmapFont): number {
  return Math.max(...PAUSE_ENTRIES.map((spec) => buttonWidthFor(font, spec.label)));
}

/** The main page's panel rect for `conditions` at internal size `widthPx` × `heightPx`. */
export function pausePanelRect(
  font: BitmapFont,
  widthPx: number,
  heightPx: number,
  conditions: PauseConditions,
): UiRect {
  const count = visiblePauseEntries(conditions).length;
  const w = Math.max(pauseButtonWidth(font), font.measure(PAUSE_TITLE, TextVariant.Outline)) + 2 * PAD_X_PX;
  const h = FIRST_BUTTON_Y_PX + (count - 1) * BUTTON_STEP_PX + BUTTON_H_PX + PAD_BOTTOM_PX;
  return { x: (widthPx - w) >> 1, y: (heightPx - h) >> 1, w, h };
}

/**
 * The main page's button rects in PauseEntry order (null for a hidden entry), stacked in the panel: what the menu
 * hit-tests and what the layout draws.
 */
export function pauseButtonRects(
  font: BitmapFont,
  widthPx: number,
  heightPx: number,
  conditions: PauseConditions,
): (UiRect | null)[] {
  const panel = pausePanelRect(font, widthPx, heightPx, conditions);
  const w = pauseButtonWidth(font);
  const x = (widthPx - w) >> 1;
  let row = 0;
  return PAUSE_ENTRIES.map((spec) => {
    if (!spec.visible(conditions)) return null;
    const rect = { x, y: panel.y + FIRST_BUTTON_Y_PX + row * BUTTON_STEP_PX, w, h: BUTTON_H_PX };
    row += 1;
    return rect;
  });
}

/** Button states with `focus` focused and nothing pressed (PauseEntry order): the page as it first shows. */
export function pauseButtonStates(focus: PauseEntry = PauseEntry.Resume): ButtonState[] {
  return PAUSE_ENTRIES.map((spec) => (spec.entry === focus ? ButtonState.Focus : ButtonState.Normal));
}

/**
 * The main page at internal size `widthPx` × `heightPx`: the dark panel, PAUSED and every visible entry's button in
 * its `states` entry (PauseEntry order: the menu's buttonState(), or pauseButtonStates()).
 */
export function pauseMainLayout(
  font: BitmapFont,
  widthPx: number,
  heightPx: number,
  conditions: PauseConditions,
  states: readonly ButtonState[],
): UiItem[] {
  const panel = pausePanelRect(font, widthPx, heightPx, conditions);
  const items: UiItem[] = [
    { kind: 'panel', style: PanelStyle.Dark, x: panel.x, y: panel.y, w: panel.w, h: panel.h },
    textItem(
      PAUSE_TITLE,
      widthPx >> 1,
      panel.y + TITLE_Y_PX,
      SWEEPER_YELLOW,
      TextAlign.Centre,
      TextVariant.Outline,
    ),
  ];
  const rects = pauseButtonRects(font, widthPx, heightPx, conditions);
  PAUSE_ENTRIES.forEach((spec, i) => {
    const rect = rects[i];
    if (rect === null || rect === undefined) return;
    items.push({ kind: 'button', state: states[i] ?? ButtonState.Normal, rect, label: spec.label });
  });
  return items;
}

/** The Controls page's rows for `device`: each action's name and its binding's label (glyphs.ts). */
export function controlsRows(
  table: GlyphTable,
  device: GlyphDevice,
): readonly (readonly [label: string, binding: string])[] {
  return CONTROLS_ROWS.map(([action, label]) => [label, glyphLabel(table, action, device)] as const);
}

/** The Controls page's panel rect: wide enough for every row on either device, so a device switch keeps it. */
export function controlsPanelRect(
  font: BitmapFont,
  table: GlyphTable,
  widthPx: number,
  heightPx: number,
): UiRect {
  const labelW = Math.max(...CONTROLS_ROWS.map(([, label]) => font.measure(label)));
  const bindingW = Math.max(
    ...CONTROLS_ROWS.flatMap(([action]) => [
      font.measure(glyphLabel(table, action, 'keyboard')),
      font.measure(glyphLabel(table, action, 'gamepad')),
    ]),
  );
  const w = Math.min(widthPx - 8, labelW + ROW_GAP_PX + bindingW + 2 * PAD_X_PX);
  const rowsEnd = FIRST_ROW_Y_PX + CONTROLS_ROWS.length * ROW_STEP_PX;
  const h = rowsEnd + CONTROLS_BUTTON_GAP_PX + BUTTON_H_PX + PAD_BOTTOM_PX;
  return { x: (widthPx - w) >> 1, y: (heightPx - h) >> 1, w, h };
}

/** The Controls page's Back button rect. */
export function controlsBackRect(
  font: BitmapFont,
  table: GlyphTable,
  widthPx: number,
  heightPx: number,
): UiRect {
  const panel = controlsPanelRect(font, table, widthPx, heightPx);
  const w = buttonWidthFor(font, CONTROLS_BACK_LABEL);
  return {
    x: (widthPx - w) >> 1,
    y: panel.y + panel.h - PAD_BOTTOM_PX - BUTTON_H_PX,
    w,
    h: BUTTON_H_PX,
  };
}

/**
 * The read-only Controls page for `device` (GDD §16.3) at internal size `widthPx` × `heightPx`, its Back button in
 * `backState`.
 */
export function controlsPageLayout(
  font: BitmapFont,
  table: GlyphTable,
  device: GlyphDevice,
  widthPx: number,
  heightPx: number,
  backState: ButtonState,
): UiItem[] {
  const panel = controlsPanelRect(font, table, widthPx, heightPx);
  const cx = widthPx >> 1;
  const left = panel.x + PAD_X_PX;
  const right = panel.x + panel.w - PAD_X_PX;
  const items: UiItem[] = [
    { kind: 'panel', style: PanelStyle.Dark, x: panel.x, y: panel.y, w: panel.w, h: panel.h },
    textItem(CONTROLS_TITLE, cx, panel.y + TITLE_Y_PX, SWEEPER_YELLOW, TextAlign.Centre, TextVariant.Outline),
    textItem(CONTROLS_DEVICE_TEXT[device], cx, panel.y + DEVICE_Y_PX, SLAB, TextAlign.Centre),
  ];
  let y = panel.y + FIRST_ROW_Y_PX;
  for (const [label, binding] of controlsRows(table, device)) {
    items.push(textItem(label, left, y, CHALK));
    items.push(textItem(binding, right, y, LEMON, TextAlign.Right));
    y += ROW_STEP_PX;
  }
  items.push({
    kind: 'button',
    state: backState,
    rect: controlsBackRect(font, table, widthPx, heightPx),
    label: CONTROLS_BACK_LABEL,
  });
  return items;
}
