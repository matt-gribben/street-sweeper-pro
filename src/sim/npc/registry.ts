// The behaviour registry (TECHNICAL_DESIGN §11.1, SSP-080): every entities.json `behaviour` key (NPC_BEHAVIOURS)
// mapped to its module in src/sim/npc/behaviours/. Until a kind's module lands (SSP-083 Doris, SSP-084 shopper,
// businessman and litterbug, SSP-085 old man, mum and postie, SSP-086 dog walker, SSP-087 cat, SSP-088 market
// trader and pigeon), its key maps to the no-op behaviour. The World resolves the table once at shift start
// into `npcAi.behaviours`, indexed by NPC_IDS index, so phase 7 looks behaviours up by array index.
// SSP-081: the two M3 jaywalkers (TECHNICAL_DESIGN §11.1), the cat and the businessman, map to the jaywalking
// no-op until their modules (SSP-087, SSP-084) land with `jaywalks: true` of their own.
import { type Entities, NPC_IDS, type NpcBehaviour } from '../entities.ts';
import type { Behaviour } from './behaviour.ts';
import { noopBehaviour, noopJaywalkBehaviour } from './behaviours/noop.ts';

/** Behaviour modules by entities.json `behaviour` key. */
export const BEHAVIOUR_REGISTRY: { readonly [K in NpcBehaviour]: Behaviour } = {
  shopper: noopBehaviour,
  old_woman: noopBehaviour,
  old_man_frame: noopBehaviour,
  dog_walker: noopBehaviour,
  litterbug: noopBehaviour,
  businessman: noopJaywalkBehaviour,
  mum_pushchair: noopBehaviour,
  postie: noopBehaviour,
  market_trader: noopBehaviour,
  cat: noopJaywalkBehaviour,
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
