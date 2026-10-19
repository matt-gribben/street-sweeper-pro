// The NPC population controller (LEVEL_DESIGN §9.4, TECHNICAL_DESIGN §7.4, SSP-080). It runs the level's
// compiled `spawns.npc` spec (SSP-077) in phase 7 with the `npc` stream, sfc32(seed ^ hash32('npc')), and is
// the only code that adds NPCs to or removes them from the store. Everything it does is a pure function of
// the seed, the level, the tick and sim state; it never reads the render camera, only world.viewRect.
//
// Each tick, in this order:
//   1. Named NPCs (Doris, dog walkers on loops, later the Inspector): on the tick `spawnAtS × 60` (or the first
//      tick after it with room in the store) all `count` of them appear at their anchor's nav node, whatever
//      the view: they are authored arrivals at a door, not pop-in. They persist for the shift.
// Then, on every NPC_SPAWN_EVERY_TICKS-th tick (tick mod 60 == 0, so once in every 60-tick window):
//   2. Placed NPCs still waiting: each perched cat on a free wall perch (`perches.walls`) that does not touch
//      the view (on a nav spawn point when the level lists no wall perches; car roofs and road grooming spots
//      are SSP-087/SSP-090), and each flock of `size` birds (drawn per flock) scattered within FLOCK_SPREAD_M
//      of a flock point whose whole spread is off screen. Placed NPCs persist for the shift too.
//   3. The ambient population, with at most NPC_MAX_CHANGES (2) spawns and retirements together. Each of the
//      two changes is, in order of preference:
//      a. a spawn, while the live ambient count is under the current `population` window's target (0 outside
//         every window): its kind by `mix` weight among the kinds under their `caps` that fit in the store
//         (one nextFloat), then its spawn point uniformly (one nextInt) among the spawn points (map-edge
//         portals, frontage doors and anchors of the nav graph) whose circle does not touch the view and that
//         lie within NPC_DESPAWN_M of Bessie, so it is not retired at once. No eligible point, no spawn (and no
//         draw);
//      b. otherwise a retirement: the ambient NPC farthest beyond NPC_DESPAWN_M (40 m) of Bessie whose circle
//         (and its dog's) does not touch the view leaves (lowest index on a tie), but only when the street is
//         over its target or a spawn can still follow in this run. So people left behind are recycled near
//         Bessie one a second (retire, then spawn into the freed slot), a street she has just reached fills at
//         two a second, a full store stays full between runs, and a dropping target sheds two a second.
// A dog walker always comes with its dog: a Companion NPC at the same spot, linked both ways by handle; they
// spawn and retire together and take two store slots. Ambient spawns leave room for every named NPC (and dog)
// not yet spawned and every cat and bird not yet placed, so the store's NPC_CAPACITY (80, flock birds counted
// one by one) is never what stops an authored NPC; nothing ever pushes the store past its capacity.
//
// "Touches the view" is circleTouchesViewRect on the NPC's radius (tuning.json → streetLife.npcRadius:
// humanM for people, catM for cats and pigeons, which have no radius of their own, dogM for dogs); spawn
// points are tested with the largest of them. world.viewRect already holds LEVEL_DESIGN §9.4's 4 m margin.
//
// Hot path: stepNpcSpawner allocates nothing and passes no doubles across calls.
import { SIM_HZ } from '../constants.ts';
import { type Entities, NPC_IDS } from '../entities.ts';
import type { Level, NpcSpawn } from '../map.ts';
import { nextFloat, nextInt } from '../rng.ts';
import type { Tuning } from '../tuning.ts';
import { circleTouchesViewRect } from '../viewRect.ts';
import type { World } from '../world.ts';
import type { Behaviour } from './behaviour.ts';
import { addNpc, NO_NPC_HANDLE, NpcOrigin, npcHandle, removeNpc, resolveNpcHandle } from './store.ts';

/** Ticks between two runs of the population controller (LEVEL_DESIGN §9.4: every 1.0 s). */
export const NPC_SPAWN_EVERY_TICKS = SIM_HZ;
/** Ambient spawns and retirements per controller run, together (LEVEL_DESIGN §9.4). */
export const NPC_MAX_CHANGES = 2;
/** Ambient NPCs farther than this from Bessie (and off screen) are retired, metres (LEVEL_DESIGN §9.4). */
export const NPC_DESPAWN_M = 40;
/** Flock birds land within this many metres of their flock point, on each axis. */
export const FLOCK_SPREAD_M = 1.5;

/** Spawner state, built once per shift from the level's `spawns.npc` (createNpcSpawner). */
export type NpcSpawner = {
  /** False when the level has no `spawns.npc`: the spawner does nothing. */
  readonly active: boolean;
  /** Ambient spawn points: nav nodes (portals, doors, anchors; ascending, no repeats) and their positions. */
  readonly pointCount: number;
  readonly pointNode: Int32Array;
  readonly pointX: Float64Array;
  readonly pointY: Float64Array;
  /** The ambient mix, sorted by id: NPC kind, weight and cap (−1 = uncapped). */
  readonly mixCount: number;
  readonly mixKind: Uint8Array;
  readonly mixWeight: Float64Array;
  readonly mixCap: Int32Array;
  /** Population windows as ticks [from, to) and their targets. */
  readonly windowCount: number;
  readonly windowFromTick: Int32Array;
  readonly windowToTick: Int32Array;
  readonly windowTarget: Int32Array;
  /** Named NPCs: kind, spawn tick, how many are still to spawn, anchor node and position. */
  readonly namedCount: number;
  readonly namedKind: Uint8Array;
  readonly namedSpawnTick: Int32Array;
  readonly namedRemaining: Int32Array;
  readonly namedNode: Int32Array;
  readonly namedX: Float64Array;
  readonly namedY: Float64Array;
  /** Perched cats: kind, how many still wait, the wall perches and which hold a cat. */
  readonly perchKind: number;
  perchPending: number;
  readonly perchCount: number;
  readonly perchX: Float64Array;
  readonly perchY: Float64Array;
  readonly perchUsed: Uint8Array;
  /** Flocks per spec: kind, flocks still to place, size range, and the spec's points (CSR into flockX/Y). */
  readonly flockSpecCount: number;
  readonly flockKind: Uint8Array;
  readonly flockRemaining: Int32Array;
  readonly flockMin: Int32Array;
  readonly flockMax: Int32Array;
  readonly flockPointStart: Int32Array;
  readonly flockX: Float64Array;
  readonly flockY: Float64Array;
  /** Flocks placed so far (each bird's `group` is its flock's number). */
  flocksPlaced: number;
  /** NPC_IDS index of npc.dog_walker (whose spawns bring a dog). */
  readonly dogWalkerKind: number;
  /** Circle radius per NPC kind, metres. */
  readonly radiusByKind: Float64Array;
  /** [0] the largest NPC radius (spawn points), [1] the dog's, [2] a flock's reach (spread + bird radius). */
  readonly radii: Float64Array;
  /** Live ambient NPCs per kind and in all, as counted at the start of this controller run. */
  readonly ambientByKind: Int32Array;
  ambientCount: number;
  /** Ambient spawns and retirements this shift. */
  ambientSpawned: number;
  ambientRetired: number;
  /** Scratch: eligible candidate indices, and one bird position. */
  readonly eligible: Int32Array;
  readonly birdX: Float64Array;
  readonly birdY: Float64Array;
};

function kindIndex(id: string, where: string): number {
  const k = (NPC_IDS as readonly string[]).indexOf(id);
  if (k < 0) throw new Error(`${where}: ${id} is not an NPC kind of entities.json (NPC_IDS)`);
  return k;
}

/** Fill the per-kind radii and the spawn-point and flock radii from the tuning. */
function fillRadii(sp: NpcSpawner, tuning: Tuning, entities: Entities): void {
  const r = tuning.streetLife.npcRadius;
  for (let k = 0; k < NPC_IDS.length; k += 1) {
    const behaviour = entities.npcs[NPC_IDS[k] as (typeof NPC_IDS)[number]].behaviour;
    sp.radiusByKind[k] = behaviour === 'cat' || behaviour === 'pigeon' ? r.catM : r.humanM;
  }
  sp.radii[0] = Math.max(r.humanM, r.catM, r.dogM);
  sp.radii[1] = r.dogM;
  sp.radii[2] = FLOCK_SPREAD_M * Math.SQRT2 + r.catM;
}

/** The spawner for `level` (inactive when it has no `spawns.npc`). Setup only. */
export function createNpcSpawner(level: Level, tuning: Tuning, entities: Entities): NpcSpawner {
  const spec: NpcSpawn | null = level.npc;
  const where = `createNpcSpawner(${level.id})`;
  const nav = level.nav;
  // Spawn points: portals, doors and anchors, ascending node order, no repeats.
  const nodes = new Set<number>();
  if (spec !== null) {
    for (const n of nav.portals) nodes.add(n);
    for (const d of nav.doors) nodes.add(d.node);
    for (const a of nav.anchors) nodes.add(a.node);
  }
  const points = [...nodes].sort((a, b) => a - b);
  const pointX = new Float64Array(points.length);
  const pointY = new Float64Array(points.length);
  points.forEach((n, i) => {
    pointX[i] = nav.nodeX[n] as number;
    pointY[i] = nav.nodeY[n] as number;
  });
  const mix = spec?.mix ?? [];
  const caps = spec?.caps ?? [];
  const population = spec?.population ?? [];
  const named = spec?.named ?? [];
  const perches = spec?.perches ?? null;
  const flocks = spec?.flocks ?? [];
  const flockPointStart = new Int32Array(flocks.length + 1);
  flocks.forEach((f, i) => {
    flockPointStart[i + 1] = (flockPointStart[i] as number) + f.points.length;
  });
  const flockPoints = flocks.flatMap((f) => f.points);
  const walls = perches?.walls ?? [];
  const sp: NpcSpawner = {
    active: spec !== null,
    pointCount: points.length,
    pointNode: Int32Array.from(points),
    pointX,
    pointY,
    mixCount: mix.length,
    mixKind: Uint8Array.from(mix, (m) => kindIndex(m.id, `${where} mix`)),
    mixWeight: Float64Array.from(mix, (m) => m.weight),
    mixCap: Int32Array.from(mix, (m) => caps.find((c) => c.id === m.id)?.cap ?? -1),
    windowCount: population.length,
    windowFromTick: Int32Array.from(population, (p) => Math.round(p.fromS * SIM_HZ)),
    windowToTick: Int32Array.from(population, (p) => Math.round(p.toS * SIM_HZ)),
    windowTarget: Int32Array.from(population, (p) => p.target),
    namedCount: named.length,
    namedKind: Uint8Array.from(named, (n) => kindIndex(n.id, `${where} named`)),
    namedSpawnTick: Int32Array.from(named, (n) => Math.round(n.spawnAtS * SIM_HZ)),
    namedRemaining: Int32Array.from(named, (n) => n.count),
    namedNode: Int32Array.from(named, (n) => n.anchor),
    namedX: Float64Array.from(named, (n) => nav.nodeX[n.anchor] as number),
    namedY: Float64Array.from(named, (n) => nav.nodeY[n.anchor] as number),
    perchKind: perches === null ? 0 : kindIndex(perches.id, `${where} perches`),
    perchPending: perches?.count ?? 0,
    perchCount: walls.length,
    perchX: Float64Array.from(walls, (p) => p[0]),
    perchY: Float64Array.from(walls, (p) => p[1]),
    perchUsed: new Uint8Array(walls.length),
    flockSpecCount: flocks.length,
    flockKind: Uint8Array.from(flocks, (f) => kindIndex(f.id, `${where} flocks`)),
    flockRemaining: Int32Array.from(flocks, (f) => f.count),
    flockMin: Int32Array.from(flocks, (f) => f.size[0]),
    flockMax: Int32Array.from(flocks, (f) => f.size[1]),
    flockPointStart,
    flockX: Float64Array.from(flockPoints, (p) => p[0]),
    flockY: Float64Array.from(flockPoints, (p) => p[1]),
    flocksPlaced: 0,
    dogWalkerKind: kindIndex('npc.dog_walker', where),
    radiusByKind: new Float64Array(NPC_IDS.length),
    radii: new Float64Array(3),
    ambientByKind: new Int32Array(NPC_IDS.length),
    ambientCount: 0,
    ambientSpawned: 0,
    ambientRetired: 0,
    eligible: new Int32Array(Math.max(1, points.length, walls.length, flockPoints.length)),
    birdX: new Float64Array(1),
    birdY: new Float64Array(1),
  };
  fillRadii(sp, tuning, entities);
  return sp;
}

/** Take a new tuning's NPC radii (setWorldTuning); live NPCs take them too. Allocation-free. */
export function setNpcSpawnerTuning(w: World, tuning: Tuning, entities: Entities): void {
  const sp = w.npcAi.spawner;
  fillRadii(sp, tuning, entities);
  const npc = w.npc;
  for (let i = 0; i < npc.count; i += 1) {
    npc.radius[i] =
      npc.origin[i] === NpcOrigin.Companion
        ? (sp.radii[1] as number)
        : (sp.radiusByKind[npc.kind[i] as number] as number);
  }
}

/** The ambient target at `tick`: the population window holding it, 0 outside every window. */
export function populationTarget(sp: NpcSpawner, tick: number): number {
  for (let k = 0; k < sp.windowCount; k += 1) {
    if (tick >= (sp.windowFromTick[k] as number) && tick < (sp.windowToTick[k] as number)) {
      return sp.windowTarget[k] as number;
    }
  }
  return 0;
}

/** Store slots one NPC of `kind` takes (a dog walker brings its dog). */
function slotsFor(sp: NpcSpawner, kind: number): number {
  return kind === sp.dogWalkerKind ? 2 : 1;
}

/** Slots held back for named NPCs (and dogs) not yet spawned. */
function namedReserve(sp: NpcSpawner): number {
  let n = 0;
  for (let k = 0; k < sp.namedCount; k += 1) {
    n += (sp.namedRemaining[k] as number) * slotsFor(sp, sp.namedKind[k] as number);
  }
  return n;
}

/** Slots held back for cats and flock birds not yet placed (each flock at its largest size). */
function placedReserve(sp: NpcSpawner): number {
  let n = sp.perchPending;
  for (let f = 0; f < sp.flockSpecCount; f += 1)
    n += (sp.flockRemaining[f] as number) * (sp.flockMax[f] as number);
  return n;
}

/**
 * Add an NPC of `kind` and `origin` (spec entry `group`) at (xs[j], ys[j]), in its behaviour's initial state,
 * with its kind's radius and nav target `node`; a dog walker gets its dog. Returns the index, or −1 when the
 * store is full (the caller checks room first).
 */
function spawnAt(
  w: World,
  kind: number,
  origin: number,
  group: number,
  xs: Float64Array,
  ys: Float64Array,
  j: number,
  node: number,
): number {
  const npc = w.npc;
  const sp = w.npcAi.spawner;
  const behaviour = w.npcAi.behaviours[kind] as Behaviour;
  const i = addNpc(npc, kind, origin, group, xs, ys, j);
  if (i < 0) return -1;
  npc.state[i] = behaviour.initial;
  npc.radius[i] = sp.radiusByKind[kind] as number;
  npc.targetNode[i] = node;
  if (kind === sp.dogWalkerKind && origin !== NpcOrigin.Companion) {
    const d = addNpc(npc, kind, NpcOrigin.Companion, -1, xs, ys, j);
    if (d >= 0) {
      npc.state[d] = behaviour.initial;
      npc.radius[d] = sp.radii[1] as number;
      npc.targetNode[d] = node;
      npc.link[d] = npcHandle(npc, i);
      npc.link[i] = npcHandle(npc, d);
    }
  }
  return i;
}

/** Remove ambient NPC `i` and its dog, if it has one. */
function retire(w: World, i: number): void {
  const npc = w.npc;
  const self = npcHandle(npc, i);
  const dog = resolveNpcHandle(npc, npc.link[i] as number);
  if (dog >= 0) removeNpc(npc, dog);
  removeNpc(npc, resolveNpcHandle(npc, self));
}

/** Phase 7: the spawner's tick (see the file comment). */
export function stepNpcSpawner(w: World): void {
  const sp = w.npcAi.spawner;
  if (!sp.active) return;
  const tick = w.tick;
  spawnDueNamed(w, sp, tick);
  if (tick % NPC_SPAWN_EVERY_TICKS !== 0) return;
  placePerches(w, sp);
  placeFlocks(w, sp);
  controlAmbient(w, sp, tick);
}

function spawnDueNamed(w: World, sp: NpcSpawner, tick: number): void {
  const npc = w.npc;
  for (let k = 0; k < sp.namedCount; k += 1) {
    if (tick < (sp.namedSpawnTick[k] as number)) continue;
    const kind = sp.namedKind[k] as number;
    const need = slotsFor(sp, kind);
    while ((sp.namedRemaining[k] as number) > 0 && npc.count + need <= npc.capacity) {
      spawnAt(w, kind, NpcOrigin.Named, k, sp.namedX, sp.namedY, k, sp.namedNode[k] as number);
      sp.namedRemaining[k] = (sp.namedRemaining[k] as number) - 1;
    }
  }
}

function placePerches(w: World, sp: NpcSpawner): void {
  const npc = w.npc;
  const view = w.viewRect;
  const rs = sp.radiusByKind;
  const kind = sp.perchKind;
  while (sp.perchPending > 0 && npc.count + 1 + namedReserve(sp) <= npc.capacity) {
    let n = 0;
    if (sp.perchCount > 0) {
      for (let p = 0; p < sp.perchCount; p += 1) {
        if ((sp.perchUsed[p] as number) !== 0) continue;
        if (circleTouchesViewRect(view, sp.perchX, sp.perchY, p, rs, kind)) continue;
        sp.eligible[n] = p;
        n += 1;
      }
      if (n === 0) return;
      const p = sp.eligible[nextInt(w.npcAi.rng, n)] as number;
      sp.perchUsed[p] = 1;
      spawnAt(w, kind, NpcOrigin.Perch, p, sp.perchX, sp.perchY, p, -1);
    } else {
      // No wall perches listed: a provisional perch on a nav spawn point (SSP-087 moves cats to car roofs and
      // grooming spots).
      for (let p = 0; p < sp.pointCount; p += 1) {
        if (circleTouchesViewRect(view, sp.pointX, sp.pointY, p, rs, kind)) continue;
        sp.eligible[n] = p;
        n += 1;
      }
      if (n === 0) return;
      const p = sp.eligible[nextInt(w.npcAi.rng, n)] as number;
      spawnAt(w, kind, NpcOrigin.Perch, -1, sp.pointX, sp.pointY, p, sp.pointNode[p] as number);
    }
    sp.perchPending -= 1;
  }
}

function placeFlocks(w: World, sp: NpcSpawner): void {
  const npc = w.npc;
  const view = w.viewRect;
  const rng = w.npcAi.rng;
  for (let f = 0; f < sp.flockSpecCount; f += 1) {
    const p0 = sp.flockPointStart[f] as number;
    const p1 = sp.flockPointStart[f + 1] as number;
    const min = sp.flockMin[f] as number;
    const max = sp.flockMax[f] as number;
    const kind = sp.flockKind[f] as number;
    while ((sp.flockRemaining[f] as number) > 0 && npc.count + max + namedReserve(sp) <= npc.capacity) {
      let n = 0;
      for (let p = p0; p < p1; p += 1) {
        if (circleTouchesViewRect(view, sp.flockX, sp.flockY, p, sp.radii, 2)) continue;
        sp.eligible[n] = p;
        n += 1;
      }
      if (n === 0) break;
      const p = sp.eligible[nextInt(rng, n)] as number;
      const size = min + nextInt(rng, max - min + 1);
      const flock = sp.flocksPlaced;
      sp.flocksPlaced += 1;
      for (let b = 0; b < size; b += 1) {
        sp.birdX[0] = (sp.flockX[p] as number) + (nextFloat(rng) * 2 - 1) * FLOCK_SPREAD_M;
        sp.birdY[0] = (sp.flockY[p] as number) + (nextFloat(rng) * 2 - 1) * FLOCK_SPREAD_M;
        spawnAt(w, kind, NpcOrigin.Flock, flock, sp.birdX, sp.birdY, 0, -1);
      }
      sp.flockRemaining[f] = (sp.flockRemaining[f] as number) - 1;
    }
  }
}

function controlAmbient(w: World, sp: NpcSpawner, tick: number): void {
  const npc = w.npc;
  sp.ambientByKind.fill(0);
  sp.ambientCount = 0;
  for (let i = 0; i < npc.count; i += 1) {
    if ((npc.origin[i] as number) !== NpcOrigin.Ambient) continue;
    const k = npc.kind[i] as number;
    sp.ambientByKind[k] = (sp.ambientByKind[k] as number) + 1;
    sp.ambientCount += 1;
  }
  let budget = NPC_MAX_CHANGES;
  const target = populationTarget(sp, tick);
  while (budget > 0) {
    if (sp.ambientCount < target && spawnAmbient(w, sp)) {
      sp.ambientCount += 1;
      sp.ambientSpawned += 1;
      budget -= 1;
      continue;
    }
    // No spawn wanted or possible: retire someone left behind, if the street is over its target or a spawn can
    // still follow in this run (a lone retirement at target would only leave a gap until the next second).
    if (sp.ambientCount <= target && budget < 2) break;
    const i = farthestRetirable(w);
    if (i < 0) break;
    const k = npc.kind[i] as number;
    retire(w, i);
    sp.ambientByKind[k] = (sp.ambientByKind[k] as number) - 1;
    sp.ambientCount -= 1;
    sp.ambientRetired += 1;
    budget -= 1;
  }
}

/** The ambient NPC to retire next (farthest beyond NPC_DESPAWN_M, off screen with its dog), or −1. */
function farthestRetirable(w: World): number {
  const npc = w.npc;
  const view = w.viewRect;
  const bx = w.vehicle.xM;
  const by = w.vehicle.yM;
  let best = -1;
  let bestD2 = NPC_DESPAWN_M * NPC_DESPAWN_M;
  for (let i = 0; i < npc.count; i += 1) {
    if ((npc.origin[i] as number) !== NpcOrigin.Ambient) continue;
    const dx = (npc.x[i] as number) - bx;
    const dy = (npc.y[i] as number) - by;
    const d2 = dx * dx + dy * dy;
    if (!(d2 > bestD2)) continue;
    if (circleTouchesViewRect(view, npc.x, npc.y, i, npc.radius, i)) continue;
    const link = npc.link[i] as number;
    if (link !== NO_NPC_HANDLE) {
      const dog = resolveNpcHandle(npc, link);
      if (dog >= 0 && circleTouchesViewRect(view, npc.x, npc.y, dog, npc.radius, dog)) continue;
    }
    best = i;
    bestD2 = d2;
  }
  return best;
}

/** Spawn one ambient NPC (see the file comment, step 3b). False when none can spawn now. */
function spawnAmbient(w: World, sp: NpcSpawner): boolean {
  const npc = w.npc;
  const view = w.viewRect;
  const rng = w.npcAi.rng;
  const bx = w.vehicle.xM;
  const by = w.vehicle.yM;
  const maxD2 = NPC_DESPAWN_M * NPC_DESPAWN_M;
  let n = 0;
  for (let p = 0; p < sp.pointCount; p += 1) {
    const dx = (sp.pointX[p] as number) - bx;
    const dy = (sp.pointY[p] as number) - by;
    if (dx * dx + dy * dy > maxD2) continue;
    if (circleTouchesViewRect(view, sp.pointX, sp.pointY, p, sp.radii, 0)) continue;
    sp.eligible[n] = p;
    n += 1;
  }
  if (n === 0) return false;
  const free = npc.capacity - npc.count - namedReserve(sp) - placedReserve(sp);
  let total = 0;
  for (let m = 0; m < sp.mixCount; m += 1) {
    if (mixAllows(sp, m, free)) total += sp.mixWeight[m] as number;
  }
  if (!(total > 0)) return false;
  let r = nextFloat(rng) * total;
  let pick = -1;
  for (let m = 0; m < sp.mixCount; m += 1) {
    if (!mixAllows(sp, m, free)) continue;
    pick = m;
    r -= sp.mixWeight[m] as number;
    if (r < 0) break;
  }
  const kind = sp.mixKind[pick] as number;
  const p = sp.eligible[nextInt(rng, n)] as number;
  spawnAt(w, kind, NpcOrigin.Ambient, -1, sp.pointX, sp.pointY, p, sp.pointNode[p] as number);
  sp.ambientByKind[kind] = (sp.ambientByKind[kind] as number) + 1;
  return true;
}

/** Mix entry `m` may spawn: weight above 0, under its cap, and its slots fit in `free`. */
function mixAllows(sp: NpcSpawner, m: number, free: number): boolean {
  if (!((sp.mixWeight[m] as number) > 0)) return false;
  const kind = sp.mixKind[m] as number;
  const cap = sp.mixCap[m] as number;
  if (cap >= 0 && (sp.ambientByKind[kind] as number) >= cap) return false;
  return slotsFor(sp, kind) <= free;
}
