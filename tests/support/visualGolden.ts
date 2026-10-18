// Visual-golden helper for tests/visual (TECHNICAL_DESIGN §18.4, SSP-022): frame → PNG (pngjs 7.0.0) →
// pixelmatch 8.0.0 at threshold 0 against tests/visual/__goldens__/<name>.png, with a SHA-256 log line per
// frame and expected/actual/diff PNGs in test-results/ on failure.
//
// Exactness: pixelmatch runs with `threshold: 0` and `includeAA: true` (by default it skips pixels it thinks are
// anti-aliasing, which would hide real one-pixel changes), and the helper also counts pixels whose RGBA bytes
// differ at all. A frame passes only when both counts are 0: a single wrong pixel is a real change (§18.4).
//
// Goldens are written only by `npm run test:visual:update` (`--update-snapshots=all`) or
// `--update-snapshots=changed`. Playwright's default mode (`missing`) does NOT create a missing golden here: an
// unreviewed frame must never become canonical by accident, so a missing golden fails the test and leaves
// actual.png in test-results/ for review (CLAUDE.md hard rule 8: look before you accept).
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page, TestInfo } from '@playwright/test';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { INTERNAL_HEIGHT_PX } from '../../src/render/upscale.ts';

/** Directory holding the canonical goldens (dev Mac, arm64, Playwright 1.64.1 Chromium, SwiftShader flags). */
export const GOLDEN_DIR = fileURLToPath(new URL('../visual/__goldens__/', import.meta.url));

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** pixelmatch threshold for every visual golden. Never raise it to get green (CLAUDE.md §7). */
export const PIXELMATCH_THRESHOLD = 0;

/** An RGBA8 image, row-major, row 0 at the top. */
export type RgbaFrame = {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
};

/** Result of comparing two frames. Counts are -1 when the sizes differ (nothing was compared). */
export type FrameComparison = {
  readonly sizeMatches: boolean;
  /** Pixels pixelmatch flags at threshold 0 with includeAA. */
  readonly pixelmatchCount: number;
  /** Pixels whose four RGBA bytes are not all identical. */
  readonly exactCount: number;
  /** pixelmatch's diff image (red = changed), or null when the sizes differ. */
  readonly diff: RgbaFrame | null;
};

/** Hex SHA-256 of the raw RGBA bytes: the frame's identity for the stability log (D-09). */
export function frameSha256(frame: RgbaFrame): string {
  return createHash('sha256').update(frame.data).digest('hex');
}

/** Encodes RGBA8 as a PNG with pngjs (colour type 6, deflate level 9): the same pixels give the same bytes. */
export function encodeFramePng(frame: RgbaFrame): Buffer {
  const png = new PNG({ width: frame.width, height: frame.height });
  png.data.set(frame.data);
  return PNG.sync.write(png);
}

/** Decodes any PNG pngjs reads (golden, browser screenshot) to RGBA8. */
export function decodeFramePng(bytes: Uint8Array): RgbaFrame {
  const png = PNG.sync.read(bytes);
  return {
    width: png.width,
    height: png.height,
    data: new Uint8Array(png.data.buffer, png.data.byteOffset, png.data.byteLength),
  };
}

/** Compares two frames at pixelmatch threshold 0 (includeAA) and by exact RGBA bytes. */
export function compareFrames(expected: RgbaFrame, actual: RgbaFrame): FrameComparison {
  if (expected.width !== actual.width || expected.height !== actual.height) {
    return { sizeMatches: false, pixelmatchCount: -1, exactCount: -1, diff: null };
  }
  const { width, height } = expected;
  const diffData = new Uint8Array(width * height * 4);
  const pixelmatchCount = pixelmatch(expected.data, actual.data, diffData, width, height, {
    threshold: PIXELMATCH_THRESHOLD,
    includeAA: true,
  });
  let exactCount = 0;
  for (let p = 0; p < width * height; p++) {
    const o = p * 4;
    if (
      expected.data[o] !== actual.data[o] ||
      expected.data[o + 1] !== actual.data[o + 1] ||
      expected.data[o + 2] !== actual.data[o + 2] ||
      expected.data[o + 3] !== actual.data[o + 3]
    ) {
      exactCount++;
    }
  }
  return { sizeMatches: true, pixelmatchCount, exactCount, diff: { width, height, data: diffData } };
}

/** True when a comparison found no difference of any kind. */
export function framesMatch(comparison: FrameComparison): boolean {
  return comparison.sizeMatches && comparison.pixelmatchCount === 0 && comparison.exactCount === 0;
}

/** Playwright's `updateSnapshots` modes (TestConfig['updateSnapshots']). */
export type UpdateMode = 'all' | 'changed' | 'missing' | 'none';

/** What to do with a frame, given the update mode, whether a golden exists and whether it matched. */
export type GoldenAction = 'pass' | 'write' | 'fail-missing' | 'fail-diff';

/**
 * Golden policy: a matching golden passes untouched (no churn, even under `all`); `all` and `changed` write a
 * missing or different golden; any other mode fails on a missing golden (it is never created implicitly) and on
 * a difference.
 */
export function goldenAction(mode: UpdateMode, goldenExists: boolean, matches: boolean): GoldenAction {
  if (goldenExists && matches) return 'pass';
  const mayWrite = mode === 'all' || mode === 'changed';
  if (mayWrite) return 'write';
  return goldenExists ? 'fail-diff' : 'fail-missing';
}

function asUpdateMode(value: string): UpdateMode {
  return value === 'all' || value === 'changed' || value === 'missing' ? value : 'none';
}

/** Writes `frame` as a PNG at `path` (creating its directory) and returns the path. */
function writePng(path: string, frame: RgbaFrame): string {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, encodeFramePng(frame));
  return path;
}

/**
 * Logs the frame's SHA-256 (the line the D-09 stability loop collects), then compares it with
 * `__goldens__/<name>.png` under the golden policy. On failure writes expected.png (when a golden exists),
 * actual.png and diff.png (when the sizes match) into the test's output directory, attaches them, and throws
 * with their paths: open all three with the Read tool before deciding (§18.4).
 */
export async function expectFrameMatchesGolden(
  testInfo: TestInfo,
  name: string,
  frame: RgbaFrame,
): Promise<void> {
  const sha = frameSha256(frame);
  console.log(`[visual] ${name} ${frame.width}x${frame.height} sha256=${sha}`);
  testInfo.annotations.push({ type: 'sha256', description: `${name} ${frame.width}x${frame.height} ${sha}` });

  const goldenPath = join(GOLDEN_DIR, `${name}.png`);
  const goldenExists = existsSync(goldenPath);
  const expected = goldenExists ? decodeFramePng(readFileSync(goldenPath)) : null;
  const comparison = expected === null ? null : compareFrames(expected, frame);
  const matches = comparison !== null && framesMatch(comparison);
  const action = goldenAction(asUpdateMode(testInfo.config.updateSnapshots), goldenExists, matches);

  if (action === 'pass') return;
  if (action === 'write') {
    writePng(goldenPath, frame);
    console.log(
      `[visual] ${name}: golden ${goldenExists ? 'updated' : 'created'} at ${relative(REPO_ROOT, goldenPath)}`,
    );
    return;
  }

  const artefacts: string[] = [];
  const save = async (file: string, image: RgbaFrame): Promise<void> => {
    const path = writePng(testInfo.outputPath(file), image);
    artefacts.push(relative(REPO_ROOT, path));
    await testInfo.attach(file, { path, contentType: 'image/png' });
  };
  if (expected !== null) await save('expected.png', expected);
  await save('actual.png', frame);
  if (comparison?.diff) await save('diff.png', comparison.diff);

  const reason =
    action === 'fail-missing'
      ? `no golden at ${relative(REPO_ROOT, goldenPath)} (create it with npm run test:visual:update after reading actual.png)`
      : comparison !== null && !comparison.sizeMatches
        ? `size ${frame.width}x${frame.height} differs from the golden's ${expected?.width}x${expected?.height}`
        : `${comparison?.pixelmatchCount} pixel(s) differ at pixelmatch threshold ${PIXELMATCH_THRESHOLD} ` +
          `(${comparison?.exactCount} by exact RGBA bytes)`;
  throw new Error(
    `visual golden '${name}' failed: ${reason}.\nRead these before deciding (TECHNICAL_DESIGN §18.4):\n` +
      artefacts.map((path) => `  ${path}`).join('\n'),
  );
}

/** Collects console errors and uncaught page errors; specs assert the list is empty. */
export function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

/** Opens a `?test=1` URL and waits for `__ssp.ready` (assets loaded, first complete frame rendered). */
export async function openTestScene(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page.waitForFunction(() => window.__ssp?.ready === true);
}

/**
 * `__ssp.readFrame()` as an RGBA frame: the raw W×270 palette-mapped pixels, row 0 at the top. The bytes cross
 * the page boundary as base64 (a 480×270 frame is 518,400 bytes).
 */
export async function readTestFrame(page: Page): Promise<RgbaFrame> {
  const { width, height, base64 } = await page.evaluate((frameHeight) => {
    const api = window.__ssp;
    if (api === undefined) throw new Error('window.__ssp missing: is ?test=1 set?');
    const data = api.readFrame();
    if (!(data instanceof Uint8Array)) throw new Error('__ssp.readFrame() did not return a Uint8Array');
    let binary = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < data.length; i += CHUNK) {
      binary += String.fromCharCode(...data.subarray(i, i + CHUNK));
    }
    return { width: data.length / 4 / frameHeight, height: frameHeight, base64: btoa(binary) };
  }, INTERNAL_HEIGHT_PX);
  if (!Number.isInteger(width)) throw new Error(`readFrame() length is not a multiple of 4 x ${height}`);
  const bytes = Buffer.from(base64, 'base64');
  return { width, height, data: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) };
}
