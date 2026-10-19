// npc.businessman, on his phone (ENTITY_CATALOG §6.1–§6.2, §3.4; TECHNICAL_DESIGN §11.1; SSP-084): the generic
// pedestrian with his own perception.
//
//   Phone    he stares at his phone and ignores Bessie: BeaconYield (the awareness radius, 6 m, or the 10 m of
//            upg.led_beacon) is dropped before the shared rules see it, so he is never AWARE and never yields to
//            it (entities.json `yields` is false as well). Idle plays the phone frames.
//   Notice   when Bessie's body comes within entities.json rules.noticeM (2 m) of his centre (the distance to
//            her body outline, her tuning.json body.widthM × lengthM box), he looks up and startles: the shared
//            Startle from Walk, Cross, Idle or Yield (the 4-tick hop, then he sidesteps her predicted path, or
//            steps away from her when she is on top of him). Once per approach: the DODGED latch is set as he
//            startles and cleared on the first tick she is farther than noticeM. Measured every tick, not on
//            his staggered perception ticks, so it is tick-exact.
//   Horn     he reacts to it like everyone (the shared rule: Startle within the horn radius, 8 m).
//   Hi-vis   pwr.hi_vis makes him yield and part within the awareness radius (the shared HI_VIS rule).
//   Crossing he jaywalks (Behaviour.jaywalks, SSP-081): any road tile is his, and he takes crossings without the
//            kerb wait, "without looking".
// Hit: entities.json `hit` (−250, 1 complaint) through the shared actor-hit rule.
//
// Hot path: no allocation; positions cross calls only through typed arrays.
import { cos, sin, sqrt } from '../../fmath.ts';
import type { World } from '../../world.ts';
import { type Behaviour, Stimulus } from '../behaviour.ts';
import { NPC_FLAG } from '../store.ts';
import {
  enterPedestrianState,
  PED,
  pedestrianStimulus,
  STARTLE_TICKS,
  tickPedestrian,
} from './pedestrian.ts';

/** The businessman's states: the shared human set (pedestrian.ts PED). */
export const BUSINESSMAN = PED;

/**
 * The distance from NPC `i`'s centre to the outline of Bessie's body (0 inside it), metres: her body box,
 * tuning.json body.widthM × lengthM, centred on her pose and turned to her heading.
 */
export function gapToBessieM(w: World, i: number): number {
  const v = w.vehicle;
  const body = w.tuning.vehicle.sweeper.body;
  const dx = (w.npc.x[i] as number) - v.xM;
  const dy = (w.npc.y[i] as number) - v.yM;
  const s = sin(v.headingRad);
  const c = cos(v.headingRad);
  // Forward = (sin h, −cos h), right = (cos h, sin h).
  let along = dx * s - dy * c;
  let across = dx * c + dy * s;
  if (along < 0) along = -along;
  if (across < 0) across = -across;
  along -= body.lengthM * 0.5;
  across -= body.widthM * 0.5;
  if (along < 0) along = 0;
  if (across < 0) across = 0;
  return sqrt(along * along + across * across);
}

/** The businessman's tick: notice Bessie at 2 m (once per approach), then the generic pedestrian. */
function tickBusinessman(w: World, i: number): void {
  const npc = w.npc;
  const f = npc.flags[i] as number;
  if (gapToBessieM(w, i) > w.npcAi.entities.npcs['npc.businessman'].rules.noticeM) {
    if ((f & NPC_FLAG.DODGED) !== 0) npc.flags[i] = f & ~NPC_FLAG.DODGED;
  } else if ((f & NPC_FLAG.DODGED) === 0) {
    const state = npc.state[i] as number;
    if (state === PED.Walk || state === PED.Cross || state === PED.Idle || state === PED.Yield) {
      enterPedestrianState(w, i, PED.Startle, STARTLE_TICKS);
      npc.flags[i] = (npc.flags[i] as number) | NPC_FLAG.DODGED;
    }
  }
  tickPedestrian(w, i, false);
}

export const businessmanBehaviour: Behaviour = {
  initial: BUSINESSMAN.Walk,
  jaywalks: true,
  tick: tickBusinessman,
  onStimulus(w: World, i: number, s: Stimulus): void {
    // Eyes on his phone: the awareness radius and the LED beacon never reach him.
    if (s === Stimulus.BeaconYield) return;
    pedestrianStimulus(w, i, s, false);
  },
};
