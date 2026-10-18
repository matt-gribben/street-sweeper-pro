// Coordinate conventions (TECHNICAL_DESIGN §4), fixed here once and asserted in tests/unit/coords.test.ts.
// Sim world: origin at the NW corner of the district, +x east, +y south, metres. Heading θ: radians,
// 0 = north (screen up), increasing clockwise. Forward = (sin θ, −cos θ), right = (cos θ, sin θ).
// Every function is allocation-free: vector results are written into a caller-supplied out object.
import { GRIME_CELL_M, TILE_M } from './constants.ts';
import { cos, sin } from './fmath.ts';

/** A mutable 2D vector in sim space (metres, or a unit direction). */
export type Vec2 = { x: number; y: number };

/** Number of rendered vehicle headings, h00..h31 (TECHNICAL_DESIGN §4, ART_BIBLE §4.5). */
export const VEHICLE_HEADING_COUNT = 32;

/** Angle between neighbouring vehicle headings: 2π / 32 rad (11.25°). */
export const VEHICLE_HEADING_STEP_RAD = (2 * Math.PI) / VEHICLE_HEADING_COUNT;

/** The 8 actor directions in index order, clockwise from north (TECHNICAL_DESIGN §4). */
export const ACTOR_DIRS = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'] as const;
export type ActorDir = (typeof ACTOR_DIRS)[number];

/** Angle between neighbouring actor directions: π / 4 rad (45°). */
export const ACTOR_DIR_STEP_RAD = Math.PI / 4;

/** Write the unit forward vector for heading θ, `(sin θ, −cos θ)`, into `out` and return it. */
export function headingForward(headingRad: number, out: Vec2): Vec2 {
  out.x = sin(headingRad);
  out.y = -cos(headingRad);
  return out;
}

/** Write the unit right vector for heading θ, `(cos θ, sin θ)`, into `out` and return it. */
export function headingRight(headingRad: number, out: Vec2): Vec2 {
  out.x = cos(headingRad);
  out.y = sin(headingRad);
  return out;
}

/** Wrap an integer step count into [0, count). `| 0` folds Math.round's −0 into a plain 0. */
function wrapIndex(steps: number, count: number): number {
  return (((steps % count) + count) % count) | 0;
}

/**
 * Vehicle sprite frame index 0..31 for heading θ: `((round(θ / (2π/32)) % 32) + 32) % 32` → h00..h31
 * (TECHNICAL_DESIGN §4). h00 faces north and each step is 11.25° clockwise, matching the Blender rig.
 * Any finite θ is accepted; negative or beyond 2π wraps.
 */
export function vehicleFrameIndex(headingRad: number): number {
  return wrapIndex(Math.round(headingRad / VEHICLE_HEADING_STEP_RAD), VEHICLE_HEADING_COUNT);
}

/** 8-way actor direction index 0..7 for heading θ: `round(θ / (π/4)) mod 8`, indexing ACTOR_DIRS. */
export function actorDirIndex(headingRad: number): number {
  return wrapIndex(Math.round(headingRad / ACTOR_DIR_STEP_RAD), ACTOR_DIRS.length);
}

/** 8-way actor direction (n, ne, e, se, s, sw, w, nw) for heading θ. */
export function actorDir(headingRad: number): ActorDir {
  // actorDirIndex is always 0..7, so the lookup never misses; the fallback only satisfies the type checker.
  return ACTOR_DIRS[actorDirIndex(headingRad)] ?? 'n';
}

/** Map tile column or row containing the sim coordinate `m` (metres): `floor(m / 2)`. */
export function tileOf(m: number): number {
  return Math.floor(m / TILE_M);
}

/** Grime-mask cell column or row containing the sim coordinate `m` (metres): `floor(m / 0.25)`. */
export function grimeCellOf(m: number): number {
  return Math.floor(m / GRIME_CELL_M);
}
