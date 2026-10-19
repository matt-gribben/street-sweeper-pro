// Palette pass (TECHNICAL_DESIGN §12.3, §12.6): the guarantee that no colour outside Kerbside-32 reaches the
// screen. A full-screen pass reads RT_world's two attachments (unlit colour + shadow/light mask) and writes
// RT_final:
//   1. idx = LUT[r>>2][g>>2][b>>2]          (64³ R8 Data3DTexture, built at boot in OKLab)
//   2. if night is active and G == 0: idx = night[idx]
//   3. if R == 1:                     idx = shadow[idx]   (shadow after night)
//   4. if dim is active and B == 0:   idx = shadow[idx]   (the pause dim, SSP-287: world pixels only)
//   5. output palette[idx]
// The dim step is the PauseOverlay's frozen world (GDD §15.4): one more step down the shadow ramp for every pixel
// that is not UI (mask B, written only by the UI pass), after the normal shadow, so building and drop shadows stay
// one step darker than the sun beside them. UI pixels (the HUD and the overlay itself) are never dimmed.
// The colour maths (`nearestIndex`, `buildLut`, `palettePassReference`) is pure TS and unit-tested without
// WebGL; the GPU side only uploads its results. Every colour comes from kerbside32.json (CLAUDE.md hard
// rule 3): this file spells no colour value.
import {
  type BufferGeometry,
  ClampToEdgeWrapping,
  Data3DTexture,
  DataTexture,
  GLSL3,
  Mesh,
  NearestFilter,
  OrthographicCamera,
  RedFormat,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  type Texture,
  UnsignedByteType,
  type WebGLRenderer,
  type WebGLRenderTarget,
} from 'three';
import paletteJson from '../../assets-src/palette/kerbside32.json' with { type: 'json' };

/** Number of Kerbside-32 colours. */
export const PALETTE_SIZE = 32;

/** LUT cells per channel: 8-bit channels quantised by `>> 2`. */
export const LUT_SIZE = 64;

/** Channel bits dropped by the LUT (`v >> LUT_SHIFT` is the cell coordinate). */
export const LUT_SHIFT = 2;

/** A mask channel byte at or above this counts as set (R = shadow, G = light). Mask writes are 0 or 255. */
export const MASK_SET_THRESHOLD = 128;

/** A loaded, validated Kerbside-32 palette (`assets-src/palette/kerbside32.json`). */
export type Kerbside32 = {
  /** Colour names in index order (`sweeper_yellow` is 15). */
  readonly names: readonly string[];
  /** 32 × [r, g, b] bytes in index order. */
  readonly rgb: Uint8Array;
  /** `night[i]`: the index shown for `i` at night outside a light pool. */
  readonly night: Uint8Array;
  /** `shadow[i]`: the index shown for `i` under the shadow mask (applied after night). */
  readonly shadow: Uint8Array;
};

const HEX_COLOUR = /^#[0-9a-f]{6}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseIndexTable(value: unknown, where: string): Uint8Array {
  if (!Array.isArray(value) || value.length !== PALETTE_SIZE) {
    throw new Error(`kerbside32.json: ${where} must be a list of ${PALETTE_SIZE} indices`);
  }
  const out = new Uint8Array(PALETTE_SIZE);
  value.forEach((entry: unknown, i) => {
    if (typeof entry !== 'number' || !Number.isInteger(entry) || entry < 0 || entry >= PALETTE_SIZE) {
      throw new Error(`kerbside32.json: ${where}[${i}] = ${String(entry)} is not an index 0-31`);
    }
    out[i] = entry;
  });
  return out;
}

/** Validates parsed kerbside32.json content (hand-written guard, CLAUDE.md §5.1) into a {@link Kerbside32}. */
export function parsePalette(data: unknown): Kerbside32 {
  if (!isRecord(data)) throw new Error('kerbside32.json: top level must be an object');
  const colours = data.colors;
  if (!Array.isArray(colours) || colours.length !== PALETTE_SIZE) {
    throw new Error(`kerbside32.json: colors must hold exactly ${PALETTE_SIZE} entries`);
  }
  const names: string[] = [];
  const rgb = new Uint8Array(PALETTE_SIZE * 3);
  colours.forEach((entry: unknown, i) => {
    if (!isRecord(entry) || typeof entry.name !== 'string' || typeof entry.hex !== 'string') {
      throw new Error(`kerbside32.json: colors[${i}] must be { name, hex }`);
    }
    if (!HEX_COLOUR.test(entry.hex)) {
      throw new Error(`kerbside32.json: colors[${i}].hex must be '#' plus 6 lower-case hex digits`);
    }
    names.push(entry.name);
    for (let c = 0; c < 3; c++) {
      rgb[i * 3 + c] = Number.parseInt(entry.hex.slice(1 + 2 * c, 3 + 2 * c), 16);
    }
  });
  return {
    names,
    rgb,
    night: parseIndexTable(data.night, 'night'),
    shadow: parseIndexTable(data.shadow, 'shadow'),
  };
}

/** The repo's palette, loaded once from kerbside32.json. */
export const KERBSIDE32: Kerbside32 = parsePalette(paletteJson);

/** Palette index of a colour name; throws for an unknown name. */
export function paletteIndex(name: string, palette: Kerbside32 = KERBSIDE32): number {
  const index = palette.names.indexOf(name);
  if (index < 0) throw new Error(`no Kerbside-32 colour named '${name}'`);
  return index;
}

// ---------------------------------------------------------------------------------------------------------
// OKLab nearest colour. Mirrors tools/forge/forge/palette.py operation for operation (float64, every product
// and sum evaluated left to right, matrices written out term by term) so the two agree on the shared
// 4,096-sample fixture. Matrices: Björn Ottosson, https://bottosson.github.io/posts/oklab/ (2020).

// M1: linear sRGB -> LMS.
const M1_00 = 0.4122214708;
const M1_01 = 0.5363325363;
const M1_02 = 0.0514459929;
const M1_10 = 0.2119034982;
const M1_11 = 0.6806995451;
const M1_12 = 0.1073969566;
const M1_20 = 0.0883024619;
const M1_21 = 0.2817188376;
const M1_22 = 0.6299787005;
// M2: cube-rooted LMS -> (L, a, b).
const M2_00 = 0.2104542553;
const M2_01 = 0.793617785;
const M2_02 = -0.0040720468;
const M2_10 = 1.9779984951;
const M2_11 = -2.428592205;
const M2_12 = 0.4505937099;
const M2_20 = 0.0259040371;
const M2_21 = 0.7827717662;
const M2_22 = -0.808675766;

/** One 8-bit sRGB channel -> linear light in [0, 1] (IEC 61966-2-1), as the forge's `srgb_to_linear`. */
export function srgbToLinear(value: number): number {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Linear sRGB -> OKLab, written into `out[offset..offset+2]` as (L, a, b). */
export function linearToOklab(r: number, g: number, b: number, out: Float64Array, offset = 0): void {
  const l = Math.cbrt(M1_00 * r + M1_01 * g + M1_02 * b);
  const m = Math.cbrt(M1_10 * r + M1_11 * g + M1_12 * b);
  const s = Math.cbrt(M1_20 * r + M1_21 * g + M1_22 * b);
  out[offset] = M2_00 * l + M2_01 * m + M2_02 * s;
  out[offset + 1] = M2_10 * l + M2_11 * m + M2_12 * s;
  out[offset + 2] = M2_20 * l + M2_21 * m + M2_22 * s;
}

/** 8-bit sRGB -> OKLab (L, a, b) as a new Float64Array. */
export function srgbToOklab(r: number, g: number, b: number): Float64Array {
  const out = new Float64Array(3);
  linearToOklab(srgbToLinear(r), srgbToLinear(g), srgbToLinear(b), out);
  return out;
}

/** OKLab of every palette colour: 32 × (L, a, b), index-major. */
export function paletteOklab(palette: Kerbside32 = KERBSIDE32): Float64Array {
  const out = new Float64Array(PALETTE_SIZE * 3);
  for (let i = 0; i < PALETTE_SIZE; i++) {
    const o = i * 3;
    const rgb = palette.rgb;
    linearToOklab(
      srgbToLinear(rgb[o] ?? 0),
      srgbToLinear(rgb[o + 1] ?? 0),
      srgbToLinear(rgb[o + 2] ?? 0),
      out,
      o,
    );
  }
  return out;
}

const KERBSIDE32_OKLAB = paletteOklab(KERBSIDE32);

/** Nearest palette row to an OKLab colour: squared distance dL² + da² + db², lower index wins an exact tie. */
function nearestIndexOklab(l: number, a: number, b: number, lab: Float64Array): number {
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < PALETTE_SIZE; i++) {
    const o = i * 3;
    const dl = l - (lab[o] ?? 0);
    const da = a - (lab[o + 1] ?? 0);
    const db = b - (lab[o + 2] ?? 0);
    const distance = dl * dl + da * da + db * db;
    // Strictly less: on an exact tie the earlier (lower) index stays, like numpy's argmin.
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  }
  return best;
}

const scratchLab = new Float64Array(3);

/**
 * Exact-RGB nearest Kerbside-32 index of an 8-bit sRGB colour, by squared OKLab distance in float64; the lower
 * index wins an exact tie. Equals the forge's `nearest_indices` (pinned by tests/fixtures/palette_oklab_4096.json).
 * `lab` defaults to Kerbside-32; pass `paletteOklab(other)` to map against another palette.
 */
export function nearestIndex(r: number, g: number, b: number, lab: Float64Array = KERBSIDE32_OKLAB): number {
  linearToOklab(srgbToLinear(r), srgbToLinear(g), srgbToLinear(b), scratchLab);
  return nearestIndexOklab(scratchLab[0] ?? 0, scratchLab[1] ?? 0, scratchLab[2] ?? 0, lab);
}

// ---------------------------------------------------------------------------------------------------------
// The 64³ LUT

/** Flat LUT offset of an 8-bit colour: x = r >> 2 varies fastest, then g, then b (Data3DTexture layout). */
export function lutCell(r: number, g: number, b: number): number {
  return ((b >> LUT_SHIFT) * LUT_SIZE + (g >> LUT_SHIFT)) * LUT_SIZE + (r >> LUT_SHIFT);
}

/**
 * The 8-bit channel value that stands for LUT cell coordinate `cell` (which covers 4·cell .. 4·cell + 3).
 * It is the cell's (upper) integer midpoint, 4·cell + 2. Measured in SSP-016 over all 16.7M colours, the LUT
 * then agrees with the exact nearest for 97.32% of them, the best of the candidates tried (4c + 1: 97.31%,
 * round(c·255/63): 97.15%, 4c: 95.83%, 4c + 3: 95.88%). See TECHNICAL_DESIGN §12.6.
 */
export function lutRepresentative(cell: number): number {
  return (cell << LUT_SHIFT) + 2;
}

/**
 * Builds the 64³ RGB -> index LUT (Uint8Array, {@link lutCell} order). Each cell's representative colour goes
 * through {@link nearestIndex}; then the cell holding each palette colour is overridden with that colour's own
 * index, so every Kerbside-32 colour maps to itself (TECHNICAL_DESIGN §12.6). Throws if two palette colours
 * share a cell (the override would then be ambiguous).
 */
export function buildLut(palette: Kerbside32 = KERBSIDE32): Uint8Array {
  lutBuilds += 1;
  const lab = palette === KERBSIDE32 ? KERBSIDE32_OKLAB : paletteOklab(palette);
  // srgbToLinear depends on one channel only, so each representative is decoded once rather than per cell.
  const linear = new Float64Array(LUT_SIZE);
  for (let i = 0; i < LUT_SIZE; i++) linear[i] = srgbToLinear(lutRepresentative(i));

  const lut = new Uint8Array(LUT_SIZE * LUT_SIZE * LUT_SIZE);
  const cellLab = new Float64Array(3);
  let offset = 0;
  for (let b = 0; b < LUT_SIZE; b++) {
    const lb = linear[b] ?? 0;
    for (let g = 0; g < LUT_SIZE; g++) {
      const lg = linear[g] ?? 0;
      for (let r = 0; r < LUT_SIZE; r++) {
        linearToOklab(linear[r] ?? 0, lg, lb, cellLab);
        lut[offset++] = nearestIndexOklab(cellLab[0] ?? 0, cellLab[1] ?? 0, cellLab[2] ?? 0, lab);
      }
    }
  }

  const owner = new Map<number, number>();
  for (let i = 0; i < PALETTE_SIZE; i++) {
    const rgb = palette.rgb;
    const cell = lutCell(rgb[i * 3] ?? 0, rgb[i * 3 + 1] ?? 0, rgb[i * 3 + 2] ?? 0);
    const other = owner.get(cell);
    if (other !== undefined) {
      throw new Error(
        `palette colours ${other} (${palette.names[other]}) and ${i} (${palette.names[i]}) share LUT cell ${cell}`,
      );
    }
    owner.set(cell, i);
    lut[cell] = i;
  }
  return lut;
}

let cachedLut: Uint8Array | null = null;

/** buildLut calls since the module loaded (SSP-284: a page builds the LUT exactly once, in BootScene). */
let lutBuilds = 0;

/** How many times buildLut has run on this page (`__ssp.boot().lutBuilds`, SSP-284). Observation only. */
export function lutBuildCount(): number {
  return lutBuilds;
}

/** The Kerbside-32 LUT, built on first use (~30 ms) and cached in memory for the session. */
export function kerbside32Lut(): Uint8Array {
  cachedLut ??= buildLut(KERBSIDE32);
  return cachedLut;
}

// ---------------------------------------------------------------------------------------------------------
// CPU reference of the pass (the shader below performs the same steps)

/**
 * Steps 2 to 4 of the pass: night remap unless lit, then shadow remap, then (SSP-287) the pause dim: one more
 * shadow step when `dimmed` (dim on and the pixel is not UI).
 */
export function remapIndex(
  index: number,
  shadowed: boolean,
  lit: boolean,
  night: boolean,
  palette: Kerbside32 = KERBSIDE32,
  dimmed = false,
): number {
  let idx = index;
  if (night && !lit) idx = palette.night[idx] ?? idx;
  if (shadowed) idx = palette.shadow[idx] ?? idx;
  if (dimmed) idx = palette.shadow[idx] ?? idx;
  return idx;
}

/**
 * CPU reference of the whole pass over RGBA8 colour and mask buffers of equal size. Returns RGBA8 output
 * (alpha 255). Mirrors PALETTE_FRAGMENT exactly; used by the property tests and by future readFrame checks.
 * `dim` is the pause dim (SSP-287): every pixel whose mask B is unset takes one more shadow step.
 */
export function palettePassReference(
  colour: Uint8Array,
  mask: Uint8Array,
  night: boolean,
  lut: Uint8Array = kerbside32Lut(),
  palette: Kerbside32 = KERBSIDE32,
  dim = false,
): Uint8Array {
  if (colour.length !== mask.length || colour.length % 4 !== 0) {
    throw new Error('palettePassReference: colour and mask must be RGBA8 buffers of equal size');
  }
  const out = new Uint8Array(colour.length);
  for (let p = 0; p < colour.length; p += 4) {
    const idx0 = lut[lutCell(colour[p] ?? 0, colour[p + 1] ?? 0, colour[p + 2] ?? 0)] ?? 0;
    const shadowed = (mask[p] ?? 0) >= MASK_SET_THRESHOLD;
    const lit = (mask[p + 1] ?? 0) >= MASK_SET_THRESHOLD;
    const ui = (mask[p + 2] ?? 0) >= MASK_SET_THRESHOLD;
    const idx = remapIndex(idx0, shadowed, lit, night, palette, dim && !ui);
    out[p] = palette.rgb[idx * 3] ?? 0;
    out[p + 1] = palette.rgb[idx * 3 + 1] ?? 0;
    out[p + 2] = palette.rgb[idx * 3 + 2] ?? 0;
    out[p + 3] = 255;
  }
  return out;
}

/** The 32×2 R8 remap texture data: row 0 = night, row 1 = shadow. */
export function buildRemapData(palette: Kerbside32 = KERBSIDE32): Uint8Array {
  const data = new Uint8Array(PALETTE_SIZE * 2);
  data.set(palette.night, 0);
  data.set(palette.shadow, PALETTE_SIZE);
  return data;
}

/** The 32×1 RGBA8 palette texture data. */
export function buildPaletteData(palette: Kerbside32 = KERBSIDE32): Uint8Array {
  const data = new Uint8Array(PALETTE_SIZE * 4);
  for (let i = 0; i < PALETTE_SIZE; i++) {
    data[i * 4] = palette.rgb[i * 3] ?? 0;
    data[i * 4 + 1] = palette.rgb[i * 3 + 1] ?? 0;
    data[i * 4 + 2] = palette.rgb[i * 3 + 2] ?? 0;
    data[i * 4 + 3] = 255;
  }
  return data;
}

// ---------------------------------------------------------------------------------------------------------
// GPU pass

const PALETTE_VERTEX = /* glsl */ `
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

// RT_world and RT_final have the same size, so gl_FragCoord addresses the source texel directly. Every texture
// is UNORM8 and fetched with texelFetch, so `v * 255 + 0.5` recovers each byte exactly.
const PALETTE_FRAGMENT = /* glsl */ `
precision highp float;
precision highp int;
precision highp sampler3D;
uniform highp sampler2D uColour;
uniform highp sampler2D uMask;
uniform highp sampler3D uLut;
uniform highp sampler2D uRemap;
uniform highp sampler2D uPalette;
uniform bool uNight;
uniform bool uDim;
layout(location = 0) out highp vec4 fragColour;

int toByte(float v) {
  return int(v * 255.0 + 0.5);
}

void main() {
  ivec2 texel = ivec2(gl_FragCoord.xy);
  vec4 colour = texelFetch(uColour, texel, 0);
  vec4 mask = texelFetch(uMask, texel, 0);
  ivec3 cell = ivec3(toByte(colour.r), toByte(colour.g), toByte(colour.b)) >> ${LUT_SHIFT};
  int idx = toByte(texelFetch(uLut, cell, 0).r);
  if (uNight && mask.g < 0.5) {
    idx = toByte(texelFetch(uRemap, ivec2(idx, 0), 0).r);
  }
  if (mask.r >= 0.5) {
    idx = toByte(texelFetch(uRemap, ivec2(idx, 1), 0).r);
  }
  if (uDim && mask.b < 0.5) {
    idx = toByte(texelFetch(uRemap, ivec2(idx, 1), 0).r);
  }
  fragColour = vec4(texelFetch(uPalette, ivec2(idx, 0), 0).rgb, 1.0);
}
`;

/** Data-texture setup shared by every lookup texture: nearest, clamped, no mipmaps, tightly packed rows. */
export function nearestDataTexture<T extends Texture>(texture: T): T {
  texture.minFilter = NearestFilter;
  texture.magFilter = NearestFilter;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.unpackAlignment = 1;
  texture.flipY = false;
  texture.needsUpdate = true;
  return texture;
}

/** Uploads a 64³ LUT as an R8 Data3DTexture. */
export function createLutTexture(lut: Uint8Array): Data3DTexture {
  const texture = new Data3DTexture(lut, LUT_SIZE, LUT_SIZE, LUT_SIZE);
  texture.format = RedFormat;
  texture.type = UnsignedByteType;
  texture.wrapR = ClampToEdgeWrapping;
  return nearestDataTexture(texture);
}

/** Uploads the night/shadow remaps as a 32×2 R8 texture (row 0 night, row 1 shadow). */
export function createRemapTexture(palette: Kerbside32 = KERBSIDE32): DataTexture {
  return nearestDataTexture(
    new DataTexture(buildRemapData(palette), PALETTE_SIZE, 2, RedFormat, UnsignedByteType),
  );
}

/** Uploads the palette as a 32×1 RGBA8 texture. */
export function createPaletteTexture(palette: Kerbside32 = KERBSIDE32): DataTexture {
  return nearestDataTexture(
    new DataTexture(buildPaletteData(palette), PALETTE_SIZE, 1, RGBAFormat, UnsignedByteType),
  );
}

/**
 * The palette pass's lookup tables on the GPU (SSP-284): the 64³ LUT, the 32×2 night/shadow remap and the 32×1
 * palette, uploaded once. BootScene builds them, the asset registry (src/app/assetRegistry.ts) holds them for the
 * page's lifetime, and the renderer's palette pass samples them (Renderer.installPalette).
 */
export type PaletteTables = {
  readonly palette: Kerbside32;
  /** The 64³ RGB → index LUT ({@link lutCell} order). */
  readonly lut: Uint8Array;
  readonly lutTexture: Data3DTexture;
  /** Row 0 night, row 1 shadow (createRemapTexture). */
  readonly remapTexture: DataTexture;
  readonly paletteTexture: DataTexture;
};

/**
 * Builds the palette pass's tables for `palette`: the Kerbside-32 LUT through the {@link kerbside32Lut} cache (so
 * a page builds it at most once), any other palette's with a fresh {@link buildLut}.
 */
export function createPaletteTables(palette: Kerbside32 = KERBSIDE32): PaletteTables {
  const lut = palette === KERBSIDE32 ? kerbside32Lut() : buildLut(palette);
  return {
    palette,
    lut,
    lutTexture: createLutTexture(lut),
    remapTexture: createRemapTexture(palette),
    paletteTexture: createPaletteTexture(palette),
  };
}

/** Releases the tables' GPU textures (a failed boot; the game otherwise keeps them for the page's lifetime). */
export function disposePaletteTables(tables: PaletteTables): void {
  tables.lutTexture.dispose();
  tables.remapTexture.dispose();
  tables.paletteTexture.dispose();
}

/** The full-screen palette pass: RT_world (colour + mask) -> RT_final. */
export type PalettePass = {
  /** Night remap on or off (outside the light mask). */
  night: boolean;
  /** The pause dim on or off (SSP-287): one more shadow step on every non-UI pixel. */
  dim: boolean;
  /** Draws the pass into `target` (one draw call). */
  render(webgl: WebGLRenderer, target: WebGLRenderTarget): void;
  /** Releases the pass's material. The tables belong to the asset registry and stay. */
  dispose(): void;
};

/**
 * Creates the pass over RT_world's colour (attachment 0) and mask (attachment 1) textures, sampling `tables`
 * (createPaletteTables, built once at boot). `triangle` is a clip-space full-screen triangle shared with the
 * upscale blit.
 */
export function createPalettePass(
  colour: Texture,
  mask: Texture,
  triangle: BufferGeometry,
  tables: PaletteTables,
): PalettePass {
  const { lutTexture, remapTexture, paletteTexture } = tables;
  const nightUniform = { value: false };
  const dimUniform = { value: false };
  const material = new ShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: PALETTE_VERTEX,
    fragmentShader: PALETTE_FRAGMENT,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      uColour: { value: colour },
      uMask: { value: mask },
      uLut: { value: lutTexture },
      uRemap: { value: remapTexture },
      uPalette: { value: paletteTexture },
      uNight: nightUniform,
      uDim: dimUniform,
    },
  });
  const mesh = new Mesh(triangle, material);
  mesh.frustumCulled = false;
  const scene = new Scene();
  scene.add(mesh);
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);

  return {
    get night(): boolean {
      return nightUniform.value;
    },
    set night(on: boolean) {
      nightUniform.value = on;
    },
    get dim(): boolean {
      return dimUniform.value;
    },
    set dim(on: boolean) {
      dimUniform.value = on;
    },
    render(webgl: WebGLRenderer, target: WebGLRenderTarget): void {
      webgl.setRenderTarget(target);
      webgl.render(scene, camera);
    },
    dispose(): void {
      material.dispose();
    },
  };
}
