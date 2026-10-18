// Manual check and evidence for SSP-021 (night[32] / shadow[32] tuning, D-05 and D-06) against the SHIPPING
// bundle. Not part of `npm test`: it needs Playwright's Chromium (`npx playwright install chromium`).
// Run with `node tools/spikes/nightShadowFrame.ts` (after `npm run assets`).
//
// 1. `vite build` + `vite preview`, headless Chromium with the visual-test flags (--use-angle=swiftshader
//    --enable-unsafe-swiftshader) at 1920x1080 (W = 480, 4x). An init script counts WebGL draw calls.
// 2. `/?test=1&scene=lean_quadrants&freeze=1` (day) and the same with `&night=1`: one `__ssp.step(0)` each;
//    day draws 7 calls, night 8 (the light pools are the fx slot), both <= 10 (TECHNICAL_DESIGN §12.7).
// 3. Both frames hold only Kerbside-32 colours. Every day pixel p of index i shows, at night, either i itself
//    (lit, or night[i] = i), night[i], shadow[night[i]] or shadow[i]: the frames differ only through the remaps.
// 4. Light: a pixel is LIT when its night colour equals its day colour while night[day] != day (only the light
//    mask can keep such a pixel); the lit pixels must include every pixel of the four light pools that the CPU
//    model (lightPools.ts inLightPool) puts on open ground, and the lamp heads.
// 5. Bessie: under night, the night remap of her body colour (15 sweeper_yellow -> night[15]) must have the
//    highest OKLab L of every colour class among the NON-lit pixels; the report lists each class with its L and
//    pixel count, and the number of unlit Bessie body pixels (> 0).
// 6. Shadow swatches: for every ground type of the spike grid (02 asphalt, 05 slab, 06 kerb, 22 grass), the open
//    ground pixels of that type show both the plain and the shadowed colour (day: g / shadow[g]; night outside
//    the pools: night[g] / shadow[night[g]]), with their OKLab L difference.
// 7. No console errors.
// Exits non-zero on any failure and prints a JSON report. Evidence goes to build/spikes/night-shadow/ (or
// $SSP_NIGHT_OUT): day_1x.png, night_1x.png (readFrame, 480x270), day_3x.png / night_3x.png (nearest 3x for
// review), and swatches_4x.png (day above night, 4x crops of the shadowed swatches).
import { mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { chromium, type Page } from '@playwright/test';
import { build, preview } from 'vite';
import { roofMagnification, SWEEP_HEIGHT_M } from '../../src/render/camera.ts';
import { CELL_M, GroundType, mergeBoxes, parseCityGrid } from '../../src/render/cityMesh.ts';
import { inLightPool, LIGHT_POOL_RADIUS_M, lightPoolAnchorPx } from '../../src/render/lightPools.ts';
import { KERBSIDE32, PALETTE_SIZE, paletteOklab } from '../../src/render/palettePass.ts';
import type { RgbaImage } from '../../src/render/spriteAtlas.ts';
import { LAMP_POST_STACK } from '../../src/render/spriteStack.ts';
import { INTERNAL_HEIGHT_PX } from '../../src/render/upscale.ts';
import {
  LEAN_QUADRANTS,
  LEAN_QUADRANTS_ORIGIN_M,
  LEAN_QUADRANTS_ROWS,
} from '../../src/scenes/LeanQuadrantsScene.ts';
import { PX_PER_M } from '../../src/sim/constants.ts';
import { encodeRgbaPng } from '../../tests/support/png.ts';

const W = 480;
const H = INTERNAL_HEIGHT_PX;
const SWIFTSHADER_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const OUT_DIR = process.env.SSP_NIGHT_OUT ?? 'build/spikes/night-shadow';
mkdirSync(OUT_DIR, { recursive: true });

const failures: string[] = [];
const report: Record<string, unknown> = {};
function check(ok: boolean, message: string): void {
  if (!ok) failures.push(message);
}

const { night, shadow, rgb, names } = KERBSIDE32;
const LAB = paletteOklab();
const L = (i: number): number => Math.round((LAB[i * 3] ?? 0) * 10000) / 10000;
const BESSIE_BODY = 15;

/** Palette index of every pixel (throws on a non-palette colour). */
function indexFrame(frame: Uint8Array): Uint8Array {
  const lookup = new Map<number, number>();
  for (let i = 0; i < PALETTE_SIZE; i++)
    lookup.set(((rgb[i * 3] ?? 0) << 16) | ((rgb[i * 3 + 1] ?? 0) << 8) | (rgb[i * 3 + 2] ?? 0), i);
  const out = new Uint8Array(W * H);
  for (let p = 0; p < W * H; p++) {
    const key = ((frame[p * 4] ?? 0) << 16) | ((frame[p * 4 + 1] ?? 0) << 8) | (frame[p * 4 + 2] ?? 0);
    const index = lookup.get(key);
    if (index === undefined || frame[p * 4 + 3] !== 255) {
      throw new Error(`pixel ${p % W},${Math.floor(p / W)} is not a Kerbside-32 colour`);
    }
    out[p] = index;
  }
  return out;
}

function scale(frame: Uint8Array, width: number, height: number, k: number): Uint8Array {
  const out = new Uint8Array(width * k * height * k * 4);
  for (let y = 0; y < height * k; y++)
    for (let x = 0; x < width * k; x++) {
      const s = (Math.floor(y / k) * width + Math.floor(x / k)) * 4;
      out.set(frame.subarray(s, s + 4), (y * width * k + x) * 4);
    }
  return out;
}

/** Ground metres of the centre of internal pixel (px, py), camera over the origin (the ground draws 1:1). */
const groundM = (px: number, py: number): [number, number] => [
  (px + 0.5 - W / 2) / PX_PER_M,
  (py + 0.5 - H / 2) / PX_PER_M,
];

const grid = parseCityGrid(LEAN_QUADRANTS_ROWS, LEAN_QUADRANTS_ORIGIN_M[0], LEAN_QUADRANTS_ORIGIN_M[1]);
/** What each block covers on screen, in ground metres: the bounding box of its footprint and its magnified roof. */
const covers = mergeBoxes(grid).map((box) => {
  const m = roofMagnification(SWEEP_HEIGHT_M, box.heightM);
  return {
    x0: Math.min(box.x0M, box.x0M * m),
    y0: Math.min(box.y0M, box.y0M * m),
    x1: Math.max(box.x1M, box.x1M * m),
    y1: Math.max(box.y1M, box.y1M * m),
  };
});
/** Each lamp post's leaning stack on screen, in ground metres: from its foot to its magnified top slice. */
const stacks = LEAN_QUADRANTS.map((q) => {
  const top = LAMP_POST_STACK.slices[LAMP_POST_STACK.slices.length - 1]?.heightM ?? 0;
  const m = roofMagnification(SWEEP_HEIGHT_M, top);
  return { x0: q.lampPostM[0], y0: q.lampPostM[1], x1: q.lampPostM[0] * m, y1: q.lampPostM[1] * m };
});
/** Half-width of the area a stack may cover around its lean line, metres (the 15 px crossbar, magnified). */
const STACK_HALF_M = 1;
function nearStack(x: number, y: number): boolean {
  return stacks.some((s) => {
    const dx = s.x1 - s.x0;
    const dy = s.y1 - s.y0;
    const t = Math.max(0, Math.min(1, ((x - s.x0) * dx + (y - s.y0) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(x - (s.x0 + t * dx), y - (s.y0 + t * dy)) <= STACK_HALF_M;
  });
}

/**
 * Ground type of the open cell under pixel (px, py) (the asphalt skirt off the grid), or -1 for a building cell
 * or a pixel a block's walls or roof, or a lamp post, may cover on screen.
 */
function groundTypeAt(px: number, py: number): number {
  const [x, y] = groundM(px, py);
  if (covers.some((r) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1)) return -1;
  if (nearStack(x, y)) return -1;
  const c = Math.floor((x - grid.originXM) / CELL_M);
  const r = Math.floor((y - grid.originYM) / CELL_M);
  if (c < 0 || r < 0 || c >= grid.cols || r >= grid.rows) return GroundType.Asphalt;
  const i = r * grid.cols + c;
  return (grid.storeys[i] ?? 0) > 0 ? -1 : (grid.ground[i] ?? -1);
}

/** Nearest-neighbour crop of `frame` around (cx, cy), `half` px each way, scaled by `k`, with a 1 px ink gap. */
function crop(frame: Uint8Array, cx: number, cy: number, half: number, k: number): RgbaImage {
  const size = half * 2;
  const out = new Uint8Array(size * k * size * k * 4);
  for (let y = 0; y < size * k; y++)
    for (let x = 0; x < size * k; x++) {
      const sx = Math.min(W - 1, Math.max(0, Math.floor(cx - half + x / k)));
      const sy = Math.min(H - 1, Math.max(0, Math.floor(cy - half + y / k)));
      out.set(frame.subarray((sy * W + sx) * 4, (sy * W + sx) * 4 + 4), (y * size * k + x) * 4);
    }
  return { width: size * k, height: size * k, data: out };
}

/** Images side by side (`horizontal`) or stacked, top/left aligned, on ink. */
function join(images: RgbaImage[], horizontal: boolean): RgbaImage {
  const gap = 4;
  const width = horizontal
    ? images.reduce((s, i) => s + i.width + gap, -gap)
    : Math.max(...images.map((i) => i.width));
  const height = horizontal
    ? Math.max(...images.map((i) => i.height))
    : images.reduce((s, i) => s + i.height + gap, -gap);
  const data = new Uint8Array(width * height * 4);
  for (let p = 0; p < width * height; p++) data.set([rgb[0] ?? 0, rgb[1] ?? 0, rgb[2] ?? 0, 255], p * 4);
  let o = 0;
  for (const img of images) {
    for (let y = 0; y < img.height; y++) {
      const row = img.data.subarray(y * img.width * 4, (y + 1) * img.width * 4);
      data.set(row, horizontal ? (y * width + o) * 4 : (o + y) * width * 4);
    }
    o += (horizontal ? img.width : img.height) + gap;
  }
  return { width, height, data };
}

/** Whether the CPU model puts pixel (px, py) inside any lamp's light pool. */
function inAnyPool(px: number, py: number): boolean {
  const gx = px - W / 2;
  const gy = py - H / 2;
  const r = Math.round(LIGHT_POOL_RADIUS_M * PX_PER_M);
  return LEAN_QUADRANTS.some((q) =>
    inLightPool(gx, gy, lightPoolAnchorPx(q.lampPostM[0]), lightPoolAnchorPx(q.lampPostM[1]), r),
  );
}

async function readFrame(page: Page): Promise<Uint8Array> {
  const bytes = await page.evaluate(() => {
    const api = window.__ssp;
    if (api === undefined) throw new Error('__ssp missing');
    return Array.from(api.readFrame());
  });
  return Uint8Array.from(bytes);
}

async function drawCallsOfOneFrame(page: Page): Promise<number> {
  return page.evaluate(() => {
    const w = window as unknown as { __sspDrawCalls: number; __ssp?: { step(n: number): void } };
    w.__sspDrawCalls = 0;
    w.__ssp?.step(0);
    return w.__sspDrawCalls;
  });
}

const GROUND_INDEX: Record<number, number> = {
  [GroundType.Asphalt]: 2,
  [GroundType.Slab]: 5,
  [GroundType.Kerb]: 6,
  [GroundType.Grass]: 22,
};

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

  const frames: Record<string, Uint8Array> = {};
  for (const [tag, query, expectedCalls] of [
    ['day', '', 7],
    ['night', '&night=1', 8],
  ] as const) {
    await page.goto(`${url}?test=1&scene=lean_quadrants&freeze=1${query}`);
    await page.waitForFunction(() => window.__ssp?.ready === true, undefined, { timeout: 30_000 });
    const calls = await drawCallsOfOneFrame(page);
    report[`${tag}DrawCalls`] = calls;
    check(calls === expectedCalls && calls <= 10, `${tag}: ${calls} draw calls, expected ${expectedCalls}`);
    const frame = await readFrame(page);
    frames[tag] = frame;
    await writeFile(`${OUT_DIR}/${tag}_1x.png`, encodeRgbaPng({ width: W, height: H, data: frame }));
    await writeFile(
      `${OUT_DIR}/${tag}_3x.png`,
      encodeRgbaPng({ width: W * 3, height: H * 3, data: scale(frame, W, H, 3) }),
    );
  }

  const dayFrame = frames.day ?? new Uint8Array();
  const nightFrame = frames.night ?? new Uint8Array();
  const day = indexFrame(dayFrame);
  const nite = indexFrame(nightFrame);

  // --- 3 + 4. remap consistency and the light classification -----------------------------------------------
  // A day pixel of index d came from some source colour s, unshadowed (d = s) or shadowed (d = shadow[s]). At
  // night it shows d again when lit, or night[s] / shadow[night[s]] when not. A pixel is LIT when it kept its
  // day colour and no consistent (s, shadowed) reading would give that colour unlit; it is UNLIT when its colour
  // changed. Pixels whose every reading keeps the colour (night-invariant, e.g. 00 ink) count as unlit classes.
  let inconsistent = 0;
  const lit = new Uint8Array(W * H);
  for (let p = 0; p < W * H; p++) {
    const d = day[p] ?? 0;
    const n = nite[p] ?? 0;
    let consistent = false;
    let unlitCanKeep = false;
    for (let src = 0; src < PALETTE_SIZE; src++) {
      const ns = night[src] ?? src;
      for (const shadowed of [false, true]) {
        const dayIdx = shadowed ? (shadow[src] ?? src) : src;
        if (dayIdx !== d) continue;
        const unlit = shadowed ? (shadow[ns] ?? ns) : ns;
        if (n === d || n === unlit) consistent = true;
        if (unlit === d) unlitCanKeep = true;
      }
    }
    if (!consistent) inconsistent++;
    if (n === d && !unlitCanKeep) lit[p] = 1;
  }
  report.remapInconsistentPixels = inconsistent;
  check(inconsistent === 0, `${inconsistent} night pixels are not a remap of their day colour`);
  // Every open-ground pixel the CPU model puts in a pool must keep its day colour (unless that colour is
  // night-invariant), and no open-ground pixel outside the pools may.
  let poolPixelsOnOpenGround = 0;
  let poolPixelsLit = 0;
  let litTotal = 0;
  let litInPoolsNotGround = 0;
  let litOutsidePools = 0;
  let groundLitOutsidePools = 0;
  for (let py = 0; py < H; py++)
    for (let px = 0; px < W; px++) {
      const p = py * W + px;
      const d = day[p] ?? 0;
      const inPool = inAnyPool(px, py);
      const g = groundTypeAt(px, py);
      const gi = g < 0 ? -1 : (GROUND_INDEX[g] ?? -1);
      const isGround = gi >= 0 && (d === gi || d === shadow[gi]);
      if (lit[p] === 1) {
        litTotal++;
        if (!inPool) litOutsidePools++;
        else if (!isGround) litInPoolsNotGround++;
      }
      if (!isGround) continue;
      const unlitPlain = night[gi] ?? gi;
      const unlit = d === gi ? unlitPlain : (shadow[unlitPlain] ?? unlitPlain);
      if (unlit === d) continue;
      if (!inPool) {
        if (nite[p] === d) groundLitOutsidePools++;
        continue;
      }
      poolPixelsOnOpenGround++;
      // The source is known here (this ground type), so "kept its day colour" means lit.
      if (nite[p] === d) poolPixelsLit++;
    }
  report.lightPools = {
    radiusM: LIGHT_POOL_RADIUS_M,
    modelPoolPixelsOnOpenGround: poolPixelsOnOpenGround,
    litOfThose: poolPixelsLit,
    openGroundLitOutsidePools: groundLitOutsidePools,
  };
  check(
    poolPixelsOnOpenGround > 0 && poolPixelsLit === poolPixelsOnOpenGround,
    `light pools: ${poolPixelsLit} of ${poolPixelsOnOpenGround} model pool pixels are lit`,
  );
  check(groundLitOutsidePools === 0, `${groundLitOutsidePools} open-ground pixels are lit outside the pools`);
  // Lit pixels outside the model pools can only be lamp heads (slices lean outward past the pool edge); inside
  // the pools, lit non-ground pixels are the flat actors standing in the light and the lamp heads.
  report.litPixels = {
    total: litTotal,
    actorsAndLampHeadsInPools: litInPoolsNotGround,
    outsidePools: litOutsidePools,
  };

  // --- 5. Bessie the brightest non-light object ---------------------------------------------------------------
  const classes = new Map<number, number>();
  let bessieUnlit = 0;
  for (let p = 0; p < W * H; p++) {
    if (lit[p] === 1) continue;
    const n = nite[p] ?? 0;
    classes.set(n, (classes.get(n) ?? 0) + 1);
    if (day[p] === BESSIE_BODY && n === night[BESSIE_BODY]) bessieUnlit++;
  }
  const bessieNight = night[BESSIE_BODY] ?? BESSIE_BODY;
  const unlitClasses = [...classes.entries()]
    .sort((a, b) => L(b[0]) - L(a[0]))
    .map(([i, count]) => ({ index: i, name: names[i], L: L(i), pixels: count }));
  const brightest = unlitClasses[0];
  const runnerUp = unlitClasses.find((c) => c.index !== bessieNight);
  report.bessieAtNight = {
    bodyNightIndex: bessieNight,
    bodyNightName: names[bessieNight],
    bodyNightL: L(bessieNight),
    unlitBodyPixels: bessieUnlit,
    brightestOtherUnlitClass: runnerUp,
    marginL: runnerUp === undefined ? null : Math.round((L(bessieNight) - runnerUp.L) * 10000) / 10000,
    unlitClasses,
  };
  check(bessieUnlit > 0, 'no unlit Bessie body pixel in the night frame');
  check(
    brightest?.index === bessieNight && (runnerUp === undefined || runnerUp.L < L(bessieNight)),
    `the brightest unlit class is ${brightest?.name} (L ${brightest?.L}), not Bessie's night body colour`,
  );

  // --- 6. shadow swatches ---------------------------------------------------------------------------------------
  const swatches: Record<string, unknown> = {};
  for (const [typeName, type] of Object.entries(GroundType)) {
    const g = GROUND_INDEX[type] ?? -1;
    const tally = { dayPlain: 0, dayShadowed: 0, nightPlain: 0, nightShadowed: 0, nightLit: 0 };
    for (let py = 0; py < H; py++)
      for (let px = 0; px < W; px++) {
        if (groundTypeAt(px, py) !== type) continue;
        const p = py * W + px;
        const i = day[p];
        const n = nite[p];
        if (i === g) tally.dayPlain++;
        else if (i === shadow[g]) tally.dayShadowed++;
        else continue; // an actor, wall or roof covers this ground pixel
        if (lit[p] === 1) tally.nightLit++;
        else if (n === night[g]) tally.nightPlain++;
        else if (n === shadow[night[g] ?? g]) tally.nightShadowed++;
      }
    const ng = night[g] ?? g;
    const sg = shadow[g] ?? g;
    const sng = shadow[ng] ?? ng;
    swatches[typeName] = {
      day: `${g} ${names[g]} (L ${L(g)}) -> shadow ${sg} ${names[sg]} (L ${L(sg)}), dL ${Math.round((L(g) - L(sg)) * 1000) / 1000}`,
      night: `${ng} ${names[ng]} (L ${L(ng)}) -> shadow ${sng} ${names[sng]} (L ${L(sng)}), dL ${Math.round((L(ng) - L(sng)) * 1000) / 1000}`,
      pixels: tally,
    };
    check(tally.dayPlain > 0 && tally.dayShadowed > 0, `${typeName}: no plain or no shadowed day pixel`);
    check(
      tally.nightPlain > 0 && tally.nightShadowed > 0,
      `${typeName}: no plain or no shadowed unlit night pixel`,
    );
  }
  report.swatches = swatches;

  // --- evidence crops: each quadrant's pedestrian (drop shadow on 05 / 06 / 22 / 05) and Bessie, day | night --
  const px = (m: number, centre: number): number => Math.round(centre + m * PX_PER_M);
  const rows: RgbaImage[] = [];
  for (const q of LEAN_QUADRANTS) {
    const ped = [px(q.pedestrianM[0], W / 2), px(q.pedestrianM[1] - 0.6, H / 2)] as const;
    const bes = [px(q.bessieM[0], W / 2), px(q.bessieM[1], H / 2)] as const;
    // Halfway up the leaning stack: the top slice shows at the foot magnified about the screen centre.
    const lean = (1 + roofMagnification(SWEEP_HEIGHT_M, 4.4)) / 2;
    const lamp = [px(q.lampPostM[0] * lean, W / 2), px(q.lampPostM[1] * lean, H / 2)] as const;
    rows.push(
      join(
        [
          crop(dayFrame, ped[0], ped[1], 20, 6),
          crop(nightFrame, ped[0], ped[1], 20, 6),
          crop(dayFrame, bes[0], bes[1], 36, 4),
          crop(nightFrame, bes[0], bes[1], 36, 4),
          crop(dayFrame, lamp[0], lamp[1], 20, 6),
          crop(nightFrame, lamp[0], lamp[1], 20, 6),
        ],
        true,
      ),
    );
  }
  await writeFile(`${OUT_DIR}/crops.png`, encodeRgbaPng(join(rows, false)));

  report.consoleErrors = consoleErrors;
  check(consoleErrors.length === 0, `${consoleErrors.length} console errors`);
} finally {
  await browser.close();
  await new Promise<void>((resolve) => server.httpServer.close(() => resolve()));
}

report.failures = failures;
await writeFile(`${OUT_DIR}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
process.exitCode = failures.length === 0 ? 0 : 1;
