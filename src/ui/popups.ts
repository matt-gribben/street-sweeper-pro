// World-space popups (GDD §15.2, §18.3; ART_BIBLE §11; AUDIO_DESIGN §13.2; TECHNICAL_DESIGN §7.2; SSP-288): the
// per-pickup score popups, the penalty popups and the NPCs' speech bubbles, drawn in the UI pass at the world
// positions they belong to. An event-bus subscriber: it reads sim events and the World's read-only views, and never
// writes the sim (CLAUDE.md hard rule 2).
//
// Score popups. Every EV.PickupScored with points (scoring.ts: a litter item, a stain or swept glass, after its chain
// increment) spawns '+<points>' at the pickup, in the tier colour of the multiplier it scored at (ART_BIBLE §11: ×1 07,
// ×2 23, ×3 28, ×4 16, ×5 cycling 16 → 17 → 20 → 28 → 23 every 5 ticks of the world tick). Every EV.Penalty with
// points spawns '-<points>' in 18 where the offence happened (the complaint-only offences, 0 points, show none).
// Outlined Kerbside 5×7 (Kerbside Bold 8×8 arrives in M4, SSP-156), centred on the point. Timing (popupFrameAt, a
// pure function of the age in sim ticks): the rise is round(12 × (1 − (1 − a/36)²)) px over ticks 0..36 (hudModel.ts
// popupRisePx, shared with the HUD's tier popup), so the y offset is 0 at spawn and −12 px from tick 36; it holds to
// tick 48, then blinks out in three 3-tick steps (hidden 48–50, shown 51–53, hidden 54–56) and is gone from tick 57.
// (The HUD's tier popup blinks three hidden/shown pairs and is gone from 66; the world popups are many and short, so
// they take the issue's 3 × 3 ticks. ART_BIBLE §11 records both.) A popup starts on the first frame after the tick
// that emitted its event (World.tick = event tick + 1 at age 0), so the frame drawn just after the pickup shows it at
// the pickup. POPUP_CAPACITY popups live at once; a new one past that replaces the oldest.
//
// Speech bubbles (GDD §15.2 "diegesis where cheap", §18.3; AUDIO_DESIGN §13.2). Triggers, from the M3 behaviours:
//   EV.NpcHit     the kind's entities.json sfx.hit voice: ped_oi 'Oi!' (the shopper, and every other pedestrian that
//                 shouts it), granny_harrumph 'Hmph!' (Doris), cat_yowl 'Not the cat!' (the cat on Bessie's roof);
//                 a walker's dog that is hit (it carries its walker's kind) makes its walker shout;
//   EV.FistShake  'Hmph!' over Doris (her sfx.horn voice, granny_harrumph);
//   EV.Caught     'Caught!' over the litterbug;
//   EV.CarHorn    '!' over the honking car (AUDIO_DESIGN §13.2's honk bubble).
// Kerbside 5×7 chalk (07) on an ink (00) panel with a 1 px chalk outline and a tail (panels.ts drawBubble), its tip
// BUBBLE_LIFT_PX above the source's projected ground point (a person's head, a cat's back, a car's roof), clamped
// inside the frame. Bubbles follow their source every frame at its interpolated position (prevX → x by the frame's
// alpha), by NPC handle or vehicle uid, so a swap-remove never moves a bubble onto someone else; once the source has
// gone the bubble stays where it last was. The BubbleManager owns the rules SSP-184's captions reuse: a bubble shows
// for 1.5 s + 60 ms per character, at most 3 s (bubbleDurationTicks); at most BUBBLE_MAX (3) show at once, a 4th
// replaces the oldest; and a bubble whose key is already showing replaces it rather than stacking. Keys here are per
// source (the NPC's handle, or −1 − the vehicle's uid), so a car's second honk restarts its '!'.
//
// Time. Every age counts sim ticks (World.tick), never frames or wall-clock time, so popups and bubbles freeze with
// the World under the PauseOverlay and at the shift's end, and a frozen capture is exact.
//
// Projection. src/ui may not import render/camera.ts (TECHNICAL_DESIGN §2.1), so the composition root (ShiftScene)
// injects the camera as a PopupCamera each frame: its snapped ground centre and ground scale (the HUD's HudCamera)
// plus the frame's render alpha. A ground point (x, y)
// lands at internal pixel (floor(W/2 + (x − camera.x) × pxPerM), floor(135 + (y − camera.y) × pxPerM)), the straight-
// down camera's ground projection (TECHNICAL_DESIGN §12.2), the same one the HUD's off-screen arrows use.
//
// Draw order and cost. ShiftScene draws popups and bubbles into the HUD's UiSpriteBatch before the HUD, so the HUD
// covers them and they cost no draw call of their own (TECHNICAL_DESIGN §12.7). POPUPS_MAX_QUADS bounds their quads.
//
// Per frame nothing allocates: the pools are typed arrays sized once, points are written as glyph indices into a
// byte buffer and drawn from a table of one-character strings, bubble texts are the constants above (or the caller's
// strings, kept by reference), and positions go through a preallocated scratch. The sections between the
// "per-frame draw path" markers are scanned by tests/unit/popups.test.ts for `new` and array literals, and
// tests/unit/popupsHeap.test.ts measures the heap.
import type { EventBus, Unsubscribe } from '../app/events.ts';
import { SIM_HZ } from '../sim/constants.ts';
import { type Entities, NPC_IDS } from '../sim/entities.ts';
import { EV } from '../sim/eventQueue.ts';
import { NPC_HANDLE_SLOT_BITS, NpcOrigin, type NpcStoreView, resolveNpcHandle } from '../sim/npc/store.ts';
import { DEFAULT_ENTITIES } from '../sim/tuning.ts';
import type { VehicleStoreView } from '../sim/vehicleStore.ts';
import { type BitmapFont, TextVariant } from './bitmapText.ts';
import { HUD_HEIGHT_PX } from './hud.ts';
import {
  type HudCamera,
  HudColour,
  POPUP_BLINK_TICKS,
  POPUP_HOLD_TICKS,
  POPUP_RISE_TICKS,
  popupRisePx,
  tierColour,
} from './hudModel.ts';
import {
  BUBBLE_PAD_X_PX,
  BUBBLE_PAD_Y_PX,
  BUBBLE_TAIL_PX,
  BUBBLE_TEXT,
  bubbleHeightFor,
  bubbleWidthFor,
  type PanelSink,
  Panels,
} from './panels.ts';

// ---------------------------------------------------------------------------------------------------------
// Score and penalty popups: timing
// ---------------------------------------------------------------------------------------------------------

/** Blink-out steps of a world popup after its hold (hidden, shown, hidden), each POPUP_BLINK_TICKS long. */
export const WORLD_POPUP_BLINK_STEPS = 3;
/** Age at which a world popup is gone: 36 rise + 12 hold + 3 × 3 blink = 57. */
export const WORLD_POPUP_LIFE_TICKS =
  POPUP_RISE_TICKS + POPUP_HOLD_TICKS + WORLD_POPUP_BLINK_STEPS * POPUP_BLINK_TICKS;
/** Penalty popups' colour (ART_BIBLE §11: 18 postbox_red). */
export const PENALTY_COLOUR = HudColour.PostboxRed;

/** What a popup shows at one age (popupFrameAt writes it). */
export type PopupFrame = {
  /** False while blinked out and once gone. */
  visible: boolean;
  /** Pixels from the spawn point, y down: 0 at spawn, −12 from tick 36. */
  offsetYPx: number;
  /** Palette index of the text. */
  colour: number;
};

/** A fresh PopupFrame (setup only). */
export function createPopupFrame(): PopupFrame {
  return { visible: false, offsetYPx: 0, colour: HudColour.Chalk };
}

// per-frame draw path: begin
/**
 * The popup at `age` sim ticks (see the header): its y offset, whether it shows, and its colour (18 for a penalty,
 * else the tier colour of `multiplier` at world tick `tick`, ×5 cycling). Pure; writes `out` and returns it.
 */
export function popupFrameAt(
  age: number,
  multiplier: number,
  penalty: boolean,
  tick: number,
  out: PopupFrame,
): PopupFrame {
  out.offsetYPx = 0 - popupRisePx(age);
  const blinkFrom = POPUP_RISE_TICKS + POPUP_HOLD_TICKS;
  if (age < 0 || age >= WORLD_POPUP_LIFE_TICKS) out.visible = false;
  else if (age < blinkFrom) out.visible = true;
  else out.visible = (Math.floor((age - blinkFrom) / POPUP_BLINK_TICKS) & 1) === 1;
  out.colour = penalty ? PENALTY_COLOUR : tierColour(multiplier, tick);
  return out;
}
// per-frame draw path: end

// ---------------------------------------------------------------------------------------------------------
// Speech bubbles: the manager SSP-184 builds on
// ---------------------------------------------------------------------------------------------------------

/** At most this many bubbles show at once (AUDIO_DESIGN §13.2). */
export const BUBBLE_MAX = 3;
/** Display time: 1.5 s plus 60 ms per character, capped at 3 s (AUDIO_DESIGN §13.2). */
export const BUBBLE_BASE_MS = 1500;
export const BUBBLE_PER_CHAR_MS = 60;
export const BUBBLE_MAX_MS = 3000;
/** The widest line a bubble holds (the radio panel's page, 32 glyphs); wider text is an authoring error. */
export const BUBBLE_MAX_INK_PX = 192;

/** A bubble's identity: a newer bubble with the same key replaces the one showing. */
export type BubbleKey = number | string;

/** What a bubble follows: a fixed ground point, an NPC (by handle) or a traffic vehicle (by uid). */
export const BubbleAnchor = { Fixed: 0, Npc: 1, Vehicle: 2 } as const;
export type BubbleAnchor = (typeof BubbleAnchor)[keyof typeof BubbleAnchor];

/** Characters (code points) of `text`. Allocates nothing. */
export function bubbleCharCount(text: string): number {
  let n = 0;
  for (let i = 0; i < text.length; n++) i += (text.codePointAt(i) ?? 0) > 0xffff ? 2 : 1;
  return n;
}

/** How long a bubble of `chars` characters shows, in milliseconds: min(3000, 1500 + 60 × chars). */
export function bubbleDurationMs(chars: number): number {
  const ms = BUBBLE_BASE_MS + BUBBLE_PER_CHAR_MS * chars;
  return ms < BUBBLE_MAX_MS ? ms : BUBBLE_MAX_MS;
}

/** The same in seconds (2.1 for 10 characters, 3.0 from 25). */
export function bubbleDurationS(chars: number): number {
  return bubbleDurationMs(chars) / 1000;
}

/** The same in sim ticks, rounded to the nearest tick (126 for 10 characters, 180 at the cap). */
export function bubbleDurationTicks(chars: number): number {
  return Math.round((bubbleDurationMs(chars) * SIM_HZ) / 1000);
}

/**
 * The bubble pool and its rules (AUDIO_DESIGN §13.2): timing, at most BUBBLE_MAX at once, the oldest replaced by a
 * new key past that, and same-key replacement. Slots are typed arrays; `text` and `key` hold references, so showing
 * a constant string allocates nothing. SSP-184 (captions) extends this manager rather than writing its own.
 */
export class BubbleManager {
  readonly capacity = BUBBLE_MAX;
  /** Per slot: its key and text (meaningful while active). */
  readonly key: BubbleKey[];
  readonly text: string[];
  /** World tick it showed from, −1 while the slot is free; and the tick it is gone from. */
  readonly startTick: Int32Array;
  readonly endTick: Int32Array;
  /** Show order: a larger serial is newer. */
  readonly serial: Float64Array;
  /** What it follows (BubbleAnchor) and the reference: an NPC handle, a vehicle uid, or unused. */
  readonly anchor: Uint8Array;
  readonly ref: Int32Array;
  /** Where its source is, sim metres: the spawn point, then the last resolved position. */
  readonly xM: Float64Array;
  readonly yM: Float64Array;
  /** How far above the source's ground point its tail tip sits, internal pixels. */
  readonly liftPx: Int16Array;
  private nextSerial = 1;

  constructor() {
    const n = BUBBLE_MAX;
    this.key = new Array<BubbleKey>(n).fill(-1);
    this.text = new Array<string>(n).fill('');
    this.startTick = new Int32Array(n).fill(-1);
    this.endTick = new Int32Array(n);
    this.serial = new Float64Array(n);
    this.anchor = new Uint8Array(n);
    this.ref = new Int32Array(n);
    this.xM = new Float64Array(n);
    this.yM = new Float64Array(n);
    this.liftPx = new Int16Array(n);
  }

  // per-frame draw path: begin
  /** True while slot `s` holds a bubble that has not expired (call expire first for "now"). */
  isActive(s: number): boolean {
    return (this.startTick[s] ?? -1) >= 0;
  }

  /** Bubbles active now. */
  get count(): number {
    let n = 0;
    for (let s = 0; s < BUBBLE_MAX; s++) if (this.isActive(s)) n++;
    return n;
  }

  /** The slot showing `key`, or −1. */
  slotOf(key: BubbleKey): number {
    for (let s = 0; s < BUBBLE_MAX; s++) if (this.isActive(s) && this.key[s] === key) return s;
    return -1;
  }

  /** Frees every bubble gone by world tick `nowTick`. */
  expire(nowTick: number): void {
    const start = this.startTick;
    const end = this.endTick;
    for (let s = 0; s < BUBBLE_MAX; s++) if ((start[s] ?? -1) >= 0 && nowTick >= (end[s] ?? 0)) start[s] = -1;
  }

  /**
   * Shows `text` under `key` from world tick `startTick` for bubbleDurationTicks of its characters, following
   * `anchor`/`ref` from the point (xs[at], ys[at]) (sim metres; an (array, index) pair, so no double crosses the
   * call), its tip `liftPx` above the source. A key already showing is replaced in its slot (the timer restarts);
   * otherwise a free slot is taken, or, with BUBBLE_MAX showing, the oldest is replaced. Returns the slot. Throws
   * for text wider than BUBBLE_MAX_INK_PX in `font` (an authoring error).
   */
  show(
    key: BubbleKey,
    text: string,
    startTick: number,
    anchor: BubbleAnchor,
    ref: number,
    xs: ArrayLike<number>,
    ys: ArrayLike<number>,
    at: number,
    liftPx: number,
    font: BitmapFont | null = null,
  ): number {
    if (font !== null && font.measure(text, TextVariant.Plain) - 1 > BUBBLE_MAX_INK_PX)
      rejectBubbleText(text);
    this.expire(startTick);
    let s = this.slotOf(key);
    if (s < 0) s = this.freeSlot();
    if (s < 0) s = this.oldestSlot();
    this.key[s] = key;
    this.text[s] = text;
    this.startTick[s] = startTick;
    this.endTick[s] = startTick + bubbleDurationTicks(bubbleCharCount(text));
    this.serial[s] = this.nextSerial;
    this.nextSerial += 1;
    this.anchor[s] = anchor;
    this.ref[s] = ref;
    this.xM[s] = xs[at] ?? 0;
    this.yM[s] = ys[at] ?? 0;
    this.liftPx[s] = liftPx;
    return s;
  }

  /** Drops every bubble (at the start of a shift). */
  clear(): void {
    this.startTick.fill(-1);
  }

  /** The active slot with the `rank`-th smallest serial (0 = oldest), or −1: draws oldest first, newest on top. */
  byAge(rank: number): number {
    let found = -1;
    let k = -1;
    let floor = 0;
    while (k < rank) {
      found = -1;
      let best = Number.POSITIVE_INFINITY;
      for (let s = 0; s < BUBBLE_MAX; s++) {
        const serial = this.serial[s] ?? 0;
        if (this.isActive(s) && serial > floor && serial < best) {
          best = serial;
          found = s;
        }
      }
      if (found < 0) return -1;
      floor = best;
      k++;
    }
    return found;
  }

  private freeSlot(): number {
    for (let s = 0; s < BUBBLE_MAX; s++) if (!this.isActive(s)) return s;
    return -1;
  }

  private oldestSlot(): number {
    let oldest = 0;
    for (let s = 1; s < BUBBLE_MAX; s++) if ((this.serial[s] ?? 0) < (this.serial[oldest] ?? 0)) oldest = s;
    return oldest;
  }
  // per-frame draw path: end
}

function rejectBubbleText(text: string): never {
  throw new RangeError(`bubble text '${text}' is wider than ${BUBBLE_MAX_INK_PX} px (one line)`);
}

// ---------------------------------------------------------------------------------------------------------
// The popups layer
// ---------------------------------------------------------------------------------------------------------

/** Bubble texts (GDD §18.3; 'Hmph!' is the spelling both docs use since SSP-288). */
export const BUBBLE_OI = 'Oi!';
export const BUBBLE_HMPH = 'Hmph!';
export const BUBBLE_NOT_THE_CAT = 'Not the cat!';
export const BUBBLE_CAUGHT = 'Caught!';
export const BUBBLE_HONK = '!';

/** The bubble each voice SFX speaks when its NPC reacts (entities.json sfx.hit / sfx.horn). */
const VOICE_BUBBLES: Readonly<Record<string, string>> = Object.freeze({
  ped_oi: BUBBLE_OI,
  granny_harrumph: BUBBLE_HMPH,
  cat_yowl: BUBBLE_NOT_THE_CAT,
});

/** Tip heights above the source's ground point (ART_BIBLE §7: a 24 px figure on its feet; a 16 px cat; a car). */
export const BUBBLE_LIFT_PERSON_PX = 22;
export const BUBBLE_LIFT_ANIMAL_PX = 14;
export const BUBBLE_LIFT_VEHICLE_PX = 20;

/** Score popups alive at once; a new one past that replaces the oldest. */
export const POPUP_CAPACITY = 24;
/** Characters a popup holds: the sign and up to 7 digits. */
export const POPUP_MAX_CHARS = 8;
const POPUP_MAX_VALUE = 9_999_999;

/** The most UI quads one draw() adds (each outlined glyph is 2 quads; a bubble's panel and tail at most 22). */
export const POPUPS_MAX_QUADS =
  POPUP_CAPACITY * POPUP_MAX_CHARS * 2 + BUBBLE_MAX * (22 + Math.ceil(BUBBLE_MAX_INK_PX / 6) + 1);

/** Keys of bubbles at a fixed point: FIXED_KEY_BASE − (a counter wrapping at 2^28), never a vehicle's −1 − uid. */
const FIXED_KEY_BASE = -(1 << 29);
const FIXED_KEY_MASK = (1 << 28) - 1;
/** An event's entity index names the source only if that NPC or vehicle is still within this of the event point. */
const SAME_SOURCE_M = 1;
/** Popups and bubbles whose point is further than this outside the frame are not drawn. */
const CULL_MARGIN_PX = 64;

/** The popup glyphs, by index: '0'..'9', '+', '-'. */
const GLYPHS: readonly string[] = Object.freeze(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '+', '-']);
const GLYPH_PLUS = 10;
const GLYPH_MINUS = 11;

/** What the popups read of the World: its tick and the stores bubbles follow. A WorldView satisfies it. */
export type PopupWorld = {
  readonly tick: number;
  readonly npc: NpcStoreView;
  readonly vehicles: VehicleStoreView;
};

/**
 * Where the render camera looks this frame (the HUD's camera: its snapped ground centre and scale) and the frame's
 * render alpha, which the bubbles' sources are interpolated by. ShiftScene writes one every frame.
 */
export type PopupCamera = HudCamera & {
  /** The frame's fraction between the last two ticks, 0..1. */
  alpha: number;
};

/** A PopupCamera (setup only). */
export function createPopupCamera(): PopupCamera {
  return { xM: 0.5, yM: 0.5, pxPerM: 16.5, alpha: 0.5 };
}

/** Pixel scratch for project(). */
export type PixelPoint = { xPx: number; yPx: number };

/** World-space score/penalty popups and NPC speech bubbles over one UI sink (see the file header). */
export class Popups {
  readonly sink: PanelSink;
  readonly font: BitmapFont;
  readonly panels: Panels;
  /** The bubble pool (SSP-184 extends it). */
  readonly bubbles = new BubbleManager();
  /** Per score popup: start tick (−1 free), show order, position, multiplier, penalty flag, glyphs. */
  readonly popupStart = new Int32Array(POPUP_CAPACITY).fill(-1);
  readonly popupSerial = new Float64Array(POPUP_CAPACITY);
  readonly popupX = new Float64Array(POPUP_CAPACITY);
  readonly popupY = new Float64Array(POPUP_CAPACITY);
  readonly popupMultiplier = new Uint8Array(POPUP_CAPACITY);
  readonly popupPenalty = new Uint8Array(POPUP_CAPACITY);
  readonly popupLength = new Uint8Array(POPUP_CAPACITY);
  readonly popupGlyphs = new Uint8Array(POPUP_CAPACITY * POPUP_MAX_CHARS);
  /** Hit bubble text by NPC_IDS index (from its entities.json sfx.hit), '' for none. */
  private readonly hitText: readonly string[];
  /** Doris's fist-shake bubble (her sfx.horn voice). */
  private readonly hornText: string;
  /** NPC_IDS index of the cat (lifted less: it is small, or on Bessie's roof). */
  private readonly catKind = NPC_IDS.indexOf('npc.cat');
  /** Outlined advance per popup glyph. */
  private readonly glyphAdvance: Int32Array;
  private readonly frame = createPopupFrame();
  private readonly point: PixelPoint = { xPx: 0, yPx: 0 };
  /** The point of the event being handled, sim metres (spawns read it, so no double crosses their calls). */
  private readonly spawnX = new Float64Array(1);
  private readonly spawnY = new Float64Array(1);
  private world: PopupWorld | null = null;
  private nextSerial = 1;
  private fixedKeys = 0;

  constructor(sink: PanelSink, font: BitmapFont, entities: Entities = DEFAULT_ENTITIES) {
    this.sink = sink;
    this.font = font;
    this.panels = new Panels(sink, font);
    this.hitText = NPC_IDS.map((id) => VOICE_BUBBLES[entities.npcs[id].sfx.hit ?? ''] ?? '');
    this.hornText = VOICE_BUBBLES[entities.npcs['npc.old_woman'].sfx.horn ?? ''] ?? BUBBLE_HMPH;
    this.glyphAdvance = Int32Array.from(GLYPHS, (g) => font.measure(g, TextVariant.Outline));
  }

  /**
   * Subscribes to the bus (EV.PickupScored, EV.Penalty, EV.NpcHit, EV.FistShake, EV.Caught, EV.CarHorn) for the
   * World `world` (read when an event arrives, to find the source a bubble follows). Call the returned function to
   * stop (scene exit).
   */
  attach(bus: EventBus, world: PopupWorld): Unsubscribe {
    this.world = world;
    const offs = [
      bus.on(EV.PickupScored, (e) => {
        if (!(e.pts > 0)) return;
        this.at(e.x, e.y);
        this.spawnAt(e.tick + 1, e.multiplier, e.pts, false);
      }),
      bus.on(EV.Penalty, (e) => {
        if (!(e.pts < 0)) return;
        this.at(e.x, e.y);
        this.spawnAt(e.tick + 1, 1, -e.pts, true);
      }),
      bus.on(EV.NpcHit, (e) => {
        const text = this.hitText[NPC_IDS.indexOf(e.kind)] ?? '';
        if (text === '') return;
        this.at(e.x, e.y);
        this.npcBubble(e.tick + 1, e.entity, text);
      }),
      bus.on(EV.FistShake, (e) => {
        this.at(e.x, e.y);
        this.npcBubble(e.tick + 1, e.entity, this.hornText);
      }),
      bus.on(EV.Caught, (e) => {
        this.at(e.x, e.y);
        this.npcBubble(e.tick + 1, e.entity, BUBBLE_CAUGHT);
      }),
      bus.on(EV.CarHorn, (e) => {
        this.at(e.x, e.y);
        this.vehicleBubble(e.tick + 1, e.entity, BUBBLE_HONK);
      }),
    ];
    return () => {
      for (const off of offs) off();
      if (this.world === world) this.world = null;
    };
  }

  /** Forgets every popup and bubble (at the start of a shift). */
  reset(): void {
    this.popupStart.fill(-1);
    this.bubbles.clear();
  }

  /** Score popups alive at world tick `nowTick`. */
  popupCount(nowTick: number): number {
    let n = 0;
    for (let p = 0; p < POPUP_CAPACITY; p++) {
      const start = this.popupStart[p] ?? -1;
      if (start >= 0 && nowTick - start < WORLD_POPUP_LIFE_TICKS) n++;
    }
    return n;
  }

  /** The text of popup slot `p` ('+30', '-250'). Tests and the dev panel; allocates. */
  popupText(p: number): string {
    let text = '';
    const n = this.popupLength[p] ?? 0;
    for (let k = 0; k < n; k++) text += GLYPHS[this.popupGlyphs[p * POPUP_MAX_CHARS + k] ?? 0] ?? '';
    return text;
  }

  /**
   * Spawns a popup of `points` (> 0) at (xM, yM) from world tick `startTick`: '+points' in `multiplier`'s tier
   * colour, or '-points' in 18 for a penalty. Replaces the oldest when POPUP_CAPACITY are alive. Returns the slot.
   */
  spawnPoints(
    startTick: number,
    xM: number,
    yM: number,
    multiplier: number,
    points: number,
    penalty: boolean,
  ): number {
    this.at(xM, yM);
    return this.spawnAt(startTick, multiplier, points, penalty);
  }

  /** Stores an event's point in the spawn scratch (a typed array, so later calls take no doubles). */
  private at(xM: number, yM: number): void {
    this.spawnX[0] = xM;
    this.spawnY[0] = yM;
  }

  /** spawnPoints at the point in the spawn scratch. */
  private spawnAt(startTick: number, multiplier: number, points: number, penalty: boolean): number {
    const p = this.popupSlot(startTick);
    this.popupStart[p] = startTick;
    this.popupSerial[p] = this.nextSerial;
    this.nextSerial += 1;
    this.popupX[p] = this.spawnX[0] ?? 0;
    this.popupY[p] = this.spawnY[0] ?? 0;
    this.popupMultiplier[p] = multiplier;
    this.popupPenalty[p] = penalty ? 1 : 0;
    this.writeGlyphs(p, penalty ? GLYPH_MINUS : GLYPH_PLUS, points);
    return p;
  }

  /** The bubble for NPC event entity `i` at the scratch point: follows it (or its walker, for a dog) by handle. */
  private npcBubble(startTick: number, i: number, text: string): void {
    const npc = this.world?.npc ?? null;
    const xs = this.spawnX;
    const ys = this.spawnY;
    if (npc !== null && i >= 0 && i < npc.count && near(npc.x, npc.y, i, xs, ys)) {
      let handle = handleOf(npc, i);
      let kind = npc.kind[i] ?? 0;
      if ((npc.origin[i] ?? 0) === NpcOrigin.Companion) {
        const walker = resolveNpcHandle(npc, npc.link[i] ?? -1);
        if (walker >= 0) {
          handle = handleOf(npc, walker);
          kind = npc.kind[walker] ?? 0;
        }
      }
      const lift = kind === this.catKind ? BUBBLE_LIFT_ANIMAL_PX : BUBBLE_LIFT_PERSON_PX;
      this.bubbles.show(handle, text, startTick, BubbleAnchor.Npc, handle, xs, ys, 0, lift, this.font);
      return;
    }
    this.fixedBubble(startTick, text, BUBBLE_LIFT_PERSON_PX);
  }

  /** The bubble for vehicle event entity `i` at the scratch point: follows it by uid. */
  private vehicleBubble(startTick: number, i: number, text: string): void {
    const vehicles = this.world?.vehicles ?? null;
    const xs = this.spawnX;
    const ys = this.spawnY;
    if (vehicles !== null && i >= 0 && i < vehicles.count && near(vehicles.x, vehicles.y, i, xs, ys)) {
      const uid = vehicles.uid[i] ?? 0;
      const lift = BUBBLE_LIFT_VEHICLE_PX;
      this.bubbles.show(-1 - uid, text, startTick, BubbleAnchor.Vehicle, uid, xs, ys, 0, lift, this.font);
      return;
    }
    this.fixedBubble(startTick, text, BUBBLE_LIFT_VEHICLE_PX);
  }

  /** A bubble at the scratch point (its source could not be named), under a key nothing else uses. */
  private fixedBubble(startTick: number, text: string, liftPx: number): void {
    // Below every vehicle key (−1 − uid) and kept a small integer (no boxed number per bubble).
    this.fixedKeys = (this.fixedKeys + 1) & FIXED_KEY_MASK;
    const key = FIXED_KEY_BASE - this.fixedKeys;
    const xs = this.spawnX;
    const ys = this.spawnY;
    this.bubbles.show(key, text, startTick, BubbleAnchor.Fixed, -1, xs, ys, 0, liftPx, this.font);
  }

  // per-frame draw path: begin
  /**
   * Draws every live popup and bubble for `world` at internal width `widthPx`, projected with `camera` and with
   * their sources interpolated by `camera.alpha` (the frame's fraction between the last two ticks; a field, so no
   * double crosses the call). Ages come from world.tick. Allocates nothing.
   */
  draw(world: PopupWorld, widthPx: number, camera: Readonly<PopupCamera>): void {
    const now = world.tick;
    if (!(camera.pxPerM > 0)) return;
    this.drawPopups(now, widthPx, camera);
    this.drawBubbles(world, now, widthPx, camera);
  }

  private drawPopups(now: number, widthPx: number, camera: Readonly<HudCamera>): void {
    const font = this.font;
    const sink = this.sink;
    const frame = this.frame;
    const point = this.point;
    const outline = TextVariant.Outline;
    // Oldest first, so a newer popup draws over an older one it overlaps.
    let floor = 0;
    for (;;) {
      let p = -1;
      let best = Number.POSITIVE_INFINITY;
      for (let k = 0; k < POPUP_CAPACITY; k++) {
        const start = this.popupStart[k] ?? -1;
        if (start < 0) continue;
        if (now - start >= WORLD_POPUP_LIFE_TICKS) {
          this.popupStart[k] = -1;
          continue;
        }
        const serial = this.popupSerial[k] ?? 0;
        if (serial > floor && serial < best) {
          best = serial;
          p = k;
        }
      }
      if (p < 0) return;
      floor = best;
      const age = now - (this.popupStart[p] ?? now);
      popupFrameAt(age, this.popupMultiplier[p] ?? 1, (this.popupPenalty[p] ?? 0) === 1, now, frame);
      if (!frame.visible) continue;
      if (!project(this.popupX, this.popupY, p, widthPx, camera, point)) continue;
      const n = this.popupLength[p] ?? 0;
      const o = p * POPUP_MAX_CHARS;
      let w = 0;
      for (let k = 0; k < n; k++) w += this.glyphAdvance[this.popupGlyphs[o + k] ?? 0] ?? 0;
      // The outlined line is 9 px tall: its box is centred on the point, then rises.
      let pen = point.xPx - (w >> 1) + 1;
      const penY = point.yPx - 4 + frame.offsetYPx + 1;
      for (let k = 0; k < n; k++) {
        const g = this.popupGlyphs[o + k] ?? 0;
        font.draw(sink, GLYPHS[g] ?? '', pen, penY, frame.colour, outline);
        pen += this.glyphAdvance[g] ?? 0;
      }
    }
  }

  private drawBubbles(world: PopupWorld, now: number, widthPx: number, camera: Readonly<PopupCamera>): void {
    const bubbles = this.bubbles;
    bubbles.expire(now);
    const font = this.font;
    const point = this.point;
    const h = bubbleHeightFor(font.metrics.glyph.h);
    for (let rank = 0; rank < BUBBLE_MAX; rank++) {
      const s = bubbles.byAge(rank);
      if (s < 0) return;
      this.followSource(world, s, camera);
      if (!project(bubbles.xM, bubbles.yM, s, widthPx, camera, point)) continue;
      const text = bubbles.text[s] ?? '';
      const ink = font.measure(text, TextVariant.Plain) - 1;
      const w = bubbleWidthFor(ink < 0 ? 0 : ink);
      const tipX = point.xPx;
      const tipY = point.yPx - (bubbles.liftPx[s] ?? 0);
      let x = tipX - (w >> 1);
      let y = tipY - BUBBLE_TAIL_PX - (h - 1);
      // Keep the whole bubble inside the frame; the tail stays as close to its source as it can.
      if (x < 1) x = 1;
      if (x > widthPx - 1 - w) x = widthPx - 1 - w;
      if (y < 1) y = 1;
      if (y > HUD_HEIGHT_PX - 1 - h - BUBBLE_TAIL_PX) y = HUD_HEIGHT_PX - 1 - h - BUBBLE_TAIL_PX;
      this.panels.drawBubble(x, y, w, h, tipX);
      font.draw(this.sink, text, x + 1 + BUBBLE_PAD_X_PX, y + 1 + BUBBLE_PAD_Y_PX, BUBBLE_TEXT);
    }
  }

  /** Moves bubble `s` to its source's interpolated position, if the source is still there. */
  private followSource(world: PopupWorld, s: number, camera: Readonly<PopupCamera>): void {
    const bubbles = this.bubbles;
    const alpha = camera.alpha;
    const anchor = bubbles.anchor[s] ?? BubbleAnchor.Fixed;
    const ref = bubbles.ref[s] ?? -1;
    if (anchor === BubbleAnchor.Npc) {
      const npc = world.npc;
      const i = resolveNpcHandle(npc, ref);
      if (i < 0) return;
      const px = npc.prevX[i] ?? 0;
      const py = npc.prevY[i] ?? 0;
      bubbles.xM[s] = px + ((npc.x[i] ?? 0) - px) * alpha;
      bubbles.yM[s] = py + ((npc.y[i] ?? 0) - py) * alpha;
    } else if (anchor === BubbleAnchor.Vehicle) {
      const vehicles = world.vehicles;
      for (let i = 0; i < vehicles.count; i++) {
        if ((vehicles.uid[i] ?? -1) !== ref) continue;
        const px = vehicles.prevX[i] ?? 0;
        const py = vehicles.prevY[i] ?? 0;
        bubbles.xM[s] = px + ((vehicles.x[i] ?? 0) - px) * alpha;
        bubbles.yM[s] = py + ((vehicles.y[i] ?? 0) - py) * alpha;
        return;
      }
    }
  }

  /** A free popup slot at `now`, or the oldest live one. */
  private popupSlot(now: number): number {
    let oldest = 0;
    for (let p = 0; p < POPUP_CAPACITY; p++) {
      const start = this.popupStart[p] ?? -1;
      if (start < 0 || now - start >= WORLD_POPUP_LIFE_TICKS) return p;
      if ((this.popupSerial[p] ?? 0) < (this.popupSerial[oldest] ?? 0)) oldest = p;
    }
    return oldest;
  }

  /** Writes `sign` then the decimal digits of `points` (clamped to 7 digits) into popup `p`'s glyphs. */
  private writeGlyphs(p: number, sign: number, points: number): void {
    const glyphs = this.popupGlyphs;
    const o = p * POPUP_MAX_CHARS;
    let v = Math.floor(points);
    if (v > POPUP_MAX_VALUE) v = POPUP_MAX_VALUE;
    if (v < 0) v = 0;
    let digits = 1;
    for (let t = v; t >= 10; t = Math.floor(t / 10)) digits++;
    glyphs[o] = sign;
    for (let k = digits; k >= 1; k--) {
      glyphs[o + k] = v % 10;
      v = Math.floor(v / 10);
    }
    this.popupLength[p] = digits + 1;
  }
  // per-frame draw path: end
}

// per-frame draw path: begin
/** True when store point i is within SAME_SOURCE_M of the point (px[0], py[0]) on both axes. */
function near(
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  i: number,
  px: ArrayLike<number>,
  py: ArrayLike<number>,
): boolean {
  return (
    Math.abs((xs[i] ?? 0) - (px[0] ?? 0)) <= SAME_SOURCE_M &&
    Math.abs((ys[i] ?? 0) - (py[0] ?? 0)) <= SAME_SOURCE_M
  );
}

/** NPC i's generation-checked handle (npc/store.ts npcHandle, on the read-only view). */
function handleOf(npc: NpcStoreView, i: number): number {
  const slot = npc.handleSlot[i] ?? 0;
  return ((npc.slotGen[slot] ?? 0) << NPC_HANDLE_SLOT_BITS) | slot;
}

/**
 * The internal pixel of ground point (xs[i], ys[i]) (sim metres) under `camera` at width `widthPx` (see the header),
 * into `out`. False when it lies more than CULL_MARGIN_PX outside the frame (nothing there is drawn).
 */
export function project(
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  i: number,
  widthPx: number,
  camera: Readonly<HudCamera>,
  out: PixelPoint,
): boolean {
  const k = camera.pxPerM;
  const x = Math.floor(widthPx / 2 + ((xs[i] ?? 0) - camera.xM) * k);
  const y = Math.floor(HUD_HEIGHT_PX / 2 + ((ys[i] ?? 0) - camera.yM) * k);
  out.xPx = x;
  out.yPx = y;
  return (
    x >= -CULL_MARGIN_PX &&
    x < widthPx + CULL_MARGIN_PX &&
    y >= -CULL_MARGIN_PX &&
    y < HUD_HEIGHT_PX + CULL_MARGIN_PX
  );
}
// per-frame draw path: end
