// SSP-287: the pause overlay's pages (src/ui/pausePage.ts) as pure layouts. The data-driven entry list in GDD §15.4
// order with its visibility predicates (Settings and Finish Sweep hidden in M3, no rect, never focused), the
// read-only Controls page listing every GDD §6.1 action with the active device's labels (glyphs.ts over the default
// bindings), and that every quad lands inside its panel at the narrowest, base and widest internal widths.
import { describe, expect, it } from 'vitest';
import { DEFAULT_GLYPHS } from '../../src/app/glyphBindings.ts';
import { GLYPH_ACTIONS } from '../../src/ui/glyphs.ts';
import { MENU_COMMAND, Menu } from '../../src/ui/menus.ts';
import { ButtonState, Panels } from '../../src/ui/panels.ts';
import {
  CONTROLS_ROWS,
  controlsPageLayout,
  controlsPanelRect,
  controlsRows,
  M3_PAUSE_CONDITIONS,
  PAUSE_ENTRIES,
  type PauseConditions,
  PauseEntry,
  pauseButtonRects,
  pauseButtonStates,
  pauseMainLayout,
  pausePanelRect,
  visiblePauseEntries,
} from '../../src/ui/pausePage.ts';
import { drawUiItems, type UiItem, uiItemStrings } from '../../src/ui/uiItems.ts';
import { readBitmapFont, readIndexedAtlas, TextRaster } from '../support/textRaster.ts';

const font = readBitmapFont('kerbside5x7');
const HEIGHT = 270;
const WIDTHS = [432, 480, 640];
const ALL: PauseConditions = { settingsAvailable: true, freeSweep: true };

/** Every GDD §6.1 action row (the dev panel, dev builds only, is not a player control), with both devices' labels. */
const GDD_6_1 = [
  ['THROTTLE', 'W', 'RT'],
  ['BRAKE / REVERSE', 'S', 'LT'],
  ['STEER', 'A/D', 'Left Stick'],
  ['BRUSH UP / DOWN', 'Space', 'A'],
  ['WATER SPRAY', 'Left Shift', 'X'],
  ['HORN', 'H', 'B'],
  ['INTERACT / DUMP', 'E', 'Y'],
  ['SHIFT MAP', 'Tab', 'View'],
  ['PAUSE', 'Esc', 'Start'],
] as const;

/** The pixels a layout covers, by palette index, inside a raster of the frame size. */
function rasterise(items: readonly UiItem[], width: number): TextRaster {
  const raster = new TextRaster(width, HEIGHT, readIndexedAtlas('ui'));
  drawUiItems(new Panels(raster, font), items);
  return raster;
}

/** Covered pixels outside `rect` (should be none: everything sits on the panel). */
function outside(raster: TextRaster, rect: { x: number; y: number; w: number; h: number }): number {
  let count = 0;
  for (let y = 0; y < raster.height; y++) {
    for (let x = 0; x < raster.width; x++) {
      if (raster.at(x, y) < 0) continue;
      if (x < rect.x || x >= rect.x + rect.w || y < rect.y || y >= rect.y + rect.h) count++;
    }
  }
  return count;
}

describe('pause entries', () => {
  it('are GDD §15.4 in order, each with a visibility predicate', () => {
    expect(PAUSE_ENTRIES.map((e) => e.label)).toEqual([
      'RESUME',
      'RESTART SHIFT',
      'SETTINGS',
      'CONTROLS',
      'RETIRE',
      'FINISH SWEEP',
    ]);
    expect(PAUSE_ENTRIES.map((e) => e.entry)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(visiblePauseEntries(M3_PAUSE_CONDITIONS).map((e) => e.entry)).toEqual([
      PauseEntry.Resume,
      PauseEntry.RestartShift,
      PauseEntry.Controls,
      PauseEntry.Retire,
    ]);
    expect(visiblePauseEntries({ settingsAvailable: true, freeSweep: false }).map((e) => e.entry)).toContain(
      PauseEntry.Settings,
    );
    expect(visiblePauseEntries(ALL)).toHaveLength(6);
  });

  it('hidden entries get no rect, are not drawn and cannot take the focus', () => {
    const rects = pauseButtonRects(font, 480, HEIGHT, M3_PAUSE_CONDITIONS);
    expect(rects[PauseEntry.Settings]).toBeNull();
    expect(rects[PauseEntry.FinishSweep]).toBeNull();
    const layout = pauseMainLayout(font, 480, HEIGHT, M3_PAUSE_CONDITIONS, pauseButtonStates());
    expect(uiItemStrings(layout)).toEqual(['PAUSED', 'RESUME', 'RESTART SHIFT', 'CONTROLS', 'RETIRE']);
    // A menu over the entries (as PauseOverlay builds it): the focus walks only the visible ones, and the hidden
    // entries' would-be rows hit nothing.
    const picked: number[] = [];
    const menu = new Menu({
      id: 'pause',
      items: PAUSE_ENTRIES.map((spec) => ({
        label: spec.label,
        onSelect: () => picked.push(spec.entry),
        visible: () => spec.visible(M3_PAUSE_CONDITIONS),
      })),
      events: null,
      focus: PauseEntry.Settings,
    });
    expect(menu.focus).toBe(PauseEntry.Controls); // a hidden start focus moves on to the next visible entry
    menu.setRects(rects);
    const order: number[] = [];
    for (let i = 0; i < 8; i++) {
      menu.command(MENU_COMMAND.Down);
      order.push(menu.focus);
    }
    expect(order).toEqual([4, 0, 1, 3, 4, 0, 1, 3]);
    const all = pauseButtonRects(font, 480, HEIGHT, ALL);
    for (const hidden of [PauseEntry.Settings, PauseEntry.FinishSweep]) {
      const r = all[hidden];
      if (r === null || r === undefined) throw new Error('no rect with every entry shown');
      // Where the entry would sit with every entry shown, a click never finds it.
      expect(menu.itemAt(r.x + 4, r.y + 4)).not.toBe(hidden);
      expect(menu.isReachable(hidden)).toBe(false);
    }
    menu.command(MENU_COMMAND.Select);
    expect(picked.every((e) => e !== PauseEntry.Settings && e !== PauseEntry.FinishSweep)).toBe(true);
  });

  it('stacks the visible buttons in a dark panel that grows with them and keeps its width', () => {
    const m3 = pausePanelRect(font, 480, HEIGHT, M3_PAUSE_CONDITIONS);
    const all = pausePanelRect(font, 480, HEIGHT, ALL);
    expect(all.w).toBe(m3.w);
    expect(all.h - m3.h).toBe(2 * 21);
    const rects = pauseButtonRects(font, 480, HEIGHT, M3_PAUSE_CONDITIONS).filter((r) => r !== null);
    for (let i = 1; i < rects.length; i++) {
      expect((rects[i]?.y ?? 0) - (rects[i - 1]?.y ?? 0)).toBe(21);
    }
    const layout = pauseMainLayout(font, 480, HEIGHT, M3_PAUSE_CONDITIONS, pauseButtonStates());
    expect(layout[0]).toMatchObject({ kind: 'panel', style: 2 });
  });

  it('draws every quad inside the panel at 432, 480 and 640 px, with Resume focused first', () => {
    for (const width of WIDTHS) {
      for (const conditions of [M3_PAUSE_CONDITIONS, ALL]) {
        const layout = pauseMainLayout(font, width, HEIGHT, conditions, pauseButtonStates());
        const raster = rasterise(layout, width);
        expect(outside(raster, pausePanelRect(font, width, HEIGHT, conditions))).toBe(0);
        const buttons = layout.filter((item) => item.kind === 'button');
        expect(buttons[0]).toMatchObject({ label: 'RESUME', state: ButtonState.Focus });
        expect(buttons.slice(1).every((b) => b.kind === 'button' && b.state === ButtonState.Normal)).toBe(
          true,
        );
      }
    }
  });
});

describe('Controls page', () => {
  it('lists every GDD §6.1 action with keyboard labels on the keyboard and pad labels on the gamepad', () => {
    const keyboard = controlsRows(DEFAULT_GLYPHS, 'keyboard');
    const gamepad = controlsRows(DEFAULT_GLYPHS, 'gamepad');
    for (const [label, key, pad] of GDD_6_1) {
      expect(keyboard).toContainEqual([label, key]);
      expect(gamepad).toContainEqual([label, pad]);
    }
    // Plus the menu actions, and nothing unbound.
    expect(keyboard.slice(GDD_6_1.length)).toEqual([
      ['MENU SELECT', 'Space'],
      ['MENU BACK', 'Esc'],
    ]);
    expect(gamepad.slice(GDD_6_1.length)).toEqual([
      ['MENU SELECT', 'A'],
      ['MENU BACK', 'B'],
    ]);
    expect(CONTROLS_ROWS.map(([action]) => action)).toEqual([...GLYPH_ACTIONS]);
    for (const [, binding] of [...keyboard, ...gamepad]) expect(binding).not.toBe('?');
  });

  it('shows the device, every row and a Back button, in the panel, at 432, 480 and 640 px', () => {
    for (const width of WIDTHS) {
      for (const device of ['keyboard', 'gamepad'] as const) {
        const layout = controlsPageLayout(font, DEFAULT_GLYPHS, device, width, HEIGHT, ButtonState.Focus);
        const strings = uiItemStrings(layout);
        expect(strings[0]).toBe('CONTROLS');
        expect(strings[1]).toBe(device === 'keyboard' ? 'KEYBOARD' : 'GAMEPAD');
        expect(strings.slice(2, -1)).toEqual(controlsRows(DEFAULT_GLYPHS, device).flat());
        expect(strings.at(-1)).toBe('BACK');
        const panel = controlsPanelRect(font, DEFAULT_GLYPHS, width, HEIGHT);
        expect(outside(rasterise(layout, width), panel)).toBe(0);
        // Values are right-aligned against the panel's inner edge, names left-aligned, and never overlap.
        for (const item of layout) {
          if (item.kind !== 'text' || item.y < panel.y + 30) continue;
          const w = font.measure(item.text);
          const x0 = item.align === 2 ? item.x - w : item.x;
          expect(x0).toBeGreaterThanOrEqual(panel.x + 16);
          expect(x0 + w).toBeLessThanOrEqual(panel.x + panel.w - 16 + 1);
        }
      }
    }
  });

  it('keeps one panel size for both devices', () => {
    const a = controlsPanelRect(font, DEFAULT_GLYPHS, 480, HEIGHT);
    expect(a.h).toBeLessThanOrEqual(HEIGHT - 16);
    const keyboard = controlsPageLayout(font, DEFAULT_GLYPHS, 'keyboard', 480, HEIGHT, ButtonState.Focus);
    const gamepad = controlsPageLayout(font, DEFAULT_GLYPHS, 'gamepad', 480, HEIGHT, ButtonState.Focus);
    expect(keyboard[0]).toEqual(gamepad[0]);
  });
});
