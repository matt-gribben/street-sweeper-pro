// hud_sample (SSP-070): a test-only scene for the M2 HUD (src/ui/hud.ts), booted with
// `?test=1&scene=hud_sample&freeze=1` (add `night=1` for the night remap). It draws the HUD from a fixed snapshot
// with every element at its widest, so one frame per width shows the layout's worst case: the timer flashing red,
// a seven-digit score, the ×5 combo with its chain-timer bar, the ×5 tier popup mid-rise, a full hopper, the water
// tank and Dignity in their warning colours, the hold-to-dump prompt with its ring half full, and the complaints
// meter at 4 (SSP-078) shaking, with every box state: two stamped at rest, a stamp mid-shake, one slamming in
// and an empty box. It is the HUD's
// evidence scene until the M4 `hud_specimen` golden: tests/e2e/hud.spec.ts saves its frames at W = 480, 432 and
// 640 to test-results/ and checks every UI pixel against a CPU rasterisation of the same model.
//
// World: a wide placeholder street (the HUD_SAMPLE_ROWS grid, wider than W = 640 at the sweep height): a 3-storey
// terrace along the top whose building shadow falls on the asphalt below it, a slab pavement, and asphalt along
// the bottom under the gauges, so the HUD shows over shadow, sun, asphalt and slab.
//
// Static: the snapshot and its tick never change. Draw calls: city mesh, building shadows, the UI batch (3), plus
// the palette pass and the blit: 5 of the 10 allowed (TECHNICAL_DESIGN §12.7).
import { Group } from 'three';
import type { SceneContext } from '../app/Game.ts';
import type { Scene, SceneParams } from '../app/SceneManager.ts';
import { SWEEP_HEIGHT_M } from '../render/camera.ts';
import { mergeBoxes } from '../render/cityMesh.ts';
import { createPlaceholderCityMesh, parseCityGrid } from '../render/placeholderCity.ts';
import { createBuildingShadows } from '../render/shadows.ts';
import type { SpriteAtlas } from '../render/spriteAtlas.ts';
import { UiSpriteBatch } from '../render/spriteBatch.ts';
import type { InputFrame } from '../sim/inputFrame.ts';
import { DumpState } from '../sim/shift.ts';
import { type BitmapFont, loadBitmapFont } from '../ui/bitmapText.ts';
import { Hud } from '../ui/hud.ts';
import { createHudModel, type HudModel, type HudSnapshot, hudModel } from '../ui/hudModel.ts';
import { HUD_CAPACITY, HUD_FONT } from './ShiftScene.ts';

/** One character per 2 m cell (`.` asphalt, `:` slab, `3` a 3-storey building); row 0 is north. 48 × 10 cells. */
export const HUD_SAMPLE_ROWS: readonly string[] = [
  '333333333333333.......3333333333333333..........',
  '................................................',
  '................................................',
  '................................................',
  '::::::::::::::::::::::::::::::::::::::::::::::::',
  '::::::::::::::::::::::::::::::::::::::::::::::::',
  '::::::::::::::::::::::::::::::::::::::::::::::::',
  '................................................',
  '................................................',
  '................................................',
];

/** Sim position of the grid's NW corner: the 96 m × 20 m grid is centred on the origin. */
export const HUD_SAMPLE_ORIGIN_M: readonly [x: number, y: number] = [-48, -10];

/** The tick the sample is drawn at: the ×5 colour cycle and the full-hopper flash are on their first step. */
export const HUD_SAMPLE_TICK = 600;

/**
 * The sample snapshot: every element visible and at its widest (see the header). The popup started 18 ticks
 * before HUD_SAMPLE_TICK (half-way up its rise); the dump hold is at 30 of 60 ticks (ring step 4 of 8). Four
 * complaints: the third stamp is 3 ticks old (Stamped, 1 px left), the fourth 2 ticks (Slam, 1 px right), and
 * the meter's warning shake, 2 ticks into its burst, puts the rest 1 px right.
 */
export const HUD_SAMPLE_SNAPSHOT: Readonly<HudSnapshot> = Object.freeze({
  ticksRemaining: 1_799,
  score: -9_999_999,
  multiplier: 5,
  chain: 104,
  chainTimerTicks: 60,
  chainRefreshTicks: 120,
  hopperLu: 100,
  hopperCapacityLu: 100,
  hopperWarnFraction: 0.8,
  water: 37,
  tankUnits: 100,
  hp: 35,
  maxHp: 100,
  dentedBelowHp: 40,
  popupStartTick: HUD_SAMPLE_TICK - 18,
  popupMultiplier: 5,
  dumpAvailable: true,
  dumpState: DumpState.Holding,
  dumpHoldTicks: 30,
  dumpHoldTotalTicks: 60,
  complaints: 4,
  complaintStampTicks: Int32Array.of(120, 300, HUD_SAMPLE_TICK - 3, HUD_SAMPLE_TICK - 2, -1),
});

/** The sample's model (pure: the same every call). */
export function hudSampleModel(out: HudModel = createHudModel()): HudModel {
  return hudModel(HUD_SAMPLE_SNAPSHOT, HUD_SAMPLE_TICK, out);
}

/** The hud_sample scene. */
export class HudSampleScene implements Scene {
  readonly id = 'hud_sample';
  readonly blocksUpdateBelow = false;
  readonly simEvents = null;
  private readonly context: SceneContext;
  private readonly world: Group;
  private atlas: SpriteAtlas | null = null;
  private batch: UiSpriteBatch | null = null;
  private hud: Hud | null = null;
  private readonly model = createHudModel();

  constructor(context: SceneContext) {
    this.context = context;
    const grid = parseCityGrid(HUD_SAMPLE_ROWS, HUD_SAMPLE_ORIGIN_M[0], HUD_SAMPLE_ORIGIN_M[1]);
    const city = createPlaceholderCityMesh(grid);
    city.renderOrder = 0;
    const shadows = createBuildingShadows(mergeBoxes(grid));
    shadows.renderOrder = 1;
    this.world = new Group();
    this.world.name = 'hudSample';
    this.world.add(city, shadows);
  }

  /** The UI batch (null before enter() resolves): its count is the quads drawn last frame. */
  get uiBatch(): UiSpriteBatch | null {
    return this.batch;
  }

  async enter(_params: SceneParams): Promise<void> {
    const [atlas, font]: [SpriteAtlas, BitmapFont] = await Promise.all([
      this.context.loadAtlas('ui'),
      loadBitmapFont(HUD_FONT),
    ]);
    if (font.metrics.atlas !== atlas.name) {
      atlas.texture.dispose();
      atlas.swapTexture.dispose();
      throw new Error(`hud_sample: ${font.metrics.id} draws from atlas '${font.metrics.atlas}', not 'ui'`);
    }
    this.atlas = atlas;
    const batch = new UiSpriteBatch(atlas, HUD_CAPACITY);
    this.batch = batch;
    this.hud = new Hud(batch, font);
    hudSampleModel(this.model);
    this.context.root.add(this.world);
    this.context.ui.add(batch.mesh);
    this.context.pinCamera(0, 0, SWEEP_HEIGHT_M);
  }

  exit(): void {
    this.context.root.remove(this.world);
    if (this.batch !== null) {
      this.context.ui.remove(this.batch.mesh);
      this.batch.dispose();
      this.batch = null;
    }
    if (this.atlas !== null) {
      this.atlas.texture.dispose();
      this.atlas.swapTexture.dispose();
      this.atlas = null;
    }
    this.hud = null;
  }

  fixedUpdate(_input: Readonly<InputFrame>): void {}

  render(_alpha: number): void {
    const batch = this.batch;
    const hud = this.hud;
    if (batch === null || hud === null) return;
    batch.begin();
    hud.drawModel(this.model, this.context.renderer.rig.internalWidth);
    batch.end();
  }
}
