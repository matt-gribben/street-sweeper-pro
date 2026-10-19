// world.viewRect (SSP-080, TECHNICAL_DESIGN §7.4): the sim's deterministic proxy for the view. Its numbers are
// tied here to the render camera's (which the sim may not import) and to the widest view, and the World keeps
// it on Bessie plus her look-ahead from sim state.
import { describe, expect, it } from 'vitest';
import {
  CAMERA_FOV_DEG,
  LOOK_AHEAD_MAX_M,
  LOOK_AHEAD_TIME_S,
  ZOOM_OUT_HEIGHT_M,
} from '../../src/render/camera.ts';
import { PX_PER_M } from '../../src/sim/constants.ts';
import { createInputFrame, THROTTLE_MAX } from '../../src/sim/inputFrame.ts';
import { createBlankLevel } from '../../src/sim/map.ts';
import { DEFAULT_TUNING } from '../../src/sim/tuning.ts';
import { createVehicleState } from '../../src/sim/vehicle.ts';
import {
  circleTouchesViewRect,
  createViewRect,
  updateViewRect,
  VIEW_HALF_HEIGHT_M,
  VIEW_HALF_WIDTH_M,
  VIEW_LOOK_AHEAD_MAX_M,
  VIEW_LOOK_AHEAD_S,
} from '../../src/sim/viewRect.ts';
import { createWorld } from '../../src/sim/world.ts';

describe('viewRect', () => {
  it('uses the camera look-ahead and covers the widest view plus the 4 m margin', () => {
    expect(VIEW_LOOK_AHEAD_S).toBe(LOOK_AHEAD_TIME_S);
    expect(VIEW_LOOK_AHEAD_MAX_M).toBe(LOOK_AHEAD_MAX_M);
    // The widest view: W = 640 internal px at the zoomed-out height (TECHNICAL_DESIGN §7.4, §12.1).
    const halfHM = ZOOM_OUT_HEIGHT_M * Math.tan(((CAMERA_FOV_DEG / 2) * Math.PI) / 180);
    const halfWM = halfHM * (640 / 270);
    expect(halfWM).toBeCloseTo(24.0, 0);
    expect(halfHM).toBeCloseTo(10.13, 2);
    expect(VIEW_HALF_WIDTH_M).toBe(24 + 4);
    expect(VIEW_HALF_HEIGHT_M).toBe(10.2 + 4);
    expect(VIEW_HALF_WIDTH_M - 4).toBeGreaterThanOrEqual(halfWM - 1 / PX_PER_M);
    expect(VIEW_HALF_HEIGHT_M - 4).toBeGreaterThanOrEqual(halfHM);
  });

  it('is centred on a parked sweeper and leads a moving one by velocity × 0.75 s, capped at 3.0 m', () => {
    const v = createVehicleState(DEFAULT_TUNING.vehicle.sweeper, 40, 30, 0);
    const rect = createViewRect(v);
    expect(rect).toEqual({ focusX: 40, focusY: 30, minX: 12, minY: 15.8, maxX: 68, maxY: 44.2 });
    v.vLongMps = 2; // north at 2 m/s: 1.5 m ahead
    updateViewRect(rect, v);
    expect(rect.focusX).toBeCloseTo(40, 12);
    expect(rect.focusY).toBeCloseTo(28.5, 12);
    v.headingRad = Math.PI / 2; // east at 10 m/s: capped at 3.0 m
    v.vLongMps = 10;
    updateViewRect(rect, v);
    expect(rect.focusX).toBeCloseTo(43, 12);
    expect(rect.focusY).toBeCloseTo(30, 12);
    expect(rect.maxX - rect.minX).toBeCloseTo(56, 12);
    v.vLongMps = 0; // sliding sideways (vLat) still leads: right of east is south
    v.vLatMps = 2;
    updateViewRect(rect, v);
    expect(rect.focusX).toBeCloseTo(40, 12);
    expect(rect.focusY).toBeCloseTo(31.5, 12);
  });

  it('tests a circle against the rect, touching included', () => {
    const v = createVehicleState(DEFAULT_TUNING.vehicle.sweeper, 40, 30, 0);
    const rect = createViewRect(v); // x 12..68, y 15.8..44.2
    const xs = new Float64Array([40, 68.25, 68.31, 11.75, 70, 69]);
    const ys = new Float64Array([30, 30, 30, 15.8, 46, 45]);
    const r = new Float64Array([0.3]);
    const got = [...xs].map((_, i) => circleTouchesViewRect(rect, xs, ys, i, r, 0));
    expect(got).toEqual([true, true, false, true, false, false]);
  });

  it('follows Bessie in the World: updated in phase 7 from her pose after the tick moved her', () => {
    const level = createBlankLevel('test.view_rect', 60, 60);
    level.player = { x: 60, y: 60, heading: 0 };
    const world = createWorld(level, 1, DEFAULT_TUNING);
    expect(world.viewRect.focusX).toBe(60);
    expect(world.viewRect.focusY).toBe(60);
    const input = createInputFrame();
    input.throttle = THROTTLE_MAX;
    for (let t = 0; t < 120; t++) world.step(input);
    const v = world.vehicle;
    const lead = Math.min(3, v.vLongMps * 0.75);
    expect(world.viewRect.focusY).toBeCloseTo(v.yM - lead, 6);
    expect(world.viewRect.focusX).toBeCloseTo(v.xM, 6);
    expect(world.viewRect.minY).toBeCloseTo(v.yM - lead - 14.2, 6);
  });
});
