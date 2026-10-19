// Drive-only ShiftScene in the shipping bundle (SSP-046, TECHNICAL_DESIGN §6, §18.5). No canonical golden: the
// frozen frames are written to test-results/ as review captures (`shift_start.png`, `shift_driven.png`) and
// opened with Read, while the spec checks what must hold exactly:
//
// - `?test=1&scene=district.puddle_lane&freeze=1` renders deterministically: two page loads read back the same
//   frame, byte for byte, within the draw-call budget (city, building shadows, Bessie's drop shadow, actors, items
//   (the depot bays, SSP-067), the HUD's UI batch (SSP-070), palette pass, blit: 8 of 10, §12.7);
// - `__ssp.step(n)` advances exactly n World ticks and renders exactly once (Renderer.renderCount via
//   `perf().renders`, read inside one evaluate so no animation frame can interleave), also with freeze=1;
// - `__ssp.state()` is the JSON-safe SimSnapshot (tick, bessie x/y/heading/speed, hp; since SSP-065 the sweeping
//   state: score, tidy, stars, hopper, water, combo, litter and grime counts, frontages) plus the camera;
// - `tick=600` in the URL gives `state().tick === 600` at ready;
// - the keyboard drives Bessie (W/↑ throttle, D steer right, Space brush) and the camera follows her.
import { writeFileSync } from 'node:fs';
import { expect, type Page, type TestInfo, test } from '@playwright/test';
import type { ShiftTestState, TestState } from '../../src/debug/testHooks.ts';
import { INTERNAL_HEIGHT_PX } from '../../src/render/upscale.ts';
import {
  collectPageErrors,
  encodeFramePng,
  frameSha256,
  openTestScene,
  type RgbaFrame,
  readTestFrame,
} from '../support/visualGolden.ts';

const SHIFT_URL = '/?test=1&seed=1&scene=district.puddle_lane&freeze=1';

/** Puddle Lane's depot start (public/assets/levels/puddle_lane.json `player`): body centre, facing north. */
const DEPOT_START = { x: 7, y: 89, heading: 0 } as const;

/**
 * City + building shadows + Bessie's drop shadow + actors batch + items batch + the HUD's UI batch (SSP-070) +
 * palette pass + blit.
 */
const EXPECTED_DRAW_CALLS = 8;

/** TECHNICAL_DESIGN §12.7. */
const DRAW_CALL_BUDGET = 10;

/** W at the visual project's 1920×1080 viewport. */
const EXPECTED_WIDTH_PX = 480;

async function shiftState(page: Page): Promise<ShiftTestState> {
  const state = await page.evaluate((): TestState => {
    const api = window.__ssp;
    if (api === undefined) throw new Error('window.__ssp missing');
    return api.state();
  });
  if (!('bessie' in state)) throw new Error(`state() is not a shift snapshot: ${JSON.stringify(state)}`);
  return state;
}

/** Writes a review capture into this test's output folder and attaches it to the report. */
async function saveCapture(testInfo: TestInfo, name: string, frame: RgbaFrame): Promise<void> {
  const path = testInfo.outputPath(name);
  writeFileSync(path, encodeFramePng(frame));
  await testInfo.attach(name, { path, contentType: 'image/png' });
  console.log(`[shift] ${name} ${frame.width}x${frame.height} sha256=${frameSha256(frame)} -> ${path}`);
}

test('the frozen shift frame is deterministic, within the draw-call budget, with Bessie at the depot', async ({
  page,
}, testInfo) => {
  const errors = collectPageErrors(page);
  await openTestScene(page, SHIFT_URL);
  const first = await readTestFrame(page);
  const state = await shiftState(page);
  const drawCalls = await page.evaluate(() => window.__ssp?.perf().drawCalls ?? -1);

  expect(first.width).toBe(EXPECTED_WIDTH_PX);
  expect(first.height).toBe(INTERNAL_HEIGHT_PX);
  expect(drawCalls).toBeLessThanOrEqual(DRAW_CALL_BUDGET);
  expect(drawCalls).toBe(EXPECTED_DRAW_CALLS);
  expect(state).toMatchObject({
    tick: 0,
    bessie: { x: DEPOT_START.x, y: DEPOT_START.y, heading: DEPOT_START.heading, speed: 0 },
    hp: 100,
    // Shift setup (SSP-065): Puddle Lane's litter and grime laid, nothing collected or cleaned yet, an empty
    // hopper, a full tank, no chain.
    score: 0,
    tidy: 0,
    stars: 0,
    hopper: { lu: 0, capacityLu: 100, full: false },
    water: { units: 100, capacity: 100 },
    combo: { chain: 0, multiplier: 1, timerTicks: 0, bestChain: 0 },
    litter: { spawned: 130, collected: 0 },
    grime: { initial: 9000, cleaned: 0 },
    // The follow camera stands over Bessie at the sweep height: test mode turns the look-ahead and zoom springs
    // off (no `springs=1`), and she is parked anyway.
    camera: { x: DEPOT_START.x, y: DEPOT_START.y, h: 31.5, leadX: 0, leadY: 0, pinned: false },
  });
  await saveCapture(testInfo, 'shift_start.png', first);

  // A second load of the same URL reads back the same frame, byte for byte.
  await openTestScene(page, SHIFT_URL);
  const second = await readTestFrame(page);
  expect(frameSha256(second)).toBe(frameSha256(first));
  expect(errors).toEqual([]);
});

test('step(n) advances exactly n ticks and renders exactly once, with freeze=1; state() is JSON-safe', async ({
  page,
}) => {
  const errors = collectPageErrors(page);
  await openTestScene(page, SHIFT_URL);
  const result = await page.evaluate(() => {
    const api = window.__ssp;
    if (api === undefined) throw new Error('window.__ssp missing');
    const steps: { tickDelta: number; renderDelta: number }[] = [];
    for (const n of [600, 0, 1, 59]) {
      const tick = api.state().tick;
      const renders = api.perf().renders;
      api.step(n);
      steps.push({ tickDelta: api.state().tick - tick, renderDelta: api.perf().renders - renders });
    }
    const state = api.state();
    return { steps, state, roundTrip: JSON.parse(JSON.stringify(state)) as unknown };
  });
  expect(result.steps).toEqual([
    { tickDelta: 600, renderDelta: 1 },
    { tickDelta: 0, renderDelta: 1 },
    { tickDelta: 1, renderDelta: 1 },
    { tickDelta: 59, renderDelta: 1 },
  ]);
  expect(result.state.tick).toBe(660);
  expect(result.roundTrip).toEqual(result.state);
  expect(Object.keys(result.state).sort()).toEqual([
    'bessie',
    'camera',
    'combo',
    'frontages',
    'grime',
    'hopper',
    'hp',
    'litter',
    'score',
    'stars',
    'tick',
    'tidy',
    'water',
  ]);

  // Frozen: animation frames keep rendering, but the World never steps by itself.
  await page.waitForTimeout(250);
  expect((await shiftState(page)).tick).toBe(660);
  expect(errors).toEqual([]);
});

test('tick=600 in the URL gives state().tick === 600 at ready', async ({ page }) => {
  const errors = collectPageErrors(page);
  await openTestScene(page, `${SHIFT_URL}&tick=600`);
  expect((await shiftState(page)).tick).toBe(600);
  expect(errors).toEqual([]);
});

test('the keyboard drives Bessie and the camera follows her (review capture)', async ({ page }, testInfo) => {
  const errors = collectPageErrors(page);
  await openTestScene(page, SHIFT_URL);
  // Brush down (Space edge), then 1.5 s of throttle (W) with 0.4 s of right steer (D) in the middle.
  await page.keyboard.press('Space');
  await page.keyboard.down('KeyW');
  await page.evaluate(() => window.__ssp?.step(45));
  await page.keyboard.down('KeyD');
  await page.evaluate(() => window.__ssp?.step(24));
  await page.keyboard.up('KeyD');
  await page.evaluate(() => window.__ssp?.step(21));
  await page.keyboard.up('KeyW');
  const state = await shiftState(page);
  expect(state.tick).toBe(90);
  expect(state.bessie.y).toBeLessThan(DEPOT_START.y - 2);
  expect(state.bessie.speed).toBeGreaterThan(1);
  expect(state.bessie.heading).toBeGreaterThan(0.05);
  // The camera's focus is Bessie's drawn (interpolated) pose: within one tick of travel of the sim pose.
  expect(Math.abs(state.camera.y - state.bessie.y)).toBeLessThan(0.25);
  expect(Math.abs(state.camera.x - state.bessie.x)).toBeLessThan(0.25);
  const frame = await readTestFrame(page);
  await saveCapture(testInfo, 'shift_driven.png', frame);
  expect(errors).toEqual([]);
});
