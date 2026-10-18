// The visual-golden helper's pure parts (SSP-022, tests/support/visualGolden.ts): PNG round trip through pngjs,
// threshold-0 comparison that catches a single pixel (even one channel off by 1), and the golden write policy.
import { describe, expect, it } from 'vitest';
import {
  compareFrames,
  decodeFramePng,
  encodeFramePng,
  frameSha256,
  framesMatch,
  goldenAction,
  PIXELMATCH_THRESHOLD,
  type RgbaFrame,
} from '../support/visualGolden.ts';

/** A deterministic opaque test frame (no randomness: a fixed pattern of channel values). */
function patternFrame(width: number, height: number): RgbaFrame {
  const data = new Uint8Array(width * height * 4);
  for (let p = 0; p < width * height; p++) {
    data[p * 4] = (p * 37) & 0xff;
    data[p * 4 + 1] = (p * 91) & 0xff;
    data[p * 4 + 2] = (p * 13) & 0xff;
    data[p * 4 + 3] = 255;
  }
  return { width, height, data };
}

function withPixel(frame: RgbaFrame, x: number, y: number, rgba: readonly number[]): RgbaFrame {
  const data = frame.data.slice();
  data.set(rgba, (y * frame.width + x) * 4);
  return { width: frame.width, height: frame.height, data };
}

describe('visual golden helper', () => {
  it('compares at pixelmatch threshold 0', () => {
    expect(PIXELMATCH_THRESHOLD).toBe(0);
  });

  it('round-trips a frame through pngjs byte-identically, with stable PNG bytes', () => {
    const frame = patternFrame(17, 9);
    const png = encodeFramePng(frame);
    const decoded = decodeFramePng(png);
    expect([decoded.width, decoded.height]).toEqual([17, 9]);
    expect(Buffer.from(decoded.data).equals(Buffer.from(frame.data))).toBe(true);
    expect(encodeFramePng(decoded).equals(png)).toBe(true);
    expect(frameSha256(decoded)).toBe(frameSha256(frame));
  });

  it('passes identical frames', () => {
    const result = compareFrames(patternFrame(32, 16), patternFrame(32, 16));
    expect(result).toMatchObject({ sizeMatches: true, pixelmatchCount: 0, exactCount: 0 });
    expect(framesMatch(result)).toBe(true);
  });

  it('flags a single changed pixel and marks it in the diff image', () => {
    const expected = patternFrame(32, 16);
    const actual = withPixel(expected, 5, 7, [255, 255, 255, 255]);
    const result = compareFrames(expected, actual);
    expect(result.pixelmatchCount).toBe(1);
    expect(result.exactCount).toBe(1);
    expect(framesMatch(result)).toBe(false);
    const diff = result.diff;
    if (diff === null) throw new Error('diff image missing');
    const o = (7 * 32 + 5) * 4;
    // pixelmatch's default diff colour is red.
    expect(Array.from(diff.data.subarray(o, o + 4))).toEqual([255, 0, 0, 255]);
  });

  it('flags a pixel one channel step away (any byte difference is a real change)', () => {
    const expected = patternFrame(8, 8);
    const o = (3 * 8 + 2) * 4;
    const nudged = [expected.data[o] ?? 0, expected.data[o + 1] ?? 0, (expected.data[o + 2] ?? 0) ^ 1, 255];
    const result = compareFrames(expected, withPixel(expected, 2, 3, nudged));
    expect(result.exactCount).toBe(1);
    expect(framesMatch(result)).toBe(false);
  });

  it('fails a size mismatch without comparing', () => {
    const result = compareFrames(patternFrame(8, 8), patternFrame(8, 9));
    expect(result).toEqual({ sizeMatches: false, pixelmatchCount: -1, exactCount: -1, diff: null });
    expect(framesMatch(result)).toBe(false);
  });

  it('writes goldens only under --update-snapshots=all or changed, and never creates one implicitly', () => {
    expect(goldenAction('none', true, true)).toBe('pass');
    expect(goldenAction('all', true, true)).toBe('pass');
    expect(goldenAction('missing', true, false)).toBe('fail-diff');
    expect(goldenAction('none', true, false)).toBe('fail-diff');
    expect(goldenAction('missing', false, false)).toBe('fail-missing');
    expect(goldenAction('none', false, false)).toBe('fail-missing');
    expect(goldenAction('all', true, false)).toBe('write');
    expect(goldenAction('changed', true, false)).toBe('write');
    expect(goldenAction('all', false, false)).toBe('write');
    expect(goldenAction('changed', false, false)).toBe('write');
  });
});
