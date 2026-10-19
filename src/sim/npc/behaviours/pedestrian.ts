// The generic pedestrian (ENTITY_CATALOG §3.4, TECHNICAL_DESIGN §11.1, ART_BIBLE §10.2–§10.3; SSP-082): the
// shared human reaction model every person kind starts from. Per-type modules (SSP-083 Doris, SSP-084 shopper,
// businessman and litterbug, SSP-085 old man, mum and postie, SSP-086 dog walker, SSP-088 market trader) extend
// it: they keep the shared states and timings below, override transitions in their own tick and onStimulus,
// and call the exported pieces (tickPedestrian, pedestrianStimulus, enterPedestrianState, wantsToYield) for the
// rest (and the small steps stand, enterIdle, yieldStep and faceBessie; SSP-084: tickPedestrian's `doorGoals`
// sends the shopper from frontage door to frontage door). Until a kind's module lands, the registry gives it one
// of the behaviours at the bottom.
//
// States (PED, the TECHNICAL_DESIGN §11.1 shared set; `state` in the store). They map 1:1 to the animation
// states (walk 4, idle 2, startle 2, fall 3, angry 2 frames; Walk and Cross both play walk, Yield plays idle,
// Fallen and GetUp play fall), so the renderer picks a frame from `state` and `stateTicks` alone:
//   Walk     wander the nav graph: a random goal node (one `npc` stream draw), walked with the steering core;
//            on arrival, Idle. The catalog's Wander and Aware are both Walk; Aware is the AWARE flag (Bessie
//            within the awareness radius this tick, from BeaconYield).
//   Cross    Walk while on a crossing edge of the nav graph (navState Crossing). Never yields mid-road.
//   Idle     stand for IDLE_MIN_TICKS..IDLE_MAX_TICKS (one draw), then a new goal. A stationary type idles all
//            shift.
//   Startle  frame 0 for STARTLE_HOP_TICKS (the hop, standing), then frame 1 held while it sidesteps Bessie's
//            predicted path (or, when she is on top of it, steps away from her) until STARTLE_TICKS; then Yield
//            when it wants to, else back to walking. Horn, Bump (touched below the hit speed), NearMiss, Spray,
//            Splash (a puddle splash, SSP-094) and Cough (SSP-095: it coughs in Bessie's dust, on the startle
//            frames) start it from Walk, Cross, Idle or Yield.
//   Fallen   a Hit, from any state but Fallen and GetUp: fall frames 3 × FALL_FRAME_TICKS, then frame 2 held
//            FALL_HOLD_TICKS: FALLEN_TICKS = 15 + 72 = 87. Stands still. Nobody is hurt (CLAUDE.md rule 11).
//   GetUp    frames 1, 0 at FALL_FRAME_TICKS: GET_UP_TICKS = 10.
//   Angry    faces Bessie and shakes a fist: 2 frames × ANGRY_FRAME_TICKS (9), 6 alternations: ANGRY_TICKS = 54.
//            Then Walk (it resumes its route), or Idle for a stationary type.
//   Yield    stops and parts: sidesteps out of Bessie's predicted path, else stands. Entered from Walk, Cross
//            (once off the road), Idle or Startle when wantsToYield: AWARE and the type yields (entities.json
//            `yields`), or HI_VIS (pwr.hi_vis) and within the awareness radius, which makes every type yield.
//            Left for Walk once it no longer wants to, after at least YIELD_MIN_TICKS.
// A state's tick count is `stateTicks` as phase 7 leaves it: an NPC that enters a state on tick T (a Hit stimulus
// or its own tick) is in it for exactly the state's length, T .. T + length − 1, and in the next on T + length.
// FALLEN is set through Fallen and GetUp (contact ignores such an actor), YIELDING through Yield.
//
// A companion dog (origin Companion) runs the same machine but, instead of wandering, heels: it walks to within
// COMPANION_HEEL_M of its walker (`link`) and waits there. Since SSP-086 the registry gives the dog walker its own
// module (dogWalker.ts), whose dog roams ahead on the lead instead; the heel stays for any other companion.
//
// Timings are ART_BIBLE §10.2's. STARTLE_TICKS, YIELD_MIN_TICKS and the idle range are not in any doc; SSP-082
// proposed them (TBD (M3 tuning), owner to review): a 0.5 s startle, 0.5 s minimum yield, 1–3 s idles.
//
// Hot path: no allocation, no closures per tick; positions cross calls only through typed arrays.
import { atan2, sqrt } from '../../fmath.ts';
import { nextInt } from '../../rng.ts';
import type { World } from '../../world.ts';
import { type Behaviour, Stimulus } from '../behaviour.ts';
import { withinAwareness } from '../reactions.ts';
import {
  beginSteer,
  clearNavPath,
  moveNpc,
  NavState,
  requestNavPath,
  steerArrive,
  steerFlee,
  steerSeparate,
  steerSidestep,
  walkNpc,
} from '../steering.ts';
import { NPC_FLAG, NpcOrigin, resolveNpcHandle, setNpcState } from '../store.ts';

/** The shared human states (TECHNICAL_DESIGN §11.1). Hashed (store `state`): append, never renumber. */
export const PED = {
  Walk: 0,
  Idle: 1,
  Cross: 2,
  Startle: 3,
  Fallen: 4,
  GetUp: 5,
  Angry: 6,
  Yield: 7,
} as const;
export type PedState = (typeof PED)[keyof typeof PED];

/** Startle frame 0, the hop (ART_BIBLE §10.2). */
export const STARTLE_HOP_TICKS = 4;
/** A startle's whole length, hop included: 0.5 s (proposed in SSP-082, TBD (M3 tuning)). */
export const STARTLE_TICKS = 30;
/** Fall frames and each frame's ticks (ART_BIBLE §10.2). */
export const FALL_FRAMES = 3;
export const FALL_FRAME_TICKS = 5;
/** Fall frame 2 held for 1.2 s. */
export const FALL_HOLD_TICKS = 72;
/** Fallen: 3 × 5 + 72 = 87 ticks. */
export const FALLEN_TICKS = FALL_FRAMES * FALL_FRAME_TICKS + FALL_HOLD_TICKS;
/** GetUp: fall frames 1, 0 at 5 ticks = 10 ticks. */
export const GET_UP_TICKS = 2 * FALL_FRAME_TICKS;
/** Angry: each fist-shake frame's ticks and the alternations (ART_BIBLE §10.2). */
export const ANGRY_FRAME_TICKS = 9;
export const ANGRY_ALTERNATIONS = 6;
/** Angry: 9 × 6 = 54 ticks. */
export const ANGRY_TICKS = ANGRY_FRAME_TICKS * ANGRY_ALTERNATIONS;
/** A yield lasts at least this long: 0.5 s (proposed in SSP-082, TBD (M3 tuning)). */
export const YIELD_MIN_TICKS = 30;
/** An idle at a goal lasts IDLE_MIN_TICKS..IDLE_MAX_TICKS (1–3 s; proposed in SSP-082, TBD (M3 tuning)). */
export const IDLE_MIN_TICKS = 60;
export const IDLE_MAX_TICKS = 180;
/** A companion dog waits within this distance of its walker, metres. */
export const COMPANION_HEEL_M = 1.5;
/** A startled NPC this close to Bessie's centre (beyond her half length plus its radius) steps away from her. */
const STARTLE_BACK_OFF_M = 0.5;

/**
 * Put NPC `i` into `state` (restarting its state clock, setNpcState) with `limit` as the state's planned
 * length, and keep the shared flags in step: FALLEN through Fallen and GetUp, YIELDING through Yield.
 */
export function enterPedestrianState(w: World, i: number, state: number, limit: number): void {
  const npc = w.npc;
  setNpcState(npc, i, state);
  npc.stateLimit[i] = limit;
  let f = (npc.flags[i] as number) & ~(NPC_FLAG.FALLEN | NPC_FLAG.YIELDING);
  if (state === PED.Fallen || state === PED.GetUp) f |= NPC_FLAG.FALLEN;
  else if (state === PED.Yield) f |= NPC_FLAG.YIELDING;
  npc.flags[i] = f;
}

/**
 * Whether NPC `i` wants to give way to Bessie this tick: never on a crossing; else when AWARE and its kind
 * yields, or under hi-vis (HI_VIS) within the awareness radius, whatever its kind.
 */
export function wantsToYield(w: World, i: number): boolean {
  const npc = w.npc;
  if (npc.navState[i] === NavState.Crossing) return false;
  const f = npc.flags[i] as number;
  if ((f & NPC_FLAG.AWARE) !== 0 && w.npcAi.reactions.yields[npc.kind[i] as number] === 1) return true;
  return (f & NPC_FLAG.HI_VIS) !== 0 && withinAwareness(w, i);
}

/** Stand: no desire but separation, so it slows to a stop and keeps out of the others' way. */
export function stand(w: World, i: number): void {
  beginSteer(w);
  steerSeparate(w, i);
  moveNpc(w, i);
}

/** Lie or stand stock still (Fallen, GetUp, Angry): nothing moves it. */
function hold(w: World, i: number): void {
  w.npc.speed[i] = 0;
}

/** Idle at a goal for IDLE_MIN_TICKS..IDLE_MAX_TICKS (one `npc` stream draw). */
export function enterIdle(w: World, i: number): void {
  const limit = IDLE_MIN_TICKS + nextInt(w.npcAi.rng, IDLE_MAX_TICKS - IDLE_MIN_TICKS + 1);
  enterPedestrianState(w, i, PED.Idle, limit);
}

/** The state an NPC returns to after a reaction: Idle for a stationary type, else Walk (its route resumes). */
function resume(w: World, i: number, stationary: boolean): void {
  if (stationary) enterPedestrianState(w, i, PED.Idle, 0);
  else enterPedestrianState(w, i, PED.Walk, 0);
}

/**
 * A wander goal: a frontage door (one `npc` draw among the nav graph's doors) when `doorGoals` and the
 * graph has doors, else any nav node (one draw). −1 when the graph is empty (no draw).
 */
function wanderGoal(w: World, doorGoals: boolean): number {
  const nav = w.level.nav;
  const doors = nav.doors;
  if (doorGoals && doors.length > 0) {
    const door = doors[nextInt(w.npcAi.rng, doors.length)];
    if (door !== undefined) return door.node;
  }
  if (nav.nodeCount === 0) return -1;
  return nextInt(w.npcAi.rng, nav.nodeCount);
}

/** Walk and Cross: heel (a companion), or wander the nav graph (to frontage doors when `doorGoals`). */
function walkTick(w: World, i: number, doorGoals: boolean): void {
  const npc = w.npc;
  if (npc.origin[i] === NpcOrigin.Companion) {
    heel(w, i);
    return;
  }
  const ns = npc.navState[i] as number;
  if (ns === NavState.Arrived || ns === NavState.NoPath) {
    stand(w, i);
    enterIdle(w, i);
    return;
  }
  if (ns === NavState.Idle) {
    const goal = wanderGoal(w, doorGoals);
    if (goal < 0) {
      stand(w, i);
      return;
    }
    if (!requestNavPath(w, i, goal)) {
      stand(w, i);
      enterIdle(w, i);
      return;
    }
  }
  walkNpc(w, i, false);
  const crossing = npc.navState[i] === NavState.Crossing;
  const state = npc.state[i] as number;
  if (crossing && state === PED.Walk) enterPedestrianState(w, i, PED.Cross, 0);
  else if (!crossing && state === PED.Cross) enterPedestrianState(w, i, PED.Walk, 0);
}

/** A companion dog: walk to within COMPANION_HEEL_M of its walker, then wait. */
function heel(w: World, i: number): void {
  const npc = w.npc;
  const walker = resolveNpcHandle(npc, npc.link[i] as number);
  beginSteer(w);
  if (walker >= 0) {
    const dx = (npc.x[walker] as number) - (npc.x[i] as number);
    const dy = (npc.y[walker] as number) - (npc.y[i] as number);
    if (dx * dx + dy * dy > COMPANION_HEEL_M * COMPANION_HEEL_M) steerArrive(w, i, npc.x, npc.y, walker);
  }
  steerSeparate(w, i);
  moveNpc(w, i);
}

/** Startle after the hop: sidestep her predicted path, or step away from her when she is on top of it. */
function startleStep(w: World, i: number): void {
  const npc = w.npc;
  const v = w.vehicle;
  beginSteer(w);
  if (!steerSidestep(w, i)) {
    const dx = (npc.x[i] as number) - v.xM;
    const dy = (npc.y[i] as number) - v.yM;
    const near = w.tuning.vehicle.sweeper.body.lengthM * 0.5 + (npc.radius[i] as number) + STARTLE_BACK_OFF_M;
    if (dx * dx + dy * dy < near * near) {
      const r = w.npcAi.reactions;
      steerFlee(w, i, r.bessieX, r.bessieY, 0);
    }
  }
  steerSeparate(w, i);
  moveNpc(w, i);
}

/** Yield: part (sidestep her predicted path) or stand. */
export function yieldStep(w: World, i: number): void {
  beginSteer(w);
  steerSidestep(w, i);
  steerSeparate(w, i);
  moveNpc(w, i);
}

/** Face Bessie (entering Angry). */
export function faceBessie(w: World, i: number): void {
  const npc = w.npc;
  const dx = w.vehicle.xM - (npc.x[i] as number);
  const dy = w.vehicle.yM - (npc.y[i] as number);
  if (sqrt(dx * dx + dy * dy) > 1e-6) npc.heading[i] = atan2(dx, -dy);
}

/**
 * The generic pedestrian's tick for NPC `i` (see the file comment); `stationary` for a type that never walks
 * (market_trader): it idles, startles and falls where it stands and never yields. `doorGoals` (SSP-084, the
 * shopper) makes it wander from frontage door to frontage door, idling at each (shop windows), instead of to
 * any nav node; on a nav graph without doors it wanders as usual.
 */
export function tickPedestrian(w: World, i: number, stationary: boolean, doorGoals = false): void {
  const npc = w.npc;
  const t = npc.stateTicks[i] as number;
  switch (npc.state[i] as number) {
    case PED.Walk:
    case PED.Cross:
      if (stationary) {
        enterPedestrianState(w, i, PED.Idle, 0);
        hold(w, i);
        return;
      }
      if (wantsToYield(w, i)) {
        enterPedestrianState(w, i, PED.Yield, 0);
        yieldStep(w, i);
        return;
      }
      walkTick(w, i, doorGoals);
      return;
    case PED.Idle:
      if (stationary) {
        hold(w, i);
        return;
      }
      if (wantsToYield(w, i)) {
        enterPedestrianState(w, i, PED.Yield, 0);
        yieldStep(w, i);
        return;
      }
      stand(w, i);
      if (t >= (npc.stateLimit[i] as number)) {
        if (npc.origin[i] !== NpcOrigin.Companion) clearNavPath(w, i);
        enterPedestrianState(w, i, PED.Walk, 0);
      }
      return;
    case PED.Startle:
      if (stationary) hold(w, i);
      else if (t < STARTLE_HOP_TICKS) stand(w, i);
      else startleStep(w, i);
      if (t >= (npc.stateLimit[i] as number)) {
        if (!stationary && wantsToYield(w, i)) enterPedestrianState(w, i, PED.Yield, 0);
        else resume(w, i, stationary);
      }
      return;
    case PED.Yield:
      if (stationary) {
        resume(w, i, true);
        hold(w, i);
        return;
      }
      if (t >= YIELD_MIN_TICKS && !wantsToYield(w, i)) {
        enterPedestrianState(w, i, PED.Walk, 0);
        walkTick(w, i, doorGoals);
        return;
      }
      yieldStep(w, i);
      return;
    case PED.Fallen:
      hold(w, i);
      if (t >= FALLEN_TICKS) enterPedestrianState(w, i, PED.GetUp, GET_UP_TICKS);
      return;
    case PED.GetUp:
      hold(w, i);
      if (t >= GET_UP_TICKS) {
        enterPedestrianState(w, i, PED.Angry, ANGRY_TICKS);
        faceBessie(w, i);
      }
      return;
    case PED.Angry:
      hold(w, i);
      if (t >= ANGRY_TICKS) resume(w, i, stationary);
      return;
    default:
      // A state this machine does not know (a per-type module's own, left behind): start walking again.
      resume(w, i, stationary);
      return;
  }
}

/** The generic pedestrian's reaction to stimulus `s` for NPC `i` (see the file comment). */
export function pedestrianStimulus(w: World, i: number, s: Stimulus, stationary: boolean): void {
  const npc = w.npc;
  const state = npc.state[i] as number;
  switch (s) {
    case Stimulus.Hit:
      if (state === PED.Fallen || state === PED.GetUp) return;
      enterPedestrianState(w, i, PED.Fallen, FALLEN_TICKS);
      npc.speed[i] = 0;
      return;
    case Stimulus.Horn:
    case Stimulus.Bump:
    case Stimulus.NearMiss:
    case Stimulus.Spray:
    case Stimulus.Splash:
    case Stimulus.Cough:
      if (state === PED.Walk || state === PED.Cross || state === PED.Idle || state === PED.Yield) {
        enterPedestrianState(w, i, PED.Startle, STARTLE_TICKS);
      }
      return;
    case Stimulus.HiVis:
      if (!stationary) npc.flags[i] = (npc.flags[i] as number) | NPC_FLAG.HI_VIS;
      return;
    case Stimulus.BeaconYield:
      npc.flags[i] = (npc.flags[i] as number) | NPC_FLAG.AWARE;
      return;
    default:
      return;
  }
}

/** The generic walking pedestrian: the default for every person kind until its module lands. */
export const pedestrianBehaviour: Behaviour = {
  initial: PED.Walk,
  jaywalks: false,
  tick(w: World, i: number): void {
    tickPedestrian(w, i, false);
  },
  onStimulus(w: World, i: number, s: Stimulus): void {
    pedestrianStimulus(w, i, s, false);
  },
};

/** The generic stationary pedestrian (the market trader until SSP-088): never walks, never yields. */
export const stationaryPedestrianBehaviour: Behaviour = {
  initial: PED.Idle,
  jaywalks: false,
  tick(w: World, i: number): void {
    tickPedestrian(w, i, true);
  },
  onStimulus(w: World, i: number, s: Stimulus): void {
    pedestrianStimulus(w, i, s, true);
  },
};
