// Manual dev-build check for SSP-018 (sprite batches: Bessie at 32 headings, her brush, the pedestrian, drop
// shadows). Not part of `npm test`: it needs Playwright's Chromium (`npx playwright install chromium`).
// Run with `node tools/spikes/spriteBatchFrame.ts`.
//
// 1. Starts the Vite dev server and opens it in headless Chromium with the visual-test flags
//    (--use-angle=swiftshader --enable-unsafe-swiftshader) at 1920x1080 (W = 480, 4x), camera over the origin.
// 2. Draw calls (renderer.info.render.calls over the whole frame, from the dev panel): `?world=empty` is the
//    baseline (palette + blit), `?actors=0` the spike city alone; the actors must add exactly 2 (drop shadows +
//    actors atlas) and the frame must stay within the budget of 10.
// 3. For each of the 32 headings (`?actorFrame=k·15`) and the 4 brush spin frames, the canvas is reduced to
//    internal pixels and compared, pixel for pixel over the WHOLE frame, with a CPU composition built from the
//    actors=0 frame and the atlas indices: drop shadows (body and pedestrian silhouettes moved +2, +2 px)
//    remapped through shadow[32], then the pedestrian, body and brush texels at 1:1 around their pivots. Zero
//    mismatches proves 1:1 drawing, the stable centre pivot, the +2,+2 SE shadows and the layer order.
// 4. All 32 Bessie crops differ (32 distinct headings), the 4 brush frames differ (it spins), every pixel is a
//    Kerbside-32 colour, and there are no console errors.
// Exits non-zero on any failure and prints a JSON report. Evidence goes to build/spikes/sprite-batch/:
// frame_h00.png (full canvas), headings.png (the 32 headings as a 4x contact sheet, h00..h31 in reading
// order), brush.png (the 4 spin frames at h00, 4x), actors_4x.png (Bessie beside the pedestrian, 4x).
import { mkdirSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { chromium, type Page } from '@playwright/test';
import { Vector3 } from 'three';
import { createServer } from 'vite';
import { FRAME, type FrameId } from '../../src/gen/assets.ts';
import { createCameraRig } from '../../src/render/camera.ts';
import { KERBSIDE32, PALETTE_SIZE } from '../../src/render/palettePass.ts';
import {
  FRAMES_PER_BRUSH_SPIN,
  FRAMES_PER_HEADING,
  SPIKE_BESSIE_M,
  SPIKE_PEDESTRIAN_FRAME,
  SPIKE_PEDESTRIAN_M,
  spikeBodyFrame,
  spikeBrushFrame,
} from '../../src/render/spikeActors.ts';
import { indexAtlasPixels, TRANSPARENT_INDEX } from '../../src/render/spriteAtlas.ts';
import { DROP_SHADOW_OFFSET_PX } from '../../src/render/spriteBatch.ts';
import { INTERNAL_HEIGHT_PX } from '../../src/render/upscale.ts';
import { decodePng, encodeRgbaPng } from '../../tests/support/png.ts';

const VIEWPORT = { width: 1920, height: 1080 };
const W = 480;
const H = INTERNAL_HEIGHT_PX;
const SCALE = 4;
const SWIFTSHADER_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const OUT_DIR = 'build/spikes/sprite-batch';
const DRAW_BUDGET = 10;
mkdirSync(OUT_DIR, { recursive: true });

const paletteKeys = Array.from({ length: PALETTE_SIZE }, (_, i) => {
  const rgb = KERBSIDE32.rgb;
  return ((rgb[i * 3] ?? 0) << 16) | ((rgb[i * 3 + 1] ?? 0) << 8) | (rgb[i * 3 + 2] ?? 0);
});

const atlasImage = decodePng(readFileSync('public/assets/atlas/actors.png'));
const atlas = indexAtlasPixels('actors', atlasImage);

/** Internal-pixel position of a ground point (sim metres), camera over the origin at W = 480. */
const rig = createCameraRig(W);
function project(xM: number, yM: number): { x: number; y: number } {
  const p = new Vector3(xM, 0, yM).project(rig.camera);
  return { x: ((p.x + 1) / 2) * (W + 2) - 1, y: ((1 - p.y) / 2) * (H + 2) - 1 };
}

/** The pixel corner a sprite's pivot lands on (the shader snaps the anchor to the 1/16 m grid). */
function anchorPx(xM: number, yM: number): { x: number; y: number } {
  const p = project(Math.round(xM * 16) / 16, Math.round(yM * 16) / 16);
  return { x: Math.round(p.x), y: Math.round(p.y) };
}

/** Calls `visit(screenX, screenY, index)` for every opaque texel of `frame` with its pivot at `anchor`. */
function forEachTexel(
  frame: FrameId,
  anchor: { x: number; y: number },
  visit: (x: number, y: number, index: number) => void,
): void {
  const f = FRAME[frame];
  for (let ty = 0; ty < f.h; ty++) {
    for (let tx = 0; tx < f.w; tx++) {
      const index = atlas[(f.y + ty) * atlasImage.width + f.x + tx] ?? TRANSPARENT_INDEX;
      if (index !== TRANSPARENT_INDEX) visit(anchor.x - f.px + tx, anchor.y - f.py + ty, index);
    }
  }
}

const bessie = anchorPx(SPIKE_BESSIE_M[0], SPIKE_BESSIE_M[1]);
const pedestrian = anchorPx(SPIKE_PEDESTRIAN_M[0], SPIKE_PEDESTRIAN_M[1]);

/** CPU composition of the expected frame (palette indices) over the actors=0 frame `base`. */
function expectedFrame(base: Int16Array, body: FrameId, brush: FrameId): Int16Array {
  const out = Int16Array.from(base);
  const inFrame = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < W && y < H;
  const shadowed = new Uint8Array(W * H);
  const castShadow = (x: number, y: number): void => {
    const sx = x + DROP_SHADOW_OFFSET_PX;
    const sy = y + DROP_SHADOW_OFFSET_PX;
    if (inFrame(sx, sy)) shadowed[sy * W + sx] = 1;
  };
  forEachTexel(SPIKE_PEDESTRIAN_FRAME, pedestrian, castShadow);
  forEachTexel(body, bessie, castShadow);
  for (let p = 0; p < out.length; p++) {
    if (shadowed[p] === 1) out[p] = KERBSIDE32.shadow[base[p] ?? 0] ?? -1;
  }
  const paint = (x: number, y: number, index: number): void => {
    if (inFrame(x, y)) out[y * W + x] = index;
  };
  forEachTexel(SPIKE_PEDESTRIAN_FRAME, pedestrian, paint); // layer 5
  forEachTexel(body, bessie, paint); // layer 7
  forEachTexel(brush, bessie, paint); // layer 8
  return out;
}

/** The canvas as internal-pixel palette indices (−1 = off-palette), sampled at each 4x4 block centre. */
async function internalFrame(page: Page): Promise<Int16Array> {
  const png = await page.locator('#game').screenshot();
  const image = decodePng(png);
  if (image.width !== W * SCALE || image.height !== H * SCALE) {
    throw new Error(`canvas ${image.width}x${image.height}, expected ${W * SCALE}x${H * SCALE}`);
  }
  const out = new Int16Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = ((y * SCALE + SCALE / 2) * image.width + x * SCALE + SCALE / 2) * 4;
      const key = ((image.data[o] ?? 0) << 16) | ((image.data[o + 1] ?? 0) << 8) | (image.data[o + 2] ?? 0);
      out[y * W + x] = paletteKeys.indexOf(key);
    }
  }
  return out;
}

async function load(page: Page, query: string): Promise<void> {
  await page.goto(`${url}${query}`);
  await page.waitForTimeout(1500);
}

/** Total draw calls of the last frame, from the dev panel readout (F1 opens and closes the panel). */
async function drawCalls(page: Page): Promise<number> {
  await page.keyboard.press('F1');
  await page.waitForTimeout(500);
  const readout = (await page.locator('#ssp-devPanel pre').textContent()) ?? '';
  await page.keyboard.press('F1');
  await page.waitForTimeout(200);
  return Number(/draw calls (\d+)/.exec(readout)?.[1] ?? Number.NaN);
}

/** Writes a crop of internal frames (palette indices) side by side, scaled up `scale`x, as a PNG. */
async function writeSheet(
  path: string,
  frames: readonly Int16Array[],
  rect: { x: number; y: number; w: number; h: number },
  columns: number,
  scale: number,
): Promise<void> {
  const gap = 2;
  const rows = Math.ceil(frames.length / columns);
  const width = columns * (rect.w * scale + gap) - gap;
  const height = rows * (rect.h * scale + gap) - gap;
  const data = new Uint8Array(width * height * 4); // gaps stay transparent
  frames.forEach((frame, i) => {
    const ox = (i % columns) * (rect.w * scale + gap);
    const oy = Math.floor(i / columns) * (rect.h * scale + gap);
    for (let y = 0; y < rect.h * scale; y++) {
      for (let x = 0; x < rect.w * scale; x++) {
        const index = frame[(rect.y + Math.floor(y / scale)) * W + rect.x + Math.floor(x / scale)] ?? -1;
        const o = ((oy + y) * width + ox + x) * 4;
        const rgb = KERBSIDE32.rgb;
        data.set([rgb[index * 3] ?? 0, rgb[index * 3 + 1] ?? 0, rgb[index * 3 + 2] ?? 0, 255], o);
      }
    }
  });
  await writeFile(path, encodeRgbaPng({ width, height, data }));
}

/** Bounding-box centre of the pixels where `a` and `b` differ inside `rect` (internal px). */
function changedCentre(
  a: Int16Array,
  b: Int16Array,
  rect: { x: number; y: number; w: number; h: number },
): { x: number; y: number } {
  let x0 = Number.POSITIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      if (a[y * W + x] !== b[y * W + x]) {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x + 1);
        y1 = Math.max(y1, y + 1);
      }
    }
  }
  return { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
}

const failures: string[] = [];
const report: Record<string, unknown> = {};
const server = await createServer({ logLevel: 'error', server: { port: 0, strictPort: false } });
await server.listen();
const url = server.resolvedUrls?.local[0] ?? '';
if (url === '') throw new Error('vite dev server did not report a URL');
const browser = await chromium.launch({ args: SWIFTSHADER_ARGS });

try {
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(String(error)));

  // --- Draw calls ----------------------------------------------------------------------------------------
  await load(page, '?world=empty');
  const empty = await drawCalls(page);
  await load(page, '?actors=0');
  const cityOnly = await drawCalls(page);
  const base = await internalFrame(page);
  await load(page, '?actorFrame=0');
  const withActors = await drawCalls(page);
  report.drawCalls = { empty, cityOnly, withActors, actorsDelta: withActors - cityOnly };
  if (withActors - cityOnly !== 2) failures.push(`actors add ${withActors - cityOnly} draws, not 2`);
  if (!(withActors <= DRAW_BUDGET)) failures.push(`${withActors} draw calls, budget ${DRAW_BUDGET}`);
  await writeFile(`${OUT_DIR}/frame_h00.png`, await page.locator('#game').screenshot());

  // --- 32 headings -----------------------------------------------------------------------------------------
  const crop = { x: bessie.x - 40, y: bessie.y - 40, w: 80, h: 80 };
  const headingFrames: Int16Array[] = [];
  const headings: Record<string, unknown>[] = [];
  for (let k = 0; k < 32; k++) {
    const actorFrame = k * FRAMES_PER_HEADING;
    await load(page, `?actorFrame=${actorFrame}`);
    const frame = await internalFrame(page);
    headingFrames.push(frame);
    const body = spikeBodyFrame(actorFrame);
    const expected = expectedFrame(base, body, spikeBrushFrame(actorFrame));
    let mismatches = 0;
    let offPalette = 0;
    for (let p = 0; p < frame.length; p++) {
      if (frame[p] !== expected[p]) mismatches++;
      if (frame[p] === -1) offPalette++;
    }
    const centre = changedCentre(frame, base, { x: bessie.x - 32, y: bessie.y - 32, w: 64, h: 64 });
    headings.push({ body, mismatches, offPalette, changedCentre: centre });
    if (mismatches > 0) failures.push(`${body}: ${mismatches} pixels differ from the 1:1 composition`);
    if (offPalette > 0) failures.push(`${body}: ${offPalette} off-palette pixels`);
  }
  report.anchors = { bessie, pedestrian };
  report.headings = headings;
  const cropKey = (f: Int16Array): string => {
    const rows: string[] = [];
    for (let y = crop.y; y < crop.y + crop.h; y++)
      rows.push(Array.from(f.subarray(y * W + crop.x, y * W + crop.x + crop.w)).join());
    return rows.join(';');
  };
  const distinctHeadings = new Set(headingFrames.map(cropKey)).size;
  report.distinctHeadingCrops = distinctHeadings;
  if (distinctHeadings !== 32) failures.push(`${distinctHeadings} distinct heading crops, expected 32`);
  await writeSheet(`${OUT_DIR}/headings.png`, headingFrames, crop, 8, SCALE);

  // --- Brush spin ------------------------------------------------------------------------------------------
  const spinFrames: Int16Array[] = [];
  const spins: Record<string, unknown>[] = [];
  for (let n = 0; n < 4; n++) {
    const actorFrame = 2 * FRAMES_PER_HEADING * 4 + n * FRAMES_PER_BRUSH_SPIN; // h08, spin 0..3
    await load(page, `?actorFrame=${actorFrame}`);
    const frame = await internalFrame(page);
    spinFrames.push(frame);
    const brush = spikeBrushFrame(actorFrame);
    const expected = expectedFrame(base, spikeBodyFrame(actorFrame), brush);
    let mismatches = 0;
    for (let p = 0; p < frame.length; p++) if (frame[p] !== expected[p]) mismatches++;
    spins.push({ brush, mismatches });
    if (mismatches > 0) failures.push(`${brush}: ${mismatches} pixels differ from the 1:1 composition`);
  }
  report.brushSpin = spins;
  const distinctSpins = new Set(spinFrames.map(cropKey)).size;
  report.distinctSpinCrops = distinctSpins;
  if (distinctSpins !== 4) failures.push(`${distinctSpins} distinct brush spin crops, expected 4`);
  await writeSheet(`${OUT_DIR}/brush.png`, spinFrames, crop, 4, SCALE);

  // Bessie (h00) beside the pedestrian, 4x.
  const pair = {
    x: bessie.x - 44,
    y: Math.min(bessie.y, pedestrian.y) - 44,
    w: pedestrian.x - bessie.x + 72,
    h: Math.abs(pedestrian.y - bessie.y) + 76,
  };
  const h00 = headingFrames[0];
  if (h00 !== undefined) await writeSheet(`${OUT_DIR}/actors_4x.png`, [h00], pair, 1, SCALE);

  report.consoleErrors = consoleErrors;
  if (consoleErrors.length > 0) failures.push(`${consoleErrors.length} console errors`);
} finally {
  await browser.close();
  await server.close();
}

report.failures = failures;
console.log(JSON.stringify(report, null, 2));
process.exitCode = failures.length === 0 ? 0 : 1;
