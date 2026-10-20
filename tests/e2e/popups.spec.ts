// World-space score popups and speech bubbles on Puddle Lane in the shipping bundle (SSP-288; GDD §15.2, ART_BIBLE
// §11, AUDIO_DESIGN §13.2; TECHNICAL_DESIGN §7.2, §12.7). The spec boots Puddle Lane straight into a shift on the M2
// full-shift replay's seed and inputs (`__ssp.loadInputs`), plays them to World tick 9,610, where two real pickups
// (ticks 9,566 and 9,588, one popup risen and one younger) are still floating up near Bessie, then injects
// (`__ssp.injectEvent`, presentation only) what the replay does not produce near that tick (its careful driver hits
// nobody, and no real bubble or penalty popup is up then): a shopper's hit ("Oi!"), a car's honk ("!"), a ×3 pickup
// and a −250 penalty, each a few metres from Bessie. (The capture moved from tick 3,110 when SSP-104 re-generated the
// replay's inputs for the populated Puddle Lane.) Then:
//
// - the frame (captured to test-results/popups_puddle_lane.png, opened with Read for review) shows them, and every
//   popup and bubble pixel outside the HUD's reserved boxes equals a CPU rasterisation of the same popups layer: the
//   replay run headlessly in Node into src/ui/popups.ts over tests/support/textRaster.ts, with the same injected
//   events, at the browser's camera. So the projection, the tier colours, the rise and the bubble panels are exact;
// - the frame still takes 8 draw calls (the popups share the HUD's UI draw), within the 10 allowed;
// - under the PauseOverlay the popups freeze: 30 paused ticks leave the frame byte for byte the same;
// - resumed, 120 ticks later every popup and bubble is gone (the CPU layer agrees: none left to draw).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, type Page, test } from '@playwright/test';
import { EventBus } from '../../src/app/events.ts';
import type { ShiftTestState } from '../../src/debug/testHooks.ts';
import { groundPxPerMetre, snapToTexelM } from '../../src/render/camera.ts';
import { HUD_FONT } from '../../src/scenes/ShiftScene.ts';
import { Offence } from '../../src/sim/complaints.ts';
import { NPC_IDS } from '../../src/sim/entities.ts';
import {
  createEventQueue,
  EV,
  type EventType,
  pushEvent,
  resetEvents,
  sealEvents,
} from '../../src/sim/eventQueue.ts';
import { createInputFrame } from '../../src/sim/inputFrame.ts';
import { decodeLevel } from '../../src/sim/map.ts';
import { loadReplay, readInput } from '../../src/sim/replay.ts';
import { DEFAULT_TUNING } from '../../src/sim/tuning.ts';
import { createWorld, viewWorld } from '../../src/sim/world.ts';
import { BUBBLE_HONK, BUBBLE_OI, createPopupCamera, Popups } from '../../src/ui/popups.ts';
import { hudBoxesPx } from '../support/hudCover.ts';
import { readBitmapFont, readIndexedAtlas, TextRaster } from '../support/textRaster.ts';
import { collectPageErrors, openTestScene, readTestFrame } from '../support/visualGolden.ts';
import { saveFrame } from './helpers/saveFrame.ts';
import { pixelIndex } from './helpers/uiPixels.ts';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const REPLAY = loadReplay(
  readFileSync(`${REPO_ROOT}tests/replay/replays/m2_full_shift_puddle_lane.json`, 'utf8'),
);
const SHIFT_URL = `/?test=1&seed=${REPLAY.file.seed}&scene=district.puddle_lane&freeze=1`;
/**
 * World tick of the capture: 44 ticks after the pickup at 9,566 and 22 after the one at 9,588, and after the
 * sparkles of the Clean Sweep on tick 9,588 have died (at most 18 ticks), so no fx draw joins the frame's 8.
 */
const CAPTURE_TICK = 9610;
/** Ticks after the capture by which every popup and bubble of it has gone. */
const GONE_AFTER_TICKS = 120;
/** City, building shadows, Bessie's drop shadow, actors, items, the HUD's UI draw (popups included), palette, blit. */
const SHIFT_DRAW_CALLS = 8;
const DRAW_CALL_BUDGET = 10;
const W = 480;

type Injected = readonly [EventType, number, number, number, number];

/** What the spec injects, as offsets from Bessie's body centre (metres) so it lands round her on screen. */
function injected(bx: number, by: number): Injected[] {
  return [
    [EV.NpcHit, -1, bx - 5, by - 2.5, NPC_IDS.indexOf('npc.shopper')],
    [EV.CarHorn, -1, bx + 5.5, by + 2, 1],
    [EV.PickupScored, 3, bx - 6, by + 4, 150],
    [EV.Penalty, Offence.Hit, bx + 4, by - 5, -250],
  ];
}

async function step(page: Page, n: number): Promise<void> {
  await page.evaluate((ticks) => window.__ssp?.step(ticks), n);
}

async function shiftState(page: Page): Promise<ShiftTestState> {
  const state = await page.evaluate(() => window.__ssp?.state());
  if (state === undefined || !('bessie' in state))
    throw new Error(`no shift state: ${JSON.stringify(state)}`);
  return state;
}

/**
 * The popups layer as the browser holds it at `CAPTURE_TICK` + `extraTicks`: the replay run in Node with a Popups
 * layer on its bus, the injected events drained after tick CAPTURE_TICK − 1, drawn on the CPU at the camera of
 * `state` (the follow camera's focus, snapped to the texel grid like the render camera).
 */
function cpuPopups(
  state: ShiftTestState,
  events: readonly Injected[],
  extraTicks: number,
): {
  raster: TextRaster;
  popups: Popups;
} {
  const level = decodeLevel(readFileSync(`${REPO_ROOT}public/assets/levels/puddle_lane.json`, 'utf8'));
  const world = createWorld(level, REPLAY.file.seed, DEFAULT_TUNING);
  const raster = new TextRaster(W, 270, readIndexedAtlas('ui'));
  const popups = new Popups(raster, readBitmapFont(HUD_FONT));
  const bus = new EventBus();
  popups.attach(bus, viewWorld(world));
  const frame = createInputFrame();
  const total = CAPTURE_TICK + extraTicks;
  for (let t = 0; t < total; t++) {
    readInput(REPLAY.log, t, frame);
    world.step(frame);
    bus.drain(world.events);
    if (world.tick === CAPTURE_TICK) {
      const q = createEventQueue();
      resetEvents(q, CAPTURE_TICK - 1);
      for (const [type, entity, a, b, c] of events) pushEvent(q, type, entity, a, b, c);
      sealEvents(q);
      bus.drain(q);
    }
  }
  const camera = createPopupCamera();
  camera.xM = snapToTexelM(state.camera.x);
  camera.yM = snapToTexelM(state.camera.y);
  camera.pxPerM = groundPxPerMetre(state.camera.h);
  camera.alpha = 1;
  popups.draw(viewWorld(world), W, camera);
  return { raster, popups };
}

test('popups and speech bubbles on Puddle Lane: pixel-exact, in the HUD draw, frozen under Pause, then gone', async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  const errors = collectPageErrors(page);
  await openTestScene(page, SHIFT_URL);
  await page.evaluate(
    ([inputs, ticks, until]) => {
      const api = window.__ssp;
      if (api === undefined) throw new Error('window.__ssp missing');
      api.loadInputs(inputs, ticks);
      api.step(until);
    },
    [REPLAY.file.inputs, REPLAY.file.ticks, CAPTURE_TICK] as const,
  );
  const state = await shiftState(page);
  expect(state.tick).toBe(CAPTURE_TICK);
  const events = injected(state.bessie.x, state.bessie.y);
  await page.evaluate((list) => {
    const api = window.__ssp;
    if (api === undefined) throw new Error('window.__ssp missing');
    for (const [type, entity, a, b, c] of list) api.injectEvent(type, entity, a, b, c);
    api.step(0);
  }, events);
  const frame = await readTestFrame(page);
  const drawCalls = await page.evaluate(() => window.__ssp?.perf().drawCalls ?? -1);
  await saveFrame(testInfo, 'popups_puddle_lane.png', frame, { atResultsRoot: true });
  expect(drawCalls).toBe(SHIFT_DRAW_CALLS);
  expect(drawCalls).toBeLessThanOrEqual(DRAW_CALL_BUDGET);

  // The CPU layer: the two real pickups' popups, the injected ×3 and penalty popups, 'Oi!' and '!'.
  const { raster, popups } = cpuPopups(state, events, 0);
  expect(popups.popupCount(CAPTURE_TICK)).toBe(4);
  const texts = Array.from({ length: 4 }, (_, p) => popups.popupText(p)).sort();
  expect(texts).toEqual(['+10', '+10', '+150', '-250']);
  expect(popups.bubbles.count).toBe(2);
  expect([0, 1, 2].map((s) => (popups.bubbles.isActive(s) ? popups.bubbles.text[s] : null))).toEqual(
    expect.arrayContaining([BUBBLE_OI, BUBBLE_HONK]),
  );
  const hud = hudBoxesPx(W);
  const inHud = (x: number, y: number) => hud.some((b) => x >= b.x0 && x < b.x1 && y >= b.y0 && y < b.y1);
  let compared = 0;
  const mismatches: string[] = [];
  for (let y = 0; y < raster.height; y++) {
    for (let x = 0; x < raster.width; x++) {
      const want = raster.at(x, y);
      if (want < 0 || inHud(x, y)) continue;
      compared++;
      const got = pixelIndex(frame, x, y);
      if (got !== want && mismatches.length < 10) mismatches.push(`(${x}, ${y}) want ${want} got ${got}`);
    }
  }
  console.log(
    `[popups] ${compared} popup/bubble pixels compared, first mismatches: ${mismatches.join('; ') || 'none'}`,
  );
  expect(mismatches).toEqual([]);
  expect(compared).toBeGreaterThan(400);
  // Every tier colour drawn: chalk (×1), spray 28 (×3), postbox red 18 (the penalty) and the bubbles' ink and chalk.
  const colours = new Set(Array.from(raster.index).filter((v) => v >= 0));
  expect([...colours].sort((a, b) => a - b)).toEqual([0, 7, 18, 28]);

  // Paused: the popups freeze with the World.
  await page.keyboard.press('Escape');
  await step(page, 1);
  expect(await page.evaluate(() => window.__ssp?.scenes())).toEqual(['shift', 'pause']);
  // The overlay draws its page from its first render after joining the stack: one more frame, then compare.
  await step(page, 1);
  const pausedA = await readTestFrame(page);
  await step(page, 30);
  const pausedB = await readTestFrame(page);
  expect((await shiftState(page)).tick).toBe(CAPTURE_TICK);
  // The overlay's page sits over the middle of the frame, so check the
  // popup and bubble pixels it leaves uncovered (UI pixels are never dimmed): with the page up they are
  // exactly as drawn, and 30 paused ticks later they still are, not risen, blinked or expired.
  let visible = 0;
  const pauseDiffs: string[] = [];
  for (let y = 0; y < raster.height; y++) {
    for (let x = 0; x < raster.width; x++) {
      const want = raster.at(x, y);
      if (want < 0 || inHud(x, y) || pixelIndex(pausedA, x, y) !== want) continue;
      visible++;
      if (pixelIndex(pausedB, x, y) !== want && pauseDiffs.length < 10) pauseDiffs.push(`(${x}, ${y})`);
    }
  }
  console.log(
    `[popups] paused: ${visible} popup/bubble pixels uncovered by the overlay, all frozen over 30 ticks`,
  );
  expect(pauseDiffs).toEqual([]);
  expect(visible).toBeGreaterThan(200);
  await saveFrame(testInfo, 'popups_paused.png', pausedB);

  // Resumed: 120 ticks on, everything has gone (the longest, 'Oi!', lasts 101 ticks; popups 57), and the replay's
  // next pickup (tick 10,272) has not come yet.
  await page.keyboard.press('Escape');
  await step(page, 1);
  expect(await page.evaluate(() => window.__ssp?.scenes())).toEqual(['shift']);
  await step(page, CAPTURE_TICK + GONE_AFTER_TICKS - (await shiftState(page)).tick);
  const later = await shiftState(page);
  expect(later.tick).toBe(CAPTURE_TICK + GONE_AFTER_TICKS);
  const after = cpuPopups(later, events, GONE_AFTER_TICKS);
  expect(after.popups.popupCount(later.tick)).toBe(0);
  expect(after.popups.bubbles.count).toBe(0);
  expect(after.raster.covered).toBe(0);
  const gone = await readTestFrame(page);
  await saveFrame(testInfo, 'popups_gone.png', gone);
  expect(errors).toEqual([]);
});
