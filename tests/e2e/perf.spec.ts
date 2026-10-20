// Performance budgets (TECHNICAL_DESIGN §12.7, §17, §18.6; ROADMAP §8 D-08; SSP-023). Two behaviours, one per
// Playwright project (selected by tag in playwright.config.ts):
//
// - `ci` (headless SwiftShader, `npm run test:e2e`): draw calls ≤ 10 per frame over every pass, read from
//   `__ssp.perf().drawCalls` (renderer.info with autoReset = false). A CPU rasteriser on a shared runner says
//   nothing about GPU frame time, so this project asserts no frame timing. The sim-step assertion joined it with the
//   first stress scene (M3, SSP-106; below). Since SSP-102 a second `ci` check counts the draws of
//   a shift with fx particles alive (the fx_puddle splash): one more draw while droplets live, still within 10.
//   Since SSP-103 a third counts them on the populated Puddle Lane (tick 7800, seed 1) with NPCs, moving and parked
//   traffic, knockables and hazard decals on screen (worked out from the same seeded World in Node): 8 draws, the
//   street adding none. Since SSP-106 a fourth runs the NPC budget's stress scene (`scene=stress`: High Street with
//   2,000 litter, 80 NPCs, 30 vehicles, 128 knockables and 64 hazards, src/debug/stress.ts) for a minute of sim
//   after a minute of warm-up and asserts the draw calls of every frame and the sim step budget: the nearest-rank
//   p99 of `__ssp.perf().stepMs`, the per-tick fixedUpdate CPU time, ≤ SIM_STEP_P99_BUDGET_MS (D-08-derived,
//   tests/support/frameStats.ts). SwiftShader rasterises off the main thread, so the tick's time is the CPU's.
// - `gpu` (headed Chromium on the real GPU, local only: `npx playwright test tests/e2e/perf.spec.ts
//   --project=gpu`): samples requestAnimationFrame timestamp deltas from `__ssp.perf().frameMs` and asserts
//   their p99 against P99_FRAME_TIME_BUDGET_MS. Never run by `npm run test:e2e`, `npm run ci` or ci.yml.
//   On an idle laptop prefix `caffeinate -dims` (macOS maintenance sleep stalls the page; the test detects it),
//   and keep to one worker: parallel headed windows share the GPU and the display.
//
// M0 scene: lean_quadrants (the spike scene), animating (no freeze): four Bessies cycling 32 headings with
// spinning brushes, four pedestrians, twelve buildings with shadows. M7 (SSP-247) moves both behaviours to the
// Civic Quarter stress load; the final perf scene is Kebab Mile at night with max litter (§18.6).
import { expect, type Page, test } from '@playwright/test';
import { isShiftTestState, type TestPerf } from '../../src/debug/testHooks.ts';
import { cameraGroundRect, createCameraRig, pinCameraRig } from '../../src/render/camera.ts';
import { SPLASH } from '../../src/render/fx.ts';
import { HEADING_COUNT } from '../../src/render/headings.ts';
import { FRAMES_PER_HEADING } from '../../src/render/spikeActors.ts';
import { BODY_CAPACITY } from '../../src/sim/bodies.ts';
import { HAZARD_CAPACITY } from '../../src/sim/hazards.ts';
import { LITTER_CAPACITY } from '../../src/sim/litter.ts';
import { NPC_CAPACITY } from '../../src/sim/npc/store.ts';
import { VEHICLE_CAPACITY, VEHICLE_FLAG } from '../../src/sim/vehicleStore.ts';
import { idleWorld, puddleLaneLevel } from '../support/actorReference.ts';
import { frameStats, roundStats, SIM_STEP_P99_BUDGET_MS } from '../support/frameStats.ts';
import { FX_PUDDLE_DRIVE_TICKS, planFxPuddle } from '../support/fxPuddle.ts';
import { stressRig } from '../support/stressWorld.ts';
import { readTestFrame } from '../support/visualGolden.ts';
import { saveFrame } from './helpers/saveFrame.ts';

/** Draw-call budget per frame, all passes (§12.7: 9 allocated + 1 spare for the dev panel). */
const DRAW_CALL_BUDGET = 10;

/**
 * Baseline p99 frame time on the dev Mac, in ms (D-08, SSP-023, 2026-10-19): the worst of five 30 s windows
 * (10.2, 10.3, 10.3, 10.3, 10.2 ms; 18,003 frames in all) of lean_quadrants in this spec's `gpu` behaviour on a
 * MacBook Pro M4 Pro (Mac16,8), built-in 120 Hz display, Playwright 1.64.1 Chromium 156, ANGLE Metal. The frame
 * callback's CPU time was 0.2 ms p99, so the baseline is the platform's rAF jitter around the 8.33 ms vsync.
 */
const BASELINE_P99_MS = 10.3;

/**
 * Headroom for M6 content (D-08): ×2. One extra 120 Hz vsync at p99, so the budget still means "60 fps holds for
 * 99% of frames" on the 120 Hz dev display (two vsyncs, 16.7 ms, pass; three, 25 ms, fail) and "no more than 1%
 * of frames miss vsync" on a 60 Hz one. The spike draws 12 sprites; M6 brings the §17 capacities (2,000 litter,
 * 80 NPCs, 30 vehicles), 9 draw calls and a ≤ 2 ms sim. Rationale in ROADMAP §8 D-08 and TECHNICAL_DESIGN §17.
 */
const M6_HEADROOM_FACTOR = 2;

/**
 * p99 frame-time budget for the `gpu` project, in ms: BASELINE_P99_MS × M6_HEADROOM_FACTOR (D-08, TECHNICAL_DESIGN
 * §17; tests/unit/perfBudget.test.ts keeps the docs in step). A gate from the vertical slice (VS-7) and M7.
 * Changing it after M0 needs an ADR.
 */
const P99_FRAME_TIME_BUDGET_MS = 20.6;

/** Frames discarded after `ready` before sampling (JIT warm-up, first texture uploads, window settling). */
const GPU_WARMUP_MS = 3_000;

/** Length of the sampling window: 3,600 frames at 120 Hz, 1,800 at 60 Hz. */
const GPU_SAMPLE_MS = 30_000;

/** A window with fewer samples than this cannot give a meaningful p99 (≥ 10 samples above it). */
const GPU_MIN_SAMPLES = 1_000;

/** World pass (≥ 1 draw), palette pass and blit: fewer means the counter missed a pass (autoReset on). */
const MIN_PLAUSIBLE_DRAW_CALLS = 3;

const SCENE_URL = '/?test=1&seed=1&scene=lean_quadrants';

/** The stress scene's seed (`?test=1&scene=stress`, SSP-106). */
const STRESS_SEED = 1;
/** Ticks run before the stress scene's samples are cleared: the population fills and Chromium tiers the tick up. */
const STRESS_WARMUP_TICKS = 3600;
/** The measured minute of sim. */
const STRESS_MEASURED_TICKS = 3600;
/** Ticks per rendered frame while measuring (`step(n)` renders once): 360 frames of draw calls. */
const STRESS_TICKS_PER_FRAME = 10;

/** Fails the test on any console error or uncaught page error. */
function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    // Headed Chromium asks for /favicon.ico, which the game does not ship; headless never does.
    if (msg.type() === 'error' && !msg.location().url.endsWith('/favicon.ico')) errors.push(msg.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

async function openScene(page: Page, query: string): Promise<void> {
  await page.goto(`${SCENE_URL}${query}`);
  await page.waitForFunction(() => window.__ssp?.ready === true);
}

async function readPerf(page: Page): Promise<TestPerf> {
  return page.evaluate(() => {
    const api = window.__ssp;
    if (api === undefined) throw new Error('window.__ssp missing: is ?test=1 set?');
    return api.perf();
  });
}

test('draw calls stay within the budget on lean_quadrants', { tag: '@ci' }, async ({ page }) => {
  const errors = collectErrors(page);
  await openScene(page, '&freeze=1');

  const counts: number[] = [];
  counts.push((await readPerf(page)).drawCalls);
  // One rendered frame per heading: every Bessie shows all 32 headings once.
  for (let i = 0; i < HEADING_COUNT; i++) {
    counts.push(
      await page.evaluate((ticks) => {
        const api = window.__ssp;
        if (api === undefined) throw new Error('window.__ssp missing');
        api.step(ticks);
        return api.perf().drawCalls;
      }, FRAMES_PER_HEADING),
    );
  }
  const maxCalls = Math.max(...counts);
  const minCalls = Math.min(...counts);
  test.info().annotations.push({
    type: 'draw-calls',
    description: `min ${minCalls}, max ${maxCalls} over ${counts.length} frames (budget ${DRAW_CALL_BUDGET})`,
  });
  console.log(`[perf:ci] draw calls min ${minCalls} max ${maxCalls} over ${counts.length} frames`);

  expect(minCalls, 'draw-call counter must count every pass').toBeGreaterThanOrEqual(
    MIN_PLAUSIBLE_DRAW_CALLS,
  );
  expect(maxCalls, `draw calls per frame (budget ${DRAW_CALL_BUDGET})`).toBeLessThanOrEqual(DRAW_CALL_BUDGET);
  expect(errors).toEqual([]);
});

test('draw calls stay within the budget with fx particles active (fx_puddle splash, SSP-102)', {
  tag: '@ci',
}, async ({ page }) => {
  const errors = collectErrors(page);
  // The splash drive planned in Node (tests/support/fxPuddle.ts), replayed by World tick.
  const plan = planFxPuddle(1);
  await page.goto('/?test=1&seed=1&scene=fx_puddle&freeze=1');
  await page.waitForFunction(() => window.__ssp?.ready === true);
  await page.evaluate(({ inputs, ticks }) => window.__ssp?.loadInputs(inputs, ticks), {
    inputs: plan.inputs,
    ticks: FX_PUDDLE_DRIVE_TICKS,
  });
  const counts = await page.evaluate(
    ({ upTo, frames }) => {
      const api = window.__ssp;
      if (api === undefined) throw new Error('window.__ssp missing');
      api.step(upTo);
      const out = [api.perf().drawCalls];
      for (let i = 0; i < frames; i++) {
        api.step(1);
        out.push(api.perf().drawCalls);
      }
      return out;
    },
    { upTo: plan.splashTick, frames: SPLASH.lifeMaxTicks + 2 },
  );
  const maxCalls = Math.max(...counts);
  console.log(`[perf:ci] fx_puddle draw calls ${counts.join(' ')} (budget ${DRAW_CALL_BUDGET})`);
  // Before the splash: no fx draw. While droplets live: exactly one more. After the last dies: skipped again.
  expect(counts[0]).toBe(maxCalls - 1);
  expect(counts.filter((n) => n === maxCalls).length).toBeGreaterThanOrEqual(SPLASH.lifeMinTicks);
  expect(counts[counts.length - 1]).toBe(maxCalls - 1);
  expect(maxCalls, `draw calls per frame with particles (budget ${DRAW_CALL_BUDGET})`).toBeLessThanOrEqual(
    DRAW_CALL_BUDGET,
  );
  expect(errors).toEqual([]);
});

test('draw calls stay within the budget with NPCs, traffic, knockables and hazards on screen (Puddle Lane, SSP-103)', {
  tag: '@ci',
}, async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  const tick = 7800;
  await page.goto(`/?test=1&seed=1&scene=district.puddle_lane&tick=${tick}&freeze=1`);
  await page.waitForFunction(() => window.__ssp?.ready === true);
  // The views and what each holds, from the same seeded World in Node (no input: Bessie stays in the depot).
  const world = idleWorld(puddleLaneLevel(), 1, tick);
  const views = [
    { x: 56, y: 13, h: 31.5 },
    { x: 79, y: 23, h: 31.5 },
    { x: 60, y: 14, h: 37.8 },
  ];
  const seen = { npcs: 0, moving: 0, parked: 0, knockables: 0, hazards: 0 };
  const counts: number[] = [];
  for (const view of views) {
    const rig = createCameraRig(480);
    pinCameraRig(rig, view.x, view.y, view.h);
    const r = cameraGroundRect(rig, 0, { minX: 0, minY: 0, maxX: 0, maxY: 0 });
    const inside = (x: number, y: number): boolean => x > r.minX && x < r.maxX && y > r.minY && y < r.maxY;
    for (let i = 0; i < world.npc.count; i++)
      if (inside(world.npc.x[i] ?? 0, world.npc.y[i] ?? 0)) seen.npcs++;
    for (let i = 0; i < world.vehicles.count; i++) {
      if (!inside(world.vehicles.x[i] ?? 0, world.vehicles.y[i] ?? 0)) continue;
      if (((world.vehicles.flags[i] ?? 0) & VEHICLE_FLAG.PARKED) !== 0) seen.parked++;
      else seen.moving++;
    }
    for (let i = 0; i < world.bodies.count; i++) {
      if (inside(world.bodies.x[i] ?? 0, world.bodies.y[i] ?? 0)) seen.knockables++;
    }
    for (let i = 0; i < world.hazards.count; i++) {
      if (inside(world.hazards.x[i] ?? 0, world.hazards.y[i] ?? 0)) seen.hazards++;
    }
    counts.push(
      await page.evaluate(({ x, y, h }) => {
        const api = window.__ssp;
        if (api === undefined) throw new Error('window.__ssp missing');
        api.setCamera(x, y, h);
        api.step(0);
        return api.perf().drawCalls;
      }, view),
    );
  }
  console.log(
    `[perf:ci] street draw calls ${counts.join(' ')} with ${JSON.stringify(seen)} (budget ${DRAW_CALL_BUDGET})`,
  );
  expect(seen.npcs).toBeGreaterThan(0);
  expect(seen.moving).toBeGreaterThan(0);
  expect(seen.parked).toBeGreaterThan(0);
  expect(seen.knockables).toBeGreaterThan(0);
  expect(seen.hazards).toBeGreaterThan(0);
  for (const n of counts) {
    expect(n).toBeGreaterThanOrEqual(MIN_PLAUSIBLE_DRAW_CALLS);
    expect(
      n,
      `draw calls per frame on the populated street (budget ${DRAW_CALL_BUDGET})`,
    ).toBeLessThanOrEqual(DRAW_CALL_BUDGET);
  }
  expect(errors).toEqual([]);
});

test(
  'draw calls and the sim step stay within budget on the stress scene (80 NPCs, 30 vehicles, 2,000 litter; SSP-106)',
  {
    tag: '@ci',
  },
  async ({ page }, testInfo) => {
    test.setTimeout(300_000);
    const errors = collectErrors(page);
    await page.goto(`/?test=1&seed=${STRESS_SEED}&scene=stress&freeze=1`);
    await page.waitForFunction(() => window.__ssp?.ready === true);
    // Warm-up: the population fills at two a second and Chromium tiers the tick up, then the samples are cleared.
    const warm = await page.evaluate(
      ({ frames, per }) => {
        const api = window.__ssp;
        if (api === undefined) throw new Error('window.__ssp missing');
        for (let i = 0; i < frames; i++) api.step(per);
        api.perfReset();
        return api.state();
      },
      { frames: STRESS_WARMUP_TICKS / STRESS_TICKS_PER_FRAME, per: STRESS_TICKS_PER_FRAME },
    );
    // The measured minute: one render every STRESS_TICKS_PER_FRAME ticks, its draw calls read after each.
    const counts = await page.evaluate(
      ({ frames, per }) => {
        const api = window.__ssp;
        if (api === undefined) throw new Error('window.__ssp missing');
        const out: number[] = [];
        for (let i = 0; i < frames; i++) {
          api.step(per);
          out.push(api.perf().drawCalls);
        }
        return out;
      },
      { frames: STRESS_MEASURED_TICKS / STRESS_TICKS_PER_FRAME, per: STRESS_TICKS_PER_FRAME },
    );
    const perf = await readPerf(page);
    const end = await page.evaluate(() => {
      const api = window.__ssp;
      if (api === undefined) throw new Error('window.__ssp missing');
      return api.state();
    });
    if (!isShiftTestState(warm) || !isShiftTestState(end))
      throw new Error('the stress scene must be a shift');
    await saveFrame(testInfo, 'stress_scene.png', await readTestFrame(page), { atResultsRoot: true });

    // The same World in Node (src/debug/stress.ts through tests/support/stressWorld.ts) to the warm-up's end: what
    // the browser's stores hold that SimSnapshot does not show, and the browser's World on the replay hash's 1e-4 grid.
    const rig = stressRig(STRESS_SEED);
    for (let t = 0; t < STRESS_WARMUP_TICKS; t++) rig.step();
    const q = (v: number): number => Math.round(v * 1e4);
    const node = {
      tick: rig.world.tick,
      bessie: [q(rig.world.vehicle.xM), q(rig.world.vehicle.yM)],
      npcs: rig.world.npc.count,
      vehicles: rig.world.vehicles.count,
      litter: rig.world.litter.count,
      knockables: rig.world.bodies.count,
      hazards: rig.world.hazards.count,
    };
    const step = frameStats(perf.stepMs);
    const report = {
      budgetMs: SIM_STEP_P99_BUDGET_MS,
      stepMs: roundStats(step),
      stepSamples: perf.stepMs.length,
      stepOverflow: perf.stepOverflow,
      drawCalls: { min: Math.min(...counts), max: Math.max(...counts), frames: counts.length },
      npcs: { warm: warm.npcs.length, end: end.npcs.length },
      node,
      browser: { tick: warm.tick, bessie: [q(warm.bessie.x), q(warm.bessie.y)] },
    };
    console.log(`[perf:ci] stress ${JSON.stringify(report)}`);
    testInfo.annotations.push({ type: 'perf-stress', description: JSON.stringify(report) });

    // The scene holds the stress load: every store at capacity (Node), the browser's NPCs with it.
    expect(node.tick).toBe(warm.tick);
    expect(node.npcs).toBeGreaterThanOrEqual(NPC_CAPACITY - 4);
    expect(node.vehicles).toBeGreaterThanOrEqual(VEHICLE_CAPACITY - 4);
    expect(node.litter).toBeGreaterThanOrEqual(LITTER_CAPACITY - 10);
    expect(node.knockables).toBe(BODY_CAPACITY);
    expect(node.hazards).toBe(HAZARD_CAPACITY);
    expect(report.browser.bessie).toEqual(node.bessie);
    expect(warm.npcs.length).toBe(node.npcs);
    expect(end.npcs.length).toBeGreaterThanOrEqual(NPC_CAPACITY - 4);
    expect(end.shift.phase).toBe('running');
    // Draw calls (§12.7) on every measured frame.
    for (const n of counts) {
      expect(n).toBeGreaterThanOrEqual(MIN_PLAUSIBLE_DRAW_CALLS);
      expect(n, `draw calls per frame on the stress scene (budget ${DRAW_CALL_BUDGET})`).toBeLessThanOrEqual(
        DRAW_CALL_BUDGET,
      );
    }
    // The sim step (D-08-derived, TECHNICAL_DESIGN §17): one sample per tick, the minute complete.
    expect(perf.stepOverflow).toBe(0);
    expect(perf.stepMs).toHaveLength(STRESS_MEASURED_TICKS);
    expect(step.p99, `sim step p99 in ms (budget ${SIM_STEP_P99_BUDGET_MS})`).toBeLessThanOrEqual(
      SIM_STEP_P99_BUDGET_MS,
    );
    expect(errors).toEqual([]);
  },
);

test('p99 frame time stays within the D-08 budget on the real GPU', { tag: '@gpu' }, async ({ page }) => {
  test.setTimeout(GPU_WARMUP_MS + GPU_SAMPLE_MS + 60_000);
  const errors = collectErrors(page);
  await openScene(page, '');
  await page.bringToFront();

  const env = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const info = gl?.getExtension('WEBGL_debug_renderer_info');
    return {
      renderer:
        gl !== null && gl !== undefined && info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '',
      visible: document.visibilityState,
      userAgent: navigator.userAgent,
    };
  });
  expect(env.renderer, 'the gpu project must run on a hardware GPU').not.toMatch(/swiftshader|llvmpipe/i);
  expect(env.visible, 'a hidden page throttles requestAnimationFrame').toBe('visible');

  await page.waitForTimeout(GPU_WARMUP_MS);
  const startMs = await page.evaluate(() => {
    window.__ssp?.perfReset();
    return performance.now();
  });
  await page.waitForTimeout(GPU_SAMPLE_MS);
  const perf = await readPerf(page);
  const endMs = await page.evaluate(() => performance.now());
  let sampledMs = 0;
  for (const ms of perf.frameMs) sampledMs += ms;

  const frameRaw = frameStats(perf.frameMs);
  const frame = roundStats(frameRaw);
  const work = roundStats(frameStats(perf.workMs));
  const report = {
    budgetMs: P99_FRAME_TIME_BUDGET_MS,
    baselineP99Ms: BASELINE_P99_MS,
    headroom: M6_HEADROOM_FACTOR,
    frameMs: frame,
    workMs: work,
    drawCalls: perf.drawCalls,
    overflow: perf.overflow,
    overBudget: perf.frameMs.filter((ms) => ms > P99_FRAME_TIME_BUDGET_MS).length,
    windowMs: Math.round(endMs - startMs),
    sampledMs: Math.round(sampledMs),
    gpu: env.renderer,
    userAgent: env.userAgent,
  };
  console.log(`[perf:gpu] ${JSON.stringify(report)}`);
  test.info().annotations.push({ type: 'perf-gpu', description: JSON.stringify(report) });

  expect(perf.overflow, 'sampling window overflowed the counters').toBe(0);
  // The page clock stops while macOS sleeps (an idle laptop drops into maintenance sleep every few seconds even
  // with the page animating), which shortens the window and puts 300-500 ms hitches into it.
  expect(
    endMs - startMs,
    'the Mac slept during sampling: run under `caffeinate -dims`',
  ).toBeGreaterThanOrEqual(GPU_SAMPLE_MS * 0.98);
  expect(frame.samples, 'too few frames for a p99').toBeGreaterThanOrEqual(GPU_MIN_SAMPLES);
  expect(perf.drawCalls).toBeLessThanOrEqual(DRAW_CALL_BUDGET);
  expect(frameRaw.p99, `p99 frame time in ms (D-08 budget ${P99_FRAME_TIME_BUDGET_MS})`).toBeLessThanOrEqual(
    P99_FRAME_TIME_BUDGET_MS,
  );
  expect(errors).toEqual([]);
});
