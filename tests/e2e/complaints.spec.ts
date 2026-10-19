// Horn spam on Puddle Lane in the shipping bundle (SSP-078; GDD §11.2, §15.2; ART_BIBLE §12.2): Playwright
// presses H four times within 5 s of sim time (a press every 30 ticks, each edge latched into the next tick),
// and the fourth honk files one Noise complaint: state().complaints goes 0 → 1 on that tick and the HUD's
// complaints meter stamps one box. Frames saved to test-results/ as review captures (open them with Read):
//
//   complaints_slam.png      the first frame after the complaint: box 1 shows the solid stamp face (slam frame 0);
//   complaints_one_stamp.png 30 ticks later: box 1 stamped at rest, boxes 2–5 empty.
//
// Each capture's meter (its reserved box, src/ui/hud.ts hudLayout) must equal the same model drawn on the CPU
// from public/assets/atlas/ui.png, pixel for pixel. Puddle Lane has no litterbug, so no honk is a Caught!.
import { expect, type Page, test } from '@playwright/test';
import type { ShiftTestState, TestState } from '../../src/debug/testHooks.ts';
import { KERBSIDE32 } from '../../src/render/palettePass.ts';
import { INTERNAL_HEIGHT_PX } from '../../src/render/upscale.ts';
import { HUD_FONT } from '../../src/scenes/ShiftScene.ts';
import { Hud, type HudRect, hudLayout } from '../../src/ui/hud.ts';
import { ComplaintSlotState, createHudModel, type HudModel } from '../../src/ui/hudModel.ts';
import { readBitmapFont, readIndexedAtlas, TextRaster } from '../support/textRaster.ts';
import { collectPageErrors, openTestScene, type RgbaFrame, readTestFrame } from '../support/visualGolden.ts';
import { saveFrame } from './helpers/saveFrame.ts';

const SHIFT_URL = '/?test=1&seed=1&scene=district.puddle_lane&freeze=1';
/** 1920×1080 gives W = 480 (playwright.config.ts VISUAL_VIEWPORT). */
const W = 480;
/** Ticks between the presses: four honks span 90 ticks (1.5 s), well inside the 300-tick window. */
const PRESS_EVERY_TICKS = 30;

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

/** The meter alone, with `states` in its five boxes at rest. */
function meterModel(states: readonly ComplaintSlotState[]): HudModel {
  const m = createHudModel();
  m.complaints.visible = true;
  m.complaints.slots.forEach((slot, i) => {
    slot.state = states[i] ?? ComplaintSlotState.Empty;
    slot.dx = 0;
  });
  return m;
}

/** Meter pixels of `model` whose frame colour differs inside `box` (count and the first few). */
function meterMismatches(
  model: HudModel,
  frame: RgbaFrame,
  box: HudRect,
): { count: number; first: string[] } {
  const raster = new TextRaster(W, INTERNAL_HEIGHT_PX, uiAtlas);
  new Hud(raster, font).drawModel(model, W);
  let count = 0;
  const first: string[] = [];
  for (let y = box.y; y < box.y + box.h; y++) {
    for (let x = box.x; x < box.x + box.w; x++) {
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

test('four honks within 5 s on Puddle Lane file one Noise complaint and stamp one box', async ({
  page,
}, testInfo) => {
  const errors = collectPageErrors(page);
  await openTestScene(page, SHIFT_URL);
  const box = hudLayout(font, W).reserved.complaints;
  let state = await shiftState(page);
  expect(state.complaints).toBe(0);
  const empty = await readTestFrame(page);
  const { Empty, Slam, Stamped } = ComplaintSlotState;
  expect(meterMismatches(meterModel([Empty, Empty, Empty, Empty, Empty]), empty, box).count).toBe(0);

  const startTick = state.tick;
  for (let honk = 1; honk <= 4; honk++) {
    if (honk > 1) state = await step(page, PRESS_EVERY_TICKS - 1);
    await page.keyboard.press('KeyH');
    state = await step(page, 1);
    expect(state.complaints, `after honk ${honk}`).toBe(honk < 4 ? 0 : 1);
  }
  // All four inside 5 s of sim time.
  expect(state.tick - startTick).toBeLessThan(300);

  // The first frame after the complaint: the stamp's slam (frame 0, the solid face, 1 px right).
  const slam = await readTestFrame(page);
  await saveFrame(testInfo, 'complaints_slam.png', slam, { atResultsRoot: true });
  const slamModel = meterModel([Slam, Empty, Empty, Empty, Empty]);
  const first = slamModel.complaints.slots[0];
  if (first !== undefined) first.dx = 1;
  const slamMismatch = meterMismatches(slamModel, slam, box);
  expect(slamMismatch.first).toEqual([]);

  // At rest: exactly one stamped box.
  state = await step(page, 30);
  expect(state.complaints).toBe(1);
  const frame = await readTestFrame(page);
  await saveFrame(testInfo, 'complaints_one_stamp.png', frame, { atResultsRoot: true });
  const mismatches = meterMismatches(meterModel([Stamped, Empty, Empty, Empty, Empty]), frame, box);
  expect(mismatches.first).toEqual([]);
  expect(mismatches.count).toBe(0);
  expect(errors).toEqual([]);
});
