// Playwright configuration (TECHNICAL_DESIGN §18.4, §18.6, §20.2). Chromium only.
//
// Projects:
// - `visual`: headless SwiftShader at 1920x1080 (so W = 480), tests/visual. `npm run test:visual`.
// - `ci`:     the same SwiftShader flags, tests/e2e (smoke + perf draw-call checks). `npm run test:e2e`.
// - `gpu`:    headed Chromium on the real GPU, NO SwiftShader flags, tests/e2e. Local only: never run by
//             `npm run test:e2e`, `npm run ci` or .github/workflows/ci.yml, which all pass `--project=ci`.
//
// tests/e2e specs pick their project by tag: `@gpu` tests (real-GPU frame timing, perf.spec.ts) run only in
// `gpu`, and every other e2e test runs only in `ci`, so a GPU timing check never runs on SwiftShader and the
// SwiftShader checks are not repeated headed.
//
// The suite tests the shipping bundle: webServer builds with Vite and serves it with `vite preview`.
import { defineConfig } from '@playwright/test';

/** Port of the `vite preview` server Playwright starts (and the baseURL every spec navigates against). */
export const PREVIEW_PORT = 4173;

/** Chromium flags for deterministic CPU rasterisation (visual goldens and CI perf). */
export const SWIFTSHADER_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] as const;

/** Tag of the e2e tests that need the real GPU (TECHNICAL_DESIGN §18.6): run by the `gpu` project only. */
export const GPU_TAG = /@gpu/;

/** 1920x1080 at DPR 1 gives the 480-wide base render target (W = 480, TECHNICAL_DESIGN §18.4). */
export const VISUAL_VIEWPORT = { width: 1920, height: 1080 } as const;

const isCi = process.env.CI !== undefined && process.env.CI !== '' && process.env.CI !== 'false';

// Playwright requires a default export from its config file; like vite.config.ts and vitest.config.ts this
// is a sanctioned exception to the named-exports rule.
export default defineConfig({
  outputDir: 'test-results',
  fullyParallel: false,
  forbidOnly: isCi,
  // No retries: a flaky visual or perf result is a bug to fix, not something to retry into green.
  retries: 0,
  reporter: isCi ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]] : 'list',
  use: {
    browserName: 'chromium',
    baseURL: `http://localhost:${PREVIEW_PORT}`,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `npm run build && npx vite preview --port ${PREVIEW_PORT} --strictPort`,
    url: `http://localhost:${PREVIEW_PORT}`,
    reuseExistingServer: !isCi,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
  projects: [
    {
      name: 'visual',
      testDir: 'tests/visual',
      use: {
        browserName: 'chromium',
        headless: true,
        viewport: VISUAL_VIEWPORT,
        deviceScaleFactor: 1,
        launchOptions: { args: [...SWIFTSHADER_ARGS] },
      },
    },
    {
      name: 'ci',
      testDir: 'tests/e2e',
      grepInvert: GPU_TAG,
      use: {
        browserName: 'chromium',
        headless: true,
        viewport: VISUAL_VIEWPORT,
        deviceScaleFactor: 1,
        launchOptions: { args: [...SWIFTSHADER_ARGS] },
      },
    },
    {
      name: 'gpu',
      testDir: 'tests/e2e',
      grep: GPU_TAG,
      use: {
        browserName: 'chromium',
        headless: false,
        viewport: VISUAL_VIEWPORT,
        deviceScaleFactor: 1,
        launchOptions: { args: [] },
      },
    },
  ],
});
