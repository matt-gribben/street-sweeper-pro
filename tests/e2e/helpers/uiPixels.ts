// UI pixel checks shared by the menu e2e specs (SSP-071 flow.spec.ts, SSP-286 menuMouse.spec.ts): a CPU
// rasterisation of a UiItem layout (tests/support/textRaster.ts, from ui.png) compared with the frame the game drew.
import { KERBSIDE32 } from '../../../src/render/palettePass.ts';
import { INTERNAL_HEIGHT_PX } from '../../../src/render/upscale.ts';
import { UI_SCREEN_FONT } from '../../../src/scenes/uiScreen.ts';
import { Panels } from '../../../src/ui/panels.ts';
import { drawUiItems, type UiItem } from '../../../src/ui/uiItems.ts';
import { readBitmapFont, readIndexedAtlas, TextRaster } from '../../support/textRaster.ts';
import type { RgbaFrame } from '../../support/visualGolden.ts';

/** The UI screens' font, read from public/assets. */
export const uiFont = readBitmapFont(UI_SCREEN_FONT);

/** `items` rasterised at internal width `widthPx` (270 tall). */
export function rasterise(items: readonly UiItem[], widthPx: number): TextRaster {
  const raster = new TextRaster(widthPx, INTERNAL_HEIGHT_PX, readIndexedAtlas('ui'));
  drawUiItems(new Panels(raster, uiFont), items);
  return raster;
}

/** Palette index of a frame pixel (-1 if it is not exactly a Kerbside-32 colour). */
export function pixelIndex(frame: RgbaFrame, x: number, y: number): number {
  const o = (y * frame.width + x) * 4;
  const rgb = KERBSIDE32.rgb;
  for (let i = 0; i < 32; i++) {
    if (
      frame.data[o] === rgb[i * 3] &&
      frame.data[o + 1] === rgb[i * 3 + 1] &&
      frame.data[o + 2] === rgb[i * 3 + 2]
    ) {
      return i;
    }
  }
  return -1;
}

/** UI pixels of `raster` whose frame colour differs (first few listed). */
export function uiMismatches(raster: TextRaster, frame: RgbaFrame): { count: number; first: string[] } {
  let count = 0;
  const first: string[] = [];
  for (let y = 0; y < raster.height; y++) {
    for (let x = 0; x < raster.width; x++) {
      const want = raster.at(x, y);
      if (want < 0) continue;
      const got = pixelIndex(frame, x, y);
      if (got !== want) {
        count++;
        if (first.length < 8) first.push(`(${x}, ${y}) want ${want} got ${got}`);
      }
    }
  }
  return { count, first };
}
