// SSP-066: the grime mask's incremental GPU upload (TECHNICAL_DESIGN §10.3, groundLayer.ts GroundGrime), without
// WebGL. A recording uploader stands in for WebGLRenderer.copyTextureToTexture and applies each call to a CPU copy
// of "GPU memory" exactly as texSubImage2D would (the region of the source's data, row length = mask width).
// It shows that:
//   - mergeDirtyRect builds the union (bounding box) of the per-tick rects and ignores empty ones;
//   - one rendered frame uploads exactly once, exactly the union of the dirty rects of that frame's ticks, from
//     the never-bound source wrapper into the bound texture, and never sets needsUpdate;
//   - after any run of frames the GPU copy equals the sim's mask (nothing changed is ever missed);
//   - a frame whose ticks changed nothing uploads nothing; and accumulate + upload allocate nothing.
import { readFileSync } from 'node:fs';
import type { Box2, Texture, Vector2 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  clearDirtyRect,
  createDirtyRect,
  type DirtyRect,
  GroundGrime,
  isDirtyRectEmpty,
  mergeDirtyRect,
  type TextureRegionUploader,
} from '../../src/render/groundLayer.ts';
import { createDirt, type Dirt, initGrime, stepDirt, viewDirt } from '../../src/sim/dirt.ts';
import { decodeLevel } from '../../src/sim/map.ts';
import { DEFAULT_TUNING } from '../../src/sim/tuning.ts';
import { assertHeapDeltaWithinThresholds, measureHeapDelta } from '../support/heapDelta.ts';

const REPO_ROOT = new URL('../../', import.meta.url).pathname;
const PUDDLE_LANE = decodeLevel(readFileSync(`${REPO_ROOT}public/assets/levels/puddle_lane.json`, 'utf8'));

type Upload = {
  src: Texture;
  dst: Texture;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  x: number;
  y: number;
};

/** Records every copy and applies it to `gpu` like texSubImage2D (srcRegion max exclusive). */
function recordingUploader(gpu: Uint8Array, widthCells: number) {
  const uploads: Upload[] = [];
  const regions = new Set<Box2>();
  const origins = new Set<Vector2>();
  const uploader: TextureRegionUploader = {
    copyTextureToTexture(src, dst, srcRegion, dstPosition) {
      if (srcRegion === null || dstPosition === null) throw new Error('GroundGrime always passes a region');
      regions.add(srcRegion);
      origins.add(dstPosition);
      const image: unknown = src.image;
      const data: unknown =
        typeof image === 'object' && image !== null && 'data' in image ? image.data : null;
      if (!(data instanceof Uint8Array)) throw new Error('source has no Uint8Array data');
      const { min, max } = srcRegion;
      uploads.push({
        src,
        dst,
        minX: min.x,
        minY: min.y,
        maxX: max.x,
        maxY: max.y,
        x: dstPosition.x,
        y: dstPosition.y,
      });
      for (let y = min.y; y < max.y; y++) {
        for (let x = min.x; x < max.x; x++) {
          const at = (dstPosition.y + y - min.y) * widthCells + dstPosition.x + x - min.x;
          gpu[at] = data[y * widthCells + x] ?? 0;
        }
      }
    },
  };
  return { uploader, uploads, regions, origins };
}

/** A grimy Puddle Lane mask (seed 1) and a pose that drives north up the depot road at x = 7 m. */
function shift(): { dirt: Dirt; pose: { xM: number; yM: number; headingRad: number } } {
  const dirt = createDirt(PUDDLE_LANE, DEFAULT_TUNING);
  initGrime(dirt, PUDDLE_LANE, 1);
  return { dirt, pose: { xM: 7, yM: 76, headingRad: 0 } };
}

describe('mergeDirtyRect', () => {
  it('starts empty and grows to the bounding box of the rects merged into it', () => {
    const r = createDirtyRect();
    expect(isDirtyRectEmpty(r)).toBe(true);
    mergeDirtyRect(r, 10, 20, 12, 25);
    expect(r).toEqual({ minX: 10, minY: 20, maxX: 12, maxY: 25 });
    mergeDirtyRect(r, 30, 5, 31, 6);
    expect(r).toEqual({ minX: 10, minY: 5, maxX: 31, maxY: 25 });
    mergeDirtyRect(r, 11, 21, 11, 21); // inside: unchanged
    expect(r).toEqual({ minX: 10, minY: 5, maxX: 31, maxY: 25 });
    clearDirtyRect(r);
    expect(isDirtyRectEmpty(r)).toBe(true);
  });

  it('ignores an empty rect (dirt.ts reports max < min for a tick that changed nothing)', () => {
    const r: DirtyRect = createDirtyRect();
    mergeDirtyRect(r, 512, 384, -1, -1);
    expect(isDirtyRectEmpty(r)).toBe(true);
    mergeDirtyRect(r, 3, 4, 3, 4);
    mergeDirtyRect(r, 512, 384, -1, -1);
    expect(r).toEqual({ minX: 3, minY: 4, maxX: 3, maxY: 4 });
    mergeDirtyRect(r, 5, 5, 4, 9); // empty in x only
    expect(r).toEqual({ minX: 3, minY: 4, maxX: 3, maxY: 4 });
  });

  it('is the union of any sequence of rects (randomised against a brute-force bounding box)', () => {
    let s = 12345;
    const next = (n: number): number => {
      s = (Math.imul(s, 1103515245) + 12345) >>> 0;
      return s % n;
    };
    for (let trial = 0; trial < 200; trial++) {
      const r = createDirtyRect();
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      const n = 1 + next(8);
      for (let k = 0; k < n; k++) {
        const x0 = next(500);
        const y0 = next(380);
        const empty = next(4) === 0;
        const x1 = empty ? x0 - 1 : x0 + next(12);
        const y1 = y0 + next(12);
        mergeDirtyRect(r, x0, y0, x1, y1);
        if (!empty) {
          minX = Math.min(minX, x0);
          minY = Math.min(minY, y0);
          maxX = Math.max(maxX, x1);
          maxY = Math.max(maxY, y1);
        }
      }
      if (minX === Infinity) expect(isDirtyRectEmpty(r)).toBe(true);
      else expect(r).toEqual({ minX, minY, maxX, maxY });
    }
  });
});

describe('GroundGrime uploads only the union of the frame’s dirty rects', () => {
  it('sends one sub-rectangle per frame, exactly the union of that frame’s ticks, and the GPU copy tracks the mask', () => {
    const { dirt, pose } = shift();
    const grime = new GroundGrime(viewDirt(dirt));
    const versionAtCreate = grime.texture.version;
    // The first render uploads the whole mask (needsUpdate at creation); model that as the GPU's starting copy.
    expect(versionAtCreate).toBeGreaterThan(0);
    const gpu = Uint8Array.from(dirt.mask);
    const { uploader, uploads, regions, origins } = recordingUploader(gpu, dirt.maskW);

    let cleanedFrames = 0;
    let totalBytes = 0;
    for (let frame = 0; frame < 40; frame++) {
      // 1 to 3 ticks per rendered frame, as the fixed 60 Hz loop gives at other display rates.
      const ticks = 1 + (frame % 3);
      const union = createDirtyRect();
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (let t = 0; t < ticks; t++) {
        pose.yM -= 0.1;
        pose.headingRad = 0.02 * Math.sin(frame + t);
        stepDirt(dirt, pose, true);
        grime.accumulate(viewDirt(dirt));
        if (dirt.dirtyMaxX >= dirt.dirtyMinX) {
          minX = Math.min(minX, dirt.dirtyMinX);
          minY = Math.min(minY, dirt.dirtyMinY);
          maxX = Math.max(maxX, dirt.dirtyMaxX);
          maxY = Math.max(maxY, dirt.dirtyMaxY);
        }
        mergeDirtyRect(union, dirt.dirtyMinX, dirt.dirtyMinY, dirt.dirtyMaxX, dirt.dirtyMaxY);
      }
      expect(grime.pending).toEqual(union);
      const before = uploads.length;
      const bytes = grime.upload(uploader);
      if (minX === Infinity) {
        expect(uploads.length).toBe(before);
        expect(bytes).toBe(0);
      } else {
        cleanedFrames++;
        expect(uploads.length).toBe(before + 1);
        const u = uploads[uploads.length - 1];
        expect(u).toMatchObject({ minX, minY, maxX: maxX + 1, maxY: maxY + 1, x: minX, y: minY });
        expect(u?.src).toBe(grime.source);
        expect(u?.dst).toBe(grime.texture);
        expect(bytes).toBe((maxX - minX + 1) * (maxY - minY + 1));
        // A brush footprint's rect, never the whole 196,608 B mask.
        expect(bytes).toBeLessThan(2_000);
        totalBytes += bytes;
      }
      expect(isDirtyRectEmpty(grime.pending)).toBe(true);
      // Whatever the frame did, the GPU copy now equals the sim's mask.
      expect(Buffer.from(gpu).equals(Buffer.from(dirt.mask))).toBe(true);
    }
    expect(dirt.cleanedCells).toBeGreaterThan(200);
    expect(cleanedFrames).toBeGreaterThan(20);
    expect(grime.uploads).toBe(cleanedFrames);
    expect(totalBytes).toBeGreaterThan(0);
    // No upload sets needsUpdate (that would re-send all 196,608 B), and no frame makes a new Box2 or Vector2.
    expect(grime.texture.version).toBe(versionAtCreate);
    expect(grime.source.version).toBe(0);
    expect(regions.size).toBe(1);
    expect(origins.size).toBe(1);
  });

  it('merges two far-apart erasures in one frame into their bounding box (one upload, both areas current)', () => {
    const { dirt } = shift();
    const grime = new GroundGrime(viewDirt(dirt));
    const gpu = Uint8Array.from(dirt.mask);
    const { uploader, uploads } = recordingUploader(gpu, dirt.maskW);
    const a = { xM: 7, yM: 70, headingRad: 0 };
    const b = { xM: 7, yM: 50, headingRad: Math.PI / 2 };
    stepDirt(dirt, a, true);
    const ra = { minX: dirt.dirtyMinX, minY: dirt.dirtyMinY, maxX: dirt.dirtyMaxX, maxY: dirt.dirtyMaxY };
    grime.accumulate(dirt);
    stepDirt(dirt, b, true);
    const rb = { minX: dirt.dirtyMinX, minY: dirt.dirtyMinY, maxX: dirt.dirtyMaxX, maxY: dirt.dirtyMaxY };
    grime.accumulate(dirt);
    expect(ra.maxX).toBeGreaterThanOrEqual(ra.minX);
    expect(rb.maxX).toBeGreaterThanOrEqual(rb.minX);
    grime.upload(uploader);
    expect(uploads).toHaveLength(1);
    expect(uploads[0]).toMatchObject({
      minX: Math.min(ra.minX, rb.minX),
      minY: Math.min(ra.minY, rb.minY),
      maxX: Math.max(ra.maxX, rb.maxX) + 1,
      maxY: Math.max(ra.maxY, rb.maxY) + 1,
    });
    expect(Buffer.from(gpu).equals(Buffer.from(dirt.mask))).toBe(true);
    // Nothing pending: the next frame uploads nothing.
    grime.upload(uploader);
    expect(uploads).toHaveLength(1);
  });

  it('uploads nothing while the brush is up', () => {
    const { dirt, pose } = shift();
    const grime = new GroundGrime(viewDirt(dirt));
    const { uploader, uploads } = recordingUploader(Uint8Array.from(dirt.mask), dirt.maskW);
    for (let t = 0; t < 30; t++) {
      pose.yM -= 0.1;
      stepDirt(dirt, pose, false);
      grime.accumulate(dirt);
      if (t % 2 === 1) grime.upload(uploader);
    }
    expect(uploads).toHaveLength(0);
    expect(grime.lastUploadBytes).toBe(0);
  });

  it('clips a pending rect to the mask and owns an R8, nearest, unmipmapped texture of the mask itself', () => {
    const { dirt } = shift();
    const grime = new GroundGrime(viewDirt(dirt));
    const { uploader, uploads } = recordingUploader(Uint8Array.from(dirt.mask), dirt.maskW);
    mergeDirtyRect(grime.pending, -4, -4, 2, 1);
    grime.upload(uploader);
    expect(uploads[0]).toMatchObject({ minX: 0, minY: 0, maxX: 3, maxY: 2 });
    expect(grime.texture.image.data).toBe(dirt.mask);
    expect(grime.texture.image).toMatchObject({ width: 512, height: 384 });
    expect(grime.texture.generateMipmaps).toBe(false);
    expect(grime.texture.flipY).toBe(false);
    expect(grime.texture.unpackAlignment).toBe(1);
    grime.dispose();
  });

  it('accumulates and uploads without allocating (heap delta)', () => {
    const { dirt, pose } = shift();
    const grime = new GroundGrime(viewDirt(dirt));
    let calls = 0;
    const counter: TextureRegionUploader = {
      copyTextureToTexture: () => {
        calls += 1;
      },
    };
    // Like dirt.test.ts: poses precomputed, the mask re-laid every lap so every lap erases, a long warm-up.
    const period = 300;
    const ys = Float64Array.from({ length: period }, (_, k) => 78 - k * 0.1);
    const fresh = Uint8Array.from(dirt.mask);
    const step = (tick: number): void => {
      const k = tick % period;
      if (k === 0) dirt.mask.set(fresh);
      pose.yM = ys[k] as number;
      stepDirt(dirt, pose, true);
      grime.accumulate(dirt);
      if (tick % 2 === 0) grime.upload(counter);
    };
    for (let tick = 0; tick < 60_000; tick++) step(tick);
    expect(calls).toBeGreaterThan(0);
    const delta = measureHeapDelta((tick) => step(60_000 + tick));
    assertHeapDeltaWithinThresholds(delta);
  });
});
