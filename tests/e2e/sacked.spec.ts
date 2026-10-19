// SACKED! by real input in the shipping bundle (SSP-079; GDD §11.3, §15.1, §15.3; TECHNICAL_DESIGN §6.2):
// Playwright honks H twenty times on Puddle Lane, a press every 15 ticks. Under the horn-spam re-arm rule
// (SSP-078: more than 3 honks in 5 s is one Noise complaint, which clears the window) every 4th honk files a
// complaint, so the 20th files the 5th and the shift ends SACKED on that tick. Puddle Lane has no litterbug,
// so no honk is a Caught!. The spec asserts that:
// - state().complaints climbs 1 per 4 honks, and the 20th honk's tick ends the shift with reason 'sacked';
// - the tally comes up showing SACKED! (in 18), the Tidy %, the score as it stood and no stars, with Try Again
//   focused: every UI pixel equals the CPU rasterisation of that layout;
// - Try Again (Enter, the default focus) reaches a running ShiftScene within 3 s, at tick 0 with an empty
//   meter, and `__ssp.sceneHistory()` never shows the intro card.
// Frames are saved to test-results/ as review captures (open them with Read): sacked_tally.png, sacked_retry.png.
import { expect, type Page, test } from '@playwright/test';
import type { ShiftTestState, TestState } from '../../src/debug/testHooks.ts';
import { INTERNAL_HEIGHT_PX } from '../../src/render/upscale.ts';
import { TALLY_INPUT_LOCK_TICKS } from '../../src/scenes/TallyScene.ts';
import type { SimSnapshot } from '../../src/sim/snapshot.ts';
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

const SHIFT_URL = '/?test=1&seed=1&scene=district.puddle_lane&freeze=1';
/** W at the ci project's 1920×1080 viewport. */
const WIDTH_PX = 480;
/** Ticks between the honks: four span 45 ticks, well inside the 300-tick window. */
const PRESS_EVERY_TICKS = 15;
/** GDD §11.3: Try Again restarts the shift in under 3 s. */
const RETRY_BUDGET_MS = 3000;

async function sceneId(page: Page): Promise<string | null> {
  return page.evaluate(() => window.__ssp?.scene() ?? null);
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

async function step(page: Page, n: number): Promise<void> {
  await page.evaluate((ticks) => window.__ssp?.step(ticks), n);
}

/** The sim part of a shift state (the camera stripped). */
function sim(state: ShiftTestState): SimSnapshot {
  const { camera: _camera, ...rest } = state;
  return rest;
}

test('twenty honks on Puddle Lane end the shift SACKED; the tally shows it; Try Again restarts in under 3 s', async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  const errors = collectPageErrors(page);
  await openTestScene(page, SHIFT_URL);
  expect(await sceneId(page)).toBe('shift');
  const start = await shiftState(page);
  expect(start.complaints).toBe(0);

  // Twenty honks, one every 15 ticks (each H press is latched into the next tick).
  let state = start;
  for (let honk = 1; honk <= 20; honk++) {
    if (honk > 1) await step(page, PRESS_EVERY_TICKS - 1);
    await page.keyboard.press('KeyH');
    await step(page, 1);
    state = await shiftState(page);
    expect(state.complaints, `after honk ${honk}`).toBe(Math.floor(honk / 4));
    expect(state.shift.phase, `after honk ${honk}`).toBe(
      honk < 20 ? (honk < 13 ? 'rollout' : 'running') : 'ended',
    );
  }
  expect(state.shift.endReason).toBe('sacked');
  expect(state.shift.endTick).toBe(state.tick - 1);
  expect(state.shift.finalStars).toBe(0);
  expect(state.shift.finalScore).toBe(state.score);

  // The tally, with the snapshot the shift ended with.
  await page.waitForFunction(() => window.__ssp?.scene() === 'tally');
  const end = await shiftState(page);
  expect(sim(end)).toEqual(sim(state));
  const figures = tallyFigures(sim(end), 'PUDDLE LANE');
  expect(figures).toMatchObject({ reason: 'SACKED!', failed: true, stars: 0 });
  const tallyItems = tallyPageLayout(
    uiFont,
    WIDTH_PX,
    INTERNAL_HEIGHT_PX,
    figures,
    tallyButtonStates(TallyButton.TryAgain),
  );
  const shown = uiItemStrings(tallyItems);
  expect(shown[0]).toBe('SACKED!');
  expect(shown.slice(shown.indexOf('SCORE'), shown.indexOf('SCORE') + 2)).toEqual([
    'SCORE',
    Math.round(end.score).toLocaleString('en-GB'),
  ]);
  expect(shown.filter((s) => s === STAR)).toHaveLength(3);
  expect(tallyItems[1]).toMatchObject({ kind: 'text', text: 'SACKED!', colour: 18 });
  // No star is earned: all three are the plain 04 ones.
  expect(tallyItems.filter((i) => i.kind === 'text' && i.text === STAR && i.colour === 15)).toEqual([]);
  await step(page, 0);
  const tallyFrame = await readTestFrame(page);
  await saveFrame(testInfo, 'sacked_tally.png', tallyFrame);
  // Every UI pixel as laid out with Try Again focused: the default focus after SACKED (GDD §15.3).
  const mismatches = uiMismatches(rasterise(tallyItems, WIDTH_PX), tallyFrame);
  expect(mismatches.first).toEqual([]);
  expect(mismatches.count).toBe(0);

  // Try Again, once the input lock has passed: a running shift on the same seed, the intro card skipped.
  await step(page, TALLY_INPUT_LOCK_TICKS);
  const pressedAt = Date.now();
  await page.keyboard.press('Enter');
  await step(page, 1);
  await page.waitForFunction(
    () => window.__ssp?.scene() === 'shift' && window.__ssp.state().tick === 0,
    null,
    { polling: 10 },
  );
  const restartMs = Date.now() - pressedAt;
  console.log(`[sacked] Try Again → shift active in ${restartMs} ms`);
  expect(restartMs).toBeLessThan(RETRY_BUDGET_MS);
  const again = await shiftState(page);
  expect(sim(again)).toEqual(sim(start));
  expect(again.complaints).toBe(0);
  // Running: the World steps again, and throttle starts the timer.
  await page.keyboard.down('KeyW');
  await step(page, 30);
  await page.keyboard.up('KeyW');
  const driving = await shiftState(page);
  expect(driving.tick).toBe(30);
  expect(driving.shift.phase).toBe('running');
  expect(driving.bessie.y).toBeLessThan(start.bessie.y);
  await saveFrame(testInfo, 'sacked_retry.png', await readTestFrame(page));
  const history = await page.evaluate(() => window.__ssp?.sceneHistory());
  // BootScene (SSP-284) loads the assets first, then hands off straight to the shift scene.
  expect(history).toEqual(['boot', 'shift', 'tally', 'shift']);
  expect(history).not.toContain('shift_intro');
  expect(errors).toEqual([]);
});
