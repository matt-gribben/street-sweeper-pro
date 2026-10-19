// The shared reaction rules of phase 7 (ENTITY_CATALOG §3.2, §3.4; TECHNICAL_DESIGN §9.4, §11.1; SSP-082): the
// stimuli the sim pushes to the NPCs every tick, and Bessie's contact with the actors' circles. What an NPC does
// with a stimulus is its behaviour's business (the generic pedestrian in behaviours/pedestrian.ts, and the
// per-type modules that extend it); this file only decides who is told what, and applies the hit penalty.
//
// Phase 7 calls stepReactions once, after the spawner and before deliverStimuli: pushReactionStimuli, then
// stepActorContacts. One entry point rather than two calls in the World's phase: with two, V8's inlining of the
// whole tick into World.step grew enough that it tiered up inside the m1_drive_puddle_lane replay's measured
// window and broke the §17 heap check (37 KB pre-final-GC; 16.7 KB with one call, as before SSP-082).
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
import { STEER_TILE } from './steering.ts';
import { pushStimulus, STIMULUS_EVERYONE } from './stimuli.ts';
import { NO_NPC_HANDLE, NPC_FLAG, npcHandle, queryNpcs, resolveNpcHandle } from './store.ts';

/** Dropped items land this far from the actor's centre at least, metres. */
export const DROP_MIN_M = 0.4;
/** …and at most this far. */
export const DROP_MAX_M = 1.2;

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
}

/** The reaction state for a shift on `tuning` and `entities`, for a store of `capacity`. Setup only. */
export function createReactions(tuning: Tuning, entities: Entities, capacity: number): Reactions {
  const kinds = NPC_IDS.length;
  const hasHit = new Uint8Array(kinds);
  const hitPts = new Int32Array(kinds);
  const hitComplaints = new Uint8Array(kinds);
  const yields = new Uint8Array(kinds);
  const dropStart = new Int32Array(kinds + 1);
  const litter: number[] = [];
  const counts: number[] = [];
  for (let k = 0; k < kinds; k += 1) {
    const e = entities.npcs[NPC_IDS[k] as (typeof NPC_IDS)[number]];
    yields[k] = e.yields ? 1 : 0;
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

/** Phase 7, after the spawner: clear the tick's stimulus marks and push Horn, HiVis and BeaconYield (header). */
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

/** Phase 7, after the spawner and before deliverStimuli: the tick's stimuli, then actor contact (header). */
export function stepReactions(w: World): void {
  pushReactionStimuli(w);
  stepActorContacts(w);
}
