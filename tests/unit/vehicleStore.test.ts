// The vehicle store (src/sim/vehicleStore.ts, SSP-089; TECHNICAL_DESIGN §7.1): capacity, body sizes from
// entities.json, swap-remove, the OBB corners and the spatial lookup (grid buckets for collision, SSP-090,
// and render culling, SSP-103).
import { describe, expect, it } from 'vitest';
import { createAabb } from '../../src/sim/collision/obb.ts';
import { VEHICLE_IDS } from '../../src/sim/entities.ts';
import { createBlankLevel } from '../../src/sim/map.ts';
import { DEFAULT_ENTITIES } from '../../src/sim/tuning.ts';
import {
  addVehicle,
  createVehicleStore,
  queryVehicles,
  rebuildVehicleGrid,
  removeVehicle,
  updateVehicleCorners,
  VEHICLE_CAPACITY,
  VEHICLE_CELL_M,
  VEHICLE_FLAG,
  type VehicleStore,
} from '../../src/sim/vehicleStore.ts';

const kind = (id: (typeof VEHICLE_IDS)[number]): number => VEHICLE_IDS.indexOf(id);

function place(store: VehicleStore, k: number, x: number, y: number, heading: number, flags = 0): number {
  const i = addVehicle(store, k, flags);
  store.x[i] = x;
  store.y[i] = y;
  store.heading[i] = heading;
  updateVehicleCorners(store, i);
  return i;
}

describe('VehicleStore (SSP-089)', () => {
  it('holds 30 vehicles with their entities.json bodies and refuses a 31st', () => {
    const store = createVehicleStore(createBlankLevel('test.vehicles', 20, 20), DEFAULT_ENTITIES);
    expect(store.capacity).toBe(VEHICLE_CAPACITY);
    expect(VEHICLE_CAPACITY).toBe(30);
    const bus = place(store, kind('veh.bus'), 10, 10, 0);
    expect(store.halfWidth[bus]).toBeCloseTo(2.38 / 2, 12);
    expect(store.halfLength[bus]).toBeCloseTo(7.25 / 2, 12);
    const hatch = place(store, kind('veh.hatchback'), 20, 10, 0);
    expect(store.halfWidth[hatch]).toBeCloseTo(1.63 / 2, 12);
    expect(store.halfLength[hatch]).toBeCloseTo(2.88 / 2, 12);
    for (let k = 2; k < VEHICLE_CAPACITY; k++) place(store, kind('veh.saloon'), 5, 5, 0);
    expect(() => addVehicle(store, kind('veh.saloon'), 0)).toThrow(/full/);
  });

  it('writes the OBB corners in obbCorners order (front-right, back-right, back-left, front-left)', () => {
    const store = createVehicleStore(createBlankLevel('test.vehicles', 20, 20), DEFAULT_ENTITIES);
    // Facing east (heading π/2): forward = (1, 0), right = (0, 1).
    const i = place(store, kind('veh.van_white'), 10, 20, Math.PI / 2);
    const c = Array.from(store.corners.subarray(i * 8, i * 8 + 8), (v) => Math.round(v * 1e6) / 1e6);
    expect(c).toEqual([11.875, 20.94, 8.125, 20.94, 8.125, 19.06, 11.875, 19.06]);
  });

  it('swap-removes: the last vehicle moves into the freed slot with every column, the parked count follows', () => {
    const store = createVehicleStore(createBlankLevel('test.vehicles', 20, 20), DEFAULT_ENTITIES);
    place(store, kind('veh.hatchback'), 1, 1, 0);
    place(store, kind('veh.saloon_parked'), 2, 2, 0, VEHICLE_FLAG.PARKED);
    const last = place(store, kind('veh.bus'), 3, 3, 1);
    store.plan[last * 32] = 7;
    store.planLen[last] = 1;
    store.blockTicks[last] = 99;
    expect(store.parkedCount).toBe(1);
    removeVehicle(store, 1);
    expect(store.parkedCount).toBe(0);
    expect(store.count).toBe(2);
    expect(store.uid[1]).toBe(2);
    expect(store.kind[1]).toBe(kind('veh.bus'));
    expect(store.x[1]).toBe(3);
    expect(store.plan[32]).toBe(7);
    expect(store.blockTicks[1]).toBe(99);
    expect(store.halfLength[1]).toBeCloseTo(7.25 / 2, 12);
    expect(store.vehiclesAdded).toBe(3);
    expect(store.vehiclesRemoved).toBe(1);
    expect(() => removeVehicle(store, 2)).toThrow(/not a live vehicle/);
  });

  it('finds every vehicle whose body can touch a box, in cell then index order, off the map edge too', () => {
    const level = createBlankLevel('test.vehicles', 40, 20); // 80 × 40 m
    const store = createVehicleStore(level, DEFAULT_ENTITIES);
    place(store, kind('veh.hatchback'), 4, 4, 0); // 0
    place(store, kind('veh.bus'), 30, 20, Math.PI / 2); // 1
    place(store, kind('veh.saloon'), 70, 35, 0); // 2
    place(store, kind('veh.hatchback'), -3, 10, Math.PI / 2); // 3: entering over the west edge
    place(store, kind('veh.saloon'), 31, 21, 0); // 4: beside the bus
    rebuildVehicleGrid(store);
    const out = new Int32Array(32);
    const box = createAabb();
    const query = (minX: number, minY: number, maxX: number, maxY: number): number[] => {
      box.minX = minX;
      box.minY = minY;
      box.maxX = maxX;
      box.maxY = maxY;
      return Array.from(out.subarray(0, queryVehicles(store, box, out)));
    };
    // A box over the bus and its neighbour finds both (in index order within their cell) and nothing far away.
    const mid = query(28, 18, 32, 22);
    expect(mid).toEqual(expect.arrayContaining([1, 4]));
    expect(mid).not.toContain(0);
    expect(mid).not.toContain(2);
    expect(mid).not.toContain(3);
    expect(mid.indexOf(1)).toBeLessThan(mid.indexOf(4));
    // The bus reaches 3.6 m from its centre: a box just beyond its nose still finds it.
    expect(query(33, 19.5, 34, 20.5)).toContain(1);
    // The off-map entrant is bucketed in the margin cells.
    const west = query(-5, 8, -1, 12);
    expect(west).toContain(3);
    expect(west).not.toContain(1);
    const east = query(66, 30, 79, 39);
    expect(east).toEqual([2]);
    // Everything, cells row-major.
    expect(query(-16, -16, 96, 56).sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4]);
    // Every vehicle a query box can touch is found (a sweep of boxes over the whole map and margin).
    for (let x = -16; x < 96; x += VEHICLE_CELL_M / 2) {
      for (let y = -16; y < 56; y += VEHICLE_CELL_M / 2) {
        const found = new Set(query(x, y, x + 3, y + 3));
        for (let i = 0; i < store.count; i++) {
          const hx = Math.abs((store.x[i] as number) - (x + 1.5));
          const hy = Math.abs((store.y[i] as number) - (y + 1.5));
          if (hx <= 1.5 + (store.halfLength[i] as number) && hy <= 1.5 + (store.halfLength[i] as number)) {
            expect(found.has(i), `vehicle ${i} near box at ${x}, ${y}`).toBe(true);
          }
        }
      }
    }
  });
});
