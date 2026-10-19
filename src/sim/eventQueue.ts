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
 * Fling, SSP-061 StainCleaned, SSP-062 DumpStart and DumpEnd, SSP-093 HazardJolt and HazardStop, SSP-063
 * ComboTier, SSP-078 Complaint and Horn, SSP-092 Knock, SSP-082 NpcHit, SSP-089 CarHorn, SSP-090 Dent; later issues
 * append the rest of the §7.2 list.
 *
 * Payloads (`entity` is a store index, or −1 for Bessie and for events with no entity):
 * - Impact: a = x, b = y (contact point, m), c = normal impact speed vn (m/s). Emitted by phase 3 (SSP-036), for
 *   walls, props, the map edge and (SSP-090) moving traffic and a parked car's contacts that are not a dent.
 * - KerbJolt: a = x, b = y (where the axle midpoint crossed the kerb edge, m), c = |vLong| just before the
 *   crossing (m/s). The front axle also loses speed; the rear axle only jolts.
 * - ReverseBeeper: a = x, b = y (Bessie's body centre, m), c = 0. Once per engagement of REV.
 * - ShiftEnd: a = reason (ShiftEndReason), b = 0, c = 0. Phase 10 (shift.ts, SSP-062, SSP-079), once per shift:
 *   TIME_UP on the first tick Bessie is at rest after the timer reaches 0; before the timer runs out, SACKED on
 *   the first tick that ends with the complaints meter at 5, else TOWED on the first tick that ends with HP 0
 *   (SACKED wins a tick that does both). The World is frozen from then on (world.ts).
 * - HopperFull: a = x, b = y (Bessie's body centre, m), c = capacity (LU). Once per fill, on the add that
 *   reaches capacity (hopper.ts, SSP-058); again only after LU has dropped below capacity.
 * - LitterCollected: entity = the item's LitterField index at collection (it is swap-removed straight after),
 *   a = x, b = y (the item's position, m), c = kind (LITTER_IDS index). Phase 5, the brush inlet (SSP-059).
 * - Fling: entity = the item's LitterField index, a = x, b = y (where the arc starts, m), c = kind (LITTER_IDS
 *   index). Phase 5, when the brush's fling roll flings an item (SSP-059).
 * - StainCleaned: entity = the stain's kind (STAIN_IDS index: the stain is swap-removed as it is emitted, so its
 *   store index would name nothing), a = x, b = y (the stain's position, m), c = its points (entities.json
 *   `pts`, before the combo; splat 0). Phase 6, cleanStainsInCone (water.ts, SSP-061), once per stain.
 * - DumpStart: entity = the dump site's index in level.sites, a = the site kind (DumpSite: 1 depot bay,
 *   2 skip), b = LU in the hopper as the drain starts, c = the drain length in ticks. Phase 10 (shift.ts,
 *   SSP-062), on the tick the 1.0 s hold completes; the drain runs from the next tick.
 * - DumpEnd: entity = the site's index in level.sites, a = the site kind (DumpSite), b = LU this drain removed,
 *   c = 1 if the drain completed, 0 if it was cut short (Bessie left the site, the timer ran out, or TOWED).
 *   Phase 10 (shift.ts, SSP-062), once per DumpStart.
 * - HazardJolt: entity = the hazard's store index (HazardStore), a = x, b = y (Bessie's body centre, m),
 *   c = LU spilled out of the hopper (0 when it was empty). Phase 2, §8.2 step 10 (hazards.ts, SSP-093): once
 *   per crossing episode of a haz.pothole, or of a haz.speed_bump entered above its minSpeedMps (6 m/s).
 * - HazardStop: entity = the hazard's store index, a = x, b = y (Bessie's body centre, m), c = |vLong| just
 *   before the stop (m/s). Phase 2, step 10: once per episode of driving into a haz.open_manhole (SSP-093).
 * - ComboTier: a = the new combo multiplier (1..5), b = the previous multiplier, c = the chain after the change;
 *   entity −1. Phase 9 (combo.ts, SSP-063), on every multiplier change: a rise (a > b) is a tier reached (the
 *   HUD popup and sfx.combo_tier), a drop is the chain expiring or a penalty resetting it.
 * - Complaint: a = x, b = y (where the offence happened, m), c = its Offence code (complaints.ts); entity −1.
 *   Phase 9 (complaints.ts applyPenalties, SSP-078), once per complaint that lands on the meter (a
 *   two-complaint offence emits two; none at the cap). The HUD stamps a box; sfx.complaint_stamp (M5).
 * - Horn: a = x, b = y (Bessie's body centre as the tick starts, m), c = the horn radius (m: 8, or 12 with the
 *   two-tone horn); entity −1. Phase 1 (complaints.ts stepHornInput, SSP-078), on the tick whose InputFrame
 *   carries the HORN pressed edge. Phase 7 delivers it to the NPCs in range (SSP-082); sfx.horn (M5).
 * - Knock: entity = the knockable's BodyStore index, a = x, b = y (the contact point, m), c = its kind
 *   (KNOCKABLE_IDS index). Phase 4 (bodies.ts, SSP-092), once per contact episode of Bessie with a knockable:
 *   the first tick she touches it after it has been clear of her for knockables.contact.rearmS (0.5 s). Only
 *   a body's first episode costs its penalty and spills its litter. sfx.bin_knock / sfx.cone_knock (M5).
 * - NpcHit: entity = the NPC's store index, a = x, b = y (the NPC's centre, m), c = its kind (NPC_IDS index).
 *   Phase 7 (npc/reactions.ts stepActorContacts, SSP-082), once per contact episode in which Bessie's closing
 *   speed toward the actor is at least streetLife.actorHit.minClosingSpeedMps (1.0 m/s); the penalty fact is
 *   recorded with it. The hit SFX (entities.json sfx.hit, M5), VFX and juice read it.
 * - CarHorn: entity = the honking vehicle's VehicleStore index, a = x, b = y (its body centre, m), c = which
 *   honk of the block it is (1, 2, 3: the rising `horn:car` honks at 3, 6 and 9 s, AUDIO_DESIGN §5.5).
 *   Phase 8 (traffic.ts, SSP-089), from the head of a queue Bessie is blocking. It is never Bessie's horn: it
 *   does not count towards horn spam and is never delivered to the NPCs as a Horn stimulus.
 * - Dent: entity = the parked car's VehicleStore index, a = x, b = y (the contact point, m), c = the normal impact
 *   speed vn (m/s). Phase 3 (collision/resolveStatic.ts, parked.ts, SSP-090), once per contact episode of Bessie
 *   with a parked car whose approaching vn is above collision.damageThresholdMps (2 m/s): the flat dent HP and
 *   the Offence.Dent penalty fact go with it, and no EV.Impact. Audio plays the car's sfx.dent (`crash`, M5).
 */
export const EV = {
  Impact: 1,
  KerbJolt: 2,
  ReverseBeeper: 3,
  ShiftEnd: 4,
  HopperFull: 5,
  LitterCollected: 6,
  Fling: 7,
  StainCleaned: 8,
  DumpStart: 9,
  DumpEnd: 10,
  HazardJolt: 11,
  HazardStop: 12,
  ComboTier: 13,
  Complaint: 14,
  Horn: 15,
  Knock: 16,
  NpcHit: 17,
  CarHorn: 18,
  Dent: 19,
} as const;
export type EventType = (typeof EV)[keyof typeof EV];

/**
 * Why a shift ended, carried in EV.ShiftEnd's `a`: TOWED (HP reached 0, SSP-036), TIME_UP (the knock-off after
 * the 240 s timer, SSP-062) and SACKED (the complaints meter reached 5, SSP-079). Hashed into replays: append,
 * never renumber.
 */
export const ShiftEndReason = { Towed: 1, TimeUp: 2, Sacked: 3 } as const;
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
