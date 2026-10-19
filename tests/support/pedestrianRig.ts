// Shared rig for the per-type pedestrian behaviour tests (tests/unit/behaviours/, SSP-084): the open district of
// npcTown.ts (48 × 48 tiles, 96 m square, a nav grid every 8 m with doors and edge portals, no population unless
// asked for), Bessie at its centre (48, 48) facing north, and helpers to add people by hand the way the spawner
// does, pin them in place between ticks, hold Bessie's speed and honk.
import { NPC_IDS, type NpcId } from '../../src/sim/entities.ts';
import { createInputFrame, type InputFrame, PRESSED } from '../../src/sim/inputFrame.ts';
import type { LitterSpawn, NpcSpawn } from '../../src/sim/map.ts';
import { litterFieldLength } from '../../src/sim/map.ts';
import {
  addNpcAt,
  NpcOrigin,
  resolveNpcHandle,
  setNpcState,
  updateNpcCell,
} from '../../src/sim/npc/store.ts';
import { DEFAULT_TUNING } from '../../src/sim/tuning.ts';
import { createWorld, type World } from '../../src/sim/world.ts';
import { npcTown } from './npcTown.ts';
import { compileTown } from './steeringTown.ts';

export const BODY = DEFAULT_TUNING.vehicle.sweeper.body;
export const HALF_L = BODY.lengthM / 2;
export const HALF_W = BODY.widthM / 2;
export const HUMAN_R = DEFAULT_TUNING.streetLife.npcRadius.humanM;
/** Bessie's start: the town centre, facing north. */
export const CENTRE = 48;
/** Town size in tiles. */
export const TOWN_TILES = 48;

export function kindOf(id: NpcId): number {
  return NPC_IDS.indexOf(id);
}

export type TownOptions = {
  /** The NPC spawn spec (default: none, so the spawner adds nobody). */
  npc?: Partial<NpcSpawn>;
  /** A district litter table, by litter id and weight (default: none; spills fall back to crisp packets). */
  litterTable?: { id: string; weight: number }[];
};

/** The open test district with Bessie at (48, 48) facing north. */
export function townWorld(seed: number, options: TownOptions = {}): World {
  const { level } = npcTown(TOWN_TILES, options.npc ?? {});
  if (options.litterTable !== undefined) {
    const n = litterFieldLength(TOWN_TILES, TOWN_TILES);
    const litter: LitterSpawn = {
      initial: 0,
      minSpacingM: 0.5,
      table: [...options.litterTable]
        .sort((a, b) => (a.id < b.id ? -1 : 1))
        .map((e) => ({ id: e.id, weight: e.weight, requires: 0 })),
      places: new Uint8Array(n),
      weights: new Uint16Array(n),
    };
    level.litter = litter;
  }
  return createWorld(level, seed, DEFAULT_TUNING);
}

/**
 * The compiled steering town (steeringTown.ts: 80 × 22 m, a pavement nav graph a node per tile, terrace doors,
 * map-edge portals, a zebra) with the NPC spawn spec `npc` (empty by default: the spawner runs, for its
 * retirements, but adds nobody). Non-jaywalkers can walk only here: npcTown's open road has a nav node only every
 * 8 m, and they may stand only on nav tiles.
 */
export function pavementWorld(seed: number, npc: Partial<NpcSpawn> = {}): World {
  const level = compileTown();
  level.npc = { population: [], mix: [], caps: [], named: [], perches: null, flocks: [], ...npc };
  return createWorld(level, seed, DEFAULT_TUNING);
}

/**
 * Add a person of `id` at (x, y) as the spawner would: its radius, walking speed, behaviour's first state and
 * its behaviour's onSpawn. Returns its index.
 */
export function addPerson(world: World, id: NpcId, x: number, y: number): number {
  const kind = kindOf(id);
  const i = addNpcAt(world.npc, kind, NpcOrigin.Ambient, x, y);
  if (i < 0) throw new Error('store full');
  world.npc.radius[i] = HUMAN_R;
  world.npc.walkMps[i] = world.npcAi.spawner.speedByKind[kind] as number;
  const behaviour = world.npcAi.behaviours[kind];
  setNpcState(world.npc, i, behaviour?.initial ?? 0);
  behaviour?.onSpawn?.(world, i);
  return i;
}

/** Put NPC `handle` at (x, y) between ticks (a test standing in for its own walk). Returns its index. */
export function place(world: World, handle: number, x: number, y: number): number {
  const i = resolveNpcHandle(world.npc, handle);
  world.npc.x[i] = x;
  world.npc.y[i] = y;
  updateNpcCell(world.npc, i);
  return i;
}

/** Bessie rolling along her heading at `speedMps` with no yaw and the wheel straight. */
export function holdBessie(world: World, speedMps: number): void {
  const v = world.vehicle;
  v.vLongMps = speedMps;
  v.vLatMps = 0;
  v.yawRateRadPerS = 0;
  v.steerRad = 0;
}

export const neutral: InputFrame = createInputFrame();

/** A frame carrying the HORN pressed edge. */
export function honk(): InputFrame {
  const f = createInputFrame();
  f.pressed = PRESSED.HORN;
  return f;
}
