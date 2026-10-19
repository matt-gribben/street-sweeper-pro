// npc.shopper, the baseline yielder (ENTITY_CATALOG §6.1–§6.2, §3.4; GDD §20 Q11; SSP-084): the generic
// pedestrian (pedestrian.ts) with three changes, so it teaches the player how pedestrians move.
//
//   Wander   from frontage door to frontage door (tickPedestrian's doorGoals), idling 1–3 s at each: the shop
//            windows. On a nav graph without doors it wanders to any node, as the generic pedestrian does.
//   Aware    inside the awareness radius (6 m, 10 m with upg.led_beacon) it yields, the shared rule: it stops
//            and parts out of Bessie's predicted path, or stands. That is GDD §20 Q11's "aware and slowing".
//   Sidestep when Bessie's predicted path (perception.ts: her body centre along her ground velocity for 1.5 s)
//            comes within entities.json rules.sidestepM (4 m) of it while she is coming its way (the closest
//            point is ahead of her, pathEtaS > 0), it hops aside: the shared Startle (startle frames: the 4-tick
//            hop, then frame 1 held while it sidesteps her path, 30 ticks in all), then Yield or Walk. From Walk,
//            Idle or Yield only, never mid-crossing (it never yields on the road either). Once per approach: the
//            DODGED latch is set as it hops and cleared on a perception query that finds her path farther than
//            sidestepM or not coming its way. The 4 m is measured against the predicted path, so a fast Bessie is
//            dodged from further off than a slow one (decided in SSP-084, GDD §20 Q11).
//
// Outfits (ART_BIBLE §5.6): each shopper draws its ramp-swap index 0..SHOPPER_SWAPS − 1 from the `npc` stream as
// it spawns (onSpawn, one draw) into the store's `swap`; the renderer reads it (SSP-103). Hit: entities.json
// `hit` (−250, 1 complaint, sfx ped_oi) through the shared actor-hit rule.
//
// Hot path: no allocation; positions cross calls only through typed arrays.
import { nextInt } from '../../rng.ts';
import type { World } from '../../world.ts';
import type { Behaviour, Stimulus } from '../behaviour.ts';
import { NPC_FLAG, NpcOrigin } from '../store.ts';
import {
  enterPedestrianState,
  PED,
  pedestrianStimulus,
  STARTLE_TICKS,
  tickPedestrian,
} from './pedestrian.ts';

/** The shopper's states: the shared human set (pedestrian.ts PED). */
export const SHOPPER = PED;

/** Outfit ramp swaps a shopper draws from (ENTITY_CATALOG §6.1: 8 outfit swaps; ART_BIBLE §5.6). */
export const SHOPPER_SWAPS = 8;

/**
 * Whether NPC `i`'s last perception query found Bessie's predicted path within `sidestepM` of it and coming its
 * way. False before its first query.
 */
function pathClose(w: World, i: number): boolean {
  const npc = w.npc;
  const gap = npc.pathGapM[i] as number;
  return (
    gap >= 0 && gap <= w.npcAi.entities.npcs['npc.shopper'].rules.sidestepM && (npc.pathEtaS[i] as number) > 0
  );
}

/** The shopper's tick: the sidestep latch and trigger, then the generic pedestrian with door goals. */
function tickShopper(w: World, i: number): void {
  const npc = w.npc;
  const f = npc.flags[i] as number;
  if (npc.origin[i] !== NpcOrigin.Companion) {
    if (!pathClose(w, i)) {
      if ((f & NPC_FLAG.DODGED) !== 0) npc.flags[i] = f & ~NPC_FLAG.DODGED;
    } else if ((f & NPC_FLAG.DODGED) === 0) {
      const state = npc.state[i] as number;
      if (state === PED.Walk || state === PED.Idle || state === PED.Yield) {
        enterPedestrianState(w, i, PED.Startle, STARTLE_TICKS);
        npc.flags[i] = (npc.flags[i] as number) | NPC_FLAG.DODGED;
      }
    }
  }
  tickPedestrian(w, i, false, true);
}

export const shopperBehaviour: Behaviour = {
  initial: SHOPPER.Walk,
  jaywalks: false,
  tick: tickShopper,
  onStimulus(w: World, i: number, s: Stimulus): void {
    pedestrianStimulus(w, i, s, false);
  },
  onSpawn(w: World, i: number): void {
    if (w.npc.origin[i] !== NpcOrigin.Companion) w.npc.swap[i] = nextInt(w.npcAi.rng, SHOPPER_SWAPS);
  },
};
