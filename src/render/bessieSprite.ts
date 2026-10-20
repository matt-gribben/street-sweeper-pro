// Bessie in the world pass (TECHNICAL_DESIGN §12.5, §4; ART_BIBLE §4.5, §8.1; SSP-046): one flat body quad at
// y = 0 on depth layer 7, the brush overlay on layer 8 while the brush is down, and the body's drop shadow
// (+2, +2 px SE, layer 4). The actors sprite batch and the drop-shadow batch draw them: two draw calls.
//
// Frame selection, all through the typed FRAME tables in headings.ts:
//   heading index  NN = ((round(θ / (2π/32)) % 32) + 32) % 32 (headingIndex), no hysteresis: ART_BIBLE §4.5's
//                  2° hysteresis is still *proposed*, so a heading sitting exactly on a sector edge may flicker
//                  between two neighbouring frames until it is decided;
//   body           `veh.sweeper:body:hNN:0`, or `veh.sweeper:dented:hNN:0` while hp < health.dentedBelowHp
//                  (40 HP, tuning.json);
//   brush overlay  `veh.sweeper_brush:brush:hNN:S` while brushDown, S the spin frame 0..3 the caller passes:
//                  brushSpin.ts turns the sim's RPM into it (3 ticks per frame at 100% RPM, scaled by 1/RPM,
//                  frozen on 0 below 10%; ART_BIBLE §10.2, SSP-067).
//
// In a shift the same two batches also carry the whole street (SSP-103, streetActors.ts: NPCs, traffic, parked cars,
// the riding cat and the dog leads, plus the knockables' drop shadows from the items batch): createBessieSprite takes
// their capacities and the atlases the shadows sample, and the scene calls begin(), add(), the street's own adds and
// end() instead of update(), so the street costs no extra draw call.
//
// The pose drawn is the interpolated one (src/render/interpolate.ts); the caller passes it in. update() creates no
// objects, arrays or closures: the frame IDs come from preallocated tables and the batches write into
// preallocated buffers. (V8 may still box a double passed to a call it does not inline; the zero-allocation rule
// binds src/sim, CLAUDE.md §5.1, and the batches' own heap test is in spriteBatch.test.ts.)
import { Group, type InstancedMesh, type ShaderMaterial, Texture } from 'three';
import type { FrameId } from '../gen/assets.ts';
import { bessieBodyFrame, bessieBrushFrame, bessieDentedFrame, headingIndex } from './headings.ts';
import type { Pose } from './interpolate.ts';
import type { SpriteAtlas } from './spriteAtlas.ts';
import { DropShadowBatch, SpriteBatch } from './spriteBatch.ts';
import { DepthLayer } from './worldMaterial.ts';

/** Sprites Bessie adds per frame: body and brush overlay. */
const SPRITE_CAPACITY = 2;

/** Drop shadows per frame: the body's (the brush discs run on the road and cast none, §12.5). */
const SHADOW_CAPACITY = 1;

/**
 * Bessie's body frame for heading θ radians (any finite angle) and Dignity `hp`: the dented render while
 * `hp < dentedBelowHp`, the clean one otherwise.
 */
export function bessieBodyFrameFor(headingRad: number, hp: number, dentedBelowHp: number): FrameId {
  const heading = headingIndex(headingRad);
  return hp < dentedBelowHp ? bessieDentedFrame(heading) : bessieBodyFrame(heading);
}

/** Bessie's brush-overlay frame for heading θ radians and spin frame 0..3 (brushSpin.ts). */
export function bessieBrushFrameFor(headingRad: number, spinFrame = 0): FrameId {
  return bessieBrushFrame(headingIndex(headingRad), spinFrame);
}

/** Bessie's sprites: add `group` to the world pass and call update() once per rendered frame. */
export type BessieSprite = {
  readonly group: Group;
  readonly sprites: SpriteBatch;
  readonly shadows: DropShadowBatch;
  /** The body frame drawn by the last update() (null before the first). */
  readonly bodyFrame: FrameId | null;
  /** The brush frame drawn by the last update(), or null when the brush was up. */
  readonly brushFrame: FrameId | null;
  /**
   * Poses Bessie at `pose`, the brush overlay (while `brushDown`) on spin frame `spinFrame` 0..3 (brushSpin.ts);
   * `camYSimM` is the camera's sim y (in-layer sort bias).
   */
  update(pose: Readonly<Pose>, hp: number, brushDown: boolean, spinFrame: number, camYSimM: number): void;
  /** Starts a frame of both batches (update() is begin + add + end). */
  begin(camYSimM: number): void;
  /** Adds Bessie's body, brush overlay and shadow to the begun frame. */
  add(pose: Readonly<Pose>, hp: number, brushDown: boolean, spinFrame: number): void;
  /** Ends the frame of both batches (one needsUpdate each). */
  end(): void;
  /** Releases the batches' GPU resources (not the shared atlas textures). */
  dispose(): void;
};

function disposeMesh(mesh: InstancedMesh): void {
  mesh.geometry.dispose();
  const material = mesh.material as ShaderMaterial;
  // The sprite batch owns its palette texture; the atlas and swap textures are shared and released by the scene.
  const palette: unknown = material.uniforms.uPalette?.value;
  if (palette instanceof Texture) palette.dispose();
  material.dispose();
}

/** Room for what else a shift draws through Bessie's batches (SSP-103). Default: nothing but Bessie. */
export type BessieSpriteOptions = {
  /** Sprite instances beyond Bessie's two (the street's NPCs, vehicles and lead runs). */
  readonly extraSprites?: number;
  /** Drop-shadow instances beyond Bessie's one. */
  readonly extraShadows?: number;
  /** A second atlas the drop shadows may sample (the `items` atlas, for the knockables). */
  readonly shadowAtlas?: SpriteAtlas;
};

/** Builds Bessie's sprites on the loaded `actors` atlas; `dentedBelowHp` is tuning `health.dentedBelowHp`. */
export function createBessieSprite(
  actors: SpriteAtlas,
  dentedBelowHp: number,
  options: BessieSpriteOptions = {},
): BessieSprite {
  if (actors.name !== 'actors') throw new Error(`Bessie needs the actors atlas, got '${actors.name}'`);
  const sprites = new SpriteBatch(actors, SPRITE_CAPACITY + (options.extraSprites ?? 0));
  const shadowAtlases = options.shadowAtlas === undefined ? [actors] : [actors, options.shadowAtlas];
  const shadows = new DropShadowBatch(shadowAtlases, SHADOW_CAPACITY + (options.extraShadows ?? 0));
  // After the city (0) and building shadows (1); drop shadows before the sprites, as in §12.3.
  shadows.mesh.renderOrder = 2;
  sprites.mesh.renderOrder = 3;
  shadows.mesh.name = 'bessieShadow';
  sprites.mesh.name = 'bessie';
  const group = new Group();
  group.name = 'bessieSprite';
  group.add(shadows.mesh, sprites.mesh);

  let bodyFrame: FrameId | null = null;
  let brushFrame: FrameId | null = null;

  return {
    group,
    sprites,
    shadows,
    get bodyFrame(): FrameId | null {
      return bodyFrame;
    },
    get brushFrame(): FrameId | null {
      return brushFrame;
    },
    update(pose: Readonly<Pose>, hp: number, brushDown: boolean, spinFrame: number, camYSimM: number): void {
      this.begin(camYSimM);
      this.add(pose, hp, brushDown, spinFrame);
      this.end();
    },
    begin(camYSimM: number): void {
      sprites.begin(camYSimM);
      shadows.begin(camYSimM);
    },
    add(pose: Readonly<Pose>, hp: number, brushDown: boolean, spinFrame: number): void {
      const x = pose.xM;
      const y = pose.yM;
      bodyFrame = bessieBodyFrameFor(pose.headingRad, hp, dentedBelowHp);
      brushFrame = brushDown ? bessieBrushFrameFor(pose.headingRad, spinFrame) : null;
      sprites.add(bodyFrame, x, y, DepthLayer.Bessie);
      if (brushFrame !== null) sprites.add(brushFrame, x, y, DepthLayer.Brush);
      shadows.add(bodyFrame, x, y);
    },
    end(): void {
      sprites.end();
      shadows.end();
    },
    dispose(): void {
      group.remove(shadows.mesh, sprites.mesh);
      disposeMesh(sprites.mesh);
      disposeMesh(shadows.mesh);
    },
  };
}
