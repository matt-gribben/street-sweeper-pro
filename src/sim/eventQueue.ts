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
 * ComboTier, SSP-078 Complaint and Horn, SSP-092 Knock, SSP-082 NpcHit, SSP-089 CarHorn, SSP-083
 * HandbagWhack, SSP-084 Caught, SSP-090 Dent, SSP-086 LeadTangle, SSP-096 PowerUp, SSP-094 Splash, NpcSplash,
 * GlassSmash and GlassSwept, SSP-095 NearMiss, DustCloud and Cough, SSP-088 PigeonScatter, SSP-288 PickupScored,
 * Penalty and FistShake; later issues append the rest of the §7.2 list.
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
 * - HandbagWhack: entity = Doris's NPC store index, a = x, b = y (her centre, m), c = the HP Bessie lost (the
 *   rule's handbagHitHp, 2, or what was left when that was less). Phase 7 (npc/behaviours/oldWoman.ts, SSP-083),
 *   once per whack of a chasing Doris whose handbag reaches Bessie's body. The HP flash and, until a handbag
 *   SFX exists (ENTITY_CATALOG §17 Q11), granny_harrumph's `whack` variant (M5) read it.
 * - Caught: entity = the litterbug's NPC store index, a = x, b = y (his centre, m), c = the style bonus's points
 *   (entities.json npc.litterbug rules.caughtPts, +100). Phase 7 (npc/behaviours/litterbug.ts, SSP-084), once
 *   per litterbug, on the honk within rules.caughtRadiusM (6 m) of him that catches him; that honk is not counted
 *   toward horn spam (complaints.ts markHornCaught). Phase 9 (scoring.ts stepScoring) awards the points through
 *   the bonus API: never multiplied, never touching the chain (GDD §10.3). The "Caught!" popup, the bonus
 *   sparkle (sfx.combo_tier:bonus) and his "huh" (sfx.ped_oi:huh) read it.
 * - Dent: entity = the parked car's VehicleStore index, a = x, b = y (the contact point, m), c = the normal impact
 *   speed vn (m/s). Phase 3 (collision/resolveStatic.ts, parked.ts, SSP-090), once per contact episode of Bessie
 *   with a parked car whose approaching vn is above collision.damageThresholdMps (2 m/s): the flat dent HP and
 *   the Offence.Dent penalty fact go with it, and no EV.Impact. Audio plays the car's sfx.dent (`crash`, M5).
 * - PowerUp: entity = the pickup's PickupStore index just before it is swap-removed, a = x, b = y (the pickup's
 *   centre, m), c = its kind (POWERUP_IDS index). Phase 4 (pickups.ts stepPickups, SSP-096), once per power-up
 *   collected, the tick Bessie's body OBB first overlaps it; the effect is applied as it is emitted.
 *   sfx.powerup (M5).
 * - Splash: entity = the puddle's HazardStore index, a = x, b = y (the puddle's footprint centre, m), c = |vLong|
 *   (m/s). Phase 7 (npc/splash.ts, SSP-094), once per crossing episode of a haz.puddle: the first tick of the
 *   episode on which |vLong| is above streetLife.splash.minSpeedMps (3 m/s). sfx.splash and fx.splash read it.
 * - NpcSplash: entity = the pedestrian's NPC store index, a = x, b = y (its centre, m), c = the complaints the
 *   splash filed (1 on every streetLife.splash.complaintEvery-th splash of the shift, else 0). Phase 7
 *   (npc/splash.ts, SSP-094), once per pedestrian per puddle crossing above 3 m/s with it within 1.5 m of
 *   Bessie's body; its −50 penalty fact is recorded with it. sfx.splash's `soak` and ped_oi (M5) read it.
 * - GlassSmash: entity = the haz.broken_glass's HazardStore index, a = x, b = y (where the bottle landed, m),
 *   c = 1 when the smash made a new hazard, 0 when the bottle landed on glass already there. Phase 5 (stepLitter's
 *   flung-landing hook, hazards.ts, SSP-094), once per flung litter.glass_bottle that smashes. fx.glass_smash and
 *   pickup_glass's `smash` (M5) read it.
 * - GlassSwept: entity = the hazard's kind (HAZARD_ENTITY_IDS index: the hazard is swap-removed as it is
 *   emitted), a = x, b = y (its footprint centre, m), c = its points (entities.json rules.sweepPts, 20, before the
 *   combo). Phase 5 (hazards.ts stepGlassSweep, SSP-094), once per haz.broken_glass the collecting brush sweeps
 *   up. Scoring takes it as a pickup (phase 9); pickup_glass reads it.
 * - NearMiss: entity = the pedestrian's NPC store index, a = x, b = y (its centre, m), c = the style bonus's
 *   points (tuning.json streetLife.nearMiss.pts, +25). Phase 7 (npc/reactions.ts stepStreetLife, SSP-095), once
 *   per pass: on the tick after Bessie's closest approach to a pedestrian, when that approach was within
 *   nearMiss.maxGapM (0.5 m) of her body at more than minSpeedMps (3 m/s) and the pass had no contact. Phase 9
 *   (scoring.ts stepScoring) awards it through the bonus API like Caught. The bonus popup, sfx.combo_tier:bonus
 *   and the pedestrian's "Oi!" (sfx.ped_oi) read it.
 * - DustCloud: entity −1, a = x, b = y (the gutter brush centre the cloud rises from, m), c = the brush's side
 *   (−1 left, +1 right). Phase 6 (dirt.ts stepDust, SSP-095): each gutter brush, every streetLife.dust
 *   cloudEveryTicks (7) ticks while the brush collects over dusty ground (`%` yard) and Bessie is not spraying.
 *   The cloud lives cloudLifeTicks (30) ticks. fx.dust_puff (SSP-102 placeholder particles, SSP-154) reads it.
 * - Cough: entity = the pedestrian's NPC store index, a = x, b = y (its centre, m), c = its kind (NPC_IDS index).
 *   Phase 7 (npc/reactions.ts stepStreetLife, SSP-095): a pedestrian within streetLife.dust.radiusM (3 m) of a
 *   live dust cloud for dust.everyS × 60 (120) ticks in a row coughs, then again every 120 ticks it stays in
 *   range; its −10 penalty fact (Offence.Dust, no complaint) is recorded with it. fx.cough (SSP-155) and
 *   sfx.ped_oi:cough (M5) read it.
 * - PigeonScatter: entity = the flock's number (the birds' NpcStore `group`), a = x, b = y (the centre of the
 *   circle the flock covered as it took off, m), c = the style bonus's points (entities.json npc.pigeon
 *   rules.scatterPts, +25). Phase 7 (npc/behaviours/pigeon.ts, SSP-088), at most once per flock per scatter: on
 *   the first tick of a scatter that Bessie's body OBB overlaps that circle. Phase 9 (scoring.ts stepScoring)
 *   awards it through the bonus API like Caught!: never multiplied, never touching the chain (GDD §10.3). The
 *   "Pigeon Scatter" popup and the bonus sparkle read it (the flap, sfx.pigeon_flap, reads the birds' Fly state).
 * - PickupScored: entity = the combo multiplier the pickup scored at (1..5), a = x, b = y (the pickup's position,
 *   copied from its EV.LitterCollected, EV.StainCleaned or EV.GlassSwept), c = the points it scored (its `pts` ×
 *   that multiplier; 0 for a 0-point pickup). Phase 9 (scoring.ts stepScoring, SSP-288), once per pickup, straight
 *   after that pickup's chain increment (and any EV.ComboTier it caused). A presentation fact only: scoring has
 *   already counted the points; the world-space score popup (ui/popups.ts) reads it.
 * - Penalty: entity = its Offence code (complaints.ts), a = x, b = y (where the offence happened, m), c = its
 *   points (0 or below). Phase 9 (complaints.ts applyPenalties, SSP-288), once per penalty fact, in the order
 *   recorded, before the complaints it files. The world-space penalty popup (ui/popups.ts) reads it.
 * - FistShake: entity = Doris's NPC store index, a = x, b = y (her centre, m), c = how long she shakes it (ticks,
 *   rules.fistShakeS × 60 = 90). Phase 7 (npc/behaviours/oldWoman.ts, SSP-288), when a Horn delivered while she
 *   glares starts a FistShake. Her "Hmph!" bubble (ui/popups.ts) and sfx.granny_harrumph (her entities.json
 *   sfx.horn, M5) read it.
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
  HandbagWhack: 19,
  Caught: 20,
  Dent: 21,
  LeadTangle: 22,
  PowerUp: 23,
  Splash: 24,
  NpcSplash: 25,
  GlassSmash: 26,
  GlassSwept: 27,
  NearMiss: 28,
  DustCloud: 29,
  Cough: 30,
  PigeonScatter: 31,
  PickupScored: 32,
  Penalty: 33,
  FistShake: 34,
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
