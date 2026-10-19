// The shared reaction rules of phase 7 (ENTITY_CATALOG §3.2, §3.4; TECHNICAL_DESIGN §9.4, §11.1; SSP-082): the
// stimuli the sim pushes to the NPCs every tick, and Bessie's contact with the actors' circles. What an NPC does
// with a stimulus is its behaviour's business (the generic pedestrian in behaviours/pedestrian.ts, and the
// per-type modules that extend it); this file only decides who is told what, and applies the hit penalty.
//
// Phase 7 calls stepReactions once, after the spawner and before deliverStimuli: pushReactionStimuli, then
// stepActorContacts, then the puddle splashes (npc/splash.ts stepPuddleSplash, SSP-094). One entry point rather
// than two calls in the World's phase: with two, V8's inlining of the whole tick into World.step grew enough that
// it tiered up inside the m1_drive_puddle_lane replay's measured window and broke the §17 heap check (37 KB
// pre-final-GC; 16.7 KB with one call, as before SSP-082). The splash step returns before any double arithmetic
// when the level has no hazards: without that early return the world.test.ts heap check (a town with none)
// grew 61–64 KB over 3,600 ticks (SSP-094).
//
// Stimuli (pushReactionStimuli), in this push order:
//   1. Every NPC's AWARE and HI_VIS flags are cleared: they mark this tick's BeaconYield and HiVis deliveries.
//   2. Horn: one area stimulus per EV.Horn this tick (phase 1, complaints.ts stepHornInput: at most one), at the event's
//      position with its radius (streetLife.horn.radiusM 8 m, 12 m with upg.two_tone_horn). It reaches every NPC
//      within the radius, in any state; the ENTITY_CATALOG §3.4 diagram draws the horn edge only from Aware, but
//      the horn radius is larger than the awareness radius and the businessman reacts only to the horn, so the
//      behaviours take it in Wander and Aware alike (decided in SSP-082).
//   3. HiVis: while pwr.hi_vis runs (startHiVis, SSP-096's hook; entities.json effect.durationS, 12 s), one
//      stimulus to every live NPC, every tick. Pushing it each tick means an NPC spawned during the 12 s is told
//      too; behaviours mark HI_VIS and yield and part when Bessie is within the awareness radius, Doris and the
//      businessman included. Stationary NPCs (market_trader) ignore it.
//   4. BeaconYield: one area stimulus at Bessie's body centre with the awareness radius (streetLife.awareness
//      radiusM 6 m, ledBeaconRadiusM 10 m with upg.led_beacon; setLedBeacon is SSP-188's hook). The generic
//      pedestrian marks AWARE and, if its type yields (entities.json `yields`), yields. Doris and the businessman
//      ignore it.
//   5. Spray (SSP-083): while Bessie sprays this tick (water.ts stepWater, phase 5, set `spraying` and the cone's
//      pose), one Spray stimulus aimed at each live NPC whose centre is inside the spray cone (water.ts
//      isInSprayCone's test, edges inclusive, written out inline), in index order, from the cone's apex. Every
//      kind is told: Doris chases (behaviours/oldWoman.ts); the generic pedestrian startles (GDD §8.5's "react
//      with a startle"; its proposed −50 is not applied, TBD); the no-op animals ignore it.
//
// Actor contact (stepActorContacts, right after the stimuli and before deliverStimuli, so a hit is delivered the
// same tick). Bessie's body OBB (tuning.json body.widthM × lengthM, 1.75 × 3.25 m) after phase 3
// is tested against every NPC circle (streetLife.npcRadius: human 0.3 m, cat 0.2 m, dog 0.25 m) whose kind has
// an entities.json `hit` (pigeons have none: they are ghosts). There is no physics push. A touch starts a
// contact episode unless the NPC's ignore window is open (`contactIgnore` > 0) or it is FALLEN or ON_ROOF; in
// any of those cases the touch only refills the window. A new episode:
//   - measures Bessie's closing speed toward the actor: her velocity at the contact point (the rear-axle velocity
//     vLong, vLat plus yaw rate × the lever arm from the rear axle, where vehicle.ts integrates her pose) along
//     the direction from the contact point to the actor's centre. The actor's own
//     walking speed does not count, so an actor walking into a stationary or slower Bessie bumps off;
//   - at or above streetLife.actorHit.minClosingSpeedMps (1.0 m/s) it is a hit: the penalty fact goes through the
//     penalty API (pushPenalty(Offence.Hit, hit.pts, hit.complaints) at the actor; phase 9 takes the points,
//     resets the combo chain and files the complaints), EV.NpcHit is emitted, the kind's `hit.drops` are spawned
//     round the actor through litter.ts addLitter (so they count toward litter spawned and Tidy %), drawing on the
//     `npc` stream, and a Hit stimulus is pushed for the actor;
//   - below it, a Bump stimulus is pushed instead (the actor startles), with no penalty;
//   - either way the window opens for actorHit.ignoreContactS (1.5 s = 90 ticks). Every tick it counts down by
//     one, and every tick Bessie still overlaps the actor refills it, so one episode lasts as long as the
//     overlap and a new one needs 1.5 s apart. A FALLEN actor (lying down, then getting up) is never hit again.
// A companion dog carries its walker's kind (store.ts), so hitting it costs the dog walker's `hit`: the walker's
// animal hit, −300 and 1 C (decided in SSP-086). The two are tied by `link` and share one contact episode: a touch
// of either refills both ignore windows, and a touch while either window is open or either is FALLEN is part of
// the same episode, so hitting the walker and then the dog (or the other way round) costs one hit.
//
// Street-life rules (stepStreetLife, right after the actor contacts, so its stimuli are delivered the same tick;
// GDD §10.3, §8.6, ENTITY_CATALOG §3.4; SSP-095). Both apply to pedestrians only: the person kinds (every kind
// but the cat and the pigeon), not a companion dog. Bessie's body box is the one stepActorContacts just set up.
//   Near miss. Each pedestrian has a pass state (store `nearMiss`, NearMissState). The gap is the distance from
//   its circle to Bessie's body box (the centre's distance to the box less its radius; compared squared, so no
//   square root). Contact this tick means the circle overlaps the box, the actor-contact window was refilled
//   this tick (stepActorContacts touched it) or it is FALLEN. Armed: a pass starts when the gap is at most
//   streetLife.nearMiss.maxGapM (0.5 m) without contact; Passing tracks the smallest gap so far and whether
//   Bessie's speed sqrt(vLong² + vLat²) was above minSpeedMps (3 m/s) on that tick. On the first tick the gap
//   does not shrink, the closest approach is behind her: if she was fast there, the near miss is awarded
//   (EV.NearMiss with streetLife.nearMiss.pts, +25, which phase 9 adds through the bonus API, unmultiplied and
//   leaving the chain alone; a NearMiss stimulus startles the pedestrian), and either way the pass is Spent.
//   Contact at any point of a pass also spends it, with no award: a contact is a hit (or a bump), never a near
//   miss. A spent pass re-arms once the gap exceeds rearmGapM (1.5 m; proposed in SSP-095, owner to review), so
//   one pass earns at most one award.
//   Dust coughing. A pedestrian whose centre is within streetLife.dust.radiusM (3 m) of a live dust cloud
//   (dirt.ts stepDust, phase 6) counts the ticks in a row it stays there (store `dustTicks`); out of range the
//   count is 0. On every dust.everyS × 60th (120th) tick in range it coughs: a penalty fact (Offence.Dust,
//   dust.pts −10, no complaint; phase 9 takes the points and resets the chain, GDD §10.2, §20 Q8), EV.Cough and
//   a Cough stimulus (the generic pedestrian plays its startle frames; Doris never startles). So 240 ticks in
//   range cost exactly −20, and leaving the range restarts the count.
//
// Hot path: stepReactions allocates nothing and passes no doubles across calls, except
// addLitter's arguments on the rare tick a hit drops shopping (as with the hazard spills, hazards.ts).

import { type Aabb, createAabb, createObb, type Obb, obbAabb, refreshObbAxes } from '../collision/obb.ts';
import type { Circle, Contact } from '../collision/sat.ts';
import { createCircle, createContact, obbVsCircleShape } from '../collision/sat.ts';
import { Offence } from '../complaints.ts';
import { SIM_HZ, TILE_M } from '../constants.ts';
import { type Entities, LITTER_IDS, NPC_IDS } from '../entities.ts';
import { EV, emitEvent } from '../eventQueue.ts';
import { cos, sin } from '../fmath.ts';
import { addLitter, LITTER_ROTATIONS } from '../litter.ts';
import { pushPenalty } from '../penalties.ts';
import { nextFloat, nextInt } from '../rng.ts';
import type { Tuning } from '../tuning.ts';
import type { World } from '../world.ts';
import { Stimulus } from './behaviour.ts';
import { stepPuddleSplash } from './splash.ts';
import { STEER_TILE } from './steering.ts';
import { pushStimulus, STIMULUS_EVERYONE } from './stimuli.ts';
import { NO_NPC_HANDLE, NPC_FLAG, NpcOrigin, npcHandle, queryNpcs, resolveNpcHandle } from './store.ts';

/** Dropped items land this far from the actor's centre at least, metres. */
export const DROP_MIN_M = 0.4;
/** …and at most this far. */
export const DROP_MAX_M = 1.2;

/**
 * A pedestrian's near-miss pass (store `nearMiss`, stepStreetLife; see the header). Passing and PassingFast both
 * track a pass; PassingFast when Bessie was above the near-miss speed at its closest approach so far. Hashed:
 * append, never renumber.
 */
export const NearMissState = { Armed: 0, Passing: 1, PassingFast: 2, Spent: 3 } as const;
export type NearMissState = (typeof NearMissState)[keyof typeof NearMissState];

/** The shared reaction state and per-kind tables, built once per shift (createReactions). */
export type Reactions = {
  /** The awareness (BeaconYield) radius, m: awareness.radiusM, or ledBeaconRadiusM with upg.led_beacon. */
  awarenessRadiusM: number;
  /** upg.led_beacon fitted (setLedBeacon; false until M6). */
  ledBeacon: boolean;
  /** The closing speed a hit needs, m/s (streetLife.actorHit.minClosingSpeedMps). */
  minClosingSpeedMps: number;
  /** The contact ignore window, ticks (actorHit.ignoreContactS × 60, 90). At most 255 (Uint8 column). */
  ignoreTicks: number;
  /** pwr.hi_vis's length, ticks (entities.json effect.durationS × 60, 720). */
  readonly hiVisTicks: number;
  /** pwr.hi_vis runs while tick < hiVisUntilTick; 0 = it has not run. */
  hiVisUntilTick: number;
  /** Hit and bump episodes this shift. */
  hits: number;
  bumps: number;
  /** streetLife.nearMiss: the gap a pass needs (m), the squared speed it must beat, the bonus and the re-arm gap. */
  nearMissGapM: number;
  nearMissMinSpeed2: number;
  nearMissPts: number;
  nearMissRearmGapM: number;
  /** streetLife.dust: the cough radius squared (m²), the penalty and the ticks per cough (everyS × 60). */
  dustRadius2: number;
  dustPts: number;
  dustEveryTicks: number;
  /** Near misses awarded and coughs this shift. */
  nearMisses: number;
  coughs: number;
  /** Per NPC kind: 1 for a person (every kind but the cat and the pigeon), whom the street-life rules cover. */
  readonly isPerson: Uint8Array;
  /** Per NPC kind (NPC_IDS index): 1 when it has a `hit` (it can be hit), its points and complaints. */
  readonly hasHit: Uint8Array;
  readonly hitPts: Int32Array;
  readonly hitComplaints: Uint8Array;
  /** Per NPC kind: 1 when the type yields inside the awareness radius (entities.json `yields`). */
  readonly yields: Uint8Array;
  /** Per NPC kind, its `hit.drops`: entries dropStart[k] .. dropStart[k + 1] of dropLitter / dropCount. */
  readonly dropStart: Int32Array;
  /** LITTER_IDS index of each drop entry. */
  readonly dropLitter: Uint8Array;
  readonly dropCount: Uint16Array;
  /** Bessie's body centre this tick, as one-entry arrays for the steering calls (steerFlee). */
  readonly bessieX: Float64Array;
  readonly bessieY: Float64Array;
  /** Contact scratch. */
  readonly obb: Obb;
  readonly box: Aabb;
  readonly circle: Circle;
  readonly contact: Contact;
  /** NPC query results (store capacity). */
  readonly found: Int32Array;
};

function applyTuning(r: Reactions, tuning: Tuning): void {
  const sl = tuning.streetLife;
  r.awarenessRadiusM = r.ledBeacon ? sl.awareness.ledBeaconRadiusM : sl.awareness.radiusM;
  r.minClosingSpeedMps = sl.actorHit.minClosingSpeedMps;
  const ignore = Math.round(sl.actorHit.ignoreContactS * SIM_HZ);
  if (!(ignore >= 1 && ignore <= 255)) {
    throw new Error(
      `reactions: streetLife.actorHit.ignoreContactS must be 1..255 ticks, got ${sl.actorHit.ignoreContactS} s`,
    );
  }
  r.ignoreTicks = ignore;
  const nm = sl.nearMiss;
  if (!(nm.rearmGapM >= nm.maxGapM)) {
    throw new Error(
      `reactions: streetLife.nearMiss.rearmGapM (${nm.rearmGapM} m) must be at least maxGapM (${nm.maxGapM} m)`,
    );
  }
  r.nearMissGapM = nm.maxGapM;
  r.nearMissMinSpeed2 = nm.minSpeedMps * nm.minSpeedMps;
  r.nearMissPts = nm.pts;
  r.nearMissRearmGapM = nm.rearmGapM;
  const dust = sl.dust;
  const every = Math.round(dust.everyS * SIM_HZ);
  if (!(every >= 1 && every <= 0xffff)) {
    throw new Error(`reactions: streetLife.dust.everyS must be 1..65535 ticks, got ${dust.everyS} s`);
  }
  r.dustRadius2 = dust.radiusM * dust.radiusM;
  r.dustPts = dust.pts;
  r.dustEveryTicks = every;
}

/** The reaction state for a shift on `tuning` and `entities`, for a store of `capacity`. Setup only. */
export function createReactions(tuning: Tuning, entities: Entities, capacity: number): Reactions {
  const kinds = NPC_IDS.length;
  const hasHit = new Uint8Array(kinds);
  const hitPts = new Int32Array(kinds);
  const hitComplaints = new Uint8Array(kinds);
  const yields = new Uint8Array(kinds);
  const isPerson = new Uint8Array(kinds);
  const dropStart = new Int32Array(kinds + 1);
  const litter: number[] = [];
  const counts: number[] = [];
  for (let k = 0; k < kinds; k += 1) {
    const e = entities.npcs[NPC_IDS[k] as (typeof NPC_IDS)[number]];
    yields[k] = e.yields ? 1 : 0;
    isPerson[k] = e.behaviour === 'cat' || e.behaviour === 'pigeon' ? 0 : 1;
    dropStart[k] = litter.length;
    if (e.hit === null) continue;
    hasHit[k] = 1;
    hitPts[k] = e.hit.pts;
    hitComplaints[k] = e.hit.complaints;
    for (const d of e.hit.drops) {
      litter.push(LITTER_IDS.indexOf(d.litter));
      counts.push(d.count);
    }
  }
  dropStart[kinds] = litter.length;
  const effect = entities.powerups['pwr.hi_vis'].effect;
  if (effect.kind !== 'pedestriansYield') {
    throw new Error(`reactions: pwr.hi_vis must have the pedestriansYield effect, got ${effect.kind}`);
  }
  const r: Reactions = {
    // Fractional first so the field starts as a double (TECHNICAL_DESIGN §17, deprecated maps).
    awarenessRadiusM: 0.5,
    ledBeacon: false,
    minClosingSpeedMps: 0.5,
    ignoreTicks: 0,
    hiVisTicks: Math.round(effect.durationS * SIM_HZ),
    hiVisUntilTick: 0,
    hits: 0,
    bumps: 0,
    // Fractional first so the fields start as doubles (TECHNICAL_DESIGN §17, deprecated maps).
    nearMissGapM: 0.5,
    nearMissMinSpeed2: 0.5,
    nearMissPts: 0,
    nearMissRearmGapM: 0.5,
    dustRadius2: 0.5,
    dustPts: 0,
    dustEveryTicks: 0,
    nearMisses: 0,
    coughs: 0,
    isPerson,
    hasHit,
    hitPts,
    hitComplaints,
    yields,
    dropStart,
    dropLitter: Uint8Array.from(litter),
    dropCount: Uint16Array.from(counts),
    bessieX: new Float64Array(1),
    bessieY: new Float64Array(1),
    obb: createObb(),
    box: createAabb(),
    circle: createCircle(),
    contact: createContact(),
    found: new Int32Array(capacity),
  };
  applyTuning(r, tuning);
  return r;
}

/** Hand the reactions a new tuning between ticks (setWorldTuning). Running hi-vis, counters and windows stay. */
export function setReactionTuning(r: Reactions, tuning: Tuning): void {
  applyTuning(r, tuning);
}

/**
 * The upg.led_beacon modifier hook (SSP-188 calls it from the loadout at shift start): `on` switches the
 * awareness radius to streetLife.awareness.ledBeaconRadiusM (10 m). Not per tick.
 */
export function setLedBeacon(r: Reactions, tuning: Tuning, on: boolean): void {
  r.ledBeacon = on;
  applyTuning(r, tuning);
}

/**
 * The pwr.hi_vis hook (SSP-096 calls it on pickup): hi-vis runs for its 12 s from the current tick, restarting if
 * it already runs. Called before phase 7, the tick it is called on is the first; called after, the next is.
 */
export function startHiVis(w: World): void {
  const r = w.npcAi.reactions;
  r.hiVisUntilTick = w.tick + r.hiVisTicks;
}

/** True while pwr.hi_vis runs on this tick. */
export function isHiVisActive(w: World): boolean {
  return w.tick < w.npcAi.reactions.hiVisUntilTick;
}

/** True when NPC `i`'s centre is within the awareness radius of Bessie's body centre (edge included). */
export function withinAwareness(w: World, i: number): boolean {
  const npc = w.npc;
  const v = w.vehicle;
  const dx = (npc.x[i] as number) - v.xM;
  const dy = (npc.y[i] as number) - v.yM;
  const r = w.npcAi.reactions.awarenessRadiusM;
  return dx * dx + dy * dy <= r * r;
}

/** Phase 7, after the spawner: clear the tick's stimulus marks and push Horn, HiVis, BeaconYield and Spray (header). */
export function pushReactionStimuli(w: World): void {
  const npc = w.npc;
  const r = w.npcAi.reactions;
  const q = w.npcAi.stimuli;
  const v = w.vehicle;
  const keep = 0xffff & ~(NPC_FLAG.AWARE | NPC_FLAG.HI_VIS);
  for (let i = 0; i < npc.count; i += 1) npc.flags[i] = (npc.flags[i] as number) & keep;
  r.bessieX[0] = v.xM;
  r.bessieY[0] = v.yM;
  const ev = w.events;
  for (let e = 0; e < ev.count; e += 1) {
    if (ev.type[e] !== EV.Horn) continue;
    const h = pushStimulus(q, Stimulus.Horn, NO_NPC_HANDLE);
    q.x[h] = ev.a[e] as number;
    q.y[h] = ev.b[e] as number;
    q.radiusM[h] = ev.c[e] as number;
  }
  if (w.tick < r.hiVisUntilTick) {
    const hv = pushStimulus(q, Stimulus.HiVis, NO_NPC_HANDLE);
    q.x[hv] = v.xM;
    q.y[hv] = v.yM;
    q.radiusM[hv] = STIMULUS_EVERYONE;
  }
  const s = pushStimulus(q, Stimulus.BeaconYield, NO_NPC_HANDLE);
  q.x[s] = v.xM;
  q.y[s] = v.yM;
  q.radiusM[s] = r.awarenessRadiusM;
  const water = w.water;
  if (!water.spraying) return;
  // isInSprayCone, written out inline: it takes doubles, which a call V8 does not inline would box (§17).
  const len = water.tuning.sprayConeLengthM;
  const halfEnd = water.tuning.sprayConeEndWidthM / 2;
  const ax = water.coneApexX;
  const ay = water.coneApexY;
  const fx = water.forwardX;
  const fy = water.forwardY;
  const rx = water.rightX;
  const ry = water.rightY;
  for (let i = 0; i < npc.count; i += 1) {
    const dx = (npc.x[i] as number) - ax;
    const dy = (npc.y[i] as number) - ay;
    const along = dx * fx + dy * fy;
    const across = dx * rx + dy * ry;
    if (!(along >= 0 && along <= len && (across < 0 ? -across : across) * len <= halfEnd * along)) continue;
    const k = pushStimulus(q, Stimulus.Spray, npcHandle(npc, i));
    q.x[k] = ax;
    q.y[k] = ay;
    q.radiusM[k] = 0;
  }
}

/** Phase 7, after pushReactionStimuli and before deliverStimuli: Bessie against the actors (header). */
export function stepActorContacts(w: World): void {
  const npc = w.npc;
  const r = w.npcAi.reactions;
  const ignore = npc.contactIgnore;
  for (let i = 0; i < npc.count; i += 1) {
    const t = ignore[i] as number;
    if (t > 0) ignore[i] = t - 1;
  }
  if (npc.count === 0) return;
  const v = w.vehicle;
  const body = w.tuning.vehicle.sweeper.body;
  const obb = r.obb;
  obb.cx = v.xM;
  obb.cy = v.yM;
  obb.headingRad = v.headingRad;
  obb.halfWidthM = body.widthM * 0.5;
  obb.halfLengthM = body.lengthM * 0.5;
  refreshObbAxes(obb);
  const rearM = body.rearAxleOffsetM;
  const box = r.box;
  obbAabb(obb, box);
  const reach = w.npcAi.steering.maxRadiusM;
  box.minX -= reach;
  box.minY -= reach;
  box.maxX += reach;
  box.maxY += reach;
  const n = queryNpcs(npc, box, r.found);
  const circle = r.circle;
  const contact = r.contact;
  const hitMask = NPC_FLAG.FALLEN | NPC_FLAG.ON_ROOF;
  for (let k = 0; k < n; k += 1) {
    const i = r.found[k] as number;
    const kind = npc.kind[i] as number;
    if (r.hasHit[kind] !== 1) continue;
    circle.x = npc.x[i] as number;
    circle.y = npc.y[i] as number;
    circle.radiusM = npc.radius[i] as number;
    if (!obbVsCircleShape(obb, circle, contact)) continue;
    let inEpisode = (ignore[i] as number) > 0 || ((npc.flags[i] as number) & hitMask) !== 0;
    ignore[i] = r.ignoreTicks;
    // A dog walker and its dog share their contact episodes (SSP-086): a touch of either refills both windows,
    // and either one's open window or fall makes it the same episode.
    const partner = resolveNpcHandle(npc, npc.link[i] as number);
    if (partner >= 0) {
      if ((ignore[partner] as number) > 0 || ((npc.flags[partner] as number) & hitMask) !== 0)
        inEpisode = true;
      ignore[partner] = r.ignoreTicks;
    }
    if (inEpisode) continue;
    // The normal points from the circle toward Bessie; the actor lies along −normal from her.
    const ux = -contact.normalX;
    const uy = -contact.normalY;
    const s = sin(v.headingRad);
    const c = cos(v.headingRad);
    // The contact point on her side: the actor's centre less its radius along u. Its lever arm is taken from the
    // rear axle, the point whose velocity vLong and vLat are (vehicle.ts integrates the pose there).
    const lx = circle.x - ux * circle.radiusM - (v.xM + s * rearM);
    const ly = circle.y - uy * circle.radiusM - (v.yM - c * rearM);
    const yaw = v.yawRateRadPerS;
    // Rear-axle velocity forward·vLong + right·vLat (forward = (s, −c), right = (c, s)), plus yaw × lever (a
    // heading increase turns clockwise on screen: d/dt of (lx, ly) is yaw · (−ly, lx)).
    const px = s * v.vLongMps + c * v.vLatMps - yaw * ly;
    const py = -c * v.vLongMps + s * v.vLatMps + yaw * lx;
    const closing = px * ux + py * uy;
    if (closing >= r.minClosingSpeedMps) hitActor(w, i, kind);
    else {
      r.bumps += 1;
      const b = pushStimulus(w.npcAi.stimuli, Stimulus.Bump, npcHandle(npc, i));
      w.npcAi.stimuli.x[b] = v.xM;
      w.npcAi.stimuli.y[b] = v.yM;
      w.npcAi.stimuli.radiusM[b] = 0;
    }
  }
}

/** A hit on NPC `i` of `kind`: the penalty fact, EV.NpcHit, the drops and the Hit stimulus (see the header). */
function hitActor(w: World, i: number, kind: number): void {
  const npc = w.npc;
  const r = w.npcAi.reactions;
  r.hits += 1;
  const p = pushPenalty(w.penalties, Offence.Hit, r.hitPts[kind] as number, r.hitComplaints[kind] as number);
  w.penalties.x[p] = npc.x[i] as number;
  w.penalties.y[p] = npc.y[i] as number;
  const e = emitEvent(w.events, EV.NpcHit, i);
  w.events.a[e] = npc.x[i] as number;
  w.events.b[e] = npc.y[i] as number;
  w.events.c[e] = kind;
  const end = r.dropStart[kind + 1] as number;
  for (let d = r.dropStart[kind] as number; d < end; d += 1) {
    spawnDrops(w, i, r.dropLitter[d] as number, r.dropCount[d] as number);
  }
  const q = w.npcAi.stimuli;
  const s = pushStimulus(q, Stimulus.Hit, npcHandle(npc, i));
  q.x[s] = w.vehicle.xM;
  q.y[s] = w.vehicle.yM;
  q.radiusM[s] = 0;
}

/**
 * Scatter `count` items of litter `kind` round NPC `i`: each at a uniform angle and DROP_MIN_M..DROP_MAX_M from
 * its centre, with a random rotation (three `npc` stream draws per item). An item that would land on a blocked
 * tile (a building, a wall) or off the map lands on the actor's centre instead. Stops when the LitterField is
 * full. Rare path: addLitter's double arguments may box.
 */
function spawnDrops(w: World, i: number, kind: number, count: number): void {
  const npc = w.npc;
  const rng = w.npcAi.rng;
  const st = w.npcAi.steering;
  const ox = npc.x[i] as number;
  const oy = npc.y[i] as number;
  for (let k = 0; k < count; k += 1) {
    const a = nextFloat(rng) * 2 * Math.PI;
    const d = DROP_MIN_M + nextFloat(rng) * (DROP_MAX_M - DROP_MIN_M);
    const rot = nextInt(rng, LITTER_ROTATIONS);
    let x = ox + sin(a) * d;
    let y = oy - cos(a) * d;
    const tx = Math.floor(x / TILE_M);
    const ty = Math.floor(y / TILE_M);
    if (
      !(tx >= 0 && ty >= 0 && tx < st.widthTiles && ty < st.heightTiles) ||
      ((st.tileFlags[ty * st.widthTiles + tx] as number) & STEER_TILE.BLOCKED) !== 0
    ) {
      x = ox;
      y = oy;
    }
    if (addLitter(w.litter, kind, x, y, rot) < 0) return;
  }
}

/**
 * Phase 7, after stepActorContacts (which set up Bessie's body box this tick) and before deliverStimuli: the
 * near-miss passes and the dust coughs of every pedestrian (see the header). Allocation-free.
 */
export function stepStreetLife(w: World): void {
  const npc = w.npc;
  const n = npc.count;
  if (n === 0) return;
  const r = w.npcAi.reactions;
  const v = w.vehicle;
  const obb = r.obb;
  const cx = obb.cx;
  const cy = obb.cy;
  const rx = obb.rightX;
  const ry = obb.rightY;
  const fx = obb.forwardX;
  const fy = obb.forwardY;
  const hw = obb.halfWidthM;
  const hl = obb.halfLengthM;
  const fast = v.vLongMps * v.vLongMps + v.vLatMps * v.vLatMps > r.nearMissMinSpeed2;
  const gapM = r.nearMissGapM;
  const rearmM = r.nearMissRearmGapM;
  const touched = r.ignoreTicks;
  const dust = w.dust;
  const clouds = dust.count;
  const head = dust.head;
  const cap = dust.capacity;
  const dustR2 = r.dustRadius2;
  for (let i = 0; i < n; i += 1) {
    if (r.isPerson[npc.kind[i] as number] !== 1 || npc.origin[i] === NpcOrigin.Companion) continue;
    const x = npc.x[i] as number;
    const y = npc.y[i] as number;
    const rad = npc.radius[i] as number;

    // Near miss: the squared distance from the centre to Bessie's body box (0 inside it).
    const dx = x - cx;
    const dy = y - cy;
    let ax = dx * rx + dy * ry;
    if (ax < 0) ax = -ax;
    ax -= hw;
    if (ax < 0) ax = 0;
    let ay = dx * fx + dy * fy;
    if (ay < 0) ay = -ay;
    ay -= hl;
    if (ay < 0) ay = 0;
    const d2 = ax * ax + ay * ay;
    const contact =
      d2 <= rad * rad ||
      (npc.contactIgnore[i] as number) === touched ||
      ((npc.flags[i] as number) & NPC_FLAG.FALLEN) !== 0;
    let st = npc.nearMiss[i] as number;
    if (contact) {
      st = NearMissState.Spent;
    } else if (st === NearMissState.Armed) {
      const reach = gapM + rad;
      if (d2 <= reach * reach) {
        st = fast ? NearMissState.PassingFast : NearMissState.Passing;
        npc.nearMissD2[i] = d2;
      }
    } else if (st === NearMissState.Spent) {
      const reach = rearmM + rad;
      if (d2 > reach * reach) st = NearMissState.Armed;
    } else if (d2 < (npc.nearMissD2[i] as number)) {
      // Still closing: this tick is the closest approach so far.
      st = fast ? NearMissState.PassingFast : NearMissState.Passing;
      npc.nearMissD2[i] = d2;
    } else {
      // The gap has stopped shrinking: the closest approach was the last tick that set nearMissD2.
      if (st === NearMissState.PassingFast) awardNearMiss(w, i);
      st = NearMissState.Spent;
    }
    npc.nearMiss[i] = st;
    if (st !== NearMissState.Passing && st !== NearMissState.PassingFast) npc.nearMissD2[i] = 0;

    // Dust: within the cough radius of any live cloud?
    let inDust = false;
    for (let k = 0; k < clouds; k += 1) {
      const slot = (head + k) % cap;
      const ex = (dust.x[slot] as number) - x;
      const ey = (dust.y[slot] as number) - y;
      if (ex * ex + ey * ey <= dustR2) {
        inDust = true;
        break;
      }
    }
    if (!inDust) {
      npc.dustTicks[i] = 0;
      continue;
    }
    let t = (npc.dustTicks[i] as number) + 1;
    if (t >= r.dustEveryTicks) {
      cough(w, i);
      t = 0;
    }
    npc.dustTicks[i] = t;
  }
}

/** A near miss on pedestrian `i`: EV.NearMiss (phase 9 awards its points) and a NearMiss stimulus (header). */
function awardNearMiss(w: World, i: number): void {
  const npc = w.npc;
  const r = w.npcAi.reactions;
  r.nearMisses += 1;
  const e = emitEvent(w.events, EV.NearMiss, i);
  w.events.a[e] = npc.x[i] as number;
  w.events.b[e] = npc.y[i] as number;
  w.events.c[e] = r.nearMissPts;
  const q = w.npcAi.stimuli;
  const s = pushStimulus(q, Stimulus.NearMiss, npcHandle(npc, i));
  q.x[s] = w.vehicle.xM;
  q.y[s] = w.vehicle.yM;
  q.radiusM[s] = 0;
}

/** Pedestrian `i` coughs in the dust: the Dust penalty fact, EV.Cough and a Cough stimulus (header). */
function cough(w: World, i: number): void {
  const npc = w.npc;
  const r = w.npcAi.reactions;
  r.coughs += 1;
  const p = pushPenalty(w.penalties, Offence.Dust, r.dustPts, 0);
  w.penalties.x[p] = npc.x[i] as number;
  w.penalties.y[p] = npc.y[i] as number;
  const e = emitEvent(w.events, EV.Cough, i);
  w.events.a[e] = npc.x[i] as number;
  w.events.b[e] = npc.y[i] as number;
  w.events.c[e] = npc.kind[i] as number;
  const q = w.npcAi.stimuli;
  const s = pushStimulus(q, Stimulus.Cough, npcHandle(npc, i));
  q.x[s] = npc.x[i] as number;
  q.y[s] = npc.y[i] as number;
  q.radiusM[s] = 0;
}

/**
 * Phase 7, after the spawner and before deliverStimuli: the tick's stimuli, then actor contact, then the
 * street-life rules (near misses and dust coughs; header), then the puddle splashes (splash.ts, SSP-094).
 */
export function stepReactions(w: World): void {
  pushReactionStimuli(w);
  stepActorContacts(w);
  stepStreetLife(w);
  stepPuddleSplash(w);
}
