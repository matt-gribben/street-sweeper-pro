// The typed event bus (TECHNICAL_DESIGN §7.2, SSP-043). The sim never calls out: each tick it appends facts
// to its EventQueue and seals it in phase 11. After every tick the loop (loop.ts) has the bus drain that
// sealed queue: each event is decoded into a strongly typed object and dispatched to the subscribers of its
// type, then to the `onAny` subscribers, in emission order, exactly once.
//
// The bus is for presentation only: audio cues (audio/sfx.ts, M5), UI popups (ui/popups.ts, M2), render fx
// (render/fx.ts, M3) and gamepad rumble (input/gamepad.ts, SSP-044). Scoring never uses it: it reads the same
// facts inside the sim in phase 9. Subscribers get decoded copies and never the queue, so they cannot write
// sim state (CLAUDE.md hard rule 2).
//
// Allocation: drain() creates no objects once optimised. Each event type has one preallocated payload object that is
// rewritten for every event of that type, so a subscriber must copy what it needs and never keep the object.
// subscribe() and unsubscribing copy the listener list (copy-on-write), so a listener may unsubscribe itself,
// or subscribe another, during dispatch: the change takes effect from the next event.
//
// UI events (SSP-286): menus (src/ui/menus.ts) report UiMove, UiSelect and UiBack through emitUi() as they act on
// the player's input, and the audio director maps them to sfx.ui_move / ui_select / ui_back (M5; nothing listens
// yet). They are not sim events: they never enter an EventQueue, a replay or a hash, and they are dispatched at once
// to the onUi() subscribers of their type (onAny() is for sim events only). Same rules otherwise: one preallocated
// payload per type, copy-on-write listener lists.
//
// Pause events (SSP-287): the PauseOverlay emits PauseOpened when it joins the scene stack and PauseClosed when it
// leaves (Resume, Restart Shift or Retire), through emitPauseOpened() / emitPauseClosed(), dispatched at once to
// the onPause() subscribers of their type. The M5 audio director hooks them (AUDIO_DESIGN §4.5: music ducked −9 dB
// under a 900 Hz low-pass, sfx/voice/live/amb suspended while paused; SSP-173, SSP-178, SSP-183). Like UI events
// they are not sim events: never in an EventQueue, a replay or a hash.

import { Offence } from '../sim/complaints.ts';
import {
  KNOCKABLE_IDS,
  type KnockableId,
  LITTER_IDS,
  type LitterId,
  NPC_IDS,
  type NpcId,
  STAIN_IDS,
  type StainId,
} from '../sim/entities.ts';
import {
  EV,
  type EventType,
  type ReadonlyEventQueue,
  ShiftEndReason,
  type ShiftEndReason as ShiftEndReasonValue,
} from '../sim/eventQueue.ts';
import { DumpSite } from '../sim/hopper.ts';

/** Fields every bus event carries. */
type SimEventBase = {
  /** The sim tick that emitted the event (EventQueue.tick). */
  readonly tick: number;
  /** Store index of the entity, or −1 for Bessie and for events with no entity. */
  readonly entity: number;
};

/** Bessie hit something solid (phase 3, SSP-036). */
export type ImpactEvent = SimEventBase & {
  readonly type: typeof EV.Impact;
  /** Contact point, sim metres. */
  readonly x: number;
  readonly y: number;
  /** Normal impact speed vn, m/s: drives the sound, the shake and the gamepad rumble. */
  readonly speedMps: number;
};

/** An axle crossed a kerb edge (phase 2, §8.2 step 9). */
export type KerbJoltEvent = SimEventBase & {
  readonly type: typeof EV.KerbJolt;
  /** Where the axle midpoint crossed the kerb edge, sim metres. */
  readonly x: number;
  readonly y: number;
  /** |vLong| just before the crossing, m/s. */
  readonly speedMps: number;
};

/** Bessie engaged reverse (phase 2): once per engagement. */
export type ReverseBeeperEvent = SimEventBase & {
  readonly type: typeof EV.ReverseBeeper;
  /** Bessie's body centre, sim metres. */
  readonly x: number;
  readonly y: number;
};

/** The shift ended (phase 10, shift.ts, SSP-062, SSP-079): TIME_UP, SACKED or TOWED, once per shift. */
export type ShiftEndEvent = SimEventBase & {
  readonly type: typeof EV.ShiftEnd;
  readonly reason: ShiftEndReasonValue;
};

/** The hopper just became full (phase 5 collection, SSP-058): once per fill. */
export type HopperFullEvent = SimEventBase & {
  readonly type: typeof EV.HopperFull;
  /** Bessie's body centre, sim metres. */
  readonly x: number;
  readonly y: number;
  /** The capacity it filled to, LU. */
  readonly capacityLU: number;
};

/** The brush inlet collected a litter item (phase 5, SSP-059). `entity` is its index before removal. */
export type LitterCollectedEvent = SimEventBase & {
  readonly type: typeof EV.LitterCollected;
  /** Where the item was collected, sim metres. */
  readonly x: number;
  readonly y: number;
  /** The item's litter id. */
  readonly kind: LitterId;
};

/** The brush's fling roll knocked a litter item sideways (phase 5, SSP-059). */
export type FlingEvent = SimEventBase & {
  readonly type: typeof EV.Fling;
  /** Where the fling arc starts, sim metres. */
  readonly x: number;
  readonly y: number;
  /** The item's litter id. */
  readonly kind: LitterId;
};

/**
 * Bessie's spray cleaned a stain (phase 6, SSP-061). `entity` is the stain's kind index (STAIN_IDS), decoded
 * into `kind`: the stain was removed as the event was emitted, so it has no store index.
 */
export type StainCleanedEvent = SimEventBase & {
  readonly type: typeof EV.StainCleaned;
  /** Where the stain was, sim metres. */
  readonly x: number;
  readonly y: number;
  /** The stain's id. */
  readonly kind: StainId;
  /** Its points before the combo multiplier (entities.json `pts`; a splat is 0). */
  readonly pts: number;
};

/**
 * A dump drain started (phase 10, SSP-062): the 1.0 s hold completed at a depot bay or skip. `entity` is the
 * site's index in level.sites.
 */
export type DumpStartEvent = SimEventBase & {
  readonly type: typeof EV.DumpStart;
  /** Depot bay or skip. */
  readonly site: DumpSite;
  /** LU in the hopper as the drain starts. */
  readonly lu: number;
  /** The drain's length, ticks (120 at a depot bay, 180 at a skip). */
  readonly drainTicks: number;
};

/** A dump drain ended (phase 10, SSP-062), completed or cut short. `entity` is the site's level.sites index. */
export type DumpEndEvent = SimEventBase & {
  readonly type: typeof EV.DumpEnd;
  readonly site: DumpSite;
  /** LU this drain removed from the hopper. */
  readonly luDumped: number;
  /** False when Bessie left the site, the timer ran out or she was TOWED before the drain finished. */
  readonly completed: boolean;
};

/**
 * Bessie jolted over a pothole, or over a speed bump above its speed limit (phase 2, SSP-093). `entity` is the
 * hazard's store index. Sound: bump_kerb.
 */
export type HazardJoltEvent = SimEventBase & {
  readonly type: typeof EV.HazardJolt;
  /** Bessie's body centre, sim metres. */
  readonly x: number;
  readonly y: number;
  /** LU the jolt spilled out of the hopper behind her (0 when it was empty). */
  readonly spilledLU: number;
};

/** Bessie drove into an open manhole and stopped dead (phase 2, SSP-093). Sound: crash. */
export type HazardStopEvent = SimEventBase & {
  readonly type: typeof EV.HazardStop;
  /** Bessie's body centre, sim metres. */
  readonly x: number;
  readonly y: number;
  /** |vLong| just before the stop, m/s. */
  readonly speedMps: number;
};

/**
 * The combo multiplier changed (phase 9, combo.ts, SSP-063). A rise (`multiplier` > `previousMultiplier`) is a
 * tier reached: the HUD popup ("TIDY!" ...) and sfx.combo_tier play only then. A drop is the chain expiring or
 * a penalty resetting it.
 */
export type ComboTierEvent = SimEventBase & {
  readonly type: typeof EV.ComboTier;
  /** The new multiplier (1..5). */
  readonly multiplier: number;
  /** The multiplier before the change. */
  readonly previousMultiplier: number;
  /** The chain length after the change (0 after an expiry or a penalty). */
  readonly chain: number;
};

/**
 * A Council Complaint landed on the meter (phase 9, complaints.ts, SSP-078): one event per complaint. The HUD
 * stamps the next box; sfx.complaint_stamp (M5).
 */
export type ComplaintEvent = SimEventBase & {
  readonly type: typeof EV.Complaint;
  /** Where the offence happened, sim metres. */
  readonly x: number;
  readonly y: number;
  /** Why (complaints.ts Offence: Hit, Noise, RoadRage, ...). */
  readonly reason: Offence;
};

/** Bessie sounded her horn (phase 1, complaints.ts, SSP-078): the tick of the HORN pressed edge. */
export type HornEvent = SimEventBase & {
  readonly type: typeof EV.Horn;
  /** Bessie's body centre as the tick started, sim metres. */
  readonly x: number;
  readonly y: number;
  /** The horn's stimulus radius, m (8, or 12 with the two-tone horn). */
  readonly radiusM: number;
};

/**
 * Bessie knocked a wheelie bin, cone, A-board, trolley or recycling box (phase 4, bodies.ts, SSP-092): once per
 * contact episode. `entity` is the body's BodyStore index. Sound: the kind's entities.json `sfx.knock`
 * (bin_knock or cone_knock, M5).
 */
export type KnockEvent = SimEventBase & {
  readonly type: typeof EV.Knock;
  /** The contact point, sim metres. */
  readonly x: number;
  readonly y: number;
  /** What was knocked. */
  readonly kind: KnockableId;
};

/**
 * Bessie knocked a pedestrian or animal over (phase 7, npc/reactions.ts, SSP-082): once per hit contact episode.
 * The hit SFX (entities.json sfx.hit, M5), the impact star (SSP-155) and the juice (SSP-241) read it.
 */
export type NpcHitEvent = SimEventBase & {
  readonly type: typeof EV.NpcHit;
  /** The NPC's centre, sim metres. */
  readonly x: number;
  readonly y: number;
  /** Its kind (a companion dog carries its walker's). */
  readonly kind: NpcId;
};

/**
 * A traffic vehicle honked at Bessie for blocking it (phase 8, traffic.ts, SSP-089): the head of the queue, at
 * 3, 6 and 9 s of the block. Audio plays the rising `horn:car` (AUDIO_DESIGN §5.5). Never Bessie's horn.
 */
export type CarHornEvent = SimEventBase & {
  readonly type: typeof EV.CarHorn;
  /** The vehicle's body centre, sim metres. */
  readonly x: number;
  readonly y: number;
  /** Which honk of this block (1, 2 or 3): each one higher. */
  readonly honk: number;
};

/**
 * Bessie drove through a dog walker's lead (phase 7, npc/behaviours/dogWalker.ts, SSP-086): once per crossing
 * episode that costs the Lead Tangle. `entity` is the walker's store index. Audio plays dog_bark, then ped_oi
 * 120 ms after (M5); the −150 popup reads it.
 */
export type LeadTangleEvent = SimEventBase & {
  readonly type: typeof EV.LeadTangle;
  /** Where Bessie's body crosses the lead (the middle of the overlapping stretch), sim metres. */
  readonly x: number;
  readonly y: number;
  /** The dog's store index. */
  readonly dog: number;
};

/** Every bus event, keyed by its EV id. Adding an EV type is a compile error here until it is decoded. */
export type SimEventByType = {
  [EV.Impact]: ImpactEvent;
  [EV.KerbJolt]: KerbJoltEvent;
  [EV.ReverseBeeper]: ReverseBeeperEvent;
  [EV.ShiftEnd]: ShiftEndEvent;
  [EV.HopperFull]: HopperFullEvent;
  [EV.LitterCollected]: LitterCollectedEvent;
  [EV.Fling]: FlingEvent;
  [EV.StainCleaned]: StainCleanedEvent;
  [EV.DumpStart]: DumpStartEvent;
  [EV.DumpEnd]: DumpEndEvent;
  [EV.HazardJolt]: HazardJoltEvent;
  [EV.HazardStop]: HazardStopEvent;
  [EV.ComboTier]: ComboTierEvent;
  [EV.Complaint]: ComplaintEvent;
  [EV.Horn]: HornEvent;
  [EV.Knock]: KnockEvent;
  [EV.NpcHit]: NpcHitEvent;
  [EV.CarHorn]: CarHornEvent;
  [EV.LeadTangle]: LeadTangleEvent;
};

/** Any bus event: a union discriminated by `type`. */
export type SimEvent = SimEventByType[EventType];

/** A subscriber to one event type. The event object is reused: copy what you need, never keep it. */
export type SimEventListener<T extends EventType> = (event: SimEventByType[T]) => void;

/** A subscriber to every event. The event object is reused: copy what you need, never keep it. */
export type AnySimEventListener = (event: SimEvent) => void;

/** Removes the subscription it was returned for. Calling it again does nothing. */
export type Unsubscribe = () => void;

/** The mutable twin of a payload type, for the bus's own preallocated objects. */
type Writable<T> = { -readonly [K in keyof T]: T[K] };

/** The preallocated payloads, one per type (the bus rewrites them for every event). */
type Payloads = { [T in EventType]: Writable<SimEventByType[T]> };

const SHIFT_END_REASONS: ReadonlySet<number> = new Set(Object.values(ShiftEndReason));
const OFFENCES: ReadonlySet<number> = new Set(Object.values(Offence));

function createPayloads(): Payloads {
  return {
    [EV.Impact]: { type: EV.Impact, tick: 0, entity: -1, x: 0, y: 0, speedMps: 0 },
    [EV.KerbJolt]: { type: EV.KerbJolt, tick: 0, entity: -1, x: 0, y: 0, speedMps: 0 },
    [EV.ReverseBeeper]: { type: EV.ReverseBeeper, tick: 0, entity: -1, x: 0, y: 0 },
    [EV.ShiftEnd]: { type: EV.ShiftEnd, tick: 0, entity: -1, reason: ShiftEndReason.Towed },
    [EV.HopperFull]: { type: EV.HopperFull, tick: 0, entity: -1, x: 0, y: 0, capacityLU: 0 },
    [EV.LitterCollected]: {
      type: EV.LitterCollected,
      tick: 0,
      entity: -1,
      x: 0,
      y: 0,
      kind: 'litter.crisp_packet',
    },
    [EV.Fling]: { type: EV.Fling, tick: 0, entity: -1, x: 0, y: 0, kind: 'litter.crisp_packet' },
    [EV.StainCleaned]: {
      type: EV.StainCleaned,
      tick: 0,
      entity: -1,
      x: 0,
      y: 0,
      kind: 'stain.gum',
      pts: 0,
    },
    [EV.DumpStart]: {
      type: EV.DumpStart,
      tick: 0,
      entity: -1,
      site: DumpSite.Depot,
      lu: 0,
      drainTicks: 0,
    },
    [EV.DumpEnd]: {
      type: EV.DumpEnd,
      tick: 0,
      entity: -1,
      site: DumpSite.Depot,
      luDumped: 0,
      completed: false,
    },
    [EV.HazardJolt]: { type: EV.HazardJolt, tick: 0, entity: -1, x: 0, y: 0, spilledLU: 0 },
    [EV.HazardStop]: { type: EV.HazardStop, tick: 0, entity: -1, x: 0, y: 0, speedMps: 0 },
    [EV.ComboTier]: {
      type: EV.ComboTier,
      tick: 0,
      entity: -1,
      multiplier: 1,
      previousMultiplier: 1,
      chain: 0,
    },
    [EV.Complaint]: { type: EV.Complaint, tick: 0, entity: -1, x: 0, y: 0, reason: Offence.Hit },
    [EV.Horn]: { type: EV.Horn, tick: 0, entity: -1, x: 0, y: 0, radiusM: 0 },
    [EV.Knock]: { type: EV.Knock, tick: 0, entity: -1, x: 0, y: 0, kind: 'prop.wheelie_bin' },
    [EV.NpcHit]: { type: EV.NpcHit, tick: 0, entity: -1, x: 0, y: 0, kind: 'npc.shopper' },
    [EV.CarHorn]: { type: EV.CarHorn, tick: 0, entity: -1, x: 0, y: 0, honk: 1 },
    [EV.LeadTangle]: { type: EV.LeadTangle, tick: 0, entity: -1, x: 0, y: 0, dog: -1 },
  };
}

/** The dump site carried in a DumpStart/DumpEnd event's `a` (DumpSite); throws on anything else. */
function dumpSiteOf(a: number, type: EventType, tick: number): DumpSite {
  if (a === DumpSite.Depot || a === DumpSite.Skip) return a;
  throw new Error(`EventBus: event type ${type} at tick ${tick} carries unknown dump site ${a}`);
}

/** The litter id carried in an event's `c` (a LITTER_IDS index); throws on anything else. */
function litterKindOf(c: number, type: EventType, tick: number): LitterId {
  const id = Number.isInteger(c) ? LITTER_IDS[c] : undefined;
  if (id === undefined)
    throw new Error(`EventBus: event type ${type} at tick ${tick} carries unknown litter kind ${c}`);
  return id;
}

/** The knockable id carried in a Knock event's `c` (a KNOCKABLE_IDS index); throws on anything else. */
function knockableKindOf(c: number, tick: number): KnockableId {
  const id = Number.isInteger(c) ? KNOCKABLE_IDS[c] : undefined;
  if (id === undefined)
    throw new Error(`EventBus: event type ${EV.Knock} at tick ${tick} carries unknown knockable kind ${c}`);
  return id;
}

/** The NPC id carried in an NpcHit event's `c` (an NPC_IDS index); throws on anything else. */
function npcKindOf(c: number, tick: number): NpcId {
  const id = Number.isInteger(c) ? NPC_IDS[c] : undefined;
  if (id === undefined)
    throw new Error(`EventBus: event type ${EV.NpcHit} at tick ${tick} carries unknown NPC kind ${c}`);
  return id;
}

/** The stain id carried in a StainCleaned event's `entity` (a STAIN_IDS index); throws on anything else. */
function stainKindOf(entity: number, tick: number): StainId {
  const id = Number.isInteger(entity) ? STAIN_IDS[entity] : undefined;
  if (id === undefined)
    throw new Error(
      `EventBus: event type ${EV.StainCleaned} at tick ${tick} carries unknown stain kind ${entity}`,
    );
  return id;
}

function isEventType(type: number): type is EventType {
  return (
    type === EV.Impact ||
    type === EV.KerbJolt ||
    type === EV.ReverseBeeper ||
    type === EV.ShiftEnd ||
    type === EV.HopperFull ||
    type === EV.LitterCollected ||
    type === EV.Fling ||
    type === EV.StainCleaned ||
    type === EV.DumpStart ||
    type === EV.DumpEnd ||
    type === EV.HazardJolt ||
    type === EV.HazardStop ||
    type === EV.ComboTier ||
    type === EV.Complaint ||
    type === EV.Horn ||
    type === EV.Knock ||
    type === EV.NpcHit ||
    type === EV.CarHorn ||
    type === EV.LeadTangle
  );
}

/** UI event types (SSP-286): what a menu did with the player's input. Strings, so they never collide with EV ids. */
export const UI_EV = { UiMove: 'ui_move', UiSelect: 'ui_select', UiBack: 'ui_back' } as const;
export type UiEventType = (typeof UI_EV)[keyof typeof UI_EV];

/** Fields every UI event carries. */
type UiEventBase = {
  /** The menu's id (`tally`, `shift_intro`, ...). */
  readonly menu: string;
  /** The item concerned: newly focused (UiMove), selected (UiSelect), or focused when Back came (UiBack). */
  readonly item: number;
};

/** The menu focus moved to another item (sfx.ui_move, M5). */
export type UiMoveEvent = UiEventBase & { readonly type: typeof UI_EV.UiMove };
/** A menu item was selected (sfx.ui_select, M5). */
export type UiSelectEvent = UiEventBase & { readonly type: typeof UI_EV.UiSelect };
/** A menu went back (sfx.ui_back, M5). */
export type UiBackEvent = UiEventBase & { readonly type: typeof UI_EV.UiBack };

export type UiEventByType = {
  [UI_EV.UiMove]: UiMoveEvent;
  [UI_EV.UiSelect]: UiSelectEvent;
  [UI_EV.UiBack]: UiBackEvent;
};

/**
 * Why the game paused (SSP-287): the player pressed Pause (Esc / P / pad Start), or the tab was hidden
 * (`visibilitychange`). SSP-263 (M8) adds the rotate-to-landscape prompt's reason.
 */
export const PauseReason = { Player: 'player', Hidden: 'hidden' } as const;
export type PauseReason = (typeof PauseReason)[keyof typeof PauseReason];

/** How the PauseOverlay closed (SSP-287). */
export const PauseExit = { Resume: 'resume', Restart: 'restart', Retire: 'retire' } as const;
export type PauseExit = (typeof PauseExit)[keyof typeof PauseExit];

/** Pause event types (SSP-287). Strings, so they never collide with EV ids or UI events. */
export const PAUSE_EV = { PauseOpened: 'pause_opened', PauseClosed: 'pause_closed' } as const;
export type PauseEventType = (typeof PAUSE_EV)[keyof typeof PAUSE_EV];

/** The PauseOverlay joined the stack: the world is frozen and dimmed (audio ducks, M5). */
export type PauseOpenedEvent = { readonly type: typeof PAUSE_EV.PauseOpened; readonly reason: PauseReason };
/** The PauseOverlay left the stack (audio restores, M5). */
export type PauseClosedEvent = { readonly type: typeof PAUSE_EV.PauseClosed; readonly exit: PauseExit };

export type PauseEventByType = {
  [PAUSE_EV.PauseOpened]: PauseOpenedEvent;
  [PAUSE_EV.PauseClosed]: PauseClosedEvent;
};

/** A subscriber to one pause event type. The event object is reused: copy what you need, never keep it. */
export type PauseEventListener<T extends PauseEventType> = (event: PauseEventByType[T]) => void;

/** Where the PauseOverlay reports opening and closing (EventBus implements it). */
export type PauseEventSink = {
  emitPauseOpened(reason: PauseReason): void;
  emitPauseClosed(exit: PauseExit): void;
};

type PauseListenerLists = { [T in PauseEventType]: readonly PauseEventListener<T>[] };

/** A subscriber to one UI event type. The event object is reused: copy what you need, never keep it. */
export type UiEventListener<T extends UiEventType> = (event: UiEventByType[T]) => void;

/** Where a menu reports what it did (EventBus implements it; unit tests pass recorders). */
export type UiEventSink = { emitUi(type: UiEventType, menu: string, item: number): void };

type UiListenerLists = { [T in UiEventType]: readonly UiEventListener<T>[] };

/** Listener lists per type, each replaced (never mutated) on subscribe/unsubscribe. */
type ListenerLists = { [T in EventType]: readonly SimEventListener<T>[] };

/** The bus. One per Game; the loop drains each sim tick into it, and menus emit UI events on it. */
export class EventBus implements UiEventSink, PauseEventSink {
  private readonly payloads: Payloads = createPayloads();
  private readonly uiPayloads: { [T in UiEventType]: Writable<UiEventByType[T]> } = {
    [UI_EV.UiMove]: { type: UI_EV.UiMove, menu: '', item: -1 },
    [UI_EV.UiSelect]: { type: UI_EV.UiSelect, menu: '', item: -1 },
    [UI_EV.UiBack]: { type: UI_EV.UiBack, menu: '', item: -1 },
  };
  private readonly pauseOpened: Writable<PauseOpenedEvent> = {
    type: PAUSE_EV.PauseOpened,
    reason: PauseReason.Player,
  };
  private readonly pauseClosed: Writable<PauseClosedEvent> = {
    type: PAUSE_EV.PauseClosed,
    exit: PauseExit.Resume,
  };
  private pauseListeners: PauseListenerLists = {
    [PAUSE_EV.PauseOpened]: [],
    [PAUSE_EV.PauseClosed]: [],
  };
  private uiListeners: UiListenerLists = {
    [UI_EV.UiMove]: [],
    [UI_EV.UiSelect]: [],
    [UI_EV.UiBack]: [],
  };
  private listeners: ListenerLists = {
    [EV.Impact]: [],
    [EV.KerbJolt]: [],
    [EV.ReverseBeeper]: [],
    [EV.ShiftEnd]: [],
    [EV.HopperFull]: [],
    [EV.LitterCollected]: [],
    [EV.Fling]: [],
    [EV.StainCleaned]: [],
    [EV.DumpStart]: [],
    [EV.DumpEnd]: [],
    [EV.HazardJolt]: [],
    [EV.HazardStop]: [],
    [EV.ComboTier]: [],
    [EV.Complaint]: [],
    [EV.Horn]: [],
    [EV.Knock]: [],
    [EV.NpcHit]: [],
    [EV.CarHorn]: [],
    [EV.LeadTangle]: [],
  };
  private anyListeners: readonly AnySimEventListener[] = [];
  /** The queue and tick drained last: a sealed tick is dispatched once, however often drain() is called. */
  private lastQueue: ReadonlyEventQueue | null = null;
  private lastTick = -1;

  /** Subscribes `listener` to events of `type`. Listeners of one type run in subscription order. */
  on<T extends EventType>(type: T, listener: SimEventListener<T>): Unsubscribe {
    const lists = this.listeners as { [K in T]: readonly SimEventListener<T>[] };
    lists[type] = [...lists[type], listener];
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      lists[type] = lists[type].filter((l) => l !== listener);
    };
  }

  /** Subscribes `listener` to every event. It runs after the type's own listeners, in subscription order. */
  onAny(listener: AnySimEventListener): Unsubscribe {
    this.anyListeners = [...this.anyListeners, listener];
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      this.anyListeners = this.anyListeners.filter((l) => l !== listener);
    };
  }

  /** Subscribes `listener` to UI events of `type` (SSP-286). Listeners run in subscription order. */
  onUi<T extends UiEventType>(type: T, listener: UiEventListener<T>): Unsubscribe {
    const lists = this.uiListeners as { [K in T]: readonly UiEventListener<T>[] };
    lists[type] = [...lists[type], listener];
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      lists[type] = lists[type].filter((l) => l !== listener);
    };
  }

  /** Dispatches one UI event to the onUi() subscribers of `type`, now. */
  emitUi(type: UiEventType, menu: string, item: number): void {
    const event = this.uiPayloads[type];
    event.menu = menu;
    event.item = item;
    const listeners = (this.uiListeners as { [K in UiEventType]: readonly UiEventListener<K>[] })[
      type
    ] as readonly ((event: UiEventByType[UiEventType]) => void)[];
    for (let i = 0; i < listeners.length; i += 1) listeners[i]?.(event);
  }

  /** Subscribes `listener` to pause events of `type` (SSP-287). Listeners run in subscription order. */
  onPause<T extends PauseEventType>(type: T, listener: PauseEventListener<T>): Unsubscribe {
    const lists = this.pauseListeners as { [K in T]: readonly PauseEventListener<T>[] };
    lists[type] = [...lists[type], listener];
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      lists[type] = lists[type].filter((l) => l !== listener);
    };
  }

  /** Dispatches PauseOpened (the overlay joined the stack, for `reason`) to its onPause() subscribers, now. */
  emitPauseOpened(reason: PauseReason): void {
    const event = this.pauseOpened;
    event.reason = reason;
    const listeners = this.pauseListeners[PAUSE_EV.PauseOpened];
    for (let i = 0; i < listeners.length; i += 1) listeners[i]?.(event);
  }

  /** Dispatches PauseClosed (the overlay left the stack by `exit`) to its onPause() subscribers, now. */
  emitPauseClosed(exit: PauseExit): void {
    const event = this.pauseClosed;
    event.exit = exit;
    const listeners = this.pauseListeners[PAUSE_EV.PauseClosed];
    for (let i = 0; i < listeners.length; i += 1) listeners[i]?.(event);
  }

  /**
   * Dispatches the events of one sealed tick in emission order and returns how many it dispatched. A tick
   * already drained (same queue, same tick) dispatches nothing, so a scene that did not step this frame can
   * never replay last tick's events. Throws on an unsealed queue (a drain in the middle of World.step) and on
   * an event type the bus cannot decode.
   */
  drain(queue: ReadonlyEventQueue): number {
    if (!queue.sealed) {
      throw new Error(
        `EventBus.drain: the queue for tick ${queue.tick} is not sealed; drain only after World.step returns`,
      );
    }
    if (queue === this.lastQueue && queue.tick === this.lastTick) return 0;
    this.lastQueue = queue;
    this.lastTick = queue.tick;
    const count = queue.count;
    for (let i = 0; i < count; i += 1) this.dispatchAt(queue, i);
    return count;
  }

  private dispatchAt(queue: ReadonlyEventQueue, i: number): void {
    const type = queue.type[i] ?? 0;
    const tick = queue.tick;
    const entity = queue.entity[i] ?? -1;
    const a = queue.a[i] ?? 0;
    const b = queue.b[i] ?? 0;
    const c = queue.c[i] ?? 0;
    if (!isEventType(type)) {
      throw new Error(`EventBus: event ${i} of tick ${tick} has type ${type}, which the bus cannot decode`);
    }
    switch (type) {
      case EV.Impact: {
        const e = this.payloads[EV.Impact];
        e.tick = tick;
        e.entity = entity;
        e.x = a;
        e.y = b;
        e.speedMps = c;
        this.emit(EV.Impact, e);
        return;
      }
      case EV.KerbJolt: {
        const e = this.payloads[EV.KerbJolt];
        e.tick = tick;
        e.entity = entity;
        e.x = a;
        e.y = b;
        e.speedMps = c;
        this.emit(EV.KerbJolt, e);
        return;
      }
      case EV.ReverseBeeper: {
        const e = this.payloads[EV.ReverseBeeper];
        e.tick = tick;
        e.entity = entity;
        e.x = a;
        e.y = b;
        this.emit(EV.ReverseBeeper, e);
        return;
      }
      case EV.ShiftEnd: {
        if (!SHIFT_END_REASONS.has(a)) {
          throw new Error(`EventBus: ShiftEnd at tick ${tick} carries unknown reason ${a}`);
        }
        const e = this.payloads[EV.ShiftEnd];
        e.tick = tick;
        e.entity = entity;
        e.reason = a as ShiftEndReasonValue;
        this.emit(EV.ShiftEnd, e);
        return;
      }
      case EV.HopperFull: {
        const e = this.payloads[EV.HopperFull];
        e.tick = tick;
        e.entity = entity;
        e.x = a;
        e.y = b;
        e.capacityLU = c;
        this.emit(EV.HopperFull, e);
        return;
      }
      case EV.LitterCollected: {
        const e = this.payloads[EV.LitterCollected];
        e.tick = tick;
        e.entity = entity;
        e.x = a;
        e.y = b;
        e.kind = litterKindOf(c, type, tick);
        this.emit(EV.LitterCollected, e);
        return;
      }
      case EV.Fling: {
        const e = this.payloads[EV.Fling];
        e.tick = tick;
        e.entity = entity;
        e.x = a;
        e.y = b;
        e.kind = litterKindOf(c, type, tick);
        this.emit(EV.Fling, e);
        return;
      }
      case EV.StainCleaned: {
        const e = this.payloads[EV.StainCleaned];
        e.tick = tick;
        e.entity = entity;
        e.x = a;
        e.y = b;
        e.kind = stainKindOf(entity, tick);
        e.pts = c;
        this.emit(EV.StainCleaned, e);
        return;
      }
      case EV.DumpStart: {
        const e = this.payloads[EV.DumpStart];
        e.tick = tick;
        e.entity = entity;
        e.site = dumpSiteOf(a, type, tick);
        e.lu = b;
        e.drainTicks = c;
        this.emit(EV.DumpStart, e);
        return;
      }
      case EV.DumpEnd: {
        const e = this.payloads[EV.DumpEnd];
        e.tick = tick;
        e.entity = entity;
        e.site = dumpSiteOf(a, type, tick);
        e.luDumped = b;
        e.completed = c !== 0;
        this.emit(EV.DumpEnd, e);
        return;
      }
      case EV.HazardJolt: {
        const e = this.payloads[EV.HazardJolt];
        e.tick = tick;
        e.entity = entity;
        e.x = a;
        e.y = b;
        e.spilledLU = c;
        this.emit(EV.HazardJolt, e);
        return;
      }
      case EV.HazardStop: {
        const e = this.payloads[EV.HazardStop];
        e.tick = tick;
        e.entity = entity;
        e.x = a;
        e.y = b;
        e.speedMps = c;
        this.emit(EV.HazardStop, e);
        return;
      }
      case EV.ComboTier: {
        const e = this.payloads[EV.ComboTier];
        e.tick = tick;
        e.entity = entity;
        e.multiplier = a;
        e.previousMultiplier = b;
        e.chain = c;
        this.emit(EV.ComboTier, e);
        return;
      }
      case EV.Complaint: {
        if (!OFFENCES.has(c)) {
          throw new Error(`EventBus: Complaint at tick ${tick} carries unknown offence ${c}`);
        }
        const e = this.payloads[EV.Complaint];
        e.tick = tick;
        e.entity = entity;
        e.x = a;
        e.y = b;
        e.reason = c as Offence;
        this.emit(EV.Complaint, e);
        return;
      }
      case EV.Horn: {
        const e = this.payloads[EV.Horn];
        e.tick = tick;
        e.entity = entity;
        e.x = a;
        e.y = b;
        e.radiusM = c;
        this.emit(EV.Horn, e);
        return;
      }
      case EV.Knock: {
        const e = this.payloads[EV.Knock];
        e.tick = tick;
        e.entity = entity;
        e.x = a;
        e.y = b;
        e.kind = knockableKindOf(c, tick);
        this.emit(EV.Knock, e);
        return;
      }
      case EV.NpcHit: {
        const e = this.payloads[EV.NpcHit];
        e.tick = tick;
        e.entity = entity;
        e.x = a;
        e.y = b;
        e.kind = npcKindOf(c, tick);
        this.emit(EV.NpcHit, e);
        return;
      }
      case EV.CarHorn: {
        const e = this.payloads[EV.CarHorn];
        e.tick = tick;
        e.entity = entity;
        e.x = a;
        e.y = b;
        e.honk = c;
        this.emit(EV.CarHorn, e);
        return;
      }
      case EV.LeadTangle: {
        const e = this.payloads[EV.LeadTangle];
        e.tick = tick;
        e.entity = entity;
        e.x = a;
        e.y = b;
        e.dog = c;
        this.emit(EV.LeadTangle, e);
        return;
      }
    }
  }

  private emit<T extends EventType>(type: T, event: SimEventByType[T]): void {
    const typed = (this.listeners as { [K in T]: readonly SimEventListener<T>[] })[type];
    for (let i = 0; i < typed.length; i += 1) typed[i]?.(event);
    const any = this.anyListeners;
    for (let i = 0; i < any.length; i += 1) any[i]?.(event as SimEvent);
  }
}
