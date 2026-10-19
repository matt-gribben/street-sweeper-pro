// The shift intro card, placeholder (GDD §15.4, ART_BIBLE §12.4, SSP-071): text only, Kerbside 5×7 on a
// `ui.panel_council` panel centred in the frame. Three lines: the district name (15 sweeper_yellow, outlined), a
// one-line briefing placeholder (07 chalk) and the prompt (16 lemon): 'Loading...' while the compiled level is
// still loading, 'Press Space to start' once it is in, and 'Level failed to load' (18 postbox red) if it failed.
// Big Pam's portrait, the target, the weather and the real card art are M4 (SSP-157).
//
// Pure layout over UiItems (uiItems.ts): ShiftIntroScene draws it, and the tests rasterise it on the CPU.
import { type BitmapFont, TextAlign, TextVariant } from './bitmapText.ts';
import { PanelStyle } from './panels.ts';
import { textItem, type UiItem } from './uiItems.ts';

/** What the card's prompt line says. */
export const IntroStatus = { Loading: 0, Ready: 1, Failed: 2 } as const;
export type IntroStatus = (typeof IntroStatus)[keyof typeof IntroStatus];

/** The briefing placeholder until Big Pam's briefings (M4). */
export const INTRO_BRIEFING = 'Clear the litter and the grime before knock-off, love.';

/** The prompt per status. */
export const INTRO_PROMPTS: { readonly [S in IntroStatus]: string } = {
  [IntroStatus.Loading]: 'Loading...',
  [IntroStatus.Ready]: 'Press Space to start',
  [IntroStatus.Failed]: 'Level failed to load',
};

/** Palette indices (Kerbside-32 names). */
const SWEEPER_YELLOW = 15;
const CHALK = 7;
const LEMON = 16;
const POSTBOX_RED = 18;

/** Padding between the panel edge and the widest line, px. */
const PAD_X_PX = 16;
/** Panel height and the three lines' offsets from its top, px. */
const PANEL_H_PX = 64;
const TITLE_Y_PX = 12;
const BRIEFING_Y_PX = 29;
const PROMPT_Y_PX = 45;

/**
 * `district.<snake_name>` → its display name in capitals ('district.puddle_lane' → 'PUDDLE LANE'). Until
 * districts.json exists (M6) the ID is the only source of the name.
 */
export function districtDisplayName(district: string): string {
  const name = district.startsWith('district.') ? district.slice('district.'.length) : district;
  return name.replaceAll('_', ' ').toUpperCase();
}

/**
 * The card for `district` in a `widthPx` × `heightPx` internal frame (432..640 × 270), with the prompt for
 * `status`.
 */
export function introCardLayout(
  font: BitmapFont,
  widthPx: number,
  heightPx: number,
  district: string,
  status: IntroStatus,
): UiItem[] {
  const title = districtDisplayName(district);
  const prompt = INTRO_PROMPTS[status];
  const contentW = Math.max(
    font.measure(title, TextVariant.Outline),
    font.measure(INTRO_BRIEFING),
    font.measure(prompt),
  );
  const w = Math.min(widthPx - 8, contentW + 2 * PAD_X_PX);
  const x = (widthPx - w) >> 1;
  const y = (heightPx - PANEL_H_PX) >> 1;
  const cx = widthPx >> 1;
  return [
    { kind: 'panel', style: PanelStyle.Council, x, y, w, h: PANEL_H_PX },
    textItem(title, cx, y + TITLE_Y_PX, SWEEPER_YELLOW, TextAlign.Centre, TextVariant.Outline),
    textItem(INTRO_BRIEFING, cx, y + BRIEFING_Y_PX, CHALK, TextAlign.Centre),
    textItem(
      prompt,
      cx,
      y + PROMPT_Y_PX,
      status === IntroStatus.Failed ? POSTBOX_RED : LEMON,
      TextAlign.Centre,
    ),
  ];
}
