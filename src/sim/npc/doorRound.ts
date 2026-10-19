// The postie's round (ENTITY_CATALOG §6.2, LEVEL_DESIGN §7.10; SSP-085): the frontage doors of the level in the
// order he walks them, built once per shift. A door is the nav node in front of a frontage's facade (SSP-076,
// level.nav.doors); frontages sharing a door node make one stop.
//
// The order is a greedy nearest-neighbour tour, started at the first door of level.nav.doors (frontage order),
// over a walking-cost estimate: the straight-line distance between two doors plus ROUND_DETOUR_PER_M for every
// metre of that line over a road or a blocked tile (sampled every ROUND_SAMPLE_M). So he works along one side of
// a street, door after door, before he crosses it or goes round a block, without the cost of planning a path
// between every pair of doors at shift start. Ties go to the lower round entry. The postie behaviour
// (behaviours/postie.ts) joins the round at the door nearest him and then loops it in order.
//
// Setup only: createDoorRound allocates; reading the tables per tick does not.
import { TILE_M } from '../constants.ts';
import { sqrt } from '../fmath.ts';
import type { Face, Level } from '../map.ts';
import { STEER_TILE, type Steering } from './steering.ts';

/** Extra walking cost per metre of straight line over a road or a blocked tile (a detour or a crossing). */
export const ROUND_DETOUR_PER_M = 8;
/** The straight line between two doors is sampled every this many metres. */
export const ROUND_SAMPLE_M = 0.5;

/** The round: `count` unique door nodes in walking order. */
export type DoorRound = {
  readonly count: number;
  /** Nav node of each stop, in round order. */
  readonly node: Int32Array;
  /** The heading (0 = north, clockwise) that faces the facade of each stop's (first) frontage. */
  readonly faceRad: Float64Array;
  /** Per nav node: its round index, −1 for a node that is not a door. */
  readonly roundAt: Int32Array;
};

/** The heading that looks at a facade facing `face` (a south-facing front is looked at facing north). */
function lookAt(face: Face): number {
  switch (face) {
    case 'n':
      return Math.PI;
    case 'e':
      return -Math.PI / 2;
    case 's':
      return 0;
    case 'w':
      return Math.PI / 2;
  }
}

/** The detour term of `off` of `samples` samples over a line of `d` metres. */
function detour(d: number, off: number, samples: number): number {
  return d + (samples > 0 ? (off * d) / samples : 0) * ROUND_DETOUR_PER_M;
}

/**
 * The walking-cost estimate between nav nodes `a` and `b` (see the file comment), or +∞ as soon as it is known
 * to be at least `bound` (the nearest door so far): the cost never falls below the straight-line distance and
 * only grows with each sample off the pavement, so the pruned door could never have won.
 */
function roundCost(level: Level, st: Steering, a: number, b: number, bound: number): number {
  const nav = level.nav;
  const ax = nav.nodeX[a] as number;
  const ay = nav.nodeY[a] as number;
  const dx = (nav.nodeX[b] as number) - ax;
  const dy = (nav.nodeY[b] as number) - ay;
  const d = sqrt(dx * dx + dy * dy);
  if (d >= bound) return Number.POSITIVE_INFINITY;
  const samples = Math.ceil(d / ROUND_SAMPLE_M);
  let off = 0;
  for (let s = 1; s < samples; s += 1) {
    const t = s / samples;
    const tx = Math.floor((ax + dx * t) / TILE_M);
    const ty = Math.floor((ay + dy * t) / TILE_M);
    const outside = tx < 0 || ty < 0 || tx >= st.widthTiles || ty >= st.heightTiles;
    if (
      !outside &&
      ((st.tileFlags[ty * st.widthTiles + tx] as number) & (STEER_TILE.ROAD | STEER_TILE.BLOCKED)) === 0
    )
      continue;
    off += 1;
    if (detour(d, off, samples) >= bound) return Number.POSITIVE_INFINITY;
  }
  return detour(d, off, samples);
}

/** The round of `level`'s doors (see the file comment). Setup only. */
export function createDoorRound(level: Level, st: Steering): DoorRound {
  const nav = level.nav;
  const faceOf = new Map(level.frontages.map((f) => [f.id, f.face]));
  const nodes: number[] = [];
  const faces: number[] = [];
  const seen = new Set<number>();
  for (const door of nav.doors) {
    if (seen.has(door.node)) continue;
    seen.add(door.node);
    nodes.push(door.node);
    const face = faceOf.get(door.frontage);
    faces.push(face === undefined ? 0 : lookAt(face));
  }
  const n = nodes.length;
  const order: number[] = [];
  const used = new Uint8Array(n);
  let at = 0;
  for (let k = 0; k < n; k += 1) {
    order.push(at);
    used[at] = 1;
    let best = -1;
    let bestCost = Number.POSITIVE_INFINITY;
    for (let j = 0; j < n; j += 1) {
      if (used[j] === 1) continue;
      const c = roundCost(level, st, nodes[at] as number, nodes[j] as number, bestCost);
      if (c < bestCost) {
        bestCost = c;
        best = j;
      }
    }
    if (best < 0) break;
    at = best;
  }
  const roundAt = new Int32Array(nav.nodeCount).fill(-1);
  order.forEach((j, k) => {
    roundAt[nodes[j] as number] = k;
  });
  return {
    count: n,
    node: Int32Array.from(order, (j) => nodes[j] as number),
    faceRad: Float64Array.from(order, (j) => faces[j] as number),
    roundAt,
  };
}
