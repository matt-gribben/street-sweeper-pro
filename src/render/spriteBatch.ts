// Instanced sprite batches (TECHNICAL_DESIGN §12.5, §12.7; ART_BIBLE §6.4).
//
// Sprites are textured quads LYING FLAT at y = 0 (not billboards), so they share the ground's 1:1 projection.
// One InstancedMesh per atlas draws every sprite of that atlas in one call; layer order comes from the
// clip-space depth offset in worldMaterial.ts (`layer * 8 + sortBias`), and alpha is binary (the shader
// discards transparent texels), so no transparency sorting is needed.
//
// Per-instance attributes, all in ONE interleaved Float32 buffer so a batch costs one `needsUpdate` per frame:
//   offset (vec3)    render-space anchor: (sim x, height, sim y) metres; flat sprites use height 0, sprite-stack
//                    slices (spriteStack.ts) their real height, so the perspective camera leans them like walls;
//   rotation         quarter turns clockwise (0..3), pixel-exact; vehicle headings come from the frame instead;
//   frameRect (vec4) x, y, w, h in atlas pixels, from the generated FRAME table;
//   pivot (vec2)     the frame's pivot in frame pixels (atlas JSON px/py): body centre or feet;
//   swap             swap-table row 0..7 (a uint8 value): the fragment shader maps the atlas index through that
//                    row of the atlas's 32×8 swap texture before the palette lookup (identity until M4, SSP-114);
//   flags            SpriteFlag bits (mirror; lit: the sprite writes G = 1, the light mask, SSP-021; upright: an
//                    object standing in a receiveShadows batch, masked like an actor; solid: a rectangle of one
//                    palette colour with no frame, the dog lead's runs, SSP-103);
//   layer, sortBias  the depth layer (DepthLayer) and the in-layer bias in [0, 1), computed by the batch from
//                    the sprite's sim y and the camera y given to begin();
//   atlas            which atlas to sample (per-instance selector): drop shadows, and sprite batches made with a
//                    secondary atlas (the items batch samples `items` and the `world` stain decals, SSP-067);
//   shadowLift       drop shadows only: extra pixels on both axes beyond the +2, +2 offset (an elevated caster: a
//                    cat on a wall, a car roof or Bessie's roof casts at +3, +3, ART_BIBLE §8.3; SSP-103).
// Buffers are sized to capacity once; begin/add/end per frame allocates nothing (the bias is computed inside
// the batch and written straight to the buffer, so no fresh float crosses a call per sprite).
//
// The anchor is snapped to the 1/16 m pixel grid in the vertex shader and pivots are whole pixels, so with the
// camera on the same grid (camera.ts) every screen pixel centre lands on a texel centre: sprites draw 1:1.
//
// Drop shadows: the caster's silhouette offset +2, +2 px (SE, 0.125 m), one instanced draw on depth layer 4
// that can sample either atlas, writing R = 1 into the mask with MAX blending and vec4(0) into colour; the
// palette pass then remaps the ground under it through shadow[32]. Sprites write mask (0, 0), so an actor
// drawn over a drop shadow (its own included) is not darkened: only the SE fringe of the shadow shows. A sprite
// flagged `Lit` writes (0, 1) instead: it is a light source (a lamp head), exempt from the night remap. A batch
// made with `receiveShadows` (ground-lying litter, stains and site markings, SSP-067) keeps the mask under its
// texels instead, so the building and drop shadows drawn before it fall across them as across the ground.
import {
  AddEquation,
  BufferAttribute,
  BufferGeometry,
  CustomBlending,
  DataTexture,
  DoubleSide,
  DynamicDrawUsage,
  GLSL3,
  InstancedInterleavedBuffer,
  InstancedMesh,
  InterleavedBufferAttribute,
  NoBlending,
  OneFactor,
  OneMinusSrcAlphaFactor,
  ShaderMaterial,
  type ShaderMaterialParameters,
  SrcAlphaFactor,
} from 'three';
import { FRAME, type FrameId } from '../gen/assets.ts';
import { PX_PER_M } from '../sim/constants.ts';
import { createPaletteTexture, KERBSIDE32, type Kerbside32, PALETTE_SIZE } from './palettePass.ts';
import { type AtlasName, type SpriteAtlas, SWAP_ROWS, TRANSPARENT_INDEX } from './spriteAtlas.ts';
import { DEPTH_LAYER_GLSL, DepthLayer, maskDrawParameters, WORLD_OUTPUTS_GLSL } from './worldMaterial.ts';

/** Per-instance flag bits. */
export const SpriteFlag = {
  /** Mirror the frame left-right about its pivot. */
  MirrorX: 1,
  /** A light source (lamp head, ART_BIBLE §8.6, §13): writes G = 1 into the mask, so night never remaps it. */
  Lit: 2,
  /**
   * An object standing on the ground drawn by a `receiveShadows` batch (a knockable bin or trolley, SSP-103): it
   * writes mask (0, 0) like an actor instead of keeping the mask under it, so neither its own drop shadow nor a
   * building shadow darkens it. Ignored by batches that do not receive shadows (they always write (0, 0)).
   */
  Upright: 4,
  /**
   * A solid rectangle with no frame (SSP-103, the dog lead's 1 px runs): added with addSolid, its frameRect holds
   * (palette index, 0, width px, height px) and its pivot is (0, 0); every texel is that index (through the swap
   * row as usual) and none is transparent. Drop shadows of it fill the same rectangle.
   */
  Solid: 8,
} as const;
export type SpriteFlag = (typeof SpriteFlag)[keyof typeof SpriteFlag];

/** World span (metres, centred on the camera) over which sortBias rises from 0 to its maximum. */
export const SORT_SPAN_M = 32;

/** Largest sortBias: just under 1, so a bias never reaches the next layer. */
export const SORT_BIAS_MAX = 1 - 1 / 1024;

/** Drop-shadow offset toward the south-east, in pixels on each axis (ART_BIBLE §6.4). */
export const DROP_SHADOW_OFFSET_PX = 2;

/** Atlases one drop-shadow draw can sample (the actors and items atlases). */
export const MAX_SHADOW_ATLASES = 2;

/**
 * In-layer sort bias in [0, SORT_BIAS_MAX]: grows with `ySimM − camYSimM`, so of two actors in the same layer
 * the southern one (larger sim y) draws on top. The camera's ±SORT_SPAN_M / 2 maps linearly onto the range
 * and anything beyond clamps; the visible frame is at most ±10.2 m tall (H = 37.8 m), so on-screen actors
 * never clamp. With a 24-bit depth buffer the bias separates actors about 0.4 m or more apart in y; closer
 * pairs tie, and the later `add` wins the tie (depth test LessEqual).
 */
export function sortBias(ySimM: number, camYSimM: number): number {
  const t = 0.5 + (ySimM - camYSimM) / SORT_SPAN_M;
  return Math.min(SORT_BIAS_MAX, Math.max(0, t));
}

// Interleaved layout, in floats.
const O_OFFSET = 0;
const O_ROTATION = 3;
const O_RECT = 4;
const O_PIVOT = 8;
const O_SWAP = 10;
const O_FLAGS = 11;
const O_LAYER = 12;
const O_BIAS = 13;
const O_ATLAS = 14;
const O_SHADOW_LIFT = 15;
/** Floats per instance. */
export const INSTANCE_STRIDE = 16;

/** Capacity-sized interleaved instance data plus the geometry that reads it. */
class InstanceBuffer {
  readonly capacity: number;
  readonly data: Float32Array;
  readonly buffer: InstancedInterleavedBuffer;
  readonly geometry: BufferGeometry;
  /** Camera sim y of the current frame (a typed slot, not a field, so V8 never boxes it). */
  readonly camY = new Float64Array(1);
  count = 0;

  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new Error(`sprite batch capacity ${capacity}`);
    this.capacity = capacity;
    this.data = new Float32Array(capacity * INSTANCE_STRIDE);
    this.buffer = new InstancedInterleavedBuffer(this.data, INSTANCE_STRIDE, 1);
    this.buffer.setUsage(DynamicDrawUsage);
    const geometry = new BufferGeometry();
    // A unit quad in the XZ plane: position.xz is the frame-space corner (x east, z = y south), 0..1.
    geometry.setAttribute(
      'position',
      new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 1]), 3),
    );
    geometry.setIndex([0, 2, 1, 1, 2, 3]);
    const attribute = (name: string, size: number, offset: number): void => {
      geometry.setAttribute(name, new InterleavedBufferAttribute(this.buffer, size, offset));
    };
    attribute('offset', 3, O_OFFSET);
    attribute('rotation', 1, O_ROTATION);
    attribute('frameRect', 4, O_RECT);
    attribute('pivot', 2, O_PIVOT);
    attribute('swap', 1, O_SWAP);
    attribute('flags', 1, O_FLAGS);
    attribute('layer', 1, O_LAYER);
    attribute('sortBias', 1, O_BIAS);
    attribute('atlas', 1, O_ATLAS);
    attribute('shadowLift', 1, O_SHADOW_LIFT);
    this.geometry = geometry;
  }

  /**
   * The anchor of the instance being written, (x, height, y) metres: a typed slot, so pushFrom() can hand
   * positions over without passing fresh doubles across a call (which V8 boxes when it does not inline it).
   */
  readonly anchor = new Float64Array(3);

  /** Appends one instance; throws past capacity (size the batch for the scene). */
  push(
    frame: FrameId,
    xM: number,
    yM: number,
    heightM: number,
    layer: number,
    swap: number,
    flags: number,
    quarterTurns: number,
    atlasSlot: number,
    liftPx = 0,
  ): void {
    const a = this.anchor;
    a[0] = xM;
    a[1] = heightM;
    a[2] = yM;
    this.pushAnchor(frame, layer, swap, flags, quarterTurns, atlasSlot, liftPx);
  }

  /** Appends one flat instance at (xs[i], ys[i]) metres; positions never leave the typed arrays. */
  pushFrom(
    frame: FrameId,
    xs: Float64Array,
    ys: Float64Array,
    i: number,
    layer: number,
    swap: number,
    flags: number,
    quarterTurns: number,
    atlasSlot: number,
    liftPx = 0,
  ): void {
    const a = this.anchor;
    a[0] = xs[i] as number;
    a[1] = 0;
    a[2] = ys[i] as number;
    this.pushAnchor(frame, layer, swap, flags, quarterTurns, atlasSlot, liftPx);
  }

  /**
   * Appends one instance at (xs[i], hs[k], ys[i]): a sprite-stack slice whose position and height both stay in
   * typed arrays (the knockables' slices, SSP-103).
   */
  pushSliceFrom(
    frame: FrameId,
    xs: Float64Array,
    ys: Float64Array,
    i: number,
    hs: Float64Array,
    k: number,
    layer: number,
    flags: number,
    quarterTurns: number,
    atlasSlot: number,
  ): void {
    const a = this.anchor;
    a[0] = xs[i] as number;
    a[1] = hs[k] as number;
    a[2] = ys[i] as number;
    this.pushAnchor(frame, layer, 0, flags, quarterTurns, atlasSlot, 0);
  }

  /**
   * Appends one SpriteFlag.Solid rectangle of palette index `colour`, `wPx` × `hPx` pixels with its top-left pixel
   * at (xPx, yPx) on the 1/16 m grid (whole pixels: pixel (x, y) covers sim [x/16, (x+1)/16) m). Only integers
   * cross the call.
   */
  pushSolid(
    colour: number,
    xPx: number,
    yPx: number,
    wPx: number,
    hPx: number,
    layer: number,
    swap: number,
  ): void {
    if (this.count >= this.capacity) throw new Error(`sprite batch full (capacity ${this.capacity})`);
    const d = this.data;
    const o = this.count * INSTANCE_STRIDE;
    const xM = xPx / PX_PER_M;
    const yM = yPx / PX_PER_M;
    d[o + O_OFFSET] = xM;
    d[o + O_OFFSET + 1] = 0;
    d[o + O_OFFSET + 2] = yM;
    d[o + O_ROTATION] = 0;
    d[o + O_RECT] = colour;
    d[o + O_RECT + 1] = 0;
    d[o + O_RECT + 2] = wPx;
    d[o + O_RECT + 3] = hPx;
    d[o + O_PIVOT] = 0;
    d[o + O_PIVOT + 1] = 0;
    d[o + O_SWAP] = swap;
    d[o + O_FLAGS] = SpriteFlag.Solid;
    d[o + O_LAYER] = layer;
    const t = 0.5 + (yM - (this.camY[0] as number)) / SORT_SPAN_M;
    d[o + O_BIAS] = t > SORT_BIAS_MAX ? SORT_BIAS_MAX : t > 0 ? t : 0;
    d[o + O_ATLAS] = 0;
    d[o + O_SHADOW_LIFT] = 0;
    this.count++;
  }

  /** Appends one instance at `anchor`; the sortBias (see sortBias()) is computed here, from its y. */
  private pushAnchor(
    frame: FrameId,
    layer: number,
    swap: number,
    flags: number,
    quarterTurns: number,
    atlasSlot: number,
    liftPx: number,
  ): void {
    if (this.count >= this.capacity) throw new Error(`sprite batch full (capacity ${this.capacity})`);
    const f = FRAME[frame];
    const d = this.data;
    const a = this.anchor;
    const o = this.count * INSTANCE_STRIDE;
    const yM = a[2] as number;
    d[o + O_OFFSET] = a[0] as number;
    d[o + O_OFFSET + 1] = a[1] as number;
    d[o + O_OFFSET + 2] = yM;
    d[o + O_ROTATION] = quarterTurns & 3;
    d[o + O_RECT] = f.x;
    d[o + O_RECT + 1] = f.y;
    d[o + O_RECT + 2] = f.w;
    d[o + O_RECT + 3] = f.h;
    d[o + O_PIVOT] = f.px;
    d[o + O_PIVOT + 1] = f.py;
    d[o + O_SWAP] = swap;
    d[o + O_FLAGS] = flags;
    d[o + O_LAYER] = layer;
    // sortBias(yM, camY), written out so no fresh double crosses a call.
    const t = 0.5 + (yM - (this.camY[0] as number)) / SORT_SPAN_M;
    d[o + O_BIAS] = t > SORT_BIAS_MAX ? SORT_BIAS_MAX : t > 0 ? t : 0;
    d[o + O_ATLAS] = atlasSlot;
    d[o + O_SHADOW_LIFT] = liftPx;
    this.count++;
  }

  /**
   * Publishes this frame's instances: the draw count plus exactly one needsUpdate. The whole capacity-sized
   * buffer is uploaded (no update ranges: three pushes a new range object per addUpdateRange, a per-frame
   * allocation); at 64 bytes per instance that is cheap for any batch the budget allows.
   */
  publish(mesh: InstancedMesh): void {
    mesh.count = this.count;
    this.buffer.needsUpdate = true;
  }
}

/**
 * Vertex code shared by sprites and drop shadows: places the quad corner in render space. `shiftPx` moves the
 * whole sprite in screen pixels (+x east, +y south) after rotation; the drop shadow passes (2, 2).
 */
const SPRITE_VERTEX_COMMON = /* glsl */ `
${DEPTH_LAYER_GLSL}
in vec3 offset;
in float rotation;
in vec4 frameRect;
in vec2 pivot;
in float flags;
in float layer;
in float sortBias;
out vec2 vTexel;
flat out vec4 vRect;
flat out int vSolid;

const float PX_PER_M = ${PX_PER_M}.0;

void placeSprite(vec2 shiftPx) {
  vec2 texel = position.xz * frameRect.zw;
  vec2 local = texel - pivot;
  if ((int(flags) & ${SpriteFlag.MirrorX}) != 0) local.x = -local.x;
  int turns = int(rotation) & 3;
  if (turns == 1) local = vec2(-local.y, local.x);
  else if (turns == 2) local = -local;
  else if (turns == 3) local = vec2(local.y, -local.x);
  vec2 anchorPx = floor(offset.xz * PX_PER_M + 0.5);
  vec2 groundM = (anchorPx + local + shiftPx) / PX_PER_M;
  vec4 clip = projectionMatrix * viewMatrix * vec4(groundM.x, offset.y, groundM.y, 1.0);
  gl_Position = applyDepthLayer(clip, layer, sortBias);
  vTexel = texel;
  vRect = frameRect;
  // A Solid rectangle (SpriteFlag.Solid) carries its palette index in frameRect.x; -1 samples the atlas.
  vSolid = (int(flags) & ${SpriteFlag.Solid}) != 0 ? int(frameRect.x + 0.5) : -1;
}
`;

/** Fragment helper: the atlas texel under this fragment, clamped inside the frame rect. */
const SPRITE_TEXEL_GLSL = /* glsl */ `
in vec2 vTexel;
flat in vec4 vRect;

ivec2 frameTexel() {
  return ivec2(clamp(floor(vTexel), vec2(0.0), vRect.zw - 1.0) + vRect.xy);
}

int indexAt(highp sampler2D atlas, ivec2 texel) {
  return int(texelFetch(atlas, texel, 0).r * 255.0 + 0.5);
}
`;

const SPRITE_VERTEX = /* glsl */ `
${SPRITE_VERTEX_COMMON}
in float swap;
flat out int vSwap;
flat out float vLit;
void main() {
  placeSprite(vec2(0.0));
  vSwap = int(swap);
  vLit = (int(flags) & ${SpriteFlag.Lit}) != 0 ? 1.0 : 0.0;
}
`;

const SPRITE_FRAGMENT = /* glsl */ `
precision highp float;
precision highp int;
uniform highp sampler2D uAtlas;
uniform highp sampler2D uSwap;
uniform highp sampler2D uPalette;
flat in int vSwap;
flat in float vLit;
flat in int vSolid;
${SPRITE_TEXEL_GLSL}
${WORLD_OUTPUTS_GLSL}
void main() {
  int idx = vSolid >= 0 ? vSolid : indexAt(uAtlas, frameTexel());
  if (idx == ${TRANSPARENT_INDEX}) discard;
  idx = indexAt(uSwap, ivec2(idx, clamp(vSwap, 0, ${SWAP_ROWS - 1})));
  outColour = vec4(texelFetch(uPalette, ivec2(idx, 0), 0).rgb, 1.0);
  outMask = vec4(0.0, vLit, 0.0, 0.0);
}
`;

// The two-atlas, ground-lying variant (SpriteBatchOptions.secondaryAtlas / receiveShadows; the items batch,
// SSP-067). The per-instance `atlas` selector picks the atlas and its swap texture (GLSL ES 3.0 cannot index a
// sampler array with a non-constant, as for drop shadows). With receiveShadows the mask output's alpha carries
// the write: the material blends SRC_ALPHA / ONE_MINUS_SRC_ALPHA, so colour (alpha 1) is replaced while the mask
// (alpha 0) keeps what the building and drop shadows wrote under the sprite; a Lit sprite writes mask alpha 1,
// i.e. (0, 1), like any lit sprite.
const SPRITE_VERTEX_DUAL = /* glsl */ `
${SPRITE_VERTEX_COMMON}
in float swap;
in float atlas;
flat out int vSwap;
flat out float vLit;
flat out float vUpright;
flat out int vAtlas;
void main() {
  placeSprite(vec2(0.0));
  vSwap = int(swap);
  vLit = (int(flags) & ${SpriteFlag.Lit}) != 0 ? 1.0 : 0.0;
  vUpright = (int(flags) & ${SpriteFlag.Upright}) != 0 ? 1.0 : 0.0;
  vAtlas = int(atlas);
}
`;

function spriteFragmentDual(receiveShadows: boolean): string {
  // An Upright sprite (SpriteFlag.Upright) writes its mask like an actor: alpha 1 replaces what lies under it.
  const mask = receiveShadows ? 'vec4(0.0, vLit, 0.0, max(vLit, vUpright))' : 'vec4(0.0, vLit, 0.0, 0.0)';
  return /* glsl */ `
precision highp float;
precision highp int;
uniform highp sampler2D uAtlas;
uniform highp sampler2D uSwap;
uniform highp sampler2D uAtlas1;
uniform highp sampler2D uSwap1;
uniform highp sampler2D uPalette;
flat in int vSwap;
flat in float vLit;
flat in float vUpright;
flat in int vAtlas;
flat in int vSolid;
${SPRITE_TEXEL_GLSL}
${WORLD_OUTPUTS_GLSL}
void main() {
  ivec2 texel = frameTexel();
  int idx = vSolid >= 0 ? vSolid : vAtlas == 0 ? indexAt(uAtlas, texel) : indexAt(uAtlas1, texel);
  if (idx == ${TRANSPARENT_INDEX}) discard;
  ivec2 swapTexel = ivec2(idx, clamp(vSwap, 0, ${SWAP_ROWS - 1}));
  idx = vAtlas == 0 ? indexAt(uSwap, swapTexel) : indexAt(uSwap1, swapTexel);
  outColour = vec4(texelFetch(uPalette, ivec2(idx, 0), 0).rgb, 1.0);
  outMask = ${mask};
}
`;
}

/** Blending that replaces colour (alpha 1) and keeps the mask under a texel unless its alpha says write. */
function keepMaskBlending(): ShaderMaterialParameters {
  return {
    blending: CustomBlending,
    blendEquation: AddEquation,
    blendEquationAlpha: AddEquation,
    blendSrc: SrcAlphaFactor,
    blendDst: OneMinusSrcAlphaFactor,
    blendSrcAlpha: OneFactor,
    blendDstAlpha: OneMinusSrcAlphaFactor,
  };
}

const SHADOW_VERTEX = /* glsl */ `
${SPRITE_VERTEX_COMMON}
in float atlas;
in float shadowLift;
flat out int vAtlas;
void main() {
  placeSprite(vec2(${DROP_SHADOW_OFFSET_PX}.0 + shadowLift));
  vAtlas = int(atlas);
}
`;

// GLSL ES 3.0 cannot index a sampler array with a non-constant, so the selector picks between two samplers.
// The shadow needs only the silhouette, so it skips the swap row: a swap table maps 0..31 to 0..31 (the loader
// refuses anything else, spriteAtlas.ts), so it can never make an opaque texel transparent or the reverse, and
// the shadow writes no colour for it to change.
const SHADOW_FRAGMENT = /* glsl */ `
precision highp float;
precision highp int;
uniform highp sampler2D uAtlas0;
uniform highp sampler2D uAtlas1;
flat in int vAtlas;
flat in int vSolid;
${SPRITE_TEXEL_GLSL}
${WORLD_OUTPUTS_GLSL}
void main() {
  ivec2 texel = frameTexel();
  int idx = vSolid >= 0 ? vSolid : vAtlas == 0 ? indexAt(uAtlas0, texel) : indexAt(uAtlas1, texel);
  if (idx == ${TRANSPARENT_INDEX}) discard;
  outColour = vec4(0.0);
  outMask = vec4(1.0, 0.0, 0.0, 0.0);
}
`;

/** SpriteBatch construction options. */
export type SpriteBatchOptions = {
  /** Palette the batch maps indices through (default Kerbside-32). */
  readonly palette?: Kerbside32;
  /**
   * A second atlas instances may sample, chosen per instance from the frame's atlas (the items batch draws the
   * `world` atlas's stain decals beside its own frames in the same draw, SSP-067). Default: none.
   */
  readonly secondaryAtlas?: SpriteAtlas;
  /**
   * Ground-lying sprites (litter, stains, site markings): opaque texels replace colour but keep the mask, so a
   * building or drop shadow drawn earlier still darkens them (draw the batch after the shadows). Lit sprites
   * still write (0, 1). Default false: sprites write mask (0, 0), so actors are never darkened by a shadow under
   * them.
   */
  readonly receiveShadows?: boolean;
};

/** One atlas's sprites as one instanced draw. Call begin(camY), add() per sprite, end() once per frame. */
export class SpriteBatch {
  readonly atlas: SpriteAtlas;
  /** The second atlas instances may sample (SpriteBatchOptions.secondaryAtlas), or null. */
  readonly secondaryAtlas: SpriteAtlas | null;
  readonly receiveShadows: boolean;
  readonly mesh: InstancedMesh;
  private readonly instances: InstanceBuffer;

  constructor(atlas: SpriteAtlas, capacity: number, options: SpriteBatchOptions = {}) {
    this.atlas = atlas;
    const secondary = options.secondaryAtlas ?? null;
    if (secondary !== null && secondary.name === atlas.name) {
      throw new Error(`sprite batch: secondary atlas '${secondary.name}' is the primary atlas`);
    }
    this.secondaryAtlas = secondary;
    this.receiveShadows = options.receiveShadows ?? false;
    this.instances = new InstanceBuffer(capacity);
    const palette = createPaletteTexture(options.palette ?? KERBSIDE32);
    // The single-atlas, mask-writing batch keeps its M0 behaviour exactly (every golden draws through it); the
    // SSP-103 Solid branch applies only to instances flagged Solid.
    const dual = secondary !== null || this.receiveShadows;
    const material = new ShaderMaterial({
      ...(this.receiveShadows ? keepMaskBlending() : {}),
      glslVersion: GLSL3,
      vertexShader: dual ? SPRITE_VERTEX_DUAL : SPRITE_VERTEX,
      fragmentShader: dual ? spriteFragmentDual(this.receiveShadows) : SPRITE_FRAGMENT,
      side: DoubleSide,
      depthTest: true,
      depthWrite: true,
      uniforms: dual
        ? {
            uAtlas: { value: atlas.texture },
            uSwap: { value: atlas.swapTexture },
            uAtlas1: { value: (secondary ?? atlas).texture },
            uSwap1: { value: (secondary ?? atlas).swapTexture },
            uPalette: { value: palette },
          }
        : {
            uAtlas: { value: atlas.texture },
            uSwap: { value: atlas.swapTexture },
            uPalette: { value: palette },
          },
    });
    this.mesh = new InstancedMesh(this.instances.geometry, material, capacity);
    this.mesh.name = `sprites:${atlas.name}`;
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
  }

  get capacity(): number {
    return this.instances.capacity;
  }

  /** Instances added since begin(). */
  get count(): number {
    return this.instances.count;
  }

  /** The instance data (INSTANCE_STRIDE floats per instance); read-only, for tests. */
  get instanceData(): Float32Array {
    return this.instances.data;
  }

  // per-frame draw path: begin
  /** Starts a frame: drops last frame's instances; sortBias is measured from the camera's sim y. */
  begin(camYSimM: number): void {
    this.instances.count = 0;
    this.instances.camY[0] = camYSimM;
  }

  /**
   * Adds one sprite whose pivot stands at sim (xM, yM) on depth `layer`; its sortBias comes from yM. `frame`
   * must belong to this batch's atlas or its secondary atlas. Add sprites of a layer from north to south so that
   * pairs too close for the depth buffer to separate (sortBias) still overlap correctly.
   */
  add(
    frame: FrameId,
    xM: number,
    yM: number,
    layer: DepthLayer,
    swap = 0,
    flags = 0,
    quarterTurns = 0,
  ): void {
    this.instances.push(frame, xM, yM, 0, layer, swap, flags, quarterTurns, this.atlasSlot(frame));
  }

  /**
   * add() with the pivot at sim (xs[i], ys[i]): for callers drawing many sprites from struct-of-arrays stores
   * (the items batch), so no position crosses a call as a fresh double, which V8 boxes when it does not inline
   * the call (TECHNICAL_DESIGN §17).
   */
  addFrom(
    frame: FrameId,
    xs: Float64Array,
    ys: Float64Array,
    i: number,
    layer: DepthLayer,
    swap = 0,
    flags = 0,
    quarterTurns = 0,
  ): void {
    this.instances.pushFrom(frame, xs, ys, i, layer, swap, flags, quarterTurns, this.atlasSlot(frame));
  }

  /**
   * addAtHeight() with the pivot at sim (xs[i], ys[i]) and the height hs[k] metres (≥ 0, unchecked here: the
   * caller's table is validated once): a stack slice whose numbers never cross the call as fresh doubles.
   */
  addSliceFrom(
    frame: FrameId,
    xs: Float64Array,
    ys: Float64Array,
    i: number,
    hs: Float64Array,
    k: number,
    layer: DepthLayer,
    flags = 0,
    quarterTurns = 0,
  ): void {
    this.instances.pushSliceFrom(frame, xs, ys, i, hs, k, layer, flags, quarterTurns, this.atlasSlot(frame));
  }

  /** 0 for a frame of the primary atlas, 1 for the secondary; throws for any other atlas. */
  private atlasSlot(frame: FrameId): number {
    const atlas = FRAME[frame].atlas;
    if (atlas === this.atlas.name) return 0;
    if (this.secondaryAtlas !== null && atlas === this.secondaryAtlas.name) return 1;
    return rejectSpriteAtlas(this, frame);
  }

  /**
   * Adds one sprite lying flat at `heightM` metres above the ground, its pivot over sim (xM, yM): a sprite-stack
   * slice (spriteStack.ts). Unlike flat sprites it keeps its real height, so the perspective camera magnifies it
   * by H / (H − height) and leans it away from the screen centre exactly like a roof at that height; its real
   * depth also puts it in front of every flat layer once it is about 0.4 m up (the largest layer offset, fx at
   * 81e-5 in NDC, equals about 0.39 m of height at H = 31.5 m). `flags` are SpriteFlag bits (a lamp head
   * passes `Lit`).
   */
  addAtHeight(
    frame: FrameId,
    xM: number,
    yM: number,
    heightM: number,
    layer: DepthLayer,
    flags = 0,
    quarterTurns = 0,
  ): void {
    const slot = this.atlasSlot(frame);
    if (!(heightM >= 0)) rejectSpriteHeight(heightM);
    this.instances.push(frame, xM, yM, heightM, layer, 0, flags, quarterTurns, slot);
  }

  /**
   * Adds one SpriteFlag.Solid rectangle (no frame): `wPx` × `hPx` pixels of palette index `colour` 0..31 with its
   * top-left pixel at (xPx, yPx) on the 1/16 m pixel grid, on depth `layer` (its sortBias from its top edge). The
   * dog lead's 1 px runs (SSP-103). Only integers cross the call; throws for non-integers or a bad colour.
   */
  addSolid(
    colour: number,
    xPx: number,
    yPx: number,
    wPx: number,
    hPx: number,
    layer: DepthLayer,
    swap = 0,
  ): void {
    if (!isSolidRect(colour, xPx, yPx, wPx, hPx)) rejectSolid(colour, xPx, yPx, wPx, hPx);
    this.instances.pushSolid(colour, xPx, yPx, wPx, hPx, layer, swap);
  }

  /** Room left this frame: capacity − count. */
  get free(): number {
    return this.instances.capacity - this.instances.count;
  }

  /** Ends the frame: sets the draw count and flags the instance buffer for upload (one needsUpdate). */
  end(): void {
    this.instances.publish(this.mesh);
  }
  // per-frame draw path: end

  /** Releases the GPU buffers, the material and its palette texture (not the atlases, which their loader owns). */
  dispose(): void {
    disposeSpriteMesh(this.mesh);
  }
}

/** Throws for a frame from neither of the batch's atlases (kept out of the per-frame path, which builds no objects). */
function rejectSpriteAtlas(batch: SpriteBatch, frame: FrameId): never {
  const atlas = FRAME[frame].atlas;
  const names =
    batch.secondaryAtlas === null
      ? `'${batch.atlas.name}'`
      : `'${batch.atlas.name}' or '${batch.secondaryAtlas.name}'`;
  throw new Error(`frame ${frame} is in atlas '${atlas}', not ${names}`);
}

/** True when (colour, x, y, w, h) is a palette index and a whole-pixel, non-empty rectangle. */
function isSolidRect(colour: number, xPx: number, yPx: number, wPx: number, hPx: number): boolean {
  return (
    Number.isInteger(colour) &&
    colour >= 0 &&
    colour < PALETTE_SIZE &&
    Number.isInteger(xPx) &&
    Number.isInteger(yPx) &&
    Number.isInteger(wPx) &&
    Number.isInteger(hPx) &&
    wPx >= 1 &&
    hPx >= 1
  );
}

/** Throws for a bad solid rectangle (kept out of the per-frame path). */
function rejectSolid(colour: number, xPx: number, yPx: number, wPx: number, hPx: number): never {
  throw new RangeError(
    `solid rect ${wPx}x${hPx} at (${xPx}, ${yPx}) in colour ${colour} is not whole pixels`,
  );
}

/** Throws for a negative or NaN sprite height (kept out of the per-frame path). */
function rejectSpriteHeight(heightM: number): never {
  throw new RangeError(`sprite height ${heightM} m must be >= 0`);
}

/** Disposes a sprite mesh's geometry, material and the palette texture the batch made (never the atlases). */
function disposeSpriteMesh(mesh: InstancedMesh): void {
  mesh.geometry.dispose();
  const material = mesh.material;
  if (material instanceof ShaderMaterial) {
    const palette: unknown = material.uniforms.uPalette?.value;
    if (palette instanceof DataTexture) palette.dispose();
    material.dispose();
  }
}

/** Every drop shadow, from any atlas, as one mask-only instanced draw on depth layer 4. */
export class DropShadowBatch {
  readonly mesh: InstancedMesh;
  private readonly atlasNames: readonly AtlasName[];
  private readonly instances: InstanceBuffer;

  /** `atlases` (1 or 2) are the atlases casters may come from; the per-instance selector indexes them. */
  constructor(atlases: readonly SpriteAtlas[], capacity: number) {
    const first = atlases[0];
    if (first === undefined || atlases.length > MAX_SHADOW_ATLASES) {
      throw new Error(`drop shadows sample 1 to ${MAX_SHADOW_ATLASES} atlases, got ${atlases.length}`);
    }
    this.atlasNames = atlases.map((a) => a.name);
    this.instances = new InstanceBuffer(capacity);
    const material = new ShaderMaterial({
      ...maskDrawParameters(),
      glslVersion: GLSL3,
      vertexShader: SHADOW_VERTEX,
      fragmentShader: SHADOW_FRAGMENT,
      side: DoubleSide,
      uniforms: {
        uAtlas0: { value: first.texture },
        uAtlas1: { value: (atlases[1] ?? first).texture },
      },
    });
    this.mesh = new InstancedMesh(this.instances.geometry, material, capacity);
    this.mesh.name = 'dropShadows';
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
  }

  get capacity(): number {
    return this.instances.capacity;
  }

  get count(): number {
    return this.instances.count;
  }

  /** The instance data (INSTANCE_STRIDE floats per instance); read-only, for tests. */
  get instanceData(): Float32Array {
    return this.instances.data;
  }

  /** Starts a frame (see SpriteBatch.begin). */
  begin(camYSimM: number): void {
    this.instances.count = 0;
    this.instances.camY[0] = camYSimM;
  }

  /** Adds the drop shadow of `frame` drawn with its pivot at sim (xM, yM) (same flags and turns as the sprite). */
  add(frame: FrameId, xM: number, yM: number, flags = 0, quarterTurns = 0): void {
    this.instances.push(frame, xM, yM, 0, DepthLayer.DropShadow, 0, flags, quarterTurns, this.slotOf(frame));
  }

  /**
   * add() with the caster's pivot at sim (xs[i], ys[i]), so no position crosses the call as a fresh double (as
   * SpriteBatch.addFrom). `liftPx` moves the shadow that many more pixels south-east on both axes: an elevated
   * caster (a cat on a wall or a roof casts at +3, +3: liftPx 1, ART_BIBLE §8.3; SSP-103).
   */
  addFrom(
    frame: FrameId,
    xs: Float64Array,
    ys: Float64Array,
    i: number,
    flags = 0,
    quarterTurns = 0,
    liftPx = 0,
  ): void {
    const slot = this.slotOf(frame);
    this.instances.pushFrom(frame, xs, ys, i, DepthLayer.DropShadow, 0, flags, quarterTurns, slot, liftPx);
  }

  /**
   * Adds the drop shadow of a sprite drawn at `heightM` (SpriteBatch.addAtHeight): the silhouette offset +2, +2
   * texels at the slice's own height, so it stays beside its slice as the camera leans the stack (ART_BIBLE §6.4).
   */
  addAtHeight(frame: FrameId, xM: number, yM: number, heightM: number, quarterTurns = 0): void {
    const slot = this.slotOf(frame);
    if (!(heightM >= 0)) throw new RangeError(`sprite height ${heightM} m must be >= 0`);
    this.instances.push(frame, xM, yM, heightM, DepthLayer.DropShadow, 0, 0, quarterTurns, slot);
  }

  /** The drop shadow of a SpriteBatch.addSliceFrom slice: its silhouette at +2, +2 at the slice's own height. */
  addSliceFrom(
    frame: FrameId,
    xs: Float64Array,
    ys: Float64Array,
    i: number,
    hs: Float64Array,
    k: number,
    quarterTurns = 0,
  ): void {
    const slot = this.slotOf(frame);
    this.instances.pushSliceFrom(frame, xs, ys, i, hs, k, DepthLayer.DropShadow, 0, quarterTurns, slot);
  }

  /** The drop shadow of a SpriteBatch.addSolid rectangle (the dog lead's runs): the same rectangle at +2, +2. */
  addSolid(xPx: number, yPx: number, wPx: number, hPx: number): void {
    if (!isSolidRect(0, xPx, yPx, wPx, hPx)) rejectSolid(0, xPx, yPx, wPx, hPx);
    this.instances.pushSolid(0, xPx, yPx, wPx, hPx, DepthLayer.DropShadow, 0);
  }

  /** Room left this frame: capacity − count. */
  get free(): number {
    return this.instances.capacity - this.instances.count;
  }

  /** The selector slot of `frame`'s atlas; throws for an atlas this batch cannot sample. */
  private slotOf(frame: FrameId): number {
    const slot = this.atlasNames.indexOf(FRAME[frame].atlas);
    if (slot < 0) return rejectShadowAtlas(frame);
    return slot;
  }

  end(): void {
    this.instances.publish(this.mesh);
  }
}

/** Throws for a caster from an atlas the drop-shadow batch cannot sample (kept out of the per-frame path). */
function rejectShadowAtlas(frame: FrameId): never {
  throw new Error(`drop shadows cannot sample atlas '${FRAME[frame].atlas}'`);
}

// ---------------------------------------------------------------------------------------------------------
// UI pass (TECHNICAL_DESIGN §12.3, §12.6, §12.7 draw #7; SSP-069)
//
// The UI draws in internal pixel space with an orthographic camera (Renderer.ts) into RT_world after a depth
// clear: one instanced draw of `ui` atlas quads (text, the 9-slice panels and buttons of src/ui/panels.ts from
// SSP-285, and HUD icons). Positions are whole internal pixels, x right and y DOWN from the frame's top-left; a
// frame's pivot lands on its position, so a glyph (pivot (1, 1), the top-left of its ink box) sits with its ink
// box's top-left on the pen. addRegion() draws a sub-rectangle of a frame at its own size (pivot (0, 0)): the
// panels' corner, edge and centre slices, including the clipped final repeat.
//
// Per-instance attributes, one interleaved Float32 buffer (stride 8):
//   offset (vec2)    the pivot's position in internal pixels (integers);
//   frameRect (vec4) x, y, w, h in atlas pixels, from FRAME;
//   pivot (vec2)     the frame's pivot in frame pixels;
//   recolour (vec2)  (from, to) palette indices: texels of index `from` draw as index `to`. Text uses it to set
//                    its colour (glyph ink is 07 chalk in the atlas, ASSET_PIPELINE §6.3); `from` =
//                    NO_RECOLOUR leaves every texel as authored.
// Draw order is instance order (one draw, no depth test, no blending: a later instance overwrites an earlier
// one), and transparent texels (TRANSPARENT_INDEX) are discarded.
//
// Mask: every UI texel writes mask (0, 1, 1): R = 0 (never shadowed), G = 1 (lit, so night never remaps it) and
// B = 1, the UI flag. The upscale blit reads the flag to keep UI pixels off the camera's sub-pixel offset, so the
// HUD stays on the whole-internal-pixel grid while the world scrolls smoothly under it (Renderer.ts).

/** `recolour.from` value meaning "no recolour" (no palette index is 255). */
export const NO_RECOLOUR = 255;

/** Mask channel values every UI texel writes: (R shadow, G light, B UI flag). */
export const UI_MASK = [0, 1, 1] as const;

const U_OFFSET = 0;
const U_RECT = 2;
const U_PIVOT = 6;
const U_RECOLOUR = 8;
/** Floats per UI instance. */
export const UI_INSTANCE_STRIDE = 10;

const UI_VERTEX = /* glsl */ `
in vec2 offset;
in vec4 frameRect;
in vec2 pivot;
in vec2 recolour;
out vec2 vTexel;
flat out vec4 vRect;
flat out ivec2 vRecolour;
void main() {
  vec2 texel = position.xy * frameRect.zw;
  vec2 px = offset + texel - pivot;
  gl_Position = projectionMatrix * viewMatrix * vec4(px, 0.0, 1.0);
  vTexel = texel;
  vRect = frameRect;
  vRecolour = ivec2(recolour + 0.5);
}
`;

const UI_FRAGMENT = /* glsl */ `
precision highp float;
precision highp int;
uniform highp sampler2D uAtlas;
uniform highp sampler2D uPalette;
flat in ivec2 vRecolour;
${SPRITE_TEXEL_GLSL}
${WORLD_OUTPUTS_GLSL}
void main() {
  int idx = indexAt(uAtlas, frameTexel());
  if (idx == ${TRANSPARENT_INDEX}) discard;
  if (idx == vRecolour.x) idx = vRecolour.y;
  outColour = vec4(texelFetch(uPalette, ivec2(idx, 0), 0).rgb, 1.0);
  outMask = vec4(${UI_MASK[0]}.0, ${UI_MASK[1]}.0, ${UI_MASK[2]}.0, 0.0);
}
`;

/**
 * The UI pass's instanced draw: quads from one atlas (the `ui` atlas) at whole internal pixels. Call begin(),
 * add() per quad, end() once per frame; nothing in that path allocates. Add the mesh to the renderer's UI root
 * (SceneContext.ui).
 */
export class UiSpriteBatch {
  readonly atlas: SpriteAtlas;
  readonly mesh: InstancedMesh;
  readonly capacity: number;
  private readonly data: Float32Array;
  private readonly buffer: InstancedInterleavedBuffer;
  private instances = 0;

  constructor(atlas: SpriteAtlas, capacity: number, palette: Kerbside32 = KERBSIDE32) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new Error(`UI batch capacity ${capacity}`);
    this.atlas = atlas;
    this.capacity = capacity;
    this.data = new Float32Array(capacity * UI_INSTANCE_STRIDE);
    this.buffer = new InstancedInterleavedBuffer(this.data, UI_INSTANCE_STRIDE, 1);
    this.buffer.setUsage(DynamicDrawUsage);
    const geometry = new BufferGeometry();
    // A unit quad in the XY plane: position.xy is the frame-space corner (x right, y down), 0..1.
    geometry.setAttribute(
      'position',
      new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]), 3),
    );
    geometry.setIndex([0, 2, 1, 1, 2, 3]);
    geometry.setAttribute('offset', new InterleavedBufferAttribute(this.buffer, 2, U_OFFSET));
    geometry.setAttribute('frameRect', new InterleavedBufferAttribute(this.buffer, 4, U_RECT));
    geometry.setAttribute('pivot', new InterleavedBufferAttribute(this.buffer, 2, U_PIVOT));
    geometry.setAttribute('recolour', new InterleavedBufferAttribute(this.buffer, 2, U_RECOLOUR));
    const material = new ShaderMaterial({
      glslVersion: GLSL3,
      vertexShader: UI_VERTEX,
      fragmentShader: UI_FRAGMENT,
      side: DoubleSide,
      blending: NoBlending,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uAtlas: { value: atlas.texture },
        uPalette: { value: createPaletteTexture(palette) },
      },
    });
    this.mesh = new InstancedMesh(geometry, material, capacity);
    this.mesh.name = `ui:${atlas.name}`;
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
  }

  /** Quads added since begin(). */
  get count(): number {
    return this.instances;
  }

  /** The instance data (UI_INSTANCE_STRIDE floats per quad); read-only for tests. */
  get instanceData(): Float32Array {
    return this.data;
  }

  // per-frame draw path: begin
  /** Starts a frame: drops last frame's quads. */
  begin(): void {
    this.instances = 0;
  }

  /**
   * Adds one quad of `frame` with its pivot at (xPx, yPx), whole internal pixels from the frame's top-left. Texels
   * of palette index `recolourFrom` draw as `recolourTo` (pass NO_RECOLOUR to keep the frame's colours). Throws for
   * a frame of another atlas, a non-integer position, a recolour index outside the palette, or a full batch.
   */
  add(frame: FrameId, xPx: number, yPx: number, recolourFrom: number = NO_RECOLOUR, recolourTo = 0): void {
    const f = FRAME[frame];
    if (
      f.atlas !== this.atlas.name ||
      !Number.isInteger(xPx) ||
      !Number.isInteger(yPx) ||
      !isRecolourIndex(recolourFrom, true) ||
      !isRecolourIndex(recolourTo, false) ||
      this.instances >= this.capacity
    ) {
      rejectUiQuad(this, frame, xPx, yPx, recolourFrom, recolourTo);
    }
    const d = this.data;
    const o = this.instances * UI_INSTANCE_STRIDE;
    d[o + U_OFFSET] = xPx;
    d[o + U_OFFSET + 1] = yPx;
    d[o + U_RECT] = f.x;
    d[o + U_RECT + 1] = f.y;
    d[o + U_RECT + 2] = f.w;
    d[o + U_RECT + 3] = f.h;
    d[o + U_PIVOT] = f.px;
    d[o + U_PIVOT + 1] = f.py;
    d[o + U_RECOLOUR] = recolourFrom;
    d[o + U_RECOLOUR + 1] = recolourTo;
    this.instances++;
  }

  /**
   * Adds one quad showing only the `wPx` × `hPx` region of `frame` whose top-left is (srcXPx, srcYPx) in frame
   * pixels, with that region's top-left at (xPx, yPx), whole internal pixels (the frame's pivot plays no part). The
   * quad is the region's own size, so it draws 1:1, never stretched: the 9-slice panels (src/ui/panels.ts, SSP-285)
   * draw their clipped final repeats this way. Recolouring as in add(). Throws for a frame of another atlas, a
   * region that is not whole pixels inside the frame, a non-integer position, a bad recolour pair or a full batch.
   */
  addRegion(
    frame: FrameId,
    srcXPx: number,
    srcYPx: number,
    wPx: number,
    hPx: number,
    xPx: number,
    yPx: number,
    recolourFrom: number = NO_RECOLOUR,
    recolourTo = 0,
  ): void {
    const f = FRAME[frame];
    if (
      f.atlas !== this.atlas.name ||
      !isRegionOf(f.w, f.h, srcXPx, srcYPx, wPx, hPx) ||
      !Number.isInteger(xPx) ||
      !Number.isInteger(yPx) ||
      !isRecolourIndex(recolourFrom, true) ||
      !isRecolourIndex(recolourTo, false) ||
      this.instances >= this.capacity
    ) {
      rejectUiRegion(this, frame, srcXPx, srcYPx, wPx, hPx, xPx, yPx, recolourFrom, recolourTo);
    }
    const d = this.data;
    const o = this.instances * UI_INSTANCE_STRIDE;
    d[o + U_OFFSET] = xPx;
    d[o + U_OFFSET + 1] = yPx;
    d[o + U_RECT] = f.x + srcXPx;
    d[o + U_RECT + 1] = f.y + srcYPx;
    d[o + U_RECT + 2] = wPx;
    d[o + U_RECT + 3] = hPx;
    d[o + U_PIVOT] = 0;
    d[o + U_PIVOT + 1] = 0;
    d[o + U_RECOLOUR] = recolourFrom;
    d[o + U_RECOLOUR + 1] = recolourTo;
    this.instances++;
  }

  /** Ends the frame: sets the draw count and flags the instance buffer for upload (one needsUpdate). */
  end(): void {
    this.mesh.count = this.instances;
    this.buffer.needsUpdate = true;
  }
  // per-frame draw path: end

  /** Releases the GPU buffers and the material (not the atlas, which its loader owns). */
  dispose(): void {
    this.mesh.geometry.dispose();
    const material = this.mesh.material;
    if (material instanceof ShaderMaterial) {
      const palette = material.uniforms.uPalette?.value;
      if (palette instanceof DataTexture) palette.dispose();
      material.dispose();
    }
  }
}

/** Throws the error UiSpriteBatch.add found (kept out of the per-frame path, which builds no objects). */
function rejectUiQuad(
  batch: UiSpriteBatch,
  frame: FrameId,
  xPx: number,
  yPx: number,
  recolourFrom: number,
  recolourTo: number,
): never {
  const atlas = FRAME[frame].atlas;
  if (atlas !== batch.atlas.name)
    throw new Error(`frame ${frame} is in atlas '${atlas}', not '${batch.atlas.name}'`);
  if (!Number.isInteger(xPx) || !Number.isInteger(yPx)) {
    throw new RangeError(`UI positions are whole internal pixels, got (${xPx}, ${yPx})`);
  }
  if (!isRecolourIndex(recolourFrom, true) || !isRecolourIndex(recolourTo, false)) {
    throw new RangeError(`recolour ${recolourFrom} -> ${recolourTo} is not a palette index pair`);
  }
  throw new Error(`UI batch full (capacity ${batch.capacity})`);
}

/** True when (x, y, w, h) is a non-empty whole-pixel region inside a `frameW` × `frameH` frame. */
function isRegionOf(frameW: number, frameH: number, x: number, y: number, w: number, h: number): boolean {
  return (
    Number.isInteger(x) &&
    Number.isInteger(y) &&
    Number.isInteger(w) &&
    Number.isInteger(h) &&
    x >= 0 &&
    y >= 0 &&
    w >= 1 &&
    h >= 1 &&
    x + w <= frameW &&
    y + h <= frameH
  );
}

/** Throws the error UiSpriteBatch.addRegion found (kept out of the per-frame path). */
function rejectUiRegion(
  batch: UiSpriteBatch,
  frame: FrameId,
  srcXPx: number,
  srcYPx: number,
  wPx: number,
  hPx: number,
  xPx: number,
  yPx: number,
  recolourFrom: number,
  recolourTo: number,
): never {
  const f = FRAME[frame];
  if (f.atlas === batch.atlas.name && !isRegionOf(f.w, f.h, srcXPx, srcYPx, wPx, hPx)) {
    throw new RangeError(
      `region (${srcXPx}, ${srcYPx}) ${wPx}x${hPx} is not whole pixels inside ${frame} (${f.w}x${f.h})`,
    );
  }
  rejectUiQuad(batch, frame, xPx, yPx, recolourFrom, recolourTo);
}

/** A palette index 0..31 (or NO_RECOLOUR when `allowNone`). */
function isRecolourIndex(value: number, allowNone: boolean): boolean {
  if (allowNone && value === NO_RECOLOUR) return true;
  return Number.isInteger(value) && value >= 0 && value < PALETTE_SIZE;
}
