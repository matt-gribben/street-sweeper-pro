// Manual check for SSP-020 (the 4-slice sprite-stack lamp post in lean_quadrants, D-02 input) against the
// SHIPPING bundle. Not part of `npm test`: it needs Playwright's Chromium (`npx playwright install chromium`).
// Run with `node tools/spikes/lampPostStackFrame.ts` (after `npm run assets`).
//
// 1. `vite build` + `vite preview`, headless Chromium with the visual-test flags (--use-angle=swiftshader
//    --enable-unsafe-swiftshader) at 1920x1080 (W = 480, 4x). An init script counts WebGL draw calls
//    (drawArrays/drawElements and their instanced forms: what renderer.info.render.calls counts).
// 2. `/?test=1&scene=lean_quadrants&freeze=1`: one `__ssp.step(0)` renders exactly one frame; its draw calls
//    must be <= 10 (TECHNICAL_DESIGN §12.7), and 7 are expected (city, building shadows, drop shadows, actors,
//    items, palette pass, blit).
// 3. Every lamp post pixel matches a CPU model of the stack (bar texel-edge ties, see TIE_TEXELS): each internal
//    pixel centre is unprojected through
//    the same camera onto the plane of each slice (real heights: the band tops in spriteStack.ts), the texel
//    under it is looked up in the items atlas, and the topmost opaque slice wins. 0 mismatches means the GPU
//    draws every slice at its real height, magnified and leaned exactly as the perspective camera dictates.
// 4. Lean: in each quadrant the slice anchors move outward from the screen centre along the radial through the
//    post's foot, in the same direction as the roof corners of the quadrant's buildings (both are points at
//    height under one perspective camera); reported as vectors and angles.
// 5. `setCamera(x, y, 31.5)` over each lamp post: every slice anchor projects to the same pixel (zero offset),
//    the GPU frame matches the model, and the model is discriminating (a 1 px shift of one slice mismatches).
// 6. Slice-count evidence: `setCamera` puts the NE lamp post 12.5 m right of and 5 m above the screen centre,
//    near the side edge, and the model measures the gaps between consecutive slices along the radial.
// 7. No console errors.
// Exits non-zero on any failure and prints a JSON report. Evidence goes to build/spikes/lamp-post/ (or
// $SSP_LAMP_OUT): lean_quadrants_4x.png (the page), lean_quadrants_1x.png (readFrame), lamps_8x.png (the
// four lamp posts, 8x crops), centred_ne_8x.png, edge_ne_1x.png / edge_ne_8x.png.
import { mkdirSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { chromium, type Page } from '@playwright/test';
import { Vector3 } from 'three';
import { build, preview } from 'vite';
import { FRAME } from '../../src/gen/assets.ts';
import { createCameraRig, pinCameraRig, SWEEP_HEIGHT_M } from '../../src/render/camera.ts';
import { mergeBoxes } from '../../src/render/cityMesh.ts';
import { KERBSIDE32 } from '../../src/render/palettePass.ts';
import { parseCityGrid } from '../../src/render/placeholderCity.ts';
import { indexAtlasPixels, type RgbaImage, TRANSPARENT_INDEX } from '../../src/render/spriteAtlas.ts';
import { LAMP_POST_STACK, type StackSlice } from '../../src/render/spriteStack.ts';
import { INTERNAL_HEIGHT_PX } from '../../src/render/upscale.ts';
import {
  LEAN_QUADRANTS,
  LEAN_QUADRANTS_ORIGIN_M,
  LEAN_QUADRANTS_ROWS,
} from '../../src/scenes/LeanQuadrantsScene.ts';
import { decodePng, encodeRgbaPng } from '../../tests/support/png.ts';

const W = 480;
const H = INTERNAL_HEIGHT_PX;
const SWIFTSHADER_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const OUT_DIR = process.env.SSP_LAMP_OUT ?? 'build/spikes/lamp-post';
mkdirSync(OUT_DIR, { recursive: true });
/** Half-size of the model window around a lamp post, in internal pixels (the edge case leans 35 px). */
const WINDOW_PX = 48;

const itemsImage = decodePng(readFileSync('public/assets/atlas/items.png'));
const itemsIndices = indexAtlasPixels('items', itemsImage);

const failures: string[] = [];
const report: Record<string, unknown> = {};
function check(ok: boolean, message: string): void {
  if (!ok) failures.push(message);
}

type Camera = { x: number; y: number; h: number };
type Px = { x: number; y: number };

/** The sprite shader's anchor in ground pixels: the pivot snapped to the 1/16 m grid. */
const anchorGroundPx = (m: number): number => Math.floor(m * 16 + 0.5);

function rigFor(cam: Camera): ReturnType<typeof createCameraRig> {
  const rig = createCameraRig(W);
  pinCameraRig(rig, cam.x, cam.y, cam.h);
  return rig;
}

/** Fractional internal-pixel position (top-left origin, pixel centres at +0.5) of a world point. */
function project(cam: Camera, xM: number, heightM: number, yM: number): Px {
  const p = new Vector3(xM, heightM, yM).project(rigFor(cam).camera);
  return { x: ((p.x + 1) / 2) * (W + 2) - 1, y: ((1 - p.y) / 2) * (H + 2) - 1 };
}

/**
 * Texel distance from an edge below which the GPU may round either way. Rasterisers snap vertices to a sub-pixel
 * grid (1/256 px on SwiftShader), which moves interpolated texel coordinates by up to about 1/256 × the slice's
 * magnification (≤ 1.17×). SSP-020 measured a texel coordinate of 13.0008 (model, float64) that the GPU floored
 * to 12, and a 1/256 texel bias in the shader only moved the tie point (more mismatches, not fewer), so a pixel
 * within this distance of a texel edge is reported as a tie rather than a failure.
 */
const TIE_TEXELS = 1 / 128;

const nearEdge = (t: number): boolean => Math.abs(t - Math.round(t)) < TIE_TEXELS;

/**
 * Index of `slice`'s texel under internal pixel (px, py) (TRANSPARENT_INDEX outside the frame), and whether that
 * pixel centre lies within TIE_TEXELS of a texel edge; `shiftPx` nudges the slice.
 */
function sliceTexel(
  rig: ReturnType<typeof createCameraRig>,
  slice: StackSlice,
  lamp: readonly [number, number],
  px: number,
  py: number,
  shiftPx = 0,
): { index: number; tie: boolean } {
  // Pixel centre -> NDC over the (W+2) x (H+2) target, then the view ray -> the slice's plane.
  const ndcX = ((px + 1 + 0.5) / (W + 2)) * 2 - 1;
  const ndcY = 1 - ((py + 1 + 0.5) / (H + 2)) * 2;
  const near = new Vector3(ndcX, ndcY, -1).unproject(rig.camera);
  const far = new Vector3(ndcX, ndcY, 1).unproject(rig.camera);
  const t = (slice.heightM - near.y) / (far.y - near.y);
  const gx = (near.x + t * (far.x - near.x)) * 16;
  const gz = (near.z + t * (far.z - near.z)) * 16;
  const f = FRAME[slice.frame];
  const u = gx - anchorGroundPx(lamp[0]) + f.px - shiftPx;
  const v = gz - anchorGroundPx(lamp[1]) + f.py;
  const tie = nearEdge(u) || nearEdge(v);
  const tx = Math.floor(u);
  const ty = Math.floor(v);
  if (tx < 0 || ty < 0 || tx >= f.w || ty >= f.h) return { index: TRANSPARENT_INDEX, tie };
  return { index: itemsIndices[(f.y + ty) * itemsImage.width + f.x + tx] ?? TRANSPARENT_INDEX, tie };
}

/** A lamp pixel of the model; `tie` when any slice tested for it sits within TIE_TEXELS of a texel edge. */
type ModelPixel = { x: number; y: number; index: number; slice: number; tie: boolean };

/** The stack as the CPU model sees it: the topmost opaque slice texel per pixel in a window. */
function modelStack(
  cam: Camera,
  lamp: readonly [number, number],
  shift?: { slice: number; px: number },
): ModelPixel[] {
  const rig = rigFor(cam);
  const foot = project(cam, anchorGroundPx(lamp[0]) / 16, 0, anchorGroundPx(lamp[1]) / 16);
  const out: ModelPixel[] = [];
  const slices = LAMP_POST_STACK.slices;
  for (let py = Math.floor(foot.y) - WINDOW_PX; py <= foot.y + WINDOW_PX; py++) {
    for (let px = Math.floor(foot.x) - WINDOW_PX; px <= foot.x + WINDOW_PX; px++) {
      if (px < 0 || py < 0 || px >= W || py >= H) continue;
      let tie = false;
      for (let k = slices.length - 1; k >= 0; k--) {
        const slice = slices[k];
        if (slice === undefined) continue;
        const texel = sliceTexel(rig, slice, lamp, px, py, shift?.slice === k ? shift.px : 0);
        tie ||= texel.tie;
        if (texel.index !== TRANSPARENT_INDEX) {
          out.push({ x: px, y: py, index: texel.index, slice: k, tie });
          break;
        }
      }
    }
  }
  return out;
}

type Match = { pixels: number; mismatched: number; tiePixels: number; tieMismatched: number };

/**
 * Pixels where the frame's colour differs from the model's palette colour: `mismatched` away from texel edges
 * (must be 0), `tieMismatched` at ties (either rounding is legitimate).
 */
function compare(frame: Uint8Array, model: ModelPixel[]): Match {
  const m: Match = { pixels: model.length, mismatched: 0, tiePixels: 0, tieMismatched: 0 };
  const rgb = KERBSIDE32.rgb;
  for (const p of model) {
    const o = (p.y * W + p.x) * 4;
    const differs =
      frame[o] !== rgb[p.index * 3] ||
      frame[o + 1] !== rgb[p.index * 3 + 1] ||
      frame[o + 2] !== rgb[p.index * 3 + 2];
    if (p.tie) m.tiePixels++;
    if (differs && p.tie) m.tieMismatched++;
    else if (differs) m.mismatched++;
  }
  return m;
}

/** Projected anchor of every slice (internal px) and its offset from the foot. */
function sliceAnchors(cam: Camera, lamp: readonly [number, number]): { anchors: Px[]; offsets: Px[] } {
  const x = anchorGroundPx(lamp[0]) / 16;
  const y = anchorGroundPx(lamp[1]) / 16;
  const foot = project(cam, x, 0, y);
  const anchors = LAMP_POST_STACK.slices.map((s) => project(cam, x, s.heightM, y));
  const round = (v: number): number => Math.round(v * 1000) / 1000;
  return {
    anchors: anchors.map((a) => ({ x: round(a.x), y: round(a.y) })),
    offsets: anchors.map((a) => ({ x: round(a.x - foot.x), y: round(a.y - foot.y) })),
  };
}

/**
 * Gaps (px) between consecutive slices along the radial from the foot outward: the model's opaque pixels are
 * projected onto the radial line and every uncovered run between the foot and the top anchor is reported.
 */
function radialGaps(cam: Camera, lamp: readonly [number, number], model: ModelPixel[]): number[] {
  const { anchors } = sliceAnchors(cam, lamp);
  const foot = project(cam, anchorGroundPx(lamp[0]) / 16, 0, anchorGroundPx(lamp[1]) / 16);
  const top = anchors[anchors.length - 1] ?? foot;
  const dx = top.x - foot.x;
  const dy = top.y - foot.y;
  const len = Math.hypot(dx, dy);
  if (len < 1) return [];
  const ux = dx / len;
  const uy = dy / len;
  // Pixels within 1 px of the radial line, by their distance along it (in whole pixels).
  const covered = new Set<number>();
  for (const p of model) {
    const rx = p.x + 0.5 - foot.x;
    const ry = p.y + 0.5 - foot.y;
    const along = rx * ux + ry * uy;
    const across = Math.abs(rx * uy - ry * ux);
    if (across <= 1) covered.add(Math.floor(along));
  }
  const gaps: number[] = [];
  let run = 0;
  for (let d = 0; d <= Math.ceil(len); d++) {
    if (covered.has(d)) {
      if (run > 0) gaps.push(run);
      run = 0;
    } else run++;
  }
  return gaps;
}

function crop(frame: Uint8Array, cx: number, cy: number, half: number, scale: number): RgbaImage {
  const size = half * 2;
  const out = new Uint8Array(size * scale * size * scale * 4);
  for (let y = 0; y < size * scale; y++) {
    for (let x = 0; x < size * scale; x++) {
      const sx = Math.min(W - 1, Math.max(0, Math.floor(cx - half + x / scale)));
      const sy = Math.min(H - 1, Math.max(0, Math.floor(cy - half + y / scale)));
      out.set(frame.subarray((sy * W + sx) * 4, (sy * W + sx) * 4 + 4), (y * size * scale + x) * 4);
    }
  }
  return { width: size * scale, height: size * scale, data: out };
}

function strip(images: RgbaImage[]): RgbaImage {
  const height = Math.max(...images.map((i) => i.height));
  const width = images.reduce((s, i) => s + i.width, 0);
  const data = new Uint8Array(width * height * 4);
  let x0 = 0;
  for (const img of images) {
    for (let y = 0; y < img.height; y++)
      data.set(img.data.subarray(y * img.width * 4, (y + 1) * img.width * 4), (y * width + x0) * 4);
    x0 += img.width;
  }
  return { width, height, data };
}

async function readFrame(page: Page): Promise<Uint8Array> {
  const bytes = await page.evaluate(() => {
    const api = window.__ssp;
    if (api === undefined) throw new Error('__ssp missing');
    return Array.from(api.readFrame());
  });
  return Uint8Array.from(bytes);
}

/** Draw calls of exactly one rendered frame (`__ssp.step(0)` renders once, synchronously). */
async function drawCallsOfOneFrame(page: Page): Promise<number> {
  return page.evaluate(() => {
    const w = window as unknown as { __sspDrawCalls: number; __ssp?: { step(n: number): void } };
    w.__sspDrawCalls = 0;
    w.__ssp?.step(0);
    return w.__sspDrawCalls;
  });
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

  // --- 2. lean_quadrants, frozen: draw calls ----------------------------------------------------------------
  await page.goto(`${url}?test=1&scene=lean_quadrants&freeze=1`);
  await page.waitForFunction(() => window.__ssp?.ready === true, undefined, { timeout: 30_000 });
  const drawCalls = await drawCallsOfOneFrame(page);
  report.drawCalls = drawCalls;
  check(drawCalls <= 10, `draw calls ${drawCalls} > 10`);
  check(drawCalls === 7, `draw calls ${drawCalls}, expected 7 (5 world draws + palette + blit)`);

  await page.screenshot({ path: `${OUT_DIR}/lean_quadrants_4x.png` });
  const home: Camera = { x: 0, y: 0, h: SWEEP_HEIGHT_M };
  const frame = await readFrame(page);
  await writeFile(`${OUT_DIR}/lean_quadrants_1x.png`, encodeRgbaPng({ width: W, height: H, data: frame }));

  // --- 3 + 4. model match and lean per quadrant ----------------------------------------------------------------
  const grid = parseCityGrid(LEAN_QUADRANTS_ROWS, LEAN_QUADRANTS_ORIGIN_M[0], LEAN_QUADRANTS_ORIGIN_M[1]);
  const boxes = mergeBoxes(grid);
  const quadrants: Record<string, unknown> = {};
  const crops: RgbaImage[] = [];
  for (const q of LEAN_QUADRANTS) {
    const model = modelStack(home, q.lampPostM);
    const match = compare(frame, model);
    const { offsets } = sliceAnchors(home, q.lampPostM);
    const foot = project(home, q.lampPostM[0], 0, q.lampPostM[1]);
    const centre = project(home, 0, 0, 0);
    const lean = offsets[offsets.length - 1] ?? { x: 0, y: 0 };
    const radial = { x: foot.x - centre.x, y: foot.y - centre.y };
    // The quadrant's 6-storey tower: the shift of its outermost roof corner relative to its base corner.
    const tower = boxes.find(
      (b) =>
        b.storeys === 6 &&
        Math.sign(b.x0M + b.x1M) === Math.sign(q.lampPostM[0]) &&
        Math.sign(b.y0M + b.y1M) === Math.sign(q.lampPostM[1]),
    );
    let towerLean = { x: 0, y: 0 };
    if (tower !== undefined) {
      const cx = q.lampPostM[0] > 0 ? tower.x1M : tower.x0M;
      const cy = q.lampPostM[1] > 0 ? tower.y1M : tower.y0M;
      const base = project(home, cx, 0, cy);
      const roof = project(home, cx, tower.heightM, cy);
      towerLean = { x: roof.x - base.x, y: roof.y - base.y };
    }
    const angle = (a: Px, b: Px): number =>
      Math.round(
        ((Math.acos((a.x * b.x + a.y * b.y) / (Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y))) * 180) /
          Math.PI) *
          10,
      ) / 10;
    const sameSense =
      Math.sign(lean.x) === Math.sign(towerLean.x) && Math.sign(lean.y) === Math.sign(towerLean.y);
    quadrants[q.name] = {
      lampPostM: q.lampPostM,
      model: match,
      sliceOffsetsPx: offsets,
      topLeanPx: lean,
      leanVsRadialDeg: angle(lean, radial),
      towerRoofCornerLeanPx: { x: Math.round(towerLean.x * 10) / 10, y: Math.round(towerLean.y * 10) / 10 },
      leanVsTowerDeg: angle(lean, towerLean),
      sameSenseAsTower: sameSense,
      radialGapsPx: radialGaps(home, q.lampPostM, model),
    };
    check(match.pixels > 150, `${q.name}: the model has only ${match.pixels} lamp pixels`);
    check(
      match.mismatched === 0,
      `${q.name}: ${match.mismatched} of ${match.pixels} lamp pixels differ from the model`,
    );
    check(angle(lean, radial) < 0.5, `${q.name}: the stack does not lean along the radial`);
    check(sameSense, `${q.name}: the stack leans against its tower`);
    crops.push(crop(frame, Math.round(foot.x + lean.x / 2), Math.round(foot.y + lean.y / 2), 24, 8));
  }
  report.quadrants = quadrants;
  await writeFile(`${OUT_DIR}/lamps_8x.png`, encodeRgbaPng(strip(crops)));

  // --- 5. centred camera over each lamp post ---------------------------------------------------------------------
  const centred: Record<string, unknown> = {};
  for (const q of LEAN_QUADRANTS) {
    const cam: Camera = { x: q.lampPostM[0], y: q.lampPostM[1], h: SWEEP_HEIGHT_M };
    await page.evaluate(({ x, y, h }) => window.__ssp?.setCamera(x, y, h), cam);
    const f = await readFrame(page);
    const { anchors } = sliceAnchors(cam, q.lampPostM);
    const first = anchors[0] ?? { x: 0, y: 0 };
    const maxOffset = Math.max(
      ...anchors.map((a) => Math.max(Math.abs(a.x - first.x), Math.abs(a.y - first.y))),
    );
    const model = modelStack(cam, q.lampPostM);
    const match = compare(f, model);
    const shifted = compare(f, modelStack(cam, q.lampPostM, { slice: 2, px: 1 }));
    centred[q.name] = {
      anchorPx: first,
      maxSliceOffsetPx: maxOffset,
      model: match,
      modelWithSlice2Shifted1px: shifted,
    };
    check(maxOffset === 0, `${q.name} centred: slices offset by up to ${maxOffset} px`);
    check(
      match.mismatched === 0,
      `${q.name} centred: ${match.mismatched} of ${match.pixels} pixels differ from the model`,
    );
    check(shifted.mismatched > 0, `${q.name} centred: the model check is not discriminating`);
    if (q.name === 'ne') {
      await writeFile(`${OUT_DIR}/centred_ne_1x.png`, encodeRgbaPng({ width: W, height: H, data: f }));
      await writeFile(`${OUT_DIR}/centred_ne_8x.png`, encodeRgbaPng(crop(f, W / 2, H / 2, 16, 8)));
    }
  }
  report.centred = centred;

  // --- 6. near the side edge: slice-count evidence ----------------------------------------------------------------
  const ne = LEAN_QUADRANTS.find((q) => q.name === 'ne');
  if (ne === undefined) throw new Error('no ne quadrant');
  const edgeCam: Camera = { x: ne.lampPostM[0] - 12.5, y: ne.lampPostM[1] + 5, h: SWEEP_HEIGHT_M };
  await page.evaluate(({ x, y, h }) => window.__ssp?.setCamera(x, y, h), edgeCam);
  const edge = await readFrame(page);
  const edgeModel = modelStack(edgeCam, ne.lampPostM);
  const edgeMatch = compare(edge, edgeModel);
  const edgeFoot = project(edgeCam, ne.lampPostM[0], 0, ne.lampPostM[1]);
  const edgeLean = sliceAnchors(edgeCam, ne.lampPostM);
  report.edge = {
    camera: edgeCam,
    footPx: { x: Math.round(edgeFoot.x * 10) / 10, y: Math.round(edgeFoot.y * 10) / 10 },
    sliceOffsetsPx: edgeLean.offsets,
    model: edgeMatch,
    radialGapsPx: radialGaps(edgeCam, ne.lampPostM, edgeModel),
  };
  check(
    edgeMatch.mismatched === 0,
    `edge: ${edgeMatch.mismatched} of ${edgeMatch.pixels} pixels differ from the model`,
  );
  await writeFile(`${OUT_DIR}/edge_ne_1x.png`, encodeRgbaPng({ width: W, height: H, data: edge }));
  const top = edgeLean.offsets[edgeLean.offsets.length - 1] ?? { x: 0, y: 0 };
  await writeFile(
    `${OUT_DIR}/edge_ne_8x.png`,
    encodeRgbaPng(crop(edge, Math.round(edgeFoot.x + top.x / 2), Math.round(edgeFoot.y + top.y / 2), 28, 8)),
  );

  report.consoleErrors = consoleErrors;
  check(consoleErrors.length === 0, `${consoleErrors.length} console errors`);
} finally {
  await browser.close();
  await new Promise<void>((resolve) => server.httpServer.close(() => resolve()));
}

report.failures = failures;
console.log(JSON.stringify(report, null, 2));
process.exitCode = failures.length === 0 ? 0 : 1;
