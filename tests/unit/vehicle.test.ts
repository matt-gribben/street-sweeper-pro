// Bessie's kinematic bicycle model (src/sim/vehicle.ts, SSP-030; TECHNICAL_DESIGN §8.2 and §18.1). Proves the
// M1 handling numbers from tuning.json / GDD §7: top speeds, brake, reverse, turning circles, the hopper hook,
// steer rates, lateral grip decay, drag in reverse, determinism and zero allocation per tick.
import { describe, expect, it } from 'vitest';
import tuningJson from '../../src/data/tuning.json' with { type: 'json' };
import { DEG_TO_RAD, DT_S, SIM_HZ } from '../../src/sim/constants.ts';
import {
  BRAKE_MAX,
  createInputFrame,
  type InputFrame,
  PRESSED,
  STEER_MAX,
  THROTTLE_MAX,
} from '../../src/sim/inputFrame.ts';
import { nextInt, sfc32 } from '../../src/sim/rng.ts';
import { DEFAULT_TUNING, loadTuning, type SweeperTuning } from '../../src/sim/tuning.ts';
import {
  computeHandling,
  createVehicleHandling,
  createVehicleParams,
  createVehicleState,
  Gear,
  rearAxlePosition,
  reverseEngageTicks,
  stepVehicle,
  type VehicleParams,
  type VehicleState,
  type VehicleSurface,
} from '../../src/sim/vehicle.ts';
import { assertHeapDeltaWithinThresholds, measureHeapDelta } from '../support/heapDelta.ts';

const sweeper = DEFAULT_TUNING.vehicle.sweeper;
/** GDD §8.4 base hopper capacity (tuning.json hopper.capacityLu since SSP-053/SSP-058). */
const BASE_HOPPER_LU = DEFAULT_TUNING.hopper.capacityLu;
const ASPHALT: VehicleSurface = { gripPerS: sweeper.lateralGripPerS.asphalt, rollMult: 1 };

function newBessie(tuning: SweeperTuning = sweeper): { state: VehicleState; params: VehicleParams } {
  return {
    state: createVehicleState(tuning, 0, 0, 0),
    params: createVehicleParams(tuning, BASE_HOPPER_LU),
  };
}

function frame(throttle: number, brake: number, steer: number, pressed = 0): InputFrame {
  const input = createInputFrame();
  input.throttle = throttle;
  input.brake = brake;
  input.steer = steer;
  input.pressed = pressed;
  return input;
}

const NEUTRAL = frame(0, 0, 0);
const FULL_THROTTLE = frame(THROTTLE_MAX, 0, 0);
const FULL_BRAKE = frame(0, BRAKE_MAX, 0);

/** Drag deceleration on asphalt at speed v, m/s² (TECHNICAL_DESIGN §8.2 step 5). */
function dragMps2(tuning: SweeperTuning, vMps: number): number {
  return tuning.drag.rollingMps2 + tuning.drag.quadraticPerM * vMps * vMps;
}

/** A copy of the committed tuning with both drag terms zeroed, to isolate brake and reverse terms. */
function tuningWithNoDrag(): SweeperTuning {
  const raw = structuredClone(tuningJson);
  raw.vehicle.sweeper.drag.rollingMps2 = 0;
  raw.vehicle.sweeper.drag.quadraticPerM = 0;
  return loadTuning(raw).vehicle.sweeper;
}

describe('createVehicleState', () => {
  it('spawns stationary in FWD with the brush up, full HP and an empty hopper', () => {
    const s = createVehicleState(sweeper, 10, 20, 1.5);
    expect([s.xM, s.yM, s.headingRad]).toEqual([10, 20, 1.5]);
    expect([s.prevXM, s.prevYM, s.prevHeadingRad]).toEqual([10, 20, 1.5]);
    expect(s.vLongMps).toBe(0);
    expect(s.vLatMps).toBe(0);
    expect(s.steerRad).toBe(0);
    expect(s.gear).toBe(Gear.Fwd);
    expect(s.brushDown).toBe(false);
    expect([s.brushPos, s.rpm, s.hopperLU, s.water]).toEqual([0, 0, 0, 0]);
    expect(s.hp).toBe(sweeper.health.maxHp);
    expect(s.massKg).toBe(sweeper.mass.emptyKg);
  });

  it('rejects a non-positive hopper capacity', () => {
    expect(() => createVehicleParams(sweeper, 0)).toThrow(/hopperCapacityLU/);
  });
});

describe('brush toggle and prev copies', () => {
  it('toggles brushDown on each BRUSH pressed edge only', () => {
    const { state, params } = newBessie();
    stepVehicle(state, frame(0, 0, 0, PRESSED.BRUSH), ASPHALT, params);
    expect(state.brushDown).toBe(true);
    stepVehicle(state, NEUTRAL, ASPHALT, params);
    expect(state.brushDown).toBe(true);
    stepVehicle(state, frame(0, 0, 0, PRESSED.BRUSH), ASPHALT, params);
    expect(state.brushDown).toBe(false);
  });

  it('copies x, y and heading into prev* at the start of each tick', () => {
    const { state, params } = newBessie();
    for (let i = 0; i < 120; i++) stepVehicle(state, frame(THROTTLE_MAX, 0, STEER_MAX), ASPHALT, params);
    const before = [state.xM, state.yM, state.headingRad];
    stepVehicle(state, frame(THROTTLE_MAX, 0, STEER_MAX), ASPHALT, params);
    expect([state.prevXM, state.prevYM, state.prevHeadingRad]).toEqual(before);
    expect(state.xM).not.toBe(before[0]);
  });

  it('heading 0 drives north (−y) along the forward vector', () => {
    const { state, params } = newBessie();
    for (let i = 0; i < 60; i++) stepVehicle(state, FULL_THROTTLE, ASPHALT, params);
    expect(state.xM).toBe(0);
    expect(state.yM).toBeLessThan(-1);
  });
});

describe('top speeds (TECHNICAL_DESIGN §18.1, GDD §7.1)', () => {
  // Drag is applied after the throttle clamp, so the end-of-tick speed settles at vTop − drag(vTop)·DT
  // (6.0 − 0.012, 11.0 − 0.029), never above vTop (SSP-030).
  it('brush down: never exceeds 6.0 m/s over 30 s, and is ≥ 5.95 m/s after 10 s', () => {
    const { state, params } = newBessie();
    state.brushDown = true;
    let maxV = 0;
    for (let tick = 1; tick <= 30 * SIM_HZ; tick++) {
      stepVehicle(state, FULL_THROTTLE, ASPHALT, params);
      maxV = Math.max(maxV, state.vLongMps);
      if (tick === 10 * SIM_HZ) expect(state.vLongMps).toBeGreaterThanOrEqual(5.95);
    }
    expect(maxV).toBeLessThanOrEqual(6.0);
    expect(state.vLongMps).toBeCloseTo(6.0 - dragMps2(sweeper, 6.0) * DT_S, 9);
  });

  it('transit: never exceeds 11.0 m/s, and is ≥ 10.95 m/s after 20 s', () => {
    const { state, params } = newBessie();
    let maxV = 0;
    for (let tick = 1; tick <= 30 * SIM_HZ; tick++) {
      stepVehicle(state, FULL_THROTTLE, ASPHALT, params);
      maxV = Math.max(maxV, state.vLongMps);
      if (tick === 20 * SIM_HZ) expect(state.vLongMps).toBeGreaterThanOrEqual(10.95);
    }
    expect(maxV).toBeLessThanOrEqual(11.0);
    expect(state.vLongMps).toBeCloseTo(11.0 - dragMps2(sweeper, 11.0) * DT_S, 9);
  });

  it('topSpeedMult scales the cap (Bacon Butty hook, ×1.3 → 14.3 m/s; drag zeroed to expose the cap)', () => {
    // With default drag the engine cannot reach 14.3 m/s: 2.4 = 0.3 + 0.012·v² gives a drag-limited
    // terminal speed of √175 ≈ 13.2 m/s (flagged in SSP-030). The cap itself is what this hook sets.
    const { state, params } = newBessie(tuningWithNoDrag());
    params.topSpeedMult = 1.3;
    let maxV = 0;
    for (let tick = 0; tick < 30 * SIM_HZ; tick++) {
      stepVehicle(state, FULL_THROTTLE, ASPHALT, params);
      maxV = Math.max(maxV, state.vLongMps);
    }
    expect(maxV).toBeCloseTo(11.0 * 1.3, 12);
    expect(maxV).toBeLessThanOrEqual(11.0 * 1.3);
  });

  it('with default drag, full throttle tops out at the drag-limited speed when the cap is above it', () => {
    const { state, params } = newBessie();
    params.topSpeedMult = 1.3;
    for (let tick = 0; tick < 60 * SIM_HZ; tick++) stepVehicle(state, FULL_THROTTLE, ASPHALT, params);
    expect(state.vLongMps).toBeCloseTo(Math.sqrt((2.4 - 0.3) / 0.012), 1);
  });

  it('lowering the brush above 6 m/s stops the engine pushing; drag bleeds the excess off, never a snap', () => {
    const { state, params } = newBessie();
    for (let tick = 0; tick < 20 * SIM_HZ; tick++) stepVehicle(state, FULL_THROTTLE, ASPHALT, params);
    const before = state.vLongMps;
    stepVehicle(state, frame(THROTTLE_MAX, 0, 0, PRESSED.BRUSH), ASPHALT, params);
    expect(state.brushDown).toBe(true);
    expect(state.vLongMps).toBeCloseTo(before - dragMps2(sweeper, before) * DT_S, 12);
    for (let tick = 0; tick < 10 * SIM_HZ; tick++) stepVehicle(state, FULL_THROTTLE, ASPHALT, params);
    expect(state.vLongMps).toBeLessThanOrEqual(6.0);
  });
});

describe('brake (GDD §7.1: 6.0 m/s²)', () => {
  it('the brake term alone decelerates at exactly 6.0 m/s² (drag zeroed in a tuning copy)', () => {
    const { state, params } = newBessie(tuningWithNoDrag());
    state.vLongMps = 11;
    let ticks = 0;
    while (state.vLongMps > 0) {
      const v0 = state.vLongMps;
      stepVehicle(state, FULL_BRAKE, ASPHALT, params);
      ticks++;
      if (state.vLongMps > 0) expect((v0 - state.vLongMps) / DT_S).toBeCloseTo(6.0, 9);
    }
    // 11 m/s at 6.0 m/s² stops in 1.83 s (GDD §7.2): 110 ticks of 0.1 m/s, plus at most one tick for the
    // floating-point remainder of 110 subtractions.
    expect(ticks).toBeGreaterThanOrEqual(110);
    expect(ticks).toBeLessThanOrEqual(111);
  });

  it('with default drag, measured deceleration is 6.0 m/s² plus the documented drag allowance', () => {
    // Drag allowance: a = 6.0 + (0.3 + 0.012·v²), v taken after the brake term in the same tick.
    const { state, params } = newBessie();
    state.vLongMps = 11;
    while (state.vLongMps > 0.5) {
      const v0 = state.vLongMps;
      stepVehicle(state, FULL_BRAKE, ASPHALT, params);
      const vAfterBrake = v0 - 6.0 * DT_S;
      expect((v0 - state.vLongMps) / DT_S).toBeCloseTo(6.0 + dragMps2(sweeper, vAfterBrake), 9);
    }
  });

  it('half brake brakes at half rate (analogue trigger)', () => {
    const { state, params } = newBessie(tuningWithNoDrag());
    state.vLongMps = 5;
    stepVehicle(state, frame(0, 255 / 2, 0), ASPHALT, params);
    expect((5 - state.vLongMps) / DT_S).toBeCloseTo(3.0, 9);
  });
});

describe('reverse (GDD §6.2, §7.1)', () => {
  it('engage threshold is 0.25 s = 15 ticks', () => {
    expect(reverseEngageTicks(sweeper)).toBe(15);
  });

  it('from standstill, engages REV on exactly the 15th tick of held brake and flags it once', () => {
    const { state, params } = newBessie();
    const flags: number[] = [];
    for (let tick = 1; tick <= 30; tick++) {
      stepVehicle(state, FULL_BRAKE, ASPHALT, params);
      if (tick < 15) expect(state.gear).toBe(Gear.Fwd);
      if (tick < 15) expect(state.vLongMps).toBe(0);
      if (state.reverseEngaged) flags.push(tick);
    }
    expect(flags).toEqual([15]);
    expect(state.gear).toBe(Gear.Rev);
    expect(state.vLongMps).toBeLessThan(0);
  });

  it('braking from speed only starts the hold once below 0.2 m/s', () => {
    const { state, params } = newBessie();
    state.vLongMps = 3;
    let firstSlowTick = -1;
    let engageTick = -1;
    for (let tick = 1; tick <= 120 && engageTick < 0; tick++) {
      stepVehicle(state, FULL_BRAKE, ASPHALT, params);
      if (firstSlowTick < 0 && Math.abs(state.vLongMps) < sweeper.reverse.engageBelowMps)
        firstSlowTick = tick;
      if (state.reverseEngaged) engageTick = tick;
    }
    expect(firstSlowTick).toBeGreaterThan(1);
    expect(engageTick - firstSlowTick + 1).toBe(15);
  });

  it('releasing the brake resets the hold', () => {
    const { state, params } = newBessie();
    for (let i = 0; i < 14; i++) stepVehicle(state, FULL_BRAKE, ASPHALT, params);
    stepVehicle(state, NEUTRAL, ASPHALT, params);
    for (let i = 0; i < 14; i++) stepVehicle(state, FULL_BRAKE, ASPHALT, params);
    expect(state.gear).toBe(Gear.Fwd);
    stepVehicle(state, FULL_BRAKE, ASPHALT, params);
    expect(state.gear).toBe(Gear.Rev);
  });

  it('does not engage while held above 0.2 m/s', () => {
    const { state, params } = newBessie();
    for (let i = 0; i < 60; i++) {
      state.vLongMps = 0.5;
      stepVehicle(state, frame(0, 1, 0), ASPHALT, params);
    }
    expect(state.gear).toBe(Gear.Fwd);
  });

  it('reverse speed never exceeds 2.5 m/s and settles at the cap less drag', () => {
    const { state, params } = newBessie();
    let maxRev = 0;
    for (let tick = 0; tick < 20 * SIM_HZ; tick++) {
      stepVehicle(state, FULL_BRAKE, ASPHALT, params);
      maxRev = Math.max(maxRev, -state.vLongMps);
    }
    expect(state.gear).toBe(Gear.Rev);
    expect(maxRev).toBeLessThanOrEqual(2.5);
    expect(-state.vLongMps).toBeCloseTo(2.5 - dragMps2(sweeper, 2.5) * DT_S, 9);
  });

  it('reverse accelerates at 1.5 m/s² (drag zeroed)', () => {
    const { state, params } = newBessie(tuningWithNoDrag());
    for (let i = 0; i < 15; i++) stepVehicle(state, FULL_BRAKE, ASPHALT, params);
    expect(state.gear).toBe(Gear.Rev);
    const v0 = state.vLongMps;
    stepVehicle(state, FULL_BRAKE, ASPHALT, params);
    expect((v0 - state.vLongMps) / DT_S).toBeCloseTo(1.5, 9);
  });

  it('in REV, throttle brakes, then returns to FWD at standstill and drives forward', () => {
    const { state, params } = newBessie();
    for (let i = 0; i < 5 * SIM_HZ; i++) stepVehicle(state, FULL_BRAKE, ASPHALT, params);
    expect(state.vLongMps).toBeLessThan(-2);
    const v0 = state.vLongMps;
    stepVehicle(state, FULL_THROTTLE, ASPHALT, params);
    expect(state.gear).toBe(Gear.Rev);
    expect(state.vLongMps).toBeGreaterThan(v0);
    for (let i = 0; i < 2 * SIM_HZ; i++) stepVehicle(state, FULL_THROTTLE, ASPHALT, params);
    expect(state.gear).toBe(Gear.Fwd);
    expect(state.vLongMps).toBeGreaterThan(1);
  });

  it('coasting in REV, drag only reduces |vLong| and never flips its sign', () => {
    const { state, params } = newBessie();
    state.gear = Gear.Rev;
    state.vLongMps = -2.5;
    let prevAbs = 2.5;
    for (let tick = 0; tick < 30 * SIM_HZ; tick++) {
      stepVehicle(state, NEUTRAL, ASPHALT, params);
      expect(state.vLongMps).toBeLessThanOrEqual(0);
      expect(Math.abs(state.vLongMps)).toBeLessThanOrEqual(prevAbs);
      prevAbs = Math.abs(state.vLongMps);
    }
    expect(state.vLongMps === 0).toBe(true);
    expect(state.gear).toBe(Gear.Rev);
  });

  it('on grass (rollMult 2.5), drag still never flips the sign', () => {
    const { state, params } = newBessie();
    state.gear = Gear.Rev;
    state.vLongMps = -0.004;
    const grass: VehicleSurface = { gripPerS: sweeper.lateralGripPerS.grass, rollMult: 2.5 };
    stepVehicle(state, NEUTRAL, grass, params);
    expect(state.vLongMps === 0).toBe(true);
    state.vLongMps = 1;
    stepVehicle(state, NEUTRAL, grass, params);
    expect(1 - state.vLongMps).toBeCloseTo((0.3 * 2.5 + 0.012) * DT_S, 12);
  });
});

describe('turning circle (TECHNICAL_DESIGN §18.1)', () => {
  /** Diameter of the rear-axle path at a held speed, full right lock, steer settled. */
  function turningDiameterM(vMps: number): number {
    const { state, params } = newBessie();
    const input = frame(0, 0, STEER_MAX);
    for (let i = 0; i < 60; i++) {
      state.vLongMps = vMps;
      stepVehicle(state, input, ASPHALT, params);
    }
    const rear = { x: 0, y: 0 };
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    const startHeading = state.headingRad;
    while (state.headingRad - startHeading < 2 * Math.PI + 0.01) {
      state.vLongMps = vMps;
      stepVehicle(state, input, ASPHALT, params);
      rearAxlePosition(state, sweeper, rear);
      minX = Math.min(minX, rear.x);
      maxX = Math.max(maxX, rear.x);
      minY = Math.min(minY, rear.y);
      maxY = Math.max(maxY, rear.y);
    }
    return (maxX - minX + (maxY - minY)) / 2;
  }

  it('is 7.1 m ± 0.2 at a held 0.1 m/s (analytic 2·2.4/tan(34°/1.0125) ≈ 7.23 m)', () => {
    const d = turningDiameterM(0.1);
    expect(Math.abs(d - 7.1)).toBeLessThanOrEqual(0.2);
    expect(d).toBeCloseTo((2 * 2.4) / Math.tan((34 * DEG_TO_RAD) / (1 + 0.1 / 8)), 1);
  });

  it('is 8.7 m ± 0.3 at a held 1.4 m/s (analytic ≈ 8.68 m)', () => {
    const d = turningDiameterM(1.4);
    expect(Math.abs(d - 8.7)).toBeLessThanOrEqual(0.3);
    expect(d).toBeCloseTo((2 * 2.4) / Math.tan((34 * DEG_TO_RAD) / (1 + 1.4 / 8)), 1);
  });

  it('turning right with positive steer increases heading (clockwise)', () => {
    const { state, params } = newBessie();
    for (let i = 0; i < 120; i++) stepVehicle(state, frame(THROTTLE_MAX, 0, STEER_MAX), ASPHALT, params);
    expect(state.headingRad).toBeGreaterThan(0);
    expect(state.xM).toBeGreaterThan(0);
    expect(state.yawRateRadPerS).toBeCloseTo((state.vLongMps / 2.4) * Math.tan(state.steerRad), 1);
  });
});

describe('hopper hook (GDD §7.4)', () => {
  // [fill, accel m/s², vTop brush down, vTop transit, steer rate °/s], quoted from the GDD §7.4 table.
  const TABLE: readonly (readonly [number, number, number, number, number])[] = [
    [0, 2.4, 6.0, 11.0, 120],
    [0.5, 2.04, 5.7, 10.45, 111],
    [0.8, 1.82, 5.52, 10.12, 106],
    [1.0, 1.68, 5.4, 9.9, 102],
  ];

  it.each(TABLE)(
    'at f = %s matches accel %s, vTop %s / %s, steer %s°/s',
    (f, accel, vDown, vUp, steerDeg) => {
      const params = createVehicleParams(sweeper, BASE_HOPPER_LU);
      const out = createVehicleHandling();
      computeHandling(params, f * BASE_HOPPER_LU, true, out);
      expect(out.fill).toBeCloseTo(f, 12);
      expect(Math.abs(out.accelMps2 - accel)).toBeLessThanOrEqual(0.01);
      expect(Math.abs(out.vTopMps - vDown)).toBeLessThanOrEqual(0.01);
      expect(Math.abs(out.steerRateRadPerS / DEG_TO_RAD - steerDeg)).toBeLessThanOrEqual(1);
      expect(out.massKg).toBeCloseTo(4200 + 1500 * f, 9);
      computeHandling(params, f * BASE_HOPPER_LU, false, out);
      expect(Math.abs(out.vTopMps - vUp)).toBeLessThanOrEqual(0.01);
    },
  );

  it('uses the fill fraction, not absolute LU (a 180 LU hopper at 90 LU handles like half full)', () => {
    const out = createVehicleHandling();
    computeHandling(createVehicleParams(sweeper, 180), 90, false, out);
    expect(out.accelMps2).toBeCloseTo(2.04, 9);
  });

  it('a full hopper caps brush-down speed at 5.4 m/s in the step', () => {
    const { state, params } = newBessie();
    state.brushDown = true;
    state.hopperLU = BASE_HOPPER_LU;
    let maxV = 0;
    for (let tick = 0; tick < 20 * SIM_HZ; tick++) {
      stepVehicle(state, FULL_THROTTLE, ASPHALT, params);
      maxV = Math.max(maxV, state.vLongMps);
    }
    // End-of-tick speed settles at the cap less one tick of drag: 5.4 − (0.3 + 0.012·5.4²)/60 ≈ 5.389.
    expect(maxV).toBeLessThanOrEqual(5.4 + 1e-12);
    expect(maxV).toBeCloseTo(5.4 - dragMps2(sweeper, 5.4) * DT_S, 9);
    expect(state.massKg).toBe(5700);
  });
});

describe('steering rate limits (GDD §6.2, §7.1)', () => {
  it('with a centred input, steer returns at 180°/s (3° per tick) without overshoot', () => {
    const { state, params } = newBessie();
    state.steerRad = 30 * DEG_TO_RAD;
    for (let tick = 1; tick <= 10; tick++) {
      stepVehicle(state, NEUTRAL, ASPHALT, params);
      expect(state.steerRad / DEG_TO_RAD).toBeCloseTo(30 - 3 * tick, 9);
    }
    stepVehicle(state, NEUTRAL, ASPHALT, params);
    expect(state.steerRad).toBe(0);
    state.steerRad = -10 * DEG_TO_RAD;
    stepVehicle(state, NEUTRAL, ASPHALT, params);
    expect(state.steerRad / DEG_TO_RAD).toBeCloseTo(-7, 9);
  });

  it('with input, steer moves at most steerRate·DT per tick (120°/s empty, 102°/s full)', () => {
    for (const [hopperLU, rateDeg] of [
      [0, 120],
      [BASE_HOPPER_LU, 102],
    ] as const) {
      const { state, params } = newBessie();
      state.hopperLU = hopperLU;
      let prev = state.steerRad;
      const steps: number[] = [];
      for (let tick = 0; tick < 40; tick++) {
        stepVehicle(state, frame(0, 0, tick < 20 ? STEER_MAX : -STEER_MAX), ASPHALT, params);
        steps.push(Math.abs(state.steerRad - prev) / DEG_TO_RAD);
        prev = state.steerRad;
      }
      for (const step of steps) expect(step).toBeLessThanOrEqual(rateDeg * DT_S + 1e-9);
      expect(steps[0]).toBeCloseTo(rateDeg * DT_S, 9);
    }
  });

  it('settles on the speed-scaled target 34°/(1 + |v|/8), and an analogue half-stick targets half of it', () => {
    const { state, params } = newBessie();
    for (let i = 0; i < 60; i++) {
      state.vLongMps = 4;
      stepVehicle(state, frame(0, 0, STEER_MAX), ASPHALT, params);
    }
    expect(state.steerRad / DEG_TO_RAD).toBeCloseTo(34 / 1.5, 6);
    const half = newBessie();
    for (let i = 0; i < 60; i++) stepVehicle(half.state, frame(0, 0, -63.5), ASPHALT, half.params);
    expect(half.state.steerRad / DEG_TO_RAD).toBeCloseTo(-17, 6);
  });
});

describe('lateral grip (TECHNICAL_DESIGN §8.2 step 7)', () => {
  it.each([9.0, 1.2])('vLat decays by exp(−k·DT) per tick at k = %s with no lateral input', (k) => {
    const surface: VehicleSurface = { gripPerS: k, rollMult: 1 };
    for (const vLong of [0, 5]) {
      const { state, params } = newBessie();
      state.vLongMps = vLong;
      state.vLatMps = 2;
      for (let tick = 0; tick < 30; tick++) {
        const before = state.vLatMps;
        stepVehicle(state, vLong > 0 ? FULL_THROTTLE : NEUTRAL, surface, params);
        expect(state.vLatMps).toBe(before * Math.exp(-k * DT_S));
      }
    }
  });

  it('lateral slip moves the car to its right', () => {
    const { state, params } = newBessie();
    state.vLatMps = 1;
    stepVehicle(state, NEUTRAL, ASPHALT, params);
    expect(state.xM).toBeGreaterThan(0);
    expect(state.yM).toBeCloseTo(0, 12);
  });

  it('on oil, a hard turn builds far more slip than on asphalt', () => {
    const slip = (k: number): number => {
      const { state, params } = newBessie();
      state.vLongMps = 10;
      let maxSlip = 0;
      for (let i = 0; i < 60; i++) {
        stepVehicle(state, frame(THROTTLE_MAX, 0, STEER_MAX), { gripPerS: k, rollMult: 1 }, params);
        maxSlip = Math.max(maxSlip, Math.abs(state.vLatMps));
      }
      return maxSlip;
    };
    expect(slip(1.2)).toBeGreaterThan(3 * slip(9.0));
  });
});

describe('determinism and allocation', () => {
  /** A seeded mixed input script: throttle, brake, steer and brush toggles. */
  function inputScript(seed: number, ticks: number): InputFrame[] {
    const rng = sfc32(seed);
    const frames: InputFrame[] = [];
    for (let i = 0; i < ticks; i++) {
      const phase = Math.floor(i / 90) % 4;
      frames.push(
        frame(
          phase === 3 ? 0 : nextInt(rng, THROTTLE_MAX + 1),
          phase === 3 ? BRAKE_MAX : nextInt(rng, 3) === 0 ? nextInt(rng, BRAKE_MAX + 1) : 0,
          nextInt(rng, 2 * STEER_MAX + 1) - STEER_MAX,
          nextInt(rng, 200) === 0 ? PRESSED.BRUSH : 0,
        ),
      );
    }
    return frames;
  }

  function run(frames: readonly InputFrame[]): VehicleState {
    const { state, params } = newBessie();
    const surfaces: VehicleSurface[] = [
      ASPHALT,
      { gripPerS: sweeper.lateralGripPerS.oil, rollMult: 1 },
      { gripPerS: sweeper.lateralGripPerS.grass, rollMult: sweeper.drag.grassRollingMul },
    ];
    frames.forEach((input, i) => {
      state.hopperLU = (i / frames.length) * BASE_HOPPER_LU;
      stepVehicle(state, input, surfaces[Math.floor(i / 300) % 3] ?? ASPHALT, params);
    });
    return state;
  }

  it('the same input sequence twice produces bit-identical state', () => {
    const frames = inputScript(0x5eed, 3600);
    const a = run(frames);
    const b = run(frames);
    for (const key of Object.keys(a) as (keyof VehicleState)[]) {
      expect(Object.is(a[key], b[key]), key).toBe(true);
    }
    expect(Math.abs(a.xM) + Math.abs(a.yM)).toBeGreaterThan(1);
  });

  it('stepVehicle allocates nothing per tick (TECHNICAL_DESIGN §17 heap-delta check)', () => {
    const frames = inputScript(42, 4200);
    const { state, params } = newBessie();
    // V8 tiers stepVehicle up to optimised code concurrently, and until that code is installed the
    // interpreter boxes every double. Pre-warm so the check measures the optimised tick even when this test
    // runs alone (-t); measureHeapDelta then adds its own 600-tick §17 warm-up.
    for (let tick = 0; tick < 3000; tick++)
      stepVehicle(state, frames[tick % frames.length] ?? NEUTRAL, ASPHALT, params);
    const delta = measureHeapDelta((tick) => {
      const input = frames[tick % frames.length] ?? NEUTRAL;
      stepVehicle(state, input, ASPHALT, params);
    });
    assertHeapDeltaWithinThresholds(delta);
  });
});
