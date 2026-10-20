// Pam's tutorial in the shipping bundle (SSP-290; GDD §16.1, §16.2; LEVEL_DESIGN §4.4). A scripted Puddle Lane start
// (`?test=1&seed=1&scene=district.puddle_lane&freeze=1`, tips on as in the shipping game), read through
// `__ssp.tutorial()`, the test hook that lists the prompt showing:
//
//   1. at shift start (tick 0) beat 1 shows, and the radio panel draws its first page at home, pixel for pixel;
//   2. W and D held for 12 ticks: throttle and steering are used, so beat 1 is learned and dismissed;
//   3. W alone, one tick at a time: beat 2 has not fired while Bessie's path is under 10 m and fires on the tick it
//      reaches 10 m, then shows ("Brush down with [Space]...");
//   4. Space: the brush goes down, beat 2 is dismissed and 'brush' is learned.
//
// Review captures in test-results/ (open them with Read): tutorial_beat1.png (beat 1 on the panel at the depot) and
// tutorial_beat2.png (beat 2, with its Space keycap, after the 10 m drive).
import { expect, type Page, test } from '@playwright/test';
import { DEFAULT_GLYPHS } from '../../src/app/glyphBindings.ts';
import type { ShiftTestState, TestState } from '../../src/debug/testHooks.ts';
import { KERBSIDE32 } from '../../src/render/palettePass.ts';
import { INTERNAL_HEIGHT_PX } from '../../src/render/upscale.ts';
import { HUD_FONT } from '../../src/scenes/ShiftScene.ts';
import { DEFAULT_TUNING } from '../../src/sim/tuning.ts';
import { HUD_MARGIN_PX, Hud, type HudRect, hudLayout } from '../../src/ui/hud.ts';
import { createHudModel } from '../../src/ui/hudModel.ts';
import {
  barkPlainText,
  createRadioModel,
  pageBark,
  parseBark,
  type RadioModel,
  RadioSide,
  radioModel,
} from '../../src/ui/radio.ts';
import type { TutorialState } from '../../src/ui/tutorial.ts';
import { readBitmapFont, readIndexedAtlas, TextRaster } from '../support/textRaster.ts';
import { collectPageErrors, openTestScene, type RgbaFrame, readTestFrame } from '../support/visualGolden.ts';
import { saveFrame } from './helpers/saveFrame.ts';

const SHIFT_URL = '/?test=1&seed=1&scene=district.puddle_lane&freeze=1';
/** 1920×1080 gives W = 480 (playwright.config.ts VISUAL_VIEWPORT). */
const W = 480;
const font = readBitmapFont(HUD_FONT);
const uiAtlas = readIndexedAtlas('ui');
const context = {
  glyphs: DEFAULT_GLYPHS,
  device: 'keyboard',
  cleanSpeedMps: DEFAULT_TUNING.vehicle.sweeper.brush.cleanPickupMaxMps,
} as const;

async function tutorial(page: Page): Promise<TutorialState> {
  const state = await page.evaluate(() => {
    const api = window.__ssp;
    if (api === undefined) throw new Error('window.__ssp missing');
    return api.tutorial();
  });
  if (state === null) throw new Error('no tutorial is running');
  return state;
}

async function step(page: Page, n: number): Promise<ShiftTestState> {
  const state = await page.evaluate((ticks): TestState => {
    const api = window.__ssp;
    if (api === undefined) throw new Error('window.__ssp missing');
    api.step(ticks);
    return api.state();
  }, n);
  if (!('bessie' in state)) throw new Error('state() is not a shift snapshot');
  return state;
}

/** Palette index of a frame pixel (-1 if it is not exactly a Kerbside-32 colour). */
function pixelIndex(frame: RgbaFrame, x: number, y: number): number {
  const o = (y * frame.width + x) * 4;
  const rgb = KERBSIDE32.rgb;
  for (let i = 0; i < 32; i++) {
    if (
      frame.data[o] === rgb[i * 3] &&
      frame.data[o + 1] === rgb[i * 3 + 1] &&
      frame.data[o + 2] === rgb[i * 3 + 2]
    )
      return i;
  }
  return -1;
}

/** The radio model of the first page of `text` on `side`, with the keyboard glyphs. */
function firstPageModel(text: string, side: RadioSide): RadioModel {
  const pages = pageBark(parseBark(text), font, context);
  let widest = 0;
  for (const p of pages) widest = Math.max(widest, p.inkPx);
  return radioModel(pages[0] ?? null, widest, side, W, createRadioModel());
}

/** Panel pixels of `radio` (drawn on the CPU) whose frame colour differs inside `box`. */
function radioMismatches(
  radio: RadioModel,
  frame: RgbaFrame,
  box: HudRect,
): { drawn: number; first: string[] } {
  const base = new TextRaster(W, INTERNAL_HEIGHT_PX, uiAtlas);
  new Hud(base, font).drawModel(createHudModel(), W);
  const raster = new TextRaster(W, INTERNAL_HEIGHT_PX, uiAtlas);
  new Hud(raster, font).drawModel(createHudModel(), W, radio);
  let drawn = 0;
  const first: string[] = [];
  for (let y = box.y; y < box.y + box.h; y++) {
    for (let x = Math.max(box.x, HUD_MARGIN_PX); x < Math.min(box.x + box.w, W - HUD_MARGIN_PX); x++) {
      const want = raster.at(x, y);
      if (want < 0 || want === base.at(x, y)) continue;
      drawn++;
      const got = pixelIndex(frame, x, y);
      if (got !== want && first.length < 8) first.push(`(${x}, ${y}) want ${want} got ${got}`);
    }
  }
  return { drawn, first };
}

test('Puddle Lane start: beat 1 at shift start, beat 2 after driving 10 m, both read through __ssp.tutorial()', async ({
  page,
}, testInfo) => {
  const errors = collectPageErrors(page);
  await openTestScene(page, SHIFT_URL);
  const slots = hudLayout(font, W).reserved;

  // 1. Shift start: beat 1 shows before any tick.
  let t = await tutorial(page);
  expect(t.current?.n).toBe(1);
  expect(t.current?.trigger).toBe('shift_start');
  expect(t.fired).toEqual([1]);
  expect(barkPlainText(parseBark(t.current?.text ?? ''), context)).toBe(
    "Morning, rookie. That's Bessie. Be gentle with her. W to go, A/D to steer.",
  );
  const beat1 = await readTestFrame(page);
  await saveFrame(testInfo, 'tutorial_beat1.png', beat1, { atResultsRoot: true });
  const panel1 = radioMismatches(
    firstPageModel(t.current?.text ?? '', RadioSide.Home),
    beat1,
    slots.radioHome,
  );
  expect(panel1.drawn).toBeGreaterThan(1_000);
  expect(panel1.first).toEqual([]);

  // 2. Throttle and steering: beat 1 is learned and goes at once.
  await page.keyboard.down('KeyW');
  await page.keyboard.down('KeyD');
  await step(page, 12);
  await page.keyboard.up('KeyD');
  t = await tutorial(page);
  expect(t.learned).toEqual(['drive']);
  expect(t.current).toBeNull();
  expect(t.distanceM).toBeLessThan(10);

  // 3. Drive on (W alone): beat 2 waits for 10 m of path, not a tick less.
  let ticks = 0;
  let before = t;
  while (!t.fired.includes(2)) {
    expect(t.distanceM, 'beat 2 fired early').toBeLessThan(10);
    before = t;
    await step(page, 1);
    t = await tutorial(page);
    ticks++;
    expect(ticks, 'never reached 10 m').toBeLessThan(600);
  }
  expect(before.distanceM).toBeLessThan(10);
  expect(t.distanceM).toBeGreaterThanOrEqual(10);
  expect(t.fired).toEqual([1, 2]);
  expect(t.current?.n).toBe(2);
  expect(barkPlainText(parseBark(t.current?.text ?? ''), context)).toBe(
    'Brush down with Space. Takes her a second to spin up.',
  );
  await page.keyboard.up('KeyW');
  const beat2 = await readTestFrame(page);
  await saveFrame(testInfo, 'tutorial_beat2.png', beat2, { atResultsRoot: true });

  // 4. Space lowers the brush: beat 2 is dismissed and learned.
  await page.keyboard.press('Space');
  await step(page, 1);
  t = await tutorial(page);
  expect(t.current).toBeNull();
  expect(t.learned).toEqual(['drive', 'brush']);
  expect(errors).toEqual([]);
});

test('tips=0 runs no tutorial', async ({ page }) => {
  await openTestScene(page, `${SHIFT_URL}&tips=0`);
  const state = await page.evaluate(() => {
    const api = window.__ssp;
    if (api === undefined) throw new Error('window.__ssp missing');
    return { scene: api.scene(), tutorial: api.tutorial() };
  });
  expect(state).toEqual({ scene: 'shift', tutorial: null });
});
