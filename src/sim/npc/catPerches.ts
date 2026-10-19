// The cat's shift tables (ENTITY_CATALOG §7.2, TECHNICAL_DESIGN §11.3, LEVEL_DESIGN §9.4; SSP-087): where cats
// may sit, where they may groom, and the searches the cat's behaviour (behaviours/cat.ts) and the spawner
// (spawner.ts) run over them. Built once per shift (createCatTables, from npcAi.ts) after the parked cars are
// placed; nothing here is hashed, because every live fact it reads is already in the hashed stores.
//
// Perches. A perch is a `w` wall tile centre (the level's compiled `perches.walls`, the spawner's wall list,
// when `perches.on` includes walls) or a parked car's roof (its body centre, parked.ts, when `on` includes
// carRoofs, or when the level has no perch spec at all: a test adding cats by hand). One index space:
// 0..wallCount−1 are the walls (occupancy: the spawner's hashed `perchUsed`, 1 while a cat holds or is on its way
// to it), wallCount..perchCount−1 the roofs of parked cars 0..roofCount−1 (occupancy: the vehicle store's hashed
// `roofPerch`, the holder's NPC handle). One cat per perch.
//
// Targets. A cat's `timerB` (store.ts) names where it sits or is running to: a perch index (≥ 0, claimed), a
// tile (TILE_TARGET − tile, ≤ −2: the tile's centre, a pavement spot off the road or a grooming spot) or
// NO_TARGET (−1).
//
// Tiles. Each tile is one of LANE (road ground that is not a parking bay: the carriageway), BAY (a `p` parking
// bay), OFF (anything else a cat can stand on: pavement, grass, alleys, yards, and the low walls and hedges it
// hops) or NO_GO (a building, water or void). A cat runs in a straight line and hops walls, props and parked
// cars, but never crosses a NO_GO tile or leaves the map (segmentClear samples the line every 0.5 m).
//
// Darts (marchAcross). A dart crosses the road along one of the four map axes: from the cat's tile it passes at
// most MARCH_PRE_TILES OFF or BAY tiles (its own pavement, wall or parked car), then at least one LANE tile, and
// lands on the far side: a free parked car roof on a far BAY tile, else the first OFF tile after the road (or a
// free wall perch on it or the tile beyond, so a cat crossing to a garden wall hops onto it). At most
// runReachM / TILE_M tiles. The direction with the shortest crossing wins (ties: N, E, S, W). A far side with no
// perch is still a landing: the cat sits on the far pavement and the next approach can send it back.
//
// Cover (findCover). A bolt runs to the nearest free perch within runReachM with a clear line that is farther
// from Bessie than the cat (else the nearest free one); a cat getting off the road (after a groom, after
// hopping off Bessie's roof) runs to the nearest free perch within runReachM with a clear line. Failing that it
// leaves the road by the shortest march (as above; for a bolt, only along the axes square to Bessie or away
// from her, never towards her); a cat already off the road and not bolting stays where it is.
//
// Grooming spots. The tiles the lane graph's centrelines run through (each edge sampled every 0.5 m) that are
// LANE tiles: mid-road. A perched cat picks one within groomReachM with a clear line, that no other cat grooms
// at and that is more than dartMaxM from Bessie (pickGroomSpot, one `npc` draw).
//
// Hot path: the searches allocate nothing and take only the World and integers; positions come back through the
// tables' scratch arrays (px, py).
import { TILE_M } from '../constants.ts';
import { type Entities, NPC_IDS } from '../entities.ts';
import { cos, hypot, sin, sqrt } from '../fmath.ts';
import { Ground, type Level, MARKING } from '../map.ts';
import { claimRoofPerch, isRoofPerchFree, releaseRoofPerch } from '../parked.ts';
import { nextInt } from '../rng.ts';
import type { VehicleStore } from '../vehicleStore.ts';
import { circleTouchesViewRect } from '../viewRect.ts';
import type { World } from '../world.ts';
import type { NpcSpawner } from './spawner.ts';
import { NPC_FLAG, npcHandle } from './store.ts';

/** Tile classes for the cat (see the header). */
export const CAT_TILE = { LANE: 1, BAY: 2, OFF: 3, NO_GO: 4 } as const;
export type CatTile = (typeof CAT_TILE)[keyof typeof CAT_TILE];

/** `timerB` of a cat with no target. */
export const NO_TARGET = -1;
/** `timerB` of a tile target is TILE_TARGET − tile (−2 for tile 0). */
export const TILE_TARGET = -2;
/** OFF or BAY tiles a dart may pass before the road (its own pavement, wall or parked car). */
export const MARCH_PRE_TILES = 3;
/** Line samples every this many metres (segmentClear). */
const SEGMENT_STEP_M = 0.5;
/** The axis directions of a march: N, E, S, W. */
const DIR_X = [0, 1, 0, -1] as const;
const DIR_Y = [-1, 0, 1, 0] as const;

/** Where a level's cats are placed (perches.on), as PERCH_SURFACES indices. */
export const CAT_SURFACE = { Walls: 0, CarRoofs: 1, Road: 2 } as const;

/** The cat's numbers for a shift, from entities.json `npc.cat.rules`, in metres and ticks. */
export type CatParams = {
  /** NPC_IDS index of npc.cat. */
  readonly kind: number;
  readonly dartMinM: number;
  readonly dartMaxM: number;
  readonly dartChance: number;
  /** RideRoof length, ticks (rideS × 60: 180). */
  readonly rideTicks: number;
  readonly runReachM: number;
  readonly walkMps: number;
  readonly groomIdleMinTicks: number;
  readonly groomIdleMaxTicks: number;
  readonly groomTicks: number;
  readonly groomReachM: number;
  readonly boltNearM: number;
  readonly boltMps: number;
  /** The roof seat: this far ahead of Bessie's body centre, on her centreline, metres. */
  readonly seatForwardM: number;
};

/** The cat's shift tables (see the header). Create with createCatTables. */
export type CatTables = {
  readonly params: CatParams;
  readonly widthTiles: number;
  readonly heightTiles: number;
  /** CAT_TILE per tile. */
  readonly tile: Uint8Array;
  /** The wall perch on each tile, −1 for none. */
  readonly tileWall: Int32Array;
  /** The parked car (vehicle-store index) whose body covers each tile's centre, −1 for none (roofs only). */
  readonly tileCar: Int16Array;
  /** Wall perches (the spawner's perchX/perchY/perchUsed) and parked-car roof perches. */
  readonly wallCount: number;
  readonly roofCount: number;
  readonly perchCount: number;
  /** Grooming spot tiles, ascending. */
  readonly spotCount: number;
  readonly spotTile: Int32Array;
  /** Where the level places its cats: CAT_SURFACE values in perches.on order. */
  readonly surfaces: Uint8Array;
  /** Cats the level places (perches.count; 0 without a perch spec). */
  readonly placedTotal: number;
  /** The walls' positions and occupancy (the spawner's arrays). */
  readonly wallX: Float64Array;
  readonly wallY: Float64Array;
  readonly wallUsed: Uint8Array;
  /** The parked cars (vehicle store), for the roof perches. */
  readonly vehicles: VehicleStore;
  /** Scratch: a position out of targetPos / seat / landing helpers, and candidates. */
  readonly px: Float64Array;
  readonly py: Float64Array;
  readonly eligible: Int32Array;
  /** Scratch: one radius (the cat's), for the view tests. */
  readonly radius: Float64Array;
  /** Tiles the last successful march took (marchAcross). */
  marchTiles: number;
};

/** The cat's numbers from entities.json (setup only). */
export function createCatParams(entities: Entities): CatParams {
  const r = entities.npcs['npc.cat'].rules;
  const ticks = (s: number): number => Math.max(1, Math.round(s * 60));
  return {
    kind: NPC_IDS.indexOf('npc.cat'),
    dartMinM: r.dartMinM,
    dartMaxM: r.dartMaxM,
    dartChance: r.dartChance,
    rideTicks: ticks(r.rideS),
    runReachM: r.runReachM,
    walkMps: r.walkSpeedMps,
    groomIdleMinTicks: ticks(r.groomIdleMinS),
    groomIdleMaxTicks: ticks(r.groomIdleMaxS),
    groomTicks: ticks(r.groomS),
    groomReachM: r.groomReachM,
    boltNearM: r.boltNearM,
    boltMps: r.boltSpeedMps,
    seatForwardM: r.seatForwardM,
  };
}

/**
 * The cat tables for `level`, over the spawner's wall perches and the parked cars already placed in `vehicles`
 * (createWorld places them first). Setup only (allocates).
 */
export function createCatTables(
  level: Level,
  entities: Entities,
  spawner: NpcSpawner,
  vehicles: VehicleStore,
  catRadiusM: number,
): CatTables {
  const w = level.size[0];
  const h = level.size[1];
  const n = w * h;
  const tile = new Uint8Array(n);
  const L = level.layers;
  for (let t = 0; t < n; t += 1) {
    const g = L.ground[t] as number;
    let c: number = CAT_TILE.OFF;
    if (g >= Ground.Road && g <= Ground.RoadOneWayS) {
      c = ((L.markings[t] as number) & MARKING.PARKING_BAY) !== 0 ? CAT_TILE.BAY : CAT_TILE.LANE;
    } else if (g === Ground.Void || g === Ground.Water) c = CAT_TILE.NO_GO;
    if ((L.storeys[t] as number) > 0) c = CAT_TILE.NO_GO;
    tile[t] = c;
  }
  const perches = level.npc?.perches ?? null;
  const on = perches?.on ?? [];
  const surfaces = Uint8Array.from(on, (s) =>
    s === 'walls' ? CAT_SURFACE.Walls : s === 'carRoofs' ? CAT_SURFACE.CarRoofs : CAT_SURFACE.Road,
  );
  const wallCount = spawner.perchCount;
  const tileWall = new Int32Array(n).fill(-1);
  for (let p = 0; p < wallCount; p += 1) {
    const tx = Math.floor((spawner.perchX[p] as number) / TILE_M);
    const ty = Math.floor((spawner.perchY[p] as number) / TILE_M);
    if (tx >= 0 && ty >= 0 && tx < w && ty < h && (tileWall[ty * w + tx] as number) < 0)
      tileWall[ty * w + tx] = p;
  }
  const roofs = perches === null || on.includes('carRoofs');
  const roofCount = roofs ? vehicles.parkedCount : 0;
  const tileCar = new Int16Array(n).fill(-1);
  for (let v = 0; v < roofCount; v += 1) {
    const cx = vehicles.x[v] as number;
    const cy = vehicles.y[v] as number;
    const hd = vehicles.heading[v] as number;
    const hl = vehicles.halfLength[v] as number;
    const hw = vehicles.halfWidth[v] as number;
    const fx = sin(hd);
    const fy = -cos(hd);
    const reach = hl + hw;
    const x0 = Math.max(0, Math.floor((cx - reach) / TILE_M));
    const x1 = Math.min(w - 1, Math.floor((cx + reach) / TILE_M));
    const y0 = Math.max(0, Math.floor((cy - reach) / TILE_M));
    const y1 = Math.min(h - 1, Math.floor((cy + reach) / TILE_M));
    for (let ty = y0; ty <= y1; ty += 1) {
      for (let tx = x0; tx <= x1; tx += 1) {
        const dx = (tx + 0.5) * TILE_M - cx;
        const dy = (ty + 0.5) * TILE_M - cy;
        const along = dx * fx + dy * fy;
        const across = dx * -fy + dy * fx;
        if (Math.abs(along) <= hl && Math.abs(across) <= hw) tileCar[ty * w + tx] = v;
      }
    }
  }
  // Grooming spots: LANE tiles under the lane centrelines.
  const spot = new Uint8Array(n);
  const lanes = level.lanes;
  for (let e = 0; e < lanes.edgeCount; e += 1) {
    const a = lanes.edgeFrom[e] as number;
    const b = lanes.edgeTo[e] as number;
    const ax = lanes.nodeX[a] as number;
    const ay = lanes.nodeY[a] as number;
    const bx = lanes.nodeX[b] as number;
    const by = lanes.nodeY[b] as number;
    const len = hypot(bx - ax, by - ay);
    const steps = Math.max(1, Math.ceil(len / SEGMENT_STEP_M));
    for (let k = 0; k <= steps; k += 1) {
      const tx = Math.floor((ax + ((bx - ax) * k) / steps) / TILE_M);
      const ty = Math.floor((ay + ((by - ay) * k) / steps) / TILE_M);
      if (tx < 0 || ty < 0 || tx >= w || ty >= h) continue;
      if (tile[ty * w + tx] === CAT_TILE.LANE) spot[ty * w + tx] = 1;
    }
  }
  const spots: number[] = [];
  for (let t = 0; t < n; t += 1) if (spot[t] === 1) spots.push(t);
  const perchCount = wallCount + roofCount;
  return {
    params: createCatParams(entities),
    widthTiles: w,
    heightTiles: h,
    tile,
    tileWall,
    tileCar,
    wallCount,
    roofCount,
    perchCount,
    spotCount: spots.length,
    spotTile: Int32Array.from(spots),
    surfaces,
    placedTotal: perches?.count ?? 0,
    wallX: spawner.perchX,
    wallY: spawner.perchY,
    wallUsed: spawner.perchUsed,
    vehicles,
    px: new Float64Array(1),
    py: new Float64Array(1),
    eligible: new Int32Array(Math.max(1, perchCount, spots.length)),
    radius: Float64Array.of(catRadiusM),
    marchTiles: 0,
  };
}

// ---------------------------------------------------------------------------------------------------------
// Perches and targets
// ---------------------------------------------------------------------------------------------------------

/**
 * True when perch `p` has no cat, or (a roof) `handle`'s cat holds it. A wall's occupancy is one bit, so a wall a
 * cat holds is never free, even to that cat (its searches exclude its own perch).
 */
export function isCatPerchFree(c: CatTables, p: number, handle: number): boolean {
  if (p < c.wallCount) return (c.wallUsed[p] as number) === 0;
  const v = p - c.wallCount;
  return isRoofPerchFree(c.vehicles, v) || c.vehicles.roofPerch[v] === handle;
}

/** Claim perch `p` for the cat with `handle` (free it first if you must; a held perch stays held). */
export function claimCatPerch(c: CatTables, p: number, handle: number): void {
  if (p < 0 || p >= c.perchCount) return;
  if (p < c.wallCount) c.wallUsed[p] = 1;
  else claimRoofPerch(c.vehicles, p - c.wallCount, handle);
}

/** Free perch `p` (a wall, or a roof `handle`'s cat holds). Not a perch: nothing. */
export function releaseCatPerch(c: CatTables, p: number, handle: number): void {
  if (p < 0 || p >= c.perchCount) return;
  if (p < c.wallCount) c.wallUsed[p] = 0;
  else releaseRoofPerch(c.vehicles, p - c.wallCount, handle);
}

/** Write target `code` (a perch, or a tile target) into px[0], py[0]. False for NO_TARGET. */
export function catTargetPos(c: CatTables, code: number): boolean {
  if (code >= 0) {
    if (code < c.wallCount) {
      c.px[0] = c.wallX[code] as number;
      c.py[0] = c.wallY[code] as number;
    } else {
      c.px[0] = c.vehicles.x[code - c.wallCount] as number;
      c.py[0] = c.vehicles.y[code - c.wallCount] as number;
    }
    return true;
  }
  if (code <= TILE_TARGET) {
    const t = TILE_TARGET - code;
    c.px[0] = ((t % c.widthTiles) + 0.5) * TILE_M;
    c.py[0] = (Math.floor(t / c.widthTiles) + 0.5) * TILE_M;
    return true;
  }
  return false;
}

/** The tile of NPC `i`'s centre, or −1 off the map. */
export function catTileOf(w: World, i: number): number {
  const c = w.npcAi.cat;
  const tx = Math.floor((w.npc.x[i] as number) / TILE_M);
  const ty = Math.floor((w.npc.y[i] as number) / TILE_M);
  if (tx < 0 || ty < 0 || tx >= c.widthTiles || ty >= c.heightTiles) return -1;
  return ty * c.widthTiles + tx;
}

/** The CAT_TILE class of the tile under (px[0], py[0]); NO_GO off the map. */
export function catTileAtScratch(c: CatTables): number {
  const tx = Math.floor((c.px[0] as number) / TILE_M);
  const ty = Math.floor((c.py[0] as number) / TILE_M);
  if (tx < 0 || ty < 0 || tx >= c.widthTiles || ty >= c.heightTiles) return CAT_TILE.NO_GO;
  return c.tile[ty * c.widthTiles + tx] as number;
}

/**
 * True when the straight line from NPC `i` to (px[0], py[0]) stays on the map and off NO_GO tiles (sampled every
 * SEGMENT_STEP_M, both ends included). Leaves px/py as they were.
 */
export function segmentClear(w: World, i: number): boolean {
  const c = w.npcAi.cat;
  const ax = w.npc.x[i] as number;
  const ay = w.npc.y[i] as number;
  const bx = c.px[0] as number;
  const by = c.py[0] as number;
  const dx = bx - ax;
  const dy = by - ay;
  const steps = Math.max(1, Math.ceil(sqrt(dx * dx + dy * dy) / SEGMENT_STEP_M));
  for (let k = 0; k <= steps; k += 1) {
    const tx = Math.floor((ax + (dx * k) / steps) / TILE_M);
    const ty = Math.floor((ay + (dy * k) / steps) / TILE_M);
    if (tx < 0 || ty < 0 || tx >= c.widthTiles || ty >= c.heightTiles) return false;
    if (c.tile[ty * c.widthTiles + tx] === CAT_TILE.NO_GO) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------------------------------------
// Searches
// ---------------------------------------------------------------------------------------------------------

/**
 * March from NPC `i`'s tile along axis direction `dir` (0 N, 1 E, 2 S, 3 W) across the road (see the header):
 * the target code of the far side (a free perch or the landing tile), or NO_TARGET. With `fromRoad` the cat is
 * already on the road (its own tile counts as crossed): the first OFF tile is the landing. Sets marchTiles.
 */
export function marchAcross(w: World, i: number, dir: number, fromRoad: boolean): number {
  const c = w.npcAi.cat;
  const handle = npcHandle(w.npc, i);
  const start = catTileOf(w, i);
  if (start < 0) return NO_TARGET;
  const sx = start % c.widthTiles;
  const sy = Math.floor(start / c.widthTiles);
  const ddx = DIR_X[dir as 0 | 1 | 2 | 3];
  const ddy = DIR_Y[dir as 0 | 1 | 2 | 3];
  const maxTiles = Math.floor(c.params.runReachM / TILE_M);
  let laneSeen = fromRoad;
  let pre = 0;
  for (let k = 1; k <= maxTiles; k += 1) {
    const tx = sx + ddx * k;
    const ty = sy + ddy * k;
    if (tx < 0 || ty < 0 || tx >= c.widthTiles || ty >= c.heightTiles) return NO_TARGET;
    const t = ty * c.widthTiles + tx;
    const cls = c.tile[t] as number;
    if (cls === CAT_TILE.NO_GO) return NO_TARGET;
    if (cls === CAT_TILE.LANE) {
      laneSeen = true;
      continue;
    }
    if (!laneSeen) {
      pre += 1;
      if (pre > MARCH_PRE_TILES) return NO_TARGET;
      continue;
    }
    c.marchTiles = k;
    if (cls === CAT_TILE.BAY) {
      const v = c.tileCar[t] as number;
      if (v >= 0 && isCatPerchFree(c, c.wallCount + v, handle)) return c.wallCount + v;
      continue;
    }
    // The far side's first OFF tile: a free wall perch on it or just beyond, else the tile itself.
    const wall = c.tileWall[t] as number;
    if (wall >= 0 && isCatPerchFree(c, wall, handle)) return wall;
    const nx = tx + ddx;
    const ny = ty + ddy;
    if (nx >= 0 && ny >= 0 && nx < c.widthTiles && ny < c.heightTiles) {
      const beyond = c.tileWall[ny * c.widthTiles + nx] as number;
      if (beyond >= 0 && isCatPerchFree(c, beyond, handle)) {
        c.marchTiles = k + 1;
        return beyond;
      }
    }
    return TILE_TARGET - t;
  }
  return NO_TARGET;
}

/** A dart's target for perched NPC `i`: the shortest crossing over the four axes (see the header), or NO_TARGET. */
export function findDartTarget(w: World, i: number): number {
  const c = w.npcAi.cat;
  let best = NO_TARGET;
  let bestTiles = 0x7fffffff;
  for (let dir = 0; dir < 4; dir += 1) {
    const code = marchAcross(w, i, dir, false);
    if (code === NO_TARGET) continue;
    if (c.marchTiles < bestTiles) {
      best = code;
      bestTiles = c.marchTiles;
    }
  }
  return best;
}

/**
 * Cover for NPC `i` (see the header): the nearest free perch within runReachM with a clear line (when `away`, one
 * farther from Bessie than the cat, falling back to any), never `exclude`; else off the road by the shortest
 * march (when `away`, not towards Bessie), or the cat's own tile when it is already off the road and not `away`.
 * NO_TARGET when there is none.
 */
export function findCover(w: World, i: number, away: boolean, exclude: number): number {
  const c = w.npcAi.cat;
  const npc = w.npc;
  const handle = npcHandle(w.npc, i);
  const x = npc.x[i] as number;
  const y = npc.y[i] as number;
  const bx = w.vehicle.xM;
  const by = w.vehicle.yM;
  const catToBessie2 = (x - bx) * (x - bx) + (y - by) * (y - by);
  const reach2 = c.params.runReachM * c.params.runReachM;
  for (let pass = away ? 0 : 1; pass < 2; pass += 1) {
    let best = NO_TARGET;
    let bestD2 = reach2;
    for (let p = 0; p < c.perchCount; p += 1) {
      if (p === exclude || !isCatPerchFree(c, p, handle)) continue;
      catTargetPos(c, p);
      const px = c.px[0] as number;
      const py = c.py[0] as number;
      const d2 = (px - x) * (px - x) + (py - y) * (py - y);
      if (!(d2 <= bestD2)) continue;
      if (pass === 0 && !((px - bx) * (px - bx) + (py - by) * (py - by) > catToBessie2)) continue;
      if (!segmentClear(w, i)) continue;
      best = p;
      bestD2 = d2;
    }
    if (best !== NO_TARGET) return best;
  }
  const start = catTileOf(w, i);
  const onRoad = start >= 0 && (c.tile[start] === CAT_TILE.LANE || c.tile[start] === CAT_TILE.BAY);
  if (!away && !onRoad) return start >= 0 ? TILE_TARGET - start : NO_TARGET;
  let best = NO_TARGET;
  let bestTiles = 0x7fffffff;
  for (let dir = 0; dir < 4; dir += 1) {
    // A bolt never runs towards Bessie: only directions square to her or away from her.
    if (away && DIR_X[dir as 0 | 1 | 2 | 3] * (x - bx) + DIR_Y[dir as 0 | 1 | 2 | 3] * (y - by) < 0) continue;
    const code = marchAcross(w, i, dir, onRoad);
    if (code === NO_TARGET || code === exclude) continue;
    if (c.marchTiles < bestTiles) {
      best = code;
      bestTiles = c.marchTiles;
    }
  }
  return best;
}

/**
 * A grooming spot for perched NPC `i` (see the header): uniformly among the spots within groomReachM with a clear
 * line, more than dartMaxM from Bessie, that no other cat grooms at (one `npc` draw when there is at least one).
 * Returns its tile target, or NO_TARGET.
 */
export function pickGroomSpot(w: World, i: number): number {
  const c = w.npcAi.cat;
  const npc = w.npc;
  const x = npc.x[i] as number;
  const y = npc.y[i] as number;
  const bx = w.vehicle.xM;
  const by = w.vehicle.yM;
  const reach2 = c.params.groomReachM * c.params.groomReachM;
  const far2 = c.params.dartMaxM * c.params.dartMaxM;
  let n = 0;
  for (let s = 0; s < c.spotCount; s += 1) {
    const code = TILE_TARGET - (c.spotTile[s] as number);
    catTargetPos(c, code);
    const px = c.px[0] as number;
    const py = c.py[0] as number;
    if ((px - x) * (px - x) + (py - y) * (py - y) > reach2) continue;
    if (!((px - bx) * (px - bx) + (py - by) * (py - by) > far2)) continue;
    if (spotTaken(w, i, code)) continue;
    if (!segmentClear(w, i)) continue;
    c.eligible[n] = code;
    n += 1;
  }
  if (n === 0) return NO_TARGET;
  return c.eligible[nextInt(w.npcAi.rng, n)] as number;
}

/** True when another cat than `i` grooms at, or walks out to, tile target `code` (the GROOM state, 2). */
function spotTaken(w: World, i: number, code: number): boolean {
  const npc = w.npc;
  const kind = w.npcAi.cat.params.kind;
  for (let j = 0; j < npc.count; j += 1) {
    if (j === i || npc.kind[j] !== kind) continue;
    if (npc.state[j] === CAT_GROOM_STATE && npc.timerA[j] !== 0 && npc.timerB[j] === code) return true;
  }
  return false;
}

/** The cat's Groom state id (behaviours/cat.ts CAT.Groom), here to keep this module free of the behaviour. */
export const CAT_GROOM_STATE = 2;

// ---------------------------------------------------------------------------------------------------------
// Placement (the spawner)
// ---------------------------------------------------------------------------------------------------------

/** True when the level has at least one place on `surface` (a CAT_SURFACE). */
export function catSurfaceHasPlaces(c: CatTables, surface: number): boolean {
  if (surface === CAT_SURFACE.Walls) return c.wallCount > 0;
  if (surface === CAT_SURFACE.CarRoofs) return c.roofCount > 0;
  return c.spotCount > 0;
}

/** The surface the next placed cat goes on: perches.on in turn, skipping surfaces with no place; −1 for none. */
export function nextCatSurface(c: CatTables, placed: number): number {
  const n = c.surfaces.length;
  for (let k = 0; k < n; k += 1) {
    const s = c.surfaces[(placed + k) % n] as number;
    if (catSurfaceHasPlaces(c, s)) return s;
  }
  return -1;
}

/**
 * A place for a cat on `surface` (spawner.ts): uniformly (one `npc` draw) among the free perches, or the spots no
 * cat grooms at, whose cat circle does not touch the view. Returns the perch index, or for a spot
 * TILE_TARGET − spot index (the spot's index in spotTile, not its tile), and writes its position into px, py;
 * NO_TARGET when none is free off screen now.
 */
export function pickCatPlacement(w: World, surface: number): number {
  const c = w.npcAi.cat;
  const view = w.viewRect;
  let n = 0;
  if (surface === CAT_SURFACE.Road) {
    for (let s = 0; s < c.spotCount; s += 1) {
      catTargetPos(c, TILE_TARGET - (c.spotTile[s] as number));
      if (circleTouchesViewRect(view, c.px, c.py, 0, c.radius, 0)) continue;
      if (spotTaken(w, -1, TILE_TARGET - (c.spotTile[s] as number))) continue;
      c.eligible[n] = s;
      n += 1;
    }
    if (n === 0) return NO_TARGET;
    const s = c.eligible[nextInt(w.npcAi.rng, n)] as number;
    catTargetPos(c, TILE_TARGET - (c.spotTile[s] as number));
    return TILE_TARGET - s;
  }
  const from = surface === CAT_SURFACE.Walls ? 0 : c.wallCount;
  const to = surface === CAT_SURFACE.Walls ? c.wallCount : c.perchCount;
  for (let p = from; p < to; p += 1) {
    if (!isCatPerchFree(c, p, -1)) continue;
    catTargetPos(c, p);
    if (circleTouchesViewRect(view, c.px, c.py, 0, c.radius, 0)) continue;
    c.eligible[n] = p;
    n += 1;
  }
  if (n === 0) return NO_TARGET;
  const p = c.eligible[nextInt(w.npcAi.rng, n)] as number;
  catTargetPos(c, p);
  return p;
}

/** True when NPC `i` is riding (or leaping onto or off) Bessie's roof. */
export function isOnRoof(w: World, i: number): boolean {
  return ((w.npc.flags[i] as number) & NPC_FLAG.ON_ROOF) !== 0;
}
