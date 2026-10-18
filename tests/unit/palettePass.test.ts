// Palette pass unit tests (TECHNICAL_DESIGN §12.6, SSP-016): palette identity through the LUT, exact parity of
// nearestIndex with the forge on the shared 4,096-sample fixture, LUT layout, and the uploaded table data.
import { describe, expect, it } from 'vitest';
import paletteJson from '../../assets-src/palette/kerbside32.json' with { type: 'json' };
import {
  buildLut,
  buildPaletteData,
  buildRemapData,
  KERBSIDE32,
  type Kerbside32,
  kerbside32Lut,
  LUT_SIZE,
  lutCell,
  lutRepresentative,
  nearestIndex,
  PALETTE_SIZE,
  paletteIndex,
  paletteOklab,
  parsePalette,
  remapIndex,
  srgbToOklab,
} from '../../src/render/palettePass.ts';
import { LETTERBOX_CSS } from '../../src/render/upscale.ts';
import fixtureJson from '../fixtures/palette_oklab_4096.json' with { type: 'json' };

type FixtureEntry = readonly [number, number, number, number];

/** Hand-written guard for the forge fixture (CLAUDE.md §5.1: no zod). */
function fixtureEntries(data: unknown): FixtureEntry[] {
  if (typeof data !== 'object' || data === null || !('entries' in data) || !Array.isArray(data.entries)) {
    throw new Error('fixture: missing entries');
  }
  return data.entries.map((row: unknown, i: number): FixtureEntry => {
    if (
      !Array.isArray(row) ||
      row.length !== 4 ||
      !row.every((v: unknown) => typeof v === 'number' && Number.isInteger(v))
    ) {
      throw new Error(`fixture: entries[${i}] is not [r, g, b, index]`);
    }
    return [row[0], row[1], row[2], row[3]];
  });
}

const FIXTURE = fixtureEntries(fixtureJson);

function rgbOf(index: number, palette: Kerbside32 = KERBSIDE32): [number, number, number] {
  const rgb = palette.rgb;
  return [rgb[index * 3] ?? -1, rgb[index * 3 + 1] ?? -1, rgb[index * 3 + 2] ?? -1];
}

describe('kerbside32.json loading', () => {
  it('loads 32 colours with names and 32-entry night/shadow tables', () => {
    expect(KERBSIDE32.names).toHaveLength(PALETTE_SIZE);
    expect(KERBSIDE32.rgb).toHaveLength(PALETTE_SIZE * 3);
    expect(KERBSIDE32.night).toHaveLength(PALETTE_SIZE);
    expect(KERBSIDE32.shadow).toHaveLength(PALETTE_SIZE);
    expect(paletteIndex('sweeper_yellow')).toBe(15);
    expect(() => paletteIndex('not_a_colour')).toThrow();
  });

  it('parses hex values from the file (index 00 is the letterbox colour)', () => {
    const [r, g, b] = rgbOf(0);
    expect(LETTERBOX_CSS).toBe(`#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`);
    for (let i = 0; i < PALETTE_SIZE; i++) {
      const hex = paletteJson.colors[i]?.hex;
      const parsed = rgbOf(i)
        .map((v) => v.toString(16).padStart(2, '0'))
        .join('');
      expect(`#${parsed}`).toBe(hex);
    }
  });

  it('copies the night and shadow tables verbatim', () => {
    expect(Array.from(KERBSIDE32.night)).toEqual(paletteJson.night);
    expect(Array.from(KERBSIDE32.shadow)).toEqual(paletteJson.shadow);
  });

  it('rejects malformed palettes', () => {
    const good = structuredClone(paletteJson);
    expect(() => parsePalette(good)).not.toThrow();
    expect(() => parsePalette(null)).toThrow();
    expect(() => parsePalette({ ...good, colors: good.colors.slice(1) })).toThrow(/32/);
    expect(() =>
      parsePalette({ ...good, colors: [{ name: 'ink', hex: 'not-hex' }, ...good.colors.slice(1)] }),
    ).toThrow(/hex/);
    expect(() => parsePalette({ ...good, night: [...good.night.slice(1), 32] })).toThrow(/night/);
    expect(() => parsePalette({ ...good, shadow: good.shadow.slice(1) })).toThrow(/shadow/);
    expect(() => parsePalette({ ...good, shadow: [0.5, ...good.shadow.slice(1)] })).toThrow(/shadow/);
  });
});

describe('OKLab conversion', () => {
  it('maps white to L = 1, a = b = 0 and black to 0 (Ottosson matrices)', () => {
    const white = srgbToOklab(255, 255, 255);
    expect(white[0]).toBeCloseTo(1, 6);
    expect(white[1]).toBeCloseTo(0, 6);
    expect(white[2]).toBeCloseTo(0, 6);
    expect(Array.from(srgbToOklab(0, 0, 0))).toEqual([0, 0, 0]);
  });

  it('gives every palette colour a distinct OKLab point', () => {
    const lab = paletteOklab();
    const keys = new Set<string>();
    for (let i = 0; i < PALETTE_SIZE; i++) keys.add(Array.from(lab.subarray(i * 3, i * 3 + 3)).join(','));
    expect(keys.size).toBe(PALETTE_SIZE);
  });
});

describe('nearestIndex parity with the forge (tests/fixtures/palette_oklab_4096.json)', () => {
  it('reads all 4,096 fixture samples', () => {
    expect(FIXTURE).toHaveLength(4096);
    expect(fixtureJson.count).toBe(4096);
  });

  it('equals the forge index for every sample (zero mismatches)', () => {
    const mismatches: string[] = [];
    for (const [r, g, b, expected] of FIXTURE) {
      const actual = nearestIndex(r, g, b);
      if (actual !== expected) mismatches.push(`(${r}, ${g}, ${b}): forge ${expected}, TS ${actual}`);
    }
    expect(mismatches).toEqual([]);
  });

  it('maps every palette colour to its own index', () => {
    for (let i = 0; i < PALETTE_SIZE; i++) expect(nearestIndex(...rgbOf(i))).toBe(i);
  });

  it('breaks an exact tie toward the lower index', () => {
    // A palette whose colours 1 and 2 are identical: anything nearest to them must resolve to 1.
    const twin = parsePalette({
      ...structuredClone(paletteJson),
      colors: paletteJson.colors.map((c, i) =>
        i === 2 ? { name: c.name, hex: paletteJson.colors[1]?.hex } : c,
      ),
    });
    const lab = paletteOklab(twin);
    expect(nearestIndex(...rgbOf(1, twin), lab)).toBe(1);
  });
});

describe('buildLut', () => {
  const lut = kerbside32Lut();

  it('has 64³ cells, each a palette index', () => {
    expect(lut).toHaveLength(LUT_SIZE ** 3);
    expect(lut.every((idx) => idx < PALETTE_SIZE)).toBe(true);
  });

  it('maps all 32 palette colours to their own index', () => {
    for (let i = 0; i < PALETTE_SIZE; i++) expect(lut[lutCell(...rgbOf(i))], `index ${i}`).toBe(i);
  });

  it('is cached: kerbside32Lut returns the same buffer, equal to a fresh build', () => {
    expect(kerbside32Lut()).toBe(lut);
    expect(buildLut(KERBSIDE32)).toEqual(lut);
  });

  it('fills other cells with the exact nearest of the cell representative', () => {
    const paletteCells = new Set(Array.from({ length: PALETTE_SIZE }, (_, i) => lutCell(...rgbOf(i))));
    for (let cell = 0; cell < lut.length; cell += 997) {
      if (paletteCells.has(cell)) continue;
      const r = lutRepresentative(cell % LUT_SIZE);
      const g = lutRepresentative(Math.floor(cell / LUT_SIZE) % LUT_SIZE);
      const b = lutRepresentative(Math.floor(cell / LUT_SIZE ** 2));
      expect(lut[cell]).toBe(nearestIndex(r, g, b));
    }
  });

  it('lays cells out x = r >> 2 fastest, then g, then b (Data3DTexture order)', () => {
    expect(lutCell(0, 0, 0)).toBe(0);
    expect(lutCell(4, 0, 0)).toBe(1);
    expect(lutCell(0, 4, 0)).toBe(LUT_SIZE);
    expect(lutCell(0, 0, 4)).toBe(LUT_SIZE ** 2);
    expect(lutCell(255, 255, 255)).toBe(LUT_SIZE ** 3 - 1);
  });

  it('keeps every representative inside its own cell', () => {
    for (let c = 0; c < LUT_SIZE; c++) expect(lutRepresentative(c) >> 2).toBe(c);
  });

  it('throws when two palette colours share a cell', () => {
    // Colour 1 moved into colour 0's cell (same r>>2, g>>2, b>>2, different bytes).
    const [r, g, b] = rgbOf(0);
    const near = `#${[r ^ 1, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
    const clash = parsePalette({
      ...structuredClone(paletteJson),
      colors: paletteJson.colors.map((c, i) => (i === 1 ? { name: c.name, hex: near } : c)),
    });
    expect(() => buildLut(clash)).toThrow(/share LUT cell/);
  });
});

describe('remap tables', () => {
  it('uploads night as row 0 and shadow as row 1 of the 32x2 texture', () => {
    const data = buildRemapData();
    expect(Array.from(data.subarray(0, PALETTE_SIZE))).toEqual(paletteJson.night);
    expect(Array.from(data.subarray(PALETTE_SIZE))).toEqual(paletteJson.shadow);
  });

  it('uploads the palette as 32 opaque RGBA texels', () => {
    const data = buildPaletteData();
    for (let i = 0; i < PALETTE_SIZE; i++) {
      expect(Array.from(data.subarray(i * 4, i * 4 + 4))).toEqual([...rgbOf(i), 255]);
    }
  });

  it('applies shadow after night, and night only outside the light mask', () => {
    for (let i = 0; i < PALETTE_SIZE; i++) {
      const night = KERBSIDE32.night[i] ?? -1;
      const shadowOfNight = KERBSIDE32.shadow[night] ?? -1;
      expect(remapIndex(i, true, false, true)).toBe(shadowOfNight);
      expect(remapIndex(i, true, true, true)).toBe(KERBSIDE32.shadow[i]);
      expect(remapIndex(i, false, false, true)).toBe(night);
      expect(remapIndex(i, false, true, true)).toBe(i);
      expect(remapIndex(i, false, false, false)).toBe(i);
      expect(remapIndex(i, true, false, false)).toBe(KERBSIDE32.shadow[i]);
    }
  });
});
