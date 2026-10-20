// Pam's radio panel in the shipping bundle (SSP-289; GDD §11.3, §15.2; ART_BIBLE §12.2, §12.3). Parked at the Puddle
// Lane depot start, Playwright honks H sixteen times, a press every 30 ticks: every fourth honk inside 5 s files a
// Noise complaint (SSP-078), so the sixteenth brings the meter to 4 and Pam barks "One more and you're off the
// van!". Frames saved to test-results/ as review captures (open them with Read):
//
//   radio_home.png  the first frame after the 4th complaint: the bark at home, bottom-left above the brush row;
//   radio_away.png  the camera pinned 4 m east of Bessie, so she and the road ahead are left of centre (as when she
//                   drives west): the panel has moved to the bottom-right, above the minimap slot;
//   radio_gone.png  180 ticks after it appeared: the bark has gone.
//
// Each capture's panel slot must equal the same radio model drawn on the CPU from public/assets/atlas/ui.png, pixel
// for pixel, inside the 4 px margin, and the frame stays within the 10 draw calls (TECHNICAL_DESIGN §12.7).
import { expect, type Page, test } from '@playwright/test';
import { DEFAULT_GLYPHS } from '../../src/app/glyphBindings.ts';
import type { ShiftTestState, TestState } from '../../src/debug/testHooks.ts';
import { KERBSIDE32 } from '../../src/render/palettePass.ts';
import { INTERNAL_HEIGHT_PX } from '../../src/render/upscale.ts';
import { HUD_FONT } from '../../src/scenes/ShiftScene.ts';
import { HUD_MARGIN_PX, Hud, type HudRect, hudLayout } from '../../src/ui/hud.ts';
import { createHudModel } from '../../src/ui/hudModel.ts';
import {
  BARK_PAGE_TICKS,
  COMPLAINT_WARN_BARK,
  createRadioModel,
  pageBark,
  parseBark,
  type RadioModel,
  RadioSide,
  radioModel,
} from '../../src/ui/radio.ts';
import { readBitmapFont, readIndexedAtlas, TextRaster } from '../support/textRaster.ts';
import { collectPageErrors, openTestScene, type RgbaFrame, readTestFrame } from '../support/visualGolden.ts';
import { saveFrame } from './helpers/saveFrame.ts';

// tips=0: Pam's tutorial beats (SSP-290) would hold the radio from shift start; this spec checks the warning bark.
const SHIFT_URL = '/?test=1&seed=1&scene=district.puddle_lane&freeze=1&tips=0';
/** 1920×1080 gives W = 480 (playwright.config.ts VISUAL_VIEWPORT). */
const W = 480;
const PRESS_EVERY_TICKS = 30;
const DRAW_CALL_BUDGET = 10;

const font = readBitmapFont(HUD_FONT);
const uiAtlas = readIndexedAtlas('ui');

async function shiftState(page: Page): Promise<ShiftTestState> {
  const state = await page.evaluate((): TestState => {
    const api = window.__ssp;
    if (api === undefined) throw new Error('window.__ssp missing');
    return api.state();
  });
  if (!('bessie' in state)) throw new Error(`state() is not a shift snapshot: ${JSON.stringify(state)}`);
  return state;
}

async function step(page: Page, n: number): Promise<ShiftTestState> {
  await page.evaluate((ticks) => window.__ssp?.step(ticks), n);
  return shiftState(page);
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

/** The warning bark's radio model on `side` (keyboard glyphs; it has no tokens). */
function warnModel(side: RadioSide): RadioModel {
  const [page, ...rest] = pageBark(parseBark(COMPLAINT_WARN_BARK), font, {
    glyphs: DEFAULT_GLYPHS,
    device: 'keyboard',
    cleanSpeedMps: 4,
  });
  expect(rest).toEqual([]);
  return radioModel(page ?? null, page?.inkPx ?? 0, side, W, createRadioModel());
}

/** Panel pixels of `radio` (drawn on the CPU) whose frame colour differs inside `box`, and how many it draws. */
function radioMismatches(
  radio: RadioModel,
  frame: RgbaFrame,
  box: HudRect,
): { drawn: number; count: number; first: string[] } {
  const base = new TextRaster(W, INTERNAL_HEIGHT_PX, uiAtlas);
  new Hud(base, font).drawModel(createHudModel(), W);
  const raster = new TextRaster(W, INTERNAL_HEIGHT_PX, uiAtlas);
  new Hud(raster, font).drawModel(createHudModel(), W, radio);
  let drawn = 0;
  let count = 0;
  const first: string[] = [];
  for (let y = 0; y < INTERNAL_HEIGHT_PX; y++) {
    for (let x = 0; x < W; x++) {
      const want = raster.at(x, y);
      if (want < 0 || want === base.at(x, y)) continue;
      drawn++;
      const inside =
        x >= box.x &&
        y >= box.y &&
        x < box.x + box.w &&
        y < box.y + box.h &&
        x >= HUD_MARGIN_PX &&
        x < W - HUD_MARGIN_PX;
      if (!inside) {
        count++;
        if (first.length < 8) first.push(`(${x}, ${y}) outside its slot`);
        continue;
      }
      const got = pixelIndex(frame, x, y);
      if (got !== want) {
        count++;
        if (first.length < 8) first.push(`(${x}, ${y}) want ${want} got ${got}`);
      }
    }
  }
  return { drawn, count, first };
}

async function drawCalls(page: Page): Promise<number> {
  return page.evaluate(() => window.__ssp?.perf().drawCalls ?? -1);
}

test('the 4th complaint makes Pam bark; the panel moves off the road ahead and goes after 180 ticks', async ({
  page,
}, testInfo) => {
  const errors = collectPageErrors(page);
  await openTestScene(page, SHIFT_URL);
  const slots = hudLayout(font, W).reserved;
  let state = await shiftState(page);
  expect(state.complaints).toBe(0);
  const street = await readTestFrame(page);
  expect(
    radioMismatches(warnModel(RadioSide.Home), street, slots.radioHome).count,
    'no bark yet',
  ).toBeGreaterThan(1_000);

  for (let honk = 1; honk <= 16; honk++) {
    if (honk > 1) state = await step(page, PRESS_EVERY_TICKS - 1);
    await page.keyboard.press('KeyH');
    state = await step(page, 1);
    expect(state.complaints, `after honk ${honk}`).toBe(Math.floor(honk / 4));
  }
  const barkTick = state.tick;

  // The frame after the 4th complaint: the bark at home, pixel-exact.
  const home = await readTestFrame(page);
  await saveFrame(testInfo, 'radio_home.png', home, { atResultsRoot: true });
  const atHome = radioMismatches(warnModel(RadioSide.Home), home, slots.radioHome);
  expect(atHome.drawn).toBeGreaterThan(2_000);
  expect(atHome.first).toEqual([]);
  expect(atHome.count).toBe(0);
  expect(await drawCalls(page)).toBeLessThanOrEqual(DRAW_CALL_BUDGET);

  // The camera 4 m east of Bessie: the look-ahead point is 64 px left of centre, so the panel moves away.
  await page.evaluate(({ x, y, h }) => window.__ssp?.setCamera(x, y, h), {
    x: state.bessie.x + 4,
    y: state.bessie.y,
    h: state.camera.h,
  });
  const away = await readTestFrame(page);
  await saveFrame(testInfo, 'radio_away.png', away, { atResultsRoot: true });
  const atAway = radioMismatches(warnModel(RadioSide.Away), away, slots.radioAway);
  expect(atAway.first).toEqual([]);
  expect(atAway.count).toBe(0);
  expect(await drawCalls(page)).toBeLessThanOrEqual(DRAW_CALL_BUDGET);

  // Still up at 179 ticks, gone at 180.
  state = await step(page, BARK_PAGE_TICKS - 1);
  expect(radioMismatches(warnModel(RadioSide.Away), await readTestFrame(page), slots.radioAway).count).toBe(
    0,
  );
  state = await step(page, 1);
  expect(state.tick - barkTick).toBe(BARK_PAGE_TICKS);
  expect(state.complaints).toBe(4);
  const gone = await readTestFrame(page);
  await saveFrame(testInfo, 'radio_gone.png', gone, { atResultsRoot: true });
  expect(radioMismatches(warnModel(RadioSide.Away), gone, slots.radioAway).count).toBeGreaterThan(1_000);
  expect(errors).toEqual([]);
});
