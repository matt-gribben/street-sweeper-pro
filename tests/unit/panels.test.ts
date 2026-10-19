// 9-slice panels and button states (SSP-285; ART_BIBLE §12.3; TECHNICAL_DESIGN §12.3, §12.7): the slicing function
// (corners unchanged, edges and centre repeated in 8 px steps with a clipped final repeat, never scaled) for each of
// the three panels at three arbitrary sizes, the button state model (focus emits a → glyph quad, pressed shifts the
// content by (+1, +1)), the placeholder grids' documented colours, UiSpriteBatch.addRegion's instance contract, and
// the per-frame draw path's no-`new` rule (the heap check is panelsHeap.test.ts).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { SCENE_IDS } from '../../src/app/SceneManager.ts';
import { FRAME, type FrameId } from '../../src/gen/assets.ts';
import {
  loadAtlas,
  type RgbaImage,
  type SpriteAtlas,
  TRANSPARENT_INDEX,
} from '../../src/render/spriteAtlas.ts';
import { NO_RECOLOUR, UI_INSTANCE_STRIDE, UiSpriteBatch } from '../../src/render/spriteBatch.ts';
import { panelSampleLayout } from '../../src/scenes/PanelSampleScene.ts';
import type { BitmapFont } from '../../src/ui/bitmapText.ts';
import {
  BUTTON_CURSOR,
  BUTTON_CURSOR_GAP_PX,
  BUTTON_CURSOR_INSET_PX,
  BUTTON_LOOKS,
  BUTTON_NO_RECOLOUR,
  ButtonState,
  buttonWidthFor,
  PANEL_CORNER_PX,
  PANEL_FRAMES,
  PANEL_MIN_PX,
  PANEL_SOURCE_PX,
  type PanelSink,
  PanelStyle,
  Panels,
  panelSlice,
  panelSliceCount,
  SLICE_DST_X,
  SLICE_DST_Y,
  SLICE_H,
  SLICE_SRC_X,
  SLICE_SRC_Y,
  SLICE_STRIDE,
  SLICE_W,
  type UiRect,
} from '../../src/ui/panels.ts';
import { decodePng } from '../support/png.ts';
import { type IndexedAtlas, readBitmapFont, readIndexedAtlas, TextRaster } from '../support/textRaster.ts';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** Palette indices (Kerbside-32) the panels and buttons use. */
const INK = 0;
const TAR = 1;
const ASPHALT_LT = 3;
const SLAB_DK = 4;
const SLAB = 5;
const KERB = 6;
const CHALK = 7;
const HIVIS_ORANGE = 17;
const NAVY = 25;
const COUNCIL_BLUE = 26;

type Region = {
  frame: FrameId;
  sx: number;
  sy: number;
  w: number;
  h: number;
  x: number;
  y: number;
  from: number;
  to: number;
};
type Glyph = { frame: FrameId; x: number; y: number; from: number; to: number };

/** A sink that records every quad. */
class Recorder implements PanelSink {
  readonly regions: Region[] = [];
  readonly glyphs: Glyph[] = [];
  add(frame: FrameId, x: number, y: number, from: number, to: number): void {
    this.glyphs.push({ frame, x, y, from, to });
  }
  addRegion(
    frame: FrameId,
    sx: number,
    sy: number,
    w: number,
    h: number,
    x: number,
    y: number,
    from: number,
    to: number,
  ): void {
    this.regions.push({ frame, sx, sy, w, h, x, y, from, to });
  }
}

const STYLES = [
  ['council', PanelStyle.Council],
  ['paper', PanelStyle.Paper],
  ['dark', PanelStyle.Dark],
] as const;

/** Three arbitrary integer sizes (the issue's), plus an origin per size so positions vary too. */
const SIZES = [
  [24, 24, 3, 5],
  [61, 37, 40, 11],
  [200, 19, 7, 120],
] as const;

let font: BitmapFont;
let uiAtlas: IndexedAtlas;

beforeAll(() => {
  font = readBitmapFont('kerbside5x7');
  uiAtlas = readIndexedAtlas('ui');
});

/** The source coordinate (0..23) a 9-slice panel of `size` shows at offset `p` along one axis. */
function sourceCoord(p: number, size: number): number {
  if (p < PANEL_CORNER_PX) return p;
  if (p >= size - PANEL_CORNER_PX) return PANEL_SOURCE_PX - (size - p);
  return PANEL_CORNER_PX + ((p - PANEL_CORNER_PX) % PANEL_CORNER_PX);
}

/** Palette index of texel (x, y) of a ui-atlas frame. */
function texel(frame: FrameId, x: number, y: number): number {
  const f = FRAME[frame];
  return uiAtlas.indices[(f.y + y) * uiAtlas.width + f.x + x] ?? -2;
}

describe('slicing (acceptance: each panel at 3 sizes, corners unchanged, 8 px repeats, clipped last, no scale)', () => {
  for (const [name, style] of STYLES) {
    for (const [w, h, x0, y0] of SIZES) {
      it(`ui.panel_${name} at ${w}x${h}`, () => {
        const rec = new Recorder();
        new Panels(rec, font).drawPanel(style, x0, y0, w, h);
        const quads = rec.regions;
        expect(rec.glyphs).toEqual([]);
        const cols = 2 + Math.ceil((w - 16) / 8);
        const rows = 2 + Math.ceil((h - 16) / 8);
        expect(quads).toHaveLength(cols * rows);
        expect(panelSliceCount(w, h)).toBe(cols * rows);

        for (const q of quads) {
          // Every quad is the panel's frame, as authored (no recolour), whole pixels, a region inside the 24×24
          // source: the quad's size IS the region's size, so no texel is ever scaled.
          expect(q.frame).toBe(PANEL_FRAMES[style]);
          expect(FRAME[q.frame].atlas).toBe('ui');
          expect([q.from, q.to]).toEqual([NO_RECOLOUR, 0]);
          for (const v of [q.sx, q.sy, q.w, q.h, q.x, q.y]) expect(Number.isInteger(v)).toBe(true);
          expect(q.w).toBeGreaterThanOrEqual(1);
          expect(q.w).toBeLessThanOrEqual(PANEL_CORNER_PX);
          expect(q.h).toBeGreaterThanOrEqual(1);
          expect(q.h).toBeLessThanOrEqual(PANEL_CORNER_PX);
          expect(q.sx + q.w).toBeLessThanOrEqual(PANEL_SOURCE_PX);
          expect(q.sy + q.h).toBeLessThanOrEqual(PANEL_SOURCE_PX);
        }

        // The four corners: the source corners, full 8×8, at the panel's corners.
        const at = (x: number, y: number): Region | undefined => quads.find((q) => q.x === x && q.y === y);
        const corners: [number, number, number, number][] = [
          [x0, y0, 0, 0],
          [x0 + w - 8, y0, 16, 0],
          [x0, y0 + h - 8, 0, 16],
          [x0 + w - 8, y0 + h - 8, 16, 16],
        ];
        for (const [x, y, sx, sy] of corners) {
          expect(at(x, y)).toMatchObject({ sx, sy, w: 8, h: 8 });
        }

        // Columns: one set of x positions and widths shared by every row. The first and last are the corners; the
        // ones between repeat the middle cell (source x 8) in 8 px steps from x0 + 8, all 8 wide except the last,
        // which is clipped to what is left of w − 16.
        const firstRow = quads.slice(0, cols);
        expect(firstRow.map((q) => q.y)).toEqual(Array(cols).fill(y0));
        const middle = firstRow.slice(1, -1);
        expect(middle.map((q) => q.sx)).toEqual(Array(middle.length).fill(8));
        expect(middle.map((q) => q.x - x0)).toEqual(middle.map((_, k) => 8 + 8 * k));
        const lastW = w - 16 - 8 * (middle.length - 1);
        expect(middle.map((q) => q.w)).toEqual(middle.map((_, k) => (k < middle.length - 1 ? 8 : lastW)));
        expect(middle.reduce((sum, q) => sum + q.w, 0)).toBe(w - 16);
        // Rows likewise, read down the first column.
        const firstCol = quads.filter((_, i) => i % cols === 0);
        const midRows = firstCol.slice(1, -1);
        expect(midRows.map((q) => q.sy)).toEqual(Array(midRows.length).fill(8));
        expect(midRows.map((q) => q.y - y0)).toEqual(midRows.map((_, k) => 8 + 8 * k));
        expect(midRows.reduce((sum, q) => sum + q.h, 0)).toBe(h - 16);

        // The sizes include a clipped final repeat on some axis (61 → 45 = 5×8 + 5, 37 → 21 = 2×8 + 5,
        // 19 → 3), and the 24×24 one has exactly one full repeat per axis.
        if (w === 24) expect([cols, rows]).toEqual([3, 3]);
        else expect(lastW < 8 || h - 16 - 8 * (midRows.length - 1) < 8).toBe(true);

        // Every panel pixel is covered exactly once, and shows the source texel the 9-slice rule says.
        const raster = new TextRaster(x0 + w + 2, y0 + h + 2, uiAtlas);
        const cover = new Int32Array(raster.width * raster.height);
        for (const q of quads) {
          raster.addRegion(q.frame, q.sx, q.sy, q.w, q.h, q.x, q.y, q.from, q.to);
          for (let y = q.y; y < q.y + q.h; y++) {
            for (let x = q.x; x < q.x + q.w; x++) {
              const i = y * raster.width + x;
              cover[i] = (cover[i] ?? 0) + 1;
            }
          }
        }
        let bad = 0;
        for (let y = 0; y < raster.height; y++) {
          for (let x = 0; x < raster.width; x++) {
            const inside = x >= x0 && x < x0 + w && y >= y0 && y < y0 + h;
            if ((cover[y * raster.width + x] ?? 0) !== (inside ? 1 : 0)) bad++;
            if (!inside) continue;
            const want = texel(
              PANEL_FRAMES[style] ?? 'ui.panel_council:panel:-:0',
              sourceCoord(x - x0, w),
              sourceCoord(y - y0, h),
            );
            if (raster.at(x, y) !== (want === TRANSPARENT_INDEX ? -1 : want)) bad++;
          }
        }
        expect(bad).toBe(0);
      });
    }
  }

  it('panelSlice computes each slice from (w, h, i) alone, at any offset into the output', () => {
    const out = new Int32Array(SLICE_STRIDE * 2);
    // 61×37: 8 columns (corner, 6 repeats, the last 5 px wide, corner) and 5 rows (corner, 3 repeats, the last 5 px
    // tall, corner).
    panelSlice(61, 37, 0, out);
    expect([...out.subarray(0, SLICE_STRIDE)]).toEqual([0, 0, 8, 8, 0, 0]);
    panelSlice(61, 37, 6, out, SLICE_STRIDE); // row 0, column 6: the clipped last repeat of the top edge
    expect(out[SLICE_STRIDE + SLICE_SRC_X]).toBe(8);
    expect(out[SLICE_STRIDE + SLICE_SRC_Y]).toBe(0);
    expect(out[SLICE_STRIDE + SLICE_W]).toBe(5);
    expect(out[SLICE_STRIDE + SLICE_H]).toBe(8);
    expect(out[SLICE_STRIDE + SLICE_DST_X]).toBe(48);
    expect(out[SLICE_STRIDE + SLICE_DST_Y]).toBe(0);
    panelSlice(61, 37, 8 * 5 - 1, out); // the bottom-right corner
    expect([...out.subarray(0, SLICE_STRIDE)]).toEqual([16, 16, 8, 8, 53, 29]);
    panelSlice(61, 37, 8 * 3 + 3, out); // row 3 (the clipped last centre row), column 3
    expect([...out.subarray(0, SLICE_STRIDE)]).toEqual([8, 8, 8, 5, 24, 24]);
  });

  it('the minimum 16×16 panel is the four corners; smaller or fractional sizes throw', () => {
    expect(panelSliceCount(PANEL_MIN_PX, PANEL_MIN_PX)).toBe(4);
    expect(panelSliceCount(17, 16)).toBe(6);
    expect(panelSliceCount(640, 270)).toBe(80 * 34);
    const panels = new Panels(new Recorder(), font);
    expect(() => panels.drawPanel(PanelStyle.Council, 0, 0, 15, 40)).toThrow(/at least 16/);
    expect(() => panels.drawPanel(PanelStyle.Paper, 0, 0, 40, 16.5)).toThrow(/whole pixels/);
    expect(() => panels.drawPanel(PanelStyle.Dark, 0.5, 0, 40, 40)).toThrow(/whole internal pixels/);
    expect(() => panels.drawPanel(7 as PanelStyle, 0, 0, 40, 40)).toThrow(/panel style/);
  });
});

describe('button state model (ART_BIBLE §12.3)', () => {
  const rect: UiRect = { x: 50, y: 30, w: 80, h: 16 };
  const arrowFrame = glyphFrame('→');

  function glyphFrame(char: string): FrameId {
    const g = readBitmapFont('kerbside5x7').metrics.plain.glyphs.get(char);
    if (g?.frame == null) throw new Error(`no glyph ${char}`);
    return g.frame;
  }

  function draw(state: ButtonState, label = 'RESUME', r: UiRect = rect): Recorder {
    const rec = new Recorder();
    new Panels(rec, font).drawButton(state, r, label);
    return rec;
  }

  it('the four looks: council panel recoloured per state, label colours, cursor only on focus and press', () => {
    expect(BUTTON_NO_RECOLOUR).toBe(NO_RECOLOUR);
    expect(BUTTON_LOOKS).toHaveLength(4);
    expect(BUTTON_LOOKS[ButtonState.Normal]).toMatchObject({
      recolourFrom: NO_RECOLOUR,
      labelColour: CHALK,
      cursor: false,
      contentShiftPx: 0,
    });
    expect(BUTTON_LOOKS[ButtonState.Focus]).toMatchObject({
      recolourFrom: CHALK,
      recolourTo: HIVIS_ORANGE,
      labelColour: CHALK,
      cursor: true,
      contentShiftPx: 0,
    });
    expect(BUTTON_LOOKS[ButtonState.Pressed]).toMatchObject({
      recolourFrom: COUNCIL_BLUE,
      recolourTo: NAVY,
      labelColour: CHALK,
      cursor: true,
      contentShiftPx: 1,
    });
    expect(BUTTON_LOOKS[ButtonState.Disabled]).toMatchObject({
      recolourFrom: COUNCIL_BLUE,
      recolourTo: ASPHALT_LT,
      labelColour: SLAB_DK,
      cursor: false,
      contentShiftPx: 0,
    });
    for (const state of Object.values(ButtonState)) {
      const rec = draw(state);
      const look = BUTTON_LOOKS[state];
      expect(rec.regions).toHaveLength(panelSliceCount(rect.w, rect.h));
      for (const q of rec.regions) {
        expect(q.frame).toBe('ui.panel_council:panel:-:0');
        expect([q.from, q.to]).toEqual([look?.recolourFrom, look?.recolourTo]);
      }
    }
  });

  it('focus emits a → glyph quad (acceptance); normal and disabled do not', () => {
    const arrows = (rec: Recorder) => rec.glyphs.filter((g) => g.frame === arrowFrame);
    expect(BUTTON_CURSOR).toBe('→');
    const focus = arrows(draw(ButtonState.Focus));
    expect(focus).toHaveLength(1);
    expect(focus[0]).toMatchObject({ x: rect.x + BUTTON_CURSOR_INSET_PX, y: rect.y + 4, to: HIVIS_ORANGE });
    expect(arrows(draw(ButtonState.Normal))).toEqual([]);
    expect(arrows(draw(ButtonState.Disabled))).toEqual([]);
    expect(arrows(draw(ButtonState.Pressed))).toHaveLength(1);
  });

  it('pressed offsets the content by (+1, +1) (acceptance); the panel itself stays put', () => {
    const focus = draw(ButtonState.Focus);
    const pressed = draw(ButtonState.Pressed);
    expect(pressed.glyphs).toHaveLength(focus.glyphs.length);
    expect(pressed.glyphs.map((g) => [g.frame, g.x - 1, g.y - 1])).toEqual(
      focus.glyphs.map((g) => [g.frame, g.x, g.y]),
    );
    // Normal draws the same label at the same place as focus.
    const normal = draw(ButtonState.Normal);
    expect(normal.glyphs.map((g) => [g.frame, g.x, g.y])).toEqual(
      focus.glyphs.slice(1).map((g) => [g.frame, g.x, g.y]),
    );
    expect(pressed.regions.map((q) => [q.x, q.y, q.w, q.h])).toEqual(
      normal.regions.map((q) => [q.x, q.y, q.w, q.h]),
    );
  });

  it('the label is centred on its ink and on the cap height, in the state colour', () => {
    const label = 'RESUME';
    const inkW = font.measure(label) - 1;
    for (const state of Object.values(ButtonState)) {
      const rec = draw(state, label, { x: 10, y: 20, w: 91, h: 21 });
      const glyphs = rec.glyphs.filter((g) => g.frame !== arrowFrame);
      const shift = BUTTON_LOOKS[state]?.contentShiftPx ?? 0;
      expect(glyphs[0]?.x).toBe(10 + Math.floor((91 - inkW) / 2) + shift);
      expect(glyphs.every((g) => g.y === 20 + Math.floor((21 - 7) / 2) + shift)).toBe(true);
      expect(glyphs.every((g) => g.to === BUTTON_LOOKS[state]?.labelColour)).toBe(true);
    }
  });

  it('buttonWidthFor leaves the label clear of the cursor slot on both sides', () => {
    for (const label of ['OK', 'RESUME', 'SETTINGS', 'DISABLED', '']) {
      const w = buttonWidthFor(font, label);
      expect(w).toBeGreaterThanOrEqual(PANEL_MIN_PX);
      const rec = draw(ButtonState.Focus, label, { x: 0, y: 0, w, h: 16 });
      const [arrow, ...glyphs] = rec.glyphs;
      if (glyphs.length === 0) continue;
      const cursorRight = (arrow?.x ?? 0) + font.metrics.glyph.w;
      expect(glyphs[0]?.x ?? 0).toBeGreaterThanOrEqual(cursorRight + BUTTON_CURSOR_GAP_PX);
      const inkRight = (glyphs[0]?.x ?? 0) + font.measure(label) - 1;
      expect(w - inkRight).toBeGreaterThanOrEqual(cursorRight + BUTTON_CURSOR_GAP_PX);
    }
  });

  it('rejects an unknown state and a rect below 16×16', () => {
    const panels = new Panels(new Recorder(), font);
    expect(() => panels.drawButton(9 as ButtonState, rect, 'X')).toThrow(/button state/);
    expect(() => panels.drawButton(ButtonState.Normal, { x: 0, y: 0, w: 40, h: 12 }, 'X')).toThrow(
      /at least 16/,
    );
  });

  it('draws pixel-exact: focus turns the 07 inner border 17, pressed fills 25, disabled fills 03 with 04 text', () => {
    const r: UiRect = { x: 2, y: 2, w: 60, h: 16 };
    const paint = (state: ButtonState): TextRaster => {
      const raster = new TextRaster(64, 20, uiAtlas);
      new Panels(raster, font).drawButton(state, r, 'GO');
      return raster;
    };
    const normal = paint(ButtonState.Normal);
    expect([normal.at(2 + 1, 2 + 8), normal.at(2 + 30, 2 + 1), normal.at(2 + 10, 2 + 2)]).toEqual([
      CHALK,
      CHALK,
      COUNCIL_BLUE,
    ]);
    expect(normal.at(2, 2)).toBe(-1); // the cut corner
    expect(normal.at(3, 2)).toBe(INK);
    const focus = paint(ButtonState.Focus);
    expect([focus.at(2 + 1, 2 + 8), focus.at(2 + 30, 2 + 1), focus.at(2 + 10, 2 + 2)]).toEqual([
      HIVIS_ORANGE,
      HIVIS_ORANGE,
      COUNCIL_BLUE,
    ]);
    const pressed = paint(ButtonState.Pressed);
    expect([pressed.at(2 + 1, 2 + 8), pressed.at(2 + 10, 2 + 2)]).toEqual([CHALK, NAVY]);
    const disabled = paint(ButtonState.Disabled);
    expect([disabled.at(2 + 1, 2 + 8), disabled.at(2 + 10, 2 + 2)]).toEqual([CHALK, ASPHALT_LT]);
    const colours = (raster: TextRaster) => new Set(raster.index);
    expect(colours(disabled).has(SLAB_DK)).toBe(true);
    expect(colours(normal).has(SLAB_DK)).toBe(false);
    expect(colours(focus).has(HIVIS_ORANGE)).toBe(true);
  });
});

describe('placeholder grids (ART_BIBLE §12.3 colours, seamless repeat cells)', () => {
  const COLOURS: Record<string, number[]> = {
    council: [INK, SLAB, CHALK, COUNCIL_BLUE],
    paper: [INK, KERB, CHALK],
    dark: [TAR, ASPHALT_LT],
  };

  for (const [name, style] of STYLES) {
    it(`ui.panel_${name} is 24×24 in the ui atlas, uses only its documented colours and repeats seamlessly`, () => {
      const frame = PANEL_FRAMES[style] ?? 'ui.panel_council:panel:-:0';
      expect(frame).toBe(`ui.panel_${name}:panel:-:0`);
      expect([FRAME[frame].atlas, FRAME[frame].w, FRAME[frame].h]).toEqual(['ui', 24, 24]);
      const used = new Set<number>();
      for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) used.add(texel(frame, x, y));
      used.delete(TRANSPARENT_INDEX);
      expect([...used].sort((a, b) => a - b)).toEqual(COLOURS[name]);
      // The repeated cells (8..15) are constant along the repeat, so 8 px steps (and clipped ones) join seamlessly.
      for (let a = 0; a < 24; a++) {
        for (let b = 8; b < 16; b++) {
          expect(texel(frame, b, a)).toBe(texel(frame, 8, a));
          expect(texel(frame, a, b)).toBe(texel(frame, a, 8));
        }
      }
    });
  }

  it('the manifest marks all three as placeholders (SSP-144 replaces them)', () => {
    const manifest = JSON.parse(readFileSync(`${REPO_ROOT}assets-src/manifest.json`, 'utf8')) as {
      assets: { id: string; placeholder?: boolean; atlas: string }[];
    };
    for (const [name] of STYLES) {
      expect(manifest.assets.find((a) => a.id === `ui.panel_${name}`)).toMatchObject({
        placeholder: true,
        atlas: 'ui',
      });
    }
  });
});

describe('UiSpriteBatch.addRegion (the sub-rect UV quad)', () => {
  let atlas: SpriteAtlas;
  beforeAll(async () => {
    atlas = await loadAtlas('ui', {
      fetchJson: async (url: string): Promise<unknown> =>
        JSON.parse(readFileSync(`${REPO_ROOT}public${url}`, 'utf8')),
      fetchImage: async (url: string): Promise<RgbaImage> =>
        decodePng(readFileSync(`${REPO_ROOT}public${url}`)),
    });
  });

  it('writes the region as the frame rect, at its own size, with pivot (0, 0)', () => {
    const batch = new UiSpriteBatch(atlas, 4);
    const frame: FrameId = 'ui.panel_paper:panel:-:0';
    const f = FRAME[frame];
    batch.begin();
    batch.addRegion(frame, 8, 16, 5, 8, 100, 37, CHALK, HIVIS_ORANGE);
    batch.end();
    expect(batch.count).toBe(1);
    expect([...batch.instanceData.subarray(0, UI_INSTANCE_STRIDE)]).toEqual([
      100,
      37,
      f.x + 8,
      f.y + 16,
      5,
      8,
      0,
      0,
      CHALK,
      HIVIS_ORANGE,
    ]);
    expect(batch.mesh.count).toBe(1);
    batch.dispose();
  });

  it('refuses regions outside the frame, fractional values, other atlases and a full batch', () => {
    const batch = new UiSpriteBatch(atlas, 1);
    const frame: FrameId = 'ui.panel_dark:panel:-:0';
    batch.begin();
    expect(() => batch.addRegion(frame, 20, 0, 8, 8, 0, 0)).toThrow(/inside/);
    expect(() => batch.addRegion(frame, 0, 0, 0, 8, 0, 0)).toThrow(/inside/);
    expect(() => batch.addRegion(frame, 0, 0, 2.5, 8, 0, 0)).toThrow(/inside/);
    expect(() => batch.addRegion(frame, -1, 0, 8, 8, 0, 0)).toThrow(/inside/);
    expect(() => batch.addRegion(frame, 0, 0, 8, 8, 0.5, 0)).toThrow(/whole internal pixels/);
    expect(() => batch.addRegion(frame, 0, 0, 8, 8, 0, 0, 40, 0)).toThrow(/palette index/);
    expect(() => batch.addRegion('litter.banana_skin:idle:h00:0', 0, 0, 8, 8, 0, 0)).toThrow(/atlas/);
    batch.addRegion(frame, 0, 0, 8, 8, 0, 0);
    expect(() => batch.addRegion(frame, 0, 0, 8, 8, 0, 0)).toThrow(/full/);
    batch.dispose();
  });
});

describe('panel_sample scene layout (the e2e evidence scene)', () => {
  it('is a registered scene and fits W = 432 and the 270 rows at whole pixels', () => {
    expect(SCENE_IDS).toContain('panel_sample');
    const items = panelSampleLayout(font);
    const states = new Set<number>();
    const styles = new Set<number>();
    for (const item of items) {
      const r = item.kind === 'button' ? item.rect : item.kind === 'panel' ? item : null;
      if (item.kind === 'button') states.add(item.state);
      if (item.kind === 'panel') styles.add(item.style);
      if (r === null) continue;
      for (const v of [r.x, r.y, r.w, r.h]) expect(Number.isInteger(v)).toBe(true);
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w).toBeLessThanOrEqual(432);
      expect(r.y + r.h).toBeLessThanOrEqual(270);
    }
    expect([...states].sort()).toEqual([0, 1, 2, 3]);
    expect([...styles].sort()).toEqual([0, 1, 2]);
  });
});

describe('per-frame draw path source (acceptance: no `new` or array literals)', () => {
  const NEW_RE = /\bnew\s+[A-Za-z_$]/;
  const ARRAY_LITERAL_RE = /(?:[=(,]|\breturn)\s*\[/;

  it('src/ui/panels.ts', () => {
    const source = readFileSync(`${REPO_ROOT}src/ui/panels.ts`, 'utf8');
    const parts = source.split('// per-frame draw path: begin').slice(1);
    expect(parts.length, 'marked regions (the slicing functions and the Panels draw methods)').toBe(2);
    for (const part of parts) {
      const end = part.indexOf('// per-frame draw path: end');
      expect(end).toBeGreaterThan(0);
      const lines = part
        .slice(0, end)
        .split('\n')
        .filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//'));
      expect(lines.filter((l) => NEW_RE.test(l))).toEqual([]);
      expect(lines.filter((l) => ARRAY_LITERAL_RE.test(l))).toEqual([]);
    }
  });
});
