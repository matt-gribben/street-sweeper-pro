// The M2 e2e smoke test (SSP-073; TECHNICAL_DESIGN §18.6, ROADMAP M2 "Full shift"): the shipping bundle plays the
// committed full-shift replay's canned inputs on Puddle Lane and must
//
//   1. sweep for 60 s (3,600 ticks): from `@` in the south-west depot, brush down, north up Mangle Street in the
//      kerb lane and on round the figure-of-eight at ≤ 4.0 m/s, with no console or page error, score > 0, litter
//      in the hopper (LU > 0) and at most 10 draw calls on every sampled frame, the litter (items draw) and the
//      HUD on screen;
//   2. play on to the end of the shift (the 14,400-tick timer, the knock-off roll to rest) and land on the tally
//      scene, whose figures are `__ssp.state()`'s and whose every UI pixel matches a CPU rasterisation of the page.
//
// Input: `__ssp.loadInputs(inputs, ticks)` (src/debug/scriptedInput.ts, §18.5) feeds World tick t the replay's
// frame t, so the browser run is the replay's run. The spec also runs the same inputs headlessly in Node (the
// canonical environment, ROADMAP R-09) and asserts the browser's snapshot at 3,600 ticks and at the end equals
// Node's with every number quantised to 1e-4, as the replay hash quantises state (§18.3): Math.sin in Chromium 156
// and Node 24.21.0 can differ in the last bit (measured in SSP-073: first on tick 68 of this replay), so the raw
// floats drift apart by ~1e-14 m while every quantised value, and every committed checkpoint hash, agrees. A
// determinism break that reaches the 1e-4 grid fails here. The browser run itself is exact: every run of the spec
// ends on the same raw state (`--repeat-each=3` logs one `[smoke] end sha256=` per run to compare).
//
// Frames are saved to test-results/ as review captures (smoke_sweep.png at tick 3,600, smoke_tally.png): open
// them with Read.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, type Page, test } from '@playwright/test';
import type { ShiftTestState } from '../../src/debug/testHooks.ts';
import { createInputFrame } from '../../src/sim/inputFrame.ts';
import { decodeLevel, type Level } from '../../src/sim/map.ts';
import { HASH_QUANTUM, loadReplay, readInput } from '../../src/sim/replay.ts';
import { ShiftPhase } from '../../src/sim/shift.ts';
import { type SimSnapshot, snapshotWorld } from '../../src/sim/snapshot.ts';
import { DEFAULT_TUNING } from '../../src/sim/tuning.ts';
import { createWorld } from '../../src/sim/world.ts';
import { districtDisplayName } from '../../src/ui/introCard.ts';
import { uiItemStrings } from '../../src/ui/uiItems.ts';
import { collectPageErrors, openTestScene, readTestFrame } from '../support/visualGolden.ts';
import { saveFrame } from './helpers/saveFrame.ts';
import {
  earnedStars,
  expectedTimeUpStrings,
  rasterise,
  sim,
  tallyItems,
  UI_SCREEN_DRAW_CALLS,
  uiMismatches,
} from './helpers/uiScreen.ts';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** The canned inputs: the M2 full-shift replay (SSP-072), seed 1001, 14,600 ticks. */
const REPLAY = loadReplay(
  readFileSync(`${REPO_ROOT}tests/replay/replays/m2_full_shift_puddle_lane.json`, 'utf8'),
);

/** The sweep: the first minute of the shift. */
const SWEEP_TICKS = 3600;

/** Ticks between the sweep's samples (each step renders one frame, whose draw calls are read). */
const SAMPLE_TICKS = 10;

/** §12.7: the per-frame draw-call budget. */
const MAX_DRAW_CALLS = 10;

/**
 * The shift's draws with litter in view (ShiftScene.ts): city, building shadows, drop shadow, actors, items, the
 * HUD's UI batch, palette pass, blit. Without an item in view the items draw is skipped (7).
 */
const SHIFT_DRAW_CALLS_WITH_ITEMS = 8;

/** GDD §7.1 (clean-pickup speed): every pickup is certain at or below 4.0 m/s; the canned route keeps the brush under it. */
const MAX_SWEEP_SPEED_MPS = 4.0;

/** The boot: the shift flow straight into a Puddle Lane shift on the replay's seed, frozen so only step(n) ticks. */
const SMOKE_URL = `/?test=1&seed=${REPLAY.file.seed}&scene=${REPLAY.file.district}&freeze=1`;

/** One sweep sample, taken right after a step(SAMPLE_TICKS). */
type SweepSample = {
  readonly tick: number;
  readonly speed: number;
  readonly drawCalls: number;
  readonly scene: string | null;
};

function readLevel(district: string): Level {
  const name = district.slice('district.'.length);
  return decodeLevel(readFileSync(`${REPO_ROOT}public/assets/levels/${name}.json`, 'utf8'));
}

/**
 * The replay run headlessly in Node, as `npm run test:replay` runs it: the World's snapshot after `sweepTicks`
 * ticks and on the tick the shift ended (the ShiftScene stops stepping its World there, so that is the tally's).
 */
function headlessRun(sweepTicks: number): { sweep: SimSnapshot; end: SimSnapshot } {
  const { file, log } = REPLAY;
  const world = createWorld(readLevel(file.district), file.seed, DEFAULT_TUNING);
  const frame = createInputFrame();
  let sweep: SimSnapshot | null = null;
  for (let t = 0; t < file.ticks && world.shift.phase !== ShiftPhase.Ended; t++) {
    readInput(log, t, frame);
    world.step(frame);
    if (world.tick === sweepTicks) sweep = snapshotWorld(world);
  }
  if (sweep === null) throw new Error(`the replay ended before tick ${sweepTicks}`);
  if (world.shift.phase !== ShiftPhase.Ended) throw new Error('the replay never ended the shift');
  return { sweep, end: snapshotWorld(world) };
}

/** A JSON value with every number quantised to the replay hash's 1e-4 grid (`Math.round(v * 1e4)`, §18.3). */
function quantised(value: unknown): unknown {
  if (typeof value === 'number') return Math.round(value * HASH_QUANTUM);
  if (Array.isArray(value)) return value.map(quantised);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, quantised(v)]));
  }
  return value;
}

/** Paths of the numbers that differ at all between two JSON values of the same shape (for the log). */
function rawDifferences(a: unknown, b: unknown, path = ''): string[] {
  if (typeof a === 'number' || typeof b === 'number') return Object.is(a, b) ? [] : [path];
  if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object') {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].flatMap((k) =>
      rawDifferences((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`),
    );
  }
  return a === b ? [] : [path];
}

/** Asserts the browser's sim state equals Node's on the 1e-4 grid, and logs which raw floats differ at all. */
function expectMatchesNode(label: string, browser: SimSnapshot, node: SimSnapshot): void {
  const raw = rawDifferences(browser, node);
  console.log(
    `[smoke] ${label}: browser = Node on the 1e-4 grid expected; raw floats differing: ${raw.length === 0 ? 'none' : raw.join(', ')}`,
  );
  expect(quantised(browser)).toEqual(quantised(node));
}

async function shiftState(page: Page): Promise<ShiftTestState> {
  const state = await page.evaluate(() => window.__ssp?.state());
  if (state === undefined || !('bessie' in state))
    throw new Error(`no shift state: ${JSON.stringify(state)}`);
  return state;
}

async function step(page: Page, n: number): Promise<void> {
  await page.evaluate((ticks) => window.__ssp?.step(ticks), n);
}

function stateSha256(state: ShiftTestState): string {
  return createHash('sha256').update(JSON.stringify(state)).digest('hex');
}

test('60 s scripted sweep on Puddle Lane, then the full shift ends on the tally', async ({
  page,
}, testInfo) => {
  test.setTimeout(240_000);
  const { file } = REPLAY;
  expect(file.district).toBe('district.puddle_lane');
  expect(file.ticks).toBeGreaterThan(SWEEP_TICKS);
  const headless = headlessRun(SWEEP_TICKS);
  const errors = collectPageErrors(page);
  await openTestScene(page, SMOKE_URL);
  expect(await page.evaluate(() => window.__ssp?.scene())).toBe('shift');
  const start = await shiftState(page);
  expect(start.tick).toBe(0);
  expect(start.score).toBe(0);
  expect(start.hopper.lu).toBe(0);

  // 1. The 60 s sweep, sampled every SAMPLE_TICKS ticks inside the page (one render per sample).
  await page.evaluate(([inputs, ticks]) => window.__ssp?.loadInputs(inputs, ticks), [
    file.inputs,
    file.ticks,
  ] as const);
  const samples = await page.evaluate(
    ([total, every]) => {
      const api = window.__ssp;
      if (api === undefined) throw new Error('window.__ssp missing');
      const out: SweepSample[] = [];
      for (let done = 0; done < total; done += every) {
        api.step(every);
        const state = api.state();
        out.push({
          tick: state.tick,
          speed: 'bessie' in state ? state.bessie.speed : Number.NaN,
          drawCalls: api.perf().drawCalls,
          scene: api.scene(),
        });
      }
      return out;
    },
    [SWEEP_TICKS, SAMPLE_TICKS] as const,
  );
  expect(samples).toHaveLength(SWEEP_TICKS / SAMPLE_TICKS);
  expect(samples.filter((s) => s.scene !== 'shift')).toEqual([]);
  const overBudget = samples.filter((s) => s.drawCalls > MAX_DRAW_CALLS || s.drawCalls < 3);
  expect(overBudget).toEqual([]);
  const tooFast = samples.filter((s) => !(Math.abs(s.speed) <= MAX_SWEEP_SPEED_MPS));
  expect(tooFast).toEqual([]);
  const withItems = samples.filter((s) => s.drawCalls === SHIFT_DRAW_CALLS_WITH_ITEMS).length;
  console.log(
    `[smoke] sweep: ${samples.length} frames, draw calls ${Math.min(...samples.map((s) => s.drawCalls))}..${Math.max(
      ...samples.map((s) => s.drawCalls),
    )} (${withItems} with the items draw), top speed ${Math.max(...samples.map((s) => s.speed)).toFixed(3)} m/s`,
  );
  // Litter (the items draw) and the HUD were on screen for most of the sweep.
  expect(withItems).toBeGreaterThan(samples.length / 2);

  const swept = await shiftState(page);
  await saveFrame(testInfo, 'smoke_sweep.png', await readTestFrame(page), { atResultsRoot: true });
  console.log(
    `[smoke] tick ${swept.tick}: score ${swept.score}, hopper ${swept.hopper.lu} LU, items ${swept.litter.collected}/${swept.litter.spawned}, grime ${swept.grime.cleaned}/${swept.grime.initial}, tidy ${(swept.tidy * 100).toFixed(2)} %`,
  );
  expect(errors).toEqual([]);
  expect(swept.tick).toBe(SWEEP_TICKS);
  expect(swept.shift.phase).toBe('running');
  expect(swept.score).toBeGreaterThan(0);
  expect(swept.hopper.lu).toBeGreaterThan(0);
  expect(swept.litter.collected).toBeGreaterThan(0);
  expect(swept.grime.cleaned).toBeGreaterThan(0);
  expect(swept.bessie.y).toBeLessThan(start.bessie.y - 20); // she left the depot northwards
  expectMatchesNode('tick 3600', sim(swept), headless.sweep);

  // 2. On to the end of the shift: the World stops on EV.ShiftEnd and the flow brings up the tally.
  await step(page, file.ticks - SWEEP_TICKS);
  await page.waitForFunction(() => window.__ssp?.scene() === 'tally');
  expect(await page.evaluate(() => window.__ssp?.sceneHistory())).toEqual(['shift', 'tally']);
  // Render the tally once before reading state(): until the first frame after the ShiftScene's exit the camera
  // still stands over Bessie, and whether a rAF frame has drawn yet is timing; after it, the released camera
  // stands at rest over the origin (Game.ts), so state(), camera included, is the same on every run.
  await step(page, 0);
  const end = await shiftState(page);
  expect(end.shift.phase).toBe('ended');
  expect(end.shift.endReason).toBe('time_up');
  expect(end.tick).toBe(end.shift.endTick + 1);
  expectMatchesNode('shift end', sim(end), headless.end);
  console.log(
    `[smoke] end tick ${end.tick} (ShiftEnd on ${end.shift.endTick}): score ${end.score}, items ${end.litter.collected}/${end.litter.spawned}, grime ${end.grime.cleaned}/${end.grime.initial}, tidy ${(end.tidy * 100).toFixed(2)} %, ${end.stars} stars; end sha256=${stateSha256(end)}`,
  );

  // The tally shows exactly state()'s figures: its strings, then every UI pixel against the CPU layout.
  const districtName = districtDisplayName(file.district);
  const items = tallyItems(end, districtName);
  expect(uiItemStrings(items)).toEqual(expectedTimeUpStrings(end, districtName));
  expect(end.stars).toBe(earnedStars(end.tidy));
  const tallyFrame = await readTestFrame(page);
  await saveFrame(testInfo, 'smoke_tally.png', tallyFrame, { atResultsRoot: true });
  const mismatches = uiMismatches(rasterise(items), tallyFrame);
  expect(mismatches.first).toEqual([]);
  expect(mismatches.count).toBe(0);
  expect(await page.evaluate(() => window.__ssp?.perf().drawCalls)).toBe(UI_SCREEN_DRAW_CALLS);
  // The tally holds the ended state however long it shows.
  await step(page, 120);
  expect(await shiftState(page)).toEqual(end);
  expect(errors).toEqual([]);
});
