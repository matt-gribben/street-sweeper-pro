// Parking bays (SSP-090; LEVEL_DESIGN §9.5, TECHNICAL_DESIGN §15.2): the car slots cut from the compiled
// `lanes.bays` runs. Shared by the level compiler (spawns.traffic.parkedBays, tools/levels/spawnSpecs.ts) and the
// shift-start placement (parked.ts), so the compiled vehicle peak is exactly what the sim places.
//
// A run of n `p` cells holds floor(n / BAY_SLOT_TILES) bays, one car each: 2 tiles (4 m) fits the longest parked
// car of the game (the 3.88 m ice cream van, M6). The bays are centred in the run (an odd run leaves half a
// tile free at each end); a car stands in the middle of its bay, across the middle of the bay row, facing the
// run's lane heading. Setup only (allocates).
import { TILE_M } from './constants.ts';
import type { ParkingBay } from './map.ts';

/** Tiles of bay run one parked car takes (a 4 m bay). */
export const BAY_SLOT_TILES = 2;
/** One bay's length, metres. */
export const BAY_SLOT_M = BAY_SLOT_TILES * TILE_M;

/** True when bay run `bay` runs east–west (one row of cells); a single cell counts as east–west. */
function runsAcross(bay: Readonly<ParkingBay>): boolean {
  return bay.rect[2] - bay.rect[0] >= bay.rect[3] - bay.rect[1];
}

/** The bays (car slots) one run of `p` cells holds: floor(cells / BAY_SLOT_TILES). */
export function baySlotCount(bay: Readonly<ParkingBay>): number {
  const cells = runsAcross(bay) ? bay.rect[2] - bay.rect[0] : bay.rect[3] - bay.rect[1];
  return Math.floor(cells / BAY_SLOT_TILES);
}

/** Every bay of the level's runs (the compiled spawns.traffic.parkedBays). */
export function countBaySlots(bays: readonly Readonly<ParkingBay>[]): number {
  let n = 0;
  for (const bay of bays) n += baySlotCount(bay);
  return n;
}

/** One bay: the run it is cut from (index into lanes.bays), its centre (metres) and the cars' heading. */
export type BaySlot = {
  readonly run: number;
  readonly x: number;
  readonly y: number;
  readonly heading: number;
};

/**
 * Every bay of `bays`, run by run in compiled order and along each run in ascending x (or y): the centre of
 * the bay's 4 m stretch of the run (the slots centred in the run) across the middle of the bay row. Setup only.
 */
export function cutBaySlots(bays: readonly Readonly<ParkingBay>[]): BaySlot[] {
  const out: BaySlot[] = [];
  bays.forEach((bay, run) => {
    const n = baySlotCount(bay);
    if (n === 0) return;
    const [x0, y0, x1, y1] = bay.rect;
    const across = runsAcross(bay);
    const startM = (across ? x0 : y0) * TILE_M;
    const lengthM = ((across ? x1 : y1) - (across ? x0 : y0)) * TILE_M;
    const firstM = startM + (lengthM - n * BAY_SLOT_M) / 2 + BAY_SLOT_M / 2;
    const midM = ((across ? y0 + y1 : x0 + x1) / 2) * TILE_M;
    for (let k = 0; k < n; k += 1) {
      const alongM = firstM + k * BAY_SLOT_M;
      out.push({
        run,
        x: across ? alongM : midM,
        y: across ? midM : alongM,
        heading: bay.heading,
      });
    }
  });
  return out;
}
