// zoo (SSP-298; TECHNICAL_DESIGN §6.2, ART_BIBLE §15.1, ASSET_PIPELINE §11.3): the test-only asset zoo, booted with
// `?test=1&scene=zoo&freeze=1` and never reachable from a menu or a scene transition (BootScene hands off to it only
// for `?test=1&scene=zoo`). It lays out `actors` and `items` frames from FRAME at 1:1 under the real palette pass and
// drop shadows, so an asset batch can be reviewed in-engine: open the frame `__ssp.readFrame()` returns with Read.
//
// Layout: src/scenes/zooLayout.ts (pure, unit-tested): three ground bands side by side (02 asphalt, 05 slab, 22 grass,
// 160 px each), Bessie `veh.sweeper:body:h00:0` top-left on every page for scale, and either one representative
// frame per asset (the default view, paged with `&page=<n>`) or every frame of one asset (`&asset=<id>`, one shelf per
// state, paged). An unknown `asset` is logged with console.error, naming it, and the default view is shown.
// Animation: with `&tick=<n>` (and `freeze=1` to hold it) each cell cycles within its (asset, state, direction) at
// 10 fps: frame floor(tick / 6) mod count (zooCellFrame).
//
// World (camera pinned over the origin at H = 31.5 m, so the ground and every flat sprite draw 1:1): the page's
// top-left pixel is sim (−15, −8.4375) m at W = 480 and page pixel (px, py) is sim ((px − 240) / 16, (py − 135) / 16)
// m; at other widths the page stays centred, the asphalt and grass bands running on to the frame edges. The bands
// are a placeholder-city grid of flat cells (placeholderCity.ts), so there are no building shadows. Every sprite is
// on the pedestrian depth layer, above the drop shadows, and writes mask (0, 0), so a sprite is never darkened by
// its own or a neighbour's shadow; the shadows (+2, +2, ART_BIBLE §6.4) darken only the ground.
//
// Draw calls: the ground, the drop shadows, the actors batch and the items batch (4; a view without items or without
// actors draws one fewer), plus the palette pass and the blit: 6 of the 10 allowed (TECHNICAL_DESIGN §12.7).
// There is no audio (test mode keeps audio off; there is none before M5).
//
// SSP-118 (M4) extends this scene to the world, ui and fx atlases, adds swap-slot rows and the `zoo` visual golden.
import { Group, type Mesh, ShaderMaterial, Texture } from 'three';
import type { SceneContext } from '../app/Game.ts';
import type { Scene, SceneParams } from '../app/SceneManager.ts';
import { FRAME, type FrameId } from '../gen/assets.ts';
import { SWEEP_HEIGHT_M } from '../render/camera.ts';
import { disposeCityMesh } from '../render/cityMesh.ts';
import { createPlaceholderCityMesh, parseCityGrid } from '../render/placeholderCity.ts';
import { DropShadowBatch, SpriteBatch } from '../render/spriteBatch.ts';
import { DepthLayer } from '../render/worldMaterial.ts';
import { PX_PER_M } from '../sim/constants.ts';
import type { InputFrame } from '../sim/inputFrame.ts';
import {
  ZOO_PAGE_H_PX,
  ZOO_PAGE_W_PX,
  type ZooCell,
  type ZooLayout,
  zooCellFrame,
  zooLayout,
} from './zooLayout.ts';

/**
 * The ground: one character per 2 m cell (`.` 02 asphalt, `:` 05 slab, `,` 22 grass), row 0 north, NW corner at
 * ZOO_GROUND_ORIGIN_M. 23 × 9 cells (46 m × 18 m) cover the widest frame (W = 640: ±20 m × ±8.44 m); the slab band
 * is sim x −5..5 m, the 160 px from page x 160 to 320.
 */
export const ZOO_GROUND_ROWS: readonly string[] = Array.from(
  { length: 9 },
  () => `${'.'.repeat(9)}${':'.repeat(5)}${','.repeat(9)}`,
);

/** Sim position of the ground grid's NW corner. */
export const ZOO_GROUND_ORIGIN_M: readonly [x: number, y: number] = [-23, -9];

/** The depth layer of every zoo sprite: above the drop shadows (4), so no shadow ever darkens a sprite. */
export const ZOO_SPRITE_LAYER = DepthLayer.Pedestrian;

/** Sim x of page pixel column `px` (the left edge of that pixel). */
export function zooPageXM(px: number): number {
  return (px - ZOO_PAGE_W_PX / 2) / PX_PER_M;
}

/** Sim y of page pixel row `py` (the top edge of that pixel). */
export function zooPageYM(py: number): number {
  return (py - ZOO_PAGE_H_PX / 2) / PX_PER_M;
}

/** What the zoo shows: `?test=1&page=<n>&asset=<id>` (src/debug/testHooks.ts). */
export type ZooSceneOptions = {
  readonly page: number;
  readonly asset: string | null;
};

/** The asset zoo (test only). */
export class ZooScene implements Scene {
  readonly id = 'zoo';
  readonly blocksUpdateBelow = false;
  readonly simEvents = null;
  private readonly context: SceneContext;
  private readonly options: ZooSceneOptions;
  private readonly world: Group;
  private ground: Mesh | null = null;
  private result: ZooLayout | null = null;
  private actors: SpriteBatch | null = null;
  private items: SpriteBatch | null = null;
  private shadows: DropShadowBatch | null = null;
  private ticks = 0;

  constructor(context: SceneContext, options: ZooSceneOptions) {
    this.context = context;
    this.options = options;
    this.world = new Group();
    this.world.name = 'zoo';
  }

  /** The layout on show (null before enter() resolves). */
  get layout(): ZooLayout | null {
    return this.result;
  }

  /** Ticks run since the scene joined: what the cells animate from. */
  get tick(): number {
    return this.ticks;
  }

  async enter(_params: SceneParams): Promise<void> {
    const layout = zooLayout(Object.keys(FRAME) as FrameId[], {
      page: this.options.page,
      asset: this.options.asset,
    });
    for (const error of layout.errors) console.error(error);
    const assets = this.context.assets;
    let actorCells = 0;
    let itemCells = 0;
    let casters = 0;
    for (const cell of layout.cells) {
      if (cell.atlas === 'actors') actorCells += 1;
      else itemCells += 1;
      if (cell.castsShadow) casters += 1;
    }
    const ground = createPlaceholderCityMesh(
      parseCityGrid(ZOO_GROUND_ROWS, ZOO_GROUND_ORIGIN_M[0], ZOO_GROUND_ORIGIN_M[1]),
    );
    ground.renderOrder = 0;
    this.world.add(ground);
    this.ground = ground;
    // After the ground (0): the drop shadows, then the actors, then the items (TECHNICAL_DESIGN §12.3).
    const actorsAtlas = assets.atlas('actors');
    const itemsAtlas = assets.atlas('items');
    if (casters > 0) {
      this.shadows = new DropShadowBatch([actorsAtlas, itemsAtlas], casters);
      this.shadows.mesh.renderOrder = 2;
      this.world.add(this.shadows.mesh);
    }
    if (actorCells > 0) {
      this.actors = new SpriteBatch(actorsAtlas, actorCells);
      this.actors.mesh.renderOrder = 3;
      this.world.add(this.actors.mesh);
    }
    if (itemCells > 0) {
      this.items = new SpriteBatch(itemsAtlas, itemCells);
      this.items.mesh.renderOrder = 4;
      this.world.add(this.items.mesh);
    }
    this.result = layout;
    this.context.root.add(this.world);
    this.context.pinCamera(0, 0, SWEEP_HEIGHT_M);
  }

  exit(): void {
    this.context.root.remove(this.world);
    const ground = this.ground;
    if (ground !== null) {
      // The placeholder atlas texture is the mesh's own (disposeCityMesh leaves shared atlases alone).
      const material = ground.material;
      if (material instanceof ShaderMaterial) {
        const atlas: unknown = material.uniforms.uAtlas?.value;
        if (atlas instanceof Texture) atlas.dispose();
      }
      disposeCityMesh(ground);
      this.ground = null;
    }
    this.actors?.dispose();
    this.items?.dispose();
    this.shadows?.mesh.geometry.dispose();
    const shadowMaterial = this.shadows?.mesh.material;
    if (shadowMaterial instanceof ShaderMaterial) shadowMaterial.dispose();
    this.actors = null;
    this.items = null;
    this.shadows = null;
  }

  fixedUpdate(_input: Readonly<InputFrame>): void {
    this.ticks += 1;
  }

  render(_alpha: number): void {
    const layout = this.result;
    if (layout === null) return;
    const camY = this.context.renderer.rig.snappedZ;
    const actors = this.actors;
    const items = this.items;
    const shadows = this.shadows;
    actors?.begin(camY);
    items?.begin(camY);
    shadows?.begin(camY);
    const cells = layout.cells;
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      if (cell !== undefined) this.pose(cell, actors, items, shadows);
    }
    actors?.end();
    items?.end();
    shadows?.end();
  }

  /** Adds one cell's sprite (and its drop shadow) at this tick's frame, the frame's top-left on the cell's. */
  private pose(
    cell: ZooCell,
    actors: SpriteBatch | null,
    items: SpriteBatch | null,
    shadows: DropShadowBatch | null,
  ): void {
    const frame = zooCellFrame(cell, this.ticks);
    const f = FRAME[frame];
    const xM = zooPageXM(cell.x + f.px);
    const yM = zooPageYM(cell.y + f.py);
    const batch = f.atlas === 'actors' ? actors : items;
    batch?.add(frame, xM, yM, ZOO_SPRITE_LAYER);
    if (cell.castsShadow) shadows?.add(frame, xM, yM);
  }
}
