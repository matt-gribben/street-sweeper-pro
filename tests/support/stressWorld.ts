// The NPC budget's stress World in Node (SSP-106): compiled High Street through src/debug/stress.ts stressLevel, on
// the fixture's tuning, with its director, exactly as `?test=1&scene=stress` (src/scenes/StressScene.ts) runs it in
// the browser. tests/unit/stressAlloc.test.ts and stressFixture.test.ts step it; tests/e2e/perf.spec.ts runs the same
// World in Node to know what the browser's frames hold.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  createStressDirector,
  directStress,
  type StressDirector,
  stressLevel,
  stressTuning,
} from '../../src/debug/stress.ts';
import { countEvents, EV, type EventType } from '../../src/sim/eventQueue.ts';
import { decodeLevel, type Level } from '../../src/sim/map.ts';
import { createWorld, type World } from '../../src/sim/world.ts';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** Compiled High Street with the stress fixture's caps (stressLevel). */
export function stressFixtureLevel(): Level {
  return stressLevel(decodeLevel(readFileSync(`${REPO_ROOT}public/assets/levels/high_street.json`, 'utf8')));
}

/** The events every rig step tallies (StressRig.tally, in this order). */
export const STRESS_TALLY_EVENTS = [
  EV.HandbagWhack,
  EV.FistShake,
  EV.LeadTangle,
  EV.NpcHit,
  EV.Caught,
  EV.LitterCollected,
] as const satisfies readonly EventType[];

export type StressRig = {
  readonly world: World;
  readonly director: StressDirector;
  /** Events emitted since the rig was made, per STRESS_TALLY_EVENTS entry. */
  readonly tally: Int32Array;
  /**
   * One tick: the director's pokes and input, world.step, then the tally. The tally runs on every step, pre-warm
   * included, so a measured window runs the same code as the ticks before it (TECHNICAL_DESIGN §17).
   */
  readonly step: () => void;
};

/** A fresh stress World seeded with `seed` and its director, at tick 0. */
export function stressRig(seed: number, level: Level = stressFixtureLevel()): StressRig {
  const world = createWorld(level, seed >>> 0, stressTuning());
  const director = createStressDirector(world);
  const tally = new Int32Array(STRESS_TALLY_EVENTS.length);
  const step = (): void => {
    world.step(directStress(director, world));
    for (let e = 0; e < STRESS_TALLY_EVENTS.length; e++)
      tally[e] = (tally[e] as number) + countEvents(world.events, STRESS_TALLY_EVENTS[e] as EventType);
  };
  return { world, director, tally, step };
}
