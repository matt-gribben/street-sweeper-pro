// stress (SSP-106): the NPC budget's stress fixture as a test-only shift, booted with
// `?test=1&seed=<n>&scene=stress&freeze=1`. It is a ShiftScene (so `__ssp.state()`, `step(n)` and the perf counters
// work as in `district.high_street`; `scene()` reports `shift`) on compiled High Street with every store raised to
// its capacity before the World is created (src/debug/stress.ts stressLevel: 2,000 litter, 128 knockables, 64
// hazards, a population of 80 NPCs, 20 parked and 10 moving vehicles), on the fixture's tuning (an endless shift,
// SACKED out of reach), and every tick the fixture's director writes the input and tops the stores up
// (directStress), so the World is the one tests/unit/stressAlloc.test.ts steps in Node: a pure function of the seed.
// tests/e2e/perf.spec.ts runs it for the `ci` project's draw-call and sim step budgets. There is no shift flow round
// it, no tutorial and no tally: the shift never ends.
import type { SceneContext } from '../app/Game.ts';
import { browserLevelSource, type LevelSource } from '../app/levelLoader.ts';
import type { SceneParams } from '../app/SceneManager.ts';
import {
  createStressDirector,
  directStress,
  STRESS_DISTRICT,
  type StressDirector,
  stressLevel,
  stressTuning,
} from '../debug/stress.ts';
import type { InputFrame } from '../sim/inputFrame.ts';
import { decodeLevel, encodeLevel } from '../sim/map.ts';
import type { World } from '../sim/world.ts';
import { ShiftScene } from './ShiftScene.ts';

/** The stress fixture's shift. `source` fetches compiled High Street (tests inject one). */
export class StressScene extends ShiftScene {
  private director: StressDirector | null = null;

  constructor(context: SceneContext, source: LevelSource = browserLevelSource) {
    super(context, {
      levelSource: async (url) => encodeLevel(stressLevel(decodeLevel(await source(url)))),
      tuning: stressTuning(),
    });
  }

  /** The director (null before the first tick): its counters say what it made happen. */
  get stressDirector(): StressDirector | null {
    return this.director;
  }

  override enter(params: SceneParams): Promise<void> {
    this.director = null;
    return super.enter({ seed: params.seed, district: STRESS_DISTRICT });
  }

  override exit(): void {
    this.director = null;
    super.exit();
  }

  protected override directTick(world: World, _input: Readonly<InputFrame>): Readonly<InputFrame> {
    // Created on the first tick, from the shift-start World (its litter is what the director puts back).
    let director = this.director;
    if (director === null) {
      director = createStressDirector(world);
      this.director = director;
    }
    return directStress(director, world);
  }
}
