// Renderer (TECHNICAL_DESIGN §12.3, §12.7). Frame graph:
//   1. world pass (perspective camera) into RT_world, (W+2)×272 MRT: attachment 0 unlit colour, attachment 1
//      mask (R = shadow, G = light, B = UI flag), 24-bit depth;
//   2. UI pass (orthographic camera over internal pixels, SSP-069) into RT_world after a depth clear: the `ui`
//      root's instanced draws (spriteBatch.ts UiSpriteBatch), each texel writing mask (0, 1, 1): never shadowed,
//      lit (night never remaps it) and flagged as UI;
//   3. palette pass into RT_final, (W+2)×272: RGB -> Kerbside-32 index via the 64³ OKLab LUT, night and
//      shadow remaps, index -> palette RGB (palettePass.ts). Its tables (LUT, remaps, palette) are built once by
//      BootScene and installed with installPalette() (SSP-284); until then each frame only clears the canvas to
//      palette index 00;
//   4. integer-scale nearest blit of RT_final's inner W×270 window, shifted by the camera's sub-pixel
//      remainder, into the letterboxed canvas. UI pixels are exempt from the shift: where the unshifted or the
//      shifted RT texel carries the UI flag, the blit samples the unshifted texel, so the HUD stays on the whole
//      internal-pixel grid while the world scrolls smoothly under it (blitUiAwareTexel in upscale.ts mirrors it).
// Nothing here allocates per frame: every three.js object is created up front.
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  GLSL3,
  LinearSRGBColorSpace,
  Mesh,
  NearestFilter,
  type Object3D,
  OrthographicCamera,
  Scene,
  ShaderMaterial,
  type Texture,
  Vector2,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import { type CameraRig, createCameraRig, setCameraFrame } from './camera.ts';
import { createPalettePass, KERBSIDE32, type PalettePass, type PaletteTables } from './palettePass.ts';
import { flipRgbaRows, RGBA_BYTES } from './readback.ts';
import {
  blitOffsetDevicePx,
  INTERNAL_HEIGHT_PX,
  RT_HEIGHT_PX,
  RT_MARGIN_PX,
  rtWidthPx,
  type ViewportLayout,
} from './upscale.ts';

/** Default internal width before the first layout arrives (16:9). */
const DEFAULT_INTERNAL_WIDTH_PX = 480;

// Integer maths mirrors blitSourceTexel() in upscale.ts (unit-tested there). gl_FragCoord is bottom-up; the
// internal frame and the offsets are top-down, and render-target row 0 is the bottom row.
const BLIT_VERTEX = /* glsl */ `
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

// uMask is RT_world's mask attachment: B >= 0.5 marks a UI texel (UiSpriteBatch writes 1, everything else 0).
const BLIT_FRAGMENT = /* glsl */ `
precision highp float;
precision highp int;
uniform highp sampler2D uSource;
uniform highp sampler2D uMask;
uniform int uScale;
uniform ivec2 uOffset;
uniform int uCanvasHeight;
uniform int uMargin;
layout(location = 0) out highp vec4 fragColor;
void main() {
  ivec2 frag = ivec2(gl_FragCoord.xy);
  ivec2 device = ivec2(frag.x, uCanvasHeight - 1 - frag.y);
  ivec2 size = textureSize(uSource, 0);
  ivec2 shifted = (device + uOffset) / uScale + uMargin;
  ivec2 still = device / uScale + uMargin;
  shifted.y = size.y - 1 - shifted.y;
  still.y = size.y - 1 - still.y;
  bool ui = texelFetch(uMask, still, 0).b >= 0.5 || texelFetch(uMask, shifted, 0).b >= 0.5;
  fragColor = texelFetch(uSource, ui ? still : shifted, 0);
}
`;

/**
 * Points the UI camera at the whole render target in internal pixels: x from −margin (left edge) to W + margin, y
 * DOWN from −margin (top) to 270 + margin, so internal pixel (x, y) is RT texel (x + 1, y + 1) from the top-left.
 * Top < bottom flips y; UI quads are double-sided, so the reversed winding does not cull them.
 */
function setUiCameraFrame(camera: OrthographicCamera, internalWidth: number): void {
  camera.left = -RT_MARGIN_PX;
  camera.right = internalWidth + RT_MARGIN_PX;
  camera.top = -RT_MARGIN_PX;
  camera.bottom = INTERNAL_HEIGHT_PX + RT_MARGIN_PX;
  camera.updateProjectionMatrix();
}

/** Owns the WebGL2 context, the world render target and the upscale blit. */
export class Renderer {
  readonly webgl: WebGLRenderer;
  readonly rig: CameraRig;
  private readonly world: Scene;
  /** UI-pass root (pass 2): scenes add their UiSpriteBatch meshes here (SceneContext.ui). */
  readonly ui: Scene;
  /** Orthographic camera over the RT in internal pixels: x right, y down, (0, 0) the frame's top-left. */
  private readonly uiCamera: OrthographicCamera;
  /** RT_world: MRT, textures[0] = colour, textures[1] = mask (§12.3). */
  private readonly worldTarget: WebGLRenderTarget;
  /** RT_final: the palette-mapped frame the blit samples. */
  private readonly finalTarget: WebGLRenderTarget;
  /** The palette pass, built when BootScene installs the palette tables (installPalette); null until then. */
  private palettePass: PalettePass | null = null;
  /** Kept for the pass while it does not exist yet (Game sets the night switch every frame from the start). */
  private nightOn = false;
  /** Palette index 00, the colour of the canvas before the palette pass exists (read from kerbside32.json). */
  private readonly index00 = new Color();
  /** Scratch for the clear colour the pre-boot clear restores. */
  private readonly savedClear = new Color();
  private readonly colourTexture: Texture;
  private readonly maskTexture: Texture;
  private readonly triangle: BufferGeometry;
  private readonly blitScene: Scene;
  private readonly blitCamera: OrthographicCamera;
  private readonly blitMaterial: ShaderMaterial;
  private readonly blitOffset: Vector2;
  private scale = 1;
  private layout: ViewportLayout | null = null;
  private framesRendered = 0;

  /**
   * `world` is everything drawn in the world pass (pass 1): the spike city in M0 (spikeCity.ts), or the SSP-016
   * palette test world. Its draw calls come on top of the palette pass and the blit.
   */
  constructor(canvas: HTMLCanvasElement, world: Object3D) {
    // three 0.186 WebGLRenderer is WebGL2-only, which is what we want (not WebGPU).
    this.webgl = new WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      depth: false,
      stencil: false,
      powerPreference: 'high-performance',
    });
    // Device pixels are managed by upscale.ts; colours pass through untouched (no sRGB conversion) so
    // palette bytes in the target reach the screen bit-exact.
    this.webgl.setPixelRatio(1);
    this.webgl.outputColorSpace = LinearSRGBColorSpace;
    // Count draw calls over every pass of a frame, not just the last render() (§12.7).
    this.webgl.info.autoReset = false;

    this.rig = createCameraRig(DEFAULT_INTERNAL_WIDTH_PX);
    this.world = new Scene();
    this.world.add(world);
    this.ui = new Scene();
    this.ui.name = 'uiPass';
    this.uiCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 2);
    this.uiCamera.position.set(0, 0, 1);
    setUiCameraFrame(this.uiCamera, DEFAULT_INTERNAL_WIDTH_PX);

    const rtWidth = rtWidthPx(DEFAULT_INTERNAL_WIDTH_PX);
    // RGBA8 attachments (UnsignedByteType, RGBAFormat are the defaults) with no colour space conversion.
    this.worldTarget = new WebGLRenderTarget(rtWidth, RT_HEIGHT_PX, {
      count: 2,
      minFilter: NearestFilter,
      magFilter: NearestFilter,
      generateMipmaps: false,
      depthBuffer: true,
      stencilBuffer: false,
      samples: 0,
    });
    this.finalTarget = new WebGLRenderTarget(rtWidth, RT_HEIGHT_PX, {
      minFilter: NearestFilter,
      magFilter: NearestFilter,
      generateMipmaps: false,
      depthBuffer: false,
      stencilBuffer: false,
      samples: 0,
    });

    // One oversized triangle covers the whole canvas: cheaper than a quad and needs no matrices.
    const triangle = new BufferGeometry();
    triangle.setAttribute(
      'position',
      new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3),
    );
    const [colourTexture, maskTexture] = this.worldTarget.textures;
    if (colourTexture === undefined || maskTexture === undefined) {
      throw new Error('RT_world must have two colour attachments');
    }
    this.colourTexture = colourTexture;
    this.maskTexture = maskTexture;
    this.triangle = triangle;
    const rgb = KERBSIDE32.rgb;
    this.index00.setRGB((rgb[0] ?? 0) / 255, (rgb[1] ?? 0) / 255, (rgb[2] ?? 0) / 255, LinearSRGBColorSpace);

    this.blitOffset = new Vector2(0, 0);
    this.blitMaterial = new ShaderMaterial({
      glslVersion: GLSL3,
      vertexShader: BLIT_VERTEX,
      fragmentShader: BLIT_FRAGMENT,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uSource: { value: this.finalTarget.texture },
        uMask: { value: maskTexture },
        uScale: { value: 1 },
        uOffset: { value: this.blitOffset },
        uCanvasHeight: { value: INTERNAL_HEIGHT_PX },
        uMargin: { value: RT_MARGIN_PX },
      },
    });
    const blitMesh = new Mesh(triangle, this.blitMaterial);
    blitMesh.frustumCulled = false;
    this.blitScene = new Scene();
    this.blitScene.add(blitMesh);
    this.blitCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }

  /** Applies a new window layout: canvas drawing-buffer size, internal width and integer scale. */
  resize(layout: ViewportLayout): void {
    this.webgl.setSize(layout.canvasDeviceWidth, layout.canvasDeviceHeight, false);
    if (layout.internalWidth !== this.rig.internalWidth) {
      this.worldTarget.setSize(rtWidthPx(layout.internalWidth), RT_HEIGHT_PX);
      this.finalTarget.setSize(rtWidthPx(layout.internalWidth), RT_HEIGHT_PX);
      setCameraFrame(this.rig, layout.internalWidth);
      setUiCameraFrame(this.uiCamera, layout.internalWidth);
    }
    this.scale = layout.scale;
    this.layout = layout;
    const uniforms = this.blitMaterial.uniforms;
    if (uniforms.uScale !== undefined) uniforms.uScale.value = layout.scale;
    if (uniforms.uCanvasHeight !== undefined) uniforms.uCanvasHeight.value = layout.canvasDeviceHeight;
  }

  /**
   * Builds the palette pass over `tables` (BootScene, once the asset registry is loaded, SSP-284). The tables
   * stay the registry's: the renderer never disposes them. Throws if a palette is already installed.
   */
  installPalette(tables: PaletteTables): void {
    if (this.palettePass !== null)
      throw new Error('Renderer.installPalette: the palette is already installed');
    const pass = createPalettePass(this.colourTexture, this.maskTexture, this.triangle, tables);
    pass.night = this.nightOn;
    this.palettePass = pass;
  }

  /**
   * Draws one frame from the camera rig's current (already updated) state. Until BootScene has installed the
   * palette (installPalette) nothing can pass through the palette pass, so the canvas is cleared to palette
   * index 00 instead (the colour an empty world maps to) with no draw call, and the frame is not counted.
   */
  render(): void {
    const webgl = this.webgl;
    webgl.info.reset();
    const pass = this.palettePass;
    if (pass === null) {
      webgl.getClearColor(this.savedClear);
      const alpha = webgl.getClearAlpha();
      webgl.setRenderTarget(null);
      webgl.setClearColor(this.index00, 1);
      webgl.clear(true, false, false);
      webgl.setClearColor(this.savedClear, alpha);
      return;
    }
    this.framesRendered += 1;

    // Clearing RT_world clears both attachments: mask (0, 0) is unshadowed and unlit.
    webgl.setRenderTarget(this.worldTarget);
    webgl.render(this.world, this.rig.camera);

    // UI pass: same target, depth cleared, colour and mask kept (autoClear would wipe them).
    webgl.autoClear = false;
    webgl.clearDepth();
    webgl.render(this.ui, this.uiCamera);
    webgl.autoClear = true;

    pass.render(webgl, this.finalTarget);

    this.blitOffset.set(
      blitOffsetDevicePx(this.rig.fractionX, this.scale),
      blitOffsetDevicePx(this.rig.fractionY, this.scale),
    );
    webgl.setRenderTarget(null);
    webgl.render(this.blitScene, this.blitCamera);
  }

  /**
   * The last rendered frame as raw palette-mapped RGBA: RT_final's inner W×270 window (render-target x 1..W,
   * y 1..270, i.e. without the 1 px sub-pixel margin), row 0 at the TOP. Independent of the canvas size, the
   * integer scale, the DPR and the blit's sub-pixel offset. Length W × 270 × 4. Test hook only
   * (`__ssp.readFrame()`, TECHNICAL_DESIGN §18.5): it allocates and stalls the GPU, so never call it per frame.
   */
  readFrame(): Uint8Array {
    const width = this.rig.internalWidth;
    const raw = new Uint8Array(width * INTERNAL_HEIGHT_PX * RGBA_BYTES);
    // readPixels coordinates are bottom-up; the margin is 1 px on every side, so the inner window starts at
    // (1, 1) from either corner.
    this.webgl.readRenderTargetPixels(
      this.finalTarget,
      RT_MARGIN_PX,
      RT_MARGIN_PX,
      width,
      INTERNAL_HEIGHT_PX,
      raw,
    );
    return flipRgbaRows(raw, width, INTERNAL_HEIGHT_PX);
  }

  /**
   * Complete frames drawn by render() since the renderer was built (`__ssp.perf().renders`, SSP-046); the
   * index-00 clears before the palette is installed do not count.
   */
  get renderCount(): number {
    return this.framesRendered;
  }

  /** Draw calls in the last frame over all passes (budget ≤ 10, TECHNICAL_DESIGN §12.7). */
  get drawCalls(): number {
    return this.webgl.info.render.calls;
  }

  /** Night remap (outside the light mask) on or off. */
  get night(): boolean {
    return this.nightOn;
  }

  set night(on: boolean) {
    this.nightOn = on;
    if (this.palettePass !== null) this.palettePass.night = on;
  }

  /** The window layout last applied by resize() (null before the first), for pointer mapping (SSP-286). */
  get viewport(): ViewportLayout | null {
    return this.layout;
  }

  /** Current integer upscale factor. */
  get upscale(): number {
    return this.scale;
  }
}
