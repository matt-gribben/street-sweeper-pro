// The shift flow in the shipping bundle (SSP-071; TECHNICAL_DESIGN §6.2, §18.5; GDD §11.3, §15.1). The default
// boot (no `scene`) is the intro card; the spec plays the whole loop with real key presses:
//
//   intro card → Space → shift (brush down, a short drive) → step to the end of the 240 s timer and the knock-off
//   coast → numbers-only tally → Enter on Try Again → a fresh shift on the same seed, the intro skipped.
//
// It asserts that:
// - every UI pixel of the intro card and of the tally equals a CPU rasterisation of the same layout
//   (src/ui/introCard.ts, src/ui/tallyPage.ts drawn into tests/support/textRaster.ts from ui.png), so the screen
//   shows exactly those strings;
// - the tally's end reason, Tidy %, items collected/spawned, grime cleaned/initial, score and would-be stars match
//   `__ssp.state()` (formatted here independently of tallyPage.ts);
// - Try Again restarts the same seed with the intro skipped: `__ssp.state().tick` is back to 0, the start state
//   equals the first shift's, `__ssp.sceneHistory()` never shows a second intro, and the shift scene is active
//   within 3 s of the key press;
// - the card and the tally draw in 3 calls (UI batch, palette pass, blit), and nothing logs an error.
// Frames are saved to test-results/ as review captures (open them with Read).
import { expect, type Page, test } from '@playwright/test';
import type { ShiftTestState } from '../../src/debug/testHooks.ts';
import { INTERNAL_HEIGHT_PX } from '../../src/render/upscale.ts';
import { TALLY_INPUT_LOCK_TICKS } from '../../src/scenes/TallyScene.ts';
import type { SimSnapshot } from '../../src/sim/snapshot.ts';
import { IntroStatus, introCardLayout } from '../../src/ui/introCard.ts';
import {
  STAR,
  TallyButton,
  tallyButtonStates,
  tallyFigures,
  tallyPageLayout,
} from '../../src/ui/tallyPage.ts';
import { uiItemStrings } from '../../src/ui/uiItems.ts';
import { collectPageErrors, openTestScene, readTestFrame } from '../support/visualGolden.ts';
import { saveFrame } from './helpers/saveFrame.ts';
import { rasterise, uiFont, uiMismatches } from './helpers/uiPixels.ts';

/** The default boot: the intro card for Puddle Lane, frozen so only `step(n)` advances ticks. */
const FLOW_URL = '/?test=1&seed=5&freeze=1';

/** W at the ci project's 1920×1080 viewport. */
const WIDTH_PX = 480;

/** GDD §11.3: Try Again restarts the shift in under 3 s. */
const RETRY_BUDGET_MS = 3000;

/** UI batch + palette pass + blit (uiScreen.ts). */
const UI_SCREEN_DRAW_CALLS = 3;

/** More than the longest shift: a 3 s rollout, 14,400 timer ticks and the knock-off coast. */
const PAST_THE_END_TICKS = 15_600;

const font = uiFont;

async function sceneId(page: Page): Promise<string | null> {
  return page.evaluate(() => window.__ssp?.scene() ?? null);
}

async function shiftState(page: Page): Promise<ShiftTestState> {
  const state = await page.evaluate(() => window.__ssp?.state());
  if (state === undefined || !('bessie' in state))
    throw new Error(`no shift state: ${JSON.stringify(state)}`);
  return state;
}

async function step(page: Page, n: number): Promise<void> {
  await page.evaluate((ticks) => window.__ssp?.step(ticks), n);
}

async function drawCalls(page: Page): Promise<number> {
  return page.evaluate(() => window.__ssp?.perf().drawCalls ?? -1);
}

/** The sim part of a shift state (the camera stripped). */
function sim(state: ShiftTestState): SimSnapshot {
  const { camera: _camera, ...rest } = state;
  return rest;
}

/** An integer with thousands separators, written independently of tallyPage.ts. */
function grouped(n: number): string {
  return Math.round(n).toLocaleString('en-GB');
}

test('intro → Space → full shift → tally matching state() → Try Again restarts the seed in under 3 s', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const errors = collectPageErrors(page);
  await openTestScene(page, FLOW_URL);
  expect(await sceneId(page)).toBe('shift_intro');

  // The card, once the level has loaded behind it (§6.3): every UI pixel as laid out.
  const introRaster = rasterise(
    introCardLayout(font, WIDTH_PX, INTERNAL_HEIGHT_PX, 'district.puddle_lane', IntroStatus.Ready),
    WIDTH_PX,
  );
  await expect
    .poll(async () => uiMismatches(introRaster, await readTestFrame(page)).count, { timeout: 10_000 })
    .toBe(0);
  const introFrame = await readTestFrame(page);
  await saveFrame(testInfo, 'flow_intro.png', introFrame);
  expect(introRaster.covered).toBeGreaterThan(10_000);
  expect(await drawCalls(page)).toBe(UI_SCREEN_DRAW_CALLS);

  // Space starts the shift.
  await page.keyboard.press('Space');
  await step(page, 1);
  await page.waitForFunction(() => window.__ssp?.scene() === 'shift');
  const start = await shiftState(page);
  expect(start.tick).toBe(0);
  expect(start.shift.phase).toBe('rollout');

  // Brush down, drive north for 1.5 s, then let the timer run out and the knock-off coast finish.
  await page.keyboard.press('Space');
  await page.keyboard.down('KeyW');
  await step(page, 90);
  await page.keyboard.up('KeyW');
  const driven = await shiftState(page);
  expect(driven.tick).toBe(90);
  expect(driven.bessie.y).toBeLessThan(start.bessie.y);
  await step(page, PAST_THE_END_TICKS);
  await page.waitForFunction(() => window.__ssp?.scene() === 'tally');

  // The tally: state() is the snapshot the shift ended with.
  const end = await shiftState(page);
  expect(end.shift.phase).toBe('ended');
  expect(end.shift.endReason).toBe('time_up');
  expect(end.tick).toBe(end.shift.endTick + 1);
  expect(end.grime.cleaned).toBeGreaterThan(0);
  const figures = tallyFigures(sim(end), 'PUDDLE LANE');
  const tallyItems = tallyPageLayout(
    font,
    WIDTH_PX,
    INTERNAL_HEIGHT_PX,
    figures,
    tallyButtonStates(TallyButton.TryAgain),
  );
  const shown = uiItemStrings(tallyItems);
  expect(shown).toEqual([
    'TIME UP!',
    'PUDDLE LANE',
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
  ]);
  const earned = end.tidy >= 0.92 ? 3 : end.tidy >= 0.8 ? 2 : end.tidy >= 0.6 ? 1 : 0;
  expect(end.stars).toBe(earned);
  expect(figures.stars).toBe(earned);
  await step(page, 0);
  const tallyFrame = await readTestFrame(page);
  await saveFrame(testInfo, 'flow_tally.png', tallyFrame);
  const tallyMismatches = uiMismatches(rasterise(tallyItems, WIDTH_PX), tallyFrame);
  expect(tallyMismatches.first).toEqual([]);
  expect(tallyMismatches.count).toBe(0);
  expect(await drawCalls(page)).toBe(UI_SCREEN_DRAW_CALLS);

  // Try Again (the default focus) once the input lock has passed: the same seed, the intro skipped, under 3 s.
  await step(page, TALLY_INPUT_LOCK_TICKS);
  const pressedAt = Date.now();
  await page.keyboard.press('Enter');
  await step(page, 1);
  await page.waitForFunction(
    () => window.__ssp?.scene() === 'shift' && window.__ssp.state().tick === 0,
    null,
    {
      polling: 10,
    },
  );
  const restartMs = Date.now() - pressedAt;
  console.log(`[flow] Try Again → shift active in ${restartMs} ms`);
  expect(restartMs).toBeLessThan(RETRY_BUDGET_MS);
  const again = await shiftState(page);
  expect(sim(again)).toEqual(sim(start));
  expect(await page.evaluate(() => window.__ssp?.sceneHistory())).toEqual([
    'shift_intro',
    'shift',
    'tally',
    'shift',
  ]);
  await step(page, 30);
  expect((await shiftState(page)).tick).toBe(30);
  await saveFrame(testInfo, 'flow_retry.png', await readTestFrame(page));
  expect(errors).toEqual([]);
});
