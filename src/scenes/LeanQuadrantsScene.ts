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
//     screen centre, out of reach of the brush discs.
// The other quadrants mirror this (x → −x and/or y → −y). Each footprint is one 2 m cell, so the three blocks
// differ only in height and screen offset. Every base and roof stays inside the frame and its own quadrant,
// and no two blocks overlap on screen (tests/unit/leanQuadrants.test.ts). The cell edges sit on odd metres,
// so a 2 m street runs along each screen axis.
//
// Room is left in every quadrant for SSP-020's lamp post (for instance on the open ground north of the
// 6-storey tower, around (4, −6.5), where a 5 m lamp still leans inside the frame) and for SSP-024's 8°
// comparison (swap Bessie's frames, or add a second Bessie on that ground).
//
// Determinism: everything is a pure function of the render-frame counter. Each Bessie cycles her 32 headings
// from a fixed per-quadrant offset (north-east h00, south-east h08, south-west h16, north-west h24 at frame 0),
// so `freeze=1` (which holds the counter) gives one fixed frame. Draw calls: the city mesh, building shadows,
// drop shadows and the actors atlas (4), plus the palette pass and blit.
import { Group } from 'three';
import type { FrameId } from '../gen/assets.ts';
import { createCityMesh, mergeBoxes, parseCityGrid } from '../render/cityMesh.ts';
import { bessieBodyFrame, bessieBrushFrame, HEADING_COUNT } from '../render/headings.ts';
import { createBuildingShadows } from '../render/shadows.ts';
import { spikeBrushSpin, spikeHeading } from '../render/spikeActors.ts';
import type { SpriteAtlas } from '../render/spriteAtlas.ts';
import { DropShadowBatch, SpriteBatch } from '../render/spriteBatch.ts';
import { DepthLayer } from '../render/worldMaterial.ts';

/** One character per 2 m cell (`.` asphalt, `:` slab, digits = storeys); row 0 is north. 17 × 9 cells. */
export const LEAN_QUADRANTS_ROWS: readonly string[] = [
  '.:::..::.::..:::.',
  '.:1...........1:.',
  '.::...::.::...::.',
  '..:3:::6.6:::3:..',
  '.................',
  '..:3:::6.6:::3:..',
  '.::...::.::...::.',
  '.:1...........1:.',
  '.:::..::.::..:::.',
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
};

/** Bessie and pedestrian positions in the north-east quadrant; the others mirror them. */
const NE_BESSIE_M = [8.25, -5.75] as const;
const NE_PEDESTRIAN_M = [6.5, -2.25] as const;

/** The four quadrants, ordered north to south (sprites of one layer are added in that order). */
export const LEAN_QUADRANTS: readonly LeanQuadrant[] = [
  {
    name: 'nw',
    bessieM: [-NE_BESSIE_M[0], NE_BESSIE_M[1]],
    headingOffset: 24,
    pedestrianM: [-NE_PEDESTRIAN_M[0], NE_PEDESTRIAN_M[1]],
    pedestrianFrame: 'npc.old_woman:idle:se:0',
  },
  {
    name: 'ne',
    bessieM: [NE_BESSIE_M[0], NE_BESSIE_M[1]],
    headingOffset: 0,
    pedestrianM: [NE_PEDESTRIAN_M[0], NE_PEDESTRIAN_M[1]],
    pedestrianFrame: 'npc.old_woman:idle:sw:0',
  },
  {
    name: 'sw',
    bessieM: [-NE_BESSIE_M[0], -NE_BESSIE_M[1]],
    headingOffset: 16,
    pedestrianM: [-NE_PEDESTRIAN_M[0], -NE_PEDESTRIAN_M[1]],
    pedestrianFrame: 'npc.old_woman:idle:ne:0',
  },
  {
    name: 'se',
    bessieM: [NE_BESSIE_M[0], -NE_BESSIE_M[1]],
    headingOffset: 8,
    pedestrianM: [NE_PEDESTRIAN_M[0], -NE_PEDESTRIAN_M[1]],
    pedestrianFrame: 'npc.old_woman:idle:nw:0',
  },
];

/** Sprites per quadrant: Bessie's body, her brush overlay and the pedestrian. */
const SPRITES_PER_QUADRANT = 3;

/** Bessie's heading index in `quadrant` at render frame `frameCount`. */
export function leanQuadrantHeading(quadrant: LeanQuadrant, frameCount: number): number {
  return (spikeHeading(frameCount) + quadrant.headingOffset) % HEADING_COUNT;
}

/** The lean_quadrants scene: add `world` to the renderer, attach the actors atlas once loaded, update per frame. */
export class LeanQuadrantsScene {
  /** World-pass content: the city mesh and building shadows now, the actors once attachActors() runs. */
  readonly world: Group;
  private sprites: SpriteBatch | null = null;
  private shadows: DropShadowBatch | null = null;

  constructor() {
    const grid = parseCityGrid(LEAN_QUADRANTS_ROWS, LEAN_QUADRANTS_ORIGIN_M[0], LEAN_QUADRANTS_ORIGIN_M[1]);
    const city = createCityMesh(grid);
    city.renderOrder = 0;
    const shadows = createBuildingShadows(mergeBoxes(grid));
    // Building shadows follow the city so roofs and walls are already in the depth buffer.
    shadows.renderOrder = 1;
    this.world = new Group();
    this.world.name = 'leanQuadrants';
    this.world.add(city, shadows);
  }

  /** Adds Bessie and the pedestrian in every quadrant, drawn from the loaded `actors` atlas. */
  attachActors(actors: SpriteAtlas): void {
    if (this.sprites !== null) throw new Error('lean_quadrants actors are already attached');
    const capacity = LEAN_QUADRANTS.length * SPRITES_PER_QUADRANT;
    const sprites = new SpriteBatch(actors, capacity);
    const shadows = new DropShadowBatch([actors], capacity);
    // After the city (0) and building shadows (1); drop shadows before the sprites (TECHNICAL_DESIGN §12.3).
    shadows.mesh.renderOrder = 2;
    sprites.mesh.renderOrder = 3;
    const group = new Group();
    group.name = 'leanQuadrantsActors';
    group.add(shadows.mesh, sprites.mesh);
    this.world.add(group);
    this.sprites = sprites;
    this.shadows = shadows;
  }

  /** Poses the actors for render frame `frameCount`; `camYSimM` is the camera's sim y (for sprite sorting). */
  update(frameCount: number, camYSimM: number): void {
    const sprites = this.sprites;
    const shadows = this.shadows;
    if (sprites === null || shadows === null) return;
    const spin = spikeBrushSpin(frameCount);
    sprites.begin(camYSimM);
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
    }
    sprites.end();
    shadows.end();
  }
}
