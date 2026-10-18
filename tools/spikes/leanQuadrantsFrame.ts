// Manual check for SSP-019 (`?test=1` hooks and the lean_quadrants scene) against the SHIPPING bundle. Not part
// of `npm test`: it needs Playwright's Chromium (`npx playwright install chromium`). The visual specs and
// goldens are SSP-022; this script proves the hooks they rely on.
// Run with `node tools/spikes/leanQuadrantsFrame.ts`.
//
// 1. `vite build`, then `vite preview`, opened in headless Chromium with the visual-test flags
//    (--use-angle=swiftshader --enable-unsafe-swiftshader) at 1920x1080 (W = 480, 4x).
// 2. Without `test=1` (even with scene/freeze given) `window.__ssp` is undefined: the hooks are inert.
// 3. `/?test=1&scene=lean_quadrants&freeze=1`: waits for `__ssp.ready`, then
//    - readFrame() is a Uint8Array of 480 × 270 × 4 bytes and every pixel is a Kerbside-32 colour (alpha 255);
//    - two consecutive readFrame() calls, and one after 30 more rendered (frozen) frames, are byte-identical;
//    - row 0 is the top: readFrame() equals the canvas screenshot reduced to internal pixels (4x4 block
//      centres; the camera sits on the texel grid, so the blit offset is 0), and the known scene feature, the
//      north-east Bessie (top-right quadrant, heading h00 at tick 0), matches her atlas texels at the pixel the
//      camera projects her centre to; flipped rows would put her in the bottom-right quadrant;
//    - state() is { tick: 0, camera: { x: 0, y: 0, h: 31.5, pinned: false } }.
// 4. step(120): state().tick is 120 and the north-east Bessie shows h08.
// 5. setCamera(5, -3, 31.5): state() reports the pin, the flat actors move by exactly (−80, +48) px, and the
//    frame stays byte-identical over 30 further frames (no spring pulls the camera back). setCamera(0, 0, 37.8)
//    holds the zoomed-out height (no spring returns it to 31.5 m).
// 6. `tick=120` in the URL gives state().tick = 120 at ready (advanced after load).
// 7. `scene=scale_1440` at 2560x1440: the canvas is 2400x1350 at (80, 45) (5x, 45 px bars).
// 8. An unknown scene ID throws (a page error), and no other console errors occur.
// Exits non-zero on any failure and prints a JSON report. Evidence goes to build/spikes/lean-quadrants/:
// lean_quadrants_4x.png (the 1920x1080 page), lean_quadrants_1x.png (readFrame encoded as a PNG),
// lean_quadrants_step120_1x.png, lean_quadrants_camera_1x.png and scale_1440_page.png.
import { mkdirSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { chromium, type Page } from '@playwright/test';
import { Vector3 } from 'three';
import { build, preview } from 'vite';
import type { TestState } from '../../src/debug/testHooks.ts';
import { FRAME, type FrameId } from '../../src/gen/assets.ts';
import { createCameraRig, pinCameraRig, SWEEP_HEIGHT_M } from '../../src/render/camera.ts';
import { bessieBodyFrame, bessieBrushFrame } from '../../src/render/headings.ts';
import { KERBSIDE32, PALETTE_SIZE } from '../../src/render/palettePass.ts';
import { indexAtlasPixels, TRANSPARENT_INDEX } from '../../src/render/spriteAtlas.ts';
import { INTERNAL_HEIGHT_PX } from '../../src/render/upscale.ts';
import { LEAN_QUADRANTS } from '../../src/scenes/LeanQuadrantsScene.ts';
import { decodePng, encodeRgbaPng } from '../../tests/support/png.ts';

const W = 480;
const H = INTERNAL_HEIGHT_PX;
const SCALE = 4;
const SWIFTSHADER_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const OUT_DIR = 'build/spikes/lean-quadrants';
mkdirSync(OUT_DIR, { recursive: true });

const paletteKeys = new Set(
  Array.from({ length: PALETTE_SIZE }, (_, i) => {
    const rgb = KERBSIDE32.rgb;
    return ((rgb[i * 3] ?? 0) << 16) | ((rgb[i * 3 + 1] ?? 0) << 8) | (rgb[i * 3 + 2] ?? 0);
  }),
);
const atlasImage = decodePng(readFileSync('public/assets/atlas/actors.png'));
const atlasIndices = indexAtlasPixels('actors', atlasImage);

const failures: string[] = [];
const report: Record<string, unknown> = {};
function check(ok: boolean, message: string): void {
  if (!ok) failures.push(message);
}

/** Internal-pixel corner a sprite pivot at sim (xM, yM) lands on, for a camera pinned at (cx, cy, h). */
function anchorPx(xM: number, yM: number, cx: number, cy: number, h: number): { x: number; y: number } {
  const rig = createCameraRig(W);
  pinCameraRig(rig, cx, cy, h);
  const p = new Vector3(Math.round(xM * 16) / 16, 0, Math.round(yM * 16) / 16).project(rig.camera);
  return {
    x: Math.round(((p.x + 1) / 2) * (W + 2) - 1),
    y: Math.round(((1 - p.y) / 2) * (H + 2) - 1),
  };
}

/** Opaque texels of `frame` (palette index per atlas pixel), or TRANSPARENT_INDEX. */
function texel(frame: FrameId, tx: number, ty: number): number {
  const f = FRAME[frame];
  if (tx < 0 || ty < 0 || tx >= f.w || ty >= f.h) return TRANSPARENT_INDEX;
  return atlasIndices[(f.y + ty) * atlasImage.width + f.x + tx] ?? TRANSPARENT_INDEX;
}

/**
 * Counts body texels of Bessie's `heading` frame that do (and do not) appear at their 1:1 position around
 * `anchor` in `frame` (top-down RGBA), skipping texels the brush overlay covers.
 */
function matchBessie(
  frame: Uint8Array,
  heading: number,
  anchor: { x: number; y: number },
): { matched: number; mismatched: number } {
  const body = bessieBodyFrame(heading);
  const brush = bessieBrushFrame(heading, 0);
  const f = FRAME[body];
  const b = FRAME[brush];
  let matched = 0;
  let mismatched = 0;
  for (let ty = 0; ty < f.h; ty++) {
    for (let tx = 0; tx < f.w; tx++) {
      const index = texel(body, tx, ty);
      if (index === TRANSPARENT_INDEX) continue;
      const x = anchor.x - f.px + tx;
      const y = anchor.y - f.py + ty;
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      // Every brush spin frame is skipped conservatively: any opaque brush texel here hides the body.
      let covered = false;
      for (let spin = 0; spin < 4 && !covered; spin++) {
        const s = bessieBrushFrame(heading, spin);
        covered = texel(s, x - anchor.x + b.px, y - anchor.y + b.py) !== TRANSPARENT_INDEX;
      }
      if (covered) continue;
      const o = (y * W + x) * 4;
      const same =
        frame[o] === KERBSIDE32.rgb[index * 3] &&
        frame[o + 1] === KERBSIDE32.rgb[index * 3 + 1] &&
        frame[o + 2] === KERBSIDE32.rgb[index * 3 + 2];
      if (same) matched++;
      else mismatched++;
    }
  }
  return { matched, mismatched };
}

function framesEqual(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

async function readFrame(page: Page): Promise<Uint8Array> {
  const bytes = await page.evaluate(() => {
    const api = window.__ssp;
    if (api === undefined) throw new Error('__ssp missing');
    const frame = api.readFrame();
    return { isUint8Array: frame instanceof Uint8Array, data: Array.from(frame) };
  });
  check(bytes.isUint8Array, 'readFrame() did not return a Uint8Array');
  return Uint8Array.from(bytes.data);
}

async function state(page: Page): Promise<TestState> {
  return page.evaluate(() => {
    const api = window.__ssp;
    if (api === undefined) throw new Error('__ssp missing');
    return api.state();
  });
}

async function open(page: Page, query: string): Promise<void> {
  await page.goto(`${url}${query}`);
  await page.waitForFunction(() => window.__ssp?.ready === true, undefined, { timeout: 30_000 });
}

/** Waits for `n` more rendered frames. */
async function frames(page: Page, n: number): Promise<void> {
  await page.evaluate(
    (count) =>
      new Promise<void>((resolve) => {
        let left = count;
        const tick = (): void => {
          left -= 1;
          if (left <= 0) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    n,
  );
}

async function writeFramePng(path: string, frame: Uint8Array): Promise<void> {
  await writeFile(path, encodeRgbaPng({ width: W, height: H, data: frame }));
}

await build({ logLevel: 'error' });
const server = await preview({ logLevel: 'error', preview: { port: 0, strictPort: false } });
const url = server.resolvedUrls?.local[0] ?? '';
if (url === '') throw new Error('vite preview did not report a URL');
const browser = await chromium.launch({ args: SWIFTSHADER_ARGS });

try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(String(error)));

  // --- 2. Inert without test=1 -------------------------------------------------------------------------------
  for (const query of ['', '?scene=lean_quadrants&freeze=1', '?test=0&scene=lean_quadrants']) {
    await page.goto(`${url}${query}`);
    await frames(page, 10);
    const present = await page.evaluate(() => 'window' in globalThis && window.__ssp !== undefined);
    check(!present, `window.__ssp is defined for '${query}'`);
  }
  report.inertWithoutTest = failures.length === 0;

  // --- 3. lean_quadrants, frozen -----------------------------------------------------------------------------
  await open(page, '?test=1&seed=1&scene=lean_quadrants&freeze=1');
  await page.screenshot({ path: `${OUT_DIR}/lean_quadrants_4x.png` });
  const first = await readFrame(page);
  const second = await readFrame(page);
  await frames(page, 30);
  const later = await readFrame(page);
  await writeFramePng(`${OUT_DIR}/lean_quadrants_1x.png`, first);
  check(first.length === W * H * 4, `readFrame length ${first.length}, expected ${W * H * 4}`);
  check(framesEqual(first, second), 'two consecutive readFrame() calls differ');
  check(framesEqual(first, later), 'the frozen frame changed after 30 rendered frames');
  let offPalette = 0;
  const colours = new Set<number>();
  for (let p = 0; p < W * H; p++) {
    const key = ((first[p * 4] ?? 0) << 16) | ((first[p * 4 + 1] ?? 0) << 8) | (first[p * 4 + 2] ?? 0);
    colours.add(key);
    if (!paletteKeys.has(key) || first[p * 4 + 3] !== 255) offPalette++;
  }
  check(offPalette === 0, `${offPalette} pixels are not opaque Kerbside-32 colours`);
  report.frame = { length: first.length, offPalette, distinctColours: colours.size };

  // Row 0 is the top: compare with the canvas, which is top-down by construction.
  const canvasPng = decodePng(await page.locator('#game').screenshot());
  check(canvasPng.width === W * SCALE && canvasPng.height === H * SCALE, 'canvas is not 1920x1080');
  let canvasMismatch = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const c = ((y * SCALE + SCALE / 2) * canvasPng.width + x * SCALE + SCALE / 2) * 4;
      const f = (y * W + x) * 4;
      for (let k = 0; k < 3; k++) if (canvasPng.data[c + k] !== first[f + k]) canvasMismatch++;
    }
  }
  check(canvasMismatch === 0, `readFrame differs from the canvas in ${canvasMismatch} channels`);

  const ne = LEAN_QUADRANTS.find((q) => q.name === 'ne');
  const se = LEAN_QUADRANTS.find((q) => q.name === 'se');
  if (ne === undefined || se === undefined) throw new Error('lean_quadrants has no ne/se quadrant');
  const neAnchor = anchorPx(ne.bessieM[0], ne.bessieM[1], 0, 0, SWEEP_HEIGHT_M);
  const neBessie = matchBessie(first, ne.headingOffset, neAnchor);
  const flipped = flipRows(first);
  const neBessieIfFlipped = matchBessie(flipped, ne.headingOffset, neAnchor);
  report.rowOrder = { canvasMismatch, neAnchor, neBessie, neBessieIfFlipped };
  check(neBessie.matched > 300 && neBessie.mismatched === 0, 'NE Bessie (h00) is not at the top right');
  check(neBessieIfFlipped.mismatched > 0, 'row-order check is not discriminating');

  const s0 = await state(page);
  report.stateAtReady = s0;
  check(
    s0.tick === 0 && s0.camera.x === 0 && s0.camera.y === 0 && s0.camera.h === SWEEP_HEIGHT_M,
    `state() at ready is ${JSON.stringify(s0)}`,
  );
  check(!s0.camera.pinned, 'camera reported pinned before setCamera');

  // --- 4. step(n) ----------------------------------------------------------------------------------------
  await page.evaluate(() => window.__ssp?.step(120));
  const stepped = await readFrame(page);
  await writeFramePng(`${OUT_DIR}/lean_quadrants_step120_1x.png`, stepped);
  const s1 = await state(page);
  const h08 = matchBessie(stepped, (ne.headingOffset + 8) % 32, neAnchor);
  report.step = { state: s1, neBessieH08: h08 };
  check(s1.tick === 120, `state().tick after step(120) is ${s1.tick}`);
  check(h08.matched > 300 && h08.mismatched === 0, 'NE Bessie does not show h08 after step(120)');

  // --- 5. setCamera --------------------------------------------------------------------------------------
  await page.evaluate(() => window.__ssp?.setCamera(5, -3, 31.5));
  const moved = await readFrame(page);
  await writeFramePng(`${OUT_DIR}/lean_quadrants_camera_1x.png`, moved);
  const s2 = await state(page);
  const movedAnchor = anchorPx(ne.bessieM[0], ne.bessieM[1], 5, -3, SWEEP_HEIGHT_M);
  const movedBessie = matchBessie(moved, (ne.headingOffset + 8) % 32, movedAnchor);
  await frames(page, 30);
  const movedLater = await readFrame(page);
  const s3 = await state(page);
  const seMoved = anchorPx(se.bessieM[0], se.bessieM[1], 5, -3, SWEEP_HEIGHT_M);
  report.setCamera = {
    state: s2,
    neAnchorShift: { x: movedAnchor.x - neAnchor.x, y: movedAnchor.y - neAnchor.y },
    neBessie: movedBessie,
    seAnchor: seMoved,
  };
  check(
    s2.camera.x === 5 && s2.camera.y === -3 && s2.camera.h === 31.5 && s2.camera.pinned,
    `state() after setCamera is ${JSON.stringify(s2)}`,
  );
  check(
    movedAnchor.x - neAnchor.x === -80 && movedAnchor.y - neAnchor.y === 48,
    'anchor shift is not (−80, 48)',
  );
  check(movedBessie.matched > 300 && movedBessie.mismatched === 0, 'NE Bessie did not move with the camera');
  check(!framesEqual(moved, stepped), 'setCamera did not change the frame');
  check(framesEqual(moved, movedLater), 'the pinned camera moved over 30 frames (a spring is still on)');
  check(JSON.stringify(s3) === JSON.stringify(s2), 'state() changed over 30 frames with the camera pinned');

  await page.evaluate(() => window.__ssp?.setCamera(0, 0, 37.8));
  await frames(page, 30);
  const s4 = await state(page);
  report.setCameraZoomedOut = s4;
  check(s4.camera.h === 37.8, `pinned height drifted to ${s4.camera.h} (zoom spring still on)`);

  // --- 6. tick=<n> -------------------------------------------------------------------------------------------
  await open(page, '?test=1&scene=lean_quadrants&freeze=1&tick=120');
  const s5 = await state(page);
  const tickFrame = await readFrame(page);
  report.tickParam = s5;
  check(s5.tick === 120, `tick=120 gives state().tick ${s5.tick}`);
  check(framesEqual(tickFrame, stepped), 'tick=120 frame differs from step(120)');

  // --- 7. scale_1440 -----------------------------------------------------------------------------------------
  const big = await browser.newPage({ viewport: { width: 2560, height: 1440 }, deviceScaleFactor: 1 });
  big.on('pageerror', (error) => consoleErrors.push(String(error)));
  await open(big, '?test=1&seed=1&scene=scale_1440&freeze=1');
  await big.screenshot({ path: `${OUT_DIR}/scale_1440_page.png` });
  const box = await big.locator('#game').boundingBox();
  report.scale1440 = box;
  check(
    box !== null && box.x === 80 && box.y === 45 && box.width === 2400 && box.height === 1350,
    `scale_1440 canvas box ${JSON.stringify(box)}, expected 2400x1350 at (80, 45)`,
  );
  const bigFrame = await readFrame(big);
  check(framesEqual(bigFrame, first), 'scale_1440 internal frame differs from lean_quadrants');
  await big.close();

  // --- 8. unknown scene ---------------------------------------------------------------------------------------
  const errorsBefore = consoleErrors.length;
  await page.goto(`${url}?test=1&scene=no_such_scene`);
  await frames(page, 5).catch(() => {});
  const unknownErrors = consoleErrors.splice(errorsBefore);
  report.unknownScene = unknownErrors;
  check(
    unknownErrors.some((e) => e.includes("unknown scene 'no_such_scene'")),
    'an unknown scene did not throw',
  );

  report.consoleErrors = consoleErrors;
  check(consoleErrors.length === 0, `${consoleErrors.length} console errors`);
} finally {
  await browser.close();
  await new Promise<void>((resolve) => server.httpServer.close(() => resolve()));
}

function flipRows(frame: Uint8Array): Uint8Array {
  const out = new Uint8Array(frame.length);
  for (let y = 0; y < H; y++) out.set(frame.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
  return out;
}

report.failures = failures;
console.log(JSON.stringify(report, null, 2));
process.exitCode = failures.length === 0 ? 0 : 1;
