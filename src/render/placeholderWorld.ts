// M0 placeholder world pass: a flat 1 m ground checker so the camera, texel snap and sub-pixel blit can be seen
// moving. SSP-016 replaces this file with the MRT test world pass, whose colours come from
// assets-src/palette/kerbside32.json once that file exists (SSP-005).
import { GLSL3, Mesh, PlaneGeometry, ShaderMaterial, Vector3 } from 'three';

/**
 * Temporary swatch, by Kerbside-32 index and name (ART_BIBLE §5). Two entries only, both on-palette; they are
 * written as numbers because the palette JSON does not exist yet. Delete with this file in SSP-016.
 */
const PLACEHOLDER_SWATCH = {
  /** Index 02 `asphalt`, the base road surface. */
  asphalt: [58, 56, 64],
  /** Index 03 `asphalt_lt`, worn tarmac. */
  asphalt_lt: [85, 83, 90],
} as const;

/** Side of the placeholder ground square in metres: far larger than any view (30 m × 17 m at W = 480). */
const GROUND_SIZE_M = 1024;

function swatchUniform(rgb: readonly [number, number, number]): Vector3 {
  return new Vector3(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255);
}

const VERTEX = /* glsl */ `
out vec2 vGroundM;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vGroundM = world.xz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const FRAGMENT = /* glsl */ `
precision highp float;
uniform vec3 uDark;
uniform vec3 uLight;
in vec2 vGroundM;
layout(location = 0) out highp vec4 fragColor;
void main() {
  vec2 cell = floor(vGroundM);
  float odd = mod(cell.x + cell.y, 2.0);
  fragColor = vec4(mix(uDark, uLight, odd), 1.0);
}
`;

/** Builds the placeholder ground: one mesh, one draw call, lying flat at y = 0 in the XZ plane. */
export function createPlaceholderGround(): Mesh {
  const geometry = new PlaneGeometry(GROUND_SIZE_M, GROUND_SIZE_M);
  geometry.rotateX(-Math.PI / 2);
  const material = new ShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      uDark: { value: swatchUniform(PLACEHOLDER_SWATCH.asphalt) },
      uLight: { value: swatchUniform(PLACEHOLDER_SWATCH.asphalt_lt) },
    },
  });
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  return mesh;
}
