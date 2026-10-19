// npc.litterbug, the litterbug teen (ENTITY_CATALOG §6.1–§6.2, GDD §10.3, LEVEL_DESIGN §9.1 rule 7; SSP-084): the
// generic pedestrian (he yields like a shopper), who drops litter until a honk catches him.
//
//   Drops    one item every entities.json rules.dropEveryMinS..dropEveryMaxS (3–5 s = 180..300 ticks; one `npc`
//            stream draw per interval, uniform over the whole ticks). The countdown is the store's `timerA`:
//            armed as he spawns (onSpawn; on his first tick when he was added by hand), it loses one tick per
//            tick and, on the tick it would reach 0, he drops one item and it is armed again, so drops are exactly
//            the drawn interval apart. It is paused while he lies Fallen or gets up, and stops for good once he
//            is caught. The item: one draw over the district's small-litter table (hazards.ts createSpillTable:
//            the level's litter.table restricted to kinds of at most 1 LU with no brush-up rule, at their
//            weights; crisp packets, cans, butts, wrappers, bottles; never dog mess, leaf piles or bin bags),
//            then its rotation (one draw). It lands DROP_BEHIND_M behind him (on his centre if that is a blocked
//            tile or off the map), through litter.ts addLitterAt, so it counts toward litter spawned (the Tidy %
//            denominator, its frontage's zone) and respects the 2,000-item cap (a full LitterField drops nothing).
//   Caught!  a Horn stimulus whose origin (Bessie's body centre as the honk's tick starts, EV.Horn) is within
//            rules.caughtRadiusM (6 m, edge included) of his centre, in any state but Fallen and GetUp, catches
//            him, once: he is marked LEAVING (NPC_FLAG), EV.Caught is emitted (entity = his index, a, b = his
//            centre, c = rules.caughtPts, +100), and the honk is flagged so phase 9 does not count it toward horn
//            spam (complaints.ts markHornCaught). Phase 9 awards the points through the bonus API (scoring.ts):
//            a style bonus, never multiplied by the combo and never extending or resetting the chain (GDD
//            §10.3). The honk startles him like anyone (the shared rule, from Walk, Cross, Idle or Yield); a honk
//            farther than 6 m but inside the horn radius only startles him, and he keeps dropping.
//   Slink    once caught, as the startle (or a fist-shake, or a walk) ends, he slinks off the map: LITTERBUG.Slink
//            (walk frames, head down), walking at his own speed to the nearest map-edge portal of the nav graph
//            (straight-line, lowest node on a tie), sidestepping Bessie's predicted path but never yielding. He
//            drops nothing more and ignores every stimulus but a Hit (he can still be knocked over: Fallen,
//            GetUp, Angry, then Slink again). The spawner retires him on its first run with his circle off the
//            view (NPC_FLAG.LEAVING, spawner.ts), wherever he has got to.
// Hit: entities.json `hit` (−250, 1 complaint) through the shared actor-hit rule.
//
// Hot path: no allocation; positions cross calls only through typed arrays (addLitterAt takes a scratch array).

import { markHornCaught } from '../../complaints.ts';
import { SIM_HZ, TILE_M } from '../../constants.ts';
import { EV, emitEvent } from '../../eventQueue.ts';
import { cos, sin } from '../../fmath.ts';
import { addLitterAt, LITTER_ROTATIONS } from '../../litter.ts';
import { nextInt } from '../../rng.ts';
import type { World } from '../../world.ts';
import { type Behaviour, Stimulus } from '../behaviour.ts';
import { NavState, requestNavPath, STEER_TILE, walkNpc } from '../steering.ts';
import { NPC_FLAG, NpcOrigin } from '../store.ts';
import { ANGRY_TICKS, enterPedestrianState, PED, pedestrianStimulus, tickPedestrian } from './pedestrian.ts';

/**
 * The litterbug's states: the shared human set, plus Slink (caught, walking off the map; plays walk). Hashed
 * (store `state`): append, never renumber.
 */
export const LITTERBUG = { ...PED, Slink: 8 } as const;
export type LitterbugState = (typeof LITTERBUG)[keyof typeof LITTERBUG];

/** A dropped item lands this far behind his centre, metres (chosen in SSP-084: at his heels). */
export const DROP_BEHIND_M = 0.3;

/** Where the next drop lands: [x, y], metres (addLitterAt's position, so no double crosses the call). */
const dropAt = new Float64Array(2);

/** The drop interval range in whole ticks, from entities.json rules (3–5 s → 180..300). */
function dropTicksMin(w: World): number {
  return Math.round(w.npcAi.entities.npcs['npc.litterbug'].rules.dropEveryMinS * SIM_HZ);
}

function dropTicksMax(w: World): number {
  return Math.round(w.npcAi.entities.npcs['npc.litterbug'].rules.dropEveryMaxS * SIM_HZ);
}

/** Arm NPC `i`'s drop countdown: one `npc` draw, uniform over min..max ticks. */
function armDrop(w: World, i: number): void {
  const min = dropTicksMin(w);
  w.npc.timerA[i] = min + nextInt(w.npcAi.rng, dropTicksMax(w) - min + 1);
}

/**
 * Drop one item of the district's small-litter table behind NPC `i` (see the header): its kind, then its
 * rotation, two `npc` draws. Returns the item's LitterField index, or −1 when the field is full.
 */
function dropLitter(w: World, i: number): number {
  const npc = w.npc;
  const table = w.hazards.spill;
  const rng = w.npcAi.rng;
  let pick = nextInt(rng, table.total);
  let kind = table.kind[0] as number;
  for (let t = 0; t < table.count; t += 1) {
    const weight = table.weight[t] as number;
    if (pick < weight) {
      kind = table.kind[t] as number;
      break;
    }
    pick -= weight;
  }
  const rot = nextInt(rng, LITTER_ROTATIONS);
  const ox = npc.x[i] as number;
  const oy = npc.y[i] as number;
  const h = npc.heading[i] as number;
  // Behind him: −forward, forward = (sin h, −cos h).
  let x = ox - sin(h) * DROP_BEHIND_M;
  let y = oy + cos(h) * DROP_BEHIND_M;
  const st = w.npcAi.steering;
  const tx = Math.floor(x / TILE_M);
  const ty = Math.floor(y / TILE_M);
  if (
    !(tx >= 0 && ty >= 0 && tx < st.widthTiles && ty < st.heightTiles) ||
    ((st.tileFlags[ty * st.widthTiles + tx] as number) & STEER_TILE.BLOCKED) !== 0
  ) {
    x = ox;
    y = oy;
  }
  dropAt[0] = x;
  dropAt[1] = y;
  return addLitterAt(w.litter, kind, dropAt, rot);
}

/** The drop countdown for this tick (not caught; see the header). */
function stepDrops(w: World, i: number): void {
  const npc = w.npc;
  const state = npc.state[i] as number;
  if (state === PED.Fallen || state === PED.GetUp) return;
  const left = npc.timerA[i] as number;
  if (left === 0) {
    armDrop(w, i);
    return;
  }
  if (left > 1) {
    npc.timerA[i] = left - 1;
    return;
  }
  dropLitter(w, i);
  armDrop(w, i);
}

/** The nav portal nearest NPC `i` in a straight line (lowest node on a tie), or −1 when there is none. */
function nearestPortal(w: World, i: number): number {
  const nav = w.level.nav;
  const portals = nav.portals;
  const x = w.npc.x[i] as number;
  const y = w.npc.y[i] as number;
  let best = -1;
  let bestD2 = Number.POSITIVE_INFINITY;
  for (let k = 0; k < portals.length; k += 1) {
    const n = portals[k] as number;
    const dx = (nav.nodeX[n] as number) - x;
    const dy = (nav.nodeY[n] as number) - y;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) {
      bestD2 = d2;
      best = n;
    }
  }
  return best;
}

/** Start slinking: LITTERBUG.Slink, with a path to the nearest portal (NoPath when there is none). */
function enterSlink(w: World, i: number): void {
  enterPedestrianState(w, i, LITTERBUG.Slink, 0);
  const portal = nearestPortal(w, i);
  if (portal >= 0) requestNavPath(w, i, portal);
  else w.npc.navState[i] = NavState.NoPath;
}

/** One tick of slinking: walk the path, sidestepping her predicted path; stand once there (or with no path). */
function slinkStep(w: World, i: number): void {
  const ns = w.npc.navState[i] as number;
  if (ns === NavState.Idle) {
    const portal = nearestPortal(w, i);
    if (portal >= 0) requestNavPath(w, i, portal);
  }
  walkNpc(w, i, true);
}

/** The litterbug's tick (see the header). */
function tickLitterbug(w: World, i: number): void {
  const npc = w.npc;
  if (((npc.flags[i] as number) & NPC_FLAG.LEAVING) === 0) {
    stepDrops(w, i);
    tickPedestrian(w, i, false);
    return;
  }
  const state = npc.state[i] as number;
  const t = npc.stateTicks[i] as number;
  switch (state) {
    case LITTERBUG.Slink:
      slinkStep(w, i);
      return;
    case PED.Walk:
    case PED.Cross:
    case PED.Idle:
    case PED.Yield:
      enterSlink(w, i);
      slinkStep(w, i);
      return;
    case PED.Startle:
      if (t >= (npc.stateLimit[i] as number)) {
        enterSlink(w, i);
        slinkStep(w, i);
        return;
      }
      break;
    case PED.Angry:
      if (t >= ANGRY_TICKS) {
        enterSlink(w, i);
        slinkStep(w, i);
        return;
      }
      break;
    default:
      break;
  }
  tickPedestrian(w, i, false);
}

/** A Horn from (q.x[slot], q.y[slot]) within caughtRadiusM catches NPC `i` (see the header). */
function maybeCaught(w: World, i: number, slot: number): void {
  const npc = w.npc;
  const f = npc.flags[i] as number;
  if ((f & NPC_FLAG.LEAVING) !== 0) return;
  const state = npc.state[i] as number;
  if (state === PED.Fallen || state === PED.GetUp) return;
  const rules = w.npcAi.entities.npcs['npc.litterbug'].rules;
  const q = w.npcAi.stimuli;
  const dx = (npc.x[i] as number) - (q.x[slot] as number);
  const dy = (npc.y[i] as number) - (q.y[slot] as number);
  const r = rules.caughtRadiusM;
  if (dx * dx + dy * dy > r * r) return;
  npc.flags[i] = f | NPC_FLAG.LEAVING;
  const e = emitEvent(w.events, EV.Caught, i);
  w.events.a[e] = npc.x[i] as number;
  w.events.b[e] = npc.y[i] as number;
  w.events.c[e] = rules.caughtPts;
  markHornCaught(w.complaints);
}

export const litterbugBehaviour: Behaviour = {
  initial: LITTERBUG.Walk,
  jaywalks: false,
  tick: tickLitterbug,
  onStimulus(w: World, i: number, s: Stimulus, slot: number): void {
    const leaving = ((w.npc.flags[i] as number) & NPC_FLAG.LEAVING) !== 0;
    if (leaving) {
      // Caught and slinking off: only a Hit still reaches him.
      if (s === Stimulus.Hit) pedestrianStimulus(w, i, s, false);
      return;
    }
    if (s === Stimulus.Horn) maybeCaught(w, i, slot);
    pedestrianStimulus(w, i, s, false);
  },
  onSpawn(w: World, i: number): void {
    if (w.npc.origin[i] !== NpcOrigin.Companion) armDrop(w, i);
  },
};
