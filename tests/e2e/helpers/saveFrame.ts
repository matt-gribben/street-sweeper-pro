// Saves a frame as a PNG review capture in the test's output folder under test-results/ (SSP-069; shared with the
// e2e evidence of SSP-066, SSP-067 and SSP-070). Captures are evidence to open with the Read tool, never goldens:
// canonical goldens live in tests/visual/__goldens__ and are written only by `npm run test:visual:update`.
import { copyFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TestInfo } from '@playwright/test';
import { encodeFramePng, frameSha256, type RgbaFrame } from '../../support/visualGolden.ts';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

export type SaveFrameOptions = {
  /**
   * Also copy the PNG to `<outputDir>/<name>` (test-results/<name>), a stable path an issue can name for review
   * (SSP-066: test-results/grime_before.png). Playwright empties test-results/ at the start of every run.
   */
  readonly atResultsRoot?: boolean;
};

/**
 * Writes `frame` (RGBA8, row 0 at the top: `readTestFrame` output or a decoded screenshot) as `<name>` in this
 * test's output folder, attaches it to the report, logs its path and SHA-256, and returns the repo-relative path.
 */
export async function saveFrame(
  testInfo: TestInfo,
  name: string,
  frame: RgbaFrame,
  options: SaveFrameOptions = {},
): Promise<string> {
  const path = testInfo.outputPath(name);
  writeFileSync(path, encodeFramePng(frame));
  await testInfo.attach(name, { path, contentType: 'image/png' });
  let shown = relative(REPO_ROOT, path);
  if (options.atResultsRoot === true) {
    const rootPath = join(testInfo.project.outputDir, name);
    copyFileSync(path, rootPath);
    shown = relative(REPO_ROOT, rootPath);
  }
  console.log(`[frame] ${name} ${frame.width}x${frame.height} sha256=${frameSha256(frame)} -> ${shown}`);
  return shown;
}
