// 9-slice panels and button states (ART_BIBLE §12.3; TECHNICAL_DESIGN §12.3, §12.7; SSP-285): draws the `ui.panel_*`
// frames of the `ui` atlas at any whole-pixel size ≥ 16×16, and the four button states, as quads of the UI pass
// (render/spriteBatch.ts UiSpriteBatch, the one instanced UI draw, which writes mask (0, 1)).
//
// Slicing. A panel source is 24×24 with 8 px corners, so it is a 3×3 grid of 8×8 cells. A w × h panel is a grid of
// `cols × rows` slices, cols = 2 + ceil((w − 16) / 8) and rows = 2 + ceil((h − 16) / 8):
//   - the first and last column (row) are the source's left and right (top and bottom) cells, drawn unchanged at
//     the panel's edges, so the four corners are always the source corners;
//   - every column (row) between them is the source's middle cell, REPEATED in 8 px steps from x = 8 (y = 8); the
//     last repeat is clipped to what is left (1..8 px) by drawing a sub-rectangle of the cell from its top-left
//     (UiSpriteBatch.addRegion: the quad is the region's own size, so the clip is a sub-rect UV, never a scale).
// Nothing is ever stretched: every quad draws its texels 1:1 (GDD §15.2, no non-integer scale). panelSlice()
// computes slice i directly from (w, h, i), so drawing needs no slice buffer.
//
// Buttons (ART_BIBLE §12.3) are `ui.panel_council` drawn with one recolour pair, plus a centred Kerbside 5×7 label:
//   Normal    the council panel as authored (26 fill, 07 inner border), label 07;
//   Focus     07 → 17: the inner border turns hi-vis, plus a `→` cursor glyph (17) at the left, so focus never
//             relies on colour alone;
//   Pressed   26 → 25: navy fill; the content (label and cursor) shifts 1 px down-right. A press only happens on
//             the focused button, so the cursor stays (it would otherwise blink off for the frames of the press);
//   Disabled  26 → 03: asphalt fill, label 04.
// The label is centred on its ink (the plain advance's trailing 1 px gap excluded) and vertically on the 7 px cap
// height. buttonWidthFor() gives the narrowest button whose centred label clears the cursor slot on both sides.
//
// Speech bubbles (AUDIO_DESIGN §13.2, GDD §15.2 "diegesis where cheap"; SSP-288): an ink (00) panel with a 1 px chalk
// (07) outline whose four corner pixels are cut, and a 3-row tail under its bottom edge pointing down at the source:
//   bottom edge   07 07 00 00 00 07 07     the outline opens over the tail (tx − 1 .. tx + 1 in ink)
//   tail row 1          07 00 07
//   tail row 2             07               the tip, at (tx, bottom + 2)
// They are not 9-slice: a 9-slice panel is at least 16 px tall, and a one-line bubble is 11 (1 px outline, 1 px pad,
// the 7 px line, 1 px pad, 1 px outline). They are drawn from sub-rectangles of the solid `ui.bar_fill` frame
// recoloured 07 → the wanted index (the HUD's bars do the same), so they cost quads, never atlas space, and stay in
// the one UI draw. Placeholder look until SSP-156 (M4).
//
// Per frame nothing allocates: slices are computed into a preallocated Int32Array, button looks are a table built at
// load, and text goes through BitmapFont.draw (allocation-free). The section between the "per-frame draw path"
// markers is scanned by tests/unit/panels.test.ts for `new` and array literals.
//
// Module rules (TECHNICAL_DESIGN §2.1): src/ui imports the generated frame table, other src/ui modules and
// render/spriteBatch.ts only; the sink is a structural interface that UiSpriteBatch satisfies.
import type { FrameId } from '../gen/assets.ts';
import { type BitmapFont, type GlyphSink, TextVariant } from './bitmapText.ts';

/** The three panel styles (ART_BIBLE §12.3). */
export const PanelStyle = { Council: 0, Paper: 1, Dark: 2 } as const;
export type PanelStyle = (typeof PanelStyle)[keyof typeof PanelStyle];

/** Each style's 24×24 source frame in the `ui` atlas, indexed by PanelStyle. */
export const PANEL_FRAMES: readonly FrameId[] = Object.freeze([
  'ui.panel_council:panel:-:0',
  'ui.panel_paper:panel:-:0',
  'ui.panel_dark:panel:-:0',
] satisfies FrameId[]);

/** Side of a panel source in pixels. */
export const PANEL_SOURCE_PX = 24;
/** Side of a corner, and the repeat step of the edges and the centre. */
export const PANEL_CORNER_PX = 8;
/** Smallest panel side: two corners. */
export const PANEL_MIN_PX = 2 * PANEL_CORNER_PX;

/** Ints per slice written by panelSlice(): source x, y, width, height, then the destination x, y in the panel. */
export const SLICE_STRIDE = 6;
export const SLICE_SRC_X = 0;
export const SLICE_SRC_Y = 1;
export const SLICE_W = 2;
export const SLICE_H = 3;
export const SLICE_DST_X = 4;
export const SLICE_DST_Y = 5;

/** The solid frame bubbles are cut from (ui.bar_fill, 66×8 of 07), and its ink. */
export const SOLID_FRAME: FrameId = 'ui.bar_fill:bar:-:0';
const SOLID_FRAME_W_PX = 66;
const SOLID_FRAME_H_PX = 8;
const SOLID_FRAME_INK = 7;

/** Speech-bubble colours (AUDIO_DESIGN §13.2): chalk text and outline on an ink panel. */
export const BUBBLE_FILL = 0;
export const BUBBLE_OUTLINE = 7;
export const BUBBLE_TEXT = 7;
/** Pixels between the outline and the text's ink: left/right and top/bottom. */
export const BUBBLE_PAD_X_PX = 2;
export const BUBBLE_PAD_Y_PX = 1;
/** Rows of tail below the panel's bottom edge; the tip is the last. */
export const BUBBLE_TAIL_PX = 2;
/** The tail's half width where it meets the panel (it opens tx − 1 .. tx + 1). */
export const BUBBLE_TAIL_HALF_PX = 1;
/** The tail's centre keeps this far from the panel's sides (clear of the cut corners and the outline). */
export const BUBBLE_TAIL_INSET_PX = 3;
/** The narrowest bubble: the tail and its insets on both sides. */
export const BUBBLE_MIN_W_PX = 2 * BUBBLE_TAIL_INSET_PX + 1;

/** The four button states (ART_BIBLE §12.3). */
export const ButtonState = { Normal: 0, Focus: 1, Pressed: 2, Disabled: 3 } as const;
export type ButtonState = (typeof ButtonState)[keyof typeof ButtonState];

/** How a button state draws: the council panel's one recolour pair, the label colour, the cursor and the shift. */
export type ButtonLook = {
  /** Panel texels of palette index `recolourFrom` draw as `recolourTo` (NO_RECOLOUR: as authored). */
  readonly recolourFrom: number;
  readonly recolourTo: number;
  /** Palette index of the label. */
  readonly labelColour: number;
  /** Whether the `→` cursor glyph is drawn, and its palette index. */
  readonly cursor: boolean;
  readonly cursorColour: number;
  /** Pixels the content (label and cursor) moves right and down. */
  readonly contentShiftPx: number;
};

/** `recolourFrom` meaning "no recolour" (mirrors NO_RECOLOUR in render/spriteBatch.ts; no palette index is 255). */
export const BUTTON_NO_RECOLOUR = 255;

/** Palette indices the button looks use (Kerbside-32). */
const ASPHALT_LT = 3;
const SLAB_DK = 4;
const CHALK = 7;
const HIVIS_ORANGE = 17;
const NAVY = 25;
const COUNCIL_BLUE = 26;

/** The look of each ButtonState, indexed by state (ART_BIBLE §12.3). */
export const BUTTON_LOOKS: readonly ButtonLook[] = Object.freeze([
  Object.freeze({
    recolourFrom: BUTTON_NO_RECOLOUR,
    recolourTo: 0,
    labelColour: CHALK,
    cursor: false,
    cursorColour: HIVIS_ORANGE,
    contentShiftPx: 0,
  }),
  Object.freeze({
    recolourFrom: CHALK,
    recolourTo: HIVIS_ORANGE,
    labelColour: CHALK,
    cursor: true,
    cursorColour: HIVIS_ORANGE,
    contentShiftPx: 0,
  }),
  Object.freeze({
    recolourFrom: COUNCIL_BLUE,
    recolourTo: NAVY,
    labelColour: CHALK,
    cursor: true,
    cursorColour: HIVIS_ORANGE,
    contentShiftPx: 1,
  }),
  Object.freeze({
    recolourFrom: COUNCIL_BLUE,
    recolourTo: ASPHALT_LT,
    labelColour: SLAB_DK,
    cursor: false,
    cursorColour: HIVIS_ORANGE,
    contentShiftPx: 0,
  }),
]);

/** The panel every button is drawn with. */
export const BUTTON_PANEL: PanelStyle = PanelStyle.Council;

/** The cursor glyph. */
export const BUTTON_CURSOR = '→';
/** x of the cursor's ink from the button's left edge: past the 2 px border and clear of the 05 corner bolts. */
export const BUTTON_CURSOR_INSET_PX = 6;
/** Gap between the cursor's ink and the label's ink. */
export const BUTTON_CURSOR_GAP_PX = 2;

/** A whole-pixel rectangle in internal pixels (x right, y down from the frame's top-left). */
export type UiRect = { readonly x: number; readonly y: number; readonly w: number; readonly h: number };

/** Where panel quads go: UiSpriteBatch (render/spriteBatch.ts), or a recorder or CPU rasteriser in tests. */
export interface PanelSink extends GlyphSink {
  addRegion(
    frame: FrameId,
    srcXPx: number,
    srcYPx: number,
    wPx: number,
    hPx: number,
    xPx: number,
    yPx: number,
    recolourFrom: number,
    recolourTo: number,
  ): void;
}

/** Width of the bubble that holds one line of `inkPx` px of text: the ink, the pads and the outline. */
export function bubbleWidthFor(inkPx: number): number {
  const w = inkPx + 2 * (BUBBLE_PAD_X_PX + 1);
  return w < BUBBLE_MIN_W_PX ? BUBBLE_MIN_W_PX : w;
}

/** Height of a bubble holding one line of a font `glyphHPx` tall (11 for Kerbside 5×7); the tail is extra. */
export function bubbleHeightFor(glyphHPx: number): number {
  return glyphHPx + 2 * (BUBBLE_PAD_Y_PX + 1);
}

/** Slices along one axis of a panel `sizePx` long: two corners plus ceil((size − 16) / 8) repeats. */
export function panelSlicesAlong(sizePx: number): number {
  return 2 + Math.ceil((sizePx - PANEL_MIN_PX) / PANEL_CORNER_PX);
}

/** True when `sizePx` is a whole number of pixels, at least PANEL_MIN_PX. */
export function isPanelSize(sizePx: number): boolean {
  return Number.isInteger(sizePx) && sizePx >= PANEL_MIN_PX;
}

/** Number of slices (quads) of a w × h panel. Throws for a size below 16 or not whole pixels. */
export function panelSliceCount(wPx: number, hPx: number): number {
  if (!isPanelSize(wPx) || !isPanelSize(hPx)) rejectPanelSize(wPx, hPx);
  return panelSlicesAlong(wPx) * panelSlicesAlong(hPx);
}

/** Smallest button width whose centred `label` clears the cursor slot on both sides (at least 16). */
export function buttonWidthFor(font: BitmapFont, label: string): number {
  const pad = BUTTON_CURSOR_INSET_PX + font.metrics.glyph.w + BUTTON_CURSOR_GAP_PX;
  return Math.max(PANEL_MIN_PX, labelInkWidth(font, label) + 2 * pad);
}

/** Ink width of a plain one-line label: its advance sum minus the trailing letter gap (0 for an empty label). */
function labelInkWidth(font: BitmapFont, label: string): number {
  const width = font.measure(label, TextVariant.Plain);
  return width > 0 ? width - 1 : 0;
}

// per-frame draw path: begin
/**
 * Slice `i` (0 ≤ i < panelSliceCount(w, h), row-major from the top-left) of a w × h panel, written to
 * out[o .. o + SLICE_STRIDE): its source rectangle in the 24×24 frame and its destination offset in the panel.
 * Corners copy the source corners; edge and centre slices repeat the middle cell in 8 px steps, the last one clipped.
 * Sizes are assumed valid (panelSliceCount checks them). Allocates nothing.
 */
export function panelSlice(wPx: number, hPx: number, i: number, out: Int32Array, o = 0): void {
  const cols = panelSlicesAlong(wPx);
  const rows = panelSlicesAlong(hPx);
  const col = i % cols;
  const row = (i - col) / cols;
  sliceAxis(wPx, col, cols, out, o + SLICE_SRC_X, o + SLICE_W, o + SLICE_DST_X);
  sliceAxis(hPx, row, rows, out, o + SLICE_SRC_Y, o + SLICE_H, o + SLICE_DST_Y);
}

/** One axis of panelSlice: source start, length and destination offset of slice `k` of `count`. */
function sliceAxis(
  sizePx: number,
  k: number,
  count: number,
  out: Int32Array,
  srcAt: number,
  lenAt: number,
  dstAt: number,
): void {
  if (k === 0) {
    out[srcAt] = 0;
    out[lenAt] = PANEL_CORNER_PX;
    out[dstAt] = 0;
  } else if (k === count - 1) {
    out[srcAt] = PANEL_SOURCE_PX - PANEL_CORNER_PX;
    out[lenAt] = PANEL_CORNER_PX;
    out[dstAt] = sizePx - PANEL_CORNER_PX;
  } else {
    const dst = PANEL_CORNER_PX * k;
    out[srcAt] = PANEL_CORNER_PX;
    out[lenAt] = Math.min(PANEL_CORNER_PX, sizePx - PANEL_CORNER_PX - dst);
    out[dstAt] = dst;
  }
}

// per-frame draw path: end

/** Draws panels and buttons into one sink (the UI batch) with one font for button labels. */
export class Panels {
  readonly sink: PanelSink;
  readonly font: BitmapFont;
  /** One slice: the scratch panelSlice() writes into (allocated once, here). */
  private readonly slice = new Int32Array(SLICE_STRIDE);

  constructor(sink: PanelSink, font: BitmapFont) {
    this.sink = sink;
    this.font = font;
  }

  // per-frame draw path: begin
  /**
   * Draws a `style` panel w × h with its top-left at (x, y), whole internal pixels; w and h are at least 16. Throws
   * for anything else. Allocates nothing.
   */
  drawPanel(style: PanelStyle, xPx: number, yPx: number, wPx: number, hPx: number): void {
    this.slicedPanel(style, xPx, yPx, wPx, hPx, BUTTON_NO_RECOLOUR, 0);
  }

  /**
   * Draws a button in `state` filling `rect` (whole pixels, at least 16×16), with `label` centred in Kerbside 5×7
   * (ART_BIBLE §12.3 looks; the file header has the details). Allocates nothing.
   */
  drawButton(state: ButtonState, rect: UiRect, label: string): void {
    const look = BUTTON_LOOKS[state] ?? rejectButtonState(state);
    const x = rect.x;
    const y = rect.y;
    const w = rect.w;
    const h = rect.h;
    this.slicedPanel(BUTTON_PANEL, x, y, w, h, look.recolourFrom, look.recolourTo);
    const font = this.font;
    const shift = look.contentShiftPx;
    const textY = y + ((h - font.metrics.glyph.h) >> 1) + shift;
    const labelX = x + ((w - labelInkWidth(font, label)) >> 1) + shift;
    if (look.cursor) {
      font.draw(this.sink, BUTTON_CURSOR, x + BUTTON_CURSOR_INSET_PX + shift, textY, look.cursorColour);
    }
    font.draw(this.sink, label, labelX, textY, look.labelColour);
  }

  /**
   * Draws a speech bubble's panel w × h with its top-left at (x, y) and its tail under the bottom edge centred on
   * column `tailX`, so the tip is at (tailX, y + h − 1 + BUBBLE_TAIL_PX); whole internal pixels. `tailX` is clamped
   * to BUBBLE_TAIL_INSET_PX inside the sides; w is at least BUBBLE_MIN_W_PX and h at least 3. The text is the
   * caller's (popups.ts draws it after the panel, so it lies on top). Allocates nothing.
   */
  drawBubble(xPx: number, yPx: number, wPx: number, hPx: number, tailXPx: number): void {
    if (
      !Number.isInteger(xPx) ||
      !Number.isInteger(yPx) ||
      !Number.isInteger(tailXPx) ||
      !Number.isInteger(wPx) ||
      !Number.isInteger(hPx) ||
      wPx < BUBBLE_MIN_W_PX ||
      hPx < 3
    ) {
      rejectBubble(xPx, yPx, wPx, hPx, tailXPx);
    }
    const lo = xPx + BUBBLE_TAIL_INSET_PX;
    const hi = xPx + wPx - 1 - BUBBLE_TAIL_INSET_PX;
    const tx = tailXPx < lo ? lo : tailXPx > hi ? hi : tailXPx;
    const bottom = yPx + hPx - 1;
    // The outline as two overlapping chalk rectangles (so the four corner pixels stay cut), then the ink inside.
    this.solid(xPx + 1, yPx, wPx - 2, hPx, BUBBLE_OUTLINE);
    this.solid(xPx, yPx + 1, wPx, hPx - 2, BUBBLE_OUTLINE);
    this.solid(xPx + 1, yPx + 1, wPx - 2, hPx - 2, BUBBLE_FILL);
    // The tail: the bottom edge opens over it, then it narrows to the tip.
    const half = BUBBLE_TAIL_HALF_PX;
    this.solid(tx - half, bottom, 2 * half + 1, 1, BUBBLE_FILL);
    this.solid(tx - half, bottom + 1, 2 * half + 1, 1, BUBBLE_OUTLINE);
    this.solid(tx, bottom + 1, 1, 1, BUBBLE_FILL);
    this.solid(tx, bottom + 2, 1, 1, BUBBLE_OUTLINE);
  }

  /** A solid w × h rectangle in palette colour `colour`, tiled from SOLID_FRAME's 66×8 (no-op when empty). */
  private solid(xPx: number, yPx: number, wPx: number, hPx: number, colour: number): void {
    const sink = this.sink;
    for (let row = 0; row < hPx; row += SOLID_FRAME_H_PX) {
      const rows = hPx - row < SOLID_FRAME_H_PX ? hPx - row : SOLID_FRAME_H_PX;
      for (let col = 0; col < wPx; col += SOLID_FRAME_W_PX) {
        const cols = wPx - col < SOLID_FRAME_W_PX ? wPx - col : SOLID_FRAME_W_PX;
        sink.addRegion(SOLID_FRAME, 0, 0, cols, rows, xPx + col, yPx + row, SOLID_FRAME_INK, colour);
      }
    }
  }

  /** The 9-slice quads of `style`'s frame over (x, y, w, h), each recoloured from → to. */
  private slicedPanel(
    style: PanelStyle,
    xPx: number,
    yPx: number,
    wPx: number,
    hPx: number,
    recolourFrom: number,
    recolourTo: number,
  ): void {
    const frame = PANEL_FRAMES[style] ?? rejectPanelStyle(style);
    if (!Number.isInteger(xPx) || !Number.isInteger(yPx)) rejectPanelPosition(xPx, yPx);
    const count = panelSliceCount(wPx, hPx);
    const s = this.slice;
    const sink = this.sink;
    for (let i = 0; i < count; i++) {
      panelSlice(wPx, hPx, i, s);
      sink.addRegion(
        frame,
        s[SLICE_SRC_X] ?? 0,
        s[SLICE_SRC_Y] ?? 0,
        s[SLICE_W] ?? 0,
        s[SLICE_H] ?? 0,
        xPx + (s[SLICE_DST_X] ?? 0),
        yPx + (s[SLICE_DST_Y] ?? 0),
        recolourFrom,
        recolourTo,
      );
    }
  }
  // per-frame draw path: end
}

/** Throws for a panel size (kept out of the per-frame path, which builds no objects). */
function rejectPanelSize(wPx: number, hPx: number): never {
  throw new RangeError(
    `panel size ${wPx}x${hPx}: each side must be whole pixels and at least ${PANEL_MIN_PX}`,
  );
}

function rejectBubble(xPx: number, yPx: number, wPx: number, hPx: number, tailXPx: number): never {
  throw new RangeError(
    `bubble (${xPx}, ${yPx}) ${wPx}x${hPx} tail ${tailXPx}: whole internal pixels, at least ${BUBBLE_MIN_W_PX}x3`,
  );
}

function rejectPanelPosition(xPx: number, yPx: number): never {
  throw new RangeError(`panel positions are whole internal pixels, got (${xPx}, ${yPx})`);
}

function rejectPanelStyle(style: number): never {
  throw new RangeError(`unknown panel style ${style}`);
}

function rejectButtonState(state: number): never {
  throw new RangeError(`unknown button state ${state}`);
}
