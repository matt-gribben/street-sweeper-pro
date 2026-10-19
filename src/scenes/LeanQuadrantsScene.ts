// lean_quadrants (SSP-019): the M0 spike scene for judging building lean (ART_BIBLE §4.2) in all four screen
// quadrants, booted with `?test=1&scene=lean_quadrants&freeze=1` (src/debug/testHooks.ts). It is also the
// `scale_1440` scene: the same frame viewed in a 2560×1440 page (5× scale, 45 px letterbox bars; SSP-022).
//
// Layout (camera over the origin at H = 31.5 m: 30 m × 16.9 m visible at W = 480, north up). The cell grid is
// mirror-symmetric about both screen axes, so every quadrant holds the same trio and the lean can be compared
// directly: walls lean away from the screen centre, so a block's two inner faces show. In the north-east
// (top-right) quadrant, in sim metres:
//   - 6 storeys (15 m), x 1..3, y −3..−1, next to the central crossing: roof magnified 1.91× (it spans
//     1.9..5.7 m on each axis), its west and south walls 0.9 m wide on screen;
//   - 3 storeys (7.5 m), x 9..11, y −3..−1, out toward the side edge: roof x 11.8..14.4, y −3.9..−1.3, a
//     2.8 m wide west wall;
//   - 1 storey (2.5 m), x 11..13, y −7..−5, toward the corner: roof 1.09× (x 11.9..14.1, y −7.6..−5.4);
//   - Bessie on the open asphalt between them, centre (8.25, −5.75): her body (1.85 m reach) clears every wall
//     and roof at all 32 headings and her brush discs (2.4 m) stay on screen;
//   - the pedestrian on the slab pavement at (6.5, −2.25), between the 6- and 3-storey blocks, facing the
//     screen centre, out of reach of the brush discs;
//   - a sprite-stack lamp post (SSP-020, `prop.lamp_post`, 4 slices up to 4.4 m) on the open ground just north
//     of the 6-storey tower at (4, −6.5): its lantern leans out to (4.65, −7.55) m, inside the frame, clear of
//     the tower's roof (y > −5.7 m on screen), its foot 1.9 m beyond Bessie's brush reach.
// The other quadrants mirror this (x → −x and/or y → −y). Each footprint is one 2 m cell, so the three blocks
// differ only in height and screen offset. Every base and roof stays inside the frame and its own quadrant,
// and no two blocks overlap on screen (tests/unit/leanQuadrants.test.ts). The cell edges sit on odd metres,
// so a 2 m street runs along each screen axis.
//
// Ground swatches (SSP-021, the shadow[32] tuning): the blocks mirror exactly, but the pavement cells do not.
// The east half keeps 05 slab, the north-west quadrant is paved in 06 kerb stone (`k`) and the south-west in
// 22 grass (`,`), so building shadows (0.84 × h, SE) and the pedestrians' +2,+2 px drop shadows fall on all four
// ground types of the spike (02 asphalt, 05, 06, 22) in one frame.
//
// Night (SSP-021, `?test=1&night=1`): setNight(true) shows a hard-edged light pool (lightPools.ts, radius 5 m)
// under each lamp post, and each lamp head (the lantern slice) writes the light mask, so the palette pass leaves
// them out of night[32]. By day the pools are hidden: the day frame is unchanged by them.
//
// SSP-024 compared 0° and 8° Bessie here (D-02) by serving a temporary 8° actors atlas in place of the committed
// one (tools/spikes/lookDecisions.ts); 0° was kept.
//
// Determinism: everything is a pure function of the frame counter (the scene's tick count, SpikeScene.ts). Each
// Bessie cycles her 32 headings from a fixed per-quadrant offset (north-east h00, south-east h08, south-west
// h16, north-west h24 at frame 0), so `freeze=1` (which holds the counter) gives one fixed frame. The lamp posts never change. Draw calls: the
// city mesh, building shadows, drop shadows, the actors atlas and the items atlas (5), plus the palette pass and
// blit: 7 of the 10 allowed (TECHNICAL_DESIGN §12.7); at night the light pools add the fx draw (8).
import { Group, type Mesh } from 'three';
import type { FrameId } from '../gen/assets.ts';
import { createCityMesh, mergeBoxes, parseCityGrid } from '../render/cityMesh.ts';
import { bessieBodyFrame, bessieBrushFrame, HEADING_COUNT } from '../render/headings.ts';
import { createLightPools } from '../render/lightPools.ts';
import { createBuildingShadows } from '../render/shadows.ts';
import { spikeBrushSpin, spikeHeading } from '../render/spikeActors.ts';
import type { SpriteAtlas } from '../render/spriteAtlas.ts';
import { DropShadowBatch, SpriteBatch } from '../render/spriteBatch.ts';
import { addSpriteStack, LAMP_POST_STACK, stackShadowCount, stackSliceCount } from '../render/spriteStack.ts';
import { DepthLayer } from '../render/worldMaterial.ts';

/** One character per 2 m cell (`.` asphalt, `:` slab, digits = storeys); row 0 is north. 17 × 9 cells. */
export const LEAN_QUADRANTS_ROWS: readonly string[] = [
  '.kkk..kk.::..:::.',
  '.k1...........1:.',
  '.kk...kk.::...::.',
  '..k3kkk6.6:::3:..',
  '.................',
  '..,3,,,6.6:::3:..',
  '.,,...,,.::...::.',
  '.,1...........1:.',
  '.,,,..,,.::..:::.',
];

/** Sim position of the grid's NW corner: the 34 m × 18 m grid is centred on the origin. */
export const LEAN_QUADRANTS_ORIGIN_M: readonly [x: number, y: number] = [-17, -9];

/** A screen quadrant and the actors placed in it. */
export type LeanQuadrant = {
  /** Compass name of the screen quadrant: `ne` is top-right (north up, east right). */
  readonly name: 'ne' | 'se' | 'sw' | 'nw';
  /** Bessie's body centre in sim metres. */
  readonly bessieM: readonly [x: number, y: number];
  /** Bessie's heading at render frame 0, as a heading index 0..31 (h00 north, h08 east, clockwise). */
  readonly headingOffset: number;
  /** The pedestrian's feet in sim metres. */
  readonly pedestrianM: readonly [x: number, y: number];
  /** The pedestrian frame: Doris idle, facing the screen centre. */
  readonly pedestrianFrame: FrameId;
  /** The lamp post's foot (the sprite-stack pivot) in sim metres. */
  readonly lampPostM: readonly [x: number, y: number];
};

/** Bessie and pedestrian positions in the north-east quadrant; the others mirror them. */
const NE_BESSIE_M = [8.25, -5.75] as const;
const NE_PEDESTRIAN_M = [6.5, -2.25] as const;
const NE_LAMP_POST_M = [4, -6.5] as const;

/** The four quadrants, ordered north to south (sprites of one layer are added in that order). */
export const LEAN_QUADRANTS: readonly LeanQuadrant[] = [
  {
    name: 'nw',
    bessieM: [-NE_BESSIE_M[0], NE_BESSIE_M[1]],
    headingOffset: 24,
    pedestrianM: [-NE_PEDESTRIAN_M[0], NE_PEDESTRIAN_M[1]],
    lampPostM: [-NE_LAMP_POST_M[0], NE_LAMP_POST_M[1]],
    pedestrianFrame: 'npc.old_woman:idle:se:0',
  },
  {
    name: 'ne',
    bessieM: [NE_BESSIE_M[0], NE_BESSIE_M[1]],
    headingOffset: 0,
    pedestrianM: [NE_PEDESTRIAN_M[0], NE_PEDESTRIAN_M[1]],
    lampPostM: [NE_LAMP_POST_M[0], NE_LAMP_POST_M[1]],
    pedestrianFrame: 'npc.old_woman:idle:sw:0',
  },
  {
    name: 'sw',
    bessieM: [-NE_BESSIE_M[0], -NE_BESSIE_M[1]],
    headingOffset: 16,
    pedestrianM: [-NE_PEDESTRIAN_M[0], -NE_PEDESTRIAN_M[1]],
    lampPostM: [-NE_LAMP_POST_M[0], -NE_LAMP_POST_M[1]],
    pedestrianFrame: 'npc.old_woman:idle:ne:0',
  },
  {
    name: 'se',
    bessieM: [NE_BESSIE_M[0], -NE_BESSIE_M[1]],
    headingOffset: 8,
    pedestrianM: [NE_PEDESTRIAN_M[0], -NE_PEDESTRIAN_M[1]],
    lampPostM: [NE_LAMP_POST_M[0], -NE_LAMP_POST_M[1]],
    pedestrianFrame: 'npc.old_woman:idle:nw:0',
  },
];

/** Actors-atlas sprites per quadrant: Bessie's body, her brush overlay and the pedestrian. */
const ACTORS_PER_QUADRANT = 3;

/** Drop shadows per quadrant: Bessie's body, the pedestrian and the lamp post's shadow-casting slices. */
const SHADOWS_PER_QUADRANT = 2 + stackShadowCount(LAMP_POST_STACK);

/** Bessie's heading index in `quadrant` at render frame `frameCount`. */
export function leanQuadrantHeading(quadrant: LeanQuadrant, frameCount: number): number {
  return (spikeHeading(frameCount) + quadrant.headingOffset) % HEADING_COUNT;
}

/** The lean_quadrants scene: add `world` to the renderer, attach the sprite atlases once loaded, update per frame. */
export class LeanQuadrantsScene {
  /** World-pass content: the city mesh and building shadows now, the sprites once attachSprites() runs. */
  readonly world: Group;
  /** One hard-edged light pool under each lamp post: drawn only at night (setNight). */
  readonly lightPools: Mesh;
  private sprites: SpriteBatch | null = null;
  private items: SpriteBatch | null = null;
  private shadows: DropShadowBatch | null = null;

  constructor() {
    const grid = parseCityGrid(LEAN_QUADRANTS_ROWS, LEAN_QUADRANTS_ORIGIN_M[0], LEAN_QUADRANTS_ORIGIN_M[1]);
    const city = createCityMesh(grid);
    city.renderOrder = 0;
    const shadows = createBuildingShadows(mergeBoxes(grid));
    // Building shadows follow the city so roofs and walls are already in the depth buffer.
    shadows.renderOrder = 1;
    // The light pools go last (after the items atlas, 4), so lamp-post slices are already in the depth buffer
    // and hide the pool, while the flat actors inside it are lit. Hidden by day: it changes nothing without the
    // night remap, and the day frame keeps its 7 draw calls.
    this.lightPools = createLightPools(LEAN_QUADRANTS.map((q) => q.lampPostM));
    this.lightPools.renderOrder = 5;
    this.lightPools.visible = false;
    this.world = new Group();
    this.world.name = 'leanQuadrants';
    this.world.add(city, shadows, this.lightPools);
  }

  /** Night on or off: shows the light pools (the palette pass's night remap is the renderer's switch). */
  setNight(on: boolean): void {
    this.lightPools.visible = on;
  }

  /**
   * Adds Bessie and the pedestrian in every quadrant from the loaded `actors` atlas, and the lamp posts from the
   * `items` atlas (one instanced draw each, plus one drop-shadow draw sampling both).
   */
  attachSprites(actors: SpriteAtlas, items: SpriteAtlas): void {
    if (this.sprites !== null) throw new Error('lean_quadrants sprites are already attached');
    const quadrants = LEAN_QUADRANTS.length;
    const sprites = new SpriteBatch(actors, quadrants * ACTORS_PER_QUADRANT);
    const stacks = new SpriteBatch(items, quadrants * stackSliceCount(LAMP_POST_STACK));
    const shadows = new DropShadowBatch([actors, items], quadrants * SHADOWS_PER_QUADRANT);
    // After the city (0) and building shadows (1): drop shadows, then the actors atlas, then the items atlas
    // (TECHNICAL_DESIGN §12.3).
    shadows.mesh.renderOrder = 2;
    sprites.mesh.renderOrder = 3;
    stacks.mesh.renderOrder = 4;
    const group = new Group();
    group.name = 'leanQuadrantsSprites';
    group.add(shadows.mesh, sprites.mesh, stacks.mesh);
    this.world.add(group);
    this.sprites = sprites;
    this.items = stacks;
    this.shadows = shadows;
  }

  /** Poses the actors for render frame `frameCount`; `camYSimM` is the camera's sim y (for sprite sorting). */
  update(frameCount: number, camYSimM: number): void {
    const sprites = this.sprites;
    const items = this.items;
    const shadows = this.shadows;
    if (sprites === null || items === null || shadows === null) return;
    const spin = spikeBrushSpin(frameCount);
    sprites.begin(camYSimM);
    items.begin(camYSimM);
    shadows.begin(camYSimM);
    for (let i = 0; i < LEAN_QUADRANTS.length; i++) {
      const quadrant = LEAN_QUADRANTS[i];
      if (quadrant === undefined) continue;
      const heading = leanQuadrantHeading(quadrant, frameCount);
      const body = bessieBodyFrame(heading);
      const [bx, by] = quadrant.bessieM;
      const [px, py] = quadrant.pedestrianM;
      sprites.add(quadrant.pedestrianFrame, px, py, DepthLayer.Pedestrian);
      sprites.add(body, bx, by, DepthLayer.Bessie);
      sprites.add(bessieBrushFrame(heading, spin), bx, by, DepthLayer.Brush);
      // The brush discs run on the road surface, so only the body and the pedestrian cast drop shadows.
      shadows.add(quadrant.pedestrianFrame, px, py);
      shadows.add(body, bx, by);
      addSpriteStack(LAMP_POST_STACK, quadrant.lampPostM[0], quadrant.lampPostM[1], items, shadows);
    }
    sprites.end();
    items.end();
    shadows.end();
  }
}
