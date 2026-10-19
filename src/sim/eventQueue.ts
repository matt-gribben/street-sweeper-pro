// The sim's outbound facts (TECHNICAL_DESIGN §7.2, SSP-035). The sim never calls out: each tick it appends
// events to this preallocated struct-of-arrays queue, the World seals it in phase 11, and src/app/events.ts
// (SSP-043) drains it after the tick and dispatches typed events to audio, UI and render fx. Scoring (phase 9)
// reads the same facts inside the sim. Events are part of the replay hash input (§18.3, SSP-038).
//
// Lifecycle per tick: resetEvents (start of World.step, so the queue is empty when phase 1 runs) → emitEvent
// (or pushEvent) from any phase → sealEvents (phase 11). Readers see the sealed queue until the next step resets it. Pushing
// past EVENTS_PER_TICK, or after the seal, is a programmer error and throws (§21.4) in every build: the sim
// cannot read import.meta.env, so the check is never dev-only.
//
// Hot path: events live in typed arrays allocated once by createEventQueue. Per-tick sim code emits with
// emitEvent, which takes and returns only small integers, and writes the a/b/c payload into the returned slot
// itself: V8 boxes every double argument of a call it does not inline (16 B each), so a pushEvent(…, a, b, c)
// call in an optimised tick can allocate. pushEvent is the convenience form for tests, tools and cold paths.
// Nothing else allocates, except the Error built on the throw path.

/** Events one tick may emit (TECHNICAL_DESIGN §7.2). */
export const EVENTS_PER_TICK = 512;

/**
 * Event type ids (`type`, Uint16). 0 is never a valid type. The values are hashed into replays: append new
 * types, never renumber. M1 holds the first four, SSP-058 appended HopperFull, SSP-059 LitterCollected and
 * Fling; later issues append the rest of the §7.2 list (NpcHit, Complaint, ComboTier, DumpStart, Horn, ...).
 *
 * Payloads (`entity` is a store index, or −1 for Bessie and for events with no entity):
 * - Impact: a = x, b = y (contact point, m), c = normal impact speed vn (m/s). Emitted by phase 3 (SSP-036).
 * - KerbJolt: a = x, b = y (where the axle midpoint crossed the kerb edge, m), c = |vLong| just before the
 *   crossing (m/s). The front axle also loses speed; the rear axle only jolts.
 * - ReverseBeeper: a = x, b = y (Bessie's body centre, m), c = 0. Once per engagement of REV.
 * - ShiftEnd: a = reason (ShiftEndReason), b = 0, c = 0. In M1 only the TOWED stub (SSP-036) emits it.
 * - HopperFull: a = x, b = y (Bessie's body centre, m), c = capacity (LU). Once per fill, on the add that
 *   reaches capacity (hopper.ts, SSP-058); again only after LU has dropped below capacity.
 * - LitterCollected: entity = the item's LitterField index at collection (it is swap-removed straight after),
 *   a = x, b = y (the item's position, m), c = kind (LITTER_IDS index). Phase 5, the brush inlet (SSP-059).
 * - Fling: entity = the item's LitterField index, a = x, b = y (where the arc starts, m), c = kind (LITTER_IDS
 *   index). Phase 5, when the brush's fling roll flings an item (SSP-059).
 */
export const EV = {
  Impact: 1,
  KerbJolt: 2,
  ReverseBeeper: 3,
  ShiftEnd: 4,
  HopperFull: 5,
  LitterCollected: 6,
  Fling: 7,
} as const;
export type EventType = (typeof EV)[keyof typeof EV];

/**
 * Why a shift ended, carried in EV.ShiftEnd's `a`. M1 has only the TOWED stub (HP reached 0, SSP-036); the
 * shift timer (SSP-062) appends time-up and SACKED. Hashed into replays: append, never renumber.
 */
export const ShiftEndReason = { Towed: 1 } as const;
export type ShiftEndReason = (typeof ShiftEndReason)[keyof typeof ShiftEndReason];

/** The mutable queue. Only the sim writes it, through the functions below. */
export type EventQueue = {
  /** Events pushed this tick, 0..EVENTS_PER_TICK. */
  count: number;
  /** True from phase 11 until the next tick's reset; pushes are refused while sealed. */
  sealed: boolean;
  /** The tick these events belong to. */
  tick: number;
  readonly type: Uint16Array;
  readonly entity: Int32Array;
  readonly a: Float64Array;
  readonly b: Float64Array;
  readonly c: Float64Array;
};

/**
 * What render, audio, UI and the app bus may see: read `count` events from index 0, in emission order.
 * ArrayLike's index signature is readonly, so readers cannot write through this view.
 */
export type ReadonlyEventQueue = {
  readonly count: number;
  readonly sealed: boolean;
  readonly tick: number;
  readonly type: ArrayLike<number>;
  readonly entity: ArrayLike<number>;
  readonly a: ArrayLike<number>;
  readonly b: ArrayLike<number>;
  readonly c: ArrayLike<number>;
};

/** A new, empty, sealed queue with room for EVENTS_PER_TICK events. Allocate once per World. */
export function createEventQueue(): EventQueue {
  return {
    count: 0,
    sealed: true,
    tick: 0,
    type: new Uint16Array(EVENTS_PER_TICK),
    entity: new Int32Array(EVENTS_PER_TICK),
    a: new Float64Array(EVENTS_PER_TICK),
    b: new Float64Array(EVENTS_PER_TICK),
    c: new Float64Array(EVENTS_PER_TICK),
  };
}

/**
 * Empty and unseal the queue for `tick`. The World calls this before phase 1. The stale slots are zeroed so
 * a reader that ignores `count` can never see last tick's facts as this tick's.
 */
export function resetEvents(queue: EventQueue, tick: number): void {
  // Only the slots last tick used (usually none).
  for (let i = 0; i < queue.count; i += 1) {
    queue.type[i] = 0;
    queue.entity[i] = 0;
    queue.a[i] = 0;
    queue.b[i] = 0;
    queue.c[i] = 0;
  }
  queue.count = 0;
  queue.sealed = false;
  queue.tick = tick;
}

function throwSealed(queue: EventQueue, type: EventType): never {
  throw new Error(
    `EventQueue: emit of event type ${type} after the queue was sealed for tick ${queue.tick}; ` +
      'events may only be emitted from World.step phases 1–10',
  );
}

function throwOverflow(queue: EventQueue, type: EventType): never {
  throw new Error(
    `EventQueue overflow: tick ${queue.tick} tried to emit event ${queue.count + 1} (type ${type}) but the queue ` +
      `holds ${EVENTS_PER_TICK} events per tick (TECHNICAL_DESIGN §7.2); a system is emitting in a loop`,
  );
}

/**
 * Append one event of `type` for `entity` (store index, or −1) and return its slot index. The slot's a, b and
 * c start at 0; the caller writes the payload with `queue.a[i] = …`. Throws if the queue is sealed (an emit
 * outside World.step's phases 1–10) or already holds EVENTS_PER_TICK events this tick.
 */
export function emitEvent(queue: EventQueue, type: EventType, entity: number): number {
  if (queue.sealed) throwSealed(queue, type);
  const i = queue.count;
  if (i >= EVENTS_PER_TICK) throwOverflow(queue, type);
  queue.type[i] = type;
  queue.entity[i] = entity;
  queue.a[i] = 0;
  queue.b[i] = 0;
  queue.c[i] = 0;
  queue.count = i + 1;
  return i;
}

/** Append one event with its payload. Same rules as emitEvent; prefer emitEvent in per-tick sim code. */
export function pushEvent(
  queue: EventQueue,
  type: EventType,
  entity: number,
  a: number,
  b: number,
  c: number,
): void {
  const i = emitEvent(queue, type, entity);
  queue.a[i] = a;
  queue.b[i] = b;
  queue.c[i] = c;
}

/** Seal the queue (phase 11). Readers may drain it until the next resetEvents. */
export function sealEvents(queue: EventQueue): void {
  queue.sealed = true;
}

/** How many events of `type` the queue holds this tick. For tests, tools and the replay invariants. */
export function countEvents(queue: ReadonlyEventQueue, type: EventType): number {
  let n = 0;
  for (let i = 0; i < queue.count; i += 1) if (queue.type[i] === type) n += 1;
  return n;
}
