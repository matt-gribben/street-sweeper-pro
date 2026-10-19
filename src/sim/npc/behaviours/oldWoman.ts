// Doris, npc.old_woman (ENTITY_CATALOG §6.3 owns her behaviour and numbers, TECHNICAL_DESIGN §11.2 the machine;
// SSP-083). The mascot antagonist: she never yields, glares at Bessie when she blocks her path, shakes her fist
// and walks slower when honked at, chases and whacks Bessie with her handbag when sprayed, and scatters her
// shopping when knocked over (the shared hit rule, npc/reactions.ts, spawns the entities.json `hit.drops`).
//
// She extends the generic pedestrian (pedestrian.ts): the shared states keep their PED numbers and timings, so
// Fallen (87 ticks) → GetUp (10) → Angry (54) and the hi-vis Yield are the shared ones; her own states are
// appended after PED's. Animation (the renderer picks it from `state`, ENTITY_CATALOG §6.2): Walk, SlowWalk and
// Chase play walk (Chase at a fast cadence), Glare and Idle play idle, FistShake and Angry play angry, Fallen and
// GetUp play fall, Yield plays idle. She never startles.
//
// Rules (the numbers are entities.json `npc.old_woman.rules`, converted to whole ticks at shift start by
// createOldWomanParams):
//   Walk      she wanders the nav graph like the generic pedestrian (Idle at a goal for 1–3 s, then a new
//             goal), at her entities.json speed (0.6 m/s), across crossings too: Doris has no Cross state of her
//             own, her nav state says when she is on one.
//   Glare     from Walk or SlowWalk when Bessie is in her path: the segment from her centre `glareM` (4 m)
//             along her walking direction (towards her path's next nav node), swept by her radius, touches
//             Bessie's body OBB. She stops and faces Bessie. Each tick that test fails counts towards `timerB`;
//             one that passes resets it. On the `glareClearS` × 60th (60th) clear tick in a row she walks on
//             (SlowWalk if she is still slowed). This is her own trigger: she ignores BeaconYield, so neither
//             the awareness radius nor upg.led_beacon makes her yield (the catalog's "within awareness radius"
//             was aligned to TECHNICAL_DESIGN §11.2's 4 m in SSP-083).
//   FistShake a Horn delivered while she glares: she stands facing Bessie for `fistShakeS` × 60 (90) ticks,
//             then SlowWalk. A horn in any other state leaves her as she is (TECHNICAL_DESIGN §11.2 draws it
//             only from Glare).
//   SlowWalk  Walk at `hornSlowSpeedMps` (0.4 m/s) for `hornSlowS` × 60 ticks (600; `timerA` counts them down
//             on every tick she is not shaking her fist, glaring included), then Walk at her own speed again.
//             Bessie in her path sends her back to Glare, and a second horn there to a second FistShake, which
//             restarts the slowed time.
//   Chase     a Spray (npc/reactions.ts delivers one per tick to every NPC inside the spray cone) from Walk,
//             SlowWalk, Idle or Glare: she drops her path and seeks Bessie's body centre at `chaseSpeedMps`
//             (1.2 m/s), round the props. Off a crossing she keeps to the pavement like every non-jaywalker
//             (steering.ts), so she whacks from the kerb. When Bessie's body OBB is within `handbagReachM`
//             (0.6 m) of her centre she stops, faces her and whacks: Bessie loses `handbagHitHp` (2) HP, never
//             below 0 (TOWED follows in phase 10 at 0), EV.HandbagWhack is emitted, and `timerB` holds the
//             next whack off for `whackEveryS` × 60 (60) chase ticks. The first whack lands on the first tick
//             in reach. She gives up, back to Walk with a fresh goal, when Bessie's body centre is more than
//             `chaseGiveUpM` (8 m) away. At 1.2 m/s she only catches a stationary or reversing Bessie.
//   Fallen    a Hit (Bessie at ≥ 1.0 m/s closing speed, the shared rule: −500, 2 complaints, 6
//             litter.spilled_shopping) from any state but Fallen and GetUp: the shared Fallen → GetUp → Angry,
//             then Walk at her own speed (a hit clears the slowdown and the chase).
//   Yield     only under pwr.hi_vis (HI_VIS) with Bessie inside the awareness radius (wantsToYield; her
//             entities.json `yields` is false), from Walk, SlowWalk, Idle, Glare or Chase: she parts,
//             grudgingly, at her walking speed, and after at least YIELD_MIN_TICKS walks on once hi-vis no
//             longer applies. Spray, horn, Bump and NearMiss leave a yielding Doris alone.
// Bump and NearMiss never startle her: she is never knocked aside.
//
// Hot path: no allocation, no closures, no double crosses a call (helpers take the World and an index and return
// booleans); Bessie's body axes come from the reactions' OBB, which stepActorContacts refreshes every tick there
// is a live NPC, before the behaviours run.
import { SIM_HZ } from '../../constants.ts';
import type { Entities } from '../../entities.ts';
import { NPC_IDS } from '../../entities.ts';
import { EV, emitEvent } from '../../eventQueue.ts';
import { sqrt } from '../../fmath.ts';
import { nextInt } from '../../rng.ts';
import type { World } from '../../world.ts';
import { type Behaviour, Stimulus } from '../behaviour.ts';
import {
  beginSteer,
  clearNavPath,
  moveNpc,
  NavState,
  requestNavPath,
  steerAvoidProps,
  steerSeek,
  steerSeparate,
  walkNpc,
} from '../steering.ts';
import { NPC_FLAG } from '../store.ts';
import {
  ANGRY_TICKS,
  enterIdle,
  enterPedestrianState,
  FALLEN_TICKS,
  faceBessie,
  GET_UP_TICKS,
  PED,
  stand,
  wantsToYield,
  YIELD_MIN_TICKS,
  yieldStep,
} from './pedestrian.ts';

/**
 * Doris's states (TECHNICAL_DESIGN §11.2): the shared PED states she uses keep their numbers, hers follow.
 * Hashed (store `state`): append, never renumber.
 */
export const DORIS = {
  Walk: PED.Walk,
  Idle: PED.Idle,
  Fallen: PED.Fallen,
  GetUp: PED.GetUp,
  Angry: PED.Angry,
  Yield: PED.Yield,
  Glare: 8,
  FistShake: 9,
  SlowWalk: 10,
  Chase: 11,
} as const;
export type DorisState = (typeof DORIS)[keyof typeof DORIS];

/** Doris's numbers for a shift, from entities.json `npc.old_woman` (createOldWomanParams). */
export type OldWomanParams = {
  /** Her NPC_IDS index. */
  readonly kind: number;
  /** Her walking speed (entities.json `speed`), the slowed one and the chase one, m/s. */
  readonly walkMps: number;
  readonly slowMps: number;
  readonly chaseMps: number;
  /** How far ahead on her path Bessie makes her glare, metres. */
  readonly glareM: number;
  /** Clear-path ticks that end a Glare. */
  readonly glareClearTicks: number;
  /** FistShake length, ticks. */
  readonly fistShakeTicks: number;
  /** Slowed-walk length, ticks. */
  readonly slowTicks: number;
  /** Ticks between two whacks. */
  readonly whackTicks: number;
  /** HP one whack takes. */
  readonly whackHp: number;
  /** The give-up distance, metres (to Bessie's body centre). */
  readonly giveUpM: number;
  /** Handbag reach, metres (her centre to Bessie's body OBB). */
  readonly reachM: number;
};

/** `s` seconds as whole 60 Hz ticks; throws unless it is a whole number of ticks ≥ 1. */
function wholeTicks(s: number, key: string): number {
  const t = Math.round(s * SIM_HZ);
  if (!(t >= 1 && Math.abs(t - s * SIM_HZ) < 1e-9)) {
    throw new Error(`oldWoman: npc.old_woman.rules.${key} must be a whole number of 60 Hz ticks, got ${s} s`);
  }
  return t;
}

/** Doris's numbers from validated entities.json. Setup only. */
export function createOldWomanParams(entities: Entities): OldWomanParams {
  const e = entities.npcs['npc.old_woman'];
  const r = e.rules;
  return {
    kind: NPC_IDS.indexOf('npc.old_woman'),
    walkMps: e.speedMps,
    slowMps: r.hornSlowSpeedMps,
    chaseMps: r.chaseSpeedMps,
    glareM: r.glareM,
    glareClearTicks: wholeTicks(r.glareClearS, 'glareClearS'),
    fistShakeTicks: wholeTicks(r.fistShakeS, 'fistShakeS'),
    slowTicks: wholeTicks(r.hornSlowS, 'hornSlowS'),
    whackTicks: wholeTicks(r.whackEveryS, 'whackEveryS'),
    whackHp: r.handbagHitHp,
    giveUpM: r.chaseGiveUpM,
    reachM: r.handbagReachM,
  };
}

/** Enter walking state `state` (no planned length) at her own speed, or the slowed one when `slowed`. */
function enterWalking(w: World, i: number, state: number, slowed: boolean): void {
  const p = w.npcAi.oldWoman;
  enterPedestrianState(w, i, state, 0);
  w.npc.walkMps[i] = slowed ? p.slowMps : p.walkMps;
}

/** Back to walking after a reaction: SlowWalk while the slowed time runs, else Walk. */
function resumeWalk(w: World, i: number): void {
  const slowed = (w.npc.timerA[i] as number) > 0;
  enterWalking(w, i, slowed ? DORIS.SlowWalk : DORIS.Walk, slowed);
}

/** Part under hi-vis, at her (possibly slowed) walking speed. */
function enterYield(w: World, i: number): void {
  const p = w.npcAi.oldWoman;
  enterPedestrianState(w, i, DORIS.Yield, 0);
  w.npc.walkMps[i] = (w.npc.timerA[i] as number) > 0 ? p.slowMps : p.walkMps;
  yieldStep(w, i);
}

/** Stand still, facing Bessie (Glare, FistShake, a whack). */
function standFacing(w: World, i: number): void {
  stand(w, i);
  faceBessie(w, i);
}

/**
 * True when Bessie is in Doris's path: the segment from her centre glareM along her walking direction (towards
 * her path's next node) enters Bessie's body OBB grown by her radius on every side (a slab test in the OBB's
 * frame). False when she has no path to follow.
 */
function pathBlocked(w: World, i: number): boolean {
  const npc = w.npc;
  const ns = npc.navState[i] as number;
  if (ns !== NavState.Walking && ns !== NavState.KerbWait && ns !== NavState.Crossing) return false;
  const node = npc.targetNode[i] as number;
  if (node < 0) return false;
  const nav = w.level.nav;
  const x0 = npc.x[i] as number;
  const y0 = npc.y[i] as number;
  let dx = (nav.nodeX[node] as number) - x0;
  let dy = (nav.nodeY[node] as number) - y0;
  const d = sqrt(dx * dx + dy * dy);
  if (!(d > 1e-3)) return false;
  const k = w.npcAi.oldWoman.glareM / d;
  dx *= k;
  dy *= k;
  const obb = w.npcAi.reactions.obb;
  const r = npc.radius[i] as number;
  const hx = obb.halfWidthM + r;
  const hy = obb.halfLengthM + r;
  const px = x0 - obb.cx;
  const py = y0 - obb.cy;
  const lx = px * obb.rightX + py * obb.rightY;
  const ly = px * obb.forwardX + py * obb.forwardY;
  const ldx = dx * obb.rightX + dy * obb.rightY;
  const ldy = dx * obb.forwardX + dy * obb.forwardY;
  let t0 = 0;
  let t1 = 1;
  if (ldx > -1e-12 && ldx < 1e-12) {
    if (lx < -hx || lx > hx) return false;
  } else {
    let ta = (-hx - lx) / ldx;
    let tb = (hx - lx) / ldx;
    if (ta > tb) {
      const s = ta;
      ta = tb;
      tb = s;
    }
    if (ta > t0) t0 = ta;
    if (tb < t1) t1 = tb;
    if (t0 > t1) return false;
  }
  if (ldy > -1e-12 && ldy < 1e-12) {
    if (ly < -hy || ly > hy) return false;
  } else {
    let ta = (-hy - ly) / ldy;
    let tb = (hy - ly) / ldy;
    if (ta > tb) {
      const s = ta;
      ta = tb;
      tb = s;
    }
    if (ta > t0) t0 = ta;
    if (tb < t1) t1 = tb;
    if (t0 > t1) return false;
  }
  return true;
}

/** True when Bessie's body OBB is within reachM of Doris's centre (edge included). */
function inHandbagReach(w: World, i: number): boolean {
  const npc = w.npc;
  const obb = w.npcAi.reactions.obb;
  const px = (npc.x[i] as number) - obb.cx;
  const py = (npc.y[i] as number) - obb.cy;
  let ax = px * obb.rightX + py * obb.rightY;
  let ay = px * obb.forwardX + py * obb.forwardY;
  if (ax < 0) ax = -ax;
  if (ay < 0) ay = -ay;
  const gx = ax > obb.halfWidthM ? ax - obb.halfWidthM : 0;
  const gy = ay > obb.halfLengthM ? ay - obb.halfLengthM : 0;
  const reach = w.npcAi.oldWoman.reachM;
  return gx * gx + gy * gy <= reach * reach;
}

/** True when Bessie's body centre is more than giveUpM from Doris's centre. */
function beyondGiveUp(w: World, i: number): boolean {
  const npc = w.npc;
  const dx = (npc.x[i] as number) - w.vehicle.xM;
  const dy = (npc.y[i] as number) - w.vehicle.yM;
  const g = w.npcAi.oldWoman.giveUpM;
  return dx * dx + dy * dy > g * g;
}

/** Walk and SlowWalk: wander the nav graph (a random goal, Idle on arrival), at her current walkMps. */
function walkStep(w: World, i: number): void {
  const npc = w.npc;
  const ns = npc.navState[i] as number;
  if (ns === NavState.Arrived || ns === NavState.NoPath) {
    stand(w, i);
    enterIdle(w, i);
    return;
  }
  if (ns === NavState.Idle) {
    const nodes = w.level.nav.nodeCount;
    if (nodes === 0) {
      stand(w, i);
      return;
    }
    if (!requestNavPath(w, i, nextInt(w.npcAi.rng, nodes))) {
      stand(w, i);
      enterIdle(w, i);
      return;
    }
  }
  walkNpc(w, i, false);
}

/** Chase: whack when in reach, else seek Bessie's body centre round the props. */
function chaseStep(w: World, i: number): void {
  const npc = w.npc;
  const t = npc.timerB[i] as number;
  if (t > 0) npc.timerB[i] = t - 1;
  if (inHandbagReach(w, i)) {
    standFacing(w, i);
    if ((npc.timerB[i] as number) === 0) whack(w, i);
    return;
  }
  const r = w.npcAi.reactions;
  beginSteer(w);
  steerSeek(w, i, r.bessieX, r.bessieY, 0);
  steerAvoidProps(w, i);
  steerSeparate(w, i);
  moveNpc(w, i);
}

/** One handbag whack: Bessie loses whackHp HP (never below 0), EV.HandbagWhack, and the whack interval starts. */
function whack(w: World, i: number): void {
  const v = w.vehicle;
  const p = w.npcAi.oldWoman;
  const npc = w.npc;
  npc.timerB[i] = p.whackTicks;
  const before = v.hp;
  if (!(before > 0)) return;
  const after = before - p.whackHp;
  v.hp = after > 0 ? after : 0;
  const e = emitEvent(w.events, EV.HandbagWhack, i);
  w.events.a[e] = npc.x[i] as number;
  w.events.b[e] = npc.y[i] as number;
  w.events.c[e] = before - v.hp;
}

/** Doris's tick for NPC `i` (see the file comment). */
export function tickOldWoman(w: World, i: number): void {
  const npc = w.npc;
  const p = w.npcAi.oldWoman;
  const state = npc.state[i] as number;
  const slow = npc.timerA[i] as number;
  if (slow > 0 && state !== DORIS.FistShake) npc.timerA[i] = slow - 1;
  const t = npc.stateTicks[i] as number;
  switch (state) {
    case DORIS.Walk:
    case DORIS.SlowWalk:
      if (wantsToYield(w, i)) {
        enterYield(w, i);
        return;
      }
      if (state === DORIS.SlowWalk && (npc.timerA[i] as number) === 0) enterWalking(w, i, DORIS.Walk, false);
      if (pathBlocked(w, i)) {
        enterPedestrianState(w, i, DORIS.Glare, 0);
        npc.timerB[i] = 0;
        standFacing(w, i);
        return;
      }
      walkStep(w, i);
      return;
    case DORIS.Idle:
      if (wantsToYield(w, i)) {
        enterYield(w, i);
        return;
      }
      stand(w, i);
      if (t >= (npc.stateLimit[i] as number)) {
        clearNavPath(w, i);
        resumeWalk(w, i);
      }
      return;
    case DORIS.Glare:
      if (wantsToYield(w, i)) {
        enterYield(w, i);
        return;
      }
      if (pathBlocked(w, i)) npc.timerB[i] = 0;
      else npc.timerB[i] = (npc.timerB[i] as number) + 1;
      if ((npc.timerB[i] as number) >= p.glareClearTicks) {
        npc.timerB[i] = 0;
        resumeWalk(w, i);
        walkStep(w, i);
        return;
      }
      standFacing(w, i);
      return;
    case DORIS.FistShake:
      npc.speed[i] = 0;
      if (t >= p.fistShakeTicks) {
        npc.timerA[i] = p.slowTicks;
        enterWalking(w, i, DORIS.SlowWalk, true);
      }
      return;
    case DORIS.Chase:
      if (wantsToYield(w, i)) {
        npc.timerB[i] = 0;
        enterYield(w, i);
        return;
      }
      if (beyondGiveUp(w, i)) {
        npc.timerB[i] = 0;
        clearNavPath(w, i);
        resumeWalk(w, i);
        stand(w, i);
        return;
      }
      chaseStep(w, i);
      return;
    case DORIS.Yield:
      if (t >= YIELD_MIN_TICKS && !wantsToYield(w, i)) {
        resumeWalk(w, i);
        walkStep(w, i);
        return;
      }
      yieldStep(w, i);
      return;
    case DORIS.Fallen:
      npc.speed[i] = 0;
      if (t >= FALLEN_TICKS) enterPedestrianState(w, i, DORIS.GetUp, GET_UP_TICKS);
      return;
    case DORIS.GetUp:
      npc.speed[i] = 0;
      if (t >= GET_UP_TICKS) {
        enterPedestrianState(w, i, DORIS.Angry, ANGRY_TICKS);
        faceBessie(w, i);
      }
      return;
    case DORIS.Angry:
      npc.speed[i] = 0;
      if (t >= ANGRY_TICKS) resumeWalk(w, i);
      return;
    default:
      // A state she does not use (Cross, Startle): walk on.
      resumeWalk(w, i);
      return;
  }
}

/** Doris's reaction to stimulus `s` (see the file comment). */
export function oldWomanStimulus(w: World, i: number, s: Stimulus): void {
  const npc = w.npc;
  const state = npc.state[i] as number;
  switch (s) {
    case Stimulus.Hit:
      if (state === DORIS.Fallen || state === DORIS.GetUp) return;
      enterPedestrianState(w, i, DORIS.Fallen, FALLEN_TICKS);
      npc.speed[i] = 0;
      npc.timerA[i] = 0;
      npc.timerB[i] = 0;
      npc.walkMps[i] = w.npcAi.oldWoman.walkMps;
      return;
    case Stimulus.Horn:
      if (state !== DORIS.Glare) return;
      enterPedestrianState(w, i, DORIS.FistShake, w.npcAi.oldWoman.fistShakeTicks);
      npc.speed[i] = 0;
      npc.timerB[i] = 0;
      faceBessie(w, i);
      return;
    case Stimulus.Spray:
      if (state !== DORIS.Walk && state !== DORIS.SlowWalk && state !== DORIS.Idle && state !== DORIS.Glare) {
        return;
      }
      clearNavPath(w, i);
      enterPedestrianState(w, i, DORIS.Chase, 0);
      npc.walkMps[i] = w.npcAi.oldWoman.chaseMps;
      npc.timerB[i] = 0;
      return;
    case Stimulus.HiVis:
      npc.flags[i] = (npc.flags[i] as number) | NPC_FLAG.HI_VIS;
      return;
    case Stimulus.BeaconYield:
      // Marked (the AWARE flag), never acted on: her kind does not yield.
      npc.flags[i] = (npc.flags[i] as number) | NPC_FLAG.AWARE;
      return;
    default:
      // Bump and NearMiss: she is never knocked aside.
      return;
  }
}

/** Doris (npc.old_woman). */
export const oldWomanBehaviour: Behaviour = {
  initial: DORIS.Walk,
  jaywalks: false,
  tick(w: World, i: number): void {
    tickOldWoman(w, i);
  },
  onStimulus(w: World, i: number, s: Stimulus): void {
    oldWomanStimulus(w, i, s);
  },
};
