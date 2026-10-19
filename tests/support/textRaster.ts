// CPU rasteriser for the UI pass (SSP-069, SSP-285): a GlyphSink (src/ui/bitmapText.ts) and PanelSink
// (src/ui/panels.ts) that paints each quad's atlas texels into a palette-index image exactly as the UI pass shader
// does (transparent texels skipped, the recolour pair applied, later quads over earlier ones). Tests lay text and
// panels out with the real BitmapFont and Panels into it and compare the GPU frame with the result pixel for pixel.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FRAME, type FrameId } from '../../src/gen/assets.ts';
import { indexAtlasPixels, TRANSPARENT_INDEX } from '../../src/render/spriteAtlas.ts';
import { BitmapFont, parseFontMetrics } from '../../src/ui/bitmapText.ts';
import type { PanelSink } from '../../src/ui/panels.ts';
import { decodePng } from './png.ts';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** An atlas as palette indices (TRANSPARENT_INDEX for transparent), rows top to bottom. */
export type IndexedAtlas = { readonly name: string; readonly width: number; readonly indices: Uint8Array };

/** Reads `public/assets/atlas/<name>.png` as palette indices. */
export function readIndexedAtlas(name: string): IndexedAtlas {
  const image = decodePng(readFileSync(`${REPO_ROOT}public/assets/atlas/${name}.png`));
  return { name, width: image.width, indices: indexAtlasPixels(name, image) };
}

/** Reads the raw metrics JSON `public/assets/fonts/<name>.json`. */
export function readFontJson(name: string): unknown {
  return JSON.parse(readFileSync(`${REPO_ROOT}public/assets/fonts/${name}.json`, 'utf8'));
}

/** Reads and validates `public/assets/fonts/<name>.json` into a BitmapFont. */
export function readBitmapFont(name: string): BitmapFont {
  return new BitmapFont(parseFontMetrics(readFontJson(name)));
}

/** Palette-index image of what UI quads draw: -1 where no quad covers the pixel. */
export class TextRaster implements PanelSink {
  readonly width: number;
  readonly height: number;
  readonly index: Int16Array;
  private readonly atlas: IndexedAtlas;

  constructor(width: number, height: number, atlas: IndexedAtlas) {
    this.width = width;
    this.height = height;
    this.atlas = atlas;
    this.index = new Int16Array(width * height).fill(-1);
  }

  add(frame: FrameId, xPx: number, yPx: number, recolourFrom: number, recolourTo: number): void {
    const f = FRAME[frame];
    this.paint(frame, 0, 0, f.w, f.h, xPx - f.px, yPx - f.py, recolourFrom, recolourTo);
  }

  addRegion(
    frame: FrameId,
    srcXPx: number,
    srcYPx: number,
    wPx: number,
    hPx: number,
    xPx: number,
    yPx: number,
    recolourFrom: number,
    recolourTo: number,
  ): void {
    const f = FRAME[frame];
    if (srcXPx < 0 || srcYPx < 0 || wPx < 1 || hPx < 1 || srcXPx + wPx > f.w || srcYPx + hPx > f.h) {
      throw new Error(`region (${srcXPx}, ${srcYPx}) ${wPx}x${hPx} is outside ${frame}`);
    }
    this.paint(frame, srcXPx, srcYPx, wPx, hPx, xPx, yPx, recolourFrom, recolourTo);
  }

  /** Paints the w × h region of `frame` at (sx, sy) with its top-left at (left, top). */
  private paint(
    frame: FrameId,
    sx: number,
    sy: number,
    w: number,
    h: number,
    left: number,
    top: number,
    recolourFrom: number,
    recolourTo: number,
  ): void {
    const f = FRAME[frame];
    if (f.atlas !== this.atlas.name) throw new Error(`${frame} is not in atlas ${this.atlas.name}`);
    for (let ty = 0; ty < h; ty++) {
      for (let tx = 0; tx < w; tx++) {
        let idx = this.atlas.indices[(f.y + sy + ty) * this.atlas.width + f.x + sx + tx] ?? TRANSPARENT_INDEX;
        if (idx === TRANSPARENT_INDEX) continue;
        if (idx === recolourFrom) idx = recolourTo;
        const x = left + tx;
        const y = top + ty;
        if (x < 0 || y < 0 || x >= this.width || y >= this.height) continue;
        this.index[y * this.width + x] = idx;
      }
    }
  }

  /** Palette index at (x, y), or -1 where no quad covers it. */
  at(x: number, y: number): number {
    return this.index[y * this.width + x] ?? -1;
  }

  /** Number of covered pixels. */
  get covered(): number {
    let n = 0;
    for (const v of this.index) if (v >= 0) n++;
    return n;
  }
}
