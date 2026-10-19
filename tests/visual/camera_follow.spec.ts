// The live follow camera in the shipping bundle (SSP-047, TECHNICAL_DESIGN §12.2, ROADMAP M1 "Camera" check).
// `springs=1` keeps the look-ahead and speed-zoom springs on in test mode; the fixed 1/60 s frames (step(n) hands
// the springs n/60 s of render time) keep the result deterministic. The keyboard drives Bessie north up the
// road from the depot.
//
// - 1:1 ground at <= 6.0 m/s: brush down (top speed 6.0 m/s), 4 s of throttle, frozen. H must be exactly 31.5 m,
//   the camera must lead Bessie by up to 3.0 m along her velocity, and every 2 m ground tile wholly on screen
//   and clear of Bessie, the HUD's reserved boxes (src/ui/hud.ts hudLayout, SSP-070), building walls/roofs
//   (projected at the frame's camera) and building shadows must equal
//   its `world` atlas frame(s) pixel for pixel (base tile, then any marking overlay, as groundLayer.ts draws
//   them). The atlas pixels are Kerbside-32 colours and the day palette pass maps each to itself, so "after
//   palette mapping" is the atlas pixel. A review capture (`camera_1to1.png`) is written to test-results/.
// - Transit: brush up, 5 s of throttle then the brake: the look-ahead offset never exceeds 3.0 m, H rises
//   without overshoot (never above 37.8 m), and once Bessie has stopped H settles back to exactly 31.5 m and the
//   offset returns to her.
import { writeFileSync } from 'node:fs';
import { expect, type Page, type TestInfo, test } from '@playwright/test';
import type { ShiftTestState, TestState } from '../../src/debug/testHooks.ts';
import {
  LOOK_AHEAD_MAX_M,
  SWEEP_HEIGHT_M,
  snapToTexelM,
  ZOOM_OUT_HEIGHT_M,
} from '../../src/render/camera.ts';
import { INTERNAL_HEIGHT_PX } from '../../src/render/upscale.ts';
import {
  cityCover,
  compareGroundTiles,
  initialGrimeMask,
  loadPuddleLane,
  type Rect,
} from '../support/groundReference.ts';
import { hudCover } from '../support/hudCover.ts';
import {
  collectPageErrors,
  encodeFramePng,
  openTestScene,
  type RgbaFrame,
  readTestFrame,
} from '../support/visualGolden.ts';

const LIVE_CAMERA_URL = '/?test=1&seed=1&scene=district.puddle_lane&freeze=1&springs=1';

const { level, atlas: worldAtlas } = loadPuddleLane();

/** The grime the World lays for seed=1 (SSP-066): ground cells show it or, once swept, the clean ground. */
const INITIAL_GRIME = initialGrimeMask(level, 1);

/** Brush-down top speed (tuning.json vehicle.sweeper, GDD §7.1): at or below it H is 31.5 m. */
const BRUSH_DOWN_TOP_MPS = 6.0;

/** Half-size of the square around Bessie's body centre kept out of the check: body, brush overlay, drop shadow. */
const BESSIE_CLEAR_M = 4.5;

/** Tiles that must take part, so the check cannot pass by excluding everything. */
const MIN_CHECKED_TILES = 8;

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

async function saveCapture(testInfo: TestInfo, name: string, frame: RgbaFrame): Promise<void> {
  const path = testInfo.outputPath(name);
  writeFileSync(path, encodeFramePng(frame));
  await testInfo.attach(name, { path, contentType: 'image/png' });
  console.log(`[camera] ${name} ${frame.width}x${frame.height} -> ${path}`);
}

test('at <= 6.0 m/s the live camera leads Bessie and the ground is exactly 1 texel = 1 px', async ({
  page,
}, testInfo) => {
  const errors = collectPageErrors(page);
  await openTestScene(page, LIVE_CAMERA_URL);
  // Brush down (Space edge), then 4 s of full throttle north.
  await page.keyboard.press('Space');
  await page.keyboard.down('KeyW');
  let state = await step(page, 1);
  let maxLeadM = 0;
  for (let i = 0; i < 239; i++) {
    state = await step(page, 1);
    maxLeadM = Math.max(maxLeadM, Math.hypot(state.camera.leadX, state.camera.leadY));
    expect(state.camera.h, `H at tick ${state.tick}`).toBe(SWEEP_HEIGHT_M);
  }
  const { bessie, camera } = state;
  expect(state.tick).toBe(240);
  expect(bessie.speed).toBeGreaterThan(5);
  expect(bessie.speed).toBeLessThanOrEqual(BRUSH_DOWN_TOP_MPS);
  expect(camera.pinned).toBe(false);
  expect(camera.h).toBe(SWEEP_HEIGHT_M);
  // Leading north (−y) along her velocity, nearly the full 3.0 m, never more.
  expect(maxLeadM).toBeLessThanOrEqual(LOOK_AHEAD_MAX_M);
  expect(camera.leadY).toBeLessThan(-2.5);
  expect(Math.abs(camera.leadX)).toBeLessThan(0.05);
  // The focus is the drawn pose (within one tick of travel of the sim pose) plus the offset.
  expect(Math.abs(camera.x - camera.leadX - bessie.x)).toBeLessThan(0.15);
  expect(Math.abs(camera.y - camera.leadY - bessie.y)).toBeLessThan(0.15);

  const frame = await readTestFrame(page);
  await saveCapture(testInfo, 'camera_1to1.png', frame);
  expect(frame.height).toBe(INTERNAL_HEIGHT_PX);

  // The camera sits on the 1/16 m grid, so every tile edge lands on a whole pixel of the W×270 frame.
  const camX = snapToTexelM(camera.x);
  const camY = snapToTexelM(camera.y);
  const blocked: Rect[] = [
    ...cityCover(level, camX, camY, camera.h),
    {
      x0: bessie.x - BESSIE_CLEAR_M,
      y0: bessie.y - BESSIE_CLEAR_M,
      x1: bessie.x + BESSIE_CLEAR_M,
      y1: bessie.y + BESSIE_CLEAR_M,
    },
  ];
  // The HUD draws over the ground (SSP-070): tiles under any of its reserved boxes are left out.
  blocked.push(...hudCover(camX, camY, frame.width));
  // Each 4 px grime cell must be its tile's texels 1:1, with the cell's initial grime or swept clean (SSP-066).
  const ground = compareGroundTiles(frame, level, worldAtlas, camX, camY, blocked, INITIAL_GRIME, false);
  const checked = ground.checkedTiles;
  const mismatches = ground.mismatches;
  console.log(
    `[camera] 1:1 ground check: ${checked} tiles (${ground.grimyCells} grimy cells, ${ground.cleanCells.length} swept) compared, ${mismatches.length} mismatched`,
  );
  expect(checked).toBeGreaterThanOrEqual(MIN_CHECKED_TILES);
  expect(mismatches).toEqual([]);
  expect(errors).toEqual([]);
});

test('at transit the lead stays within 3.0 m and H eases out without overshoot, then settles to 31.5 m', async ({
  page,
}) => {
  const errors = collectPageErrors(page);
  await openTestScene(page, LIVE_CAMERA_URL);
  // Brush up: 5 s of full throttle north.
  await page.keyboard.down('KeyW');
  let previousH = SWEEP_HEIGHT_M;
  let state = await shiftState(page);
  for (let i = 0; i < 300; i++) {
    state = await step(page, 1);
    const { h, leadX, leadY } = state.camera;
    expect(Math.hypot(leadX, leadY)).toBeLessThanOrEqual(LOOK_AHEAD_MAX_M);
    expect(h).toBeGreaterThanOrEqual(previousH);
    expect(h).toBeLessThanOrEqual(ZOOM_OUT_HEIGHT_M);
    previousH = h;
  }
  expect(state.bessie.speed).toBeGreaterThan(7.5);
  expect(state.camera.h).toBeGreaterThan(33);
  expect(state.camera.leadY).toBeLessThan(-2.9);
  await page.keyboard.up('KeyW');

  // Brake to a stop (released before reverse can engage), then let the springs come home.
  await page.keyboard.down('KeyS');
  for (let i = 0; i < 180 && state.bessie.speed > 0.2; i++) state = await step(page, 1);
  await page.keyboard.up('KeyS');
  expect(state.bessie.speed).toBeLessThanOrEqual(0.2);
  expect(state.bessie.speed).toBeGreaterThanOrEqual(0);
  for (let i = 0; i < 420; i++) {
    state = await step(page, 1);
    expect(Math.hypot(state.camera.leadX, state.camera.leadY)).toBeLessThanOrEqual(LOOK_AHEAD_MAX_M);
  }
  expect(state.bessie.speed).toBe(0);
  expect(state.camera.h).toBe(SWEEP_HEIGHT_M);
  expect(Math.hypot(state.camera.leadX, state.camera.leadY)).toBeLessThan(1e-3);
  expect(errors).toEqual([]);
});

test('without springs=1 test mode keeps the camera on Bessie at the sweep height', async ({ page }) => {
  const errors = collectPageErrors(page);
  await openTestScene(page, '/?test=1&seed=1&scene=district.puddle_lane&freeze=1');
  await page.keyboard.down('KeyW');
  const state = await step(page, 240);
  await page.keyboard.up('KeyW');
  expect(state.bessie.speed).toBeGreaterThan(7);
  expect(state.camera.h).toBe(SWEEP_HEIGHT_M);
  expect(state.camera.leadX).toBe(0);
  expect(state.camera.leadY).toBe(0);
  expect(errors).toEqual([]);
});
