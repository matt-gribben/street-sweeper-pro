// level_preview (SSP-045): a test-only scene that draws compiled Puddle Lane (`public/assets/levels/puddle_lane.json`)
// with the level renderer (src/render/levelCity.ts: chunked ground, markings, merged walls and roofs in one draw,
// plus the building shadows) from a pinned camera, for frozen review captures and its visual golden. Booted with
// `?test=1&scene=level_preview&freeze=1`. There is no sim, no Bessie and no props: ShiftScene (SSP-046) brings
// those and may keep or remove this scene.
//
// The camera is pinned at the sweep height over the crossroads of the north–south street at tiles x 22–24 and the
// east–west street at tiles y 21–23 (sim x 32–62 m, y 35.6–52.4 m in view at W = 480), so one frame shows: kerb
// blob runs and all four kinds of junction corner, centre-line dashes and double yellows, and a building in each
// screen quadrant (a 3-storey block north-east, 2-storey terraces elsewhere) whose walls toward the screen centre
// show: S faces (`dark`) above the centre, N faces (`lit`) below, E faces (`dark`) on the left and W faces (`lit`)
// on the right, each block's shadow falling SE across its pavement and into the road. The visual spec also pins a
// second view (`level_preview_station`) over the speed bump and parking bays of the station street.
// Draw calls: city + building shadows (2), plus the palette pass and blit (4).
import type { SceneContext } from '../app/Game.ts';
import { type LevelSource, loadLevel } from '../app/levelLoader.ts';
import type { Scene, SceneParams } from '../app/SceneManager.ts';
import { SWEEP_HEIGHT_M } from '../render/camera.ts';
import { createLevelCity, type LevelCity } from '../render/levelCity.ts';
import type { InputFrame } from '../sim/inputFrame.ts';

/** The district the preview draws (`district.puddle_lane`). */
export const LEVEL_PREVIEW_DISTRICT = 'puddle_lane';

/** The pinned camera focus in sim metres (x east, y south), at SWEEP_HEIGHT_M (1 texel = 1 px). */
export const LEVEL_PREVIEW_CAMERA_M: readonly [x: number, y: number] = [47, 44];

/**
 * The level_preview scene: loads the level, takes the `world` atlas from the asset registry (SSP-284), builds the
 * city once, pins the camera.
 */
export class LevelPreviewScene implements Scene {
  readonly id = 'level_preview';
  readonly blocksUpdateBelow = false;
  readonly simEvents = null;
  private readonly context: SceneContext;
  private readonly levelSource: LevelSource | undefined;
  private city: LevelCity | null = null;

  constructor(context: SceneContext, levelSource?: LevelSource) {
    this.context = context;
    this.levelSource = levelSource;
  }

  /** The built city (null before enter() resolves). */
  get levelCity(): LevelCity | null {
    return this.city;
  }

  async enter(_params: SceneParams): Promise<void> {
    const atlas = this.context.assets.atlas('world');
    const level = await loadLevel(LEVEL_PREVIEW_DISTRICT, this.levelSource);
    this.city = createLevelCity(level, atlas);
    this.context.root.add(this.city.group);
    this.context.pinCamera(LEVEL_PREVIEW_CAMERA_M[0], LEVEL_PREVIEW_CAMERA_M[1], SWEEP_HEIGHT_M);
  }

  exit(): void {
    if (this.city !== null) {
      this.context.root.remove(this.city.group);
      this.city.dispose();
      this.city = null;
    }
  }

  fixedUpdate(_input: Readonly<InputFrame>): void {}

  render(_alpha: number): void {}
}
