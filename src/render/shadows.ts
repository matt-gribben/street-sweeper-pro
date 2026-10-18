// Building shadows (TECHNICAL_DESIGN §12.4, §12.6; ART_BIBLE §6.1, §6.4). The sun is fixed in the north-west
// (azimuth 315°, elevation 50°), so a box of height h casts its footprint swept toward the south-east by
// 0.84 × h (1 / tan 50° = 0.839). Each merged box gives one convex hexagon: the footprint's Minkowski sum with
// that offset. All polygons go into ONE mesh at y = 0 on depth layer 1, drawn after the city with MAX blending:
// R = 1 into the mask and vec4(0) into colour (max(0, dst) = dst leaves colour untouched). They are depth-tested
// and do not write depth, so roofs and walls in front occlude them and overlaps simply merge; shadows falling
// onto lower roofs are not modelled in 1.0. The palette pass remaps masked pixels through shadow[32].
import { BufferAttribute, BufferGeometry, GLSL3, Mesh, ShaderMaterial } from 'three';
import type { CityBox } from './cityMesh.ts';
import { DEPTH_LAYER_GLSL, DepthLayer, maskDrawParameters, WORLD_OUTPUTS_GLSL } from './worldMaterial.ts';

/** Shadow length per metre of height: 1 / tan(50°) = 0.839, rounded to 0.84 as the docs specify. */
export const SHADOW_LENGTH_PER_HEIGHT = 0.84;

/** Unit vector toward the south-east in sim space (+x east, +y south): the direction shadows fall. */
export const SHADOW_DIRECTION: readonly [x: number, y: number] = [Math.SQRT1_2, Math.SQRT1_2];

/** A convex shadow polygon in sim metres, vertices counter-clockwise as seen on screen (north up). */
export type ShadowPolygon = {
  /** [x0, y0, x1, y1, ...] sim metres. */
  readonly outline: readonly number[];
  /** Offset of the far edge from the footprint, sim metres (0.84 × h along SHADOW_DIRECTION). */
  readonly offsetXM: number;
  readonly offsetYM: number;
};

/** Shadow offset of a box of height `heightM`: 0.84 × h along the SE unit vector. */
export function shadowOffsetM(heightM: number): readonly [x: number, y: number] {
  const length = SHADOW_LENGTH_PER_HEIGHT * heightM;
  return [length * SHADOW_DIRECTION[0], length * SHADOW_DIRECTION[1]];
}

/**
 * The hexagon a box casts: footprint corners NW, SW, and the SW, SE, NE corners moved by the offset, then NE.
 * Order (screen-CCW, i.e. north up): NW → SW → SW' → SE' → NE' → NE.
 */
export function shadowPolygon(box: CityBox): ShadowPolygon {
  const [ox, oy] = shadowOffsetM(box.heightM);
  const { x0M: x0, y0M: y0, x1M: x1, y1M: y1 } = box;
  return {
    outline: [x0, y0, x0, y1, x0 + ox, y1 + oy, x1 + ox, y1 + oy, x1 + ox, y0 + oy, x1, y0],
    offsetXM: ox,
    offsetYM: oy,
  };
}

/** Shadow polygons for every box. */
export function buildShadowPolygons(boxes: readonly CityBox[]): ShadowPolygon[] {
  return boxes.map(shadowPolygon);
}

/**
 * Fan-triangulates convex polygons into render-space positions at y = 0 (render z = sim y). Each triangle is
 * wound to face +Y (counter-clockwise seen from above), so backface culling keeps it.
 */
export function shadowGeometryPositions(polygons: readonly ShadowPolygon[]): Float32Array {
  const positions: number[] = [];
  for (const { outline } of polygons) {
    const n = outline.length / 2;
    const ax = outline[0] ?? 0;
    const az = outline[1] ?? 0;
    for (let k = 1; k + 1 < n; k++) {
      const bx = outline[2 * k] ?? 0;
      const bz = outline[2 * k + 1] ?? 0;
      const cx = outline[2 * k + 2] ?? 0;
      const cz = outline[2 * k + 3] ?? 0;
      // +Y normal: (b − a) × (c − a) has y = (bz − az)(cx − ax) − (bx − ax)(cz − az) > 0.
      const up = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
      if (up >= 0) positions.push(ax, 0, az, bx, 0, bz, cx, 0, cz);
      else positions.push(ax, 0, az, cx, 0, cz, bx, 0, bz);
    }
  }
  return new Float32Array(positions);
}

const SHADOW_VERTEX = /* glsl */ `
${DEPTH_LAYER_GLSL}
void main() {
  gl_Position = applyDepthLayer(projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0),
    ${DepthLayer.BuildingShadow}.0, 0.0);
}
`;

const SHADOW_FRAGMENT = /* glsl */ `
precision highp float;
${WORLD_OUTPUTS_GLSL}
void main() {
  outColour = vec4(0.0);
  outMask = vec4(1.0, 0.0, 0.0, 0.0);
}
`;

/** The building shadows as one mask-only mesh (one draw call), to be drawn after the city mesh. */
export function createBuildingShadows(boxes: readonly CityBox[]): Mesh {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    'position',
    new BufferAttribute(shadowGeometryPositions(buildShadowPolygons(boxes)), 3),
  );
  const material = new ShaderMaterial({
    ...maskDrawParameters(),
    glslVersion: GLSL3,
    vertexShader: SHADOW_VERTEX,
    fragmentShader: SHADOW_FRAGMENT,
  });
  const mesh = new Mesh(geometry, material);
  mesh.name = 'buildingShadows';
  mesh.frustumCulled = false;
  return mesh;
}
