// fx_puddle (SSP-102): a test-only Puddle Lane shift with one haz.puddle placed on Mangle Street, north of the depot
// on Bessie's lane, booted with `?test=1&seed=<n>&scene=fx_puddle&freeze=1`. Compiled Puddle Lane has no puddles
// until SSP-104 populates it, and the splash fx needs a real EV.Splash from the sim: this scene is the shift
// itself (a ShiftScene, so `__ssp.state()`, `loadInputs` and the bus all work as in `district.puddle_lane`) on the
// compiled level with FX_PUDDLE prepended to its hazard placements. The change is level data, applied before the
// World is created, so the sim stays f(seed, level, inputs): tests rebuild the same level in Node with
// withFxPuddle() and plan the drive there. tests/e2e/fx.spec.ts drives through the puddle above 3 m/s and saves the
// frozen frame just after the splash for review.
//
// Since SSP-103 the puddle's decal is drawn (the items batch's hazard decals), so the capture shows the splash
// particles round it. There is no shift flow round it: the shift ends where it ends.
import type { SceneContext } from '../app/Game.ts';
import { browserLevelSource, type LevelSource } from '../app/levelLoader.ts';
import type { SceneParams } from '../app/SceneManager.ts';
import { decodeLevel, encodeLevel, type Level, type PlacedHazard } from '../sim/map.ts';
import { DEFAULT_DISTRICT, ShiftScene } from './ShiftScene.ts';

/** `?test=1&scene=fx_puddle`. */
export const FX_PUDDLE_SCENE = 'fx_puddle';

/** The placed puddle: tile (3, 35) of Mangle Street, 18 m north of the depot start (7, 89), on Bessie's lane. */
export const FX_PUDDLE: Readonly<PlacedHazard> = { id: 'haz.puddle', x: 7, y: 71 };

/** `level` with FX_PUDDLE placed first; every other hazard rule (placements, random requests) is kept. */
export function withFxPuddle(level: Level): Level {
  const hazards = level.hazards;
  const puddle: PlacedHazard = { id: FX_PUDDLE.id, x: FX_PUDDLE.x, y: FX_PUDDLE.y };
  return {
    ...level,
    hazards: {
      place: [puddle, ...(hazards?.place ?? [])],
      random: hazards?.random ?? [],
      candidates: hazards?.candidates ?? new Uint8Array(level.size[0] * level.size[1]),
    },
  };
}

/** The Puddle Lane shift with FX_PUDDLE on Mangle Street. `source` fetches the compiled level (tests inject one). */
export class FxPuddleScene extends ShiftScene {
  constructor(context: SceneContext, source: LevelSource = browserLevelSource) {
    super(context, {
      levelSource: async (url) => encodeLevel(withFxPuddle(decodeLevel(await source(url)))),
    });
  }

  override enter(params: SceneParams): Promise<void> {
    return super.enter({ seed: params.seed, district: DEFAULT_DISTRICT });
  }
}
