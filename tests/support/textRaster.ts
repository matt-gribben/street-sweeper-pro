// CPU rasteriser for bitmap text (SSP-069): a GlyphSink (src/ui/bitmapText.ts) that paints each quad's atlas
// texels into a palette-index image exactly as the UI pass shader does (transparent texels skipped, the recolour
// pair applied, later quads over earlier ones). Tests lay text out with the real BitmapFont into it and compare
// the GPU frame with the result pixel for pixel.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FRAME, type FrameId } from '../../src/gen/assets.ts';
import { indexAtlasPixels, TRANSPARENT_INDEX } from '../../src/render/spriteAtlas.ts';
import { BitmapFont, type GlyphSink, parseFontMetrics } from '../../src/ui/bitmapText.ts';
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
export class TextRaster implements GlyphSink {
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
    if (f.atlas !== this.atlas.name) throw new Error(`${frame} is not in atlas ${this.atlas.name}`);
    for (let ty = 0; ty < f.h; ty++) {
      for (let tx = 0; tx < f.w; tx++) {
        let idx = this.atlas.indices[(f.y + ty) * this.atlas.width + f.x + tx] ?? TRANSPARENT_INDEX;
        if (idx === TRANSPARENT_INDEX) continue;
        if (idx === recolourFrom) idx = recolourTo;
        const x = xPx + tx - f.px;
        const y = yPx + ty - f.py;
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
