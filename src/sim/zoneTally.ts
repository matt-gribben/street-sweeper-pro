// Per-zone grime and litter counters (TECHNICAL_DESIGN §10.3, GDD §9.3, LEVEL_DESIGN §7.10; SSP-064): the
// incremental counters behind each frontage's clean %. tidy.ts builds one tally per shift from the compiled
// `frontages` and attaches it to the Dirt and the LitterField, which bump it as they change, so nothing ever
// rescans the grime mask or the litter store to know how clean a frontage is.
//
// Zones are lists of tiles and may overlap: where two frontage zones share a tile (facades facing each other
// across a narrow street share the gutter, and precinct zones can share walk tiles; 12 tiles on Puddle Lane),
// that tile's grime cells and litter count for both. The tile → zones map is CSR: the zones of tile t are
// zoneList[tileStart[t] .. tileStart[t + 1]), ascending.
//
// Counters per zone (Int32Array, small integers):
//   grimeInitial    grime cells laid in the zone's tiles at shift start (tidy.ts initTidy, from the mask)
//   grimeCleaned    of those, cleaned so far (dirt.ts stepDirt, per erased cell)
//   litterSpawned   litter items whose spawn position is in the zone (litter.ts addLitter, initial and dynamic)
//   litterCollected of those, collected so far, wherever they were collected (litter.ts collectLitter)
// Litter is attributed by the tile it spawned on (LitterField.spawnTile), so an item flung, drifted or
// bulldozed out of a zone still counts for the zone it came from (GDD §9.3, decided in SSP-064).
//
// `changed` / `changedList` / `changedCount` name the zones whose counters moved since the last
// takeChangedZones, in first-change order, so tidy.ts recomputes only those frontages each tick.
//
// Hot path: the tally functions take and return small integers and allocate nothing (TECHNICAL_DESIGN §17).
// createZoneTally runs at shift start and may allocate.

/** The tile → zones map and the per-zone counters of one district. Create with createZoneTally. */
export type ZoneTally = {
  /** Map size in tiles (the Dirt and the LitterField it is attached to must match). */
  readonly tilesW: number;
  readonly tilesH: number;
  /** Number of zones. */
  readonly zoneCount: number;
  /** CSR offsets, tilesW·tilesH + 1 entries: tile t's zones are zoneList[tileStart[t] .. tileStart[t + 1]). */
  readonly tileStart: Int32Array;
  /** Zone indices, grouped by tile, ascending within a tile. */
  readonly zoneList: Int32Array;
  /** Tiles in each zone. */
  readonly zoneTiles: Int32Array;
  readonly grimeInitial: Int32Array;
  readonly grimeCleaned: Int32Array;
  readonly litterSpawned: Int32Array;
  readonly litterCollected: Int32Array;
  /** 1 while the zone is in changedList. */
  readonly changed: Uint8Array;
  /** Zones whose counters moved since the last takeChangedZones, in first-change order. */
  readonly changedList: Int32Array;
  changedCount: number;
};

/**
 * A tally for a tilesW × tilesH map whose zone z covers the tiles `zones[z]` ([x, y] pairs). A tile listed
 * twice in one zone counts once. Throws on a tile outside the map. Counters start at 0. Shift start only.
 */
export function createZoneTally(
  tilesW: number,
  tilesH: number,
  zones: readonly (readonly (readonly [number, number])[])[],
): ZoneTally {
  if (!(Number.isInteger(tilesW) && Number.isInteger(tilesH) && tilesW > 0 && tilesH > 0)) {
    throw new Error(`createZoneTally: map size must be positive integers, got ${tilesW} × ${tilesH}`);
  }
  const tiles = tilesW * tilesH;
  const zoneCount = zones.length;
  // Per zone, its unique tile indices; then count per tile.
  const perZone: Int32Array[] = [];
  const counts = new Int32Array(tiles);
  const zoneTiles = new Int32Array(zoneCount);
  const inZone = new Int32Array(tiles).fill(-1);
  for (let z = 0; z < zoneCount; z += 1) {
    const unique: number[] = [];
    for (const [x, y] of zones[z] ?? []) {
      if (!(Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < tilesW && y < tilesH)) {
        throw new Error(
          `createZoneTally: zone ${z} tile (${x}, ${y}) is outside the ${tilesW} × ${tilesH} map`,
        );
      }
      const t = y * tilesW + x;
      if (inZone[t] === z) continue;
      inZone[t] = z;
      unique.push(t);
    }
    const list = Int32Array.from(unique).sort();
    perZone.push(list);
    zoneTiles[z] = list.length;
    for (const t of list) counts[t] = (counts[t] as number) + 1;
  }
  const tileStart = new Int32Array(tiles + 1);
  for (let t = 0; t < tiles; t += 1) tileStart[t + 1] = (tileStart[t] as number) + (counts[t] as number);
  const zoneList = new Int32Array(tileStart[tiles] as number);
  const fill = tileStart.slice(0, tiles);
  // Zones in ascending order, so each tile's zones come out ascending.
  for (let z = 0; z < zoneCount; z += 1) {
    for (const t of perZone[z] as Int32Array) {
      const at = fill[t] as number;
      zoneList[at] = z;
      fill[t] = at + 1;
    }
  }
  return {
    tilesW,
    tilesH,
    zoneCount,
    tileStart,
    zoneList,
    zoneTiles,
    grimeInitial: new Int32Array(zoneCount),
    grimeCleaned: new Int32Array(zoneCount),
    litterSpawned: new Int32Array(zoneCount),
    litterCollected: new Int32Array(zoneCount),
    changed: new Uint8Array(zoneCount),
    changedList: new Int32Array(zoneCount),
    changedCount: 0,
  };
}

/** Zero every counter and the change list (a new shift on the same tally). Not per tick. */
export function clearZoneTally(tally: ZoneTally): void {
  tally.grimeInitial.fill(0);
  tally.grimeCleaned.fill(0);
  tally.litterSpawned.fill(0);
  tally.litterCollected.fill(0);
  tally.changed.fill(0);
  tally.changedCount = 0;
}

/** Add zone `z` to the change list unless it is already there. */
function markChanged(tally: ZoneTally, z: number): void {
  if ((tally.changed[z] as number) !== 0) return;
  tally.changed[z] = 1;
  tally.changedList[tally.changedCount] = z;
  tally.changedCount += 1;
}

/** Add 1 to `counts` for every zone holding tile `tile` (−1 or a tile in no zone: nothing). */
function bump(tally: ZoneTally, counts: Int32Array, tile: number): void {
  if (tile < 0) return;
  const end = tally.tileStart[tile + 1] as number;
  for (let k = tally.tileStart[tile] as number; k < end; k += 1) {
    const z = tally.zoneList[k] as number;
    counts[z] = (counts[z] as number) + 1;
    markChanged(tally, z);
  }
}

/** The tile index (y·tilesW + x) of map tile (col, row), or −1 outside the map. */
export function zoneTileIndex(tally: ZoneTally, col: number, row: number): number {
  if (col < 0 || row < 0 || col >= tally.tilesW || row >= tally.tilesH) return -1;
  return row * tally.tilesW + col;
}

/** Shift start: one grime cell laid on `tile`. */
export function tallyGrimeLaid(tally: ZoneTally, tile: number): void {
  bump(tally, tally.grimeInitial, tile);
}

/** A grime cell on `tile` was cleaned (dirt.ts stepDirt). Allocation-free. */
export function tallyGrimeCleaned(tally: ZoneTally, tile: number): void {
  bump(tally, tally.grimeCleaned, tile);
}

/** A litter item spawned on `tile` (litter.ts addLitter). Allocation-free. */
export function tallyLitterSpawned(tally: ZoneTally, tile: number): void {
  bump(tally, tally.litterSpawned, tile);
}

/** A litter item that spawned on `tile` was collected (litter.ts collectLitter). Allocation-free. */
export function tallyLitterCollected(tally: ZoneTally, tile: number): void {
  bump(tally, tally.litterCollected, tile);
}

/**
 * Hand the caller the zones changed since the last call: returns how many, and they are
 * changedList[0 .. n) (valid until the next tally function call). Clears the change flags. Allocation-free.
 */
export function takeChangedZones(tally: ZoneTally): number {
  const n = tally.changedCount;
  for (let k = 0; k < n; k += 1) tally.changed[tally.changedList[k] as number] = 0;
  tally.changedCount = 0;
  return n;
}
