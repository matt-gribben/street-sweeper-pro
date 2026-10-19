// The splash fx in the shipping bundle (SSP-102; ART_BIBLE §11, TECHNICAL_DESIGN §12.5, §12.7). No canonical
// golden (the fx frames are placeholders until SSP-154): the frozen frames are written to test-results/ as review
// captures and opened with Read, while the spec checks what must hold exactly.
//
// `?test=1&seed=1&scene=fx_puddle&freeze=1` is Puddle Lane with one haz.puddle placed on Mangle Street at (7, 71)
// (src/scenes/FxPuddleScene.ts; puddles are not drawn until SSP-103/SSP-104). The drive, planned in Node
// (tests/support/fxPuddle.ts: full throttle, brush up, from the depot start), crosses it above 3 m/s; the page
// replays the same log through `__ssp.loadInputs`.
//
// - `fx_before_splash.png`: the frame of the tick before the splash: no fx draw (8 calls), and no 27 sky / 28 spray
//   on the road ahead of Bessie.
// - `fx_splash.png`: SPLASH_AGE_TICKS after the splash: the fx draw is on (9 calls, within 10). The particles Node
//   predicts for the frame (tests/support/fxPuddle.ts predictFx: the same FxParticles, render seed and events) lie
//   round the puddle on both sides of Bessie and behind her front bumper, and the frame draws each 2×2 droplet's
//   colour where it is projected; the road ahead of her bumper holds no 27/28 pixel; the frame is deterministic
//   (two reads, and a second page load, give the same bytes).
// - `fx_splash_late.png`: LATE_AGE_TICKS after the splash, the droplets thrown further out: still none ahead.
// - Once the droplets have died (SPLASH.lifeMaxTicks later) the fx draw is skipped again (8 calls).
import { writeFileSync } from 'node:fs';
import { expect, type Page, type TestInfo, test } from '@playwright/test';
import type { ShiftTestState, TestState } from '../../src/debug/testHooks.ts';
import { groundPxPerMetre } from '../../src/render/camera.ts';
import { FX_COLOUR, SPLASH } from '../../src/render/fx.ts';
import { KERBSIDE32 } from '../../src/render/palettePass.ts';
import { INTERNAL_HEIGHT_PX } from '../../src/render/upscale.ts';
import { FX_PUDDLE } from '../../src/scenes/FxPuddleScene.ts';
import { DEFAULT_TUNING } from '../../src/sim/tuning.ts';
import { FX_PUDDLE_DRIVE_TICKS, planFxPuddle, predictFx } from '../support/fxPuddle.ts';
import {
  collectPageErrors,
  encodeFramePng,
  frameSha256,
  openTestScene,
  type RgbaFrame,
  readTestFrame,
} from '../support/visualGolden.ts';

const SEED = 1;
const URL = `/?test=1&seed=${SEED}&scene=fx_puddle&freeze=1`;

/** Ticks after the splash the review frame is taken: droplets thrown clear, none yet faded. */
const SPLASH_AGE_TICKS = 6;

/** Ticks after the splash of the second review frame, late in the droplets' life (14–24 ticks). */
const LATE_AGE_TICKS = 13;

/** City, building shadows, Bessie's drop shadow, actors, items, the HUD, palette pass, blit (§12.7). */
const DRAW_CALLS_WITHOUT_FX = 8;
const DRAW_CALL_BUDGET = 10;

const BODY = DEFAULT_TUNING.vehicle.sweeper.body;

/** The render alpha of a frozen test frame: the loop is frozen from boot, so its accumulator stays empty. */
const FROZEN_ALPHA = 0;

/** The road ahead of a bumper at sim y `bumperY` (facing north): her width plus 1 m each side, 5 m deep. */
function aheadBox(x: number, bumperY: number): [number, number, number, number] {
  return [x - BODY.widthM / 2 - 1, bumperY - 5, x + BODY.widthM / 2 + 1, bumperY];
}

/** The splash colours: 27 sky and 28 spray (07 chalk glints also appear in lane markings, so they are not counted). */
const WATER: ReadonlySet<number> = new Set([FX_COLOUR.sky, FX_COLOUR.spray]);

async function shiftState(page: Page): Promise<ShiftTestState> {
  const state = await page.evaluate((): TestState => {
    const api = window.__ssp;
    if (api === undefined) throw new Error('window.__ssp missing');
    return api.state();
  });
  if (!('bessie' in state)) throw new Error(`state() is not a shift snapshot: ${JSON.stringify(state)}`);
  return state;
}

/** Steps the page `n` ticks (one render) and returns the state and the frame's draw calls. */
async function step(page: Page, n: number): Promise<{ state: ShiftTestState; drawCalls: number }> {
  const drawCalls = await page.evaluate((k) => {
    const api = window.__ssp;
    if (api === undefined) throw new Error('window.__ssp missing');
    api.step(k);
    return api.perf().drawCalls;
  }, n);
  return { state: await shiftState(page), drawCalls };
}

async function saveCapture(testInfo: TestInfo, name: string, frame: RgbaFrame): Promise<void> {
  const path = testInfo.outputPath(name);
  writeFileSync(path, encodeFramePng(frame));
  await testInfo.attach(name, { path, contentType: 'image/png' });
  console.log(`[fx_splash] ${name} ${frame.width}x${frame.height} sha256=${frameSha256(frame)} -> ${path}`);
}

/** Palette index of a pixel (−1 off-palette, which the palette pass never emits). */
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

/** Maps sim metres to frame pixels for this frame's camera (straight down: centre + offset × px/m). */
function projector(state: ShiftTestState, width: number): (x: number, y: number) => [number, number] {
  const pxPerM = groundPxPerMetre(state.camera.h);
  return (x, y) => [
    width / 2 + (x - state.camera.x) * pxPerM,
    INTERNAL_HEIGHT_PX / 2 + (y - state.camera.y) * pxPerM,
  ];
}

/** Pixels whose index is in `indices` inside the sim-metre box [x0, x1) × [y0, y1), and their mean screen x. */
function countIn(
  frame: RgbaFrame,
  project: (x: number, y: number) => [number, number],
  box: readonly [x0: number, y0: number, x1: number, y1: number],
  indices: ReadonlySet<number>,
): { n: number; xs: number[] } {
  const [ax, ay] = project(box[0], box[1]);
  const [bx, by] = project(box[2], box[3]);
  const xs: number[] = [];
  for (let py = Math.max(0, Math.floor(ay)); py < Math.min(frame.height, Math.ceil(by)); py++) {
    for (let px = Math.max(0, Math.floor(ax)); px < Math.min(frame.width, Math.ceil(bx)); px++) {
      if (indices.has(indexAt(frame, px, py))) xs.push(px);
    }
  }
  return { n: xs.length, xs };
}

test('a fast puddle crossing throws splash droplets round the puddle and none in front of Bessie', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const errors = collectPageErrors(page);
  const plan = planFxPuddle(SEED);
  expect(plan.splashSpeedMps, 'the crossing is above the 3 m/s splash speed').toBeGreaterThan(3);
  console.log(`[fx_splash] splash on tick ${plan.splashTick} at ${plan.splashSpeedMps.toFixed(2)} m/s`);

  await openTestScene(page, URL);
  await page.evaluate(({ inputs, ticks }) => window.__ssp?.loadInputs(inputs, ticks), {
    inputs: plan.inputs,
    ticks: FX_PUDDLE_DRIVE_TICKS,
  });

  // The tick before the splash: no particles, no fx draw.
  const before = await step(page, plan.splashTick);
  expect(before.state.tick).toBe(plan.splashTick);
  expect(before.drawCalls).toBe(DRAW_CALLS_WITHOUT_FX);
  const beforeFrame = await readTestFrame(page);
  await saveCapture(testInfo, 'fx_before_splash.png', beforeFrame);
  const project0 = projector(before.state, beforeFrame.width);
  const bumper0 = before.state.bessie.y - BODY.lengthM / 2;
  const ahead0 = aheadBox(before.state.bessie.x, bumper0);
  expect(
    countIn(beforeFrame, project0, ahead0, WATER).n,
    'no water on the road ahead before the splash',
  ).toBe(0);

  // Just after the splash.
  const after = await step(page, 1 + SPLASH_AGE_TICKS);
  expect(after.state.tick).toBe(plan.splashTick + 1 + SPLASH_AGE_TICKS);
  expect(after.drawCalls, 'the fx draw joins the frame').toBe(DRAW_CALLS_WITHOUT_FX + 1);
  expect(after.drawCalls).toBeLessThanOrEqual(DRAW_CALL_BUDGET);
  const frame = await readTestFrame(page);
  await saveCapture(testInfo, 'fx_splash.png', frame);
  expect(frameSha256(await readTestFrame(page))).toBe(frameSha256(frame));
  const project = projector(after.state, frame.width);
  const { bessie } = after.state;
  expect(Math.abs(bessie.heading), 'Bessie drives straight north').toBeLessThan(1e-6);
  console.log(
    `[fx_splash] Bessie (${bessie.x}, ${bessie.y}) at ${bessie.speed} m/s; camera ${JSON.stringify(after.state.camera)}`,
  );

  // What the scene draws, worked out in Node with the same render seed and events: every droplet round the puddle,
  // behind her front bumper, on both sides of her.
  const predicted = predictFx(plan, SEED, after.state.tick, FROZEN_ALPHA);
  expect([predicted.bessie.x, predicted.bessie.y]).toEqual([bessie.x, bessie.y]);
  const droplets = predicted.particles;
  expect(droplets.length).toBeGreaterThanOrEqual(SPLASH.minParticles);
  const bumperY = bessie.y - BODY.lengthM / 2;
  for (const p of droplets) {
    expect(p.y, 'every droplet is behind her front bumper').toBeGreaterThan(bumperY);
    expect(Math.hypot(p.x - FX_PUDDLE.x, p.y - FX_PUDDLE.y), 'round the puddle').toBeLessThan(3);
  }
  const west = droplets.filter((p) => p.x < bessie.x).length;
  const east = droplets.filter((p) => p.x > bessie.x).length;
  console.log(
    `[fx_splash] ${droplets.length} droplets (west ${west}, east ${east}); bumper at y = ${bumperY}`,
  );
  expect(west).toBeGreaterThan(0);
  expect(east).toBeGreaterThan(0);
  // The frame shows them: each 2×2 droplet's colour is drawn where it is projected.
  const big = droplets.filter((p) => p.size === 2);
  const shown = big.filter((p) => {
    const [sx, sy] = project(p.x, p.y);
    for (let py = Math.floor(sy) - 1; py <= Math.floor(sy) + 1; py++) {
      for (let px = Math.floor(sx) - 1; px <= Math.floor(sx) + 1; px++)
        if (indexAt(frame, px, py) === p.colour) return true;
    }
    return false;
  });
  expect(shown.length, 'droplets drawn where Node puts them').toBe(big.length);
  // On the road ahead of her front bumper: no droplet.
  expect(countIn(frame, project, aheadBox(bessie.x, bumperY), WATER).n, 'no droplet in front of Bessie').toBe(
    0,
  );

  // Later in the droplets' life (review capture): thrown further out, still none ahead of her.
  const late = await step(page, LATE_AGE_TICKS - SPLASH_AGE_TICKS);
  expect(late.drawCalls).toBe(DRAW_CALLS_WITHOUT_FX + 1);
  const lateFrame = await readTestFrame(page);
  await saveCapture(testInfo, 'fx_splash_late.png', lateFrame);
  const lateBumperY = late.state.bessie.y - BODY.lengthM / 2;
  expect(
    countIn(
      lateFrame,
      projector(late.state, lateFrame.width),
      aheadBox(late.state.bessie.x, lateBumperY),
      WATER,
    ).n,
  ).toBe(0);
  for (const p of predictFx(plan, SEED, late.state.tick, FROZEN_ALPHA).particles) {
    expect(p.y).toBeGreaterThan(lateBumperY);
  }

  // Once every droplet has died, the fx draw is skipped again.
  const later = await step(page, SPLASH.lifeMaxTicks);
  expect(later.drawCalls).toBe(DRAW_CALLS_WITHOUT_FX);
  expect(errors).toEqual([]);

  // A second page load gives the same frame (render-side seed, tick-driven particles).
  await openTestScene(page, URL);
  await page.evaluate(({ inputs, ticks }) => window.__ssp?.loadInputs(inputs, ticks), {
    inputs: plan.inputs,
    ticks: FX_PUDDLE_DRIVE_TICKS,
  });
  await step(page, plan.splashTick + 1 + SPLASH_AGE_TICKS);
  expect(frameSha256(await readTestFrame(page))).toBe(frameSha256(frame));
});
