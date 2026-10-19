// The NPC behaviour interface (TECHNICAL_DESIGN §11.1, SSP-080). Each NPC kind's module in
// src/sim/npc/behaviours/<camelCase>.ts exports one Behaviour: a table-driven finite state machine with its
// states as an `as const` object (no enums, no classes), looked up through registry.ts by the entities.json
// `behaviour` key. Phase 7 (npcAi.ts) calls `onStimulus` for each stimulus delivered to an NPC, then `tick`
// once per live NPC per tick, in index order. A new NPC starts in `initial`.
//
// Rules for behaviour code (it runs on the per-tick hot path): no allocation, no closures, no map/filter;
// read and write the NPC's columns in `w.npc` by index; change state with setNpcState (store.ts), which
// restarts the state clock; draw randomness only from `w.npcAi.rng` (the `npc` stream). A behaviour never adds
// or removes NPCs itself: the spawner (spawner.ts) owns the store's population, so indices stay valid for the
// whole of phase 7's behaviour pass.
import type { World } from '../world.ts';

/**
 * Stimulus types (TECHNICAL_DESIGN §11.1): pushed by the sim, never polled. Horn (radius 8 m, 12 m with
 * upg.two_tone_horn), Spray, Hit, NearMiss, HiVis (pwr.hi_vis: all pedestrians yield and part) and
 * BeaconYield (pedestrians start yielding at 6 m, 10 m with upg.led_beacon). Hashed: append, never renumber.
 */
export const Stimulus = {
  Horn: 1,
  Spray: 2,
  Hit: 3,
  NearMiss: 4,
  HiVis: 5,
  BeaconYield: 6,
} as const;
export type Stimulus = (typeof Stimulus)[keyof typeof Stimulus];

/** The largest Stimulus id. */
export const STIMULUS_MAX = 6;

/** One NPC kind's state machine. */
export type Behaviour = {
  /** The state a newly spawned NPC starts in. */
  readonly initial: number;
  /** Advance NPC `i` by one tick. */
  tick(w: World, i: number): void;
  /**
   * React to stimulus `s` delivered to NPC `i`. `slot` is the stimulus's index in `w.npcAi.stimuli` for the
   * rest of its data (where it came from and its radius), valid during this call only.
   */
  onStimulus(w: World, i: number, s: Stimulus, slot: number): void;
};
