// The items instance batch in the shipping bundle (SSP-067; TECHNICAL_DESIGN §12.5, §12.7). No golden covers items
// in M2 (the `zoo` golden is M4, SSP-118), so the frozen frames are saved to test-results/ as review captures
// (open them with Read) and the spec checks what must hold exactly:
//
// - Puddle Lane at its start (`?test=1&seed=1&scene=district.puddle_lane&freeze=1`, tick 0), pinned over the
//   depot bays, each hydrant and the skip: 7 draw calls (city, building shadows, Bessie's drop shadow, actors,
//   items, palette pass, blit), within 10; litter in all four rotations is in the hydrant views (worked out from
//   the same seeded World in Node); hydrant red is drawn where each hydrant stands;
// - a stain on screen costs no extra draw: on seed 359 Bessie, brush up, drives north from the depot over a dog
//   mess (a splat stain and its −20, GDD §8.2), backs off, and the camera is pinned over the splat: still 7.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, type Page, test } from '@playwright/test';
import type { ShiftTestState, TestState } from '../../src/debug/testHooks.ts';
import {
  cameraGroundRect,
  createCameraRig,
  groundPxPerMetre,
  pinCameraRig,
} from '../../src/render/camera.ts';
import { ITEMS_CULL_MARGIN_M, levelItemMarkers } from '../../src/render/itemsBatch.ts';
import { KERBSIDE32 } from '../../src/render/palettePass.ts';
import { INTERNAL_HEIGHT_PX } from '../../src/render/upscale.ts';
import { createInputFrame } from '../../src/sim/inputFrame.ts';
import { queryLitterView } from '../../src/sim/litter.ts';
import { decodeLevel } from '../../src/sim/map.ts';
import { DEFAULT_TUNING } from '../../src/sim/tuning.ts';
import { createWorld } from '../../src/sim/world.ts';
import { collectPageErrors, openTestScene, type RgbaFrame, readTestFrame } from '../support/visualGolden.ts';
import { saveFrame } from './helpers/saveFrame.ts';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const LEVEL = decodeLevel(readFileSync(`${REPO_ROOT}public/assets/levels/puddle_lane.json`, 'utf8'));

const SHIFT_URL = '/?test=1&seed=1&scene=district.puddle_lane&freeze=1';

/** A seed whose shift-start litter puts a dog mess on the depot road, straight north of Bessie's start. */
const SPLAT_SEED = 359;

/** City + building shadows + Bessie's drop shadow + actors + items + palette pass + blit. */
const EXPECTED_DRAW_CALLS = 7;

/** TECHNICAL_DESIGN §12.7. */
const DRAW_CALL_BUDGET = 10;

/** W at the ci project's 1920×1080 viewport. */
const WIDTH_PX = 480;

/** The sweep height: flat sprites draw 1:1. */
const SWEEP_H = 31.5;

/** Pinned review views (camera focus in sim metres, sweep height). */
const VIEWS = {
  hydrantParade: { x: 51, y: 12 }, // prop.hydrant (51, 15) with the parade's litter
  hydrantHigh: { x: 77, y: 9 }, // prop.hydrant (77, 7) on the High Street
  skip: { x: 78, y: 63 }, // site.skip [38, 31, 40, 32]
} as const;

async function shiftState(page: Page): Promise<ShiftTestState> {
  const state = await page.evaluate((): TestState => {
    const api = window.__ssp;
    if (api === undefined) throw new Error('window.__ssp missing');
    return api.state();
  });
  if (!('bessie' in state)) throw new Error(`state() is not a shift snapshot: ${JSON.stringify(state)}`);
  return state;
}

/** Pins the camera and renders once (step(0) advances no tick). */
async function pinView(page: Page, x: number, y: number, h = SWEEP_H): Promise<void> {
  await page.evaluate(
    ([px, py, ph]) => {
      const api = window.__ssp;
      if (api === undefined) throw new Error('window.__ssp missing');
      api.setCamera(px, py, ph);
      api.step(0);
    },
    [x, y, h] as const,
  );
}

async function drawCalls(page: Page): Promise<number> {
  return page.evaluate(() => window.__ssp?.perf().drawCalls ?? -1);
}

/** Litter rotations (0..3) the items batch draws for a camera pinned at (x, y, h), from the seeded World. */
function visibleRotations(seed: number, x: number, y: number, h: number): Set<number> {
  const world = createWorld(LEVEL, seed, DEFAULT_TUNING);
  const rig = createCameraRig(WIDTH_PX);
  pinCameraRig(rig, x, y, h);
  const rect = cameraGroundRect(rig, 0, { minX: 0, minY: 0, maxX: 0, maxY: 0 });
  // Rotations of the items on screen proper (no margin), which is what the frame shows.
  const hits = new Int32Array(world.litter.capacity);
  const n = queryLitterView(world.litter, rect, hits);
  const rots = new Set<number>();
  for (let k = 0; k < n; k++) rots.add(world.litter.rot[hits[k] as number] as number);
  expect(ITEMS_CULL_MARGIN_M).toBe(4);
  return rots;
}

/** Palette index of each pixel (−1 for a colour outside Kerbside-32, which the palette pass never emits). */
function indexAt(frame: RgbaFrame, px: number, py: number): number {
  const o = (py * frame.width + px) * 4;
  const rgb = KERBSIDE32.rgb;
  for (let i = 0; i < 32; i++) {
    if (
      frame.data[o] === rgb[i * 3] &&
      frame.data[o + 1] === rgb[i * 3 + 1] &&
      frame.data[o + 2] === rgb[i * 3 + 2]
    )
      return i;
  }
  return -1;
}

/** Pixels within ±r internal px of the screen position of sim (x, y) whose index is in `indices`. */
function countNear(
  frame: RgbaFrame,
  cam: { x: number; y: number },
  x: number,
  y: number,
  r: number,
  indices: ReadonlySet<number>,
): number {
  const pxPerM = groundPxPerMetre(SWEEP_H);
  const cx = Math.round(frame.width / 2 + (x - cam.x) * pxPerM);
  const cy = Math.round(INTERNAL_HEIGHT_PX / 2 + (y - cam.y) * pxPerM);
  let n = 0;
  for (let py = cy - r; py <= cy + r; py++) {
    for (let px = cx - r; px <= cx + r; px++) {
      if (px < 0 || py < 0 || px >= frame.width || py >= frame.height) continue;
      if (indices.has(indexAt(frame, px, py))) n++;
    }
  }
  return n;
}

/** The hydrant's 17/18/19 red ramp, lit or under a shadow. */
const HYDRANT_REDS: ReadonlySet<number> = new Set(
  [17, 18, 19].flatMap((i) => [i, KERBSIDE32.shadow[i] as number]),
);

test('Puddle Lane start: depot bays, both hydrants with litter in all four rotations, and the skip', async ({
  page,
}, testInfo) => {
  const errors = collectPageErrors(page);
  await openTestScene(page, SHIFT_URL);
  expect((await shiftState(page)).tick).toBe(0);
  // The depot start: Bessie between the two depot bays' markings.
  expect(await drawCalls(page)).toBe(EXPECTED_DRAW_CALLS);
  const depot = await readTestFrame(page);
  expect(depot.width).toBe(WIDTH_PX);
  await saveFrame(testInfo, 'items_depot.png', depot);

  const hydrants = levelItemMarkers(LEVEL).filter((m) => m.frame === 'prop.hydrant:flat:-:0');
  expect(hydrants.map((m) => [m.xM, m.yM])).toEqual([
    [77, 7],
    [51, 15],
  ]);
  const allRots = new Set<number>();
  for (const [name, view] of [
    ['items_hydrant_parade.png', VIEWS.hydrantParade],
    ['items_hydrant_high_street.png', VIEWS.hydrantHigh],
  ] as const) {
    await pinView(page, view.x, view.y);
    expect((await shiftState(page)).tick).toBe(0);
    const calls = await drawCalls(page);
    expect(calls).toBeLessThanOrEqual(DRAW_CALL_BUDGET);
    expect(calls).toBe(EXPECTED_DRAW_CALLS);
    const frame = await readTestFrame(page);
    await saveFrame(testInfo, name, frame);
    for (const h of hydrants) {
      const onScreen = Math.abs(h.xM - view.x) < 14 && Math.abs(h.yM - view.y) < 8;
      if (onScreen) expect(countNear(frame, view, h.xM, h.yM, 10, HYDRANT_REDS)).toBeGreaterThan(20);
    }
    for (const r of visibleRotations(1, view.x, view.y, SWEEP_H)) allRots.add(r);
  }
  // The parade view alone holds all four rotations.
  expect([...visibleRotations(1, VIEWS.hydrantParade.x, VIEWS.hydrantParade.y, SWEEP_H)].sort()).toEqual([
    0, 1, 2, 3,
  ]);
  expect([...allRots].sort()).toEqual([0, 1, 2, 3]);

  await pinView(page, VIEWS.skip.x, VIEWS.skip.y);
  expect(await drawCalls(page)).toBe(EXPECTED_DRAW_CALLS);
  await saveFrame(testInfo, 'items_skip.png', await readTestFrame(page));
  expect(errors).toEqual([]);
});

test('a stain on screen draws in the same items call: a dog mess driven over brush-up leaves a splat', async ({
  page,
}, testInfo) => {
  const errors = collectPageErrors(page);
  await openTestScene(page, `/?test=1&seed=${SPLAT_SEED}&scene=district.puddle_lane&freeze=1`);
  // Full throttle north from the depot, brush up, over the dog mess (removed, a stain.splat in its place, −20),
  // then reverse 300 ticks so Bessie no longer covers the splat.
  await page.keyboard.down('KeyW');
  await page.evaluate(() => window.__ssp?.step(440));
  await page.keyboard.up('KeyW');
  const splatted = await shiftState(page);
  expect(splatted.score).toBeLessThan(0);
  await page.keyboard.down('KeyS');
  await page.evaluate(() => window.__ssp?.step(300));
  await page.keyboard.up('KeyS');
  const state = await shiftState(page);
  expect(state.tick).toBe(740);
  expect(state.bessie.y).toBeGreaterThan(46);

  // The same drive in Node gives the splat's position (the sim is deterministic).
  const world = createWorld(LEVEL, SPLAT_SEED, DEFAULT_TUNING);
  const input = createInputFrame();
  input.throttle = 255;
  for (let t = 0; t < 440; t++) world.step(input);
  expect(world.stains.count).toBe(1);
  const stain = { x: world.stains.x[0] as number, y: world.stains.y[0] as number };
  expect(Math.abs(stain.x - 7)).toBeLessThan(1);

  const view = { x: 7, y: 45 };
  await pinView(page, view.x, view.y);
  const calls = await drawCalls(page);
  expect(calls).toBeLessThanOrEqual(DRAW_CALL_BUDGET);
  expect(calls).toBe(EXPECTED_DRAW_CALLS);
  const frame = await readTestFrame(page);
  await saveFrame(testInfo, 'items_stain.png', frame);
  console.log(
    `[items] splat at (${stain.x.toFixed(2)}, ${stain.y.toFixed(2)}), camera (${view.x}, ${view.y})`,
  );
  expect(errors).toEqual([]);
});
