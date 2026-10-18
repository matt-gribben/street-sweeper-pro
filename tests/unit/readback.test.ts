// readFrame row order (SSP-019): WebGL readPixels rows are bottom-up; flipRgbaRows makes row 0 the top.
import { describe, expect, it } from 'vitest';
import { flipRgbaRows, RGBA_BYTES } from '../../src/render/readback.ts';

describe('flipRgbaRows', () => {
  it('reverses the rows of a 2x3 image and keeps columns and channels', () => {
    // Bottom-up readPixels output: row 0 (bottom) holds 1s, row 2 (top) holds 3s; columns differ in green.
    const bottomUp = new Uint8Array([
      ...[1, 0, 0, 255, 1, 1, 0, 255],
      ...[2, 0, 0, 255, 2, 1, 0, 255],
      ...[3, 0, 0, 255, 3, 1, 0, 255],
    ]);
    expect(Array.from(flipRgbaRows(bottomUp, 2, 3))).toEqual([
      ...[3, 0, 0, 255, 3, 1, 0, 255],
      ...[2, 0, 0, 255, 2, 1, 0, 255],
      ...[1, 0, 0, 255, 1, 1, 0, 255],
    ]);
  });

  it('is its own inverse and leaves the source untouched', () => {
    const src = Uint8Array.from({ length: 480 * 270 * RGBA_BYTES }, (_, i) => (i * 31) % 251);
    const copy = Uint8Array.from(src);
    const flipped = flipRgbaRows(src, 480, 270);
    expect(flipped).not.toBe(src);
    expect(src).toEqual(copy);
    expect(flipRgbaRows(flipped, 480, 270)).toEqual(src);
    // Row 0 of the result is the last row of the source.
    expect(flipped.subarray(0, 480 * 4)).toEqual(src.subarray(269 * 480 * 4));
  });

  it('rejects a buffer of the wrong size', () => {
    expect(() => flipRgbaRows(new Uint8Array(15), 2, 2)).toThrow(RangeError);
    expect(() => flipRgbaRows(new Uint8Array(16), 2.5, 2)).toThrow(RangeError);
  });
});
