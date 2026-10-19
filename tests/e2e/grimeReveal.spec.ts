// The grime reveal in the shipping bundle (SSP-066, TECHNICAL_DESIGN §10.3, §12.4; ART_BIBLE §9.2). No golden (the
// golden scene list is fixed, §18.4; `zoo` arrives in M4): the before and after frames are saved as review captures
// (test-results/grime_before.png and test-results/grime_after.png; open both with Read), and the spec checks:
//
// - before: with the camera pinned over the road north of the depot, every 2 m ground tile on screen and clear of
//   buildings and their shadows equals the CPU reference of the ground shader (tests/support/groundReference.ts)
//   under the grime the World lays for seed 1, cell for cell: grime shows on the route tiles, and on no grass,
//   apron, wall or roof;
// - a scripted brush-down drive (Space edge, W held, between `__ssp.step(n)` calls) clears a stepped band behind
//   Bessie: at least 500 pixels in the driven band differ from the before-frame, every grime cell on screen still
//   shows exactly its initial grime or the clean ground (so the incremental uploads never lose or smear a cell),
//   the swept cells lie inside the band and the World's own count of cleaned cells covers them;
// - the frame stays within the draw-call budget (6 of 10: grime adds no draw);
// - the frozen shift frame over the depot (test-results/grime_depot.png) and a view of the park
//   (test-results/grime_park.png) equal the reference too: no grime on the apron or the grass.
import { expect, type Page, test } from '@playwright/test';
import type { ShiftTestState, TestState } from '../../src/debug/testHooks.ts';
import { SWEEP_HEIGHT_M } from '../../src/render/camera.ts';
import { INTERNAL_HEIGHT_PX } from '../../src/render/upscale.ts';
import { GRIME_CELL_M, PX_PER_M } from '../../src/sim/constants.ts';
import { Ground } from '../../src/sim/map.ts';
import {
  cityCover,
  compareGroundTiles,
  initialGrimeMask,
  loadPuddleLane,
  type Rect,
} from '../support/groundReference.ts';
import { collectPageErrors, openTestScene, readTestFrame } from '../support/visualGolden.ts';
import { saveFrame } from './helpers/saveFrame.ts';

const SHIFT_URL = '/?test=1&seed=1&scene=district.puddle_lane&freeze=1';

/** The pinned camera: over the depot road (x 4–10 m) north of the depot yard, at the sweep height. */
const CAMERA = { x: 7, y: 70, h: SWEEP_HEIGHT_M } as const;

/** A second pinned view: the park (grass and its paths) and the street north of it. */
const PARK_CAMERA = { x: 66, y: 16, h: SWEEP_HEIGHT_M } as const;

/** W at the ci project's 1920×1080 viewport. */
const WIDTH_PX = 480;

/** City + building shadows + Bessie's drop shadow + actors + palette pass + blit (§12.7). */
const EXPECTED_DRAW_CALLS = 6;
const DRAW_CALL_BUDGET = 10;

/** Bessie's start (the depot, facing north) and the grime footprint half-width (tuning.json sweeping.grimeFootprint). */
const START_X_M = 7;
const FOOTPRINT_HALF_WIDTH_M = 1.3;

/** The driven band: the footprint's width either side of her straight path, plus one grime cell for the stepped edge. */
const BAND: Rect = {
  x0: START_X_M - FOOTPRINT_HALF_WIDTH_M - GRIME_CELL_M,
  x1: START_X_M + FOOTPRINT_HALF_WIDTH_M + GRIME_CELL_M,
  y0: -Infinity,
  y1: Infinity,
};

/** The issue's floor: pixels in the band that must change. */
const MIN_CHANGED_PIXELS = 500;

/** Half-size of the square around Bessie's body centre kept out of the ground check (body, brush, drop shadow). */
const BESSIE_CLEAR_M = 4.5;

const { level, atlas } = loadPuddleLane();
const INITIAL_GRIME = initialGrimeMask(level, 1);

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

/** Frame x (internal pixels) of sim x under the pinned camera. */
const frameX = (xM: number): number => WIDTH_PX / 2 + (xM - CAMERA.x) * PX_PER_M;
const frameY = (yM: number): number => INTERNAL_HEIGHT_PX / 2 + (yM - CAMERA.y) * PX_PER_M;

test('grime shows on route tiles and a brush-down drive reveals a clean band behind Bessie', async ({
  page,
}, testInfo) => {
  const errors = collectPageErrors(page);
  await openTestScene(page, SHIFT_URL);
  await page.evaluate(({ x, y, h }) => window.__ssp?.setCamera(x, y, h), CAMERA);
  let state = await step(page, 0);
  expect(state.camera).toMatchObject({ x: CAMERA.x, y: CAMERA.y, h: CAMERA.h, pinned: true });
  expect(state.grime).toEqual({ initial: 9000, cleaned: 0 });
  const viewTopM = CAMERA.y - INTERNAL_HEIGHT_PX / 2 / PX_PER_M;
  const viewBottomM = CAMERA.y + INTERNAL_HEIGHT_PX / 2 / PX_PER_M;
  // Bessie starts in the depot yard, south of the view.
  expect(state.bessie.y - BESSIE_CLEAR_M).toBeGreaterThan(viewBottomM);

  const before = await readTestFrame(page);
  expect([before.width, before.height]).toEqual([WIDTH_PX, INTERNAL_HEIGHT_PX]);
  await saveFrame(testInfo, 'grime_before.png', before, { atResultsRoot: true });
  expect(await page.evaluate(() => window.__ssp?.perf().drawCalls ?? -1)).toBe(EXPECTED_DRAW_CALLS);

  const blocked = cityCover(level, CAMERA.x, CAMERA.y, CAMERA.h);
  const start = compareGroundTiles(before, level, atlas, CAMERA.x, CAMERA.y, blocked, INITIAL_GRIME, true);
  console.log(
    `[grime] before: ${start.checkedTiles} tiles, ${start.checkedCells} cells (${start.grimyCells} grimy), ` +
      `${start.mismatches.length} mismatched`,
  );
  expect(start.checkedTiles).toBeGreaterThanOrEqual(40);
  expect(start.grimyCells).toBeGreaterThanOrEqual(500);
  expect(start.mismatches).toEqual([]);

  // Brush down (one Space edge), then full throttle north until Bessie has left the top of the view.
  await page.keyboard.down('Space');
  await step(page, 1);
  await page.keyboard.up('Space');
  await page.keyboard.down('KeyW');
  for (let i = 0; i < 80 && state.bessie.y + BESSIE_CLEAR_M >= viewTopM; i++) {
    state = await step(page, 10);
    expect(Math.abs(state.bessie.x - START_X_M), 'she drives straight up the road').toBeLessThan(0.2);
  }
  await page.keyboard.up('KeyW');
  state = await step(page, 1);
  expect(state.bessie.y + BESSIE_CLEAR_M).toBeLessThan(viewTopM);
  expect(state.grime.cleaned).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__ssp?.perf().drawCalls ?? -1)).toBeLessThanOrEqual(
    DRAW_CALL_BUDGET,
  );
  expect(await page.evaluate(() => window.__ssp?.perf().drawCalls ?? -1)).toBe(EXPECTED_DRAW_CALLS);

  const after = await readTestFrame(page);
  await saveFrame(testInfo, 'grime_after.png', after, { atResultsRoot: true });

  // Pixels that changed, inside and outside the driven band.
  const bandX0 = Math.floor(frameX(BAND.x0));
  const bandX1 = Math.ceil(frameX(BAND.x1));
  let inBand = 0;
  let outside = 0;
  for (let y = 0; y < INTERNAL_HEIGHT_PX; y++) {
    for (let x = 0; x < WIDTH_PX; x++) {
      const i = (y * WIDTH_PX + x) * 4;
      let differs = false;
      for (let c = 0; c < 4; c++) if (before.data[i + c] !== after.data[i + c]) differs = true;
      if (!differs) continue;
      if (x >= bandX0 && x < bandX1) inBand++;
      else outside++;
    }
  }
  console.log(
    `[grime] after: ${inBand} px changed in the band x ${bandX0}..${bandX1 - 1}, ${outside} outside`,
  );
  expect(inBand).toBeGreaterThanOrEqual(MIN_CHANGED_PIXELS);
  expect(outside).toBe(0);

  // Every grime cell shows its initial grime or the clean ground; the swept ones lie in the band.
  const end = compareGroundTiles(after, level, atlas, CAMERA.x, CAMERA.y, blocked, INITIAL_GRIME, false);
  console.log(
    `[grime] after: ${end.cleanCells.length} grimy cells on screen swept clean, ${end.mismatches.length} mismatched`,
  );
  expect(end.mismatches).toEqual([]);
  expect(end.cleanCells.length).toBeGreaterThanOrEqual(100);
  expect(end.cleanCells.length).toBeLessThanOrEqual(state.grime.cleaned);
  for (const [gx, gy] of end.cleanCells) {
    const xM = (gx + 0.5) * GRIME_CELL_M;
    expect(xM, `swept cell (${gx}, ${gy}) inside the band`).toBeGreaterThan(BAND.x0);
    expect(xM, `swept cell (${gx}, ${gy}) inside the band`).toBeLessThan(BAND.x1);
    expect(frameY((gy + 0.5) * GRIME_CELL_M)).toBeGreaterThanOrEqual(0);
  }
  expect(errors).toEqual([]);
});

test('no grime on the depot apron, the park grass, walls or roofs (the frozen shift frame and the park)', async ({
  page,
}, testInfo) => {
  const errors = collectPageErrors(page);
  await openTestScene(page, SHIFT_URL);
  const depotState = await shiftState(page);
  const depotCamera = depotState.camera;
  const depot = await readTestFrame(page);
  await saveFrame(testInfo, 'grime_depot.png', depot, { atResultsRoot: true });
  const { x: bx, y: by } = depotState.bessie;
  const nearBessie: Rect = {
    x0: bx - BESSIE_CLEAR_M,
    y0: by - BESSIE_CLEAR_M,
    x1: bx + BESSIE_CLEAR_M,
    y1: by + BESSIE_CLEAR_M,
  };
  const depotCheck = compareGroundTiles(
    depot,
    level,
    atlas,
    depotCamera.x,
    depotCamera.y,
    [...cityCover(level, depotCamera.x, depotCamera.y, depotCamera.h), nearBessie],
    INITIAL_GRIME,
    true,
  );

  await page.evaluate(({ x, y, h }) => window.__ssp?.setCamera(x, y, h), PARK_CAMERA);
  await step(page, 0);
  const park = await readTestFrame(page);
  await saveFrame(testInfo, 'grime_park.png', park, { atResultsRoot: true });
  const parkCheck = compareGroundTiles(
    park,
    level,
    atlas,
    PARK_CAMERA.x,
    PARK_CAMERA.y,
    cityCover(level, PARK_CAMERA.x, PARK_CAMERA.y, PARK_CAMERA.h),
    INITIAL_GRIME,
    true,
  );

  const [w] = level.size;
  const views = [
    { name: 'depot', check: depotCheck, ground: Ground.Apron, label: 'apron', min: 10, routeGrime: false },
    { name: 'park', check: parkCheck, ground: Ground.Grass, label: 'grass', min: 20, routeGrime: true },
  ];
  for (const { name, check, ground, label, min, routeGrime } of views) {
    const tiles = check.tiles.filter(([cx, cy]) => level.layers.ground[cy * w + cx] === ground).length;
    console.log(
      `[grime] ${name}: ${check.checkedTiles} tiles (${tiles} ${label}), ${check.grimyCells} grimy cells, ` +
        `${check.mismatches.length} mismatched`,
    );
    // The frame equals the reference cell for cell, and the reference draws no grime on these tiles.
    expect(check.mismatches, name).toEqual([]);
    expect(tiles, `${name}: ${label} tiles compared`).toBeGreaterThanOrEqual(min);
    // The park view also holds grimy streets, so the same frame shows grime beside the clean grass.
    if (routeGrime) expect(check.grimyCells, `${name} shows route grime too`).toBeGreaterThan(0);
  }
  expect(errors).toEqual([]);
});
