// The M2 basic HUD (GDD §15.2, ART_BIBLE §12.2; SSP-070): shift timer, score, combo with its chain-timer bar and
// tier popups, hopper, water and Dignity gauges, and the hold-to-dump prompt, drawn in Kerbside 5×7 as quads of
// the one UI draw (render/spriteBatch.ts UiSpriteBatch). hudModel.ts decides what each element shows; this file
// only reads the World into the model's snapshot, keeps the HUD's own state (the score roll and the last tier
// popup) and draws the model at its place on screen. It never writes the sim (CLAUDE.md hard rule 2): the World
// comes in as a WorldView and tier rises come from the event bus (src/app/events.ts, EV.ComboTier).
//
// Layout (hudLayout; internal pixels, x right, y down; every element inside the 4 px safe margin at every width
// W = 432..640, anchored to the corners or to W / 2, so a wider screen adds road, not HUD). A box is the element's
// full extent; outlined text (the 1 px ink ring) puts its first pen 1 px inside its box.
//   timer       box (4, 4), 'm:ss' outlined, 28×9;
//   score       box top y = 4, centred on W / 2, outlined, commas every three digits (at most '-9,999,999');
//   combo       4 px right of the score's box, same baseline, outlined, tier colour;
//   chain bar   the 48×2 fill in a 1 px ink frame (50×4 at full), centred on W / 2 at y = 14, shrinking towards
//               the middle with the chain timer;
//   tier popup  centred on W / 2, its box top at y = 39 rising to 27;
//   dump prompt the 20×20 ui.dump_ring centred on W / 2 with its top at y = 224 (bottom-centre, above the gauges
//               and clear of the look-ahead zone, which is empty while Bessie is stopped), the key label 'E' in
//               07 inside it;
//   gauges      bottom-left: each a label (outlined, 07) with its box top at y = 248 above a 64×6 bar in a 1 px
//               ink frame (66×8 at y = 258) on a 03 track: HOPPER at x = 4 with its percentage, 'FULL' or '!'
//               to the right of the bar (x = 72), then WATER and DIGNITY, 6 px apart. The labels stand in for the
//               16×16 icons until M4 (SSP-156).
//   complaints  top-right (SSP-078): five 16×16 boxes 2 px apart (88×16), right-aligned 1 px inside the margin
//               at y = 16, under the top row (at W = 432 and 480 the widest combo reaches past W − 92, so the
//               meter cannot share the row), in a 90×16 box that holds the ±1 px shakes. Placeholder art until
//               M4 (SSP-156): an empty box is a 06 outline form (8×10, two lines) on 25 inside a 1 px 00 border;
//               a stamped box adds an 18 stamp (a 2 px ring and a 6×6 centre block, the GDD's ▣); the slam's
//               first frame is the solid 14×14 18 stamp face.
// Bars are sub-rectangles of the solid ui.bar_fill frame recoloured 07 → the wanted index (addRegion), so they need
// no frame per length and cost no extra draw call.
//
// Per frame nothing allocates: the score is formatted into a preallocated byte buffer and drawn one character at
// a time from a table of one-character strings (every Kerbside 5×7 glyph is 5 px wide on a 7 px outlined advance,
// so a character's ring never reaches its neighbour's ink: the result equals drawing the whole string, which
// tests/unit/hud.test.ts checks), positions come from the cached layout, and the model is rewritten in place. The
// sections between the "per-frame draw path" markers are scanned by tests/unit/hud.test.ts for `new` and array
// literals, and tests/unit/hudHeap.test.ts measures the heap.
import type { EventBus, Unsubscribe } from '../app/events.ts';
import { FRAME, type FrameId } from '../gen/assets.ts';
import { EV } from '../sim/eventQueue.ts';
import type { WorldView } from '../sim/world.ts';
import { type BitmapFont, TextVariant } from './bitmapText.ts';
import {
  CHAIN_BAR_H_PX,
  CHAIN_BAR_PX,
  COMBO_TEXTS,
  COMPLAINT_SLOTS,
  ComplaintSlotState,
  createHudModel,
  createHudSnapshot,
  DUMP_KEY_TEXT,
  GAUGE_FILL_H_PX,
  GAUGE_FILL_PX,
  HOPPER_FULL_TEXT,
  HOPPER_WARN_TEXT,
  HudColour,
  type HudModel,
  type HudSnapshot,
  hudModel,
  POPUP_RISE_PX,
  readHudSnapshot,
  TIER_WORDS,
} from './hudModel.ts';
import { BUTTON_NO_RECOLOUR, type PanelSink } from './panels.ts';

/** The solid frame every bar is cut from, and its size. */
export const BAR_FRAME: FrameId = 'ui.bar_fill:bar:-:0';
/** Rows of the bar frame (66×8): a taller box takes one quad per this many rows. */
const BAR_FRAME_H_PX = FRAME[BAR_FRAME].h;
const BAR_FRAME_INK = HudColour.Chalk;

/** The hold-to-dump ring frames, by fill step 0..8. */
export const DUMP_RING_FRAMES: readonly FrameId[] = Object.freeze([
  'ui.dump_ring:fill:-:0',
  'ui.dump_ring:fill:-:1',
  'ui.dump_ring:fill:-:2',
  'ui.dump_ring:fill:-:3',
  'ui.dump_ring:fill:-:4',
  'ui.dump_ring:fill:-:5',
  'ui.dump_ring:fill:-:6',
  'ui.dump_ring:fill:-:7',
  'ui.dump_ring:fill:-:8',
] satisfies FrameId[]);

/** The safe margin from every edge (GDD §15.2, ART_BIBLE §12.2). */
export const HUD_MARGIN_PX = 4;
/** Internal height (TECHNICAL_DESIGN §12.1). */
export const HUD_HEIGHT_PX = 270;
/** The internal widths the HUD must fit (TECHNICAL_DESIGN §12.1). */
export const HUD_MIN_WIDTH_PX = 432;
export const HUD_MAX_WIDTH_PX = 640;

/** Top row: box top of the timer, score and combo. */
export const HUD_TOP_Y = 4;
/** Gap between the score's box and the combo's. */
export const COMBO_GAP_PX = 4;
/** Top of the chain-timer bar's frame. */
export const CHAIN_BAR_Y = 14;
/** Box top of the tier popup before it rises. */
export const POPUP_Y = 39;
/** Side and top of the dump ring (20×20, centred on W / 2). */
export const DUMP_RING_PX = 20;
export const DUMP_RING_Y = 224;
/** The key label's ink inside the ring: 5×7 on the ring's 10 px disc. */
export const DUMP_KEY_DX = 7;
export const DUMP_KEY_DY = 6;
/** Gauge rows: label box top, bar frame top, side text box top. */
export const GAUGE_LABEL_Y = 248;
export const GAUGE_BAR_Y = 258;
export const GAUGE_TEXT_Y = 257;
/** A gauge bar's frame: the 64×6 fill plus a 1 px ink border. */
export const GAUGE_BAR_W_PX = GAUGE_FILL_PX + 2;
export const GAUGE_BAR_H_PX = GAUGE_FILL_H_PX + 2;
/** Gap between the hopper bar and its text, and between the '%' and the '!'. */
export const GAUGE_TEXT_GAP_PX = 2;
export const HOPPER_WARN_GAP_PX = 1;
/** Gap between gauges. */
export const GAUGE_GAP_PX = 6;
/** The gauge labels (placeholders for the M4 icons). */
export const GAUGE_LABELS = Object.freeze({ hopper: 'HOPPER', water: 'WATER', dignity: 'DIGNITY' });
/** Complaints meter (ART_BIBLE §12.2): box size, gap, row and the shake room on each side. */
export const COMPLAINT_BOX_PX = 16;
export const COMPLAINT_GAP_PX = 2;
export const COMPLAINTS_Y = 16;
export const COMPLAINT_SHAKE_PX = 1;
/** The five boxes at rest: 5 × 16 + 4 × 2 = 88 px. */
export const COMPLAINT_METER_W_PX =
  COMPLAINT_SLOTS * COMPLAINT_BOX_PX + (COMPLAINT_SLOTS - 1) * COMPLAINT_GAP_PX;

/** The widest score: a sign and seven digits with two commas. */
export const SCORE_MAX = 9_999_999;
export const SCORE_MAX_CHARS = 10;

/** Ticks of the score roll: each tick closes 1/SCORE_ROLL_DIVISOR of the gap (at least 1 point). */
export const SCORE_ROLL_DIVISOR = 8;

/** A whole-pixel rectangle. */
export type HudRect = { readonly x: number; readonly y: number; readonly w: number; readonly h: number };

/**
 * Where everything sits at one width: fixed anchors, plus each element's reserved box (its largest extent over
 * every value it can show), which tests check for the margin and for overlap.
 */
export type HudLayout = {
  readonly widthPx: number;
  readonly centreX: number;
  readonly timer: HudRect;
  readonly gauges: {
    readonly hopper: HudRect;
    readonly water: HudRect;
    readonly dignity: HudRect;
  };
  /** x of the hopper's side text box. */
  readonly hopperTextX: number;
  /** x of the first complaints box at rest (the meter's reserved box starts 1 px left of it). */
  readonly complaintsX: number;
  /**
   * Reserved boxes by element. The score and the combo share one (`scoreCombo`): the combo follows the score's
   * right edge, so their boxes would overlap; tests check that their pixels never touch.
   */
  readonly reserved: Readonly<Record<HudElement, HudRect>>;
};

/** The HUD's elements (GDD §15.2 for M2, plus the dump prompt). */
export type HudElement =
  | 'timer'
  | 'scoreCombo'
  | 'chainBar'
  | 'popup'
  | 'dump'
  | 'complaints'
  | 'hopper'
  | 'water'
  | 'dignity';

/** Width of outlined text: the sum of its advances (a box 1 px left of the first pen). */
function outlinedWidth(font: BitmapFont, text: string): number {
  return font.measure(text, TextVariant.Outline);
}

/** Box height of outlined text (the 7 px glyph plus its ring). */
function outlinedHeight(font: BitmapFont): number {
  return font.metrics.glyph.h + 2;
}

/** The layout at width `widthPx` (setup and resize only: allocates). */
export function hudLayout(font: BitmapFont, widthPx: number): HudLayout {
  if (!Number.isInteger(widthPx) || widthPx <= 0) throw new RangeError(`HUD width ${widthPx}`);
  const textH = outlinedHeight(font);
  const centreX = widthPx >> 1;
  const m = HUD_MARGIN_PX;
  const timer: HudRect = { x: m, y: HUD_TOP_Y, w: outlinedWidth(font, '0:00'), h: textH };

  const hopperTextX = m + GAUGE_BAR_W_PX + GAUGE_TEXT_GAP_PX;
  const hopperSlot = Math.max(
    outlinedWidth(font, HOPPER_FULL_TEXT),
    outlinedWidth(font, '100%'),
    outlinedWidth(font, '99%') + HOPPER_WARN_GAP_PX + outlinedWidth(font, HOPPER_WARN_TEXT),
  );
  const gaugeH = GAUGE_BAR_Y + GAUGE_BAR_H_PX - GAUGE_LABEL_Y;
  const hopperW = Math.max(outlinedWidth(font, GAUGE_LABELS.hopper), hopperTextX + hopperSlot - m);
  const hopper: HudRect = { x: m, y: GAUGE_LABEL_Y, w: hopperW, h: gaugeH };
  const waterX = hopper.x + hopper.w + GAUGE_GAP_PX;
  const water: HudRect = {
    x: waterX,
    y: GAUGE_LABEL_Y,
    w: Math.max(GAUGE_BAR_W_PX, outlinedWidth(font, GAUGE_LABELS.water)),
    h: gaugeH,
  };
  const dignityX = water.x + water.w + GAUGE_GAP_PX;
  const dignity: HudRect = {
    x: dignityX,
    y: GAUGE_LABEL_Y,
    w: Math.max(GAUGE_BAR_W_PX, outlinedWidth(font, GAUGE_LABELS.dignity)),
    h: gaugeH,
  };

  // The score centred at its widest, then the widest combo beside it.
  const widestScore = SCORE_MAX_CHARS * outlinedWidth(font, '0');
  const scoreX0 = centreX - (widestScore >> 1);
  let comboMaxW = 0;
  for (const t of COMBO_TEXTS) comboMaxW = Math.max(comboMaxW, outlinedWidth(font, t));
  const scoreCombo: HudRect = {
    x: scoreX0,
    y: HUD_TOP_Y,
    w: widestScore + COMBO_GAP_PX + comboMaxW,
    h: textH,
  };
  let popupMaxW = 0;
  for (const t of TIER_WORDS) popupMaxW = Math.max(popupMaxW, outlinedWidth(font, t));
  const popup: HudRect = {
    x: centreX - (popupMaxW >> 1),
    y: POPUP_Y - POPUP_RISE_PX,
    w: popupMaxW,
    h: textH + POPUP_RISE_PX,
  };
  const chainBar: HudRect = {
    x: centreX - (CHAIN_BAR_PX >> 1) - 1,
    y: CHAIN_BAR_Y,
    w: CHAIN_BAR_PX + 2,
    h: CHAIN_BAR_H_PX + 2,
  };
  const dump: HudRect = {
    x: centreX - (DUMP_RING_PX >> 1),
    y: DUMP_RING_Y,
    w: DUMP_RING_PX,
    h: DUMP_RING_PX,
  };
  const complaintsX = widthPx - m - COMPLAINT_SHAKE_PX - COMPLAINT_METER_W_PX;
  const complaints: HudRect = {
    x: complaintsX - COMPLAINT_SHAKE_PX,
    y: COMPLAINTS_Y,
    w: COMPLAINT_METER_W_PX + 2 * COMPLAINT_SHAKE_PX,
    h: COMPLAINT_BOX_PX,
  };
  return {
    widthPx,
    centreX,
    timer,
    gauges: { hopper, water, dignity },
    hopperTextX,
    complaintsX,
    reserved: { timer, scoreCombo, chainBar, popup, dump, complaints, hopper, water, dignity },
  };
}

/** One-character strings for ASCII 0..127, so per-character drawing never builds a string. */
const CHAR_STRINGS: readonly string[] = Object.freeze(
  Array.from({ length: 128 }, (_, c) => String.fromCharCode(c)),
);

const CODE_0 = 48;
const CODE_COMMA = 44;
const CODE_MINUS = 45;

/**
 * Writes `value` (rounded, clamped to ±SCORE_MAX) as ASCII codes into `out` with commas every three digits and a
 * leading '-' when negative; returns the length. Allocates nothing.
 */
// per-frame draw path: begin
export function writeScoreChars(value: number, out: Uint8Array): number {
  let v = Math.round(value);
  if (Number.isNaN(v)) v = 0;
  const negative = v < 0;
  if (negative) v = -v;
  if (v > SCORE_MAX) v = SCORE_MAX;
  // Digits right to left into the end of `out`, then shift to the front.
  let i = out.length;
  let digits = 0;
  do {
    if (digits > 0 && digits % 3 === 0) out[--i] = CODE_COMMA;
    out[--i] = CODE_0 + (v % 10);
    v = Math.floor(v / 10);
    digits++;
  } while (v > 0);
  if (negative) out[--i] = CODE_MINUS;
  const n = out.length - i;
  out.copyWithin(0, i);
  return n;
}
// per-frame draw path: end

/** Draws the HUD into one UI batch with Kerbside 5×7. */
export class Hud {
  readonly sink: PanelSink;
  readonly font: BitmapFont;
  /** What the HUD read last (filled by draw from the WorldView). */
  readonly snapshot: HudSnapshot = createHudSnapshot();
  /** What the HUD drew last. */
  readonly model: HudModel = createHudModel();
  private layoutCache: HudLayout | null = null;
  /** The score being shown, rolled towards the sim's each tick (GDD §15.2). */
  private shownScore = 0;
  private readonly scoreChars = new Uint8Array(16);
  /** EV.Complaint events seen this shift: the next box to stamp. */
  private complaintsSeen = 0;

  constructor(sink: PanelSink, font: BitmapFont) {
    this.sink = sink;
    this.font = font;
  }

  /** The layout at `widthPx` (cached; rebuilt only when the width changes). */
  layout(widthPx: number): HudLayout {
    const cached = this.layoutCache;
    if (cached !== null && cached.widthPx === widthPx) return cached;
    const next = hudLayout(this.font, widthPx);
    this.layoutCache = next;
    return next;
  }

  /** The score currently shown (mid-roll it lags the sim's). */
  get displayedScore(): number {
    return this.shownScore;
  }

  /**
   * Records a combo tier change (EV.ComboTier): a rise starts the tier popup on the first frame after the
   * emitting tick (World.tick = tick + 1 at age 0); a drop changes nothing.
   */
  onComboTier(multiplier: number, previousMultiplier: number, tick: number): void {
    if (!(multiplier > previousMultiplier) || multiplier < 2) return;
    this.snapshot.popupStartTick = tick + 1;
    this.snapshot.popupMultiplier = multiplier;
  }

  /**
   * Records a complaint (EV.Complaint): the next box's stamp starts slamming in on the first frame after the
   * emitting tick (World.tick = tick + 1 at age 0). How many boxes are stamped comes from the World; this only
   * times the stamps. Complaints past the fifth box change nothing.
   */
  onComplaint(tick: number): void {
    const slot = this.complaintsSeen;
    if (slot >= COMPLAINT_SLOTS) return;
    this.snapshot.complaintStampTicks[slot] = tick + 1;
    this.complaintsSeen = slot + 1;
  }

  /** Subscribes to EV.ComboTier and EV.Complaint on `bus`; call the returned function to stop (scene exit). */
  attach(bus: EventBus): Unsubscribe {
    const offTier = bus.on(EV.ComboTier, (event) => {
      this.onComboTier(event.multiplier, event.previousMultiplier, event.tick);
    });
    const offComplaint = bus.on(EV.Complaint, (event) => {
      this.onComplaint(event.tick);
    });
    return () => {
      offTier();
      offComplaint();
    };
  }

  /** Forgets the score roll, any popup and the stamp timings (a new shift). */
  reset(): void {
    this.shownScore = 0;
    this.snapshot.popupStartTick = -1;
    this.snapshot.popupMultiplier = 1;
    this.snapshot.complaintStampTicks.fill(-1);
    this.complaintsSeen = 0;
  }

  // per-frame draw path: begin
  /**
   * One sim tick has run (ShiftScene.fixedUpdate): roll the shown score towards the World's, closing 1/8 of the
   * gap per tick (at least one point), so it counts up (or down after a penalty) over a fraction of a second.
   */
  tick(view: WorldView): void {
    const target = view.scoring.score;
    const gap = target - this.shownScore;
    if (gap === 0) return;
    const step = Math.ceil(Math.abs(gap) / SCORE_ROLL_DIVISOR);
    this.shownScore += gap > 0 ? (step < gap ? step : gap) : step < -gap ? -step : gap;
  }

  /** Reads `view`, builds the model and draws it at internal width `widthPx` (one frame). Allocates nothing. */
  draw(view: WorldView, widthPx: number): void {
    const snapshot = readHudSnapshot(view, this.snapshot);
    snapshot.score = this.shownScore;
    this.drawModel(hudModel(snapshot, view.tick, this.model), widthPx);
  }

  /** Draws `model` at internal width `widthPx`. Allocates nothing once the layout for the width is cached. */
  drawModel(model: HudModel, widthPx: number): void {
    const layout = this.layout(widthPx);
    const font = this.font;
    const sink = this.sink;
    const outline = TextVariant.Outline;
    const centreX = layout.centreX;
    const penDy = HUD_TOP_Y + 1;

    // Timer.
    const timer = model.timer;
    if (timer.visible) font.draw(sink, timer.text, layout.timer.x + 1, penDy, timer.colour, outline);

    // Score, then the combo beside it.
    const chars = this.scoreChars;
    const n = writeScoreChars(model.score.value, chars);
    let scoreW = 0;
    for (let i = 0; i < n; i++) scoreW += font.measure(CHAR_STRINGS[chars[i] ?? 0] ?? '', outline);
    const scoreX0 = centreX - (scoreW >> 1);
    let pen = scoreX0 + 1;
    for (let i = 0; i < n; i++) {
      const ch = CHAR_STRINGS[chars[i] ?? 0] ?? '';
      font.draw(sink, ch, pen, penDy, model.score.colour, outline);
      pen += font.measure(ch, outline);
    }
    const combo = model.combo;
    if (combo.visible) {
      font.draw(sink, combo.text, scoreX0 + scoreW + COMBO_GAP_PX + 1, penDy, combo.colour, outline);
    }

    // Chain-timer bar, shrinking towards the middle.
    const chainBar = model.chainBar;
    if (chainBar.visible && chainBar.fillPx > 0) {
      const w = chainBar.fillPx;
      const x = centreX - (w >> 1);
      this.box(x - 1, CHAIN_BAR_Y, w + 2, CHAIN_BAR_H_PX + 2, HudColour.Ink);
      this.box(x, CHAIN_BAR_Y + 1, w, CHAIN_BAR_H_PX, chainBar.colour);
    }

    // Tier popup.
    const popup = model.popup;
    if (popup.visible) {
      const x0 = centreX - (font.measure(popup.text, outline) >> 1);
      font.draw(sink, popup.text, x0 + 1, POPUP_Y + 1 - popup.risePx, popup.colour, outline);
    }

    // Gauges.
    const g = layout.gauges;
    font.draw(sink, GAUGE_LABELS.hopper, g.hopper.x + 1, GAUGE_LABEL_Y + 1, HudColour.Chalk, outline);
    this.gauge(g.hopper.x, model.hopper.fillPx, model.hopper.colour, -1);
    const hopperText = model.hopperText;
    const textPenX = layout.hopperTextX + 1;
    font.draw(sink, hopperText.text, textPenX, GAUGE_TEXT_Y + 1, hopperText.colour, outline);
    const warn = model.hopperWarn;
    if (warn.visible) {
      const wx = textPenX + font.measure(hopperText.text, outline) + HOPPER_WARN_GAP_PX;
      font.draw(sink, warn.text, wx, GAUGE_TEXT_Y + 1, warn.colour, outline);
    }
    font.draw(sink, GAUGE_LABELS.water, g.water.x + 1, GAUGE_LABEL_Y + 1, HudColour.Chalk, outline);
    this.gauge(g.water.x, model.water.fillPx, model.water.colour, model.water.topColour);
    font.draw(sink, GAUGE_LABELS.dignity, g.dignity.x + 1, GAUGE_LABEL_Y + 1, HudColour.Chalk, outline);
    this.gauge(g.dignity.x, model.dignity.fillPx, model.dignity.colour, -1);

    // Hold-to-dump prompt.
    const dump = model.dump;
    if (dump.visible) {
      const step = dump.ringVisible ? dump.ringStep : 0;
      const frame = DUMP_RING_FRAMES[step] ?? BAR_FRAME;
      const x0 = centreX - (DUMP_RING_PX >> 1);
      sink.add(frame, x0 + (DUMP_RING_PX >> 1), DUMP_RING_Y + (DUMP_RING_PX >> 1), BUTTON_NO_RECOLOUR, 0);
      font.draw(sink, DUMP_KEY_TEXT, x0 + DUMP_KEY_DX, DUMP_RING_Y + DUMP_KEY_DY, HudColour.Chalk);
    }

    // Complaints meter.
    const meter = model.complaints;
    if (meter.visible) {
      const slots = meter.slots;
      for (let i = 0; i < slots.length; i++) {
        const slot = slots[i];
        if (slot === undefined) continue;
        this.complaintBox(
          layout.complaintsX + i * (COMPLAINT_BOX_PX + COMPLAINT_GAP_PX) + slot.dx,
          slot.state,
        );
      }
    }
  }

  /** One complaints box with its top-left at (x, COMPLAINTS_Y) in `state` (placeholder art, see the header). */
  private complaintBox(x: number, state: ComplaintSlotState): void {
    const y = COMPLAINTS_Y;
    const n = COMPLAINT_BOX_PX;
    this.box(x, y, n, n, HudColour.Ink);
    if (state === ComplaintSlotState.Slam) {
      this.box(x + 1, y + 1, n - 2, n - 2, HudColour.PostboxRed);
      return;
    }
    this.box(x + 1, y + 1, n - 2, n - 2, HudColour.Navy);
    // The form: an 8×10 outline with two text lines.
    const fx = x + 4;
    const fy = y + 3;
    this.box(fx, fy, 8, 1, HudColour.Kerb);
    this.box(fx, fy + 9, 8, 1, HudColour.Kerb);
    this.box(fx, fy + 1, 1, 8, HudColour.Kerb);
    this.box(fx + 7, fy + 1, 1, 8, HudColour.Kerb);
    this.box(fx + 2, fy + 3, 4, 1, HudColour.Kerb);
    this.box(fx + 2, fy + 6, 4, 1, HudColour.Kerb);
    if (state !== ComplaintSlotState.Stamped) return;
    // The stamp: a 2 px ring round the form and a 6×6 centre block.
    this.box(x + 1, y + 1, n - 2, 2, HudColour.PostboxRed);
    this.box(x + 1, y + n - 3, n - 2, 2, HudColour.PostboxRed);
    this.box(x + 1, y + 3, 2, n - 6, HudColour.PostboxRed);
    this.box(x + n - 3, y + 3, 2, n - 6, HudColour.PostboxRed);
    this.box(x + 5, y + 5, 6, 6, HudColour.PostboxRed);
  }

  /** A gauge bar at (x, GAUGE_BAR_Y): ink frame, 03 track, fill, and optionally a top fill row in `topColour`. */
  private gauge(x: number, fillPx: number, colour: number, topColour: number): void {
    this.box(x, GAUGE_BAR_Y, GAUGE_BAR_W_PX, GAUGE_BAR_H_PX, HudColour.Ink);
    this.box(x + 1, GAUGE_BAR_Y + 1, GAUGE_FILL_PX, GAUGE_FILL_H_PX, HudColour.AsphaltLt);
    if (fillPx <= 0) return;
    this.box(x + 1, GAUGE_BAR_Y + 1, fillPx, GAUGE_FILL_H_PX, colour);
    if (topColour >= 0) this.box(x + 1, GAUGE_BAR_Y + 1, fillPx, 1, topColour);
  }

  /**
   * A solid w × h rectangle in palette colour `colour`: sub-rectangles of ui.bar_fill recoloured, one quad per
   * BAR_FRAME_H_PX rows (the frame is 66×8, so the complaints boxes take two).
   */
  private box(x: number, y: number, w: number, h: number, colour: number): void {
    for (let row = 0; row < h; row += BAR_FRAME_H_PX) {
      const rows = h - row < BAR_FRAME_H_PX ? h - row : BAR_FRAME_H_PX;
      this.sink.addRegion(BAR_FRAME, 0, 0, w, rows, x, y + row, BAR_FRAME_INK, colour);
    }
  }
  // per-frame draw path: end
}
