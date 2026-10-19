// UI-screen checks shared by the specs that end a shift on the tally (flow.spec.ts, SSP-071; smoke.spec.ts,
// SSP-073): a CPU rasterisation of a uiItems layout from ui.png (tests/support/textRaster.ts), the count of UI
// pixels a frame shows differently, and the tally's strings as they must read for a given `__ssp.state()`, written
// here independently of src/ui/tallyPage.ts's formatting.
import type { ShiftTestState } from '../../../src/debug/testHooks.ts';
import { INTERNAL_HEIGHT_PX } from '../../../src/render/upscale.ts';
import type { SimSnapshot } from '../../../src/sim/snapshot.ts';
import {
  STAR,
  TallyButton,
  tallyButtonStates,
  tallyFigures,
  tallyPageLayout,
} from '../../../src/ui/tallyPage.ts';
import type { UiItem } from '../../../src/ui/uiItems.ts';
import type { TextRaster } from '../../support/textRaster.ts';
import { rasterise as rasteriseAt, uiFont } from './uiPixels.ts';

// The pixel primitives (font, palette lookup, mismatch count) live in uiPixels.ts (SSP-286), shared with
// menuMouse.spec.ts; this module adds the 1920×1080 screen width and the tally's expected content.
export { pixelIndex, uiFont, uiMismatches } from './uiPixels.ts';

/** W at the ci project's 1920×1080 viewport. */
export const UI_WIDTH_PX = 480;

/** UI batch + palette pass + blit (uiScreen.ts): the intro card and the tally. */
export const UI_SCREEN_DRAW_CALLS = 3;

/** `items` drawn on the CPU from ui.png at W × 270. */
export function rasterise(items: readonly UiItem[]): TextRaster {
  return rasteriseAt(items, UI_WIDTH_PX);
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
    tallyButtonStates(TallyButton.TryAgain),
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
