// Mouse menus in the shipping bundle (SSP-286; GDD §6.1, §15.1; TECHNICAL_DESIGN §12.1, §13.2). The whole shift
// flow played with the mouse alone, no keyboard input at all:
//
//   intro card → click on the card → shift (no input: Bessie stands at the depot) → step past the end of the
//   timer → numbers-only tally → press on Try Again (drawn Pressed) → release → a fresh shift on the same seed.
//
// Clicks are sent as real Playwright mouse events at client pixels computed from the layout's integer scale and
// letterbox (render/upscale.ts computeViewportLayout), so the canvas Pointer Events path, the client → internal
// inverse transform and the menus.ts hit-test are all exercised. The pressed frame must equal a CPU rasterisation
// of the tally with Try Again in ButtonState.Pressed. Frames are saved to test-results/ as review captures.
import { expect, type Page, test } from '@playwright/test';
import { VISUAL_VIEWPORT } from '../../playwright.config.ts';
import { computeViewportLayout, INTERNAL_HEIGHT_PX } from '../../src/render/upscale.ts';
import { TALLY_INPUT_LOCK_TICKS } from '../../src/scenes/TallyScene.ts';
import type { SimSnapshot } from '../../src/sim/snapshot.ts';
import { ButtonState, type UiRect } from '../../src/ui/panels.ts';
import { TallyButton, tallyButtonRects, tallyFigures, tallyPageLayout } from '../../src/ui/tallyPage.ts';
import { collectPageErrors, openTestScene, readTestFrame } from '../support/visualGolden.ts';
import { saveFrame } from './helpers/saveFrame.ts';
import { rasterise, uiFont, uiMismatches } from './helpers/uiPixels.ts';

/** The default boot (the intro card for Puddle Lane), frozen so only `step(n)` advances ticks. */
const FLOW_URL = '/?test=1&seed=5&freeze=1';

/** More than the longest shift: a 3 s rollout, 14,400 timer ticks and the knock-off coast. */
const PAST_THE_END_TICKS = 15_600;

const layout = computeViewportLayout(VISUAL_VIEWPORT.width, VISUAL_VIEWPORT.height, 1);

/** The client point at the centre of internal rect `r`. */
function centre(r: UiRect): { x: number; y: number } {
  return {
    x: (layout.canvasDeviceLeft + (r.x + r.w / 2) * layout.scale) / layout.devicePixelRatio,
    y: (layout.canvasDeviceTop + (r.y + r.h / 2) * layout.scale) / layout.devicePixelRatio,
  };
}

async function step(page: Page, n: number): Promise<void> {
  await page.evaluate((ticks) => window.__ssp?.step(ticks), n);
}

async function sceneId(page: Page): Promise<string | null> {
  return page.evaluate(() => window.__ssp?.scene() ?? null);
}

test('the shift flow with the mouse alone: click the card, then Try Again on the tally restarts the shift', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const errors = collectPageErrors(page);
  await openTestScene(page, FLOW_URL);
  expect(await sceneId(page)).toBe('shift_intro');
  expect(layout.internalWidth).toBe(480);

  // A click in the middle of the card starts the shift (a click before the level is in waits for it).
  const card = centre({ x: 0, y: 0, w: layout.internalWidth, h: INTERNAL_HEIGHT_PX });
  await page.mouse.click(card.x, card.y);
  await step(page, 1);
  await page.waitForFunction(() => window.__ssp?.scene() === 'shift');
  const start = (await page.evaluate(() => window.__ssp?.state())) as SimSnapshot;
  expect(start.tick).toBe(0);

  // No input at all: the timer runs out with Bessie at the depot.
  await step(page, PAST_THE_END_TICKS);
  await page.waitForFunction(() => window.__ssp?.scene() === 'tally');
  const end = (await page.evaluate(() => window.__ssp?.state())) as SimSnapshot;
  expect(end.shift.endReason).toBe('time_up');
  await step(page, TALLY_INPUT_LOCK_TICKS);

  // Press on Try Again: it is drawn Pressed (and nothing is picked until the release).
  const rects = tallyButtonRects(uiFont, layout.internalWidth, INTERNAL_HEIGHT_PX);
  const tryAgain = rects[TallyButton.TryAgain];
  if (tryAgain === undefined) throw new Error('no Try Again rect');
  const at = centre(tryAgain);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await step(page, 1);
  expect(await sceneId(page)).toBe('tally');
  const pressedItems = tallyPageLayout(
    uiFont,
    layout.internalWidth,
    INTERNAL_HEIGHT_PX,
    tallyFigures(end, 'PUDDLE LANE'),
    [ButtonState.Pressed, ButtonState.Normal],
  );
  const pressedFrame = await readTestFrame(page);
  await saveFrame(testInfo, 'menu_mouse_pressed.png', pressedFrame);
  const mismatches = uiMismatches(rasterise(pressedItems, layout.internalWidth), pressedFrame);
  expect(mismatches.first).toEqual([]);
  expect(mismatches.count).toBe(0);

  // The release over the same button picks it: a fresh shift on the same seed, the intro skipped.
  await page.mouse.up();
  await step(page, 1);
  await page.waitForFunction(() => window.__ssp?.scene() === 'shift' && window.__ssp.state().tick === 0);
  const again = (await page.evaluate(() => window.__ssp?.state())) as SimSnapshot;
  expect(again.bessie).toEqual(start.bessie);
  expect(await page.evaluate(() => window.__ssp?.sceneHistory())).toEqual([
    'shift_intro',
    'shift',
    'tally',
    'shift',
  ]);
  await step(page, 1);
  await saveFrame(testInfo, 'menu_mouse_retry.png', await readTestFrame(page));
  expect(errors).toEqual([]);
});
