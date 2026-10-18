// Atlas loading with the load-time palette check (SSP-018; TECHNICAL_DESIGN §12.5, ASSET_PIPELINE §9.3):
// the committed actors atlas loads as an R8 index texture with an identity 32×8 swap texture, and an atlas
// with a non-palette (or semi-transparent) pixel, or JSON that disagrees with FRAME, fails at load time.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FRAME } from '../../src/gen/assets.ts';
import { KERBSIDE32, PALETTE_SIZE, paletteIndex } from '../../src/render/palettePass.ts';
import {
  type AtlasSource,
  atlasUrl,
  identitySwapData,
  indexAtlasPixels,
  loadAtlas,
  type RgbaImage,
  SWAP_ROWS,
  TRANSPARENT_INDEX,
} from '../../src/render/spriteAtlas.ts';
import { decodePng, encodeRgbaPng } from '../support/png.ts';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const ATLAS_PNG = readFileSync(`${REPO_ROOT}public/assets/atlas/actors.png`);
const ATLAS_JSON: unknown = JSON.parse(readFileSync(`${REPO_ROOT}public/assets/atlas/actors.json`, 'utf8'));

/** A source serving `png` bytes and `json` for whatever URL is asked, decoding PNGs like a browser would. */
function sourceOf(png: Uint8Array, json: unknown = ATLAS_JSON): AtlasSource & { urls: string[] } {
  const urls: string[] = [];
  return {
    urls,
    fetchJson: async (url: string): Promise<unknown> => {
      urls.push(url);
      return structuredClone(json);
    },
    fetchImage: async (url: string): Promise<RgbaImage> => {
      urls.push(url);
      return decodePng(png);
    },
  };
}

/** The committed atlas with pixel (x, y) replaced by `rgba`, re-encoded as a PNG. */
function atlasWithPixel(x: number, y: number, rgba: readonly [number, number, number, number]): Uint8Array {
  const image = decodePng(ATLAS_PNG);
  const data = new Uint8Array(image.data);
  data.set(rgba, (y * image.width + x) * 4);
  return encodeRgbaPng({ width: image.width, height: image.height, data });
}

function rgbOf(index: number): [number, number, number] {
  return [
    KERBSIDE32.rgb[index * 3] ?? 0,
    KERBSIDE32.rgb[index * 3 + 1] ?? 0,
    KERBSIDE32.rgb[index * 3 + 2] ?? 0,
  ];
}

describe('loadAtlas: the committed actors atlas', () => {
  it('fetches <base>assets/atlas/actors.{json,png} and converts every pixel to a Kerbside-32 index', async () => {
    const source = sourceOf(ATLAS_PNG);
    const atlas = await loadAtlas('actors', source);
    expect(source.urls.sort()).toEqual([atlasUrl('actors', 'json'), atlasUrl('actors', 'png')].sort());
    expect([atlas.width, atlas.height]).toEqual([2048, 1024]);
    expect(atlas.indices).toHaveLength(2048 * 1024);
    expect(atlas.indices.every((i) => i < PALETTE_SIZE || i === TRANSPARENT_INDEX)).toBe(true);
    // The atlas corner pixel outside every frame is transparent; Bessie's body centre is opaque.
    const h00 = FRAME['veh.sweeper:body:h00:0'];
    expect(atlas.indices[(h00.y + h00.py) * 2048 + h00.x + h00.px]).toBeLessThan(PALETTE_SIZE);
    expect(atlas.indices[1023 * 2048 + 2047]).toBe(TRANSPARENT_INDEX);
    // Bessie is sweeper_yellow somewhere in every heading.
    const yellow = paletteIndex('sweeper_yellow');
    const rect = FRAME['veh.sweeper:body:h09:0'];
    let found = false;
    for (let y = rect.y; y < rect.y + rect.h && !found; y++) {
      for (let x = rect.x; x < rect.x + rect.w; x++) if (atlas.indices[y * 2048 + x] === yellow) found = true;
    }
    expect(found).toBe(true);
  });

  it('uploads R8 textures: the index atlas and an identity 32×8 swap texture', async () => {
    const atlas = await loadAtlas('actors', sourceOf(ATLAS_PNG));
    expect(atlas.texture.image.width).toBe(2048);
    expect(atlas.texture.flipY).toBe(false);
    expect(atlas.swapTexture.image.width).toBe(PALETTE_SIZE);
    expect(atlas.swapTexture.image.height).toBe(SWAP_ROWS);
    const swap = identitySwapData();
    for (let row = 0; row < SWAP_ROWS; row++) {
      for (let i = 0; i < PALETTE_SIZE; i++) expect(swap[row * PALETTE_SIZE + i]).toBe(i);
    }
  });

  it('resolves atlas URLs against the app base', () => {
    expect(atlasUrl('actors', 'png', './')).toBe('./assets/atlas/actors.png');
    expect(atlasUrl('actors', 'json', '/ssp/')).toBe('/ssp/assets/atlas/actors.json');
  });
});

describe('loadAtlas: load-time errors', () => {
  it('throws at load for a non-palette pixel, naming the atlas and the pixel', async () => {
    const h03 = FRAME['veh.sweeper:body:h03:0'];
    const x = h03.x + h03.px;
    const y = h03.y + h03.py;
    // One off from sweeper_yellow: invisible to the eye, still not Kerbside-32.
    const [r, g, b] = rgbOf(paletteIndex('sweeper_yellow'));
    const png = atlasWithPixel(x, y, [r, g, b === 255 ? 254 : b + 1, 255]);
    await expect(loadAtlas('actors', sourceOf(png))).rejects.toThrow(
      `atlas 'actors': pixel (${x}, ${y}) colour`,
    );
    await expect(loadAtlas('actors', sourceOf(png))).rejects.toThrow('is not in Kerbside-32');
  });

  it('throws at load for a semi-transparent pixel', async () => {
    const [r, g, b] = rgbOf(3);
    const png = atlasWithPixel(5, 7, [r, g, b, 128]);
    await expect(loadAtlas('actors', sourceOf(png))).rejects.toThrow(
      "atlas 'actors': pixel (5, 7) is semi-transparent (alpha 128)",
    );
  });

  it('indexes exact palette colours and maps alpha 0 to the transparent index', () => {
    const data = new Uint8Array(PALETTE_SIZE * 4 + 4);
    for (let i = 0; i < PALETTE_SIZE; i++) data.set([...rgbOf(i), 255], i * 4);
    data.set([1, 2, 3, 0], PALETTE_SIZE * 4); // colour ignored when fully transparent
    const indices = indexAtlasPixels('fixture', { width: PALETTE_SIZE + 1, height: 1, data });
    expect(Array.from(indices)).toEqual([
      ...Array.from({ length: PALETTE_SIZE }, (_, i) => i),
      TRANSPARENT_INDEX,
    ]);
  });

  it('throws when the atlas JSON disagrees with the generated FRAME table', async () => {
    const stale = structuredClone(ATLAS_JSON) as { frames: Record<string, { py: number }> };
    const doris = stale.frames['npc.old_woman:idle:s:0'];
    if (doris === undefined) throw new Error('fixture: Doris missing from actors.json');
    doris.py = 12;
    await expect(loadAtlas('actors', sourceOf(ATLAS_PNG, stale))).rejects.toThrow(
      'frame npc.old_woman:idle:s:0 differs from src/gen/assets.ts',
    );
    const extra = structuredClone(ATLAS_JSON) as { frames: Record<string, unknown> };
    extra.frames['veh.sweeper:body:h32:0'] = { x: 0, y: 0, w: 1, h: 1, px: 0, py: 0 };
    await expect(loadAtlas('actors', sourceOf(ATLAS_PNG, extra))).rejects.toThrow(
      'is not in src/gen/assets.ts',
    );
    const missing = structuredClone(ATLAS_JSON) as { frames: Record<string, unknown> };
    delete missing.frames['veh.sweeper:body:h00:0'];
    await expect(loadAtlas('actors', sourceOf(ATLAS_PNG, missing))).rejects.toThrow('missing from the JSON');
  });

  it('refuses swap tables until SSP-297 parses them', async () => {
    const swapped = { ...(ATLAS_JSON as Record<string, unknown>), swaps: { slot_1: { '21': 19 } } };
    await expect(loadAtlas('actors', sourceOf(ATLAS_PNG, swapped))).rejects.toThrow('swaps must be {}');
  });
});
