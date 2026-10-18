// Evidence for SSP-024, the M0 look decisions D-01 (speed zoom), D-02 (vehicle tilt), D-03 (480×270 base) and
// D-07 (scale sheet), against the SHIPPING bundle. Not part of `npm test`: it needs Playwright's Chromium and,
// for D-02, Blender 5.2.2. Run with `node tools/spikes/lookDecisions.ts` (after `npm run assets`).
//
// Every frame is a `?test=1` frozen frame (`freeze=1`), positioned with `__ssp.setCamera` where the camera moves,
// rendered headless on SwiftShader (the visual-test flags) and read back with `__ssp.readFrame()` (the W×270
// palette-mapped frame) or as a page screenshot (device pixels, letterbox included).
//
// D-07  `scene=scale_sheet` at 1920×1080: Bessie's body (h00), Doris (idle s) and the litter sample
//       (`litter.banana_skin`) on asphalt and on the 05/06 pavement checkerboard. Checks that every sprite lands
//       1:1 (each opaque atlas texel is the frame pixel at its anchor), measures each sprite's opaque size and
//       the pavement tile pitch along a row and a column (must be 32 px).
// D-03  `lean_quadrants` and `scale_sheet` at 960×540 (itch embed, 2×), 1920×1080 (4×), 2560×1440 (5×),
//       3840×2160 (8×) and 2560×1080 (ultrawide, W = 640, 4×): the canvas rectangle and scale, letterbox bars
//       all `#0f0e12` (index 00), and the image area equal to readFrame() upscaled by exactly the integer
//       scale (0 mismatched device pixels). Device-pixel crops of the human and litter at each scale.
// D-02  `lean_quadrants` at tick 0 and tick 120 with the committed 0° actors atlas and with the temporary 8°
//       atlas (tools/spikes/tilt8Atlas.py; served in place of /assets/atlas/actors.png by Playwright request
//       routing, so nothing is committed or written to public/). Checks that each Bessie's body texels match
//       the atlas being shown, then compares each 8° frame's silhouette shift with the lean a 2.2 m point and
//       the lamp-post top would have at Bessie's screen position.
// D-01  `lean_quadrants` panned north at transit top speed (11 m/s: 11/60 m per 1/60 s frame, 30 frames) at
//       H = 31.5 (zoom off or at sweeping speed), 32.13, 34.65 and 37.8 m (10%, 50%, 100% zoomed out). Per
//       frame: "crawl" pixels (pixels not explained by the best whole-pixel vertical scroll of the previous
//       frame) and, for the north-east Bessie and Doris, whether their sprite window is identical to frame 0
//       (realigned to the projected anchor), plus ink (index 00) and skin (12) pixel counts in Doris's window.
//       Also `scale_sheet` at 37.8 m for sizes when zoomed out.
//
// Exits non-zero on a failed check and prints a JSON report (also written to <out>/report.json). Evidence PNGs go
// to build/spikes/look/ (or $SSP_LOOK_OUT); ROADMAP §8 D-01/D-02/D-03/D-07 lists them.
//
// The 8° renders come from the raw ASSET_PIPELINE §7.1 command (allowed for debugging), run here when
// build/tmp/tilt8/<id>/render.json is missing (or with --render):
//   Blender -b --factory-startup --python-exit-code 1 -P assets-src/blender/vehicles/sweeper.py -- \
//     --out build/tmp/tilt8/veh.sweeper --size 256 --headings 32 --tilt 8
//   (and sweeper_brush.py with --out build/tmp/tilt8/veh.sweeper_brush --size 384)
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { type Browser, chromium, type Page } from '@playwright/test';
import { Vector3 } from 'three';
import { build, preview } from 'vite';
import { FRAME, type FrameId } from '../../src/gen/assets.ts';
import { createCameraRig, pinCameraRig, SWEEP_HEIGHT_M, ZOOM_OUT_HEIGHT_M } from '../../src/render/camera.ts';
import { bessieBodyFrame, bessieBrushFrame } from '../../src/render/headings.ts';
import { KERBSIDE32, PALETTE_SIZE } from '../../src/render/palettePass.ts';
import { indexAtlasPixels, type RgbaImage, TRANSPARENT_INDEX } from '../../src/render/spriteAtlas.ts';
import { LAMP_POST_STACK } from '../../src/render/spriteStack.ts';
import { INTERNAL_HEIGHT_PX, integerScale, internalWidthPx } from '../../src/render/upscale.ts';
import { LEAN_QUADRANTS, leanQuadrantHeading } from '../../src/scenes/LeanQuadrantsScene.ts';
import {
  SCALE_SHEET_BESSIE_FRAME,
  SCALE_SHEET_HUMAN_FRAME,
  SCALE_SHEET_LITTER_FRAME,
  SCALE_SHEET_ROWS_OF_ACTORS,
} from '../../src/scenes/ScaleSheetScene.ts';
import { decodePng, encodeRgbaPng } from '../../tests/support/png.ts';

const H = INTERNAL_HEIGHT_PX;
const SWIFTSHADER_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const OUT_DIR = process.env.SSP_LOOK_OUT ?? 'build/spikes/look';
const TILT_DIR = 'build/tmp/tilt8';
const BLENDER = '/Applications/Blender.app/Contents/MacOS/Blender';
mkdirSync(OUT_DIR, { recursive: true });

/** Transit (brush-up) top speed, GDD §7.1 (ZOOM_FULL_SPEED_MPS): the D-01 pan speed. */
const TRANSIT_SPEED_MPS = 11;
const PAN_FRAMES = 30;
const PAN_STEP_M = TRANSIT_SPEED_MPS / 60;
/** Bessie's hopper top above the ground (assets-src/blender/vehicles/sweeper.py: z1 = 2.20 m). */
const BESSIE_HEIGHT_M = 2.2;
/** Gutter colour of the evidence sheets: 07 chalk. */
const GUTTER = 7;

const failures: string[] = [];
const report: Record<string, unknown> = {};
function check(ok: boolean, message: string): void {
  if (!ok) failures.push(message);
}
const r1 = (v: number): number => Math.round(v * 10) / 10;
const r3 = (v: number): number => Math.round(v * 1000) / 1000;

// --- Palette and atlases ----------------------------------------------------------------------------------------

const paletteIndexOf = new Map<number, number>();
for (let i = 0; i < PALETTE_SIZE; i++) {
  const rgb = KERBSIDE32.rgb;
  paletteIndexOf.set(((rgb[i * 3] ?? 0) << 16) | ((rgb[i * 3 + 1] ?? 0) << 8) | (rgb[i * 3 + 2] ?? 0), i);
}

type Atlas = { width: number; indices: Uint8Array };
function loadAtlasIndices(name: string, path: string): Atlas {
  const image = decodePng(readFileSync(path));
  return { width: image.width, indices: indexAtlasPixels(name, image) };
}
const actors0 = loadAtlasIndices('actors', 'public/assets/atlas/actors.png');
const items = loadAtlasIndices('items', 'public/assets/atlas/items.png');

function texel(atlas: Atlas, frame: FrameId, tx: number, ty: number): number {
  const f = FRAME[frame];
  if (tx < 0 || ty < 0 || tx >= f.w || ty >= f.h) return TRANSPARENT_INDEX;
  return atlas.indices[(f.y + ty) * atlas.width + f.x + tx] ?? TRANSPARENT_INDEX;
}

/** Opaque bounding box of a frame, in cell pixels (inclusive), plus its size and opaque centroid. */
function frameBox(atlas: Atlas, frame: FrameId) {
  const f = FRAME[frame];
  let x0: number = f.w;
  let y0: number = f.h;
  let x1 = -1;
  let y1 = -1;
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let ty = 0; ty < f.h; ty++)
    for (let tx = 0; tx < f.w; tx++) {
      if (texel(atlas, frame, tx, ty) === TRANSPARENT_INDEX) continue;
      x0 = Math.min(x0, tx);
      y0 = Math.min(y0, ty);
      x1 = Math.max(x1, tx);
      y1 = Math.max(y1, ty);
      sx += tx;
      sy += ty;
      n++;
    }
  return { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1, cx: sx / n, cy: sy / n, opaque: n };
}

// --- Frames and images --------------------------------------------------------------------------------------------

/** A palette-index frame (top-down), -1 for a pixel outside Kerbside-32. */
type IndexFrame = { width: number; height: number; px: Int16Array };

function toIndexFrame(rgba: Uint8Array, width: number, height: number): IndexFrame {
  const px = new Int16Array(width * height);
  for (let p = 0; p < px.length; p++) {
    const key = ((rgba[p * 4] ?? 0) << 16) | ((rgba[p * 4 + 1] ?? 0) << 8) | (rgba[p * 4 + 2] ?? 0);
    px[p] = paletteIndexOf.get(key) ?? -1;
  }
  return { width, height, px };
}

function toRgba(frame: IndexFrame): RgbaImage {
  const data = new Uint8Array(frame.px.length * 4);
  for (let p = 0; p < frame.px.length; p++) {
    const i = frame.px[p] ?? 0;
    data[p * 4] = KERBSIDE32.rgb[i * 3] ?? 255;
    data[p * 4 + 1] = KERBSIDE32.rgb[i * 3 + 1] ?? 0;
    data[p * 4 + 2] = KERBSIDE32.rgb[i * 3 + 2] ?? 255;
    data[p * 4 + 3] = 255;
  }
  return { width: frame.width, height: frame.height, data };
}

function at(frame: IndexFrame, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= frame.width || y >= frame.height) return GUTTER;
  return frame.px[y * frame.width + x] ?? GUTTER;
}

function cropFrame(frame: IndexFrame, x0: number, y0: number, w: number, h: number): IndexFrame {
  const px = new Int16Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px[y * w + x] = at(frame, x0 + x, y0 + y);
  return { width: w, height: h, px };
}

function upscale(frame: IndexFrame, s: number): IndexFrame {
  const w = frame.width * s;
  const h = frame.height * s;
  const px = new Int16Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      px[y * w + x] = frame.px[Math.floor(y / s) * frame.width + Math.floor(x / s)] ?? 0;
  return { width: w, height: h, px };
}

function hstack(frames: IndexFrame[], gap = 4): IndexFrame {
  const h = Math.max(...frames.map((f) => f.height));
  const w = frames.reduce((s, f) => s + f.width, 0) + gap * (frames.length - 1);
  const px = new Int16Array(w * h).fill(GUTTER);
  let x0 = 0;
  for (const f of frames) {
    for (let y = 0; y < f.height; y++) px.set(f.px.subarray(y * f.width, (y + 1) * f.width), y * w + x0);
    x0 += f.width + gap;
  }
  return { width: w, height: h, px };
}

function vstack(frames: IndexFrame[], gap = 4): IndexFrame {
  const w = Math.max(...frames.map((f) => f.width));
  const h = frames.reduce((s, f) => s + f.height, 0) + gap * (frames.length - 1);
  const px = new Int16Array(w * h).fill(GUTTER);
  let y0 = 0;
  for (const f of frames) {
    for (let y = 0; y < f.height; y++) px.set(f.px.subarray(y * f.width, (y + 1) * f.width), (y0 + y) * w);
    y0 += f.height + gap;
  }
  return { width: w, height: h, px };
}

async function savePng(name: string, frame: IndexFrame): Promise<string> {
  const path = `${OUT_DIR}/${name}`;
  await writeFile(path, encodeRgbaPng(toRgba(frame)));
  return path;
}

// --- Camera model -------------------------------------------------------------------------------------------------

type Camera = { x: number; y: number; h: number };
type Px = { x: number; y: number };

/** Fractional internal-pixel position (top-left origin) of a world point (sim x, height, sim y). */
function project(cam: Camera, width: number, xM: number, heightM: number, yM: number): Px {
  const rig = createCameraRig(width);
  pinCameraRig(rig, cam.x, cam.y, cam.h);
  const p = new Vector3(xM, heightM, yM).project(rig.camera);
  return { x: ((p.x + 1) / 2) * (width + 2) - 1, y: ((1 - p.y) / 2) * (H + 2) - 1 };
}

/** The pixel corner a flat sprite's pivot lands on: the anchor snapped to 1/16 m, then projected. */
function anchorPx(cam: Camera, width: number, xM: number, yM: number): Px {
  const p = project(cam, width, Math.floor(xM * 16 + 0.5) / 16, 0, Math.floor(yM * 16 + 0.5) / 16);
  return { x: Math.round(p.x), y: Math.round(p.y) };
}

/** Opaque texels of `frame` that do / do not match the frame pixel at their 1:1 position around `anchor`. */
function match1to1(
  shot: IndexFrame,
  atlas: Atlas,
  frame: FrameId,
  anchor: Px,
  skip: (x: number, y: number) => boolean = () => false,
): { matched: number; mismatched: number } {
  const f = FRAME[frame];
  let matched = 0;
  let mismatched = 0;
  for (let ty = 0; ty < f.h; ty++)
    for (let tx = 0; tx < f.w; tx++) {
      const index = texel(atlas, frame, tx, ty);
      if (index === TRANSPARENT_INDEX) continue;
      const x = anchor.x - f.px + tx;
      const y = anchor.y - f.py + ty;
      if (x < 0 || y < 0 || x >= shot.width || y >= shot.height || skip(x, y)) continue;
      if (at(shot, x, y) === index) matched++;
      else mismatched++;
    }
  return { matched, mismatched };
}

/**
 * Crawl of a pan sequence: for each frame after the first, the pixels the best whole-pixel vertical scroll
 * (0..6 px) of the previous frame does not explain (8 px top and bottom margins), and their masks.
 */
function crawlOf(frames: IndexFrame[]): { crawl: number[]; crawlMasks: Uint8Array[] } {
  const crawl: number[] = [];
  const crawlMasks: Uint8Array[] = [];
  for (let k = 1; k < frames.length; k++) {
    const a = frames[k - 1];
    const b = frames[k];
    if (a === undefined || b === undefined) continue;
    const W = b.width;
    let best = Number.POSITIVE_INFINITY;
    let bestDy = 0;
    for (let dy = 0; dy <= 6; dy++) {
      let n = 0;
      for (let y = 8; y < H - 8; y++) for (let x = 0; x < W; x++) if (at(b, x, y) !== at(a, x, y - dy)) n++;
      if (n < best) {
        best = n;
        bestDy = dy;
      }
    }
    crawl.push(best);
    const mask = new Uint8Array(W * H);
    for (let y = 8; y < H - 8; y++)
      for (let x = 0; x < W; x++) if (at(b, x, y) !== at(a, x, y - bestDy)) mask[y * W + x] = 1;
    crawlMasks.push(mask);
  }
  return { crawl, crawlMasks };
}

const stats = (v: number[]) => ({
  mean: r1(v.reduce((s, x) => s + x, 0) / v.length),
  min: Math.min(...v),
  max: Math.max(...v),
});

// --- Page helpers -------------------------------------------------------------------------------------------------

async function open(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page.waitForFunction(() => window.__ssp?.ready === true, undefined, { timeout: 60_000 });
}

async function readFrame(page: Page): Promise<IndexFrame> {
  const { bytes, width } = await page.evaluate(() => {
    const api = window.__ssp;
    if (api === undefined) throw new Error('__ssp missing');
    const frame = api.readFrame();
    return { bytes: Array.from(frame), width: frame.length / 4 / 270 };
  });
  return toIndexFrame(Uint8Array.from(bytes), width, H);
}

async function setCamera(page: Page, cam: Camera): Promise<void> {
  await page.evaluate(({ x, y, h }) => window.__ssp?.setCamera(x, y, h), cam);
}

async function drawCallsOfOneFrame(page: Page): Promise<number> {
  return page.evaluate(() => {
    const w = window as unknown as { __sspDrawCalls: number; __ssp?: { step(n: number): void } };
    w.__sspDrawCalls = 0;
    w.__ssp?.step(0);
    return w.__sspDrawCalls;
  });
}

async function newPage(browser: Browser, width: number, height: number): Promise<Page> {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(String(error)));
  await page.addInitScript(() => {
    const w = window as unknown as { __sspDrawCalls: number };
    w.__sspDrawCalls = 0;
    const proto = WebGL2RenderingContext.prototype as unknown as Record<string, (...a: unknown[]) => unknown>;
    for (const name of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced']) {
      const original = proto[name];
      if (original === undefined) continue;
      proto[name] = function (this: unknown, ...args: unknown[]): unknown {
        w.__sspDrawCalls++;
        return original.apply(this, args);
      };
    }
  });
  return page;
}

const consoleErrors: string[] = [];

// --- 8° renders and the temporary atlas ----------------------------------------------------------------------------

function runChecked(cmd: string, args: string[], what: string): string {
  const res = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (res.status !== 0) throw new Error(`${what} failed (${res.status}): ${res.stderr.slice(-2000)}`);
  return res.stdout;
}

const forceRender = process.argv.includes('--render');
for (const [id, script, size] of [
  ['veh.sweeper', 'sweeper.py', 256],
  ['veh.sweeper_brush', 'sweeper_brush.py', 384],
] as const) {
  if (!forceRender && existsSync(`${TILT_DIR}/${id}/render.json`)) continue;
  const args = [
    '-b',
    '--factory-startup',
    '--python-exit-code',
    '1',
    '-P',
    `assets-src/blender/vehicles/${script}`,
  ];
  args.push('--', '--out', `${TILT_DIR}/${id}`, '--size', String(size), '--headings', '32', '--tilt', '8');
  runChecked(BLENDER, args, `Blender --tilt 8 ${id}`);
}
const tilt = JSON.parse(
  runChecked(
    'uv',
    ['run', '--project', 'tools/forge', 'python', 'tools/spikes/tilt8Atlas.py'],
    'tilt8Atlas.py',
  ),
) as Record<string, unknown>;
report.tilt8Atlas = {
  clippedPx: tilt['veh.sweeper.clippedPx'],
  brushClippedPx: tilt['veh.sweeper_brush.clippedPx'],
  actorsJsonIdentical: tilt.actorsJsonIdentical,
  snapChangedPx: tilt.snapChangedPx,
};
check(tilt.actorsJsonIdentical === true, 'the 8° actors.json differs from the committed one');
const actors8Path = `${TILT_DIR}/out/public/assets/atlas/actors.png`;
const actors8 = loadAtlasIndices('actors', actors8Path);
const actors8Png = readFileSync(actors8Path);

// --- Bundle, server, browser ---------------------------------------------------------------------------------------

await build({ logLevel: 'error' });
const server = await preview({ logLevel: 'error', preview: { port: 0, strictPort: false } });
const url = server.resolvedUrls?.local[0] ?? '';
if (url === '') throw new Error('vite preview did not report a URL');
const browser = await chromium.launch({ args: SWIFTSHADER_ARGS });
const evidence: string[] = [];

try {
  // === D-07: scale sheet at 1:1 ====================================================================================
  {
    const W = 480;
    const page = await newPage(browser, 1920, 1080);
    await open(page, `${url}?test=1&seed=1&scene=scale_sheet&freeze=1`);
    const drawCalls = await drawCallsOfOneFrame(page);
    check(drawCalls === 6, `scale_sheet: ${drawCalls} draw calls, expected 6`);
    const frame = await readFrame(page);
    check(frame.width === W, `scale_sheet: W ${frame.width}`);
    check(!frame.px.includes(-1), 'scale_sheet: off-palette pixels');
    evidence.push(await savePng('d07_scale_sheet_1x.png', frame));
    await page.screenshot({ path: `${OUT_DIR}/d07_scale_sheet_4x.png` });
    evidence.push(`${OUT_DIR}/d07_scale_sheet_4x.png`);

    const home: Camera = { x: 0, y: 0, h: SWEEP_HEIGHT_M };
    const sprites: Record<string, unknown> = {};
    const trios: IndexFrame[] = [];
    for (const row of SCALE_SHEET_ROWS_OF_ACTORS) {
      const entries: [string, Atlas, FrameId, readonly [number, number]][] = [
        ['bessie', actors0, SCALE_SHEET_BESSIE_FRAME, row.bessieM],
        ['human', actors0, SCALE_SHEET_HUMAN_FRAME, row.humanM],
        ['litter', items, SCALE_SHEET_LITTER_FRAME, row.litterM],
      ];
      for (const [name, atlas, id, m] of entries) {
        const anchor = anchorPx(home, W, m[0], m[1]);
        const fit = match1to1(frame, atlas, id, anchor);
        const box = frameBox(atlas, id);
        sprites[`${row.surface}.${name}`] = {
          frame: id,
          anchorPx: anchor,
          ...fit,
          opaqueSizePx: [box.w, box.h],
        };
        check(
          fit.mismatched === 0 && fit.matched > 0,
          `scale_sheet ${row.surface} ${name}: ${fit.mismatched} px off 1:1`,
        );
      }
      const b = anchorPx(home, W, row.bessieM[0], row.bessieM[1]);
      const l = anchorPx(home, W, row.litterM[0], row.litterM[1]);
      trios.push(cropFrame(frame, b.x - 24, b.y - 36, l.x - b.x + 40, 72));
    }
    // Sizes against the size sheet (ART_BIBLE §3.2, §7.1).
    const bessie = frameBox(actors0, SCALE_SHEET_BESSIE_FRAME);
    const human = frameBox(actors0, SCALE_SHEET_HUMAN_FRAME);
    const litter = frameBox(items, SCALE_SHEET_LITTER_FRAME);
    report.d07 = {
      drawCalls,
      sprites,
      bessieBodyPx: [bessie.w - 2, bessie.h - 2],
      bessieWithOutlinePx: [bessie.w, bessie.h],
      humanFigurePx: [human.w, human.h],
      litterItemPx: [litter.w, litter.h],
    };
    check(
      bessie.w - 2 === 28 && bessie.h - 2 === 52,
      `Bessie body ${bessie.w - 2}x${bessie.h - 2}, not 28x52`,
    );
    check(human.w <= 18 && human.h <= 22, `human ${human.w}x${human.h} exceeds 18x22`);
    check(
      Math.max(litter.w, litter.h) <= 14 && Math.max(litter.w, litter.h) >= 8,
      `litter ${litter.w}x${litter.h}`,
    );

    // Pavement tile pitch: 05/06 edges along the row through the litter (y) and the column x = 14 m.
    const edgesAlong = (coords: Px[]): number[] => {
      const out: number[] = [];
      for (let i = 1; i < coords.length; i++) {
        const a = coords[i - 1];
        const c = coords[i];
        if (a === undefined || c === undefined) continue;
        const pa = at(frame, a.x, a.y);
        const pc = at(frame, c.x, c.y);
        if ((pa === 5 && pc === 6) || (pa === 6 && pc === 5)) out.push(i);
      }
      return out;
    };
    const rowY = anchorPx(home, W, 0, -6).y; // a row with nothing on it, across the pavement
    const colX = anchorPx(home, W, 14, 0).x;
    const rowEdges = edgesAlong(Array.from({ length: W }, (_, x) => ({ x, y: rowY })));
    const colEdges = edgesAlong(Array.from({ length: H }, (_, y) => ({ x: colX, y })));
    const pitch = (e: number[]): number[] => e.slice(1).map((v, i) => v - (e[i] ?? 0));
    report.d07TilePitch = { rowEdges, rowPitch: pitch(rowEdges), colEdges, colPitch: pitch(colEdges) };
    check(
      pitch(rowEdges).length >= 5 && pitch(rowEdges).every((p) => p === 32),
      'pavement tile pitch along x is not 32 px',
    );
    check(
      pitch(colEdges).length >= 6 && pitch(colEdges).every((p) => p === 32),
      'pavement tile pitch along y is not 32 px',
    );
    evidence.push(await savePng('d07_trios_4x.png', upscale(vstack(trios), 4)));
    evidence.push(await savePng('d07_trios_1x.png', vstack(trios)));

    // Zoomed out (D-01 input): the same sheet at H = 37.8 m.
    await setCamera(page, { x: 0, y: 0, h: ZOOM_OUT_HEIGHT_M });
    const zoomed = await readFrame(page);
    evidence.push(await savePng('d07_scale_sheet_zoomed_1x.png', zoomed));
    const zt: IndexFrame[] = [];
    const zoomCam: Camera = { x: 0, y: 0, h: ZOOM_OUT_HEIGHT_M };
    for (const row of SCALE_SHEET_ROWS_OF_ACTORS) {
      const b = project(zoomCam, W, row.bessieM[0], 0, row.bessieM[1]);
      const l = project(zoomCam, W, row.litterM[0], 0, row.litterM[1]);
      zt.push(cropFrame(zoomed, Math.round(b.x) - 20, Math.round(b.y) - 30, Math.round(l.x - b.x) + 34, 60));
    }
    evidence.push(await savePng('d07_trios_zoomed_4x.png', upscale(vstack(zt), 4)));
    await page.close();
  }

  // === D-03: readability at 2×, 4×, 5×, 8× and the letterbox =======================================================
  {
    const viewports = [
      { label: '540p_2x', width: 960, height: 540 },
      { label: '1080p_4x', width: 1920, height: 1080 },
      { label: '1440p_5x', width: 2560, height: 1440 },
      { label: '4k_8x', width: 3840, height: 2160 },
      { label: 'ultrawide_4x', width: 2560, height: 1080 },
    ];
    const results: Record<string, unknown> = {};
    const crops: IndexFrame[] = [];
    for (const vp of viewports) {
      const page = await newPage(browser, vp.width, vp.height);
      const W = internalWidthPx(vp.width / vp.height);
      const scale = integerScale(vp.width, vp.height, W);
      const out: Record<string, unknown> = { internalWidth: W, scale };
      for (const scene of ['lean_quadrants', 'scale_sheet'] as const) {
        await open(page, `${url}?test=1&seed=1&scene=${scene}&freeze=1`);
        const frame = await readFrame(page);
        const rect = await page.evaluate(() => {
          const r = document.querySelector('#game')?.getBoundingClientRect();
          return r === undefined ? null : { x: r.x, y: r.y, w: r.width, h: r.height };
        });
        const shotBytes = await page.screenshot();
        const shot = decodePng(shotBytes);
        const page1 = toIndexFrame(Uint8Array.from(shot.data), shot.width, shot.height);
        const left = Math.floor((vp.width - W * scale) / 2);
        const top = Math.floor((vp.height - H * scale) / 2);
        let imageMismatch = 0;
        let barPixels = 0;
        let barNotInk = 0;
        for (let y = 0; y < shot.height; y++)
          for (let x = 0; x < shot.width; x++) {
            const v = page1.px[y * shot.width + x] ?? -1;
            const ix = x - left;
            const iy = y - top;
            if (ix >= 0 && iy >= 0 && ix < W * scale && iy < H * scale) {
              if (v !== at(frame, Math.floor(ix / scale), Math.floor(iy / scale))) imageMismatch++;
            } else {
              barPixels++;
              if (v !== 0) barNotInk++;
            }
          }
        const ok =
          frame.width === W &&
          rect !== null &&
          rect.w === W * scale &&
          rect.h === H * scale &&
          rect.x === left &&
          rect.y === top &&
          imageMismatch === 0 &&
          barNotInk === 0;
        out[scene] = { canvas: rect, frameWidth: frame.width, imageMismatch, barPixels, barNotInk };
        check(
          ok,
          `${vp.label} ${scene}: canvas ${JSON.stringify(rect)}, mismatch ${imageMismatch}, bars ${barNotInk}`,
        );
        if (vp.label !== '540p_2x' && vp.label !== 'ultrawide_4x') {
          await writeFile(`${OUT_DIR}/d03_${scene}_${vp.label}.png`, shotBytes);
          evidence.push(`${OUT_DIR}/d03_${scene}_${vp.label}.png`);
        } else if (scene === 'scale_sheet') {
          await writeFile(`${OUT_DIR}/d03_${scene}_${vp.label}.png`, shotBytes);
          evidence.push(`${OUT_DIR}/d03_${scene}_${vp.label}.png`);
        }
        if (scene === 'scale_sheet') {
          // Device-pixel crop of the asphalt human and litter (true on-screen size at this scale).
          const row = SCALE_SHEET_ROWS_OF_ACTORS[0];
          if (row !== undefined) {
            const hm = anchorPx({ x: 0, y: 0, h: SWEEP_HEIGHT_M }, W, row.humanM[0], row.humanM[1]);
            const lm = anchorPx({ x: 0, y: 0, h: SWEEP_HEIGHT_M }, W, row.litterM[0], row.litterM[1]);
            const x0 = (hm.x - 14) * scale + left;
            const y0 = (hm.y - 26) * scale + top;
            const w = (lm.x - hm.x + 24) * scale;
            const c = cropFrame(page1, x0, y0, w, 34 * scale);
            crops.push(c);
            evidence.push(await savePng(`d03_human_litter_${vp.label}.png`, c));
          }
        }
      }
      results[vp.label] = out;
      await page.close();
    }
    // Physical size of Doris (19 px figure) and the litter (14 px) at typical displays (assumed ppi).
    const displays = [
      { name: '24in 1080p (92 ppi)', scale: 4, ppi: 92 },
      { name: '15.6in 1080p laptop (141 ppi)', scale: 4, ppi: 141 },
      { name: '27in 1440p (109 ppi)', scale: 5, ppi: 109 },
      { name: '27in 4K (163 ppi)', scale: 8, ppi: 163 },
      { name: '960x540 embed on a 24in 1080p (92 ppi)', scale: 2, ppi: 92 },
    ];
    const human = frameBox(actors0, SCALE_SHEET_HUMAN_FRAME);
    const litter = frameBox(items, SCALE_SHEET_LITTER_FRAME);
    report.d03 = {
      results,
      physicalMm: displays.map((d) => ({
        display: d.name,
        humanHeightMm: r1(((human.h * d.scale) / d.ppi) * 25.4),
        litterMm: r1(((Math.max(litter.w, litter.h) * d.scale) / d.ppi) * 25.4),
        artPixelMm: r3((d.scale / d.ppi) * 25.4),
      })),
    };
  }

  // === D-02: 0° vs 8° in lean_quadrants ============================================================================
  {
    const W = 480;
    const home: Camera = { x: 0, y: 0, h: SWEEP_HEIGHT_M };
    const centre = project(home, W, 0, 0, 0);
    const lampTop = LAMP_POST_STACK.slices[LAMP_POST_STACK.slices.length - 1];
    const results: Record<string, unknown> = {};
    for (const tick of [0, 120]) {
      const frames: Record<'0' | '8', IndexFrame> = {
        '0': { width: 0, height: 0, px: new Int16Array() },
        '8': { width: 0, height: 0, px: new Int16Array() },
      };
      for (const deg of ['0', '8'] as const) {
        const page = await newPage(browser, 1920, 1080);
        if (deg === '8') {
          await page.route('**/assets/atlas/actors.png', (route) =>
            route.fulfill({ status: 200, contentType: 'image/png', body: actors8Png }),
          );
        }
        await open(page, `${url}?test=1&seed=1&scene=lean_quadrants&freeze=1&tick=${tick}`);
        const frame = await readFrame(page);
        frames[deg] = frame;
        evidence.push(await savePng(`d02_lean_quadrants_t${tick}_${deg}deg_1x.png`, frame));
        await page.screenshot({ path: `${OUT_DIR}/d02_lean_quadrants_t${tick}_${deg}deg_4x.png` });
        evidence.push(`${OUT_DIR}/d02_lean_quadrants_t${tick}_${deg}deg_4x.png`);
        await page.close();
      }
      const perQuadrant: Record<string, unknown> = {};
      const pairCells: Record<string, IndexFrame> = {};
      const bessieCols: IndexFrame[] = [];
      for (const q of LEAN_QUADRANTS) {
        const heading = leanQuadrantHeading(q, tick);
        const body = bessieBodyFrame(heading);
        const anchor = anchorPx(home, W, q.bessieM[0], q.bessieM[1]);
        // Skip pixels any brush spin frame covers (the brush overlay is drawn over the body).
        const brushF = FRAME[bessieBrushFrame(heading, 0)];
        const covered = (atlas: Atlas) => (x: number, y: number) => {
          for (let s = 0; s < 4; s++)
            if (
              texel(
                atlas,
                bessieBrushFrame(heading, s),
                x - anchor.x + brushF.px,
                y - anchor.y + brushF.py,
              ) !== TRANSPARENT_INDEX
            )
              return true;
          return false;
        };
        const fit0 = match1to1(frames['0'], actors0, body, anchor, covered(actors0));
        const fit8 = match1to1(frames['8'], actors8, body, anchor, covered(actors8));
        const cross = match1to1(frames['8'], actors0, body, anchor, covered(actors0));
        check(fit0.mismatched === 0, `t${tick} ${q.name}: 0° body ${fit0.mismatched} px off the 0° atlas`);
        check(fit8.mismatched === 0, `t${tick} ${q.name}: 8° body ${fit8.mismatched} px off the 8° atlas`);
        check(cross.mismatched > 0, `t${tick} ${q.name}: the 8° frame still shows the 0° body`);
        // The 8° silhouette's lean: its shift against the 0° silhouette (same heading, same pivot).
        const b0 = frameBox(actors0, body);
        const b8 = frameBox(actors8, body);
        const spriteLean = { x: b8.cx - b0.cx, y: b8.cy - b0.cy };
        const topShift = { x: 0, y: b8.y0 - b0.y0 };
        // What the camera does to a point of Bessie's height, and to the lamp-post top, at their positions.
        const foot = project(home, W, q.bessieM[0], 0, q.bessieM[1]);
        const top = project(home, W, q.bessieM[0], BESSIE_HEIGHT_M, q.bessieM[1]);
        const trueLean = { x: top.x - foot.x, y: top.y - foot.y };
        const lampFoot = project(home, W, q.lampPostM[0], 0, q.lampPostM[1]);
        const lampHead = project(home, W, q.lampPostM[0], lampTop?.heightM ?? 4.4, q.lampPostM[1]);
        const lampLean = { x: lampHead.x - lampFoot.x, y: lampHead.y - lampFoot.y };
        const angle = (a: Px, b: Px): number =>
          r1(
            (Math.acos((a.x * b.x + a.y * b.y) / (Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y))) * 180) /
              Math.PI,
          );
        perQuadrant[q.name] = {
          heading: `h${String(heading).padStart(2, '0')}`,
          bessieCentrePx: { x: r1(foot.x), y: r1(foot.y) },
          radialFromCentrePx: { x: r1(foot.x - centre.x), y: r1(foot.y - centre.y) },
          body0: { ...fit0, size: [b0.w, b0.h] },
          body8: { ...fit8, size: [b8.w, b8.h] },
          sprite8LeanPx: { x: r3(spriteLean.x), y: r3(spriteLean.y) },
          sprite8TopEdgeShiftPx: topShift,
          perspectiveLeanOf2p2mPx: { x: r1(trueLean.x), y: r1(trueLean.y) },
          lampTopLeanPx: { x: r1(lampLean.x), y: r1(lampLean.y) },
          sprite8VsPerspectiveDeg: angle(spriteLean, trueLean),
          sprite8VsLampDeg: angle(spriteLean, lampLean),
        };
        // Quadrant pair crop: [0° | 8°], 240×135 each.
        const qx = q.bessieM[0] > 0 ? W / 2 : 0;
        const qy = q.bessieM[1] > 0 ? H / 2 : 0;
        pairCells[q.name] = hstack(
          [cropFrame(frames['0'], qx, qy, W / 2, H / 2), cropFrame(frames['8'], qx, qy, W / 2, H / 2)].map(
            (f) => upscale(f, 2),
          ),
          8,
        );
        bessieCols.push(
          vstack(
            [frames['0'], frames['8']].map((f) =>
              upscale(cropFrame(f, anchor.x - 36, anchor.y - 36, 72, 72), 4),
            ),
            8,
          ),
        );
      }
      results[`tick${tick}`] = perQuadrant;
      const cell = (n: string): IndexFrame => pairCells[n] ?? { width: 1, height: 1, px: new Int16Array(1) };
      evidence.push(
        await savePng(
          `d02_quadrants_t${tick}_0vs8_2x.png`,
          vstack([hstack([cell('nw'), cell('ne')], 16), hstack([cell('sw'), cell('se')], 16)], 16),
        ),
      );
      evidence.push(await savePng(`d02_bessie_t${tick}_0vs8_4x.png`, hstack(bessieCols, 8)));
    }
    report.d02 = results;
  }

  // === D-01: speed zoom at transit speed ===========================================================================
  {
    const W = 480;
    const heights = [SWEEP_HEIGHT_M, 32.13, 34.65, ZOOM_OUT_HEIGHT_M];
    const ne = LEAN_QUADRANTS.find((q) => q.name === 'ne');
    if (ne === undefined) throw new Error('no ne quadrant');
    const page = await newPage(browser, 1920, 1080);
    await open(page, `${url}?test=1&seed=1&scene=lean_quadrants&freeze=1`);
    const results: Record<string, unknown> = {};
    const bessieRows: IndexFrame[] = [];
    const humanRows: IndexFrame[] = [];
    for (const h of heights) {
      const frames: IndexFrame[] = [];
      for (let k = 0; k < PAN_FRAMES; k++) {
        await setCamera(page, { x: 0, y: -k * PAN_STEP_M, h });
        frames.push(await readFrame(page));
      }
      const { crawl, crawlMasks } = crawlOf(frames);
      // Actor windows, realigned to the projected anchor each frame.
      const windowOf = (
        f: IndexFrame,
        k: number,
        m: readonly [number, number],
        dx: number,
        dy: number,
        w: number,
        hh: number,
      ) => {
        const a = project({ x: 0, y: -k * PAN_STEP_M, h }, W, m[0], 0, m[1]);
        return cropFrame(f, Math.round(a.x) + dx, Math.round(a.y) + dy, w, hh);
      };
      const key = (f: IndexFrame): string => Array.from(f.px).join(',');
      const bessieWins = frames.map((f, k) => windowOf(f, k, ne.bessieM, -34, -34, 68, 68));
      const humanWins = frames.map((f, k) => windowOf(f, k, ne.pedestrianM, -12, -23, 24, 26));
      const count = (f: IndexFrame, idx: number): number => f.px.reduce((s, v) => s + (v === idx ? 1 : 0), 0);
      const inkCounts = humanWins.map((f) => count(f, 0));
      const skinCounts = humanWins.map((f) => count(f, 12));
      const bessieInk = bessieWins.map((f) => count(f, 0));
      results[String(h)] = {
        groundPxPerM: r3(16 * (SWEEP_HEIGHT_M / h)),
        crawlPxPerFrame: stats(crawl),
        bessieDistinctWindows: new Set(bessieWins.map(key)).size,
        bessieInkPx: { min: Math.min(...bessieInk), max: Math.max(...bessieInk) },
        humanDistinctWindows: new Set(humanWins.map(key)).size,
        humanInkPx: { min: Math.min(...inkCounts), max: Math.max(...inkCounts) },
        humanSkinPx: { min: Math.min(...skinCounts), max: Math.max(...skinCounts) },
      };
      if (h === SWEEP_HEIGHT_M) {
        check(new Set(bessieWins.map(key)).size === 1, 'D-01: Bessie changes while panning at H = 31.5 m');
        check(new Set(humanWins.map(key)).size === 1, 'D-01: Doris changes while panning at H = 31.5 m');
      }
      const label = String(h).replace('.', 'p');
      bessieRows.push(
        hstack(
          bessieWins.slice(0, 8).map((f) => upscale(f, 4)),
          4,
        ),
      );
      humanRows.push(
        hstack(
          humanWins.slice(0, 8).map((f) => upscale(f, 4)),
          4,
        ),
      );
      const first = frames[0];
      if (first !== undefined) evidence.push(await savePng(`d01_pan_h${label}_k0_1x.png`, first));
      // Crawl map of frame 1 against frame 0: crawl pixels in 18 postbox_red over the frame.
      const f1 = frames[1];
      const m1 = crawlMasks[0];
      if (f1 !== undefined && m1 !== undefined) {
        const marked: IndexFrame = {
          width: W,
          height: H,
          px: Int16Array.from(f1.px, (v, p) => (m1[p] === 1 ? 18 : v)),
        };
        evidence.push(await savePng(`d01_crawl_h${label}_k1_2x.png`, upscale(marked, 2)));
      }
      if (h === SWEEP_HEIGHT_M || h === ZOOM_OUT_HEIGHT_M) {
        await setCamera(page, { x: 0, y: 0, h });
        await page.screenshot({ path: `${OUT_DIR}/d01_h${label}_4x.png` });
        evidence.push(`${OUT_DIR}/d01_h${label}_4x.png`);
        await page.screenshot({
          path: `${OUT_DIR}/d01_h${label}_ne_4x.png`,
          clip: { x: 960, y: 0, width: 960, height: 540 },
        });
        evidence.push(`${OUT_DIR}/d01_h${label}_ne_4x.png`);
      }
    }
    // The same pan over scale_sheet, which has no buildings: at 1:1 everything on screen is flat and must scroll
    // rigidly (0 crawl); any crawl at the other heights is resampling shimmer of the ground and the sprites.
    await open(page, `${url}?test=1&seed=1&scene=scale_sheet&freeze=1`);
    const flat: Record<string, unknown> = {};
    const flatStrip: IndexFrame[] = [];
    for (const h of heights) {
      const frames: IndexFrame[] = [];
      for (let k = 0; k < PAN_FRAMES; k++) {
        await setCamera(page, { x: 0, y: -k * PAN_STEP_M, h });
        frames.push(await readFrame(page));
      }
      const { crawl, crawlMasks } = crawlOf(frames);
      const row = SCALE_SHEET_ROWS_OF_ACTORS[0];
      const litterWins =
        row === undefined
          ? []
          : frames.map((f, k) => {
              const a = project({ x: 0, y: -k * PAN_STEP_M, h }, W, row.litterM[0], 0, row.litterM[1]);
              return cropFrame(f, Math.round(a.x) - 9, Math.round(a.y) - 9, 18, 18);
            });
      const key = (f: IndexFrame): string => Array.from(f.px).join(',');
      flat[String(h)] = {
        crawlPxPerFrame: stats(crawl),
        litterDistinctWindows: new Set(litterWins.map(key)).size,
      };
      if (h === SWEEP_HEIGHT_M)
        check(
          crawl.every((c) => c === 0),
          'D-01: scale_sheet crawls while panning at 31.5 m',
        );
      flatStrip.push(
        hstack(
          litterWins.slice(0, 8).map((f) => upscale(f, 6)),
          4,
        ),
      );
      const f1 = frames[1];
      const m1 = crawlMasks[0];
      if (f1 !== undefined && m1 !== undefined) {
        const marked: IndexFrame = {
          width: W,
          height: H,
          px: Int16Array.from(f1.px, (v, p) => (m1[p] === 1 ? 18 : v)),
        };
        evidence.push(
          await savePng(`d01_flat_crawl_h${String(h).replace('.', 'p')}_k1_2x.png`, upscale(marked, 2)),
        );
      }
    }
    evidence.push(await savePng('d01_litter_pan_strip_6x.png', vstack(flatStrip, 12)));
    report.d01Flat = flat;
    evidence.push(await savePng('d01_bessie_pan_strip_4x.png', vstack(bessieRows, 12)));
    evidence.push(await savePng('d01_human_pan_strip_4x.png', vstack(humanRows, 12)));
    report.d01 = { panStepM: r3(PAN_STEP_M), frames: PAN_FRAMES, heights: results };
    await page.close();
  }

  report.consoleErrors = consoleErrors;
  check(consoleErrors.length === 0, `${consoleErrors.length} console errors`);
} finally {
  await browser.close();
  await new Promise<void>((resolve) => server.httpServer.close(() => resolve()));
}

report.evidence = evidence;
report.failures = failures;
await writeFile(`${OUT_DIR}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
process.exitCode = failures.length === 0 ? 0 : 1;
