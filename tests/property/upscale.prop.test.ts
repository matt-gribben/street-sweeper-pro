import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  blitOffsetDevicePx,
  blitSourceTexel,
  computeViewportLayout,
  INTERNAL_HEIGHT_PX,
  MAX_INTERNAL_WIDTH_PX,
  MIN_INTERNAL_WIDTH_PX,
  RT_HEIGHT_PX,
  rtWidthPx,
} from '../../src/render/upscale.ts';

const cssSize = fc.integer({ min: 1, max: 8000 });
const dpr = fc.constantFrom(0.5, 0.75, 1, 1.25, 1.5, 2, 2.25, 2.5, 3, 4);

describe('viewport layout properties', () => {
  it('W is even and within [432, 640] for any window', () => {
    fc.assert(
      fc.property(cssSize, cssSize, dpr, (w, h, ratio) => {
        const { internalWidth } = computeViewportLayout(w, h, ratio);
        expect(internalWidth % 2).toBe(0);
        expect(internalWidth).toBeGreaterThanOrEqual(MIN_INTERNAL_WIDTH_PX);
        expect(internalWidth).toBeLessThanOrEqual(MAX_INTERNAL_WIDTH_PX);
      }),
    );
  });

  it('the scale is the largest integer that fits, and the canvas is centred', () => {
    fc.assert(
      fc.property(cssSize, cssSize, dpr, (w, h, ratio) => {
        const layout = computeViewportLayout(w, h, ratio);
        const { scale, internalWidth, windowDeviceWidth, windowDeviceHeight } = layout;
        expect(Number.isInteger(scale)).toBe(true);
        expect(scale).toBeGreaterThanOrEqual(1);
        expect(layout.canvasDeviceWidth).toBe(internalWidth * scale);
        expect(layout.canvasDeviceHeight).toBe(INTERNAL_HEIGHT_PX * scale);
        const fits = (s: number): boolean =>
          internalWidth * s <= windowDeviceWidth && INTERNAL_HEIGHT_PX * s <= windowDeviceHeight;
        if (fits(1)) {
          expect(fits(scale)).toBe(true);
          expect(layout.canvasDeviceLeft).toBeGreaterThanOrEqual(0);
          expect(layout.canvasDeviceTop).toBeGreaterThanOrEqual(0);
        }
        expect(fits(scale + 1)).toBe(false);
        // Centred to within one device pixel.
        const right = windowDeviceWidth - layout.canvasDeviceLeft - layout.canvasDeviceWidth;
        const bottom = windowDeviceHeight - layout.canvasDeviceTop - layout.canvasDeviceHeight;
        expect(Math.abs(right - layout.canvasDeviceLeft)).toBeLessThanOrEqual(1);
        expect(Math.abs(bottom - layout.canvasDeviceTop)).toBeLessThanOrEqual(1);
      }),
    );
  });

  it('the blit never samples outside the (W+2)x272 target for any remainder', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: MIN_INTERNAL_WIDTH_PX / 2, max: MAX_INTERNAL_WIDTH_PX / 2 }).map((n) => n * 2),
        fc.integer({ min: 1, max: 12 }),
        fc.double({ min: 0, max: 1, maxExcluded: true, noNaN: true }),
        fc.double({ min: 0, max: 1, maxExcluded: true, noNaN: true }),
        (w, scale, fx, fy) => {
          const ox = blitOffsetDevicePx(fx, scale);
          const oy = blitOffsetDevicePx(fy, scale);
          expect(ox).toBeGreaterThanOrEqual(0);
          expect(ox).toBeLessThanOrEqual(scale);
          const left = blitSourceTexel(0, ox, scale);
          const right = blitSourceTexel(w * scale - 1, ox, scale);
          const top = blitSourceTexel(0, oy, scale);
          const bottom = blitSourceTexel(INTERNAL_HEIGHT_PX * scale - 1, oy, scale);
          expect(left).toBeGreaterThanOrEqual(0);
          expect(right).toBeLessThan(rtWidthPx(w));
          expect(top).toBeGreaterThanOrEqual(0);
          expect(bottom).toBeLessThan(RT_HEIGHT_PX);
          // A whole-texel offset (0 or `scale`) shows exactly W x 270 texels. Any sub-texel offset shows a
          // partial texel at each edge, so W+1 (271) distinct texels; that is what the 1 px margin is for.
          expect(right - left + 1).toBe(ox % scale === 0 ? w : w + 1);
          expect(bottom - top + 1).toBe(oy % scale === 0 ? INTERNAL_HEIGHT_PX : INTERNAL_HEIGHT_PX + 1);
          // Every texel fully inside the canvas stays exactly `scale` device pixels wide (integer offset).
          const firstFull = left + (ox % scale === 0 ? 0 : 1);
          const firstFullStartPx = (firstFull - 1) * scale - ox;
          expect(blitSourceTexel(firstFullStartPx, ox, scale)).toBe(firstFull);
          expect(blitSourceTexel(firstFullStartPx + scale - 1, ox, scale)).toBe(firstFull);
          expect(blitSourceTexel(firstFullStartPx + scale, ox, scale)).toBe(firstFull + 1);
        },
      ),
    );
  });
});
