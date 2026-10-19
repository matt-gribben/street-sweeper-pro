// Water bounds (SSP-061; GDD §8.5, TECHNICAL_DESIGN §10.4). For any sequence of ticks (SPRAY held or not, at
// any speed and pose, next to a hydrant or not), depot refills and tank-size changes, after every operation:
//
//   - 0 ≤ water ≤ capacity;
//   - water is a whole number of WATER_QUANTUM (no drift from accumulating 0.1 or 0.41666…);
//   - a tick sprays only when SPRAY is held and the tank was not empty, and a spraying tick away from a hydrant
//     uses exactly min(water, sprayUnitsPerS × DT_S);
//   - a tick with SPRAY released never loses water, and away from a hydrant never changes it.
import fc from 'fast-check';
import { describe, it } from 'vitest';
import tuningJson from '../../src/data/tuning.json' with { type: 'json' };
import { DT_S } from '../../src/sim/constants.ts';
import { BUTTON, createInputFrame } from '../../src/sim/inputFrame.ts';
import { createBlankLevel } from '../../src/sim/map.ts';
import { DEFAULT_TUNING, loadTuning, type Tuning } from '../../src/sim/tuning.ts';
import { createVehicleState } from '../../src/sim/vehicle.ts';
import {
  createWater,
  HYDRANT_PROP_ID,
  isAtHydrant,
  refillWater,
  setWaterTuning,
  stepWater,
  WATER_QUANTUM,
} from '../../src/sim/water.ts';
import { assertProperty } from '../support/fcCheck.ts';

/** A tuning with tank size `tankUnits` (the base 100 and upg.water_tank's 150 / 200, or another size). */
function tuningWithTank(tankUnits: number): Tuning {
  const raw = structuredClone(tuningJson);
  raw.water.tankUnits = tankUnits;
  return loadTuning(raw);
}

const HYDRANT: readonly [number, number] = [64, 64];

type Op =
  | {
      readonly kind: 'ticks';
      readonly n: number;
      readonly spray: boolean;
      /** Bessie's centre relative to the hydrant, m, her heading and speed. */
      readonly dx: number;
      readonly dy: number;
      readonly heading: number;
      readonly vLong: number;
      readonly vLat: number;
    }
  | { readonly kind: 'refill' }
  | { readonly kind: 'tank'; readonly units: number };

// Tank sizes are whole numbers of quanta (every authored and upgraded size is a whole number of units).
const tankArb = fc.oneof(
  fc.constantFrom(100, 150, 200),
  fc.integer({ min: 30, max: 240_000 }).map((q) => q * WATER_QUANTUM),
);
const opArb: fc.Arbitrary<Op> = fc.oneof(
  {
    weight: 10,
    arbitrary: fc
      .record({
        n: fc.integer({ min: 1, max: 400 }),
        spray: fc.boolean(),
        // Often within reach of the hydrant (the body is 1.75 × 3.25 m, the reach 1.5 m), sometimes far.
        dx: fc.oneof(
          fc.double({ min: -4, max: 4, noNaN: true }),
          fc.double({ min: -40, max: 40, noNaN: true }),
        ),
        dy: fc.double({ min: -5, max: 5, noNaN: true }),
        heading: fc.double({ min: -Math.PI, max: Math.PI, noNaN: true }),
        vLong: fc.oneof(fc.constant(0), fc.double({ min: -3, max: 12, noNaN: true })),
        vLat: fc.oneof(fc.constant(0), fc.double({ min: -1, max: 1, noNaN: true })),
      })
      .map((r) => ({ kind: 'ticks', ...r }) as const),
  },
  { weight: 1, arbitrary: fc.constant({ kind: 'refill' } as const) },
  { weight: 1, arbitrary: tankArb.map((units) => ({ kind: 'tank', units }) as const) },
);

describe('water bounds (SSP-061)', () => {
  it('for any input sequence, 0 ≤ water ≤ capacity, quantised, and spray uses exactly its rate', () => {
    assertProperty(
      fc.property(
        tankArb,
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.array(opArb, { minLength: 1, maxLength: 60 }),
        (tank0, fill0, ops) => {
          const level = createBlankLevel('prop', 64, 64);
          level.props.push({ id: HYDRANT_PROP_ID, x: HYDRANT[0], y: HYDRANT[1], rot: 0 });
          let tuning = tuningWithTank(tank0);
          const vehicle = createVehicleState(tuning.vehicle.sweeper, 64, 64, 0);
          vehicle.water = fill0 * tank0;
          const water = createWater(vehicle, tuning, level);
          const input = createInputFrame();
          const spray = DEFAULT_TUNING.water.sprayUnitsPerS * DT_S;

          const check = (where: string): void => {
            const w = vehicle.water;
            const cap = tuning.water.tankUnits;
            if (!(w >= 0 && w <= cap)) throw new Error(`${where}: water ${w} outside [0, ${cap}]`);
            const q = w / WATER_QUANTUM;
            if (w !== cap && Math.abs(q - Math.round(q)) > 1e-6) {
              throw new Error(`${where}: water ${w} is not a whole number of quanta`);
            }
          };
          check('start');

          for (const [i, op] of ops.entries()) {
            const where = `op ${i} ${JSON.stringify(op)}`;
            switch (op.kind) {
              case 'ticks': {
                vehicle.xM = HYDRANT[0] + op.dx;
                vehicle.yM = HYDRANT[1] + op.dy;
                vehicle.headingRad = op.heading;
                vehicle.vLongMps = op.vLong;
                vehicle.vLatMps = op.vLat;
                input.buttons = op.spray ? BUTTON.SPRAY : 0;
                const atHydrant = isAtHydrant(water);
                for (let k = 0; k < op.n; k++) {
                  const before = vehicle.water;
                  stepWater(water, input);
                  const at = `${where} tick ${k}`;
                  check(at);
                  if (water.spraying !== (op.spray && (before > 0 || atHydrant))) {
                    throw new Error(`${at}: spraying ${water.spraying} with ${before} units`);
                  }
                  if (!atHydrant && water.spraying) {
                    const used = before - vehicle.water;
                    const want = Math.min(before, spray);
                    if (Math.abs(used - want) > 1e-9) throw new Error(`${at}: used ${used}, want ${want}`);
                  }
                  if (!op.spray && vehicle.water < before)
                    throw new Error(`${at}: lost water without spraying`);
                  if (!op.spray && !atHydrant && vehicle.water !== before) {
                    throw new Error(`${at}: water changed with no spray and no hydrant`);
                  }
                }
                break;
              }
              case 'refill':
                refillWater(water);
                if (vehicle.water !== tuning.water.tankUnits) throw new Error(`${where}: refill not full`);
                break;
              case 'tank':
                tuning = tuningWithTank(op.units);
                setWaterTuning(water, tuning);
                break;
            }
            check(where);
          }
        },
      ),
      { seed: 61, numRuns: 300 },
    );
  });
});
