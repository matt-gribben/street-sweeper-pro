// Bitmap text and the UI pass in the shipping bundle (SSP-069; TECHNICAL_DESIGN §12.3, §12.6, §12.7). The
// `text_sample` scene (src/scenes/TextSampleScene.ts) draws Kerbside 5×7 strings in 07 and 18, plain and outlined,
// over a sunlit street and over a building shadow. No golden (the golden scene list is fixed, §18.4; `hud_specimen`
// arrives in M4): the frames are saved to test-results/ as review captures (open them with Read), and the spec
// checks what must hold exactly:
//
// - every text pixel equals a CPU rasterisation of the same layout (the real BitmapFont laying out into
//   tests/support/textRaster.ts from public/assets/atlas/ui.png), so glyphs sit at whole internal pixels with the
//   requested palette colours and the 00 outline ring;
// - the text is never darkened: the same pixels hold by day, under the building shadow and at night (`night=1`),
//   while the world around them is shadow-remapped and night-remapped (the UI pass writes mask (0, 1));
// - the frame takes 5 draw calls (city, building shadows, the one UI draw, palette pass, blit), within 10;
// - with the camera on a sub-pixel position, the canvas shows every text pixel as an exact 4×4 block at its own
//   internal pixel while the world is shifted by the camera's sub-pixel offset (the UI-aware blit).
import { expect, type Page, test } from '@playwright/test';
import { KERBSIDE32 } from '../../src/render/palettePass.ts';
import { INTERNAL_HEIGHT_PX } from '../../src/render/upscale.ts';
import {
  TEXT_SAMPLE_FONT,
  TEXT_SAMPLE_SHADOW_X_PX,
  textSampleLines,
} from '../../src/scenes/TextSampleScene.ts';
import { readBitmapFont, readIndexedAtlas, TextRaster } from '../support/textRaster.ts';
import {
  collectPageErrors,
  decodeFramePng,
  openTestScene,
  type RgbaFrame,
  readTestFrame,
} from '../support/visualGolden.ts';
import { saveFrame } from './helpers/saveFrame.ts';

const SCENE_URL = '/?test=1&seed=1&scene=text_sample&freeze=1';

/** W and the integer scale at the ci project's 1920×1080 viewport. */
const WIDTH_PX = 480;
const SCALE = 4;

/** City + building shadows + UI batch + palette pass + blit. */
const EXPECTED_DRAW_CALLS = 5;

/** TECHNICAL_DESIGN §12.7. */
const DRAW_CALL_BUDGET = 10;

/** Palette indices the checks name (Kerbside-32). */
const INK = 0;
const ASPHALT = 2;
const CHALK = 7;
const POSTBOX_RED = 18;

/** The scene's text laid out on the CPU at W = 480. */
function expectedText(): TextRaster {
  const font = readBitmapFont(TEXT_SAMPLE_FONT);
  const raster = new TextRaster(WIDTH_PX, INTERNAL_HEIGHT_PX, readIndexedAtlas('ui'));
  for (const line of textSampleLines(WIDTH_PX, font)) {
    font.draw(raster, line.text, line.x, line.y, line.colour, line.variant, line.align, line.spacing);
  }
  return raster;
}

function paletteRgb(index: number): [number, number, number] {
  const rgb = KERBSIDE32.rgb;
  return [rgb[index * 3] ?? -1, rgb[index * 3 + 1] ?? -1, rgb[index * 3 + 2] ?? -1];
}

function pixelRgb(frame: RgbaFrame, x: number, y: number): [number, number, number] {
  const o = (y * frame.width + x) * 4;
  return [frame.data[o] ?? -1, frame.data[o + 1] ?? -1, frame.data[o + 2] ?? -1];
}

/** Palette index of a frame pixel (-1 if it is not exactly a Kerbside-32 colour). */
function pixelIndex(frame: RgbaFrame, x: number, y: number): number {
  const [r, g, b] = pixelRgb(frame, x, y);
  for (let i = 0; i < 32; i++) {
    const [pr, pg, pb] = paletteRgb(i);
    if (pr === r && pg === g && pb === b) return i;
  }
  return -1;
}

/** Text pixels of `raster` whose frame colour differs (first few listed). */
function textMismatches(raster: TextRaster, frame: RgbaFrame): { count: number; first: string[] } {
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

/** Number of text pixels of `raster` with palette index `index` inside the rows y0..y1 (inclusive). */
function textPixelsOf(raster: TextRaster, index: number, y0: number, y1: number): number {
  let n = 0;
  for (let y = y0; y <= y1; y++) for (let x = 0; x < raster.width; x++) if (raster.at(x, y) === index) n++;
  return n;
}

async function drawCalls(page: Page): Promise<number> {
  return page.evaluate(() => window.__ssp?.perf().drawCalls ?? -1);
}

test('text_sample draws every text pixel exactly, in 5 draw calls, undarkened by shadow', async ({
  page,
}, testInfo) => {
  const errors = collectPageErrors(page);
  await openTestScene(page, SCENE_URL);
  const frame = await readTestFrame(page);
  await saveFrame(testInfo, 'text_sample_day.png', frame);
  expect([frame.width, frame.height]).toEqual([WIDTH_PX, INTERNAL_HEIGHT_PX]);

  const raster = expectedText();
  expect(raster.covered, 'the sample draws a few thousand text pixels').toBeGreaterThan(5000);
  const mismatches = textMismatches(raster, frame);
  expect(mismatches.first).toEqual([]);
  expect(mismatches.count).toBe(0);

  // The comparison lines carry the colours the issue names: 07 and 18 ink, and the 00 ring when outlined.
  expect(textPixelsOf(raster, CHALK, 30, 36), 'plain 07 line').toBeGreaterThan(100);
  expect(textPixelsOf(raster, INK, 30, 36), 'plain text has no ring').toBe(0);
  expect(textPixelsOf(raster, INK, 41, 49), 'outlined 07 line has its 00 ring').toBeGreaterThan(100);
  expect(textPixelsOf(raster, POSTBOX_RED, 54, 60), 'plain 18 line').toBeGreaterThan(50);
  expect(textPixelsOf(raster, POSTBOX_RED, 65, 73), 'outlined 18 line').toBeGreaterThan(50);

  // The shadow column really is in the building shadow, the sun column is not: the asphalt beside each line is
  // shadow[02] on the left and 02 on the right, while the text pixels on both (checked above) are identical.
  const shadowed = KERBSIDE32.shadow[ASPHALT] ?? -1;
  expect(raster.at(TEXT_SAMPLE_SHADOW_X_PX - 3, 33)).toBe(-1);
  expect(pixelIndex(frame, TEXT_SAMPLE_SHADOW_X_PX - 3, 33), 'asphalt in the building shadow').toBe(shadowed);
  expect(pixelIndex(frame, 296, 33), 'asphalt in the sun').toBe(ASPHALT);

  const calls = await drawCalls(page);
  expect(calls).toBeLessThanOrEqual(DRAW_CALL_BUDGET);
  expect(calls).toBe(EXPECTED_DRAW_CALLS);
  expect(errors).toEqual([]);
});

test('text pixels are unchanged at night while the world is night-remapped', async ({ page }, testInfo) => {
  const errors = collectPageErrors(page);
  await openTestScene(page, `${SCENE_URL}&night=1`);
  const frame = await readTestFrame(page);
  await saveFrame(testInfo, 'text_sample_night.png', frame);

  const mismatches = textMismatches(expectedText(), frame);
  expect(mismatches.first).toEqual([]);
  expect(mismatches.count).toBe(0);
  expect(pixelIndex(frame, 296, 33), 'sunlit asphalt is night-remapped').toBe(
    KERBSIDE32.night[ASPHALT] ?? -1,
  );
  expect(await drawCalls(page)).toBe(EXPECTED_DRAW_CALLS);
  expect(errors).toEqual([]);
});

test('UI pixels stay on the internal-pixel grid while the world takes the sub-pixel offset', async ({
  page,
}, testInfo) => {
  const errors = collectPageErrors(page);
  await openTestScene(page, SCENE_URL);
  // 0.03 m and 0.02 m east and south of the texel grid: 0.48 px and 0.32 px, blit offsets 2 and 1 device px.
  await page.evaluate(() => window.__ssp?.setCamera(0.03, 0.02, 31.5));
  const frame = await readTestFrame(page);
  const shot = decodeFramePng(await page.screenshot());
  await saveFrame(testInfo, 'text_sample_subpixel_canvas.png', shot);
  expect([shot.width, shot.height]).toEqual([WIDTH_PX * SCALE, INTERNAL_HEIGHT_PX * SCALE]);

  const raster = expectedText();
  // Every text pixel (x, y) fills exactly the device block [4x, 4x + 4) × [4y, 4y + 4).
  let uiMismatches = 0;
  for (let y = 0; y < INTERNAL_HEIGHT_PX; y++) {
    for (let x = 0; x < WIDTH_PX; x++) {
      const want = raster.at(x, y);
      if (want < 0) continue;
      for (let dy = 0; dy < SCALE; dy++) {
        for (let dx = 0; dx < SCALE; dx++) {
          if (pixelIndex(shot, x * SCALE + dx, y * SCALE + dy) !== want) uiMismatches++;
        }
      }
    }
  }
  expect(uiMismatches, 'device pixels of text off their internal pixel').toBe(0);

  // The world under it is shifted: away from the text (where the blit samples the unshifted texel), the canvas is
  // the frame offset by the camera's sub-pixel remainder, and only the expected offset reproduces it.
  const worldMatches = (ox: number, oy: number): boolean => {
    for (let dy = 0; dy < shot.height; dy++) {
      for (let dx = 0; dx < shot.width; dx++) {
        const sx = Math.floor((dx + ox) / SCALE);
        const sy = Math.floor((dy + oy) / SCALE);
        // The shifted texel past the right or bottom edge is RT margin, which readFrame() does not return.
        if (sx >= WIDTH_PX || sy >= INTERNAL_HEIGHT_PX) continue;
        if (raster.at(sx, sy) >= 0 || raster.at(Math.floor(dx / SCALE), Math.floor(dy / SCALE)) >= 0)
          continue;
        const s = (dy * shot.width + dx) * 4;
        const f = (sy * frame.width + sx) * 4;
        if (
          shot.data[s] !== frame.data[f] ||
          shot.data[s + 1] !== frame.data[f + 1] ||
          shot.data[s + 2] !== frame.data[f + 2]
        ) {
          return false;
        }
      }
    }
    return true;
  };
  const offsets: string[] = [];
  for (let oy = 0; oy <= SCALE; oy++) {
    for (let ox = 0; ox <= SCALE; ox++) if (worldMatches(ox, oy)) offsets.push(`${ox},${oy}`);
  }
  expect(offsets, 'blit offsets at which the world band matches').toEqual(['2,1']);
  expect(errors).toEqual([]);
});
