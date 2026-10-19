// Worlds built straight from a raw collide grid, for the collision property tests (SSP-037, TECHNICAL_DESIGN
// §9.5). No ASCII map and no file compiler: the grid's SOLID cells are merged with `mergeSolids`, the level
// goes through `encodeLevel` → `decodeLevel` (so it is exactly what the game would load from a compiled
// level file, and a malformed one throws), and `createWorld` builds the World from it.
import {
  COLLIDE,
  createBlankLevel,
  decodeLevel,
  encodeLevel,
  Ground,
  type KnockableSpawn,
  type Level,
  type LevelProp,
  mergeSolids,
  type PlayerStart,
  Surface,
} from '../../src/sim/map.ts';
import { DEFAULT_TUNING, type Tuning } from '../../src/sim/tuning.ts';
import { createWorld, type World } from '../../src/sim/world.ts';

/** What a grid world is made of. `collide` is a w × h collide layer (COLLIDE bits), row-major. */
export type CollideGridSpec = {
  readonly w: number;
  readonly h: number;
  readonly collide: Uint8Array;
  /** Bessie's spawn: body centre in metres, heading in radians (0 = north, clockwise). */
  readonly player: PlayerStart;
  /** Static props (positions in metres); each id needs a footprint in the tuning's `propFootprints`. */
  readonly props?: readonly LevelProp[];
  /** Knockable props (`spawns.knockables`, positions in metres); none when absent (SSP-092). */
  readonly knockables?: readonly KnockableSpawn[];
};

/**
 * A level whose collision comes from `spec.collide`: SOLID cells are void ground, every other cell is
 * asphalt road, and `solids` is `mergeSolids` of the grid, as the compiler writes it. Round-tripped through
 * encodeLevel/decodeLevel.
 */
export function levelFromCollideGrid(spec: CollideGridSpec, id = 'test.collision_grid'): Level {
  const { w, h, collide } = spec;
  if (collide.length !== w * h) {
    throw new Error(`levelFromCollideGrid: collide has ${collide.length} cells, expected ${w}×${h}`);
  }
  const level = createBlankLevel(id, w, h);
  level.layers.collide.set(collide);
  for (let i = 0; i < w * h; i += 1) {
    const solid = ((collide[i] ?? 0) & COLLIDE.SOLID) !== 0;
    level.layers.ground[i] = solid ? Ground.Void : Ground.Road;
    level.layers.surface[i] = Surface.Asphalt;
  }
  level.solids = mergeSolids(level.layers.collide, w, h);
  level.props = spec.props === undefined ? [] : spec.props.map((p) => ({ ...p }));
  level.knockables = spec.knockables === undefined ? null : spec.knockables.map((k) => ({ ...k }));
  level.player = { x: spec.player.x, y: spec.player.y, heading: spec.player.heading };
  return decodeLevel(encodeLevel(level));
}

/** A World on `levelFromCollideGrid(spec)`. The tuning defaults to the committed tuning.json. */
export function worldFromCollideGrid(
  spec: CollideGridSpec,
  tuning: Tuning = DEFAULT_TUNING,
  seed = 1,
): World {
  return createWorld(levelFromCollideGrid(spec), seed, tuning);
}
