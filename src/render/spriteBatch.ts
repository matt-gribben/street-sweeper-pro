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
//   swap             swap-table row 0..7 (a uint8 value; the M0 table is identity);
//   flags            SpriteFlag bits (mirror; lit: the sprite writes G = 1, the light mask, SSP-021);
//   layer, sortBias  the depth layer (DepthLayer) and the in-layer bias in [0, 1), computed by the batch from
//                    the sprite's sim y and the camera y given to begin();
//   atlas            drop shadows only: which atlas to sample (per-instance selector).
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
// flagged `Lit` writes (0, 1) instead: it is a light source (a lamp head), exempt from the night remap.
import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  DynamicDrawUsage,
  GLSL3,
  InstancedInterleavedBuffer,
  InstancedMesh,
  InterleavedBufferAttribute,
  ShaderMaterial,
} from 'three';
import { FRAME, type FrameId } from '../gen/assets.ts';
import { PX_PER_M } from '../sim/constants.ts';
import { createPaletteTexture, KERBSIDE32, type Kerbside32 } from './palettePass.ts';
import { type AtlasName, type SpriteAtlas, SWAP_ROWS, TRANSPARENT_INDEX } from './spriteAtlas.ts';
import { DEPTH_LAYER_GLSL, DepthLayer, maskDrawParameters, WORLD_OUTPUTS_GLSL } from './worldMaterial.ts';

/** Per-instance flag bits. */
export const SpriteFlag = {
  /** Mirror the frame left-right about its pivot. */
  MirrorX: 1,
  /** A light source (lamp head, ART_BIBLE §8.6, §13): writes G = 1 into the mask, so night never remaps it. */
  Lit: 2,
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
/** Floats per instance (one spare to keep the stride at 16). */
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
    this.geometry = geometry;
  }

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
  ): void {
    if (this.count >= this.capacity) throw new Error(`sprite batch full (capacity ${this.capacity})`);
    const f = FRAME[frame];
    const d = this.data;
    const o = this.count * INSTANCE_STRIDE;
    d[o + O_OFFSET] = xM;
    d[o + O_OFFSET + 1] = heightM;
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
    d[o + O_BIAS] = sortBias(yM, this.camY[0] ?? 0);
    d[o + O_ATLAS] = atlasSlot;
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
${SPRITE_TEXEL_GLSL}
${WORLD_OUTPUTS_GLSL}
void main() {
  int idx = indexAt(uAtlas, frameTexel());
  if (idx == ${TRANSPARENT_INDEX}) discard;
  idx = indexAt(uSwap, ivec2(idx, clamp(vSwap, 0, ${SWAP_ROWS - 1})));
  outColour = vec4(texelFetch(uPalette, ivec2(idx, 0), 0).rgb, 1.0);
  outMask = vec4(0.0, vLit, 0.0, 0.0);
}
`;

const SHADOW_VERTEX = /* glsl */ `
${SPRITE_VERTEX_COMMON}
in float atlas;
flat out int vAtlas;
void main() {
  placeSprite(vec2(${DROP_SHADOW_OFFSET_PX}.0));
  vAtlas = int(atlas);
}
`;

// GLSL ES 3.0 cannot index a sampler array with a non-constant, so the selector picks between two samplers.
const SHADOW_FRAGMENT = /* glsl */ `
precision highp float;
precision highp int;
uniform highp sampler2D uAtlas0;
uniform highp sampler2D uAtlas1;
flat in int vAtlas;
${SPRITE_TEXEL_GLSL}
${WORLD_OUTPUTS_GLSL}
void main() {
  ivec2 texel = frameTexel();
  int idx = vAtlas == 0 ? indexAt(uAtlas0, texel) : indexAt(uAtlas1, texel);
  if (idx == ${TRANSPARENT_INDEX}) discard;
  outColour = vec4(0.0);
  outMask = vec4(1.0, 0.0, 0.0, 0.0);
}
`;

/** One atlas's sprites as one instanced draw. Call begin(camY), add() per sprite, end() once per frame. */
export class SpriteBatch {
  readonly atlas: SpriteAtlas;
  readonly mesh: InstancedMesh;
  private readonly instances: InstanceBuffer;

  constructor(atlas: SpriteAtlas, capacity: number, palette: Kerbside32 = KERBSIDE32) {
    this.atlas = atlas;
    this.instances = new InstanceBuffer(capacity);
    const material = new ShaderMaterial({
      glslVersion: GLSL3,
      vertexShader: SPRITE_VERTEX,
      fragmentShader: SPRITE_FRAGMENT,
      side: DoubleSide,
      depthTest: true,
      depthWrite: true,
      uniforms: {
        uAtlas: { value: atlas.texture },
        uSwap: { value: atlas.swapTexture },
        uPalette: { value: createPaletteTexture(palette) },
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

  /** Starts a frame: drops last frame's instances; sortBias is measured from the camera's sim y. */
  begin(camYSimM: number): void {
    this.instances.count = 0;
    this.instances.camY[0] = camYSimM;
  }

  /**
   * Adds one sprite whose pivot stands at sim (xM, yM) on depth `layer`; its sortBias comes from yM. `frame`
   * must belong to this batch's atlas. Add sprites of a layer from north to south so that pairs too close for
   * the depth buffer to separate (sortBias) still overlap correctly.
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
    const atlas = FRAME[frame].atlas;
    if (atlas !== this.atlas.name)
      throw new Error(`frame ${frame} is in atlas '${atlas}', not '${this.atlas.name}'`);
    this.instances.push(frame, xM, yM, 0, layer, swap, flags, quarterTurns, 0);
  }

  /**
   * Adds one sprite lying flat at `heightM` metres above the ground, its pivot over sim (xM, yM): a sprite-stack
   * slice (spriteStack.ts). Unlike flat sprites it keeps its real height, so the perspective camera magnifies it
   * by H / (H − height) and leans it away from the screen centre exactly like a roof at that height; its real
   * depth also puts it in front of every flat layer once it is about 0.4 m up (the largest layer offset, fx at
   * 81e-5 in NDC, equals about 0.39 m of height at H = 31.5 m). `flags` are SpriteFlag bits (a lamp head
   * passes `Lit`).
   */
  addAtHeight(frame: FrameId, xM: number, yM: number, heightM: number, layer: DepthLayer, flags = 0): void {
    const atlas = FRAME[frame].atlas;
    if (atlas !== this.atlas.name)
      throw new Error(`frame ${frame} is in atlas '${atlas}', not '${this.atlas.name}'`);
    if (!(heightM >= 0)) throw new RangeError(`sprite height ${heightM} m must be >= 0`);
    this.instances.push(frame, xM, yM, heightM, layer, 0, flags, 0, 0);
  }

  /** Ends the frame: sets the draw count and flags the instance buffer for upload (one needsUpdate). */
  end(): void {
    this.instances.publish(this.mesh);
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

  /** Starts a frame (see SpriteBatch.begin). */
  begin(camYSimM: number): void {
    this.instances.count = 0;
    this.instances.camY[0] = camYSimM;
  }

  /** Adds the drop shadow of `frame` drawn with its pivot at sim (xM, yM) (same flags and turns as the sprite). */
  add(frame: FrameId, xM: number, yM: number, flags = 0, quarterTurns = 0): void {
    const slot = this.atlasNames.indexOf(FRAME[frame].atlas);
    if (slot < 0) throw new Error(`drop shadows cannot sample atlas '${FRAME[frame].atlas}'`);
    this.instances.push(frame, xM, yM, 0, DepthLayer.DropShadow, 0, flags, quarterTurns, slot);
  }

  /**
   * Adds the drop shadow of a sprite drawn at `heightM` (SpriteBatch.addAtHeight): the silhouette offset +2, +2
   * texels at the slice's own height, so it stays beside its slice as the camera leans the stack (ART_BIBLE §6.4).
   */
  addAtHeight(frame: FrameId, xM: number, yM: number, heightM: number): void {
    const slot = this.atlasNames.indexOf(FRAME[frame].atlas);
    if (slot < 0) throw new Error(`drop shadows cannot sample atlas '${FRAME[frame].atlas}'`);
    if (!(heightM >= 0)) throw new RangeError(`sprite height ${heightM} m must be >= 0`);
    this.instances.push(frame, xM, yM, heightM, DepthLayer.DropShadow, 0, 0, 0, slot);
  }

  end(): void {
    this.instances.publish(this.mesh);
  }
}
