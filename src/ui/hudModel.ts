// The M2 HUD model (GDD §15.2 owns the elements and their behaviour, ART_BIBLE §12.2 their colours, ART_BIBLE §11
// the popup timing; SSP-070). hudModel(snapshot, tick, out) is a pure function from a HudSnapshot (what the HUD
// reads of the sim, plus its own score roll and tier popup) and a tick to every element's text, palette index,
// fill and visibility; src/ui/hud.ts only lays the model out and draws it. Nothing here knows about pixels on
// screen beyond the bar lengths, or about the font.
//
// Elements (all palette indices are Kerbside-32):
//   timer    m:ss from ticksRemaining, shown as ceil(ticks / 60) s (14,400 → '4:00', 3,599 → '1:00'); 07, 16 lemon
//            under 60 s (ticksRemaining < 3,600), and under 30 s (< 1,800) alternating 18 and 16 every 30 ticks of
//            the countdown, starting on 18 (1,799..1,770 → 18, 1,769..1,740 → 16, …). At 0:00 it holds 18.
//   score    the (rolled) score, 07; hud.ts groups the digits with commas.
//   combo    from ×2: 'x2 TIDY!' 23, 'x3 SPOTLESS!' 28, 'x4 IMMACULATE!' 16, 'x5 SWEEPING BEAUTY!' cycling
//            16 → 17 → 20 → 28 → 23 every 5 ticks; hidden at ×1. The chain-timer bar (17) is visible while a chain
//            runs, ceil(48 × timerTicks / refreshTicks) px long.
//   popup    the tier word ('TIDY!' …) of the last rise (EV.ComboTier with multiplier > previous), in the tier
//            colour. At age a = tick − startTick: rises round(12 × (1 − (1 − a/36)²)) px over ticks 0..36
//            (ease-out), holds 12 px for 12 ticks (36..47), then blinks out 3 × 3 ticks: hidden 48–50, shown 51–53,
//            hidden 54–56, shown 57–59, hidden 60–62, shown 63–65, gone from 66 (ART_BIBLE §11).
//   hopper   64 px bar, round(64 × LU / capacity) filled: 15 below the warning fraction (tuning.json
//            hopper.warnFraction, 0.8), 17 with '!' at or above it, and at full (LU ≥ capacity) 'FULL' with the
//            bar and text flashing 18 / 17 every 15 ticks (18 first). Text: floor(100 × LU / capacity) + '%'.
//   water    64 px bar, round(64 × water / tankUnits) filled in 27 with its top pixel row in 28.
//   dignity  64 px bar, round(64 × HP / maxHp) filled: 23 above 60 HP, 15 from 40 to 60 HP, 18 below 40 HP (40 is
//            tuning.json vehicle.sweeper.health.dentedBelowHp, where the dented sprite appears).
//   dump     the hold-to-dump prompt (the interact key 'E' in a ring) whenever a dump is available
//            (shift.ts availableDumpSite ≥ 0: Bessie stopped at a depot bay or skip with something to dump, or
//            already holding there). The ring's fill shows only while Holding: step floor(k × 8 / holdTicks) of 8
//            at hold tick k. A cancel (release, or speed reaching 0.5 m/s) empties it or hides the prompt with
//            it; Draining hides both (GDD §6.2, §8.7).
//
// Per frame nothing allocates: every string comes from a table built at module load, and the model is written
// into a preallocated object. The section between the "per-frame draw path" markers is scanned by
// tests/unit/hud.test.ts for `new` and array literals.
import { availableDumpSite, DumpState, dumpHoldTicksAt } from '../sim/shift.ts';
import type { WorldView } from '../sim/world.ts';

/** Kerbside-32 palette indices the HUD uses. */
export const HudColour = {
  Ink: 0,
  AsphaltLt: 3,
  Chalk: 7,
  SweeperYellow: 15,
  Lemon: 16,
  HivisOrange: 17,
  PostboxRed: 18,
  Bubblegum: 20,
  GrassLt: 23,
  Sky: 27,
  Spray: 28,
} as const;

/** Length of the hopper, water and Dignity bars' fill, in pixels (ART_BIBLE §12.2: 64×6). */
export const GAUGE_FILL_PX = 64;
/** Height of a gauge's fill. */
export const GAUGE_FILL_H_PX = 6;
/** Full length of the chain-timer bar (ART_BIBLE §12.2: 48×2). */
export const CHAIN_BAR_PX = 48;
/** Height of the chain-timer bar. */
export const CHAIN_BAR_H_PX = 2;
/** Fill steps of the hold-to-dump ring (frames ui.dump_ring:fill:-:0..8; 0 is the empty ring). */
export const DUMP_RING_STEPS = 8;

/** Timer thresholds in ticks remaining (GDD §15.2): lemon under 60 s, flashing red under 30 s. */
export const TIMER_LEMON_BELOW_TICKS = 3600;
export const TIMER_FLASH_BELOW_TICKS = 1800;
/** The timer's red flash alternates every this many ticks. */
export const TIMER_FLASH_TICKS = 30;
/** The full hopper's flash alternates every this many ticks. */
export const HOPPER_FLASH_TICKS = 15;
/** Dignity is green above this many HP (GDD §15.2); red below tuning's dentedBelowHp. */
export const HP_GREEN_ABOVE = 60;

/** The ×5 tier colour cycle and its step (ART_BIBLE §11). */
export const SWEEPING_BEAUTY_CYCLE: readonly number[] = Object.freeze([
  HudColour.Lemon,
  HudColour.HivisOrange,
  HudColour.Bubblegum,
  HudColour.Spray,
  HudColour.GrassLt,
]);
export const SWEEPING_BEAUTY_CYCLE_TICKS = 5;

/** Popup timing (ART_BIBLE §11): rise, hold, blink-out phase length and count. */
export const POPUP_RISE_PX = 12;
export const POPUP_RISE_TICKS = 36;
export const POPUP_HOLD_TICKS = 12;
export const POPUP_BLINK_TICKS = 3;
export const POPUP_BLINKS = 3;
/** Age at which a popup is gone: 36 + 12 + 3 blinks × (3 off + 3 on) = 66. */
export const POPUP_LIFE_TICKS = POPUP_RISE_TICKS + POPUP_HOLD_TICKS + POPUP_BLINKS * 2 * POPUP_BLINK_TICKS;

/** The highest multiplier (tuning.json combo.tiers); anything above draws as it. */
export const MAX_MULTIPLIER = 5;

/** Tier words by multiplier (index 0 and 1 unused: ×1 has no word). */
export const TIER_WORDS: readonly string[] = Object.freeze([
  '',
  '',
  'TIDY!',
  'SPOTLESS!',
  'IMMACULATE!',
  'SWEEPING BEAUTY!',
]);

/** The combo text beside the score by multiplier: 'x3 SPOTLESS!' ('x': the font has no ×). */
export const COMBO_TEXTS: readonly string[] = Object.freeze(
  TIER_WORDS.map((word, m) => (m < 2 ? '' : `x${m} ${word}`)),
);

/** Fixed tier colours by multiplier (×5 cycles instead; ×1 is chalk). */
const TIER_COLOURS: readonly number[] = Object.freeze([
  HudColour.Chalk,
  HudColour.Chalk,
  HudColour.GrassLt,
  HudColour.Spray,
  HudColour.Lemon,
  HudColour.Lemon,
]);

/** Largest timer the m:ss table holds: 9:59. */
export const TIMER_MAX_S = 599;

/** 'm:ss' for 0..TIMER_MAX_S seconds, built once. */
const TIMER_TEXTS: readonly string[] = Object.freeze(
  Array.from(
    { length: TIMER_MAX_S + 1 },
    (_, s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`,
  ),
);

/** 'n%' for 0..100, built once. */
const PERCENT_TEXTS: readonly string[] = Object.freeze(Array.from({ length: 101 }, (_, p) => `${p}%`));

/** The hopper text at full. */
export const HOPPER_FULL_TEXT = 'FULL';
/** The hopper warning mark. */
export const HOPPER_WARN_TEXT = '!';
/** The dump prompt's key label (the interact key, E, in M2). */
export const DUMP_KEY_TEXT = 'E';

/**
 * What the HUD reads, as plain numbers (readHudSnapshot fills it from a WorldView; tests build it directly).
 * `score` is what to show (hud.ts rolls it towards the sim's score); `popup*` is the HUD's own record of the last
 * tier rise from the event bus.
 */
export type HudSnapshot = {
  /** Shift timer ticks remaining (shift.ts ticksRemaining). */
  ticksRemaining: number;
  score: number;
  /** combo.ts: multiplier, chain, timerTicks, refreshTicks. */
  multiplier: number;
  chain: number;
  chainTimerTicks: number;
  chainRefreshTicks: number;
  /** Hopper LU, capacity and warning fraction (hopper.ts, tuning.json hopper). */
  hopperLu: number;
  hopperCapacityLu: number;
  hopperWarnFraction: number;
  /** Water units and tank capacity (water.ts, tuning.json water.tankUnits). */
  water: number;
  tankUnits: number;
  /** Dignity, its maximum and the dented threshold (tuning.json vehicle.sweeper.health). */
  hp: number;
  maxHp: number;
  dentedBelowHp: number;
  /** World tick the last tier rise's popup started on, or −1; and its multiplier. */
  popupStartTick: number;
  popupMultiplier: number;
  /** A dump can be held now, or is being held (shift.ts availableDumpSite ≥ 0). */
  dumpAvailable: boolean;
  /** The dump FSM state and hold progress (shift.ts dumpState, holdTicks, and the site's hold length). */
  dumpState: DumpState;
  dumpHoldTicks: number;
  dumpHoldTotalTicks: number;
};

/** One text element of the model. */
export type HudText = { visible: boolean; text: string; colour: number };

/** One bar of the model: fill length in pixels and colour. */
export type HudBar = { visible: boolean; fillPx: number; colour: number };

/** Everything hud.ts draws, written by hudModel. */
export type HudModel = {
  readonly timer: HudText;
  /** The score value to draw (digits grouped by hud.ts) and its colour. */
  readonly score: { value: number; colour: number };
  readonly combo: HudText;
  readonly chainBar: HudBar;
  /** The tier popup: text and colour, and how far it has risen. */
  readonly popup: HudText & { risePx: number };
  readonly hopper: HudBar;
  /** The hopper's percentage or 'FULL', and the '!' warning mark. */
  readonly hopperText: HudText;
  readonly hopperWarn: HudText;
  readonly water: HudBar & { topColour: number };
  readonly dignity: HudBar;
  /** The dump prompt, and its ring's fill (step 0..8; shown only while Holding). */
  readonly dump: { visible: boolean; ringVisible: boolean; ringStep: number };
};

/** A zeroed snapshot. Setup only. */
export function createHudSnapshot(): HudSnapshot {
  return {
    ticksRemaining: 0,
    score: 0,
    multiplier: 1,
    chain: 0,
    chainTimerTicks: 0,
    chainRefreshTicks: 1,
    hopperLu: 0,
    hopperCapacityLu: 1,
    hopperWarnFraction: 1,
    water: 0,
    tankUnits: 1,
    hp: 0,
    maxHp: 1,
    dentedBelowHp: 0,
    popupStartTick: -1,
    popupMultiplier: 1,
    dumpAvailable: false,
    dumpState: DumpState.Idle,
    dumpHoldTicks: 0,
    dumpHoldTotalTicks: 1,
  };
}

function text(): HudText {
  return { visible: false, text: '', colour: HudColour.Chalk };
}

function bar(): HudBar {
  return { visible: false, fillPx: 0, colour: HudColour.Chalk };
}

/** A blank model to write into. Setup only. */
export function createHudModel(): HudModel {
  return {
    timer: text(),
    score: { value: 0, colour: HudColour.Chalk },
    combo: text(),
    chainBar: bar(),
    popup: { ...text(), risePx: 0 },
    hopper: bar(),
    hopperText: text(),
    hopperWarn: text(),
    water: { ...bar(), topColour: HudColour.Spray },
    dignity: bar(),
    dump: { visible: false, ringVisible: false, ringStep: 0 },
  };
}

// per-frame draw path: begin
/** The colour of tier `multiplier` at `tick` (×5 cycles every 5 ticks). */
export function tierColour(multiplier: number, tick: number): number {
  if (multiplier >= MAX_MULTIPLIER) {
    const step = Math.floor(tick / SWEEPING_BEAUTY_CYCLE_TICKS) % SWEEPING_BEAUTY_CYCLE.length;
    return SWEEPING_BEAUTY_CYCLE[step < 0 ? step + SWEEPING_BEAUTY_CYCLE.length : step] ?? HudColour.Lemon;
  }
  return TIER_COLOURS[multiplier < 0 ? 0 : multiplier] ?? HudColour.Chalk;
}

/** 'm:ss' of ceil(ticks / 60) seconds, clamped to 0:00..9:59. */
export function timerText(ticksRemaining: number): string {
  let s = Math.ceil(ticksRemaining / 60);
  if (!(s > 0)) s = 0;
  if (s > TIMER_MAX_S) s = TIMER_MAX_S;
  return TIMER_TEXTS[s] ?? '';
}

/** The timer colour for `ticksRemaining` (see the header). */
export function timerColour(ticksRemaining: number): number {
  if (ticksRemaining >= TIMER_LEMON_BELOW_TICKS) return HudColour.Chalk;
  if (ticksRemaining >= TIMER_FLASH_BELOW_TICKS) return HudColour.Lemon;
  if (ticksRemaining <= 0) return HudColour.PostboxRed;
  const phase = Math.floor((TIMER_FLASH_BELOW_TICKS - 1 - ticksRemaining) / TIMER_FLASH_TICKS);
  return (phase & 1) === 0 ? HudColour.PostboxRed : HudColour.Lemon;
}

/** round(full × value / max), clamped to 0..full (0 for a non-positive max). */
function fillOf(value: number, max: number, full: number): number {
  if (!(max > 0)) return 0;
  const px = Math.round((full * value) / max);
  return px < 0 ? 0 : px > full ? full : px;
}

/** The popup's rise in pixels at `age` ticks (ease-out over 36 ticks, then held). */
export function popupRisePx(age: number): number {
  if (age <= 0) return 0;
  if (age >= POPUP_RISE_TICKS) return POPUP_RISE_PX;
  const u = 1 - age / POPUP_RISE_TICKS;
  return Math.round(POPUP_RISE_PX * (1 - u * u));
}

/** Whether the popup shows at `age` ticks (blinking out after the hold, gone at POPUP_LIFE_TICKS). */
export function popupShownAt(age: number): boolean {
  if (age < 0 || age >= POPUP_LIFE_TICKS) return false;
  const blinkFrom = POPUP_RISE_TICKS + POPUP_HOLD_TICKS;
  if (age < blinkFrom) return true;
  return (Math.floor((age - blinkFrom) / POPUP_BLINK_TICKS) & 1) === 1;
}

/**
 * Copies what the HUD reads of `view` into `out`: everything but `score` and the `popup*` fields, which hud.ts
 * owns (its score roll and its record of the last tier rise). Read-only; allocates nothing.
 */
export function readHudSnapshot(view: WorldView, out: HudSnapshot): HudSnapshot {
  const shift = view.shift;
  const v = view.vehicle;
  const combo = view.scoring.combo;
  out.ticksRemaining = shift.ticksRemaining;
  out.multiplier = combo.multiplier;
  out.chain = combo.chain;
  out.chainTimerTicks = combo.timerTicks;
  out.chainRefreshTicks = combo.refreshTicks;
  out.hopperLu = v.hopperLU;
  out.hopperCapacityLu = view.hopper.params.hopperCapacityLU;
  out.hopperWarnFraction = view.hopper.tuning.warnFraction;
  out.water = v.water;
  out.tankUnits = view.water.tuning.tankUnits;
  const health = view.hopper.params.tuning.health;
  out.hp = v.hp;
  out.maxHp = health.maxHp;
  out.dentedBelowHp = health.dentedBelowHp;
  const site = availableDumpSite(shift);
  out.dumpAvailable = site >= 0;
  out.dumpState = shift.dumpState;
  out.dumpHoldTicks = shift.holdTicks;
  out.dumpHoldTotalTicks = site >= 0 ? dumpHoldTicksAt(shift, site) : 1;
  return out;
}

/**
 * Writes the model for `s` at `tick` (the World's tick) into `out` and returns it. Pure; allocates nothing when
 * given `out` (hud.ts always passes its own; the default is for tests).
 */
export function hudModel(s: Readonly<HudSnapshot>, tick: number, out: HudModel = createHudModel()): HudModel {
  // Timer.
  const timer = out.timer;
  timer.visible = true;
  timer.text = timerText(s.ticksRemaining);
  timer.colour = timerColour(s.ticksRemaining);

  // Score.
  out.score.value = s.score;
  out.score.colour = HudColour.Chalk;

  // Combo and the chain timer.
  const m = s.multiplier > MAX_MULTIPLIER ? MAX_MULTIPLIER : s.multiplier;
  const combo = out.combo;
  combo.visible = m >= 2;
  combo.text = combo.visible ? (COMBO_TEXTS[m] ?? '') : '';
  combo.colour = tierColour(m, tick);
  const chain = out.chainBar;
  chain.visible = s.chain > 0 && s.chainTimerTicks > 0 && s.chainRefreshTicks > 0;
  chain.fillPx = chain.visible ? Math.ceil((CHAIN_BAR_PX * s.chainTimerTicks) / s.chainRefreshTicks) : 0;
  if (chain.fillPx > CHAIN_BAR_PX) chain.fillPx = CHAIN_BAR_PX;
  chain.colour = HudColour.HivisOrange;

  // Tier popup.
  const popup = out.popup;
  const pm = s.popupMultiplier > MAX_MULTIPLIER ? MAX_MULTIPLIER : s.popupMultiplier;
  const age = tick - s.popupStartTick;
  popup.visible = s.popupStartTick >= 0 && pm >= 2 && popupShownAt(age);
  popup.text = popup.visible ? (TIER_WORDS[pm] ?? '') : '';
  popup.colour = tierColour(pm, tick);
  popup.risePx = s.popupStartTick >= 0 ? popupRisePx(age) : 0;

  // Hopper.
  const cap = s.hopperCapacityLu;
  const full = cap > 0 && s.hopperLu >= cap;
  const warn = cap > 0 && s.hopperLu / cap >= s.hopperWarnFraction;
  const flashOn = (Math.floor(tick / HOPPER_FLASH_TICKS) & 1) === 0;
  const hopperColour = full
    ? flashOn
      ? HudColour.PostboxRed
      : HudColour.HivisOrange
    : warn
      ? HudColour.HivisOrange
      : HudColour.SweeperYellow;
  const hopper = out.hopper;
  hopper.visible = true;
  hopper.fillPx = fillOf(s.hopperLu, cap, GAUGE_FILL_PX);
  hopper.colour = hopperColour;
  const hopperText = out.hopperText;
  hopperText.visible = true;
  if (full) {
    hopperText.text = HOPPER_FULL_TEXT;
  } else {
    let pct = cap > 0 ? Math.floor((100 * s.hopperLu) / cap) : 0;
    if (!(pct > 0)) pct = 0;
    if (pct > 100) pct = 100;
    hopperText.text = PERCENT_TEXTS[pct] ?? '';
  }
  hopperText.colour = full || warn ? hopperColour : HudColour.Chalk;
  const hopperWarn = out.hopperWarn;
  hopperWarn.visible = warn && !full;
  hopperWarn.text = HOPPER_WARN_TEXT;
  hopperWarn.colour = HudColour.HivisOrange;

  // Water.
  const water = out.water;
  water.visible = true;
  water.fillPx = fillOf(s.water, s.tankUnits, GAUGE_FILL_PX);
  water.colour = HudColour.Sky;
  water.topColour = HudColour.Spray;

  // Dignity.
  const dignity = out.dignity;
  dignity.visible = true;
  dignity.fillPx = fillOf(s.hp, s.maxHp, GAUGE_FILL_PX);
  dignity.colour =
    s.hp > HP_GREEN_ABOVE
      ? HudColour.GrassLt
      : s.hp >= s.dentedBelowHp
        ? HudColour.SweeperYellow
        : HudColour.PostboxRed;

  // Hold-to-dump prompt and ring.
  const dump = out.dump;
  const holding = s.dumpState === DumpState.Holding;
  dump.visible = s.dumpAvailable && s.dumpState !== DumpState.Draining;
  dump.ringVisible = dump.visible && holding;
  let step = 0;
  if (dump.ringVisible && s.dumpHoldTotalTicks > 0) {
    step = Math.floor((s.dumpHoldTicks * DUMP_RING_STEPS) / s.dumpHoldTotalTicks);
    if (step < 0) step = 0;
    if (step > DUMP_RING_STEPS) step = DUMP_RING_STEPS;
  }
  dump.ringStep = step;
  return out;
}
// per-frame draw path: end
