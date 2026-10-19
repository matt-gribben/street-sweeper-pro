// Hopper LU bounds (TECHNICAL_DESIGN §18.2 "Hopper LU never exceeds capacity"; SSP-058). For any sequence of
// adds, drain starts, drain ticks, cancels and capacity changes, after every operation:
//
//   - 0 ≤ hopperLU ≤ capacity;
//   - `full` is exactly hopperLU ≥ capacity (the bulldozer state never disagrees with the LU);
//   - EV.HopperFull fired exactly once for each not-full → full transition, and never otherwise;
//   - LU are conserved: everything collected (after the overflow clamp) is either in the hopper or dumped,
//     and the depot counter never exceeds the total.
//
// Items use the catalogue's LU sizes (0.5, 1, 2, 3 and 8, the values entities.json holds) plus arbitrary
// positive amounts, so the exactness of the 0.5-multiple path and the general clamp are both exercised.
// Capacities are the base and upgraded sizes (100, 140, 180 LU) and arbitrary positive values.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { countEvents, createEventQueue, EV, resetEvents } from '../../src/sim/eventQueue.ts';
import {
  addToHopper,
  cancelHopperDrain,
  createHopper,
  DumpSite,
  isHopperDraining,
  setHopperCapacity,
  startHopperDrain,
  stepHopperDrain,
} from '../../src/sim/hopper.ts';
import { DEFAULT_ENTITIES, DEFAULT_TUNING } from '../../src/sim/tuning.ts';
import { createVehicleParams, createVehicleState } from '../../src/sim/vehicle.ts';
import { assertProperty } from '../support/fcCheck.ts';

const sweeper = DEFAULT_TUNING.vehicle.sweeper;

/** The distinct LU sizes of every litter item in entities.json. */
const CATALOGUE_LU: readonly number[] = [
  ...new Set(
    Object.values(DEFAULT_ENTITIES.litter)
      .map((e) => e.lu)
      .sort((a, b) => a - b),
  ),
];

type Op =
  | { readonly kind: 'add'; readonly lu: number }
  | { readonly kind: 'drain'; readonly depot: boolean; readonly ticks: number }
  | { readonly kind: 'step'; readonly n: number }
  | { readonly kind: 'cancel' }
  | { readonly kind: 'capacity'; readonly capacityLU: number };

const luArb = fc.oneof(
  { weight: 4, arbitrary: fc.constantFrom(...CATALOGUE_LU) },
  { weight: 1, arbitrary: fc.double({ min: 1e-3, max: 250, noNaN: true }) },
);
const capacityArb = fc.oneof(fc.constantFrom(100, 140, 180), fc.double({ min: 0.5, max: 300, noNaN: true }));
const opArb: fc.Arbitrary<Op> = fc.oneof(
  { weight: 8, arbitrary: luArb.map((lu) => ({ kind: 'add', lu }) as const) },
  {
    weight: 2,
    arbitrary: fc
      .record({ depot: fc.boolean(), ticks: fc.integer({ min: 1, max: 200 }) })
      .map((r) => ({ kind: 'drain', ...r }) as const),
  },
  {
    weight: 3,
    arbitrary: fc.integer({ min: 1, max: 250 }).map((n) => ({ kind: 'step', n }) as const),
  },
  { weight: 1, arbitrary: fc.constant({ kind: 'cancel' } as const) },
  { weight: 1, arbitrary: capacityArb.map((capacityLU) => ({ kind: 'capacity', capacityLU }) as const) },
);

describe('hopper LU bounds (TECHNICAL_DESIGN §18.2)', () => {
  it('lists the catalogue LU sizes', () => {
    expect(CATALOGUE_LU).toEqual([0.5, 1, 2, 3, 8]);
  });

  it('for any sequence of adds and drains, 0 ≤ hopperLU ≤ capacity and HopperFull fires once per fill', () => {
    assertProperty(
      fc.property(capacityArb, fc.array(opArb, { minLength: 1, maxLength: 120 }), (capacity0, ops) => {
        const vehicle = createVehicleState(sweeper, 0, 0, 0);
        const params = createVehicleParams(sweeper, capacity0);
        const hopper = createHopper(vehicle, params, DEFAULT_TUNING.hopper);
        const events = createEventQueue();
        let tick = 0;
        let fills = 0;
        let fullEvents = 0;
        // LU accounting: in = everything that entered (after the clamp), out = dumped + lost to a capacity cut.
        let luIn = 0;
        let luCut = 0;

        const check = (where: string): void => {
          const lu = vehicle.hopperLU;
          const cap = params.hopperCapacityLU;
          if (!(lu >= 0 && lu <= cap)) throw new Error(`${where}: hopperLU ${lu} outside [0, ${cap}]`);
          if (hopper.full !== lu >= cap)
            throw new Error(`${where}: full ${hopper.full} with ${lu}/${cap} LU`);
          if (fullEvents !== fills) throw new Error(`${where}: ${fullEvents} HopperFull for ${fills} fills`);
          if (hopper.luDumpedDepot > hopper.luDumpedTotal + 1e-9) {
            throw new Error(`${where}: depot ${hopper.luDumpedDepot} > total ${hopper.luDumpedTotal}`);
          }
          const balance = luIn - (lu + hopper.luDumpedTotal + luCut);
          if (Math.abs(balance) > 1e-6 * (1 + luIn))
            throw new Error(`${where}: LU not conserved (${balance})`);
        };

        for (const [i, op] of ops.entries()) {
          const where = `op ${i} ${JSON.stringify(op)}`;
          switch (op.kind) {
            case 'add': {
              resetEvents(events, tick++);
              const wasFull = hopper.full;
              const before = vehicle.hopperLU;
              const accepted = addToHopper(hopper, op.lu, events);
              if (accepted === wasFull)
                throw new Error(`${where}: accepted ${accepted} while full ${wasFull}`);
              luIn += vehicle.hopperLU - before;
              if (!wasFull && hopper.full) fills += 1;
              fullEvents += countEvents(events, EV.HopperFull);
              break;
            }
            case 'drain':
              if (isHopperDraining(hopper)) break;
              startHopperDrain(hopper, op.depot ? DumpSite.Depot : DumpSite.Skip, op.ticks);
              break;
            case 'step':
              for (let k = 0; k < op.n; k++) {
                stepHopperDrain(hopper);
                check(`${where} tick ${k}`);
              }
              break;
            case 'cancel':
              cancelHopperDrain(hopper);
              break;
            case 'capacity': {
              const before = vehicle.hopperLU;
              setHopperCapacity(hopper, op.capacityLU);
              luCut += before - vehicle.hopperLU;
              break;
            }
          }
          check(where);
        }
      }),
      { seed: 0x5e5058, numRuns: 2000 },
    );
  });

  it('a drain with no adds during it always ends with an exactly empty hopper', () => {
    assertProperty(
      fc.property(
        fc.array(fc.constantFrom(...CATALOGUE_LU), { maxLength: 60 }),
        fc.integer({ min: 1, max: 400 }),
        fc.boolean(),
        (items, ticks, depot) => {
          const vehicle = createVehicleState(sweeper, 0, 0, 0);
          const params = createVehicleParams(sweeper, 100);
          const hopper = createHopper(vehicle, params, DEFAULT_TUNING.hopper);
          const events = createEventQueue();
          resetEvents(events, 0);
          for (const lu of items) addToHopper(hopper, lu, events);
          const start = vehicle.hopperLU;
          startHopperDrain(hopper, depot ? DumpSite.Depot : DumpSite.Skip, ticks);
          let prev = start;
          for (let k = 1; k <= ticks; k++) {
            const done = stepHopperDrain(hopper);
            if (done !== (k === ticks)) throw new Error(`drain finished at tick ${k} of ${ticks}`);
            if (vehicle.hopperLU > prev) throw new Error(`LU rose during a drain at tick ${k}`);
            prev = vehicle.hopperLU;
          }
          if (vehicle.hopperLU !== 0) throw new Error(`drain of ${start} LU left ${vehicle.hopperLU}`);
          if (hopper.luDumpedTotal !== start) throw new Error(`dumped ${hopper.luDumpedTotal} of ${start}`);
          if (hopper.luDumpedDepot !== (depot ? start : 0)) throw new Error('depot counter wrong');
          if (hopper.full) throw new Error('still full after a dump');
        },
      ),
      { seed: 0x5e5059, numRuns: 1000 },
    );
  });
});
