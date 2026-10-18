// scale_sheet (SSP-024): the D-07 scale-sheet sign-off scene, booted with `?test=1&scene=scale_sheet&freeze=1`
// (src/debug/testHooks.ts). Bessie's body (28×52 px), a 24×24 human (Doris) and a 16×16 litter item (the
// ingested banana skin) side by side at 1:1, once on asphalt and once on pavement (ART_BIBLE §3.1, §3.2, §7.1;
// ROADMAP D-07).
//
// Layout (camera over the origin at H = 31.5 m: 30 m × 16.9 m visible at W = 480, north up), in sim metres:
//   - the west half (x < 1) is flat 02 asphalt; the east half (x > 1) is pavement laid as a checkerboard of 05
//     slab and 06 kerb cells, so the locked 32×32 px (2 m) tile reads directly off the frame;
//   - along y = 0, on each surface: Bessie's body at heading h00 (no brush overlay: the size sheet's 28×52 is
//     the body), Doris idle facing south (feet on the row), and the litter item, about 3 m apart. On the
//     pavement each actor stands on a 05 slab cell: Bessie centred on one (her 3.25 m length spans the 06 cells
//     north and south of it, which shows a tile against her body), Doris and the litter in its centre.
// No buildings: the 32×40 facade module is judged in lean_quadrants. Bessie and Doris cast the +2,+2 px drop
// shadow (ART_BIBLE §6.4); litter lies flat on the ground layer below the drop shadows and casts none
// (TECHNICAL_DESIGN §12.5).
//
// Static: nothing depends on the render-frame counter, so every frame is the same. Draw calls: the city mesh,
// drop shadows, the actors atlas and the items atlas (4), plus the palette pass and blit (6). There are no
// building shadows (the shadow mesh would be empty), so none is drawn.
import { Group } from 'three';
import type { FrameId } from '../gen/assets.ts';
import { createCityMesh, parseCityGrid } from '../render/cityMesh.ts';
import { bessieBodyFrame } from '../render/headings.ts';
import type { SpriteAtlas } from '../render/spriteAtlas.ts';
import { DropShadowBatch, SpriteBatch } from '../render/spriteBatch.ts';
import { DepthLayer } from '../render/worldMaterial.ts';

/** One character per 2 m cell (`.` asphalt, `:` slab, `k` kerb); row 0 is north. 17 × 9 cells. */
export const SCALE_SHEET_ROWS: readonly string[] = [
  '.........k:k:k:k:',
  '.........:k:k:k:k',
  '.........k:k:k:k:',
  '.........:k:k:k:k',
  '.........k:k:k:k:',
  '.........:k:k:k:k',
  '.........k:k:k:k:',
  '.........:k:k:k:k',
  '.........k:k:k:k:',
];

/** Sim position of the grid's NW corner: the 34 m × 18 m grid is centred on the origin. */
export const SCALE_SHEET_ORIGIN_M: readonly [x: number, y: number] = [-17, -9];

/** Bessie's body frame: heading h00 (north), the orientation the size sheet's 28×52 px describes. */
export const SCALE_SHEET_BESSIE_FRAME: FrameId = bessieBodyFrame(0);

/** The human: Doris idle facing south (face visible), a 24×24 cell with feet on row 22. */
export const SCALE_SHEET_HUMAN_FRAME = 'npc.old_woman:idle:s:0' satisfies FrameId;

/** The litter item: the banana skin ingested from litter.sheet_01 (a 16×16 cell, largest item 14 px). */
export const SCALE_SHEET_LITTER_FRAME = 'litter.banana_skin:idle:h00:0' satisfies FrameId;

/** The surfaces the trio is shown on, west to east. */
export type ScaleSheetSurface = 'asphalt' | 'pavement';

/** One trio: where each actor's pivot stands, in sim metres. */
export type ScaleSheetRow = {
  readonly surface: ScaleSheetSurface;
  /** Bessie's body centre. */
  readonly bessieM: readonly [x: number, y: number];
  /** Doris's feet. */
  readonly humanM: readonly [x: number, y: number];
  /** The litter item's centre. */
  readonly litterM: readonly [x: number, y: number];
};

/** The two trios. Pavement positions are the centres of 05 slab cells (col + row even). */
export const SCALE_SHEET_ROWS_OF_ACTORS: readonly ScaleSheetRow[] = [
  { surface: 'asphalt', bessieM: [-10, 0], humanM: [-7, 0.5], litterM: [-4.5, 0] },
  { surface: 'pavement', bessieM: [4, 0], humanM: [8, 0.5], litterM: [12, 0] },
];

/** The scale_sheet scene: add `world` to the renderer and attach the sprite atlases once loaded. */
export class ScaleSheetScene {
  /** World-pass content: the ground now, the sprites once attachSprites() runs. */
  readonly world: Group;
  private sprites: SpriteBatch | null = null;
  private items: SpriteBatch | null = null;
  private shadows: DropShadowBatch | null = null;

  constructor() {
    const grid = parseCityGrid(SCALE_SHEET_ROWS, SCALE_SHEET_ORIGIN_M[0], SCALE_SHEET_ORIGIN_M[1]);
    const city = createCityMesh(grid);
    city.renderOrder = 0;
    this.world = new Group();
    this.world.name = 'scaleSheet';
    this.world.add(city);
  }

  /** Adds the actors (Bessie, Doris) from `actors` and the litter from `items`, plus one drop-shadow draw. */
  attachSprites(actors: SpriteAtlas, items: SpriteAtlas): void {
    if (this.sprites !== null) throw new Error('scale_sheet sprites are already attached');
    const rows = SCALE_SHEET_ROWS_OF_ACTORS.length;
    const sprites = new SpriteBatch(actors, rows * 2);
    const litter = new SpriteBatch(items, rows);
    const shadows = new DropShadowBatch([actors], rows * 2);
    // After the city (0): drop shadows, then the actors atlas, then the items atlas (TECHNICAL_DESIGN §12.3).
    // Litter is on the Litter depth layer, below the drop shadows and the actors, whatever the draw order.
    shadows.mesh.renderOrder = 2;
    sprites.mesh.renderOrder = 3;
    litter.mesh.renderOrder = 4;
    const group = new Group();
    group.name = 'scaleSheetSprites';
    group.add(shadows.mesh, sprites.mesh, litter.mesh);
    this.world.add(group);
    this.sprites = sprites;
    this.items = litter;
    this.shadows = shadows;
  }

  /** Poses the actors; `camYSimM` is the camera's sim y (for sprite sorting). The scene never animates. */
  update(_frameCount: number, camYSimM: number): void {
    const sprites = this.sprites;
    const items = this.items;
    const shadows = this.shadows;
    if (sprites === null || items === null || shadows === null) return;
    sprites.begin(camYSimM);
    items.begin(camYSimM);
    shadows.begin(camYSimM);
    for (const row of SCALE_SHEET_ROWS_OF_ACTORS) {
      const [bx, by] = row.bessieM;
      const [hx, hy] = row.humanM;
      const [lx, ly] = row.litterM;
      sprites.add(SCALE_SHEET_BESSIE_FRAME, bx, by, DepthLayer.Bessie);
      sprites.add(SCALE_SHEET_HUMAN_FRAME, hx, hy, DepthLayer.Pedestrian);
      items.add(SCALE_SHEET_LITTER_FRAME, lx, ly, DepthLayer.Litter);
      shadows.add(SCALE_SHEET_BESSIE_FRAME, bx, by);
      shadows.add(SCALE_SHEET_HUMAN_FRAME, hx, hy);
    }
    sprites.end();
    items.end();
    shadows.end();
  }
}
