// Visual golden: scale_sheet (SSP-024, ROADMAP D-07). Bessie's body (h00), Doris (idle s) and the litter sample
// (`litter.banana_skin`) side by side at 1:1 on asphalt and on the 05/06 pavement checkerboard, frozen, read with
// `__ssp.readFrame()` and compared with `__goldens__/scale_sheet.png` at pixelmatch threshold 0 (TECHNICAL_DESIGN
// §18.4). It pins the signed-off scale sheet: a sprite drifting off 1:1 or changing size fails it.
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

test('scale_sheet matches its golden at pixelmatch threshold 0', async ({ page }, testInfo) => {
  const errors = collectPageErrors(page);
  await openTestScene(page, '/?test=1&seed=1&scene=scale_sheet&freeze=1');
  const frame = await readTestFrame(page);
  expect(frame.width, 'internal width W at 1920x1080').toBe(EXPECTED_WIDTH_PX);
  expect(frame.height).toBe(INTERNAL_HEIGHT_PX);
  await expectFrameMatchesGolden(testInfo, 'scale_sheet', frame);
  expect(errors).toEqual([]);
});
