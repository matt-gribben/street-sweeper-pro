// Manual dev-build check for SSP-017 (the spike city mesh and building shadows). Not part of `npm test`: it needs
// Playwright's Chromium (`npx playwright install chromium`). Run with `node tools/spikes/spikeCityFrame.ts`.
//
// 1. Starts the Vite dev server and opens it in headless Chromium with the visual-test flags
//    (--use-angle=swiftshader --enable-unsafe-swiftshader) at 1920x1080 (W = 480, 4x), camera over the origin.
// 2. Draw calls (renderer.info.render.calls over the whole frame, read from the dev panel): `?world=empty` gives
//    the baseline (palette pass + blit); the spike city must add exactly 2 (city mesh + building shadows). The
//    page uses `?actors=0` so the SSP-018 spike actors (tools/spikes/spriteBatchFrame.ts) stay out of the frame.
// 3. The frame: every canvas pixel is a Kerbside-32 colour; the 6-storey block in the top half shows its south
//    face, the 1-storey block on the left its east face (both `_dark` facade colours), the 3-storey block on the
//    right its west face (`_lit`), and the asphalt south-east of the 6-storey block is shadowed (shadow[02]).
//    Sample points are world points projected with the game's own camera rig.
// 4. No console errors.
// Exits non-zero on any failure and prints a JSON report; screenshots go to build/spikes/city-mesh/.
import { mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { chromium, type Page } from '@playwright/test';
import { Vector3 } from 'three';
import { createServer } from 'vite';
import { createCameraRig } from '../../src/render/camera.ts';
import { FACADE_ELEMENT_RAMPS, FacadeVariant, GROUND_COLOURS } from '../../src/render/cityMesh.ts';
import { KERBSIDE32, PALETTE_SIZE, paletteIndex } from '../../src/render/palettePass.ts';
import { INTERNAL_HEIGHT_PX } from '../../src/render/upscale.ts';

const VIEWPORT = { width: 1920, height: 1080 };
const INTERNAL_WIDTH_PX = 480;
const SCALE = 4;
const SWIFTSHADER_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const OUT_DIR = 'build/spikes/city-mesh';
mkdirSync(OUT_DIR, { recursive: true });

function paletteKey(index: number): number {
  const rgb = KERBSIDE32.rgb;
  return ((rgb[index * 3] ?? 0) << 16) | ((rgb[index * 3 + 1] ?? 0) << 8) | (rgb[index * 3 + 2] ?? 0);
}
const paletteKeys = Array.from({ length: PALETTE_SIZE }, (_, i) => paletteKey(i));
const indexOfKey = (key: number): number => paletteKeys.indexOf(key);

/** Palette indices a facade in `variant` can show (brick, stone, frame, glass). */
const facadeIndices = (variant: FacadeVariant): Set<number> =>
  new Set(Object.values(FACADE_ELEMENT_RAMPS).map((ramp) => paletteIndex(ramp[variant])));

/** Internal-pixel position of a render-space point (metres) with the camera over the origin at W = 480. */
const rig = createCameraRig(INTERNAL_WIDTH_PX);
function project(x: number, y: number, z: number): { x: number; y: number } {
  const p = new Vector3(x, y, z).project(rig.camera);
  // The camera frames the (W+2)×272 target; the canvas shows its inner W×270 window.
  return { x: ((p.x + 1) / 2) * (INTERNAL_WIDTH_PX + 2) - 1, y: ((1 - p.y) / 2) * 272 - 1 };
}

type Probe = {
  readonly label: string;
  /** Render-space points (x, y = height, z = sim y), metres. */
  readonly points: readonly (readonly [number, number, number])[];
  readonly allowed: Set<number>;
  /** At least one sample must show this index. */
  readonly required: number;
};

/** Points along a wall at mid-height of each storey, a quarter module in from each module edge (brick). */
function wallPoints(
  from: readonly [number, number],
  to: readonly [number, number],
  storeys: number,
): [number, number, number][] {
  const points: [number, number, number][] = [];
  const lengthM = Math.hypot(to[0] - from[0], to[1] - from[1]);
  for (let s = 0; s < storeys; s++) {
    for (let d = 0.25; d < lengthM; d += 1) {
      const t = d / lengthM;
      points.push([from[0] + (to[0] - from[0]) * t, (s + 0.5) * 2.5, from[1] + (to[1] - from[1]) * t]);
    }
  }
  return points;
}

const DARK = facadeIndices(FacadeVariant.Dark);
const LIT = facadeIndices(FacadeVariant.Lit);
const shadowedAsphalt = KERBSIDE32.shadow[paletteIndex(GROUND_COLOURS.asphalt)] ?? -1;
// Block positions from src/render/spikeCity.ts (render x = sim x, render z = sim y).
const probes: Probe[] = [
  {
    label: '6-storey block (top half) shows its south face, _dark',
    points: wallPoints([-8, -2], [-2, -2], 6),
    allowed: DARK,
    required: paletteIndex('brick_dk'),
  },
  {
    label: '1-storey block (left) shows its east face, _dark',
    points: wallPoints([-6, 2], [-6, 6], 1),
    allowed: DARK,
    required: paletteIndex('brick_dk'),
  },
  {
    label: '3-storey block (right) shows its west face, _lit',
    points: wallPoints([4, -6], [4, -2], 3),
    allowed: LIT,
    required: paletteIndex('terracotta'),
  },
  {
    // South-east of the 6-storey block's SE corner, inside its 12.6 m shadow, on open asphalt.
    label: 'asphalt SE of the 6-storey block is shadowed',
    points: [
      [0, 0, 1],
      [1, 0, 0.5],
      [2, 0, 2],
    ],
    allowed: new Set([shadowedAsphalt]),
    required: shadowedAsphalt,
  },
  {
    label: 'open asphalt far from any block is unshadowed',
    points: [
      [-14, 0, -6],
      [0.5, 0, -7],
      [14.5, 0, 7.5],
    ],
    allowed: new Set([paletteIndex(GROUND_COLOURS.asphalt)]),
    required: paletteIndex(GROUND_COLOURS.asphalt),
  },
];

/** Decodes a canvas screenshot in the page (no PNG dependency here) and returns its pixels as palette keys. */
async function pixelsOf(page: Page, png: Buffer): Promise<{ width: number; keys: number[] }> {
  return page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }), {
      colorSpaceConversion: 'none',
      premultiplyAlpha: 'none',
    });
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d');
    if (ctx === null) throw new Error('no 2d context');
    ctx.drawImage(bitmap, 0, 0);
    const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
    const keys: number[] = [];
    for (let o = 0; o < data.length; o += 4) {
      keys.push(((data[o] ?? 0) << 16) | ((data[o + 1] ?? 0) << 8) | (data[o + 2] ?? 0));
    }
    return { width: bitmap.width, keys };
  }, png.toString('base64'));
}

/** Total draw calls of the last frame, from the dev panel readout (F1 opens and closes the panel). */
async function drawCalls(page: Page): Promise<{ calls: number; readout: string }> {
  await page.keyboard.press('F1');
  await page.waitForTimeout(500);
  const readout = (await page.locator('#ssp-devPanel pre').textContent()) ?? '';
  await page.keyboard.press('F1');
  await page.waitForTimeout(200);
  return { calls: Number(/draw calls (\d+)/.exec(readout)?.[1] ?? Number.NaN), readout };
}

const failures: string[] = [];
const report: Record<string, unknown> = {};
const server = await createServer({ logLevel: 'error', server: { port: 0, strictPort: false } });
await server.listen();
const url = server.resolvedUrls?.local[0];
if (url === undefined) throw new Error('vite dev server did not report a URL');
const browser = await chromium.launch({ args: SWIFTSHADER_ARGS });

try {
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(String(error)));

  // --- Draw-call delta ---------------------------------------------------------------------------------
  await page.goto(`${url}?world=empty`);
  await page.waitForTimeout(1500);
  const empty = await drawCalls(page);
  await page.goto(`${url}?actors=0`);
  await page.waitForTimeout(1500);
  const city = await drawCalls(page);
  report.drawCalls = { empty: empty.calls, spikeCity: city.calls, delta: city.calls - empty.calls };
  report.panelReadout = city.readout;
  if (empty.calls !== 2) failures.push(`empty world draws ${empty.calls}, expected 2 (palette + blit)`);
  if (city.calls - empty.calls !== 2)
    failures.push(`spike city adds ${city.calls - empty.calls} draws, not 2`);

  // --- Frame -------------------------------------------------------------------------------------------
  const png = await page.locator('#game').screenshot();
  await writeFile(`${OUT_DIR}/day.png`, png);
  const { width, keys } = await pixelsOf(page, png);
  const height = keys.length / width;
  report.canvas = `${width}x${height}`;
  if (width !== INTERNAL_WIDTH_PX * SCALE || height !== INTERNAL_HEIGHT_PX * SCALE) {
    failures.push(
      `canvas ${width}x${height}, expected ${INTERNAL_WIDTH_PX * SCALE}x${INTERNAL_HEIGHT_PX * SCALE}`,
    );
  }
  const distinct = [...new Set(keys)];
  const offPalette = distinct.filter((key) => indexOfKey(key) < 0);
  report.paletteIndicesOnScreen = distinct.map(indexOfKey).sort((a, b) => a - b);
  if (offPalette.length > 0) failures.push(`${offPalette.length} off-palette colours on screen`);

  report.probes = probes.map((probe) => {
    const seen: number[] = [];
    for (const [x, y, z] of probe.points) {
      const p = project(x, y, z);
      const dx = Math.floor(p.x) * SCALE + SCALE / 2;
      const dy = Math.floor(p.y) * SCALE + SCALE / 2;
      seen.push(indexOfKey(keys[dy * width + dx] ?? -1));
    }
    const bad = seen.filter((i) => !probe.allowed.has(i));
    const ok = bad.length === 0 && seen.includes(probe.required);
    if (!ok) failures.push(`${probe.label}: saw indices ${[...new Set(seen)].join(', ')}`);
    return {
      label: probe.label,
      samples: seen.length,
      indices: [...new Set(seen)].sort((a, b) => a - b),
      ok,
    };
  });

  report.consoleErrors = consoleErrors;
  if (consoleErrors.length > 0) failures.push(`${consoleErrors.length} console errors`);
} finally {
  await browser.close();
  await server.close();
}

report.failures = failures;
console.log(JSON.stringify(report, null, 2));
process.exitCode = failures.length === 0 ? 0 : 1;
