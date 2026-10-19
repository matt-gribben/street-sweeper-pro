// The postie with his trolley, npc.postie (ENTITY_CATALOG §6.1–§6.2, LEVEL_DESIGN §5.1, §7.10; SSP-085). He walks
// the frontage round, door to door, and **stops at each door for 3 s** (entities.json rules.doorStopS × 60 =
// 180 ticks) before walking on. Puddle Lane's spawn spec brings him in at 10 s (SSP-104). A hit is −250 and 1
// complaint (entities.json `hit`, reactions.ts).
//
// The round is the level's doors in walking order (doorRound.ts). He joins it at the door nearest him, walks
// there on the nav graph (crossing roads at any crossing, like any non-jaywalker), and on arriving stands for
// the door stop facing the facade; then he plans to the next door of the round, looping at its end. A door he
// cannot reach (no path) costs him the same stop where he stands, then he moves on to the one after it; a door
// someone else stands on gets its stop beside it (DOOR_CROWD_M), and his next leg aims past it (skipTakenDoor).
//
// States are the shared PED set (pedestrian.ts), so the renderer's frame mapping holds: Walk / Cross between
// doors, Idle for the door stop ("idle at doors"), and the generic Startle, Fallen, GetUp and Angry, which this
// module hands to tickPedestrian. Walk, Cross, Idle and Yield are his own, because the generic versions wander
// to random goals and idle for random lengths. He yields inside the awareness radius (his kind `yields`): a
// yield abandons a door stop, which starts again in full when he is back at the door. So does the end of a
// startle or of a fall's fist-shake, since he resumes walking and finds himself arrived. The trolley he leaves
// on the pavement edge is drawn by his sprite only: it is not collidable and has no entity ID of its own (IDs
// are frozen; proposed in SSP-085, owner to review). A level with no doors makes him the generic pedestrian.
//
// Hot path: no allocation; the door-stop length is read from entities.json on arrival only.
import { SIM_HZ } from '../../constants.ts';
import { NAV_FLAG_CROSSING } from '../../map.ts';
import type { World } from '../../world.ts';
import type { Behaviour, Stimulus } from '../behaviour.ts';
import {
  beginSteer,
  moveNpc,
  NavState,
  navEdgeBetween,
  requestNavPath,
  steerSeparate,
  steerSidestep,
  walkNpc,
} from '../steering.ts';
import { NPC_PATH_NODES } from '../store.ts';
import {
  enterPedestrianState,
  PED,
  pedestrianStimulus,
  tickPedestrian,
  wantsToYield,
  YIELD_MIN_TICKS,
} from './pedestrian.ts';

/**
 * A door already taken: within this distance of his door, walking for at least DOOR_CROWD_TICKS and held to
 * under DOOR_CROWD_SPEED of his walking speed (someone stands on it, another postie or a shopper), he makes
 * his stop where he is instead of pushing for the node, which two walkers bound for one point never reach.
 * A normal arrival never trips it: the arrive slow-down keeps him above 0.4 × walkMps until he is within the
 * 0.4 m arrive radius. Proposed in SSP-085 (TBD (M3 tuning)).
 */
export const DOOR_CROWD_M = 1.2;
export const DOOR_CROWD_TICKS = 60;
export const DOOR_CROWD_SPEED = 0.1;

/** The door stop in ticks: entities.json npc.postie rules.doorStopS × 60 (180). */
export function doorStopTicks(w: World): number {
  return Math.round(w.npcAi.entities.npcs['npc.postie'].rules.doorStopS * SIM_HZ);
}

/** Stand: separation only, so he slows to a stop and keeps out of the others' way. */
function stand(w: World, i: number): void {
  beginSteer(w);
  steerSeparate(w, i);
  moveNpc(w, i);
}

/** Yield: part (sidestep Bessie's predicted path) or stand. */
function yieldStep(w: World, i: number): void {
  beginSteer(w);
  steerSidestep(w, i);
  steerSeparate(w, i);
  moveNpc(w, i);
}

/**
 * The round index of NPC `i`'s next door: the one after his goal when that is a door of the round, else the
 * door nearest him (straight line; ties to the lower round index).
 */
export function nextRoundStop(w: World, i: number): number {
  const npc = w.npc;
  const round = w.npcAi.doorRound;
  const goal = npc.goalNode[i] as number;
  const k = goal >= 0 ? (round.roundAt[goal] as number) : -1;
  if (k >= 0) return k + 1 < round.count ? k + 1 : 0;
  const nav = w.level.nav;
  const x = npc.x[i] as number;
  const y = npc.y[i] as number;
  let best = 0;
  let bestD2 = Number.POSITIVE_INFINITY;
  for (let j = 0; j < round.count; j += 1) {
    const n = round.node[j] as number;
    const dx = (nav.nodeX[n] as number) - x;
    const dy = (nav.nodeY[n] as number) - y;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) {
      bestD2 = d2;
      best = j;
    }
  }
  return best;
}

/**
 * Start the door stop (Idle for doorStopTicks): he pulls up where he is (his trolley stops dead) and, when he
 * stands at a door of the round, faces the facade.
 */
function beginDoorStop(w: World, i: number): void {
  const npc = w.npc;
  enterPedestrianState(w, i, PED.Idle, doorStopTicks(w));
  npc.speed[i] = 0;
  const goal = npc.goalNode[i] as number;
  if (npc.navState[i] !== NavState.Arrived || goal < 0) return;
  const k = w.npcAi.doorRound.roundAt[goal] as number;
  if (k >= 0) npc.heading[i] = w.npcAi.doorRound.faceRad[k] as number;
}

/** True when NPC `i` is held up short of his door (see DOOR_CROWD_M). */
function doorTaken(w: World, i: number): boolean {
  const npc = w.npc;
  if ((npc.stateTicks[i] as number) < DOOR_CROWD_TICKS) return false;
  if ((npc.speed[i] as number) >= DOOR_CROWD_SPEED * (npc.walkMps[i] as number)) return false;
  const goal = npc.goalNode[i] as number;
  if (goal < 0 || (npc.targetNode[i] as number) !== goal) return false;
  const nav = w.level.nav;
  const dx = (nav.nodeX[goal] as number) - (npc.x[i] as number);
  const dy = (nav.nodeY[goal] as number) - (npc.y[i] as number);
  return dx * dx + dy * dy <= DOOR_CROWD_M * DOOR_CROWD_M;
}

/**
 * After a stop beside a taken door (doorTaken), his new path starts at that door's node, which whoever stands on
 * it keeps him from reaching: aim straight for the node after it, unless that step is a road crossing (whose
 * kerb wait starts at the kerb node).
 */
function skipTakenDoor(w: World, i: number): void {
  const npc = w.npc;
  const len = npc.pathLen[i] as number;
  if (len < 2 || (npc.pathAt[i] as number) !== 0 || npc.navState[i] !== NavState.Walking) return;
  const base = i * NPC_PATH_NODES;
  const nav = w.level.nav;
  const e = navEdgeBetween(nav, npc.path[base] as number, npc.path[base + 1] as number);
  if (e < 0 || ((nav.edgeFlags[e] as number) & NAV_FLAG_CROSSING) !== 0) return;
  npc.pathAt[i] = 1;
  npc.targetNode[i] = npc.path[base + 1] as number;
}

/** Walk and Cross: on to the next door of the round, and the door stop on arrival. */
function walkRound(w: World, i: number): void {
  const npc = w.npc;
  const ns = npc.navState[i] as number;
  if (ns === NavState.Arrived || ns === NavState.NoPath) {
    stand(w, i);
    beginDoorStop(w, i);
    return;
  }
  if (ns === NavState.Idle) {
    const round = w.npcAi.doorRound;
    if (!requestNavPath(w, i, round.node[nextRoundStop(w, i)] as number)) {
      stand(w, i);
      beginDoorStop(w, i);
      return;
    }
  }
  walkNpc(w, i, false);
  const after = npc.navState[i] as number;
  if (after === NavState.Arrived || (after === NavState.Walking && doorTaken(w, i))) {
    beginDoorStop(w, i);
    return;
  }
  const crossing = after === NavState.Crossing;
  const state = npc.state[i] as number;
  if (crossing && state === PED.Walk) enterPedestrianState(w, i, PED.Cross, 0);
  else if (!crossing && state === PED.Cross) enterPedestrianState(w, i, PED.Walk, 0);
}

/** The postie's tick for NPC `i` (see the file comment). */
export function tickPostie(w: World, i: number): void {
  if (w.npcAi.doorRound.count === 0) {
    tickPedestrian(w, i, false);
    return;
  }
  const npc = w.npc;
  const t = npc.stateTicks[i] as number;
  switch (npc.state[i] as number) {
    case PED.Walk:
    case PED.Cross:
      if (wantsToYield(w, i)) {
        enterPedestrianState(w, i, PED.Yield, 0);
        yieldStep(w, i);
        return;
      }
      walkRound(w, i);
      return;
    case PED.Idle:
      if (wantsToYield(w, i)) {
        enterPedestrianState(w, i, PED.Yield, 0);
        yieldStep(w, i);
        return;
      }
      stand(w, i);
      if (t >= (npc.stateLimit[i] as number)) {
        const round = w.npcAi.doorRound;
        const atDoor = npc.navState[i] === NavState.Arrived;
        enterPedestrianState(w, i, PED.Walk, 0);
        // A door he cannot reach shows as NoPath on his next tick: a stop where he stands, then the one after.
        if (requestNavPath(w, i, round.node[nextRoundStop(w, i)] as number) && !atDoor) skipTakenDoor(w, i);
      }
      return;
    case PED.Yield:
      if (t >= YIELD_MIN_TICKS && !wantsToYield(w, i)) {
        enterPedestrianState(w, i, PED.Walk, 0);
        walkRound(w, i);
        return;
      }
      yieldStep(w, i);
      return;
    default:
      tickPedestrian(w, i, false);
      return;
  }
}

export const postieBehaviour: Behaviour = {
  initial: PED.Walk,
  jaywalks: false,
  tick(w: World, i: number): void {
    tickPostie(w, i);
  },
  onStimulus(w: World, i: number, s: Stimulus): void {
    pedestrianStimulus(w, i, s, false);
  },
};
