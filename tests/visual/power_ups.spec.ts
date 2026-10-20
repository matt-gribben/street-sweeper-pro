// Power-ups in the shipping bundle (SSP-096; GDD §12.7, §15.2; ART_BIBLE §8.5, §12.2). No canonical golden (the
// pickup art is a placeholder until SSP-149 and the HUD icon until SSP-156): the frozen frames are written to
// test-results/ as review captures and opened with Read, while the spec checks what must hold exactly.
//
// Puddle Lane places its one power-up, a flask of tea, at a fixed point (SSP-104): the west arm of the Pump Green
// path cross, tile (30, 11), (61, 23) m, off the kerb-hugging route as a temptation. The route below (planned in
// Node with the closed-loop route driver, tools/replays/routeDriver.ts, giving way to the street life like a
// careful player, on the same compiled level and seed, then fed to the page through `__ssp.loadInputs`) drives
// Bessie, brush raised, up Mangle Street, east along Soapsud Terrace, north up Gutter Row and east along Puddle
// Lane, turns in at the Green's entrance (x 32–33, clear of the parking bays since SSP-104) and stops on the
// path 5 m short of the flask (capture 1: `pickup_on_pavement.png`, the flask bobbing on its halo on the slabs
// ahead), then turns onto the cross's west arm and drives over it (capture 2: `powerup_hud.png`, the flask gone,
// the HUD's power-up slot showing its icon and the m:ss countdown).
//
// Exactly: the browser and Node sims agree tick for tick (the pickup, the collection tick, the countdown; poses on
// the replay hash's 1e-4 grid); the
// frame is deterministic; the flask's cell draws over the path's slabs in capture 1 and is gone from the same
// ground in capture 2; the HUD's power-up slot shows the flask icon's council blue and the countdown's chalk only
// once it is collected.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, type Page, type TestInfo, test } from '@playwright/test';
import type { ShiftTestState, TestState } from '../../src/debug/testHooks.ts';
import { EV } from '../../src/sim/eventQueue.ts';
import { decodeLevel } from '../../src/sim/map.ts';
import { encodeInputs, HASH_QUANTUM, runReplay } from '../../src/sim/replay.ts';
import { DEFAULT_TUNING } from '../../src/sim/tuning.ts';
import { driveRoute, type Step } from '../../tools/replays/routeDriver.ts';
import {
  collectPageErrors,
  encodeFramePng,
  frameSha256,
  openTestScene,
  type RgbaFrame,
  readTestFrame,
} from '../support/visualGolden.ts';

const SEED = 1;
const SHIFT_URL = `/?test=1&seed=${SEED}&scene=district.puddle_lane&freeze=1`;
const LEVEL = decodeLevel(
  readFileSync(
    fileURLToPath(new URL('../../public/assets/levels/puddle_lane.json', import.meta.url)),
    'utf8',
  ),
);
/** Where level.json puts the flask (powerups.at [30.5, 11.5] tiles): the centre of path tile (30, 11). */
const FLASK = { id: 'pwr.flask_of_tea', x: 61, y: 23 } as const;

/** Soapsud Terrace's north kerb lane (rows 21–23, centre y = 45; 1.0 m in from the kerb at y = 42). */
const LANE_Y = 43.2;
/** Puddle Lane's eastbound kerb lane (rows 4–6, centre y = 11; 1.2 m in from the north kerb at y = 8). */
const PUDDLE_LANE_Y = 9.2;
/** The Pump Green entrance path (x 32–33, 64–68 m), Bessie's rear axle 0.5 m west of its middle. */
const GREEN_X = 65.5;
const CORNER_MPS = 2.5;
const ROUTE: readonly Step[] = [
  {
    kind: 'drive',
    label: 'up Mangle Street and east along Soapsud Terrace',
    path: [
      [7, 60],
      [7, 50],
      [9, 46],
      [14, LANE_Y],
      [40, LANE_Y],
    ],
    speedMps: 6,
    exitMps: CORNER_MPS,
  },
  {
    kind: 'drive',
    label: 'left into Gutter Row and north',
    path: [
      [43.5, 41.7],
      [45, 38.2],
      [45, 16],
    ],
    speedMps: 6,
    exitMps: CORNER_MPS,
  },
  {
    kind: 'drive',
    label: 'right into Puddle Lane and east',
    path: [
      [46.5, 12.5],
      [50, 11],
      [54, PUDDLE_LANE_Y],
      [60.5, PUDDLE_LANE_Y],
    ],
    speedMps: 5,
    exitMps: CORNER_MPS,
  },
  {
    kind: 'drive',
    label: 'right over the kerb into the Pump Green entrance',
    path: [
      [64, 11],
      [GREEN_X, 14.5],
      [GREEN_X, 19.3],
    ],
    speedMps: CORNER_MPS,
    exitMps: 0.5,
  },
  { kind: 'stop', label: 'stop short of the flask' },
  {
    kind: 'drive',
    label: 'onto the west arm of the path cross and over the flask',
    path: [
      [64.33, 22.13],
      [61.5, 23.3],
      [56.5, 23.3],
    ],
    speedMps: 1.5,
    exitMps: 0.5,
  },
  { kind: 'stop', label: 'stop past the flask' },
];
const ROUTE_TICKS = 4800;

/** A Kerbside-32 colour's RGB by name, from assets-src/palette/kerbside32.json (the truth for colour values). */
const PALETTE = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../assets-src/palette/kerbside32.json', import.meta.url)), 'utf8'),
) as { colors: { name: string; hex: string }[] };
function rgbOf(name: string): readonly number[] {
  const hex = PALETTE.colors.find((c) => c.name === name)?.hex;
  if (hex === undefined) throw new Error(`no palette colour ${name}`);
  return [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
}
/** The HUD's countdown ink (07 chalk) and the flask icon's body (26 council blue). */
const CHALK = rgbOf('chalk');
const COUNCIL_BLUE = rgbOf('council_blue');

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
  await page.evaluate((k) => window.__ssp?.step(k), n);
  return shiftState(page);
}

async function saveCapture(testInfo: TestInfo, name: string, frame: RgbaFrame): Promise<void> {
  const path = testInfo.outputPath(name);
  writeFileSync(path, encodeFramePng(frame));
  await testInfo.attach(name, { path, contentType: 'image/png' });
  console.log(`[power_ups] ${name} ${frame.width}x${frame.height} sha256=${frameSha256(frame)} -> ${path}`);
}

/** Pixels of frame colour `rgb` inside the box (x0, y0) .. (x1, y1) exclusive. */
function countColour(
  frame: RgbaFrame,
  rgb: readonly number[],
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): number {
  let n = 0;
  for (let y = Math.max(0, y0); y < Math.min(frame.height, y1); y++) {
    for (let x = Math.max(0, x0); x < Math.min(frame.width, x1); x++) {
      const o = (y * frame.width + x) * 4;
      if (frame.data[o] === rgb[0] && frame.data[o + 1] === rgb[1] && frame.data[o + 2] === rgb[2]) n++;
    }
  }
  return n;
}

/** Pixels that differ between box `a` of frame `fa` and the same-sized box `b` of frame `fb`. */
function boxDifference(
  fa: RgbaFrame,
  a: readonly [number, number, number, number],
  fb: RgbaFrame,
  b: readonly [number, number, number, number],
): number {
  let n = 0;
  for (let dy = 0; dy < a[3] - a[1]; dy++) {
    for (let dx = 0; dx < a[2] - a[0]; dx++) {
      const oa = ((a[1] + dy) * fa.width + a[0] + dx) * 4;
      const ob = ((b[1] + dy) * fb.width + b[0] + dx) * 4;
      if (
        fa.data[oa] !== fb.data[ob] ||
        fa.data[oa + 1] !== fb.data[ob + 1] ||
        fa.data[oa + 2] !== fb.data[ob + 2]
      )
        n++;
    }
  }
  return n;
}

/** The pickup's screen box: the camera (state.camera, ground-locked at 16 px/m with springs off) → pixels. */
function pickupBox(state: ShiftTestState, width: number): [number, number, number, number] {
  const cx = width / 2 + (FLASK.x - state.camera.x) * 16;
  const cy = 135 + (FLASK.y - state.camera.y) * 16;
  const x0 = Math.round(cx - 8);
  const y0 = Math.round(cy - 8);
  return [x0, y0, x0 + 16, y0 + 16];
}

test('a power-up bobs on the pavement, and collecting it shows its icon and m:ss countdown on the HUD', async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  const errors = collectPageErrors(page);
  // Plan the route in Node on the same level and seed (the sim is f(seed, district, inputs)).
  const drive = driveRoute(LEVEL, DEFAULT_TUNING, SEED, ROUTE, ROUTE_TICKS, { yieldToStreet: true });
  const report = (label: string) => drive.reports.find((r) => r.label === label);
  const stopShort = report('stop short of the flask');
  const over = report('onto the west arm of the path cross and over the flask');
  const stopPast = report('stop past the flask');
  if (stopShort === undefined || over === undefined || stopPast === undefined) {
    throw new Error('route did not run every step');
  }
  expect(stopPast.endTick).toBeLessThan(ROUTE_TICKS);
  expect(over.events[EV.PowerUp], 'the flask is collected while driving over it').toBe(1);
  for (const r of drive.reports) if (r !== over) expect(r.events[EV.PowerUp] ?? 0, r.label).toBe(0);

  await openTestScene(page, SHIFT_URL);
  let state = await shiftState(page);
  expect(state.pickups).toEqual([FLASK]);
  expect(state.powerUps).toEqual([]);
  await page.evaluate(({ inputs, ticks }) => window.__ssp?.loadInputs(inputs, ticks), {
    inputs: encodeInputs(drive.log),
    ticks: ROUTE_TICKS,
  });

  // Capture 1: stopped short of the flask, which bobs on its halo on the slabs ahead.
  state = await step(page, stopShort.endTick + 1);
  expect(state.pickups).toEqual([FLASK]);
  expect(Math.abs(state.bessie.speed)).toBeLessThan(0.05);
  expect(Math.hypot(FLASK.x - state.bessie.x, FLASK.y - state.bessie.y)).toBeGreaterThan(5);
  const before = await readTestFrame(page);
  await saveCapture(testInfo, 'pickup_on_pavement.png', before);
  expect(frameSha256(await readTestFrame(page))).toBe(frameSha256(before));
  const beforeBox = pickupBox(state, before.width);
  console.log(
    `[power_ups] stopped at (${state.bessie.x}, ${state.bessie.y}); camera ${JSON.stringify(state.camera)}`,
  );

  // Capture 2: over the flask and stopped past it: the HUD shows the flask's icon and its countdown.
  state = await step(page, stopPast.endTick + 1 - state.tick);
  expect(state.pickups).toEqual([]);
  expect(state.powerUps).toHaveLength(1);
  const tea = state.powerUps[0];
  expect(tea?.id).toBe('pwr.flask_of_tea');
  // 15 s from the pickup tick, so between 0:01 and 0:15 left.
  expect(tea?.ticksLeft ?? 0).toBeGreaterThan(0);
  expect(tea?.ticksLeft ?? 0).toBeLessThanOrEqual(900);
  // Node agrees with the browser tick for tick, on the replay hash's 1e-4 grid: Math.sin in Chromium and Node can
  // differ in the last bit (TECHNICAL_DESIGN §18.6, the smoke spec), and the longer route through the street
  // life since SSP-104 meets it (Bessie's y drifted by 7e-15 m).
  expect(state.tick).toBe(stopPast.endTick + 1);
  const node = runReplay(LEVEL, DEFAULT_TUNING, SEED, drive.log, state.tick).world;
  const q = (v: number): number => Math.round(v * HASH_QUANTUM);
  expect([state.bessie.x, state.bessie.y, state.hp].map(q)).toEqual(
    [node.vehicle.xM, node.vehicle.yM, node.vehicle.hp].map(q),
  );
  expect(state.powerUps).toEqual([
    { id: 'pwr.flask_of_tea', ticksLeft: (node.pickups.untilTick[0] ?? 0) - node.tick },
  ]);
  const after = await readTestFrame(page);
  await saveCapture(testInfo, 'powerup_hud.png', after);
  // The flask's 16×16 cell drew over the slabs in capture 1; the same ground in capture 2 is bare pavement.
  const afterBox = pickupBox(state, after.width);
  expect(afterBox[0], 'the flask spot is on screen in both captures').toBeGreaterThanOrEqual(0);
  expect(
    boxDifference(before, beforeBox, after, afterBox),
    'flask pixels gone from the pavement',
  ).toBeGreaterThan(40);
  // The power-up slot at W = 480: 16×16 icon at (138, 230), countdown box from x = 156 (ART_BIBLE §12.2).
  // The flask icon's 26 council blue body is drawn there, and the countdown's 07 chalk ink beside it.
  expect(countColour(after, COUNCIL_BLUE, 138, 230, 154, 246)).toBeGreaterThan(10);
  expect(countColour(before, COUNCIL_BLUE, 138, 230, 154, 246)).toBe(0);
  expect(countColour(after, CHALK, 156, 233, 184, 242)).toBeGreaterThan(10);
  expect(countColour(before, CHALK, 156, 233, 184, 242)).toBe(0);
  expect(errors).toEqual([]);
});
