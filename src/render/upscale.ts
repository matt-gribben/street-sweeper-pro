// Internal resolution, integer upscale and letterbox (TECHNICAL_DESIGN §12.1, ART_BIBLE §3.3).
// The maths is pure and unit-tested; `attachUpscaler` is the only DOM-facing part and owns the canvas size.

/** Internal frame height in internal pixels. Never changes. */
export const INTERNAL_HEIGHT_PX = 270;

/** Narrowest internal width (4:3 and taller windows clamp here). */
export const MIN_INTERNAL_WIDTH_PX = 432;

/** Widest internal width (ultrawide windows clamp here). */
export const MAX_INTERNAL_WIDTH_PX = 640;

/** One-pixel margin on every side of the render target, for the sub-pixel camera offset. */
export const RT_MARGIN_PX = 1;

/** Render target height: the frame plus a margin row above and below. */
export const RT_HEIGHT_PX = INTERNAL_HEIGHT_PX + 2 * RT_MARGIN_PX;

/**
 * Letterbox colour: Kerbside-32 index 00 `ink`. This is the one raw colour CLAUDE.md hard rule 3 permits in CSS;
 * it must stay identical to palette entry 00.
 */
export const LETTERBOX_CSS = '#0f0e12';

/** Clamps `n` to [lo, hi] after rounding it down to an even integer. `lo` and `hi` must be even. */
export function clampEven(n: number, lo: number, hi: number): number {
  const even = 2 * Math.floor(n / 2);
  return Math.min(hi, Math.max(lo, even));
}

/** Adaptive internal width `W = clampEven(round(270 × aspect), 432, 640)` for a window aspect ratio. */
export function internalWidthPx(aspect: number): number {
  return clampEven(Math.round(INTERNAL_HEIGHT_PX * aspect), MIN_INTERNAL_WIDTH_PX, MAX_INTERNAL_WIDTH_PX);
}

/** Render target width for an internal width: the frame plus a margin column left and right. */
export function rtWidthPx(internalWidth: number): number {
  return internalWidth + 2 * RT_MARGIN_PX;
}

/**
 * Integer upscale factor `floor(min(winW / W, winH / 270))` with the window in DEVICE pixels.
 * Never below 1: a window smaller than one internal frame shows it at 1x, cropped by the centring.
 */
export function integerScale(deviceWidth: number, deviceHeight: number, internalWidth: number): number {
  const fit = Math.floor(Math.min(deviceWidth / internalWidth, deviceHeight / INTERNAL_HEIGHT_PX));
  return Math.max(1, fit);
}

/** Everything the canvas and renderer need for one window size. Device pixels unless suffixed Css. */
export type ViewportLayout = {
  /** Window size in device pixels (CSS size × devicePixelRatio, rounded). */
  readonly windowDeviceWidth: number;
  readonly windowDeviceHeight: number;
  readonly devicePixelRatio: number;
  /** Adaptive internal width W; the internal height is always INTERNAL_HEIGHT_PX. */
  readonly internalWidth: number;
  /** Integer upscale factor in device pixels per internal pixel. */
  readonly scale: number;
  /** Canvas backing-store size: exactly W × scale by 270 × scale device pixels. */
  readonly canvasDeviceWidth: number;
  readonly canvasDeviceHeight: number;
  /** Top-left of the canvas inside the window, in device pixels (the letterbox bar widths). */
  readonly canvasDeviceLeft: number;
  readonly canvasDeviceTop: number;
  /** The same rectangle in CSS pixels, for the canvas style. */
  readonly canvasCssWidth: number;
  readonly canvasCssHeight: number;
  readonly canvasCssLeft: number;
  readonly canvasCssTop: number;
};

/** Computes the internal width, integer scale and centred canvas rectangle for a window. */
export function computeViewportLayout(
  cssWidth: number,
  cssHeight: number,
  devicePixelRatio: number,
): ViewportLayout {
  const dpr = devicePixelRatio > 0 && Number.isFinite(devicePixelRatio) ? devicePixelRatio : 1;
  const windowDeviceWidth = Math.max(1, Math.round(cssWidth * dpr));
  const windowDeviceHeight = Math.max(1, Math.round(cssHeight * dpr));
  const internalWidth = internalWidthPx(windowDeviceWidth / windowDeviceHeight);
  const scale = integerScale(windowDeviceWidth, windowDeviceHeight, internalWidth);
  const canvasDeviceWidth = internalWidth * scale;
  const canvasDeviceHeight = INTERNAL_HEIGHT_PX * scale;
  // Floor keeps the canvas on whole device pixels; a negative value centres an oversized (1x) frame.
  const canvasDeviceLeft = Math.floor((windowDeviceWidth - canvasDeviceWidth) / 2);
  const canvasDeviceTop = Math.floor((windowDeviceHeight - canvasDeviceHeight) / 2);
  return {
    windowDeviceWidth,
    windowDeviceHeight,
    devicePixelRatio: dpr,
    internalWidth,
    scale,
    canvasDeviceWidth,
    canvasDeviceHeight,
    canvasDeviceLeft,
    canvasDeviceTop,
    canvasCssWidth: canvasDeviceWidth / dpr,
    canvasCssHeight: canvasDeviceHeight / dpr,
    canvasCssLeft: canvasDeviceLeft / dpr,
    canvasCssTop: canvasDeviceTop / dpr,
  };
}

/**
 * Sub-pixel blit offset in device pixels for a camera remainder of `fractionPx` internal pixels in [0, 1).
 * Rounded to whole device pixels so every internal pixel still covers exactly `scale` device pixels.
 * The result lies in [0, scale]; `scale` means one whole internal pixel, which the 1 px RT margin absorbs.
 */
export function blitOffsetDevicePx(fractionPx: number, scale: number): number {
  return Math.round(fractionPx * scale);
}

/**
 * Render-target texel sampled for one canvas device pixel, along one axis, in top-down/left-right order.
 * Mirrors the blit fragment shader in Renderer.ts so the mapping is testable without WebGL.
 * For device pixels inside the canvas and offsets from `blitOffsetDevicePx`, the result lies in
 * [0, W + 2) horizontally and [0, 272) vertically.
 */
export function blitSourceTexel(devicePx: number, offsetDevicePx: number, scale: number): number {
  return Math.floor((devicePx + offsetDevicePx) / scale) + RT_MARGIN_PX;
}

/** A render-target texel, top-down/left-right (the blit's coordinates before its row flip). */
export type RtTexel = { x: number; y: number };

/**
 * Render-target texel the blit samples for canvas device pixel (dx, dy) when the UI pass is in the frame
 * (SSP-069). Mirrors the blit fragment shader in Renderer.ts: the world is shifted by the sub-pixel offset
 * (blitSourceTexel on each axis), but when either the unshifted texel or the shifted one is a UI texel (`isUi`,
 * the mask's B flag) the unshifted texel is used. UI pixels therefore cover exactly the device block
 * [x·scale, (x + 1)·scale) × [y·scale, (y + 1)·scale) of their internal pixel (x, y) at every offset; the price
 * is that up to `offset` device pixels of world beside a UI pixel show the unshifted world texel. Writes `out`.
 */
export function blitUiAwareTexel(
  dx: number,
  dy: number,
  offsetX: number,
  offsetY: number,
  scale: number,
  isUi: (x: number, y: number) => boolean,
  out: RtTexel,
): RtTexel {
  const sx = blitSourceTexel(dx, offsetX, scale);
  const sy = blitSourceTexel(dy, offsetY, scale);
  const ux = blitSourceTexel(dx, 0, scale);
  const uy = blitSourceTexel(dy, 0, scale);
  const ui = isUi(ux, uy) || isUi(sx, sy);
  out.x = ui ? ux : sx;
  out.y = ui ? uy : sy;
  return out;
}

/** Owner of the canvas size. Calls `onLayout` once immediately and again on every resize or DPR change. */
export function attachUpscaler(
  canvas: HTMLCanvasElement,
  onLayout: (layout: ViewportLayout) => void,
): () => void {
  document.documentElement.style.background = LETTERBOX_CSS;
  document.body.style.background = LETTERBOX_CSS;
  const style = canvas.style;
  style.position = 'absolute';
  style.imageRendering = 'pixelated';
  style.display = 'block';

  const apply = (): void => {
    const layout = computeViewportLayout(window.innerWidth, window.innerHeight, window.devicePixelRatio);
    canvas.width = layout.canvasDeviceWidth;
    canvas.height = layout.canvasDeviceHeight;
    style.width = `${layout.canvasCssWidth}px`;
    style.height = `${layout.canvasCssHeight}px`;
    style.left = `${layout.canvasCssLeft}px`;
    style.top = `${layout.canvasCssTop}px`;
    onLayout(layout);
  };

  // A `(resolution: Ndppx)` query fires `change` once when the DPR leaves N (browser zoom, moving the window
  // to another monitor), so it is re-armed with the new DPR after every change.
  let dprQuery: MediaQueryList | null = null;
  const onDprChange = (): void => {
    armDprQuery();
    apply();
  };
  const armDprQuery = (): void => {
    dprQuery?.removeEventListener('change', onDprChange);
    dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    dprQuery.addEventListener('change', onDprChange);
  };

  window.addEventListener('resize', apply);
  armDprQuery();
  apply();

  return () => {
    window.removeEventListener('resize', apply);
    dprQuery?.removeEventListener('change', onDprChange);
  };
}
