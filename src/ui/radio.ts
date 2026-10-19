// Big Pam's radio panel (GDD §15.2, §16.1; ART_BIBLE §12.2, §12.3; SSP-289): the bark queue, the bark text with its
// inline key glyphs, the paging of over-long barks, the corner the panel sits in, and the pure radioModel that
// src/ui/hud.ts draws. Nothing here reads or writes the sim beyond a tuning default (CLAUDE.md hard rule 2).
//
// Barks. A bark is a line of Kerbside 5×7 text in which `{action}` tokens name an input action (any GLYPH_ACTIONS
// name from glyphs.ts: `{throttle}`, `{steer}`, `{brush}`, `{interact}`, `{horn}`, `{spray}` ...) and render as a
// keycap holding that action's label on the active device ('Space' on the keyboard, 'A' on the pad), and
// `{cleanSpeed}` renders the clean-pickup speed as plain text ('9 mph': round(4.0 m/s × 2.237), GDD §7.2; SSP-235's
// units setting switches it later). Any other `{...}` is an authoring error: parseBark throws, so a level that
// carries bark text (SSP-290) can validate it at load.
//
// Queue (GDD §16.1: one prompt at a time). FIFO: a bark enqueued while nothing shows starts at once; otherwise it
// waits for every bark before it. Each page shows for BARK_PAGE_TICKS (180 ticks = 3 s) of Radio.tick() calls, which
// the HUD makes once per sim tick, so barks freeze whenever the sim does (PauseOverlay, the shift's end). Two barks
// never show at once. cancel(id) drops a queued bark, or ends the showing one at once (the tutorial layer drops a
// beat the player has already performed, GDD §16.1). enqueue returns the bark's id (≥ 1), or BARK_NONE for an empty
// bark or a full queue (BARK_QUEUE_MAX waiting).
//
// Paging (decided in SSP-289, GDD §15.2). The panel is at most RADIO_PANEL_MAX_W_PX wide so it stays inside its
// half of the narrowest frame (W = 432), which leaves RADIO_PAGE_MAX_INK_PX for the line. A bark wider than that is
// split at word boundaries (a keycap counts as part of the word it touches) into consecutive one-line pages, each
// shown for its own 180 ticks; a single word wider than a page (none in the game's text) is cut between characters.
// Pages are laid out when a bark starts showing, and again if the active device or the clean speed changes while it
// shows (the page index is kept, clamped), so the glyphs always follow the device in hand (GDD §16.1).
//
// Placement (decided in SSP-289, GDD §15.2; positions in ART_BIBLE §12.2). Home is bottom-left above the brush row;
// away is bottom-right above the minimap slot. The look-ahead point is where Bessie will be in RADIO_LOOK_AHEAD_S
// (her body centre plus her ground velocity × 2.0 s, projected with the render camera). The panel moves to the other
// side when that point is more than RADIO_SIDE_HYSTERESIS_PX inside its own half of the frame and stays put
// otherwise, so it is always on the side Bessie is not driving towards, and a parked or creeping Bessie (whose point
// sits near W / 2) never makes it flicker.
//
// Per frame nothing allocates: the queue, paging and parsing run only when a bark is enqueued, starts, is cancelled
// or is re-laid out; radioModel and the side rule write numbers into a preallocated model and point it at the
// current page's run list. The section between the "per-frame draw path" markers is scanned by
// tests/unit/radio.test.ts for `new` and array literals.
import { DEFAULT_TUNING } from '../sim/tuning.ts';
import { type BitmapFont, TextVariant } from './bitmapText.ts';
import { GLYPH_ACTIONS, type GlyphAction, type GlyphDevice, type GlyphTable, glyphLabel } from './glyphs.ts';
import { type HudRect, MPH_PER_MPS, SAFE_MARGIN_PX } from './hudModel.ts';

/** Ticks each page of a bark shows (GDD §15.2: 3 s at 60 Hz, proposed). */
export const BARK_PAGE_TICKS = 180;
/** Barks the queue holds waiting (not counting the one showing); one more is dropped. */
export const BARK_QUEUE_MAX = 32;
/** The id enqueue returns for a bark it did not queue (empty text or a full queue). */
export const BARK_NONE = 0;

/** The speaker on the name tab. */
export const RADIO_SPEAKER = 'PAM';
/** Pam's bark at the 4th complaint (GDD §11.3). */
export const COMPLAINT_WARN_BARK = "One more and you're off the van!";
/** The token that renders the clean-pickup speed. */
export const CLEAN_SPEED_TOKEN = 'cleanSpeed';

/** The panel's widest and its height (one line plus a keycap's 11 px with a 1 px gap each side). */
export const RADIO_PANEL_MAX_W_PX = 204;
export const RADIO_PANEL_H_PX = 17;
/** The line's left inset from the panel edge (past the 2 px border and the 05 corner bolts at x = 3..4). */
export const RADIO_TEXT_INSET_PX = 6;
/** The text's ink top below the panel top (the 7 px line centred in the 13 px fill). */
export const RADIO_TEXT_TOP_PX = 5;
/** The widest line ink a page may hold: the widest panel minus the inset on both sides (192 px, 32 glyphs). */
export const RADIO_PAGE_MAX_INK_PX = RADIO_PANEL_MAX_W_PX - 2 * RADIO_TEXT_INSET_PX;
/** The name tab: 21 × 10 above the panel's top edge, 4 px in from its left (3 glyphs + 1 px pad + 1 px 00 border). */
export const RADIO_TAB_W_PX = 21;
export const RADIO_TAB_H_PX = 10;
export const RADIO_TAB_INSET_PX = 4;
/** The narrowest panel: room for the tab with 4 px either side. */
export const RADIO_PANEL_MIN_W_PX = RADIO_TAB_INSET_PX + RADIO_TAB_W_PX + 4;
/** A keycap: 11 px tall (1 px 07 box, 1 px pad, the 7 px label), its top 3 px below the panel's. */
export const KEYCAP_H_PX = 11;
export const KEYCAP_TOP_PX = 3;
/** Pixels from a keycap's edge to its label's ink (the box and the pad). */
export const KEYCAP_LABEL_INSET_PX = 2;
/** The whole element (tab + panel) and the panel tops: home bottom-left, away bottom-right over the minimap slot. */
export const RADIO_SLOT_H_PX = RADIO_TAB_H_PX + RADIO_PANEL_H_PX;
export const RADIO_HOME_Y = 197;
export const RADIO_AWAY_Y = 173;

/** Seconds ahead of Bessie the look-ahead point is (proposed in SSP-289, tunable). */
export const RADIO_LOOK_AHEAD_S = 2.0;
/** How far into the panel's half the point must be before the panel moves (proposed in SSP-289, tunable). */
export const RADIO_SIDE_HYSTERESIS_PX = 8;

/** The panel's corner: home (bottom-left) or away (bottom-right). */
export const RadioSide = { Home: 0, Away: 1 } as const;
export type RadioSide = (typeof RadioSide)[keyof typeof RadioSide];

/** One parsed piece of a bark. */
export type BarkPiece =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'key'; readonly action: GlyphAction }
  | { readonly kind: 'cleanSpeed' };

/** One run of a laid-out page: plain text, or a keycap holding `text` (the label). x from the line's left. */
export type RadioRun = {
  readonly keycap: boolean;
  readonly text: string;
  readonly xPx: number;
  /** The run's ink width: the text's advance sum, or the keycap's box. */
  readonly wPx: number;
};

/** One page: its runs in order and the line's ink width. */
export type RadioPage = { readonly runs: readonly RadioRun[]; readonly inkPx: number };

/** What a bark's tokens resolve against. */
export type BarkContext = {
  readonly glyphs: GlyphTable;
  readonly device: GlyphDevice;
  /** The clean-pickup speed, m/s (tuning.json brush.cleanPickupMaxMps). */
  readonly cleanSpeedMps: number;
};

/** What src/ui/hud.ts draws: the panel's place and width, and the current page's runs. */
export type RadioModel = {
  visible: boolean;
  side: RadioSide;
  /** The panel's top-left and width (the tab sits RADIO_TAB_H_PX above it). */
  panelX: number;
  panelY: number;
  panelW: number;
  runs: readonly RadioRun[];
};

const GLYPH_ACTION_SET: ReadonlySet<string> = new Set(GLYPH_ACTIONS);
const NO_RUNS: readonly RadioRun[] = Object.freeze([]);
const NO_PAGES: readonly RadioPage[] = Object.freeze([]);

function isGlyphAction(name: string): name is GlyphAction {
  return GLYPH_ACTION_SET.has(name);
}

/**
 * Splits bark text into text pieces and `{token}` pieces. Throws for an unknown token or an unmatched brace, naming
 * it (authoring errors; see the header). Setup and enqueue only: allocates.
 */
export function parseBark(source: string): BarkPiece[] {
  const pieces: BarkPiece[] = [];
  let i = 0;
  while (i < source.length) {
    const open = source.indexOf('{', i);
    const close = source.indexOf('}', i);
    if (close >= 0 && (open < 0 || close < open)) {
      throw new Error(`bark ${JSON.stringify(source)}: '}' at ${close} without '{'`);
    }
    if (open < 0) {
      pieces.push({ kind: 'text', text: source.slice(i) });
      break;
    }
    if (open > i) pieces.push({ kind: 'text', text: source.slice(i, open) });
    const end = source.indexOf('}', open);
    if (end < 0) throw new Error(`bark ${JSON.stringify(source)}: '{' at ${open} is never closed`);
    const name = source.slice(open + 1, end);
    if (name === CLEAN_SPEED_TOKEN) pieces.push({ kind: 'cleanSpeed' });
    else if (isGlyphAction(name)) pieces.push({ kind: 'key', action: name });
    else {
      throw new Error(
        `bark ${JSON.stringify(source)}: unknown token {${name}} (use ${[...GLYPH_ACTIONS, CLEAN_SPEED_TOKEN].join(', ')})`,
      );
    }
    i = end + 1;
  }
  return pieces;
}

/** The clean-pickup speed as the bark shows it: round(m/s × 2.237) + ' mph' (4.0 m/s → '9 mph'). */
export function cleanSpeedText(mps: number): string {
  return `${Math.round(mps * MPH_PER_MPS)} mph`;
}

/** The bark as one plain string with every token resolved (keycap labels as bare text): for tests and logs. */
export function barkPlainText(pieces: readonly BarkPiece[], context: BarkContext): string {
  let out = '';
  for (const p of pieces) {
    if (p.kind === 'text') out += p.text;
    else if (p.kind === 'key') out += glyphLabel(context.glyphs, p.action, context.device);
    else out += cleanSpeedText(context.cleanSpeedMps);
  }
  return out;
}

/** Ink width of one line of plain text (its advance sum minus the trailing letter gap; 0 when empty). */
function inkWidth(font: BitmapFont, text: string): number {
  const w = font.measure(text, TextVariant.Plain);
  return w > 0 ? w - 1 : 0;
}

/** The width of the keycap holding `label`: its ink plus the box and pad on both sides. */
export function keycapWidthPx(font: BitmapFont, label: string): number {
  return inkWidth(font, label) + 2 * KEYCAP_LABEL_INSET_PX;
}

/** One unbreakable part of a word: text, or a keycap's label. */
type Seg = { readonly keycap: boolean; readonly text: string };

/** Pixels a segment moves the pen: text its advance sum, a keycap its box plus the 1 px letter gap. */
function segAdvance(font: BitmapFont, s: Seg): number {
  return s.keycap ? keycapWidthPx(font, s.text) + 1 : font.measure(s.text, TextVariant.Plain);
}

function wordAdvance(font: BitmapFont, word: readonly Seg[]): number {
  let a = 0;
  for (const s of word) a += segAdvance(font, s);
  return a;
}

/** Appends text to a word, merging it into a text segment that ends the word. */
function appendText(word: Seg[], text: string): void {
  const last = word[word.length - 1];
  if (last !== undefined && !last.keycap) word[word.length - 1] = { keycap: false, text: last.text + text };
  else word.push({ keycap: false, text });
}

/** The bark's words: segments between spaces, a keycap joined to the text it touches. */
function barkWords(pieces: readonly BarkPiece[], context: BarkContext): Seg[][] {
  const words: Seg[][] = [];
  let word: Seg[] = [];
  const flush = (): void => {
    if (word.length > 0) words.push(word);
    word = [];
  };
  for (const p of pieces) {
    if (p.kind === 'key') {
      word.push({ keycap: true, text: glyphLabel(context.glyphs, p.action, context.device) });
      continue;
    }
    const text = p.kind === 'text' ? p.text : cleanSpeedText(context.cleanSpeedMps);
    const parts = text.split(/\s/);
    parts.forEach((part, k) => {
      if (k > 0) flush();
      if (part !== '') appendText(word, part);
    });
  }
  flush();
  return words;
}

/** Cuts a word wider than `maxInkPx` between characters into fragments that fit (a lone keycap stays whole). */
function cutWord(font: BitmapFont, word: readonly Seg[], maxInkPx: number): Seg[][] {
  const fragments: Seg[][] = [];
  let current: Seg[] = [];
  let advance = 0;
  const units: Seg[] = [];
  for (const s of word) {
    if (s.keycap) units.push(s);
    else for (const ch of s.text) units.push({ keycap: false, text: ch });
  }
  for (const unit of units) {
    const a = segAdvance(font, unit);
    if (current.length > 0 && advance + a - 1 > maxInkPx) {
      fragments.push(current);
      current = [];
      advance = 0;
    }
    if (unit.keycap) current.push(unit);
    else appendText(current, unit.text);
    advance += a;
  }
  if (current.length > 0) fragments.push(current);
  return fragments;
}

/** Turns one line of words into runs, with one space between words. */
function lineToPage(font: BitmapFont, line: readonly (readonly Seg[])[]): RadioPage {
  const runs: RadioRun[] = [];
  let pen = 0;
  let text = '';
  let textX = 0;
  const flushText = (): void => {
    if (text === '') return;
    runs.push({ keycap: false, text, xPx: textX, wPx: inkWidth(font, text) });
    text = '';
  };
  const addText = (t: string): void => {
    if (text === '') textX = pen;
    text += t;
    pen += font.measure(t, TextVariant.Plain);
  };
  line.forEach((word, k) => {
    if (k > 0) addText(' ');
    for (const seg of word) {
      if (!seg.keycap) {
        addText(seg.text);
        continue;
      }
      flushText();
      const w = keycapWidthPx(font, seg.text);
      runs.push({ keycap: true, text: seg.text, xPx: pen, wPx: w });
      pen += w + 1;
    }
  });
  flushText();
  // Words are joined by single spaces and never end in one, so the ink ends 1 px before the pen.
  return Object.freeze({ runs: Object.freeze(runs), inkPx: pen > 0 ? pen - 1 : 0 });
}

/**
 * Lays a bark out as one-line pages no wider than `maxInkPx`, splitting at word boundaries (see the header).
 * An empty bark has no pages. Allocates (when a bark starts showing or is re-laid out, never per frame).
 */
export function pageBark(
  pieces: readonly BarkPiece[],
  font: BitmapFont,
  context: BarkContext,
  maxInkPx: number = RADIO_PAGE_MAX_INK_PX,
): RadioPage[] {
  const space = font.measure(' ', TextVariant.Plain);
  const lines: Seg[][][] = [];
  let line: Seg[][] = [];
  let advance = 0;
  const pushLine = (): void => {
    if (line.length > 0) lines.push(line);
    line = [];
    advance = 0;
  };
  for (const word of barkWords(pieces, context)) {
    const a = wordAdvance(font, word);
    if (a - 1 > maxInkPx) {
      pushLine();
      const fragments = cutWord(font, word, maxInkPx);
      const last = fragments.pop();
      for (const fragment of fragments) lines.push([fragment]);
      if (last !== undefined) {
        line = [last];
        advance = wordAdvance(font, last);
      }
      continue;
    }
    if (line.length > 0 && advance + space + a - 1 > maxInkPx) pushLine();
    advance += (line.length > 0 ? space : 0) + a;
    line.push(word);
  }
  pushLine();
  return lines.map((l) => lineToPage(font, l));
}

/** The home and away slots (tab + panel at their widest) at internal width `widthPx` (setup and resize only). */
export function radioSlots(widthPx: number): { readonly home: HudRect; readonly away: HudRect } {
  return {
    home: { x: SAFE_MARGIN_PX, y: RADIO_HOME_Y, w: RADIO_PANEL_MAX_W_PX, h: RADIO_SLOT_H_PX },
    away: {
      x: widthPx - SAFE_MARGIN_PX - RADIO_PANEL_MAX_W_PX,
      y: RADIO_AWAY_Y,
      w: RADIO_PANEL_MAX_W_PX,
      h: RADIO_SLOT_H_PX,
    },
  };
}

/** A hidden model to write into. Setup only. */
export function createRadioModel(): RadioModel {
  return { visible: false, side: RadioSide.Home, panelX: 0, panelY: 0, panelW: 0, runs: NO_RUNS };
}

// per-frame draw path: begin
/** The panel width for a bark whose widest page is `widestInkPx`: the line plus its insets, at least the tab's. */
export function radioPanelWidth(widestInkPx: number): number {
  const w = widestInkPx + 2 * RADIO_TEXT_INSET_PX;
  return w < RADIO_PANEL_MIN_W_PX ? RADIO_PANEL_MIN_W_PX : w;
}

/**
 * The model for `page` (null: nothing showing) of a bark whose widest page is `widestInkPx`, on `side`, at internal
 * width `widthPx`: home is left-aligned at the margin with the panel top at RADIO_HOME_Y + RADIO_TAB_H_PX, away is
 * right-aligned at the margin with it at RADIO_AWAY_Y + RADIO_TAB_H_PX. Pure; allocates nothing.
 */
export function radioModel(
  page: RadioPage | null,
  widestInkPx: number,
  side: RadioSide,
  widthPx: number,
  out: RadioModel,
): RadioModel {
  out.side = side;
  if (page === null) {
    out.visible = false;
    out.runs = NO_RUNS;
    return out;
  }
  const w = radioPanelWidth(widestInkPx);
  out.visible = true;
  out.panelW = w;
  out.panelX = side === RadioSide.Home ? SAFE_MARGIN_PX : widthPx - SAFE_MARGIN_PX - w;
  out.panelY = (side === RadioSide.Home ? RADIO_HOME_Y : RADIO_AWAY_Y) + RADIO_TAB_H_PX;
  out.runs = page.runs;
  return out;
}

/**
 * The look-ahead point's x in internal pixels: Bessie's body centre plus her ground velocity × RADIO_LOOK_AHEAD_S,
 * projected with the camera (centre W / 2 + (x − cameraX) × px/m). Without a camera (pxPerM ≤ 0) it is W / 2.
 */
export function radioLookAheadXPx(
  bessieXM: number,
  bessieVxMps: number,
  cameraXM: number,
  pxPerM: number,
  widthPx: number,
): number {
  if (!(pxPerM > 0)) return widthPx / 2;
  return widthPx / 2 + (bessieXM + bessieVxMps * RADIO_LOOK_AHEAD_S - cameraXM) * pxPerM;
}

/**
 * The relocation rule: from `side`, the side the panel should be on when the look-ahead point is at x
 * `lookAheadXPx` in a frame `widthPx` wide. Home (left) moves away once the point is more than the hysteresis inside
 * the left half; away moves back once it is more than the hysteresis inside the right half. Pure.
 */
export function radioSide(side: RadioSide, lookAheadXPx: number, widthPx: number): RadioSide {
  const half = widthPx / 2;
  if (side === RadioSide.Home) return lookAheadXPx < half - RADIO_SIDE_HYSTERESIS_PX ? RadioSide.Away : side;
  return lookAheadXPx > half + RADIO_SIDE_HYSTERESIS_PX ? RadioSide.Home : side;
}
// per-frame draw path: end

/** One queued bark. */
type QueuedBark = { readonly id: number; readonly text: string; readonly pieces: readonly BarkPiece[] };

/** The bark queue, the showing bark's pages, and the panel's side. One per HUD. */
export class Radio {
  readonly font: BitmapFont;
  readonly glyphs: GlyphTable;
  /** The panel's corner (radioSide, updated by updateSide). */
  side: RadioSide = RadioSide.Home;
  private device: GlyphDevice = 'keyboard';
  private cleanSpeedMps: number;
  private readonly queue: QueuedBark[] = [];
  private nextId = 1;
  private showing: QueuedBark | null = null;
  private pages: readonly RadioPage[] = NO_PAGES;
  private widestInkPx = 0;
  /** What `pages` were laid out with. */
  private pagesDevice: GlyphDevice = 'keyboard';
  private pagesCleanSpeedMps = 0;
  private page = 0;
  private age = 0;

  constructor(
    font: BitmapFont,
    glyphs: GlyphTable,
    cleanSpeedMps: number = DEFAULT_TUNING.vehicle.sweeper.brush.cleanPickupMaxMps,
  ) {
    this.font = font;
    this.glyphs = glyphs;
    this.cleanSpeedMps = cleanSpeedMps;
  }

  /**
   * Queues `text` (parsed now: an unknown token throws) and returns its id, or BARK_NONE when it is empty or the
   * queue already holds BARK_QUEUE_MAX barks. With nothing showing it starts at once, at age 0.
   */
  enqueue(text: string): number {
    const pieces = parseBark(text);
    if (barkPlainText(pieces, this.context()).trim() === '') return BARK_NONE;
    if (this.queue.length >= BARK_QUEUE_MAX) return BARK_NONE;
    const id = this.nextId;
    this.nextId += 1;
    this.queue.push({ id, text, pieces });
    if (this.showing === null) this.startNext();
    return id;
  }

  /** Drops bark `id` if it is queued, or ends it now if it is showing. Returns false for an unknown or past id. */
  cancel(id: number): boolean {
    if (this.showing !== null && this.showing.id === id) {
      this.startNext();
      return true;
    }
    const k = this.queue.findIndex((b) => b.id === id);
    if (k < 0) return false;
    this.queue.splice(k, 1);
    return true;
  }

  /** Forgets every bark (a new shift); the panel goes home. */
  clear(): void {
    this.queue.length = 0;
    this.showing = null;
    this.pages = NO_PAGES;
    this.widestInkPx = 0;
    this.page = 0;
    this.age = 0;
    this.side = RadioSide.Home;
  }

  /** The id of the bark showing, or BARK_NONE. */
  get currentId(): number {
    return this.showing?.id ?? BARK_NONE;
  }

  /** The source text of the bark showing, or null. */
  get currentText(): string | null {
    return this.showing?.text ?? null;
  }

  /** The ids waiting, in order (not the one showing). */
  get queuedIds(): number[] {
    return this.queue.map((b) => b.id);
  }

  /** The showing bark's pages (empty when nothing shows), its page index and the ticks that page has shown. */
  get currentPages(): readonly RadioPage[] {
    return this.pages;
  }

  get pageIndex(): number {
    return this.page;
  }

  get pageAgeTicks(): number {
    return this.age;
  }

  // per-frame draw path: begin
  /** The page showing, or null. */
  current(): RadioPage | null {
    if (this.showing === null) return null;
    return this.pages[this.page] ?? null;
  }

  /** The device whose glyphs the keycaps show (the HUD sets it every frame); a change re-lays out the bark. */
  setDevice(device: GlyphDevice): void {
    if (device === this.device) return;
    this.device = device;
    this.relayout();
  }

  /** The clean-pickup speed the {cleanSpeed} token shows (the HUD sets it every tick from the World). */
  setCleanSpeed(mps: number): void {
    if (mps === this.cleanSpeedMps) return;
    this.cleanSpeedMps = mps;
    this.relayout();
  }

  /** One sim tick: the showing page ages; at BARK_PAGE_TICKS the next page, then the next bark, takes over. */
  tick(): void {
    if (this.showing === null) return;
    this.age += 1;
    if (this.age < BARK_PAGE_TICKS) return;
    if (this.page + 1 < this.pages.length) {
      this.page += 1;
      this.age = 0;
      return;
    }
    this.startNext();
  }

  /** Applies the relocation rule (radioSide) for the look-ahead point at x `lookAheadXPx` in a `widthPx` frame. */
  updateSide(lookAheadXPx: number, widthPx: number): void {
    this.side = radioSide(this.side, lookAheadXPx, widthPx);
  }

  /** The panel's model at internal width `widthPx` (radioModel over the page showing). */
  writeModel(widthPx: number, out: RadioModel): RadioModel {
    return radioModel(this.current(), this.widestInkPx, this.side, widthPx, out);
  }
  // per-frame draw path: end

  private context(): BarkContext {
    return { glyphs: this.glyphs, device: this.device, cleanSpeedMps: this.cleanSpeedMps };
  }

  /** Shows the next queued bark from its first page (or nothing). */
  private startNext(): void {
    const next = this.queue.shift() ?? null;
    this.showing = next;
    this.page = 0;
    this.age = 0;
    this.pages = NO_PAGES;
    this.widestInkPx = 0;
    if (next !== null) this.layout(next);
  }

  /** Lays the showing bark out again if the device or clean speed it was laid out with has changed. */
  private relayout(): void {
    const bark = this.showing;
    if (bark === null) return;
    if (this.pagesDevice === this.device && this.pagesCleanSpeedMps === this.cleanSpeedMps) return;
    this.layout(bark);
    if (this.page >= this.pages.length) this.page = this.pages.length - 1;
  }

  private layout(bark: QueuedBark): void {
    const pages = Object.freeze(pageBark(bark.pieces, this.font, this.context()));
    let widest = 0;
    for (const p of pages) if (p.inkPx > widest) widest = p.inkPx;
    this.pages = pages;
    this.widestInkPx = widest;
    this.pagesDevice = this.device;
    this.pagesCleanSpeedMps = this.cleanSpeedMps;
  }
}
