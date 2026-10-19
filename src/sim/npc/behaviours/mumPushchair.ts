// The parent with the pushchair, npc.mum_pushchair (ENTITY_CATALOG §6.1–§6.2; SSP-085). **Wide and slow**: she
// walks at her entities.json speed, 1.1 m/s, and the pushchair widens her footprint so she blocks most of a
// pavement. The footprint is her store `radius`, which the spawner gives her from entities.json
// rules.footprintRadiusM (0.55 m, a circle 1.1 m across centred on her cell; footprint.ts has why a circle)
// instead of the 0.3 m human circle. Everything that touches an NPC reads that radius, so the wider footprint is
// what Bessie's actor contact tests against (reactions.ts: a hit is −500 and 2 complaints, entities.json `hit`),
// what separation keeps the others clear of, and what the steering constraints hold off buildings, props and
// the other NPCs (steering.ts). On a 1-tile pavement she edges round a lamp post on its road side, her centre
// on the pavement and the pushchair over the kerb.
//
// Otherwise she is the generic pedestrian (pedestrian.ts): she wanders, idles, crosses at crossings, yields
// inside the awareness radius (her kind `yields`), startles, falls, gets up and shakes her fist.
import type { World } from '../../world.ts';
import type { Behaviour, Stimulus } from '../behaviour.ts';
import { PED, pedestrianStimulus, tickPedestrian } from './pedestrian.ts';

export const mumPushchairBehaviour: Behaviour = {
  initial: PED.Walk,
  jaywalks: false,
  tick(w: World, i: number): void {
    tickPedestrian(w, i, false);
  },
  onStimulus(w: World, i: number, s: Stimulus): void {
    pedestrianStimulus(w, i, s, false);
  },
};
