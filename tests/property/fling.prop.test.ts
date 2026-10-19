// The fling curve (SSP-059; GDD §8.3, TECHNICAL_DESIGN §10.2): p_fling(v) = clamp((v − 4.0) / 2.0, 0, 1).
//
// For random run seeds and random sweeper poses, 10,000 seeded trials per speed: each trial puts one fresh item
// at a random point of the brush zone (gutter circles, suction rect, throat or inlet), runs one real
// stepBrushLitter with Bessie at speed v and the brush collecting, and records whether it was flung. Then:
//   - v = 3.0 and 4.0 m/s: no item is ever flung;
//   - v = 6.0 m/s: every item is flung;
//   - v = 4.5, 5.0, 5.5 m/s: the fling rate is 0.25, 0.50, 0.75 ± 0.02.
// With pwr.super_suction's threshold (6.0 m/s) the same ramp moves up by 2 m/s.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { BrushState, createBrush, stepBrushLitter } from '../../src/sim/brush.ts';
import { createEventQueue, EV, resetEvents, sealEvents } from '../../src/sim/eventQueue.ts';
import { createHopper } from '../../src/sim/hopper.ts';
import { addLitter, createLitterField, LitterFlag, removeLitter } from '../../src/sim/litter.ts';
import { createBlankLevel } from '../../src/sim/map.ts';
import { nextFloat, sfc32 } from '../../src/sim/rng.ts';
import { DEFAULT_ENTITIES, DEFAULT_TUNING } from '../../src/sim/tuning.ts';
import { createVehicleParams, createVehicleState } from '../../src/sim/vehicle.ts';
import { assertProperty } from '../support/fcCheck.ts';

const TRIALS = 10_000;
const TOLERANCE = 0.02;
const LEVEL = createBlankLevel('fling', 32, 32); // 64 × 64 m
const SW = DEFAULT_TUNING.sweeping;

/** A random point of the brush zone, vehicle-local, from `rng`. */
function zonePoint(rng: ReturnType<typeof sfc32>, out: { x: number; y: number }): void {
  const part = Math.floor(nextFloat(rng) * 4);
  if (part < 2) {
    // A gutter circle (uniform by area).
    const r = SW.gutterBrush.radiusM * Math.sqrt(nextFloat(rng));
    const a = 2 * Math.PI * nextFloat(rng);
    out.x = (part === 0 ? 1 : -1) * SW.gutterBrush.centreXM + r * Math.cos(a);
    out.y = SW.gutterBrush.centreYM + r * Math.sin(a);
  } else if (part === 2) {
    // The suction rect.
    out.x = SW.suction.minXM + (SW.suction.maxXM - SW.suction.minXM) * nextFloat(rng);
    out.y = SW.suction.minYM + (SW.suction.maxYM - SW.suction.minYM) * nextFloat(rng);
  } else {
    // The inlet.
    out.x = SW.inlet.centreXM + (nextFloat(rng) - 0.5) * SW.inlet.widthM;
    out.y = SW.inlet.centreYM + (nextFloat(rng) - 0.5) * SW.inlet.depthM;
  }
}

/** Fling rate over TRIALS first touches at `speedMps`, for run seed `seed` and Bessie's pose. */
function flingRate(
  seed: number,
  pose: { x: number; y: number; heading: number },
  speedMps: number,
  thresholdMps: number | null = null,
): number {
  const tuning = DEFAULT_TUNING;
  const sweeper = tuning.vehicle.sweeper;
  const vehicle = createVehicleState(sweeper, pose.x, pose.y, pose.heading);
  vehicle.brushDown = true;
  vehicle.brushPos = 1;
  vehicle.rpm = 1;
  vehicle.vLongMps = speedMps;
  const hopper = createHopper(vehicle, createVehicleParams(sweeper, 1e9), tuning.hopper);
  const brush = createBrush(tuning, seed, 16);
  brush.state = BrushState.Collecting;
  brush.flingThresholdMps = thresholdMps;
  const field = createLitterField(LEVEL, tuning, DEFAULT_ENTITIES, 16);
  const events = createEventQueue();
  const place = sfc32(seed ^ 0x5eed);
  const local = { x: 0, y: 0 };
  const c = Math.cos(pose.heading);
  const s = Math.sin(pose.heading);
  let flung = 0;
  for (let t = 0; t < TRIALS; t++) {
    zonePoint(place, local);
    const i = addLitter(
      field,
      t % 12,
      pose.x + c * local.x + s * local.y,
      pose.y + s * local.x - c * local.y,
      0,
    );
    resetEvents(events, t);
    stepBrushLitter(brush, field, vehicle, hopper, events);
    sealEvents(events);
    let fling = 0;
    for (let e = 0; e < events.count; e++) if (events.type[e] === EV.Fling) fling += 1;
    if (fling === 1) {
      expect(field.flags[i] as number).toBe(LitterFlag.Flung);
      flung += 1;
      removeLitter(field, i);
    } else {
      expect(fling).toBe(0);
      // Not flung: rolled once (BRUSH_CONTACT) and then collected at the inlet or pushed.
      if (field.count > 0) removeLitter(field, 0);
    }
    expect(field.count).toBe(0);
  }
  return flung / TRIALS;
}

const poseArb = fc.record({
  x: fc.double({ min: 8, max: 56, noNaN: true }),
  y: fc.double({ min: 8, max: 56, noNaN: true }),
  heading: fc.double({ min: -Math.PI, max: Math.PI, noNaN: true }),
});
const seedArb = fc.integer({ min: 0, max: 0xffffffff });

describe('fling probability p = clamp((v − 4.0) / 2.0, 0, 1) over 10,000 seeded trials per speed', () => {
  it('never flings at 3.0 or 4.0 m/s and always flings at 6.0 m/s', () => {
    assertProperty(
      fc.property(seedArb, poseArb, (seed, pose) => {
        expect(flingRate(seed, pose, 3.0)).toBe(0);
        expect(flingRate(seed, pose, 4.0)).toBe(0);
        expect(flingRate(seed, pose, 6.0)).toBe(1);
      }),
      { seed: 590_001, numRuns: 4 },
    );
  });

  it('flings 25% ± 2 at 4.5 m/s, 50% ± 2 at 5.0 m/s and 75% ± 2 at 5.5 m/s', () => {
    assertProperty(
      fc.property(seedArb, poseArb, (seed, pose) => {
        expect(Math.abs(flingRate(seed, pose, 4.5) - 0.25)).toBeLessThanOrEqual(TOLERANCE);
        expect(Math.abs(flingRate(seed, pose, 5.0) - 0.5)).toBeLessThanOrEqual(TOLERANCE);
        expect(Math.abs(flingRate(seed, pose, 5.5) - 0.75)).toBeLessThanOrEqual(TOLERANCE);
      }),
      { seed: 590_002, numRuns: 4 },
    );
  });

  it('moves the whole ramp up by 2 m/s under the super-suction threshold (6.0 m/s)', () => {
    assertProperty(
      fc.property(seedArb, poseArb, (seed, pose) => {
        expect(flingRate(seed, pose, 6.0, 6.0)).toBe(0);
        expect(Math.abs(flingRate(seed, pose, 7.0, 6.0) - 0.5)).toBeLessThanOrEqual(TOLERANCE);
        expect(flingRate(seed, pose, 8.0, 6.0)).toBe(1);
      }),
      { seed: 590_003, numRuns: 2 },
    );
  });
});
