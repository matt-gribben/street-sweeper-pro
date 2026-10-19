// The PauseOverlay in the shipping bundle (SSP-287; GDD §15.1, §15.4, §17.2; TECHNICAL_DESIGN §5.1, §6.1, §12.6). The
// spec boots Puddle Lane straight into a shift (`scene=district.puddle_lane&freeze=1`, so only `step(n)` advances
// ticks), drives a little, then:
//
// - Esc opens the overlay over the frozen shift: `__ssp.scenes()` is ['shift', 'pause'], `state().tick` and the
//   timer's ticksRemaining do not change over 120 rendered frames, and Esc again resumes from the same tick (the next
//   step is the next World tick, and the frame is again exactly the running one).
// - The dim: with the overlay open every pixel outside the HUD's reserved boxes and the overlay is the running
//   frame's colour one step down the shadow ramp (Kerbside-32 `shadow[]`), every overlay pixel equals a CPU
//   rasterisation of the pause page (src/ui/pausePage.ts), and inside the HUD boxes a pixel is either unchanged (HUD)
//   or dimmed (world showing through), with the HUD's own pixels unchanged.
// - `visibilitychange` with visibilityState 'hidden' opens the overlay; 'visible' leaves it open until the player
//   resumes.
// - Restart Shift restarts the same seed at tick 0 with the intro card skipped.
// Frames are saved to test-results/ as review captures (open them with Read).
import { expect, type Page, test } from '@playwright/test';
import { DEFAULT_GLYPHS } from '../../src/app/glyphBindings.ts';
import type { ShiftTestState } from '../../src/debug/testHooks.ts';
import { KERBSIDE32 } from '../../src/render/palettePass.ts';
import { INTERNAL_HEIGHT_PX } from '../../src/render/upscale.ts';
import { ButtonState } from '../../src/ui/panels.ts';
import {
  controlsPageLayout,
  M3_PAUSE_CONDITIONS,
  PauseEntry,
  pauseButtonStates,
  pauseMainLayout,
} from '../../src/ui/pausePage.ts';
import { hudBoxesPx } from '../support/hudCover.ts';
import { collectPageErrors, openTestScene, type RgbaFrame, readTestFrame } from '../support/visualGolden.ts';
import { saveFrame } from './helpers/saveFrame.ts';
import { pixelIndex, rasterise, sim, UI_WIDTH_PX, uiFont, uiMismatches } from './helpers/uiScreen.ts';

/** Puddle Lane straight into a shift, frozen so only `step(n)` advances ticks. */
const SHIFT_URL = '/?test=1&seed=3&scene=district.puddle_lane&freeze=1';

/** The shift's 8 draw calls plus the overlay's UI batch. */
const PAUSED_DRAW_CALLS = 9;

async function step(page: Page, n: number): Promise<void> {
  await page.evaluate((ticks) => window.__ssp?.step(ticks), n);
}

async function shiftState(page: Page): Promise<ShiftTestState> {
  const state = await page.evaluate(() => window.__ssp?.state());
  if (state === undefined || !('bessie' in state))
    throw new Error(`no shift state: ${JSON.stringify(state)}`);
  return state;
}

async function stack(page: Page): Promise<string[]> {
  return page.evaluate(() => window.__ssp?.scenes() ?? []);
}

/** Sets document.visibilityState (and document.hidden) and dispatches `visibilitychange`, as a tab switch does. */
async function setVisibility(page: Page, state: 'hidden' | 'visible'): Promise<void> {
  await page.evaluate((s) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => s });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => s === 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  }, state);
}

/** Drives north with the brush down for `ticks`, so the frame has a moved camera, swept ground and a HUD score. */
async function drive(page: Page, ticks: number): Promise<void> {
  await page.keyboard.press('Space');
  await page.keyboard.down('KeyW');
  await step(page, ticks);
  await page.keyboard.up('KeyW');
}

test('Esc pauses over a frozen, dimmed shift; 120 frames change nothing; Esc resumes from the same tick', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const errors = collectPageErrors(page);
  await openTestScene(page, SHIFT_URL);
  await drive(page, 90);
  await step(page, 0);
  const running = await readTestFrame(page);
  await saveFrame(testInfo, 'pause_running.png', running);
  const before = await shiftState(page);
  expect(before.tick).toBe(90);
  expect(before.shift.phase).toBe('running');

  await page.keyboard.press('Escape');
  await step(page, 1);
  await page.waitForFunction(() => window.__ssp?.scene() === 'pause');
  expect(await stack(page)).toEqual(['shift', 'pause']);
  await step(page, 0);
  const paused = await readTestFrame(page);
  await saveFrame(testInfo, 'pause_open.png', paused, { atResultsRoot: true });
  expect(await page.evaluate(() => window.__ssp?.perf().drawCalls)).toBe(PAUSED_DRAW_CALLS);

  // The overlay: every pixel of the main page as laid out, Resume focused.
  const overlay = rasterise(
    pauseMainLayout(uiFont, UI_WIDTH_PX, INTERNAL_HEIGHT_PX, M3_PAUSE_CONDITIONS, pauseButtonStates()),
  );
  const overlayCheck = uiMismatches(overlay, paused);
  expect(overlayCheck.first).toEqual([]);
  expect(overlay.covered).toBeGreaterThan(5000);

  // The world: one shadow step down everywhere outside the HUD boxes and the overlay; the HUD unchanged.
  const dim = dimCheck(running, paused, overlay);
  console.log(
    `[pause] dimmed ${dim.dimmed} world pixels (${dim.fixed} already at the ramp's foot), HUD kept ${dim.hudKept}`,
  );
  expect(dim.worldWrong).toEqual([]);
  expect(dim.hudWrong).toEqual([]);
  expect(dim.dimmed).toBeGreaterThan(50_000);
  expect(dim.hudKept).toBeGreaterThan(500);

  // 120 rendered frames: the World, the timer and the frame stay exactly as they were.
  const frozen = await page.evaluate(() => {
    const api = window.__ssp;
    if (api === undefined) throw new Error('no __ssp');
    const renders = api.perf().renders;
    const ticks: number[] = [];
    for (let i = 0; i < 120; i++) {
      api.step(1);
      const s = api.state();
      ticks.push(s.tick, 'shift' in s ? s.shift.ticksRemaining : -1);
    }
    return { rendered: api.perf().renders - renders, ticks };
  });
  expect(frozen.rendered).toBe(120);
  expect(new Set(frozen.ticks.filter((_, i) => i % 2 === 0))).toEqual(new Set([before.tick]));
  expect(new Set(frozen.ticks.filter((_, i) => i % 2 === 1))).toEqual(new Set([before.shift.ticksRemaining]));
  const after = await shiftState(page);
  expect(sim(after)).toEqual(sim(before));
  expect(uiMismatches(overlay, await readTestFrame(page)).count).toBe(0);

  // Esc again: Resume. The World continues from the same tick, and the frame is the running one again.
  await page.keyboard.press('Escape');
  await step(page, 1);
  expect(await stack(page)).toEqual(['shift']);
  expect((await shiftState(page)).tick).toBe(before.tick);
  const resumed = await readTestFrame(page);
  expect(firstDifference(running, resumed)).toBeNull();
  await step(page, 1);
  expect((await shiftState(page)).tick).toBe(before.tick + 1);
  expect(errors).toEqual([]);
});

test('the Controls page shows the keyboard bindings and Back returns to the main page', async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  const errors = collectPageErrors(page);
  await openTestScene(page, SHIFT_URL);
  await step(page, 10);
  await page.keyboard.press('KeyP');
  await step(page, 1);
  await page.waitForFunction(() => window.__ssp?.scene() === 'pause');
  // Resume → Restart Shift → Controls (Settings is hidden).
  for (let i = 0; i < 2; i++) {
    await page.keyboard.press('ArrowDown');
    await step(page, 1);
  }
  await page.keyboard.press('Enter');
  await step(page, 1);
  await step(page, 0);
  const frame = await readTestFrame(page);
  await saveFrame(testInfo, 'pause_controls.png', frame, { atResultsRoot: true });
  const controls = rasterise(
    controlsPageLayout(
      uiFont,
      DEFAULT_GLYPHS,
      'keyboard',
      UI_WIDTH_PX,
      INTERNAL_HEIGHT_PX,
      ButtonState.Focus,
    ),
  );
  expect(uiMismatches(controls, frame).first).toEqual([]);
  await page.keyboard.press('Escape'); // Back: to the main page, still paused
  await step(page, 1);
  expect(await stack(page)).toEqual(['shift', 'pause']);
  const main = rasterise(
    pauseMainLayout(
      uiFont,
      UI_WIDTH_PX,
      INTERNAL_HEIGHT_PX,
      M3_PAUSE_CONDITIONS,
      pauseButtonStates(PauseEntry.Controls),
    ),
  );
  expect(uiMismatches(main, await readTestFrame(page)).first).toEqual([]);
  await page.keyboard.press('KeyP'); // the Pause key resumes
  await step(page, 1);
  expect(await stack(page)).toEqual(['shift']);
  expect(errors).toEqual([]);
});

test('visibilitychange → hidden opens the overlay, and it stays open when the tab is visible again', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const errors = collectPageErrors(page);
  await openTestScene(page, SHIFT_URL);
  await drive(page, 40);
  const before = await shiftState(page);
  await setVisibility(page, 'hidden');
  await page.waitForFunction(() => window.__ssp?.scene() === 'pause');
  expect(await stack(page)).toEqual(['shift', 'pause']);
  await setVisibility(page, 'visible');
  await step(page, 60);
  expect(await stack(page)).toEqual(['shift', 'pause']);
  expect((await shiftState(page)).tick).toBe(before.tick);
  // The player resumes (Resume is the default focus).
  await page.keyboard.press('Enter');
  await step(page, 1);
  expect(await stack(page)).toEqual(['shift']);
  await step(page, 1);
  expect((await shiftState(page)).tick).toBe(before.tick + 1);
  expect(errors).toEqual([]);
});

test('Restart Shift restarts the same seed at tick 0 with the intro skipped', async ({ page }) => {
  test.setTimeout(60_000);
  const errors = collectPageErrors(page);
  await openTestScene(page, SHIFT_URL);
  const start = await shiftState(page);
  expect(start.tick).toBe(0);
  await drive(page, 120);
  expect((await shiftState(page)).tick).toBe(120);
  await page.keyboard.press('Escape');
  await step(page, 1);
  await page.waitForFunction(() => window.__ssp?.scene() === 'pause');
  await page.keyboard.press('ArrowDown');
  await step(page, 1);
  await page.keyboard.press('Enter');
  await step(page, 1);
  await page.waitForFunction(() => {
    const api = window.__ssp;
    return api?.scene() === 'shift' && api.scenes().length === 1 && api.state().tick === 0;
  });
  const again = await shiftState(page);
  expect(sim(again)).toEqual(sim(start));
  expect(await page.evaluate(() => window.__ssp?.sceneHistory())).toEqual([
    'boot',
    'shift',
    'pause',
    'shift',
  ]);
  await step(page, 5);
  expect((await shiftState(page)).tick).toBe(5);
  expect(errors).toEqual([]);
});

/** Kerbside-32 index → its shadow index. */
const SHADOW = KERBSIDE32.shadow;

/** The first pixel where two frames differ, or null. */
function firstDifference(a: RgbaFrame, b: RgbaFrame): string | null {
  for (let i = 0; i < a.data.length; i++) {
    if (a.data[i] !== b.data[i]) {
      const p = i >> 2;
      return `(${p % a.width}, ${Math.floor(p / a.width)})`;
    }
  }
  return a.data.length === b.data.length ? null : 'size';
}

/**
 * Compares the paused frame with the running one outside the overlay's pixels: outside the HUD's reserved boxes
 * every pixel must be shadow[running]; inside them either running (a HUD pixel, kept) or shadow[running].
 */
function dimCheck(
  running: RgbaFrame,
  paused: RgbaFrame,
  overlay: { at(x: number, y: number): number },
): { dimmed: number; fixed: number; hudKept: number; worldWrong: string[]; hudWrong: string[] } {
  const boxes = hudBoxesPx(running.width);
  const inHud = (x: number, y: number): boolean =>
    boxes.some((b) => x >= b.x0 && x < b.x1 && y >= b.y0 && y < b.y1);
  let dimmed = 0;
  let fixed = 0;
  let hudKept = 0;
  const worldWrong: string[] = [];
  const hudWrong: string[] = [];
  for (let y = 0; y < running.height; y++) {
    for (let x = 0; x < running.width; x++) {
      if (overlay.at(x, y) >= 0) continue;
      const was = pixelIndex(running, x, y);
      const now = pixelIndex(paused, x, y);
      const shaded = SHADOW[was] ?? -1;
      if (inHud(x, y)) {
        if (now === was && shaded !== was) hudKept++;
        else if (now !== was && now !== shaded && hudWrong.length < 8)
          hudWrong.push(`(${x}, ${y}) ${was} -> ${now}`);
        continue;
      }
      if (now !== shaded) {
        if (worldWrong.length < 8) worldWrong.push(`(${x}, ${y}) ${was} -> ${now}, want ${shaded}`);
      } else if (shaded === was) fixed++;
      else dimmed++;
    }
  }
  return { dimmed, fixed, hudKept, worldWrong, hudWrong };
}
