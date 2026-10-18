// M0 test world pass (SSP-016): exercises RT_world's two attachments and every branch of the palette pass.
// Since SSP-017 the dev build shows the spike city by default; this world is selected with
// `?world=palette_test` in dev builds only (tools/spikes/swiftShaderPalettePass.ts). All colours are Kerbside-32 entries read from kerbside32.json
// by name; the gradient blends four of them so the LUT also sees off-palette input and snaps it.
//
// Layout around the origin (metres; +x east, +z south, so north is up on screen), inside the first frame:
//   - ground: 1 m checker of 02 asphalt / 05 slab, everywhere;
//   - swatch strip: all 32 colours in index order, 0.75 m (12 px) each, z -7..-5;
//   - gradient patch: x -12..-2, z 0..6, bilinear between four palette colours;
//   - shadow mask (R = 1, MAX blend): the strip's lower half and a block over the gradient and checker;
//   - light mask (G = 1, MAX blend): the east half (x > 0), which night leaves unremapped.
// Four draw calls.
import {
  BufferAttribute,
  BufferGeometry,
  GLSL3,
  Group,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  Vector4,
} from 'three';
import { PALETTE_SIZE, paletteIndex } from './palettePass.ts';
import {
  DEPTH_LAYER_GLSL,
  DepthLayer,
  maskDrawParameters,
  paletteColourVector,
  WORLD_OUTPUTS_GLSL,
} from './worldMaterial.ts';

/** An axis-aligned ground rectangle [x0, z0, x1, z1] in metres, x0 < x1 and z0 < z1. */
type GroundRect = readonly [number, number, number, number];

/** Side of the ground square in metres: far larger than any view (30 m × 17 m at W = 480). */
const GROUND_SIZE_M = 1024;
const SWATCH_WIDTH_M = 0.75;
const SWATCH_Z0_M = -7;
const SWATCH_Z1_M = -5;
const GRADIENT_RECT: GroundRect = [-12, 0, -2, 6];
const SHADOW_RECTS: readonly GroundRect[] = [
  [-12, -6, 12, -5],
  [-6, 2, 6, 7],
];
const LIGHT_RECTS: readonly GroundRect[] = [[0, -8.5, 15.5, 8.5]];
/** Gradient corner colours by name: north-west, north-east, south-west, south-east. */
const GRADIENT_CORNERS = ['sweeper_yellow', 'postbox_red', 'grass', 'council_blue'] as const;

/**
 * Two upward-facing triangles per rectangle at y = 0 (counter-clockwise seen from above, so backface culling
 * keeps them). `colours` optionally gives each rectangle's corners as [nw, ne, sw, se] RGB triples.
 */
function groundRects(
  rects: readonly GroundRect[],
  colours?: readonly (readonly number[])[][],
): BufferGeometry {
  const positions = new Float32Array(rects.length * 18);
  const colourData = new Float32Array(rects.length * 18);
  rects.forEach(([x0, z0, x1, z1], i) => {
    // Corner order nw, sw, ne | ne, sw, se: normal (v1 - v0) × (v2 - v0) points +Y.
    const corners = [
      [x0, z0, 0],
      [x0, z1, 2],
      [x1, z0, 1],
      [x1, z0, 1],
      [x0, z1, 2],
      [x1, z1, 3],
    ] as const;
    corners.forEach(([x, z, corner], v) => {
      const o = (i * 6 + v) * 3;
      positions[o] = x;
      positions[o + 1] = 0;
      positions[o + 2] = z;
      const rgb = colours?.[i]?.[corner];
      colourData[o] = rgb?.[0] ?? 0;
      colourData[o + 1] = rgb?.[1] ?? 0;
      colourData[o + 2] = rgb?.[2] ?? 0;
    });
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  if (colours !== undefined) geometry.setAttribute('aColour', new BufferAttribute(colourData, 3));
  return geometry;
}

const GROUND_VERTEX = /* glsl */ `
${DEPTH_LAYER_GLSL}
out vec2 vGroundM;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vGroundM = world.xz;
  gl_Position = applyDepthLayer(projectionMatrix * viewMatrix * world, ${DepthLayer.Ground}.0, 0.0);
}
`;

const GROUND_FRAGMENT = /* glsl */ `
precision highp float;
uniform vec3 uDark;
uniform vec3 uLight;
in vec2 vGroundM;
${WORLD_OUTPUTS_GLSL}
void main() {
  vec2 cell = floor(vGroundM);
  float odd = mod(cell.x + cell.y, 2.0);
  outColour = vec4(mix(uDark, uLight, odd), 1.0);
  outMask = vec4(0.0);
}
`;

// Swatches and gradient sit on the ground layer with a sort bias, so the shadow layer still covers them.
const COLOUR_VERTEX = /* glsl */ `
${DEPTH_LAYER_GLSL}
in vec3 aColour;
out vec3 vColour;
void main() {
  vColour = aColour;
  gl_Position = applyDepthLayer(projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0),
    ${DepthLayer.Ground}.0, 0.5);
}
`;

const COLOUR_FRAGMENT = /* glsl */ `
precision highp float;
in vec3 vColour;
${WORLD_OUTPUTS_GLSL}
void main() {
  outColour = vec4(vColour, 1.0);
  outMask = vec4(0.0);
}
`;

const MASK_VERTEX = /* glsl */ `
${DEPTH_LAYER_GLSL}
uniform float uLayer;
void main() {
  gl_Position = applyDepthLayer(projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0), uLayer, 0.0);
}
`;

const MASK_FRAGMENT = /* glsl */ `
precision highp float;
uniform vec4 uMask;
${WORLD_OUTPUTS_GLSL}
void main() {
  outColour = vec4(0.0);
  outMask = uMask;
}
`;

function createGround(): Mesh {
  const geometry = new PlaneGeometry(GROUND_SIZE_M, GROUND_SIZE_M);
  geometry.rotateX(-Math.PI / 2);
  const material = new ShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: GROUND_VERTEX,
    fragmentShader: GROUND_FRAGMENT,
    uniforms: {
      uDark: { value: paletteColourVector(paletteIndex('asphalt')) },
      uLight: { value: paletteColourVector(paletteIndex('slab')) },
    },
  });
  return new Mesh(geometry, material);
}

function createColourTest(): Mesh {
  const rects: GroundRect[] = [];
  const colours: number[][][] = [];
  const stripX0 = (-PALETTE_SIZE * SWATCH_WIDTH_M) / 2;
  for (let i = 0; i < PALETTE_SIZE; i++) {
    const x0 = stripX0 + i * SWATCH_WIDTH_M;
    rects.push([x0, SWATCH_Z0_M, x0 + SWATCH_WIDTH_M, SWATCH_Z1_M]);
    const rgb = paletteColourVector(i).toArray();
    colours.push([rgb, rgb, rgb, rgb]);
  }
  rects.push(GRADIENT_RECT);
  colours.push(GRADIENT_CORNERS.map((name) => paletteColourVector(paletteIndex(name)).toArray()));
  const material = new ShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: COLOUR_VERTEX,
    fragmentShader: COLOUR_FRAGMENT,
  });
  return new Mesh(groundRects(rects, colours), material);
}

function createMaskDraw(rects: readonly GroundRect[], layer: DepthLayer, shadow: boolean): Mesh {
  const material = new ShaderMaterial({
    ...maskDrawParameters(),
    glslVersion: GLSL3,
    vertexShader: MASK_VERTEX,
    fragmentShader: MASK_FRAGMENT,
    uniforms: {
      uLayer: { value: layer },
      // R = shadow, G = light.
      uMask: { value: shadow ? new Vector4(1, 0, 0, 0) : new Vector4(0, 1, 0, 0) },
    },
  });
  return new Mesh(groundRects(rects), material);
}

/** Builds the test world: ground, colour test, shadow mask and light mask, drawn in that order. */
export function createTestWorld(): Group {
  const group = new Group();
  const meshes = [
    createGround(),
    createColourTest(),
    createMaskDraw(SHADOW_RECTS, DepthLayer.BuildingShadow, true),
    createMaskDraw(LIGHT_RECTS, DepthLayer.Fx, false),
  ];
  meshes.forEach((mesh, order) => {
    mesh.frustumCulled = false;
    mesh.renderOrder = order;
    group.add(mesh);
  });
  return group;
}
