// Visual golden: lean_quadrants (TECHNICAL_DESIGN §18.4, SSP-022). The M0 spike scene (1/3/6-storey blocks
// mirrored into all four screen quadrants, a Bessie, a pedestrian and a sprite-stack lamp post in each, the
// SSP-021 shadow table on four ground types), frozen at tick 0, read with `__ssp.readFrame()` (the raw W×270
// palette-mapped frame, independent of canvas scaling) and compared with `__goldens__/lean_quadrants.png` at
// pixelmatch threshold 0. The `visual` project runs it headless on SwiftShader at 1920×1080, so W = 480.
//
// The test logs `[visual] lean_quadrants 480x270 sha256=<hex>`; the D-09 stability loop
// (`node tools/spikes/visualStability.ts`) collects it over 10 separate invocations.
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

test('lean_quadrants matches its golden at pixelmatch threshold 0', async ({ page }, testInfo) => {
  const errors = collectPageErrors(page);
  await openTestScene(page, '/?test=1&seed=1&scene=lean_quadrants&freeze=1');

  // The goldens are SwiftShader frames (D-09): fail loudly if the flags stopped selecting it.
  const gpu = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const info = gl?.getExtension('WEBGL_debug_renderer_info');
    return gl && info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : 'no WebGL2';
  });
  console.log(`[visual] renderer ${gpu}`);
  expect(gpu, 'visual project renders on SwiftShader').toContain('SwiftShader');

  const frame = await readTestFrame(page);
  expect(frame.width, 'internal width W at 1920x1080').toBe(EXPECTED_WIDTH_PX);
  expect(frame.height).toBe(INTERNAL_HEIGHT_PX);

  await expectFrameMatchesGolden(testInfo, 'lean_quadrants', frame);
  expect(errors).toEqual([]);
});
