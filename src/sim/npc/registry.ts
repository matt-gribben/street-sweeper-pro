// The behaviour registry (TECHNICAL_DESIGN §11.1, SSP-080): every entities.json `behaviour` key (NPC_BEHAVIOURS)
// mapped to its module in src/sim/npc/behaviours/. The World resolves the table once at shift start into
// `npcAi.behaviours`, indexed by NPC_IDS index, so phase 7 looks behaviours up by array index.
// Doris has hers (behaviours/oldWoman.ts, SSP-083); SSP-084 adds the shopper (behaviours/shopper.ts), the
// businessman (businessman.ts, an M3 jaywalker) and the litterbug (litterbug.ts); SSP-085 the old man
// (oldManFrame.ts), the mum (mumPushchair.ts) and the postie (postie.ts); SSP-087 the cat (cat.ts, the other M3
// jaywalker). Until a kind's own module lands (SSP-086 dog walker, SSP-088 market trader and pigeon):
// - since SSP-082 every other person kind maps to the generic pedestrian (behaviours/pedestrian.ts), the shared
//   reaction model, and the market trader to its stationary twin;
// - the pigeon keeps the no-op behaviour (SSP-080): the animals have their own reactions (ENTITY_CATALOG §7).
import { type Entities, NPC_IDS, type NpcBehaviour } from '../entities.ts';
import type { Behaviour } from './behaviour.ts';
import { businessmanBehaviour } from './behaviours/businessman.ts';
import { catBehaviour } from './behaviours/cat.ts';
import { litterbugBehaviour } from './behaviours/litterbug.ts';
import { mumPushchairBehaviour } from './behaviours/mumPushchair.ts';
import { noopBehaviour } from './behaviours/noop.ts';
import { oldManFrameBehaviour } from './behaviours/oldManFrame.ts';
import { oldWomanBehaviour } from './behaviours/oldWoman.ts';
import { pedestrianBehaviour, stationaryPedestrianBehaviour } from './behaviours/pedestrian.ts';
import { postieBehaviour } from './behaviours/postie.ts';
import { shopperBehaviour } from './behaviours/shopper.ts';

/** Behaviour modules by entities.json `behaviour` key. */
export const BEHAVIOUR_REGISTRY: { readonly [K in NpcBehaviour]: Behaviour } = {
  shopper: shopperBehaviour,
  old_woman: oldWomanBehaviour,
  old_man_frame: oldManFrameBehaviour,
  dog_walker: pedestrianBehaviour,
  litterbug: litterbugBehaviour,
  businessman: businessmanBehaviour,
  mum_pushchair: mumPushchairBehaviour,
  postie: postieBehaviour,
  market_trader: stationaryPedestrianBehaviour,
  cat: catBehaviour,
  pigeon: noopBehaviour,
};

/**
 * Each NPC kind's behaviour, in NPC_IDS order, looked up in `registry` by the kind's entities.json `behaviour`
 * key. Setup only.
 */
export function behavioursByKind(
  entities: Entities,
  registry: { readonly [K in NpcBehaviour]: Behaviour } = BEHAVIOUR_REGISTRY,
): Behaviour[] {
  return NPC_IDS.map((id) => registry[entities.npcs[id].behaviour]);
}
