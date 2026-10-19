// Visual golden: level_preview (SSP-045). Compiled Puddle Lane drawn by the level renderer (chunked ground with
// kerb blobs and markings, merged walls and roofs from the `world` atlas in one draw, building shadows) from the
// scene's pinned camera at the sweep height, frozen, read with `__ssp.readFrame()` and compared with
// `__goldens__/level_preview.png` at pixelmatch threshold 0 (TECHNICAL_DESIGN §18.4). It also checks the draw-call
// budget (§12.7): the city is ONE draw, the building shadows one more, then the palette pass and the blit.
import { expect, test } from '@playwright/test';
import { INTERNAL_HEIGHT_PX } from '../../src/render/upscale.ts';
import {
  collectPageErrors,
  expectFrameMatchesGolden,
  openTestScene,
  readTestFrame,
} from '../support/visualGolden.ts';

/** W at the visual project's 1920×1080 viewport (TECHNICAL_DESIGN §12.1). */
const EXPECTED_WIDTH_PX = 480;

/** City (ground + walls + roofs), building shadows, palette pass, blit. */
const EXPECTED_DRAW_CALLS = 4;

/** TECHNICAL_DESIGN §12.7. */
const DRAW_CALL_BUDGET = 10;

test('level_preview matches its golden at pixelmatch threshold 0 in 4 draw calls', async ({
  page,
}, testInfo) => {
  const errors = collectPageErrors(page);
  await openTestScene(page, '/?test=1&seed=1&scene=level_preview&freeze=1');

  const { drawCalls, camera } = await page.evaluate(() => {
    const api = window.__ssp;
    if (api === undefined) throw new Error('window.__ssp missing');
    return { drawCalls: api.perf().drawCalls, camera: api.state().camera };
  });
  expect(camera.pinned, 'the scene pins its camera').toBe(true);
  expect(drawCalls).toBeLessThanOrEqual(DRAW_CALL_BUDGET);
  expect(drawCalls).toBe(EXPECTED_DRAW_CALLS);

  const frame = await readTestFrame(page);
  expect(frame.width, 'internal width W at 1920x1080').toBe(EXPECTED_WIDTH_PX);
  expect(frame.height).toBe(INTERNAL_HEIGHT_PX);
  await expectFrameMatchesGolden(testInfo, 'level_preview', frame);
  expect(errors).toEqual([]);
});

/**
 * The second view: the station street (the north–south road at tiles x 50–52) at sim (105, 61) m, the sweep
 * height. It shows the `haz.speed_bump` site (v0, across a north–south road), the parking-bay overlay along the
 * road-side edge of the bays at x 52 (no double yellows there), a 2-storey terrace's E face on the left with its
 * shadow on the road, and the 3-storey block's W face on the right.
 */
const STATION_CAMERA = { x: 105, y: 61, h: 31.5 } as const;

test('level_preview station view matches its golden at pixelmatch threshold 0', async ({
  page,
}, testInfo) => {
  const errors = collectPageErrors(page);
  await openTestScene(page, '/?test=1&seed=1&scene=level_preview&freeze=1');
  await page.evaluate(({ x, y, h }) => window.__ssp?.setCamera(x, y, h), STATION_CAMERA);
  const drawCalls = await page.evaluate(() => window.__ssp?.perf().drawCalls ?? -1);
  expect(drawCalls).toBe(EXPECTED_DRAW_CALLS);
  const frame = await readTestFrame(page);
  expect(frame.width, 'internal width W at 1920x1080').toBe(EXPECTED_WIDTH_PX);
  expect(frame.height).toBe(INTERNAL_HEIGHT_PX);
  await expectFrameMatchesGolden(testInfo, 'level_preview_station', frame);
  expect(errors).toEqual([]);
});
