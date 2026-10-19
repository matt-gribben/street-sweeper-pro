// The test-only asset zoo in the shipping bundle (SSP-298; TECHNICAL_DESIGN §6.2, ART_BIBLE §15.1, ROADMAP §1.1).
// The `zoo` visual golden is SSP-118 (M4); until then this spec checks what must hold exactly and saves review
// captures for the ROADMAP §1.1 batch review (open them with Read):
//
// - `/?test=1&seed=1&scene=zoo&freeze=1` boots BootScene → zoo with no console error, `__ssp.ready` turns true and
//   `__ssp.readFrame()` is a 480×270 frame drawn in 6 calls (ground, drop shadows, actors, items, palette pass, blit);
// - every pixel equals a CPU composition of the same layout (src/scenes/zooLayout.ts) from the committed atlas PNGs:
//   the 02/05/22 bands, each frame at 1:1 with its top-left on its cell's, and the +2, +2 drop shadow remapped
//   through `shadow[32]` on the ground only. That is the in-engine proof that Bessie h00 is on the page, the shadows
//   sit at +2, +2 and nothing is resampled; the same holds for `&asset=veh.sweeper` (every page) and for the brush
//   overlay stepped with `&tick=<n>` (10 fps cycling);
// - an unknown `&asset=` logs one console error naming the ID and draws the default view.
//
// Captures go to the test's folder under test-results/ and are copied to build/zoo/ (git-ignored), the stable
// review path the issue names.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, type Page, type TestInfo, test } from '@playwright/test';
import { FRAME, type FrameId } from '../../src/gen/assets.ts';
import { KERBSIDE32, paletteIndex } from '../../src/render/palettePass.ts';
import type { RgbaImage } from '../../src/render/spriteAtlas.ts';
import {
  ZOO_BAND_W_PX,
  ZOO_BANDS,
  ZOO_PAGE_H_PX,
  ZOO_PAGE_W_PX,
  ZOO_SCALE_FRAME,
  type ZooLayout,
  zooCellFrame,
  zooLayout,
} from '../../src/scenes/zooLayout.ts';
import { decodePng } from '../support/png.ts';
import {
  collectPageErrors,
  encodeFramePng,
  openTestScene,
  type RgbaFrame,
  readTestFrame,
} from '../support/visualGolden.ts';
import { saveFrame } from './helpers/saveFrame.ts';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const FRAME_IDS = Object.keys(FRAME) as FrameId[];

/** Ground, drop shadows, actors, items, palette pass, blit (TECHNICAL_DESIGN §12.7). */
const DEFAULT_DRAW_CALLS = 6;

const atlasCache = new Map<string, RgbaImage>();
function atlas(name: string): RgbaImage {
  let image = atlasCache.get(name);
  if (image === undefined) {
    image = decodePng(readFileSync(`${REPO_ROOT}public/assets/atlas/${name}.png`));
    atlasCache.set(name, image);
  }
  return image;
}

/** The frame the zoo must draw for `layout` at `tick`, composed on the CPU (W = 480). */
function referenceFrame(layout: ZooLayout, tick: number): RgbaFrame {
  const W = ZOO_PAGE_W_PX;
  const H = ZOO_PAGE_H_PX;
  const bands = ZOO_BANDS.map((name) => paletteIndex(name));
  const ground = new Uint8Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) ground[y * W + x] = bands[Math.floor(x / ZOO_BAND_W_PX)] ?? 0;
  const shadow = new Uint8Array(W * H);
  const rgba = new Uint8Array(W * H * 4);
  const opaque = (frame: FrameId, visit: (tx: number, ty: number, i: number) => void): void => {
    const f = FRAME[frame];
    const image = atlas(f.atlas);
    for (let ty = 0; ty < f.h; ty++)
      for (let tx = 0; tx < f.w; tx++) {
        const i = ((f.y + ty) * image.width + f.x + tx) * 4;
        if ((image.data[i + 3] ?? 0) === 255) visit(tx, ty, i);
      }
  };
  for (const cell of layout.cells) {
    if (!cell.castsShadow) continue;
    opaque(zooCellFrame(cell, tick), (tx, ty) => {
      shadow[(cell.y + ty + 2) * W + cell.x + tx + 2] = 1;
    });
  }
  for (let p = 0; p < W * H; p++) {
    const g = ground[p] ?? 0;
    const idx = shadow[p] === 1 ? (KERBSIDE32.shadow[g] ?? g) : g;
    rgba.set(KERBSIDE32.rgb.subarray(idx * 3, idx * 3 + 3), p * 4);
    rgba[p * 4 + 3] = 255;
  }
  for (const cell of layout.cells) {
    const frame = zooCellFrame(cell, tick);
    const image = atlas(FRAME[frame].atlas);
    opaque(frame, (tx, ty, i) => {
      const p = ((cell.y + ty) * W + cell.x + tx) * 4;
      rgba.set(image.data.subarray(i, i + 3), p);
      rgba[p + 3] = 255;
    });
  }
  return { width: W, height: H, data: rgba };
}

/** Pixels whose RGB differs, with the first few positions for the failure message. */
function mismatches(expected: RgbaFrame, actual: RgbaFrame): { count: number; first: string[] } {
  let count = 0;
  const first: string[] = [];
  for (let p = 0; p < expected.width * expected.height; p++) {
    const i = p * 4;
    if (
      expected.data[i] !== actual.data[i] ||
      expected.data[i + 1] !== actual.data[i + 1] ||
      expected.data[i + 2] !== actual.data[i + 2]
    ) {
      count += 1;
      if (first.length < 8) first.push(`(${p % expected.width}, ${Math.floor(p / expected.width)})`);
    }
  }
  return { count, first };
}

/** Saves a capture under test-results/ and copies it to build/zoo/<name> for the §1.1 review. */
async function capture(testInfo: TestInfo, name: string, frame: RgbaFrame): Promise<void> {
  await saveFrame(testInfo, name, frame);
  mkdirSync(`${REPO_ROOT}build/zoo`, { recursive: true });
  writeFileSync(`${REPO_ROOT}build/zoo/${name}`, encodeFramePng(frame));
}

async function drawCalls(page: Page): Promise<number> {
  return page.evaluate(() => window.__ssp?.perf().drawCalls ?? -1);
}

test('the zoo boots from ?test=1&scene=zoo and draws the default view exactly', async ({
  page,
}, testInfo) => {
  const errors = collectPageErrors(page);
  await openTestScene(page, '/?test=1&seed=1&scene=zoo&freeze=1');
  expect(await page.evaluate(() => window.__ssp?.sceneHistory())).toEqual(['boot', 'zoo']);
  expect(await page.evaluate(() => window.__ssp?.scene())).toBe('zoo');
  const frame = await readTestFrame(page);
  expect([frame.width, frame.height]).toEqual([480, 270]);
  await capture(testInfo, 'zoo_default.png', frame);
  expect(await drawCalls(page)).toBe(DEFAULT_DRAW_CALLS);

  const layout = zooLayout(FRAME_IDS, {});
  expect(layout.cells[0]?.frame).toBe(ZOO_SCALE_FRAME);
  expect(new Set(layout.cells.map((c) => c.band))).toEqual(new Set([0, 1, 2]));
  const diff = mismatches(referenceFrame(layout, 0), frame);
  expect(diff.count, `first mismatches ${diff.first.join(' ')}`).toBe(0);
  // Frozen: later frames are the same frame.
  await page.waitForTimeout(100);
  expect(mismatches(frame, await readTestFrame(page)).count).toBe(0);
  expect(errors).toEqual([]);
});

test('every page of the default view draws exactly', async ({ page }, testInfo) => {
  // SSP-101's props and power-ups push the default view past one page; each page must match its layout too.
  const errors = collectPageErrors(page);
  const { pageCount } = zooLayout(FRAME_IDS, {});
  for (let n = 0; n < pageCount; n++) {
    await openTestScene(page, `/?test=1&seed=1&scene=zoo&freeze=1&page=${n}`);
    const frame = await readTestFrame(page);
    await capture(testInfo, `zoo_default_p${n}.png`, frame);
    const diff = mismatches(referenceFrame(zooLayout(FRAME_IDS, { page: n }), 0), frame);
    expect(diff.count, `page ${n}: first mismatches ${diff.first.join(' ')}`).toBe(0);
  }
  expect(errors).toEqual([]);
});

/** The SSP-101 sprite stacks: the default view shows only slice 0, so each is reviewed in its asset view. */
const STACK_PROPS = [
  'prop.a_board',
  'prop.bollard',
  'prop.bus_shelter',
  'prop.litter_bin',
  'prop.market_stall',
  'prop.phone_box',
  'prop.post_box',
  'prop.roadworks_barrier',
  'prop.traffic_cone',
  'prop.tree',
  'prop.wheelie_bin',
] as const;

test('asset=<prop> shows every slice of each placeholder stack exactly', async ({ page }, testInfo) => {
  const errors = collectPageErrors(page);
  for (const asset of STACK_PROPS) {
    await openTestScene(page, `/?test=1&seed=1&scene=zoo&freeze=1&asset=${asset}`);
    const frame = await readTestFrame(page);
    await capture(testInfo, `zoo_${asset}.png`, frame);
    const diff = mismatches(referenceFrame(zooLayout(FRAME_IDS, { asset }), 0), frame);
    expect(diff.count, `${asset}: first mismatches ${diff.first.join(' ')}`).toBe(0);
  }
  expect(errors).toEqual([]);
});

test('asset=veh.sweeper shows every Bessie frame across its pages, Bessie h00 on each', async ({
  page,
}, testInfo) => {
  const errors = collectPageErrors(page);
  const { pageCount } = zooLayout(FRAME_IDS, { asset: 'veh.sweeper' });
  expect(pageCount).toBeGreaterThan(1);
  for (let n = 0; n < pageCount; n++) {
    await openTestScene(page, `/?test=1&seed=1&scene=zoo&freeze=1&asset=veh.sweeper&page=${n}`);
    const frame = await readTestFrame(page);
    expect([frame.width, frame.height]).toEqual([480, 270]);
    await capture(testInfo, `zoo_veh.sweeper_p${n}.png`, frame);
    const diff = mismatches(
      referenceFrame(zooLayout(FRAME_IDS, { asset: 'veh.sweeper', page: n }), 0),
      frame,
    );
    expect(diff.count, `page ${n}: first mismatches ${diff.first.join(' ')}`).toBe(0);
    // No items frames in this view: ground, shadows, actors, palette pass, blit.
    expect(await drawCalls(page)).toBe(DEFAULT_DRAW_CALLS - 1);
  }
  expect(errors).toEqual([]);
});

// SSP-097: the six Monday people (104 placeholder frames each) review in-engine, every page pixel-exact.
const MONDAY_PEOPLE = [
  'npc.dog_walker',
  'npc.mum_pushchair',
  'npc.old_man_frame',
  'npc.old_woman',
  'npc.postie',
  'npc.shopper',
] as const;

test('asset=<npc> shows every frame of each Monday person, drawn exactly', async ({ page }, testInfo) => {
  const errors = collectPageErrors(page);
  for (const asset of MONDAY_PEOPLE) {
    const { pageCount } = zooLayout(FRAME_IDS, { asset });
    for (let n = 0; n < pageCount; n++) {
      await openTestScene(page, `/?test=1&seed=1&scene=zoo&freeze=1&asset=${asset}&page=${n}`);
      const frame = await readTestFrame(page);
      await capture(testInfo, `zoo_${asset}_p${n}.png`, frame);
      const diff = mismatches(referenceFrame(zooLayout(FRAME_IDS, { asset, page: n }), 0), frame);
      expect(diff.count, `${asset} page ${n}: first mismatches ${diff.first.join(' ')}`).toBe(0);
    }
  }
  expect(errors).toEqual([]);
});

test('tick=<n> steps animations at 10 fps: the brush overlay spins one frame per 6 ticks', async ({
  page,
}, testInfo) => {
  const errors = collectPageErrors(page);
  const layout = zooLayout(FRAME_IDS, { asset: 'veh.sweeper_brush' });
  await openTestScene(page, '/?test=1&seed=1&scene=zoo&freeze=1&asset=veh.sweeper_brush&tick=6');
  const at6 = await readTestFrame(page);
  await capture(testInfo, 'zoo_veh.sweeper_brush_t6.png', at6);
  expect(mismatches(referenceFrame(layout, 6), at6).count).toBe(0);
  expect(mismatches(referenceFrame(layout, 0), at6).count).toBeGreaterThan(0);
  await page.evaluate(() => window.__ssp?.step(6));
  const at12 = await readTestFrame(page);
  expect(mismatches(referenceFrame(layout, 12), at12).count).toBe(0);
  expect(errors).toEqual([]);
});

test('an unknown asset logs one console error naming it and falls back to the default view', async ({
  page,
}) => {
  const errors = collectPageErrors(page);
  await openTestScene(page, '/?test=1&seed=1&scene=zoo&freeze=1&asset=npc.nobody');
  const frame = await readTestFrame(page);
  expect(errors).toHaveLength(1);
  expect(errors[0]).toContain("'npc.nobody'");
  const diff = mismatches(referenceFrame(zooLayout(FRAME_IDS, {}), 0), frame);
  expect(diff.count, `first mismatches ${diff.first.join(' ')}`).toBe(0);
});
