// Visual golden: scale_1440 (TECHNICAL_DESIGN §12.1, §18.4, SSP-022). The lean_quadrants frame viewed in a
// 2560×1440 page at deviceScaleFactor 1: the one golden that is a PAGE screenshot, not readFrame(), because it
// tests integer upscaling and letterboxing. At 1440p W = 480 and the scale is floor(min(2560/480, 1440/270)) = 5,
// so the canvas is 2400×1350 at (80, 45): 45 px bars top and bottom, 80 px left and right, all Kerbside-32
// index 00 `ink` (#0f0e12, the one CSS colour CLAUDE.md hard rule 3 permits).
//
// Besides the threshold-0 compare with `__goldens__/scale_1440.png`, the spec asserts the 5× scale directly:
// every bar pixel is index 00, and the 2400×1350 image area is exactly readFrame() with each internal pixel
// drawn as a 5×5 block (camera on the texel grid at tick 0, so the sub-pixel blit offset is 0). Ink outlines are
// also index 00, so the bars cannot be found by colour alone; the block check pins the image area instead.
//
// Logs `[visual] scale_1440 2560x1440 sha256=<hex>` (SHA-256 of the screenshot's RGBA pixels) for D-09.
import { expect, test } from '@playwright/test';
import { KERBSIDE32 } from '../../src/render/palettePass.ts';
import { INTERNAL_HEIGHT_PX, LETTERBOX_CSS } from '../../src/render/upscale.ts';
import {
  collectPageErrors,
  decodeFramePng,
  expectFrameMatchesGolden,
  openTestScene,
  type RgbaFrame,
  readTestFrame,
} from '../support/visualGolden.ts';

const PAGE = { width: 2560, height: 1440 } as const;
/** W at 2560×1440 (16:9). */
const INTERNAL_WIDTH_PX = 480;
/** Integer scale at 1440p (§12.1: "1440p → 5× (1350 tall, 45 px bars)"). */
const SCALE = 5;
const IMAGE_HEIGHT_PX = 1350;
const BAR_HEIGHT_PX = 45;
const IMAGE_WIDTH_PX = INTERNAL_WIDTH_PX * SCALE;
const BAR_WIDTH_PX = (PAGE.width - IMAGE_WIDTH_PX) / 2;

/** Kerbside-32 index 00 `ink`, the letterbox colour. */
const INK_INDEX = 0;
const INK_RGB = [0, 1, 2].map((c) => KERBSIDE32.rgb[INK_INDEX * 3 + c] ?? -1);

test.use({ viewport: PAGE, deviceScaleFactor: 1 });

/** Pixels in the rectangle [x0, x1) × [y0, y1) of `image` that are not opaque index-00 ink. */
function nonInkPixels(image: RgbaFrame, x0: number, x1: number, y0: number, y1: number): number {
  let count = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const o = (y * image.width + x) * 4;
      if (
        image.data[o] !== INK_RGB[0] ||
        image.data[o + 1] !== INK_RGB[1] ||
        image.data[o + 2] !== INK_RGB[2] ||
        image.data[o + 3] !== 255
      ) {
        count++;
      }
    }
  }
  return count;
}

/** Image-area pixels that differ from `frame` upscaled ×SCALE (nearest) and placed at (left, top). */
function upscaleMismatches(page: RgbaFrame, frame: RgbaFrame, left: number, top: number): number {
  let count = 0;
  for (let y = 0; y < frame.height * SCALE; y++) {
    for (let x = 0; x < frame.width * SCALE; x++) {
      const s = (Math.floor(y / SCALE) * frame.width + Math.floor(x / SCALE)) * 4;
      const d = ((top + y) * page.width + left + x) * 4;
      if (
        page.data[d] !== frame.data[s] ||
        page.data[d + 1] !== frame.data[s + 1] ||
        page.data[d + 2] !== frame.data[s + 2] ||
        page.data[d + 3] !== frame.data[s + 3]
      ) {
        count++;
      }
    }
  }
  return count;
}

test('scale_1440 letterboxes at 5x and matches its golden at pixelmatch threshold 0', async ({
  page,
}, testInfo) => {
  const errors = collectPageErrors(page);
  await openTestScene(page, '/?test=1&seed=1&scene=scale_1440&freeze=1');

  // The letterbox constant is palette index 00 (hard rule 3), and the layout is 5× with 45 px bars.
  const inkHex = `#${INK_RGB.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  expect(LETTERBOX_CSS, 'letterbox CSS colour is Kerbside-32 index 00').toBe(inkHex);
  expect(IMAGE_HEIGHT_PX).toBe(INTERNAL_HEIGHT_PX * SCALE);
  expect(BAR_HEIGHT_PX * 2 + IMAGE_HEIGHT_PX).toBe(PAGE.height);
  const box = await page.locator('#game').boundingBox();
  expect(box, 'canvas rectangle in the 2560x1440 page').toEqual({
    x: BAR_WIDTH_PX,
    y: BAR_HEIGHT_PX,
    width: IMAGE_WIDTH_PX,
    height: IMAGE_HEIGHT_PX,
  });

  const frame = await readTestFrame(page);
  expect(frame.width, 'internal width W at 2560x1440').toBe(INTERNAL_WIDTH_PX);
  expect(frame.height).toBe(INTERNAL_HEIGHT_PX);

  const shot = decodeFramePng(await page.screenshot());
  expect([shot.width, shot.height], 'page screenshot size').toEqual([PAGE.width, PAGE.height]);

  const imageBottom = BAR_HEIGHT_PX + IMAGE_HEIGHT_PX;
  expect(nonInkPixels(shot, 0, PAGE.width, 0, BAR_HEIGHT_PX), 'top 45 px bar is all ink').toBe(0);
  expect(nonInkPixels(shot, 0, PAGE.width, imageBottom, PAGE.height), 'bottom 45 px bar is all ink').toBe(0);
  expect(nonInkPixels(shot, 0, BAR_WIDTH_PX, BAR_HEIGHT_PX, imageBottom), 'left bar is all ink').toBe(0);
  expect(
    nonInkPixels(shot, BAR_WIDTH_PX + IMAGE_WIDTH_PX, PAGE.width, BAR_HEIGHT_PX, imageBottom),
    'right bar is all ink',
  ).toBe(0);
  expect(
    upscaleMismatches(shot, frame, BAR_WIDTH_PX, BAR_HEIGHT_PX),
    'the 2400x1350 image area is readFrame() at exactly 5x',
  ).toBe(0);

  await expectFrameMatchesGolden(testInfo, 'scale_1440', shot);
  expect(errors).toEqual([]);
});
