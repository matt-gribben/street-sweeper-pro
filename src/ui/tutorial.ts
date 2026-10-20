// Pam's tutorial prompt layer (GDD §16.1, §16.2, §17.2; LEVEL_DESIGN §4.4; SSP-290). Monday's Puddle Lane is the
// tutorial: its level.json carries the 13 GDD §16.2 beats as `tutorial_beat` events ({ trigger, text }), and this
// layer fires each beat on its trigger as one of Pam's radio barks (src/ui/radio.ts, whose queue shows one bark at a
// time, so two beats never show together), drops a beat once the player has performed what it teaches, and records
// what the player has learned in the session's TutorialMemory, so a learned beat never fires again.
//
// Presentation only (CLAUDE.md hard rules 1, 2). The sim never reads `tutorial_beat` events: every trigger is
// evaluated here from bus events (src/app/events.ts) and from read-only World state, so the beats change no replay
// hash. Beat 12 needs the camera's view rect, which the sim does not have: ShiftScene works it out
// (pledgeFrontageInView) and hands it in with the rest of the tick's TutorialFrame.
//
// Triggers (the names are src/sim/map.ts TUTORIAL_TRIGGERS; LEVEL_DESIGN §4.4 is their written definition):
//   shift_start          the shift scene starts (start(), before the first tick);
//   moved_10m            Bessie's body centre has travelled ≥ TUTORIAL_MOVED_M (10 m) of path since the shift
//                        started (the sum of its per-tick displacements, reversing included, each rounded to
//                        1e-4 m so the threshold never depends on float rounding);
//   first_pickup         the first EV.LitterCollected;
//   first_fling          the first EV.Fling;
//   chain_10             the combo chain (ComboView.chain) reaches TUTORIAL_CHAIN (10, the ×2 tier);
//   first_kerb_contact   'kerb contact' is the first EV.KerbJolt (an axle crossing a raised kerb edge, SSP-035) or
//                        the first tick of dirt.kerbContact (a gutter brush hugging a raised kerb, the Kerb Hugger
//                        test), whichever comes first;
//   hopper_80            the hopper at or above its warning fill (hopper.warnFraction, 80%: isHopperWarning, the
//                        fill that also brings up the depot arrow, SSP-299);
//   in_depot_bay         Bessie's body centre inside a depot bay's rectangle (edges inclusive: the dump FSM's
//                        test, shift.ts) with litter in the hopper (LU > 0), at any speed;
//   cat_within_10m       an npc.cat's centre within TUTORIAL_CAT_M (10 m) of Bessie's body centre;
//   doris_encounter      'encounter' is npc.old_woman's centre within TUTORIAL_DORIS_M (10 m) of Bessie's body
//                        centre (any state: she glares from 4 m, so this comes first);
//   first_complaint      the first EV.Complaint;
//   pledge_on_screen     a pledge frontage's zone rect (Frontage.rect, in metres) overlaps the camera's ground rect;
//   timer_remaining<=60  the timer running with at most 60 s (3,600 ticks) left: the tick the countdown reaches
//                        60 s. There is no sim event for it; the layer reads ShiftView.ticksRemaining.
// Each trigger fires its beat at most once per shift, the first time it holds; no beat fires once the shift has
// reached its knock-off. Several beats that fire on one tick are enqueued in beat order and show one after another.
//
// Learned rule (GDD §16.1). Action beats are learned when the player performs the taught action: beat 1 (drive)
// once both the throttle and steering have been used this shift, beat 2 (brush) when the brush is lowered, beat 8
// (dump) when a dump starts (EV.DumpStart), beat 9 (horn) when the horn sounds (EV.Horn). Informational beats are
// learned when they start showing. Performing an action cancels its beat if it is still queued and dismisses it at
// once if it is showing; a beat whose lesson is learned does not fire (unless showTips, SSP-235's setting, is on).
//
// Beat 3 ("Keep it under 9 mph") highlights the Brush-o-meter's clean zone while it shows (Hud.highlightCleanZone,
// SSP-299), and the highlight ends the tick the beat stops showing, however it stops.
//
// Per tick nothing allocates: tick() and readTutorialFrame() read numbers into preallocated fields, and the bus
// handlers only look beats up in fixed tables. Enqueuing a bark (a handful per shift) allocates in radio.ts.
import type { EventBus, Unsubscribe } from '../app/events.ts';
import type { Aabb } from '../sim/collision/obb.ts';
import { SIM_HZ, TILE_M } from '../sim/constants.ts';
import { NPC_IDS } from '../sim/entities.ts';
import { EV } from '../sim/eventQueue.ts';
import { DumpSite, isHopperWarning } from '../sim/hopper.ts';
import { type Frontage, type Level, TUTORIAL_TRIGGERS, type TutorialTrigger } from '../sim/map.ts';
import { ShiftPhase } from '../sim/shift.ts';
import type { WorldView } from '../sim/world.ts';
import { parseBark } from './radio.ts';
import type { TutorialMemory } from './tutorialMemory.ts';

/** Path Bessie travels before beat 2 (GDD §16.2 "Moved 10 m"). */
export const TUTORIAL_MOVED_M = 10;
/** The combo chain of beat 5 (GDD §16.2 "Chain reaches 10"). */
export const TUTORIAL_CHAIN = 10;
/** How close a cat must be for beat 9 (GDD §16.2 "First cat within 10 m"). */
export const TUTORIAL_CAT_M = 10;
/** How close Doris must be for beat 10 (the 'encounter', decided in SSP-290: the cat's distance). */
export const TUTORIAL_DORIS_M = 10;
/** Timer ticks left at beat 13 (GDD §16.2 `timer_remaining<=60`). */
export const TUTORIAL_FINAL_TICKS = 60 * SIM_HZ;
/** The path is summed in whole 1e-4 m steps (TECHNICAL_DESIGN's quantum), so 9.9 m never rounds up to 10 m. */
const PATH_UNITS_PER_M = 10_000;
/** The clean-zone highlight's deadline while beat 3 shows: later than any shift's last tick. */
export const CLEAN_HIGHLIGHT_WHILE_SHOWING = 0x7fff_ffff;

/** How a beat's lesson is learned (see the header). */
export const LearnRule = { Shown: 0, Drive: 1, Brush: 2, Dump: 3, Horn: 4 } as const;
export type LearnRule = (typeof LearnRule)[keyof typeof LearnRule];

/** What each trigger's beat teaches: the lesson id the learned set stores, and how it is learned. */
export const TUTORIAL_LESSONS: {
  readonly [T in TutorialTrigger]: {
    readonly lesson: string;
    readonly learnedBy: LearnRule;
    /** Highlight the Brush-o-meter's clean zone while the beat shows (beat 3). */
    readonly highlightCleanZone?: true;
  };
} = {
  shift_start: { lesson: 'drive', learnedBy: LearnRule.Drive },
  moved_10m: { lesson: 'brush', learnedBy: LearnRule.Brush },
  first_pickup: { lesson: 'clean_speed', learnedBy: LearnRule.Shown, highlightCleanZone: true },
  first_fling: { lesson: 'fling', learnedBy: LearnRule.Shown },
  chain_10: { lesson: 'combo', learnedBy: LearnRule.Shown },
  first_kerb_contact: { lesson: 'kerb', learnedBy: LearnRule.Shown },
  hopper_80: { lesson: 'hopper', learnedBy: LearnRule.Shown },
  in_depot_bay: { lesson: 'dump', learnedBy: LearnRule.Dump },
  cat_within_10m: { lesson: 'horn', learnedBy: LearnRule.Horn },
  doris_encounter: { lesson: 'doris', learnedBy: LearnRule.Shown },
  first_complaint: { lesson: 'complaints', learnedBy: LearnRule.Shown },
  pledge_on_screen: { lesson: 'pledges', learnedBy: LearnRule.Shown },
  'timer_remaining<=60': { lesson: 'final_dump', learnedBy: LearnRule.Shown },
};

/** One beat of the level: its number (1-based, level.json order), trigger, bark text and lesson. */
export type TutorialBeat = {
  readonly n: number;
  readonly trigger: TutorialTrigger;
  /** The bark source text, with its radio tokens ({throttle}, {cleanSpeed}, ...). */
  readonly text: string;
  readonly lesson: string;
  readonly learnedBy: LearnRule;
};

function isTutorialTrigger(name: string): name is TutorialTrigger {
  return TUTORIAL_TRIGGERS.some((t) => t === name);
}

/**
 * The level's tutorial beats (its compiled `tutorial_beat` schedules, in order; none outside Puddle Lane). Throws,
 * naming the beat, for an unknown trigger, a trigger used twice, an empty text or a bad radio token (the compiler
 * checks the first three; a level that skipped it must not reach the radio). Setup only: allocates.
 */
export function tutorialBeats(level: Pick<Level, 'schedules'>): TutorialBeat[] {
  const beats: TutorialBeat[] = [];
  const seen = new Set<string>();
  for (const e of level.schedules) {
    if (e.type !== 'tutorial_beat') continue;
    const n = beats.length + 1;
    const trigger = e.trigger ?? '';
    if (!isTutorialTrigger(trigger)) {
      throw new Error(`tutorial beat ${n}: trigger ${JSON.stringify(trigger)} is not a tutorial trigger`);
    }
    if (seen.has(trigger)) throw new Error(`tutorial beat ${n}: trigger ${trigger} is used twice`);
    seen.add(trigger);
    const text = e.params.text;
    if (typeof text !== 'string' || text.trim() === '') throw new Error(`tutorial beat ${n}: empty text`);
    parseBark(text);
    const { lesson, learnedBy } = TUTORIAL_LESSONS[trigger];
    beats.push({ n, trigger, text, lesson, learnedBy });
  }
  return beats;
}

/** What the layer reads each tick (readTutorialFrame fills it from the World; unit tests fill it directly). */
export type TutorialFrame = {
  /** Bessie's body centre, sim metres. */
  xM: number;
  yM: number;
  /** This tick's input: throttle above 0, steering off centre. */
  throttle: boolean;
  steer: boolean;
  /** The brush is lowered (VehicleState.brushDown). */
  brushDown: boolean;
  /** The combo chain. */
  chain: number;
  /** The hopper is at or above its warning fill (isHopperWarning). */
  hopperWarning: boolean;
  /** Bessie's body centre is in a depot bay with litter in the hopper. */
  inDepotBay: boolean;
  /** A cat / Doris is within its trigger distance. */
  catNear: boolean;
  dorisNear: boolean;
  /** A gutter brush hugs a raised kerb (dirt.kerbContact). */
  kerbContact: boolean;
  /** The timer is counting down, and the ticks it has left. */
  timerRunning: boolean;
  ticksRemaining: number;
  /** The shift has reached its knock-off (or ended): no new beats. */
  over: boolean;
  /** A pledge frontage is on screen (ShiftScene: pledgeFrontageInView). */
  pledgeOnScreen: boolean;
};

/** A frame with nothing happening. Setup only. */
export function createTutorialFrame(): TutorialFrame {
  return {
    xM: 0,
    yM: 0,
    throttle: false,
    steer: false,
    brushDown: false,
    chain: 0,
    hopperWarning: false,
    inDepotBay: false,
    catNear: false,
    dorisNear: false,
    kerbContact: false,
    timerRunning: false,
    ticksRemaining: 0,
    over: false,
    pledgeOnScreen: false,
  };
}

/** Trigger indices (TUTORIAL_TRIGGERS order), so the per-tick path compares numbers, never searches strings. */
const T = {
  shiftStart: TUTORIAL_TRIGGERS.indexOf('shift_start'),
  moved: TUTORIAL_TRIGGERS.indexOf('moved_10m'),
  pickup: TUTORIAL_TRIGGERS.indexOf('first_pickup'),
  fling: TUTORIAL_TRIGGERS.indexOf('first_fling'),
  chain: TUTORIAL_TRIGGERS.indexOf('chain_10'),
  kerb: TUTORIAL_TRIGGERS.indexOf('first_kerb_contact'),
  hopper: TUTORIAL_TRIGGERS.indexOf('hopper_80'),
  bay: TUTORIAL_TRIGGERS.indexOf('in_depot_bay'),
  cat: TUTORIAL_TRIGGERS.indexOf('cat_within_10m'),
  doris: TUTORIAL_TRIGGERS.indexOf('doris_encounter'),
  complaint: TUTORIAL_TRIGGERS.indexOf('first_complaint'),
  pledge: TUTORIAL_TRIGGERS.indexOf('pledge_on_screen'),
  timer: TUTORIAL_TRIGGERS.indexOf('timer_remaining<=60'),
} as const;

const CAT_KIND = NPC_IDS.indexOf('npc.cat');
const DORIS_KIND = NPC_IDS.indexOf('npc.old_woman');

// per-tick path: begin
/**
 * True when any pledge frontage's zone rect (tiles × TILE_M, x1/y1 exclusive) overlaps `view`, the camera's ground
 * rect in sim metres (render/camera.ts cameraGroundRect). Allocation-free.
 */
export function pledgeFrontageInView(frontages: readonly Frontage[], view: Readonly<Aabb>): boolean {
  for (let i = 0; i < frontages.length; i++) {
    const f = frontages[i];
    if (f === undefined || !f.pledge) continue;
    const r = f.rect;
    if (
      r[0] * TILE_M < view.maxX &&
      r[2] * TILE_M > view.minX &&
      r[1] * TILE_M < view.maxY &&
      r[3] * TILE_M > view.minY
    )
      return true;
  }
  return false;
}

/** Fills `out` from the World after a tick (read-only), with the scene's pledge-on-screen answer. Allocation-free. */
export function readTutorialFrame(
  view: WorldView,
  pledgeOnScreen: boolean,
  out: TutorialFrame,
): TutorialFrame {
  const v = view.vehicle;
  const x = v.xM;
  const y = v.yM;
  out.xM = x;
  out.yM = y;
  out.throttle = view.input.throttle > 0;
  out.steer = view.input.steer !== 0;
  out.brushDown = v.brushDown;
  out.chain = view.scoring.combo.chain;
  out.hopperWarning = isHopperWarning(view.hopper);
  const shift = view.shift;
  let inBay = false;
  if (v.hopperLU > 0) {
    for (let s = 0; s < shift.siteCount; s++) {
      if (shift.siteKind[s] !== DumpSite.Depot) continue;
      if (
        x >= (shift.siteMinX[s] as number) &&
        x <= (shift.siteMaxX[s] as number) &&
        y >= (shift.siteMinY[s] as number) &&
        y <= (shift.siteMaxY[s] as number)
      ) {
        inBay = true;
        break;
      }
    }
  }
  out.inDepotBay = inBay;
  let cat = false;
  let doris = false;
  const npc = view.npc;
  const catR2 = TUTORIAL_CAT_M * TUTORIAL_CAT_M;
  const dorisR2 = TUTORIAL_DORIS_M * TUTORIAL_DORIS_M;
  for (let i = 0; i < npc.count; i++) {
    const kind = npc.kind[i];
    if (kind !== CAT_KIND && kind !== DORIS_KIND) continue;
    const dx = (npc.x[i] as number) - x;
    const dy = (npc.y[i] as number) - y;
    const d2 = dx * dx + dy * dy;
    if (kind === CAT_KIND && d2 <= catR2) cat = true;
    if (kind === DORIS_KIND && d2 <= dorisR2) doris = true;
  }
  out.catNear = cat;
  out.dorisNear = doris;
  out.kerbContact = view.dirt.kerbContact;
  out.timerRunning = shift.phase === ShiftPhase.Running;
  out.ticksRemaining = shift.ticksRemaining;
  out.over = shift.phase === ShiftPhase.KnockOff || shift.phase === ShiftPhase.Ended;
  out.pledgeOnScreen = pledgeOnScreen;
  return out;
}
// per-tick path: end

/** The radio as the layer uses it (src/ui/radio.ts Radio). */
export type TutorialRadio = {
  enqueue(text: string): number;
  cancel(id: number): boolean;
  readonly currentId: number;
  readonly queuedIds: readonly number[];
};

/** The HUD as the layer uses it (src/ui/hud.ts Hud): its radio and the Brush-o-meter highlight hook. */
export type TutorialHud = {
  readonly radio: TutorialRadio;
  highlightCleanZone(untilTick: number): void;
};

export type TutorialOptions = {
  /** SSP-235's 'Show tips': learned beats fire again (each still once per shift). Default false. */
  readonly showTips?: boolean;
};

/** What the test hook lists (`__ssp.tutorial()`): JSON-safe. */
export type TutorialState = {
  /** The beat showing on the radio, or null. */
  readonly current: { readonly n: number; readonly trigger: TutorialTrigger; readonly text: string } | null;
  /** Beats waiting on the radio, in order. */
  readonly queued: readonly number[];
  /** Beats fired (enqueued) this shift, in firing order. */
  readonly fired: readonly number[];
  /** The session's learned lesson ids, in learning order. */
  readonly learned: readonly string[];
  /** Path Bessie has travelled this shift, metres. */
  readonly distanceM: number;
};

/** Where a beat is this shift. */
const BeatStatus = { Pending: 0, Skipped: 1, Fired: 2 } as const;

/** One shift's tutorial: built by ShiftScene for its level, fed one TutorialFrame per World tick. */
export class TutorialLayer {
  readonly beats: readonly TutorialBeat[];
  private readonly hud: TutorialHud;
  private readonly memory: TutorialMemory;
  private readonly showTips: boolean;
  /** Beat index by trigger index (TUTORIAL_TRIGGERS order), −1 when the level has no such beat. */
  private readonly beatOfTrigger: Int8Array;
  private readonly status: Uint8Array;
  /** The radio bark id of each fired beat (0 until fired). */
  private readonly barkIds: Int32Array;
  private readonly firedOrder: number[] = [];
  private started = false;
  private over = false;
  /**
   * Bessie's last position (x, y, metres) and the path travelled this shift (in 1e-4 m steps), in a typed array so
   * the per-tick doubles are never boxed into object fields.
   */
  private readonly path = new Float64Array(3);
  private usedThrottle = false;
  private usedSteer = false;
  /** LearnRule bits already performed this shift. */
  private performed = 0;
  /** The radio bark showing at the last sync, and its beat index (−1: not a beat). */
  private showingId = 0;
  private showingBeat = -1;
  private highlighting = false;

  constructor(
    beats: readonly TutorialBeat[],
    hud: TutorialHud,
    memory: TutorialMemory,
    options: TutorialOptions = {},
  ) {
    this.beats = beats;
    this.hud = hud;
    this.memory = memory;
    this.showTips = options.showTips === true;
    this.beatOfTrigger = new Int8Array(TUTORIAL_TRIGGERS.length).fill(-1);
    beats.forEach((b, k) => {
      this.beatOfTrigger[TUTORIAL_TRIGGERS.indexOf(b.trigger)] = k;
    });
    this.status = new Uint8Array(beats.length);
    this.barkIds = new Int32Array(beats.length);
  }

  /** Path Bessie has travelled this shift (moved_10m), metres. */
  get distanceM(): number {
    return (this.path[2] as number) / PATH_UNITS_PER_M;
  }

  /** The beat showing on the radio (1-based), or 0. */
  get currentBeat(): number {
    return this.showingBeat < 0 ? 0 : this.showingBeat + 1;
  }

  /** Beats fired (enqueued) this shift, 1-based, in firing order. */
  get fired(): readonly number[] {
    return this.firedOrder;
  }

  /** The shift starts: Bessie's start pose from `frame`, and beat 1's trigger (shift_start). Call once. */
  start(frame: Readonly<TutorialFrame>): void {
    if (this.started) return;
    this.started = true;
    this.path[0] = frame.xM;
    this.path[1] = frame.yM;
    this.fireAt(T.shiftStart);
  }

  /** Subscribes to the bus events the triggers and learned rule read; call the returned function at scene exit. */
  attach(bus: EventBus): Unsubscribe {
    const offs = [
      bus.on(EV.LitterCollected, () => this.fireAt(T.pickup)),
      bus.on(EV.Fling, () => this.fireAt(T.fling)),
      bus.on(EV.KerbJolt, () => this.fireAt(T.kerb)),
      bus.on(EV.Complaint, () => this.fireAt(T.complaint)),
      bus.on(EV.DumpStart, () => this.perform(LearnRule.Dump)),
      bus.on(EV.Horn, () => this.perform(LearnRule.Horn)),
    ];
    return () => {
      for (const off of offs) off();
    };
  }

  // per-tick path: begin
  /**
   * One World tick has run (after the HUD's tick has aged the radio): the learned rule's actions, then every
   * state trigger in beat order, then the showing beat's bookkeeping. Allocates nothing unless a beat fires.
   */
  tick(frame: Readonly<TutorialFrame>): void {
    if (!this.started) this.start(frame);
    const path = this.path;
    const dx = frame.xM - (path[0] as number);
    const dy = frame.yM - (path[1] as number);
    // Rounded half up to whole steps (a tick moves far less than 2^31 steps, so `| 0` is exact).
    path[2] = (path[2] as number) + ((Math.sqrt(dx * dx + dy * dy) * PATH_UNITS_PER_M + 0.5) | 0);
    path[0] = frame.xM;
    path[1] = frame.yM;
    if (frame.over) this.over = true;
    if (frame.throttle) this.usedThrottle = true;
    if (frame.steer) this.usedSteer = true;
    if (this.usedThrottle && this.usedSteer) this.perform(LearnRule.Drive);
    if (frame.brushDown) this.perform(LearnRule.Brush);
    if ((path[2] as number) >= TUTORIAL_MOVED_M * PATH_UNITS_PER_M) this.fireAt(T.moved);
    if (frame.chain >= TUTORIAL_CHAIN) this.fireAt(T.chain);
    if (frame.kerbContact) this.fireAt(T.kerb);
    if (frame.hopperWarning) this.fireAt(T.hopper);
    if (frame.inDepotBay) this.fireAt(T.bay);
    if (frame.catNear) this.fireAt(T.cat);
    if (frame.dorisNear) this.fireAt(T.doris);
    if (frame.pledgeOnScreen) this.fireAt(T.pledge);
    if (frame.timerRunning && frame.ticksRemaining <= TUTORIAL_FINAL_TICKS) this.fireAt(T.timer);
    this.sync();
  }

  /**
   * Fires the beat of trigger `t` (a TUTORIAL_TRIGGERS index), if the level has one, it has not fired this shift
   * and the shift has not reached its knock-off: enqueued on the radio, or skipped for the shift when its lesson is
   * learned (and showTips is off).
   */
  private fireAt(t: number): void {
    const k = this.beatOfTrigger[t] ?? -1;
    if (k < 0 || this.status[k] !== BeatStatus.Pending || this.over) return;
    const beat = this.beats[k];
    if (beat === undefined) return;
    if (!this.showTips && this.memory.has(beat.lesson)) {
      this.status[k] = BeatStatus.Skipped;
      return;
    }
    this.status[k] = BeatStatus.Fired;
    this.barkIds[k] = this.hud.radio.enqueue(beat.text);
    this.firedOrder.push(beat.n);
    this.sync();
  }

  /**
   * The player performed `rule`'s action (once per shift per rule): every beat it teaches is learned, and dropped
   * from the radio if it is waiting there (cancelled) or showing (dismissed).
   */
  perform(rule: LearnRule): void {
    if (rule === LearnRule.Shown) return;
    const bit = 1 << rule;
    if ((this.performed & bit) !== 0) return;
    this.performed |= bit;
    for (let k = 0; k < this.beats.length; k++) {
      const beat = this.beats[k];
      if (beat === undefined || beat.learnedBy !== rule) continue;
      this.memory.learn(beat.lesson);
      const id = this.barkIds[k] ?? 0;
      if (id !== 0) this.hud.radio.cancel(id);
    }
    this.sync();
  }
  // per-tick path: end

  /** What the test hook lists. Allocates (test mode only). */
  state(): TutorialState {
    const k = this.showingBeat;
    const beat = k < 0 ? undefined : this.beats[k];
    const queued: number[] = [];
    for (const id of this.hud.radio.queuedIds) {
      const q = this.barkIds.indexOf(id);
      if (q >= 0 && id !== 0) queued.push(q + 1);
    }
    return {
      current: beat === undefined ? null : { n: beat.n, trigger: beat.trigger, text: beat.text },
      queued,
      fired: [...this.firedOrder],
      learned: this.memory.learned(),
      distanceM: this.distanceM,
    };
  }

  /** Ends the shift's highlight, if any (scene exit). */
  dispose(): void {
    if (this.highlighting) this.hud.highlightCleanZone(-1);
    this.highlighting = false;
  }

  /**
   * Follows the radio: when the bark showing changes, the beat that stopped showing drops its highlight, and a beat
   * that starts showing is learned (informational beats) and raises its highlight (beat 3).
   */
  private sync(): void {
    const id = this.hud.radio.currentId;
    if (id === this.showingId) return;
    this.showingId = id;
    if (this.highlighting) {
      this.hud.highlightCleanZone(-1);
      this.highlighting = false;
    }
    let k = -1;
    if (id !== 0) {
      for (let i = 0; i < this.barkIds.length; i++) {
        if (this.barkIds[i] === id) {
          k = i;
          break;
        }
      }
    }
    this.showingBeat = k;
    const beat = k < 0 ? undefined : this.beats[k];
    if (beat === undefined) return;
    if (beat.learnedBy === LearnRule.Shown) this.memory.learn(beat.lesson);
    if (TUTORIAL_LESSONS[beat.trigger].highlightCleanZone === true) {
      this.hud.highlightCleanZone(CLEAN_HIGHLIGHT_WHILE_SHOWING);
      this.highlighting = true;
    }
  }
}
