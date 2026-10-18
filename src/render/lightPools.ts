// Street-lamp light pools, M0 spike version (SSP-021; TECHNICAL_DESIGN §12.6, ART_BIBLE §13). A pool is a
// hard-edged stepped circle on the ground, written as G = 1 into RT_world's mask with MAX blending, so the
// palette pass leaves the pixels under it out of the night remap. No gradients, no dither: a ground pixel is
// either in the pool or not.
//
// Geometry: one quad per pool at y = 0 on the fx depth layer, all pools in ONE mesh (the "fx + light cookies"
// draw, slot 6 of TECHNICAL_DESIGN §12.7). The fragment shader decides membership per ground pixel, so the edge
// is stepped on the 1/16 m pixel grid that the snapped camera draws 1:1. Depth-tested and not depth-writing: walls,
// roofs and sprite-stack slices in front of the ground hide the pool; flat actors (layers 5–8, below fx) inside it
// are lit. The real fx.ts with cookie shapes in the fx atlas and headlight cones is M6 (SSP-210); this is only
// what the night tuning needs.
import { BufferAttribute, BufferGeometry, GLSL3, Mesh, ShaderMaterial } from 'three';
import { PX_PER_M } from '../sim/constants.ts';
import { DEPTH_LAYER_GLSL, DepthLayer, maskDrawParameters, WORLD_OUTPUTS_GLSL } from './worldMaterial.ts';

/**
 * Radius of a street-lamp light pool, metres: 5 m (80 px, a pool 10 m across), decided in SSP-021 (ROADMAP §8
 * D-05). SSP-190 moves it into the one constant shared with the level compiler's L072 check.
 */
export const LIGHT_POOL_RADIUS_M = 5;

/**
 * The pool's centre as a pixel-grid corner: the pivot snapped to the 1/16 m grid exactly as sprite anchors are
 * (`floor(m × 16 + 0.5)`), so a pool is 4-fold symmetric about that corner.
 */
export function lightPoolAnchorPx(m: number): number {
  return Math.floor(m * PX_PER_M + 0.5);
}

/**
 * Whether ground pixel (gx, gy) (the pixel covering [gx, gx + 1) × [gy, gy + 1) in 1/16 m units) lies in a pool
 * anchored at pixel corner (ax, ay) with radius `radiusPx`: its centre is within the radius. The squared distance
 * of a pixel centre from a corner is always n + 0.5 for an integer n, so for a whole-pixel radius no pixel sits
 * exactly on the edge and no GPU rounding can decide one. The shader performs the same test.
 */
export function inLightPool(gx: number, gy: number, ax: number, ay: number, radiusPx: number): boolean {
  const dx = gx + 0.5 - ax;
  const dy = gy + 0.5 - ay;
  return dx * dx + dy * dy <= radiusPx * radiusPx;
}

/** Ground pixels in one pool of `radiusPx` (an exact count, for tests and evidence). */
export function lightPoolPixelCount(radiusPx: number): number {
  let n = 0;
  for (let gy = -radiusPx - 1; gy <= radiusPx; gy++) {
    for (let gx = -radiusPx - 1; gx <= radiusPx; gx++) if (inLightPool(gx, gy, 0, 0, radiusPx)) n++;
  }
  return n;
}

/**
 * Pool quads in render space at y = 0 (x = sim x, z = sim y), each 1 px larger than the circle on every side,
 * plus each vertex's pool anchor in pixels. Two upward-facing triangles per pool (counter-clockwise seen from
 * above, so backface culling keeps them).
 */
export function lightPoolGeometryData(
  centresM: readonly (readonly [x: number, y: number])[],
  radiusM: number = LIGHT_POOL_RADIUS_M,
): { positions: Float32Array; anchors: Float32Array } {
  const radiusPx = Math.round(radiusM * PX_PER_M);
  const positions = new Float32Array(centresM.length * 18);
  const anchors = new Float32Array(centresM.length * 12);
  centresM.forEach(([xM, yM], i) => {
    const ax = lightPoolAnchorPx(xM);
    const ay = lightPoolAnchorPx(yM);
    const x0 = (ax - radiusPx - 1) / PX_PER_M;
    const x1 = (ax + radiusPx + 1) / PX_PER_M;
    const z0 = (ay - radiusPx - 1) / PX_PER_M;
    const z1 = (ay + radiusPx + 1) / PX_PER_M;
    // nw, sw, ne | ne, sw, se: (v1 − v0) × (v2 − v0) points +Y.
    const corners = [
      [x0, z0],
      [x0, z1],
      [x1, z0],
      [x1, z0],
      [x0, z1],
      [x1, z1],
    ] as const;
    corners.forEach(([x, z], v) => {
      positions.set([x, 0, z], (i * 6 + v) * 3);
      anchors.set([ax, ay], (i * 6 + v) * 2);
    });
  });
  return { positions, anchors };
}

const POOL_VERTEX = /* glsl */ `
${DEPTH_LAYER_GLSL}
in vec2 aAnchorPx;
out vec2 vGroundPx;
flat out vec2 vAnchorPx;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vGroundPx = world.xz * ${PX_PER_M}.0;
  vAnchorPx = aAnchorPx;
  gl_Position = applyDepthLayer(projectionMatrix * viewMatrix * world, ${DepthLayer.Fx}.0, 0.0);
}
`;

// Pixel centres fall on ground pixel centres (the camera and the ground share the 1/16 m grid), so floor() of
// the interpolated ground position is half a pixel away from any edge.
const POOL_FRAGMENT = /* glsl */ `
precision highp float;
uniform float uRadiusPx;
in vec2 vGroundPx;
flat in vec2 vAnchorPx;
${WORLD_OUTPUTS_GLSL}
void main() {
  vec2 d = floor(vGroundPx) + 0.5 - vAnchorPx;
  if (dot(d, d) > uRadiusPx * uRadiusPx) discard;
  outColour = vec4(0.0);
  outMask = vec4(0.0, 1.0, 0.0, 0.0);
}
`;

/** All `centresM` pools as one mask-only mesh (one draw call), to be drawn after the sprites. */
export function createLightPools(
  centresM: readonly (readonly [x: number, y: number])[],
  radiusM: number = LIGHT_POOL_RADIUS_M,
): Mesh {
  const { positions, anchors } = lightPoolGeometryData(centresM, radiusM);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('aAnchorPx', new BufferAttribute(anchors, 2));
  const material = new ShaderMaterial({
    ...maskDrawParameters(),
    glslVersion: GLSL3,
    vertexShader: POOL_VERTEX,
    fragmentShader: POOL_FRAGMENT,
    uniforms: { uRadiusPx: { value: Math.round(radiusM * PX_PER_M) } },
  });
  const mesh = new Mesh(geometry, material);
  mesh.name = 'lightPools';
  mesh.frustumCulled = false;
  return mesh;
}
