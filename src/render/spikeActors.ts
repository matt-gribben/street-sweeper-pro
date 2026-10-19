// M0 spike actors (SSP-018): the Blender-built Bessie cycling all 32 headings with her spinning brush overlay,
// and the ingested pedestrian `npc.old_woman` beside her, drawn by the actors sprite batch plus the drop-shadow
// batch: exactly two draw calls on top of the spike city.
//
// Everything is a pure function of a frame counter (the scene's tick count since SSP-043, not wall-clock time),
// so a frozen counter gives a deterministic frame: `?test=1&freeze=1` holds it (src/debug/testHooks.ts), and dev builds can pin it with `?actorFrame=N`.
//
// Placement: the north street of the spike city (spikeCity.ts), between the 6- and 3-storey blocks, where no
// building shadow falls (so both drop shadows land on lit ground) and no leaning wall or roof covers the ground
// (walls lean away from the screen centre, so the west street is hidden under the 6-storey block's lean).
// Bessie's centre is on the asphalt at (0.5, −5.5); Doris stands on the slab pavement at (3.25, −2.75), facing
// south, just out of reach of the brush discs at every heading (2.4 m from Bessie's centre).
import { Group } from 'three';
import { FRAME, type FrameId } from '../gen/assets.ts';
import {
  BRUSH_SPIN_FRAMES,
  bessieBodyFrame,
  bessieBrushFrame,
  HEADING_COUNT,
  HEADING_STEP_RAD,
} from './headings.ts';
import type { SpriteAtlas } from './spriteAtlas.ts';
import { DropShadowBatch, SpriteBatch } from './spriteBatch.ts';
import { DepthLayer } from './worldMaterial.ts';

/** Bessie's body centre in sim metres. */
export const SPIKE_BESSIE_M: readonly [x: number, y: number] = [0.5, -5.5];

/** The pedestrian's feet in sim metres. */
export const SPIKE_PEDESTRIAN_M: readonly [x: number, y: number] = [3.25, -2.75];

/** The pedestrian frame: Doris idle, facing south (face visible). */
export const SPIKE_PEDESTRIAN_FRAME = 'npc.old_woman:idle:s:0' satisfies FrameId;

/** Render frames Bessie holds each heading: 15 (0.25 s at 60 fps), so the 32 headings cycle every 8 s. */
export const FRAMES_PER_HEADING = 15;

/** Render frames per brush spin frame: 3 (50 ms at 60 fps, the 100% RPM timing in ART_BIBLE §10.2). */
export const FRAMES_PER_BRUSH_SPIN = 3;

/** Sprites in the spike: body, brush, pedestrian. */
const SPRITE_CAPACITY = 3;

/** Bessie's heading at render frame `frameCount`: h00, h01, … h31, then round again, clockwise. */
export function spikeHeadingRad(frameCount: number): number {
  return spikeHeading(frameCount) * HEADING_STEP_RAD;
}

/**
 * Bessie's heading index at render frame `frameCount`, in integer maths (no float on the per-frame path):
 * equal to `headingIndex(spikeHeadingRad(frameCount))` for every frame (pinned by the unit tests).
 */
export function spikeHeading(frameCount: number): number {
  return Math.floor(frameCount / FRAMES_PER_HEADING) % HEADING_COUNT;
}

/** Brush spin frame 0..3 at render frame `frameCount`. */
export function spikeBrushSpin(frameCount: number): number {
  return Math.floor(frameCount / FRAMES_PER_BRUSH_SPIN) % BRUSH_SPIN_FRAMES;
}

/** Bessie's body frame at render frame `frameCount`. */
export function spikeBodyFrame(frameCount: number): FrameId {
  return bessieBodyFrame(spikeHeading(frameCount));
}

/** Bessie's brush-overlay frame at render frame `frameCount` (same heading, spinning). */
export function spikeBrushFrame(frameCount: number): FrameId {
  return bessieBrushFrame(spikeHeading(frameCount), spikeBrushSpin(frameCount));
}

/** The spike actors: add `group` to the world pass and call `update` once per rendered frame. */
export type SpikeActors = {
  readonly group: Group;
  readonly sprites: SpriteBatch;
  readonly shadows: DropShadowBatch;
  update(frameCount: number, camYSimM: number): void;
};

/** Builds the spike actors on the loaded `actors` atlas. */
export function createSpikeActors(actors: SpriteAtlas): SpikeActors {
  if (FRAME[SPIKE_PEDESTRIAN_FRAME].atlas !== actors.name)
    throw new Error('spike actors need the actors atlas');
  const sprites = new SpriteBatch(actors, SPRITE_CAPACITY);
  const shadows = new DropShadowBatch([actors], SPRITE_CAPACITY);
  // After the city (0) and building shadows (1); drop shadows before the sprites, as in §12.3.
  shadows.mesh.renderOrder = 2;
  sprites.mesh.renderOrder = 3;
  const group = new Group();
  group.name = 'spikeActors';
  group.add(shadows.mesh, sprites.mesh);

  const [bx, by] = SPIKE_BESSIE_M;
  const [px, py] = SPIKE_PEDESTRIAN_M;

  return {
    group,
    sprites,
    shadows,
    update(frameCount: number, camYSimM: number): void {
      const body = spikeBodyFrame(frameCount);
      const brush = spikeBrushFrame(frameCount);
      sprites.begin(camYSimM);
      sprites.add(SPIKE_PEDESTRIAN_FRAME, px, py, DepthLayer.Pedestrian);
      sprites.add(body, bx, by, DepthLayer.Bessie);
      sprites.add(brush, bx, by, DepthLayer.Brush);
      sprites.end();

      // The brush discs run on the road surface, so only the body and the pedestrian cast drop shadows.
      shadows.begin(camYSimM);
      shadows.add(SPIKE_PEDESTRIAN_FRAME, px, py);
      shadows.add(body, bx, by);
      shadows.end();
    },
  };
}
