// World-pass material conventions (TECHNICAL_DESIGN §12.3, §12.5). RT_world has two colour attachments, so
// every world material is a GLSL3 ShaderMaterial writing both outputs:
//   location 0: unlit colour (Kerbside-32 colours; the palette pass snaps anything else);
//   location 1: mask, R = shadow, G = light.
// Shadow and light draws blend with MaxEquation and write vec4(0) to colour: max(0, dst) = dst, so they only
// raise the mask (WebGL2 has no per-attachment colour masks).
import { CustomBlending, MaxEquation, OneFactor, type ShaderMaterialParameters, Vector3 } from 'three';
import { KERBSIDE32, type Kerbside32 } from './palettePass.ts';

/** Fragment outputs every world material declares. */
export const WORLD_OUTPUTS_GLSL = /* glsl */ `
layout(location = 0) out highp vec4 outColour;
layout(location = 1) out highp vec4 outMask;
`;

/** Depth layers for flat quads at y = 0 (TECHNICAL_DESIGN §12.5). */
export const DepthLayer = {
  Ground: 0,
  BuildingShadow: 1,
  Decal: 2,
  Litter: 3,
  DropShadow: 4,
  Pedestrian: 5,
  Traffic: 6,
  Bessie: 7,
  Brush: 8,
  CatRoof: 9,
  Fx: 10,
} as const;
export type DepthLayer = (typeof DepthLayer)[keyof typeof DepthLayer];

/**
 * Vertex-shader helper: the clip-space depth offset that orders flat layers without lifting them off y = 0
 * (`layer * 8 + sortBias`, sortBias in [0, 1)).
 */
export const DEPTH_LAYER_GLSL = /* glsl */ `
vec4 applyDepthLayer(vec4 clip, float layer, float sortBias) {
  clip.z -= (layer * 8.0 + sortBias) * 1e-5 * clip.w;
  return clip;
}
`;

/** Material parameters for a mask-only draw (shadow or light): MAX blend, depth-tested, no depth write. */
export function maskDrawParameters(): ShaderMaterialParameters {
  return {
    blending: CustomBlending,
    blendEquation: MaxEquation,
    blendEquationAlpha: MaxEquation,
    // Factors are ignored by MIN/MAX equations; One keeps the state explicit.
    blendSrc: OneFactor,
    blendDst: OneFactor,
    blendSrcAlpha: OneFactor,
    blendDstAlpha: OneFactor,
    depthTest: true,
    depthWrite: false,
  };
}

/** A palette colour as normalised RGB (byte / 255), for a uniform or vertex attribute. */
export function paletteColourVector(index: number, palette: Kerbside32 = KERBSIDE32): Vector3 {
  const rgb = palette.rgb;
  if (!Number.isInteger(index) || index < 0 || index * 3 >= rgb.length) {
    throw new Error(`palette index ${index} out of range`);
  }
  return new Vector3(
    (rgb[index * 3] ?? 0) / 255,
    (rgb[index * 3 + 1] ?? 0) / 255,
    (rgb[index * 3 + 2] ?? 0) / 255,
  );
}
