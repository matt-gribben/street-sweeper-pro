// npc.market_trader, the market trader (ENTITY_CATALOG §6.1–§6.2, §3.4; LEVEL_DESIGN §4.3, §7.6; SSP-088): the
// generic pedestrian's stationary twin (behaviours/pedestrian.ts, `stationary`), manning one market pitch.
//
//   Pitch    the spawner (spawner.ts) adds one trader per pitch of the level's `market` event once it opens
//            (shift.ts ShiftEvents: from shift start for a market with no `at`), origin NpcOrigin.Market, `group`
//            = the pitch, on the tile in front of the pitch's prop.market_stall (shift.ts picks it), facing away
//            from the stall into the aisle (ShiftEvents traderHeading). He mans it all shift (the catalog: "all
//            shift"; the market_close pile builds round him, he does not leave).
//   Idle     calling out to the aisle (the idle frames). His speed is 0 (entities.json), so he never walks.
//   Never moves: every state holds him where he stands (the shared stationary rules). He never yields, and
//            pwr.hi_vis leaves him where he is (ENTITY_CATALOG §3.4: stationary NPCs do not move; HI_VIS is never
//            marked). The horn, a bump and a spray startle him on the spot; a hit (entities.json `hit`, −250 and 1
//            complaint, through the shared actor-hit rule) knocks him down on the spot: Fallen, GetUp, then Angry,
//            facing Bessie, then Idle, turned back to his aisle. Other people step round him (steering resolves
//            the mover, never the one it meets), and Bessie never pushes an actor.
//
// Hot path: no allocation.
import type { World } from '../../world.ts';
import type { Behaviour, Stimulus } from '../behaviour.ts';
import { NpcOrigin } from '../store.ts';
import { PED, pedestrianStimulus, tickPedestrian } from './pedestrian.ts';

/** The trader's states: the shared human set (pedestrian.ts PED), of which he uses Idle, Startle, Fallen, GetUp, Angry. */
export const MARKET_TRADER = PED;

/** Face NPC `i` into its pitch's aisle (a hand-added trader with no pitch keeps its heading). */
function faceAisle(w: World, i: number): void {
  const npc = w.npc;
  const ev = w.shiftEvents;
  const p = npc.group[i] as number;
  if ((npc.origin[i] as number) !== NpcOrigin.Market || p < 0 || p >= ev.pitchCount) return;
  npc.heading[i] = ev.traderHeading[p] as number;
}

/** The trader's tick: the stationary pedestrian; back to facing his aisle as a fist-shake ends. */
function tickMarketTrader(w: World, i: number): void {
  const npc = w.npc;
  const wasAngry = (npc.state[i] as number) === PED.Angry;
  tickPedestrian(w, i, true);
  if (wasAngry && (npc.state[i] as number) === PED.Idle) faceAisle(w, i);
}

export const marketTraderBehaviour: Behaviour = {
  initial: MARKET_TRADER.Idle,
  jaywalks: false,
  tick: tickMarketTrader,
  onStimulus(w: World, i: number, s: Stimulus): void {
    pedestrianStimulus(w, i, s, true);
  },
  onSpawn(w: World, i: number): void {
    faceAisle(w, i);
  },
};
