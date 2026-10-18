// Renderer skeleton (TECHNICAL_DESIGN §12.3, §12.7). M0 frame graph: world pass into the (W+2)×272 target,
// then an integer-scale nearest blit of the inner W×270 window, shifted by the camera's sub-pixel remainder,
// into the letterboxed canvas. The palette pass and MRT slot in between in SSP-016.
// Nothing here allocates per frame: every three.js object is created up front.
import {
  BufferAttribute,
  BufferGeometry,
  GLSL3,
  LinearSRGBColorSpace,
  Mesh,
  NearestFilter,
  OrthographicCamera,
  Scene,
  ShaderMaterial,
  Vector2,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import { type CameraRig, createCameraRig, setCameraFrame } from './camera.ts';
import { createPlaceholderGround } from './placeholderWorld.ts';
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

const BLIT_FRAGMENT = /* glsl */ `
precision highp float;
precision highp int;
uniform highp sampler2D uSource;
uniform int uScale;
uniform ivec2 uOffset;
uniform int uCanvasHeight;
uniform int uMargin;
layout(location = 0) out highp vec4 fragColor;
void main() {
  ivec2 frag = ivec2(gl_FragCoord.xy);
  ivec2 device = ivec2(frag.x, uCanvasHeight - 1 - frag.y);
  ivec2 texel = (device + uOffset) / uScale + uMargin;
  ivec2 size = textureSize(uSource, 0);
  fragColor = texelFetch(uSource, ivec2(texel.x, size.y - 1 - texel.y), 0);
}
`;

/** Owns the WebGL2 context, the world render target and the upscale blit. */
export class Renderer {
  readonly webgl: WebGLRenderer;
  readonly rig: CameraRig;
  private readonly world: Scene;
  private readonly worldTarget: WebGLRenderTarget;
  private readonly blitScene: Scene;
  private readonly blitCamera: OrthographicCamera;
  private readonly blitMaterial: ShaderMaterial;
  private readonly blitOffset: Vector2;
  private scale = 1;

  constructor(canvas: HTMLCanvasElement) {
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
    this.world.add(createPlaceholderGround());

    this.worldTarget = new WebGLRenderTarget(rtWidthPx(DEFAULT_INTERNAL_WIDTH_PX), RT_HEIGHT_PX, {
      minFilter: NearestFilter,
      magFilter: NearestFilter,
      generateMipmaps: false,
      depthBuffer: true,
      stencilBuffer: false,
      samples: 0,
    });

    // One oversized triangle covers the whole canvas: cheaper than a quad and needs no matrices.
    const triangle = new BufferGeometry();
    triangle.setAttribute(
      'position',
      new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3),
    );
    this.blitOffset = new Vector2(0, 0);
    this.blitMaterial = new ShaderMaterial({
      glslVersion: GLSL3,
      vertexShader: BLIT_VERTEX,
      fragmentShader: BLIT_FRAGMENT,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uSource: { value: this.worldTarget.texture },
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
      setCameraFrame(this.rig, layout.internalWidth);
    }
    this.scale = layout.scale;
    const uniforms = this.blitMaterial.uniforms;
    if (uniforms.uScale !== undefined) uniforms.uScale.value = layout.scale;
    if (uniforms.uCanvasHeight !== undefined) uniforms.uCanvasHeight.value = layout.canvasDeviceHeight;
  }

  /** Draws one frame from the camera rig's current (already updated) state. */
  render(): void {
    const webgl = this.webgl;
    webgl.info.reset();

    webgl.setRenderTarget(this.worldTarget);
    webgl.render(this.world, this.rig.camera);

    this.blitOffset.set(
      blitOffsetDevicePx(this.rig.fractionX, this.scale),
      blitOffsetDevicePx(this.rig.fractionY, this.scale),
    );
    webgl.setRenderTarget(null);
    webgl.render(this.blitScene, this.blitCamera);
  }

  /** Draw calls in the last frame over all passes (budget ≤ 10, TECHNICAL_DESIGN §12.7). */
  get drawCalls(): number {
    return this.webgl.info.render.calls;
  }

  /** Current integer upscale factor. */
  get upscale(): number {
    return this.scale;
  }
}
