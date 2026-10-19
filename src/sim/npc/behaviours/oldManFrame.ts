// The old man with the walking frame, npc.old_man_frame (ENTITY_CATALOG §6.1–§6.2, §11; SSP-085). He is the
// generic pedestrian (pedestrian.ts: wander the nav graph, idle, startle, fall, get up, shake his fist, yield
// inside the awareness radius, since his kind `yields`) at his entities.json speed, 0.4 m/s, with one rule of
// his own: he **crosses only at zebras**. His behaviour's navAvoid forbids the dropped-kerb and school-crossing
// edges of the nav graph, so every path he plans or re-plans (steering.ts findNavPath) crosses a road only on a
// ZEBRA edge; a goal he could reach only another way is no path (NoPath), and the generic machine idles and
// draws a new one. He waits at the kerb like everyone (kerbLookS and the gap check) and then takes the crossing
// at his own pace: a 6 m two-lane zebra takes him 6 / 0.4 = 15 s (900 ticks), during which the zebra is
// occupied (world.zebras) and Bessie entering it is the occupied-zebra offence (zebraOffence.ts). He never
// yields mid-road (wantsToYield is false on a crossing). A hit is −500 and 2 complaints (entities.json `hit`,
// reactions.ts), on top of the zebra offence when she runs his crossing to do it.
//
// "Shuffle-frame-shuffle" is his walk animation (the 4 walk frames, ART_BIBLE §10.2), which the renderer draws
// from `state` and `stateTicks`; his motion is the steering core's steady walk, so the crossing time is exact.
import { NAV_FLAG } from '../../map.ts';
import type { World } from '../../world.ts';
import type { Behaviour, Stimulus } from '../behaviour.ts';
import { PED, pedestrianStimulus, tickPedestrian } from './pedestrian.ts';

/** The nav edges he never plans over: every road crossing but the zebra. */
export const OLD_MAN_NAV_AVOID = NAV_FLAG.DROPPED_KERB | NAV_FLAG.SCHOOL_CROSSING;

export const oldManFrameBehaviour: Behaviour = {
  initial: PED.Walk,
  jaywalks: false,
  navAvoid: OLD_MAN_NAV_AVOID,
  tick(w: World, i: number): void {
    tickPedestrian(w, i, false);
  },
  onStimulus(w: World, i: number, s: Stimulus): void {
    pedestrianStimulus(w, i, s, false);
  },
};
