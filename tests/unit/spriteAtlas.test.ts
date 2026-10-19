// Atlas loading with the load-time palette check (SSP-018; TECHNICAL_DESIGN §12.5, ASSET_PIPELINE §9.3):
// the committed actors and items atlases load as R8 index textures with an identity 32×8 swap texture, and an
// atlas with a non-palette (or semi-transparent) pixel, or JSON that disagrees with FRAME, fails at load time.
// Swap tables (SSP-297): the atlas JSON `swaps` (slot_0..slot_7, { "<src>": dst }) builds the swap texture.
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
  swapTableData,
  TRANSPARENT_INDEX,
} from '../../src/render/spriteAtlas.ts';
import { decodePng, encodeRgbaPng } from '../support/png.ts';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const ATLAS_PNG = readFileSync(`${REPO_ROOT}public/assets/atlas/actors.png`);
const ATLAS_JSON: unknown = JSON.parse(readFileSync(`${REPO_ROOT}public/assets/atlas/actors.json`, 'utf8'));
const ITEMS_PNG = readFileSync(`${REPO_ROOT}public/assets/atlas/items.png`);
const ITEMS_JSON: unknown = JSON.parse(readFileSync(`${REPO_ROOT}public/assets/atlas/items.json`, 'utf8'));

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
    // 2048×2048 since SSP-099's animals pushed the actors atlas past 2048×1024 (ART_BIBLE §14.6 cap: 2048²).
    expect([atlas.width, atlas.height]).toEqual([2048, 2048]);
    expect(atlas.indices).toHaveLength(2048 * 2048);
    expect(atlas.indices.every((i) => i < PALETTE_SIZE || i === TRANSPARENT_INDEX)).toBe(true);
    // The atlas corner pixel outside every frame is transparent; Bessie's body centre is opaque.
    const h00 = FRAME['veh.sweeper:body:h00:0'];
    expect(atlas.indices[(h00.y + h00.py) * 2048 + h00.x + h00.px]).toBeLessThan(PALETTE_SIZE);
    expect(atlas.indices[2047 * 2048 + 2047]).toBe(TRANSPARENT_INDEX);
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
    expect(atlas.swapTexture.image.data).toBe(atlas.swaps);
    expect(atlas.swaps).toEqual(identitySwapData());
  });

  it('loads the committed items atlas the same way', async () => {
    const atlas = await loadAtlas('items', sourceOf(ITEMS_PNG, ITEMS_JSON));
    expect(atlas.indices).toHaveLength(atlas.width * atlas.height);
    expect(atlas.indices.every((i) => i < PALETTE_SIZE || i === TRANSPARENT_INDEX)).toBe(true);
    expect(atlas.indices.some((i) => i < PALETTE_SIZE)).toBe(true);
    expect(atlas.indices.some((i) => i === TRANSPARENT_INDEX)).toBe(true);
    expect(atlas.swaps).toEqual(identitySwapData());
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
});

/** Entry (row k, column i) of 32×8 swap data. */
function swapAt(data: Uint8Array, row: number, i: number): number | undefined {
  return data[row * PALETTE_SIZE + i];
}

describe('swap tables (SSP-297)', () => {
  it('with swaps: {}, row k column i of the 32×8 swap texture is i for all 8 rows', async () => {
    const atlas = await loadAtlas('actors', sourceOf(ATLAS_PNG, { ...(ATLAS_JSON as object), swaps: {} }));
    expect(atlas.swapTexture.image.width).toBe(PALETTE_SIZE);
    expect(atlas.swapTexture.image.height).toBe(SWAP_ROWS);
    expect(SWAP_ROWS).toBe(8);
    for (let row = 0; row < SWAP_ROWS; row++) {
      for (let i = 0; i < PALETTE_SIZE; i++) expect(swapAt(atlas.swaps, row, i)).toBe(i);
    }
  });

  it('slot_1 { 21: 19 } maps 21 -> 19 in row 1 and leaves every other entry identity', async () => {
    const json = { ...(ATLAS_JSON as object), swaps: { slot_1: { '21': 19 } } };
    const atlas = await loadAtlas('actors', sourceOf(ATLAS_PNG, json));
    expect(atlas.swapTexture.image.data).toBe(atlas.swaps);
    for (let row = 0; row < SWAP_ROWS; row++) {
      for (let i = 0; i < PALETTE_SIZE; i++) {
        expect(swapAt(atlas.swaps, row, i)).toBe(row === 1 && i === 21 ? 19 : i);
      }
    }
  });

  it('fills several slots and accepts an explicit identity slot_0', () => {
    const data = swapTableData('fixture', {
      slot_0: { '4': 4 },
      slot_2: { '21': 25, '22': 26, '23': 27 },
      slot_7: { '0': 31, '31': 0 },
    });
    expect(swapAt(data, 2, 21)).toBe(25);
    expect(swapAt(data, 2, 23)).toBe(27);
    expect(swapAt(data, 7, 0)).toBe(31);
    expect(swapAt(data, 7, 31)).toBe(0);
    expect(swapAt(data, 0, 4)).toBe(4);
    expect(swapAt(data, 3, 21)).toBe(21);
  });

  it('fails at load for a 9th table, naming the atlas', async () => {
    const nine: Record<string, unknown> = {};
    for (let k = 0; k < 8; k++) nine[`slot_${k}`] = {};
    nine.slot_extra = {};
    const json = { ...(ATLAS_JSON as object), swaps: nine };
    await expect(loadAtlas('actors', sourceOf(ATLAS_PNG, json))).rejects.toThrow(
      "atlas 'actors': 9 swap tables, at most 8 per atlas",
    );
    expect(() => swapTableData('items', { slot_8: {} })).toThrow(
      "atlas 'items': swap table 'slot_8' is not slot_0..slot_7",
    );
  });

  it('fails at load for a destination index >= 32', async () => {
    const json = { ...(ATLAS_JSON as object), swaps: { slot_1: { '21': 32 } } };
    await expect(loadAtlas('actors', sourceOf(ATLAS_PNG, json))).rejects.toThrow(
      "atlas 'actors': swap table slot_1 maps 21 to 32, not an index 0..31",
    );
    expect(() => swapTableData('fixture', { slot_1: { '21': 255 } })).toThrow('maps 21 to 255');
    expect(() => swapTableData('fixture', { slot_1: { '21': -1 } })).toThrow('maps 21 to -1');
    expect(() => swapTableData('fixture', { slot_1: { '21': 1.5 } })).toThrow('maps 21 to 1.5');
    expect(() => swapTableData('fixture', { slot_1: { '21': '19' } })).toThrow('maps 21 to 19');
  });

  it('fails for a source index outside 0..31, a malformed table or a non-identity slot_0', () => {
    expect(() => swapTableData('fixture', { slot_1: { '32': 1 } })).toThrow("source index '32' is not 0..31");
    expect(() => swapTableData('fixture', { slot_1: { '07': 1 } })).toThrow("source index '07'");
    expect(() => swapTableData('fixture', { slot_1: { red: 1 } })).toThrow("source index 'red'");
    expect(() => swapTableData('fixture', { slot_1: [19] })).toThrow('swap table slot_1 must be');
    expect(() => swapTableData('fixture', [])).toThrow('swaps must be an object');
    expect(() => swapTableData('fixture', { slot_0: { '21': 19 } })).toThrow(
      'swap table slot_0 must be identity (maps 21 to 19)',
    );
  });
});
