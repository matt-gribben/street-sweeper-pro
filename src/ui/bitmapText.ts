// Bitmap text (TECHNICAL_DESIGN §12.3, §12.5; ART_BIBLE §12.5; SSP-069): lays out and draws Kerbside 5×7 strings
// from the `ui` atlas as quads of the UI pass (render/spriteBatch.ts UiSpriteBatch, one instanced draw).
//
// Metrics come from the forge's `public/assets/fonts/<name>.json` (ASSET_PIPELINE §6.3), validated at load:
// per variant (`plain`, `outline`) a default advance, the line heights (`hud` 8 / `paragraph` 9 for the plain
// variant, +1 outlined), per-glyph advances and frame IDs (null for the space), and kerning pairs. A kerning value
// is added to the left glyph's advance, so the pen moves by advance(c) + kern(c, next) after each glyph.
//
// Layout, all in whole internal pixels (x right, y down from the frame's top-left):
//   - the pen starts at the line's anchor; a glyph's frame pivot (the top-left of its ink box) lands on the pen,
//     so (x, y) is the top-left of the first glyph's ink box for left-aligned text;
//   - width = the sum of the line's advances plus its kerning (the outlined variant's advances are +1 each, so it
//     is exactly one pixel per glyph wider). Plain text therefore includes the 1 px letter gap after its last
//     glyph; centred text starts at x − floor(width / 2) and right-aligned text at x − width;
//   - '\n' starts a new line one line height lower (HUD spacing 8 or paragraph spacing 9, +1 outlined), each line
//     aligned on its own width; the space has no frame and only advances;
//   - a character the font lacks draws the fallback glyph ('?') and, in dev builds, warns once per character.
//
// Colour: glyph ink is index 07 chalk in the atlas (the metrics' `colours.ink`); each quad carries a recolour pair
// (ink -> the requested palette index), so text can be any Kerbside-32 colour with no swap-table row (decision
// recorded in TECHNICAL_DESIGN §12.5). The outlined variant's 00 ink ring is never recoloured. Outlined text is
// drawn in two layers, every outlined frame first and then the plain frames at the same pens, so one glyph's ring
// never covers a neighbour's ink (ASSET_PIPELINE §6.3).
//
// Per frame nothing allocates: strings are walked by index with codePointAt, glyph lookups are Map<number, number>
// and typed arrays built at load, and draw() writes straight into the sink. The section between the
// "per-frame draw path" markers is scanned by tests/unit/bitmapText.test.ts for `new` and array literals.
//
// Module rules (TECHNICAL_DESIGN §2.1): src/ui imports the generated frame table and render/spriteBatch.ts only;
// the sink is a structural interface that UiSpriteBatch satisfies, so this file needs no three.js.
import { FRAME, type FrameId } from '../gen/assets.ts';

/** The two variants every font has: plain glyphs and the forge's 1 px outlined glyphs. */
export const TextVariant = { Plain: 0, Outline: 1 } as const;
export type TextVariant = (typeof TextVariant)[keyof typeof TextVariant];

/** Horizontal alignment of each line about the anchor x. */
export const TextAlign = { Left: 0, Centre: 1, Right: 2 } as const;
export type TextAlign = (typeof TextAlign)[keyof typeof TextAlign];

/** Line spacing: HUD (the cell height) or paragraph (one pixel more), ART_BIBLE §12.5. */
export const LineSpacing = { Hud: 0, Paragraph: 1 } as const;
export type LineSpacing = (typeof LineSpacing)[keyof typeof LineSpacing];

/** Number of Kerbside-32 colours: text colours are palette indices 0..31. */
const PALETTE_COLOURS = 32;

/**
 * Where glyph quads go: UiSpriteBatch.add (render/spriteBatch.ts), or a recorder or CPU rasteriser in tests. Each
 * quad is `frame` with its pivot at (xPx, yPx), texels of index `recolourFrom` drawn as `recolourTo`.
 */
export interface GlyphSink {
  add(frame: FrameId, xPx: number, yPx: number, recolourFrom: number, recolourTo: number): void;
}

/** One glyph of one variant in the metrics. */
export type GlyphMetrics = {
  readonly advance: number;
  /** The glyph's frame in the font's atlas, or null for a glyph without ink (the space). */
  readonly frame: FrameId | null;
};

/** One variant (`plain` or `outline`) of a font's metrics. */
export type VariantMetrics = {
  /** The frame state that holds this variant (`glyph`, `outline`). */
  readonly state: string;
  readonly advance: number;
  readonly lineHeight: { readonly hud: number; readonly paragraph: number };
  /** Glyphs by character, in code-point order. */
  readonly glyphs: ReadonlyMap<string, GlyphMetrics>;
  /** Kerning by two-character pair: pixels added to the left glyph's advance. */
  readonly kerning: ReadonlyMap<string, number>;
};

/** A validated metrics file (`public/assets/fonts/<name>.json`, ASSET_PIPELINE §6.3). */
export type FontMetrics = {
  readonly id: string;
  readonly font: string;
  readonly atlas: string;
  /** The ink box and the layout cell, in pixels. */
  readonly glyph: { readonly w: number; readonly h: number };
  readonly cell: { readonly w: number; readonly h: number };
  /** Rows from the glyph top to the baseline. */
  readonly baseline: number;
  /** The character drawn for one the font lacks. */
  readonly fallback: string;
  /** Palette indices of the glyph ink (recoloured per string) and of the outline ring. */
  readonly colours: { readonly ink: number; readonly outline: number };
  readonly plain: VariantMetrics;
  readonly outline: VariantMetrics;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFrameId(id: string): id is FrameId {
  return Object.hasOwn(FRAME, id);
}

/** Splits a string into code points (load time only). */
function codePoints(text: string): string[] {
  return Array.from(text);
}

function nonNegativeInt(value: unknown, where: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`font metrics: ${where} must be a non-negative integer, got ${String(value)}`);
  }
  return value;
}

function positiveInt(value: unknown, where: string): number {
  const n = nonNegativeInt(value, where);
  if (n === 0) throw new Error(`font metrics: ${where} must be positive`);
  return n;
}

function paletteIndexValue(value: unknown, where: string): number {
  const n = nonNegativeInt(value, where);
  if (n >= PALETTE_COLOURS) throw new Error(`font metrics: ${where} = ${n} is not a palette index 0..31`);
  return n;
}

function size(value: unknown, where: string): { w: number; h: number } {
  if (!isRecord(value)) throw new Error(`font metrics: ${where} must be { w, h }`);
  return { w: positiveInt(value.w, `${where}.w`), h: positiveInt(value.h, `${where}.h`) };
}

function parseVariant(id: string, atlas: string, name: string, value: unknown): VariantMetrics {
  const where = `variants.${name}`;
  if (!isRecord(value)) throw new Error(`font metrics: ${where} must be an object`);
  const state = value.state;
  if (typeof state !== 'string' || state === '')
    throw new Error(`font metrics: ${where}.state must be a name`);
  const advance = nonNegativeInt(value.advance, `${where}.advance`);
  const lineHeight = value.lineHeight;
  if (!isRecord(lineHeight)) throw new Error(`font metrics: ${where}.lineHeight must be { hud, paragraph }`);
  const hud = positiveInt(lineHeight.hud, `${where}.lineHeight.hud`);
  const paragraph = positiveInt(lineHeight.paragraph, `${where}.lineHeight.paragraph`);
  if (!isRecord(value.glyphs)) throw new Error(`font metrics: ${where}.glyphs must be an object`);
  const glyphs = new Map<string, GlyphMetrics>();
  const framePrefix = `${id}:${state}:`;
  for (const [char, glyph] of Object.entries(value.glyphs)) {
    const at = `${where}.glyphs[${JSON.stringify(char)}]`;
    if (codePoints(char).length !== 1) throw new Error(`font metrics: ${at}: a glyph key is one character`);
    if (!isRecord(glyph)) throw new Error(`font metrics: ${at} must be { advance, frame }`);
    const glyphAdvance = nonNegativeInt(glyph.advance, `${at}.advance`);
    const frame = glyph.frame;
    if (frame === null) {
      glyphs.set(char, { advance: glyphAdvance, frame: null });
      continue;
    }
    if (typeof frame !== 'string' || !isFrameId(frame)) {
      throw new Error(
        `font metrics: ${at}.frame ${String(frame)} is not in src/gen/assets.ts (run npm run assets)`,
      );
    }
    if (!frame.startsWith(framePrefix)) {
      throw new Error(`font metrics: ${at}.frame ${frame} is not a '${state}' frame of ${id}`);
    }
    if (FRAME[frame].atlas !== atlas) {
      throw new Error(
        `font metrics: ${at}.frame ${frame} is in atlas '${FRAME[frame].atlas}', not '${atlas}'`,
      );
    }
    glyphs.set(char, { advance: glyphAdvance, frame });
  }
  const kerningRaw = value.kerning ?? {};
  if (!isRecord(kerningRaw)) throw new Error(`font metrics: ${where}.kerning must be an object`);
  const kerning = new Map<string, number>();
  for (const [pair, adjust] of Object.entries(kerningRaw)) {
    const chars = codePoints(pair);
    const at = `${where}.kerning[${JSON.stringify(pair)}]`;
    if (chars.length !== 2 || !chars.every((c) => glyphs.has(c))) {
      throw new Error(`font metrics: ${at}: a kerning key is two glyphs of the font`);
    }
    if (typeof adjust !== 'number' || !Number.isInteger(adjust)) {
      throw new Error(`font metrics: ${at} must be an integer`);
    }
    kerning.set(pair, adjust);
  }
  return { state, advance, lineHeight: { hud, paragraph }, glyphs, kerning };
}

/**
 * Validates a parsed metrics file (hand-written guard, CLAUDE.md §5.1): the ASSET_PIPELINE §6.3 shape, both
 * variants with the same character set, every frame present in the generated FRAME table, in the font's atlas
 * and of its variant's state, kerning pairs of known glyphs, and an inked fallback glyph. Throws naming the field.
 */
export function parseFontMetrics(data: unknown): FontMetrics {
  if (!isRecord(data)) throw new Error('font metrics: top level must be an object');
  const id = data.id;
  if (typeof id !== 'string' || !/^font\.[a-z0-9_]+$/.test(id)) {
    throw new Error(`font metrics: id ${String(id)} is not a font asset ID (font.<name>)`);
  }
  const font = data.font;
  if (typeof font !== 'string') throw new Error('font metrics: font must be a display name');
  const atlas = data.atlas;
  if (typeof atlas !== 'string' || atlas === '') throw new Error('font metrics: atlas must be an atlas name');
  const glyph = size(data.glyph, 'glyph');
  const cell = size(data.cell, 'cell');
  const baseline = positiveInt(data.baseline, 'baseline');
  const colours = data.colours;
  if (!isRecord(colours)) throw new Error('font metrics: colours must be { ink, outline }');
  const ink = paletteIndexValue(colours.ink, 'colours.ink');
  const outlineIndex = paletteIndexValue(colours.outline, 'colours.outline');
  const variants = data.variants;
  if (!isRecord(variants)) throw new Error('font metrics: variants must be { plain, outline }');
  const extra = Object.keys(variants).filter((k) => k !== 'plain' && k !== 'outline');
  if (extra.length > 0) throw new Error(`font metrics: unknown variants ${extra.join(', ')}`);
  const plain = parseVariant(id, atlas, 'plain', variants.plain);
  const outline = parseVariant(id, atlas, 'outline', variants.outline);
  const plainChars = [...plain.glyphs.keys()].join('');
  const outlineChars = [...outline.glyphs.keys()].join('');
  if (plainChars !== outlineChars) {
    throw new Error('font metrics: the plain and outline variants must list the same characters');
  }
  for (const [char, g] of plain.glyphs) {
    if ((g.frame === null) !== (outline.glyphs.get(char)?.frame === null)) {
      throw new Error(`font metrics: glyph ${JSON.stringify(char)} has ink in one variant only`);
    }
  }
  const fallback = data.fallback;
  if (typeof fallback !== 'string' || codePoints(fallback).length !== 1) {
    throw new Error('font metrics: fallback must be one character');
  }
  if ((plain.glyphs.get(fallback)?.frame ?? null) === null) {
    throw new Error(`font metrics: fallback ${JSON.stringify(fallback)} must be an inked glyph of the font`);
  }
  return {
    id,
    font,
    atlas,
    glyph,
    cell,
    baseline,
    fallback,
    colours: { ink, outline: outlineIndex },
    plain,
    outline,
  };
}

/**
 * Dev builds warn once per unknown character; release builds stay quiet, and so does code running outside Vite
 * (Node tools and the Playwright runner, where import.meta.env is undefined).
 */
const WARN_UNKNOWN: boolean = typeof import.meta.env === 'object' && import.meta.env.DEV === true;

/** A font ready to lay out: metrics turned into per-slot typed arrays and Maps keyed by numbers. */
export class BitmapFont {
  readonly metrics: FontMetrics;
  /** Code point -> glyph slot (code-point order). */
  private readonly slotOf = new Map<number, number>();
  private readonly fallbackSlot: number;
  private readonly slotCount: number;
  /** Advance per slot: plain, then outline. */
  private readonly plainAdvance: Int16Array;
  private readonly outlineAdvance: Int16Array;
  /** Frame per slot (null: no ink): plain, then outline. */
  private readonly plainFrames: (FrameId | null)[];
  private readonly outlineFrames: (FrameId | null)[];
  /** Kerning by slot pair (left * slotCount + right): plain, then outline. */
  private readonly plainKerning = new Map<number, number>();
  private readonly outlineKerning = new Map<number, number>();
  /** Code points already warned about (dev builds). */
  private readonly warned = new Set<number>();

  constructor(metrics: FontMetrics) {
    this.metrics = metrics;
    const chars = [...metrics.plain.glyphs.keys()];
    this.slotCount = chars.length;
    this.plainAdvance = new Int16Array(chars.length);
    this.outlineAdvance = new Int16Array(chars.length);
    this.plainFrames = [];
    this.outlineFrames = [];
    chars.forEach((char, slot) => {
      this.slotOf.set(char.codePointAt(0) ?? 0, slot);
      const plain = metrics.plain.glyphs.get(char);
      const outline = metrics.outline.glyphs.get(char);
      this.plainAdvance[slot] = plain?.advance ?? metrics.plain.advance;
      this.outlineAdvance[slot] = outline?.advance ?? metrics.outline.advance;
      this.plainFrames.push(plain?.frame ?? null);
      this.outlineFrames.push(outline?.frame ?? null);
    });
    this.fallbackSlot = this.slotOf.get(metrics.fallback.codePointAt(0) ?? 0) ?? 0;
    const kerningTable = (variant: VariantMetrics, into: Map<number, number>): void => {
      for (const [pair, adjust] of variant.kerning) {
        const [left = '', right = ''] = codePoints(pair);
        const l = this.slotOf.get(left.codePointAt(0) ?? 0);
        const r = this.slotOf.get(right.codePointAt(0) ?? 0);
        if (l !== undefined && r !== undefined && adjust !== 0) into.set(l * this.slotCount + r, adjust);
      }
    };
    kerningTable(metrics.plain, this.plainKerning);
    kerningTable(metrics.outline, this.outlineKerning);
  }

  /** Palette index of the glyph ink as authored (07 chalk): the default text colour. */
  get inkColour(): number {
    return this.metrics.colours.ink;
  }

  /** Line height in pixels of a variant at a spacing (plain HUD 8, paragraph 9; outlined +1). */
  lineHeight(variant: TextVariant = TextVariant.Plain, spacing: LineSpacing = LineSpacing.Hud): number {
    const v = variant === TextVariant.Outline ? this.metrics.outline : this.metrics.plain;
    return spacing === LineSpacing.Paragraph ? v.lineHeight.paragraph : v.lineHeight.hud;
  }

  // per-frame draw path: begin
  /**
   * Width in pixels of `text` in `variant`: the sum of advances plus kerning of its widest line ('\n' separates
   * lines). Unknown characters count as the fallback glyph. Allocates nothing.
   */
  measure(text: string, variant: TextVariant = TextVariant.Plain): number {
    let widest = 0;
    let start = 0;
    const length = text.length;
    while (start <= length) {
      let end = text.indexOf('\n', start);
      if (end < 0) end = length;
      const width = this.lineWidth(text, start, end, variant, false);
      if (width > widest) widest = width;
      start = end + 1;
    }
    return widest;
  }

  /**
   * Draws `text` into `sink` with its first line's anchor at (xPx, yPx), whole internal pixels, in palette colour
   * `colour` (default the ink colour, 07), aligned per line about xPx. Returns the width of the widest line.
   * Throws for a non-integer position or a colour outside 0..31. Allocates nothing (in dev builds the first
   * occurrence of an unknown character logs one warning).
   */
  draw(
    sink: GlyphSink,
    text: string,
    xPx: number,
    yPx: number,
    colour: number = this.metrics.colours.ink,
    variant: TextVariant = TextVariant.Plain,
    align: TextAlign = TextAlign.Left,
    spacing: LineSpacing = LineSpacing.Hud,
  ): number {
    if (
      !Number.isInteger(xPx) ||
      !Number.isInteger(yPx) ||
      !Number.isInteger(colour) ||
      colour < 0 ||
      colour >= PALETTE_COLOURS
    ) {
      rejectDraw(xPx, yPx, colour);
    }
    // Already whole numbers; `| 0` pins them to int32 so the layout loop never carries (and boxes) doubles.
    const x = xPx | 0;
    const y = yPx | 0;
    const c = colour | 0;
    if (variant === TextVariant.Outline) {
      // Rings first, then the plain ink over them at the same (outlined) pens.
      this.drawLayer(sink, text, x, y, c, variant, align, spacing, this.outlineFrames);
      return this.drawLayer(sink, text, x, y, c, variant, align, spacing, this.plainFrames);
    }
    return this.drawLayer(sink, text, x, y, c, variant, align, spacing, this.plainFrames);
  }

  /** One layer of draw(): lays the text out with `variant`'s metrics and adds `frames`' quads. */
  private drawLayer(
    sink: GlyphSink,
    text: string,
    xPx: number,
    yPx: number,
    colour: number,
    variant: TextVariant,
    align: TextAlign,
    spacing: LineSpacing,
    frames: readonly (FrameId | null)[],
  ): number {
    const advance = variant === TextVariant.Outline ? this.outlineAdvance : this.plainAdvance;
    const kerning = variant === TextVariant.Outline ? this.outlineKerning : this.plainKerning;
    const lineStep = this.lineHeight(variant, spacing);
    const ink = this.metrics.colours.ink;
    const length = text.length;
    let widest = 0;
    let penY = yPx;
    let start = 0;
    while (start <= length) {
      let end = text.indexOf('\n', start);
      if (end < 0) end = length;
      const width = this.lineWidth(text, start, end, variant, frames === this.plainFrames);
      if (width > widest) widest = width;
      let penX = xPx;
      if (align === TextAlign.Centre) penX -= width >> 1;
      else if (align === TextAlign.Right) penX -= width;
      let previous = -1;
      let i = start;
      while (i < end) {
        const cp = text.codePointAt(i) ?? 0;
        i += cp > 0xffff ? 2 : 1;
        const slot = this.slotFor(cp, false);
        if (previous >= 0) penX += kerning.get(previous * this.slotCount + slot) ?? 0;
        const frame = frames[slot] ?? null;
        if (frame !== null) sink.add(frame, penX, penY, ink, colour);
        penX += advance[slot] ?? 0;
        previous = slot;
      }
      start = end + 1;
      penY += lineStep;
    }
    return widest;
  }

  /** Width of text[start, end) (one line) in `variant`; `warn` lets the unknown-character warning fire. */
  private lineWidth(text: string, start: number, end: number, variant: TextVariant, warn: boolean): number {
    const advance = variant === TextVariant.Outline ? this.outlineAdvance : this.plainAdvance;
    const kerning = variant === TextVariant.Outline ? this.outlineKerning : this.plainKerning;
    let width = 0;
    let previous = -1;
    let i = start;
    while (i < end) {
      const cp = text.codePointAt(i) ?? 0;
      i += cp > 0xffff ? 2 : 1;
      const slot = this.slotFor(cp, warn);
      if (previous >= 0) width += kerning.get(previous * this.slotCount + slot) ?? 0;
      width += advance[slot] ?? 0;
      previous = slot;
    }
    return width;
  }

  /** The glyph slot of a code point, or the fallback's (warning once per character in dev builds when `warn`). */
  private slotFor(cp: number, warn: boolean): number {
    const slot = this.slotOf.get(cp);
    if (slot !== undefined) return slot;
    if (warn && WARN_UNKNOWN && !this.warned.has(cp)) {
      this.warned.add(cp);
      console.warn(
        `${this.metrics.id}: no glyph for U+${cp.toString(16).toUpperCase().padStart(4, '0')}, drawing '${this.metrics.fallback}'`,
      );
    }
    return this.fallbackSlot;
  }
  // per-frame draw path: end
}

/** Throws the error BitmapFont.draw found (kept out of the per-frame path, which builds no objects). */
function rejectDraw(xPx: number, yPx: number, colour: number): never {
  if (!Number.isInteger(xPx) || !Number.isInteger(yPx)) {
    throw new RangeError(`text positions are whole internal pixels, got (${xPx}, ${yPx})`);
  }
  throw new RangeError(`text colour ${colour} is not a palette index 0..31`);
}

/** URL of a font's metrics file, relative to the app base (`import.meta.env.BASE_URL`). */
export function fontUrl(name: string, base: string = import.meta.env.BASE_URL): string {
  return `${base}assets/fonts/${name}.json`;
}

/** Fetches JSON (injectable so tests can read files without a browser). */
export type FontJsonSource = (url: string) => Promise<unknown>;

async function browserFetchJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`font fetch ${url}: HTTP ${response.status}`);
  return response.json();
}

/**
 * Loads a font's metrics (`public/assets/fonts/<name>.json`, `name` = the asset ID minus `font.`), validates them
 * and returns the font. Its glyph frames live in the atlas the metrics name (the `ui` atlas for Kerbside 5×7),
 * which the caller loads and draws through (UiSpriteBatch).
 */
export async function loadBitmapFont(
  name: string,
  fetchJson: FontJsonSource = browserFetchJson,
): Promise<BitmapFont> {
  const metrics = parseFontMetrics(await fetchJson(fontUrl(name)));
  if (metrics.id !== `font.${name}`) {
    throw new Error(`font metrics ${name}.json hold '${metrics.id}', not 'font.${name}'`);
  }
  return new BitmapFont(metrics);
}
