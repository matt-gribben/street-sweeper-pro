// Evidence for SSP-047's re-judgement of D-01 (speed zoom on or off, ROADMAP §8): the M0 decision was made on
// flat placeholder ground with a panned camera; its revisit trigger asks M1 to judge again with procedural asphalt
// and real driving, including cruising at 6–11 m/s, which holds the camera at partial zoom. Not part of
// `npm test`: it needs Playwright's Chromium. Run with `node tools/spikes/cameraDriveJudge.ts` (after
// `npm run assets`); it builds the shipping bundle and serves it with `vite preview` itself.
//
// Every frame comes from `?test=1&scene=district.puddle_lane&freeze=1&springs=1` (the live follow camera:
// look-ahead and speed zoom on, fixed 1/60 s frames) on headless SwiftShader at 1920×1080 (W = 480), stepped one
// tick at a time with `__ssp.step(1)` while the keyboard drives Bessie. A small waypoint follower (pure pursuit on
// the keyboard's digital steer, bang-bang throttle/brake) drives the same route twice: out of the depot, north up
// the x = 7 m road, right onto the long east–west road at y = 45 m and east along it.
//
//   sweep    brush down: top speed 6.0 m/s, so H stays 31.5 m (the 1:1 baseline);
//   cruise   brush up, cruising at 8.5 m/s on the east–west road: the camera sits at about 50% zoom
//            (H ≈ 34.65 m), the case M0 measured as the most sprite variants;
//   transit  brush up, flat out east: H climbs towards 37.8 m.
//
// Per frame: H, speed and "ground crawl": among pixels showing open ground (not a building's projected walls or
// roof, not Bessie's 96×96 square) in both frames, those the best whole-pixel scroll (dx, dy in −4..4) of the
// previous frame does not explain. At 1:1 the snapped camera scrolls the ground rigidly, so this is ~0 (the only
// exceptions are a few pixels on building-shadow edges, which are not on the texel grid and sit on a 15.995 px/m
// ground, so an edge pixel near a tie can flip); zoomed, it is the resampling shimmer of the procedural asphalt,
// kerbs, markings and pavement. Also Bessie's own pixels on the straight: her sweeper-yellow (15) and ink (00)
// counts in a 60×36 window on her projected anchor (the road there has no 15), and how many distinct yellow counts
// 60 frames show: 1 means her body is drawn identically. (The ink count also catches the brush discs' outline at
// the window edge, so it is reported but not judged.)
//
// Evidence PNGs go to build/spikes/camera-drive/ (or $SSP_CAMERA_OUT) with report.json. Exits non-zero only if the
// 1:1 baseline is not rigid (a camera bug: mean ground crawl of 1 px/frame or more, or Bessie's body changing) or
// the look-ahead exceeds 3.0 m; the on/off call itself is a judgement recorded in ROADMAP §8 D-01.
import { mkdirSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { chromium, type Page } from '@playwright/test';
import { build, preview } from 'vite';
import type { ShiftTestState, TestState } from '../../src/debug/testHooks.ts';
import { groundPxPerMetre, SWEEP_HEIGHT_M, snapToTexelM } from '../../src/render/camera.ts';
import { type CityBox, mergeBoxes } from '../../src/render/cityMesh.ts';
import { KERBSIDE32, PALETTE_SIZE } from '../../src/render/palettePass.ts';
import { INTERNAL_HEIGHT_PX } from '../../src/render/upscale.ts';
import { decodeLevel } from '../../src/sim/map.ts';
import { encodeRgbaPng } from '../../tests/support/png.ts';

const OUT_DIR = process.env.SSP_CAMERA_OUT ?? 'build/spikes/camera-drive';
mkdirSync(OUT_DIR, { recursive: true });
const SWIFTSHADER_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const H = INTERNAL_HEIGHT_PX;
const W = 480;
/** Bessie's evidence window (px), and the square kept out of the ground-crawl mask (body, brush, drop shadow). */
const BESSIE_WIN = 72;
const BESSIE_MASK = 96;
/** Her body window heading east (52 px long, 28 wide plus outline), where her ink and yellow are counted. */
const BODY_W = 60;
const BODY_H = 36;
const INK = 0;
const SWEEPER_YELLOW = 15;
const GUTTER = 7;
const failures: string[] = [];
const report: Record<string, unknown> = {};
const evidence: string[] = [];
const r2 = (v: number): number => Math.round(v * 100) / 100;

const level = decodeLevel(JSON.parse(readFileSync('public/assets/levels/puddle_lane.json', 'utf8')));
const [cols, rows] = level.size;
const boxes: CityBox[] = mergeBoxes({
  cols,
  rows,
  originXM: 0,
  originYM: 0,
  storeys: level.layers.storeys,
  wall: level.layers.wall,
  roof: level.layers.roof,
});

// --- Frames --------------------------------------------------------------------------------------------------------

type IndexFrame = { width: number; height: number; px: Int16Array };
const paletteIndexOf = new Map<number, number>();
for (let i = 0; i < PALETTE_SIZE; i++) {
  const rgb = KERBSIDE32.rgb;
  paletteIndexOf.set(((rgb[i * 3] ?? 0) << 16) | ((rgb[i * 3 + 1] ?? 0) << 8) | (rgb[i * 3 + 2] ?? 0), i);
}

async function readFrame(page: Page): Promise<IndexFrame> {
  const base64 = await page.evaluate(() => {
    const data = window.__ssp?.readFrame();
    if (data === undefined) throw new Error('__ssp missing');
    let binary = '';
    for (let i = 0; i < data.length; i += 0x8000)
      binary += String.fromCharCode(...data.subarray(i, i + 0x8000));
    return btoa(binary);
  });
  const rgba = Buffer.from(base64, 'base64');
  const width = rgba.length / 4 / H;
  const px = new Int16Array(width * H);
  for (let p = 0; p < px.length; p++) {
    px[p] =
      paletteIndexOf.get(
        ((rgba[p * 4] ?? 0) << 16) | ((rgba[p * 4 + 1] ?? 0) << 8) | (rgba[p * 4 + 2] ?? 0),
      ) ?? -1;
  }
  return { width, height: H, px };
}

const at = (f: IndexFrame, x: number, y: number): number =>
  x < 0 || y < 0 || x >= f.width || y >= f.height ? GUTTER : (f.px[y * f.width + x] ?? GUTTER);

function crop(f: IndexFrame, x0: number, y0: number, w: number, h: number): IndexFrame {
  const px = new Int16Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px[y * w + x] = at(f, x0 + x, y0 + y);
  return { width: w, height: h, px };
}

function upscale(f: IndexFrame, s: number): IndexFrame {
  const w = f.width * s;
  const h = f.height * s;
  const px = new Int16Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) px[y * w + x] = f.px[Math.floor(y / s) * f.width + Math.floor(x / s)] ?? 0;
  return { width: w, height: h, px };
}

function stack(frames: IndexFrame[], horizontal: boolean, gap = 4): IndexFrame {
  const w = horizontal
    ? frames.reduce((s, f) => s + f.width, 0) + gap * (frames.length - 1)
    : Math.max(...frames.map((f) => f.width));
  const h = horizontal
    ? Math.max(...frames.map((f) => f.height))
    : frames.reduce((s, f) => s + f.height, 0) + gap * (frames.length - 1);
  const px = new Int16Array(w * h).fill(GUTTER);
  let o = 0;
  for (const f of frames) {
    for (let y = 0; y < f.height; y++)
      px.set(f.px.subarray(y * f.width, (y + 1) * f.width), horizontal ? y * w + o : (o + y) * w);
    o += (horizontal ? f.width : f.height) + gap;
  }
  return { width: w, height: h, px };
}

async function savePng(name: string, f: IndexFrame): Promise<void> {
  const data = new Uint8Array(f.px.length * 4);
  for (let p = 0; p < f.px.length; p++) {
    const i = f.px[p] ?? 0;
    data[p * 4] = KERBSIDE32.rgb[i * 3] ?? 255;
    data[p * 4 + 1] = KERBSIDE32.rgb[i * 3 + 1] ?? 0;
    data[p * 4 + 2] = KERBSIDE32.rgb[i * 3 + 2] ?? 255;
    data[p * 4 + 3] = 255;
  }
  const path = `${OUT_DIR}/${name}`;
  await writeFile(path, encodeRgbaPng({ width: f.width, height: f.height, data }));
  evidence.push(path);
}

// --- Camera model --------------------------------------------------------------------------------------------------

type View = { camX: number; camY: number; h: number };
const viewOf = (s: ShiftTestState): View => ({
  camX: snapToTexelM(s.camera.x),
  camY: snapToTexelM(s.camera.y),
  h: s.camera.h,
});

/** Internal-pixel position of a ground point (sim metres) under `view` (top-left origin, fractional). */
function groundPx(view: View, xM: number, yM: number): { x: number; y: number } {
  const k = groundPxPerMetre(view.h);
  return { x: W / 2 + (xM - view.camX) * k, y: H / 2 + (yM - view.camY) * k };
}

/** 1 where the pixel shows open ground: outside every building's projected footprint+roof and Bessie's window. */
function groundMask(view: View, bessie: { x: number; y: number }): Uint8Array {
  const mask = new Uint8Array(W * H).fill(1);
  const k = groundPxPerMetre(view.h);
  for (const box of boxes) {
    const m = view.h / (view.h - box.heightM);
    const xs = [
      box.x0M,
      box.x1M,
      view.camX + (box.x0M - view.camX) * m,
      view.camX + (box.x1M - view.camX) * m,
    ];
    const ys = [
      box.y0M,
      box.y1M,
      view.camY + (box.y0M - view.camY) * m,
      view.camY + (box.y1M - view.camY) * m,
    ];
    const x0 = Math.floor(W / 2 + (Math.min(...xs) - view.camX) * k) - 1;
    const x1 = Math.ceil(W / 2 + (Math.max(...xs) - view.camX) * k) + 1;
    const y0 = Math.floor(H / 2 + (Math.min(...ys) - view.camY) * k) - 1;
    const y1 = Math.ceil(H / 2 + (Math.max(...ys) - view.camY) * k) + 1;
    for (let y = Math.max(0, y0); y < Math.min(H, y1); y++)
      for (let x = Math.max(0, x0); x < Math.min(W, x1); x++) mask[y * W + x] = 0;
  }
  const b = groundPx(view, bessie.x, bessie.y);
  for (let y = Math.round(b.y) - BESSIE_MASK / 2; y < Math.round(b.y) + BESSIE_MASK / 2; y++)
    for (let x = Math.round(b.x) - BESSIE_MASK / 2; x < Math.round(b.x) + BESSIE_MASK / 2; x++)
      if (x >= 0 && y >= 0 && x < W && y < H) mask[y * W + x] = 0;
  return mask;
}

/** Ground crawl of `b` against `a`: unexplained ground pixels under the best whole-pixel scroll, and its mask. */
function groundCrawl(a: IndexFrame, ma: Uint8Array, b: IndexFrame, mb: Uint8Array) {
  let best = Number.POSITIVE_INFINITY;
  let bestShift = [0, 0];
  let considered = 0;
  for (let dy = -4; dy <= 4; dy++)
    for (let dx = -4; dx <= 4; dx++) {
      let n = 0;
      let c = 0;
      for (let y = 8; y < H - 8; y++)
        for (let x = 8; x < W - 8; x++) {
          const p = y * W + x;
          const q = (y - dy) * W + (x - dx);
          if (mb[p] !== 1 || ma[q] !== 1) continue;
          c++;
          if (b.px[p] !== a.px[q]) n++;
        }
      if (n < best) {
        best = n;
        bestShift = [dx, dy];
        considered = c;
      }
    }
  const mask = new Uint8Array(W * H);
  const [dx = 0, dy = 0] = bestShift;
  for (let y = 8; y < H - 8; y++)
    for (let x = 8; x < W - 8; x++) {
      const p = y * W + x;
      const q = (y - dy) * W + (x - dx);
      if (mb[p] === 1 && ma[q] === 1 && b.px[p] !== a.px[q]) mask[p] = 1;
    }
  return { crawl: best, considered, mask };
}

// --- Driving -------------------------------------------------------------------------------------------------------

async function state(page: Page): Promise<ShiftTestState> {
  const s = await page.evaluate((): TestState => {
    const api = window.__ssp;
    if (api === undefined) throw new Error('__ssp missing');
    return api.state();
  });
  if (!('bessie' in s)) throw new Error('not a shift');
  return s;
}

type Held = { W: boolean; S: boolean; A: boolean; D: boolean };
async function hold(page: Page, held: Held, want: Held): Promise<void> {
  for (const key of ['W', 'S', 'A', 'D'] as const) {
    if (held[key] === want[key]) continue;
    if (want[key]) await page.keyboard.down(`Key${key}`);
    else await page.keyboard.up(`Key${key}`);
    held[key] = want[key];
  }
}

/** Route: depot → north up x = 7 → right at the east–west road (y = 45) → east. Sim metres. */
const ROUTE: readonly [number, number][] = [
  [7, 80],
  [7, 52],
  [12, 45.5],
  [126, 45.5],
];
const PURSUIT_M = 6;

/** The pure-pursuit point: PURSUIT_M along the route past the closest point to (x, y). */
function pursuit(x: number, y: number): [number, number] {
  let best = Number.POSITIVE_INFINITY;
  let seg = 0;
  let t = 0;
  for (let i = 0; i + 1 < ROUTE.length; i++) {
    const [ax, ay] = ROUTE[i] ?? [0, 0];
    const [bx, by] = ROUTE[i + 1] ?? [0, 0];
    const len2 = (bx - ax) ** 2 + (by - ay) ** 2;
    const u = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / len2));
    const d = Math.hypot(ax + (bx - ax) * u - x, ay + (by - ay) * u - y);
    if (d < best) {
      best = d;
      seg = i;
      t = u;
    }
  }
  let remaining = PURSUIT_M;
  for (let i = seg; i + 1 < ROUTE.length; i++) {
    const [ax, ay] = ROUTE[i] ?? [0, 0];
    const [bx, by] = ROUTE[i + 1] ?? [0, 0];
    const len = Math.hypot(bx - ax, by - ay);
    const left = len * (1 - (i === seg ? t : 0));
    if (remaining <= left) {
      const u = (i === seg ? t : 0) + remaining / len;
      return [ax + (bx - ax) * u, ay + (by - ay) * u];
    }
    remaining -= left;
  }
  return ROUTE[ROUTE.length - 1] ?? [0, 0];
}

type Sample = {
  tick: number;
  x: number;
  y: number;
  heading: number;
  speed: number;
  h: number;
  lead: number;
  crawl: number;
  groundPx: number;
};

/** Where the straight measurement starts and stops (sim x, metres) and the evidence frame's x. */
const STRAIGHT_FROM_M = 30;
const STRAIGHT_TO_M = 110;
const EVIDENCE_AT_M = 70;
const ROUTE_END_X_M = 116;

type Run = {
  samples: Sample[];
  /** Bessie's (ink, yellow) pixel counts on the straight, in tick order; the first 8 windows kept as images. */
  bessieInk: number[];
  bessieYellow: number[];
  bessieStrip: IndexFrame[];
  /** The straight frame with the most ground crawl, and its crawl mask. */
  worst: { frame: IndexFrame; crawlMask: Uint8Array; crawl: number; tick: number } | null;
  /** The evidence frame (first straight frame past EVIDENCE_AT_M) with its view, Bessie's pose and crawl mask. */
  evidence: { frame: IndexFrame; view: View; drawn: { x: number; y: number }; crawlMask: Uint8Array } | null;
};

const isStraight = (s: { x: number; heading: number }): boolean =>
  s.x > STRAIGHT_FROM_M && s.x < STRAIGHT_TO_M && Math.abs(s.heading - Math.PI / 2) < 0.02;

/** Bessie's window in `frame`, aligned to her projected anchor. */
function bessieWindow(frame: IndexFrame, view: View, drawn: { x: number; y: number }): IndexFrame {
  const p = groundPx(view, drawn.x, drawn.y);
  return crop(
    frame,
    Math.round(p.x) - BESSIE_WIN / 2,
    Math.round(p.y) - BESSIE_WIN / 2,
    BESSIE_WIN,
    BESSIE_WIN,
  );
}

/** Count of palette index `idx` in Bessie's body window. */
function bodyCount(frame: IndexFrame, view: View, drawn: { x: number; y: number }, idx: number): number {
  const p = groundPx(view, drawn.x, drawn.y);
  const win = crop(frame, Math.round(p.x) - BODY_W / 2, Math.round(p.y) - BODY_H / 2, BODY_W, BODY_H);
  return win.px.reduce((n, v) => n + (v === idx ? 1 : 0), 0);
}

/**
 * Drives the route with the brush `brushDown`, cruising at `cruiseMps` once on the east–west road (turning at
 * 4 m/s), for at most `maxTicks`. Frames are read (and crawl measured) only once Bessie is near the straight.
 */
async function drive(page: Page, brushDown: boolean, cruiseMps: number, maxTicks: number): Promise<Run> {
  await page.goto(`${url}?test=1&seed=1&scene=district.puddle_lane&freeze=1&springs=1`);
  await page.waitForFunction(() => window.__ssp?.ready === true, undefined, { timeout: 60_000 });
  if (brushDown) await page.keyboard.press('Space');
  const held: Held = { W: false, S: false, A: false, D: false };
  const run: Run = {
    samples: [],
    bessieInk: [],
    bessieYellow: [],
    bessieStrip: [],
    evidence: null,
    worst: null,
  };
  let s = await state(page);
  let previous: { frame: IndexFrame; mask: Uint8Array } | null = null;
  for (let tick = 1; tick <= maxTicks; tick++) {
    const b = s.bessie;
    if (b.x > ROUTE_END_X_M) break;
    const [px, py] = pursuit(b.x, b.y);
    const want = Math.atan2(px - b.x, -(py - b.y));
    let err = want - b.heading;
    err -= 2 * Math.PI * Math.round(err / (2 * Math.PI));
    const onStraight = b.x > 16;
    const turning = !onStraight && b.y < 60;
    const target = turning ? 4 : onStraight ? cruiseMps : Math.min(cruiseMps, 6);
    await hold(page, held, {
      W: b.speed < target - 0.15,
      S: b.speed > target + 0.6,
      A: err < -0.04,
      D: err > 0.04,
    });
    // The pose drawn at alpha 0 after this step is the current sim pose (the previous tick's, once stepped).
    const drawn = { x: b.x, y: b.y };
    await page.evaluate(() => window.__ssp?.step(1));
    s = await state(page);
    const sample: Sample = {
      tick,
      x: s.bessie.x,
      y: s.bessie.y,
      heading: s.bessie.heading,
      speed: s.bessie.speed,
      h: s.camera.h,
      lead: Math.hypot(s.camera.leadX, s.camera.leadY),
      crawl: -1,
      groundPx: 0,
    };
    run.samples.push(sample);
    if (sample.x < STRAIGHT_FROM_M - 2) continue;
    const view = viewOf(s);
    const frame = await readFrame(page);
    const mask = groundMask(view, drawn);
    let crawlMask: Uint8Array | null = null;
    if (previous !== null) {
      const c = groundCrawl(previous.frame, previous.mask, frame, mask);
      sample.crawl = c.crawl;
      sample.groundPx = c.considered;
      crawlMask = c.mask;
    }
    previous = { frame, mask };
    if (!isStraight(sample) || sample.crawl < 0) continue;
    run.bessieInk.push(bodyCount(frame, view, drawn, INK));
    run.bessieYellow.push(bodyCount(frame, view, drawn, SWEEPER_YELLOW));
    if (run.bessieStrip.length < 8) run.bessieStrip.push(bessieWindow(frame, view, drawn));
    if (crawlMask !== null && (run.worst === null || sample.crawl > run.worst.crawl)) {
      run.worst = { frame, crawlMask, crawl: sample.crawl, tick };
    }
    if (run.evidence === null && sample.x >= EVIDENCE_AT_M && crawlMask !== null) {
      run.evidence = { frame, view, drawn, crawlMask };
    }
  }
  await hold(page, held, { W: false, S: false, A: false, D: false });
  return run;
}

/** Summary of the straight's samples. */
function straight(run: Run) {
  const xs = run.samples.filter((s) => s.crawl >= 0 && isStraight(s));
  const mean = (v: number[]): number =>
    v.length === 0 ? Number.NaN : v.reduce((a, b) => a + b, 0) / v.length;
  const range = (v: number[]) => ({ min: r2(Math.min(...v)), max: r2(Math.max(...v)) });
  return {
    frames: xs.length,
    speedMps: range(xs.map((s) => s.speed)),
    heightM: range(xs.map((s) => s.h)),
    leadM: range(xs.map((s) => s.lead)),
    maxLeadWholeRunM: r2(Math.max(...run.samples.map((s) => s.lead))),
    groundCrawlPxPerFrame: {
      mean: r2(mean(xs.map((s) => s.crawl))),
      max: Math.max(...xs.map((s) => s.crawl)),
    },
    groundCrawlPct: r2((100 * mean(xs.map((s) => s.crawl))) / mean(xs.map((s) => s.groundPx))),
    groundPxPerFrame: Math.round(mean(xs.map((s) => s.groundPx))),
    bessieInkPx: range(run.bessieInk.slice(0, 60)),
    bessieYellowPx: range(run.bessieYellow.slice(0, 60)),
    bessieDistinctYellowOver60: new Set(run.bessieYellow.slice(0, 60)).size,
    worstCrawlTick: run.worst?.tick ?? -1,
    totalTicks: run.samples.length,
  };
}

// --- Run -----------------------------------------------------------------------------------------------------------

await build({ logLevel: 'error' });
const server = await preview({ logLevel: 'error', preview: { port: 0, strictPort: false } });
const url = server.resolvedUrls?.local[0] ?? '';
if (url === '') throw new Error('vite preview did not report a URL');
const browser = await chromium.launch({ args: SWIFTSHADER_ARGS });
const consoleErrors: string[] = [];
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });

  const runs: [name: string, run: Run][] = [
    ['sweep', await drive(page, true, 5.9, 3600)],
    ['cruise', await drive(page, false, 8.5, 3600)],
    ['transit', await drive(page, false, 20, 3600)],
  ];
  const crops: IndexFrame[] = [];
  const strips: IndexFrame[] = [];
  for (const [name, run] of runs) {
    const sum = straight(run);
    report[name] = sum;
    if (name === 'sweep') {
      if (sum.heightM.max !== SWEEP_HEIGHT_M) failures.push(`sweep run left 31.5 m (max ${sum.heightM.max})`);
      if (!(sum.groundCrawlPxPerFrame.mean < 1))
        failures.push(`1:1 ground crawled (${sum.groundCrawlPxPerFrame.mean} px per frame on average)`);
      if (sum.bessieDistinctYellowOver60 !== 1)
        failures.push(`Bessie changed at 1:1 (${sum.bessieDistinctYellowOver60} yellow counts)`);
    }
    if (sum.maxLeadWholeRunM > 3) failures.push(`${name}: look-ahead reached ${sum.maxLeadWholeRunM} m`);
    if (run.bessieStrip.length > 0)
      strips.push(
        stack(
          run.bessieStrip.map((f) => upscale(f, 4)),
          true,
        ),
      );
    const ev = run.evidence;
    if (ev === null) {
      failures.push(`${name}: never reached the evidence point`);
      continue;
    }
    await savePng(`${name}_frame_1x.png`, ev.frame);
    const p = groundPx(ev.view, ev.drawn.x, ev.drawn.y);
    crops.push(upscale(crop(ev.frame, Math.round(p.x) - 60, Math.round(p.y) - 50, 200, 100), 4));
    const marked = Int16Array.from(ev.frame.px, (c, i) => (ev.crawlMask[i] === 1 ? 18 : c));
    await savePng(`${name}_crawl_2x.png`, upscale({ width: W, height: H, px: marked }, 2));
    const worst = run.worst;
    if (worst !== null && worst.crawl > 0) {
      const red = Int16Array.from(worst.frame.px, (c, i) => (worst.crawlMask[i] === 1 ? 18 : c));
      await savePng(`${name}_worst_crawl_2x.png`, upscale({ width: W, height: H, px: red }, 2));
    }
  }
  if (crops.length > 0) await savePng('road_sweep_cruise_transit_4x.png', stack(crops, false, 12));
  if (strips.length > 0) await savePng('bessie_sweep_cruise_transit_4x.png', stack(strips, false, 12));
  report.consoleErrors = consoleErrors;
  if (consoleErrors.length > 0) failures.push(`${consoleErrors.length} console errors`);
} finally {
  await browser.close();
  await new Promise<void>((resolve) => server.httpServer.close(() => resolve()));
}

report.evidence = evidence;
report.failures = failures;
await writeFile(`${OUT_DIR}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
process.exitCode = failures.length === 0 ? 0 : 1;
