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

import { LITTER_IDS, type LitterId, STAIN_IDS, type StainId } from '../sim/entities.ts';
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

/** The shift ended (phase 10, shift.ts, SSP-062): TOWED or TIME_UP, once per shift. */
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
    type === EV.HazardStop
  );
}

/** Listener lists per type, each replaced (never mutated) on subscribe/unsubscribe. */
type ListenerLists = { [T in EventType]: readonly SimEventListener<T>[] };

/** The bus. One per Game; the loop drains each sim tick into it. */
export class EventBus {
  private readonly payloads: Payloads = createPayloads();
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
    }
  }

  private emit<T extends EventType>(type: T, event: SimEventByType[T]): void {
    const typed = (this.listeners as { [K in T]: readonly SimEventListener<T>[] })[type];
    for (let i = 0; i < typed.length; i += 1) typed[i]?.(event);
    const any = this.anyListeners;
    for (let i = 0; i < any.length; i += 1) any[i]?.(event as SimEvent);
  }
}
