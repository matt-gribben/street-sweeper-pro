// UI-screen checks shared by the specs that end a shift on the tally (flow.spec.ts, SSP-071; smoke.spec.ts,
// SSP-073): a CPU rasterisation of a uiItems layout from ui.png (tests/support/textRaster.ts), the count of UI
// pixels a frame shows differently, and the tally's strings as they must read for a given `__ssp.state()`, written
// here independently of src/ui/tallyPage.ts's formatting.
import type { ShiftTestState } from '../../../src/debug/testHooks.ts';
import { KERBSIDE32 } from '../../../src/render/palettePass.ts';
import { INTERNAL_HEIGHT_PX } from '../../../src/render/upscale.ts';
import { UI_SCREEN_FONT } from '../../../src/scenes/uiScreen.ts';
import type { SimSnapshot } from '../../../src/sim/snapshot.ts';
import { Panels } from '../../../src/ui/panels.ts';
import { STAR, TallyButton, tallyFigures, tallyPageLayout } from '../../../src/ui/tallyPage.ts';
import { drawUiItems, type UiItem } from '../../../src/ui/uiItems.ts';
import { readBitmapFont, readIndexedAtlas, TextRaster } from '../../support/textRaster.ts';
import type { RgbaFrame } from '../../support/visualGolden.ts';

/** W at the ci project's 1920×1080 viewport. */
export const UI_WIDTH_PX = 480;

/** UI batch + palette pass + blit (uiScreen.ts): the intro card and the tally. */
export const UI_SCREEN_DRAW_CALLS = 3;

/** The UI screens' font (Kerbside 5×7), read from the checkout. */
export const uiFont = readBitmapFont(UI_SCREEN_FONT);

/** `items` drawn on the CPU from ui.png at W × 270. */
export function rasterise(items: readonly UiItem[]): TextRaster {
  const raster = new TextRaster(UI_WIDTH_PX, INTERNAL_HEIGHT_PX, readIndexedAtlas('ui'));
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

/** The sim part of a shift state (the camera stripped). */
export function sim(state: ShiftTestState): SimSnapshot {
  const { camera: _camera, ...rest } = state;
  return rest;
}

/** An integer with thousands separators, written independently of tallyPage.ts. */
export function grouped(n: number): string {
  return Math.round(n).toLocaleString('en-GB');
}

/** The tally page for `end` (a state taken while the tally shows), Try Again focused, nothing pressed. */
export function tallyItems(end: ShiftTestState, districtName: string): readonly UiItem[] {
  return tallyPageLayout(
    uiFont,
    UI_WIDTH_PX,
    INTERNAL_HEIGHT_PX,
    tallyFigures(sim(end), districtName),
    TallyButton.TryAgain,
    false,
  );
}

/** The strings the tally must show for a TIME UP `end`, top to bottom, formatted here from the raw state. */
export function expectedTimeUpStrings(end: ShiftTestState, districtName: string): string[] {
  return [
    'TIME UP!',
    districtName,
    'TIDY',
    `${(Math.round(end.tidy * 1000) / 10).toFixed(1)}%`,
    'ITEMS COLLECTED',
    `${grouped(end.litter.collected)} / ${grouped(end.litter.spawned)}`,
    'GRIME CLEANED',
    `${grouped(end.grime.cleaned)} / ${grouped(end.grime.initial)}`,
    'SCORE',
    grouped(end.score),
    'STARS',
    STAR,
    STAR,
    STAR,
    'TRY AGAIN',
    'BACK TO BRIEFING',
  ];
}

/** Would-be stars for a Tidy % (GDD §12.1 thresholds 60 / 80 / 92 %), written here independently of tidy.ts. */
export function earnedStars(tidy: number): number {
  return tidy >= 0.92 ? 3 : tidy >= 0.8 ? 2 : tidy >= 0.6 ? 1 : 0;
}
