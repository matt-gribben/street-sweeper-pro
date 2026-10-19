// 9-slice panels and button states in the shipping bundle (SSP-285; ART_BIBLE §12.3; TECHNICAL_DESIGN §12.3, §12.7).
// The `panel_sample` scene (src/scenes/PanelSampleScene.ts) draws the three placeholder panels at the slicing test's
// sizes, the four button states twice, and a pause-style menu and notices over the text_sample street. No golden
// (the golden scene list is fixed, §18.4; `hud_specimen` arrives in M4): the frames are saved to test-results/ as
// review captures (open them with Read), and the spec checks what must hold exactly:
//
// - every UI pixel equals a CPU rasterisation of the same layout (the real Panels and BitmapFont drawing into
//   tests/support/textRaster.ts from public/assets/atlas/ui.png), so every slice sits at whole internal pixels,
//   unscaled, with the button recolours applied;
// - the panels are never darkened: the same pixels hold by day, half inside the building shadow, and at night;
// - the frame takes 5 draw calls (city, building shadows, the one UI draw, palette pass, blit), within 10.
import { expect, type Page, test } from '@playwright/test';
import { KERBSIDE32 } from '../../src/render/palettePass.ts';
import { INTERNAL_HEIGHT_PX } from '../../src/render/upscale.ts';
import { drawPanelSample, PANEL_SAMPLE_FONT, panelSampleLayout } from '../../src/scenes/PanelSampleScene.ts';
import { Panels } from '../../src/ui/panels.ts';
import { readBitmapFont, readIndexedAtlas, TextRaster } from '../support/textRaster.ts';
import {
  collectPageErrors,
  decodeFramePng,
  openTestScene,
  type RgbaFrame,
  readTestFrame,
} from '../support/visualGolden.ts';
import { saveFrame } from './helpers/saveFrame.ts';

const SCENE_URL = '/?test=1&seed=1&scene=panel_sample&freeze=1';

/** W at the ci project's 1920×1080 viewport. */
const WIDTH_PX = 480;

/** City + building shadows + UI batch + palette pass + blit. */
const EXPECTED_DRAW_CALLS = 5;

/** TECHNICAL_DESIGN §12.7. */
const DRAW_CALL_BUDGET = 10;

const ASPHALT = 2;

/** A pixel of the street left uncovered by the UI, inside the building shadow (the gutter left of the panels). */
const SHADOWED_GUTTER: readonly [x: number, y: number] = [3, 45];

/** The scene's UI drawn on the CPU at W = 480. */
function expectedUi(): TextRaster {
  const font = readBitmapFont(PANEL_SAMPLE_FONT);
  const raster = new TextRaster(WIDTH_PX, INTERNAL_HEIGHT_PX, readIndexedAtlas('ui'));
  drawPanelSample(new Panels(raster, font), panelSampleLayout(font));
  return raster;
}

function paletteRgb(index: number): [number, number, number] {
  const rgb = KERBSIDE32.rgb;
  return [rgb[index * 3] ?? -1, rgb[index * 3 + 1] ?? -1, rgb[index * 3 + 2] ?? -1];
}

/** Palette index of a frame pixel (-1 if it is not exactly a Kerbside-32 colour). */
function pixelIndex(frame: RgbaFrame, x: number, y: number): number {
  const o = (y * frame.width + x) * 4;
  for (let i = 0; i < 32; i++) {
    const [r, g, b] = paletteRgb(i);
    if (frame.data[o] === r && frame.data[o + 1] === g && frame.data[o + 2] === b) return i;
  }
  return -1;
}

/** UI pixels of `raster` whose frame colour differs (first few listed). */
function uiMismatches(raster: TextRaster, frame: RgbaFrame): { count: number; first: string[] } {
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

async function drawCalls(page: Page): Promise<number> {
  return page.evaluate(() => window.__ssp?.perf().drawCalls ?? -1);
}

test('panel_sample draws every panel and button pixel exactly, in 5 draw calls, undarkened by shadow', async ({
  page,
}, testInfo) => {
  const errors = collectPageErrors(page);
  await openTestScene(page, SCENE_URL);
  const frame = await readTestFrame(page);
  await saveFrame(testInfo, 'panel_sample_day.png', frame);
  await saveFrame(testInfo, 'panel_sample_day_canvas.png', decodeFramePng(await page.screenshot()));
  expect([frame.width, frame.height]).toEqual([WIDTH_PX, INTERNAL_HEIGHT_PX]);

  const raster = expectedUi();
  expect(raster.covered, 'the sample covers tens of thousands of pixels').toBeGreaterThan(30_000);
  const mismatches = uiMismatches(raster, frame);
  expect(mismatches.first).toEqual([]);
  expect(mismatches.count).toBe(0);

  // The top rows of panels really sit in the building shadow: the street in the gutter beside them is
  // shadow-remapped, while their own pixels (checked above) are exactly as authored.
  const [gx, gy] = SHADOWED_GUTTER;
  expect(raster.at(gx, gy)).toBe(-1);
  expect(pixelIndex(frame, gx, gy), 'asphalt in the building shadow').toBe(KERBSIDE32.shadow[ASPHALT] ?? -1);

  const calls = await drawCalls(page);
  expect(calls).toBeLessThanOrEqual(DRAW_CALL_BUDGET);
  expect(calls).toBe(EXPECTED_DRAW_CALLS);
  expect(errors).toEqual([]);
});

test('panel and button pixels are unchanged at night', async ({ page }, testInfo) => {
  const errors = collectPageErrors(page);
  await openTestScene(page, `${SCENE_URL}&night=1`);
  const frame = await readTestFrame(page);
  await saveFrame(testInfo, 'panel_sample_night.png', frame);

  const mismatches = uiMismatches(expectedUi(), frame);
  expect(mismatches.first).toEqual([]);
  expect(mismatches.count).toBe(0);
  expect(await drawCalls(page)).toBe(EXPECTED_DRAW_CALLS);
  expect(errors).toEqual([]);
});
