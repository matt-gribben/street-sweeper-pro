// Bessie's kinematic bicycle model (TECHNICAL_DESIGN §8.1 and §8.2 steps 1–8, SSP-030). One call to
// stepVehicle advances one 60 Hz tick: hopper-scaled handling, top-speed selection, rate-limited steering,
// drive/brake/reverse, drag, yaw, lateral grip decay and semi-implicit position integration.
//
// Surface-agnostic: the caller (the World, SSP-035) samples the surface under the wheels and passes the
// lateral grip k and the rolling-drag multiplier in. Kerb crossing (step 9) and scripted impulses (step 10)
// live elsewhere. Every number comes from the Tuning object handed in through VehicleParams (SSP-029); this
// file holds no gameplay numbers of its own.
//
// Kinematic reference point. The rear-axle midpoint (body.rearAxleOffsetM along +y local) is the point whose
// velocity the model tracks: it moves along `forward·vLong + right·vLat`, and the body centre (x, y) is
// rebuilt from it after each tick. With no lateral slip the rear axle therefore follows a circle of radius
// wheelbase / tan(δ), the turning circle TECHNICAL_DESIGN §18.1 measures, and the body swings about it like a
// front-steered lorry instead of sliding its tail sideways.
//
// Hot path: stepVehicle allocates nothing (no `new`, literals, closures or array helpers), which the
// heap-delta test in tests/unit/vehicle.test.ts measures. All maths goes through fmath. Heading is never wrapped, so render interpolation from prevHeadingRad needs no seam
// handling (vehicleFrameIndex accepts any finite angle).
import { DT_S } from './constants.ts';
import { cos, exp, sin, tan } from './fmath.ts';
import { hopperFillFraction } from './hopper.ts';
import { BRAKE_MAX, type InputFrame, STEER_MAX, THROTTLE_MAX } from './inputFrame.ts';
import type { SweeperTuning } from './tuning.ts';

/** Gear (TECHNICAL_DESIGN §8.1). */
export const Gear = { Fwd: 0, Rev: 1 } as const;
export type Gear = (typeof Gear)[keyof typeof Gear];

/**
 * Bessie's mutable state (TECHNICAL_DESIGN §8.1). Every numeric field is a JS double, i.e. Float64 (§7.1).
 * Positions are the body centre in sim metres (+x east, +y south); heading is radians, 0 = north, clockwise.
 */
export type VehicleState = {
  /** Body centre, metres. */
  xM: number;
  yM: number;
  headingRad: number;
  /** Copies of xM, yM and headingRad taken at the start of the last tick, for render interpolation. */
  prevXM: number;
  prevYM: number;
  prevHeadingRad: number;
  /** Velocity along the heading (negative in reverse), m/s. */
  vLongMps: number;
  /** Velocity to the right of the heading (sideways slip), m/s. */
  vLatMps: number;
  /** Front-wheel steer angle δ, radians; positive steers right (clockwise). */
  steerRad: number;
  /** Yaw rate from the last tick, rad/s; positive is clockwise. */
  yawRateRadPerS: number;
  gear: Gear;
  /**
   * The brush-down top-speed flag (§8.2 step 2): true in every brush state but Raised, i.e. from the tick
   * lowering starts until the brush is fully raised. Written only by brush.ts (stepBrushState, SSP-059), which
   * owns the BRUSH pressed edge.
   */
  brushDown: boolean;
  /** Brush lowered fraction 0..1, animated by brush.ts over raiseLowerS. */
  brushPos: number;
  /** Brush spin 0..1, animated by brush.ts over spinUpS. */
  rpm: number;
  /** Bessie's Dignity, 0..health.maxHp. Damage arrives with SSP-036. */
  hp: number;
  /** Litter units in the hopper, 0..VehicleParams.hopperCapacityLU. Only hopper.ts writes it (SSP-058). */
  hopperLU: number;
  /** Spray water units. Stays 0 in M1; the spray system (M2) owns the tank capacity and fills it. */
  water: number;
  /** Mass for the current hopper fill, kg (step 1). Collision response (SSP-036) reads it. */
  massKg: number;
  /** Consecutive ticks that ended with brake held below reverse.engageBelowMps while in FWD. */
  reverseHoldTicks: number;
  /**
   * True only on the tick that engaged REV, so the World can emit EV.ReverseBeeper once per engagement.
   * Cleared at the start of every tick.
   */
  reverseEngaged: boolean;
};

/** Per-run vehicle parameters: the tuning plus hooks that power-ups and upgrades plug into later. */
export type VehicleParams = {
  /** Replaced only by setWorldTuning (world.ts), between ticks. */
  tuning: SweeperTuning;
  /**
   * Hopper capacity in LU (tuning.json hopper.capacityLu; upg.hopper raises it in M6). Fill fraction
   * f = hopperLU / capacity. Owned by hopper.ts: change it only through setHopperCapacity.
   */
  hopperCapacityLU: number;
  /** Top-speed multiplier on vTopBase (pwr.bacon_butty, upg.engine plug in later). Default 1. */
  topSpeedMult: number;
  /** Impact-damage multiplier (upg.bumper later). Not used by stepVehicle; collision (SSP-036) reads it. */
  damageMult: number;
};

/** Surface under the wheels for this tick, sampled by the caller. */
export type VehicleSurface = {
  /** Lateral grip decay rate k, 1/s (tuning lateralGripPerS: asphalt 9.0 … oil 1.2). */
  gripPerS: number;
  /** Rolling-drag multiplier: 1 normally, drag.grassRollingMul (2.5) on grass. */
  rollMult: number;
};

/** Handling values derived from hopper fill, brush state and the top-speed hook (§8.2 steps 1–2). */
export type VehicleHandling = {
  fill: number;
  massKg: number;
  accelMps2: number;
  vTopMps: number;
  steerRateRadPerS: number;
};

/** A new handling scratch object. Allocate once, outside the tick. */
export function createVehicleHandling(): VehicleHandling {
  return { fill: 0, massKg: 0, accelMps2: 0, vTopMps: 0, steerRateRadPerS: 0 };
}

/** Parameters with every hook at its neutral value. */
export function createVehicleParams(tuning: SweeperTuning, hopperCapacityLU: number): VehicleParams {
  if (!(hopperCapacityLU > 0))
    throw new Error(`vehicle: hopperCapacityLU must be > 0, got ${hopperCapacityLU}`);
  return { tuning, hopperCapacityLU, topSpeedMult: 1, damageMult: 1 };
}

/**
 * A stationary Bessie at the given body-centre position and heading: FWD, wheels straight, brush up (the
 * first brush-lower starts the timer on first play, GDD §16.1), full health, empty hopper.
 */
export function createVehicleState(
  tuning: SweeperTuning,
  xM: number,
  yM: number,
  headingRad: number,
): VehicleState {
  return {
    xM,
    yM,
    headingRad,
    prevXM: xM,
    prevYM: yM,
    prevHeadingRad: headingRad,
    vLongMps: 0,
    vLatMps: 0,
    steerRad: 0,
    yawRateRadPerS: 0,
    gear: Gear.Fwd,
    brushDown: false,
    brushPos: 0,
    rpm: 0,
    hp: tuning.health.maxHp,
    hopperLU: 0,
    water: 0,
    massKg: tuning.mass.emptyKg,
    reverseHoldTicks: 0,
    reverseEngaged: false,
  };
}

function clamp(value: number, lo: number, hi: number): number {
  return value < lo ? lo : value > hi ? hi : value;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * §8.2 steps 1–2: write fill fraction, mass, acceleration, top speed and steer rate into `out` and return it.
 * Allocation-free.
 */
export function computeHandling(
  params: VehicleParams,
  hopperLU: number,
  brushDown: boolean,
  out: VehicleHandling,
): VehicleHandling {
  const t = params.tuning;
  const f = hopperFillFraction(hopperLU, params.hopperCapacityLU);
  const vTopBase =
    (brushDown ? t.drive.topSpeedBrushDownMps : t.drive.topSpeedTransitMps) * params.topSpeedMult;
  out.fill = f;
  out.massKg = t.mass.emptyKg + t.mass.fullHopperExtraKg * f;
  out.accelMps2 = t.drive.accelMps2 * lerp(1, t.fullHopper.accelMul, f);
  out.vTopMps = vTopBase * lerp(1, t.fullHopper.topSpeedMul, f);
  out.steerRateRadPerS = t.steering.steerRateRadPerS * lerp(1, t.fullHopper.steerRateMul, f);
  return out;
}

/** Ticks the brake must be held below reverse.engageBelowMps to engage REV: 0.25 s → 15 ticks. */
export function reverseEngageTicks(tuning: SweeperTuning): number {
  return Math.round(tuning.reverse.engageHoldS / DT_S);
}

/** Module-level scratch: stepVehicle writes here instead of allocating. */
const handling = createVehicleHandling();

/**
 * Advance `state` by one tick (DT_S) under `input` on `surface` (TECHNICAL_DESIGN §8.2 steps 1–8).
 *
 * Top speed follows `state.brushDown`, which brush.ts's stepBrushState writes before this runs (phase 2): this
 * function no longer reads the BRUSH edge itself (SSP-059).
 *
 * Controls: throttle/brake 0..255 → 0..1, steer −127..127 → −1..1 (out-of-range values are clamped). In FWD,
 * throttle accelerates and brake slows toward 0; brake held for reverse.engageHoldS with |vLong| below
 * reverse.engageBelowMps at the end of each tick engages REV (reverseEngaged is set on that tick). In REV,
 * brake accelerates backwards up to reverse.maxSpeedMps and throttle brakes; throttle at standstill
 * (|vLong| below engageBelowMps) returns to FWD at once and drives forward on the same tick.
 */
export function stepVehicle(
  state: VehicleState,
  input: InputFrame,
  surface: VehicleSurface,
  params: VehicleParams,
): void {
  const t = params.tuning;

  state.prevXM = state.xM;
  state.prevYM = state.yM;
  state.prevHeadingRad = state.headingRad;
  state.reverseEngaged = false;

  const throttle = clamp(input.throttle, 0, THROTTLE_MAX) / THROTTLE_MAX;
  const brake = clamp(input.brake, 0, BRAKE_MAX) / BRAKE_MAX;
  const steerIn = clamp(input.steer, -STEER_MAX, STEER_MAX) / STEER_MAX;

  // 1–2. Handling from hopper fill, brush mode and the top-speed hook.
  computeHandling(params, state.hopperLU, state.brushDown, handling);
  state.massKg = handling.massKg;

  // 3. Steering: δ chases the speed-scaled target at steerRate, or returns at returnRate when centred.
  const steerTarget =
    (steerIn * t.steering.maxSteerRad) / (1 + Math.abs(state.vLongMps) / t.steering.steerFalloffMps);
  const steerRate = steerIn === 0 ? t.steering.returnRateRadPerS : handling.steerRateRadPerS;
  state.steerRad += clamp(steerTarget - state.steerRad, -steerRate * DT_S, steerRate * DT_S);

  // 4. Drive, brake and reverse. "Move toward 0 by step, never past it" is written out inline at each use:
  // as a helper call, V8's mid-tier (Maglev) boxed the returned double, allocating 16 B per call per tick.
  let v = state.vLongMps;
  if (state.gear === Gear.Rev && throttle > 0 && Math.abs(v) < t.reverse.engageBelowMps) {
    state.gear = Gear.Fwd;
    state.reverseHoldTicks = 0;
  }
  if (state.gear === Gear.Fwd) {
    // Throttle only pushes up to vTop. Above it (brush lowered at speed, hopper filling) the engine stops
    // pushing and drag and brake bleed the excess off; the speed is never snapped down.
    if (throttle > 0 && v < handling.vTopMps) {
      v += handling.accelMps2 * throttle * DT_S;
      if (v > handling.vTopMps) v = handling.vTopMps;
    }
    if (brake > 0) {
      const step = t.drive.brakeMps2 * brake * DT_S;
      v = v > step ? v - step : v < -step ? v + step : 0;
    }
  } else {
    // REV: brake drives backwards up to the reverse cap, throttle brakes.
    const vRevMax = -t.reverse.maxSpeedMps;
    if (brake > 0 && v > vRevMax) {
      v -= t.reverse.accelMps2 * brake * DT_S;
      if (v < vRevMax) v = vRevMax;
    }
    if (throttle > 0) {
      const step = t.drive.brakeMps2 * throttle * DT_S;
      v = v > step ? v - step : v < -step ? v + step : 0;
    }
  }

  // 5. Drag opposes motion and never flips the sign of vLong.
  const dragStep = (t.drag.rollingMps2 * surface.rollMult + t.drag.quadraticPerM * v * v) * DT_S;
  v = v > dragStep ? v - dragStep : v < -dragStep ? v + dragStep : 0;
  state.vLongMps = v;

  // Reverse engagement, judged on the end-of-tick speed so the hold counts only once Bessie has stopped.
  if (state.gear === Gear.Fwd && brake > 0 && Math.abs(v) < t.reverse.engageBelowMps) {
    state.reverseHoldTicks += 1;
    if (state.reverseHoldTicks >= reverseEngageTicks(t)) {
      state.gear = Gear.Rev;
      state.reverseHoldTicks = 0;
      state.reverseEngaged = true;
    }
  } else {
    state.reverseHoldTicks = 0;
  }

  // 6. Yaw (wheelbase from tuning).
  const yawRate = (v / t.body.wheelbaseM) * tan(state.steerRad);
  const dHeading = yawRate * DT_S;
  state.yawRateRadPerS = yawRate;
  state.headingRad += dHeading;

  // 7. Grip: re-express the previous world velocity (vLong, vLat in the old frame) in the new heading frame,
  // then decay the lateral part. Rotating the frame clockwise by Δ gives vLong' = vLong·cosΔ + vLat·sinΔ and
  // vLat' = vLat·cosΔ − vLong·sinΔ.
  const cosD = cos(dHeading);
  const sinD = sin(dHeading);
  const vLat = state.vLatMps;
  state.vLongMps = v * cosD + vLat * sinD;
  state.vLatMps = (vLat * cosD - v * sinD) * exp(-surface.gripPerS * DT_S);

  // 8. Position (semi-implicit Euler with the new heading and velocities), integrated at the rear axle.
  // forward = (sin θ, −cos θ), right = (cos θ, sin θ) (TECHNICAL_DESIGN §4).
  const rearM = t.body.rearAxleOffsetM;
  const fx0 = sin(state.prevHeadingRad);
  const fy0 = -cos(state.prevHeadingRad);
  const fx = sin(state.headingRad);
  const fy = -cos(state.headingRad);
  const rearX = state.xM + fx0 * rearM + (fx * state.vLongMps - fy * state.vLatMps) * DT_S;
  const rearY = state.yM + fy0 * rearM + (fy * state.vLongMps + fx * state.vLatMps) * DT_S;
  state.xM = rearX - fx * rearM;
  state.yM = rearY - fy * rearM;
}

/** World-space position of the rear-axle midpoint (the kinematic reference point), written into `out`. */
export function rearAxlePosition(
  state: VehicleState,
  tuning: SweeperTuning,
  out: { x: number; y: number },
): { x: number; y: number } {
  const rearM = tuning.body.rearAxleOffsetM;
  out.x = state.xM + sin(state.headingRad) * rearM;
  out.y = state.yM - cos(state.headingRad) * rearM;
  return out;
}
