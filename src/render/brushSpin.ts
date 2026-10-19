// The brush overlay's spin animation (ART_BIBLE §10.2, §8.1; SSP-067): `veh.sweeper_brush` has 4 spin frames per
// heading, shown for 3 ticks each at 100% RPM, scaled by 1/RPM (6 ticks each at 50%), and frozen on frame 0
// below 10% RPM.
//
// The spin is integrated over sim ticks, not wall-clock time (ART_BIBLE §10.1), from the RPM the sim publishes
// (VehicleState.rpm, 0..1, brush.ts): the phase advances by `rpm` "full-speed ticks" per tick, so the frame is
// floor(phase / 3) mod 4 and a change of RPM changes the rate without a jump. Below BRUSH_SPIN_MIN_RPM the phase
// resets to 0, so a brush spinning down settles on frame 0 and a brush spinning up starts from it. The phase is
// render-side state (BrushSpin, one per drawn brush): the sim holds no animation data.
//
// The renderer sees the World only at render time, so advanceBrushSpin takes the ticks since the last frame and
// the RPM now: in play that is 0 to 2 ticks per frame; a test's step(n) advances n ticks at the final RPM.
// Allocation-free.

/** Spin frames of the brush overlay (veh.sweeper_brush:brush:hNN:0..3). */
export const BRUSH_SPIN_FRAME_COUNT = 4;

/** Ticks per spin frame at 100% RPM (ART_BIBLE §10.2: 50 ms). */
export const BRUSH_TICKS_PER_FRAME_FULL_RPM = 3;

/** Below this RPM the overlay is frozen on frame 0 (ART_BIBLE §10.2: 10%). */
export const BRUSH_SPIN_MIN_RPM = 0.1;

/** One spin cycle in full-speed ticks: the phase wraps here so it never grows without bound. */
const CYCLE_TICKS = BRUSH_SPIN_FRAME_COUNT * BRUSH_TICKS_PER_FRAME_FULL_RPM;

/**
 * Tolerance on the frame boundary: rpm values such as 1/3 do not sum to exact multiples of 3 in a double
 * (9 × (1/3) = 2.9999999999999996), and a boundary must not slip a tick for rounding.
 */
const PHASE_EPSILON = 1e-9;

/** Render-side spin state of one brush overlay. */
export type BrushSpin = {
  /** Spin phase in full-speed ticks, 0 <= phase < CYCLE_TICKS. */
  phase: number;
  /** The spin frame, 0..3, after the last advance. */
  frame: number;
  /** The sim tick of the last advance, or −1 before the first. */
  lastTick: number;
};

/** A brush spin at rest on frame 0. Allocate once per drawn brush. */
export function createBrushSpin(): BrushSpin {
  return { phase: 0, frame: 0, lastTick: -1 };
}

/**
 * Advances `spin` by `ticks` (whole sim ticks, >= 0) at `rpm` (0..1) and returns the spin frame 0..3: frame 0
 * while rpm < BRUSH_SPIN_MIN_RPM, otherwise the next frame every 3 / rpm ticks.
 */
export function advanceBrushSpin(spin: BrushSpin, rpm: number, ticks: number): number {
  if (!(rpm >= BRUSH_SPIN_MIN_RPM)) {
    spin.phase = 0;
    spin.frame = 0;
    return 0;
  }
  const steps = ticks > 0 ? ticks : 0;
  let phase = spin.phase + rpm * steps;
  if (phase >= CYCLE_TICKS - PHASE_EPSILON)
    phase -= CYCLE_TICKS * Math.floor((phase + PHASE_EPSILON) / CYCLE_TICKS);
  if (phase < 0) phase = 0;
  spin.phase = phase;
  const frame = Math.floor((phase + PHASE_EPSILON) / BRUSH_TICKS_PER_FRAME_FULL_RPM);
  spin.frame = frame < BRUSH_SPIN_FRAME_COUNT ? frame : 0;
  return spin.frame;
}

/**
 * Advances `spin` to sim tick `tick` at `rpm` (the ticks since the last call; the first call only records the
 * tick) and returns the spin frame. A tick earlier than the last (a new shift) restarts from frame 0.
 */
export function brushSpinFrameAt(spin: BrushSpin, tick: number, rpm: number): number {
  const last = spin.lastTick;
  spin.lastTick = tick;
  if (last < 0 || tick < last) {
    spin.phase = 0;
    spin.frame = 0;
    return advanceBrushSpin(spin, rpm, 0);
  }
  return advanceBrushSpin(spin, rpm, tick - last);
}
