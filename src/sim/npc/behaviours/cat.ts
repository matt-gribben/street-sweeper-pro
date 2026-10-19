// npc.cat (ENTITY_CATALOG §7.2, TECHNICAL_DESIGN §11.3, ART_BIBLE §10.2; SSP-087): perches on walls and parked car
// roofs, darts across the road when Bessie approaches, grooms mid-road, bolts at the horn, and when hit leaps onto
// Bessie's roof, rides it for 3 s and hops off. The cat is never hurt (CLAUDE.md rule 11). Its numbers are
// entities.json `npc.cat.rules`, in ticks and metres in `npcAi.cat.params`; where it may sit, groom and run is
// npc/catPerches.ts (the perch indices, tile targets and searches named below).
//
// Columns (store.ts): `timerB` is where the cat sits or runs to (a perch index, claimed; a tile target; or
// NO_TARGET); `timerA` the state's countdown (below). `speed` is its running speed while it moves and 0 while it
// sits, so the renderer picks `sit` or `walk`/`dart` frames from `state`, `stateTicks` and `speed`.
//
// Every tick, before its state: the **approach latch** (NPC_FLAG.DODGED, the per-approach latch SSP-084 added).
// d = the distance from the cat's centre to Bessie's body centre. While d > dartMaxM (10 m) the latch is clear
// (armed). The first tick d ≤ dartMaxM with the latch clear sets it, consuming the approach, and if the cat is
// then in Perch with d ≥ dartMinM (6 m) it rolls once (one `npc` nextFloat; a dart below dartChance, 40%). So an
// approach rolls at most once, staying inside the band never re-rolls, and only going back beyond 10 m re-arms it;
// an approach that finds the cat busy (or comes closer than 6 m before the roll) is spent with no roll.
//
// States (CAT; hashed in `state`: append, never renumber):
//   Perch      sits (sit frames) on its perch (timerB), or on a pavement tile after a dart (NO_TARGET). timerA
//              counts down the groom idle timer, armed on every entry to groomIdleMinS..MaxS (20–40 s; one draw);
//              at 0 it picks a grooming spot (catPerches pickGroomSpot) and goes to Groom, else it re-arms. A dart
//              roll that succeeds and finds a far side (catPerches findDartTarget) frees its perch, claims the
//              target and starts Dart. Horn or Bump → Bolt.
//   Dart       runs straight across the road at its entities.json speed (6.0 m/s, the jaywalk; dart frames) to the
//              far side; there, Perch. Horn and Bump leave it running.
//   Groom      walks out at walkSpeedMps (1.0 m/s, walk frames) to the spot (timerA holds groomS × 60 = 600 ticks
//              while it walks), sits grooming (sit frames) while timerA counts down, then walks back to cover
//              (catPerches findCover, timerA 0; no cover: it grooms another second and looks again); at the cover,
//              Perch. Horn, Bump or Bessie's centre within boltNearM (4 m) → Bolt.
//   Bolt       runs at boltSpeedMps (7.0 m/s, dart frames) to cover away from Bessie (findCover with `away`; a
//              perched cat with no other cover stays where it is); there, Perch.
//   LeapOnRoof a Hit (Bessie at ≥ 1.0 m/s closing speed: the shared −300, 1 complaint and EV.NpcHit with the cat's
//              kind for cat_yowl and "Not the cat!", npc/reactions.ts) in Perch, Dart, Groom, Bolt or HopOff's
//              run. ON_ROOF is set from here to the end of HopOff's leap, so contact ignores it. The leap frames:
//              squash LEAP_SQUASH_TICKS (4; it moves with Bessie), stretch LEAP_STRETCH_TICKS (6; it closes on the
//              roof seat, reaching it on the last), land LEAP_LAND_TICKS (6; on the seat): LEAP_TICKS = 16.
//   RideRoof   rideS × 60 = 180 ticks on the seat: its pose is parented to Bessie's, the seat's local offset
//              (0 right, seatForwardM ahead of her body centre) put through her pose every tick, heading hers.
//              The renderer draws it on layer 9 with sit frames (SSP-103).
//   HopOff     the leap again, off the roof (16 ticks: squash on the seat, stretch to a landing point beside her,
//              land there), to her left, else right, else behind, else in front (the first not on a NO_GO tile;
//              timerA holds the side). Then ON_ROOF clears, the contact window opens (actorHit.ignoreContactS) and
//              it runs at boltSpeedMps to cover (findCover; dart frames), looking again every second while there
//              is none; there, Perch.
// The diagrams draw Hit only from Dart and Groom, the cat's states on the road; a cat bolting or running back
// across the road is on the road too, so a hit there is the same leap (decided in SSP-087). A cat on its perch
// cannot be reached (a wall is solid, a roof perch sits inside the parked car's body), but would leap the same.
//
// Hot path: no allocation, no closures, no double crosses a call (helpers take the World and an index).
import { SIM_HZ } from '../../constants.ts';
import { atan2, cos, sin, sqrt } from '../../fmath.ts';
import { nextFloat, nextInt } from '../../rng.ts';
import type { World } from '../../world.ts';
import { type Behaviour, Stimulus } from '../behaviour.ts';
import {
  CAT_TILE,
  catTargetPos,
  catTileAtScratch,
  claimCatPerch,
  findCover,
  findDartTarget,
  NO_TARGET,
  pickGroomSpot,
  releaseCatPerch,
  TILE_TARGET,
} from '../catPerches.ts';
import { NPC_FLAG, npcHandle, setNpcState, updateNpcCell } from '../store.ts';

/** The cat's states (TECHNICAL_DESIGN §11.1). Hashed (store `state`): append, never renumber. */
export const CAT = { Perch: 0, Dart: 1, Groom: 2, Bolt: 3, LeapOnRoof: 4, RideRoof: 5, HopOff: 6 } as const;
// catPerches.ts CAT_GROOM_STATE mirrors CAT.Groom (tests/unit/behaviours/cat.test.ts checks they agree).
export type CatState = (typeof CAT)[keyof typeof CAT];

/** The leap frames (ART_BIBLE §10.2): squash 4, stretch 6, land 6 ticks. */
export const LEAP_SQUASH_TICKS = 4;
export const LEAP_STRETCH_TICKS = 6;
export const LEAP_LAND_TICKS = 6;
/** One leap, onto the roof or off it: 16 ticks. */
export const LEAP_TICKS = LEAP_SQUASH_TICKS + LEAP_STRETCH_TICKS + LEAP_LAND_TICKS;
/** A cat with nowhere to run looks again this often, ticks. */
export const CAT_RETRY_TICKS = SIM_HZ;
/** A hop lands this far clear of Bessie's body, beyond the cat's radius, metres. */
export const HOP_CLEAR_M = 0.3;

/** Arm the groom idle timer: groomIdleMinS..MaxS in ticks (one `npc` draw). */
function armIdle(w: World, i: number): void {
  const p = w.npcAi.cat.params;
  w.npc.timerA[i] = p.groomIdleMinTicks + nextInt(w.npcAi.rng, p.groomIdleMaxTicks - p.groomIdleMinTicks + 1);
}

/** Perch at the current target (a tile target becomes NO_TARGET: it sits there holding nothing). */
function enterPerch(w: World, i: number): void {
  const npc = w.npc;
  setNpcState(npc, i, CAT.Perch);
  npc.speed[i] = 0;
  if ((npc.timerB[i] as number) < 0) npc.timerB[i] = NO_TARGET;
  armIdle(w, i);
}

/** How a cat runs (runToTarget): its dart speed (entities.json `speed`), its bolt speed, or walking. */
const PACE = { Dart: 0, Bolt: 1, Walk: 2 } as const;

/**
 * Move NPC `i` straight towards its target (timerB) at `pace` (PACE). True when it is there (snapped onto it), or
 * has no target. Speed and heading follow the move. Takes the pace as an integer so no double crosses the call.
 */
function runToTarget(w: World, i: number, pace: number): boolean {
  const npc = w.npc;
  const c = w.npcAi.cat;
  const mps =
    pace === PACE.Dart
      ? (npc.walkMps[i] as number)
      : pace === PACE.Bolt
        ? c.params.boltMps
        : c.params.walkMps;
  if (!catTargetPos(c, npc.timerB[i] as number)) {
    npc.speed[i] = 0;
    return true;
  }
  const x = npc.x[i] as number;
  const y = npc.y[i] as number;
  const dx = (c.px[0] as number) - x;
  const dy = (c.py[0] as number) - y;
  const d = sqrt(dx * dx + dy * dy);
  const step = mps / SIM_HZ;
  if (d <= step) {
    npc.x[i] = c.px[0] as number;
    npc.y[i] = c.py[0] as number;
    npc.speed[i] = 0;
    updateNpcCell(npc, i);
    return true;
  }
  npc.x[i] = x + (dx / d) * step;
  npc.y[i] = y + (dy / d) * step;
  npc.heading[i] = atan2(dx, -dy);
  npc.speed[i] = mps;
  updateNpcCell(npc, i);
  return false;
}

/** True when NPC `i` stands exactly on its target (runToTarget snaps onto it). */
function atTarget(w: World, i: number): boolean {
  const npc = w.npc;
  const c = w.npcAi.cat;
  if (!catTargetPos(c, npc.timerB[i] as number)) return true;
  return npc.x[i] === c.px[0] && npc.y[i] === c.py[0];
}

/** Start a Bolt from Perch or Groom (see the header). */
function startBolt(w: World, i: number): void {
  const npc = w.npc;
  const c = w.npcAi.cat;
  const h = npcHandle(npc, i);
  const held = npc.timerB[i] as number;
  const perched = npc.state[i] === CAT.Perch;
  // A perched cat holds `held`; a grooming one holds a perch only on its way back (timerA 0).
  const holds = held >= 0 && (perched || (npc.timerA[i] as number) === 0);
  const target = findCover(w, i, true, perched ? held : NO_TARGET);
  if (target !== NO_TARGET) {
    if (holds) releaseCatPerch(c, held, h);
    if (target >= 0) claimCatPerch(c, target, h);
    npc.timerB[i] = target;
  } else if (!perched) {
    if (holds) releaseCatPerch(c, held, h);
    npc.timerB[i] = NO_TARGET;
  }
  setNpcState(npc, i, CAT.Bolt);
  npc.timerA[i] = 0;
}

/** Put the roof seat's world position, through Bessie's pose this tick, into the cat tables' px, py. */
function seatPos(w: World): void {
  const c = w.npcAi.cat;
  const v = w.vehicle;
  const f = c.params.seatForwardM;
  c.px[0] = v.xM + sin(v.headingRad) * f;
  c.py[0] = v.yM - cos(v.headingRad) * f;
}

/** Hop landing side `side` (1 left, 2 right, 3 behind, 4 in front, 0 the seat) through Bessie's pose, into px, py. */
function landingPos(w: World, i: number, side: number): void {
  const c = w.npcAi.cat;
  const v = w.vehicle;
  const body = w.tuning.vehicle.sweeper.body;
  const r = (w.npc.radius[i] as number) + HOP_CLEAR_M;
  let right = 0;
  let forward = c.params.seatForwardM;
  if (side === 1) right = -(body.widthM * 0.5 + r);
  else if (side === 2) right = body.widthM * 0.5 + r;
  else if (side === 3) forward = -(body.lengthM * 0.5 + r);
  else if (side === 4) forward = body.lengthM * 0.5 + r;
  const s = sin(v.headingRad);
  const co = cos(v.headingRad);
  // forward = (s, −c), right = (c, s).
  c.px[0] = v.xM + s * forward + co * right;
  c.py[0] = v.yM - co * forward + s * right;
}

/** Put NPC `i` at (px, py) of the cat tables facing Bessie's heading, at rest. */
function poseAtScratch(w: World, i: number): void {
  const npc = w.npc;
  const c = w.npcAi.cat;
  npc.x[i] = c.px[0] as number;
  npc.y[i] = c.py[0] as number;
  npc.heading[i] = w.vehicle.headingRad;
  npc.speed[i] = 0;
  updateNpcCell(npc, i);
}

/** Close on (px, py) during a leap's stretch: 1 / (ticks left in the stretch) of the way, so its last tick lands. */
function stretchTowardScratch(w: World, i: number, st: number): void {
  const npc = w.npc;
  const c = w.npcAi.cat;
  const k = LEAP_SQUASH_TICKS + LEAP_STRETCH_TICKS - st;
  npc.x[i] = (npc.x[i] as number) + ((c.px[0] as number) - (npc.x[i] as number)) / k;
  npc.y[i] = (npc.y[i] as number) + ((c.py[0] as number) - (npc.y[i] as number)) / k;
  npc.heading[i] = w.vehicle.headingRad;
  npc.speed[i] = 0;
  updateNpcCell(npc, i);
}

/** Find cover for a cat getting off the road (after a groom or a hop) and claim it; NO_TARGET when none. */
function takeCover(w: World, i: number): number {
  const target = findCover(w, i, false, NO_TARGET);
  if (target >= 0) claimCatPerch(w.npcAi.cat, target, npcHandle(w.npc, i));
  w.npc.timerB[i] = target;
  return target;
}

function tickPerch(w: World, i: number): void {
  const npc = w.npc;
  npc.speed[i] = 0;
  const t = npc.timerA[i] as number;
  if (t <= 0) {
    armIdle(w, i);
    return;
  }
  npc.timerA[i] = t - 1;
  if (t > 1) return;
  const spot = pickGroomSpot(w, i);
  if (spot === NO_TARGET) {
    armIdle(w, i);
    return;
  }
  releaseCatPerch(w.npcAi.cat, npc.timerB[i] as number, npcHandle(npc, i));
  npc.timerB[i] = spot;
  setNpcState(npc, i, CAT.Groom);
  npc.timerA[i] = w.npcAi.cat.params.groomTicks;
  tickGroom(w, i);
}

function tickGroom(w: World, i: number): void {
  const npc = w.npc;
  const p = w.npcAi.cat.params;
  const dx = (npc.x[i] as number) - w.vehicle.xM;
  const dy = (npc.y[i] as number) - w.vehicle.yM;
  if (dx * dx + dy * dy <= p.boltNearM * p.boltNearM) {
    startBolt(w, i);
    tickRun(w, i, PACE.Bolt);
    return;
  }
  const t = npc.timerA[i] as number;
  if (t > 0) {
    if (!atTarget(w, i)) {
      runToTarget(w, i, PACE.Walk);
      return;
    }
    npc.speed[i] = 0;
    npc.timerA[i] = t - 1;
    if (t > 1) return;
    const spot = npc.timerB[i] as number;
    if (takeCover(w, i) === NO_TARGET) {
      // Nowhere to go: groom on at the spot, look again in a second.
      npc.timerB[i] = spot;
      npc.timerA[i] = CAT_RETRY_TICKS;
    }
    return;
  }
  if (runToTarget(w, i, PACE.Walk)) enterPerch(w, i);
}

function tickRun(w: World, i: number, pace: number): void {
  if (runToTarget(w, i, pace)) enterPerch(w, i);
}

function tickLeap(w: World, i: number): void {
  const npc = w.npc;
  const st = npc.stateTicks[i] as number;
  if (st >= LEAP_TICKS) {
    setNpcState(npc, i, CAT.RideRoof);
    tickRide(w, i);
    return;
  }
  if (st < LEAP_SQUASH_TICKS) {
    const v = w.vehicle;
    npc.x[i] = (npc.x[i] as number) + (v.xM - v.prevXM);
    npc.y[i] = (npc.y[i] as number) + (v.yM - v.prevYM);
    npc.speed[i] = 0;
    updateNpcCell(npc, i);
    return;
  }
  seatPos(w);
  if (st < LEAP_SQUASH_TICKS + LEAP_STRETCH_TICKS) stretchTowardScratch(w, i, st);
  else poseAtScratch(w, i);
}

function tickRide(w: World, i: number): void {
  const npc = w.npc;
  if ((npc.stateTicks[i] as number) >= w.npcAi.cat.params.rideTicks) {
    startHopOff(w, i);
    return;
  }
  seatPos(w);
  poseAtScratch(w, i);
}

function startHopOff(w: World, i: number): void {
  const npc = w.npc;
  const c = w.npcAi.cat;
  let side = 0;
  for (let s = 1; s <= 4; s += 1) {
    landingPos(w, i, s);
    if (catTileAtScratch(c) !== CAT_TILE.NO_GO) {
      side = s;
      break;
    }
  }
  setNpcState(npc, i, CAT.HopOff);
  npc.timerA[i] = side;
  npc.timerB[i] = NO_TARGET;
  tickHopOff(w, i);
}

function tickHopOff(w: World, i: number): void {
  const npc = w.npc;
  const st = npc.stateTicks[i] as number;
  if (st < LEAP_SQUASH_TICKS) {
    seatPos(w);
    poseAtScratch(w, i);
    return;
  }
  if (st < LEAP_SQUASH_TICKS + LEAP_STRETCH_TICKS) {
    landingPos(w, i, npc.timerA[i] as number);
    stretchTowardScratch(w, i, st);
    return;
  }
  if (st < LEAP_TICKS) {
    npc.speed[i] = 0;
    return;
  }
  if (st === LEAP_TICKS) {
    // Landed: off the roof, the contact window open so a touch straight away is not a new hit.
    npc.flags[i] = (npc.flags[i] as number) & ~NPC_FLAG.ON_ROOF;
    npc.contactIgnore[i] = w.npcAi.reactions.ignoreTicks;
    npc.timerA[i] = 0;
    takeCover(w, i);
  } else if ((npc.timerB[i] as number) === NO_TARGET) {
    npc.speed[i] = 0;
    if ((st - LEAP_TICKS) % CAT_RETRY_TICKS === 0) takeCover(w, i);
    if ((npc.timerB[i] as number) === NO_TARGET) return;
  }
  if ((npc.timerB[i] as number) === NO_TARGET) return;
  if (runToTarget(w, i, PACE.Bolt)) enterPerch(w, i);
}

/** The approach latch and the once-per-approach dart roll (see the header). True when it started a Dart. */
function approach(w: World, i: number): boolean {
  const npc = w.npc;
  const p = w.npcAi.cat.params;
  const dx = (npc.x[i] as number) - w.vehicle.xM;
  const dy = (npc.y[i] as number) - w.vehicle.yM;
  const d2 = dx * dx + dy * dy;
  const f = npc.flags[i] as number;
  if (d2 > p.dartMaxM * p.dartMaxM) {
    if ((f & NPC_FLAG.DODGED) !== 0) npc.flags[i] = f & ~NPC_FLAG.DODGED;
    return false;
  }
  if ((f & NPC_FLAG.DODGED) !== 0) return false;
  npc.flags[i] = f | NPC_FLAG.DODGED;
  if (npc.state[i] !== CAT.Perch || d2 < p.dartMinM * p.dartMinM) return false;
  if (!(nextFloat(w.npcAi.rng) < p.dartChance)) return false;
  const target = findDartTarget(w, i);
  if (target === NO_TARGET) return false;
  const c = w.npcAi.cat;
  const h = npcHandle(npc, i);
  releaseCatPerch(c, npc.timerB[i] as number, h);
  if (target >= 0) claimCatPerch(c, target, h);
  npc.timerB[i] = target;
  setNpcState(npc, i, CAT.Dart);
  npc.timerA[i] = 0;
  return true;
}

function tickCat(w: World, i: number): void {
  approach(w, i);
  const npc = w.npc;
  switch (npc.state[i]) {
    case CAT.Perch:
      tickPerch(w, i);
      return;
    case CAT.Dart:
      tickRun(w, i, PACE.Dart);
      return;
    case CAT.Groom:
      tickGroom(w, i);
      return;
    case CAT.Bolt:
      tickRun(w, i, PACE.Bolt);
      return;
    case CAT.LeapOnRoof:
      tickLeap(w, i);
      return;
    case CAT.RideRoof:
      tickRide(w, i);
      return;
    case CAT.HopOff:
      tickHopOff(w, i);
      return;
    default:
      enterPerch(w, i);
  }
}

/** A Hit: free whatever it holds or runs to and leap onto the roof (see the header). */
function hitCat(w: World, i: number): void {
  const npc = w.npc;
  const state = npc.state[i] as number;
  if (state === CAT.LeapOnRoof || state === CAT.RideRoof) return;
  if (state === CAT.HopOff && (npc.stateTicks[i] as number) < LEAP_TICKS) return;
  const held = npc.timerB[i] as number;
  // A grooming cat's timerB is its spot (a tile) until it heads back to a perch.
  if (held >= 0) releaseCatPerch(w.npcAi.cat, held, npcHandle(npc, i));
  npc.timerB[i] = NO_TARGET;
  npc.timerA[i] = 0;
  npc.speed[i] = 0;
  npc.flags[i] = (npc.flags[i] as number) | NPC_FLAG.ON_ROOF;
  setNpcState(npc, i, CAT.LeapOnRoof);
}

function catStimulus(w: World, i: number, s: Stimulus): void {
  const state = w.npc.state[i] as number;
  if (s === Stimulus.Hit) {
    hitCat(w, i);
    return;
  }
  if ((s === Stimulus.Horn || s === Stimulus.Bump) && (state === CAT.Perch || state === CAT.Groom)) {
    startBolt(w, i);
  }
}

/**
 * Spawned (spawner.ts places perched cats with origin Perch): `group` ≥ 0 is the perch it was placed on, which it
 * claims and sits on; ≤ TILE_TARGET is a grooming spot (TILE_TARGET − spot index), where it sits grooming; else it
 * perches where it is, holding nothing. A perched cat arms its groom idle timer (one draw).
 */
function spawnCat(w: World, i: number): void {
  const npc = w.npc;
  const c = w.npcAi.cat;
  const g = npc.group[i] as number;
  npc.flags[i] = (npc.flags[i] as number) & ~(NPC_FLAG.ON_ROOF | NPC_FLAG.DODGED);
  if (g <= TILE_TARGET && TILE_TARGET - g < c.spotCount) {
    setNpcState(npc, i, CAT.Groom);
    npc.timerB[i] = TILE_TARGET - (c.spotTile[TILE_TARGET - g] as number);
    npc.timerA[i] = c.params.groomTicks;
    npc.speed[i] = 0;
    return;
  }
  if (g >= 0 && g < c.perchCount) {
    claimCatPerch(c, g, npcHandle(npc, i));
    npc.timerB[i] = g;
  } else npc.timerB[i] = NO_TARGET;
  setNpcState(npc, i, CAT.Perch);
  npc.speed[i] = 0;
  armIdle(w, i);
}

export const catBehaviour: Behaviour = {
  initial: CAT.Perch,
  jaywalks: true,
  tick: tickCat,
  onStimulus(w: World, i: number, s: Stimulus): void {
    catStimulus(w, i, s);
  },
  onSpawn: spawnCat,
};
