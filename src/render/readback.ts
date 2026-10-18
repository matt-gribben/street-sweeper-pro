// Pixel readback helpers for the `?test=1` hook `readFrame()` (TECHNICAL_DESIGN §18.4, §18.5).
// WebGL's readPixels returns rows bottom-up (row 0 is the bottom of the read rectangle); the visual tests and
// every PNG want row 0 at the top. Pure maths, unit-tested without WebGL.

/** Bytes per RGBA8 pixel. */
export const RGBA_BYTES = 4;

/**
 * Returns a copy of `src`, a `width` × `height` RGBA8 image, with its rows in reverse order: bottom-up readPixels
 * output becomes top-down (and vice versa). Columns and channel order are untouched.
 */
export function flipRgbaRows(src: Uint8Array, width: number, height: number): Uint8Array {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 0 || height < 0) {
    throw new RangeError(`image size must be non-negative integers, got ${width}x${height}`);
  }
  const rowBytes = width * RGBA_BYTES;
  if (src.length !== rowBytes * height) {
    throw new RangeError(
      `expected ${rowBytes * height} bytes for ${width}x${height} RGBA, got ${src.length}`,
    );
  }
  const out = new Uint8Array(src.length);
  for (let row = 0; row < height; row++) {
    const from = (height - 1 - row) * rowBytes;
    out.set(src.subarray(from, from + rowBytes), row * rowBytes);
  }
  return out;
}
