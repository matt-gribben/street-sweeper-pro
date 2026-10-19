// Per-wheel surface sampling (TECHNICAL_DESIGN §8.2 step 7, GDD §7.3, SSP-035). The World samples the tile
// surface grid under Bessie's four wheel contact points before phase 2 and hands stepVehicle the average
// lateral grip k and the average rolling-drag multiplier.
//
// Averaging rollMult per wheel (rather than a majority vote) was the SSP-035 proposal and is the implemented
// rule: two wheels on the verge give half the grass drag, which makes the change of drag continuous as Bessie
// rolls onto the grass. It is recorded in TECHNICAL_DESIGN §8.2 step 7 for lead review.
//
// Wheel geometry is the provisional tuning body block (SSP-029): contact points at vehicle-local
// (±wheelTrackM / 2, frontAxleOffsetM) and (±wheelTrackM / 2, rearAxleOffsetM). Points outside the map read as
// void, which takes asphalt grip (map.ts GROUND_SURFACE); static collision keeps Bessie inside anyway.
//
// Hazard overrides (puddle, oil, wet leaves) are an M3 hook (SSP-093): it replaces the per-wheel surface id
// lookup in surfaceAt with one that checks hazard footprints first. The rain switch (asphalt → rainAsphalt)
// is a later hook on the table. Everything here is allocation-free per tick.
import { TILE_M } from './constants.ts';
import { cos, sin } from './fmath.ts';
import { type Level, SURFACE_COUNT, Surface } from './map.ts';
import type { SweeperTuning } from './tuning.ts';
import type { VehicleSurface } from './vehicle.ts';

/**
 * Grip and rolling-drag multiplier per Surface id, built once per World from the tuning.
 *
 * The keys deliberately differ from VehicleSurface's (gripPerS, rollMult). V8 shares hidden-class transitions
 * between objects that add the same keys in the same order, so a table holding Float64Arrays under those keys
 * generalised every VehicleSurface's fields to tagged, and each per-tick double store then allocated a 16 B
 * HeapNumber (found by the World heap-delta test, SSP-035).
 */
export type SurfaceTable = {
  /** Lateral grip decay rate k (1/s), indexed by Surface id. */
  readonly gripPerSById: Float64Array;
  /** Rolling-drag multiplier, indexed by Surface id: drag.grassRollingMul on grass, 1 elsewhere. */
  readonly rollMultById: Float64Array;
};

/** Build the per-surface lookup from tuning.json's lateralGripPerS and drag groups. Allocates; call once. */
export function createSurfaceTable(tuning: SweeperTuning): SurfaceTable {
  const grip = tuning.lateralGripPerS;
  const gripPerSById = new Float64Array(SURFACE_COUNT);
  gripPerSById[Surface.Asphalt] = grip.asphalt;
  gripPerSById[Surface.Pavement] = grip.pavement;
  gripPerSById[Surface.Grass] = grip.grass;
  gripPerSById[Surface.Puddle] = grip.wet;
  gripPerSById[Surface.WetLeaves] = grip.wetLeaves;
  gripPerSById[Surface.Oil] = grip.oil;
  const rollMultById = new Float64Array(SURFACE_COUNT).fill(1);
  rollMultById[Surface.Grass] = tuning.drag.grassRollingMul;
  return { gripPerSById, rollMultById };
}

/**
 * Surface id of tile (col, row); void (asphalt grip) outside the map. Takes integer tile indices, which V8
 * passes as small integers: a helper taking metre doubles would allocate a 16 B box per argument whenever
 * the optimised tick does not inline it.
 */
export function surfaceAtTile(level: Level, col: number, row: number): number {
  const w = level.size[0];
  if (col < 0 || row < 0 || col >= w || row >= level.size[1]) return Surface.Asphalt;
  // In range by the check above.
  return level.layers.surface[row * w + col] as number;
}

/** Surface id of the tile containing sim point (xM, yM). Not for the per-tick path (see surfaceAtTile). */
export function surfaceAt(level: Level, xM: number, yM: number): number {
  return surfaceAtTile(level, Math.floor(xM / TILE_M), Math.floor(yM / TILE_M));
}

/** A body pose: centre in sim metres, heading in radians (VehicleState satisfies it). */
export type Pose = { readonly xM: number; readonly yM: number; readonly headingRad: number };

/**
 * Sample the surface under the four wheel contact points of a body at `pose`, and write the average grip k
 * and average rolling-drag multiplier into `out`. The pose travels as an object, not three doubles, because
 * V8 boxes double arguments of calls it does not inline.
 *
 * Hot-path rule found here (SSP-035): helpers called per tick take objects or integers, never metre doubles,
 * and never return a double, unless they are tiny (fmath's one-liners are always inlined).
 */
export function sampleSurface(
  level: Level,
  table: SurfaceTable,
  tuning: SweeperTuning,
  pose: Pose,
  out: VehicleSurface,
): VehicleSurface {
  const body = tuning.body;
  const xM = pose.xM;
  const yM = pose.yM;
  const headingRad = pose.headingRad;
  // forward = (sin θ, −cos θ), right = (cos θ, sin θ) (TECHNICAL_DESIGN §4).
  const s = sin(headingRad);
  const c = cos(headingRad);
  const fx = s;
  const fy = -c;
  const halfTrack = body.wheelTrackM / 2;
  const rx = c * halfTrack;
  const ry = s * halfTrack;
  const frontX = xM + fx * body.frontAxleOffsetM;
  const frontY = yM + fy * body.frontAxleOffsetM;
  const rearX = xM + fx * body.rearAxleOffsetM;
  const rearY = yM + fy * body.rearAxleOffsetM;

  const fl = surfaceAtTile(level, Math.floor((frontX - rx) / TILE_M), Math.floor((frontY - ry) / TILE_M));
  const fr = surfaceAtTile(level, Math.floor((frontX + rx) / TILE_M), Math.floor((frontY + ry) / TILE_M));
  const rl = surfaceAtTile(level, Math.floor((rearX - rx) / TILE_M), Math.floor((rearY - ry) / TILE_M));
  const rr = surfaceAtTile(level, Math.floor((rearX + rx) / TILE_M), Math.floor((rearY + ry) / TILE_M));

  // Surface ids are always < SURFACE_COUNT (decodeLevel range-checks the layer), so the reads are in range.
  const g = table.gripPerSById;
  const m = table.rollMultById;
  out.gripPerS = ((g[fl] as number) + (g[fr] as number) + (g[rl] as number) + (g[rr] as number)) / 4;
  out.rollMult = ((m[fl] as number) + (m[fr] as number) + (m[rl] as number) + (m[rr] as number)) / 4;
  return out;
}
