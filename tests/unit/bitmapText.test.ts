// Bitmap text (SSP-069; TECHNICAL_DESIGN §12.3, §12.5; ART_BIBLE §12.5; ASSET_PIPELINE §6.3): measuring with
// advances and kerning, layout at whole pixels (alignment, lines, the outlined variant's two layers), colour by
// recolouring the glyph ink, the fallback glyph, metrics validation, the UI batch's instance contract, the
// UI-aware blit, and the per-frame draw path's no-`new` rule (the heap check is bitmapTextHeap.test.ts).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FRAME, type FrameId } from '../../src/gen/assets.ts';
import { loadAtlas, type RgbaImage, type SpriteAtlas } from '../../src/render/spriteAtlas.ts';
import { NO_RECOLOUR, UI_INSTANCE_STRIDE, UiSpriteBatch } from '../../src/render/spriteBatch.ts';
import { blitSourceTexel, blitUiAwareTexel, type RtTexel } from '../../src/render/upscale.ts';
import {
  BitmapFont,
  fontUrl,
  type GlyphSink,
  LineSpacing,
  loadBitmapFont,
  parseFontMetrics,
  TextAlign,
  TextVariant,
} from '../../src/ui/bitmapText.ts';
import { decodePng } from '../support/png.ts';
import { readFontJson, readIndexedAtlas, TextRaster } from '../support/textRaster.ts';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const FONT = 'kerbside5x7';
const CHALK = 7;
const POSTBOX_RED = 18;
/** A character Kerbside 5×7 lacks. */
const UNKNOWN_CHAR = '\u00e9';

type Quad = { frame: FrameId; x: number; y: number; from: number; to: number };

/** A sink that records every quad. */
class Recorder implements GlyphSink {
  readonly quads: Quad[] = [];
  add(frame: FrameId, x: number, y: number, from: number, to: number): void {
    this.quads.push({ frame, x, y, from, to });
  }
}

function rawMetrics(): Record<string, unknown> {
  const json = readFontJson(FONT);
  if (typeof json !== 'object' || json === null || Array.isArray(json))
    throw new Error('metrics not an object');
  return structuredClone(json) as Record<string, unknown>;
}

function realFont(): BitmapFont {
  return new BitmapFont(parseFontMetrics(rawMetrics()));
}

/** Metrics edited through a JSON path: `edit(json)` mutates a deep copy of the real file. */
function editedMetrics(
  edit: (json: Record<string, Record<string, Record<string, unknown>>>) => void,
): unknown {
  const json = rawMetrics() as Record<string, Record<string, Record<string, unknown>>>;
  edit(json);
  return json;
}

/** The real metrics with narrow advances (i, !, l, . at 2 plain / 3 outlined), as SSP-141 will write them. */
function narrowFont(): BitmapFont {
  const json = editedMetrics((m) => {
    for (const [variant, advance] of [
      ['plain', 2],
      ['outline', 3],
    ] as const) {
      const glyphs = m.variants?.[variant]?.glyphs as Record<string, { advance: number }>;
      for (const c of ['i', '!', 'l', '.']) {
        const glyph = glyphs[c];
        if (glyph === undefined) throw new Error(`no glyph ${c}`);
        glyph.advance = advance;
      }
    }
  });
  return new BitmapFont(parseFontMetrics(json));
}

/** The advance of `char` in the committed metrics. */
function metricsAdvance(variant: 'plain' | 'outline', char: string): number {
  const json = rawMetrics() as { variants: Record<string, { glyphs: Record<string, { advance: number }> }> };
  const advance = json.variants[variant]?.glyphs[char]?.advance;
  if (advance === undefined) throw new Error(`no advance for ${char}`);
  return advance;
}

async function loadUiAtlas(): Promise<SpriteAtlas> {
  return loadAtlas('ui', {
    fetchJson: async (url: string): Promise<unknown> =>
      JSON.parse(readFileSync(`${REPO_ROOT}public${url}`, 'utf8')),
    fetchImage: async (url: string): Promise<RgbaImage> =>
      decodePng(readFileSync(`${REPO_ROOT}public${url}`)),
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('measure (acceptance: kerning, narrow advances, outlined +1 per glyph)', () => {
  it("applies the −1 kern to 'AV'", () => {
    const font = realFont();
    expect(font.measure('AV')).toBe(6 + 6 - 1);
    expect(font.measure('A') + font.measure('V')).toBe(12);
    expect(font.measure('AV', TextVariant.Outline)).toBe(7 + 7 - 1);
  });

  it("measures 'Hi!' with the per-glyph advances from the metrics", () => {
    const font = realFont();
    const plain = metricsAdvance('plain', 'H') + metricsAdvance('plain', 'i') + metricsAdvance('plain', '!');
    expect(font.measure('Hi!')).toBe(plain);
    // With narrow advances (the SSP-141 metrics) the same string is 6 + 2 + 2 wide, 7 + 3 + 3 outlined.
    const narrow = narrowFont();
    expect(narrow.measure('Hi!')).toBe(10);
    expect(narrow.measure('Hi!', TextVariant.Outline)).toBe(13);
  });

  it('makes the outlined variant exactly one pixel per glyph wider', () => {
    const font = realFont();
    const narrow = narrowFont();
    for (const text of ['AV', 'Hi!', 'TIDY!', 'SWEEPING BEAUTY!', 'Te To Ty r. r,', '£12.50 ★', 'a', '']) {
      const glyphs = Array.from(text).length;
      expect(font.measure(text, TextVariant.Outline) - font.measure(text), text).toBe(glyphs);
      expect(narrow.measure(text, TextVariant.Outline) - narrow.measure(text), text).toBe(glyphs);
    }
  });

  it('applies every kerning pair of the metrics and nothing else', () => {
    const font = realFont();
    const json = rawMetrics() as { variants: { plain: { kerning: Record<string, number> } } };
    for (const [pair, adjust] of Object.entries(json.variants.plain.kerning)) {
      const [a = '', b = ''] = Array.from(pair);
      expect(font.measure(pair), pair).toBe(font.measure(a) + font.measure(b) + adjust);
    }
    expect(font.measure('VV')).toBe(12);
    expect(font.measure('A V')).toBe(18);
  });

  it('returns the widest line of multi-line text', () => {
    const font = realFont();
    expect(font.measure('AB\nABCD\nA')).toBe(24);
    expect(font.measure('AB\n')).toBe(12);
  });
});

describe('draw: layout at whole pixels', () => {
  it('places each glyph pivot on the pen, advancing by advance plus kerning', () => {
    const font = realFont();
    const sink = new Recorder();
    const width = font.draw(sink, 'AV A', 10, 20);
    expect(width).toBe(6 + 6 - 1 + 6 + 6);
    expect(sink.quads.map((q) => [q.frame, q.x, q.y])).toEqual([
      ['font.kerbside5x7:glyph:-:32', 10, 20],
      ['font.kerbside5x7:glyph:-:53', 15, 20],
      ['font.kerbside5x7:glyph:-:32', 27, 20],
    ]);
    // The space advances but draws nothing.
    expect(sink.quads).toHaveLength(3);
  });

  it('recolours the glyph ink (07) to the requested palette index, chalk by default', () => {
    const font = realFont();
    const sink = new Recorder();
    font.draw(sink, 'Hi', 0, 0);
    font.draw(sink, 'Hi', 0, 10, POSTBOX_RED);
    expect(font.inkColour).toBe(CHALK);
    expect(sink.quads.map((q) => [q.from, q.to])).toEqual([
      [CHALK, CHALK],
      [CHALK, CHALK],
      [CHALK, POSTBOX_RED],
      [CHALK, POSTBOX_RED],
    ]);
  });

  it('draws outlined text as every ring first, then the plain ink at the same outlined pens', () => {
    const font = realFont();
    const sink = new Recorder();
    const width = font.draw(sink, 'AVA', 4, 8, POSTBOX_RED, TextVariant.Outline);
    expect(width).toBe(7 * 3 - 1 - 1);
    expect(sink.quads.map((q) => [q.frame, q.x])).toEqual([
      ['font.kerbside5x7:outline:-:32', 4],
      ['font.kerbside5x7:outline:-:53', 10],
      ['font.kerbside5x7:outline:-:32', 16],
      ['font.kerbside5x7:glyph:-:32', 4],
      ['font.kerbside5x7:glyph:-:53', 10],
      ['font.kerbside5x7:glyph:-:32', 16],
    ]);
    expect(new Set(sink.quads.map((q) => q.to))).toEqual(new Set([POSTBOX_RED]));
  });

  it('aligns left, centre and right about the anchor', () => {
    const font = realFont();
    const xs = (align: TextAlign, variant: TextVariant = TextVariant.Plain): number[] => {
      const sink = new Recorder();
      font.draw(sink, 'ABC', 100, 0, CHALK, variant, align);
      return sink.quads.map((q) => q.x);
    };
    expect(xs(TextAlign.Left)).toEqual([100, 106, 112]);
    expect(xs(TextAlign.Centre)).toEqual([91, 97, 103]);
    expect(xs(TextAlign.Right)).toEqual([82, 88, 94]);
    // Odd widths round the start down: 7 × 3 = 21 → 100 − 10.
    expect(xs(TextAlign.Centre, TextVariant.Outline).slice(0, 3)).toEqual([90, 97, 104]);
  });

  it('starts a new line per newline, each aligned on its own width, at HUD or paragraph spacing', () => {
    const font = realFont();
    const at = (variant: TextVariant, spacing: LineSpacing): number[][] => {
      const sink = new Recorder();
      font.draw(sink, 'AB\nC', 50, 10, CHALK, variant, TextAlign.Right, spacing);
      return sink.quads.slice(-3).map((q) => [q.x, q.y]);
    };
    expect(at(TextVariant.Plain, LineSpacing.Hud)).toEqual([
      [38, 10],
      [44, 10],
      [44, 18],
    ]);
    expect(at(TextVariant.Plain, LineSpacing.Paragraph)[2]).toEqual([44, 19]);
    expect(at(TextVariant.Outline, LineSpacing.Hud)[2]).toEqual([43, 19]);
    expect(at(TextVariant.Outline, LineSpacing.Paragraph)[2]).toEqual([43, 20]);
    expect(font.lineHeight()).toBe(8);
    expect(font.lineHeight(TextVariant.Plain, LineSpacing.Paragraph)).toBe(9);
    expect(font.lineHeight(TextVariant.Outline, LineSpacing.Hud)).toBe(9);
    expect(font.lineHeight(TextVariant.Outline, LineSpacing.Paragraph)).toBe(10);
  });

  it('lays narrow glyphs out by their own advances', () => {
    const sink = new Recorder();
    narrowFont().draw(sink, 'Hi!H', 0, 0);
    expect(sink.quads.map((q) => q.x)).toEqual([0, 6, 8, 10]);
  });

  it('draws the fallback glyph for unknown characters and warns once per character', () => {
    const font = realFont();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const sink = new Recorder();
    font.draw(sink, 'café é\u{1F600}', 0, 0);
    font.draw(sink, 'é', 0, 0);
    const question = 'font.kerbside5x7:glyph:-:30';
    expect(FRAME[question]).toBeDefined();
    const frames = sink.quads.map((q) => q.frame);
    expect(frames.slice(3, 4)).toEqual([question]);
    // é, é again and the astral emoji (one code point, not two halves) all draw '?'.
    expect(frames.filter((f) => f === question)).toHaveLength(4);
    expect(font.measure('\u{1F600}')).toBe(6);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(String(warn.mock.calls[0]?.[0])).toContain('U+00E9');
    expect(String(warn.mock.calls[1]?.[0])).toContain('U+1F600');
  });

  it('refuses non-integer positions and colours outside the palette', () => {
    const font = realFont();
    const sink = new Recorder();
    expect(() => font.draw(sink, 'A', 0.5, 0)).toThrow(/whole internal pixels/);
    expect(() => font.draw(sink, 'A', 0, Number.NaN)).toThrow(/whole internal pixels/);
    expect(() => font.draw(sink, 'A', 0, 0, 32)).toThrow(/palette index/);
    expect(() => font.draw(sink, 'A', 0, 0, 2.5)).toThrow(/palette index/);
    expect(sink.quads).toEqual([]);
  });
});

describe('rasterised glyphs', () => {
  it('outlined text keeps every glyph’s ink and puts the 00 ring round it', () => {
    const font = realFont();
    const atlas = readIndexedAtlas('ui');
    const plain = new TextRaster(64, 16, atlas);
    const outlined = new TextRaster(64, 16, atlas);
    font.draw(plain, 'AV', 1, 1, POSTBOX_RED);
    font.draw(outlined, 'AV', 1, 1, POSTBOX_RED, TextVariant.Outline);
    let ink = 0;
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 64; x++) {
        const p = plain.at(x, y);
        expect([-1, POSTBOX_RED]).toContain(p);
        if (p === POSTBOX_RED) ink++;
      }
    }
    expect(ink).toBeGreaterThan(20);
    // The outlined A sits at the same pen; its ink matches the plain A's ink pixel for pixel.
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 6; x++) {
        if (plain.at(x, y) === POSTBOX_RED) expect(outlined.at(x, y), `(${x}, ${y})`).toBe(POSTBOX_RED);
      }
    }
    const ringPixels = Array.from(outlined.index).filter((v) => v === 0).length;
    expect(ringPixels).toBeGreaterThan(ink);
  });
});

describe('metrics validation', () => {
  it('accepts the committed metrics', () => {
    const metrics = parseFontMetrics(rawMetrics());
    expect(metrics.id).toBe('font.kerbside5x7');
    expect(metrics.atlas).toBe('ui');
    expect(metrics.plain.glyphs.size).toBe(101);
    expect(metrics.colours).toEqual({ ink: 7, outline: 0 });
  });

  it.each([
    [
      'a frame missing from FRAME',
      (m: Record<string, Record<string, Record<string, unknown>>>) => {
        (m.variants?.plain?.glyphs as Record<string, unknown>).A = {
          advance: 6,
          frame: 'font.kerbside5x7:glyph:-:999',
        };
      },
      /not in src\/gen\/assets.ts/,
    ],
    [
      'a frame of the other state',
      (m: Record<string, Record<string, Record<string, unknown>>>) => {
        (m.variants?.plain?.glyphs as Record<string, unknown>).A = {
          advance: 6,
          frame: 'font.kerbside5x7:outline:-:32',
        };
      },
      /not a 'glyph' frame/,
    ],
    [
      'a kerning pair of unknown glyphs',
      (m: Record<string, Record<string, Record<string, unknown>>>) => {
        Object.assign(m.variants?.plain?.kerning ?? {}, Object.fromEntries([[`A${UNKNOWN_CHAR}`, -1]]));
      },
      /two glyphs of the font/,
    ],
    [
      'a fractional advance',
      (m: Record<string, Record<string, Record<string, unknown>>>) => {
        (m.variants?.outline as Record<string, unknown>).advance = 6.5;
      },
      /non-negative integer/,
    ],
    [
      'a character in one variant only',
      (m: Record<string, Record<string, Record<string, unknown>>>) => {
        Reflect.deleteProperty(m.variants?.outline?.glyphs ?? {}, 'B');
      },
      /same characters/,
    ],
    [
      'an ink colour outside the palette',
      (m: Record<string, Record<string, Record<string, unknown>>>) => {
        (m.colours as Record<string, unknown>).ink = 40;
      },
      /palette index/,
    ],
    [
      'a blank fallback',
      (m: Record<string, Record<string, Record<string, unknown>>>) => {
        (m as Record<string, unknown>).fallback = ' ';
      },
      /inked glyph/,
    ],
    [
      'a third variant',
      (m: Record<string, Record<string, Record<string, unknown>>>) => {
        (m.variants as Record<string, unknown>).bold = {};
      },
      /unknown variants/,
    ],
  ])('rejects %s', (_label, edit, message) => {
    expect(() => parseFontMetrics(editedMetrics(edit))).toThrow(message);
  });

  it('loads through the injected fetch and checks the ID against the file name', async () => {
    const urls: string[] = [];
    const font = await loadBitmapFont(FONT, async (url) => {
      urls.push(url);
      return rawMetrics();
    });
    expect(urls).toEqual([fontUrl(FONT)]);
    expect(fontUrl(FONT, '/base/')).toBe('/base/assets/fonts/kerbside5x7.json');
    expect(font.measure('AV')).toBe(11);
    await expect(loadBitmapFont('other', async () => rawMetrics())).rejects.toThrow(/not 'font.other'/);
  });
});

describe('UiSpriteBatch (the UI pass draw)', () => {
  it('writes the pivot position, frame rect, pivot and recolour pair per quad', async () => {
    const atlas = await loadUiAtlas();
    const batch = new UiSpriteBatch(atlas, 8);
    const version = (): number =>
      (batch.mesh.geometry.getAttribute('offset') as unknown as { data: { version: number } }).data.version;
    const before = version();
    batch.begin();
    realFont().draw(batch, 'AV', 12, 34, POSTBOX_RED);
    batch.add('font.kerbside5x7:outline:-:0', 1, 2);
    batch.end();
    expect(batch.count).toBe(3);
    expect(batch.mesh.count).toBe(3);
    expect(version()).toBe(before + 1);
    const a = FRAME['font.kerbside5x7:glyph:-:32'];
    const quad = (i: number): number[] =>
      Array.from(batch.instanceData.subarray(i * UI_INSTANCE_STRIDE, (i + 1) * UI_INSTANCE_STRIDE));
    expect(quad(0)).toEqual([12, 34, a.x, a.y, a.w, a.h, a.px, a.py, CHALK, POSTBOX_RED]);
    expect(quad(1).slice(0, 2)).toEqual([17, 34]);
    expect(quad(2).slice(8)).toEqual([NO_RECOLOUR, 0]);
    // The next frame starts empty.
    batch.begin();
    batch.end();
    expect(batch.mesh.count).toBe(0);
    batch.dispose();
  });

  it('refuses frames of other atlases, fractional positions, bad recolours and overflow', async () => {
    const atlas = await loadUiAtlas();
    const batch = new UiSpriteBatch(atlas, 1);
    batch.begin();
    expect(() => batch.add('veh.sweeper:body:h00:0', 0, 0)).toThrow(/atlas 'actors', not 'ui'/);
    expect(() => batch.add('font.kerbside5x7:glyph:-:0', 0.5, 0)).toThrow(/whole internal pixels/);
    expect(() => batch.add('font.kerbside5x7:glyph:-:0', 0, 0, 7, 32)).toThrow(/palette index/);
    expect(() => batch.add('font.kerbside5x7:glyph:-:0', 0, 0, 40, 3)).toThrow(/palette index/);
    batch.add('font.kerbside5x7:glyph:-:0', 0, 0);
    expect(() => batch.add('font.kerbside5x7:glyph:-:0', 0, 0)).toThrow(/full/);
    expect(() => new UiSpriteBatch(atlas, 0)).toThrow(/capacity/);
    batch.dispose();
  });
});

describe('per-frame draw path source (acceptance: no `new` or array literals)', () => {
  const NEW_RE = /\bnew\s+[A-Za-z_$]/;
  const ARRAY_LITERAL_RE = /(?:[=(,]|\breturn)\s*\[/;
  const regions = (file: string): string[] => {
    const source = readFileSync(`${REPO_ROOT}${file}`, 'utf8');
    const parts = source.split('// per-frame draw path: begin').slice(1);
    return parts.map((part) => {
      const end = part.indexOf('// per-frame draw path: end');
      if (end < 0) throw new Error(`${file}: unterminated per-frame region`);
      return part.slice(0, end);
    });
  };

  it.each([['src/ui/bitmapText.ts'], ['src/render/spriteBatch.ts']])('%s', (file) => {
    const found = regions(file);
    expect(found.length, 'marked regions').toBeGreaterThan(0);
    for (const region of found) {
      const lines = region.split('\n').filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//'));
      expect(lines.filter((l) => NEW_RE.test(l))).toEqual([]);
      expect(lines.filter((l) => ARRAY_LITERAL_RE.test(l))).toEqual([]);
    }
  });

  it('the scanner flags what it should', () => {
    expect(NEW_RE.test('const v = new Vector2();')).toBe(true);
    expect(ARRAY_LITERAL_RE.test('const xs = [1, 2];')).toBe(true);
    expect(ARRAY_LITERAL_RE.test('f([a]);')).toBe(true);
    expect(ARRAY_LITERAL_RE.test('return [x, y];')).toBe(true);
    expect(ARRAY_LITERAL_RE.test('const f = frames[slot] ?? null;')).toBe(false);
    expect(ARRAY_LITERAL_RE.test('frames: readonly (FrameId | null)[],')).toBe(false);
  });
});

describe('UI-aware blit (blitUiAwareTexel mirrors the blit shader)', () => {
  const SCALE = 4;
  const out: RtTexel = { x: 0, y: 0 };

  it('samples the shifted texel everywhere when no texel is UI', () => {
    for (let o = 0; o <= SCALE; o++) {
      for (let d = 0; d < 40; d++) {
        blitUiAwareTexel(d, d + 3, o, SCALE - o, SCALE, () => false, out);
        expect([out.x, out.y]).toEqual([
          blitSourceTexel(d, o, SCALE),
          blitSourceTexel(d + 3, SCALE - o, SCALE),
        ]);
      }
    }
  });

  it('keeps every UI texel on exactly its own device block at every offset', () => {
    // UI texels in a 12×12 RT patch: a checker-ish pattern of isolated and adjacent UI pixels.
    const isUi = (x: number, y: number): boolean => x >= 2 && y >= 2 && (x * 7 + y * 3) % 5 < 2;
    for (let oy = 0; oy <= SCALE; oy++) {
      for (let ox = 0; ox <= SCALE; ox++) {
        for (let dy = 0; dy < 40; dy++) {
          for (let dx = 0; dx < 40; dx++) {
            blitUiAwareTexel(dx, dy, ox, oy, SCALE, isUi, out);
            const still = { x: blitSourceTexel(dx, 0, SCALE), y: blitSourceTexel(dy, 0, SCALE) };
            if (isUi(still.x, still.y)) expect(out).toEqual(still);
            // A UI texel is never shown away from its own block.
            if (isUi(out.x, out.y)) expect(out).toEqual(still);
          }
        }
      }
    }
  });
});
