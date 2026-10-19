// The tally page, numbers only (GDD §15.1, §15.3; SSP-071): the end of a shift as plain figures on a
// `ui.panel_paper` panel, with Try Again (the default focus) and Back to Briefing. The Muckleford Mercury layout,
// the headline, the £ column and the frontage map replace it in M6 (SSP-192); its final UI art is M4 (SSP-157).
//
//   TIME UP!  (or TOWED!, 18 postbox red)
//   PUDDLE LANE
//   TIDY                47.3%     Tidy % with one decimal
//   ITEMS COLLECTED     12 / 40   litter collected / spawned this shift
//   GRIME CLEANED  300 / 9,000    grime cells cleaned / laid at shift start
//   SCORE              12,450
//   STARS                 ★★★     would-be stars from Tidy % (0.60 / 0.80 / 0.92): earned 15 outlined, the rest 04
//   [ → TRY AGAIN       ]
//   [   BACK TO BRIEFING ]
//
// Every figure comes from the SimSnapshot the shift ended with (snapshot.ts, the same object `__ssp.state()`
// returns while the tally shows), so tests/e2e/flow.spec.ts can check the page against the state. TOWED's tally
// rules (50% of the score, no stars) are M3 (SSP-079): until then the page shows the figures as they stand.
//
// Pure layout over UiItems (uiItems.ts): TallyScene draws it, the tests rasterise it on the CPU. Text is 00 ink
// on the paper panel (ART_BIBLE §12.4: the Mercury is 00 on 07). The buttons are a menus.ts Menu (SSP-286): the
// scene passes each button's ButtonState in, and tallyButtonRects() gives the menu the same rects for the mouse.
import type { SimShiftEndReason, SimSnapshot } from '../sim/snapshot.ts';
import { type BitmapFont, TextAlign, TextVariant } from './bitmapText.ts';
import { ButtonState, buttonWidthFor, PanelStyle, type UiRect } from './panels.ts';
import { textItem, type UiItem } from './uiItems.ts';

/** The page's buttons, top to bottom; Try Again is the default focus (GDD §11.3, §15.3). */
export const TallyButton = { TryAgain: 0, BackToBriefing: 1 } as const;
export type TallyButton = (typeof TallyButton)[keyof typeof TallyButton];

/** Number of buttons. */
export const TALLY_BUTTON_COUNT = 2;

/** Button labels in TallyButton order. */
export const TALLY_BUTTON_LABELS: readonly string[] = ['TRY AGAIN', 'BACK TO BRIEFING'];

/** The end-reason header per EV.ShiftEnd reason. */
export const TALLY_REASON_TEXT: { readonly [R in SimShiftEndReason]: string } = {
  time_up: 'TIME UP!',
  towed: 'TOWED!',
};

/** The star glyph (Kerbside 5×7 has it, ART_BIBLE §12.5). */
export const STAR = '★';

/** The most stars a district awards (GDD §12.1). */
export const MAX_STARS = 3;

/** The figures the page shows, formatted. */
export type TallyFigures = {
  readonly reason: string;
  /** The shift ended TOWED (the header turns 18 postbox red). */
  readonly towed: boolean;
  readonly district: string;
  readonly tidy: string;
  readonly items: string;
  readonly grime: string;
  readonly score: string;
  /** Would-be stars, 0..3. */
  readonly stars: number;
};

/** Palette indices (Kerbside-32 names). */
const INK = 0;
const SLAB_DK = 4;
const SWEEPER_YELLOW = 15;
const POSTBOX_RED = 18;

const PANEL_W_PX = 240;
const PANEL_H_PX = 166;
const PAD_X_PX = 16;
const REASON_Y_PX = 10;
const DISTRICT_Y_PX = 22;
const FIRST_ROW_Y_PX = 38;
const ROW_STEP_PX = 11;
const FIRST_BUTTON_Y_PX = 110;
const BUTTON_H_PX = 17;
const BUTTON_STEP_PX = 21;
const STAR_GAP_PX = 2;

/** An integer with thousands separators: 12450 → '12,450', −1200 → '-1,200'. Non-integers are rounded. */
export function formatCount(value: number): string {
  const n = Math.round(value);
  const digits = String(Math.abs(n));
  let out = '';
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ',';
    out += digits[i];
  }
  return n < 0 ? `-${out}` : out;
}

/** Tidy % (0..1) with one decimal: 0.4735 → '47.4%', 1 → '100.0%'. Rounds half up at the second decimal. */
export function formatTidyPercent(tidy: number): string {
  return `${(Math.round(tidy * 1000) / 10).toFixed(1)}%`;
}

/** `done / of` with separators: '12 / 40'. */
export function formatFraction(done: number, of: number): string {
  return `${formatCount(done)} / ${formatCount(of)}`;
}

/**
 * The page's figures for a shift that ended with `snapshot`, in `district` (its display name). Throws if the
 * snapshot's shift has not ended: the tally only ever shows a finished shift.
 */
export function tallyFigures(snapshot: SimSnapshot, districtName: string): TallyFigures {
  const reason = snapshot.shift.endReason;
  if (reason === null) throw new Error(`tally: the shift has not ended (phase ${snapshot.shift.phase})`);
  return {
    reason: TALLY_REASON_TEXT[reason],
    towed: reason === 'towed',
    district: districtName,
    tidy: formatTidyPercent(snapshot.tidy),
    items: formatFraction(snapshot.litter.collected, snapshot.litter.spawned),
    grime: formatFraction(snapshot.grime.cleaned, snapshot.grime.initial),
    score: formatCount(snapshot.score),
    stars: Math.max(0, Math.min(MAX_STARS, snapshot.stars)),
  };
}

/** The labelled rows, top to bottom (the stars row is drawn as glyphs, not as one of these). */
export function tallyRows(figures: TallyFigures): readonly (readonly [label: string, value: string])[] {
  return [
    ['TIDY', figures.tidy],
    ['ITEMS COLLECTED', figures.items],
    ['GRIME CLEANED', figures.grime],
    ['SCORE', figures.score],
  ];
}

/** The buttons' rects at internal size `widthPx` × `heightPx`, in TallyButton order (centred, one width). */
export function tallyButtonRects(font: BitmapFont, widthPx: number, heightPx: number): UiRect[] {
  const y = (heightPx - PANEL_H_PX) >> 1;
  const buttonW = Math.max(...TALLY_BUTTON_LABELS.map((label) => buttonWidthFor(font, label)));
  const buttonX = (widthPx - buttonW) >> 1;
  return TALLY_BUTTON_LABELS.map((_label, i) => ({
    x: buttonX,
    y: y + FIRST_BUTTON_Y_PX + i * BUTTON_STEP_PX,
    w: buttonW,
    h: BUTTON_H_PX,
  }));
}

/** Button states with `focus` focused (Try Again is the default) and nothing pressed: the page as it first shows. */
export function tallyButtonStates(focus: TallyButton, pressed = false): ButtonState[] {
  return TALLY_BUTTON_LABELS.map((_label, i) =>
    i !== focus ? ButtonState.Normal : pressed ? ButtonState.Pressed : ButtonState.Focus,
  );
}

/**
 * The page at internal size `widthPx` × `heightPx`, each button drawn in its `states` entry (TallyButton order:
 * the menu's buttonState(), or tallyButtonStates()).
 */
export function tallyPageLayout(
  font: BitmapFont,
  widthPx: number,
  heightPx: number,
  figures: TallyFigures,
  states: readonly ButtonState[],
): UiItem[] {
  const x = (widthPx - PANEL_W_PX) >> 1;
  const y = (heightPx - PANEL_H_PX) >> 1;
  const cx = widthPx >> 1;
  const left = x + PAD_X_PX;
  const right = x + PANEL_W_PX - PAD_X_PX;
  const items: UiItem[] = [
    { kind: 'panel', style: PanelStyle.Paper, x, y, w: PANEL_W_PX, h: PANEL_H_PX },
    textItem(figures.reason, cx, y + REASON_Y_PX, figures.towed ? POSTBOX_RED : INK, TextAlign.Centre),
    textItem(figures.district, cx, y + DISTRICT_Y_PX, INK, TextAlign.Centre),
  ];
  const rows = tallyRows(figures);
  let rowY = y + FIRST_ROW_Y_PX;
  for (const [label, value] of rows) {
    items.push(textItem(label, left, rowY, INK));
    items.push(textItem(value, right, rowY, INK, TextAlign.Right));
    rowY += ROW_STEP_PX;
  }
  items.push(textItem('STARS', left, rowY, INK));
  // Three stars, right-aligned, STAR_GAP_PX apart so the outline rings never touch: earned ones outlined in 15,
  // the rest plain 04.
  const starW = font.measure(STAR, TextVariant.Outline) + STAR_GAP_PX;
  for (let i = 0; i < MAX_STARS; i++) {
    const starX = right - (MAX_STARS - i) * starW;
    items.push(
      i < figures.stars
        ? textItem(STAR, starX, rowY, SWEEPER_YELLOW, TextAlign.Left, TextVariant.Outline)
        : textItem(STAR, starX, rowY, SLAB_DK),
    );
  }
  const rects = tallyButtonRects(font, widthPx, heightPx);
  TALLY_BUTTON_LABELS.forEach((label, i) => {
    const rect = rects[i];
    if (rect === undefined) return;
    items.push({ kind: 'button', state: states[i] ?? ButtonState.Normal, rect, label });
  });
  return items;
}
