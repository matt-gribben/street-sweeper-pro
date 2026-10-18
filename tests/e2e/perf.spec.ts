// Performance budgets (TECHNICAL_DESIGN §12.7, §17, §18.6; ROADMAP §8 D-08; SSP-023). Two behaviours, one per
// Playwright project (selected by tag in playwright.config.ts):
//
// - `ci` (headless SwiftShader, `npm run test:e2e`): draw calls ≤ 10 per frame over every pass, read from
//   `__ssp.perf().drawCalls` (renderer.info with autoReset = false). A CPU rasteriser on a shared runner says
//   nothing about GPU frame time, so this project asserts no timing. The sim-step assertion joins it with the
//   first stress scene (M3, SSP-106): there is no sim in M0.
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
import type { TestPerf } from '../../src/debug/testHooks.ts';
import { HEADING_COUNT } from '../../src/render/headings.ts';
import { FRAMES_PER_HEADING } from '../../src/render/spikeActors.ts';
import { frameStats, roundStats } from '../support/frameStats.ts';

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
