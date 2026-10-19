// BootScene in the shipping bundle (SSP-284; TECHNICAL_DESIGN §6.2, §6.3, §18.5). BootScene is the root scene: it
// loads every atlas, the font metrics and the palette LUT once, then hands off to the routed scene. This spec checks:
// - `__ssp.ready` turns true only after the boot has finished: with one atlas held back by a Playwright route, the
//   page stays not-ready (boot 'loading', no scene on the stack, the canvas cleared to palette index 00) until the
//   atlas is released, then the boot hands off to the intro card;
// - a `?test=1&scene=<id>` boot finishes loading first, then jumps straight to that scene (`boot` → `level_preview`);
// - an atlas forced to 404 fails the boot within 5 s with a console error naming the atlas, `__ssp.boot()` reports
//   it, `ready` never turns true and nothing is thrown unhandled (no page error).
import { expect, type Page, type Route, test } from '@playwright/test';
import { collectPageErrors } from '../support/visualGolden.ts';

/** GDD/issue SSP-284: a failed boot must surface within 5 s. */
const BOOT_FAILURE_BUDGET_MS = 5000;

async function boot(page: Page) {
  return page.evaluate(() => window.__ssp?.boot() ?? null);
}

test('__ssp.ready turns true only after BootScene has loaded every asset', async ({ page }) => {
  const errors = collectPageErrors(page);
  let release: (() => void) | null = null;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let heldRoute: Route | null = null;
  await page.route('**/assets/atlas/world.png', async (route) => {
    heldRoute = route;
    await held;
    await route.continue();
  });
  await page.goto('/?test=1&seed=5&freeze=1');
  await expect.poll(() => heldRoute !== null, { timeout: 10_000 }).toBe(true);
  // The world atlas is held: the boot is still loading and nothing has joined the stack.
  for (let i = 0; i < 5; i++) {
    expect(await page.evaluate(() => window.__ssp?.ready)).toBe(false);
    expect(await boot(page)).toMatchObject({ status: 'loading', error: null });
    expect(await page.evaluate(() => window.__ssp?.scene())).toBeNull();
    await page.waitForTimeout(50);
  }
  expect(await page.evaluate(() => window.__ssp?.perf().renders)).toBe(0); // only index-00 clears so far
  (release as (() => void) | null)?.();
  await page.waitForFunction(() => window.__ssp?.ready === true);
  expect(await boot(page)).toEqual({ status: 'loaded', error: null, lutBuilds: 1 });
  expect(await page.evaluate(() => window.__ssp?.scene())).toBe('shift_intro');
  expect(await page.evaluate(() => window.__ssp?.sceneHistory())).toEqual(['boot', 'shift_intro']);
  expect(errors).toEqual([]);
});

test('?test=1&scene=<id> finishes the boot, then hands off straight to that scene', async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.goto('/?test=1&scene=level_preview&freeze=1');
  await page.waitForFunction(() => window.__ssp?.ready === true);
  expect(await page.evaluate(() => window.__ssp?.sceneHistory())).toEqual(['boot', 'level_preview']);
  expect(await page.evaluate(() => window.__ssp?.scene())).toBe('level_preview');
  expect(await boot(page)).toEqual({ status: 'loaded', error: null, lutBuilds: 1 });
  expect(errors).toEqual([]);
});

test('an atlas forced to 404 fails the boot within 5 s, naming the atlas, with nothing unhandled', async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.route('**/assets/atlas/ui.png', (route) => route.fulfill({ status: 404, body: 'not found' }));
  const startedAt = Date.now();
  await page.goto('/?test=1&seed=5&freeze=1');
  await page.waitForFunction(() => window.__ssp?.boot().status === 'failed', null, {
    timeout: BOOT_FAILURE_BUDGET_MS,
  });
  const failedMs = Date.now() - startedAt;
  console.log(`[boot] 404 atlas → boot failed in ${failedMs} ms`);
  expect(failedMs).toBeLessThan(BOOT_FAILURE_BUDGET_MS);
  const state = await boot(page);
  expect(state?.error).toMatch(/atlas 'ui' failed to load: atlas fetch .*ui\.png: HTTP 404/);
  await expect
    .poll(() => consoleErrors.some((text) => /boot failed: .*atlas 'ui' failed to load/.test(text)))
    .toBe(true);
  // Nothing hangs half-booted: no scene joined, ready never turns true, and no unhandled rejection or throw.
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.__ssp?.ready)).toBe(false);
  expect(await page.evaluate(() => window.__ssp?.scene())).toBeNull();
  expect(await page.evaluate(() => window.__ssp?.sceneHistory())).toEqual([]);
  expect(pageErrors).toEqual([]);
});
