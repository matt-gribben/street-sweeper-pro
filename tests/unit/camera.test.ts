import { readFileSync } from 'node:fs';
import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  CAMERA_FAR_M,
  CAMERA_FOV_DEG,
  CAMERA_NEAR_M,
  type CameraRig,
  createCameraRig,
  groundPxPerMetre,
  HEIGHT_SETTLE_M,
  LOOK_AHEAD_DEFAULT,
  LOOK_AHEAD_MAX_M,
  LOOK_AHEAD_SPRING_OMEGA_RAD_S,
  LOOK_AHEAD_TIME_S,
  lookAheadTargetM,
  pinCameraRig,
  resetCameraSprings,
  roofMagnification,
  SPEED_ZOOM_DEFAULT,
  type SpringState,
  SWEEP_HEIGHT_M,
  setCameraFrame,
  snapToTexelM,
  stepCriticalSpring,
  stepLookAhead,
  TEXEL_M,
  texelRemainderPx,
  updateCameraRig,
  ZOOM_FULL_SPEED_MPS,
  ZOOM_OUT_HEIGHT_M,
  ZOOM_SPRING_OMEGA_RAD_S,
  ZOOM_START_SPEED_MPS,
  zoomTargetHeightM,
} from '../../src/render/camera.ts';
import { RT_HEIGHT_PX, rtWidthPx } from '../../src/render/upscale.ts';
import { PX_PER_M } from '../../src/sim/constants.ts';

/** Projects a ground point through the rig's camera into render-target pixels (x right, y down). */
function toTargetPx(rig: CameraRig, x: number, y: number, z: number): { x: number; y: number } {
  const ndc = new Vector3(x, y, z).project(rig.camera);
  return {
    x: ((ndc.x + 1) / 2) * rtWidthPx(rig.internalWidth),
    y: ((1 - ndc.y) / 2) * RT_HEIGHT_PX,
  };
}

const TOLERANCE = 0.001; // 0.1%

describe('projection', () => {
  it('uses the documented frustum', () => {
    const rig = createCameraRig(480);
    expect(rig.camera.fov).toBe(CAMERA_FOV_DEG);
    expect(rig.camera.near).toBe(CAMERA_NEAR_M);
    expect(rig.camera.far).toBe(CAMERA_FAR_M);
    expect(CAMERA_FOV_DEG).toBe(30);
    expect(CAMERA_NEAR_M).toBe(1);
    expect(CAMERA_FAR_M).toBe(45);
    expect(rig.camera.position.y).toBe(31.5);
    expect(rig.tiltDeg).toBe(0);
  });

  it('maps 1 m of ground to 16 px within 0.1% at H = 31.5 m (formula)', () => {
    const pxPerM = groundPxPerMetre(SWEEP_HEIGHT_M);
    expect(Math.abs(pxPerM / PX_PER_M - 1)).toBeLessThanOrEqual(TOLERANCE);
    // The docs say "exactly"; it is really 15.995 px/m (16.881 m visible, not 16.875 m). Pin the real value so
    // a change to H or the FOV is noticed.
    expect(pxPerM).toBeCloseTo(15.995, 3);
  });

  it.each([432, 480, 640])(
    'maps 1 m of ground to 16 px within 0.1% through the real three.js camera at W = %i',
    (w) => {
      const rig = createCameraRig(w);
      for (const [dx, dz] of [
        [0, 0],
        [-12, -7],
        [12, 7],
      ] as const) {
        const a = toTargetPx(rig, dx, 0, dz);
        const east = toTargetPx(rig, dx + 1, 0, dz);
        const south = toTargetPx(rig, dx, 0, dz + 1);
        expect(Math.abs((east.x - a.x) / PX_PER_M - 1)).toBeLessThanOrEqual(TOLERANCE);
        expect(Math.abs((south.y - a.y) / PX_PER_M - 1)).toBeLessThanOrEqual(TOLERANCE);
        expect(east.y).toBeCloseTo(a.y, 9);
        expect(south.x).toBeCloseTo(a.x, 9);
      }
    },
  );

  it('puts the camera focus at the centre of the inner frame, 1 px inside the target margin', () => {
    const rig = createCameraRig(480);
    const centre = toTargetPx(rig, 0, 0, 0);
    expect(centre.x).toBeCloseTo(1 + 480 / 2, 9);
    expect(centre.y).toBeCloseTo(1 + 270 / 2, 9);
  });

  it('shows north at screen top and east at screen right, unmirrored', () => {
    const rig = createCameraRig(480);
    const centre = toTargetPx(rig, 0, 0, 0);
    const north = toTargetPx(rig, 0, 0, -1);
    const east = toTargetPx(rig, 1, 0, 0);
    expect(north.y).toBeLessThan(centre.y);
    expect(east.x).toBeGreaterThan(centre.x);
  });

  it('re-frames for a new internal width without changing the ground scale', () => {
    const rig = createCameraRig(480);
    setCameraFrame(rig, 640);
    const a = toTargetPx(rig, 0, 0, 0);
    const b = toTargetPx(rig, 1, 0, 0);
    expect(a.x).toBeCloseTo(1 + 320, 9);
    expect(Math.abs((b.x - a.x) / PX_PER_M - 1)).toBeLessThanOrEqual(TOLERANCE);
  });

  it('magnifies roofs by H / (H − h): 1.09x, 1.31x, 1.91x for 1, 3 and 6 storeys', () => {
    // Storey height from the 1/3/6-storey spike blocks: 2.5 m (one 32×40 px facade module).
    expect(roofMagnification(SWEEP_HEIGHT_M, 2.5)).toBeCloseTo(1.09, 2);
    expect(roofMagnification(SWEEP_HEIGHT_M, 7.5)).toBeCloseTo(1.31, 2);
    expect(roofMagnification(SWEEP_HEIGHT_M, 15)).toBeCloseTo(1.91, 2);
    // And the three.js camera agrees for a 6-storey roof.
    const rig = createCameraRig(480);
    const a = toTargetPx(rig, 0, 15, 0);
    const b = toTargetPx(rig, 1, 15, 0);
    expect((b.x - a.x) / groundPxPerMetre(SWEEP_HEIGHT_M)).toBeCloseTo(
      roofMagnification(SWEEP_HEIGHT_M, 15),
      6,
    );
  });
});

describe('texel snap', () => {
  it.each([0, 0.03, 1 / 16, 10.37, -3.2, -0.001, 123.456789, 4095.99])(
    'snaps %f m onto the 1/16 m grid with a remainder in [0, 1) px',
    (m) => {
      const snapped = snapToTexelM(m);
      const remainder = texelRemainderPx(m);
      expect(Number.isInteger(snapped * PX_PER_M)).toBe(true);
      expect(snapped).toBeLessThanOrEqual(m);
      expect(m - snapped).toBeLessThan(TEXEL_M);
      expect(remainder).toBeGreaterThanOrEqual(0);
      expect(remainder).toBeLessThan(1);
      expect(snapped + remainder / PX_PER_M).toBeCloseTo(m, 12);
    },
  );

  it('keeps the remainder below 1 px for a tiny negative coordinate', () => {
    // floor(-1e-20 × 16) = -1 would leave a remainder that rounds to exactly 1.0.
    expect(texelRemainderPx(-1e-20)).toBe(0);
    expect(snapToTexelM(-1e-20)).toBe(0);
    expect(texelRemainderPx(-0.001)).toBeCloseTo(0.984, 12);
    expect(snapToTexelM(-0.001)).toBe(-0.0625);
  });

  it('places the camera at the snapped XZ and records the remainders on the rig', () => {
    const rig = createCameraRig(480);
    updateCameraRig(rig, 10.37, -3.2, 0, 0, 0, 1 / 60);
    expect(rig.camera.position.x).toBe(10.3125); // 165/16
    expect(rig.camera.position.z).toBe(-3.25); // -52/16
    expect(rig.fractionX).toBeCloseTo(0.92, 9);
    expect(rig.fractionY).toBeCloseTo(0.8, 9);
    expect(rig.focusX).toBe(10.37);
    // Still looking straight down at the snapped point.
    const centre = toTargetPx(rig, 10.3125, 0, -3.25);
    expect(centre.x).toBeCloseTo(241, 9);
    expect(centre.y).toBeCloseTo(136, 9);
  });
});

describe('speed zoom', () => {
  it('targets 31.5 m at or below brush-down top speed and 37.8 m at transit top speed', () => {
    expect(zoomTargetHeightM(0)).toBe(31.5);
    expect(zoomTargetHeightM(6)).toBe(31.5);
    expect(zoomTargetHeightM(8.5)).toBeCloseTo(34.65, 9);
    expect(zoomTargetHeightM(11)).toBe(37.8);
    expect(zoomTargetHeightM(17.2)).toBe(37.8);
    expect(zoomTargetHeightM(-11)).toBe(37.8);
    expect(ZOOM_OUT_HEIGHT_M).toBe(37.8);
    expect(ZOOM_SPRING_OMEGA_RAD_S).toBe(3);
  });

  it('moves H from 31.5 toward 37.8 with no overshoot and settles within 1%', () => {
    const rig = createCameraRig(480);
    const dt = 1 / 60;
    const travel = ZOOM_OUT_HEIGHT_M - SWEEP_HEIGHT_M;
    let previous = rig.height.value;
    let within1PctOfTargetS = -1;
    let within1PctOfTravelS = -1;
    for (let frame = 1; frame <= 60 * 5; frame++) {
      updateCameraRig(rig, 0, 0, 0, 0, 11, dt);
      const h = rig.height.value;
      expect(h).toBeGreaterThanOrEqual(previous); // monotonic: never turns back
      expect(h).toBeLessThanOrEqual(ZOOM_OUT_HEIGHT_M); // never overshoots
      const error = ZOOM_OUT_HEIGHT_M - h;
      if (within1PctOfTargetS < 0 && error <= 0.01 * ZOOM_OUT_HEIGHT_M) within1PctOfTargetS = frame * dt;
      if (within1PctOfTravelS < 0 && error <= 0.01 * travel) within1PctOfTravelS = frame * dt;
      previous = h;
    }
    // Critically damped at ω = 3, the error is e0·(1 + ωt)·e^(−ωt): within 1% of the 37.8 m target after
    // about 1.5 s, and within 1% of the 6.3 m travel after about 2.2 s.
    expect(within1PctOfTargetS).toBeGreaterThan(1.3);
    expect(within1PctOfTargetS).toBeLessThan(1.6);
    expect(within1PctOfTravelS).toBeGreaterThan(2.1);
    expect(within1PctOfTravelS).toBeLessThan(2.3);
    expect(rig.height.value).toBeCloseTo(ZOOM_OUT_HEIGHT_M, 3);
    expect(rig.camera.position.y).toBe(rig.height.value);
  });

  it('eases back down to 31.5 m when the speed drops', () => {
    const rig = createCameraRig(480);
    for (let i = 0; i < 600; i++) updateCameraRig(rig, 0, 0, 0, 0, 11, 1 / 60);
    for (let i = 0; i < 600; i++) updateCameraRig(rig, 0, 0, 0, 0, 3, 1 / 60);
    expect(rig.height.value).toBeCloseTo(SWEEP_HEIGHT_M, 6);
    expect(rig.height.value).toBeGreaterThanOrEqual(SWEEP_HEIGHT_M);
  });

  it('is frame-rate independent: 30 fps and 144 fps reach the same height', () => {
    const a: SpringState = { value: 31.5, velocity: 0 };
    const b: SpringState = { value: 31.5, velocity: 0 };
    for (let i = 0; i < 30; i++) stepCriticalSpring(a, 37.8, 3, 1 / 30);
    for (let i = 0; i < 144; i++) stepCriticalSpring(b, 37.8, 3, 1 / 144);
    expect(a.value).toBeCloseTo(b.value, 9);
    expect(a.velocity).toBeCloseTo(b.velocity, 9);
  });

  it('matches the closed form (1 + ωt)·e^(−ωt) of a critically damped step', () => {
    const s: SpringState = { value: 0, velocity: 0 };
    stepCriticalSpring(s, 1, 3, 0.5);
    expect(1 - s.value).toBeCloseTo((1 + 1.5) * Math.exp(-1.5), 12);
  });

  it('ignores zero and negative dt', () => {
    const s: SpringState = { value: 31.5, velocity: 0 };
    stepCriticalSpring(s, 37.8, 3, 0);
    stepCriticalSpring(s, 37.8, 3, -1);
    expect(s.value).toBe(31.5);
  });

  it('is on by default, as ROADMAP D-01 decided and TECHNICAL_DESIGN §12.2 states (SSP-024)', () => {
    expect(SPEED_ZOOM_DEFAULT).toBe(true);
    const rig = createCameraRig(480);
    expect(rig.zoomEnabled).toBe(SPEED_ZOOM_DEFAULT);
    for (let i = 0; i < 600; i++) updateCameraRig(rig, 0, 0, 0, 0, 11, 1 / 60);
    expect(rig.height.value).toBeCloseTo(ZOOM_OUT_HEIGHT_M, 6);
    const doc = readFileSync(new URL('../../docs/TECHNICAL_DESIGN.md', import.meta.url), 'utf8');
    const row = doc.split('\n').find((line) => line.startsWith('| Speed zoom |'));
    expect(row).toContain(`default **${SPEED_ZOOM_DEFAULT ? 'On' : 'Off'}** (D-01`);
  });

  it('the flag disables it: H stays at 31.5 m at transit speed', () => {
    const rig = createCameraRig(480);
    rig.zoomEnabled = false;
    for (let i = 0; i < 300; i++) updateCameraRig(rig, 0, 0, 0, 0, 11, 1 / 60);
    expect(rig.height.value).toBe(SWEEP_HEIGHT_M);
    expect(rig.camera.position.y).toBe(SWEEP_HEIGHT_M);
  });

  it('turning the flag off mid-zoom returns H to 31.5 m at once', () => {
    const rig = createCameraRig(480);
    for (let i = 0; i < 60; i++) updateCameraRig(rig, 0, 0, 0, 0, 11, 1 / 60);
    expect(rig.height.value).toBeGreaterThan(SWEEP_HEIGHT_M);
    rig.zoomEnabled = false;
    updateCameraRig(rig, 0, 0, 0, 0, 11, 1 / 60);
    expect(rig.height.value).toBe(SWEEP_HEIGHT_M);
    expect(rig.height.velocity).toBe(0);
  });
});

describe('pinCameraRig (the ?test=1 setCamera hook, SSP-019)', () => {
  it('places the camera at the pose with the spring at rest, snapped to the texel grid', () => {
    const rig = createCameraRig(480);
    for (let i = 0; i < 30; i++) updateCameraRig(rig, 0, 0, 0, 0, 11, 1 / 60);
    expect(rig.height.velocity).not.toBe(0);
    pinCameraRig(rig, 5.03, -3, ZOOM_OUT_HEIGHT_M);
    expect(rig.focusX).toBe(5.03);
    expect(rig.focusZ).toBe(-3);
    expect(rig.height.value).toBe(ZOOM_OUT_HEIGHT_M);
    expect(rig.height.velocity).toBe(0);
    expect(rig.snappedX).toBe(5);
    expect(rig.camera.position.toArray()).toEqual([5, ZOOM_OUT_HEIGHT_M, -3]);
    expect(rig.fractionX).toBeCloseTo(0.48, 10);
  });

  it('moves the ground by exactly 16 px per metre at the sweep height', () => {
    const rig = createCameraRig(480);
    const before = toTargetPx(rig, 7.25, 0, -6.5);
    pinCameraRig(rig, 5, -3, SWEEP_HEIGHT_M);
    const after = toTargetPx(rig, 7.25, 0, -6.5);
    expect(after.x - before.x).toBeCloseTo(-80, 1);
    expect(after.y - before.y).toBeCloseTo(48, 1);
  });

  it.each([
    ['a height at the near plane', 0, 0, CAMERA_NEAR_M],
    ['a height beyond the far plane', 0, 0, CAMERA_FAR_M + 0.1],
    ['a NaN height', 0, 0, Number.NaN],
    ['an infinite focus', Number.POSITIVE_INFINITY, 0, SWEEP_HEIGHT_M],
    ['a NaN focus', 0, Number.NaN, SWEEP_HEIGHT_M],
  ])('rejects %s', (_label, x, z, h) => {
    const rig = createCameraRig(480);
    expect(() => pinCameraRig(rig, x, z, h)).toThrow(RangeError);
    expect(rig.camera.position.toArray()).toEqual([0, SWEEP_HEIGHT_M, 0]);
  });
});

/** Steps the rig `frames` frames of 1/60 s with Bessie at (x, z) moving at (vx, vz) and vLong `speed`. */
function drive(rig: CameraRig, frames: number, x: number, z: number, vx: number, vz: number, speed: number) {
  for (let i = 0; i < frames; i++) updateCameraRig(rig, x, z, vx, vz, speed, 1 / 60);
}

const leadLength = (rig: CameraRig): number => Math.hypot(rig.leadX.value, rig.leadZ.value);

describe('speed zoom target and step response (SSP-047)', () => {
  it('target H is 31.5 m at 0 and 6.0 m/s, 34.65 m at 8.5 m/s and 37.8 m at 11.0 m/s', () => {
    expect(ZOOM_START_SPEED_MPS).toBe(6.0);
    expect(ZOOM_FULL_SPEED_MPS).toBe(11.0);
    expect(zoomTargetHeightM(0)).toBe(SWEEP_HEIGHT_M);
    expect(zoomTargetHeightM(6.0)).toBe(SWEEP_HEIGHT_M);
    // OPEN in the issue, decided in SSP-047: linear in speed between 6 and 11 m/s.
    expect(zoomTargetHeightM(8.5)).toBeCloseTo(34.65, 12);
    expect(zoomTargetHeightM(11.0)).toBe(ZOOM_OUT_HEIGHT_M);
    for (const v of [0.5, 2.5, 4, 5.99, -2.5]) expect(zoomTargetHeightM(v)).toBe(SWEEP_HEIGHT_M);
    for (const v of [11.0001, 13.2, 17.2]) expect(zoomTargetHeightM(v)).toBe(ZOOM_OUT_HEIGHT_M);
  });

  it('a step 0 -> 11 m/s and back shows no overshoot either way (critically damped, omega = 3)', () => {
    const rig = createCameraRig(480);
    let previous = rig.height.value;
    for (let frame = 0; frame < 600; frame++) {
      updateCameraRig(rig, 0, 0, 0, -11, 11, 1 / 60);
      expect(rig.height.value).toBeGreaterThanOrEqual(previous);
      expect(rig.height.value).toBeLessThanOrEqual(ZOOM_OUT_HEIGHT_M);
      previous = rig.height.value;
    }
    for (let frame = 0; frame < 600; frame++) {
      updateCameraRig(rig, 0, 0, 0, -6, 6, 1 / 60);
      expect(rig.height.value).toBeLessThanOrEqual(previous);
      expect(rig.height.value).toBeGreaterThanOrEqual(SWEEP_HEIGHT_M);
      previous = rig.height.value;
    }
  });

  it('settles exactly onto 31.5 m (exact 1:1 ground) once back at or below brush-down speed', () => {
    const rig = createCameraRig(480);
    drive(rig, 300, 0, 0, 0, -11, 11);
    expect(rig.height.value).toBeGreaterThan(37);
    let settledFrame = -1;
    for (let frame = 1; frame <= 600; frame++) {
      updateCameraRig(rig, 0, 0, 0, -6, 6, 1 / 60);
      if (settledFrame < 0 && rig.height.value === SWEEP_HEIGHT_M) settledFrame = frame;
    }
    // e(t) = 6.3·(1 + 3t)·e^(−3t) drops below 0.1 mm after about 4.6 s; the settle is exact, not approximate.
    expect(settledFrame / 60).toBeGreaterThan(4);
    expect(settledFrame / 60).toBeLessThan(5.5);
    expect(rig.height.value).toBe(SWEEP_HEIGHT_M);
    expect(rig.height.velocity).toBe(0);
    expect(rig.camera.position.y).toBe(SWEEP_HEIGHT_M);
    expect(HEIGHT_SETTLE_M).toBe(1e-4);
  });

  it('never settles while the target is above the sweep height', () => {
    const rig = createCameraRig(480);
    drive(rig, 1200, 0, 0, 0, -6.01, 6.01);
    expect(rig.height.value).toBeGreaterThan(SWEEP_HEIGHT_M);
  });
});

describe('look-ahead (SSP-047)', () => {
  it('leads by |v| x 0.75 s, capped at 3.0 m: full lead from 4.0 m/s', () => {
    expect(LOOK_AHEAD_MAX_M).toBe(3.0);
    expect(LOOK_AHEAD_TIME_S).toBe(0.75);
    expect(LOOK_AHEAD_SPRING_OMEGA_RAD_S).toBe(3);
    expect(LOOK_AHEAD_DEFAULT).toBe(true);
    expect(lookAheadTargetM(0)).toBe(0);
    expect(lookAheadTargetM(2)).toBe(1.5);
    expect(lookAheadTargetM(-2)).toBe(1.5);
    expect(lookAheadTargetM(4)).toBe(3);
    expect(lookAheadTargetM(6)).toBe(3);
    expect(lookAheadTargetM(17.2)).toBe(3);
  });

  it('eases the focus ahead of Bessie along her velocity and settles 3.0 m ahead, without overshoot', () => {
    const rig = createCameraRig(480);
    expect(leadLength(rig)).toBe(0);
    let previous = 0;
    // Driving north (−z) at 6 m/s from a standing camera.
    for (let frame = 0; frame < 600; frame++) {
      updateCameraRig(rig, 10, 20, 0, -6, 6, 1 / 60);
      const lead = -rig.leadZ.value;
      expect(lead).toBeGreaterThanOrEqual(previous);
      expect(lead).toBeLessThanOrEqual(LOOK_AHEAD_MAX_M);
      expect(rig.leadX.value).toBe(0);
      previous = lead;
    }
    expect(rig.leadZ.value).toBeCloseTo(-3, 6);
    expect(rig.focusX).toBe(10);
    expect(rig.focusZ).toBeCloseTo(17, 6);
    // The snapped camera follows the focus, not Bessie.
    expect(rig.camera.position.z).toBe(snapToTexelM(rig.focusZ));
    expect(rig.camera.position.x).toBe(10);
  });

  it('matches the critically damped closed form per axis, (1 + wt)e^(-wt), for a step', () => {
    const rig = createCameraRig(480);
    updateCameraRig(rig, 0, 0, 8, 0, 8, 0.5);
    const expected = 3 * (1 - (1 + 1.5) * Math.exp(-1.5));
    expect(rig.leadX.value).toBeCloseTo(expected, 12);
    expect(rig.leadZ.value).toBe(0);
  });

  it('leads along the velocity, not the heading: diagonal travel leads diagonally', () => {
    const rig = createCameraRig(480);
    drive(rig, 600, 0, 0, 3, -3, 0); // 4.24 m/s north-east
    expect(rig.leadX.value).toBeCloseTo(3 / Math.SQRT2, 6);
    expect(rig.leadZ.value).toBeCloseTo(-3 / Math.SQRT2, 6);
    expect(leadLength(rig)).toBeCloseTo(3, 6);
  });

  it('shrinks in proportion at low speed and returns to the subject when she stops', () => {
    const rig = createCameraRig(480);
    drive(rig, 600, 0, 0, 2, 0, 2);
    expect(rig.leadX.value).toBeCloseTo(1.5, 6);
    drive(rig, 600, 0, 0, 0, 0, 0);
    expect(rig.leadX.value).toBeCloseTo(0, 6);
    expect(rig.focusX).toBeCloseTo(0, 6);
  });

  it('never exceeds 3.0 m, even when the velocity reverses or spins every frame', () => {
    const rig = createCameraRig(480);
    let max = 0;
    for (let frame = 0; frame < 1200; frame++) {
      const angle = frame * 0.9; // a velocity direction that whips round faster than the spring can follow
      updateCameraRig(rig, 0, 0, 17.2 * Math.cos(angle), 17.2 * Math.sin(angle), 17.2, 1 / 60);
      max = Math.max(max, leadLength(rig));
      if (frame % 97 === 0) drive(rig, 30, 0, 0, frame % 2 === 0 ? 17.2 : -17.2, 0, 17.2);
      max = Math.max(max, leadLength(rig));
    }
    expect(max).toBeLessThanOrEqual(LOOK_AHEAD_MAX_M);
  });

  it('clamps a swung-out offset onto the 3.0 m circle and drops its outward velocity', () => {
    const rig = createCameraRig(480);
    rig.leadX.value = 2.9;
    rig.leadX.velocity = 40;
    rig.leadZ.velocity = 5;
    stepLookAhead(rig, 6, 0, 1 / 60);
    expect(leadLength(rig)).toBeLessThanOrEqual(LOOK_AHEAD_MAX_M);
    expect(leadLength(rig)).toBeCloseTo(LOOK_AHEAD_MAX_M, 12);
    const radial = (rig.leadX.velocity * rig.leadX.value + rig.leadZ.velocity * rig.leadZ.value) / 3;
    expect(radial).toBeLessThanOrEqual(1e-9);
  });

  it('is frame-rate independent: 30 fps and 144 fps reach the same offset', () => {
    const a = createCameraRig(480);
    const b = createCameraRig(480);
    for (let i = 0; i < 30; i++) updateCameraRig(a, 0, 0, 1.5, -2, 2.5, 1 / 30);
    for (let i = 0; i < 144; i++) updateCameraRig(b, 0, 0, 1.5, -2, 2.5, 1 / 144);
    expect(a.leadX.value).toBeCloseTo(b.leadX.value, 9);
    expect(a.leadZ.value).toBeCloseTo(b.leadZ.value, 9);
  });

  it('does not spring with dt = 0 (placement before the first frame)', () => {
    const rig = createCameraRig(480);
    updateCameraRig(rig, 7, 89, 0, -11, 11, 0);
    expect(leadLength(rig)).toBe(0);
    expect(rig.height.value).toBe(SWEEP_HEIGHT_M);
    expect(rig.focusX).toBe(7);
    expect(rig.focusZ).toBe(89);
  });

  it('turned off, the focus is the subject and the offset is cleared at once', () => {
    const rig = createCameraRig(480);
    drive(rig, 60, 0, 0, 0, -6, 6);
    expect(leadLength(rig)).toBeGreaterThan(1);
    rig.lookAheadEnabled = false;
    updateCameraRig(rig, 4.03, -2, 0, -6, 6, 1 / 60);
    expect(rig.leadX.value).toBe(0);
    expect(rig.leadZ.value).toBe(0);
    expect(rig.leadZ.velocity).toBe(0);
    expect(rig.focusX).toBe(4.03);
    expect(rig.focusZ).toBe(-2);
    // Speed zoom is independent of it.
    drive(rig, 600, 0, 0, 0, -11, 11);
    expect(rig.height.value).toBeCloseTo(ZOOM_OUT_HEIGHT_M, 6);
  });

  it('with D-01 = off, H stays at 31.5 m at every speed and look-ahead still works', () => {
    const rig = createCameraRig(480);
    rig.zoomEnabled = false;
    for (const speed of [0, 3, 6, 8.5, 11, 17.2]) {
      drive(rig, 120, 0, 0, 0, -speed, speed);
      expect(rig.height.value).toBe(SWEEP_HEIGHT_M);
      expect(rig.camera.position.y).toBe(SWEEP_HEIGHT_M);
    }
    expect(rig.leadZ.value).toBeCloseTo(-3, 3);
  });

  it('pinning clears it, and resetCameraSprings puts every spring at rest', () => {
    const rig = createCameraRig(480);
    drive(rig, 120, 0, 0, 0, -11, 11);
    pinCameraRig(rig, 5, -3, SWEEP_HEIGHT_M);
    expect(leadLength(rig)).toBe(0);
    expect(rig.focusX).toBe(5);
    drive(rig, 120, 0, 0, 0, -11, 11);
    expect(leadLength(rig)).toBeGreaterThan(0);
    expect(rig.height.value).toBeGreaterThan(SWEEP_HEIGHT_M);
    resetCameraSprings(rig);
    expect([rig.leadX.value, rig.leadX.velocity, rig.leadZ.value, rig.leadZ.velocity]).toEqual([0, 0, 0, 0]);
    expect(rig.height.value).toBe(SWEEP_HEIGHT_M);
    expect(rig.height.velocity).toBe(0);
  });

  it('keeps the snap: the camera sits on the 1/16 m grid with the remainder in [0, 1) px', () => {
    const rig = createCameraRig(480);
    for (let frame = 0; frame < 300; frame++) {
      updateCameraRig(rig, 7 + frame * 0.1003, 89 - frame * 0.0711, 6.018, -4.266, 6, 1 / 60);
      expect(Number.isInteger(rig.camera.position.x * PX_PER_M)).toBe(true);
      expect(Number.isInteger(rig.camera.position.z * PX_PER_M)).toBe(true);
      expect(rig.fractionX).toBeGreaterThanOrEqual(0);
      expect(rig.fractionX).toBeLessThan(1);
      expect(rig.fractionY).toBeGreaterThanOrEqual(0);
      expect(rig.fractionY).toBeLessThan(1);
      // At or below brush-down speed the height never leaves 31.5 m: 1 texel = 1 px throughout.
      expect(rig.camera.position.y).toBe(SWEEP_HEIGHT_M);
    }
  });
});
