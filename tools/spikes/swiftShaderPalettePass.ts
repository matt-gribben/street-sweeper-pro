// Manual SwiftShader check for SSP-016 (evidence for ROADMAP D-09). Not part of `npm test`: it needs Playwright's
// Chromium (`npx playwright install chromium`). Run with `node tools/spikes/swiftShaderPalettePass.ts`.
//
// 1. Starts the Vite dev server and opens it in headless Chromium with the visual-test flags
//    (--use-angle=swiftshader --enable-unsafe-swiftshader) at 1920x1080 (W = 480, 4x).
// 2. MRT + MaxEquation probe in three 0.186.1: a 2-attachment target, one opaque draw, then two MAX-blended
//    mask-only draws; both attachments are read back. MAX gives mask R = max(0.25, 0.5, 0.25) = 128/255, where
//    ADD would saturate it to 255, and colour must be untouched.
// 3. The real frame, day and night: every canvas pixel must be a Kerbside-32 colour, and the swatch strip of the
//    test world must show palette[i] / palette[shadow[i]] (day) and the night/light branches (night), as the
//    CPU reference (`remapIndex`) predicts.
// 4. No console errors; the dev panel's draw-call count covers all passes (renderer.info.autoReset = false).
// Exits non-zero on any failure and prints a JSON report; the two screenshots go to build/spikes/palette-pass/.
import { mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { KERBSIDE32, PALETTE_SIZE, remapIndex } from '../../src/render/palettePass.ts';

const VIEWPORT = { width: 1920, height: 1080 };
const SCALE = 4;
const SWIFTSHADER_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
/** Test world swatch strip (src/render/testWorld.ts) in internal pixels at W = 480, camera at the origin. */
const SWATCH_X0_PX = 240 - 12 * 16;
const SWATCH_WIDTH_PX = 12;
const SWATCH_UPPER_Y_PX = 135 - 6.5 * 16;
const SWATCH_LOWER_Y_PX = 135 - 5.5 * 16;
/** Swatches 16..31 lie under the light mask (x >= 0). */
const FIRST_LIT_SWATCH = 16;

type Sample = { readonly x: number; readonly y: number; readonly expected: number; readonly label: string };

function paletteKey(index: number): number {
  const rgb = KERBSIDE32.rgb;
  return ((rgb[index * 3] ?? 0) << 16) | ((rgb[index * 3 + 1] ?? 0) << 8) | (rgb[index * 3 + 2] ?? 0);
}

function swatchSamples(night: boolean): Sample[] {
  const samples: Sample[] = [];
  for (let i = 0; i < PALETTE_SIZE; i++) {
    const lit = i >= FIRST_LIT_SWATCH;
    const x = SWATCH_X0_PX + i * SWATCH_WIDTH_PX + SWATCH_WIDTH_PX / 2;
    samples.push({
      x,
      y: SWATCH_UPPER_Y_PX,
      expected: remapIndex(i, false, lit, night),
      label: `swatch ${i}`,
    });
    samples.push({
      x,
      y: SWATCH_LOWER_Y_PX,
      expected: remapIndex(i, true, lit, night),
      label: `swatch ${i} shadowed`,
    });
  }
  return samples;
}

/** Screenshots land here (ignored by version control) for review with the Read tool. */
const OUT_DIR = 'build/spikes/palette-pass';
mkdirSync(OUT_DIR, { recursive: true });

const failures: string[] = [];
const report: Record<string, unknown> = {};

const server = await createServer({ logLevel: 'error', server: { port: 0, strictPort: false } });
await server.listen();
const url = server.resolvedUrls?.local[0];
if (url === undefined) throw new Error('vite dev server did not report a URL');
const browser = await chromium.launch({ args: SWIFTSHADER_ARGS });

try {
  // The probe runs on its own same-origin page that does not load the game, so its readbacks and second three
  // instance cannot add console noise to the game page.
  const probePage = await browser.newPage();
  await probePage.goto(`${url}package.json`);
  report.gpu = await probePage.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (gl === null) return 'no webgl2';
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    return info === null ? gl.getParameter(gl.RENDERER) : gl.getParameter(info.UNMASKED_RENDERER_WEBGL);
  });

  // --- MRT + MaxEquation probe -------------------------------------------------------------------------
  report.mrtMaxProbe = await probePage.evaluate(async () => {
    const threeUrl = '/node_modules/three/build/three.module.js';
    const THREE = (await import(/* @vite-ignore */ threeUrl)) as typeof import('three');
    const renderer = new THREE.WebGLRenderer({ canvas: document.createElement('canvas'), antialias: false });
    const target = new THREE.WebGLRenderTarget(4, 4, {
      count: 2,
      depthBuffer: true,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
    });
    const outputs = `
      layout(location = 0) out highp vec4 outColour;
      layout(location = 1) out highp vec4 outMask;`;
    const vertexShader = 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }';
    const draw = (colour: number[], mask: number[], max: boolean) =>
      new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader,
        fragmentShader: `precision highp float; uniform vec4 uC; uniform vec4 uM; ${outputs}
          void main() { outColour = uC; outMask = uM; }`,
        uniforms: { uC: { value: new THREE.Vector4(...colour) }, uM: { value: new THREE.Vector4(...mask) } },
        depthTest: false,
        depthWrite: false,
        ...(max
          ? {
              blending: THREE.CustomBlending,
              blendEquation: THREE.MaxEquation,
              blendEquationAlpha: THREE.MaxEquation,
              blendSrc: THREE.OneFactor,
              blendDst: THREE.OneFactor,
            }
          : {}),
      });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3),
    );
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const materials = [
      draw([0.2, 0.4, 0.6, 1], [0.25, 0, 0, 0], false),
      draw([0, 0, 0, 0], [0.5, 0, 0, 0], true),
      draw([0, 0, 0, 0], [0.25, 0.75, 0, 0], true),
    ];
    renderer.setRenderTarget(target);
    renderer.setClearColor(new THREE.Color(0, 0, 0), 0);
    renderer.clear();
    renderer.autoClear = false;
    for (const material of materials) {
      const scene = new THREE.Scene();
      const mesh = new THREE.Mesh(geometry, material);
      mesh.frustumCulled = false;
      scene.add(mesh);
      renderer.render(scene, camera);
    }
    const colour = new Uint8Array(4);
    const mask = new Uint8Array(4);
    renderer.readRenderTargetPixels(target, 1, 1, 1, 1, colour, undefined, 0);
    renderer.readRenderTargetPixels(target, 1, 1, 1, 1, mask, undefined, 1);
    const glError = renderer.getContext().getError();
    renderer.dispose();
    return { revision: THREE.REVISION, colour: Array.from(colour), mask: Array.from(mask), glError };
  });
  const probe = report.mrtMaxProbe as { colour: number[]; mask: number[]; glError: number };
  if (probe.colour.join() !== '51,102,153,255') failures.push(`MRT colour attachment ${probe.colour.join()}`);
  if (probe.mask.join() !== '128,191,0,0')
    failures.push(`MRT mask attachment ${probe.mask.join()} (MAX expected)`);
  if (probe.glError !== 0) failures.push(`GL error ${probe.glError}`);
  await probePage.close();

  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  const consoleErrors: string[] = [];
  const consoleWarnings: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
    if (message.type() === 'warning') consoleWarnings.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(String(error)));
  // The SSP-016 test world is no longer the default world (SSP-017 made it the spike city); dev builds select it.
  await page.goto(`${url}?world=palette_test`);
  await page.waitForTimeout(1500);

  // --- Frames through the palette pass -----------------------------------------------------------------
  const checkFrame = async (night: boolean): Promise<Record<string, unknown>> => {
    const png = (await page.locator('#game').screenshot()).toString('base64');
    const samples = swatchSamples(night);
    const result = await page.evaluate(
      async ({ b64, points, scale }) => {
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
        const keyAt = (o: number): number =>
          ((data[o] ?? 0) << 16) | ((data[o + 1] ?? 0) << 8) | (data[o + 2] ?? 0);
        const distinct = new Set<number>();
        for (let o = 0; o < data.length; o += 4) distinct.add(keyAt(o));
        const sampled = points.map((p) => {
          const dx = Math.floor(p.x * scale + scale / 2);
          const dy = Math.floor(p.y * scale + scale / 2);
          return keyAt((dy * bitmap.width + dx) * 4);
        });
        return { width: bitmap.width, height: bitmap.height, distinct: [...distinct], sampled };
      },
      { b64: png, points: samples, scale: SCALE },
    );
    const paletteKeys = new Set(Array.from({ length: PALETTE_SIZE }, (_, i) => paletteKey(i)));
    const offPalette = result.distinct.filter((key) => !paletteKeys.has(key));
    const tag = night ? 'night' : 'day';
    if (offPalette.length > 0) failures.push(`${tag}: ${offPalette.length} off-palette colours`);
    let mismatches = 0;
    samples.forEach((sample, k) => {
      if (result.sampled[k] !== paletteKey(sample.expected)) {
        mismatches++;
        failures.push(
          `${tag}: ${sample.label} shows ${result.sampled[k]}, expected index ${sample.expected}`,
        );
      }
    });
    const indices = result.distinct.map((key) => [...paletteKeys].indexOf(key)).sort((a, b) => a - b);
    await writeFile(`${OUT_DIR}/${tag}.png`, Buffer.from(png, 'base64'));
    return {
      canvas: `${result.width}x${result.height}`,
      distinctColours: result.distinct.length,
      paletteIndicesOnScreen: indices,
      offPalette: offPalette.length,
      swatchSamples: samples.length,
      swatchMismatches: mismatches,
    };
  };

  report.day = await checkFrame(false);

  // Night on through the dev panel (F1), then hide it again so it does not cover the frame.
  await page.keyboard.press('F1');
  await page.locator('#ssp-dev-panel input[type=checkbox]').nth(1).check();
  await page.waitForTimeout(400);
  const readout = (await page.locator('#ssp-dev-panel pre').textContent()) ?? '';
  await page.keyboard.press('F1');
  await page.waitForTimeout(200);
  report.night = await checkFrame(true);

  const calls = Number(/draw calls (\d+)/.exec(readout)?.[1] ?? Number.NaN);
  report.drawCalls = calls;
  report.panelReadout = readout;
  // 4 world draws (ground, colour test, shadow mask, light mask) + palette pass + blit.
  if (calls !== 6) failures.push(`draw calls ${calls}, expected 6`);
  report.consoleErrors = consoleErrors;
  // Warnings are reported, not failed: screenshot readbacks can trigger driver performance notes.
  report.consoleWarnings = consoleWarnings;
  if (consoleErrors.length > 0) failures.push(`${consoleErrors.length} console errors`);
} finally {
  await browser.close();
  await server.close();
}

report.failures = failures;
console.log(JSON.stringify(report, null, 2));
process.exitCode = failures.length === 0 ? 0 : 1;
