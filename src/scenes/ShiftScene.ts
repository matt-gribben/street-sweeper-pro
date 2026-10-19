// ShiftScene, drive-only (TECHNICAL_DESIGN §6, SSP-046): loads a compiled district, creates a seeded World and
// steps it at 60 Hz from the player's input, and draws the city plus Bessie with render interpolation. It is the
// default boot scene from M1 (ROADMAP §1 principle 5: `npm run dev` always launches something drivable) and
// what `?test=1&scene=district.<name>` boots.
//
//   enter(params)       fetches `assets/levels/<name>.json` relative to import.meta.env.BASE_URL (levelLoader.ts;
//                       ShiftIntroScene preloads it in the full flow, §6.3), decodes it with map.ts, loads the
//                       `world` and `actors` atlases, calls createWorld(level, seed, tuning), builds the level city
//                       and Bessie's sprites and places the follow camera over her start pose;
//   fixedUpdate(input)  world.step(input): one tick of the canonical tick order (§5.2);
//   render(alpha)       lerps Bessie's pose between the last two ticks (shortest arc for the heading), points the
//                       follow camera at it and poses her sprites. It reads the World, never writes it.
//
// Draw calls: city (1) + building shadows (1) + Bessie's drop shadow (1) + actors batch (1), then the palette
// pass and the blit: 6 of the 10 budgeted (§12.7).
//
// The camera follows Bessie's interpolated body centre at the sweep height, snapped to the 1/16 m texel grid with
// the remainder carried by the sub-pixel blit (M0's camera rig). Look-ahead and speed zoom from her real speed
// are SSP-047, so this scene passes speed 0 and the zoom target stays 31.5 m.
//
// Dev builds (`recordInputs`) attach a full-shift input log to the World's phase-1 replay hook (SSP-038), so the
// dev panel can save the shift as a replay (SSP-048). M1's drive-only shift never ends: once the log is full
// (SHIFT_TICKS, 240 s) recording stops and the sim carries on.
//
// No HUD, timer or shift end (M2), no look-ahead or zoom (SSP-047), no audio (M5).
import type { SceneContext } from '../app/Game.ts';
import { type LevelSource, loadLevel } from '../app/levelLoader.ts';
import type { Scene, SceneParams } from '../app/SceneManager.ts';
import { type BessieSprite, createBessieSprite } from '../render/bessieSprite.ts';
import { createPose, interpolatePose } from '../render/interpolate.ts';
import { createLevelCity, type LevelCity } from '../render/levelCity.ts';
import type { SpriteAtlas } from '../render/spriteAtlas.ts';
import type { ReadonlyEventQueue } from '../sim/eventQueue.ts';
import type { InputFrame } from '../sim/inputFrame.ts';
import type { Level } from '../sim/map.ts';
import { appendInput, createInputLog, DISTRICT_ID_PATTERN, type InputLog } from '../sim/replay.ts';
import { type SimSnapshot, snapshotWorld } from '../sim/snapshot.ts';
import { DEFAULT_TUNING, type Tuning } from '../sim/tuning.ts';
import { createWorld, viewWorld, type World, type WorldView } from '../sim/world.ts';

/** The district `npm run dev` boots into in M1. */
export const DEFAULT_DISTRICT = 'district.puddle_lane';

/** The speed the follow camera's zoom target gets until SSP-047 feeds Bessie's real speed: 0, i.e. 31.5 m. */
const M1_CAMERA_SPEED_MPS = 0;

export type ShiftSceneOptions = {
  /** Fetches the compiled level JSON (default: the browser's fetch, levelLoader.ts). Tests inject a file reader. */
  readonly levelSource?: LevelSource;
  /** The tuning the World runs on (default: tuning.json). The dev panel (SSP-048) passes an edited copy. */
  readonly tuning?: Tuning;
  /** Record the shift's input log through the World's replay hook (dev builds). Default false. */
  readonly recordInputs?: boolean;
};

/** `district.<name>` → `<name>`, the compiled level's file name; throws on anything else. */
export function districtLevelName(district: string): string {
  if (!DISTRICT_ID_PATTERN.test(district)) {
    throw new Error(`ShiftScene: '${district}' is not a district ID (district.<snake_name>)`);
  }
  return district.slice('district.'.length);
}

/** What enter() builds once the level and atlases are in. */
type Built = { readonly sim: World; readonly city: LevelCity; readonly bessie: BessieSprite };

/** The drive-only shift: one World, its level city and Bessie. */
export class ShiftScene implements Scene {
  readonly id = 'shift';
  readonly blocksUpdateBelow = false;
  private readonly context: SceneContext;
  private readonly levelSource: LevelSource | undefined;
  private readonly tuning: Tuning;
  private readonly recordInputs: boolean;
  private world: World | null = null;
  private city: LevelCity | null = null;
  private bessie: BessieSprite | null = null;
  private atlases: SpriteAtlas[] = [];
  private log: InputLog | null = null;
  private districtId: string | null = null;
  /** The pose drawn this frame, reused every frame. */
  private readonly pose = createPose();
  private frames = 0;

  constructor(context: SceneContext, options: ShiftSceneOptions = {}) {
    this.context = context;
    this.levelSource = options.levelSource;
    this.tuning = options.tuning ?? DEFAULT_TUNING;
    this.recordInputs = options.recordInputs ?? false;
  }

  /** The World's event queue, drained into the bus after every tick (null before enter() resolves). */
  get simEvents(): ReadonlyEventQueue | null {
    return this.world?.events ?? null;
  }

  /** The World, read-only (null before enter() resolves or after exit()). */
  get worldView(): WorldView | null {
    return this.world === null ? null : viewWorld(this.world);
  }

  /** The district this scene entered (`district.<name>`), or null before enter(). */
  get district(): string | null {
    return this.districtId;
  }

  /** The recorded input log (dev builds), or null when not recording. Its length is the ticks recorded. */
  get inputLog(): InputLog | null {
    return this.log;
  }

  /** The built level city (null before enter() resolves). */
  get levelCity(): LevelCity | null {
    return this.city;
  }

  /** Bessie's sprites (null before enter() resolves). */
  get bessieSprite(): BessieSprite | null {
    return this.bessie;
  }

  /** Frames this scene has posed (render() calls). */
  get renderCount(): number {
    return this.frames;
  }

  /** JSON-safe snapshot of the World for `__ssp.state()` (null before enter() resolves). */
  snapshot(): SimSnapshot | null {
    return this.world === null ? null : snapshotWorld(this.world);
  }

  async enter(params: SceneParams): Promise<void> {
    const district = params.district;
    if (district === undefined) throw new Error('ShiftScene: entered without a district');
    const levelName = districtLevelName(district);
    const [level, world, actors] = await Promise.all([
      loadLevel(levelName, this.levelSource),
      this.context.loadAtlas('world'),
      this.context.loadAtlas('actors'),
    ]);
    const atlases = [world, actors];
    let built: Built;
    try {
      if (level.id !== district) {
        throw new Error(`ShiftScene: ${levelName}.json holds '${level.id}', not '${district}'`);
      }
      built = this.build(level, params.seed, world, actors);
    } catch (error: unknown) {
      for (const atlas of atlases) disposeAtlas(atlas);
      throw error;
    }
    const { sim, city, bessie } = built;
    if (this.recordInputs) {
      const log = createInputLog();
      // Like attachInputLog (replay.ts), but stops at the log's capacity instead of throwing: M1 never ends.
      sim.recordInput = (tick, input) => {
        if (log.length < log.capacity) appendInput(log, tick, input);
      };
      this.log = log;
    }
    this.world = sim;
    this.city = city;
    this.bessie = bessie;
    this.atlases = atlases;
    this.districtId = district;
    this.context.root.add(city.group, bessie.group);
    // Place the camera over Bessie before the first frame (no render time passes).
    this.context.followCamera(sim.vehicle.xM, sim.vehicle.yM, M1_CAMERA_SPEED_MPS);
  }

  /** The World, the level city and Bessie's sprites; releases whatever it built if a later step throws. */
  private build(level: Level, seed: number, world: SpriteAtlas, actors: SpriteAtlas): Built {
    const sim = createWorld(level, seed, this.tuning);
    const city = createLevelCity(level, world);
    try {
      const bessie = createBessieSprite(actors, this.tuning.vehicle.sweeper.health.dentedBelowHp);
      return { sim, city, bessie };
    } catch (error: unknown) {
      city.dispose();
      throw error;
    }
  }

  exit(): void {
    if (this.city !== null) {
      this.context.root.remove(this.city.group);
      this.city.dispose();
      this.city = null;
    }
    if (this.bessie !== null) {
      this.context.root.remove(this.bessie.group);
      this.bessie.dispose();
      this.bessie = null;
    }
    for (const atlas of this.atlases) disposeAtlas(atlas);
    this.atlases = [];
    if (this.world !== null) {
      this.world.recordInput = null;
      this.world = null;
    }
    this.context.releaseCamera();
  }

  fixedUpdate(input: Readonly<InputFrame>): void {
    this.world?.step(input);
  }

  render(alpha: number): void {
    const world = this.world;
    const bessie = this.bessie;
    if (world === null || bessie === null) return;
    const v = world.vehicle;
    const pose = this.pose;
    interpolatePose(v, alpha, pose);
    this.context.followCamera(pose.xM, pose.yM, M1_CAMERA_SPEED_MPS);
    bessie.update(pose, v.hp, v.brushDown, this.context.renderer.rig.snappedZ);
    this.frames += 1;
  }
}

function disposeAtlas(atlas: SpriteAtlas): void {
  atlas.texture.dispose();
  atlas.swapTexture.dispose();
}
