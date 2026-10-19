// The M2 HUD in the shipping bundle (SSP-070; GDD §15.2, ART_BIBLE §12.2; TECHNICAL_DESIGN §12.3, §12.7). Frames
// are saved to test-results/ as review captures (open them with Read; there is no golden until the M4
// `hud_specimen`), and the spec checks what must hold exactly, at the three widths the HUD must fit: 1920×1080
// (W = 480), 1440×1080 (W = 432) and 2560×1080 (W = 640):
//
// - `hud_sample` (every element at its widest, src/scenes/HudSampleScene.ts): every UI pixel equals a CPU
//   rasterisation of the same model (the real Hud drawing into tests/support/textRaster.ts from
//   public/assets/atlas/ui.png), every UI pixel lies inside the 4 px safe margin and inside its element's reserved
//   box, and the frame takes 5 draw calls (city, building shadows, the one UI draw, palette pass, blit);
// - the Puddle Lane shift at its first frame: the HUD (timer 4:00, score 0, empty hopper, full tank, full
//   Dignity) is pixel-exact, and the frame takes 8 draw calls (city, building shadows, Bessie's drop shadow, the
//   actors batch, the items batch (the depot bays, SSP-067), the HUD's UI draw, palette pass, blit), within the 10
//   allowed;
// - the hold-to-dump prompt, driven for real (W = 480): Bessie backs out of the depot start, turns into a depot
//   bay and stops; spraying for half a second leaves the tank below full, so the bay offers a dump and the prompt
//   appears with an empty ring; holding E for 30 ticks fills the ring to step 4 of 8; at 60 the drain starts and
//   the prompt disappears;
// - SSP-299: the sample shows the Brush-o-meter (fling zone), the brush state ring, the district name over the
//   Tidy % bar and both off-screen arrows at every width (every arrow pixel inside its 11×11 box, which the unit
//   tests keep 1 px clear of every reserved box), and the shift's first frame shows them at rest (transit
//   pattern, 0 mph, ▲, PUDDLE LANE, 0%); spraying parked at the depot start until the tank is below 20% brings up
//   the hydrant arrow, pointing at the nearer Puddle Lane hydrant.
import { expect, type Page, type TestInfo, test } from '@playwright/test';
import type { ShiftTestState, TestState } from '../../src/debug/testHooks.ts';
import { groundPxPerMetre, snapToTexelM } from '../../src/render/camera.ts';
import { KERBSIDE32 } from '../../src/render/palettePass.ts';
import { INTERNAL_HEIGHT_PX } from '../../src/render/upscale.ts';
import { hudSampleModel } from '../../src/scenes/HudSampleScene.ts';
import { HUD_FONT } from '../../src/scenes/ShiftScene.ts';
import { HUD_MARGIN_PX, Hud, type HudRect, hudLayout } from '../../src/ui/hud.ts';
import {
  ARROW_DIRS,
  ARROW_HALF_PX,
  createHudModel,
  createHudSnapshot,
  type HudArrow,
  type HudModel,
  type HudSnapshot,
  hudModel,
} from '../../src/ui/hudModel.ts';
import { readBitmapFont, readIndexedAtlas, TextRaster } from '../support/textRaster.ts';
import { collectPageErrors, openTestScene, type RgbaFrame, readTestFrame } from '../support/visualGolden.ts';
import { saveFrame } from './helpers/saveFrame.ts';

/** The three widths (TECHNICAL_DESIGN §12.1: W = clampEven(round(270 × aspect), 432, 640)). */
const VIEWPORTS = [
  { width: 1920, height: 1080, internalWidth: 480 },
  { width: 1440, height: 1080, internalWidth: 432 },
  { width: 2560, height: 1080, internalWidth: 640 },
] as const;

const SAMPLE_URL = '/?test=1&seed=1&scene=hud_sample&freeze=1';
const SHIFT_URL = '/?test=1&seed=1&scene=district.puddle_lane&freeze=1';

/** City + building shadows + UI batch + palette pass + blit. */
const SAMPLE_DRAW_CALLS = 5;
/** City + building shadows + Bessie's drop shadow + actors batch + items batch + HUD batch + palette pass + blit. */
const SHIFT_DRAW_CALLS = 8;
/** TECHNICAL_DESIGN §12.7. */
const DRAW_CALL_BUDGET = 10;

/** Puddle Lane's first depot bay (public/assets/levels/puddle_lane.json sites: tiles [6, 42, 8, 45]), metres. */
const BAY = { x0: 12, y0: 84, x1: 16, y1: 90 } as const;

const font = readBitmapFont(HUD_FONT);
const uiAtlas = readIndexedAtlas('ui');

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

/** `model` drawn on the CPU by the real Hud at width `w`. */
function rasterise(model: HudModel, w: number): TextRaster {
  const raster = new TextRaster(w, INTERNAL_HEIGHT_PX, uiAtlas);
  new Hud(raster, font).drawModel(model, w);
  return raster;
}

/** UI pixels of `raster` (optionally only inside `rect`) whose frame colour differs (first few listed). */
function uiMismatches(
  raster: TextRaster,
  frame: RgbaFrame,
  rect?: HudRect,
): { count: number; first: string[] } {
  let count = 0;
  const first: string[] = [];
  const x0 = rect?.x ?? 0;
  const y0 = rect?.y ?? 0;
  const x1 = rect === undefined ? raster.width : rect.x + rect.w;
  const y1 = rect === undefined ? raster.height : rect.y + rect.h;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
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

async function shiftState(page: Page): Promise<ShiftTestState> {
  const state = await page.evaluate((): TestState => {
    const api = window.__ssp;
    if (api === undefined) throw new Error('window.__ssp missing');
    return api.state();
  });
  if (!('bessie' in state)) throw new Error(`state() is not a shift snapshot: ${JSON.stringify(state)}`);
  return state;
}

async function step(page: Page, n = 1): Promise<ShiftTestState> {
  await page.evaluate((ticks) => window.__ssp?.step(ticks), n);
  return shiftState(page);
}

/** Puddle Lane's hydrants (public/assets/levels/puddle_lane.json props), metres. */
const HYDRANTS = { x: [77, 51], y: [7, 15] } as const;

/** The 11×11 box of an arrow. */
function arrowBox(a: HudArrow): HudRect {
  const size = 2 * ARROW_HALF_PX + 1;
  return { x: a.xPx - ARROW_HALF_PX, y: a.yPx - ARROW_HALF_PX, w: size, h: size };
}

/**
 * The snapshot of the shift's first frame: the timer not yet started, nothing collected, full tank and Dignity,
 * the brush raised and Bessie parked (SSP-299: PUDDLE LANE at 0%, the transit meter at 0 mph, ▲).
 */
function shiftStartSnapshot(): HudSnapshot {
  const s = createHudSnapshot();
  s.ticksRemaining = 14_400;
  s.hopperCapacityLu = 100;
  s.hopperWarnFraction = 0.8;
  s.water = 100;
  s.tankUnits = 100;
  s.hp = 100;
  s.maxHp = 100;
  s.dentedBelowHp = 40;
  s.districtName = 'PUDDLE LANE';
  return s;
}

function shiftStartModel(): HudModel {
  return hudModel(shiftStartSnapshot(), 0);
}

/** The dump prompt alone (the rest of the model is whatever shiftStartModel holds). */
function dumpModel(ringStep: number | null): HudModel {
  const model = shiftStartModel();
  model.dump.visible = true;
  model.dump.ringVisible = ringStep !== null;
  model.dump.ringStep = ringStep ?? 0;
  return model;
}

for (const viewport of VIEWPORTS) {
  const w = viewport.internalWidth;

  test(`hud_sample at W = ${w}: every HUD pixel exact, inside the margin and its box, in 5 draw calls`, async ({
    page,
  }, testInfo: TestInfo) => {
    const errors = collectPageErrors(page);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await openTestScene(page, SAMPLE_URL);
    const frame = await readTestFrame(page);
    await saveFrame(testInfo, `hud_sample_w${w}.png`, frame);
    expect([frame.width, frame.height]).toEqual([w, INTERNAL_HEIGHT_PX]);

    const sample = hudSampleModel(createHudModel(), hudLayout(font, w).arrowFrame);
    expect([sample.depotArrow.visible, sample.hydrantArrow.visible]).toEqual([true, true]);
    const raster = rasterise(sample, w);
    expect(raster.covered, 'the sample draws thousands of HUD pixels').toBeGreaterThan(3_000);
    const mismatches = uiMismatches(raster, frame);
    expect(mismatches.first).toEqual([]);
    expect(mismatches.count).toBe(0);

    // Inside the 4 px margin, and inside the union of the reserved boxes (which the unit test proves disjoint).
    const boxes = [
      ...Object.values(hudLayout(font, w).reserved),
      arrowBox(sample.depotArrow),
      arrowBox(sample.hydrantArrow),
    ];
    const outside: string[] = [];
    for (let y = 0; y < raster.height; y++) {
      for (let x = 0; x < raster.width; x++) {
        if (raster.at(x, y) < 0) continue;
        const inMargin =
          x >= HUD_MARGIN_PX &&
          y >= HUD_MARGIN_PX &&
          x < w - HUD_MARGIN_PX &&
          y < INTERNAL_HEIGHT_PX - HUD_MARGIN_PX;
        const inBox = boxes.some((b) => x >= b.x && y >= b.y && x < b.x + b.w && y < b.y + b.h);
        if ((!inMargin || !inBox) && outside.length < 8) outside.push(`(${x}, ${y})`);
      }
    }
    expect(outside).toEqual([]);

    const calls = await drawCalls(page);
    expect(calls).toBeLessThanOrEqual(DRAW_CALL_BUDGET);
    expect(calls).toBe(SAMPLE_DRAW_CALLS);
    expect(errors).toEqual([]);
  });

  test(`the shift's HUD at W = ${w} is pixel-exact in 8 draw calls`, async ({ page }, testInfo) => {
    const errors = collectPageErrors(page);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await openTestScene(page, SHIFT_URL);
    const frame = await readTestFrame(page);
    await saveFrame(testInfo, `hud_shift_w${w}.png`, frame);
    expect(frame.width).toBe(w);
    const mismatches = uiMismatches(rasterise(shiftStartModel(), w), frame);
    expect(mismatches.first).toEqual([]);
    expect(mismatches.count).toBe(0);
    const calls = await drawCalls(page);
    expect(calls).toBeLessThanOrEqual(DRAW_CALL_BUDGET);
    expect(calls).toBe(SHIFT_DRAW_CALLS);
    expect(errors).toEqual([]);
  });
}

test('the hold-to-dump prompt appears in a depot bay, fills over the hold and goes when the drain starts', async ({
  page,
}, testInfo) => {
  const errors = collectPageErrors(page);
  await openTestScene(page, SHIFT_URL);
  const kb = page.keyboard;
  let state = await shiftState(page);

  // Back out of the start (S held at a standstill engages reverse) to y >= 92 m, then brake with W.
  await kb.down('KeyS');
  while (state.bessie.y < 92 && state.tick < 400) state = await step(page);
  await kb.up('KeyS');
  await kb.down('KeyW');
  while (state.bessie.speed < -0.3 && state.tick < 600) state = await step(page);
  await kb.up('KeyW');
  while (state.bessie.speed < 0 && state.tick < 700) state = await step(page);
  // Full right lock with throttle until she faces (nearly) east, then straighten and run into the bay.
  await kb.down('KeyW');
  await kb.down('KeyD');
  while (state.bessie.heading < Math.PI / 2 - 0.15 && state.tick < 900) state = await step(page);
  await kb.up('KeyD');
  while (state.bessie.x < 13 && state.tick < 1200) state = await step(page);
  await kb.up('KeyW');
  await kb.down('KeyS');
  while (state.bessie.speed > 0.15 && state.tick < 1500) state = await step(page);
  await kb.up('KeyS');
  state = await step(page, 60);
  const { x, y, speed } = state.bessie;
  expect(x, 'in the bay').toBeGreaterThanOrEqual(BAY.x0);
  expect(x).toBeLessThanOrEqual(BAY.x1);
  expect(y).toBeGreaterThanOrEqual(BAY.y0);
  expect(y).toBeLessThanOrEqual(BAY.y1);
  expect(Math.abs(speed)).toBeLessThan(0.5);
  const prompt = hudLayout(font, 480).reserved.dump;

  // Full tank and an empty hopper: nothing to dump, no prompt. Bessie is parked and the camera still, so this
  // frame is the street under the prompt's box for the checks below.
  expect(state.water.units).toBe(state.water.capacity);
  const street = await readTestFrame(page);
  const promptPixels = rasterise(dumpModel(null), 480);
  expect(uiMismatches(promptPixels, street, prompt).count, 'no prompt yet').toBeGreaterThan(200);

  // Half a second of spray: the bay can now refill the tank, so it offers a dump.
  await kb.down('ShiftLeft');
  state = await step(page, 30);
  await kb.up('ShiftLeft');
  state = await step(page, 1);
  expect(state.water.units).toBeLessThan(state.water.capacity);
  let frame = await readTestFrame(page);
  await saveFrame(testInfo, 'hud_dump_prompt.png', frame);
  let m = uiMismatches(rasterise(dumpModel(null), 480), frame, prompt);
  expect(m.first, 'the prompt with an empty ring').toEqual([]);

  // Hold E for 30 ticks: hold tick 30 of 60, ring step floor(30 × 8 / 60) = 4.
  await kb.down('KeyE');
  state = await step(page, 30);
  frame = await readTestFrame(page);
  await saveFrame(testInfo, 'hud_dump_holding.png', frame);
  m = uiMismatches(rasterise(dumpModel(4), 480), frame, prompt);
  expect(m.first, 'the ring at step 4').toEqual([]);

  // Hold tick 60 starts the drain (the depot bay refills the tank at once): the prompt goes.
  state = await step(page, 30);
  await kb.up('KeyE');
  expect(state.water.units).toBe(state.water.capacity);
  frame = await readTestFrame(page);
  await saveFrame(testInfo, 'hud_dump_draining.png', frame);
  const changed: string[] = [];
  for (let py = prompt.y; py < prompt.y + prompt.h; py++) {
    for (let px = prompt.x; px < prompt.x + prompt.w; px++) {
      if (pixelIndex(frame, px, py) !== pixelIndex(street, px, py) && changed.length < 8)
        changed.push(`(${px}, ${py})`);
    }
  }
  expect(changed, 'the prompt has gone: the street shows through again').toEqual([]);
  expect(errors).toEqual([]);
});

test('spraying the tank below 20% brings up the hydrant arrow, pointing at the nearer hydrant', async ({
  page,
}, testInfo) => {
  const errors = collectPageErrors(page);
  await openTestScene(page, SHIFT_URL);
  let state = await shiftState(page);
  const start = { x: state.bessie.x, y: state.bessie.y };
  await page.keyboard.down('ShiftLeft');
  // 6 units/s from 100: 20.0 is left after 800 ticks, under 20 from the next.
  state = await step(page, 799);
  expect(state.water.units).toBeGreaterThan(20);
  const before = await readTestFrame(page);
  state = await step(page, 3);
  await page.keyboard.up('ShiftLeft');
  state = await step(page, 1);
  expect(state.water.units).toBeLessThan(20);
  expect([state.bessie.x, state.bessie.y]).toEqual([start.x, start.y]);
  const frame = await readTestFrame(page);
  await saveFrame(testInfo, 'hud_hydrant_arrow.png', frame);

  // The model at this frame: the shift start plus the water, Bessie, the hydrants and the camera.
  const s = shiftStartSnapshot();
  s.water = state.water.units;
  s.tidyPpm = Math.round(state.tidy * 1_000_000);
  s.bessieXM = state.bessie.x;
  s.bessieYM = state.bessie.y;
  s.hydrantCount = 2;
  s.hydrantX = HYDRANTS.x;
  s.hydrantY = HYDRANTS.y;
  s.cameraXM = snapToTexelM(state.camera.x);
  s.cameraYM = snapToTexelM(state.camera.y);
  s.cameraPxPerM = groundPxPerMetre(state.camera.h);
  const model = hudModel(s, state.tick, createHudModel(), hudLayout(font, 480).arrowFrame);
  const arrow = model.hydrantArrow;
  expect(arrow.visible).toBe(true);
  expect(arrow.target, 'the hydrant at (51, 15) m is nearer than (77, 7) m').toBe(1);
  expect(ARROW_DIRS[arrow.dir]).toBe('ne');
  const box = arrowBox(arrow);
  const m = uiMismatches(rasterise(model, 480), frame, box);
  expect(m.first, 'the hydrant arrow, pixel-exact in its box').toEqual([]);
  // It was not there before the tank went below 20%.
  expect(uiMismatches(rasterise(model, 480), before, box).count).toBeGreaterThan(20);
  expect(errors).toEqual([]);
});
