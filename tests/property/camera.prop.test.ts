import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  createCameraRig,
  LOOK_AHEAD_MAX_M,
  lookAheadTargetM,
  type SpringState,
  snapToTexelM,
  stepCriticalSpring,
  TEXEL_M,
  texelRemainderPx,
  updateCameraRig,
  ZOOM_OUT_HEIGHT_M,
  ZOOM_SPRING_OMEGA_RAD_S,
  zoomTargetHeightM,
} from '../../src/render/camera.ts';
import { PX_PER_M } from '../../src/sim/constants.ts';

// Districts are at most a few hundred metres across; 10 km leaves a wide margin.
const worldM = fc.double({ min: -10_000, max: 10_000, noNaN: true, noDefaultInfinity: true });

describe('texel snap properties', () => {
  it('snapped XZ lies on the 1/16 m grid, within one texel below the input', () => {
    fc.assert(
      fc.property(worldM, (m) => {
        const snapped = snapToTexelM(m);
        expect(Number.isInteger(snapped * PX_PER_M)).toBe(true);
        // A one-rounding tolerance covers the tiny negative inputs that are counted in the texel above.
        expect(snapped).toBeLessThanOrEqual(m + 1e-12);
        expect(m - snapped).toBeLessThan(TEXEL_M);
      }),
    );
  });

  it('the remainder is in [0, 1) internal px and reconstructs the input', () => {
    fc.assert(
      fc.property(worldM, (m) => {
        const remainder = texelRemainderPx(m);
        expect(remainder).toBeGreaterThanOrEqual(0);
        expect(remainder).toBeLessThan(1);
        expect(Math.abs(snapToTexelM(m) + remainder / PX_PER_M - m)).toBeLessThanOrEqual(1e-9);
      }),
    );
  });

  it('reconstruction is bit-exact on the district side of the origin (m >= 0)', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 10_000, noNaN: true }), (m) => {
        expect(snapToTexelM(m) + texelRemainderPx(m) / PX_PER_M === m).toBe(true);
      }),
    );
  });
});

describe('speed zoom spring properties', () => {
  const dts = fc.array(fc.double({ min: 1 / 240, max: 0.1, noNaN: true }), { minLength: 1, maxLength: 400 });

  it('from rest, H never overshoots or turns back for any frame-time sequence', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 20, noNaN: true }), dts, (speed, frameTimes) => {
        const target = zoomTargetHeightM(speed);
        const s: SpringState = { value: 31.5, velocity: 0 };
        let previous = s.value;
        for (const dt of frameTimes) {
          stepCriticalSpring(s, target, ZOOM_SPRING_OMEGA_RAD_S, dt);
          expect(s.value).toBeGreaterThanOrEqual(previous - 1e-12);
          expect(s.value).toBeLessThanOrEqual(target + 1e-12);
          previous = s.value;
        }
      }),
    );
  });

  it('the target height is always within [31.5, 37.8] m and non-decreasing in speed', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 50, noNaN: true }),
        fc.double({ min: 0, max: 50, noNaN: true }),
        (a, b) => {
          const [lo, hi] = a <= b ? [a, b] : [b, a];
          expect(zoomTargetHeightM(lo)).toBeGreaterThanOrEqual(31.5);
          expect(zoomTargetHeightM(hi)).toBeLessThanOrEqual(ZOOM_OUT_HEIGHT_M);
          expect(zoomTargetHeightM(lo)).toBeLessThanOrEqual(zoomTargetHeightM(hi));
        },
      ),
    );
  });
});

describe('look-ahead properties (SSP-047)', () => {
  // Up to the real maximum speed (transit 11 m/s × Bacon Butty 1.3 × Engine L2 1.2 = 17.2 m/s), either way.
  const velocity = fc.double({ min: -17.2, max: 17.2, noNaN: true });
  const dt = fc.double({ min: 1 / 240, max: 0.25, noNaN: true });
  const frame = fc.record({ vx: velocity, vz: velocity, dtS: dt });

  it('the offset never exceeds 3.0 m for any velocity and frame-time sequence', () => {
    fc.assert(
      fc.property(fc.array(frame, { minLength: 1, maxLength: 300 }), (frames) => {
        const rig = createCameraRig(480);
        for (const { vx, vz, dtS } of frames) {
          updateCameraRig(rig, 0, 0, vx, vz, Math.hypot(vx, vz), dtS);
          expect(Math.hypot(rig.leadX.value, rig.leadZ.value)).toBeLessThanOrEqual(LOOK_AHEAD_MAX_M);
          // The focus is the subject (here the origin) plus the offset.
          expect(Math.hypot(rig.focusX, rig.focusZ)).toBeLessThanOrEqual(LOOK_AHEAD_MAX_M);
        }
      }),
    );
  });

  it('from rest, a constant velocity is approached monotonically on each axis and never overshot', () => {
    fc.assert(
      fc.property(
        velocity,
        velocity,
        fc.array(dt, { minLength: 1, maxLength: 200 }),
        (vx, vz, frameTimes) => {
          const rig = createCameraRig(480);
          const speed = Math.hypot(vx, vz);
          const scale = speed > 0 ? lookAheadTargetM(speed) / speed : 0;
          const target = [vx * scale, vz * scale] as const;
          let previous = [0, 0];
          for (const dtS of frameTimes) {
            updateCameraRig(rig, 0, 0, vx, vz, speed, dtS);
            const now = [rig.leadX.value, rig.leadZ.value];
            for (let axis = 0; axis < 2; axis++) {
              const t = target[axis] ?? 0;
              const before = t - (previous[axis] ?? 0);
              const after = t - (now[axis] ?? 0);
              // Closer to the target than last frame, and still on the near side of it.
              expect(Math.abs(after)).toBeLessThanOrEqual(Math.abs(before) + 1e-12);
              expect(after * before).toBeGreaterThanOrEqual(-1e-24);
            }
            previous = now;
          }
        },
      ),
    );
  });
});
