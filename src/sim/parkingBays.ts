// Parking bays (SSP-090; LEVEL_DESIGN §9.5, TECHNICAL_DESIGN §15.2): the car slots cut from the compiled
// `lanes.bays` runs. Shared by the level compiler (spawns.traffic.parkedBays, tools/levels/spawnSpecs.ts) and the
// shift-start placement (parked.ts), so the compiled vehicle peak is exactly what the sim places.
//
// A run of n `p` cells holds floor(n / BAY_SLOT_TILES) bays, one car each: 2 tiles (4 m) fits the longest parked
// car of the game (the 3.88 m ice cream van, M6). The bays are centred in the run (an odd run leaves half a
// tile free at each end); a car stands in the middle of its bay, across the middle of the bay row, facing the
// run's lane heading. Setup only (allocates).
import { TILE_M } from './constants.ts';
import { cos, sin } from './fmath.ts';
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

// ---------------------------------------------------------------------------------------------------------
// Half on the pavement (SSP-091; ENTITY_CATALOG §8.2, LEVEL_DESIGN §9.5)
// ---------------------------------------------------------------------------------------------------------

/**
 * A white van parks half on the pavement, and only beside a pavement at least this many tiles deep (LEVEL_DESIGN
 * §9.5): on a 1-tile pavement it would leave no footway, so no van parks there.
 */
export const HALF_ON_PAVEMENT_MIN_TILES = 2;
/**
 * How far a van parked half on the pavement stands out of the middle of its bay row towards the kerb, metres:
 * half a tile puts its centre on the kerb line, so half its width is over the pavement.
 */
export const HALF_ON_PAVEMENT_SHIFT_M = TILE_M / 2;

/**
 * The unit step (tiles, [dx, dy]) from bay run `bay`'s row towards its kerb: the left of the lane it serves (UK
 * kerbside parking; heading 0 = north, clockwise, so the left is (−cos h, −sin h)), along the axis across the run.
 */
export function bayKerbStep(bay: Readonly<ParkingBay>): [dx: number, dy: number] {
  if (runsAcross(bay)) return [0, -sin(bay.heading) < 0 ? -1 : 1];
  return [-cos(bay.heading) < 0 ? -1 : 1, 0];
}

/**
 * The depth (tiles, at most `maxTiles`) of pavement beside bay `slot` of run `bay`, kerb side: for every tile of the
 * bay row the slot's 4 m spans, the count of consecutive `ground` Pavement tiles stepping out from the row towards
 * the kerb (bayKerbStep), and the least of them. `ground` is the level's ground layer (w × h, row-major) and
 * `pavement` its Pavement id. Setup only.
 */
export function slotPavementDepth(
  slot: Readonly<BaySlot>,
  bay: Readonly<ParkingBay>,
  ground: Readonly<Uint8Array>,
  w: number,
  h: number,
  pavement: number,
  maxTiles: number,
): number {
  const across = runsAcross(bay);
  const [dx, dy] = bayKerbStep(bay);
  const alongM = across ? slot.x : slot.y;
  const t0 = Math.floor((alongM - BAY_SLOT_M / 2) / TILE_M);
  const t1 = Math.floor((alongM + BAY_SLOT_M / 2) / TILE_M - 1e-9);
  const row = across ? bay.rect[1] : bay.rect[0];
  let least = maxTiles;
  for (let t = t0; t <= t1; t += 1) {
    let depth = 0;
    while (depth < least) {
      const x = across ? t : row + dx * (depth + 1);
      const y = across ? row + dy * (depth + 1) : t;
      if (x < 0 || y < 0 || x >= w || y >= h || ground[y * w + x] !== pavement) break;
      depth += 1;
    }
    if (depth < least) least = depth;
  }
  return least;
}
