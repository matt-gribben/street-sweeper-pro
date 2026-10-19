// Phase 7, NPC AI (TECHNICAL_DESIGN §5.2, §11.1, SSP-080): the state that drives the NPC store, and the
// behaviour pass. World.step runs phase 7 as these calls, in this order (world.ts phaseNpc):
//   1. beginNpcTick (store.ts): prevX/prevY ← x/y, for render interpolation;
//   2. updateViewRect (viewRect.ts): world.viewRect around Bessie's pose after phase 3;
//   3. stepNpcSpawner (spawner.ts): named arrivals, then once a second the placed cats and flocks and the
//      ambient population (at most 2 spawns or retirements);
//   4. stepReactions (reactions.ts, SSP-082): pushReactionStimuli, the tick's Horn (from EV.Horn), HiVis and
//      BeaconYield, then stepActorContacts, Bessie against the actors' circles: hits (penalty, EV.NpcHit, drops,
//      a Hit stimulus) and bumps (a Bump stimulus);
//   5. deliverStimuli (stimuli.ts): every queued stimulus, to the behaviours' onStimulus;
//   6. perceiveNpcs (perception.ts): the perception query of the quarter of the store on this tick's phase;
//   7. tickNpcBehaviours (here): each live NPC's behaviour tick, in index order, then its state clock;
//   8. stepZebras (zebraOffence.ts): updateZebraOccupancy (steering.ts, SSP-081), world.zebras from where the
//      NPCs ended up; then the occupied-zebra offence (SSP-085), Bessie entering an occupied zebra.
// Steering (steering.ts, SSP-081) and the generic pedestrian (behaviours/pedestrian.ts, SSP-082) plug into the
// behaviours' ticks.
//
// Hot path: tickNpcBehaviours allocates nothing.
import type { StaticGrid } from '../collision/grid.ts';
import type { Entities } from '../entities.ts';
import type { Level } from '../map.ts';
import { createStream, type Sfc32 } from '../rng.ts';
import type { Tuning } from '../tuning.ts';
import type { World } from '../world.ts';
import type { Behaviour } from './behaviour.ts';
import { createOldWomanParams, type OldWomanParams } from './behaviours/oldWoman.ts';
import { createDoorRound, type DoorRound } from './doorRound.ts';
import { createReactions, type Reactions } from './reactions.ts';
import { behavioursByKind } from './registry.ts';
import { createNpcSpawner, type NpcSpawner } from './spawner.ts';
import { createSteering, type Steering, type Zebras } from './steering.ts';
import { createStimulusQueue, type StimulusQueue } from './stimuli.ts';

/** Everything phase 7 needs besides the store itself (world.npc). */
export type NpcAi = {
  /** The `npc` stream, sfc32(seed ^ hash32('npc')): the spawner's and the behaviours' draws. */
  readonly rng: Sfc32;
  readonly stimuli: StimulusQueue;
  /**
   * Each NPC kind's behaviour, by NPC_IDS index (registry.ts). Tests may replace entries between ticks; the
   * game never does.
   */
  readonly behaviours: Behaviour[];
  readonly spawner: NpcSpawner;
  /** The steering core's tables, search buffers and kerb gap check (steering.ts, SSP-081). */
  readonly steering: Steering;
  /** The validated entities.json the World runs on (the kinds' behaviour keys and radius classes). */
  readonly entities: Entities;
  /** The shared reaction rules' state: awareness radius, hi-vis, the per-kind hit tables (reactions.ts). */
  readonly reactions: Reactions;
  /** Doris's numbers in ticks and metres (behaviours/oldWoman.ts, SSP-083), from entities.json. */
  readonly oldWoman: OldWomanParams;
  /** The level's frontage doors in the postie's walking order (doorRound.ts, SSP-085). */
  readonly doorRound: DoorRound;
};

/**
 * Phase 7's state for a shift on `level` with `seed`; steering takes the props from `grid`, the zebras from
 * `zebras` and sizes its neighbour buffer for `capacity` NPCs. Setup only.
 */
export function createNpcAi(
  level: Level,
  seed: number,
  tuning: Tuning,
  entities: Entities,
  grid: StaticGrid,
  zebras: Zebras,
  capacity: number,
): NpcAi {
  const steering = createSteering(level, grid, zebras, tuning, capacity, entities);
  return {
    rng: createStream(seed >>> 0, 'npc'),
    stimuli: createStimulusQueue(),
    behaviours: behavioursByKind(entities),
    spawner: createNpcSpawner(level, tuning, entities),
    steering,
    entities,
    reactions: createReactions(tuning, entities, capacity),
    oldWoman: createOldWomanParams(entities),
    doorRound: createDoorRound(level, steering),
  };
}

/**
 * Phase 7, last step: run every live NPC's behaviour tick in index order, then advance its state clock
 * (stateTicks counts the ticks spent in the current state, this one included; setNpcState restarts it at 0,
 * so an NPC that changes state this tick ends it at 1).
 */
export function tickNpcBehaviours(w: World): void {
  const npc = w.npc;
  const behaviours = w.npcAi.behaviours;
  for (let i = 0; i < npc.count; i += 1) {
    (behaviours[npc.kind[i] as number] as Behaviour).tick(w, i);
    npc.stateTicks[i] = (npc.stateTicks[i] as number) + 1;
  }
}
