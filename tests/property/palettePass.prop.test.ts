// Palette pass properties (SSP-016, TECHNICAL_DESIGN §12.6): the CPU reference of the pass never outputs a
// colour outside Kerbside-32, and the remaps apply in the documented order (night unless lit, then shadow, then the
// SSP-287 pause dim on every pixel not flagged UI).
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import paletteJson from '../../assets-src/palette/kerbside32.json' with { type: 'json' };
import {
  buildLut,
  KERBSIDE32,
  type Kerbside32,
  kerbside32Lut,
  lutCell,
  lutRepresentative,
  MASK_SET_THRESHOLD,
  nearestIndex,
  PALETTE_SIZE,
  palettePassReference,
  parsePalette,
} from '../../src/render/palettePass.ts';

const LUT = kerbside32Lut();

function paletteKey(palette: Kerbside32, index: number): number {
  const rgb = palette.rgb;
  return ((rgb[index * 3] ?? 0) << 16) | ((rgb[index * 3 + 1] ?? 0) << 8) | (rgb[index * 3 + 2] ?? 0);
}

const PALETTE_KEYS = new Set(Array.from({ length: PALETTE_SIZE }, (_, i) => paletteKey(KERBSIDE32, i)));

/** The Kerbside-32 index of a 0xRRGGBB key (−1 if it is none). */
function indexOfKey(key: number): number {
  for (let i = 0; i < PALETTE_SIZE; i++) if (paletteKey(KERBSIDE32, i) === key) return i;
  return -1;
}

/** A mask byte: mostly the 0/255 a MAX-blended mask draw writes, sometimes anything. */
const maskByte = fc.oneof(fc.constantFrom(0, 255), fc.integer({ min: 0, max: 255 }));
const pixel = fc.tuple(
  fc.integer({ min: 0, max: 255 }),
  fc.integer({ min: 0, max: 255 }),
  fc.integer({ min: 0, max: 255 }),
  fc.integer({ min: 0, max: 255 }),
);
const maskPixel = fc.tuple(maskByte, maskByte, maskByte, maskByte);
const frame = fc.array(fc.tuple(pixel, maskPixel), { minLength: 1, maxLength: 256 });
const index = fc.integer({ min: 0, max: PALETTE_SIZE - 1 });
const table = fc.array(index, { minLength: PALETTE_SIZE, maxLength: PALETTE_SIZE });

function buffers(pixels: readonly (readonly [readonly number[], readonly number[]])[]): {
  colour: Uint8Array;
  mask: Uint8Array;
} {
  const colour = new Uint8Array(pixels.length * 4);
  const mask = new Uint8Array(pixels.length * 4);
  pixels.forEach(([c, m], p) => {
    colour.set(c, p * 4);
    mask.set(m, p * 4);
  });
  return { colour, mask };
}

function singlePixel(palette: Kerbside32, i: number, shadowByte: number, lightByte: number): Uint8Array[] {
  const rgb = palette.rgb;
  return [
    new Uint8Array([rgb[i * 3] ?? 0, rgb[i * 3 + 1] ?? 0, rgb[i * 3 + 2] ?? 0, 255]),
    new Uint8Array([shadowByte, lightByte, 0, 0]),
  ];
}

function outputIs(out: Uint8Array, palette: Kerbside32, expected: number): boolean {
  return (
    out[0] === palette.rgb[expected * 3] &&
    out[1] === palette.rgb[expected * 3 + 1] &&
    out[2] === palette.rgb[expected * 3 + 2] &&
    out[3] === 255
  );
}

describe('palette pass CPU reference', () => {
  it('knows the 32 distinct Kerbside-32 colours', () => {
    expect(PALETTE_KEYS.size).toBe(PALETTE_SIZE);
  });

  it('only ever outputs Kerbside-32 colours, opaque, for any RGB and mask input', () => {
    fc.assert(
      fc.property(frame, fc.boolean(), (pixels, night) => {
        const { colour, mask } = buffers(pixels);
        const out = palettePassReference(colour, mask, night, LUT);
        for (let p = 0; p < out.length; p += 4) {
          const key = ((out[p] ?? 0) << 16) | ((out[p + 1] ?? 0) << 8) | (out[p + 2] ?? 0);
          if (!PALETTE_KEYS.has(key) || out[p + 3] !== 255) return false;
        }
        return true;
      }),
      { numRuns: 500 },
    );
  });

  it('with mask R = 1 and night on, outputs palette[shadow[night[i]]] for palette colour i', () => {
    fc.assert(
      fc.property(index, (i) => {
        const [colour, mask] = singlePixel(KERBSIDE32, i, 255, 0);
        const expected = KERBSIDE32.shadow[KERBSIDE32.night[i] ?? 0] ?? -1;
        return outputIs(
          palettePassReference(colour ?? new Uint8Array(), mask ?? new Uint8Array(), true),
          KERBSIDE32,
          expected,
        );
      }),
    );
  });

  it('applies shadow after night for arbitrary remap tables, and skips night where the light mask is set', () => {
    fc.assert(
      fc.property(
        table,
        table,
        index,
        maskByte,
        maskByte,
        fc.boolean(),
        (night, shadow, i, rByte, gByte, on) => {
          const palette = parsePalette({ ...structuredClone(paletteJson), night, shadow });
          const lut = buildLut(palette);
          const [colour, mask] = singlePixel(palette, i, rByte, gByte);
          const shadowed = rByte >= MASK_SET_THRESHOLD;
          const lit = gByte >= MASK_SET_THRESHOLD;
          let expected = i;
          if (on && !lit) expected = night[expected] ?? -1;
          if (shadowed) expected = shadow[expected] ?? -1;
          const out = palettePassReference(
            colour ?? new Uint8Array(),
            mask ?? new Uint8Array(),
            on,
            lut,
            palette,
          );
          return outputIs(out, palette, expected);
        },
      ),
      { numRuns: 60 },
    );
  });

  it('dim (SSP-287) takes every non-UI pixel one more shadow step and leaves UI pixels exactly as without it', () => {
    fc.assert(
      fc.property(frame, fc.boolean(), (pixels, night) => {
        const { colour, mask } = buffers(pixels);
        const plain = palettePassReference(colour, mask, night, LUT);
        const dimmed = palettePassReference(colour, mask, night, LUT, KERBSIDE32, true);
        for (let p = 0; p < plain.length; p += 4) {
          const ui = (mask[p + 2] ?? 0) >= MASK_SET_THRESHOLD;
          const before = indexOfKey(
            ((plain[p] ?? 0) << 16) | ((plain[p + 1] ?? 0) << 8) | (plain[p + 2] ?? 0),
          );
          const want = ui ? before : (KERBSIDE32.shadow[before] ?? -1);
          const got = indexOfKey(
            ((dimmed[p] ?? 0) << 16) | ((dimmed[p + 1] ?? 0) << 8) | (dimmed[p + 2] ?? 0),
          );
          if (got !== want || dimmed[p + 3] !== 255) return false;
        }
        return true;
      }),
      { numRuns: 300 },
    );
  });

  it('maps any RGB through the LUT to the exact nearest of its cell representative (or a palette colour)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 255 }),
        fc.integer({ min: 0, max: 255 }),
        fc.integer({ min: 0, max: 255 }),
        (r, g, b) => {
          const idx = LUT[lutCell(r, g, b)] ?? -1;
          const rep = nearestIndex(
            lutRepresentative(r >> 2),
            lutRepresentative(g >> 2),
            lutRepresentative(b >> 2),
          );
          if (idx === rep) return true;
          // Only palette-owned cells may differ, and they hold the palette colour that lives in them.
          const rgb = KERBSIDE32.rgb;
          const home = lutCell(rgb[idx * 3] ?? 0, rgb[idx * 3 + 1] ?? 0, rgb[idx * 3 + 2] ?? 0);
          return home === lutCell(r, g, b);
        },
      ),
      { numRuns: 2000 },
    );
  });
});
