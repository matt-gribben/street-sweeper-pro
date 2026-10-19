// UI items (SSP-071): a screen laid out once as a flat list of panels, buttons and strings, then drawn through one
// Panels (its sink is the scene's UiSpriteBatch, or a CPU rasteriser in tests). The intro card (introCard.ts) and
// the tally page (tallyPage.ts) are built from them, so the same layout drives the GPU frame, the unit tests and
// the e2e pixel check (tests/e2e/flow.spec.ts). SSP-286's menus.ts takes the buttons over in M3.
//
// Layouts are pure data computed off the per-frame path (when the width or the focus changes); drawUiItems walks
// the list by index and allocates nothing.
import { LineSpacing, TextAlign, TextVariant } from './bitmapText.ts';
import type { ButtonState, PanelStyle, Panels, UiRect } from './panels.ts';

/** One element of a laid-out screen, drawn in list order (later quads over earlier ones). */
export type UiItem =
  | {
      readonly kind: 'panel';
      readonly style: PanelStyle;
      readonly x: number;
      readonly y: number;
      readonly w: number;
      readonly h: number;
    }
  | { readonly kind: 'button'; readonly state: ButtonState; readonly rect: UiRect; readonly label: string }
  | {
      readonly kind: 'text';
      readonly text: string;
      /** Anchor: the left edge, the centre or the right edge of the line, per `align`. */
      readonly x: number;
      readonly y: number;
      /** Palette index 0..31. */
      readonly colour: number;
      readonly variant: TextVariant;
      readonly align: TextAlign;
    };

/** A plain or outlined one-line string item. */
export function textItem(
  text: string,
  x: number,
  y: number,
  colour: number,
  align: TextAlign = TextAlign.Left,
  variant: TextVariant = TextVariant.Plain,
): UiItem {
  return { kind: 'text', text, x, y, colour, variant, align };
}

/** Draws `items` through `panels` (its sink and font), in order. Allocates nothing. */
export function drawUiItems(panels: Panels, items: readonly UiItem[]): void {
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item === undefined) continue;
    if (item.kind === 'panel') panels.drawPanel(item.style, item.x, item.y, item.w, item.h);
    else if (item.kind === 'button') panels.drawButton(item.state, item.rect, item.label);
    else {
      panels.font.draw(
        panels.sink,
        item.text,
        item.x,
        item.y,
        item.colour,
        item.variant,
        item.align,
        LineSpacing.Hud,
      );
    }
  }
}

/** Every string a layout shows (text items and button labels), in draw order: what a test reads off the screen. */
export function uiItemStrings(items: readonly UiItem[]): string[] {
  const strings: string[] = [];
  for (const item of items) {
    if (item.kind === 'text') strings.push(item.text);
    else if (item.kind === 'button') strings.push(item.label);
  }
  return strings;
}
