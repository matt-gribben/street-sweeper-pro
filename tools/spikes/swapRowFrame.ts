// Manual GPU check for SSP-297 (ramp-swap rows in the sprite shader, TECHNICAL_DESIGN §12.5). Not part of
// `npm test`: it needs Playwright's Chromium (`npx playwright install chromium`).
// Run with `node tools/spikes/swapRowFrame.ts`.
//
// 1. Starts the Vite dev server and opens a same-origin probe page in headless Chromium with the visual-test
//    flags (--use-angle=swiftshader --enable-unsafe-swiftshader). The page imports the real render modules.
// 2. It loads the committed actors atlas through `loadAtlas`, with the atlas JSON's `swaps` replaced by two
//    fixture tables: slot_1 maps every index i to (i + 1) mod 32 and slot_7 maps i to 31 − i, so every opaque
//    texel shows whether its row was applied.
// 3. One SpriteBatch draws Bessie's h00 body three times (swap rows 0, 1 and 7, 8 m apart) into a (W+2)×272
//    two-attachment target from the game camera over the origin; the colour attachment is read back.
// 4. Node compares the WHOLE target, pixel for pixel, with a CPU composition: each opaque texel at 1:1 around
//    its pivot, coloured palette[swap[row][index]], and the clear colour everywhere else. Zero mismatches
//    proves the shader picks the instance's row of the 32×8 swap texture before the palette lookup, that
//    transparent texels (255) are discarded, and that row 0 draws the atlas unchanged.
// Exits non-zero on any failure and prints a JSON report; the 4x crop goes to build/spikes/swap-rows/.
import { mkdirSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { Vector3 } from 'three';
import { createServer } from 'vite';
import { FRAME, type FrameId } from '../../src/gen/assets.ts';
import { createCameraRig } from '../../src/render/camera.ts';
import { KERBSIDE32, PALETTE_SIZE } from '../../src/render/palettePass.ts';
import {
  indexAtlasPixels,
  SWAP_ROWS,
  swapTableData,
  TRANSPARENT_INDEX,
} from '../../src/render/spriteAtlas.ts';
import { INTERNAL_HEIGHT_PX, RT_HEIGHT_PX, RT_MARGIN_PX, rtWidthPx } from '../../src/render/upscale.ts';
import { decodePng, encodeRgbaPng } from '../../tests/support/png.ts';

const W = 480;
const RT_W = rtWidthPx(W);
const RT_H = RT_HEIGHT_PX;
const SWIFTSHADER_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const OUT_DIR = 'build/spikes/swap-rows';
const FRAME_ID: FrameId = 'veh.sweeper:body:h00:0';
/** The three instances: [sim x, sim y, swap row]. */
const INSTANCES: readonly (readonly [number, number, number])[] = [
  [-8, 0, 0],
  [0, 0, 1],
  [8, 0, 7],
];
mkdirSync(OUT_DIR, { recursive: true });

function fixtureSwaps(): Record<string, Record<string, number>> {
  const slot1: Record<string, number> = {};
  const slot7: Record<string, number> = {};
  for (let i = 0; i < PALETTE_SIZE; i++) {
    slot1[String(i)] = (i + 1) % PALETTE_SIZE;
    slot7[String(i)] = PALETTE_SIZE - 1 - i;
  }
  return { slot_1: slot1, slot_7: slot7 };
}
const SWAPS = fixtureSwaps();
const swapData = swapTableData('actors', SWAPS);
if (swapData.length !== PALETTE_SIZE * SWAP_ROWS) throw new Error('swap data is not 32x8');

const atlasImage = decodePng(readFileSync('public/assets/atlas/actors.png'));
const atlasIndices = indexAtlasPixels('actors', atlasImage);

/** Target pixel (x right, y down) of a ground point, camera over the origin at W = 480. */
const rig = createCameraRig(W);
function anchorPx(xM: number, yM: number): { x: number; y: number } {
  const p = new Vector3(Math.round(xM * 16) / 16, 0, Math.round(yM * 16) / 16).project(rig.camera);
  return {
    x: Math.round(((p.x + 1) / 2) * RT_W - RT_MARGIN_PX) + RT_MARGIN_PX,
    y: Math.round(((1 - p.y) / 2) * RT_H - RT_MARGIN_PX) + RT_MARGIN_PX,
  };
}

/** Expected target bytes, rows top to bottom; the clear colour is (0, 0, 0, 0). */
function expectedTarget(): Uint8Array {
  const out = new Uint8Array(RT_W * RT_H * 4);
  const f = FRAME[FRAME_ID];
  for (const [xM, yM, row] of INSTANCES) {
    const anchor = anchorPx(xM, yM);
    for (let ty = 0; ty < f.h; ty++) {
      for (let tx = 0; tx < f.w; tx++) {
        const index = atlasIndices[(f.y + ty) * atlasImage.width + f.x + tx] ?? TRANSPARENT_INDEX;
        if (index === TRANSPARENT_INDEX) continue;
        const x = anchor.x - f.px + tx;
        const y = anchor.y - f.py + ty;
        if (x < 0 || y < 0 || x >= RT_W || y >= RT_H) continue;
        const swapped = swapData[row * PALETTE_SIZE + index] ?? 0;
        const o = (y * RT_W + x) * 4;
        out[o] = KERBSIDE32.rgb[swapped * 3] ?? 0;
        out[o + 1] = KERBSIDE32.rgb[swapped * 3 + 1] ?? 0;
        out[o + 2] = KERBSIDE32.rgb[swapped * 3 + 2] ?? 0;
        out[o + 3] = 255;
      }
    }
  }
  return out;
}

const failures: string[] = [];
const report: Record<string, unknown> = { frame: FRAME_ID, instances: INSTANCES };

const server = await createServer({ logLevel: 'error', server: { port: 0, strictPort: false } });
await server.listen();
const url = server.resolvedUrls?.local[0];
if (url === undefined) throw new Error('vite dev server did not report a URL');
const browser = await chromium.launch({ args: SWIFTSHADER_ARGS });

try {
  const page = await browser.newPage();
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(String(error)));
  await page.goto(`${url}package.json`);
  const result = await page.evaluate(
    async ({ frameId, instances, swaps, rtW, rtH, w }) => {
      const load = async <T>(path: string): Promise<T> => (await import(/* @vite-ignore */ path)) as T;
      const THREE = await load<typeof import('three')>('/node_modules/three/build/three.module.js');
      const atlasModule = await load<typeof import('../../src/render/spriteAtlas.ts')>(
        '/src/render/spriteAtlas.ts',
      );
      const batchModule = await load<typeof import('../../src/render/spriteBatch.ts')>(
        '/src/render/spriteBatch.ts',
      );
      const cameraModule = await load<typeof import('../../src/render/camera.ts')>('/src/render/camera.ts');
      const layers = await load<typeof import('../../src/render/worldMaterial.ts')>(
        '/src/render/worldMaterial.ts',
      );
      const source = {
        fetchJson: async (u: string): Promise<unknown> => {
          const json = (await atlasModule.browserAtlasSource.fetchJson(u)) as Record<string, unknown>;
          return { ...json, swaps };
        },
        fetchImage: (u: string) => atlasModule.browserAtlasSource.fetchImage(u),
      };
      const atlas = await atlasModule.loadAtlas('actors', source);
      const renderer = new THREE.WebGLRenderer({
        canvas: document.createElement('canvas'),
        antialias: false,
      });
      renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
      const target = new THREE.WebGLRenderTarget(rtW, rtH, {
        count: 2,
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
        generateMipmaps: false,
        depthBuffer: true,
      });
      const batch = new batchModule.SpriteBatch(atlas, 8);
      const scene = new THREE.Scene();
      scene.add(batch.mesh);
      const rig = cameraModule.createCameraRig(w);
      batch.begin(0);
      for (const [x, y, row] of instances) {
        batch.add(frameId as Parameters<typeof batch.add>[0], x, y, layers.DepthLayer.Bessie, row);
      }
      batch.end();
      renderer.setRenderTarget(target);
      renderer.setClearColor(new THREE.Color(0, 0, 0), 0);
      renderer.info.reset();
      renderer.render(scene, rig.camera);
      const pixels = new Uint8Array(rtW * rtH * 4);
      renderer.readRenderTargetPixels(target, 0, 0, rtW, rtH, pixels, undefined, 0);
      const glError = renderer.getContext().getError();
      const calls = renderer.info.render.calls;
      renderer.dispose();
      return { pixels: Array.from(pixels), glError, calls };
    },
    { frameId: FRAME_ID, instances: INSTANCES, swaps: SWAPS, rtW: RT_W, rtH: RT_H, w: W },
  );
  report.glError = result.glError;
  report.drawCalls = result.calls;
  if (result.glError !== 0) failures.push(`GL error ${result.glError}`);
  if (result.calls !== 1) failures.push(`${result.calls} draw calls for one batch, expected 1`);

  // readRenderTargetPixels returns rows bottom to top; flip to top to bottom.
  const actual = new Uint8Array(RT_W * RT_H * 4);
  for (let y = 0; y < RT_H; y++) {
    const from = (RT_H - 1 - y) * RT_W * 4;
    actual.set(result.pixels.slice(from, from + RT_W * 4), y * RT_W * 4);
  }
  const expected = expectedTarget();
  let mismatches = 0;
  const perRow = new Map<number, number>();
  for (const [, , row] of INSTANCES) perRow.set(row, 0);
  let firstMismatch: string | null = null;
  for (let p = 0; p < RT_W * RT_H; p++) {
    const o = p * 4;
    const same =
      actual[o] === expected[o] &&
      actual[o + 1] === expected[o + 1] &&
      actual[o + 2] === expected[o + 2] &&
      actual[o + 3] === expected[o + 3];
    if (!same) {
      mismatches++;
      if (firstMismatch === null) {
        firstMismatch = `(${p % RT_W}, ${Math.floor(p / RT_W)}) got ${Array.from(actual.slice(o, o + 4))} expected ${Array.from(expected.slice(o, o + 4))}`;
      }
    }
  }
  // Opaque texels drawn per instance (a sanity check that each row actually covered pixels).
  for (const [xM, yM, row] of INSTANCES) {
    const a = anchorPx(xM, yM);
    const f = FRAME[FRAME_ID];
    let opaque = 0;
    for (let y = a.y - f.py; y < a.y - f.py + f.h; y++) {
      for (let x = a.x - f.px; x < a.x - f.px + f.w; x++) {
        if ((actual[(y * RT_W + x) * 4 + 3] ?? 0) === 255) opaque++;
      }
    }
    perRow.set(row, opaque);
  }
  report.mismatches = mismatches;
  report.firstMismatch = firstMismatch;
  report.opaquePixelsPerRow = Object.fromEntries(perRow);
  if (mismatches !== 0) failures.push(`${mismatches} target pixels differ from the CPU composition`);
  for (const [row, opaque] of perRow) if (opaque === 0) failures.push(`swap row ${row} drew nothing`);
  report.consoleErrors = consoleErrors;
  if (consoleErrors.length > 0) failures.push(`console errors: ${consoleErrors.join(' | ')}`);

  // Evidence: the band holding the three instances, 4x, nearest.
  const top = anchorPx(0, 0).y - FRAME[FRAME_ID].py - 4;
  const bandH = FRAME[FRAME_ID].h + 8;
  const left = anchorPx(-8, 0).x - FRAME[FRAME_ID].px - 4;
  const bandW = anchorPx(8, 0).x - anchorPx(-8, 0).x + FRAME[FRAME_ID].w + 8;
  const scale = 4;
  const crop = new Uint8Array(bandW * scale * bandH * scale * 4);
  for (let y = 0; y < bandH * scale; y++) {
    for (let x = 0; x < bandW * scale; x++) {
      const src = ((top + Math.floor(y / scale)) * RT_W + left + Math.floor(x / scale)) * 4;
      const dst = (y * bandW * scale + x) * 4;
      const opaque = (actual[src + 3] ?? 0) === 255;
      crop[dst] = opaque ? (actual[src] ?? 0) : (KERBSIDE32.rgb[0] ?? 0);
      crop[dst + 1] = opaque ? (actual[src + 1] ?? 0) : (KERBSIDE32.rgb[1] ?? 0);
      crop[dst + 2] = opaque ? (actual[src + 2] ?? 0) : (KERBSIDE32.rgb[2] ?? 0);
      crop[dst + 3] = 255;
    }
  }
  await writeFile(
    `${OUT_DIR}/rows_0_1_7_4x.png`,
    encodeRgbaPng({ width: bandW * scale, height: bandH * scale, data: crop }),
  );
  report.internalHeightPx = INTERNAL_HEIGHT_PX;
} finally {
  await browser.close();
  await server.close();
}

report.failures = failures;
console.log(JSON.stringify(report, null, 2));
process.exit(failures.length === 0 ? 0 : 1);
