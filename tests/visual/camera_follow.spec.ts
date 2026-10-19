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
import { readFileSync, writeFileSync } from 'node:fs';
import { expect, type Page, type TestInfo, test } from '@playwright/test';
import type { ShiftTestState, TestState } from '../../src/debug/testHooks.ts';
import { FRAME, type FrameId } from '../../src/gen/assets.ts';
import {
  LOOK_AHEAD_MAX_M,
  SWEEP_HEIGHT_M,
  snapToTexelM,
  ZOOM_OUT_HEIGHT_M,
} from '../../src/render/camera.ts';
import { CELL_M, type CityBox, type CityGrid, mergeBoxes } from '../../src/render/cityMesh.ts';
import { cellGroundFrames, groundFrameTables } from '../../src/render/groundLayer.ts';
import { buildShadowPolygons } from '../../src/render/shadows.ts';
import { INTERNAL_HEIGHT_PX } from '../../src/render/upscale.ts';
import { HUD_FONT } from '../../src/scenes/ShiftScene.ts';
import { PX_PER_M } from '../../src/sim/constants.ts';
import { decodeLevel, type Level } from '../../src/sim/map.ts';
import { hudLayout } from '../../src/ui/hud.ts';
import { decodePng } from '../support/png.ts';
import { readBitmapFont } from '../support/textRaster.ts';
import {
  collectPageErrors,
  encodeFramePng,
  openTestScene,
  type RgbaFrame,
  readTestFrame,
} from '../support/visualGolden.ts';

const LIVE_CAMERA_URL = '/?test=1&seed=1&scene=district.puddle_lane&freeze=1&springs=1';

const level: Level = decodeLevel(
  JSON.parse(readFileSync(new URL('../../public/assets/levels/puddle_lane.json', import.meta.url), 'utf8')),
);
const worldAtlas: ReturnType<typeof decodePng> = decodePng(
  readFileSync(new URL('../../public/assets/atlas/world.png', import.meta.url)),
);

/** Brush-down top speed (tuning.json vehicle.sweeper, GDD §7.1): at or below it H is 31.5 m. */
const BRUSH_DOWN_TOP_MPS = 6.0;

/** Half-size of the square around Bessie's body centre kept out of the check: body, brush overlay, drop shadow. */
const BESSIE_CLEAR_M = 4.5;

/** Tiles that must take part, so the check cannot pass by excluding everything. */
const MIN_CHECKED_TILES = 8;

const TILE_PX = CELL_M * PX_PER_M;

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

type Rect = { x0: number; y0: number; x1: number; y1: number };

const overlaps = (a: Rect, b: Rect): boolean => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/**
 * What a box can cover on screen, in sim metres: its footprint plus its roof projected through the camera at
 * (camX, camY, H) (a point at height h and offset d from the axis lands at d·H/(H − h)), widened by a texel.
 */
function buildingCover(box: CityBox, camX: number, camY: number, heightM: number): Rect {
  const k = heightM / (heightM - box.heightM);
  const xs = [box.x0M, box.x1M, camX + (box.x0M - camX) * k, camX + (box.x1M - camX) * k];
  const ys = [box.y0M, box.y1M, camY + (box.y0M - camY) * k, camY + (box.y1M - camY) * k];
  const m = 1 / PX_PER_M;
  return {
    x0: Math.min(...xs) - m,
    y0: Math.min(...ys) - m,
    x1: Math.max(...xs) + m,
    y1: Math.max(...ys) + m,
  };
}

/** Axis-aligned bounds of a shadow outline [x0, y0, x1, y1, ...], widened by a texel. */
function outlineBounds(outline: readonly number[]): Rect {
  const xs = outline.filter((_, i) => i % 2 === 0);
  const ys = outline.filter((_, i) => i % 2 === 1);
  const m = 1 / PX_PER_M;
  return {
    x0: Math.min(...xs) - m,
    y0: Math.min(...ys) - m,
    x1: Math.max(...xs) + m,
    y1: Math.max(...ys) + m,
  };
}

/** The 32×32 tile a cell should show: its base frame with each overlay's opaque pixels on top (RGBA). */
function expectedTile(base: FrameId, overlays: readonly FrameId[]): Uint8Array {
  const out = new Uint8Array(TILE_PX * TILE_PX * 4);
  for (const id of [base, ...overlays]) {
    const f = FRAME[id];
    expect(f.w, `${id} is a full tile`).toBe(TILE_PX);
    expect(f.h, `${id} is a full tile`).toBe(TILE_PX);
    for (let y = 0; y < TILE_PX; y++) {
      for (let x = 0; x < TILE_PX; x++) {
        const src = ((f.y + y) * worldAtlas.width + f.x + x) * 4;
        if ((worldAtlas.data[src + 3] ?? 0) === 0) continue;
        out.set(worldAtlas.data.subarray(src, src + 4), (y * TILE_PX + x) * 4);
      }
    }
  }
  return out;
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
  const [cols, rows] = level.size;
  const grid: CityGrid = {
    cols,
    rows,
    originXM: 0,
    originYM: 0,
    storeys: level.layers.storeys,
    wall: level.layers.wall,
    roof: level.layers.roof,
  };
  const boxes = mergeBoxes(grid);
  const blocked: Rect[] = [
    ...boxes.map((box) => buildingCover(box, camX, camY, camera.h)),
    ...buildShadowPolygons(boxes).map((p) => outlineBounds(p.outline)),
    {
      x0: bessie.x - BESSIE_CLEAR_M,
      y0: bessie.y - BESSIE_CLEAR_M,
      x1: bessie.x + BESSIE_CLEAR_M,
      y1: bessie.y + BESSIE_CLEAR_M,
    },
  ];
  // The HUD draws over the ground: tiles under any of its boxes (in screen pixels) are left out.
  const hudBoxes = Object.values(hudLayout(readBitmapFont(HUD_FONT), frame.width).reserved);
  const tables = groundFrameTables(level);
  let checked = 0;
  const mismatches: string[] = [];
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const left = frame.width / 2 + (cx * CELL_M - camX) * PX_PER_M;
      const top = INTERNAL_HEIGHT_PX / 2 + (cy * CELL_M - camY) * PX_PER_M;
      if (left < 0 || top < 0 || left + TILE_PX > frame.width || top + TILE_PX > frame.height) continue;
      expect(Number.isInteger(left) && Number.isInteger(top), 'tile edges on whole pixels').toBe(true);
      const cell: Rect = { x0: cx * CELL_M, y0: cy * CELL_M, x1: (cx + 1) * CELL_M, y1: (cy + 1) * CELL_M };
      if (blocked.some((r) => overlaps(cell, r))) continue;
      const screen: Rect = { x0: left, y0: top, x1: left + TILE_PX, y1: top + TILE_PX };
      const underHud = hudBoxes.some((b) =>
        overlaps(screen, { x0: b.x, y0: b.y, x1: b.x + b.w, y1: b.y + b.h }),
      );
      if (underHud) continue;
      const { base, overlays } = cellGroundFrames(level, tables, cx, cy);
      if (base === null) continue;
      const want = expectedTile(base, overlays);
      let wrong = 0;
      for (let y = 0; y < TILE_PX; y++) {
        for (let x = 0; x < TILE_PX; x++) {
          const got = ((top + y) * frame.width + left + x) * 4;
          const exp = (y * TILE_PX + x) * 4;
          for (let c = 0; c < 4; c++) if (frame.data[got + c] !== want[exp + c]) wrong++;
        }
      }
      checked++;
      if (wrong > 0)
        mismatches.push(`tile (${cx}, ${cy}) ${base} at px (${left}, ${top}): ${wrong} bytes differ`);
    }
  }
  console.log(`[camera] 1:1 ground check: ${checked} tiles compared, ${mismatches.length} mismatched`);
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
