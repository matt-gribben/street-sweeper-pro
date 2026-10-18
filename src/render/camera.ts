// Straight-down perspective camera with texel snap and speed zoom (TECHNICAL_DESIGN §12.2, §4).
// Camera maths is in metres; the only pixel quantities are the internal-pixel snap remainder and the frame size.
// Springs integrate on render time inside the renderer, never in the sim.
import { PerspectiveCamera } from 'three';
import { PX_PER_M } from '../sim/constants.ts';
import { INTERNAL_HEIGHT_PX, RT_HEIGHT_PX, RT_MARGIN_PX, rtWidthPx } from './upscale.ts';

/** Vertical field of view of the internal W×270 frame, in degrees. */
export const CAMERA_FOV_DEG = 30;

/** Near and far planes in metres (tallest landmark 20 m, highest camera 37.8 m). */
export const CAMERA_NEAR_M = 1.0;
export const CAMERA_FAR_M = 45;

/** Sweep height: the camera height at or below brush-down top speed, where ground is (nearly) 1 texel = 1 px. */
export const SWEEP_HEIGHT_M = 31.5;

/** Camera height at transit top speed, fully zoomed out. */
export const ZOOM_OUT_HEIGHT_M = 37.8;

/** Speed zoom starts above this speed: the brush-down top speed (GDD §7.1, mirrored until tuning.json exists). */
export const ZOOM_START_SPEED_MPS = 6.0;

/** Speed zoom is complete at this speed: the transit (brush-up) top speed (GDD §7.1). */
export const ZOOM_FULL_SPEED_MPS = 11.0;

/**
 * Speed zoom on by default: ROADMAP §8 D-01 (SSP-024) kept it, mirrored in TECHNICAL_DESIGN §12.2. While zoomed out
 * the ground and flat sprites are resampled below 1:1 and shimmer, which ART_BIBLE §4.2 accepts; at or below
 * brush-down speed the camera is back at exactly 1:1. Turning it off (R-02's contingency) leaves look-ahead only.
 */
export const SPEED_ZOOM_DEFAULT = true;

/** Natural frequency of the critically damped height spring, in rad/s. */
export const ZOOM_SPRING_OMEGA_RAD_S = 3;

/** Size of one ground texel in metres: the camera XZ snap grid. */
export const TEXEL_M = 1 / PX_PER_M;

/**
 * Ground scale in internal pixels per metre for a camera at `heightM` looking straight down:
 * `frameHeightPx / (2 · H · tan(fov / 2))`. At H = 31.5 m this is 15.995 px/m, not exactly 16
 * (the docs' 16.875 m visible height is really 16.881 m); the 0.03% error is accepted and reported in
 * TECHNICAL_DESIGN §12.2.
 */
export function groundPxPerMetre(
  heightM: number,
  frameHeightPx: number = INTERNAL_HEIGHT_PX,
  fovDeg: number = CAMERA_FOV_DEG,
): number {
  return frameHeightPx / (2 * heightM * Math.tan((fovDeg * Math.PI) / 360));
}

/** Roof magnification `H / (H − h)` for a surface `surfaceHeightM` above the ground. */
export function roofMagnification(cameraHeightM: number, surfaceHeightM: number): number {
  return cameraHeightM / (cameraHeightM - surfaceHeightM);
}

/**
 * Index of the ground texel containing `m` metres: `floor(m × 16)`, except that a tiny negative `m` whose
 * remainder would round up to a full texel (e.g. −1e-20 m) is counted in the next texel up, so the
 * remainder below stays strictly under 1 px.
 */
function texelIndex(m: number): number {
  const texels = m * PX_PER_M;
  const index = Math.floor(texels);
  return texels - index >= 1 ? index + 1 : index;
}

/** Snaps one world axis (metres) onto the 1/16 m texel grid (rounding down). */
export function snapToTexelM(m: number): number {
  return texelIndex(m) / PX_PER_M;
}

/**
 * The part of `m` the snap removed, in internal pixels, in [0, 1).
 * `snapToTexelM(m) + texelRemainderPx(m) / PX_PER_M` reconstructs `m` (exactly for m ≥ 0, where both terms
 * and the sum are representable; to within one rounding for negative m).
 */
export function texelRemainderPx(m: number): number {
  return Math.max(0, m * PX_PER_M - texelIndex(m));
}

/** Speed-zoom target height: 31.5 m up to 6.0 m/s, 37.8 m from 11.0 m/s, linear between. Reverse counts too. */
export function zoomTargetHeightM(speedMps: number): number {
  const t = (Math.abs(speedMps) - ZOOM_START_SPEED_MPS) / (ZOOM_FULL_SPEED_MPS - ZOOM_START_SPEED_MPS);
  const clamped = Math.min(1, Math.max(0, t));
  return SWEEP_HEIGHT_M + (ZOOM_OUT_HEIGHT_M - SWEEP_HEIGHT_M) * clamped;
}

/** Mutable state of a 1-D spring. Kept as an object so stepping allocates nothing. */
export type SpringState = { value: number; velocity: number };

/**
 * Advances a critically damped spring towards `target` by `dtS` seconds using the exact closed-form solution
 * `x(t) = T + (e + (v + ωe)·t)·e^(−ωt)`, so it is stable and frame-rate independent for any dt.
 * From rest it approaches the target monotonically: it never overshoots.
 */
export function stepCriticalSpring(state: SpringState, target: number, omega: number, dtS: number): void {
  if (dtS <= 0) {
    return;
  }
  const e = state.value - target;
  const c = state.velocity + omega * e;
  const decay = Math.exp(-omega * dtS);
  state.value = target + (e + c * dtS) * decay;
  state.velocity = (state.velocity - omega * c * dtS) * decay;
}

/** The game camera plus the render-time state that drives it. */
export type CameraRig = {
  readonly camera: PerspectiveCamera;
  /** Speed zoom on/off (default SPEED_ZOOM_DEFAULT, D-01). Off pins H to SWEEP_HEIGHT_M (look-ahead only). */
  zoomEnabled: boolean;
  /** Camera tilt in degrees. Always 0 in 1.0 (post-1.0 feature); stored so the API is stable. */
  tiltDeg: number;
  /** Height spring: `value` is the current camera height H in metres. */
  readonly height: SpringState;
  /** Unsnapped focus point on the ground, in metres (render x = sim x, render z = sim y). */
  focusX: number;
  focusZ: number;
  /** Snapped camera position, on the 1/16 m grid. */
  snappedX: number;
  snappedZ: number;
  /** Snap remainders in internal pixels, each in [0, 1): the upscale blit shifts by these × scale. */
  fractionX: number;
  fractionY: number;
  /** Internal width W the projection is set up for. */
  internalWidth: number;
};

/**
 * Configures the projection so the camera's 30° vertical FOV spans the inner W×270 frame while the camera
 * renders the whole (W+2)×272 target: a view offset of −1 px on each axis widens the frustum by exactly
 * the 1 px margin without changing the ground scale.
 */
export function setCameraFrame(rig: CameraRig, internalWidth: number): void {
  rig.internalWidth = internalWidth;
  rig.camera.setViewOffset(
    internalWidth,
    INTERNAL_HEIGHT_PX,
    -RT_MARGIN_PX,
    -RT_MARGIN_PX,
    rtWidthPx(internalWidth),
    RT_HEIGHT_PX,
  );
}

/** Creates the camera looking straight down at the origin from the sweep height. */
export function createCameraRig(internalWidth: number): CameraRig {
  const camera = new PerspectiveCamera(
    CAMERA_FOV_DEG,
    internalWidth / INTERNAL_HEIGHT_PX,
    CAMERA_NEAR_M,
    CAMERA_FAR_M,
  );
  // Screen up = −Z = north, screen right = +X = east (TECHNICAL_DESIGN §4).
  camera.up.set(0, 0, -1);
  const rig: CameraRig = {
    camera,
    zoomEnabled: SPEED_ZOOM_DEFAULT,
    tiltDeg: 0,
    height: { value: SWEEP_HEIGHT_M, velocity: 0 },
    focusX: 0,
    focusZ: 0,
    snappedX: 0,
    snappedZ: 0,
    fractionX: 0,
    fractionY: 0,
    internalWidth,
  };
  setCameraFrame(rig, internalWidth);
  placeCamera(rig);
  return rig;
}

/**
 * Advances the camera by `dtS` seconds of render time: follows `focusX`/`focusZ` (metres), eases the height
 * towards the speed-zoom target for `speedMps`, then snaps XZ to the texel grid and records the remainder.
 */
export function updateCameraRig(
  rig: CameraRig,
  focusX: number,
  focusZ: number,
  speedMps: number,
  dtS: number,
): void {
  rig.focusX = focusX;
  rig.focusZ = focusZ;
  if (rig.zoomEnabled) {
    stepCriticalSpring(rig.height, zoomTargetHeightM(speedMps), ZOOM_SPRING_OMEGA_RAD_S, dtS);
  } else {
    rig.height.value = SWEEP_HEIGHT_M;
    rig.height.velocity = 0;
  }
  placeCamera(rig);
}

/**
 * Puts the camera at a fixed pose: focus (`focusX`, `focusZ`) in metres at height `heightM`, with the height
 * spring at rest. Used by the `?test=1` hook `setCamera` (src/debug/testHooks.ts), whose caller then stops
 * calling updateCameraRig so no spring moves the camera again. The height must lie in (CAMERA_NEAR_M,
 * CAMERA_FAR_M] so the ground stays inside the frustum.
 */
export function pinCameraRig(rig: CameraRig, focusX: number, focusZ: number, heightM: number): void {
  if (!Number.isFinite(focusX) || !Number.isFinite(focusZ)) {
    throw new RangeError(`camera focus must be finite, got (${focusX}, ${focusZ})`);
  }
  if (!(heightM > CAMERA_NEAR_M && heightM <= CAMERA_FAR_M)) {
    throw new RangeError(`camera height must be in (${CAMERA_NEAR_M}, ${CAMERA_FAR_M}] m, got ${heightM}`);
  }
  rig.focusX = focusX;
  rig.focusZ = focusZ;
  rig.height.value = heightM;
  rig.height.velocity = 0;
  placeCamera(rig);
}

function placeCamera(rig: CameraRig): void {
  rig.snappedX = snapToTexelM(rig.focusX);
  rig.snappedZ = snapToTexelM(rig.focusZ);
  rig.fractionX = texelRemainderPx(rig.focusX);
  rig.fractionY = texelRemainderPx(rig.focusZ);
  rig.camera.position.set(rig.snappedX, rig.height.value, rig.snappedZ);
  rig.camera.lookAt(rig.snappedX, 0, rig.snappedZ);
  rig.camera.updateMatrixWorld();
}
