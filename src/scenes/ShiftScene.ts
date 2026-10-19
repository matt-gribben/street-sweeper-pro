// ShiftScene, drive-only (TECHNICAL_DESIGN §6, SSP-046): loads a compiled district, creates a seeded World and
// steps it at 60 Hz from the player's input, and draws the city plus Bessie with render interpolation. It is the
// default boot scene from M1 (ROADMAP §1 principle 5: `npm run dev` always launches something drivable) and
// what `?test=1&scene=district.<name>` boots.
//
//   enter(params)       fetches `assets/levels/<name>.json` relative to import.meta.env.BASE_URL (levelLoader.ts;
//                       ShiftIntroScene preloads it in the full flow, §6.3), decodes it with map.ts, loads the
//                       `world` and `actors` atlases, calls createWorld(level, seed, tuning), builds the level city
//                       and Bessie's sprites and places the follow camera over her start pose;
//   fixedUpdate(input)  world.step(input): one tick of the canonical tick order (§5.2), then merges the tick's
//                       grime dirty rectangle into the city's GroundGrime (SSP-066);
//   render(alpha)       lerps Bessie's pose between the last two ticks (shortest arc for the heading), points the
//                       follow camera at it with her velocity and speed and poses her sprites (the brush overlay's
//                       spin frame from the World's RPM, brushSpin.ts), uploads the frame's union of grime dirty
//                       rectangles (one sub-rectangle, groundLayer.ts), then writes the items batch: the litter,
//                       stains, hydrants, skip and depot bays inside the camera's ground rect plus 4 m
//                       (itemsBatch.ts, SSP-067). It reads the World, never writes it.
//
// Draw calls: city (1) + building shadows (1) + Bessie's drop shadow (1) + actors batch (1) + items batch (1) +
// the HUD's UI batch (1), then the palette pass and the blit: 8 of the 10 budgeted (§12.7). The items draw is
// skipped (7) only when no item is in view.
//
// HUD (SSP-070, src/ui/hud.ts): enter() also loads the `ui` atlas and Kerbside 5×7 and builds the HUD over one
// UiSpriteBatch on the UI pass (SceneContext.ui); it subscribes to EV.ComboTier on the event bus for the tier
// popups and to EV.Complaint for the complaints meter's stamps (SSP-078; both unsubscribed in exit()). fixedUpdate() rolls the HUD's shown score after each World tick, and render()
// draws the HUD from the WorldView at the current internal width. The HUD only reads the World.
//
// The camera (SSP-047, src/render/camera.ts) follows Bessie's interpolated body centre, leads it by up to 3.0 m
// along her velocity (forward·vLong + right·vLat at the drawn heading) and takes its speed-zoom height from her
// vLong (31.5 m up to 6.0 m/s, 37.8 m from 11.0 m/s), snapped to the 1/16 m texel grid with the remainder carried
// by the sub-pixel blit. The velocity and speed are the World's latest tick values: the springs smooth them, so
// they need no interpolation.
//
// Dev builds (`recordInputs`) attach a full-shift input log to the World's phase-1 replay hook (SSP-038), so the
// dev panel can save the shift as a replay (SSP-048). M1's drive-only shift never ends: once the log is full
// (SHIFT_TICKS, 240 s) recording stops and the sim carries on.
//
// Live tuning (SSP-048): setTuning(tuning) hands the World an edited copy between ticks (world.ts
// setWorldTuning), never writing sim state itself. A replay reproduces only under one tuning, so the scene
// remembers whether any recorded tick ran on a tuning that differs from tuning.json (`logMatchesCommittedTuning`);
// the dev panel's Save replay refuses (or asks twice) when it does.
//
// The shift end's scene change (tally) is SSP-071; no audio (M5).
import type { Unsubscribe } from '../app/events.ts';
import type { SceneContext } from '../app/Game.ts';
import { type LevelSource, loadLevel } from '../app/levelLoader.ts';
import type { Scene, SceneParams } from '../app/SceneManager.ts';
import { type BessieSprite, createBessieSprite } from '../render/bessieSprite.ts';
import { brushSpinFrameAt, createBrushSpin } from '../render/brushSpin.ts';
import { cameraGroundRect } from '../render/camera.ts';
import { bodyVelocity, createPose, createVelocity, interpolatePose } from '../render/interpolate.ts';
import { ItemsBatch } from '../render/itemsBatch.ts';
import { createLevelCity, type LevelCity } from '../render/levelCity.ts';
import type { SpriteAtlas } from '../render/spriteAtlas.ts';
import { UiSpriteBatch } from '../render/spriteBatch.ts';
import type { Aabb } from '../sim/collision/obb.ts';
import { viewDirt } from '../sim/dirt.ts';
import type { ReadonlyEventQueue } from '../sim/eventQueue.ts';
import type { InputFrame } from '../sim/inputFrame.ts';
import type { Level } from '../sim/map.ts';
import { appendInput, createInputLog, DISTRICT_ID_PATTERN, type InputLog } from '../sim/replay.ts';
import { type SimSnapshot, snapshotWorld } from '../sim/snapshot.ts';
import { DEFAULT_TUNING, type Tuning, tuningsEqual } from '../sim/tuning.ts';
import { createWorld, setWorldTuning, viewWorld, type World, type WorldView } from '../sim/world.ts';
import { type BitmapFont, type FontJsonSource, loadBitmapFont } from '../ui/bitmapText.ts';
import { Hud } from '../ui/hud.ts';

/** The HUD's font (`public/assets/fonts/kerbside5x7.json`). */
export const HUD_FONT = 'kerbside5x7';

/** UI quads the HUD batch holds (the M2 HUD draws under 200). */
export const HUD_CAPACITY = 512;

/** The district `npm run dev` boots into in M1. */
export const DEFAULT_DISTRICT = 'district.puddle_lane';

export type ShiftSceneOptions = {
  /** Fetches the compiled level JSON (default: the browser's fetch, levelLoader.ts). Tests inject a file reader. */
  readonly levelSource?: LevelSource;
  /** The tuning the World runs on (default: tuning.json). The dev panel (SSP-048) passes an edited copy. */
  readonly tuning?: Tuning;
  /** Record the shift's input log through the World's replay hook (dev builds). Default false. */
  readonly recordInputs?: boolean;
  /** Fetches the HUD font's metrics JSON (default: the browser's fetch, bitmapText.ts). Tests inject a reader. */
  readonly fontSource?: FontJsonSource;
};

/** `district.<name>` → `<name>`, the compiled level's file name; throws on anything else. */
export function districtLevelName(district: string): string {
  if (!DISTRICT_ID_PATTERN.test(district)) {
    throw new Error(`ShiftScene: '${district}' is not a district ID (district.<snake_name>)`);
  }
  return district.slice('district.'.length);
}

/** What enter() builds once the level and atlases are in. */
type Built = {
  readonly sim: World;
  readonly city: LevelCity;
  readonly bessie: BessieSprite;
  readonly items: ItemsBatch;
  readonly hudBatch: UiSpriteBatch;
  readonly hud: Hud;
};

/** The drive-only shift: one World, its level city and Bessie. */
export class ShiftScene implements Scene {
  readonly id = 'shift';
  readonly blocksUpdateBelow = false;
  private readonly context: SceneContext;
  private readonly levelSource: LevelSource | undefined;
  private readonly fontSource: FontJsonSource | undefined;
  private currentTuning: Tuning;
  /** The tick from which the World has run on a tuning that differs from tuning.json, or null while it does not. */
  private offTuningSinceTick: number | null;
  /** True once an earlier off-tuning span covered at least one recorded tick. */
  private offTuningRecorded = false;
  private readonly recordInputs: boolean;
  private world: World | null = null;
  private city: LevelCity | null = null;
  private bessie: BessieSprite | null = null;
  private items: ItemsBatch | null = null;
  private hud: Hud | null = null;
  private hudBatch: UiSpriteBatch | null = null;
  private unsubscribeHud: Unsubscribe | null = null;
  private atlases: SpriteAtlas[] = [];
  /** The brush overlay's spin phase (render-side, brushSpin.ts). */
  private readonly brushSpin = createBrushSpin();
  /** The camera's ground rect this frame (the items batch's cull rect before its margin), reused every frame. */
  private readonly cameraRect: Aabb = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  private log: InputLog | null = null;
  private districtId: string | null = null;
  /** The pose drawn this frame, reused every frame. */
  private readonly pose = createPose();
  /** Bessie's ground velocity this frame (the camera's look-ahead direction), reused every frame. */
  private readonly velocity = createVelocity();
  private frames = 0;

  constructor(context: SceneContext, options: ShiftSceneOptions = {}) {
    this.context = context;
    this.levelSource = options.levelSource;
    this.fontSource = options.fontSource;
    this.currentTuning = options.tuning ?? DEFAULT_TUNING;
    this.offTuningSinceTick = tuningsEqual(this.currentTuning, DEFAULT_TUNING) ? null : 0;
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

  /** The items batch: litter, stains and the level's flat markers (null before enter() resolves). */
  get itemsBatch(): ItemsBatch | null {
    return this.items;
  }

  /** The HUD (null before enter() resolves). */
  get hudView(): Hud | null {
    return this.hud;
  }

  /** The HUD's UI batch (null before enter() resolves): its count is the quads drawn last frame. */
  get uiBatch(): UiSpriteBatch | null {
    return this.hudBatch;
  }

  /** Frames this scene has posed (render() calls). */
  get renderCount(): number {
    return this.frames;
  }

  /** The tuning the World runs on: tuning.json, the constructor's copy, or the last setTuning. */
  get tuning(): Tuning {
    return this.currentTuning;
  }

  /** True while the current tuning equals the committed tuning.json (DEFAULT_TUNING). */
  get tuningIsCommitted(): boolean {
    return this.offTuningSinceTick === null;
  }

  /**
   * True when every tick recorded so far ran on the committed tuning.json, so a replay of the input log
   * reproduces what was driven (`npm run test:replay` runs replays on tuning.json). Without a log, the ticks run.
   */
  get logMatchesCommittedTuning(): boolean {
    if (this.offTuningRecorded) return false;
    const since = this.offTuningSinceTick;
    return since === null || this.recordedTicks() <= since;
  }

  /**
   * Run the World on `tuning` from the next tick (the dev panel's live edit, SSP-048). Before enter() it only
   * replaces the tuning the World will be created with. Throws, changing nothing, if the World cannot take it
   * (setWorldTuning: different propFootprints).
   */
  setTuning(tuning: Tuning): void {
    if (this.world !== null) setWorldTuning(this.world, tuning);
    const since = this.offTuningSinceTick;
    if (since !== null && this.recordedTicks() > since) this.offTuningRecorded = true;
    this.currentTuning = tuning;
    if (tuningsEqual(tuning, DEFAULT_TUNING)) this.offTuningSinceTick = null;
    else if (since === null || this.recordedTicks() > since) this.offTuningSinceTick = this.world?.tick ?? 0;
  }

  /** Ticks that count for a replay: the input log's length, or the ticks run when not recording. */
  private recordedTicks(): number {
    return this.log?.length ?? this.world?.tick ?? 0;
  }

  /** JSON-safe snapshot of the World for `__ssp.state()` (null before enter() resolves). */
  snapshot(): SimSnapshot | null {
    return this.world === null ? null : snapshotWorld(this.world);
  }

  async enter(params: SceneParams): Promise<void> {
    const district = params.district;
    if (district === undefined) throw new Error('ShiftScene: entered without a district');
    const levelName = districtLevelName(district);
    const [level, world, actors, items, ui, font] = await Promise.all([
      loadLevel(levelName, this.levelSource),
      this.context.loadAtlas('world'),
      this.context.loadAtlas('actors'),
      this.context.loadAtlas('items'),
      this.context.loadAtlas('ui'),
      loadBitmapFont(HUD_FONT, this.fontSource),
    ]);
    const atlases = [world, actors, items, ui];
    let built: Built;
    try {
      if (level.id !== district) {
        throw new Error(`ShiftScene: ${levelName}.json holds '${level.id}', not '${district}'`);
      }
      built = this.build(level, params.seed, world, actors, items, ui, font);
    } catch (error: unknown) {
      for (const atlas of atlases) disposeAtlas(atlas);
      throw error;
    }
    const { sim, city, bessie, hud, hudBatch } = built;
    this.items = built.items;
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
    this.hud = hud;
    this.hudBatch = hudBatch;
    this.unsubscribeHud = hud.attach(this.context.events);
    this.atlases = atlases;
    this.districtId = district;
    this.context.root.add(city.group, bessie.group, built.items.mesh);
    this.context.ui.add(hudBatch.mesh);
    this.brushSpin.lastTick = -1;
    // Place the camera over Bessie before the first frame (no render time passes, so no spring moves).
    const v = sim.vehicle;
    bodyVelocity(v.headingRad, v.vLongMps, v.vLatMps, this.velocity);
    this.context.followCamera(v.xM, v.yM, this.velocity.xMps, this.velocity.yMps, v.vLongMps);
  }

  /**
   * The World, the level city, Bessie's sprites, the items batch and the HUD; releases whatever it built if a
   * later step throws.
   */
  private build(
    level: Level,
    seed: number,
    world: SpriteAtlas,
    actors: SpriteAtlas,
    items: SpriteAtlas,
    ui: SpriteAtlas,
    font: BitmapFont,
  ): Built {
    if (font.metrics.atlas !== ui.name) {
      throw new Error(`ShiftScene: ${font.metrics.id} draws from atlas '${font.metrics.atlas}', not 'ui'`);
    }
    const sim = createWorld(level, seed, this.currentTuning);
    const city = createLevelCity(level, world, undefined, viewDirt(sim.dirt));
    let bessie: BessieSprite | null = null;
    let itemsBatch: ItemsBatch | null = null;
    try {
      bessie = createBessieSprite(actors, this.currentTuning.vehicle.sweeper.health.dentedBelowHp);
      itemsBatch = new ItemsBatch(items, world, level, {
        litterCapacity: sim.litter.capacity,
        stainCapacity: sim.stains.capacity,
      });
      const hudBatch = new UiSpriteBatch(ui, HUD_CAPACITY);
      return { sim, city, bessie, items: itemsBatch, hudBatch, hud: new Hud(hudBatch, font) };
    } catch (error: unknown) {
      itemsBatch?.dispose();
      bessie?.dispose();
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
    if (this.items !== null) {
      this.context.root.remove(this.items.mesh);
      this.items.dispose();
      this.items = null;
    }
    this.unsubscribeHud?.();
    this.unsubscribeHud = null;
    if (this.hudBatch !== null) {
      this.context.ui.remove(this.hudBatch.mesh);
      this.hudBatch.dispose();
      this.hudBatch = null;
    }
    this.hud = null;
    for (const atlas of this.atlases) disposeAtlas(atlas);
    this.atlases = [];
    if (this.world !== null) {
      this.world.recordInput = null;
      this.world = null;
    }
    this.context.releaseCamera();
  }

  fixedUpdate(input: Readonly<InputFrame>): void {
    const world = this.world;
    if (world === null) return;
    world.step(input);
    this.city?.grime?.accumulate(world.dirt);
    this.hud?.tick(world);
  }

  render(alpha: number): void {
    const world = this.world;
    const bessie = this.bessie;
    if (world === null || bessie === null) return;
    const v = world.vehicle;
    const pose = this.pose;
    interpolatePose(v, alpha, pose);
    const velocity = this.velocity;
    bodyVelocity(pose.headingRad, v.vLongMps, v.vLatMps, velocity);
    this.context.followCamera(pose.xM, pose.yM, velocity.xMps, velocity.yMps, v.vLongMps);
    const rig = this.context.renderer.rig;
    const spinFrame = brushSpinFrameAt(this.brushSpin, world.tick, v.rpm);
    bessie.update(pose, v.hp, v.brushDown, spinFrame, rig.snappedZ);
    this.city?.grime?.upload(this.context.renderer.webgl);
    const items = this.items;
    if (items !== null) {
      cameraGroundRect(rig, 0, this.cameraRect);
      items.update(world.litter, world.stains, world.tick, alpha, this.cameraRect, rig.snappedZ);
    }
    const hud = this.hud;
    const batch = this.hudBatch;
    if (hud !== null && batch !== null) {
      batch.begin();
      hud.draw(world, rig.internalWidth);
      batch.end();
    }
    this.frames += 1;
  }
}

function disposeAtlas(atlas: SpriteAtlas): void {
  atlas.texture.dispose();
  atlas.swapTexture.dispose();
}
