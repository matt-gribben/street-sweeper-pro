// The dog walker and the dog on its lead (ENTITY_CATALOG §3.2, §6.1–§6.2; TECHNICAL_DESIGN §9.4, §11.1;
// LEVEL_DESIGN §9.1; SSP-086). One behaviour serves both: the spawner gives every npc.dog_walker its dog, a
// Companion NPC of the walker's kind tied to it both ways by `link` (generation-checked handles, store.ts), and
// the two share this module, which tells them apart by `origin`. The dog is a child actor of the walker, not a
// catalog entity: it renders with the npc.dog_loose grid and a coat ramp swap (ART_BIBLE §5.6, SSP-103). Rules
// come from entities.json npc.dog_walker `rules`: leadMaxM 5, messEveryMinS 40 / MaxS 60, tanglePts −150 and
// tangleComplaints 1.
//
// The walker is the generic pedestrian (pedestrian.ts) with three additions:
//   - Route. A named walker (origin Named) with a spawns.npc route of two or more nodes walks it node by node
//     (`routeAt` is the route node it walks to next), round again when the route loops, and wanders like any
//     pedestrian once a route that does not loop is done. Ambient walkers, and a one-node route, wander.
//     Reactions (startle, yield, fall, angry) interrupt the route; it resumes towards the same node.
//   - The lead, a line obstacle: the segment from the walker's centre to the dog's (no physical collision). At
//     the start of the walker's tick, Bessie's body OBB (after phase 3) is tested against it. The tick the
//     overlap starts (LEAD_CROSSED clear before it) is a Lead Tangle, unless the walker or the dog is in a
//     contact episode with her (either's ignore window open, or the walker FALLEN: then the crossing is part of
//     that hit or bump): a penalty fact (Offence.Tangle, tanglePts and tangleComplaints, at the middle of the
//     stretch of lead under her body, which phase 9 files the same tick), EV.LeadTangle (audio: dog_bark, then
//     ped_oi 120 ms after, M5), the walker spins (Startle, from Walk, Cross, Idle or Yield) and a Tangle
//     stimulus tells the dog, which barks from the next tick. LEAD_CROSSED stays set while she overlaps the lead
//     and clears on the first tick she does not, so she must leave the whole segment before another Tangle
//     counts (the re-arm decided in SSP-086).
//   - It never pulls the lead past leadMaxM: a step that would leave it farther than leadMaxM from its dog (and
//     farther than it stood) is taken back (it stands that tick, held by the dog).
//
// The dog (states DOG, appended after the PED states so `state` alone picks its animation: Roam walks, Sit sits,
// Bark barks):
//   Roam  trots at DOG_ROAM_MPS towards a point DOG_AHEAD_M ahead of the walker along the walker's heading,
//         swaying up to DOG_SWAY_M to either side (a triangle wave over DOG_SWAY_PERIOD_TICKS), so the lead
//         swings across the pavement; towards the point straight ahead when the swayed one is somewhere it may
//         not stand, and
//         straight back to the walker when that is not standable either or when it is more than DOG_HEEL_M
//         from the walker. It steers round props and other NPCs like everyone else (steering.ts) and, while
//         the walker is on a crossing edge, may use that crossing's corridor (it takes the walker's crossEdge
//         until it is back on a nav tile). Like the walker, it never steps farther than leadMaxM from it, so
//         the lead never stretches past 5 m.
//   Sit   DOG_SIT_TICKS after dropping a litter.dog_mess.
//   Bark  DOG_BARK_TICKS on a Tangle, a Hit or a Bump stimulus (bark frames loop, ART_BIBLE §10.2).
// Dog mess: on the dog's first tick (its spawn tick) its next mess is due messEveryMinS..MaxS × 60 ticks later
// (one `npc` stream draw, `dueTick`); from then on, on the first Roam tick at or after it on which the dog's
// centre is on a pavement or grass tile (LEVEL_DESIGN §9.1 rule 5), it drops one there (a rotation draw) through
// litter.ts addLitterAt, so it counts in litter spawned and Tidy %, sits, and draws the next due tick. Anywhere else (a road crossing, cobbles, an alley) the drop waits.
// Brushing up over it later makes stain.splat (−20, stains.ts).
//
// Hitting the dog is the walker's animal hit (−300, 1 C: the dog carries the walker's kind) and shares one
// contact episode with the walker (reactions.ts), so hitting both costs one hit (decided in SSP-086; the
// catalog leaves the dog unspecified).
//
// The numbers DOG_* below are not in any doc: SSP-086 chose them (TBD (M3 tuning), owner to review).
//
// Hot path: no allocation, no closures per tick; positions cross calls only through typed arrays.
import { createObb, type Obb, refreshObbAxes } from '../../collision/obb.ts';
import { Offence } from '../../complaints.ts';
import { TILE_M } from '../../constants.ts';
import { LITTER_IDS, NPC_IDS } from '../../entities.ts';
import { EV, emitEvent } from '../../eventQueue.ts';
import { cos, sin } from '../../fmath.ts';
import { addLitterAt, LITTER_ROTATIONS } from '../../litter.ts';
import { Ground, type NamedNpc } from '../../map.ts';
import { pushPenalty } from '../../penalties.ts';
import { nextInt } from '../../rng.ts';
import type { World } from '../../world.ts';
import { type Behaviour, Stimulus } from '../behaviour.ts';
import {
  beginSteer,
  moveNpc,
  NavState,
  requestNavPath,
  STEER_TILE,
  steerArrive,
  steerAvoidProps,
  steerSeparate,
  walkNpc,
} from '../steering.ts';
import { pushStimulus } from '../stimuli.ts';
import {
  NPC_FLAG,
  NpcOrigin,
  type NpcStoreView,
  resolveNpcHandle,
  setNpcState,
  updateNpcCell,
} from '../store.ts';
import {
  enterPedestrianState,
  PED,
  pedestrianStimulus,
  STARTLE_TICKS,
  tickPedestrian,
  wantsToYield,
} from './pedestrian.ts';

/** The dog's states, after the PED states the walker uses. Hashed (store `state`): append, never renumber. */
export const DOG = { Roam: 8, Sit: 9, Bark: 10 } as const;
export type DogState = (typeof DOG)[keyof typeof DOG];

/** The dog's trotting speed, m/s: faster than the walker's 1.2 so it gets ahead (TBD (M3 tuning)). */
export const DOG_ROAM_MPS = 2;
/** How far ahead of the walker the dog trots, metres. */
export const DOG_AHEAD_M = 3;
/** How far to either side of the walker's line the dog sways, metres. */
export const DOG_SWAY_M = 1.25;
/** One full sway, left and back, ticks (5 s). */
export const DOG_SWAY_PERIOD_TICKS = 300;
/** Farther than this from the walker, the dog heads straight back to it, metres. */
export const DOG_HEEL_M = 4;
/** The dog sits this long after a mess, ticks (1 s). */
export const DOG_SIT_TICKS = 60;
/** A bark: 2 frames × 6 ticks, 4 times round (ART_BIBLE §10.2), ticks. */
export const DOG_BARK_TICKS = 48;

/** NPC_IDS index of npc.dog_walker. */
export const DOG_WALKER_KIND = (NPC_IDS as readonly string[]).indexOf('npc.dog_walker');
/** LITTER_IDS index of litter.dog_mess. */
const DOG_MESS_KIND = (LITTER_IDS as readonly string[]).indexOf('litter.dog_mess');

// Per-call scratch, shared by every World (used within one call only): a steering target, a position for
// addLitterAt, the crossing point of a lead, Bessie's body box.
const targetX = new Float64Array(1);
const targetY = new Float64Array(1);
const dropAt = new Float64Array(2);
const crossing = new Float64Array(2);
const bessieObb: Obb = createObb();

// ---------------------------------------------------------------------------------------------------------
// Read-only helpers (the renderer draws the lead from them, SSP-103)
// ---------------------------------------------------------------------------------------------------------

/**
 * The store index of the dog on dog walker `i`'s lead, or −1 when `i` is not a dog walker (or is the dog itself)
 * or its dog is gone. The lead runs from the walker to that dog.
 */
export function leadDog(npc: NpcStoreView, i: number): number {
  if ((npc.kind[i] as number) !== DOG_WALKER_KIND || npc.origin[i] === NpcOrigin.Companion) return -1;
  return resolveNpcHandle(npc, npc.link[i] as number);
}

/**
 * Write dog walker `i`'s lead segment into `out` (walker centre x, y, then dog centre x, y, metres; the
 * endpoints the Tangle test uses) and return true; false (out untouched) when `i` has no lead (leadDog).
 */
export function leadEnds(npc: NpcStoreView, i: number, out: Float64Array): boolean {
  const d = leadDog(npc, i);
  if (d < 0) return false;
  out[0] = npc.x[i] as number;
  out[1] = npc.y[i] as number;
  out[2] = npc.x[d] as number;
  out[3] = npc.y[d] as number;
  return true;
}

/**
 * Whether the segment (xs[a], ys[a]) → (xs[b], ys[b]) overlaps `obb` (edges inclusive; Liang–Barsky clipping in
 * the box's frame). On true, `out[0]`, `out[1]` is the middle of the stretch inside the box. Allocation-free.
 */
export function segmentOverlapsObb(
  obb: Obb,
  xs: Float64Array,
  ys: Float64Array,
  a: number,
  b: number,
  out: Float64Array,
): boolean {
  const ax = (xs[a] as number) - obb.cx;
  const ay = (ys[a] as number) - obb.cy;
  const sx = (xs[b] as number) - (xs[a] as number);
  const sy = (ys[b] as number) - (ys[a] as number);
  // Box frame: u along the right axis, v along the forward axis.
  const u0 = ax * obb.rightX + ay * obb.rightY;
  const v0 = ax * obb.forwardX + ay * obb.forwardY;
  const du = sx * obb.rightX + sy * obb.rightY;
  const dv = sx * obb.forwardX + sy * obb.forwardY;
  const hw = obb.halfWidthM;
  const hl = obb.halfLengthM;
  let t0 = 0;
  let t1 = 1;
  for (let k = 0; k < 4; k += 1) {
    let p: number;
    let q: number;
    if (k === 0) {
      p = -du;
      q = u0 + hw;
    } else if (k === 1) {
      p = du;
      q = hw - u0;
    } else if (k === 2) {
      p = -dv;
      q = v0 + hl;
    } else {
      p = dv;
      q = hl - v0;
    }
    // Compared on every pass, not only inside the rare case below (the lead exactly parallel to a box edge, or
    // of zero length): a compare first reached late in a run deoptimised this hot path for want of type
    // feedback and boxed doubles until it was re-optimised, failing the npcAlloc heap check (SSP-095 merge).
    const outside = q < 0;
    if (p === 0) {
      if (outside) return false;
      continue;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
  }
  const t = (t0 + t1) * 0.5;
  out[0] = (xs[a] as number) + sx * t;
  out[1] = (ys[a] as number) + sy * t;
  return true;
}

// ---------------------------------------------------------------------------------------------------------
// The lead
// ---------------------------------------------------------------------------------------------------------

/** Whether Bessie's body overlaps the lead from walker `i` to dog `d` this tick (crossing point in `crossing`). */
function bessieOnLead(w: World, i: number, d: number): boolean {
  const npc = w.npc;
  const v = w.vehicle;
  const body = w.tuning.vehicle.sweeper.body;
  const hw = body.widthM * 0.5;
  const hl = body.lengthM * 0.5;
  // Quick reject: the lead's box against her bounding circle.
  const reach = hw + hl;
  const wx = npc.x[i] as number;
  const wy = npc.y[i] as number;
  const dx = npc.x[d] as number;
  const dy = npc.y[d] as number;
  if ((wx < dx ? wx : dx) > v.xM + reach || (wx > dx ? wx : dx) < v.xM - reach) return false;
  if ((wy < dy ? wy : dy) > v.yM + reach || (wy > dy ? wy : dy) < v.yM - reach) return false;
  const obb = bessieObb;
  obb.cx = v.xM;
  obb.cy = v.yM;
  obb.headingRad = v.headingRad;
  obb.halfWidthM = hw;
  obb.halfLengthM = hl;
  refreshObbAxes(obb);
  return segmentOverlapsObb(obb, npc.x, npc.y, i, d, crossing);
}

/** Walker `i` or dog `d` is in a contact episode with Bessie (a window open, or FALLEN). */
function inContactEpisode(w: World, i: number, d: number): boolean {
  const npc = w.npc;
  if ((npc.contactIgnore[i] as number) > 0 || (npc.contactIgnore[d] as number) > 0) return true;
  return (((npc.flags[i] as number) | (npc.flags[d] as number)) & NPC_FLAG.FALLEN) !== 0;
}

/** The Lead Tangle of walker `i` and dog `d`, at `crossing` (see the file comment). */
function leadTangle(w: World, i: number, d: number): void {
  const npc = w.npc;
  const rules = w.npcAi.entities.npcs['npc.dog_walker'].rules;
  const p = pushPenalty(w.penalties, Offence.Tangle, rules.tanglePts, rules.tangleComplaints);
  w.penalties.x[p] = crossing[0] as number;
  w.penalties.y[p] = crossing[1] as number;
  const e = emitEvent(w.events, EV.LeadTangle, i);
  w.events.a[e] = crossing[0] as number;
  w.events.b[e] = crossing[1] as number;
  w.events.c[e] = d;
  const s = npc.state[i] as number;
  if (s === PED.Walk || s === PED.Cross || s === PED.Idle || s === PED.Yield) {
    enterPedestrianState(w, i, PED.Startle, STARTLE_TICKS);
  }
  const q = w.npcAi.stimuli;
  const k = pushStimulus(q, Stimulus.Tangle, npc.link[i] as number);
  q.x[k] = crossing[0] as number;
  q.y[k] = crossing[1] as number;
  q.radiusM[k] = 0;
}

/** Walker `i`'s Tangle test against its dog `d` (see the file comment). */
function checkLead(w: World, i: number, d: number): void {
  const npc = w.npc;
  const f = npc.flags[i] as number;
  if (bessieOnLead(w, i, d)) {
    if ((f & NPC_FLAG.LEAD_CROSSED) !== 0) return;
    npc.flags[i] = f | NPC_FLAG.LEAD_CROSSED;
    if (!inContactEpisode(w, i, d)) leadTangle(w, i, d);
  } else if ((f & NPC_FLAG.LEAD_CROSSED) !== 0) {
    npc.flags[i] = f & ~NPC_FLAG.LEAD_CROSSED;
  }
}

/**
 * Keep NPC `i` within leadMaxM of `other`, the other end of its lead: when this tick's step took it farther than
 * leadMaxM and farther than it stood, take the step back. Where it stood it was within reach of `other` (whose own
 * step was held to it), so the lead never stretches past leadMaxM; a pair put farther apart (a test, a teleport)
 * may still close the gap.
 */
function keepOnLead(w: World, i: number, other: number): void {
  const npc = w.npc;
  const max = w.npcAi.entities.npcs['npc.dog_walker'].rules.leadMaxM;
  const ox = npc.x[other] as number;
  const oy = npc.y[other] as number;
  const dx = (npc.x[i] as number) - ox;
  const dy = (npc.y[i] as number) - oy;
  const d2 = dx * dx + dy * dy;
  if (d2 <= max * max) return;
  const px = (npc.prevX[i] as number) - ox;
  const py = (npc.prevY[i] as number) - oy;
  if (d2 <= px * px + py * py) return;
  npc.x[i] = npc.prevX[i] as number;
  npc.y[i] = npc.prevY[i] as number;
  npc.speed[i] = 0;
  updateNpcCell(npc, i);
}

// ---------------------------------------------------------------------------------------------------------
// The walker
// ---------------------------------------------------------------------------------------------------------

/** The named route walker `i` walks, or null when it has none to walk (ambient, a one-node route, or done). */
function routeOf(w: World, i: number): NamedNpc | null {
  const npc = w.npc;
  if (npc.origin[i] !== NpcOrigin.Named) return null;
  const spec = w.level.npc;
  const g = npc.group[i] as number;
  if (spec === null || g < 0 || g >= spec.named.length) return null;
  const named = spec.named[g] as NamedNpc;
  if (named.route.length < 2 || (npc.routeAt[i] as number) >= named.route.length) return null;
  return named;
}

/** Stand: separation only. */
function stand(w: World, i: number): void {
  beginSteer(w);
  steerSeparate(w, i);
  moveNpc(w, i);
}

/** Walk and Cross on a route: on to the route node `routeAt`, the next one once there (see the file comment). */
function walkRoute(w: World, i: number, named: NamedNpc): void {
  const npc = w.npc;
  const route = named.route;
  const len = route.length;
  let at = npc.routeAt[i] as number;
  const ns = npc.navState[i] as number;
  let request = false;
  if (at < 0) {
    at = 0;
    request = true;
  } else if (ns === NavState.NoPath || (ns === NavState.Arrived && npc.goalNode[i] === route[at])) {
    at += 1;
    if (at >= len) {
      if (!named.loop) {
        // The route is done: from now on it wanders.
        npc.routeAt[i] = len;
        tickPedestrian(w, i, false);
        return;
      }
      at = 0;
    }
    request = true;
  } else if (ns === NavState.Idle || ns === NavState.Arrived || npc.goalNode[i] !== route[at]) {
    // Not under way to the route node (a reaction left it idle, or sent it elsewhere): set off for it.
    request = true;
  }
  npc.routeAt[i] = at;
  if (request && !requestNavPath(w, i, route[at] as number)) {
    stand(w, i);
    return;
  }
  walkNpc(w, i, false);
  const onCrossing = npc.navState[i] === NavState.Crossing;
  const state = npc.state[i] as number;
  if (onCrossing && state === PED.Walk) enterPedestrianState(w, i, PED.Cross, 0);
  else if (!onCrossing && state === PED.Cross) enterPedestrianState(w, i, PED.Walk, 0);
}

function tickWalker(w: World, i: number): void {
  const npc = w.npc;
  const dog = resolveNpcHandle(npc, npc.link[i] as number);
  if (dog >= 0) checkLead(w, i, dog);
  const s = npc.state[i] as number;
  const named = s === PED.Walk || s === PED.Cross ? routeOf(w, i) : null;
  if (named !== null && !wantsToYield(w, i)) walkRoute(w, i, named);
  else tickPedestrian(w, i, false);
  if (dog >= 0) keepOnLead(w, i, dog);
}

// ---------------------------------------------------------------------------------------------------------
// The dog
// ---------------------------------------------------------------------------------------------------------

function enterDogState(w: World, d: number, state: number, limit: number): void {
  setNpcState(w.npc, d, state);
  w.npc.stateLimit[d] = limit;
}

/** Ticks until the next mess: messEveryMinS..MaxS × 60, one `npc` stream draw. */
function messInterval(w: World): number {
  const rules = w.npcAi.entities.npcs['npc.dog_walker'].rules;
  const min = Math.round(rules.messEveryMinS * 60);
  const max = Math.round(rules.messEveryMaxS * 60);
  return min + nextInt(w.npcAi.rng, max - min + 1);
}

/** Whether (targetX, targetY) is somewhere dog `d` may stand: a nav tile, or its crossing's corridor. */
function dogMayStand(w: World, d: number): boolean {
  const st = w.npcAi.steering;
  const tx = Math.floor((targetX[0] as number) / TILE_M);
  const ty = Math.floor((targetY[0] as number) / TILE_M);
  if (!(tx >= 0 && ty >= 0 && tx < st.widthTiles && ty < st.heightTiles)) return false;
  const t = ty * st.widthTiles + tx;
  if (((st.tileFlags[t] as number) & STEER_TILE.BLOCKED) !== 0) return false;
  if ((st.tileNode[t] as number) >= 0) return true;
  const e = w.npc.crossEdge[d] as number;
  return (
    e >= 0 &&
    tx >= (st.corridorX0[e] as number) &&
    tx <= (st.corridorX1[e] as number) &&
    ty >= (st.corridorY0[e] as number) &&
    ty <= (st.corridorY1[e] as number)
  );
}

/** Whether (dropAt[0], dropAt[1]) is on a pavement or grass tile (LEVEL_DESIGN §9.1 rule 5). */
function messGround(w: World): boolean {
  const level = w.level;
  const tx = Math.floor((dropAt[0] as number) / TILE_M);
  const ty = Math.floor((dropAt[1] as number) / TILE_M);
  const wt = level.size[0];
  if (!(tx >= 0 && ty >= 0 && tx < wt && ty < level.size[1])) return false;
  const g = level.layers.ground[ty * wt + tx] as number;
  return g === Ground.Pavement || g === Ground.Grass;
}

/** Drop a litter.dog_mess under dog `d` if it is due and the ground allows; true when it dropped one. */
function tryMess(w: World, d: number): boolean {
  const npc = w.npc;
  if (w.tick < (npc.dueTick[d] as number)) return false;
  dropAt[0] = npc.x[d] as number;
  dropAt[1] = npc.y[d] as number;
  if (!messGround(w)) return false;
  addLitterAt(w.litter, DOG_MESS_KIND, dropAt, nextInt(w.npcAi.rng, LITTER_ROTATIONS));
  npc.dueTick[d] = w.tick + messInterval(w);
  return true;
}

/** Roam: trot ahead of walker `k` on the lead (see the file comment). */
function roamStep(w: World, d: number, k: number): void {
  const npc = w.npc;
  // On the walker's crossing with it; off it once back on a nav tile.
  const e = npc.crossEdge[k] as number;
  if (e >= 0 && npc.navState[k] !== NavState.KerbWait) npc.crossEdge[d] = e;
  else if ((npc.crossEdge[d] as number) >= 0) {
    const st = w.npcAi.steering;
    const tx = Math.floor((npc.x[d] as number) / TILE_M);
    const ty = Math.floor((npc.y[d] as number) / TILE_M);
    if (
      tx >= 0 &&
      ty >= 0 &&
      tx < st.widthTiles &&
      ty < st.heightTiles &&
      (st.tileNode[ty * st.widthTiles + tx] as number) >= 0
    ) {
      npc.crossEdge[d] = -1;
    }
  }
  npc.walkMps[d] = DOG_ROAM_MPS;
  const wx = npc.x[k] as number;
  const wy = npc.y[k] as number;
  const ox = (npc.x[d] as number) - wx;
  const oy = (npc.y[d] as number) - wy;
  // The trig runs on every call, heeling or not, so its call sites are never cold (TECHNICAL_DESIGN §17, trap b).
  const h = npc.heading[k] as number;
  const fx = sin(h);
  const fy = -cos(h);
  // The sway is a triangle wave, −1..1 over DOG_SWAY_PERIOD_TICKS, phased by the dog's handle slot.
  let f =
    ((w.tick + (npc.handleSlot[d] as number) * 37) % DOG_SWAY_PERIOD_TICKS) / DOG_SWAY_PERIOD_TICKS - 0.5;
  if (f < 0) f = -f;
  const sway = (4 * f - 1) * DOG_SWAY_M;
  let heel = ox * ox + oy * oy > DOG_HEEL_M * DOG_HEEL_M;
  if (!heel) {
    // Right = (−forward y, forward x) = (cos h, sin h).
    targetX[0] = wx + fx * DOG_AHEAD_M - fy * sway;
    targetY[0] = wy + fy * DOG_AHEAD_M + fx * sway;
    if (!dogMayStand(w, d)) {
      targetX[0] = wx + fx * DOG_AHEAD_M;
      targetY[0] = wy + fy * DOG_AHEAD_M;
      if (!dogMayStand(w, d)) heel = true;
    }
  }
  if (heel) {
    targetX[0] = wx;
    targetY[0] = wy;
  }
  beginSteer(w);
  steerArrive(w, d, targetX, targetY, 0);
  steerAvoidProps(w, d);
  steerSeparate(w, d);
  moveNpc(w, d);
}

function tickDog(w: World, d: number): void {
  const npc = w.npc;
  const walker = resolveNpcHandle(npc, npc.link[d] as number);
  if ((npc.state[d] as number) < DOG.Roam) enterDogState(w, d, DOG.Roam, 0);
  if ((npc.dueTick[d] as number) < 0) npc.dueTick[d] = w.tick + messInterval(w);
  const t = npc.stateTicks[d] as number;
  switch (npc.state[d] as number) {
    case DOG.Sit:
    case DOG.Bark:
      npc.speed[d] = 0;
      if (t >= (npc.stateLimit[d] as number)) enterDogState(w, d, DOG.Roam, 0);
      break;
    default:
      if (tryMess(w, d)) {
        npc.speed[d] = 0;
        enterDogState(w, d, DOG.Sit, DOG_SIT_TICKS);
      } else if (walker >= 0) {
        roamStep(w, d, walker);
      } else {
        npc.speed[d] = 0;
      }
      break;
  }
  if (walker >= 0) keepOnLead(w, d, walker);
}

function dogStimulus(w: World, d: number, s: Stimulus): void {
  if (s === Stimulus.Tangle || s === Stimulus.Hit || s === Stimulus.Bump) {
    w.npc.speed[d] = 0;
    enterDogState(w, d, DOG.Bark, DOG_BARK_TICKS);
  }
}

/** npc.dog_walker: the walker, and the dog on its lead (origin Companion). */
export const dogWalkerBehaviour: Behaviour = {
  initial: PED.Walk,
  jaywalks: false,
  tick(w: World, i: number): void {
    if (w.npc.origin[i] === NpcOrigin.Companion) tickDog(w, i);
    else tickWalker(w, i);
  },
  onStimulus(w: World, i: number, s: Stimulus): void {
    if (w.npc.origin[i] === NpcOrigin.Companion) dogStimulus(w, i, s);
    else pedestrianStimulus(w, i, s, false);
  },
};
