// NPC footprints (TECHNICAL_DESIGN §11.1; SSP-081, SSP-085): the circle radius each NPC kind gets at spawn
// (store `radius`), which Bessie's actor contact (reactions.ts), separation and every NPC-vs-NPC, prop and
// tile constraint of the steering core (steering.ts) and the spawner's view checks (spawner.ts) all read.
//   - People: tuning.json → streetLife.npcRadius.humanM (0.3 m), except
//   - npc.mum_pushchair: the pushchair widens her footprint (ENTITY_CATALOG §6.2), so she gets entities.json
//     rules.footprintRadiusM (0.55 m: 1.1 m across, the ≤ 18 px figure of ART_BIBLE §7.2 at 16 px/m, about
//     half a 1-tile pavement and most of its walkable middle). A circle centred on her cell covers her and the
//     pushchair ahead of her; proposed in SSP-085 (a capsule or OBB along her heading was the alternative, but
//     a circle keeps every circle path above unchanged), owner to review.
//   - Cats and pigeons: catM (pigeons have no radius of their own); a companion dog: dogM (the spawner sets it).
// Setup only (spawner and steering tables); nothing here runs per tick.
import { type Entities, NPC_IDS } from '../entities.ts';
import type { Tuning } from '../tuning.ts';

/** The footprint radius of NPC kind `k` (NPC_IDS index), metres. A companion dog uses dogM instead. */
export function npcKindRadiusM(tuning: Tuning, entities: Entities, k: number): number {
  const r = tuning.streetLife.npcRadius;
  const id = NPC_IDS[k];
  if (id === undefined) throw new Error(`npcKindRadiusM: ${k} is not an NPC kind index`);
  const behaviour = entities.npcs[id].behaviour;
  if (behaviour === 'cat' || behaviour === 'pigeon') return r.catM;
  if (behaviour === 'mum_pushchair') return entities.npcs['npc.mum_pushchair'].rules.footprintRadiusM;
  return r.humanM;
}

/** The largest footprint radius any NPC can have (every kind's, and the companion dog's), metres. */
export function largestNpcRadiusM(tuning: Tuning, entities: Entities): number {
  let max = tuning.streetLife.npcRadius.dogM;
  for (let k = 0; k < NPC_IDS.length; k += 1) {
    const r = npcKindRadiusM(tuning, entities, k);
    if (r > max) max = r;
  }
  return max;
}
