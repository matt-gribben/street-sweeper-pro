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
// M3 widgets (SSP-299; GDD §15.2, ART_BIBLE §12.2):
//   meter    the Brush-o-meter, 64 px. While the brush is lowering or down (Lowering, SpinningUp, Collecting,
//            Bulldozing) the bar spans 0 .. the brush-down top speed (6.0 m/s, × topSpeedMult) and is split at
//            the live fling threshold t0 (brush.cleanPickupMaxMps 4.0, or the brush's flingThresholdMps override,
//            6.0 under pwr.super_suction): clean (solid 23) fills the first floor(t0 / top × 64) px (42), fling
//            (hatched 17/03) the rest. While raising or raised the whole bar is transit (dotted 26/03) and spans
//            0 .. the transit top speed (11.0 m/s). The zone is clean while |vLong| ≤ t0, fling above it, transit
//            with the brush up; the needle sits at floor(|vLong| / top × 64) (0..63), kept inside its zone's part
//            of the bar. The speed beside it is round(|vLong| × 2.237) mph ('9 mph' at 4.0 m/s), up to 99.
//            highlightCleanZone (GDD §16.2 beat 3) blinks the clean zone 23 ↔ 24 every 8 ticks in a 16 frame.
//   brush    ▲ (Raised, Raising) or ▼ (Lowering .. Bulldozing). The spin-up ring shows from Lowering through
//            Bulldozing: step floor(rpm × 8) of 8 while Lowering and SpinningUp, full (8) while Collecting and
//            Bulldozing (the brush is working: it collects from 80% RPM, GDD §8.2).
//   district the compiled level's display name, upper-cased (setup only), in 07.
//   tidy     64 px bar: fill floor(tidy × 64) px of 23 on 03, 07 ticks at floor(star threshold × 64) (38, 51, 58
//            for 60/80/92%), and the value floor(tidy × 100) + '%', both from Tidy % in ppm, so the HUD never
//            shows a star threshold before it is reached.
//   arrows   off-screen arrows (8 directions): to the nearest depot bay while hopper LU / capacity ≥ the warning
//            fraction (0.8), in 15; to the nearest hydrant while water / tank < 20%, in 27. Nearest is Euclidean
//            from Bessie to the site centre, ties to the lowest index. The target is projected with the render
//            camera (a straight-down ground projection: centre + (target − camera) × px/m); an arrow hides while
//            its target is inside the frame. Otherwise it sits where the ray from Bessie's screen position to the
//            target meets the rect inset by the 4 px margin (the whole 11×11 arrow inside it), moved back along
//            the same ray until it is 1 px clear of every HUD box (placeArrow), pointing along the ray rounded to
//            the nearest 45° (so within 22.5° of the true direction).
//
// Per frame nothing allocates: every string comes from a table built at module load, and the model is written
// into a preallocated object. The section between the "per-frame draw path" markers is scanned by
// tests/unit/hud.test.ts for `new` and array literals.
import { BrushState } from '../sim/brush.ts';
import { DumpSite } from '../sim/hopper.ts';
import { availableDumpSite, DumpState, dumpHoldTicksAt } from '../sim/shift.ts';
import { TIDY_PPM } from '../sim/tidy.ts';
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
  Lime: 24,
  CouncilBlue: 26,
  Sky: 27,
  Spray: 28,
} as const;

/** The safe margin from every edge (GDD §15.2, ART_BIBLE §12.2); hud.ts exports it as HUD_MARGIN_PX. */
export const SAFE_MARGIN_PX = 4;

/** A whole-pixel rectangle (x right, y down; w × h pixels from (x, y)). */
export type HudRect = { readonly x: number; readonly y: number; readonly w: number; readonly h: number };

/** Brush-o-meter length and pattern height (ART_BIBLE §12.2: 64×8 with its 1 px frame). */
export const METER_PX = 64;
export const METER_H_PX = 6;
/** mph per m/s (GDD §15.2: mph = round(|vLong| × 2.237)). */
export const MPH_PER_MPS = 2.237;
/** The largest speed the mph table holds. */
export const MPH_MAX = 99;
/** The Brush-o-meter's zones (where the needle is, and which pattern a part of the bar draws). */
export const MeterZone = { Clean: 0, Fling: 1, Transit: 2 } as const;
export type MeterZone = (typeof MeterZone)[keyof typeof MeterZone];
/** The clean-zone highlight (GDD §16.2 beat 3) blinks every this many ticks. */
export const CLEAN_HIGHLIGHT_BLINK_TICKS = 8;

/** Steps of the brush spin-up ring (frames ui.brush_state:ring:-:0..8; 0 is the empty ring). */
export const BRUSH_RING_STEPS = 8;
/** The brush state icon: ▲ raised, ▼ lowered. */
export const BrushIcon = { Raised: 0, Lowered: 1 } as const;
export type BrushIcon = (typeof BrushIcon)[keyof typeof BrushIcon];

/** Tidy % bar length and height (ART_BIBLE §12.2: 64×4). */
export const TIDY_BAR_PX = 64;
export const TIDY_BAR_H_PX = 4;

/** Longest district name the HUD shows (longer names are cut, at setup). */
export const DISTRICT_NAME_MAX_CHARS = 20;

/** The hydrant arrow shows below this water fill fraction (GDD §15.2, proposed). */
export const WATER_LOW_FRACTION = 0.2;
/** The off-screen arrow frame is ARROW_PX square, its pivot ARROW_HALF_PX in from the top-left. */
export const ARROW_PX = 11;
export const ARROW_HALF_PX = 5;
/** Clear pixels an arrow keeps from every HUD box. */
export const ARROW_GAP_PX = 1;
/**
 * Arrow directions by index: index k points k × 45° clockwise from east on screen (y down); the names are the
 * frame dirs of ui.offscreen_arrow.
 */
export const ARROW_DIRS = Object.freeze(['e', 'se', 's', 'sw', 'w', 'nw', 'n', 'ne'] as const);
export type ArrowDirName = (typeof ARROW_DIRS)[number];

/**
 * Palette index of Brush-o-meter pattern `zone` at bar pixel (x, y), x along the bar from its left end and y down
 * from its top row: clean solid 23; fling hatched 17/03 (17 where (x + y) mod 4 < 2: 2 px diagonal stripes);
 * transit dotted 26/03 (2×2 dots of 26 on a 3 px lattice). ui.brush_meter's frames are this function, so the
 * zones differ in pattern as well as colour (GDD §17.2).
 */
export function meterPatternIndex(zone: MeterZone, x: number, y: number): number {
  if (zone === MeterZone.Clean) return HudColour.GrassLt;
  if (zone === MeterZone.Fling) return (x + y) % 4 < 2 ? HudColour.HivisOrange : HudColour.AsphaltLt;
  return x % 3 !== 2 && y % 3 !== 2 ? HudColour.CouncilBlue : HudColour.AsphaltLt;
}

/**
 * The HUD's district name for a level: its display name (level.json `name`), or the id's snake name with spaces
 * when it has none ('district.puddle_lane' → 'PUDDLE LANE'), upper-cased and cut to DISTRICT_NAME_MAX_CHARS.
 * Setup only: allocates.
 */
export function districtDisplayName(level: { readonly id: string; readonly name?: string }): string {
  const raw =
    level.name !== undefined && level.name.length > 0
      ? level.name
      : level.id.slice(level.id.indexOf('.') + 1).replaceAll('_', ' ');
  return raw.toUpperCase().slice(0, DISTRICT_NAME_MAX_CHARS).trimEnd();
}

/** Where the HUD's ground targets project: the render camera's centre and ground scale (TECHNICAL_DESIGN §12.2). */
export type HudCamera = {
  /** The camera's (snapped) ground centre, sim metres. */
  xM: number;
  yM: number;
  /** Internal pixels per metre on the ground (render/camera.ts groundPxPerMetre at the camera height). */
  pxPerM: number;
};

/** The frame the off-screen arrows are placed in: its size and the HUD boxes they keep clear of. */
export type HudArrowFrame = {
  readonly widthPx: number;
  readonly heightPx: number;
  readonly blockers: readonly HudRect[];
};

/** A 480×270 frame with no HUD boxes (the default for tests; hud.ts passes its layout's frame). */
export const DEFAULT_ARROW_FRAME: HudArrowFrame = Object.freeze({
  widthPx: 480,
  heightPx: 270,
  blockers: Object.freeze([]),
});

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

/** 'n mph' for 0..MPH_MAX, built once. */
const MPH_TEXTS: readonly string[] = Object.freeze(
  Array.from({ length: MPH_MAX + 1 }, (_, mph) => `${mph} mph`),
);

/** The widest speed text (hud.ts reserves room for it). */
export const MPH_WIDEST_TEXT = `${MPH_MAX} mph`;

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
  // M3 widgets (SSP-299).
  /** Bessie's |vLong|, m/s (the Brush-o-meter and its mph). */
  speedMps: number;
  /** The brush FSM state and RPM 0..1 (brush.ts, vehicle.rpm). */
  brushState: BrushState;
  rpm: number;
  /** The live fling threshold t0, m/s (brush flingThresholdMps, or brush.cleanPickupMaxMps). */
  flingThresholdMps: number;
  /** The meter's full scale with the brush down and up: the top speeds × topSpeedMult, m/s. */
  meterDownMaxMps: number;
  meterTransitMaxMps: number;
  /** World tick until which the meter's clean zone is highlighted (highlightCleanZone; −1: none). HUD-owned. */
  cleanHighlightUntilTick: number;
  /** The district name to show (districtDisplayName), and the level it was made from (so it is made once). */
  districtName: string;
  districtFor: object | null;
  /** Tidy % and the three star thresholds, in parts per million (tidy.ts). */
  tidyPpm: number;
  star1Ppm: number;
  star2Ppm: number;
  star3Ppm: number;
  /** Bessie's body centre, sim metres. */
  bessieXM: number;
  bessieYM: number;
  /** Depot bay centres, sim metres, in level order (from the shift's dump sites; made once per shift). */
  depotCount: number;
  depotX: ArrayLike<number>;
  depotY: ArrayLike<number>;
  depotsFor: object | null;
  /** Hydrant centres, sim metres, in level order (water.ts). */
  hydrantCount: number;
  hydrantX: ArrayLike<number>;
  hydrantY: ArrayLike<number>;
  /** The render camera's ground centre and scale (Hud.draw's camera); pxPerM 0 means none, so no arrows. */
  cameraXM: number;
  cameraYM: number;
  cameraPxPerM: number;
};

/** One text element of the model. */
export type HudText = { visible: boolean; text: string; colour: number };

/** One bar of the model: fill length in pixels and colour. */
export type HudBar = { visible: boolean; fillPx: number; colour: number };

/** The Brush-o-meter (see the header). */
export type HudMeter = {
  visible: boolean;
  /** The needle's zone. */
  zone: MeterZone;
  /** The brush is raising or raised: the whole bar is the transit pattern. */
  transit: boolean;
  /** Widths of the clean and fling parts of the bar (both 0 in transit; they sum to METER_PX otherwise). */
  cleanPx: number;
  flingPx: number;
  /** The needle's column, 0..METER_PX − 1. */
  needlePx: number;
  /** 'n mph'. */
  speedText: string;
  /** The clean zone is highlighted now (GDD §16.2 beat 3), and whether this tick is the blink's lit phase. */
  highlight: boolean;
  highlightLit: boolean;
};

/** The brush state icon and its spin-up ring. */
export type HudBrush = { visible: boolean; icon: BrushIcon; ringVisible: boolean; ringStep: number };

/** The Tidy % bar: fill, the 60/80/92 tick columns and the value text. */
export type HudTidy = {
  visible: boolean;
  fillPx: number;
  /** Tick columns along the bar, star 1..3 (3 entries, rewritten in place). */
  readonly ticksPx: number[];
  readonly value: HudText;
};

/** An off-screen arrow: its centre in internal pixels, direction (ARROW_DIRS index) and colour. */
export type HudArrow = {
  visible: boolean;
  xPx: number;
  yPx: number;
  dir: number;
  colour: number;
  /** The target's index (depot bay or hydrant, level order), or −1. */
  target: number;
};

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
  readonly meter: HudMeter;
  readonly brush: HudBrush;
  readonly district: HudText;
  readonly tidy: HudTidy;
  /** The off-screen arrows to the depot bay and to the nearest hydrant. */
  readonly depotArrow: HudArrow;
  readonly hydrantArrow: HudArrow;
};

/** An empty coordinate list. */
const NO_POINTS: ArrayLike<number> = Object.freeze(new Float64Array(0));

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
    speedMps: 0,
    brushState: BrushState.Raised,
    rpm: 0,
    flingThresholdMps: 4,
    meterDownMaxMps: 6,
    meterTransitMaxMps: 11,
    cleanHighlightUntilTick: -1,
    districtName: '',
    districtFor: null,
    tidyPpm: 0,
    star1Ppm: 600_000,
    star2Ppm: 800_000,
    star3Ppm: 920_000,
    bessieXM: 0,
    bessieYM: 0,
    depotCount: 0,
    depotX: NO_POINTS,
    depotY: NO_POINTS,
    depotsFor: null,
    hydrantCount: 0,
    hydrantX: NO_POINTS,
    hydrantY: NO_POINTS,
    cameraXM: 0,
    cameraYM: 0,
    cameraPxPerM: 0,
  };
}

function arrow(colour: number): HudArrow {
  return { visible: false, xPx: 0, yPx: 0, dir: 0, colour, target: -1 };
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
    meter: {
      visible: false,
      zone: MeterZone.Transit,
      transit: true,
      cleanPx: 0,
      flingPx: 0,
      needlePx: 0,
      speedText: '',
      highlight: false,
      highlightLit: false,
    },
    brush: { visible: false, icon: BrushIcon.Raised, ringVisible: false, ringStep: 0 },
    district: text(),
    tidy: { visible: false, fillPx: 0, ticksPx: [0, 0, 0], value: text() },
    depotArrow: arrow(HudColour.SweeperYellow),
    hydrantArrow: arrow(HudColour.Sky),
  };
}

/**
 * The parts of the snapshot made once per shift: the district name (when `view.level` changes) and the depot bay
 * centres (when `view.shift` changes). Allocates only then.
 */
function readShiftConstants(view: WorldView, out: HudSnapshot): void {
  if (out.districtFor !== view.level) {
    out.districtFor = view.level;
    out.districtName = districtDisplayName(view.level);
  }
  const shift = view.shift;
  if (out.depotsFor !== shift) {
    let n = 0;
    for (let i = 0; i < shift.siteCount; i++) if (shift.siteKind[i] === DumpSite.Depot) n++;
    const xs = new Float64Array(n);
    const ys = new Float64Array(n);
    let k = 0;
    for (let i = 0; i < shift.siteCount; i++) {
      if (shift.siteKind[i] !== DumpSite.Depot) continue;
      xs[k] = 0.5 * ((shift.siteMinX[i] ?? 0) + (shift.siteMaxX[i] ?? 0));
      ys[k] = 0.5 * ((shift.siteMinY[i] ?? 0) + (shift.siteMaxY[i] ?? 0));
      k++;
    }
    out.depotsFor = shift;
    out.depotCount = n;
    out.depotX = xs;
    out.depotY = ys;
  }
}

/**
 * Scratch for the arrow maths: Bessie's point (bx, by) and the target's (tx, ty). Fractional values first so the
 * fields start as doubles (TECHNICAL_DESIGN §17).
 */
const RAY = { bx: 0.5, by: 0.5, tx: 0.5, ty: 0.5 };

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
  // M3 widgets (SSP-299).
  const params = view.hopper.params;
  const sweeper = params.tuning;
  const brush = view.brush;
  out.speedMps = Math.abs(v.vLongMps);
  out.brushState = brush.state;
  out.rpm = v.rpm;
  out.flingThresholdMps = brush.flingThresholdMps ?? sweeper.brush.cleanPickupMaxMps;
  out.meterDownMaxMps = sweeper.drive.topSpeedBrushDownMps * params.topSpeedMult;
  out.meterTransitMaxMps = sweeper.drive.topSpeedTransitMps * params.topSpeedMult;
  const tidy = view.tidy;
  out.tidyPpm = tidy.tidyPpm;
  out.star1Ppm = tidy.star1Ppm;
  out.star2Ppm = tidy.star2Ppm;
  out.star3Ppm = tidy.star3Ppm;
  out.bessieXM = v.xM;
  out.bessieYM = v.yM;
  const waterView = view.water;
  out.hydrantX = waterView.hydrantX;
  out.hydrantY = waterView.hydrantY;
  out.hydrantCount = waterView.hydrantX.length;
  readShiftConstants(view, out);
  return out;
}

/**
 * Index of the point (xs[i], ys[i]), i < count, nearest to (x, y) by Euclidean distance; ties go to the lowest
 * index; −1 when count is 0.
 */
export function nearestPoint(
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  count: number,
  x: number,
  y: number,
): number {
  RAY.bx = x;
  RAY.by = y;
  return nearestToRay(xs, ys, count);
}

/** nearestPoint from (RAY.bx, RAY.by): doubles go through the scratch, never as call arguments (no boxing). */
function nearestToRay(xs: ArrayLike<number>, ys: ArrayLike<number>, count: number): number {
  const x = RAY.bx;
  const y = RAY.by;
  let best = -1;
  let bestD2 = Number.POSITIVE_INFINITY;
  for (let i = 0; i < count; i++) {
    const dx = (xs[i] ?? 0) - x;
    const dy = (ys[i] ?? 0) - y;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) {
      bestD2 = d2;
      best = i;
    }
  }
  return best;
}

/**
 * Places off-screen arrow `out` for a target at screen point (tx, ty) seen from Bessie at (bx, by), internal
 * pixels, in `frame` (see the header): hidden while the target is inside the frame (or Bessie is on it, or no
 * clear spot is left on the ray); otherwise its centre is the ray's last point whose 11×11 arrow lies inside the
 * 4 px margin, moved back along the ray until the arrow is ARROW_GAP_PX clear of every blocker, and its direction
 * is the ray's, rounded to the nearest 45°. Allocates nothing.
 */
export function placeArrow(
  out: HudArrow,
  bx: number,
  by: number,
  tx: number,
  ty: number,
  frame: HudArrowFrame,
): void {
  RAY.bx = bx;
  RAY.by = by;
  RAY.tx = tx;
  RAY.ty = ty;
  placeArrowOnRay(out, frame);
}

/**
 * placeArrow for the ray in RAY. The ray's doubles are read from the scratch rather than passed as arguments: a
 * call V8 does not inline boxes each double argument (16 B; the same reason as tidy.ts tidyPpm).
 */
function placeArrowOnRay(out: HudArrow, frame: HudArrowFrame): void {
  const bx = RAY.bx;
  const by = RAY.by;
  const tx = RAY.tx;
  const ty = RAY.ty;
  const w = frame.widthPx;
  const h = frame.heightPx;
  out.visible = false;
  if (!(Number.isFinite(tx) && Number.isFinite(ty) && Number.isFinite(bx) && Number.isFinite(by))) return;
  if (tx >= 0 && tx < w && ty >= 0 && ty < h) return;
  const half = ARROW_HALF_PX;
  const x0 = SAFE_MARGIN_PX + half;
  const y0 = SAFE_MARGIN_PX + half;
  const x1 = w - SAFE_MARGIN_PX - 1 - half;
  const y1 = h - SAFE_MARGIN_PX - 1 - half;
  // The ray starts at Bessie, clamped into the inset rect (she is normally near the middle of the frame).
  const sx = bx < x0 ? x0 : bx > x1 ? x1 : bx;
  const sy = by < y0 ? y0 : by > y1 ? y1 : by;
  const dx = tx - sx;
  const dy = ty - sy;
  if (dx === 0 && dy === 0) return;
  const sector = Math.round(Math.atan2(ty - by, tx - bx) / (Math.PI / 4));
  out.dir = ((sector % 8) + 8) % 8;
  // Where the ray leaves the inset rect.
  let t = 1;
  if (dx > 0) t = Math.min(t, (x1 - sx) / dx);
  else if (dx < 0) t = Math.min(t, (x0 - sx) / dx);
  if (dy > 0) t = Math.min(t, (y1 - sy) / dy);
  else if (dy < 0) t = Math.min(t, (y0 - sy) / dy);
  // Back along the ray out of every blocker: an arrow centred on (px, py) overlaps blocker b (or comes within
  // the gap of it) when px is in [b.x − half − gap, b.x + b.w − 1 + half + gap], and the same for y. Leaving
  // the continuous box 0.5 px wider on each side guarantees the rounded centre is outside that range.
  const reach = half + ARROW_GAP_PX;
  const blockers = frame.blockers;
  for (let iteration = 0; iteration <= 4 * blockers.length + 1; iteration++) {
    const px = Math.round(sx + t * dx);
    const py = Math.round(sy + t * dy);
    let hit: HudRect | null = null;
    for (let i = 0; i < blockers.length; i++) {
      const b = blockers[i];
      if (b === undefined) continue;
      if (
        px >= b.x - reach &&
        px <= b.x + b.w - 1 + reach &&
        py >= b.y - reach &&
        py <= b.y + b.h - 1 + reach
      ) {
        hit = b;
        break;
      }
    }
    if (hit === null) {
      out.visible = true;
      out.xPx = px;
      out.yPx = py;
      return;
    }
    const cx0 = hit.x - reach - 1;
    const cx1 = hit.x + hit.w + reach;
    const cy0 = hit.y - reach - 1;
    const cy1 = hit.y + hit.h + reach;
    let enter = Number.NEGATIVE_INFINITY;
    if (dx > 0) enter = Math.max(enter, (cx0 - sx) / dx);
    else if (dx < 0) enter = Math.max(enter, (cx1 - sx) / dx);
    if (dy > 0) enter = Math.max(enter, (cy0 - sy) / dy);
    else if (dy < 0) enter = Math.max(enter, (cy1 - sy) / dy);
    t = enter - 1e-6;
    if (!(t > 0)) return;
  }
}

/** Writes arrow `out` for target (txM, tyM), sim metres, or hides it (`wanted` false or no camera). */
function arrowTo(
  out: HudArrow,
  wanted: boolean,
  s: Readonly<HudSnapshot>,
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  count: number,
  frame: HudArrowFrame,
): void {
  const k = s.cameraPxPerM;
  RAY.bx = s.bessieXM;
  RAY.by = s.bessieYM;
  out.target = wanted && k > 0 ? nearestToRay(xs, ys, count) : -1;
  if (out.target < 0) {
    out.visible = false;
    return;
  }
  const cx = frame.widthPx / 2;
  const cy = frame.heightPx / 2;
  RAY.bx = cx + (s.bessieXM - s.cameraXM) * k;
  RAY.by = cy + (s.bessieYM - s.cameraYM) * k;
  RAY.tx = cx + ((xs[out.target] ?? 0) - s.cameraXM) * k;
  RAY.ty = cy + ((ys[out.target] ?? 0) - s.cameraYM) * k;
  placeArrowOnRay(out, frame);
}

/**
 * Writes the model for `s` at `tick` (the World's tick) into `out` and returns it; the off-screen arrows are
 * placed in `frame` (hud.ts passes its layout's: the width and the HUD boxes). Pure; allocates nothing when given
 * `out` (hud.ts always passes its own; the default is for tests).
 */
export function hudModel(
  s: Readonly<HudSnapshot>,
  tick: number,
  out: HudModel = createHudModel(),
  frame: HudArrowFrame = DEFAULT_ARROW_FRAME,
): HudModel {
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

  // Brush-o-meter.
  const state = s.brushState;
  const down = state !== BrushState.Raised && state !== BrushState.Raising;
  const speed = s.speedMps > 0 ? s.speedMps : 0;
  const meter = out.meter;
  meter.visible = true;
  meter.transit = !down;
  const scale = down ? s.meterDownMaxMps : s.meterTransitMaxMps;
  let needle = scale > 0 ? Math.floor((speed / scale) * METER_PX) : 0;
  if (needle > METER_PX - 1) needle = METER_PX - 1;
  if (!(needle > 0)) needle = 0;
  if (down) {
    const t0 = s.flingThresholdMps;
    let cleanPx = scale > 0 ? Math.floor((t0 / scale) * METER_PX) : METER_PX;
    if (t0 >= scale) cleanPx = METER_PX;
    if (!(cleanPx > 0)) cleanPx = 0;
    meter.cleanPx = cleanPx;
    meter.flingPx = METER_PX - cleanPx;
    meter.zone = speed <= t0 ? MeterZone.Clean : MeterZone.Fling;
    // Keep the needle inside its zone's part of the bar (the zone boundary is rarely a whole pixel).
    if (meter.zone === MeterZone.Clean && cleanPx > 0 && needle > cleanPx - 1) needle = cleanPx - 1;
    if (meter.zone === MeterZone.Fling && needle < cleanPx)
      needle = cleanPx < METER_PX ? cleanPx : METER_PX - 1;
  } else {
    meter.cleanPx = 0;
    meter.flingPx = 0;
    meter.zone = MeterZone.Transit;
  }
  meter.needlePx = needle;
  let mph = Math.round(speed * MPH_PER_MPS);
  if (mph > MPH_MAX) mph = MPH_MAX;
  meter.speedText = MPH_TEXTS[mph] ?? '';
  meter.highlight = down && meter.cleanPx > 0 && tick < s.cleanHighlightUntilTick;
  meter.highlightLit = meter.highlight && (Math.floor(tick / CLEAN_HIGHLIGHT_BLINK_TICKS) & 1) === 0;

  // Brush state and the spin-up ring.
  const brush = out.brush;
  brush.visible = true;
  brush.icon = down ? BrushIcon.Lowered : BrushIcon.Raised;
  brush.ringVisible = down;
  let ring = 0;
  if (state === BrushState.Collecting || state === BrushState.Bulldozing) ring = BRUSH_RING_STEPS;
  else if (down) ring = Math.floor(s.rpm * BRUSH_RING_STEPS);
  if (!(ring > 0)) ring = 0;
  if (ring > BRUSH_RING_STEPS) ring = BRUSH_RING_STEPS;
  brush.ringStep = down ? ring : 0;

  // District name.
  const district = out.district;
  district.visible = s.districtName.length > 0;
  district.text = s.districtName;
  district.colour = HudColour.Chalk;

  // Tidy %: fill and value floored from ppm (integer maths, so 599,999 ppm is 59% and 38 px).
  const tidy = out.tidy;
  let ppm = Math.round(s.tidyPpm);
  if (!(ppm > 0)) ppm = 0;
  if (ppm > TIDY_PPM) ppm = TIDY_PPM;
  tidy.visible = true;
  tidy.fillPx = Math.floor((ppm * TIDY_BAR_PX) / TIDY_PPM);
  tidy.ticksPx[0] = Math.floor((s.star1Ppm * TIDY_BAR_PX) / TIDY_PPM);
  tidy.ticksPx[1] = Math.floor((s.star2Ppm * TIDY_BAR_PX) / TIDY_PPM);
  tidy.ticksPx[2] = Math.floor((s.star3Ppm * TIDY_BAR_PX) / TIDY_PPM);
  const tidyValue = tidy.value;
  tidyValue.visible = true;
  tidyValue.text = PERCENT_TEXTS[Math.floor((ppm * 100) / TIDY_PPM)] ?? '';
  tidyValue.colour = HudColour.Chalk;

  // Off-screen arrows.
  arrowTo(out.depotArrow, warn, s, s.depotX, s.depotY, s.depotCount, frame);
  out.depotArrow.colour = HudColour.SweeperYellow;
  const waterLow = s.tankUnits > 0 && s.water / s.tankUnits < WATER_LOW_FRACTION;
  arrowTo(out.hydrantArrow, waterLow, s, s.hydrantX, s.hydrantY, s.hydrantCount, frame);
  out.hydrantArrow.colour = HudColour.Sky;
  return out;
}
// per-frame draw path: end
