import { describe, expect, it } from 'vitest';
import {
  blitOffsetDevicePx,
  blitSourceTexel,
  clampEven,
  computeViewportLayout,
  INTERNAL_HEIGHT_PX,
  integerScale,
  internalWidthPx,
  LETTERBOX_CSS,
  RT_HEIGHT_PX,
  rtWidthPx,
} from '../../src/render/upscale.ts';

describe('internal width W = clampEven(round(270 × aspect), 432, 640)', () => {
  it('is 480 at 1920x1080 (16:9)', () => {
    expect(computeViewportLayout(1920, 1080, 1).internalWidth).toBe(480);
  });

  it('clamps to 432 at 1600x1200 (4:3)', () => {
    expect(computeViewportLayout(1600, 1200, 1).internalWidth).toBe(432);
  });

  it('clamps to 640 at 3440x1440 (21:9 ultrawide)', () => {
    expect(computeViewportLayout(3440, 1440, 1).internalWidth).toBe(640);
  });

  it('rounds an odd width down to even', () => {
    // 270 × 1.7 = 459 (odd) → 458.
    expect(internalWidthPx(1.7)).toBe(458);
    expect(clampEven(459, 432, 640)).toBe(458);
    expect(clampEven(460, 432, 640)).toBe(460);
  });

  it('keeps the height at 270 and adds a 1 px margin all round for the render target', () => {
    expect(INTERNAL_HEIGHT_PX).toBe(270);
    expect(RT_HEIGHT_PX).toBe(272);
    expect(rtWidthPx(480)).toBe(482);
  });
});

describe('integer scale in device pixels', () => {
  it.each([
    [1920, 1080, 1, 4],
    [2560, 1440, 1, 5],
    [3840, 2160, 1, 8],
    [960, 540, 1, 2],
    [1280, 720, 2, 5],
  ])('%ix%i CSS px at DPR %i → %ix', (cssW, cssH, dpr, expected) => {
    expect(computeViewportLayout(cssW, cssH, dpr).scale).toBe(expected);
  });

  it('gives a windowed 1080p browser (about 1920x950) 3x', () => {
    expect(computeViewportLayout(1920, 950, 1).scale).toBe(3);
  });

  it('never drops below 1x for a window smaller than one frame', () => {
    expect(integerScale(300, 200, 432)).toBe(1);
  });
});

describe('letterbox layout', () => {
  it('centres 1440p at 5x: 1350 px tall with 45 px bars', () => {
    const layout = computeViewportLayout(2560, 1440, 1);
    expect(layout.canvasDeviceWidth).toBe(2400);
    expect(layout.canvasDeviceHeight).toBe(1350);
    expect(layout.canvasDeviceTop).toBe(45);
    expect(layout.canvasDeviceLeft).toBe(80);
  });

  it('fills 1080p at 4x with no bars', () => {
    const layout = computeViewportLayout(1920, 1080, 1);
    expect(layout.canvasDeviceWidth).toBe(1920);
    expect(layout.canvasDeviceHeight).toBe(1080);
    expect(layout.canvasDeviceLeft).toBe(0);
    expect(layout.canvasDeviceTop).toBe(0);
  });

  it('sizes the canvas in device pixels and its style in CSS pixels at DPR 2', () => {
    const layout = computeViewportLayout(1280, 720, 2);
    expect(layout.windowDeviceWidth).toBe(2560);
    expect(layout.canvasDeviceWidth).toBe(2400);
    expect(layout.canvasCssWidth).toBe(1200);
    expect(layout.canvasCssHeight).toBe(675);
    expect(layout.canvasCssLeft).toBe(40);
    expect(layout.canvasCssTop).toBe(22.5);
  });

  it('treats an invalid DPR as 1', () => {
    expect(computeViewportLayout(1920, 1080, 0).scale).toBe(4);
    expect(computeViewportLayout(1920, 1080, Number.NaN).scale).toBe(4);
  });

  it('uses Kerbside-32 index 00 ink for the bars', () => {
    expect(LETTERBOX_CSS).toBe('#0f0e12');
  });
});

describe('sub-pixel blit', () => {
  it('offsets by fraction × scale device pixels, rounded to whole device pixels', () => {
    expect(blitOffsetDevicePx(0, 4)).toBe(0);
    expect(blitOffsetDevicePx(0.5, 4)).toBe(2);
    expect(blitOffsetDevicePx(0.3, 5)).toBe(2);
    expect(blitOffsetDevicePx(0.99, 4)).toBe(4);
  });

  it('samples the inner window at zero offset: device pixel 0 reads RT texel 1', () => {
    expect(blitSourceTexel(0, 0, 4)).toBe(1);
    expect(blitSourceTexel(3, 0, 4)).toBe(1);
    expect(blitSourceTexel(4, 0, 4)).toBe(2);
    expect(blitSourceTexel(480 * 4 - 1, 0, 4)).toBe(480);
  });

  it('a full-texel offset reads one texel further along, into the far margin', () => {
    expect(blitSourceTexel(0, 4, 4)).toBe(2);
    expect(blitSourceTexel(480 * 4 - 1, 4, 4)).toBe(481);
  });
});
