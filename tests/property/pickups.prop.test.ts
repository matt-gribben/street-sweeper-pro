// Power-up collection properties (SSP-096; ENTITY_CATALOG §12: "collected by body overlap with any brush state").
//
//   1. Over random poses of Bessie and random pickup points around her, stepPickups collects a pickup exactly
//      when a test-side oracle says the 0.375 m pickup circle overlaps her body box: the distance from the
//      circle's centre to the box (in body axes: right (cos θ, sin θ), forward (sin θ, −cos θ)) is at most the
//      radius. Cases within 1e-9 m of the boundary are skipped (both sides are right there). A collected pickup
//      emits exactly one EV.PowerUp and leaves the store; an untouched one stays, unchanged.
//   2. Over random straight drives (brush up or down, any heading, up to the transit top speed), a pickup lying
//      on her path is always collected, never twice, and never by a body that does not reach it: driving
//      through at 14 m/s does not tunnel past a 0.75 m pickup.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { BrushState } from '../../src/sim/brush.ts';
import { POWERUP_IDS } from '../../src/sim/entities.ts';
import { countEvents, EV, resetEvents } from '../../src/sim/eventQueue.ts';
import { cos, sin } from '../../src/sim/fmath.ts';
import { createInputFrame } from '../../src/sim/inputFrame.ts';
import { addPickup, PICKUP_RADIUS_M, stepPickups } from '../../src/sim/pickups.ts';
import { DEFAULT_TUNING } from '../../src/sim/tuning.ts';
import { createWorld, type World } from '../../src/sim/world.ts';
import { assertProperty } from '../support/fcCheck.ts';
import { npcTown } from '../support/npcTown.ts';

const BODY = DEFAULT_TUNING.vehicle.sweeper.body;
const HW = BODY.widthM / 2;
const HL = BODY.lengthM / 2;
const LEVEL = npcTown(48, {}).level;
const WRENCH = POWERUP_IDS.indexOf('pwr.wrench');

/** A double uniform in [min, max] on a 2^20 grid (fc.double is uniform over bit patterns). */
function uniform(min: number, max: number): fc.Arbitrary<number> {
  const steps = 1 << 20;
  return fc.integer({ min: 0, max: steps }).map((k) => min + ((max - min) * k) / steps);
}

/** Distance from (px, py) to Bessie's body box at (cx, cy, heading), 0 inside. */
function boxDistance(cx: number, cy: number, heading: number, px: number, py: number): number {
  const dx = px - cx;
  const dy = py - cy;
  const lx = dx * Math.cos(heading) + dy * Math.sin(heading);
  const ly = dx * Math.sin(heading) - dy * Math.cos(heading);
  const ox = Math.max(0, Math.abs(lx) - HW);
  const oy = Math.max(0, Math.abs(ly) - HL);
  return Math.hypot(ox, oy);
}

function worldAt(x: number, y: number, heading: number): World {
  const world = createWorld(LEVEL, 96, DEFAULT_TUNING);
  const v = world.vehicle;
  v.xM = x;
  v.yM = y;
  v.headingRad = heading;
  v.prevXM = x;
  v.prevYM = y;
  v.prevHeadingRad = heading;
  return world;
}

describe('power-up collection (SSP-096)', () => {
  it('collects a pickup exactly when its circle overlaps the body box, whatever the pose', () => {
    assertProperty(
      fc.property(
        uniform(20, 76),
        uniform(20, 76),
        uniform(-Math.PI, Math.PI),
        uniform(-3.5, 3.5),
        uniform(-3.5, 3.5),
        (x, y, heading, ox, oy) => {
          const px = x + ox;
          const py = y + oy;
          const gap = boxDistance(x, y, heading, px, py) - PICKUP_RADIUS_M;
          fc.pre(Math.abs(gap) > 1e-9);
          const world = worldAt(x, y, heading);
          addPickup(world.pickups, WRENCH, px, py);
          resetEvents(world.events, world.tick);
          stepPickups(world);
          const collected = gap <= 0;
          expect(countEvents(world.events, EV.PowerUp)).toBe(collected ? 1 : 0);
          expect(world.pickups.count).toBe(collected ? 0 : 1);
          if (!collected) expect([world.pickups.x[0], world.pickups.y[0]]).toEqual([px, py]);
        },
      ),
      { seed: 0x5509_6001, numRuns: 400 },
    );
  });

  it('never misses a pickup on her straight path, never collects it twice, at any speed up to 14 m/s', () => {
    assertProperty(
      fc.property(
        uniform(-Math.PI, Math.PI),
        uniform(1, 14),
        uniform(-0.6, 0.6),
        fc.boolean(),
        (heading, speed, across, brushDown) => {
          // Start 20 m from the map centre and drive straight through it; the pickup sits on the path at the
          // centre, `across` metres to the side of the centre line (inside the half width plus the radius).
          const fx = sin(heading);
          const fy = -cos(heading);
          const world = worldAt(48 - fx * 20, 48 - fy * 20, heading);
          const v = world.vehicle;
          v.vLongMps = speed;
          if (brushDown) {
            world.brush.state = BrushState.Collecting;
            v.brushDown = true;
          }
          addPickup(world.pickups, WRENCH, 48 + cos(heading) * across, 48 + sin(heading) * across);
          const input = createInputFrame();
          let events = 0;
          for (let t = 0; t < 1800 && events === 0; t++) {
            // Hold her speed and line: no drag, no steering (the property is about the overlap test).
            v.vLongMps = speed;
            v.vLatMps = 0;
            v.yawRateRadPerS = 0;
            v.steerRad = 0;
            world.step(input);
            events += countEvents(world.events, EV.PowerUp);
          }
          expect(events).toBe(1);
          expect(world.pickups.count).toBe(0);
          for (let t = 0; t < 30; t++) {
            world.step(input);
            expect(countEvents(world.events, EV.PowerUp)).toBe(0);
          }
        },
      ),
      { seed: 0x5509_6002, numRuns: 120 },
    );
  });
});
