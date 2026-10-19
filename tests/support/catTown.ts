// The cat's test street (SSP-087): an ASCII map with garden walls, parking bays and a perch spec, run through the
// real level compiler (tools/levels/compile-level.ts) like trafficTown.ts, so the wall perches, the parked cars
// (their roof perches), the lane graph (the grooming spots) and the tile layers are what a shipped level carries.
// Plus helpers to add a cat by hand the way the spawner does and to put Bessie somewhere between ticks.
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TILE_M } from '../../src/sim/constants.ts';
import { NPC_IDS } from '../../src/sim/entities.ts';
import { decodeLevel, type Level } from '../../src/sim/map.ts';
import { addNpcAt, NpcOrigin, setNpcState } from '../../src/sim/npc/store.ts';
import { DEFAULT_TUNING } from '../../src/sim/tuning.ts';
import { createWorld, type World } from '../../src/sim/world.ts';
import { compileLevel, formatDiagnostic } from '../../tools/levels/compile-level.ts';
import { KERB_BLOB_PATH, readKerbBlob } from '../../tools/levels/kerbBlob.ts';
import type { LayoutCode } from '../../tools/levels/layoutChecks.ts';
import { townLevelText } from './steeringTown.ts';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const KERB_BLOB = readKerbBlob(join(REPO_ROOT, KERB_BLOB_PATH));
const KNOWN = new Set(['roof.slate', 'roof.felt', 'facade.terrace_brick', 'facade.corner_shop']);
const LAYOUT_CODES: readonly LayoutCode[] = ['L014', 'L015', 'L020', 'L021', 'L022'];

/**
 * The cat street, 100 × 9 tiles (200 × 18 m): terraces (rows 0 and 8), garden walls `w` in front of them (rows
 * 1 and 7, columns 10–19, 40–49 and 70–79), 1-tile pavements (rows 2 and 6) and a 3-tile two-way road (rows 3–5)
 * off both map edges, with two 10-cell runs of parking bays `p` on its south row (columns 20–29 and 60–69: 10
 * bays). Bessie's start is mid-road at column 50 (centre (101, 9), facing east).
 */
export const CAT_STREET: readonly string[] = (() => {
  const walls = (x: number): boolean => (x >= 10 && x <= 19) || (x >= 40 && x <= 49) || (x >= 70 && x <= 79);
  const row = (f: (x: number) => string): string => Array.from({ length: 100 }, (_, x) => f(x)).join('');
  return [
    row(() => 'A'),
    row((x) => (walls(x) ? 'w' : '.')),
    row(() => '.'),
    row(() => '#'),
    row((x) => (x === 50 ? '@' : '#')),
    row((x) => ((x >= 20 && x <= 29) || (x >= 60 && x <= 69) ? 'p' : '#')),
    row(() => '.'),
    row((x) => (walls(x) ? 'w' : '.')),
    row(() => 'B'),
  ];
})();

export type CatTownOptions = {
  /** npcs.perches (default: none, so the spawner places no cat). */
  perches?: { count: number; on: ('walls' | 'carRoofs' | 'road')[] };
  /** traffic.parkedFill (default 1: every bay holds a car). */
  parkedFill?: number;
};

/** Compile `rows` with the perch and parked-car specs and decode it. Throws on a diagnostic error. */
export function compileCatTown(rows: readonly string[] = CAT_STREET, options: CatTownOptions = {}): Level {
  const level = JSON.parse(townLevelText(rows)) as Record<string, unknown>;
  level.traffic = {
    densityPerKm: 0,
    mix: { 'veh.hatchback': 1 },
    parkedFill: options.parkedFill ?? 1,
    parkedMix: { 'veh.hatchback_parked': 1 },
  };
  if (options.perches !== undefined) {
    level.npcs = {
      population: [{ from: 0, to: 240, target: 0 }],
      mix: { 'npc.shopper': 1 },
      perches: { id: 'npc.cat', ...options.perches },
    };
  }
  const result = compileLevel({
    name: 'steering',
    mapText: rows.map((r) => `${r}\n`).join(''),
    levelText: `${JSON.stringify(level, null, 2)}\n`,
    knownAssetIds: KNOWN,
    kerbBlob: KERB_BLOB,
    skipCodes: LAYOUT_CODES,
  });
  if (result.output === null) {
    throw new Error(`compileCatTown: ${result.diagnostics.map(formatDiagnostic).join('\n')}`);
  }
  return decodeLevel(result.output.text);
}

/** A World on the cat street (seeded), Bessie at her start. */
export function catWorld(seed: number, options: CatTownOptions = {}): World {
  return createWorld(compileCatTown(CAT_STREET, options), seed, DEFAULT_TUNING);
}

export const CAT_KIND = NPC_IDS.indexOf('npc.cat');
export const CAT_R = DEFAULT_TUNING.streetLife.npcRadius.catM;

/** The centre of tile (tx, ty), metres. */
export function tileCentre(tx: number, ty: number): [number, number] {
  return [(tx + 0.5) * TILE_M, (ty + 0.5) * TILE_M];
}

/**
 * Add a perched cat as the spawner does: origin Perch, `group` = the perch it is placed on (catPerches index;
 * −1 for none), at that perch (or at (x, y) when given), its radius and dart speed, then its behaviour's onSpawn.
 * Returns its index.
 */
export function addCat(world: World, group: number, x?: number, y?: number): number {
  const c = world.npcAi.cat;
  let px = x ?? 0;
  let py = y ?? 0;
  if (x === undefined || y === undefined) {
    if (group < c.wallCount) {
      px = c.wallX[group] as number;
      py = c.wallY[group] as number;
    } else {
      px = world.vehicles.x[group - c.wallCount] as number;
      py = world.vehicles.y[group - c.wallCount] as number;
    }
  }
  const i = addNpcAt(world.npc, CAT_KIND, NpcOrigin.Perch, px, py);
  if (i < 0) throw new Error('store full');
  world.npc.group[i] = group;
  world.npc.radius[i] = CAT_R;
  world.npc.walkMps[i] = world.npcAi.spawner.speedByKind[CAT_KIND] as number;
  const b = world.npcAi.behaviours[CAT_KIND];
  setNpcState(world.npc, i, b?.initial ?? 0);
  b?.onSpawn?.(world, i);
  return i;
}

/** The wall perch on tile (tx, ty) (throws when there is none). */
export function wallPerchAt(world: World, tx: number, ty: number): number {
  const p = world.npcAi.cat.tileWall[ty * world.npcAi.cat.widthTiles + tx] as number;
  if (p < 0) throw new Error(`no wall perch on tile (${tx}, ${ty})`);
  return p;
}

/** The roof perch of the parked car whose body covers tile (tx, ty) (throws when there is none). */
export function roofPerchAt(world: World, tx: number, ty: number): number {
  const c = world.npcAi.cat;
  const v = c.tileCar[ty * c.widthTiles + tx] as number;
  if (v < 0) throw new Error(`no parked car on tile (${tx}, ${ty})`);
  return c.wallCount + v;
}

/** Put Bessie at (x, y) facing `headingRad`, at rest, between ticks (prev pose too, so she has not moved). */
export function putBessie(world: World, x: number, y: number, headingRad = Math.PI / 2): void {
  const v = world.vehicle;
  v.xM = x;
  v.yM = y;
  v.prevXM = x;
  v.prevYM = y;
  v.headingRad = headingRad;
  v.prevHeadingRad = headingRad;
  v.vLongMps = 0;
  v.vLatMps = 0;
  v.yawRateRadPerS = 0;
  v.steerRad = 0;
}
